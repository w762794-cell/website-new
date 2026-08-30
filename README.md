# រឿងចិន → Subtitle ខ្មែរ

គេហទំព័រសម្រាប់ upload mp3 រឿងចិន ហើយប្រព័ន្ធនឹង៖
1. ស្តាប់សំឡេង ហើយបំលែងទៅជាអក្សរចិន (transcribe) ដោយប្រើ **Groq Whisper API** (ឥតគិតថ្លៃ)
2. បកប្រែជាភាសាខ្មែរ ដោយប្រើ **Groq LLM** (Llama 3.3, ឥតគិតថ្លៃ)
3. បង្កើតឯកសារ `.srt` ដែលមានពេលវេលា (timestamp) ត្រូវតាមសំឡេងនីមួយៗ
4. Host លើ **Vercel Free Plan**

## ហេតុអ្វីមិនប្រើ Whisper ដំណើរការក្នុងម៉ាស៊ីនផ្ទាល់ (local)?

គម្រោង Telegram bot ពីមុនរបស់អ្នក (`telegram-srt-bot`) ជួប Whisper OOM (memory not enough)
ព្រោះវាព្យាយាមដំណើរការ Whisper model ដោយផ្ទាល់នៅលើ Render free tier។ Vercel free tier
មានកម្រិតតឹងជាងទៀត (គ្មាន GPU, function size តូច, timeout ខ្លី) ដូច្នេះគេហទំព័រនេះ
ប្រើ **Groq's hosted Whisper API** ជំនួសវិញ — ការគណនាធ្ងន់ៗកើតឡើងនៅលើ server របស់ Groq
មិនមែននៅលើ Vercel ទេ ដូច្នេះមិនជួប OOM ទៀត។ Groq ក៏មាន free tier សម្រាប់ការបកប្រែផងដែរ
(មិនប្រើ Google Translate ទៀត ដូច្នេះជៀសផុតពីបញ្ហា rate-limit ដែលធ្លាប់ជួប)។

## ដំណើរការតំឡើង (Setup)

### ១. ទទួល Groq API Key ដោយឥតគិតថ្លៃ
- ចូល https://console.groq.com/keys
- Sign up (ឥតគិតថ្លៃ) ហើយបង្កើត API Key ថ្មី
- ចម្លងលេខសំងាត់ (key) ទុក

### ២. Upload code ទៅ GitHub
- បង្កើត repository ថ្មីនៅ GitHub (ឧ. `khmer-subtitle-site`)
- Upload ឯកសារទាំងអស់ក្នុង folder នេះទៅ repository នោះ (អាច upload ដោយ browser ពី iPhone
  បានដូចគម្រោង Telegram bot ពីមុនរបស់អ្នក)

### ៣. Deploy លើ Vercel
- ចូល https://vercel.com ហើយ Sign in ដោយ GitHub account
- ចុច "Add New Project" → ជ្រើសរើស repository `khmer-subtitle-site`
- មុនចុច Deploy សូមចូលទៅ **Environment Variables** ហើយបន្ថែម:
  - Name: `GROQ_API_KEY`
  - Value: (paste key ដែលបានពី Groq)
- ចុច **Deploy**

Vercel នឹងផ្តល់ link ដូចជា `https://khmer-subtitle-site.vercel.app`

## របៀបប្រើ

1. បើក website
2. ជ្រើសរើស ឬអូសឯកសារ mp3 (រឿងចិន) ចូល
3. ចុច "បំលែងឥឡូវនេះ"
4. រង់ចាំបន្តិច — វានឹងបង្ហាញអត្ថបទចិន + ការបកប្រែខ្មែរ រួមទាំងពេលវេលានីមួយៗ
5. ចុច "ទាញយកឯកសារ subtitle.srt" ដើម្បីយក subtitle file ទៅប្រើជាមួយ video/audio player

## កម្រិតកំណត់ដែលគួរដឹង (Free tier limits)

- **ទំហំឯកសារ**: Vercel Free plan កំណត់ request body ត្រឹម ~4.5 MB ក្នុងមួយការ upload
  ដូច្នេះគួរប្រើ mp3 clip ខ្លីៗ (ប្រហែល ២-៤ នាទី ចំពោះ bitrate ធម្មតា)។ បើឯកសារធំជាងនេះ
  គួរកាត់ជា clip តូចៗសិន ឬកែសម្រួល bitrate ឲ្យទាប។
- **រយៈពេលដំណើរការ (timeout)**: function កំណត់ត្រឹម 60 វិនាទីក្នុងឯកសារ `vercel.json`
  ប៉ុន្តែ Vercel Free plan អាចដាក់កម្រិត timeout ខ្លីជាងនេះទៅតាមគោលការណ៍បច្ចុប្បន្នរបស់ Vercel
  (សូមពិនិត្យក្នុង Vercel Dashboard → Project Settings → Functions)។ បើឯកសារវែងជាងនេះ
  ត្រូវការពេលច្រើនជាង function timeout អាចត្រូវការ upgrade ទៅ Vercel Pro ឬ
  បំបែកឯកសារជាផ្នែកតូចៗ (chunking) — អាចស្នើឲ្យខ្ញុំបន្ថែម feature នេះនៅពេលក្រោយបាន។
- **Groq Free tier**: មានកម្រិត requests/tokens ក្នុងមួយថ្ងៃ គ្រប់គ្រាន់សម្រាប់សាកល្បង
  ប៉ុន្តែប្រសិនបើប្រើច្រើននឹងត្រូវរង់ចាំ ឬ upgrade គណនី Groq។

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
