# 027 Counting reactions

Status: Approved · Author: · PR:

## Problem

Reactions are a large share of how people answer each other, but Yapalytics throws
most of them away. A reaction sent as a text (SMS and RCS: `Loved “see you soon 😊”`,
`❤️ to “see you soon 😊”`, `Loved an image`) is dropped while the file loads and only
adds to one total on the loading screen. Reactions stored on a message (Instagram,
Messenger, Telegram, Google Chat) show as chips under it in Messages, but spec 004 R8
keeps them out of every statistic. iMessage tapbacks are skipped entirely.

So Top emoji only counts emoji people typed. Someone who hearts every message and
rarely types ❤️ looks like they never use it. And there's no way to see how fast
people react, whether they react instead of replying, or who reacts to their own
messages.

## Goals and non-goals

- Count every reaction we can read, with who reacted, the emoji, and when.
- Tie each SMS/RCS reaction text to the message it reacts to, so it can be timed and
  shown under that message.
- Count reactions in every emoji statistic: Top emoji (beside the typed emoji), Emoji
  over time, signature emoji, Year in review and the summary image.
- New cards: time to react, reacting to your own messages, reacting instead of
  replying, who reacts the most, and the most-reacted messages.
- Highlights for the standouts.
- Not in scope: counting reactions as messages. Message counts, words, mood, reply
  times, conversation starts and every statistic that isn't about emoji stay as they
  are.

## Definitions

- **Reaction**: one person putting one emoji on one message. A person changing their
  reaction on a message replaces it. Removing it removes it.
- **Reaction text**: an SMS/RCS message that is a reaction. These are the ones
  `isReactionText` already recognises (`js/parser.js`).
- **Target**: the message a reaction is on. For apps that store reactions on the
  message, the target is that message. For reaction texts, it is found by matching
  (R4, R5).
- **Matched**: a reaction text whose target was found.
- **Reactor**: who reacted. "You" when it's the owner of that app (spec 013), the same
  way the message list names you today (spec 004 R9).
- **Time to react**: the reaction's time minus the target's time, for a reaction that
  has both.
- **Own-message reaction**: a reaction whose reactor also sent the target.
- **Reaction instead of a reply**: a reaction after which the reactor sends nothing
  else in that conversation (the existing conversation, cut by the gap in Settings).

## Requirements

### Reading reactions

- **R1** Reaction texts stay out of the messages, as now, but are kept in a separate
  list instead of being thrown away. Each keeps its time, conversation, app, side
  (sent or received), group sender, and what the text says: the emoji, the quoted
  text or the media kind, and whether it's a removal.
- **R2** A reaction text's emoji:

  | Text starts with | Emoji |
  |---|---|
  | `Liked` | 👍 |
  | `Loved` | ❤️ |
  | `Disliked` | 👎 |
  | `Laughed at` | 😂 |
  | `Emphasized` / `Emphasised` | ‼️ |
  | `Questioned` | ❓ |
  | `Reacted X to`, `Reacted with X to`, `X to` | X |
  | `Removed a heart / like / dislike / laugh / exclamation / question mark from` | ❤️ 👍 👎 😂 ‼️ ❓, as a removal |
  | `Removed X from` | X, as a removal |

  A custom name like `:party_blob:` is kept as the "emoji", as spec 004 does for Google
  Chat.
- **R3** Apps that store reactions on the message also keep each person's reaction
  time when the export has one: Instagram and Messenger `reactions[].timestamp`
  (seconds), Telegram `recent[].date`. Google Chat exports give no time. Everything
  else about these reactions is as spec 004 R6, R7, R9 and R10 say.
- **R4** iMessage tapbacks (`Tapbacks:` followed by indented `Loved by Alex` lines) are
  read as reactions on the message above them, named "You" when the name is the
  iMessage owner. They have no time. Thread replies, which are indented the same way,
  are still skipped.

### Matching reaction texts to their target

- **R5** A reaction text quoting a message is matched to the latest earlier message in
  the same thread (before any person linking) from up to 24 hours before the reaction,
  whose text equals the quote. Both texts are compared with invisible marks dropped,
  spaces collapsed, curly and straight quotes and apostrophes treated as the same, and
  a trailing `…` or `...` dropped. A quote that is cut short (no closing quote, or a
  closing `…`) matches a message that starts with it. When no message equals the quote,
  a message that starts with it counts too.
- **R6** A reaction text to media (`Loved an image`) is matched to the latest earlier
  message in the same thread, up to 24 hours back, with that kind of attachment: image,
  photo or picture to a photo (or GIF), movie or video to a video, GIF to a GIF, audio
  or voice message to audio, and sticker, attachment, file, location or contact to any
  attachment. `a link` matches the latest message with a link. Phones don't say which
  file, so this is a best guess, and the card says so.
- **R7** A removal cancels the same reactor's latest earlier reaction with that emoji
  on the same target. A removal with nothing to cancel is ignored. A new reaction from
  the same reactor on a target they already reacted to replaces the earlier one, but
  the time to react stays the time of the first.
