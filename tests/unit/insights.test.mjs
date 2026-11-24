import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, makeMessage, messageLib } from '../helpers/load.mjs';

const lib = messageLib();
const {
  aggregateMessages, buildHighlights, highlightText, profileFacts, sameDayHistory, daysWithHistory,
  nearestDayWithHistory, pickMoments, busiestConversation,
} = loadApp([
  'aggregateMessages', 'buildHighlights', 'highlightText', 'profileFacts', 'sameDayHistory', 'daysWithHistory',
  'nearestDayWithHistory', 'pickMoments', 'busiestConversation',
]);
const DAY = 86400000;
const START = Date.parse('2024-01-01T12:00:00Z');

/**
 * A synthetic history with clear patterns:
 * - Mom: daily for 8 months. You start every conversation, answer in 1 minute, she takes 2 hours.
 * - Alex: busy for 5 months, then nearly silent for the last 3.
 * - Sam: a few late-night chats.
 */
function history() {
  const out = [];
  const at = (t, o, k, body) => out.push(makeMessage(lib, { at: new Date(t).toISOString(), o, k, body }));
  for (let d = 0; d < 240; d++) {
    const t = START + d * DAY;
    at(t, 1, 'mom', 'good morning, how did you sleep? 😂');
    at(t + 2 * 3600e3, 0, 'mom', 'good, thanks');
    at(t + 2 * 3600e3 + 60e3, 1, 'mom', 'great to hear');
  }
  for (let d = 0; d < 150; d++) {
    const t = START + d * DAY + 3 * 3600e3;
    at(t, 0, 'alex', 'hey');
    at(t + 5 * 60e3, 1, 'alex', 'hi there');
  }
  at(START + 235 * DAY + 3 * 3600e3, 0, 'alex', 'long time no see');
  for (let d = 0; d < 12; d++) {
    const t = Date.parse('2024-03-01T02:00:00Z') + d * 7 * DAY;
    at(t, 1, 'sam', 'up late again');
    at(t + 60e3, 0, 'sam', 'same lol');
  }
  return out.sort((a, b) => a.t - b.t);
}

const labels = { mom: 'Mom', alex: 'Alex', sam: 'Sam' };
const labelFor = (k) => labels[k] || k;

describe('buildHighlights', () => {
  const msgs = history();
  const A = aggregateMessages(msgs);
  const hl = buildHighlights(msgs, A, { labelFor });
  const byKind = Object.fromEntries(hl.map((h) => [h.kind, highlightText(h)]));

  it('picks at most six, one of each kind, most notable first', () => {
    assert.ok(hl.length <= 6 && hl.length >= 4);
    assert.equal(new Set(hl.map((h) => h.kind)).size, hl.length);
    for (let i = 1; i < hl.length; i++) assert.ok(hl[i - 1].score >= hl[i].score);
  });

  it('names the most-messaged conversation', () => {
    assert.match(byKind.top, /^Mom is your most-messaged conversation: 720 messages, \d+% of everything\.$/);
  });

  it('finds the most lopsided reply speed', () => {
    assert.equal(byKind.reply, 'You usually reply to Mom in 1m; they take 2h.');
  });

  it('finds who starts the conversations', () => {
    assert.equal(byKind.starts, 'You start 100% of conversations with Mom.');
  });

  it('notices a conversation fading', () => {
    assert.match(byKind.down, /^Your messages with Alex are down 9\d% in the last 3 months compared with the 3 before\.$/);
  });

  it('says plainly when a conversation stopped', () => {
    const quiet = history().filter((m) => !(m.k === 'alex' && m.b === 'long time no see'));
    const text = highlightText(buildHighlights(quiet, aggregateMessages(quiet), { labelFor, limit: 20 }).find((h) => h.kind === 'down'));
    assert.match(text, /^No messages with Alex in the last 3 months, after \d+ in the 3 before\.$/);
  });

  it('links people to their profile', () => {
    const top = hl.find((h) => h.kind === 'top');
    assert.deepEqual(top.parts[0], { k: 'mom', text: 'Mom' });
  });

  it('talks about "here" for one conversation', () => {
    const mom = msgs.filter((m) => m.k === 'mom');
    const one = buildHighlights(mom, aggregateMessages(mom), { labelFor, single: true, limit: Infinity });
    assert.ok(!one.some((h) => h.kind === 'top'));
    const balance = one.find((h) => h.kind === 'balance');
    assert.equal(highlightText(balance), 'You send 67% of the messages here.');
    assert.match(highlightText(one.find((h) => h.kind === 'streak')), /^Your longest run here: 240 days in a row/);
  });

  it('says nothing about an empty selection', () => {
    assert.deepEqual(buildHighlights([], aggregateMessages([])), []);
  });
});

