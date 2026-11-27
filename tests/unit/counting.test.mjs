/*
 * Spec 028: words are counted in slices (Background) with the same results as in one go.
 */
import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, messageLib, makeMessage } from '../helpers/load.mjs';

const {
  Background, aggregateContent, aggregateContentSteps, buildDocFreq, buildDocFreqSteps, conversationTerms, conversationTermsSteps,
} = loadApp(['Background', 'aggregateContent', 'aggregateContentSteps', 'buildDocFreq', 'buildDocFreqSteps', 'conversationTerms', 'conversationTermsSteps']);
const lib = messageLib();

/** Run `makeSteps()` as a background job in `slot`; resolves with its result. */
const inSlices = (makeSteps, slot = 'test') => new Promise((resolve) => Background.run(slot, Symbol(slot), makeSteps, resolve));

const BODIES = [
  'see you at the station tomorrow morning', 'that was hilarious 😂😂', 'check this https://example.com/a/b out',
  'did you get the tickets?', 'thanks so much, really appreciate it', 'sorry I missed your call', 'see you at the station later',
  'nos vemos mañana en la estación', 'merci beaucoup pour le dîner', 'Loved “see you at the station”', 'teh station is closed', '*the',
  'the blue heron is back at the pond', 'the blue heron flew off again', 'pizza tonight?', 'ok', '❤️',
];

/** A few thousand messages over a 1-on-1, a group and another 1-on-1, over a couple of years. */
function messages() {
  const out = [];
  const start = Date.UTC(2023, 0, 1);
  for (let i = 0; i < 4500; i++) {
    const k = i % 5 === 0 ? 'g:team' : i % 3 === 0 ? 'sam' : 'alex';
    const at = new Date(start + i * 3.7 * 3600e3).toISOString();
    const extra = k === 'g:team' ? { sn: ['Kim', 'Lee', 'Max'][i % 3] } : {};
    out.push(makeMessage(lib, { at, k, o: i % 2, body: BODIES[(i * 7) % BODIES.length], ...extra }));
  }
  return out;
}

/** A job of `n` steps, counting the steps it ran in `ran[i]`; each step moves `clock` on by `ms`. */
const job = (ran, i, n = 50, clock = null, ms = 0) => (function* () {
  for (let k = 0; k < n; k++) {
    ran[i]++;
    if (clock) clock.t += ms;
    yield k / n;
  }
  return i;
})();

describe('spec 028 counting in slices', () => {
  const schedule = Background.schedule;
  beforeEach(() => {
    Background.jobs.clear();
    Background.budget = 0; // a step per slice: as many slices as there can be
    Background.schedule = schedule;
  });
  /** Slices then run only when the test calls Background.slice(). */
  const byHand = () => { Background.schedule = () => {}; };

  it('AC1: sliced counts equal counting in one go', async () => {
    const msgs = messages();
    for (const sel of [msgs, msgs.filter((m) => m.k === 'alex'), msgs.filter((m) => m.k === 'g:team')]) {
      assert.deepStrictEqual(await inSlices(() => aggregateContentSteps(sel, 'vader')), aggregateContent(sel, 'vader'));
    }
    const df = buildDocFreq(msgs);
    assert.deepStrictEqual(await inSlices(() => buildDocFreqSteps(msgs)), df);
    for (const k of ['alex', 'g:team']) {
      const own = msgs.filter((m) => m.k === k);
      assert.deepStrictEqual(await inSlices(() => conversationTermsSteps(own, df)), conversationTerms(own, df));
    }
  });

  it('AC1: buildDocFreq yields while adding up words too, with progress going up to 1', () => {
    // 30 conversations of 1,000 words each that no other uses: 30,000 to add up after the last message.
    const msgs = Array.from({ length: 3000 }, (_, i) => ({ k: `c${i % 30}`, b: Array.from({ length: 10 }, (_, w) => `w${i}x${w}`).join(' '), f: 0 }));
    const seen = [];
    const steps = buildDocFreqSteps(msgs);
    let r;
    while (!(r = steps.next()).done) seen.push(r.value);
    assert.equal(r.value.df.size, 30000);
    assert.ok(seen.some((p) => p > 0.9 && p < 1), 'a yield while adding up, after the messages');
    assert.ok(seen.every((p, i) => p > 0 && p <= 1 && (i === 0 || p > seen[i - 1])), 'progress goes up, within 0–1');
  });

  it('AC1: aggregateContent yields while working out new words per month too', () => {
    // 30,000 words used once each, over a year: 30,000 to go through after the last message.
    const msgs = Array.from({ length: 3000 }, (_, i) => makeMessage(lib, { at: new Date(Date.UTC(2023, 0, 1) + i * 3 * 3600e3).toISOString(), k: 'alex', o: i % 2, body: Array.from({ length: 10 }, (_, w) => `w${i}x${w}`).join(' ') }));
    const seen = [];
    const steps = aggregateContentSteps(msgs, 'vader');
    let r;
    while (!(r = steps.next()).done) seen.push(r.value);
    assert.deepStrictEqual(r.value, aggregateContent(msgs, 'vader'));
    assert.ok(seen.some((p) => p > 0.9 && p < 1), 'a yield after the messages');
    assert.ok(seen.every((p, i) => p > 0 && p <= 1 && (i === 0 || p >= seen[i - 1])), 'progress goes up, within 0–1');
  });

  it('AC7: a dropped job never runs again; only the last one finishes', () => {
    byHand();
    const ran = [0, 0, 0];
    const done = [];
    Background.run('content', 'a', () => job(ran, 0), (v) => done.push(v));
    for (let i = 0; i < 3; i++) Background.slice();
    assert.equal(ran[0], 3, 'the first job was under way');
    Background.run('content', 'b', () => job(ran, 1), (v) => done.push(v));
    Background.run('content', 'c', () => job(ran, 2), (v) => done.push(v));
    while (Background.jobs.size) Background.slice();
    assert.deepEqual(done, [2]);
    assert.equal(ran[0], 3, 'the first job never ran again');
    assert.equal(ran[1], 0, 'the second never started');
    assert.equal(ran[2], 50);
  });

  it('AC9: small selections asked for in one turn are counted at once only until syncMs is spent', async () => {
    byHand();
    Background.syncMs = 25;
    // A clock that only the jobs move: each of their steps takes 2 ms.
    const clock = { t: 1000 };
    mock.method(performance, 'now', () => clock.t);
    try {
      const ran = [0, 0, 0, 0];
      const done = [];
      const ask = (i, steps) => {
        Background.run(`terms:${i}`, i, () => job(ran, i, steps, clock, 2), (v) => done.push(v));
        Background.finishInTurn(`terms:${i}`, i);
      };
      ask(0, 5); // 10 ms: done at once
      ask(1, 15); // 30 ms: stopped at the first step that ends past the turn's 25 ms
      ask(2, 5); // nothing left this turn
      assert.deepEqual(done, [0]);
      assert.equal(ran[1], 8, 'the second ran from 10 ms to 26 ms');
      assert.equal(ran[2], 0);
      await null; // the turn is over: the next one gets its own 25 ms
      ask(3, 5);
      assert.deepEqual(done, [0, 3]);
      assert.equal(ran[2], 0, 'a job left to slices waits for them');
      while (Background.jobs.size) Background.slice(); // the rest go on in slices
      assert.deepEqual(done, [0, 3, 1, 2]);
      assert.deepEqual(ran, [5, 15, 5, 5], 'nothing ran twice');
    } finally {
      mock.restoreAll();
      Background.syncMs = 50;
    }
  });
});
