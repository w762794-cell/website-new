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

// Split Khmer text into chunks small enough for the TTS endpoint (byte-limited, not char-limited).
function splitTextForTTS(text, maxBytes = 180) {
  const chunks = [];
  let current = '';

  const pushCurrent = () => {
    if (current.trim().length > 0) chunks.push(current.trim());
    current = '';
  };

  // Try to split on sentence-ish punctuation / spaces first, else fall back to hard slicing.
  const pieces = text.split(/([។៕!?.\s])/).filter(Boolean);

  for (const piece of pieces) {
    const candidate = current + piece;
    if (Buffer.byteLength(candidate, 'utf8') > maxBytes) {
      if (current) {
        pushCurrent();
        current = piece;
      } else {
        // Single piece itself too long (no spaces) — hard slice by bytes.
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

// Fetch one chunk of Khmer speech audio from Google Translate's unofficial TTS endpoint.
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

// Turn a full Khmer sentence into one concatenated mp3 Buffer (chunked internally if needed).
async function synthesizeKhmer(text) {
  const chunks = splitTextForTTS(text);
  const buffers = [];
  for (const chunk of chunks) {
    // Sequential per-chunk to stay polite to the free endpoint and preserve order.
    const buf = await fetchTTSChunk(chunk);
    buffers.push(buf);
  }
  return Buffer.concat(buffers);
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

  const apiKey = (process.env.GROQ_API_KEY || '').trim();
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
    const BATCH_SIZE = 25;
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

      const chatRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
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
      });

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
    segments.forEach((idxSeg, idx) => {
      const khmerText = translations[idxSeg.id] || idxSeg.text;
      srt += `${idx + 1}\n`;
      srt += `${formatTimestamp(idxSeg.start)} --> ${formatTimestamp(idxSeg.end)}\n`;
      srt += `${khmerText}\n\n`;
    });

    // ---- Step 4: Synthesize Khmer speech for each segment, then stitch into one mp3 ----
    const khmerTexts = segments.map((s) => (translations[s.id] || s.text).trim()).filter(Boolean);

    let audioBuffers;
    try {
      audioBuffers = await mapWithConcurrency(khmerTexts, 4, synthesizeKhmer);
    } catch (ttsErr) {
      return res.status(502).json({
        error: `កំហុសពេលបង្កើតសំឡេងខ្មែរ (TTS): ${ttsErr.message}. សូមសាកល្បងម្តងទៀត ឬប្រើ clip ខ្លីជាងនេះ`,
      });
    }

    const finalAudioBuffer = Buffer.concat(audioBuffers);
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
    return res.status(500).json({ error: err.message || 'មានបញ្ហាមិនស្គាល់មូលហេតុកើតឡើង' });
  }
}
