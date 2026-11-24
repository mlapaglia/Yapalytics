# 020 Daily rhythm: your day, time away and unusual days

Status: Draft · Author: · PR:

## Problem

The Activity tab shows when messages happen in total (hour of day, day of week, the
weekly heatmap, night owl), but not how a person's day moves over the years. Nothing
says "you used to sign off at 11 and now it's 1 am", or "the week of Mar 3 your
messages ran six hours late: you were away". The busiest day is shown, but only one, and
a day that was huge for one conversation is lost among the totals. Nothing points out
a day that was strangely quiet with someone you talk to every day.

These are some of the most personal things a message history can show, and they need no
message text: only times, directions and conversations.

## Goals and non-goals

- Estimate when your day starts and ends from your first and last messages, week by
  week, and show how it changes.
- Spot stretches when your messages ran on a different clock (travel, jet lag, night
  shifts), and say plainly that it is a guess.
- List the days that were far busier or quieter than normal for a conversation, each one
  a click away in the Messages tab.
- Add three highlights built on these.
- Not in scope: storing or asking for time zones, changing how any parser stamps times,
  treating the estimate as real sleep data, and unusual days for calls.

## Definitions

- **Rhythm day.** A day that runs from 4:00 am to 3:59 am the next morning
  (`RHYTHM_DAY_START = 4`). A message at 1:30 am on Mar 5 belongs to Mar 4's rhythm day,
  so a late night counts as the end of the day before, not the start of the next. Its
  number is `rec.d` when `rec.h >= 4`, else `rec.d - 1`.
- **Your messages.** Messages with `o = 1` that aren't reactions (`f & T_REACTION`).
- **Counted day.** A rhythm day with at least 5 of your messages.
- **Clock time in the day.** Minutes after 4:00 am, 0 to 1439, so 1:30 am is 1290 and
  sorts after 11 pm.
- **UTC apps.** Apps whose exports give each message an absolute time: SMS Backup &
  Restore (epoch ms), Google Chat (a time with its zone), Telegram (`date_unixtime`),
  Instagram and Messenger (`timestamp_ms`). **Wall-clock apps:** WhatsApp and iMessage,
  whose exports write a clock time with no zone (see Clocks below).

## Requirements

### Your day

- **R1** The Activity tab gets a card, **When your day starts and ends**. It plots, per
  week (Monday to Sunday, by rhythm day), the median clock time of your first message
  and of your last message on that week's counted days. Weeks with fewer than 3 counted
  days are gaps in the lines. The y axis runs from 4 am at the top to 4 am at the bottom
  and is labelled in clock times; the area between the lines is shaded.
- **R2** With more than 104 weeks to plot, the card uses months instead: medians of the
  month's counted days, and a month with fewer than 8 counted days is a gap.
- **R3** A line under the title gives the usual times over all counted days in the
  selection, then weekdays and weekends when each has at least 10 counted days:
  "Usually 8:40 AM – 11:55 PM · Weekdays 7:50 AM – 11:30 PM · Weekends 10:15 AM – 12:40
  AM". Weekend means the rhythm day is a Saturday or Sunday.
- **R4** The card says what it is built on: "From N days with at least 5 messages from
  you. Your first and last messages aren't when you wake up and go to sleep, but they
  move with them." With fewer than 14 counted days the chart shows "Not enough days with
  5 or more messages from you" instead.
- **R5** The card follows every filter, like the rest of the tab. For one conversation
  it uses only your messages in it.

### Time away

- **R6** For each counted day, using only your messages from UTC apps, with at least 8
  of them that day: the day's **centre** is the circular mean of the messages' clock
  times on a 24-hour circle.
- **R7** A day's **baseline** comes from the centres of the days 8 to 35 days before it
  (*before*) and 8 to 35 days after it (*after*): the surrounding weeks, leaving a week
  each side out. A side counts with at least 4 days. The day is judged only when those
  weeks show one usual clock:
  - With both sides, they need at least 10 days together, and the circular medians of
    the two sides must be within 2 hours of each other. The baseline is the circular
    median of both. Around a move or a long trip the sides differ, and the day says
    nothing about being away.
  - With one side only (the start or end of the history, or weeks of silence), it needs
    at least 10 days, 75% of them within 2 hours of its circular median (a steady
    routine), and that median within 2 hours of the circular median of every centre in
    the selection. Without the last check, the last weeks of a history that ends soon
    after a long trip would be judged against the trip and read as "earlier".

  A day's **shift** is its centre minus its baseline, wrapped into −12…+12 hours. Its
  **spread** is 1.4826 × the median distance from the baseline of the baseline days less
  than 3 hours from it (a robust standard deviation that a trip inside the window
  doesn't widen).
- **R8** An **away stretch** starts as a run of at least 3 judged days, where no two
  judged days in a row are more than 3 rhythm days apart, that all shift in the same
  direction by at least 3 hours and at least 3 × their spread. The spread rule keeps
  people whose days vary a lot (the demo: message times drawn at random) from showing
  trips that aren't there. The run then grows over the days with a centre next to it (at
  most 3 rhythm days apart) that are still that far off the run's baseline the same way:
  the first and last weeks of a trip of a month or so can't be judged on their own,
  because the weeks on one side are partly away. Overlapping runs merge. Its shift is the
  median shift of its days against the run's baseline, rounded to the nearest hour.
  Stretches longer than 42 days aren't reported: a move or a new job is a lasting change,
  and the Your day chart shows those.
