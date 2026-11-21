# 005 Linked people across apps

Status: Draft · PR:

## Problem

Every export makes its own conversations. Alex over SMS and Alex on Instagram are two
entries in the conversation picker, two rows on the leaderboard, two profiles, and two
separate sets of insights ("your most-messaged conversation", streaks, reply times). If
you talk to someone on several apps, no view shows how much you actually talk to them.

## Goals and non-goals

- Let the user tie one person's 1-on-1 conversations from different apps (or two threads
  in the same app) together, so the dashboard treats them as one conversation.
- Suggest exact matches (same name, phone number or email) without applying them.
- Let the user link any two 1-on-1 conversations by hand, and undo any link.
- Remember links in this browser.
- Not in scope: fuzzy matching ("Alex R." and "Alex Rivera"), linking group chats,
  attributing a group member's messages to a person, syncing links between devices.

## Requirements

- **R1** Linking is optional. With no links the app behaves exactly as before.
- **R2** Only 1-on-1 conversations can be linked. Group chats never appear in
  suggestions or pickers and are never changed by a link.
- **R3** The app suggests links between 1-on-1 conversations that share an exact
  identity. Nothing is linked until the user accepts a suggestion.
  - Same name: compared ignoring case, accents and extra spaces. A name counts only if
    no app has two conversations with it (two Instagram "Chris" threads are ambiguous,
    so none of the "Chris" threads are suggested). Placeholder names ("Instagram User",
    "Deleted Account", "Me", "Unknown") and your own name on that app never match.
  - Same phone number: the last 10 digits (or every digit, if there are 7 to 9) of any
    name or address that looks like a number, so `+1 (555) 123-4567` and
    `5551234567` match.
  - Same email: case-insensitive.
- **R4** A linked person replaces its conversations everywhere conversations are
  listed or counted: the picker, the leaderboard, highlights, profiles, sessions, reply
  times, streaks, AI analysis. It shows as `🔗 <name>`.
- **R5** The person's name defaults to the first real name (not a number or email) by
  app: SMS, iMessage, WhatsApp, Google Chat, Telegram, then Instagram, so a
  contact-book name wins over an Instagram handle. Ties go to the conversation with
  more messages. The user can pick another of its conversations' names.
- **R6** The app filter still applies: with Instagram selected, a person is listed if
  any of its conversations is on Instagram, with only its Instagram message count, and
  shows only its Instagram messages.
- **R7** In the message list, a linked person's messages say which app they came from:
  "From 🔗 Alex Rivera · Instagram" under All conversations, and just "Instagram" when
  the person is selected.
- ~~**R8** The People filter finds a person by any of its conversations' names or
  numbers.~~ The People filter was removed in spec 012; its Conversation picker finds a
  person this way (spec 012 R1).
- **R9** Links, chosen names and dismissed suggestions are saved in this browser
  (`localStorage` key `ms-people`) and apply again when the same conversations are
  loaded. A link applies only when at least two of its conversations are loaded.
  "Forget all links" clears all of it.
- **R10** A change to the links in one tab applies in the app's other open tabs, so a
  tab that's still open can't write back links that were forgotten in another.
- **R11** An AI analysis of a linked person belongs to the conversations it read. Adding
  or removing one clears the report, and a result that arrives after that isn't shown.

## Privacy

No message text is read or sent. Matching uses conversation names, phone numbers and
emails, and runs in the page.

`localStorage` (`ms-people`) keeps, in this browser only: the linked conversations'
keys (contact names, the last 8 digits of SMS numbers, Instagram thread folder ids,
Telegram chat ids, Google Chat DM ids, iMessage and WhatsApp conversation names),
each person's chosen name, and the dismissed suggestions. It stays until the user
clicks "Forget all links" or clears the site's data. Nothing leaves the browser.

A saved link is tied to conversation keys, the same keys the app uses to recognise a
conversation when files are loaded again. An unrelated conversation that gets the same
key in a later export joins the link: a WhatsApp chat with the same title, or an SMS
number with the same last 8 digits. The app already treats those as one conversation
when they're loaded together, so links follow that rule rather than adding a stricter
one.

## Design

