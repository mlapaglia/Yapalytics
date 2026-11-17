# 004 Shared posts and reactions on messages

Status: Draft (built, awaiting review) · PR:

## Problem

A post or reel shared in an Instagram DM shows in the Messages tab as `📎 File`. The
export has more than that. The message's `share` object has the post's `link`, the
creator's caption (`share_text`) and the creator's username (`original_content_owner`).
The parser keeps none of it, so you can't tell what was shared or open it. Shares also
count as "Other files" and toward the Attachments total, and the gallery says they
"can't be shown because their files weren't loaded". That's wrong: they aren't files.

Reactions on a message (😂 on a reel, ❤️ on a photo) are in the Instagram, Telegram
and Google Chat exports, each message listing its own. The parsers throw them away, so
the message list never shows them. (Reactions sent as texts, like "Loved “see you”" in
SMS, are a different thing. They're already counted and left out of the messages.)

## Goals and non-goals

- Show what was shared (creator and caption) and link to the post.
- Show a thumbnail of the post for users who choose to load previews from Instagram.
- Show the reactions on each message, and who reacted.
- Not in scope: a "shared posts" chart or count, previews for other apps' links,
  remembering which posts loaded, and reaction statistics (most-used reaction, who
  reacts most). WhatsApp, iMessage and SMS exports have no reactions on messages to show.

## Requirements

- **R1** A message that shares a post or reel shows a share card instead of `📎 File`.
  The card shows the creator (`@owner`), the caption (clamped to 4 lines; clicking the
  caption expands it) and an "Open on Instagram ↗" link. The link opens in a new tab
  (`target="_blank"`, `rel="noopener noreferrer"`). A share with no Instagram link says
  "Open link ↗" instead.
- **R2** Only `http:` and `https:` links become links. A share with any other link
  still shows its card, but the card has no link.
- **R3** The Messages toolbar has an "Instagram previews" checkbox, off by default and
  saved in this browser (`localStorage` key `ms-ig-previews`). It appears only when a
  loaded message shares an Instagram post (`instagram.com/p|reel|reels|tv/<code>`).
  When it's on, each such card shows Instagram's embed of the post, loaded lazily,
  clipped to the card. A transparent link covers the embed, so clicking the preview
  opens the post in a new tab.
- **R4** The caption isn't the sender's words. It doesn't count toward words, emoji,
  mood or swearing, and the message's text stays empty. In AI analysis the message is
  `[shared post]`, without the caption (it used to be `[file]`). The message
  browser's search matches the caption and the creator.
- **R5** A share isn't a file. It doesn't count toward "Other files", the Attachments
  KPI or the gallery's "can't be shown" note. It still counts as a message.
- **R6** A message with reactions shows them under its content as a row of chips, one
  per emoji, with a count when more than one person used it. Hovering a chip names who
  reacted. Your own reaction is named "You".
- **R7** Reactions come from Instagram (`reactions[]`: `reaction`, `actor`), Telegram
  (`reactions[]` of type `emoji`: `emoji`, `count`, and `recent[].from`, which may
  list fewer people than `count`; that's shown as "and N more") and Google Chat
  (`reactions[]`: `emoji.unicode`, or `:name:` for a custom emoji, and `reactor_emails`,
  named from the conversation's members). Telegram custom-emoji and paid reactions have
  no emoji to show and are skipped.
- **R8** Reactions on a message never count as messages and don't change any statistic.
  They aren't sent to AI analysis.
- **R9** You are named "You" by the owner picked for the source (Instagram, Telegram),
  so picking a different owner relabels the reactions. Google Chat knows your email
  from the export.

## Privacy

With "Instagram previews" off (the default), nothing leaves the browser. The card is
built from the export alone.

With it on, the browser loads `https://www.instagram.com/<p|reel|tv>/<code>/embed/` for
each share card in the message list (lazily, as cards near the screen). Instagram learns
the post's shortcode, the user's IP address, and any instagram.com cookies the browser
sends. Nothing else goes to Instagram: no message text, caption, sender or the link's
`?id=` query. The URL is rebuilt from the shortcode alone. The checkbox's tooltip and the
landing page's privacy line say this.

Clicking a card's link opens the post on Instagram in a new tab. The user does that
explicitly.

Reactions are read from the export and shown on the page. They go nowhere else.

## Design

**Data.** The Instagram worker sets `rec.sh = { u, x, w }` on a message whose `share`
has a link, caption or owner. `u` is the link, or `''` if it isn't `http(s)`. `x` is the
caption and `w` is the creator. The text goes through the same mojibake fix as the rest
of the export. The share no longer adds to `rec.ot`. A message with only a share (its
text is the "… sent an attachment." placeholder) is kept because it has `sh`. Its `b`
stays `''`.

Every parser that sees reactions sets `rec.rx = [{ r, c, n }]`, one entry per emoji
in the order first seen. `r` is the emoji, `c` how many reacted with it, and `n` the
names known, which can be fewer than `c`. `messageLib().addReaction(rec, emoji, count,
names)` builds it, so all workers merge the same way. Google Chat writes "You" for the
owner's email. For the other sources the page compares names with
`S.owners[source].name` when it draws the chips.

**Code.** `media.js` gets `instagramEmbedUrl(link)` (the embed URL, or `null`) and
`shareCard(sh, previews)`, which builds the card with DOM calls only, never
`innerHTML`. `renderBrowser` appends the card. `S.igPreviews` holds the setting.
`#igPreviewsChk` sits beside "Mood scores" and is hidden unless a message in `S.msgs`
has an embeddable link. `app.js` gets `reactionsRow(m)`, which `renderBrowser`
appends after the content (DOM calls only).

**UI.** The card sits in the bubble under any text: a bordered box with `@creator`,
the clamped caption and the link. With previews on, a 400px-tall frame sits above the
text. The embed is 326px wide (the narrowest Instagram renders), clipped to the bubble's
width, and sandboxed (`allow-scripts allow-same-origin`) with `referrerpolicy="no-referrer"`.
Reaction chips are small rounded pills tinted from the bubble's text color, so they
read in sent and received bubbles and in both themes.

## Acceptance criteria

- **AC1** Given an export with a shared reel, when its chat is open in Messages, then
  the bubble shows `@creator`, the caption and an "Open on Instagram ↗" link to the
  reel with `target="_blank"`, and doesn't show `📎 File`. The parser gives the record
  `sh` with the decoded link, caption and creator, `b === ''` and `ot === 0`.
- **AC2** Given a share whose link is `javascript:…`, then `sh.u === ''` and its card
  has no link.
- **AC3** `instagramEmbedUrl` maps `/reel/`, `/reels/`, `/p/` and `/tv/` links (with or
  without `www.`, a query or a trailing slash) to `https://www.instagram.com/<p|reel|tv>/<code>/embed/`,
  and returns `null` for other links.
- **AC4** Given previews are off, when the chat with a share is open, then the page has
  no iframe and makes no request to instagram.com.
- **AC5** The caption doesn't count toward the message's words, emoji or mood
  (`wc === 0`, `e === null`, no `v`).
- **AC6** Given an export with a shared reel, when "Instagram previews" is checked,
  then the card shows an iframe whose src is the reel's `/embed/` URL. After a reload
  and loading the export again, the checkbox is still checked.
- **AC7** Given the chat with a share is open, when searching for a word in the caption,
  then the share message is listed.
- **AC8** Shares don't count as files: the Attachments KPI and "Other files" leave them
  out, and so does the gallery's "can't be shown" note.
- **AC9** `addReaction` merges reactions by emoji, adds up counts, keeps each name once,
  and ignores an empty emoji or a count of 0.
- **AC10** Given an Instagram message with ❤️ from Alex, ❤️ from you and 😮 from Alex,
  then `rx` is `[{ r: '❤️', c: 2, n: [Alex, you] }, { r: '😮', c: 1, n: [Alex] }]`.
- **AC11** Given a Telegram message with 👍 ×3 whose `recent` names one person, plus a
  custom-emoji reaction, then `rx` is `[{ r: '👍', c: 3, n: [that person] }]`.
- **AC12** Given a Google Chat message with reactions from you and from Alex by email,
  then the names are "You" and Alex's name, and a custom emoji shows as `:name:`.
- **AC13** Given the Instagram chat is open in Messages, then the café message shows a
  ❤️ chip with "2" whose tooltip is "❤️ Alex Rivera, You" and a 😮 chip, and the
  shared reel shows 😂 from "You". After picking Alex Rivera as the owner, the ❤️
  tooltip names "You, Jamie Park" instead. The message count doesn't change.

## Open questions

- Instagram's embed may not render some posts (private accounts, removed posts). The
  card's text and link still work, and we can't detect the failure across origins.
