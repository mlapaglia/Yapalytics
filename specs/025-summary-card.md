# 025 Summary image

Status: Draft · PR:

## Problem

People want to post their numbers: "412,000 messages since 2014, median reply 3
minutes". The only image Yapalytics makes is Year in review (`js/panels/wrapped.js`).
It covers one calendar year, not the dates picked on the dashboard. It also prints
names and the most-used word, so posting it shares other people's names, and a word
from their messages, without asking them. Each chart has its own "Save PNG" (ECharts'
`saveAsImage` in `baseOption`, `js/charts.js`), but that saves one chart, not a
summary.

## Goals and non-goals

- One image of the headline numbers for the current selection: whatever conversation,
  app, group setting and dates are picked.
- Safe to post by default: no message text and no names. Names appear only when the
  user turns them on for that image.
- Made and saved in the browser. Nothing is uploaded.
- Not in scope: posting to social networks, a share link, changing Year in review
  (see Open questions), choosing which tiles appear.

## Requirements

- **R1** The Overview tab has a **Summary image** button above its KPI tiles, on the
  right. It opens the Summary image dialog. (The section title is only there for screen
  readers, so the button can't sit beside it.)
- **R2** The dialog shows a preview of the image, a **Show names** checkbox, and a
  **Save PNG** button. It covers the selection as it was when the dialog opened.
- **R3** The image is 1080 × 1350 pixels and shows:
  - the date span (`Mar 2019 – Nov 2026`) and, for one conversation, its name or its
    stand-in (R5)
  - total messages, with sent and received
  - tiles: messages per day (over the span, as the Overview's **Per day** KPI),
    active days, longest streak, busiest day (count and date), your median reply and
    theirs, conversations and group chats (All conversations only), night-owl share,
    attachments
  - the 5 conversations with the most messages, as bars with counts (All
    conversations), or each side's messages (one conversation, as
    `senderBreakdown` does for Year in review)
  - the 3 most-used emoji
  - each app's share of messages, when the selection has 2 or more apps
  - "Yapalytics" in a corner
- **R4** The image never contains message text: no words, phrases, link sites,
  captions, file names or AI output.
- **R5** With **Show names** off (the default), people are stand-ins by rank. In the
  top conversations, 1-on-1 conversations are "Person 1", "Person 2"… and group chats
  "Group chat 1"…, each numbered in its own order. In one conversation, the other
  people are "Person 1", "Person 2"… by messages sent. The picked conversation is "A
  conversation" or "A group chat". "You", "Unknown sender", "Everyone else (N people)"
  and app names stay.
- **R6** With **Show names** on, names are `plainName` for conversations and
  `senderLabel` for group members, as on the dashboard. The checkbox goes back to off
  every time the dialog opens. It is never saved.
- **R7** **Save PNG** downloads the image as `Yapalytics-summary-YYYY-MM-DD.png` (today's
  date). It makes no network request.
- **R8** The image looks the same in light and dark themes: a fixed dark background like
  Year in review's, and the dark theme's series colours for bars whatever the page's
  theme. (The two themes' series colours differ, so using the page's would break this.)
- **R9** With an empty selection the button is disabled.

## Privacy

Nothing leaves the browser. The image is drawn on a `<canvas>` in the page and saved
with `canvas.toBlob` and a download link, as `saveWrapped` does. Nothing is uploaded,
and nothing about the image is stored.

The image holds counts, dates, durations, emoji and app names. It holds no message
text (R4). Emoji are counted the same way as the Top emoji chart and are shown without
the messages they came from.

Names are off by default (R5). The card is made to be posted, and the people in it
didn't choose to be in a post. A rank says what the card is about (how much you talk to
your top people) without saying who they are. Initials were considered and rejected:
anyone who knows you can often tell who "A. R." is, so they still identify people. The
choice isn't saved, so each image is a fresh decision.

## Design

**Code.** A new file, `js/ui/summary-dialog.js`, loaded after `js/ui/profile.js` in
`index.html`:

- `summaryStats(msgs, A, { contact, names, labelFor, senderLabel, appName })`: a pure
  function. It returns everything the image shows as strings and numbers. With
  `names: false` it never calls `labelFor` or `senderLabel`. Unit tests check it
  directly.
- `drawSummary(canvas, sum)`: draws `sum` with `SUMMARY_COLORS`, the dark theme's
  series colours. The background, text-fitting and rounded-box helpers inside
  `drawWrapped` move to a shared `canvasKit(canvas)` in `js/panels/wrapped.js`, and both
  drawings use it. Year in review's image is byte for byte the same as before (checked
  by hashing the demo's PNG before and after).
- Emoji are drawn one at a time: the emoji font's spaces are wide, so a run of three
  was cut to fit, and cutting could split an emoji.
- `openSummaryDialog()`: takes `Select.range()` and `Select.agg()`, draws the
  preview, wires the checkbox (redraws) and **Save PNG** (`summaryFileName()`).
- A `summary-button` panel on the Overview tab disables the button when the selection
  is empty.

**UI.** `index.html` gets `<dialog id="summaryDlg">` with the same classes as the other
dialogs (`profile`), the preview canvas (`#summaryCanvas`, scaled down by CSS), the
checkbox (`#summaryNames`) and `#summarySave`. The button `#summaryBtn` goes in a
`.glance-bar` above `#kpis`.

**Data.** Nothing new. Everything comes from `aggregateMessages` (`A.dir`,
`A.activeDays`, `A.longestStreak`, `A.busiestDay`, `A.replyMedian`, `A.contacts`,
`A.night`, `A.media`, `A.emojiFreq`, `A.sourceMonths`, `A.byContact`).

## Acceptance criteria

- **AC1** With the demo loaded, the Overview tab has a **Summary image** button that
  opens a dialog with a preview, an unchecked **Show names** box and **Save PNG**.
- **AC2** `summaryStats` for a history with Alex (most messages), a group chat and Sam
  gives bars labelled "Person 1", "Group chat 1" and "Person 2" with `names: false`,
  without looking up a name, and "Alex", the group's name and "Sam" with `names: true`.
- **AC3** `summaryStats` for one conversation gives "A conversation" with names off,
  and "A group chat" for a group. The bars are "You" and stand-ins, and no name is
  looked up.
- **AC4** For a history whose messages all contain the word `zebracorn` and a link to
  `example.org`, `JSON.stringify(summaryStats(…))` contains neither, with names on or
  off.
- **AC5** `summaryStats` gives the totals, tiles, top 3 emoji and app shares that the
  Overview KPIs give for the same selection.
- **AC6** Clicking **Save PNG** downloads `Yapalytics-summary-<today>.png`, a PNG of
  1080 × 1350, and makes no network request.
- **AC7** Ticking **Show names**, closing the dialog and opening it again leaves the box
  unticked.
- **AC8** With a date range that has no messages, the button is disabled.
- **AC9** The preview draws the same pixels in the light and dark themes.

## Open questions

- **Year in review.** It shows names and the most-used word by default, which R4 and R5
  say a shareable image shouldn't. Asked whether it should get the same **Show names**
  box, the owner chose to leave it as it is for now.
- **Top emoji.** Kept, because Year in review and the Top emoji chart show them. Is a
  signature emoji ever revealing enough to hide by default?
- **Should the two images merge?** Year in review could become this dialog with a year
  picked. Not now: Year in review follows its own year picker, not the date filter.