**Data.** A linked message keeps its conversation key in `m.tk` and gets a person key
in `m.k`: `p:` + the smallest of its conversation keys, which stays the same across
reloads. Every aggregate already groups by `m.k`, so analysis.js and insights.js don't
change. Unlinked messages have no `tk`. SMS calls get the same treatment (`c.k`/`c.tk`).
`p:` keys don't start with `g:`, so group checks are unaffected.

`S.contacts` gains an entry per applied person:
`{ key, name, person: true, threads, sources, group: false, addr: '', members, lastT }`.
The conversations' own entries stay, for labels in the People dialog.

**State.** `S.people` (person key → `{ key, name, threads }`, including people whose
conversations aren't all loaded), `S.personOf` (conversation key → person key, applied
people only) and `S.dismissed` (signatures: sorted conversation keys joined by a
newline).

`applyLinks()` rebuilds `S.personOf`, rewrites the keys on messages and calls, rebuilds
the person contacts, recomputes first-seen times, labels and search text, and moves the
selected conversation to its person (or to "All" if its person is gone). It runs after
loading files and after every change in the People dialog.

**Code.** `js/people.js` holds the pure parts: `normName`, `normPhone`,
`identityTokens(contact, ownNames)`, `suggestLinks(threads, personOf, dismissed)` and
`defaultPersonName(threads)`. app.js holds state, storage, `applyLinks` and the dialog.

**UI.** A `🔗 Link people` button next to the conversation picker. It shows the number of
suggestions (`🔗 Link people (2)`) and is hidden when fewer than two 1-on-1 conversations are
loaded. It opens a dialog with:

1. Suggestions: each shows its conversations (app mark, name, message count), why
   ("Same name", "Same phone number", "Same email"), and **Link** / **Dismiss**.
   Linking a suggestion that includes a conversation already in a person adds the
   others to that person.
2. Linked people: a name picker, the conversations with ✕ to unlink each, and
   **Unlink all**. A person left with one conversation is removed.
3. Link by hand: two pickers of 1-on-1 conversations and **Link**, disabled when both
   are the same conversation or already the same person.
4. "Links are saved in this browser only." and **Forget all links**.

A profile of a person says "1-on-1 on SMS and Instagram" and lists its conversations.
Every 1-on-1 profile has a button to open the People dialog with that conversation
picked.

## Acceptance criteria

- **AC1** Given SMS and Instagram exports that both have a 1-on-1 with "Alex Rivera",
  the People button shows 1 suggestion and the picker still lists both conversations.
- **AC2** Accepting it, the picker shows one `🔗 Alex Rivera` with the combined count,
  the two separate entries are gone, and the leaderboard has one row for it.
- **AC3** An SMS from `+1 (555) 123-4567` and a WhatsApp chat titled `+1 555 123 4567`
  are suggested with "Same phone number".
- **AC4** Two Instagram threads named "Chris" and an SMS "Chris" produce no suggestion.
- **AC5** Group chats never appear in suggestions or the manual pickers.
- **AC6** Linking two conversations by hand merges them, and the person's profile says
  "1-on-1 on SMS and Instagram".
- **AC7** Unlinking a conversation shows it on its own again; unlinking down to one
  conversation removes the person.
- **AC8** Links survive a page reload and loading the same files again. "Forget all
  links" removes them and `ms-people`.
- **AC9** A dismissed suggestion doesn't come back after a reload.
- **AC10** With the Instagram filter, a linked person is listed with only its Instagram
  message count, and its message list shows only Instagram messages.
- **AC11** In the message list, a linked person's messages name the app they came from.
- **AC12** With no links, messages and leaderboard rows are the same as before.
- ~~**AC13** The People filter finds a person by any of its conversations' names.~~
  Moved to spec 012 AC4.
- **AC14** The person's name defaults to the contact-book name over an Instagram handle,
  and can be changed to another of its conversations' names.
- **AC15** Forgetting all links in one tab removes them from another open tab, and a
  later change in that tab doesn't bring them back.
- **AC16** Adding a conversation to an analyzed person clears its AI report, even though
  the person's key stays the same.

## Open questions

- None.
