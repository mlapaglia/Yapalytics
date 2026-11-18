# 009 Facebook Messenger import

Status: Approved: built · PR: [#16](https://github.com/mlapaglia/Yapalytics/pull/16)

## Problem

Yapalytics reads six apps, but not Facebook Messenger, which for many people holds years
of their conversations. Someone who imports Instagram can't add the Messenger side of
the same friendships, so Across apps (spec 007) and linked people (spec 005) leave out
one of the apps they use most.

Messenger has two exports, and a full history needs both:

- **Facebook's "Download your information" (DYI)**, in JSON. Its messages use the same
  layout as Instagram's export, which the app already reads (`js/instagram.js`).
- **The encrypted chats download.** Since Messenger made personal chats end-to-end
  encrypted (rolled out from late 2023), DYI leaves those chats out. They come from a
  separate download in Messenger: **Settings → Privacy & safety → End-to-end encrypted
  chats → Message storage → Download secure storage data**. It is also JSON, in a
  different layout. It only exists if secure storage was turned on.

## Goals and non-goals

- Read both Messenger exports as one new app, **Messenger**, alongside the other six.
- Reuse the Instagram parser for DYI instead of writing a second copy of it.
- Not in scope: the HTML formats of either export; message requests and filtered
  (spam) threads; Facebook posts, comments and Marketplace; chats only on a phone that
  never turned on secure storage. Group chats in the encrypted chats download wait for a
  real sample (see open questions). Until then, encrypted threads are all read as
  1-on-1s.

## Requirements

- **R1** A Facebook DYI `.zip`, or every part of a split one chosen together, loads as
  Messenger: source `6`, conversation keys `fb:<thread id>` and `g:fb:<thread id>` for
  groups (more than 2 participants). Threads in `inbox/`, `archived_threads/` and
  `e2ee_cutover/` are kept. `message_requests/` and `filtered_threads/` are skipped and
  counted as skipped chats.
- **R2** The encrypted chats download (`.zip`, or its thread `.json` files) loads as
  Messenger too. It has no thread ids, so its conversations are keyed by `threadName`:
  `fb:e2ee:<threadName>`. Its layout, confirmed from real threads:

  ```json
  { "participants": ["You", "Alex Rivera"], "threadName": "Alex Rivera_6",
    "messages": [
      { "isUnsent": false, "media": [], "senderName": "You", "text": "…",
        "reactions": [{ "actor": "Alex Rivera", "reaction": "😆" }],
        "timestamp": 1746193477720, "type": "text" },
      { "isUnsent": false, "media": [{ "uri": "./media/482a04c4-….jpeg" }],
        "reactions": [], "senderName": "You", "text": "",
        "timestamp": 1734391202014, "type": "media" }] }
  ```

  Participants are plain names, `timestamp` is in milliseconds, and each thread is its
  own file named `<threadName>.json`. A conversation is named after the other
  participant ("Alex Rivera"), never the `threadName`, so the `_6` suffix isn't shown.
  The same chat keeps its `threadName` from one download to the next, so loading two
  downloads doesn't double it: its messages are deduplicated like any overlapping
  export. A message counts when it has text or media and
  isn't unsent, whatever its `type`. Each `media` item is one attachment, its kind taken
  from the file extension (photo, GIF, video, audio, or other). Its `uri` is relative to
  the thread file's folder. When the zip has the file there, the attachment opens and
  its size counts. Otherwise it's counted but can't be opened.
- **R3** As for Instagram: call notices, group events (named the group, added, removed,
  left, changed the photo / theme / emoji / nicknames), "sent an attachment"
  placeholders with nothing behind them, and unsent messages are not counted as
  messages. A shared link or post behind a placeholder is kept, in `sh` (spec 004).
  "Reacted 😂 to your message" and "Liked a message" are reactions (`T_REACTION`). The
  `reactions` on a message go in its `rx`, with who reacted.
- **R4** Meta's escaped UTF-8 ("Ã©" for "é") is decoded in every DYI string. The
  encrypted chats download is already proper UTF-8 and is not decoded again, since that
  could garble real accented text.
- **R5** Which sender is you: a DYI zip that includes
  `profile_information.json` gives your name (`profile_v2.name.full_name`) as the first
  guess. The encrypted chats download has no profile, but a chat's `threadName` is the
  other person's name, so the guess is the participant the thread isn't named after (the
  rule the app already uses for 1-on-1s named after the other person), and failing that
  the one participant in every thread. Either way, the filter bar shows **You on
  Messenger** to set or correct it, as it does for Instagram.
- **R6** A Facebook export is never read as Instagram, and an Instagram export never as
  Messenger, in the same pick or apart. A zip is Messenger when its paths start with
  `your_facebook_activity/`, it has Facebook's `profile_information.json`, its media
  URIs point inside `your_facebook_activity/`, or it is the encrypted chats download.
  The Instagram signs are the ones `detectKind` uses today.
- **R7** A single `message_N.json` file can't be told apart from Instagram's by its name.
  It is Messenger when its media URIs or `thread_path` point inside
  `your_facebook_activity/`, or its participants include Facebook's placeholder
  "Facebook user". Otherwise it is read as Instagram, as today. Because this is a
  guess, R13 lets the user change it.
- **R8** Either export in HTML format gives an error that says so and how to export
  again as JSON, as Instagram's does.
- **R9** Messenger appears wherever apps are listed: the source switch (with its logo),
  Platform mix, the Across apps tab, profiles ("1-on-1 on Messenger"), people chips and
  pickers, the Files dialog, the setup guide on the landing page, and the README. Its
  conversation mark is ⚡.
- **R10** Linked people (spec 005): Messenger names count as real names (except "Facebook
  user"). A person's default name comes from Messenger after Instagram.
- **R11** All parts of a Messenger export are read together, like Instagram's (spec 006
  R16), so photos in one part still open from messages in another.
- **R12** A chat's older history in DYI and its newer history in the encrypted download
  are two conversations, not merged. Linking (spec 005) joins them: they're suggested as
  one person by name, together with that person's conversations in other apps. Spec 005
  skips a name when one app has two conversations with it, taking them for two people.
  For that rule a DYI Messenger conversation and an encrypted one count as different
  exports, so one DYI and one encrypted conversation with the same name are still
  suggested. Two DYI conversations, or two encrypted ones, with the same name are still
  skipped.
- **R13** In the Files dialog, each single `message_N.json` file's row has an app picker,
  **Instagram** or **Messenger**, set to the R7 guess. Changing it is a pending change
  like checking or unchecking a file (spec 006 R6): **Apply** turns on, and applying
  reads the loaded files again with that file as the chosen app. The choice stays for
  as long as the file is in the list.
- **R14** The demo includes Messenger: a DYI export and an encrypted chats download, with
  at least one person who is also in the demo's Instagram export and whose chat moves
  from DYI to encrypted, so the demo shows R12's link suggestion and Across apps shows a
  switch between Instagram and Messenger.

## Privacy

Messenger exports are read like every other export: in a Web Worker in the browser,
from files the user chose. Nothing is uploaded, nothing new is stored, and no new network
requests are made. The Messenger logo is inline SVG in `index.html`.

## Design

**Detection** (`detectKind`, `js/app.js`). New kind `'messenger'`. For a zip, the R6 signs
are checked before the Instagram ones. Today any other `.json` file is taken for
Telegram's `result.json` by its extension alone. Now a `.json` file's start is read: one
with `"threadName"` and `"participants"` is an encrypted Messenger thread, anything else
stays Telegram. A zip holding such files is the encrypted chats download. Error texts
that list the readable exports gain "Facebook Messenger".

**Parser** (`js/instagram.js`). `instagramParserWorker` becomes `metaParserWorker`. The
worker message carries the app: `{ files, app: 'instagram' | 'messenger' }`. Per app:
the source number (5 or 6), key prefix (`ig:` / `fb:`), placeholder name ("Instagram
User" / "Facebook user"), kept folders, how to find your name, and the error texts.
Everything else (thread reading, notices, reactions, shares, attachments, escaped UTF-8)
is shared. A second reader handles encrypted chat threads (`senderName`, `text`,
`timestamp`, `media`, `reactions`, `isUnsent`) and produces the same records, without the
UTF-8 fix-up.
`parseInstagramFiles` keeps its signature; `parseMessengerFiles(files, callbacks)` is new.
Both still go through `runParserWorker`, so the worker stays self-contained.

**Linking** (`suggestLinks`, `js/people.js`). The "two people with this name on one app"
check groups conversations by app and, for Messenger, by export: keys starting with
`fb:e2ee:` count apart from other `fb:` keys (R12). Nothing else in linking changes.

**Files dialog** (`js/app.js`, `js/files.js`). A file entry's `kind` can be changed for
`message_N.json` rows (R13): the row shows a small `<select>` in place of the app logo.
`planFileChanges` treats a changed `kind` on a loaded file as dropping it and adding it
again, so it asks for a rebuild. The guess stays in the entry; only the user changes it.

**Demo** (`js/demo.js`). `buildDemoMessenger` builds both exports from the demo's
people, like `buildDemoTelegram`. The demo tests' expected counts change with it.

**Records.** No new fields: `{ t, o, m, s: 6, k, sn, ph, gf, vd, au, ot, mb, att?, sh?, rx?, f? }`,
with `o` set later from `S.owners[6]`, as for Instagram.

**Source tables.** `SOURCES[6] = 'Messenger'`, `SOURCE_MARK[6] = '⚡'`, `hasOwner(6)`,
`S.owners[6]`, `FILE_LOGO.messenger`, `READ_TOGETHER` gains `'messenger'`,
`PERSON_NAME_ORDER` gains `6` at the end. On the Across apps tab, the "shared a post"
switch trigger is listed when Instagram or Messenger is loaded, not only Instagram. Comments that list sources and key prefixes
(`js/analysis.js`) are updated.

**UI.** A `logo-messenger` symbol in the SVG sprite. A `data-source="6"` button in the
source switch, after Instagram. A Messenger card in the setup guide with both export paths,
noting that encrypted chats need the second download. The tagline and meta description
name Messenger.

**Tests.** `tests/helpers/messenger.mjs` builds DYI zips (whole, split, HTML), encrypted
chats downloads and single thread files, in the way `tests/helpers/instagram.mjs` does.
Unit tests in `tests/unit/messenger.test.mjs`. Browser tests in `tests/e2e/messenger.spec.mjs`.
The existing Instagram tests must pass unchanged, apart from naming the worker they run
(`metaParserWorker`). The landing page and demo tests gain Messenger.

## Acceptance criteria

- **AC1** A DYI zip with a 1-on-1 in `inbox/`, a group in `archived_threads/`, a thread
  in `e2ee_cutover/`, one in `message_requests/` and one in `filtered_threads/` loads 3
  Messenger conversations with keys `fb:…`, `g:fb:…`, `fb:…`, and 2 skipped chats.
- **AC2** A split DYI export with messages in part 1 and their photos in part 2, chosen
  together, shows the photos on those messages and opens them.
- **AC3** An encrypted thread file like the one in R2, with 7 messages and one 😆
  reaction, loads as one Messenger conversation keyed `fb:e2ee:<threadName>`, with 7
  messages, both senders, and the reaction in that message's `rx` with who reacted.
  An unsent message (`isUnsent: true`) in it isn't counted.
- **AC4** Call notices, group events, unsent messages and bare "sent an attachment"
  placeholders aren't counted. A placeholder with a shared link keeps the link in `sh`.
  "Reacted 😂 to your message" counts as a reaction, not a message.
- **AC5** A DYI message whose text is escaped UTF-8 ("cafÃ©") shows as "café". An
  encrypted thread message "café 😃" shows unchanged.
- **AC6** With `profile_information.json` in the zip, your messages are marked sent
  with no picker change. Choosing another name under **You on Messenger** flips sent and
  received.
- **AC7** An Instagram export and a Facebook export chosen together load as two apps:
  Instagram conversations keep `ig:` keys and source 5, Messenger ones `fb:` keys and
  source 6.
- **AC8** A DYI zip in HTML format, or an HTML encrypted chats download, shows an error
  that tells the user to export again as JSON.
- **AC9** With Messenger and one other app loaded, the source switch shows a Messenger
  button. Clicking it shows only Messenger conversations, and Platform mix has a
  Messenger series.
- **AC10** A single `message_1.json` whose photo URIs start with
  `your_facebook_activity/` loads as Messenger. One with no Facebook signs loads as
  Instagram.
- **AC11** The same friend on Instagram and Messenger, with the same name, is offered as
  a link (spec 005), and the linked profile lists both apps.
- **AC12** Two encrypted thread files that share one participant mark that participant's
  messages sent. So does a single thread file, from the name it's not named after.
- **AC13** A Telegram `result.json` still loads as Telegram when chosen next to
  encrypted Messenger thread files.
- **AC14** In an encrypted chats zip, a `type: "media"` message with an empty text and
  `media: [{ uri: "./media/<id>.jpeg" }]`, whose file sits in the thread's `media/`
  folder, counts as one photo and opens in the lightbox. The same message read from the
  thread `.json` alone counts as one photo that can't be opened.
- **AC15** With Instagram "Alex Rivera", a DYI Messenger "Alex Rivera" and an encrypted
  Messenger "Alex Rivera" loaded, one link is suggested with all three conversations.
  With two DYI Messenger conversations named "Alex Rivera", no link is suggested by name.
- **AC16** In the Files dialog, a `message_1.json` guessed as Instagram shows the picker
  set to **Instagram**. Choosing **Messenger** turns on **Apply**. Applying moves its
  conversation to Messenger (source 6, `fb:` key) and leaves the other files as they were.
  Choosing **Instagram** again and applying moves it back.
- **AC17** With the demo loaded, the source switch has a Messenger button, the demo's
  shared person has a link suggestion covering Instagram and both Messenger exports, and
  Across apps lists a switch between Instagram and Messenger.
- **AC18** An encrypted thread file named `Alex Rivera_6.json` is listed as "Alex Rivera".
  Loading it twice (or two downloads that both have it) counts its messages once.

## Open questions

- **Group chats in the encrypted chats download.** No sample yet, so their layout is
  unknown. They're left for a later change, once someone has one. Until then the reader
  treats every encrypted thread as a 1-on-1. A group thread with more than two
  participants is still read and counted, just not marked as a group.
- **Other `type` values.** Only `"text"` and `"media"` have been seen. Calls, shared
  links and system notices may have their own types or texts that R3 should filter out.
  For now, anything with text or media counts.

Settled in review: the two Messenger exports stay separate and linking joins them (R12);
single `message_N.json` files are guessed and can be switched in the Files dialog (R7,
R13); the demo includes Messenger (R14); `threadName` stays the same across downloads
(R2).
