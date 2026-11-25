/* specs/027-reactions.md: reading, matching and counting reactions. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, makeMessage, messageLib } from '../helpers/load.mjs';
import { runParser } from '../helpers/worker.mjs';
import { asFile, igMessage, threadOf } from '../helpers/instagram.mjs';

const lib = messageLib();
const {
  createDataset, selectReactions, aggregateReactions, aggregateMessages, aggregateContent, emojiOption, emojiTrendWithReactions,
  convoEmojiWithReactions, withReactionEmoji, signatureEmoji, emojiTotal, reactWhoRows, reactionHighlights, highlightText,
  summaryStats, statsTables, REACT_BINS, mergeReactions,
} = loadApp([
  'createDataset', 'selectReactions', 'aggregateReactions', 'aggregateMessages', 'aggregateContent', 'emojiOption', 'emojiTrendWithReactions',
  'convoEmojiWithReactions', 'withReactionEmoji', 'signatureEmoji', 'emojiTotal', 'reactWhoRows', 'reactionHighlights', 'highlightText',
  'summaryStats', 'statsTables', 'REACT_BINS', 'mergeReactions',
]);
const ui = new Proxy({}, { get: (_, k) => (k === 'series' || k === 'heat' ? Array(8).fill('#888') : '#888') });

const MIN = 60e3;
const T0 = Date.parse('2024-03-01T12:00:00Z');
const at = (min) => new Date(T0 + min * MIN).toISOString();
/** An SMS record in the 1-on-1 with +1555, `min` minutes after 12:00. */
const sms = (min, o, body, extra = {}) => makeMessage(lib, { at: at(min), o, k: '+1555', body, ...extra });

/** A dataset loaded with `recs`, as after a load. */
function loaded(recs, owners = {}) {
  const D = createDataset();
  D.addBatch(recs, []);
  D.finish();
  D.rederive({ owners, people: new Map() });
  return D;
}
const counted = (D, filter = {}, gap = 3600e3) => aggregateReactions(selectReactions(D.reactionEvents, filter), { gap, byKey: D.byKey });

