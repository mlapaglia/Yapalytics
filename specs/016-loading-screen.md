# 016 A livelier loading screen

Status: Approved: built · Author: · PR:

## Problem

Loading shows one thin bar and a line like "Reading chats.zip (2/5) · 31 MB of 80 MB ·
12,400 messages, 0 calls". A big Google Takeout or a few years of SMS takes tens of
seconds, and in that time the page says little: not which files are still to come, how
fast it's going, how long is left, or what it's doing once the bar is full (sorting,
working out who's you, linking people, drawing the dashboard). The bar can sit at
100% while that happens, which looks like a hang. The demo doesn't show the screen at
all while its data is being made.

Loading is also the first moment the app has something to show about someone's
messages. Watching the years fill in as files are read is a good first look.

## Goals and non-goals

- Goal: while files load (Choose your exports, Try the demo, a drop, or Apply in the
  Files dialog), show what's happening: each file and its state, the current step,
  live counts, speed, time elapsed and left, a timeline that fills in as messages are
  read, and the names of conversations as they're found.
- Goal: the steps after reading (merging, sorting, owners and links, drawing) show as
  steps instead of a full bar that seems stuck.
- Goal: no slower than today. The screen draws at most once per animation frame, and
  the work added per batch is a single pass over that batch.
- Not in scope: cancelling a load, reading files in parallel, or a summary of the load
  afterwards, on its own screen or on the dashboard.
- Not in scope: changing what the parsers read. They only gain the found
  conversations on their batch messages (Design).

## Requirements

- **R1** The loading screen has these parts, top to bottom: the current step, an
  overall progress bar with a percentage, a row of live counts, a speed line, a
  timeline, the conversations found, a list of files and a list of steps.
- **R2** **Current step.** One line naming what's happening now, e.g. "Reading
  WhatsApp Chat with Alex.zip", "Sorting 29,520 messages", "Working out who's you",
  "Drawing the dashboard". It's announced to screen readers when it changes
  (`aria-live="polite"`), and only then, not on every number change. The line is
  written as soon as the step changes, so a step shorter than a frame still shows.
- **R3** **Progress bar.** It's split into one segment per file, sized by the file's
  share of the total bytes, coloured with that file's app colour. Each segment fills
  as its file is read. The percentage beside it is bytes read over total bytes for
  the files being read: a file that failed keeps its row (R14) but leaves the
  percentage, so a load that goes on without it still ends at 100%. After reading, the
  bar stays full and the step list (R8) shows what's left.
- **R4** **Live counts.** Messages, calls, conversations, photos and videos, reactions
  and duplicates skipped, each counting up as batches arrive. A count shows once it's
  above zero (Messages always shows), so a WhatsApp-only load never shows "0 calls".
  When the load ends, every count shows its exact value. Counts include what was
  already loaded when files are added to it.
  - Messages and calls: what's been kept (`Data.msgs.length`, `Data.calls.length`).
  - Conversations: distinct conversation keys among kept messages and calls.
  - Photos and videos: the sum of photos, videos and GIFs on kept messages.
  - Reactions: reactions sent as texts that were left out (`Data.reactions`), plus
    reactions on messages (`rx`).
  - Duplicates skipped: messages already loaded from another file (overlapping
    exports).
- **R5** **Speed line.** Read speed in MB/s and messages per second, time elapsed, and
  time left. Speeds are averaged over the 2 seconds up to now, so they don't jump, and
  a read that stalls slows to 0 within 2 seconds instead of showing its last speed. Time left
  is shown only after 1 second of reading and only while it's over 1 second; it's
  bytes left over the recent byte rate, rounded ("about 12 s left", "about 2 min
  left").
- **R6** **Timeline.** A bar per month from the earliest to the latest message read so
  far, height by message count, growing as batches arrive, with the first and last
  month labelled ("Mar 2016 – Nov 2026"). It's drawn on a `<canvas>`, not ECharts, so
  it's cheap to redraw every frame.
- **R7** **Files.** One row per file being read: app logo, file name, size, and its
  state: waiting, reading (with its own percentage), done (with how many messages and
  calls it added, and how long it took) or failed. Files read together as one job (an
  Instagram export or a Takeout split across zips) share a state and one count, since
  the parser can't say which file a message came from: each of their rows says
  "30 messages from these 2 files".
  - Up to 4 files (or jobs) are read at the same time, each in its own worker, leaving
    a core for the page. Their batches are still added in file order, as if the files
    were read one after another, so a message in two overlapping exports keeps the
    same copy whichever file finishes first. Until the files before it are added, a
    file that's already read shows "Reading 100%" and its counts wait. Its time is how
    long its own reading took.
- **R8** **Steps.** A short list that ticks off as it goes, each with the time it
  took: Preparing the demo (demo only), Checking files, Reading files, Merging and
  sorting, Who's you and linked people, Drawing the dashboard. The current step has
  a spinner.
- **R9** Between the steps after reading, the page draws, so each step shows before the
  next starts. This adds at most one frame per step, and nothing while the page is
  hidden (a background tab gets no frames, and the load mustn't wait for one).
- **R10** **Demo.** Try the demo shows the loading screen before the demo data is made,
  with Preparing the demo as the first step.
- **R11** The loading screen shows no message text and no sender names. Conversation
  names (R15), file names, app names and counts only.
- **R12** With `prefers-reduced-motion: reduce`, nothing animates: no spinner, counts
  jump to their value, and the bar doesn't ease. New counts and names appear without
  fading in, with or without reduced motion: the page is busy reading, so a fade
  would stall half-way.
- **R13** It works in light and dark themes and at phone width (360px) without
  scrolling sideways. The file list scrolls on its own after 6 rows.
- **R14** If a file fails, its row says so and the load goes on as today (spec 006):
  the other files are read again and the error shows on the dashboard or landing page.
- **R15** **Conversations found.** Names of conversations appear as they're read, each
  with its app's logo, newest first: the last 8 stay on screen, the older ones dimmer
  ("Found: Alex Rivera · Mom · Road Trip 🚗 …"). A conversation with no name shows its
  number or address, as the conversation picker does. Group chats show their title.
  Names arrive with the batch their first message is in, so a big single file shows
  them as it's read, not only when it's done. Names are set as text, never as markup.
  A long name is cut short with "…" at 240px (or the screen's width, if narrower), with
  the whole name on hover, so it can't widen the page.

## Privacy

Nothing leaves the browser. The loading screen reads counts, times and months from
records already in memory, and conversation names from the parser workers, which
already send them to the page at the end of each file. It shows conversation names
(R15) but no message text or sender names (R11). Nothing new is stored.

## Design

**Markup.** `#progress` in `index.html` becomes:

```html
<div id="progress" class="progress" hidden>
  <p class="load-step"><span class="load-spin" aria-hidden="true"></span><span id="loadStep" aria-live="polite">Starting…</span></p>
  <div class="load-bar"><div class="load-segs" id="loadSegs"></div><span class="load-pct" id="loadPct">0%</span></div>
  <dl class="load-counts" id="loadCounts"></dl>
  <p class="load-speed" id="loadSpeed"></p>
  <figure class="load-timeline"><canvas id="loadTimeline" aria-hidden="true"></canvas><figcaption id="loadRange"></figcaption></figure>
  <section class="load-found-wrap" aria-label="Conversations found">
    <h3 class="load-h">Conversations found</h3>
    <ul class="load-found" id="loadFound"></ul>
  </section>
  <div class="load-lists">
    <ul class="load-files" id="loadFiles" aria-label="Files"></ul>
    <ol class="load-steps" id="loadSteps" aria-label="Steps"></ol>
  </div>
</div>
```

`#progressBar` and `#progressText` go away.

**Model.** A new `js/load-stats.js` (before `analysis.js`), with no DOM, so it's unit
tested. Every call takes the time last:

```js
const stats = createLoadStats({ steps: ['demo', 'check', 'read', …], now });
stats.step(id, detail, now);               // the current step; records each step's time
stats.beginRead(files, base, now);         // files: [{ file, name, size, s }]; base: what Data holds already
stats.startJob(i, files, now);
stats.progress(i, loaded, total, now);     // from the worker
stats.batch(i, data, res, found, now);     // res: Data.addBatch's result; found: new conversations
stats.endJob(i, { error }, now);
stats.end(now);
stats.snapshot(now)  // -> { step, detail, steps, files, pct, counts, bps, mps, elapsed, left, months, first, last, found, foundN }
```

Rates come from a ring of `(time, bytes, messages)` samples over the last 2 seconds.
`now` is passed in so tests control time.

**Workers.** `messageLib` gains `contactMap()`: a `Map` that remembers the
conversations added since it was last asked. Each parser's `contacts` becomes one, and
its `flush()` posts `found: contacts.takeFresh()` (`[{ key, name, s, group }]`, names
read at flush time, so an SMS name set after the conversation was created is there)
with each batch. `runParserWorker` passes it on as `onBatch(msgs, calls, found)`.

**Dataset.** `Data.addBatch` returns where the kept messages and calls start in
`Data.msgs` and `Data.calls`, and how many messages were duplicates
(`{ msgFrom, callFrom, dupes }`), so counts and the timeline only see new records
without copying them. Existing callers ignore the return value.

**View.** A new `js/ui/load-screen.js`:

- `LoadScreen.start({ demo, check })` starts a `requestAnimationFrame` loop that draws
  `stats.snapshot(performance.now())`, changing only text that changed. File rows and
  bar segments are built when the files change. `LoadScreen.step()` writes the step
  line at once (R2).
- `LoadScreen.stop()` ends the loop and draws once more with the counts at their
  values. The last snapshot stays in `LoadScreen.last` and the loop's draw count in
  `LoadScreen.draws`, for tests.
- The timeline canvas is drawn from `snapshot.months` (a `Map` of month index to
  count) with the theme's accent colour, scaled for `devicePixelRatio`.

**Loader.** `loadFiles`, `readFiles`, `finishLoad` (now async) and `applyFiles` report
each step and `await nextFrame()` between the steps after reading (R9). The demo
buttons call `loadDemo()`, which shows the screen, awaits a frame, then builds the demo
files (R10). The file queue stops the screen when a load ends, however it ends.

**Styles.** New `.load-*` rules in `styles.css`, using the theme tokens. Segment colours
are each app's chart colour (`appColor`). Reduced motion turns off the spinner, the
pulse and transitions (R12).

## Acceptance criteria

- **AC1** Given a load of an SMS backup and a WhatsApp chat, the screen
  shows two file rows with their app logos and sizes, and two bar segments sized by
  their bytes.
- **AC2** During that load, the current step reads "Reading <file name>" for each file
  in turn, then "Sorting … messages", "Working out who's you" and "Drawing the
  dashboard", in that order.
- **AC3** When reading ends, the Messages, Calls and Conversations counts equal
  `Data.msgs.length`, `Data.calls.length` and the number of distinct conversation keys.
- **AC4** Loading a file twice in the Files dialog (overlapping exports) shows a
  Duplicates skipped count equal to the messages dropped.
- **AC5** With a WhatsApp-only load, no Calls count is shown.
- **AC6** `snapshot()` with samples 1 MB every 100 ms reports about 10 MB/s, and time
  left equal to the bytes left over that rate; before 1 s of reading, or under 1 s
  left, there is no time left.
- **AC7** The timeline's months, first and last match the months of the messages read
  so far, and its caption names the first and last month.
- **AC8** Each file row ends done with how many messages it added; a file that fails
  ends failed, and the load goes on as spec 006 says.
- **AC9** The step list ticks off every step with a time, and the demo's list starts
  with Preparing the demo.
- **AC10** Clicking Try the demo shows the loading screen before the demo data exists.
- **AC11** The loading screen's text has none of the loaded messages' bodies or
  sender names.
- **AC12** `aria-live` text changes only when the step changes.
- **AC13** With reduced motion emulated, no element on the loading screen has a running
  animation or transition.
- **AC14** At 360px wide the loading screen has no horizontal scroll, in light and
  dark themes.
- **AC15** The loading screen draws at most once per animation frame: over a demo
  load, the number of draws is no more than the number of frames.
- **AC16** During a load of one SMS backup, conversation names appear in Conversations
  found before reading ends, with the SMS logo, and the list never holds more than 8.
- **AC17** A conversation named `<img src=x onerror=alert(1)>` shows as that text in
  Conversations found, and no script runs.
- **AC18** Given a large SMS backup and a small one that repeats its first messages,
  loaded in that order, the small one finishes reading first (they're read at the same
  time), yet the large one's row counts every message and the small one's counts none:
  its messages are the duplicates.

## Decisions

- No summary after loading, on its own screen or on the dashboard.
- Conversation names show as they're found (R15). Message text and sender names
  still don't.
- No Cancel button.
