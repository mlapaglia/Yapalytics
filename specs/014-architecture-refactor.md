# 014 Restructuring the code: safety, speed and room to grow

Status: Draft · Author: · PR:

## Problem

Nearly all of the UI lives in `js/app.js`: 2,800 lines holding a global state object
`S` (about 45 fields), file detection, loading and dedup, owner guessing, people links,
three dialogs, every card's rendering and all event wiring. That shape now costs us in
four ways:

- **A crafted export can run script in the page.** Chart tooltips build HTML from
  conversation and sender names without escaping. A WhatsApp file named
  `WhatsApp Chat with <img src=x onerror=…>.txt` runs that script when its bar's
  tooltip shows (checked with a throwaway Playwright test). Anyone who can name a group
  chat can do this, and the script can read every loaded message.
- **Every click recomputes everything.** With the demo data copied to 302,700 messages,
  `refresh()` takes about 300 ms on an Apple-silicon Mac. About 190 ms of that is
  `aggregateMessages`, and roughly 67 ms of *that* is splitting text into words for the
  Words chart, which sits on another tab. Switching the theme, sorting the leaderboard
  and clicking **Show all** pay the full cost, though they need no new numbers. All
  ~30 charts are redrawn, though only one tab shows at a time.
- **Features touch too many places.** A new card means editing `index.html`, `S`,
  `refresh()`, `init()` and often `resetLoaded()` and the lazy-section list. A new app
  means about 10 edits across 6 files: app numbers are bare literals
  (`s === 2 || … || s === 6`, seven-slot arrays, `PERSON_NAME_ORDER`, `READ_TOGETHER`),
  plus parallel name, mark and logo tables and seven near-identical blocks in `readFiles`.
- **Much of it can't be unit tested.** No unit test loads `app.js`. Detection, dedup,
  owner guessing, linking and filtering are checked only through the browser, and the
  browser tests read `S` directly about 85 times across 17 files, so moving state breaks them.

## Goals and non-goals

- No text from an export can become markup.
- An interaction recomputes only what it changes and draws only what's on screen.
- Adding an app is one registry entry plus its parser; adding a card is its markup plus
  one panel.
- Loading, dedup, owners and links are unit tested without a browser.
- Each step lands as its own PR with every existing test passing.
- Not in scope: ES modules or a build step (they would break opening the page from
  `file://`), visible changes to the dashboard, and moving aggregation into a worker.
- Not in scope, dropped in review: copying ECharts and Tom Select into the repo so the
  app runs offline (R1, R2, AC3, AC4). HEIC conversion stays on the CDN as it is.

## Requirements

- ~~**R1** `index.html` loads no script or stylesheet from another host.~~ Dropped in review.
- ~~**R2** The dashboard loads, draws and switches tabs when opened from `file://` with
  the network off.~~ Dropped in review.
- **R3** Text from exports is escaped wherever it becomes HTML: `innerHTML`, chart
  tooltip formatters, and `title` / `aria-label` attributes built as strings.
- **R4** Each app (SMS, Google Chat, WhatsApp, iMessage, Telegram, Instagram,
  Messenger) is described once, in a registry. Nothing outside the registry tests an app
  number or kind string to decide behaviour.
- **R5** Loading, dedup, contact merging, owner guessing and people links live in a
  dataset module with no DOM access, and are unit tested.
- **R6** After loading or after an owner or link change, everything derived from the
  records (owners, links, labels, search text, first-seen times, the by-conversation
  index) is recomputed by one function, in one fixed order. It is the only place that
  clears cached results.
- **R7** The current selection and its aggregates are cached. They're recomputed only
  when something they depend on changes.
- **R8** Changing the theme, sorting or expanding the leaderboard, moving On this day,
  switching the calendar or Year in review year, or typing in the message search
  doesn't rerun `aggregateMessages`.
- **R9** Only the open tab is drawn. Other tabs are marked out of date and drawn when opened.
- **R10** Word counts for the Words chart and Year in review are worked out in the same
  pass as the other text statistics, only when one of those is shown. `aggregateMessages`
  no longer splits text into words.
- **R11** Picking a conversation or opening a profile uses an index by conversation
  instead of scanning every message.
- **R12** Browser tests read the page only through `tests/e2e/state.mjs`, not `S` or
  other internals.
- **R13** Saved settings keep their storage keys (`ms-theme`, `ms-ig-previews`,
  `ms-people`, `yapa-ai`) and formats, so nothing saved before the change is lost.
- **R14** What the dashboard shows doesn't change. Existing acceptance tests for specs
  001–013 keep passing; only their way of reading the page (R12) is updated.

## Privacy

