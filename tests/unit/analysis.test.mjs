import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadScripts, makeMessage, messageLib } from '../helpers/load.mjs';

const lib = messageLib();
const msg = (spec) => makeMessage(lib, spec);
const {
  phraseRegex, aggregatePhrase, replyBins, fmtGapWords, fmtGapShort, aggregateMessages, aggregateContent,
  CONVO_GAP, CONVO_GAPS,
} = loadScripts(['parser.js', 'analysis.js'], [
  'phraseRegex', 'aggregatePhrase', 'replyBins', 'fmtGapWords', 'fmtGapShort', 'aggregateMessages', 'aggregateContent',
  'CONVO_GAP', 'CONVO_GAPS',
]);
const HOUR = 3600e3;

describe('phraseRegex', () => {
  const count = (q, text) => (text.match(phraseRegex(q)) || []).length;

  it('matches whole words in any case', () => {
    assert.equal(count('lol', 'lol LOL lollipop'), 2);
  });
  it('lets words be separated by any run of spaces', () => {
    assert.equal(count('love you', 'Love   you!! i love you2 love youuu'), 1);
  });
  it('treats curly and straight apostrophes alike', () => {
    assert.equal(count("don't", 'don’t do it, don\'t'), 2);
  });
  it('counts every emoji in a run', () => {
    assert.equal(count('😂', 'no way 😂😂😂'), 3);
  });
  it('matches regex characters literally', () => {
    assert.equal(count('c++', 'i write c++ and c'), 1);
  });
  it('folds accented capitals', () => {
    assert.equal(count('café', 'CAFÉ café cafés'), 2);
  });
  it('returns null for a blank query', () => {
    assert.equal(phraseRegex('   '), null);
  });
});

describe('aggregatePhrase', () => {
  const msgs = [
    msg({ at: '2024-01-05T10:00:00Z', o: 0, body: 'lol ok' }),
    msg({ at: '2024-01-06T10:00:00Z', o: 1, body: 'LOL lol' }),
    msg({ at: '2024-02-01T10:00:00Z', o: 1, body: 'lollipop' }),
    msg({ at: '2024-02-02T10:00:00Z', o: 0, body: 'Laughed at “lol”' }), // reaction: ignored
    msg({ at: '2024-03-01T10:00:00Z', o: 0, body: 'still lol' }),
  ];
  const P = aggregatePhrase(msgs, phraseRegex('lol'));

  it('counts uses and messages per side ([received, sent])', () => {
    assert.deepEqual(P.uses, [2, 2]);
    assert.deepEqual(P.msgs, [2, 1]);
  });
  it('buckets uses by day', () => {
    assert.deepEqual([...P.days.entries()], [[msgs[0].d, [1, 0]], [msgs[1].d, [0, 2]], [msgs[4].d, [1, 0]]]);
  });
  it("records each side's first use", () => {
    assert.equal(P.first[0], msgs[0]);
    assert.equal(P.first[1], msgs[1]);
  });
});

describe('conversation gap helpers', () => {
  it('defaults to 6 hours and offers it as a choice', () => {
    assert.equal(CONVO_GAP, 6 * HOUR);
    assert.ok(CONVO_GAPS.includes(CONVO_GAP));
  });
  it('labels gaps', () => {
    assert.deepEqual(CONVO_GAPS.map(fmtGapShort), ['30m', '1h', '3h', '6h', '12h', '24h']);
    assert.deepEqual(CONVO_GAPS.map(fmtGapWords), ['30 minutes', '1 hour', '3 hours', '6 hours', '12 hours', '24 hours']);
  });
  it('stops reply bins at the gap, cutting the last one short', () => {
    const labels = (g) => replyBins(g).map((b) => b.label);
    assert.deepEqual(labels(30 * 60e3), ['< 1 min', '1–5 min', '5–15 min', '15–30 min']);
    assert.deepEqual(labels(HOUR), ['< 1 min', '1–5 min', '5–15 min', '15–60 min']);
    assert.deepEqual(labels(6 * HOUR), ['< 1 min', '1–5 min', '5–15 min', '15–60 min', '1–3 h', '3–6 h']);
    assert.deepEqual(labels(12 * HOUR), ['< 1 min', '1–5 min', '5–15 min', '15–60 min', '1–3 h', '3–8 h', '8–12 h']);
    assert.deepEqual(labels(24 * HOUR), ['< 1 min', '1–5 min', '5–15 min', '15–60 min', '1–3 h', '3–8 h', '8–24 h']);
  });
  it('leaves the last reply bin open so a reply right at the gap still lands', () => {
    for (const g of CONVO_GAPS) assert.equal(replyBins(g).at(-1).max, Infinity);
  });
});

