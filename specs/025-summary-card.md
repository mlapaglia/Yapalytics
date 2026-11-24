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

- **R1** The Overview tab has a **Summary image** button beside its section title. It
  opens the Summary image dialog.
- **R2** The dialog shows a preview of the image, a **Show names** checkbox, and a
  **Save PNG** button. It covers the selection as it was when the dialog opened.
- **R3** The image is 1080 × 1350 pixels and shows:
  - the date span (`Mar 2019 – Nov 2026`) and, for one conversation, its name or its
    stand-in (R5)
  - total messages, with sent and received
  - tiles: messages per active day, active days, longest streak, busiest day (count and
    date), your median reply and theirs, conversations and group chats (All
    conversations only), night-owl share, attachments
  - the 5 conversations with the most messages, as bars with counts (All
    conversations), or each side's messages (one conversation, as
    `senderBreakdown` does for Year in review)
  - the 3 most-used emoji
  - each app's share of messages, when the selection has 2 or more apps
  - "Yapalytics" in a corner
- **R4** The image never contains message text: no words, phrases, link sites,
  captions, file names or AI output.
- **R5** With **Show names** off (the default), people are stand-ins by rank:
  "Person 1", "Person 2", … in the bars, and "a conversation" or "a group chat" for the
  picked conversation. "You" stays "You". App names stay.
- **R6** With **Show names** on, names are `plainName` for conversations and
  `senderLabel` for group members, as on the dashboard. The checkbox goes back to off
  every time the dialog opens. It is never saved.
- **R7** **Save PNG** downloads the image as `Yapalytics-summary-YYYY-MM-DD.png` (today's
  date). It makes no network request.
- **R8** The image looks the same in light and dark themes: a fixed dark background like
  Year in review's, with the theme's series colours for bars.
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

- `summaryStats(msgs, A, { single, names, labelFor, senderLabel })`: a pure function.
  It returns everything the image shows as strings and numbers. With `names: false` it
  never calls `labelFor` or `senderLabel`. Unit tests check it directly.
- `drawSummary(canvas, S, ui)`: draws `S`. The text-fitting and rounded-bar helpers
  inside `drawWrapped` move to a shared `canvasKit(ctx)` in `js/panels/wrapped.js`, and
  both drawings use it.
- `openSummaryDialog()`: takes `Select.range()` and `Select.agg()`, draws the
  preview, wires the checkbox (redraws) and **Save PNG**.

**UI.** `index.html` gets `<dialog id="summaryDlg">` with the same classes as the other
dialogs (`profile`), the preview canvas (`#summaryCanvas`, scaled down by CSS), the
checkbox (`#summaryNames`) and `#summarySave`. The button `#summaryBtn` goes in the
`#sec-glance` section title row.

**Data.** Nothing new. Everything comes from `aggregateMessages` (`A.dir`,
`A.activeDays`, `A.longestStreak`, `A.busiestDay`, `A.replyMedian`, `A.contacts`,
`A.night`, `A.media`, `A.emojiFreq`, `A.sourceMonths`, `A.byContact`).

## Acceptance criteria

- **AC1** With the demo loaded, the Overview tab has a **Summary image** button that
  opens a dialog with a preview, an unchecked **Show names** box and **Save PNG**.
- **AC2** `summaryStats` for a history with Alex (most messages) and Sam gives bars
  labelled "Person 1" and "Person 2" with `names: false`, and "Alex" and "Sam" with
  `names: true`.
- **AC3** `summaryStats` for one conversation gives "a conversation" with names off,
  and "a group chat" for a group. The bars are "You" and stand-ins.
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
  say a shareable image shouldn't. Should it get the same **Show names** box and drop
  "Top word" (or put it behind the box)? That changes something people already use, so
  it's left for its own change.
- **Top emoji.** Kept, because Year in review and the Top emoji chart show them. Is a
  signature emoji ever revealing enough to hide by default?
- **Should the two images merge?** Year in review could become this dialog with a year
  picked. Not now: Year in review follows its own year picker, not the date filter.