- **R8** A matched reaction text shows under its target in Messages as a chip, like
  other reactions (spec 004 R6). An unmatched one counts in totals and emoji but has no
  time to react and doesn't show in Messages.

### What counts

- **R9** A reaction belongs to the selection when its target does (conversation, app,
  group and date filters). An unmatched reaction text uses its own time and
  conversation.
- **R10** Reactions never count as messages and don't change any statistic that
  existed before this spec, except the emoji ones (R11, R11a). Spec 004 R8 is amended
  to say so. They still aren't sent to AI analysis.

### Top emoji

- **R11** Top emoji counts reactions as well as typed emoji, as four stacked parts per
  emoji: typed by you, reacted by you, typed by them, reacted by them. The reaction
  parts are lighter shades of the sent and received colours. Rows are ranked by the
  total. The tooltip gives all four numbers. The subtitle says "Typed and reacted,
  sent and received". A **Reactions** checkbox in the card header, ticked by default,
  turns the reaction parts off.
- **R11a** Emoji over time, the signature emoji of a conversation (People, Highlights),
  the top emoji in Year in review and in the summary image count typed and reacted
  emoji together, by the reaction's time and side. The Reactions box in Top emoji
  doesn't change them.

### New cards

These go on the Mood & emoji tab after Top emoji, under a "Reactions" heading, and in
Jump to…. With no reactions in the selection each card says "No reactions in this
selection".

- **R12** **Reactions**: how many reactions you gave and got, and the top 10 reaction
  emoji as sent and received bars. The note says how many reaction texts couldn't be
  matched to a message, and that reactions to photos and videos are matched to the
  latest one sent before them.
- **R13** **Time to react**: a histogram of time to react, per side, in the reply-time
  bins (`< 1 min` to `> 1 day`, not cut at the conversation gap), with each side's
  median in the note. Only reactions with a time count. The note names the apps that
  give reaction times. A median shows only when that side has at least 10 timed
  reactions.
- **R14** **How you react**: for each side, the share of reactions that are
  own-message reactions, and the share that are reactions instead of a reply, as two
  paired bars.
- **R15** **Who reacts the most**: per conversation, reactions they gave and you gave,
  each per 100 messages from the other side, for the top 10 by reactions. Group chats
  are one row each. A row needs at least 50 messages from the other side. Clicking a
  row opens that conversation's profile.
- **R16** **Most-reacted messages**: the 5 messages with the most reactions, each with
  its sender, date, reaction chips and a **Read →** button that opens that day in
  Messages (as Unusual days does). The text shows only in this card, which is on the
  page like the message list.

### Highlights

- **R17** Highlights, each only when it holds:
  - "Alex reacts to 1 in 4 of your messages": the top row of R15 at 20 or more per
    100.
  - "You react in a median of 45 seconds, Alex in 3 hours": both medians from R13, at
    least 4× apart.
  - "You've reacted to your own messages 37 times": at least 10.
  - "40% of Alex's reactions are instead of a reply": at least 30%, with at least 30
    reactions.

### Export

- **R18** The Export dialog (spec 026) gets `reactions.csv`: per emoji, the counts
  reacted by you and by them, and `reaction-times.csv`: the R13 bins per side. Neither
  has message text.

## Privacy

Reaction texts quote message text. The quote is used only to find the target, in the
page. It isn't stored anywhere new and isn't sent anywhere. The Most-reacted messages
card shows message text on the page, like the message list does. The CSV files have
counts only. Nothing here is sent to AI analysis.

## Design

**Parsers (workers).**
- `js/parser.js`: `analyzeText` keeps flagging reaction texts, and also sets
  `rec.rv = { r, q?, mk?, rm? }`: the emoji (R2), the quoted text, the media kind and
  whether it's a removal. `reactionOf(body)` does the parsing, after the same tidying
  `isReactionText` does.
- `js/instagram.js` and `js/telegram.js` pass each person's time to `addReaction`,
  which keeps `rx[].at`, a list of times parallel to `rx[].n` (`null` where unknown).
  `mergeReactions` keeps them.
- `js/imessage.js`: `readBody` reads `Tapbacks:` lines (`<Verb> by <name>`) into `rx`
  instead of skipping them.

**Dataset.** `addBatch` puts reaction texts in `D.reactionTexts` instead of only
counting them. They're deduped by the same key as now. `D.reactions` stays the count
for the loading screen. `reset()` clears the list.

**Matching.** New `js/reactions.js` (loaded after `js/analysis.js`):
- `matchReactionTexts(texts, msgsByThread)` returns, per reaction text, its target or
  `null` (R5–R7).
- `reactionEvents(D)` builds one flat list from the matched texts and every `rx`:
  `{ r, you (1 or 0), who, t (or null), target (or null), k, s, lag (or null), own }`.

`rederive` runs both after `o` is set (so "you" is right when the owner changes) and
before `D.version++`. Matched texts are also added to their target's `rx` for Messages,
marked so a reload doesn't add them twice.

**Aggregation.** `aggregateReactions(events, filter, gap)` in `js/reactions.js`:
- `perEmoji`: Map emoji → `[them, you]`
- `given` / `got`
- `lagHist`: per side, over `REACT_BINS`, and `lagMedian`
- `own` and `instead`: per side
- `byConvo`
- `top`: the most-reacted messages
- `unmatched`

