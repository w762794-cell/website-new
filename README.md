# រឿងចិន → សំឡេងខ្មែរ (Khmer Voice Dubbing)

គេហទំព័រសម្រាប់ upload mp3 រឿងចិន ហើយប្រព័ន្ធនឹង៖
1. ស្តាប់សំឡេង ហើយបំលែងទៅជាអក្សរចិន (transcribe) ដោយប្រើ **Groq Whisper API** (ឥតគិតថ្លៃ)
2. បកប្រែជាភាសាខ្មែរ ដោយប្រើ **Groq LLM** (`openai/gpt-oss-120b`, ឥតគិតថ្លៃ)
3. បង្កើត **សំឡេងខ្មែរនិយាយ** (text-to-speech) សម្រាប់ប្រយោគនីមួយៗ ហើយបញ្ចូលគ្នាទៅជា mp3 មួយ
4. ជាបន្ថែម៖ បង្កើតឯកសារ `.srt` ផងដែរ (subtitle មានពេលវេលា)
5. Host លើ **Vercel Free Plan**

## របៀបធ្វើសំឡេងខ្មែរឲ្យ sync តាមវិនាទី

ឥឡូវនេះ សំឡេងខ្មែរនិយាយនីមួយៗ **ចាប់ផ្តើមមិនលឿនជាងចំណុចវិនាទីដើមរបស់ភាសាចិន** នៅត្រង់ប្រយោគនោះ
(យក timestamp ពី Whisper) ។ ប្រព័ន្ធប្រើ **ffmpeg** (static binary ដាក់ក្នុង project ដោយស្វ័យប្រវត្តិ)
ដើម្បី៖
1. បំលែងសំឡេង TTS នីមួយៗទៅជា raw audio (PCM)
2. គណនា និងបញ្ចូល "ភាពស្ងាត់" (silence) ចន្លោះប្រយោគនីមួយៗ ដើម្បីឲ្យត្រូវនឹងវិនាទីដើម
3. បំលែងចុងក្រោយត្រឡប់ទៅជា mp3 មួយ

**ដែនកំណត់**: បើសំឡេងខ្មែរនិយាយវែងជាងចន្លោះពេលរបស់ប្រយោគដើម (ព្រោះភាសាខ្មែរជាធម្មតាវែងជាងចិន)
ប្រយោគបន្ទាប់នឹង **យឺតទៅមុខបន្តិច** ដោយស្វ័យប្រវត្តិ (គ្មានការកាត់ ឬបង្កើនល្បឿនសំឡេងទេ) រហូតដល់
មានចន្លោះគ្រប់គ្រាន់សម្រាប់ "ដេញតាម" ពេលវិញ។ នេះមានន័យថា ចំណុចខ្លះអាចមិនត្រូវគ្នា 100% ជាមួយ
វីដេអូដើមទេ ប៉ុន្តែជាទូទៅនឹងជិតដិតគ្នាណាស់សម្រាប់ការស្តាប់ជា narration ។

**ហានិភ័យលើ Vercel Free**: ffmpeg binary មានទំហំធំ (~២៥-៣០ MB) ដូច្នេះ function bundle សរុប
អាចជិតដល់ដែនកំណត់ទំហំរបស់ Vercel Hobby (50 MB uncompressed)។ បើ deploy បរាជ័យដោយសារតែ
ទំហំធំពេក សូមប្រាប់ខ្ញុំ ខ្ញុំអាចត្រឡប់ទៅជាវិធីសាមញ្ញជាងមុន (អានតគ្នាបន្តបន្ទាប់ គ្មាន sync ច្បាស់លាស់)
ដែលមិនត្រូវការ ffmpeg ទេ។

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
