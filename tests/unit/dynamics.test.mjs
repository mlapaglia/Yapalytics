import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, makeMessage, messageLib } from '../helpers/load.mjs';

const lib = messageLib();
const { aggregateMessages, buildHighlights, highlightText, styleMatch, styleSeries, TURN_BINS } = loadApp([
  'aggregateMessages', 'buildHighlights', 'highlightText', 'styleMatch', 'styleSeries', 'TURN_BINS',
]);
const DAY = 86400000;
const MIN = 60e3;
const START = Date.parse('2024-01-01T12:00:00Z');

/** Builds messages: say(dayOffset, minuteOffset, o, body, k). */
function builder() {
  const out = [];
  const say = (d, m, o, body = 'hey', k = 'alex') => out.push(makeMessage(lib, { at: new Date(START + d * DAY + m * MIN).toISOString(), o, k, body }));
  // A message far after everything else, in another thread, so every conversation above is settled.
  const done = (d = 1000) => say(d, 0, 1, 'later', 'zed');
  const msgs = () => out.sort((a, b) => a.t - b.t);
  return { say, done, msgs };
}

const kinds = (msgs, opts = {}) => {
  const A = aggregateMessages(msgs);
  const hl = buildHighlights(msgs, A, { labelFor: (k) => ({ alex: 'Alex' })[k] || k, limit: Infinity, ...opts });
  return Object.fromEntries(hl.map((h) => [h.kind, highlightText(h)]));
};

