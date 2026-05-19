# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the app

There is no build step. The app uses native ES modules and `fetch`, so it cannot be opened directly as a `file://` URL — serve it with a local HTTP server:

```
python -m http.server 8000
# then open http://localhost:8000/
```

There are no tests, no linter, and no package manager configuration.

## Architecture

This is a zero-dependency, vanilla JavaScript single-page app. All state lives in memory; there is no backend.

**Data flow on test start:**
1. `app.js` fetches `data/questions.json` once at startup.
2. `selector.js:selectQuestions()` picks 20 questions using proportional allocation across topics (largest-remainder method), so every topic is represented fairly regardless of pool size.
3. For each selected question, `renderers.js:buildOptionsForInstance()` shuffles the answer options and stores the shuffled order in the answer record — this snapshot is reused on the review screen so option labels stay consistent.

**Question types** (defined in `questions.json`, handled by all four JS modules):
- `single` — radio buttons; one correct answer from `optionCorrect`/`correct`.
- `multi-exact` — checkboxes; user must pick exactly `requiredCount` correct answers.
- `open` — free-text input; scored by `fuzzy.js` against `acceptableAnswers`/`correct`. If `userSpecific: true` (e.g., "Who is your senator?"), auto-scoring is skipped and the user self-assesses.

**Module responsibilities:**
- `js/selector.js` — question bank sampling; exports `selectQuestions`, `shuffle`, `TEST_SIZE`.
- `js/renderers.js` — DOM construction for the quiz form; returns a `{ readAnswer, isReady, focus? }` helper object that `app.js` calls without needing to know the question type.
- `js/scorer.js` — pure scoring logic; delegates open-answer matching to `fuzzy.js`.
- `js/fuzzy.js` — normalizes text (lowercases, strips stopwords/punctuation) and computes Levenshtein similarity; `isFuzzyMatch` uses a 0.8 threshold but requires exact match for short or numeric tokens to avoid false positives.
- `js/app.js` — view controller; owns `state = { questions, answers, currentIndex }` and wires all DOM events.

**Question data schema** (`data/questions.json`):
- `correct` — canonical correct string(s); used for scoring and review display.
- `optionCorrect` — the subset of `options` that are correct (used when `options` contains distractors from the USCIS source).
- `acceptableAnswers` — broader set accepted for fuzzy open-answer matching.
- `userSpecific: true` — flags questions whose correct answer depends on the test-taker's state or current officials.
- `specialConsideration65_20` — marks questions eligible for the 65+/20-year residency exemption (informational only; not used by scoring logic).

**View routing:** `showView(name)` simply toggles the `hidden` attribute on the four `<section>` elements (`welcome`, `quiz`, `results`, `review`). There is no URL routing.
