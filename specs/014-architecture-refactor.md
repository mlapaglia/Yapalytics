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
  doesn't recompute the selection's aggregates. (Year in review works out the picked
  year's own numbers.)
- **R9** Only the open tab is drawn. Other tabs are marked out of date and drawn when opened.
- **R10** Word counts for the Words chart and Year in review are worked out in the same
  pass as the other text statistics, only when one of those is shown. `aggregateMessages`
  no longer splits text into words. That pass splits each message's text once, and a
  message with a link once more without its links, for the vocabulary.
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

`tests/e2e/state.mjs` exports `inApp(page, (app, arg) => …, arg)`. It runs the function
in the page like `page.evaluate`, with `app` built by one `VIEW()` function in
`state.mjs`: getters for the state the specs read (`msgs`, `calls`, `contacts`,
`personOf`, `owners`, `reactions`, `files`, `filter`, `moodScorer`, `convoGap`,
`appsGap`, `phrase`, `topRows`, `browserShown`, `browserMood`, `phraseMsgs`, `vocab`)
and the app functions they call (`selection()`, `addMessages()`, `setVocabMonth()`,
`openProfile()`, `plainName()`, `readDay()`, `showMoodMessages()`, `explainMood()`,
`pickToLink()`). Every spec switches to it. Later steps that move state change only
`VIEW`. A unit test fails if a file in `tests/e2e/` other than `state.mjs` uses `S.` or
one of those app functions directly. Library functions that hold no state
(`aggregateMessages`, `phraseRegex`…) can still be called in the page.

`tests/helpers/load.mjs` gains `loadApp(names, globals)`, which loads every script in
`index.html` order except `app.js`. Unit tests then stop listing each file's dependencies.

### Step 4 · App registry

`js/sources.js` holds `Sources.list`, one entry per app. The file's header documents
every field:

```js
{
  id: 3, kind: 'imessage', name: 'iMessage', logo: 'imessage', mark: '🔵', exportName: 'iMessage',
  senderNames: true, defaultOwner: 'Me', addrIds: false,
  jobs: 'together', readTogether: false, archives: false, metaFormat: false, shares: false, nameRank: 1,
  parse: (files, cb) => parseIMessageFiles(files, cb),
  detect: { file: async (p) => …, zip: async (p) => … },
}
```

plus `Sources.byId(id)`, `Sources.byKind(kind)`, `Sources.zeros()` (a zeroed slot per
app id) and the helpers `hasOwner(s)`, `isDefaultOwner(s, name)`, `sourceName(s)` and
`sourceNames()`.

What each old site becomes:

| Before | After |
|---|---|
| `SOURCES`, `SOURCE_MARK`, `SOURCE_LOGO`, `FILE_LOGO` | `sourceName(s)`, `.mark`, `.logo`; pure modules that take a name lookup get `sourceNames()` |
| `hasOwner(s)`, `isDefaultOwner(s, n)`, `S.owners` setup | the same helpers, reading `.senderNames` and `.defaultOwner`; `S.owners` built from the list |
| Seven blocks in `readFiles` | one loop over the list: one job per file (`jobs: 'each'`) or per app, files kept for attachments when `.archives` |
| The Google Chat date error in `readFiles` | `.badDatesError` |
| `READ_TOGETHER` in `files.js` | `.readTogether` |
| `PERSON_NAME_ORDER`, `exportOf`, `!c.s \|\| c.s === 1` in `people.js` | `.nameRank`, Messenger's `exportOf(contact)` hook, `.addrIds` |
| `[0, 0, 0, 0, 0, 0, 0]` in `analysis.js`, `crossapp.js` | `Sources.zeros()` |
| `[0, 1, …, 6]` in `charts.js` | the ids in the name lookup it's given |
| `P.apps.has(5) \|\| P.apps.has(6)` | `.shares` |
| `'instagram' \|\| 'messenger'` for a loose thread file | `.metaFormat` |
| Source filter buttons written in `index.html` | added from the list when the dashboard draws |
| `.app-0` … `.app-6` colours in `styles.css` | `--app` set inline from the app id (the classes stay as hooks) |

**Detection.** `fileKind` was an ordered chain in which some rules weigh one app
against another (Facebook vs Instagram, Telegram vs the encrypted Messenger download).
It becomes `detectFile(file)` in `sources.js`. Each entry's `detect` holds its rules
(`file` for a loose file, `zip` and other named rules for a zip), and `DETECT_STEPS`
lists the order they're tried in, first match wins. An app missing from
`DETECT_STEPS` has its rules tried first. `fileProbe(file)` reads the start of a file,
a zip's entries and Meta's layout once, however many rules ask.
`tests/helpers/detect-cases.mjs` builds 41 files (every demo export, the test helpers'
exports, HTML exports, loose thread files, split-export parts, non-exports). The old
`fileKind`'s answers for them were recorded before it was removed (AC7). Node 22 has
`File` and `DecompressionStream`, so `zipLib` runs there.

The parsers stay where they are: worker code is unchanged.

### Step 5 · Dataset

`js/dataset.js` exports `createDataset()`; `app.js` holds one as `Data`. It returns:

- **State:** `msgs`, `calls`, `contacts`, `archives`, `reactions`, `personOf`,
  `firstSeen`, `byKey`, `version`.
- **Loading:** `archive(files)` (keeps files for attachments, returns their first
  index), `addBatch(msgs, calls, attBase)` (dedup and reaction merge, the old `onBatch`),
  `addContacts(list)` (the old contact merge), `finish()` (sort), `reset()`. `reset`
  keeps `archives`, which is append-only, as `resetLoaded` did.
- **Who's you:** `ownerPool`, `guessOwner`, `guessOwners(owners)`, `ownerChoices`,
  `ownerOrigin(source, owner)`.
- **Conversations:** `loadedSources`, `keySources`, `threadCounts`, `messagesOf(key)`
  (from `byKey`, R11), `searchText(contact, owners)`.
- **`rederive({ owners, people })`** (R6): sets `m.o` from owners, applies links (`m.k` /
  `m.tk`, person contacts), then labels, search text, `firstSeen` and `byKey`, then
  bumps `version`. That's the order `finishLoad`, `setOwner` and `changeLinks` followed,
  now written down once.
- **Plain helpers** that need no state also move here: `formatAddr`, `contactName`,
  `contactLabel`, `threadName`, `isLinkable`, `personKeyOf`, `sameName`.

`app.js` keeps a small `rederive()` that calls `Data.rederive`, keeps the picked
conversation valid and redraws the "Which one is you?" button and dialog. `readFiles`,
with its progress bar, and the Files dialog stay in `app.js` until step 7 splits the UI
into files. Picking a conversation and opening a profile use `Data.messagesOf` instead
of scanning every message.

### Step 6 · State and caches

`S` splits up:

- `Data`: the dataset (step 5).
- `js/store.js`: `Store` (`get`, `set`, `getJSON`, `setJSON`) is the only code that
  touches `localStorage`. Every access is guarded there once, under the same keys
  (R13, `STORE_KEYS`). `Prefs` holds the theme, Instagram previews, owners, saved links
  and dismissed suggestions, with the link editing (`linkThreads`, `unlinkThread`,
  `loadPeople`, `savePeople`). AI settings stay in `AiAnalysis`, saved through `Store`.
- `js/select.js`: `View` holds what's picked: filter, `convoGap`, `appsGap`,
  granularity, mood scorer, phrase and its granularity, vocabulary month, calendar year,
  Year in review year, On this day, leaderboard, and the message list (`browser`: limit,
  query, mood filter, show mood).
- What's left on `S` is what the last draw produced and the dialogs' scratch (chart
  click rows, the word tracker's messages, the Files and People dialogs' working state).
  Step 7 moves it into the panels and dialogs.

`Select` in `js/select.js` caches the selection and its numbers. Every key includes
`Data.version`:

| Value | Cached on |
|---|---|
| `base()` (filters, not dates) | `Data.version`, contact, app, groups. Uses `byKey` for one conversation. |
| `range()` | the above, from, to |
| `calls()` | the same as `base()` |
| `agg()`: `aggregateMessages` | `range()`'s key, `convoGap` |
| `content()`: `aggregateContent` | `range()`'s key, scorer, `AiMood.scoresVersion` |
| `cross()`: `aggregateCrossApp` | `range()`'s key, `appsGap` |
| `docFreq()` | `Data.version`, app, groups |

AI mood scoring writes `m.ai` into records, so `AiMood` bumps `scoresVersion` whenever
it does, and `content()` recomputes with the new scores. `refresh()` reads everything
through `Select`, so drawing again for a new theme or a sorted table reuses the numbers
(R8). `selectMessages`, `selectCalls` and `inDates` are the plain functions behind it,
replacing `baseMessages`, `baseCalls` and `inRange`.

### Step 7 · Panels

`js/panels.js`:

```js
Panels.register({
  id: 'leaderboard', tab: 'sec-people', topics: ['data', 'selection', 'gap', 'leader'],
  init() { /* wire its own controls, once */ },
  render(ctx) { /* ctx.agg(), ctx.content(), ctx.ui, ctx.all, ctx.put(id, fn) … */ },
});
```

- `Panels.invalidate(topics, { except })` marks each panel that lists a matching
  topic (`'*'` for all). Marked panels with `tab: null` draw first, since they decide
  which sections exist. Then `Tabs.sync()` runs, then the open tab's marked panels draw.
  The rest draw when `Tabs` opens their tab (R9). This replaces `refresh()`,
  `lazyRender`, the `Lazy` object and its IntersectionObserver.
- `View.set(patch, opts)` (defined in `panels.js`) changes what's picked and
  invalidates the topics it touches: `filter` changes give `selection` plus
  `filter.contact` / `filter.source` / `filter.groups` / `filter.dates`; every other
  field has its own topic (`gap`, `appsGap`, `gran`, `scorer`, `phrase`, `vocab`,
  `calendar`, `wrapped`, `otd`, `leader`, `browser`). A new selection starts the message
  list at the latest messages again. The other topics are `data` (a load, owners, links)
  and `theme`. The timeline's own zoom passes `{ except: ['timeline'] }`, so its window
  isn't redrawn under it.
- `ctx` reads `Select` lazily, so a tab that needs no aggregates doesn't compute them.
  A theme change clears the cached theme and redraws the open tab's charts from cached
  numbers.
- `Charts.set(id, option, { on: { click: fn, 'zr:click': fn } })` attaches handlers when
  a chart is created, replacing the `__wired` / `__moodWired` flags.
- `wordFreq` moves out of `aggregateMessages` into `aggregateContent` (R10). Year in
  review reads it from that year's `aggregateContent`.

**Panels without a tab.** `filters` (the conversation picker and app buttons, topics
`data` and `filter.source`), `scope` (the scope line and date fields), `sections` (which
sections and cards have anything to show, from one cheap pass over the selection rather
than `aggregateMessages`, so the tab bar and "Jump to…" are right whatever tab is open),
and `mood-scoring` (AI mood follows the selection).

**Files.** The renderers leave `app.js` for one file per tab: `js/panels/overview.js`,
`activity.js`, `people.js`, `groups.js`, `replies.js`, `words.js`, `mood.js`, `media.js`
(with the attachments panel, which is on that tab), `calls.js`, `sources.js`, `apps.js`,
`wrapped.js`, `messages.js`, `ai.js`, and `layout.js` for `sections` and `mood-scoring`.
Dialogs and controls go in `js/ui/`: `common.js` (shared helpers), `pickers.js`,
`filters.js`, `loader.js` (reading files, drag and drop, `rederive()`),
`files-dialog.js`, `owner-dialog.js`, `people-dialog.js`, `profile.js` and `theme.js`.
Each dialog keeps its working state in its own object (`Files`, `PeopleDlg`), and each
panel keeps what its clicks need (the rows behind a chart's bars) beside it. `app.js`
keeps only startup.

**Dependencies are passed in.** `Tabs.init({ onShown, onHidden })`,
`AiMood.init({ setScorer })` and `AiAnalysis.init({ nameOf, senderOf, readDay })` get the
dashboard's functions instead of calling them by name. They read `View`, `Select`,
`Data` and `Prefs` like any other module. A unit test fails if any app file mentions
`S.`.

It lands as one PR: the panels share `View.set` and topics, so moving some tabs while
`refresh()` drew the rest would have meant building both ways of drawing.

### Step 8 · Cleanups

- `js/format.js` collects the 34 hand-written `toLocaleDateString` calls into
  `fmtDate.short`, `.long`, `.monthYear` and `.time`, and keeps one each of `andList`
  (dropping `crossAppList`) and `pct` (dropping `pctText`, `shareText`, `crossPct`).
- The trait flags (`T_REACTION`, `T_LINK`, …) are defined once in `messageLib`, which
  must stay self-contained for the workers. `analysis.js` reads them from there instead
  of keeping its own copy "in sync".
- Event wiring uses `addEventListener` throughout. The page-wide click handler in
  `initGlance` splits so each panel handles its own `data-*` actions.

### Effect

Measured after step 7 the same way as in Problem: the demo copied to 302,700 messages,
headless Chromium on an Apple-silicon Mac, the median of four runs. These numbers inform;
they aren't acceptance criteria.

| Action | Before | After |
|---|---|---|
| Change the selection on Overview | ~300 ms | 116 ms |
| Change the selection on Messages | ~300 ms | 14 ms |
| Switch the theme on Overview / Activity | ~300 ms | 0 / 31 ms |
| Sort the leaderboard | ~280 ms | 2 ms |
| Open Words, first time | ~220 ms | 160 ms |
| Open a profile (the busiest conversation) | ~140 ms | ~150 ms |

The profile didn't get faster: finding its messages no longer scans everything, but
aggregating the busiest conversation is most of its cost.

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
- **AC6** Given a browser test that adds an eighth app to `Sources.list` (detection by
  file extension, a parser that returns two messages), when a matching file is loaded,
  then the app shows in the source filter with its name and logo, and its two messages
  are counted. No other file changes.
- **AC7** Given each case in `tests/helpers/detect-cases.mjs`, `detectFile` returns the
  same kind, or the same error message, as `fileKind` did before the change.
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
  no message text is split into words. Opening Words splits each message with text once
  (a message with a link once more), and opening Mood & emoji and Media & links after it
  splits nothing more.
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