- **R9** The card lists the away stretches under the chart, newest first, at most 5, and
  shades each one on the chart. Each reads "Mar 3 – Mar 12, 2024: your messages ran
  about **6 hours later** than usual." (or "earlier"), with a **Read those days →**
  button that sets the date filter to the stretch and opens the Messages tab. One line
  under the list says "A guess from when you send messages: travel, jet lag and night
  shifts all look like this."
- **R10** Wall-clock apps never count towards away stretches (see Clocks). When the
  selection has your messages but none from UTC apps, the list says "Time away needs
  messages from SMS, Google Chat, Telegram, Instagram or Messenger. WhatsApp and iMessage
  exports don't say which time zone their times are in." The names come from the
  registry, not a fixed string.

### Unusual days

- **R11** For each conversation in the selection with at least 200 messages (at most the
  25 busiest), take its messages per local day (`rec.d`) from its first to its last day,
  with days without messages counted as 0. A day is judged against the 56 days before it,
  and only once there are 28 of them. For a set of counts, the **usual** count is their
  median `m` and the spread is `s = max(1.4826 × MAD, √m, 1)`, where MAD is their median
  absolute deviation.
- **R12** A day is **busy** when it has at least 30 messages and, against the window's
  days *with messages* (at least 10 of them), at least 3 × max(m, 1) and
  `(count − m) / s ≥ 5`; its score is `(count − m) / s` and its usual count that `m`. A
  conversation that's silent most days but long when it happens would otherwise make
  every ordinary chat a spike: on the demo, all 37 busy days had a usual count of 0.
  A day is **quiet** when, against all the window's days, `m ≥ 15`, the count is at most
  15% of `m`, and it isn't part of a run of 3 or more days without messages (long
  silences are for `reunion` and Drifted apart); its score is `(m − count) / s`.
- **R13** The Activity tab gets a card, **Unusual days**, listing the 10 highest-scoring
  days, at most 2 for any one conversation, newest first. A busy day reads "Sat, Mar 4,
  2023 · Alex · **212** messages, **14×** a normal day (usually about 15)". A quiet day
  reads "Tue, Jun 6, 2023 · Mom · only **2** messages (usually about 41)". The
  conversation is left out when one is picked. Each row has a **Read that day →** button
  that calls `readDay(dayStart, { contact: k, clearMood: true })`, or with `contact: null`
  when a conversation is already picked, so a linked person spanning apps stays picked.
- **R14** With none, the card says "Nothing out of the ordinary in this selection." With
  no conversation of 200+ messages, it says "Unusual days need a conversation with at
  least 200 messages."

### Highlights

- **R15** `buildHighlights` can return three more kinds, sorted by score with the rest:

| Kind | Icon | Fires when | Sentence (all / single) |
|---|---|---|---|
| `bedtime` | 🌙 | *All only.* The median last-message clock time of the counted days in the last 3 months of the selection differs from that of the 12 months before by 45 minutes or more, each with at least 20 counted days | "You've been signing off **1h 10m** later in the last 3 months than in the year before: around **12:50 AM**, up from 11:40 PM." (or "earlier", "down from") |
| `away` | 🧳 | *All only.* At least one away stretch: the one with the largest shift, the latest when tied | "From Mar 3 to Mar 12, 2024 your messages ran about **6 hours later** than usual. Away somewhere?" |
| `spike` | 📣 | The highest-scoring busy unusual day, when it isn't the selection's busiest day (`busiestDay` already says that one) | "Sat, Mar 4, 2023 was a big day with Alex: **212** messages, **14×** a normal day." / "Sat, Mar 4, 2023 was a big day here: **212** messages, **14×** a normal day." |

- **R16** Scores: `bedtime` 30 + 10 per hour of change (at most 45), `away` 38, `spike`
  26 + the day's score (at most 40, like `busiestDay`; 32 + 2 × the score put a day of 38
  messages second on the demo). Names are profile links, as in the other highlights.

## Clocks

Every time on the dashboard is the browser's local time of a stored instant
(`stampTime` in `js/parser.js`). How that instant was made depends on the app:

