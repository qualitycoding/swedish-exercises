# Weekly content refresh

A scheduled task runs this procedure once a week. Each run adds **one new theme** (four exercises: reading,
listening, writing, speaking) based on that week's Swedish news. It does not edit or delete existing themes:
their ids are the keys of learners' saved scores.

The rules come from the `learning-exercise-site` skill in `qualitycoding/skills` (sections 3–8 and 10). This file
is the checklist for one run.

## 1. Prepare

1. Clone this repository and run `npm ci && npx playwright install chromium` (or use a pre-installed Playwright of
   the same version), then `npm test`. If the suite fails **before** any change, stop and report: do not build on a
   broken baseline.
2. Read `data/manifest.json` and the newest three themes so the new theme differs in topic.

## 2. Choose the topic

1. Search the web for Swedish news from the past seven days (for example SVT Nyheter, Sveriges Radio Ekot, DN, SvD,
   TT via other outlets, and government or agency press releases).
2. Pick one story that matters to people living in Sweden and has at least two independent sources for each fact
   the exercises will use. Rotate between areas: politics and society, economy and work, science, health and
   environment, culture and sport, everyday life and rules. Do not pick the same area as the newest theme.
3. Political stories: describe procedures, results and each side's stated positions neutrally; no verdicts.

## 3. Write the theme

1. Copy the structure of an existing file in `data/themes/`. New id: a short ASCII slug plus the date,
   for example `bostader-20261114`. File name `data/themes/<id>.json`. `dateLabel` is the date the run researched
   the news, written in Swedish (`14 november 2026`). `sources` lists every source used (title and https URL).
2. Reading text 200–450 words, original wording, ending with a short coffee-room dialogue marked
   *påhittat exempel* that uses at least one `slang` term and some `vardagligt` terms; 10 questions.
3. Listening script 120–320 words, written for the exercise; only sourced facts about real people, never
   invented words, feelings or plans; 8 questions + 2 dictation sentences (no digits).
4. Writing: 4 gaps, 3 word-order sentences (no commas), 3 translations with keyword groups (stems of 2+ letters)
   and a model answer; an unscored free-writing task with checklist and model text.
5. Speaking: 6 read-aloud sentences (no digits) and 4 questions with keyword groups and a model answer.
6. Label every glossed word `[[word|explanation|label]]` with `slang`, `vardagligt`, `idiom` or no label.
   Explanations are in Swedish.
7. Add the file name as the **first** entry of `data/manifest.json` (newest first).

## 4. Verify, then publish

1. `node tools/validate.mjs` and `node --test tests/*.test.mjs` must both pass. Fix the theme, never the tests or
   the validator rules, to make them pass. If they still fail after three attempts, do not push: report what fails.
2. Check every sentence that names a real person against a source.
3. Commit as `Weekly theme: <title> (<dateLabel>)` and push to `main`.
4. Confirm in the Actions runs list that **CI**, **pages build and deployment** and **Live site check** all
   succeed for the pushed commit (github.io itself is not reachable from the agent sandbox).
5. Report: the theme title, the sources, the commit, and the three run results. If anything failed or was skipped,
   say so first.