No message text goes anywhere new, and nothing new is downloaded. Stored data is
unchanged (R13). Escaping (R3) closes a way for a crafted export to run script that
could read every loaded message.

## Design

The work is ordered so each step lands on its own and later steps rest on earlier ones.
Script loading stays classic `<script>` tags. Each new file defines one namespace object
and does nothing when it loads; only `app.js` runs code at startup.

### Step 1 · Escaping (bug fix)

`js/html.js`, loaded first after the vendor scripts:

- `` html`<b>${name}</b>` `` is a tagged template that escapes every interpolated value
  and returns a `SafeHtml` string. Values that are already `SafeHtml`, including arrays
  of them, go in unescaped, so nesting works. `raw(s)` marks trusted markup.
- `escapeHtml` moves here from `app.js`.

Every tooltip formatter in `charts.js` uses it (`stackTooltip`, top conversations, new
people, group senders, call contacts, relationships and the rest). Then the 52
`innerHTML` sites move over (36 in `app.js`, 8 in `ai-analysis.js`, 5 in `media.js`,
2 in `tabs.js`, 1 in `ai-mood.js`), and `kpi()` escapes its label, sub and title.

### ~~Step 2 · Offline~~

Dropped in review: ECharts and Tom Select keep loading from jsDelivr.

### Step 3 · Test seam

`tests/e2e/state.mjs` exports named readers, `messages(page, fn)`, `filter(page)`,
`contacts(page)`, `personOf(page)`, `owners(page)`, `browserShown(page)` and so on,
covering the fields the specs read today: `msgs`, `personOf`, `filter`, `contacts`,
`moodScorer`, `browserShown`, `browserMood`, `topRows`, `reactions`, `phraseMsgs`,
`owners`, `convoGap`, `vocab`, `vocabMo`, `phrase`, `files` and `appsGap`. Every spec
switches to them. Later steps that move state then change only this file. A unit test
fails if a file in `tests/e2e/` other than `state.mjs` mentions `S.`.

`tests/helpers/load.mjs` gains `loadApp(names, globals)`, which reads the script order
from `index.html`. Unit tests then stop listing each file's dependencies by hand.

### Step 4 · App registry

`js/sources.js`:

```js
const Sources = {
  list: [
    { id: 0, kind: 'sms', name: 'SMS', logo: 'sms', mark: '',
      senderNames: false, defaultOwner: null, readTogether: false, archives: 'each',
      nameRank: 0, shares: false, parse: parseBackupFile, detect: … },
    { id: 3, kind: 'imessage', name: 'iMessage', logo: 'imessage', mark: '🔵',
      senderNames: true, defaultOwner: 'Me', readTogether: false, archives: null,
      nameRank: 1, shares: false, parse: parseIMessageFiles, detect: … },
    …
  ],
  byId(id), byKind(kind), count, // count replaces the literal seven-slot arrays
};
```

What each current site becomes:

| Today | Becomes |
|---|---|
| `SOURCES`, `SOURCE_MARK`, `SOURCE_LOGO`, `FILE_LOGO` | `Sources.byId(s).name` / `.mark` / `.logo` |
| `hasOwner(s)`, `isDefaultOwner(s, n)`, `S.owners` setup | `.senderNames`, `.defaultOwner` |
| Seven blocks in `readFiles` | one loop: group files by kind, one job per file or per group (`readTogether`), archives offset when `archives` is set |
| `READ_TOGETHER` in `files.js` | `.readTogether` |
| `PERSON_NAME_ORDER`, `exportOf` in `people.js` | `.nameRank`, plus an `exportOf(contact)` hook on Messenger |
| `[0, 0, 0, 0, 0, 0, 0]` in `analysis.js`, `crossapp.js` | `zeros(Sources.count)` |
| `P.apps.has(5) \|\| P.apps.has(6)` | `.shares` |
| The HTML-export error messages | `.htmlError` on Telegram, Instagram and Messenger |

**Detection.** `fileKind` is an ordered chain in which some rules weigh one app against
another (Facebook vs Instagram, Telegram vs the encrypted Messenger download). It
becomes `detectFile(file)` in `sources.js`, which runs each entry's `detect(probe)` in
a written precedence order. `probe` caches the zip listing and file peeks, so each is
read once. Before moving it, unit tests pin the current results for every fixture in
`tests/fixtures/` (Node 22 has `Blob`, `File` and `DecompressionStream`, so `zipLib`
runs there).

The parsers stay where they are: worker code is unchanged.

### Step 5 · Dataset

`js/dataset.js` exports `createDataset()`, which returns:

