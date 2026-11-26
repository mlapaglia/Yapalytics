# 028 Counting words without freezing the page

Status: Draft · Author: · PR:

## Problem

The Words, Mood & emoji and Media & links tabs count every word, phrase, emoji, link and
language in the selection the first time one of them opens (`aggregateContent`), plus
each conversation's words for inside jokes and "What you talk about" (`buildDocFreq`,
`conversationTerms`). All of it runs on the page in one go. On a real 345k-message folder
that's about 3 s with nothing drawn: the window doesn't scroll, the tab bar doesn't
respond and the browser may offer to stop the page. Picking another conversation or date
range does it again.

The counting itself has no waste left that's worth much: a third of it is building and
counting 2.8M phrase uses, which number keys made slower, not faster. Making the page wait less means not
making it wait at all.

## Goals and non-goals

- Goal: the page keeps drawing and responding while words are counted, whatever the size
  of the selection.
- Goal: the tabs show what they're doing while they wait, and the counts when ready.
- Goal: the counts are exactly what they are today.
- Not in scope: making the counting faster, or changing what's counted.
- Not in scope: Year in review (`wrapped.js`), which counts one year without phrases and
  takes a fraction of the time; it keeps counting in one go.

## Requirements

- **R1** Counting runs in slices of at most about 30 ms, with the browser free to draw and
  handle input between them. Over a 345k-message selection, no frame waits more than
  100 ms on counting.
- **R2** While the selection's counts aren't ready, each card that needs them shows
  "Counting words…" in place of its chart, list or table, with how far it has got
  ("Counting words… 40%"). Cards that don't need them draw at once, as today.
- **R3** When the counts are ready, every card waiting on them draws, without the tab being
  opened again.
- **R4** Changing what's selected while counting (conversation, app, groups, dates, mood
  scorer, AI scores arriving) drops the counting under way and starts on the new
  selection. A card never shows counts from a selection that's no longer picked.
- **R5** Counting starts as soon as the dashboard has drawn after a load or a selection
  change, whichever tab is open, so the Words, Mood & emoji and Media & links tabs are
  often ready by the time they're opened. It's the same work the tabs would do anyway,
  done earlier; it's never done twice for one selection.
- **R6** Inside jokes and "What you talk about" (per-conversation words and the
  conversation counts behind them) are counted the same way, after the selection's counts.
- **R7** Code that needs counts at once (the conversation profile's "What you talk about",
  Year in review, tests) can still ask for them and get them: it finishes the
  counting under way in one go rather than waiting for slices.
- **R8** The counts are the same as counting in one go, for any selection.

## Privacy

Nothing changes where message text goes: it's counted on the page, as today, and nothing
is sent or stored.

## Design

**Slices.** `aggregateContent`, `buildDocFreq` and `conversationTerms` become generator
functions (`aggregateContentSteps`, …) that `yield` every 1,000 messages with how far they
are (0–1), and return their result. The existing names stay as wrappers that run the
generator to the end, so the code that counts is one copy and R8 holds by construction.
The work after the message loop (new words per month) is short and stays in the last
slice.

**Runner** (`js/background.js`). `Background.run(key, steps, onDone)` advances a generator
until 30 ms have passed, then waits for the next task (`setTimeout(0)`, or
`scheduler.yield()` where it exists) and goes on. One job runs at a time; starting a job
with another key drops the one under way (its generator is never resumed). `finish(key)`
runs a job's remaining steps at once (R7). The time budget is a property tests can
lower.

**Select.** `Select.content()` returns the counts when they're ready for the current
selection, and otherwise starts (or keeps) the job for it and returns `null`. It gains
`Select.contentProgress()` (0–1) for R2 and `Select.content({ now: true })` for R7.
`docFreq()` and `terms(k)` work the same way. Their cache keys don't change.
When a job finishes and its key is still current, it fills the cache and calls
`Panels.invalidate(['content'])`.

**Panels.** Panels that use counts add the topic `'content'`. `ctx.content()` can return
`null`; `ctx.counting(id)` draws the "Counting words… 40%" placeholder in a chart or box.
The panels: words, distinct, phrases, jokes, corrections, languages, vocab (Words); mood
(Mood & emoji); media's link domains (Media & links). While a job runs, the waiting
panels redraw their placeholder at most twice a second for the percentage.

**Starting early (R5).** After `finishLoad` draws the dashboard, and after each
`View.set` that changes the selection, the loader asks `Select.content()` once (and
then `docFreq()` and the open conversation's `terms`), which starts the jobs.

**Timers.** Each job adds its slices' time to `LoadPerf` under its name, so `?perf`
shows how long counting took and its longest slice.

### Considered: a worker

Counting in a Web Worker would also keep the page free, but the worker needs its own
copy of the messages (0.2–0.3 s to send after a load), kept in step with every owner or
link change (`rederive` rewrites `o` and `k`), with AI mood scores sent across too, and
the counts it sends back include phrase counters of up to 300,000 entries per person.
Slicing keeps one copy of everything on the page and changes far less. If counting ever
needs to get faster and not just stop freezing, the generators can move into a worker
later.

## Acceptance criteria

- **AC1** For generated selections (1-on-1, group, all conversations; with links,
  reactions, emoji, corrections, several languages), the sliced counts equal counting in
  one go: `aggregateContent`, `buildDocFreq` and `conversationTerms`.
- **AC2** With the time budget at 1 ms, opening the Words tab on the demo shows
  "Counting words…" in its cards, the page draws at least two frames before the counts
  appear, and then every card shows the same content as with counting in one go.
- **AC3** Picking another conversation while counting ends with the cards showing that
  conversation's counts, and no card ever shows the earlier selection's.
- **AC4** After a load, with the Overview tab open, counting runs and finishes on its own:
  opening Words afterwards shows the counts at once, with no "Counting words…".
- **AC5** The Mood & emoji and Media & links tabs show "Counting words…" while counting
  and their charts once it's done.
- **AC6** Opening a conversation's profile while counting shows its "What you talk about"
  words, the same as with counting in one go.
- **AC7** A dropped job never runs again: after three quick selection changes, only the
  last selection's job finishes.

## Open questions

- Is a percentage in the placeholder worth it, or is "Counting words…" enough?
- Starting early (R5) spends a few seconds of slices after every load even if the Words
  tab is never opened. The page stays responsive, but it's work the user didn't ask for.
  Worth it?
