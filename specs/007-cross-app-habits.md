# 007 Cross-app habits

Status: Approved · PR: [#14](https://github.com/mlapaglia/Yapalytics/pull/14)

## Problem

Spec 005 lets you link one person's 1-on-1 conversations across apps, so `🔗 Alex Rivera`
covers both SMS and Instagram. Once linked, the dashboard treats them as one
conversation, and how the two of you move between apps disappears from view. Nothing
shows that you bounce between Instagram and SMS in the middle of a conversation, who
moves it, what sets off a move, or that you drifted from SMS to Instagram last spring.

## Goals and non-goals

- Measure how linked people use their apps together: how often a conversation moves
  between apps, who moves it and why, how replies cross apps, what each app is used
  for, and how the main app changes over time.
- Show this for all linked people together and for each linked person.
- Not in scope: unlinked conversations (two apps can't be compared without a link),
  group chats, and guessing links that the user hasn't made.

## Definitions

Only linked people (`p:` keys) whose messages in the current selection span 2+ apps
count. A **conversation** follows the existing session rule, no silence longer than a
gap, but with this tab's own gap (`S.appsGap`, R7) instead of the dashboard's
(`S.convoGap`).

| # | Metric | Definition |
|---|---|---|
| M1 | App split | Share of messages per app, overall and for each side. |
| M2 | Switches | Two consecutive messages in one conversation on different apps. Also shown per conversation. |
| M3 | Multi-app conversations | Share of conversations that use 2+ apps. |
| M4 | Back-and-forth conversations | Conversations that leave an app and come back to it (A→B→A). |
| M5 | Multi-app days | Share of active days with messages on 2+ apps. Across several people, each person's days count separately. |
| M6 | Who switches | Who sent the first message on the new app, you or them. |
| M7 | Switch routes | Switches per direction (Instagram → SMS, SMS → Instagram), split by who switched. |
| M8 | What sets off a switch | The message just before the switch: an Instagram share (`sh`), a link (`f & T_LINK`), a photo, video or GIF, or plain text. The first match in that order counts. |
| M9 | Cross-app replies | Replies (the other side answering within the gap, as in `aggregateMessages`) that arrive on a different app than the message they answer. Also the median reply time for cross-app and same-app replies. |
| M10 | What each app is for | One column per app: messages, % from you, average length, % with photos or videos, % with links or shares, peak hour, conversations started there by each side, and median reply time for each side. |
| M11 | Main app over time | Monthly app share (100% stacked). A **shift** is when the app with the most messages in a 3-month window changes, that window has at least 30 messages, and the new leader holds for the next 3 windows. One busy month is in at most 3 windows, so it can't make a shift by itself, and a change in the last 3 months is too recent to call. |
| M12 | Biggest juggle | The conversation with the most switches: its date, switch count and apps, with a "Read that day" link. |

## Requirements

- **R1** A new tab, **Across apps** (`#sec-apps`, slug `apps`), comes after Sources.
  Following spec 003 R3, it has a tab only when the selection has a linked person with
  messages on 2+ apps. With the app filter set to one app, or with no links, it has
  none.
- **R2** With **All conversations** selected, the tab shows totals across linked people
  and a table with one row per linked person. With a person selected, it shows that
  person alone.
- **R3** The date range ~~and People filter~~ applies, as on every other tab (spec 012
  removed the People filter). The conversation gap is this tab's own (R7).
- **R4** A linked person's profile has a short **Across apps** section: the app split
  bar, plus switches per conversation, who switches, and cross-app replies.
- **R5** Highlights can include one cross-app finding, the strongest of: who switches
  (one side has at least 65% of at least 10 switches), back-and-forth conversations (at
  least 20% of at least 10 conversations), or a main-app shift.
- **R6** No message text is read. These metrics use only the app, time, direction,
  length, attachment counts, the link flag and the share flag.
- **R7** The Switching apps card has a picker for when a conversation ends: after
  15 minutes, 30 minutes, 1 hour or 6 hours of quiet (default 6 hours, the same as the
  rest of the dashboard). Moving between apps happens on a short timescale, so these
  choices are shorter than the Replies tab's (30 minutes to 24 hours). The picker
  applies to everything spec 007 shows: the tab, the profile section and the
  highlight. It doesn't change the Replies tab's gap, and that one doesn't change it.

## Privacy

Nothing changes in where data goes. Everything is computed in the page from fields
that are already loaded. Nothing is stored or sent.

## Design

**Code.** `js/crossapp.js` (pure, loaded after `insights.js`):

- `aggregateCrossApp(msgs, gap)`: one pass over the selection (sorted by time),
  counting only `p:` keys. It tracks each person's open conversation the way
  `aggregateMessages` does. It returns `{ people: Map(k → P), total: P, busiest }`.
  People whose selection has only one app are left out of both `people` and `total`.
- `mainAppShifts(months)` → `[{ mo, from, to }]` (M11).
- `crossAppHighlight(X, labelFor)` → a highlight in the `buildHighlights` format, or
  null (R5).

`buildHighlights` accepts a `crossApp` option and adds that highlight.
`switchRoutesOption` in `charts.js` draws M7. M11 reuses
`monthlyStackOption(…, { percent: true })`.

**UI.** The `#sec-apps` section has these cards:

1. **Switching apps**: tiles for switches (M2), multi-app conversations (M3),
   back-and-forth conversations (M4), multi-app days (M5), who switches (M6) and
   cross-app replies (M9), plus the biggest juggle (M12) with a "Read that day" link.
2. **Linked people** (All conversations only): person (opens the profile), messages,
   app split bar, switches per conversation, multi-app %, who switches, main app.
   Sorted by switches.
3. **Main app over time** (M11), with any shifts in the note.
4. **Switch routes** (M7) and **What sets off a switch** (M8).
5. **What each app is for** (M10).

**Demo.** The demo adds an Instagram 1-on-1 with Alex Rivera over the same months as the
SMS one, so it offers a link suggestion and shows the tab once that's accepted.

## Acceptance criteria

- **AC1** SMS → Instagram → SMS in one conversation gives 2 switches, one multi-app
  conversation and one back-and-forth conversation. The same messages with a gap longer
  than the conversation gap between apps give 0 switches.
- **AC2** Who switches counts the sender of the first message on the new app. Routes are
  counted per direction.
- **AC3** A switch after a message with a share counts as a share trigger, after a link
  as a link trigger, and after a photo as a media trigger.
- **AC4** A reply on a different app than the message it answers counts as cross-app,
  and its time is in the cross-app reply times.
- **AC5** Unlinked messages, group messages, and a linked person with one app in the
  selection aren't counted.
- **AC6** `mainAppShifts` reports SMS → Instagram in the right month for a clear shift,
  and nothing for a one-month flicker or for windows under 30 messages.
- **AC7** `crossAppHighlight` returns the who-switches sentence when one side has at
  least 65% of the switches.
- **AC8** With no links there's no Across apps tab. After linking Alex by hand, the tab
  appears with the expected switch count.
- **AC9** With the Instagram filter, the tab is hidden. If it was selected, Overview is
  selected instead.
- **AC10** With All conversations selected, the Linked people table has a row for Alex.
  The name opens the profile, which has an Across apps section.
- **AC11** With Alex selected, What each app is for has an SMS column and an Instagram column.
- **AC12** A date range that ends before the first switch shows 0 switches.
- **AC13** The Across apps picker offers 15m, 30m, 1h and 6h, with 6h picked at first.
  Picking 15m splits a conversation whose apps are 20 minutes apart, so its switch is
  no longer counted. The Replies tab's picker stays on 6h.

## Open questions

- None.
