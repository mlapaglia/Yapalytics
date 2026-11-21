# 011 Bots in Google Chat conversations

Status: Implemented · PR: [#18](https://github.com/mlapaglia/Yapalytics/pull/18)

## Problem

Old Google Hangouts conversations came over to Google Chat with GIPHY still listed as a
member if anyone had used `/giphy` in them. In a Takeout export, a chat between you and
one other person can therefore have three members: you, them and GIPHY. The parser
counts every member, so it treats that chat as a group. Group chats can't be linked
(spec 005 R2), so the conversation can't be linked to the same person's SMS or other
apps, even though only two people ever talked in it.

The parser already skips messages whose sender has `user_type: "Bot"`. The bot only
matters when deciding who is in the conversation.

## Goals and non-goals

- A Google Chat conversation between you and one other person is a 1-on-1, whatever
  bots are also listed as members, so it can be linked.
- Not in scope: other apps' exports, members who left a conversation, and linking group
  chats (still ruled out by spec 005 R2).

## Requirements

- **R1** Members with `user_type: "Bot"` don't count when deciding whether a Google Chat
  conversation is a 1-on-1 or a group, and aren't listed among a group's members.
- **R2** A conversation with one other human member, in a `DM` folder or an unnamed
  `Space` folder, is a 1-on-1 keyed `gc:<their email>`, like any other Google Chat DM.
  It isn't marked as a group, so spec 005 lets you link it.
- **R3** A named space stays a group, even with only one other human in it.
- **R4** A conversation with two or more other humans stays a group.
- **R5** When the bot conversation and a newer DM are with the same person, they have the
  same key and show as one conversation.

## Privacy

Nothing changes in where data goes. The parser reads the same `group_info.json` member
list it already reads, in the browser. No message text is read, stored or sent for
this.

## Design

**Code.** In `js/googlechat.js`, `describeGroup(dir, info, owner)` drops members whose
`user_type` is `"Bot"` along with the owner before counting the others. A conversation
is a group only when the folder is a `Space` with a `name` in `group_info.json` or there
is more than one other human. Before this change every `Space` folder was a group. Now
only named ones are, because it isn't known which folder type Takeout uses for old
Hangouts chats. Group chats with several people still have more than one other human, so
they stay groups.

Bot messages are still skipped as before (`creator.user_type === 'Bot'`). When
`group_info.json` is missing, members are rebuilt from message senders, which can
include the bot, and R1 then drops it.

**Tests.** `tests/helpers/takeout.mjs` gains `takeoutChats(chats)`, which builds a
text-only Takeout zip with any number of conversations, and `GIPHY`, a bot member.

## Acceptance criteria

- **AC1** A `DM` folder with you, Alex and GIPHY gives one contact `gc:alex@example.com`
  that isn't a group and is named Alex. Its messages have that key and no sender name,
  and GIPHY's message is skipped.
- **AC2** An unnamed `Space` folder with you, Alex and GIPHY gives a 1-on-1
  `gc:alex@example.com`.
- **AC3** A `Space` folder named "Team" with you, Alex and GIPHY stays a group.
- **AC4** A folder with you, Alex, Sam and GIPHY stays a group, and its members are
  `Alex~Sam`, without GIPHY.
- **AC5** A GIPHY conversation and a newer `DM` with Alex give one contact,
  `gc:alex@example.com`, with the messages from both.

## Open questions

None. Settled while building:

- **How GIPHY is marked.** In a real Takeout export with an old Hangouts chat, GIPHY is
  listed with `user_type: "Bot"`, so R1's check is enough and nothing needs matching by
  name. With the fix, that chat loads as a 1-on-1 and links to the person's SMS.