- **State:** `msgs`, `calls`, `contacts`, `archives`, `reactions`, `version`.
- **Loading:** `addBatch(msgs, calls, attBase)` (dedup and reaction merge, today's
  `onBatch`), `addContacts(list)` (today's contact merge), `finish()` (sort), `reset()`.
  It keeps `archives`, which is append-only, as `resetLoaded` does today.
- **`rederive({ owners, people, dismissed })`** (R6): sets `m.o` from owners, applies
  links (`m.k` / `m.tk`, person contacts), then labels, search text, `firstSeen` and
  `byKey: Map<key, msg[]>` (R11), then bumps `version`. The order is the one
  `finishLoad`, `setOwner` and `changeLinks` follow today, written down once.
- **Moved here from `app.js`:** `guessOwner`, `ownerPool`, `ownerChoices`, `ownerOrigin`,
  `threadCounts`, `contactLabel`, `contactName`, `contactSearchText`, `keySources`,
  `loadedSources`.

`readFiles` and its progress bar stay in a loader (`js/ui/loader.js`), which calls the
dataset. The file list and the Files dialog move to `js/ui/files-dialog.js`.

### Step 6 · State and caches

`S` splits three ways:

- `Data`: the dataset (step 5).
- `Prefs` (`js/store.js`): theme, Instagram previews, owners, people, dismissed
  suggestions and AI settings. All `localStorage` access goes here, wrapped in
  try/catch once, under the same keys (R13).
- `View`: filter, `convoGap`, `appsGap`, granularity, phrase, calendar year, Year in
  review year, On this day, leaderboard, message list (limit, query, mood filter, show
  mood), mood scorer and vocabulary month. `View.set(patch)` works out which *topics*
  changed and passes them to `Panels.invalidate(topics)`.

Topics: `data` (load, owners, links), `selection` (contact, app, groups, dates), `gap`,
`appsGap`, `theme`, `scorer`, `aiScores`, plus one per panel's own controls (`leader`,
`calendar`, `otd`, `phrase`, `browser`, `wrapped`, `vocab`).

`js/select.js` caches:

| Value | Cached on |
|---|---|
| `base()` (filters, not dates) | `Data.version`, contact, app, groups. Uses `byKey` for one conversation. |
| `range()` | `base()`, from, to |
| `agg()`: `aggregateMessages` | `range()`, `convoGap` |
| `content()`: `aggregateContent` plus word counts | `range()`, scorer, AI-score version |
| `cross()`: `aggregateCrossApp` | `range()`, `appsGap` |
| `docFreq()` | `Data.version`, app, groups |

AI mood scoring writes `m.ai` into records, so `AiMood` bumps an AI-score version, and
`content()` recomputes with the new scores.

### Step 7 · Panels

`js/panels.js`:

```js
Panels.register({
  id: 'leaderboard', tab: 'sec-people', topics: ['data', 'selection', 'gap', 'leader'],
  init(ctx) { /* wire its own controls once */ },
  render(ctx) { /* ctx.agg(), ctx.view, ctx.ui, ctx.html … computed on first use */ },
});
```

- `Panels.invalidate(topics)` marks each panel that lists a matching topic. Marked
  panels in the open tab render at once, and so do those with `tab: null` (scope line,
  filter bar, tab bar). The rest render when `Tabs` opens their tab (R9). This replaces
  `refresh()`, `lazyRender`, the `Lazy` object and its IntersectionObserver. The gallery
  keeps its own batching and thumbnail observer.
- `ctx` reads `Select` lazily, so a tab that needs no message aggregates doesn't compute
  them. Theme changes (`theme` topic) redraw the open tab's charts from cached aggregates.
- `Charts.set(id, option, { on: { click: fn } })` attaches handlers the first time a
  chart is created, replacing the `__wired` / `__moodWired` flags.
- `wordFreq` moves out of `aggregateMessages` into `aggregateContent`, which already
  splits each message into words once; link messages are split once too (R10). Year in
  review reads it from `content()` for its year.

**Files.** The renderers leave `app.js` for one file per tab: `js/panels/overview.js`,
`activity.js`, `people.js`, `groups.js`, `replies.js`, `words.js`, `mood.js`, `media.js`,
`calls.js`, `sources.js`, `apps.js`, `wrapped.js`, `messages.js` and `ai.js`. Dialogs
and controls go in `js/ui/`: `files-dialog.js`, `people-dialog.js`, `owner-dialog.js`,
`profile.js`, `pickers.js`, `filters.js`, `theme.js`. `app.js` keeps only startup.

**Dependencies are passed in.** `AiMood`, `AiAnalysis`, `Tabs`, `Thumbs` and `Viewer`
get what they use through `init({ selection, setScorer, onShown, … })` instead of
reading `S`, `inRange`, `baseMessages`, `setMoodScorer` or `onTabShown`. A unit test
fails if a file other than `app.js` mentions `S.` once `S` is gone.