describe('spec 017 how two people talk', () => {
  it('AC1: a settled you → them → you conversation is your last word; one only they wrote is their no reply', () => {
    const b = builder();
    b.say(0, 0, 1); b.say(0, 5, 0); b.say(0, 10, 1);
    b.say(2, 0, 0);
    b.done();
    const A = aggregateMessages(b.msgs());
    assert.deepEqual(A.endings.last, [0, 1]);
    // zed's lone message is the last in the selection, so it isn't settled
    assert.deepEqual(A.endings.none, [1, 0]);
    const bc = A.byContact.get('alex');
    assert.deepEqual(bc.lastWord, [0, 1]);
    assert.deepEqual(bc.noReply, [1, 0]);
  });

  it('AC2: a conversation less than one gap before the last message doesn’t count', () => {
    const b = builder();
    b.say(0, 0, 1); b.say(0, 5, 0, 'is it?');
    b.say(0, 30, 1, 'unrelated', 'zed'); // the selection's last message, 25 minutes later
    const A = aggregateMessages(b.msgs());
    assert.deepEqual(A.endings, { last: [0, 0], none: [0, 0] });
    assert.deepEqual(A.questionReplies.asked, [0, 0]);
    assert.equal(A.sessions, 2); // still counted as conversations elsewhere
  });

  it('AC3: group chat messages don’t count towards endings, questions, turns or style', () => {
    const b = builder();
    for (let d = 0; d < 30; d++) { b.say(d, 0, 1, 'ready?', 'g:club'); b.say(d, 1, 0, 'yes', 'g:club'); }
    b.done();
    const A = aggregateMessages(b.msgs().filter((m) => m.k !== 'zed'));
    assert.deepEqual(A.endings, { last: [0, 0], none: [0, 0] });
    assert.deepEqual(A.questionReplies.asked, [0, 0]);
    assert.deepEqual(A.turns, [0, 0]);
    assert.equal(A.styleMonths.size, 0);
    assert.equal(A.byContact.get('g:club').style.size, 0);
  });

  it('AC4: a question followed by the other side’s message is replied; one left hanging isn’t; two in a row are both replied', () => {
    const b = builder();
    b.say(0, 0, 1, 'how are you?'); b.say(0, 2, 0, 'fine');
    b.say(1, 0, 1, 'still there?');
    b.say(2, 0, 1, 'dinner?'); b.say(2, 1, 1, 'or lunch?'); b.say(2, 5, 0, 'dinner');
    b.say(3, 0, 0, 'you free?'); b.say(3, 1, 0, 'hello');
    b.done();
    const A = aggregateMessages(b.msgs());
    assert.deepEqual(A.questionReplies.asked, [1, 4]);
    assert.deepEqual(A.questionReplies.replied, [0, 3]);
    assert.deepEqual(A.byContact.get('alex').qReplied, [0, 3]);
  });

  it('AC5: three of yours then one of theirs is one turn of 3 for you and one turn of 1 for them', () => {
    const b = builder();
    b.say(0, 0, 1); b.say(0, 1, 1); b.say(0, 2, 1); b.say(0, 3, 0);
    const A = aggregateMessages(b.msgs());
    const bin = (n) => TURN_BINS.findIndex((x) => n <= x.max);
    assert.equal(A.turnHist[1][bin(3)], 1);
    assert.equal(A.turnHist[0][bin(1)], 1);
    assert.deepEqual(A.turns, [1, 1]);
    assert.deepEqual(A.turnMsgs, [1, 3]);
  });

  it('AC6: the same markers match 100, rare markers are skipped, and a thin window isn’t counted', () => {
    // [messages, words, emoji, questions, laughs, love, caps, swearing]
    assert.equal(styleMatch([20, 100, 0, 5, 0, 0, 0, 0], [40, 200, 0, 10, 0, 0, 0, 0]), 100);
    // words per message 5 vs 15: 1 − 10/20 = 0.5; questions 0.25 vs 0.25: 1 → 75
    assert.equal(styleMatch([20, 100, 0, 5, 0, 0, 0, 0], [20, 300, 0, 5, 0, 0, 0, 0]), 75);
    // one swear against none is under 10 on the two sides together: skipped
    assert.equal(styleMatch([20, 100, 0, 5, 0, 0, 0, 1], [20, 300, 0, 5, 0, 0, 0, 0]), 75);
    assert.equal(styleMatch([0, 0, 0, 0, 0, 0, 0, 0], [20, 300, 0, 5, 0, 0, 0, 0]), null);
    const side = (n) => [n, n * 2, 0, 0, 0, 0, 0, 0];
    const months = new Map([
      [100, [side(10), side(10)]], // 10 a side: too few alone
      [101, [side(10), side(10)]],
      [102, [side(10), side(10)]], // with the 2 months before: 30 a side
      [110, [side(29), side(40)]], // nothing in the months before: too few
    ]);
    assert.deepEqual(styleSeries(months), [[102, 100]]);
  });

  it('AC6: a month with only a photo still gets a point when its window has enough text', () => {
    const b = builder();
    for (let i = 0; i < 15; i++) {
      for (const d of [i, 31 + i]) { b.say(d, 0, 1, 'see you soon'); b.say(d, 1, 0, 'see you soon'); } // 15 a side in January and in February
    }
    b.say(60, 0, 0, ''); // March: one photo, no text
    const msgs = b.msgs();
    msgs[msgs.length - 1].ph = 1;
    const A = aggregateMessages(msgs);
    const months = styleSeries(A.byContact.get('alex').style).map(([mo]) => mo % 12);
    assert.deepEqual(months, [1, 2]); // January alone is too few; February's and March's windows have 30 a side
  });

  it('AC7: lastWord names who usually sends the final message', () => {
    const b = builder();
    for (let i = 0; i < 40; i++) {
      if (i < 32) { b.say(i, 0, 1, 'hi'); b.say(i, 2, 0, 'hey'); }
      else { b.say(i, 0, 0, 'hey'); b.say(i, 2, 1, 'hi'); }
    }
    b.done();
    assert.equal(kinds(b.msgs()).lastWord, 'Alex gets the last word in 80% of your conversations.');
  });

  it('AC8: noReply counts the times one side wrote and heard nothing back', () => {
    const b = builder();
    for (let i = 0; i < 20; i++) b.say(i, 0, 1, 'hello');
    for (let i = 20; i < 22; i++) b.say(i, 0, 0, 'hello');
    for (let i = 22; i < 42; i++) { b.say(i, 0, i % 2, 'hi'); b.say(i, 2, 1 - (i % 2), 'hey'); }
    b.done();
    assert.equal(kinds(b.msgs()).noReply, '20 times you messaged Alex and heard nothing back within 6 hours. It went the other way 2 times.');
  });

  it('AC9: questionReplies compares how often each side’s questions get a reply', () => {
    const b = builder();
    let d = 0;
    for (let i = 0; i < 36; i++, d++) { b.say(d, 0, 1, 'free?'); b.say(d, 2, 0, 'sure'); }
    for (let i = 0; i < 4; i++, d++) b.say(d, 0, 1, 'free?');
    for (let i = 0; i < 16; i++, d++) { b.say(d, 0, 0, 'free?'); b.say(d, 2, 1, 'sure'); }
    for (let i = 0; i < 24; i++, d++) b.say(d, 0, 0, 'free?');
    b.done();
    assert.equal(kinds(b.msgs()).questionReplies, '90% of your questions get a reply from Alex, but only 40% of theirs get one from you.');
  });

  it('AC9: the 25-point rule is on the exact difference: 24.5 points don’t fire, 25 do', () => {
    const run = (askEach, yoursReplied, theirsReplied) => {
      const b = builder();
      let d = 0;
      for (let i = 0; i < askEach; i++, d++) { b.say(d, 0, 1, 'free?'); if (i < yoursReplied) b.say(d, 2, 0, 'sure'); }
      for (let i = 0; i < askEach; i++, d++) { b.say(d, 0, 0, 'free?'); if (i < theirsReplied) b.say(d, 2, 1, 'sure'); }
      b.done();
      return kinds(b.msgs()).questionReplies;
    };
    assert.equal(run(200, 150, 101), undefined); // 75% vs 50.5%
    assert.equal(run(40, 36, 26), '90% of your questions get a reply from Alex, but only 65% of theirs get one from you.');
  });

  it('AC10: converge names a conversation whose styles moved together', () => {
    const b = builder();
    for (let mo = 0; mo < 14; mo++) {
      for (let i = 0; i < 20; i++) {
        const d = mo * 31 + i;
        b.say(d, 0, 1, mo < 7 ? 'hello there my friend how are you doing today 😂😂' : 'ok then');
        b.say(d, 2, 0, 'ok then');
      }
    }
    b.done();
    assert.match(kinds(b.msgs()).converge, /^You and Alex write more alike than you used to: style match up from \d+ to 100\.$/);
  });

  it('AC11: one conversation uses the single sentences', () => {
    const b = builder();
    for (let i = 0; i < 40; i++) {
      if (i < 32) { b.say(i, 0, 1, 'hi'); b.say(i, 2, 0, 'hey'); }
      else { b.say(i, 0, 0, 'hey'); b.say(i, 2, 1, 'hi'); }
    }
    b.say(1000, 0, 1, 'later');
    const k = kinds(b.msgs(), { single: true });
    assert.equal(k.lastWord, 'Alex gets the last word in 80% of conversations here.');
  });
});
