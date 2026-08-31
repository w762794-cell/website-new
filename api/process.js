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
        'suitable for TV/movie subtitles. Keep the same meaning, tone, and length appropriate for subtitles. ' +
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

    // ---- Step 3: Build the .srt file ----
    let srt = '';
    segments.forEach((seg, idx) => {
      const khmerText = translations[seg.id] || seg.text;
      srt += `${idx + 1}\n`;
      srt += `${formatTimestamp(seg.start)} --> ${formatTimestamp(seg.end)}\n`;
      srt += `${khmerText}\n\n`;
    });

    return res.status(200).json({
      srt,
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
