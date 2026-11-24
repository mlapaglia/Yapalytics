import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from '../helpers/load.mjs';

/** Prefs and STORE_KEYS over a fresh in-memory localStorage (or one that throws). */
function prefsWith(saved, { broken = false } = {}) {
  const data = new Map(Object.entries(saved));
  const localStorage = broken
    ? { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } }
    : { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k) };
  const app = loadApp(['Prefs', 'STORE_KEYS', 'CONVO_GAP'], { localStorage });
  app.Prefs.load();
  return { ...app, data };
}

describe('spec 015 saved conversation gap', () => {
  test('AC6: a saved gap from CONVO_GAPS is read back', () => {
    const { Prefs } = prefsWith({ 'yapa-convo-gap': String(3 * 3600e3) });
    assert.equal(Prefs.convoGap, 3 * 3600e3);
  });

  test('AC7: a missing, unreadable or unknown gap is 6 hours', () => {
    for (const v of [undefined, 'abc', '0', '', '7200000', '-3600000']) {
      const { Prefs, CONVO_GAP } = prefsWith(v === undefined ? {} : { 'yapa-convo-gap': v });
      assert.equal(Prefs.convoGap, CONVO_GAP, String(v));
      assert.equal(CONVO_GAP, 6 * 3600e3);
    }
  });

  test('AC6: saving writes the gap, and the default removes it', () => {
    const { Prefs, data } = prefsWith({});
    Prefs.saveConvoGap(3600e3);
    assert.equal(data.get('yapa-convo-gap'), '3600000');
    Prefs.saveConvoGap(6 * 3600e3);
    assert.equal(data.has('yapa-convo-gap'), false);
  });

  test('AC8: with storage throwing, the gap still changes for this page', () => {
    const { Prefs, CONVO_GAP } = prefsWith({}, { broken: true });
    assert.equal(Prefs.convoGap, CONVO_GAP);
    Prefs.saveConvoGap(12 * 3600e3);
    assert.equal(Prefs.convoGap, 12 * 3600e3);
  });
});
