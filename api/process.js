const { formidable } = require('formidable');
const fs = require('fs');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

const SAMPLE_RATE = 24000; // mono 16-bit PCM working format for all internal audio math

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

// Split Khmer text into chunks small enough for the TTS endpoint (byte-limited, not char-limited).
function splitTextForTTS(text, maxBytes = 180) {
  const chunks = [];
  let current = '';

  const pushCurrent = () => {
    if (current.trim().length > 0) chunks.push(current.trim());
    current = '';
  };

  const pieces = text.split(/([។៕!?.\s])/).filter(Boolean);

  for (const piece of pieces) {
    const candidate = current + piece;
    if (Buffer.byteLength(candidate, 'utf8') > maxBytes) {
      if (current) {
        pushCurrent();
        current = piece;
      } else {
        let rest = piece;
        while (Buffer.byteLength(rest, 'utf8') > maxBytes) {
          let sliceLen = maxBytes;
          let slice = rest.slice(0, sliceLen);
          while (Buffer.byteLength(slice, 'utf8') > maxBytes && sliceLen > 1) {
            sliceLen -= 1;
            slice = rest.slice(0, sliceLen);
          }
          chunks.push(slice);
          rest = rest.slice(sliceLen);
        }
        current = rest;
      }
    } else {
      current = candidate;
    }
  }
  pushCurrent();

  return chunks.length ? chunks : [text];
}