- **UTC apps** store a real instant. Their hours are shown in the time zone of the
  browser now, wherever you were when you sent them. A week in Tokyo from New York shows
  as messages running about 13 hours off: that is what R6–R8 look for.
- **WhatsApp** (`stampOf` in `js/whatsapp.js`) and **iMessage** (`js/imessage.js`) exports
  write clock times with no zone, and the parsers read them as the browser's local
  time. imessage-exporter writes them in the exporting Mac's time zone. When that Mac,
  or the phone that exported a WhatsApp chat, was in the same zone as the browser now,
  these hours match the UTC apps'. When it wasn't, every hour in that export is off by
  the difference, for the whole export. It isn't known whether WhatsApp writes the time
  zone at sending or at export (Open questions), so these apps are left out of time away
  (R10). They do count towards Your day and Unusual days. A constant offset moves the
  Your day lines but not their changes over time, and unusual days use whole days.
- **Telegram** uses `date_unixtime`, a real instant. Exports without it fall back to
  `date`, a clock time with no zone (`js/telegram.js`), which behaves like WhatsApp. The
  registry can't tell those apart, so Telegram counts as a UTC app.

This spec doesn't change how any app is stamped. The Hour of day, Weekly rhythm and
Night owl charts already work this way.

## Privacy

Nothing new leaves the browser. These features read message times, directions,
conversations, apps and the reaction flag. No code here reads message text, and no
message text is shown, except in the Messages tab when you click a button to read a day,
which already exists. Nothing is stored.

## Design

**UI.** Two cards on the Activity tab after Night owl, both `card wide`:

- `#rhythmCard`: title "When your day starts and ends", `#rhythmNote` (R3) and
  `#rhythmBasis` (R4) under it, chart `c-rhythm`, then `#awayList` (R9, R10).
- `#unusualCard`: title "Unusual days", sub "Days far busier or quieter than normal for
  a conversation", list `#unusualDays` (R13, R14).

Both appear in "Jump to…" because they're `article.card`s in the section (`Tabs.init`).

**Data.** A new file, `js/rhythm.js`, of pure functions over time-sorted message
records, loaded after `js/analysis.js` and before `js/insights.js` in `index.html`:

- `RHYTHM_DAY_START = 4`, `rhythmDayOf(r)`, `clockMinutes(r)`, `rhythmClock(min)`.
- `yourDays(msgs, utcApps)`: Map of rhythm day to `{ n, first, last, utc: [clock
  minutes] }` for your messages.
- `sleepSchedule(days)`: `{ counted, buckets: [{ start (ms), first, last, n }], unit:
  'week' | 'month', usual: { first, last }, weekday, weekend }` (R1–R4), and
  `rhythmNoteText(schedule)` (R3).
- `awayStretches(days)`: `[{ from, to (rhythm days), shift (hours, signed), days }]` (R6–R8).
- `unusualDays(msgs, { minMessages = 200, top = 25 })`: `[{ d, k, n, usual, kind: 'busy' |
  'quiet', score }]`, best first, and `unusualList(days)`: the per-conversation cap and the
  limit of 10, newest first (R11–R13).

`js/sources.js` gets a new registry field, `clock: 'utc' | 'wall'`, set to `'wall'` for
WhatsApp and iMessage, and `utcApps()`, the set of UTC app ids. `yourDays` takes that set
so it doesn't read the registry itself, which keeps it testable.

**Caching.** `Select.rhythm()` caches `{ days, schedule, away }` and `Select.unusual()`
caches `unusualDays`, both keyed on `rangeDeps()` (`js/select.js`), like `agg()`.

**Code.**

- `js/panels/activity.js` registers a `rhythm` panel (tab `sec-activity`, topics `data`,
  `selection`, `theme`) that draws both cards. **Read those days →** calls
  `setRange(from, to)` and `Tabs.select('sec-messages')`. **Read that day →** calls
  `readDay` (`js/ui/common.js`).
- `js/charts.js` gets `rhythmOption(ui, schedule, away)`: two lines and a band on a
  time-of-day axis, with a `markArea` for each away stretch.
- `js/insights.js`: `buildHighlights` takes `rhythm` and `unusual` options, like
  `crossApp`, and adds the R15 kinds when they're given. `renderHighlights` in
  `js/panels/overview.js` passes `Select.rhythm()` and `Select.unusual()`. The highlights
  panel needs no new topics: both depend on the selection.

**Cost.** Unusual days scan at most 25 conversations' daily counts with a 56-day window.
Time away compares each day with the days within 35 days of it. On the demo (29,520
messages, 779 counted days): `yourDays` 1 ms, `awayStretches` 11 ms, `unusualDays` 38 ms;
on the demo ×10 (295,200 messages) `yourDays` 8 ms and `unusualDays` 54 ms. Both are
cached per selection and only worked out when the Activity or Overview tab draws.

