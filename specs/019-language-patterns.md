# 019 Language patterns

Status: Draft · Author: · PR:

## Problem

The Words tab counts single words: the most used, the new ones each month, and (for one
conversation) the words that set it apart. It can't show how people talk. Nobody can see
their friend's catchphrase ("no way dude"), the joke only two people share, who keeps
fixing their typos with `*word`, who says thanks and sorry the most, or that a
conversation is half in Spanish.

## Goals and non-goals

- Show each person's signature phrases: 2- and 3-word phrases they use far more than
  everyone else.
- Show inside jokes: words and phrases both sides of one conversation keep using, over
  time, that hardly come up anywhere else.
- Count corrections (`*word` sent right after a typo), and thanks and sorry, per side
  over time.
- Tell which language messages are in, per side and per conversation, entirely in the
  browser.
- Build on what's there: `tokensOf`, `aggregateContent`, `buildDocFreq`,
  `distinctiveWords` and the Word tracker. "What you talk about" keeps showing what it
  shows now.
- Not in scope: AI or any model download, languages other than those listed in R14,
  grammar or spelling checks, translating anything, highlights for these findings.

## Requirements

**Signature phrases**

- **R1** A phrase is 2 or 3 words in a row from one message (`tokensOf`, links taken
  out), with at least one word that isn't a filler word (`STOPWORDS`). Phrases don't
  cross messages.
- **R2** A person's signature phrases are the phrases they use at least 5 times, on at
  least 3 different days, ranked by how much more they use them than everyone else in
  the selection: the weighted log-odds ratio with an informative Dirichlet prior
  (Monroe, Colaresi and Quinn, "Fightin' Words", 2008), with everyone's counts scaled by
  0.1 as the prior. Only phrases with a z-score of 2 or more count, and that the person
  uses, per phrase they write, at least twice as often as everyone else. Each person
  shows their top 8.
  - *Why the 0.1:* with everyone's counts at full weight, a phrase only one side of a
    1-on-1 uses, 10 times, scores z = 1.8 and never shows.
  - *Why twice as often:* on the demo, where everyone picks lines from one shared list,
    z alone let through "heading out" and "happy birthday" for Alex. They're just more
    of a common line, by chance. The rule removes both and keeps everything else.
- **R3** When a 3-word phrase and a 2-word phrase inside it both qualify, only the 3-word
  one is shown if it has at least 70% of the 2-word one's uses; otherwise only the 2-word
  one.
- **R3a** A phrase that overlaps a better-ranked one ("pushed the fix", "fix can you"),
  with uses within 70% of each other either way, isn't shown: they're pieces of one
  sentence. Without this, one line used 15 times filled a column with six phrases.
- **R4** Who gets a column depends on the selection:
  - **All conversations:** You, and the 5 people with the most messages to you in
    1-on-1 conversations (a linked person counts once). Group messages count toward
    everyone's background, not toward a person.
  - **One 1-on-1 conversation:** You and them.
  - **One group conversation:** You and the 5 members who sent the most.
- **R5** Each phrase is a chip with its count. Clicking it tracks the phrase in the Word
  tracker, as vocabulary chips do now.

**Inside jokes**

- **R6** An inside joke of one conversation is a word or a 2- or 3-word phrase (R1)
  that, in the selection:
  - is used at least 6 times, at least twice by each side (in a group: by at least 2
    different people),
  - on at least 3 different days spread over at least 14 days, and
  - hardly appears elsewhere: a single word is in at most 2 conversations
    (`buildDocFreq`); a phrase has at least one word of 3+ letters that is in at most 2
    conversations.
