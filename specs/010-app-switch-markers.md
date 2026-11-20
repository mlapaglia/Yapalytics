# 010 App switches in the message list

Status: Approved · PR: [#17](https://github.com/mlapaglia/Yapalytics/pull/17)

## Problem

Spec 007 counts how a linked person's conversations move between apps, but the Messages
tab doesn't show it happening. With `🔗 Alex Rivera` selected, every bubble says
"Instagram" or "SMS" in the same small grey text. You have to read each label to notice
that the two of you were trading memes on Instagram and then went back to SMS. Nothing
marks the point where the conversation moved or who moved it.

## Goals and non-goals

- When a linked person is selected, make each move between apps visible as you scroll:
  where it happened, from which app to which, and who moved it.
- Make runs of messages on one app easy to tell apart at a glance.
- Use the same definition of a switch as the Across apps tab, so the list and the tab
  agree.
- Not in scope: All conversations (people's messages are interleaved there, so two
  rows next to each other aren't one conversation), group chats, unlinked conversations,
  marking a new conversation that starts on another app (it isn't a switch), and a
  "jump to the next switch" control.

## Requirements

- **R1** With a linked person (`p:` key) selected, a **switch marker** sits between two
  messages in one conversation that are on different apps. This is spec 007 M2's
  switch: the conversation gap is the Across apps tab's (`S.appsGap`, spec 007 R7), so
  changing that picker changes the markers too.
- **R2** A switch marker shows the route and who moved it: `Instagram → SMS`, then
  `You moved` or `Alex moved` (the person's first name, or the whole name if it's a
  number or email). The mover sent the first message on the new app (spec 007 M6). Each app name
  has a dot in that app's chart colour.
- ~~**R3** A quieter `Now on SMS` marker when a new conversation starts on a different
  app.~~ Dropped in review: a new conversation on another app isn't a switch, and the
  app label on each bubble already says where it is.
- **R4** Each bubble of a linked person's message gets a thin edge in its app's chart
  colour, just outside its outer side (left for theirs, right for yours), so runs on one
  app read as a block.
  Colour is never the only cue: the markers and the app label say the app in words.
- ~~**R5** Show the app name label only on the first bubble of each run.~~ Dropped in
  review: the app name stays on every bubble as spec 005 R7 has it. Markers and edges
  are added to it.
- **R6** Markers compare each message with the one before it in the person's selection,
  not just the ones shown, so the first shown message gets a marker if the switch
  happened right there and "Show earlier messages" doesn't move or duplicate markers.
- **R7** While a search term or a mood filter is active, there are no markers: the
  messages shown aren't next to each other in the conversation. The app edges (R4)
  stay.
- **R8** With the app filter set to one app, an unlinked conversation, a group chat or
  All conversations selected, the list looks exactly as it does today.
- **R9** Markers are separators to assistive tech, with a label in words: "Switched from
  Instagram to SMS. Alex moved."

## Privacy

Nothing changes in where data goes. Markers and edges use only each message's app,
time, direction and person key, all already loaded. No message text is read, stored or
sent.

## Design

**Code.** In `js/crossapp.js` (pure, so the unit tests can load it):

- `appSwitchMarks(list, gap)`: `list` is one person's time-sorted messages. Returns a
  `Map` from a message's index in `list` to `{ from, to, o }`, where `o` is the mover's
  direction. It uses the same conversation rule as `addCrossApp`, so with the whole
  selection it has exactly `aggregateCrossApp(…).people.get(k).switches` entries.

In `js/app.js`, `renderBrowser`:

- When the selected key starts with `p:`, the app filter is "all" and neither a search
  nor a mood filter is active, call `appSwitchMarks(msgs, S.appsGap)` on the whole
  selection (R6) and add a marker before each marked message that's shown.
- When the selected key starts with `p:` and the app filter is "all", message rows get
  `app-edge app-N` (N = `m.s`). `app-N` sets `--app` to `--series-(N+1)`, the colour the
  Across apps charts already use for that app.

**UI.**

```
                 ── ● Instagram → ● SMS · Alex moved ──
  ┃ SMS
  ┃ omw, 10 min
                                                SMS ┃
                                        you're late ┃
```

`.app-switch` is a centred row with a hairline either side, like `.day-sep` but with a
pill holding the route. The edge is a 3px bar 4px outside the bubble's outer side. It
can't go inside: SMS's chart colour is the sent bubble's blue, so it would vanish on
your own SMS messages.

**Demo.** The demo's Alex Rivera already moves between SMS and Instagram (spec 007), so
linking Alex and selecting them shows markers with no demo changes.

## Acceptance criteria

- **AC1** `appSwitchMarks` on SMS → Instagram → SMS within the gap returns two marks,
  at the first Instagram message and the first SMS message after it, each with its
  route and the mover's direction.
- **AC2** An app change after more than the gap of quiet has no mark. Two messages in a
  row on the same app have no mark.
- **AC3** `appSwitchMarks` gives as many marks as `aggregateCrossApp` counts switches
  for that person, for a long mix of apps and gaps at every gap in `APPS_GAPS`.
- **AC4** With Alex linked and selected, "Read that day" on Across apps'
  biggest juggle shows as many switch markers as the juggle's switch count.
- **AC5** A switch marker reads `Instagram → SMS` and `You moved` or `Alex moved`,
  matching who sent the first message on the new app. Its accessible label says the
  same in a sentence.
- **AC6** Setting the Across apps picker to 15m removes the marker for a switch between
  messages 20 minutes apart.
- **AC7** With Alex selected, every linked bubble has its app's edge class and still
  shows its app name.
- **AC8** Typing a search term with Alex selected removes all markers.
- **AC9** Under All conversations there are no markers and linked bubbles still read
  `From 🔗 Alex Rivera · Instagram`. With the Instagram filter and Alex selected, there
  are no markers.
- **AC10** An unlinked conversation's message list has no markers and no app edges
  (spec 005 R1).
- **AC11** With "Show earlier messages" clicked, the markers already shown keep their
  places and none appear twice.

## Open questions

- None.