describe('profileFacts', () => {
  const mom = history().filter((m) => m.k === 'mom');
  const F = profileFacts(mom, aggregateMessages(mom));

  it('compares the two sides', () => {
    assert.equal(F.you.messages, 480);
    assert.equal(F.them.messages, 240);
    assert.equal(F.you.reply, 60e3);
    assert.equal(F.them.reply, 2 * 3600e3);
    assert.equal(F.you.starts, 240);
    assert.equal(F.them.starts, 0);
    assert.equal(F.you.questions, 240);
    assert.deepEqual(F.you.emoji, [['😂', 240]]);
  });

  it('finds the first message, streak and busiest month', () => {
    assert.equal(F.firstText.b, 'good morning, how did you sleep? 😂');
    assert.equal(F.longestStreak.len, 240);
    assert.equal(F.busiestMonth.n, 93); // a 31-day month, 3 messages a day
    assert.equal(F.peakHour, 14); // 2 messages a day at 14:00 UTC
  });
});

describe('on this day', () => {
  const msgs = [
    makeMessage(lib, { at: '2023-10-15T09:00:00Z', o: 1, k: 'mom', body: 'happy birthday!! hope it is a great one' }),
    makeMessage(lib, { at: '2024-10-15T20:00:00Z', o: 0, k: 'alex', body: 'see you at the game tonight?' }),
    makeMessage(lib, { at: '2024-10-15T21:00:00Z', o: 1, k: 'alex', body: 'yes!' }),
    makeMessage(lib, { at: '2024-10-16T08:00:00Z', o: 0, k: 'alex', body: 'what a game' }),
    makeMessage(lib, { at: '2026-10-15T08:00:00Z', o: 0, k: 'sam', body: 'today, not history' }),
  ];

  it('groups the same date in earlier years, newest first', () => {
    const before = Date.parse('2026-10-15T00:00:00Z');
    const years = sameDayHistory(msgs, 9, 15, before);
    assert.deepEqual(years.map((y) => [y.year, y.msgs.length]), [[2024, 2], [2023, 1]]);
  });

  it('finds the nearest day with messages', () => {
    const days = daysWithHistory(msgs, Date.parse('2026-10-15T00:00:00Z'));
    assert.deepEqual(nearestDayWithHistory(days, 9, 20), { month: 9, day: 16 });
    assert.deepEqual(nearestDayWithHistory(days, 0, 1), { month: 9, day: 16 });
    assert.equal(nearestDayWithHistory(new Set(), 0, 1), null);
  });

  it('picks readable messages spread through the day', () => {
    const day = Array.from({ length: 30 }, (_, i) => makeMessage(lib, { at: new Date(START + i * 60e3).toISOString(), k: 'mom', body: i % 2 ? 'ok' : `message number ${i} here` }));
    const picks = pickMoments(day, 3);
    assert.equal(picks.length, 3);
    assert.ok(picks.every((m) => m.l >= 12));
    assert.ok(picks[0].t < picks[1].t && picks[1].t < picks[2].t);
  });

  it('names who a day was mostly with', () => {
    assert.deepEqual(busiestConversation(msgs.slice(0, 4)), { k: 'alex', n: 3, of: 2 });
    assert.equal(busiestConversation([]), null);
  });
});

