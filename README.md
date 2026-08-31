# រឿងចិន → Subtitle ខ្មែរ

គេហទំព័រសម្រាប់ upload mp3 រឿងចិន ហើយប្រព័ន្ធនឹង៖
1. ស្តាប់សំឡេង ហើយបំលែងទៅជាអក្សរចិន (transcribe) ដោយប្រើ **Groq Whisper API** (ឥតគិតថ្លៃ)
2. បកប្រែជាភាសាខ្មែរ ដោយប្រើ **Groq LLM** (`openai/gpt-oss-120b`, ឥតគិតថ្លៃ)
3. បង្កើតឯកសារ `.srt` ដែលមានពេលវេលា (timestamp) ត្រូវតាមសំឡេងនីមួយៗ
4. Host លើ **Vercel Free Plan**

មិនមានការបង្កើតសំឡេងខ្មែរ (voice/TTS) ទេ — មានតែ subtitle text ប៉ុណ្ណោះ។

## ដំណើរការតំឡើង (Setup)

### ១. ទទួល Groq API Key ដោយឥតគិតថ្លៃ
- ចូល https://console.groq.com/keys
- Sign up (ឥតគិតថ្លៃ) ហើយបង្កើត API Key ថ្មី
- ចម្លងលេខសំងាត់ (key) ទុក — **ត្រូវប្រាកដថាគ្មាន space ឬបន្ទាត់ទទេនៅចន្លោះក្នុង key**

### ២. Upload code ទៅ GitHub
- បង្កើត repository ថ្មីនៅ GitHub (ឧ. `khmer-subtitle-site`)
- Upload ឯកសារទាំងអស់ក្នុង folder នេះទៅ repository នោះ

### ៣. Deploy លើ Vercel
- ចូល https://vercel.com ហើយ Sign in ដោយ GitHub account
- ចុច "Add New Project" → ជ្រើសរើស repository `khmer-subtitle-site`
- មុនចុច Deploy សូមចូលទៅ **Environment Variables** ហើយបន្ថែម:
  - Type: **Secret**
  - Key: `GROQ_API_KEY`
  - Value: (paste key ដែលបានពី Groq)
- ចុច **Deploy**

## របៀបប្រើ

1. បើក website
2. ជ្រើសរើស ឬអូសឯកសារ mp3 (រឿងចិន) ចូល
3. ចុច "បំលែងឥឡូវនេះ"
4. រង់ចាំបន្តិច — វានឹងបង្ហាញអត្ថបទចិន + ការបកប្រែខ្មែរ រួមទាំងពេលវេលានីមួយៗ
5. ចុច "ទាញយកឯកសារ subtitle.srt" ដើម្បីយក subtitle file ទៅប្រើជាមួយ video/audio player

## កម្រិតកំណត់ដែលគួរដឹង (Free tier limits)

- **ទំហំឯកសារ**: Vercel Free plan កំណត់ request body ត្រឹម ~4.5 MB ក្នុងមួយការ upload
- **រយៈពេលដំណើរការ (timeout)**: function កំណត់ត្រឹម 60 វិនាទីក្នុងឯកសារ `vercel.json`
- **Groq Free tier**: មានកម្រិត tokens/minute — code មាន retry ស្វ័យប្រវត្តិរួចហើយ

## ឯកសារក្នុង project

```
khmer-subtitle-site/
├── api/
│   └── process.js       ← Serverless function: transcribe + translate + build .srt
├── public/
│   └── index.html        ← Frontend (upload UI)
├── package.json
├── vercel.json           ← កំណត់ function timeout
└── .env.example
```
