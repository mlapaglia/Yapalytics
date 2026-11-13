# 001 AI mood scoring

Status: Draft (built, awaiting review) · PR:

## Problem

Mood scores come from VADER, a word list. It adds up the words it knows, so it misses
sarcasm ("yeah right, like that'll happen 🙄" scores positive), slang it has no entry
for, and anything that depends on how words fit together. It is fast and explainable,
but for chat it is often wrong.

A small sentiment model trained on tweets reads short, informal text much better. It can
run in the browser, so it keeps the promise that messages never leave the device.

## Goals and non-goals

- Let the user switch the Mood chart and the message scores from VADER to an AI model
  that runs in their browser.
- Keep VADER as the default: instant, no download.
- Not in scope: scoring with context from earlier messages (the model was trained on
  single tweets, so pairs would be out of distribution); WebGPU acceleration; keeping
  scores between visits; emotions beyond positive / neutral / negative.

## Requirements

- **R1** VADER stays the default scorer. Nothing is downloaded until the user asks for
  the AI model.
- **R2** Before downloading, the card says what will happen: about 126 MB, downloaded
  once from Hugging Face and the jsDelivr CDN, then run in this tab, with no message
  text leaving the device.
- **R3** The AI model scores exactly the messages VADER scores (messages with letters,
  emoji turned into words for VADER only, no reactions), so the two are comparable.
- **R4** Scoring shows progress (download, then "n of N messages") and can be stopped.
- **R5** The chart, its note and the message scores switch to the AI scores only when
  every message has one. A stopped or failed run leaves everything on VADER, keeps the
  scores done so far, and resumes from there next time.
- **R6** Each identical text is scored once.
- **R7** The user can switch back to VADER at any time, instantly, and back to AI
  without scoring again.
- **R8** Messages added later with **+ Add files** are scored automatically while the AI
  scorer is on. The chart stays on AI scores and updates when they're done.
- **R9** With the AI scorer on, a message's score pill explains itself with the model's
  three probabilities and the VADER score for comparison.
- **R10** If the model can't load (offline, blocked CDN), the card says so in plain words
  and stays on VADER.

## Privacy

- Downloaded: Transformers.js 4.3.2 from cdn.jsdelivr.net, the ONNX Runtime WebAssembly
  files it fetches from the same CDN, and the model
  `Xenova/twitter-roberta-base-sentiment-latest` (int8, 126 MB) from huggingface.co.
  The browser caches them (Cache Storage), so later visits don't download them again.
- Message text goes only to a Web Worker in the same tab. No network request carries
  message text.
- Scores are kept in memory only, like everything else the app computes.

## Design

**UI.** The Mood over time card gets a segmented control in its header: **VADER** |
**AI model**. Below the header, a status line (`#aiMoodStatus`) shows one of:

| State | Shows |
|---|---|
| Off | nothing |
| Asking | the download notice (R2), **Download and score** and **Cancel** |
| Loading | "Downloading the model… 42%" and **Stop** |
| Scoring | "Scoring 12,345 of 40,000 messages…" and **Stop** |
| Done | nothing (the note under the title names the scorer) |
| Error | the error in plain words and **Try again** |

Choosing **AI model** when every message already has an AI score switches at once.

**Data.** A message's AI result is `m.ai = [negative, neutral, positive]`, probabilities
rounded to 3 places. Messages with the same text share one array. The score is
`positive − negative` (−1…1). The label is the most likely class, not a threshold on the
score, because that's the model's own decision. `analysis.js` gets `moodScore(m, scorer)`
and `moodSign(m, scorer)`, and `aggregateContent(msgs, scorer)` takes the scorer.
`S.moodScorer` is `'vader'` or `'ai'`.

**Code.** `js/ai-mood.js`:

- `aiMoodText(body)`: the text the model sees. Same tweet clean-up as the model's
  authors (`@name` becomes `@user`, links become `http`), capped at 1,000 characters.
- `aiMoodPlan(msgs)`: the unique texts still to score, and the messages behind each.
- `aiMoodWorker(self, T)`: serialized into a module Web Worker that imports
  Transformers.js. Protocol: in `{type:'load'}` → out `progress` … `ready`. In
  `{type:'score', id, texts}` → out `{type:'scored', id, results}`. `error` either way.
- `AiMood`: the controller (state machine above). It sends batches of 32 texts, sorted
  by length so batches pad little, and applies results as they come. A batch already
  sent when **Stop** is clicked still gets applied. A new run waits for it before
  planning, so those texts aren't scored twice (found while building AC5).

De-duplication matters a lot: the demo's 26,725 scored messages are only 74 unique
texts. Real exports repeat less, but "ok", "lol" and "love you" still add up.

Runs on WebAssembly with the int8 model on every machine, so the same text gets the
same score everywhere. In Node, the model scores about 600 messages a second. Expect
roughly 100–300 a second in a browser tab.

## Acceptance criteria

- **AC1** Loading data downloads nothing for AI mood, and the Mood chart uses VADER.
- **AC2** Choosing **AI model** shows the download notice and makes no request until
  **Download and score** is clicked. **Cancel** returns to VADER.
- **AC3** After scoring finishes: every message with a VADER score has an AI score, the
  chart and note use AI scores, and the scorer control shows **AI model**.
- **AC4** Each unique text is sent to the model once.
- **AC5** **Stop** during scoring leaves the chart on VADER. Choosing **AI model** again
  scores only the messages still missing.
- **AC6** Switching to **VADER** and back after a finished run is instant: no download
  notice and no scoring.
- **AC7** With AI on, the score pills show AI scores, and opening one shows the three
  probabilities and the VADER score.
- **AC8** If the model fails to load, the card shows an error with **Try again** and the
  chart stays on VADER.
- **AC9** Files added while AI is on get scored, and the chart stays on AI scores.
- **AC10** `aiMoodText`, `aiMoodPlan`, `moodScore`, `moodSign` and
  `aggregateContent(…, 'ai')` behave as described (unit tests).

## Open questions

- WebGPU would be several times faster, but the int8 model needs CPU fallbacks there.
  Switching to the q4f16 build on WebGPU would give slightly different scores on
  different machines. Worth it?
- Should the choice of scorer be remembered between visits? (The model stays cached
  either way.)