// Fetch one chunk of Khmer speech audio (mp3 bytes) from Google Translate's unofficial TTS endpoint.
async function fetchTTSChunk(text) {
  const url =
    'https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=km&q=' +
    encodeURIComponent(text);

  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Referer: 'https://translate.google.com/',
    },
  });

  if (!res.ok) {
    throw new Error(`TTS endpoint failed (${res.status}) for chunk: "${text.slice(0, 20)}..."`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// Turn a full Khmer sentence into one concatenated raw mp3 Buffer (chunked internally if needed).
async function synthesizeKhmerMp3(text) {
  const chunks = splitTextForTTS(text);
  const buffers = [];
  for (const chunk of chunks) {
    const buf = await fetchTTSChunk(chunk);
    buffers.push(buf);
  }
  return Buffer.concat(buffers);
}

// Run an ffmpeg (static binary) process, feeding `input` to stdin and collecting stdout as a Buffer.
function runFfmpeg(args, input) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args);
    const outChunks = [];
    let stderr = '';

    proc.stdout.on('data', (d) => outChunks.push(d));
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-500)}`));
      } else {
        resolve(Buffer.concat(outChunks));
      }
    });

    proc.stdin.on('error', () => {}); // ignore EPIPE if ffmpeg exits early
    proc.stdin.write(input);
    proc.stdin.end();
  });
}

// Decode an mp3 Buffer into raw mono 16-bit PCM at SAMPLE_RATE.
async function decodeMp3ToPcm(mp3Buffer) {
  return runFfmpeg(
    ['-i', 'pipe:0', '-f', 's16le', '-acodec', 'pcm_s16le', '-ar', String(SAMPLE_RATE), '-ac', '1', 'pipe:1'],
    mp3Buffer
  );
}

// Encode raw mono 16-bit PCM at SAMPLE_RATE into an mp3 Buffer.
async function encodePcmToMp3(pcmBuffer) {
  return runFfmpeg(
    ['-f', 's16le', '-ar', String(SAMPLE_RATE), '-ac', '1', '-i', 'pipe:0', '-codec:a', 'libmp3lame', '-b:a', '64k', '-f', 'mp3', 'pipe:1'],
    pcmBuffer
  );
}

function silencePcm(seconds) {
  if (seconds <= 0) return Buffer.alloc(0);
  const numSamples = Math.round(seconds * SAMPLE_RATE);
  return Buffer.alloc(numSamples * 2); // 16-bit = 2 bytes/sample, zero = silence
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

// Run async tasks with limited concurrency, preserving input order in the result array.
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const current = nextIndex++;
      results[current] = await fn(items[current], current);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let apiKey = (process.env.GROQ_API_KEY || '').replace(/[\s\u00A0\u200B-\u200D\uFEFF]/g, '');
  apiKey = apiKey.replace(/[^A-Za-z0-9_\-]/g, '');
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
    const segments = transcription.segments || [];

    if (segments.length === 0) {
      return res.status(422).json({ error: 'រកមិនឃើញសំឡេងនិយាយនៅក្នុងឯកសារនេះទេ' });
    }

    // ---- Step 2: Translate each segment (Chinese -> Khmer) in batches ----
    const BATCH_SIZE = 12;
    const translations = {};

    for (let i = 0; i < segments.length; i += BATCH_SIZE) {
      const batch = segments
        .slice(i, i + BATCH_SIZE)
        .map((s) => ({ id: s.id, text: s.text.trim() }));

      const prompt =
        'You are a professional Chinese-to-Khmer subtitle translator. ' +
        'Translate the "text" field of each item below from Chinese to natural, fluent Khmer ' +
        'suitable for spoken narration. Keep the same meaning and tone. ' +
        'Return ONLY a JSON array, same order, same "id" values, each item shaped as {"id": <id>, "khmer": "<translation>"}. ' +
        'No explanation, no markdown fences, JSON only.\n\n' +
        `Input:\n${JSON.stringify(batch)}`;

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
          }),
        })
      );

      if (!chatRes.ok) {
        const errText = await chatRes.text();
        return res.status(502).json({ error: `កំហុសពី Translation API: ${errText}` });
      }

      const chatData = await chatRes.json();
      let content = chatData.choices[0].message.content.trim();
      content = content.replace(/^```json\s*/i, '').replace(/```$/, '').trim();

      let parsed;
      try {
        parsed = JSON.parse(content);
      } catch (e) {
        const match = content.match(/\[[\s\S]*\]/);
        parsed = match ? JSON.parse(match[0]) : [];
      }

      for (const item of parsed) {
        translations[item.id] = item.khmer;
      }
    }

    // ---- Step 3: Build the .srt file (kept as a bonus download) ----
    let srt = '';
    segments.forEach((seg, idx) => {
      const khmerText = translations[seg.id] || seg.text;
      srt += `${idx + 1}\n`;
      srt += `${formatTimestamp(seg.start)} --> ${formatTimestamp(seg.end)}\n`;
      srt += `${khmerText}\n\n`;
    });

    // ---- Step 4: Synthesize Khmer speech per segment (mp3), decode each to raw PCM ----
    const khmerTexts = segments.map((s) => (translations[s.id] || s.text).trim());

    let segmentPcms;
    try {
      segmentPcms = await mapWithConcurrency(khmerTexts, 4, async (text) => {
        if (!text) return Buffer.alloc(0);
        const mp3 = await synthesizeKhmerMp3(text);
        return decodeMp3ToPcm(mp3);
      });
    } catch (ttsErr) {
      return res.status(502).json({
        error: `កំហុសពេលបង្កើតសំឡេងខ្មែរ (TTS): ${ttsErr.message}. សូមសាកល្បងម្តងទៀត ឬប្រើ clip ខ្លីជាងនេះ`,
      });
    }

    // ---- Step 5: Lay segments onto a timeline matching the ORIGINAL Chinese timestamps ----
    // Each Khmer clip is placed no earlier than its original segment's start time. If a clip
    // runs longer than the gap to the next segment, following segments drift later to catch up
    // once a big enough gap appears again (no audio is sped up or cut).
    const parts = [];
    let currentTime = 0;

    segments.forEach((seg, idx) => {
      const pcm = segmentPcms[idx];
      if (pcm.length === 0) return;

      const desiredStart = seg.start;
      const gap = desiredStart - currentTime;
      if (gap > 0.05) {
        parts.push(silencePcm(gap));
        currentTime += gap;
      }

      parts.push(pcm);
      currentTime += pcm.length / (SAMPLE_RATE * 2);
    });

    const finalPcm = Buffer.concat(parts);

    let finalAudioBuffer;
    try {
      finalAudioBuffer = await encodePcmToMp3(finalPcm);
    } catch (encodeErr) {
      return res.status(502).json({ error: `កំហុសពេលបង្កើតឯកសារ mp3 ចុងក្រោយ: ${encodeErr.message}` });
    }

    const audioBase64 = finalAudioBuffer.toString('base64');

    return res.status(200).json({
      srt,
      audioBase64,
      audioMimeType: 'audio/mpeg',
      segments: segments.map((s) => ({
        start: s.start,
        end: s.end,
        original: s.text,
        khmer: translations[s.id] || '',
      })),
    });
  } catch (err) {
    const hint = /did not match the expected pattern/i.test(err.message || '')
      ? ' (GROQ_API_KEY ប្រហែលជានៅមានតួអក្សរលាក់ខាងក្នុង — សូមលុបចោល ហើយវាយបញ្ចូល key ដោយផ្ទាល់ដៃម្តងទៀត ជំនួសការ copy-paste)'
      : '';
    return res.status(500).json({ error: (err.message || 'មានបញ្ហាមិនស្គាល់មូលហេតុកើតឡើង') + hint });
  }
}
