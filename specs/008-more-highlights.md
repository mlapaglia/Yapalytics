# 008 More highlights

Status: Approved · PR:

## Problem

The Overview tab's Highlights card has 12 kinds of finding: most-messaged conversation,
balance, reply speed, who starts, rising and fading, streaks, late nights, message
length, go-to emoji, daily rhythm, the loudest group member and one cross-app finding
(spec 007). For most histories the same handful come up every time, and a lot that
stands out goes unsaid: the day everything happened, the friend you've texted for a
decade, the person who always laughs at your jokes.

## Goals and non-goals

- Add 16 more kinds of finding. They cover moments, relationships over time, how two
  people talk, and habits.
- Keep the card short. It shows the 6 strongest and puts the rest behind a button.
- Not in scope: findings that need message text beyond the trait flags the parser
  already sets, the mood scores or the AI analysis.

## Requirements

- **R1** `buildHighlights` can return each of the kinds in the table below, at most one
  of each, sorted by score with the existing ones.
- **R2** Every new kind has a sentence for **All conversations**. Where the table gives
  one, it also has a sentence for a single conversation (`single`), which talks about
  "here". Kinds marked *all only* never appear for a single conversation.
- **R3** The card shows the 6 highest-scoring highlights. When there are more, a
  **Show N more** button under the list reveals the rest in score order and becomes
  **Show fewer**. The list collapses again whenever the dashboard re-renders.
- **R4** Names in the new sentences are links to the profile, as they are now.

| Kind | Icon | Fires when | Sentence (all / single) |
|---|---|---|---|
| `busiestDay` | 🗓️ | The busiest day has ≥ 100 messages and ≥ 4× the average active day | "Your busiest day was Sat, Mar 4, 2023: **812** messages, **70%** with Alex." The last part only appears when one conversation has ≥ 50% of the day. / "The busiest day here was Sat, Mar 4, 2023: **812** messages." |
| `marathon` | 🏃 | The longest conversation (no silence longer than the gap) has ≥ 100 messages | "Your longest conversation: **642** messages with Alex over **5h 12m** on Sat, Jun 3, 2023." / "The longest conversation here: **642** messages over **5h 12m** on …" |
| `latest` | 🦉 | The latest-in-the-night message (midnight to 5 am) is at 3 am or later | "Your latest late-night message: **4:52 AM**, with Alex on …" / "The latest late-night message here: **4:52 AM**, on …" |
| `milestone` | 🎉 | The largest milestone of ≥ 1,000 messages (per conversation, or in total) in the last 6 months of the selection | "You passed **10,000** messages with Alex on …" / "You passed **100,000** messages in total on …" / "This conversation passed **10,000** messages on …" |
| `oldest` | 🕰️ | Of the busy conversations with messages in the last 3 months, the one with the earliest first message, when that is ≥ 3 years before the end (≥ 2 years for single) | "You've been texting Alex since **Aug 2014**: over **11 years**." / "You've been talking here since **Aug 2014**: over **11 years**." |
| `newcomer` | ✨ | *All only.* A conversation ranked #2–#5 by messages, with 50+, whose first message is in the last 6 months, in a selection that spans ≥ 12 months (the highest-ranked one) | "Your conversation with Sam started in **Jul 2026** and is already your **#3**." |
| `reunion` | 🤝 | A busy 1-on-1 conversation with a silence of ≥ 90 days and ≥ 20 messages on each side of it (the longest such silence) | "You and Alex went **214 days** without a message, then picked back up on …" / "The longest silence here: **214 days**, until …" |
| `year` | 📅 | The selection has messages in 3+ calendar years | "**2021** was your biggest year: **48,210** messages, **2×** as many as in 2020." The comparison appears when the selection covers the whole year before and the ratio is ≥ 1.3. / "**2021** was the biggest year here: …" |
| `laughs` | 😂 | A busy 1-on-1 conversation where one side laughs (the Laughs trait) at ≥ 2× the other's rate per message, with ≥ 20 laughs on that side | "Alex laughs (lol, haha, 😂) **3×** as often as you do." / "You laugh (lol, haha, 😂) **3×** as often as Alex does." Single uses the same sentences. |
| `questions` | ❓ | A busy 1-on-1 conversation with ≥ 30 questions where one side asks ≥ 65% | "You ask **72%** of the questions with Alex." / "Alex asks **72%** of the questions." Single: "You ask **72%** of the questions here." |
| `doubles` | 💬 | A busy 1-on-1 conversation where one side has ≥ 30 double texts and ≥ 2.5× the other's | "You double-text Alex **4×** as often as they double-text you." / "Alex double-texts you **4×** as often as you double-text them." Single uses the same sentences. |
| `fastest` | ⚡ | *All only.* Of the busy 1-on-1 conversations with ≥ 30 replies from them (at least two), the lowest median reply, when ≤ 2 minutes | "Alex is your fastest replier: they usually answer in **40s**." |
| `sigEmoji` | the emoji | *All only.* Of the top 15 busy conversations, the signature emoji (`signatureEmoji`) with ≥ 5 uses there and the highest lift, when ≥ 5× | "🦖 is your emoji with Alex: used **9×** as often there as in your messages overall." |
| `photos` | 📸 | ≥ 30 photos sent and one conversation gets ≥ 30% of them; otherwise the same for photos received / single: ≥ 30 photos with one side sending ≥ 2× the other | "Alex gets **40%** of the photos you send." / "Alex sends you the most photos: **1,204**." / single: "Alex sends **3×** as many photos as you here." |
| `weekend` | 🛋️ | A busy conversation with ≥ 100 messages, ≥ 50% of them on a Saturday or Sunday (the highest share). For all conversations the share must also be 15 points above your overall weekend share. | "Sam is your weekend conversation: **61%** of your messages with them are on a Saturday or Sunday." / "**61%** of messages here are on a Saturday or Sunday." |
| `morning` | 🌅 | The same, with ≥ 35% from 5 to 9 am (and 15 points above your overall share) | "Mom is your early-morning conversation: **42%** of your messages with them are between 5 and 9 AM." / "**42%** of messages here are between 5 and 9 AM." |
| `love` | ❤️ | ≥ 20 messages with the Love trait and one conversation has ≥ 40% of them / single: one side sends ≥ 2× the other's | "**45%** of your love-you messages (love you, ❤️, 😘) are with Alex." / single: "You send **2×** as many love-you messages (love you, ❤️, 😘) as Alex here." |