describe('spec 027 reading reactions', () => {
  it('AC1: reactionOf gives the emoji, the quote or file kind, and removals, for each kind of text', () => {
    const cases = [
      ['Liked “x”', { r: '👍', q: 'x' }],
      ['Loved “x”', { r: '❤️', q: 'x' }],
      ['Disliked “x”', { r: '👎', q: 'x' }],
      ['Laughed at “x”', { r: '😂', q: 'x' }],
      ['Emphasized “x”', { r: '‼️', q: 'x' }],
      ['Emphasised “x”', { r: '‼️', q: 'x' }],
      ['Questioned “x”', { r: '❓', q: 'x' }],
      ['Reacted 😂 to “x”', { r: '😂', q: 'x' }],
      ['Reacted with 🔥 to “x”', { r: '🔥', q: 'x' }],
      ['❤️ to “x”', { r: '❤️', q: 'x' }],
      ['​❤️ to “x”', { r: '❤️', q: 'x' }],
      ['Liked an image', { r: '👍', mk: 'ph' }],
      ['Removed a heart from “x”', { r: '❤️', q: 'x', rm: true }],
      ['Removed a like from “x”', { r: '👍', q: 'x', rm: true }],
      ['Removed a dislike from “x”', { r: '👎', q: 'x', rm: true }],
      ['Removed a laugh from “x”', { r: '😂', q: 'x', rm: true }],
      ['Removed an exclamation from “x”', { r: '‼️', q: 'x', rm: true }],
      ['Removed a question mark from “x”', { r: '❓', q: 'x', rm: true }],
      ['Removed 😂 from “x”', { r: '😂', q: 'x', rm: true }],
      ['Reacted :party_blob: to “x”', { r: ':party_blob:', q: 'x' }],
      ['Reacted with :party_blob: to “x”', { r: ':party_blob:', q: 'x' }],
      ['1️⃣ to “x”', { r: '1️⃣', q: 'x' }],
    ];
    for (const [body, want] of cases) assert.deepEqual(lib.reactionOf(body), want, body);
    assert.equal(lib.reactionOf('Loved the movie last night'), null);
  });

  it('AC2: a tapback on Alex’s message is a reaction on it, not a message, 3 minutes after', () => {
    const D = loaded([sms(0, 0, 'see you soon 😊'), sms(3, 1, 'Loved “see you soon 😊”')]);
    assert.deepEqual(D.msgs.map((m) => m.b), ['see you soon 😊']);
    assert.equal(D.reactionEvents.length, 1);
    const [e] = D.reactionEvents;
    assert.deepEqual([e.r, e.you, e.lag, e.target], ['❤️', 1, 3 * MIN, D.msgs[0]]);
    assert.deepEqual(D.textRx.get(D.msgs[0]), [{ r: '❤️', c: 1, n: ['You'] }]);
  });

  it('AC8: reaction times come from Instagram timestamps and Telegram dates; Google Chat ones have none but count', async () => {
    const out = await runParser('instagram.js', 'metaParserWorker', { files: [asFile(threadOf(
      igMessage(0, 'Alex', { content: 'big news' }),
      igMessage(60, 'Jamie', { content: 'tell me', reactions: [{ reaction: '❤', actor: 'Alex', timestamp: Date.parse('2024-08-20T10:03:00Z') / 1000 }] }),
    ))] });
    const reacted = out.msgs.find((m) => m.rx);
    assert.deepEqual(reacted.rx, [{ r: '❤', c: 1, n: ['Alex'], at: [Date.parse('2024-08-20T10:03:00Z')] }]);
    const D = loaded(out.msgs, { 5: { name: 'Jamie' } });
    const [e] = D.reactionEvents;
    assert.deepEqual([e.r, e.you, e.lag, e.own], ['❤️', 0, 2 * MIN, false]);

    // Telegram: recent[].date becomes `at` (telegram.test.mjs reads it from an export), and a lag here
    const tg = loaded([{ ...sms(0, 0, 'hi'), s: 4, sn: 'Mila', k: 'tg:1', rx: [{ r: '👍', c: 1, n: ['Jamie'], at: [T0 + 5 * MIN] }] }], { 4: { name: 'Jamie' } });
    assert.deepEqual(tg.reactionEvents.map((e) => [e.you, e.lag]), [[1, 5 * MIN]]);

    // Two exports giving one reaction different times keep the earliest, in either order
    const late = [{ r: '❤', c: 1, n: ['Alex'], at: [9000] }], early = [{ r: '❤', c: 1, n: ['Alex'], at: [5000] }];
    assert.deepEqual(mergeReactions(late, early)[0].at, [5000]);
    assert.deepEqual(mergeReactions(early, late)[0].at, [5000]);
    assert.deepEqual(mergeReactions([{ r: '❤', c: 1, n: ['Alex'] }], late)[0].at, [9000], 'an unknown time is filled');

    // Google Chat: reactors, no times
    const chat = loaded([{ ...sms(0, 1, 'hi'), s: 1, k: 'gc:dm', rx: [{ r: '👍', c: 1, n: ['Alex'] }] }]);
    const R = counted(chat);
    assert.deepEqual([R.n, R.timed, chat.reactionEvents[0].lag], [[1, 0], [0, 0], null]);
  });

  it('AC9: iMessage tapbacks are reactions on the message above them; thread replies are still skipped', async () => {
    const text = [
      'May 17, 2022  5:29:42 PM',
      'Alex',
      'Hello world',
      'Tapbacks:',
      '    Loved by Me',
      '    😂 by Sam',
      '    May 17, 2022  5:31:00 PM',
      '    Sam',
      '    reply text',
      '',
      'May 17, 2022  5:32:00 PM',
      'Me',
      'hi',
      'Tapbacks:',
      '    Laughed by Alex',
      '',
      'May 17, 2022  5:33:00 PM',
      'Alex',
      'count off',
      'Tapbacks:',
      '    1️⃣ by Sam',
      '    Loved by Me',
      '',
    ].join('\n');
    const out = await runParser('imessage.js', 'iMessageParserWorker', { files: [new File([text], 'Alex.txt', { type: 'text/plain' })] });
    assert.deepEqual(out.msgs.map((m) => [m.b, m.rx]), [
      ['Hello world', [{ r: '❤️', c: 1, n: ['Me'] }, { r: '😂', c: 1, n: ['Sam'] }]],
      ['hi', [{ r: '😂', c: 1, n: ['Alex'] }]],
      ['count off', [{ r: '1️⃣', c: 1, n: ['Sam'] }, { r: '❤️', c: 1, n: ['Me'] }]],
    ]);
    const D = loaded(out.msgs, { 3: { name: 'Me' } });
    assert.deepEqual(D.reactionEvents.map((e) => [e.r, e.you, e.own]), [['❤️', 1, false], ['😂', 0, false], ['😂', 0, false], ['1️⃣', 0, false], ['❤️', 1, false]]);
  });
});

