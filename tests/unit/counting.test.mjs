/*
 * Spec 028: words are counted in slices (Background) with the same results as in one go.
 */
import { describe, it, beforeEach } from 'node:test';
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

describe('spec 028 counting in slices', () => {
  beforeEach(() => {
    Background.jobs.clear();
    Background.budget = 0; // a step per slice: as many slices as there can be
  });

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

  it('AC7: a dropped job never runs again; only the last one finishes', async () => {
    const steps = [0, 0, 0];
    const job = (i) => (function* () {
      for (let k = 0; k < 50; k++) {
        steps[i]++;
        yield k / 50;
      }
      return i;
    })();
    const done = [];
    Background.run('content', 'a', () => job(0), (v) => done.push(v));
    await new Promise((r) => setTimeout(r, 20)); // let the first one get going
    const first = steps[0];
    assert.ok(first > 0 && first < 50, 'the first job was under way');
    Background.run('content', 'b', () => job(1), (v) => done.push(v));
    const last = new Promise((resolve) => Background.run('content', 'c', () => job(2), (v) => { done.push(v); resolve(); }));
    await last;
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(done, [2]);
    assert.equal(steps[0], first, 'the first job never ran again');
    assert.equal(steps[1], 0, 'the second never started');
    assert.equal(steps[2], 50);
  });
});