`Select.reactions()` caches it on the range dependencies and `View.convoGap`.

**Charts** (`js/charts.js`): `emojiOption` gets the reaction parts. New
`reactionsOption`, `reactTimeOption`, `reactHowOption`. Who reacts the most and
Most-reacted messages are HTML tables like the leaderboard.

**Panel.** New `js/panels/reactions.js` registers `reactions` on `sec-mood`, topics
`data`, `selection` and `theme`. `index.html` gets the five cards (`#reactionsCard`,
`#reactTimeCard`, `#reactHowCard`, `#reactWhoCard`, `#reactTopCard`) and the
Reactions checkbox in Top emoji. Highlights go in a `reactionHighlights` function in
`js/insights.js`.

**Demo.** The demo's SMS reaction texts quote messages sent shortly before them in the
same thread, so they match. One reacts to a photo, one is a removal, and one quotes a
message that isn't there. Instagram reactions keep their timestamps. iMessage tapbacks
use the real `<Verb> by <name>` lines.

## Acceptance criteria

Each one is checked by at least one test that names it.

- **AC1** `reactionOf` gives ❤️ for `Loved “x”`, `❤️ to “x”` and `​❤️ to “x”`;
  😂 for `Laughed at “x”` and `Reacted 😂 to “x”`; 👍 for `Liked an image` with media
  kind `ph`; and ❤️ as a removal for `Removed a heart from “x”`. Each table row of R2 has
  a case.
- **AC2** An SMS backup with Alex's `see you soon 😊` at 12:00 and your
  `Loved “see you soon 😊”` at 12:03 has no reaction among the messages, one reaction
  event (❤️, you, lag 3 minutes, target Alex's message), and the chip ❤️ You under
  Alex's message in Messages.
- **AC3** A quote cut short with no closing quote (`😂 to “ that was hilari`) matches
  `that was hilarious 🤣🤣`. Curly and straight quotes and apostrophes match each other.
- **AC4** When the same text was sent twice, the reaction matches the later one before
  it. A message after the reaction is never the target. A quote whose only match is 25
  hours earlier stays unmatched and counts in the R12 note.
- **AC5** `Loved an image` matches the latest earlier message with a photo in that
  thread, not a later one, and not one in another thread.
- **AC6** `Loved “x”` then `Removed a heart from “x”` leaves no reaction. `Loved “x”`
  then `Laughed at “x”` from the same person leaves one 😂, timed from the first.
- **AC7** Your own `Loved “…”` on a message you sent is an own-message reaction. In a
  group MMS, a reaction from `+1555` to a message from `+1555` is one, and to a message
  from `+1666` isn't.
- **AC8** Instagram reactions with `timestamp` get a lag. Telegram `recent[].date`
  gives one. Google Chat reactions have none, but count in totals and emoji.
- **AC9** An iMessage message with `Tapbacks:` and `    Loved by Alex` gets a ❤️ from
  Alex in `rx`. `    Loved by Me` with Me as the owner is your reaction. An indented
  thread reply is still skipped.
- **AC10** Loading reactions changes no number that isn't about emoji. Message counts,
  Top words, mood, reply times and the KPIs for a history with reactions equal those
  for the same history with its reaction texts removed.
- **AC11** Top emoji, for a history where you typed ❤️ twice and reacted ❤️ three
  times, shows ❤️ with 2 typed and 3 reacted for you. Unticking Reactions shows 2.
- **AC11a** For that history, Emoji over time counts 5 ❤️ in the month, and the top
  emoji in Year in review and the summary image is ❤️. A conversation whose only ❤️ are
  reactions can have ❤️ as its signature emoji.
- **AC12** Time to react: reactions after 30 s, 10 min and 2 days land in `< 1 min`,
  `5–15 min` and `> 1 day`. The median shows with 10 timed reactions on a side, not
  with 9.
- **AC13** How you react: a reaction followed by nothing else from the reactor in that
  conversation is a reaction instead of a reply. One followed by a message from them
  before the gap isn't.
- **AC14** Who reacts the most ranks conversations by reactions, per 100 messages from
  the other side, and leaves out ones under 50 messages.
- **AC15** Most-reacted messages lists the message with 3 reactions above the one with
  2, and Read → opens its day in Messages.
- **AC16** Each R17 highlight fires at its threshold and not just below it.
- **AC17** With the demo loaded, the Mood & emoji tab shows the five reaction cards,
  each with data, and they're in Jump to….
- **AC18** `reactions.csv` and `reaction-times.csv` match the cards' numbers and
  contain no message text.

## Open questions

- iOS 18 emoji tapbacks in imessage-exporter: are they `😂 by Alex` lines? Check
  against its source while building R4.
- Do real Messenger exports carry `reactions[].timestamp`, and real Telegram exports
  `recent[].date`? The demo has neither. R3 uses them only when present.

Settled in review: reactions count in every emoji statistic (R11a), and a reaction text
matches only within the 24 hours before it (R5, R6), so a common reply like `ok` can't
match an old message.