## Acceptance criteria

- **AC1** A message of yours at 1:30 am on Mar 5 is the last message of Mar 4's rhythm
  day, shown as 1:30 AM, and plots below 11 PM on the chart.
- **AC2** A rhythm day with 4 of your messages and 30 received isn't counted; one with 5
  of yours is.
- **AC3** In a week with 2 counted days, the week is a gap. In a week with counted days
  whose first messages are 7:00, 8:00 and 9:00 AM, the week's first is 8:00 AM.
- **AC4** 20 weekday counted days from 8 AM to 11 PM and 10 weekend days from 10 AM to
  1 AM give "Usually …", "Weekdays 8:00 AM – 11:00 PM" and "Weekends 10:00 AM – 1:00
  AM". With 9 weekend days, the weekend part is left out.
- **AC5** More than 104 weeks of counted days are plotted by month.
- **AC6** With 13 counted days the chart shows "Not enough days with 5 or more messages
  from you".
- **AC7** `bedtime`: a year of last messages at 11:30 PM, then 3 months at 12:45 AM,
  gives "You've been signing off 1h 15m later …". A 30-minute change doesn't fire. One
  conversation picked never shows it.
- **AC8** `awayStretches`: 60 days of SMS messages from 9 AM to 11 PM with 7 days in the
  middle from 3 PM to 5 AM give one stretch over those 7 days with a shift of +6.
- **AC9** The same with a 2-hour shift, or with the shift on only 2 days, gives none. A
  shift that lasts 50 days gives none.
- **AC10** The AC8 history from WhatsApp (`s = 2`) gives no stretch, and the card says
  time away needs messages from the other apps.
- **AC11** The card lists the AC8 stretch as "…: your messages ran about 6 hours later
  than usual." **Read those days →** sets the date filter to those 7 days and opens the
  Messages tab.
- **AC12** `unusualDays`: a conversation with about 20 messages a day for 90 days and one
  day of 200 lists that day as busy, with usual 20 and "10×". A day of 45 doesn't fire.
- **AC13** A conversation with about 40 a day and one day of 2 lists it as quiet. A run of
  10 days with no messages lists none of them.
- **AC14** A spike in a conversation's first 28 days isn't listed. A conversation with
  150 messages isn't judged.
- **AC15** The Unusual days card lists at most 10 days and at most 2 from one
  conversation. With one conversation picked, rows leave its name out.
- **AC16** Clicking **Read that day →** on a row opens the Messages tab with that day's
  messages in that conversation.
- **AC17** `spike`: the AC12 day gives "… was a big day with … : 200 messages, 10× a
  normal day." When that day is also the busiest day of the selection, `spike` doesn't
  fire. For one conversation it uses the "here" sentence.
- **AC18** `away` gives "From … to … your messages ran about 6 hours later than usual.
  Away somewhere?" for the AC8 history, and never for one conversation.
- **AC19** In the browser, with a generated SMS file holding the AC8 history loaded, the
  Activity tab shows both cards, the chart with one shaded stretch, and both appear in
  "Jump to…".
- **AC20** A 30-day trip is one stretch over all 30 days, though its first and last
  weeks can't be judged on their own.
- **AC21** A 7-day trip in the first or last weeks of the history is found. A 50-day trip
  that ends 20 days before the history does gives none (not a stretch "earlier" after it).
- **AC22** A year of days whose messages fall at random hours (the demo's weights) gives
  no stretch.
- **AC23** In a conversation that talks every third day, about 40 messages each time, an
  ordinary day isn't busy; a day of 200 is, with usual 40.

## Open questions

- Does WhatsApp's text export write each message's time in the zone it was sent in, or
  in the phone's zone when exported? If it's the zone when exported, WhatsApp behaves
  like iMessage and could join time away whenever its offset from the browser is 0.
  Check against an export made after a trip.
- The thresholds (5 messages a day, 3-hour shift and 3× spread, 2 hours for agreeing
  sides, 75% steady, 42 days, z ≥ 5, 200 messages, 10 active days) are first guesses,
  checked only on the demo and synthetic histories. Tune them on a few real histories,
  and change them here. On synthetic histories, trips are found with days varying by
  up to ±1.5 hours; at ±2 hours a 30-day trip is missed (a 7-day one is still found).
- A trip in the first or last weeks of a history whose usual clock changed (after a
  move) isn't found: a one-sided baseline must match the clock of the whole selection.
- Should Your day use only 1-on-1 conversations? A busy group chat can get your first
  message of the day without saying much about you. For now groups count, and the group
  chats filter can leave them out.
- A day of 4 am to 4 am suits most people. Someone who goes to bed at 5 am would want a
  later boundary. A setting (spec 015) could come later.
