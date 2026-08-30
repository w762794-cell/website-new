# រឿងចិន → សំឡេងខ្មែរ (Khmer Voice Dubbing)

គេហទំព័រសម្រាប់ upload mp3 រឿងចិន ហើយប្រព័ន្ធនឹង៖
1. ស្តាប់សំឡេង ហើយបំលែងទៅជាអក្សរចិន (transcribe) ដោយប្រើ **Groq Whisper API** (ឥតគិតថ្លៃ)
2. បកប្រែជាភាសាខ្មែរ ដោយប្រើ **Groq LLM** (`openai/gpt-oss-120b`, ឥតគិតថ្លៃ)
3. បង្កើត **សំឡេងខ្មែរនិយាយ** (text-to-speech) សម្រាប់ប្រយោគនីមួយៗ ហើយបញ្ចូលគ្នាទៅជា mp3 មួយ
4. ជាបន្ថែម៖ បង្កើតឯកសារ `.srt` ផងដែរ (subtitle មានពេលវេលា)
5. Host លើ **Vercel Free Plan**

## របៀបបង្កើតសំឡេងខ្មែរ (TTS)

ប្រើ Google Translate's unofficial text-to-speech endpoint (ឥតគិតថ្លៃ គ្មាន API key ត្រូវការ)
ដើម្បីអានប្រយោគខ្មែរនីមួយៗ រួចយកសំឡេងទាំងអស់មកតគ្នាតាមលំដាប់ (ដូចជា narrator អានរឿងបន្តបន្ទាប់គ្នា)។

**ចំណាំសំខាន់**: endpoint នេះជា unofficial (មិនមែន Google Cloud TTS ផ្លូវការទេ) ដូច្នេះ៖
- វាអាចមាន **rate limit** ប្រសិនបើប្រើញឹកញាប់ពេក ឬច្រើននាក់ប្រើក្នុងពេលតែមួយ
  (ដូចបញ្ហាដែលធ្លាប់ជួបនៅក្នុងគម្រោង `telegram-srt-bot` ពីមុន)
- សំឡេងនិងចង្វាក់អានប្រហែលជាមិនដូចជា voice actor ពិតទេ ព្រោះជា robotic TTS voice
- ការតគ្នា (concatenation) នៃប្រយោគនីមួយៗ **មិនមានការគណនាតាមវិនាទីច្បាស់លាស់** ដូចវីដេអូដើមទេ
  វាគ្រាន់តែអានតគ្នាបន្តបន្ទាប់ (គ្មានចន្លោះពេលច្បាស់លាស់ដូចអូឌីយ៉ូដើម) — សមរម្យសម្រាប់ស្តាប់រឿង
  ជា narration ថ្មី មិនមែនសម្រាប់ sync ជាមួយវីដេអូដើមទេ។ បើត្រូវការ sync ជាមួយវីដេអូ សូមប្រាប់
  ខ្ញុំ អាចបន្ថែម feature នោះនៅពេលក្រោយ (ត្រូវការ ffmpeg សម្រាប់បញ្ចូល silence gaps)។

## ដំណើរការតំឡើង (Setup)

### ១. ទទួល Groq API Key ដោយឥតគិតថ្លៃ
- ចូល https://console.groq.com/keys
- Sign up (ឥតគិតថ្លៃ) ហើយបង្កើត API Key ថ្មី
- ចម្លងលេខសំងាត់ (key) ទុក — **ត្រូវប្រាកដថាគ្មាន space ឬបន្ទាត់ទទេនៅចុងពេល paste**

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
2. ជ្រើសរើសឯកសារ mp3 (រឿងចិន) — តូចជាង ៤.៤ MB
3. ចុច "បំលែងឥឡូវនេះ"
4. រង់ចាំបន្តិច (អាចចំណាយពេល ១-២ នាទី អាស្រ័យលើប្រវែងឯកសារ)
5. ស្តាប់សំឡេងខ្មែរផ្ទាល់ក្នុងទំព័រ ឬចុច "ទាញយកសំឡេងខ្មែរ (.mp3)"
6. ចង់បាន subtitle timing ដែរ អាចទាញយក `.srt` បន្ថែមបានផងដែរ

## កម្រិតកំណត់ដែលគួរដឹង (Free tier limits)

- **ទំហំឯកសារ**: Vercel Free plan កំណត់ request body ត្រឹម ~4.5 MB ក្នុងមួយការ upload
  ដូច្នេះគួរប្រើ mp3 clip ខ្លីៗ (ប្រហែល ២-៤ នាទី)។
- **រយៈពេលដំណើរការ (timeout)**: function កំណត់ត្រឹម 60 វិនាទីក្នុងឯកសារ `vercel.json`
  ការធ្វើ TTS ម្តងមួយប្រយោគ អាចចំណាយពេលច្រើនប្រសិនបើឯកសារមានប្រយោគច្រើន។ បើលើសពេល
  អាចត្រូវការ upgrade ទៅ Vercel Pro ឬកាត់ clip ឲ្យខ្លីជាងនេះ។
- **Groq Free tier**: មានកម្រិត requests/tokens ក្នុងមួយថ្ងៃ
- **Google TTS endpoint**: unofficial ដូច្នេះអាចត្រូវបាន block ឬ rate-limit ពេលប្រើច្រើនពេក

## ឯកសារក្នុង project

```
khmer-subtitle-site/
├── api/
│   └── process.js       ← transcribe (Whisper) + translate (Groq LLM) + TTS + build .srt
├── public/
│   └── index.html        ← Frontend (upload UI + audio player)
├── package.json
├── vercel.json           ← កំណត់ function timeout
└── .env.example
```
