# 021 Comparing two periods

Status: Draft · PR: [#35](https://github.com/mlapaglia/Yapalytics/pull/35)

## Problem

The dashboard describes one date range at a time. To see whether this year differs from
last year, you pick one range, remember the numbers, pick the other and compare them in
your head. Year over year (Activity tab) lines up calendar years month by month, but only
for message counts. Year in review covers one year at a time. Nothing answers "Am I
texting more since I moved?", "Do I reply faster than I did last spring?" or "Who's new
in my life this quarter, and who went quiet?"

## Goals and non-goals

- Put two periods side by side: the dashboard's date range, and one before it, a year
  before it, or any other.
- Compare the headline numbers, who you talk to, and when you talk, with each change
  stated plainly.
- Make the common comparisons one click: the last 90 or 365 days against the ones
  before, and this year so far against the same days last year.
- Not in scope: a comparison on every chart, words, mood, emoji, media, links, calls,
  the Across apps tab and highlights. Also out: more than two periods, saving a
  comparison, and putting it in the URL (spec 003 leaves the filters out of the URL too).

## Definitions

- **This period (B)** is the dashboard's date range (`View.filter.from` to
  `View.filter.to`). An open end is the last message loaded, as for the presets and the
  scope line (`dataBounds` in `js/ui/filters.js`).
- **The other period (A)** comes from the **compare with** choice:
  - **The period before** (the default): the same number of days as B, ending the day
    before B starts.
  - **A year earlier**: B's dates one calendar year back. Feb 29 becomes Feb 28.
  - **Custom**: two dates you pick.
- **A period's days** are its local days that fall between the selection's first message
  at any date (`Select.base()`) and the last message loaded. Per-day numbers divide by
  these, so a period that starts before your history isn't watered down by days you have
  no messages for. The end is the last message loaded, not the selection's last: when one
  conversation went quiet before the end of the range, its quiet days are real and count.
  (Building showed this: ending at the conversation's own last message made "the last 90
  days" 85 days long for a conversation quiet for 5 days, and its per-day numbers too
  high.)

## Requirements

- **R1** A new tab, **Compare** (`#sec-compare`, slug `compare`), after Activity. It
  shows whenever the selection has messages at any date (`Select.base()`), like Year in
  review.
- **R2** Its header names both periods: "Mar 1 – May 31, 2026 compared with Nov 29, 2025
  – Feb 28, 2026 · 92 days each". When the periods have different numbers of days, it
  gives both and adds "Changes compare messages per day." With no date range picked it
  names B and says "your whole history here".
- **R3** A **Compare with** control offers The period before, A year earlier and Custom.
  Custom shows two date inputs for A, limited to the data's bounds like the filter's
  dates (`syncRangeUi` in `js/ui/filters.js`). Picking Custom starts them at the period
  it replaces, so nothing changes until a date does.
- **R4** With no date range picked (the **All** preset), B is your whole history and has
  nothing before it, so the tab shows three buttons instead of the comparison: **Last 90
  days vs the 90 before**, **Last 365 days vs the 365 before**, and **This year so far vs
  the same days last year**. Each sets the date filter (the first two exactly as the
  90-day and Last year presets do) and the matching Compare with choice.
- **R5** B follows every change to the date filter: the date inputs, the presets and the
  timeline zoom. With The period before or A year earlier, A moves with it. The
  conversation, app and group chat filters apply to both periods.