The tabs move in this order, with `refresh()` drawing what hasn't moved yet:

1. Overview and Activity, with the panel machinery.
2. People, Groups and Replies.
3. Words, Mood and Media, together because they share `content()`.
4. Calls, Sources, Across apps, Year in review, Messages and AI analysis. Then
   `refresh()` is deleted.

### Step 8 · Cleanups

- `js/format.js` collects the 34 hand-written `toLocaleDateString` calls into
  `fmtDate.short`, `.long`, `.monthYear` and `.time`, and keeps one each of `andList`
  (dropping `crossAppList`) and `pct` (dropping `pctText`, `shareText`, `crossPct`).
- The trait flags (`T_REACTION`, `T_LINK`, …) are defined once in `messageLib`, which
  must stay self-contained for the workers. `analysis.js` reads them from there instead
  of keeping its own copy "in sync".
- Event wiring uses `addEventListener` throughout. The page-wide click handler in
  `initGlance` splits so each panel handles its own `data-*` actions.

### Expected effect

Measured the same way as in Problem (302,700 messages, Apple silicon, Overview open).
These figures are estimates, not acceptance criteria:

| Action | Today | Expected |
|---|---|---|
| Change a filter | ~300 ms | ~130 ms (no word splitting, no hidden tabs) |
| Switch theme, sort the leaderboard | ~300 ms | < 20 ms (no aggregation) |
| Open a profile | ~140 ms | ~60 ms (index, no word splitting) |
| Open Words, first time | ~220 ms extra | ~170 ms (one word-splitting pass) |

`npm run bench` (`tests/helpers/bench.mjs`) prints these numbers. It informs, but never
fails a build.

## Acceptance criteria

- **AC1** Given a WhatsApp export whose chat name, and a group whose sender name, is
  `<img src=x onerror=window.__xss=1>`, when the tooltips of top conversations, group
  senders, relationships and new people are shown, then `window.__xss` stays unset and
  the name shows as text.
- **AC2** Given the same name, when the leaderboard, On this day, the profile dialog,
  the message list and the People dialog are shown, then no script runs and the name
  shows as text.
- ~~**AC3** Given every request to a host other than 127.0.0.1 blocked, the demo loads
  with no off-host request.~~ Dropped with R1.
- ~~**AC4** Given the app opened from `file://` offline, the demo loads.~~ Dropped with R2.
- **AC5** Given the browser tests, no file in `tests/e2e/` except `state.mjs` refers to `S.`.
- **AC6** Given a unit test that adds an eighth app to `Sources.list` (detection by file
  extension, a parser that returns two messages), when a matching file is loaded, then
  the app shows in the source filter with its name and logo, and its two messages are
  counted. No other file changes.
- **AC7** Given each fixture in `tests/fixtures/`, `detectFile` returns the same kind,
  or the same error message, as `fileKind` did before the change.
- **AC8** Given two overlapping exports of one conversation, when both are added to a
  dataset in either order, then each message is kept once, reactions from both are
  merged, and attachments come from whichever copy can open them.
- **AC9** Given a dataset with a saved link and a guessed owner, `rederive` sets `o`,
  `k` and `tk` as today. Running it twice gives the same result.
- **AC10** `dataset.js`, `select.js`, `sources.js` and `store.js` load in Node with no
  `document` or `window`.
- **AC11** Given the dashboard on Overview, when the theme is switched, the leaderboard
  is sorted, On this day moves a day or the message search changes, then
  `aggregateMessages` isn't called.
- **AC12** Given the dashboard on Overview, when the conversation filter changes, then
  no chart outside Overview, the filter bar and the tab bar is drawn. Opening Activity
  then draws Activity's charts for the new selection.
- **AC13** Given the dashboard on Overview, when data loads or the filter changes, then
  no message text is split into words. Opening Words splits each message once.
- **AC14** Given links, a dismissed suggestion, a theme, Instagram previews and AI
  settings saved by the current version, when the restructured app loads, then all of
  them apply.
- **AC15** All existing unit and browser tests pass, changed only to read the page
  through `state.mjs`.

## Open questions

- **Dedup memory.** `addBatch` keeps a string key per message for the whole session.
  A 53-bit hash would use far less memory, at a tiny chance of two different messages
  colliding and one being dropped. Keep strings for now?
- **`js/people.js` naming.** With `js/panels/people.js` added, should the link-suggestion
  module become `js/links.js`?
- **Load-error alert.** `showLoadError` uses `alert()` when data is already loaded.
  Replacing it with an inline message is a visible change, so it would need its own spec.