- **R7** Inside jokes rank by uses × log2(days used), with R3 and R3a applied to them
  too (so "moose" and "peak moose energy" don't both show unless their counts differ).
  For one conversation, the card lists the top 10: the joke, how many times it was used,
  who used it first and when, and when it was last used.
- **R8** For All conversations, the card lists the top inside joke of each of the 8
  conversations with the most messages in the selection (200 or more). Conversations
  with no inside joke are left out. Names link to the profile.
- **R9** Clicking a joke tracks it in the Word tracker. For All conversations it also
  picks that conversation, so the tracker counts it there.

**Corrections**

- **R10** A correction is a message that is only one to three words with `*` in front
  (`*there`, `* their`) or behind (`there*`), sent within 5 minutes of the same person's
  previous message in the same conversation (their message doesn't count as fixing
  yours). That earlier message must have a word
  within edit distance max(2, ⌊length / 3⌋) of the correction's first word, without
  being the same word. Messages wrapped in stars (`*sigh*`) are actions, not
  corrections.
- **R11** The Corrections card shows corrections per 1,000 messages per month, sent and
  received, the totals for each side, and each side's 5 most corrected words.

**Thanks and sorry**

- **R12** A thanks message has any of: thanks, thank you, thank u, thx, thnx, ty, tysm,
  tyvm, much appreciated, appreciate it. A sorry message has any of: sorry, sry, soz, my
  bad, apologies, apologize, apologise. These are whole words in any case, with curly
  apostrophes treated as straight. Reactions don't count.
- **R13** The "Thanks & sorry" card shows the share of messages with each per month,
  sent and received, and a note with each side's overall share ("You say thanks in
  4.2% of your messages; they do in 2.1%").

**Languages**

- **R14** Each message with text gets one language, or none:
  - **Script first.** Letters are counted by Unicode script. When one script has at
    least 60% of 3 or more letters: Greek → Greek, Hebrew → Hebrew, Thai → Thai, Hangul
    → Korean, Hiragana or Katakana (with or without Han) → Japanese, Han alone → Chinese,
    Devanagari → Hindi, Arabic → Arabic, Cyrillic → Ukrainian when it has і, ї, є or ґ,
    else Russian.
  - **Latin by common words.** A Latin-script message with 3 or more words is scored
    against a short list of common words for English, Spanish, Portuguese, French,
    German, Italian, Dutch, Polish, Turkish and Indonesian. Letters only one of these
    languages uses add a point: ñ Spanish, ã õ Portuguese, ß German, ğ ş ı Turkish, ł ą ę
    ś ź ż ć ń Polish. The language with the most points wins when it has at least 2
    points and more than any other.
  - Anything else has no language: short messages, ties, other scripts.
- **R15** The Languages card shows, for each side, how many messages are in each
  language. Language names come from `Intl.DisplayNames` in the browser's language. A
  note says how many messages were too short or unclear to tell.
- **R16** For All conversations, the card also lists up to 10 conversations whose main
  language isn't yours, or whose second language has 20% or more of their messages,
  with the share of each. A conversation needs 20 messages with a language to be
  listed. Names link to the profile.
- **R17** When the selection has only one language (every other language under 5% of
  messages with a language), the card says so in one line ("Everything here is in
  English, as far as Yapalytics can tell") in place of the chart.

**Where they go**

- **R18** The Words tab gets "Signature phrases" and "Inside jokes" (both wide), and
  "Corrections" and "Languages", after "Vocabulary". "Thanks & sorry" goes on the Mood &
  emoji tab, after "Swearing", since it's drawn like it. Every card is listed in "Jump
  to…".
- **R19** "What you talk about" shows the same words as before (it now shares its word
  counting with inside jokes, R22).

## Privacy

Nothing leaves the browser. Everything here reads message text that is already in the
page and works it out in the page. The language detector is a few dozen common words
per language and a table of Unicode scripts, written into `analysis.js`. Nothing is
downloaded, and no model is used. The cards show short pieces of message text (phrases,
jokes, corrected words) on screen, as the Words tab already does. Nothing is stored.

## Design

**One text pass for the selection.** Spec 014 R10 makes `aggregateContent` the one pass
over the selection that splits text into words. Signature phrases, corrections, thanks
and sorry, and languages are counted in that pass, from the tokens it already makes, so
the text is still split once per message. Its cache (`Select.content`) also depends on
the mood scorer, so changing the scorer counts them again. That's rare and costs one
pass. New fields on its result:

- `phrases`: `{ mode, people, who: Map(person -> counter of [uses, lastDay, days]),
  all: counter of uses }`, where a counter is `{ map, n (phrase uses), floor, cap }`.
  `person` is `'You'`; for All conversations a 1-on-1's `k`; in a group, `sn || sk`.
  Only the people R4 names are counted. `phraseWho(msgs)` finds them first with a cheap
  pass that counts messages per person without touching the text, and sets `mode`
  (`'all'`, `'one'` or `'group'`) from whether every message is in one conversation.
- `corrections`: `Map(mo -> [r, s])`, `correctionsTotal: [r, s]`, `correctedWords:
  [Map(word -> n), Map(word -> n)]`. The pass keeps each person's previous message per
  conversation (`Map(k -> Map(sender -> message))`, the sender being you, `sn || sk`, or
  the other side of a 1-on-1) and splits it only when a message with `*` might correct
  it.
- `polite`: `Map(mo -> { thanks: [r, s], sorry: [r, s] })`, `politeTotal`. The share's
  base is the existing `swear` month's `n` (messages with text).
- `lang`: `Map(code -> [r, s])`, `langNone: [r, s]`, `langByContact: Map(k -> Map(code
  -> n))`.

`aggregateContent(msgs, scorer, { phrases = true, phraseCap = PHRASE_CAP })`: Year in
review passes `phrases: false`, so its own pass doesn't count phrases it won't show.
`phraseCap` is there for AC6.

`tokensOf` now filters a new `wordsOf` (every word, single letters and numbers too), so
phrases keep "what a day" whole while every word count stays as it was.

**Phrase counts are capped.** A big selection has millions of different phrases. When
`all` or one person's map passes `PHRASE_CAP` (300,000), entries with 1 use are dropped,
then 2, until it's under 90% of the cap (lossy counting). Each time, dropping starts
again from 1 use. A phrase dropped and seen again starts over, so its count can be low
by the uses it had when dropped, and R2 needs 5 uses anyway. The background count of a
phrase is never taken as less than the person's count. `signaturePhrases(P, limit = 8)`
scores what's left (R2, R3, R3a).

**Inside jokes: a pass per conversation.** Inside jokes need, per conversation, every
word and phrase with who used it and on which days, plus how many conversations use
each word. Keeping that for every conversation in `aggregateContent` would take too much
memory, so, like `distinctiveWords` today, it's a separate pass over the conversations
it shows, using the by-conversation index (`Data.messagesOf`, `inDates`).
`conversationTerms(msgs, docFreq)` splits each message once (twice with a link) and
returns `{ group, words, phrases }`, each a `Map(term -> { n: [r, s], who: Set, days,
first (record), last (time) })`. `words` has every token, links included, as
`distinctiveWords` always counted them. `phrases` has only the phrases with a rare word
(R6), found in a second walk over the words kept from the first, so a long conversation
doesn't hold every phrase it ever used. `distinctiveWords(msgs, df, limit, terms)`
reads its counts from `terms.words` and gives the same rows as before (AC12).
`insideJokes(terms, docFreq, limit)` ranks R6–R7. `Select.terms(k)` caches
`conversationTerms` per conversation until the data, app, groups setting or dates
change. For All conversations that's at most 8 conversations (R8).
`Select.docFreq()` is unchanged, but the Inside jokes card now needs it for All
conversations too, where only one conversation's view used it before.

So opening Words on All conversations splits the selection once in `aggregateContent`
(spec 014 R10 still holds for that pass), plus, once each and cached: every
conversation of the app for `docFreq`, and the up to 8 conversations Inside jokes shows.
Spec 014's AC13 test counted every split through `tokensOf`. It now counts `wordsOf`
calls, checks the selection pass is once per message, checks Overview splits nothing,
and checks Mood and Media reuse what Words worked out.

**Languages.** `languageOf(text, words)` applies R14. `LANG_WORDS` has about 30 to 50
common words per language. A word in two lists is a point for both, so the words only
one language uses decide. Most are unique: "the", "and", "you" for English but not "a",
which several languages use.

**Code.**

- `js/patterns.js` (new, loaded after `analysis.js`): `countPatterns` (what
  `aggregateContent` calls for each message), `phraseWho`, `phrasesOf`, the phrase
  counter, `phraseZ`, `signaturePhrases`, `conversationTerms`, `insideJokes`,
  `languageOf`, `LANG_WORDS`, `languageSummary`, `otherLanguageConversations`,
  `THANKS_RE`, `SORRY_RE`, `CORRECTION_RE`, `editDistance`. `analysis.js` was already
  over 600 lines.
- `js/analysis.js`: `wordsOf`, `isToken`, the new fields in `aggregateContent`, and
  `distinctiveWords` reading `conversationTerms`.
- `js/select.js`: `Select.messagesOf(k)` and `Select.terms(k)`.
- `js/panels/words.js`: panels `phrases`, `jokes`, `corrections` and `languages`
  (topics `data`, `selection`, `theme`). Chips reuse `trackPhrase`.
- `js/panels/mood.js`: `renderPolite`, drawn by the `mood` panel (it already depends on
  the content pass).
- `js/charts.js`: `correctionsOption`, `politeOption` (the shape of `swearOption`),
  `languagesOption`.
- `index.html`: the five cards (R18).

## Acceptance criteria

- **AC1** Given a 1-on-1 where they write "no way dude" in 10 messages over 5 days and
  you never do, the Signature phrases card shows "no way dude" under them and not under
  you.
- **AC2** A phrase used 10 times, all on one day, isn't a signature phrase (R2).
- **AC3** "on my way" used 8 times and "my way" used 9 times shows only "on my way";
  with "my way" used 20 times, only "my way" (R3).
- **AC4** "you know" (only filler words) is never a signature phrase.
- **AC5** For All conversations, the columns are You and the top 5 people by 1-on-1
  messages, and a group member's messages don't make a column.
- **AC6** With `PHRASE_CAP` set to 100 and 1,000 one-off phrases, a phrase used 30
  times still comes out with a count within 10 of 30 and ranks first.
- **AC7** Clicking a phrase chip puts it in the Word tracker and draws it.
- **AC8** Given "moose" used 8 times by both sides over 30 days in one conversation and
  in no other, it's an inside joke there. Used in 3 other conversations, it isn't.
- **AC9** A word used 8 times by only one side isn't an inside joke (R6).
- **AC10** For one conversation, each inside joke row shows its uses, who used it first
  and when, and when it was last used.
- **AC11** For All conversations, the Inside jokes card has at most 8 rows, one per
  conversation, each linking to the profile.
- **AC12** "What you talk about" gives the same words for the demo as before.
- **AC13** "I'll be ther soon" then "*there" from the same person a minute later is one
  correction, with "there" as the corrected word. "*sigh*", "*there" 10 minutes later,
  and "*banana" after "I'll be ther soon" aren't corrections.
- **AC14** "Thank you!!", "thx" and "Thanks" count as thanks; "thankful" doesn't.
  "Sorry", "my bad" and "sry" count as sorry; "sorrowful" doesn't.
- **AC15** "¿Dónde estás? Te espero en la casa" is Spanish; "Where are you? I'm at the
  house" is English; "ok" has no language; "Привіт, як справи?" is Ukrainian;
  "こんにちは" is Japanese; "你好吗" is Chinese.
- **AC16** For All conversations, a conversation with 30 Spanish messages and 5 English
  ones is listed when your main language is English; one with 2 Spanish messages isn't.
- **AC17** A selection that's all English shows the one-line note instead of a chart.
- **AC18** With the demo loaded, the Words tab shows Signature phrases, Inside jokes,
  Corrections and Languages; the Mood & emoji tab shows Thanks & sorry; "Jump to…" lists
  all five.
- **AC19** Year in review gives the same numbers as before, and its `aggregateContent`
  call doesn't count phrases.

## Open questions

- The thresholds (5 uses on 3 days, z ≥ 2, 6 uses over 14 days, df ≤ 2) are first
  guesses. Tune them on real histories.
- An inside joke made only of common words ("big sad") is missed by R6's rare-word
  rule. Counting how many conversations use every phrase would fix it, but would need a
  phrase index of the whole history. Is that worth the memory?
- The language detector can't tell apart close languages it doesn't list (Catalan
  reads as Spanish, Danish and Norwegian as nothing or Dutch), Arabic-script languages
  (Persian and Urdu read as Arabic), or Cyrillic languages other than Ukrainian (they
  read as Russian). Mixed messages count as whichever language has more points. Should
  the Arabic and Cyrillic labels say "Arabic script" and "Cyrillic" instead?
- Thanks and sorry are English only. Add other languages' words once languages are
  known per message?
- Corrections that add a missing word ("I going" then "*am") have nothing to match in
  the earlier message, so they aren't counted.
- Should any of these become highlights (spec 008 style), such as "Alex says thanks
  3× as often as you"? Left out for now.
- The demo shows little of this. Everyone in it picks lines from one shared list, so
  only Priya (Google Chat) has signature phrases, inside jokes turn up only in the
  WhatsApp chats, nobody corrects a typo and everything is English. Give a few demo
  people a catchphrase, a running joke, typos and a second language? That changes the
  demo's text, which other tests read.
- Speed: `aggregateContent` on the demo ×10 (295,200 messages) takes about 340 ms,
  against about 130 ms before (about 240 ms with `phrases: false`). Phrases, the
  language check and the thanks and sorry tests are the cost. It runs once per
  selection, when a tab that needs it opens, and is cached. The user asked for accuracy
  over speed, so nothing was traded for it.
