const { formidable } = require('formidable');
const fs = require('fs');

// Vercel needs raw body (multipart), so disable the default JSON body parser.
export const config = {
  api: {
    bodyParser: false,
  },
};

function formatTimestamp(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds - Math.floor(seconds)) * 1000);
  const pad = (n, l = 2) => String(n).padStart(l, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

// Retry a fetch-returning function on Groq rate-limit (429) errors, honoring
// the "try again in Xs" hint in the error body when present.
async function fetchWithRetry(fn, maxRetries = 4) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fn();
    if (res.status !== 429) return res;

    const bodyText = await res.text();
    let waitMs = 2000 * (attempt + 1);
    const match = bodyText.match(/try again in ([\d.]+)s/i);
    if (match) waitMs = Math.ceil(parseFloat(match[1]) * 1000) + 300;

    if (attempt === maxRetries) {
      return { ok: false, status: 429, text: async () => bodyText };
    }
    await new Promise((r) => setTimeout(r, waitMs));
  }
}

function cleanEnvValue(v) {
  return (v || '').replace(/[\s\u00A0\u200B-\u200D\uFEFF]/g, '');
}

// Build short display lines from a set of word-level timestamps belonging to ONE sentence,
// breaking whenever there's a silence gap or the line gets too long. Because this only ever
// runs on the words of a single already-translated sentence, a split here never crosses a
// sentence boundary — it's purely about keeping subtitle lines short and silence-aware.
function buildLinesFromWords(words, opts = {}) {
  const SILENCE_GAP = opts.silenceGap ?? 0.5;
  const MAX_DURATION = opts.maxDuration ?? 6;
  const MAX_CHARS = opts.maxChars ?? 32;

  const lines = [];
  let current = null;

  for (const w of words) {
    const word = (w.word || '').trim();
    if (!word) continue;

    if (current) {
      const gap = w.start - current.end;
      const wouldBeDuration = w.end - current.start;
      const wouldBeChars = current.text.length + word.length;

      if (gap > SILENCE_GAP || wouldBeDuration > MAX_DURATION || wouldBeChars > MAX_CHARS) {
        lines.push(current);
        current = null;
      }
    }

    if (!current) {
      current = { text: word, start: w.start, end: w.end };
    } else {
      current.text += word;
      current.end = w.end;
    }
  }
  if (current) lines.push(current);

  return lines;
}

// Split a translated Khmer sentence across N sub-lines, proportionally to how long each
// corresponding original-language sub-line was (approximate, but keeps lines roughly matched
// to their share of the sentence instead of dumping the whole translation on the first line).
function splitTranslationAcrossLines(khmerText, originalLineTexts) {
  if (originalLineTexts.length <= 1) return [khmerText];

  const totalOriginalLen = originalLineTexts.reduce((sum, t) => sum + t.length, 0) || 1;
  const totalKhmerLen = khmerText.length;

  const parts = [];
  let consumed = 0;
  for (let i = 0; i < originalLineTexts.length; i++) {
    const isLast = i === originalLineTexts.length - 1;
    if (isLast) {
      parts.push(khmerText.slice(consumed).trim());
      break;
    }
    const share = originalLineTexts[i].length / totalOriginalLen;
    let take = Math.round(share * totalKhmerLen);
    // Prefer breaking on a space if one exists near the cut point, for slightly cleaner splits.
    let cut = consumed + take;
    const spacePos = khmerText.indexOf(' ', cut);
    if (spacePos !== -1 && spacePos - cut < 10) cut = spacePos;
    cut = Math.min(cut, khmerText.length);
    parts.push(khmerText.slice(consumed, cut).trim());
    consumed = cut;
  }
  return parts.filter((p) => p.length > 0).length ? parts : [khmerText];
}