describe('spec 027 matching reaction texts', () => {
  it('AC3: a quote cut short matches the message it starts, and curly and straight quotes match', () => {
    const D = loaded([
      sms(0, 0, 'that was hilarious 🤣🤣'),
      sms(1, 1, '😂 to “ that was hilari'),
      sms(2, 0, 'don\'t forget the "good" one'),
      sms(3, 1, 'Loved "don’t forget the “good” one"'),
    ]);
    assert.deepEqual(D.reactionEvents.map((e) => e.target && e.target.b), ['that was hilarious 🤣🤣', 'don\'t forget the "good" one']);
  });

  it('AC4: the latest earlier match wins, a later message never does, and 25 hours back is too far', () => {
    const D = loaded([
      sms(0, 0, 'ok'),
      sms(60, 0, 'ok'),
      sms(90, 1, 'Liked “ok”'),
      sms(120, 0, 'ok'),
      sms(200, 0, 'one of a kind'),
      sms(200 + 25 * 60, 1, 'Loved “one of a kind”'),
    ]);
    const [liked, loved] = D.reactionEvents;
    assert.equal(liked.target.t, T0 + 60 * MIN);
    assert.equal(loved.target, null);
    assert.equal(counted(D).unmatched, 1);
  });

  it('AC5: Loved an image is on the latest earlier photo in that thread', () => {
    const D = loaded([
      sms(0, 0, '', { ph: 1 }),
      { ...sms(30, 0, '', { ph: 1 }), k: '+1666' },
      sms(60, 1, 'Loved an image'),
      sms(90, 0, '', { ph: 1 }),
    ]);
    assert.equal(D.reactionEvents[0].target.t, T0);
  });

  it('AC6: a removal cancels the reaction, and a change keeps one reaction timed from the first', () => {
    const removed = loaded([sms(0, 0, 'x'), sms(1, 1, 'Loved “x”'), sms(2, 1, 'Removed a heart from “x”')]);
    assert.equal(removed.reactionEvents.length, 0);
    const changed = loaded([sms(0, 0, 'x'), sms(1, 1, 'Loved “x”'), sms(5, 1, 'Laughed at “x”')]);
    assert.deepEqual(changed.reactionEvents.map((e) => [e.r, e.lag]), [['😂', MIN]]);
  });

  it('AC7: a reaction on the reactor’s own message is an own-message reaction, in 1-on-1s and group MMS', () => {
    const one = loaded([sms(0, 1, 'mine'), sms(1, 1, 'Loved “mine”')]);
    assert.equal(one.reactionEvents[0].own, true);
    const g = (min, sk, body) => ({ ...makeMessage(lib, { at: at(min), o: 0, k: 'g:+1555~+1666', body, m: 1 }), sk });
    const group = loaded([g(0, '+1555', 'from 1555'), g(1, '+1666', 'from 1666'), g(2, '+1555', 'Liked “from 1555”'), g(3, '+1555', 'Liked “from 1666”')]);
    assert.deepEqual(group.reactionEvents.map((e) => e.own), [true, false]);
    // R8: a group reactor with no conversation of their own is named by their number, not the group
    group.addContacts([{ key: 'g:+1555~+1666', name: 'Book Club', addr: '+1555~+1666', group: true, s: 0, lastT: 0, members: [] }]);
    group.rederive({ owners: {}, people: new Map() });
    assert.deepEqual(group.textRx.get(group.msgs[1]), [{ r: '👍', c: 1, n: ['+1555'] }]);
  });
});

