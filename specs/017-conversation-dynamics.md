# 017 How two people talk

Status: Approved · PR: [#32](https://github.com/mlapaglia/Yapalytics/pull/32)

## Problem

The Replies tab says who sends more, how fast each side answers, who starts
conversations and who double-texts. It doesn't say how conversations end, whether
questions get answered, how each side takes turns, or whether two people have started
to write like each other. Those are the things people mean when they ask "who puts in
more effort here?", and every number needed to answer them is already on the
message records.

## Goals and non-goals

- Show how 1-on-1 conversations end: who has the last word, and how often someone
  writes and hears nothing back.
- Show how many questions get a reply from the other side.
- Show turn-taking: how many messages each side sends before the other answers.
- Show how alike two people's writing styles are, month by month.
- Add a highlight for each of these.
- Not in scope: group chats (with more than two people, "the other side" is not one
  person; spec 018 covers groups), reading message text beyond what the parser already
  sets, quoted replies (spec 022), and the profile dialog.

## Definitions

- **Conversation**: the existing one. A run of messages in one thread with no silence
  longer than the conversation gap picked in Settings (spec 015).
- **Turn**: messages in a row from one side, within one conversation.
- **Last word**: in a conversation where both sides wrote, the side that sent the
  final message.
- **No reply**: a conversation where only one side wrote. It belongs to the side that
  wrote ("you got no reply", "they got no reply").
- **Settled**: a conversation whose last message is more than one gap before the last
  message in the selection. Only settled conversations count for endings and question
  replies. Without this rule, a chat that is still going would look unanswered.
- **Question with a reply**: a message with the Questions trait, followed in the same
  conversation by any message from the other side.
- **Text message**: a message with text (`l > 0`) that isn't a reaction.
- **Style markers**: for one side over a set of text messages: words per message,
  emoji per message, and the share of messages that ask a question, laugh, say
  love-you, are in ALL CAPS, or swear.
- **Style match**: for each marker, with the two sides' values `a` and `b`,
  `1 − |a − b| / (a + b)`, averaged over the markers and shown as 0 to 100. A marker
  is left out when it adds up to fewer than 10 on the two sides together (questions,
  laughs, emoji…), because one swear word against none would otherwise score that
  marker 0. This is the formula of Language Style Matching (Ireland and Pennebaker),
  applied to these markers instead of function words, so the card calls it "style
  match" and doesn't claim to be LSM.
- **Point**: the style match for a month, over that month and the 2 before it. A month
  with messages gets a point when its 3 months have at least 30 text messages from
  each side. A single month is too small a sample: on the demo, monthly values swung
  8–12 points around a conversation's overall match; 3-month windows bring that to
  3–5.

## Requirements

- **R1** Everything in this spec counts 1-on-1 conversations only: thread keys that
  don't start with `g:`. A selection with group chats still counts its 1-on-1 messages.
- **R2** The Replies tab gets four new cards after "Texting habits":
  1. **How conversations end**: a donut with four parts: *You had the last word*,
     *They had the last word*, *You got no reply*, *They got no reply*. Its center
     shows the number of settled conversations. The note says "1-on-1 conversations,
     each ending after {gap} of quiet" and has the same **Change** button as the other
     gap notes.
  2. **Questions that got a reply**: one bar each for *Your questions* and *Their
     questions*, split into *Got a reply* and *No reply*, with the reply share as a
     label.
  3. **Turn-taking**: messages per turn for each side, in bins 1, 2, 3, 4–5, 6–10,
     11+. The note gives each side's average messages per turn.
  4. **Style match** (wide): for **All conversations**, one line for each of the 5
     busiest 1-on-1 conversations with at least 3 points. For one conversation, a
     single line, and under it a table of both sides' markers over the whole selection,
     the match for each marker ("–" when it's too rare to compare) and the overall
     match.
- **R3** When the selection has no 1-on-1 messages, the first three cards show
  "No 1-on-1 conversations in this selection". The style card shows "Style match
  compares two people. Pick a 1-on-1 conversation." for a group chat, and "Not enough
  messages to compare styles" when nothing has a point.
- **R4** Changing the conversation gap in Settings redraws all four cards.
- **R5** `buildHighlights` can return the four kinds in the table below, at most one of
  each, scored alongside the others. They consider the same 1-on-1 conversations spec
  008 does: the busy ones, or the one selected.

| Kind | Icon | Fires when | Sentence (all and single) |
|---|---|---|---|
| `lastWord` | 🎤 | ≥ 30 settled conversations where both wrote, and one side had the last word in ≥ 70% (the most lopsided) | "Alex gets the last word in **74%** of your conversations." / "You get the last word in **74%** of your conversations with Alex." Single: "… of conversations here." |
| `noReply` | 📭 | One side has ≥ 15 no-reply conversations and ≥ 3× the other's (the other counts as at least 1) | "**23** times you messaged Alex and heard nothing back within 6 hours. It went the other way **4** times." / "**23** times Alex messaged you and heard nothing back within 6 hours. …" "It never went the other way." when the other is 0. The duration is the gap in words. |
| `questionReplies` | 💭 | Each side asked ≥ 30 questions in settled conversations and the two reply shares differ by ≥ 25 points | "**88%** of your questions get a reply from Alex, but only **52%** of theirs get one from you." or the reverse: "**88%** of Alex's questions get a reply from you, but only **52%** of yours get one from them." |
| `converge` | 🪞 | ≥ 6 points spanning ≥ 12 months, and the mean of the last 3 points is ≥ 15 above the first 3 | "You and Alex write more alike than you used to: style match up from **52** to **78**." Single: "You write more alike here than you used to: …" |

Scores: `lastWord` 26 + (share − 0.5) × 40, `noReply` 26 + min(10, log2(ratio) × 4),
`questionReplies` 24 + points / 4, `converge` 28 + min(12, rise / 3). The thresholds
can be tuned against real histories; changes go in this table.

## Privacy

Nothing new leaves the browser and nothing new is stored. The new numbers come from
fields the parsers already set: time, direction, thread, length, word count, emoji,
trait flags and swear counts. No new code reads message text.

## Design

**Data.** `aggregateMessages` (js/analysis.js) already walks each thread's
conversations with `lastByThread`. The open conversation gains `sides` (bit 1 =
received, bit 2 = sent), `turn` (messages in the current turn) and `asked` ([r, s]
questions waiting for a reply). For 1-on-1 threads only:

- each message from side `o` marks side `1 − o`'s waiting questions as replied and
  clears them; a new turn closes the previous turn into `A.turnHist`
- `closeSession` counts the turn still open, and, when the conversation is settled,
  its ending and its unreplied questions

New fields on `A`, all [received, sent] where it says so:

- `endings: { last: [r, s], none: [r, s] }`
- `questionReplies: { asked: [r, s], replied: [r, s] }` (settled conversations only)
- `turnHist: [[…], […]]` in `TURN_BINS` order, and `turns: [r, s]`
- `styleMonths: Map(mo -> [sums r, sums s])` and `styleTotal: [sums r, sums s]`, where
  sums are `[messages, words, emoji, questions, laughs, love, caps, swearing]` over
  text messages. The loop adds to each conversation's `style` only, and these two are
  added up from those after it: the pass is about 12% slower than before (96 to 107 ms
  for 295,000 messages), against 19% when the loop filled all three.

and on each 1-on-1 `byContact` record: `lastWord: [r, s]`, `noReply: [r, s]`,
`qAsked: [r, s]`, `qReplied: [r, s]`, `style: Map(mo -> [sums r, sums s])`.

New helpers in js/analysis.js: `TURN_BINS`, `STYLE_MARKERS` (labels and how to read
each from the sums), `STYLE_WINDOW = 3`, `STYLE_MIN_MSGS = 30`, `STYLE_MIN_HITS = 10`,
`styleMarkers(sums)`, `markerMatch(a, b, marker)`, `styleMatch(a, b)` (sums in, 0–100
or null out), and `styleSeries(months)` (months to `[[mo, match]]` points).

`A.turnMsgs: [r, s]` (messages in those turns) gives the turn-taking note's averages.

Settled uses the time of the last message in `msgs`, so it needs no second pass: a
conversation is settled when `A.last − its last message > gap`, checked after the loop
for the conversations still open.

**Charts.** js/charts.js gets `endingsOption`, `questionRepliesOption`, `turnsOption`
and `styleOption`, in the style of `splitOption`, `behaviorOption` and
`relationshipsOption`.

**Panel.** The `replies` panel (js/panels/replies.js) draws the new cards, the notes
and the style table (`#styleMarkers`). Its topics already include `gap`.

**Highlights.** A new `dynamicsHighlights` in js/insights.js, called from
`buildHighlights` after `moreHighlights`, adds the four kinds.

## Acceptance criteria

- **AC1** In a 1-on-1 thread, a settled conversation you → them → you counts as your
  last word; one where only they wrote counts as their no reply.
- **AC2** A conversation whose last message is less than one gap before the last
  message in the selection doesn't count for endings or question replies.
- **AC3** Messages in a group chat don't count towards endings, question replies,
  turns or style.
- **AC4** Your question followed by their message in the same conversation is replied;
  your question in a conversation where they never write again isn't; two questions of
  yours in a row followed by one message of theirs are both replied.
- **AC5** You sending 3 messages and then them sending 1 adds one turn to your "3" bin
  and one to their "1" bin.
- **AC6** Two sides with the same markers have a style match of 100; a marker that
  adds up to fewer than 10 on the two sides is skipped; a month whose 3-month window has
  fewer than 30 text messages on either side gets no point, and one whose window
  reaches 30 does, even when that month itself has only photos.
- **AC7** `lastWord`: 40 settled conversations where Alex sends the final message in 32
  give "Alex gets the last word in 80% of your conversations."
- **AC8** `noReply`: you getting no reply 20 times and Alex 2 times gives "20 times you
  messaged Alex and heard nothing back within 6 hours. It went the other way 2 times."
- **AC9** `questionReplies`: 40 of your questions with 36 replied and 40 of theirs with
  16 replied gives "90% of your questions get a reply from Alex, but only 40% of theirs
  get one from you."
  The 25-point rule is on the exact difference: 75% against 50.5% doesn't fire, 90%
  against 65% does.
- **AC10** `converge`: a conversation whose markers start far apart and end the same
  gives "You and Alex write more alike than you used to: style match up from N to 100."
- **AC11** For a single conversation, the kinds use their single sentences.
- **AC12** With the demo loaded, the Replies tab shows the four new cards with charts
  drawn. Picking a 1-on-1 conversation shows the style table; picking a group chat
  shows the style card's empty text.
- **AC13** Changing the conversation gap in Settings changes the "How conversations
  end" note to the new gap.

## Open questions

- Reactions (iMessage tapbacks and Google Messages reactions arrive as messages) count
  as messages today, so a tapback can be the last word. That matches how the
  conversation is counted elsewhere. Should endings skip them?
- The style markers are what the parser already sets. Function-word rates (closer to
  real LSM) would need the text, and would belong in spec 019's text pass.
- Should the profile dialog show last word and question replies too?