// Ask the model to translate one batch of {id, text} sentences to Khmer, returning a
// map of id -> khmer. If the response is malformed/truncated/missing items, this recurses
// on smaller sub-batches (down to 1 sentence at a time) until every id is covered.
async function translateBatch(batch, contextTail, apiKey, depth = 0) {
  const contextBlock =
    contextTail.length > 0
      ? 'Context — the last few sentences already translated earlier in this same story ' +
        '(for continuity of names/tone only, do NOT re-translate or include these in your output):\n' +
        contextTail.map((c) => `- 中文: ${c.zh}\n  ខ្មែរ: ${c.km}`).join('\n') +
        '\n\n'
      : '';

  const prompt =
    'You are a professional Chinese-to-Khmer subtitle translator working through one continuous story, ' +
    'sentence by sentence, in order. Translate the "text" field of each item below from Chinese to natural, ' +
    'fluent Khmer suitable for TV/movie subtitles. Preserve the actual meaning and narrative continuity of the ' +
    'story (character names, who is speaking, pronouns, ongoing tone) — do not translate sentences as isolated, ' +
    'unrelated fragments. Keep each translation reasonably close in length to the original, suitable for a subtitle line. ' +
    `You MUST return exactly ${batch.length} item(s), one for every id listed, with no omissions.\n\n` +
    contextBlock +
    'Return ONLY a JSON array, same order, same "id" values, each item shaped as {"id": <id>, "khmer": "<translation>"}. ' +
    'No explanation, no markdown fences, JSON only.\n\n' +
    `Sentences to translate now:\n${JSON.stringify(batch)}`;

  const chatRes = await fetchWithRetry(() =>
    fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'openai/gpt-oss-120b',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens: 8000,
      }),
    })
  );

  let parsed = [];
  if (chatRes.ok) {
    const chatData = await chatRes.json();
    let content = (chatData.choices?.[0]?.message?.content || '').trim();
    content = content.replace(/^```json\s*/i, '').replace(/```$/, '').trim();
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      const match = content.match(/\[[\s\S]*\]/);
      if (match) {
        try {
          parsed = JSON.parse(match[0]);
        } catch (e2) {
          parsed = [];
        }
      }
    }
  }

  const result = {};
  for (const item of parsed) {
    if (item && item.khmer) result[item.id] = item.khmer;
  }

  const missing = batch.filter((b) => !result[b.id]);

  if (missing.length > 0) {
    if (batch.length === 1 || depth >= 6) {
      // Can't split further (or gone deep enough) — leave these missing; caller falls back
      // to the original Chinese text for any id still absent from the returned map.
      return result;
    }
    const mid = Math.ceil(missing.length / 2);
    const subA = missing.slice(0, mid);
    const subB = missing.slice(mid);
    const [resA, resB] = await Promise.all([
      translateBatch(subA, contextTail, apiKey, depth + 1),
      translateBatch(subB, contextTail, apiKey, depth + 1),
    ]);
    Object.assign(result, resA, resB);
  }

  return result;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = cleanEnvValue(process.env.GROQ_API_KEY).replace(/[^A-Za-z0-9_\-]/g, '');
  if (!apiKey) {
    return res
      .status(500)
      .json({ error: 'GROQ_API_KEY មិនត្រូវបានកំណត់ក្នុង Environment Variables របស់ Vercel ទេ' });
  }

  try {
    const form = formidable({ maxFileSize: 20 * 1024 * 1024 });
    const [, files] = await form.parse(req);
    const fileField = files.audio;
    const file = Array.isArray(fileField) ? fileField[0] : fileField;

    if (!file) {
      return res.status(400).json({ error: 'មិនមានឯកសារសំឡេងត្រូវបានផ្ញើមកទេ' });
    }

    const nameLooksLikeMp3 = /\.mp3$/i.test(file.originalFilename || '');
    const typeLooksLikeMp3 = (file.mimetype || '').includes('audio');
    if (!nameLooksLikeMp3 && !typeLooksLikeMp3) {
      return res.status(400).json({ error: 'សូម upload តែឯកសារ .mp3 ប៉ុណ្ណោះ (ឯកសារ video ដូចជា .mp4 មិនអាចប្រើបានទេ)' });
    }

    // ---- Step 1: Transcribe Chinese speech with Groq's hosted Whisper ----
    const audioBuffer = fs.readFileSync(file.filepath);
    const blob = new Blob([audioBuffer], { type: file.mimetype || 'audio/mpeg' });

    const whisperForm = new FormData();
    whisperForm.append('file', blob, file.originalFilename || 'audio.mp3');
    whisperForm.append('model', 'whisper-large-v3');
    whisperForm.append('response_format', 'verbose_json');
    whisperForm.append('language', 'zh');
    whisperForm.append('timestamp_granularities[]', 'segment');
    whisperForm.append('timestamp_granularities[]', 'word');
    whisperForm.append('temperature', '0');

    const transcribeRes = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: whisperForm,
    });

    if (!transcribeRes.ok) {
      const errText = await transcribeRes.text();
      return res.status(502).json({ error: `កំហុសពី Whisper API: ${errText}` });
    }

    const transcription = await transcribeRes.json();
    const rawSegments = transcription.segments || [];
    const words = transcription.words || [];

    if (rawSegments.length === 0) {
      return res.status(422).json({ error: 'រកមិនឃើញសំឡេងនិយាយនៅក្នុងឯកសារនេះទេ' });
    }

    // Group words under the (full-sentence) Whisper segment they fall within, so we can
    // translate at the sentence level (context intact) while still building short,
    // silence-aware display lines from each sentence's own words afterward.
    let wordCursor = 0;
    const sentenceWordGroups = rawSegments.map((seg) => {
      const group = [];
      while (wordCursor < words.length && words[wordCursor].start < seg.end + 0.05) {
        if (words[wordCursor].start >= seg.start - 0.05) group.push(words[wordCursor]);
        wordCursor++;
      }
      return group;
    });

    // ---- Step 2: Translate FULL SENTENCES (Chinese -> Khmer) in batches, with rolling
    // context from the previous batch so names/pronouns/tone stay consistent across the story ----
    const BATCH_SIZE = 10;
    const translations = {}; // keyed by rawSegments index
    let contextTail = []; // last few {zh, km} pairs, for continuity only

    for (let i = 0; i < rawSegments.length; i += BATCH_SIZE) {
      const batchSegs = rawSegments.slice(i, i + BATCH_SIZE);
      const batch = batchSegs.map((s, j) => ({ id: i + j, text: s.text.trim() }));

      const batchResult = await translateBatch(batch, contextTail, apiKey);
      Object.assign(translations, batchResult);

      // Carry the last 3 sentences of this batch forward as context for the next one.
      contextTail = batchSegs.slice(-3).map((s, k) => {
        const idx = i + batchSegs.length - Math.min(3, batchSegs.length) + k;
        return { zh: s.text.trim(), km: translations[idx] || '' };
      });
    }

    // ---- Step 3: Build short, silence-aware subtitle lines, distributing each sentence's
    // already-translated Khmer text across its own sub-lines (never crossing sentence bounds) ----
    const outputLines = [];

    rawSegments.forEach((seg, idx) => {
      const khmerFull = (translations[idx] || seg.text).trim();
      const wordGroup = sentenceWordGroups[idx];

      const subLines = wordGroup && wordGroup.length > 0 ? buildLinesFromWords(wordGroup) : null;

      if (!subLines || subLines.length === 0) {
        outputLines.push({ text: khmerFull, start: seg.start, end: seg.end, original: seg.text.trim() });
        return;
      }

      const originalTexts = subLines.map((l) => l.text);
      const khmerParts = splitTranslationAcrossLines(khmerFull, originalTexts);

      subLines.forEach((line, k) => {
        outputLines.push({
          text: khmerParts[k] || (k === 0 ? khmerFull : ''),
          start: line.start,
          end: line.end,
          original: line.text,
        });
      });
    });

    // ---- Step 4: Build the .srt file ----
    let srt = '';
    outputLines.forEach((line, idx) => {
      srt += `${idx + 1}\n`;
      srt += `${formatTimestamp(line.start)} --> ${formatTimestamp(line.end)}\n`;
      srt += `${line.text}\n\n`;
    });

    return res.status(200).json({
      srt,
      segments: outputLines.map((l) => ({
        start: l.start,
        end: l.end,
        original: l.original,
        khmer: l.text,
      })),
    });
  } catch (err) {
    const hint = /did not match the expected pattern/i.test(err.message || '')
      ? ' (GROQ_API_KEY ប្រហែលជានៅមានតួអក្សរលាក់ខាងក្នុង — សូមលុបចោល ហើយវាយបញ្ចូល key ដោយផ្ទាល់ដៃម្តងទៀត ជំនួសការ copy-paste)'
      : '';
    return res.status(500).json({ error: (err.message || 'មានបញ្ហាមិនស្គាល់មូលហេតុកើតឡើង') + hint });
  }
}