describe('spec 008 more highlights', () => {
  const names = { ...labels, pat: 'Pat' };
  const name = (k) => names[k] || k;
  /** A message list builder: at(time, o, key, body, extra fields). */
  const build = () => {
    const out = [];
    const at = (t, o, k, body = 'hello there', rest = {}) => out.push(makeMessage(lib, { at: new Date(t).toISOString(), o, k, body, ...rest }));
    return { at, msgs: () => out.sort((a, b) => a.t - b.t) };
  };
  const HOUR = 3600e3;
  const MIN = 60e3;
  const run = (msgs, opts = {}) => buildHighlights(msgs, aggregateMessages(msgs), { labelFor: name, limit: Infinity, ...opts });
  const textOf = (msgs, kind, opts) => {
    const h = run(msgs, opts).find((x) => x.kind === kind);
    return h ? highlightText(h) : null;
  };
  /** A back-and-forth: n messages with `k`, one a day from `from`, alternating sides. */
  const chat = (at, k, from, n, { step = DAY, body = 'hello there' } = {}) => {
    for (let i = 0; i < n; i++) at(from + i * step, i % 2, k, body);
  };

  it('AC1: names the busiest day and who it was with', () => {
    const { at, msgs } = build();
    for (let d = 0; d < 30; d++) if (d !== 15) chat(at, 'mom', START + d * DAY, 2, { step: HOUR });
    chat(at, 'alex', START + 15 * DAY, 100, { step: MIN });
    chat(at, 'sam', START + 15 * DAY + 4 * HOUR, 20, { step: MIN });
    assert.match(textOf(msgs(), 'busiestDay'), /^Your busiest day was Tue, Jan 16, 2024: 120 messages, 83% with Alex\.$/);

    const calm = build();
    for (let d = 0; d < 30; d++) chat(calm.at, 'mom', START + d * DAY, d === 15 ? 60 : 2, { step: MIN });
    assert.equal(textOf(calm.msgs(), 'busiestDay'), null);
  });

  it('AC1: a selection with only a few active days still gets its busiest day', () => {
    const { at, msgs } = build();
    chat(at, 'alex', START, 120, { step: MIN });
    for (let d = 1; d <= 4; d++) at(START + d * DAY, 1, 'alex');
    assert.match(textOf(msgs(), 'busiestDay'), /^Your busiest day was Mon, Jan 1, 2024: 120 messages, 100% with Alex\.$/);
  });

  it('AC2: names the longest unbroken conversation', () => {
    const { at, msgs } = build();
    chat(at, 'alex', START, 150, { step: MIN });
    chat(at, 'mom', START + 2 * DAY, 20);
    assert.match(textOf(msgs(), 'marathon'), /^Your longest conversation: 150 messages with Alex over 2h 29m on Mon, Jan 1, 2024\.$/);
  });

  it('AC3: finds the latest late-night message, from 3 am on', () => {
    const { at, msgs } = build();
    chat(at, 'mom', START, 20);
    at(Date.parse('2024-01-05T04:30:00Z'), 1, 'sam', 'still up');
    assert.match(textOf(msgs(), 'latest'), /^Your latest late-night message: 4:30\sAM, with Sam on Fri, Jan 5, 2024\.$/);

    const early = build();
    chat(early.at, 'mom', START, 20);
    early.at(Date.parse('2024-01-05T01:30:00Z'), 1, 'sam', 'still up');
    assert.equal(textOf(early.msgs(), 'latest'), null);
  });

  it('AC4: celebrates a recent milestone', () => {
    const { at, msgs } = build();
    chat(at, 'alex', START, 1000, { step: 2 * HOUR });
    chat(at, 'mom', START, 30);
    assert.match(textOf(msgs(), 'milestone'), /^You passed 1,000 messages with Alex on .+\.$/);
  });

  it("AC5: names the oldest conversation that's still going", () => {
    const { at, msgs } = build();
    chat(at, 'sam', START - 200 * DAY, 60, { step: 5 * DAY }); // older, but quiet for the last 3 months
    chat(at, 'alex', START, 170, { step: 7 * DAY });
    assert.equal(textOf(msgs(), 'oldest'), "You've been texting Alex since Jan 2024: over 3 years.");
  });

  it('AC6: spots a new conversation near the top', () => {
    const { at, msgs } = build();
    chat(at, 'mom', START, 400);
    chat(at, 'sam', START, 100, { step: 4 * DAY });
    chat(at, 'alex', START + 340 * DAY, 300, { step: 4 * HOUR });
    assert.equal(textOf(msgs(), 'newcomer'), 'Your conversation with Alex started in Dec 2024 and is already your #2.');
  });

  it('AC7: finds a long silence that ended', () => {
    const { at, msgs } = build();
    chat(at, 'alex', START, 30);
    chat(at, 'alex', START + 230 * DAY, 30);
    assert.equal(textOf(msgs(), 'reunion'), 'You and Alex went 200 days without a message, then picked back up on Sun, Aug 18, 2024.');
    assert.equal(textOf(msgs(), 'reunion', { single: true }), 'The longest silence here: 200 days, until Sun, Aug 18, 2024.');
  });

  it('AC7: skips a longer silence without 20 messages on each side for a shorter one with them', () => {
    const { at, msgs } = build();
    chat(at, 'alex', START, 10); // days 0–9, then 200 silent days
    chat(at, 'alex', START + 210 * DAY, 30); // days 210–239, then 100 silent days
    chat(at, 'alex', START + 340 * DAY, 30);
    assert.match(textOf(msgs(), 'reunion'), /^You and Alex went 100 days without a message/);
  });

  it('AC8: names the biggest year, compared with a whole year before', () => {
    const years = (from) => {
      const { at, msgs } = build();
      chat(at, 'alex', Date.parse(from), 100, { step: 2 * DAY });
      chat(at, 'alex', Date.parse('2023-01-01T12:00:00Z'), 300, { step: DAY });
      chat(at, 'alex', Date.parse('2024-02-01T12:00:00Z'), 100, { step: 2 * DAY });
      return msgs();
    };
    assert.equal(textOf(years('2022-01-01T00:00:00Z'), 'year'), '2023 was your biggest year: 300 messages, 3× as many as in 2022.');
    assert.equal(textOf(years('2022-03-01T00:00:00Z'), 'year'), '2023 was your biggest year: 300 messages.');
  });

  it('AC9: says who laughs more', () => {
    const { at, msgs } = build();
    for (let i = 0; i < 60; i++) {
      at(START + i * DAY, 0, 'alex', i < 40 ? 'haha that is great' : 'sounds good');
      at(START + i * DAY + MIN, 1, 'alex', i < 2 ? 'lol ok' : 'see you then');
    }
    const want = 'Alex laughs (lol, haha, 😂) 20× as often as you do.';
    assert.equal(textOf(msgs(), 'laughs'), want);
    assert.equal(textOf(msgs(), 'laughs', { single: true }), want);
  });

  it('AC9: a side that never laughs, in few messages, is not called the one who laughs more', () => {
    const { at, msgs } = build();
    for (let i = 0; i < 1000; i++) at(START + i * HOUR, 0, 'alex', i < 20 ? 'haha nice' : 'ok');
    for (let i = 0; i < 20; i++) at(START + i * HOUR + MIN, 1, 'alex', 'ok');
    assert.equal(textOf(msgs(), 'laughs'), null);
  });

  it('AC9: needs 20 laughs from the side that laughs more', () => {
    const { at, msgs } = build();
    for (let i = 0; i < 1000; i++) at(START + i * HOUR, 0, 'alex', i < 20 ? 'haha nice' : 'ok');
    for (let i = 0; i < 50; i++) at(START + i * HOUR + MIN, 1, 'alex', i < 10 ? 'lol' : 'ok');
    assert.equal(textOf(msgs(), 'laughs'), null);
  });

  it('AC10: says who asks the questions', () => {
    const { at, msgs } = build();
    for (let i = 0; i < 60; i++) {
      at(START + i * DAY, 1, 'alex', i < 40 ? 'how are you?' : 'see you then');
      at(START + i * DAY + MIN, 0, 'alex', i < 10 ? 'and you?' : 'all good');
    }
    assert.equal(textOf(msgs(), 'questions'), 'You ask 80% of the questions with Alex.');
    assert.equal(textOf(msgs(), 'questions', { single: true }), 'You ask 80% of the questions here.');
  });

  it('AC11: says who double-texts', () => {
    const { at, msgs } = build();
    for (let i = 0; i < 40; i++) {
      const t = START + i * DAY;
      at(t, 1, 'alex', 'hey');
      at(t + MIN, 1, 'alex', 'you there');
      at(t + 2 * MIN, 0, 'alex', 'yes');
      if (i < 10) at(t + 3 * MIN, 0, 'alex', 'what is up');
    }
    assert.equal(textOf(msgs(), 'doubles'), 'You double-text Alex 4× as often as they double-text you.');
  });

  it('AC12: names the fastest replier', () => {
    const { at, msgs } = build();
    for (let i = 0; i < 40; i++) {
      const t = START + i * DAY;
      at(t, 1, 'alex', 'hey');
      at(t + 30e3, 0, 'alex', 'hi');
      at(t + HOUR, 1, 'sam', 'hey');
      at(t + HOUR + 5 * MIN, 0, 'sam', 'hi');
    }
    assert.equal(textOf(msgs(), 'fastest'), 'Alex is your fastest replier: they usually answer in 30s.');
  });

  it("AC13: finds an emoji that's one conversation's own", () => {
    const { at, msgs } = build();
    for (let i = 0; i < 60; i++) {
      at(START + i * DAY, i % 2, 'alex', i < 10 ? 'rawr 🦖' : 'hello there');
      at(START + i * DAY + HOUR, i % 2, 'sam', i < 30 ? 'funny 😂' : 'hello there');
      at(START + i * DAY + 2 * HOUR, i % 2, 'mom', i < 30 ? 'funny 😂' : 'hello there');
    }
    const h = run(msgs()).find((x) => x.kind === 'sigEmoji');
    assert.equal(h.icon, '🦖');
    assert.equal(highlightText(h), '🦖 is your emoji with Alex: used 7× as often there as across all your conversations.');
  });

  it('AC14: says who gets your photos', () => {
    const { at, msgs } = build();
    const sends = { alex: 20, sam: 10, mom: 10 };
    for (const [k, n] of Object.entries(sends)) {
      for (let i = 0; i < n; i++) at(START + i * DAY, 1, k, '', { ph: 1 });
    }
    assert.equal(textOf(msgs(), 'photos'), 'Alex gets 50% of the photos you send.');
  });

  it('AC15: finds the weekend conversation and the early-morning one', () => {
    const { at, msgs } = build();
    const saturday = Date.parse('2024-01-06T15:00:00Z');
    for (let i = 0; i < 120; i++) at(saturday + Math.floor(i / 2) * 7 * DAY + (i % 2) * MIN, i % 2, 'sam');
    const monday = Date.parse('2024-01-01T07:00:00Z');
    for (let i = 0; i < 120; i++) at(monday + Math.floor(i / 2) * 7 * DAY + (i % 2) * MIN, i % 2, 'mom');
    for (let i = 0; i < 300; i++) at(Date.parse('2024-01-02T14:00:00Z') + Math.floor(i / 2) * 7 * DAY + (i % 2) * MIN, i % 2, 'alex');
    const all = msgs();
    assert.equal(textOf(all, 'weekend'), 'Sam is your weekend conversation: 100% of your messages with them are on a Saturday or Sunday.');
    assert.match(textOf(all, 'morning'), /^Mom is your early-morning conversation: 100% of your messages with them are between 5\sAM and 9\sAM\.$/);
    const sam = all.filter((m) => m.k === 'sam');
    assert.equal(textOf(sam, 'weekend', { single: true }), '100% of messages here are on a Saturday or Sunday.');
  });

  it('AC16: says who gets the love-you messages', () => {
    const { at, msgs } = build();
    for (let i = 0; i < 40; i++) at(START + i * DAY, 1, 'alex', i < 30 ? 'love you' : 'see you');
    for (let i = 0; i < 40; i++) at(START + i * DAY + HOUR, 1, 'sam', i < 5 ? 'love you' : 'see you');
    assert.equal(textOf(msgs(), 'love'), '86% of your love-you messages (love you, ❤️, 😘) are with Alex.');
  });

  it('AC17: one conversation leaves out the all-only kinds and talks about "here"', () => {
    const { at, msgs } = build();
    for (let i = 0; i < 60; i++) {
      at(START + i * DAY, 1, 'alex', i < 10 ? 'rawr 🦖' : 'hey');
      at(START + i * DAY + 30e3, 0, 'alex', 'hi');
    }
    chat(at, 'alex', START + 300 * DAY, 120, { step: HOUR });
    const one = run(msgs(), { single: true });
    const kinds = new Set(one.map((h) => h.kind));
    for (const k of ['newcomer', 'fastest', 'sigEmoji']) assert.ok(!kinds.has(k), k);
    for (const h of one.filter((x) => ['busiestDay', 'marathon', 'reunion', 'year', 'weekend', 'morning'].includes(x.kind))) {
      assert.match(highlightText(h), /here/);
    }
  });
});