- **R6** When A has fewer than 7 days (see A period's days), the tab says "There's no history
  before Mar 1, 2026 to compare with." with the R4 buttons under it.
- **R7** A table of headline numbers, one row each, with A, B and the change:

| Row | Value | Change |
|---|---|---|
| Messages per day | messages ÷ period days | percent |
| You sent | your share of messages | points |
| Active days | share of period days with a message | points |
| Conversations | conversations with a message | percent |
| Your reply time | median, as on the Overview tile | faster / slower |
| Their reply time | median | faster / slower |
| You start | your share of conversation starts | points |
| Avg length, sent | characters per message (reactions left out) | percent |
| Avg length, received | the same | percent |
| Emoji per 100 messages | emoji ÷ messages × 100 | percent |
| Attachments per day | photos, videos, GIFs, audio and files ÷ period days | percent |
| Night owl | share of messages from midnight to 5 am | points |

  The numbers come from `aggregateMessages` over each period, with the conversation gap
  from Settings.
- **R8** Changes are written "+38%", "−12%", "+6 pts", "2m faster" or "3m slower" (the
  difference in median, with `fmtDuration`). A change smaller than 5% (percent), 2 points
  (points) or 10% of A's median (times) reads "about the same". When A is 0 and B isn't,
  it reads "new". Changes have an ▲ or ▼ and no colour that calls them good or bad.
- **R9** A row shows "–" for a side, and no change, when that side is too thin: fewer
  than 20 messages for You sent, Emoji and Night owl, fewer than 20 messages with text on
  that side for the lengths, fewer than 10 replies for reply times, fewer than 8
  conversation starts for You start. Active days, Conversations and the per-day rows
  always show: they're counts of days and conversations, not shares of a few messages.
- **R10** With **All conversations** picked, a **People** card lists the 10 conversations
  with the most messages in B: messages in A, messages in B and the change, by the R8
  rules. Under it, **New** lists up to 5 conversations with no messages in A and at least
  20 in B, and **Went quiet** lists up to 5 with at least 20 in A and none in B, busiest
  first. Names link to the profile (`personLink`) and carry the app mark the People tab
  uses (`labelFor`), so a linked person and an unlinked conversation with the same name
  can be told apart.
- **R11** A **When** card overlays the two periods' hour-of-day profiles: each period's
  share of its messages in each hour, as two lines. Next to it, day of week the same way,
  as paired bars. Shares, not counts, so periods of different lengths compare.
- **R13** Tables and chart legends call the periods **Earlier** and **Date range**. On
  wide screens each table's column head has the period's dates under it; on a phone the
  dates are only in the header line, so the table fits at 390px.
- **R12** The rest of the dashboard is unchanged and shows B, as it does now. Year over
  year stays on the Activity tab and still lines up the calendar years in B.

## Privacy

Nothing new leaves the browser. The comparison reads message times, directions,
conversations, lengths, emoji, attachment counts and the reaction flag, the same fields
`aggregateMessages` already reads. No message text is read or shown. The Compare with
choice lives in `View` for the session and isn't stored.

## Design

**State.** `View.compare = { mode: 'before' | 'year' | 'custom', from: null, to: null }`
in `js/select.js`. `from` and `to` are used only for Custom. `VIEW_TOPICS` in
`js/panels.js` gets `compare: ['compare']`, and `View.set` merges `compare` into the
existing object as it does `leader` and `browser`.

**Periods.** A new file, `js/compare.js`, of pure functions, loaded after
`js/analysis.js` in `index.html`:

- `comparePeriods({ from, to }, compare, { first, last })`: `{ a: { from, to, days },
  b: { from, to, days } }`, or `a: null` when B has an open start (R4). Days are local
  days, so a period across a daylight-saving change still has whole days. The period
  before uses `new Date(y, m, d - days)`, not milliseconds.
- `compareRows(A, B, aDays, bDays)`: the R7 rows as `{ id, label, a, b, change: { kind:
  'pct' | 'pts' | 'dur' | 'new' | 'same' | null, value, dir } }`, with the R8 and R9
  rules.
- `comparePeople(A, B, aDays, bDays)`: `{ top, fresh, quiet }` from each `byContact`
  (R10).
- `profileShares(A)`: `{ hour: [24], dow: [7] }` from `A.hour` and `A.dow` (R11).

**Caching.** `Select.compareRange()` caches `inDates(Select.base(), a.from, a.to)`, keyed
on `rangeDeps()` and `View.compare`. `Select.compareAgg()` caches `aggregateMessages`
over it with `View.convoGap`. B reuses `Select.agg()`, so opening the tab costs one more
aggregation.

**UI.** `index.html` gets `<section class="dash-section" id="sec-compare"
data-slug="compare" data-tab="Compare">` after `#sec-activity`, with:

- `#compareHead`: the R2 line and the Compare with segmented control (`#compareMode`,
  buttons `data-mode`), and `#compareCustom` with two date inputs, hidden unless Custom.
- `#compareStart`: the R4 and R6 buttons (`data-compare-preset="90" | "365" | "ytd"`).
- `#compareCard` (wide): the R7 table, `#compareRows`.
- `#comparePeopleCard` (wide): the R10 table and lists. Hidden when one conversation is
  picked (from the `sections` panel in `js/panels/layout.js`, like `#leaderCard`).
- `#compareWhenCard`: charts `c-cmp-hour` and `c-cmp-dow`.

**Code.** `js/panels/compare.js` registers a `compare` panel (tab `sec-compare`, topics
`data`, `selection`, `gap`, `compare`, `theme`) and wires the controls in `init`. The
start buttons call `setRange` (`js/ui/filters.js`) and `View.set({ compare: { mode } })`
together, so the tab draws once. `js/charts.js` gets `compareHourOption(ui, a, b,
labels)` and `compareDowOption(ui, a, b, labels)`. The `sections` panel shows
`#sec-compare` when `ctx.base().length > 0`.

**What isn't compared, and why.** The timeline, calendar and Year over year already show
change over time. Words, mood, emoji and links need `aggregateContent`, a second pass
over message text, for each period, which costs more for an answer that a word list
gives poorly. Calls come from one app only. Each could be added later as its own row or
card.

## Acceptance criteria

- **AC1** `comparePeriods`: B from Mar 1 to May 31, 2026 (92 days), The period before,
  gives A from Nov 29, 2025 to Feb 28, 2026, 92 days each.
- **AC2** A year earlier: B from Mar 1 to May 31, 2026 gives A from Mar 1 to May 31,
  2025. B ending Feb 29, 2024 gives A ending Feb 28, 2023.
- **AC3** A period that starts before the first message has only its days with history:
  A from Jan 1 to Mar 31 with history starting Mar 1 has 31 days.
- **AC4** `compareRows`: 900 messages over 90 days in A and 1,800 in B give Messages per
  day 10 and 20, "+100%".
- **AC5** You sent 40% in A and 46% in B gives "+6 pts". With 10 messages in A, the row
  shows "–" for A and no change.
- **AC6** Your reply time of 10m in A and 4m in B gives "6m faster". With 9 replies in a
  period, that side shows "–".
- **AC7** 100 and 103 messages per day give "about the same". 0 and 40 attachments per
  day give "new".
- **AC8** `comparePeople`: Alex with 10 in A and 100 in B is in the top list with
  "+900%". Sam with 0 in A and 40 in B is under New. Jo with 50 in A and 0 in B is under
  Went quiet. Kim with 0 and 15 is in neither list.
- **AC9** `profileShares`: each period's hour shares and weekday shares add up to 100%.
- **AC10** Custom periods of 30 and 60 days compare per day, and the header gives both
  lengths and "Changes compare messages per day."
- **AC11** In the browser, with the demo loaded and the date filter on All, the Compare
  tab shows the three buttons and no table. Clicking **Last 90 days vs the 90 before**
  sets the date inputs as the 90-day preset does, and the header names both 90-day
  periods.
- **AC12** Then picking **A year earlier** moves A back a year and leaves the date
  filter as it was. Picking a conversation redraws both periods for it and hides the
  People card.
- **AC13** Changing the date filter's start date moves B, and with The period before,
  A ends the day before B's new start.
- **AC14** Picking **Custom** shows two date inputs. Setting them changes A and nothing
  else.
- **AC15** With a range that starts on the first day of history, the tab says "There's
  no history before … to compare with." and shows the three buttons.

## Open questions

- **Before / after a date.** This design compares equal stretches either side of a date
  (set the date as the start of the range, then The period before). Some people will
  want everything before against everything after. Custom covers it with four date
  picks. Is a one-step "Split at a date" mode worth adding?
- A group chat picked on its own could get a members table (A vs B per sender, from
  `senderBreakdown` in `js/panels/wrapped.js`) in place of People. Worth it in this spec
  or later?
- The "about the same" thresholds (5%, 2 points, 10%) ignore how many messages are
  behind a number. A 10% change in 30 messages means little; one in 30,000 means a lot.
  A simple test could replace them if they mislead in practice.
- Should Year over year link to Compare with A year earlier, now that both exist?
