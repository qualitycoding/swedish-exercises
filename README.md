# Svenska på riktigt – Swedish current-affairs exercises

Reading, listening, writing and speaking exercises in Swedish about current events in Sweden.
Each exercise takes about ten minutes, is scored out of 10 and can be retried as often as you like.
Scores are saved in the browser (`localStorage`), with export/import on the *Om* page for moving between devices.

**Open it:** <https://qualitycoding.github.io/swedish-exercises/>

## What's inside

Six launch themes (news situation on 2 November 2026), four exercises each, plus one new theme a week:

| Theme | Topic |
|---|---|
| Regeringen | Government formation after the September 2026 election |
| Elpriset | High electricity prices in the south and the state's price cap |
| Lönerna | The 2027 wage round: unions demand 3.9 % |
| Maraton | Andreas Almgren wins the New York City Marathon on debut |
| Nya regler | New rules from 1 November (notifiable diseases, customs, sick reporting) |
| November | Weather outlook, darkness and TV on the sofa |

| Exercise | How it is scored (10 items, 1 point each) |
|---|---|
| **Läsförståelse** (reading) | Article with tap-to-reveal glossary; multiple choice and true/false. |
| **Hörförståelse** (listening) | Script read aloud by the browser's Swedish voice (speed control, play by part); 8 questions + 2 dictation sentences (word accuracy ≥ 90 % = 1, ≥ 70 % = ½). |
| **Skrivande** (writing) | Inflect words (½ point if only å/ä/ö or a single typo is wrong), build sentences with correct word order, translate (scored on required keywords, with a model answer). Plus an unscored free-writing task with checklist, model text and auto-saved draft. |
| **Tala** (speaking) | Read sentences aloud and answer questions. Speech recognition (`sv-SE`) compares what you said with the target (best of three attempts). Without speech recognition – or if you prefer – you listen to the model and assess yourself. |

### Slang and register labels

Every glossed word carries a label so it is clear how informal it is:
**SLANG** (informal, often young or group-bound – e.g. *knega*, *asgrym*, *softa*),
**VARDAGLIGT** (everyday spoken language – e.g. *vabba*, *pank*, *less*),
**IDIOM** (fixed expression – e.g. *det svider i plånboken*), and plain **ORD** for ordinary vocabulary.
Each reading text ends with an invented coffee-room dialogue (clearly marked *påhittat exempel*) where the colloquial words appear in context.

### Browser support for speech

- Text-to-speech uses `speechSynthesis`, which all mainstream browsers have; you need a Swedish voice installed in the device's text-to-speech settings. The listening page says which voice it found.
- Speech recognition uses `SpeechRecognition`/`webkitSpeechRecognition`: Chrome, Edge and Safari (Safari 14.1+ on macOS, 14.5+ on iOS). Firefox has it only behind a flag, so there the speaking exercises use self-assessment. Chrome sends the audio to Google's speech service for recognition.

## Weekly refresh

A scheduled task adds one new theme every week from that week's Swedish news, following [REFRESH.md](REFRESH.md).
New themes appear first on the start page; existing themes are never changed, so saved scores stay valid.

## Content and sources

The texts are written for language learning from news reports, with sources linked at the bottom of each reading exercise.
Listening scripts are written for the exercise. Nothing is copied from the sources. The news situation may have changed since the date shown.

## Development

No build step: plain HTML, CSS and ES modules, served as-is by GitHub Pages (branch `main`, folder `/`).

```sh
npm ci                      # Playwright 1.63.0 for the browser tests
npx playwright install chromium
npm test                    # validate data + unit tests + end-to-end tests in headless Chromium
npm run serve               # local server; open the printed URL
```

- `data/manifest.json` lists the theme files in order; `data/themes/<id>.json` holds one theme with its four exercises.
- Glossed words use the markup `[[word|explanation|label]]`, where label is `slang`, `vardagligt`, `idiom` or empty.
- `tools/validate.mjs` checks every exercise has exactly 10 scored items, that answers are consistent (model answers hit their own keywords, word-order sentences rebuild, answer indices are in range), that markup is well-formed, that each reading text contains slang, and that texts are a ten-minute length.
- `tests/e2e.test.mjs` answers every exercise correctly (expects 10/10) and wrongly (expects ≤ 2), checks scores persist across reloads, retry, next/previous navigation, the half-point rule, speech synthesis and the self-assessment fallback. The Web Speech API is replaced by a fake in tests.

### Adding a theme

1. Copy a file in `data/themes/`, change `id`, texts and questions (10 items per exercise).
2. Add it to `data/manifest.json`.
3. Run `npm test` and push. CI runs the same checks.

## Licence

[Apache License 2.0](LICENSE)