describe('spec 027 what counts', () => {
  it('AC10: reactions change no number that isn’t about emoji', () => {
    const base = [sms(0, 0, 'see you soon 😊'), sms(5, 1, 'yes!!'), sms(9, 0, 'great')];
    const withRx = [...base, sms(3, 1, 'Loved “see you soon 😊”'), sms(10, 1, 'Liked “great”')];
    const pick = (D) => {
      const A = aggregateMessages(D.msgs, 3600e3);
      return JSON.stringify([A.dir, A.words, A.replyMedian, A.lenSum, A.starters, A.emojiFreq.size, A.traits]);
    };
    assert.equal(pick(loaded(withRx)), pick(loaded(base)));
  });

  it('AC11: Top emoji stacks typed and reacted per side, and leaves reactions out without them', () => {
    const D = loaded([sms(0, 1, 'love ❤️'), sms(1, 1, 'you ❤️'), sms(2, 0, 'a'), sms(3, 1, 'Loved “a”'), sms(4, 0, 'b'), sms(5, 1, 'Loved “b”'), sms(6, 0, 'c'), sms(7, 1, 'Loved “c”')]);
    const A = aggregateMessages(D.msgs);
    const R = counted(D);
    const heart = (opt) => Object.fromEntries(opt.series.map((s) => [s.name, s.data[opt.yAxis.data.indexOf('❤️')]]));
    assert.deepEqual(heart(emojiOption(ui, A, 20, R).opt), { 'You typed': 2, 'You reacted': 3, 'They typed': 0, 'They reacted': 0 });
    assert.deepEqual(heart(emojiOption(ui, A, 20, null).opt), { Sent: 2, Received: 0 });
  });

  it('AC11: a typed ❤ and a reacted ❤️ are one emoji', () => {
    const D = loaded([
      sms(0, 1, '😂😂😂😂'), sms(1, 1, 'love ❤'), sms(2, 1, 'you ❤'),
      sms(3, 0, 'a'), sms(4, 1, 'Loved “a”'), sms(5, 0, 'b'), sms(6, 1, 'Loved “b”'), sms(7, 0, 'c'), sms(8, 1, 'Loved “c”'),
    ]);
    const opt = emojiOption(ui, aggregateMessages(D.msgs), 20, counted(D)).opt;
    assert.equal(opt.yAxis.data[0], '❤️');
    assert.deepEqual(opt.series.map((s) => s.data[0]), [2, 3, 0, 0]);
    assert.equal(summaryStats(D.msgs, aggregateMessages(D.msgs), { reactions: counted(D) }).emoji[0], '❤️');
  });

  it('AC11a: Emoji over time, the summary image and signature emoji count reactions too', () => {
    const D = loaded([
      sms(0, 1, '😂😂😂'), sms(1, 1, 'love ❤️'), sms(2, 1, 'you ❤️'),
      sms(3, 0, 'a'), sms(4, 1, 'Loved “a”'), sms(5, 0, 'b'), sms(6, 1, 'Loved “b”'), sms(7, 0, 'c'), sms(8, 1, 'Loved “c”'),
    ]);
    const A = aggregateMessages(D.msgs);
    const R = counted(D);
    const trend = emojiTrendWithReactions(aggregateContent(D.msgs), R);
    assert.equal(trend.emojiMonths.get(2024 * 12 + 2).get('❤️'), 5);
    assert.equal(summaryStats(D.msgs, A, { reactions: R }).emoji[0], '❤️');
    assert.equal(summaryStats(D.msgs, A).emoji[0], '😂');

    // Sam's only ❤️ are reactions, and they set Sam apart.
    const two = loaded([
      ...['😂 a', '😂 b', '😂 c', '😂 d', '😂 e'].map((b, i) => ({ ...sms(i, 0, b), k: '+1777' })),
      ...['x', 'y', 'z'].flatMap((b, i) => [sms(10 + i * 2, 0, b), sms(11 + i * 2, 1, `Loved “${b}”`)]),
    ]);
    const A2 = aggregateMessages(two.msgs);
    const R2 = counted(two);
    const freq = withReactionEmoji(A2.emojiFreq, R2);
    assert.equal(signatureEmoji(convoEmojiWithReactions(A2.byContact.get('+1555'), R2, '+1555'), freq, emojiTotal(freq)), '❤️');
  });
});