"Busy" is the existing rule: one of the 25 conversations with the most messages, with
50 or more. Dates are written as `Sat, Mar 4, 2023` and times in the browser's locale.
The thresholds can be tuned against real histories; changes go in this table.

## Privacy

Nothing new leaves the browser. The new findings use message times, directions,
attachment counts, emoji and the trait flags the parser already sets (laughs,
questions, love). No new code reads message text, and no message text is shown.

## Design

**Data.** `aggregateMessages` adds counters to each conversation's `byContact` record:

- `traits: [[…], […]]`: trait counts per side, in `TRAITS` order
- `doubles: [r, s]`: double texts per side
- `ph: [r, s]`: photos per side
- `weekend`, `morning`: messages on Saturday or Sunday; messages from 5 to 9 am
- `longestGap: { len, end, before }`: the longest silence in days, when messages
  resumed, and how many messages came before it (`null` when there is none)
- `replyN: [r, s]`: replies counted for the median

**Code.** The new kinds go in `buildHighlights` in `js/insights.js`. `renderHighlights`
in `js/app.js` asks for all of them (`limit: Infinity`), renders the first
`HIGHLIGHT_LIMIT` (6) and the rest as hidden `<li class="hl-more">`. A
`#highlightsMore` button under the list toggles them.

## Acceptance criteria

- **AC1** `busiestDay`: a day with 120 messages, 100 of them with Alex, among ordinary
  days gives "Your busiest day was …: 120 messages, 83% with Alex."; a day with 60
  doesn't fire.
- **AC2** `marathon`: an unbroken run of 150 messages gives the sentence with the count,
  the conversation and the duration.
- **AC3** `latest`: a message at 4:30 am fires; the latest at 1 am doesn't.
- **AC4** `milestone`: a conversation passing 1,000 messages near the end of the
  selection gives "You passed 1,000 messages with … on …".
- **AC5** `oldest`: a conversation that started 3 years before the end and is still
  active gives "You've been texting … since …: over 3 years."; one that went quiet
  doesn't count.
- **AC6** `newcomer`: a conversation that started 2 months before the end and ranks #2
  gives "… started in … and is already your #2."
- **AC7** `reunion`: a 200-day silence between two busy stretches gives "You and … went
  200 days without a message, then picked back up on …".
- **AC8** `year`: 3 years of messages name the biggest one and its ratio to the year
  before; a partial year before gets no ratio.
- **AC9** `laughs`: a conversation where they laugh in most messages and you rarely do
  gives "… laughs (lol, haha, 😂) N× as often as you do."
- **AC10** `questions`: you ask 80% of 50 questions gives "You ask 80% of the questions
  with …".
- **AC11** `doubles`: you double-text 4× as often gives "You double-text … 4× as often
  as they double-text you."
- **AC12** `fastest`: of two conversations with 30+ replies, the one whose median reply
  is 30 seconds gives "… is your fastest replier: they usually answer in 30s."
- **AC13** `sigEmoji`: an emoji used only with one person gives "… is your emoji with
  …".
- **AC14** `photos`: one person getting half your photos gives "… gets 50% of the photos
  you send."
- **AC15** `weekend` and `morning`: a conversation only on weekends, and one only at 7
  am, give their sentences.
- **AC16** `love`: one person getting most of your love-you messages gives "N% of your
  love-you messages (love you, ❤️, 😘) are with …".
- **AC17** For a single conversation, `newcomer`, `fastest` and `sigEmoji` never appear,
  and the kinds with a single sentence use it.
- **AC18** With the demo loaded, the card shows at most 6 highlights and a "Show N
  more" button. Clicking it shows N more and changes it to "Show fewer"; clicking again
  hides them.

## Open questions

- The thresholds are first guesses. Revisit them once they've run on a few real
  histories.