describe('aggregateMessages', () => {
  // Me 10:00 → Alex 10:01 (reply, 1 min) → Alex 10:02 (double text) → Me 12:02 (reply, 2 h)
  // → Alex 19:02 (7 h later: a new conversation at 6 h, a reply at 24 h)
  const thread = [
    msg({ at: '2024-08-20T10:00:00Z', o: 1, body: 'hey' }),
    msg({ at: '2024-08-20T10:01:00Z', o: 0, body: 'hi' }),
    msg({ at: '2024-08-20T10:02:00Z', o: 0, body: 'what are you up to?' }),
    msg({ at: '2024-08-20T12:02:00Z', o: 1, body: 'not much' }),
    msg({ at: '2024-08-20T19:02:00Z', o: 0, body: 'dinner?' }),
  ];
  const accounted = (A) => A.starters[0] + A.starters[1] + A.doubleTexts[0] + A.doubleTexts[1] +
    [...A.reply[0], ...A.reply[1]].reduce((a, b) => a + b, 0);

  it('splits conversations after 6 hours of quiet by default', () => {
    const A = aggregateMessages(thread);
    assert.equal(A.gap, 6 * HOUR);
    assert.equal(A.sessions, 2);
    assert.deepEqual(A.starters, [1, 1]);
    assert.deepEqual(A.doubleTexts, [1, 0]);
    assert.deepEqual(A.reply[0], [0, 1, 0, 0, 0, 0]); // Alex: 1–5 min
    assert.deepEqual(A.reply[1], [0, 0, 0, 0, 1, 0]); // me: 1–3 h
    assert.deepEqual(A.sessionHist, [1, 1, 0, 0, 0, 0]); // one 1-message, one 4-message conversation
    assert.equal(A.longestSession.n, 4);
  });

  it('follows a longer gap: one conversation, and the 7-hour answer is a reply', () => {
    const A = aggregateMessages(thread, 24 * HOUR);
    assert.equal(A.sessions, 1);
    assert.deepEqual(A.starters, [0, 1]);
    assert.deepEqual(A.reply[0], [0, 1, 0, 0, 0, 1, 0]); // Alex: 1–5 min and 3–8 h
    assert.equal(A.replyBins.length, 7);
    assert.equal(A.longestSession.n, 5);
  });

  it('accounts for every message as a starter, a reply or a double text, at any gap', () => {
    for (const g of CONVO_GAPS) assert.equal(accounted(aggregateMessages(thread, g)), thread.length, `gap ${g}`);
  });

  it('keeps separate threads apart', () => {
    const other = msg({ at: '2024-08-20T10:00:30Z', o: 0, k: 'sam', body: 'yo' });
    const A = aggregateMessages([thread[0], other, ...thread.slice(1)]);
    assert.equal(A.byContact.size, 2);
    assert.deepEqual(A.byContact.get('sam').starters, [1, 0], "Sam's message isn't a reply to me");
  });

  it('counts direction, hours and words', () => {
    const A = aggregateMessages(thread);
    assert.deepEqual(A.dir, [3, 2]);
    assert.equal(A.hour[1][10], 1);
    assert.equal(A.hour[0][19], 1);
    assert.deepEqual(A.wordFreq.get('dinner'), [1, 0]);
    assert.equal(A.wordFreq.has('what'), false, 'filler words are left out');
  });
});

describe('aggregateContent: vocabulary', () => {
  const july = 2024 * 12 + 6;
  const aug = july + 1;
  const C = aggregateContent([
    msg({ at: '2024-07-01T10:00:00Z', o: 1, body: 'hello world friends' }),
    msg({ at: '2024-07-02T10:00:00Z', o: 0, body: 'hello there' }),
    msg({ at: '2024-08-01T10:00:00Z', o: 1, body: 'hello axolotl axolotl https://www.youtube.com/watch?v=abc' }),
    msg({ at: '2024-08-02T10:00:00Z', o: 0, body: 'world peace 2day' }),
    msg({ at: '2024-08-03T10:00:00Z', o: 0, body: 'Loved “zebra”' }), // reaction: ignored
  ]);

  it('counts different words per month and side, ignoring the pieces of links', () => {
    assert.deepEqual(C.vocab.get(july), [2, 3]);
    assert.deepEqual(C.vocab.get(aug), [3, 2]); // them: world, peace, 2day · me: hello, axolotl
  });

  it('treats every listable word as new in the first month', () => {
    const [them, me] = C.vocabNew.get(july);
    assert.deepEqual(me, { n: 3, top: [['friends', 1], ['hello', 1], ['world', 1]] });
    assert.deepEqual(them, { n: 1, top: [['hello', 1]] }, '"there" is a filler word');
  });

  it("lists each side's first-time words, most used first", () => {
    const [them, me] = C.vocabNew.get(aug);
    assert.deepEqual(me, { n: 1, top: [['axolotl', 2]] }, 'hello was used in July; link words are skipped');
    assert.deepEqual(them, { n: 2, top: [['peace', 1], ['world', 1]] }, 'new for them even though I said it first; 2day has a digit');
  });

  it('leaves reactions out', () => {
    for (const [, sides] of C.vocabNew) for (const s of sides) assert.ok(!s.top.some(([w]) => w === 'zebra'));
  });
});

describe('spec 008: per-conversation counters', () => {
  const at = (iso, o, body = 'hi', rest = {}) => msg({ at: iso, o, k: 'alex', body, ...rest });
  const msgs = [
    at('2024-01-06T07:00:00Z', 1, 'lol how are you?'), // Saturday, early morning
    at('2024-01-06T07:01:00Z', 1, 'love you'), // double text
    at('2024-01-06T07:02:00Z', 0, 'haha good', { ph: 2 }),
    at('2024-01-10T12:00:00Z', 0, 'hey'), // Wednesday, after 3 silent days
  ];
  const bc = aggregateMessages(msgs).byContact.get('alex');

  it('counts traits, double texts, photos and when messages land', () => {
    assert.deepEqual(bc.traits[1], [1, 0, 1, 1, 0]); // Questions, Links, Laughs, Love, ALL CAPS
    assert.deepEqual(bc.traits[0], [0, 0, 1, 0, 0]);
    assert.deepEqual(bc.doubles, [0, 1]);
    assert.deepEqual(bc.ph, [2, 0]);
    assert.equal(bc.weekend, 3);
    assert.equal(bc.morning, 3);
    assert.deepEqual(bc.replyN, [1, 0]);
  });

  it('keeps the longest silence and what came before it', () => {
    assert.deepEqual(bc.longestGap, { len: 3, end: Date.parse('2024-01-10T12:00:00Z'), before: 3 });
  });
});