describe('spec 027 the cards', () => {
  /** A timed reaction event on a message in conversation `k`. */
  const ev = (you, lag, k = 'alex') => ({ r: '❤️', you, who: you ? 'you' : k, t: T0 + lag, mo: 0, m: { k, t: T0, o: 1 - you }, target: { t: T0 }, lag, own: false, s: 0 });

  it('AC12: time to react lands in its bin, and a median needs 10 timed reactions', () => {
    const R = aggregateReactions([ev(1, 30e3), ev(1, 10 * MIN), ev(1, 2 * 86400e3)]);
    const label = (i) => REACT_BINS[i].label;
    assert.deepEqual(R.hist[1].flatMap((n, i) => (n ? [label(i)] : [])), ['< 1 min', '5–15 min', '> 1 day']);
    assert.equal(aggregateReactions(Array.from({ length: 9 }, () => ev(0, MIN))).median[0], null);
    assert.equal(aggregateReactions(Array.from({ length: 10 }, () => ev(0, MIN))).median[0], MIN);
  });

  it('AC13: a reaction with nothing after it from the reactor in the conversation is instead of a reply', () => {
    const quiet = loaded([sms(0, 0, 'news'), sms(1, 1, 'Loved “news”'), sms(30, 0, 'hello?'), sms(200, 1, 'sorry, later')]);
    const replied = loaded([sms(0, 0, 'news'), sms(1, 1, 'Loved “news”'), sms(10, 1, 'wow')]);
    assert.deepEqual([counted(quiet).instead[1], counted(quiet).judged[1]], [1, 1]);
    assert.deepEqual([counted(replied).instead[1], counted(replied).judged[1]], [0, 1]);
  });

  it('AC14: Who reacts the most ranks by reactions, per 100 messages from the other side, from 50 messages each', () => {
    const convo = (n, onOther, reacted) => ({ n, onOther, reacted });
    const R = { byConvo: new Map([['a', convo([10, 5], [10, 5], [8, 5])], ['b', convo([30, 20], [30, 20], [20, 20])], ['c', convo([90, 90], [90, 90], [90, 90])]]) };
    const A = { byContact: new Map([['a', { n: [100, 50] }], ['b', { n: [80, 200] }], ['c', { n: [49, 300] }]]) };
    const rows = reactWhoRows(R, A);
    assert.deepEqual(rows.map((r) => r.k), ['b', 'a']);
    assert.deepEqual([rows[0].themRate, rows[0].youRate, rows[0].themShare], [15, 25, 0.1]);
  });

  it('AC14: only reactions on the other side’s messages count, each message once for the share', () => {
    // Alex hearts all 3 of their own messages, and one of yours twice (❤️ then 😂 from a second app).
    const recs = [];
    for (let i = 0; i < 60; i++) recs.push(sms(i * 2, 0, `alex ${i}`), sms(i * 2 + 1, 1, `you ${i}`));
    recs.push(sms(200, 0, 'Loved “alex 1”'), sms(201, 0, 'Loved “alex 2”'), sms(202, 0, 'Loved “alex 3”'), sms(203, 0, 'Loved “you 50”'));
    const D = loaded(recs);
    const [row] = reactWhoRows(counted(D), aggregateMessages(D.msgs));
    assert.deepEqual([row.them, row.themShare], [1, 1 / 60]);
  });

  it('AC15: the most-reacted messages come first', () => {
    const D = loaded([
      sms(0, 0, 'two'), sms(1, 1, 'Loved “two”'), sms(2, 0, 'Laughed at “two”'),
      sms(3, 1, 'three'), sms(4, 0, 'Loved “three”'), sms(5, 1, 'Liked “three”'),
    ]);
    // Three reactions on "three": add one stored on the message.
    D.msgs.find((m) => m.b === 'three').rx = [{ r: '🔥', c: 1, n: ['Alex'] }];
    D.rederive({ owners: {}, people: new Map() });
    assert.deepEqual(counted(D).top.map((x) => [x.m.b, x.n]), [['three', 3], ['two', 2]]);
  });

  it('AC16: each reaction highlight fires at its threshold and not just below', () => {
    const fire = (R, A = { byContact: new Map() }) => {
      const out = [];
      reactionHighlights(A, { n: [100, 100], median: [null, null], own: [0, 0], instead: [0, 0], judged: [0, 0], byConvo: new Map(), ...R }, {
        add: (kind, score, icon, parts) => out.push({ kind, parts }), person: (k) => ({ k, text: k }), single: false, rows: [],
      });
      return Object.fromEntries(out.map((h) => [h.kind, highlightText(h)]));
    };
    const who = (them) => fire({ byConvo: new Map([['Alex', { n: [them, 0], onOther: [them, 0], reacted: [them, 0] }]]) }, { byContact: new Map([['Alex', { n: [100, 100] }]]) });
    assert.equal(who(20).reactsMost, 'Alex reacts to 1 in 5 of your messages.');
    assert.equal(who(19).reactsMost, undefined);
    assert.equal(fire({ median: [4 * 60e3, 60e3] }).reactSpeed, 'You react in a median of 1m, others in 4m.');
    assert.equal(fire({ median: [3.9 * 60e3, 60e3] }).reactSpeed, undefined);
    assert.equal(fire({ own: [0, 10] }).ownReactions, "You've reacted to your own messages 10 times.");
    assert.equal(fire({ own: [0, 9] }).ownReactions, undefined);
    assert.equal(fire({ instead: [0, 30], judged: [0, 100] }).reactInstead, '30% of your reactions are instead of a reply.');
    assert.equal(fire({ instead: [0, 29], judged: [0, 100] }).reactInstead, undefined);
    assert.equal(fire({ instead: [0, 10], judged: [0, 29] }).reactInstead, undefined);
  });

  it('AC18: reactions.csv and reaction_times.csv have the cards’ numbers and no message text', () => {
    const D = loaded([sms(0, 0, 'zebracorn 😊'), sms(3, 1, 'Loved “zebracorn 😊”'), sms(4, 0, 'more zebracorn'), sms(200, 0, 'Laughed at “more zebracorn”')]);
    const R = counted(D);
    const tables = statsTables(aggregateMessages(D.msgs), null, { reactions: R });
    const file = (name) => tables.find((t) => t.file === name);
    assert.deepEqual(file('reactions.csv').rows, [['❤️', 1, 0], ['😂', 0, 1]]);
    assert.deepEqual(file('reaction_times.csv').rows, REACT_BINS.map((b, i) => [b.label, R.hist[1][i], R.hist[0][i]]));
    assert.ok(!JSON.stringify([file('reactions.csv'), file('reaction_times.csv')]).includes('zebracorn'));
    assert.equal(statsTables(aggregateMessages(D.msgs), null, {}).some((t) => t.file === 'reactions.csv'), false);
  });
});
