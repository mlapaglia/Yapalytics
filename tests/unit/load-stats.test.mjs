import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, messageLib as makeLib, makeMessage } from '../helpers/load.mjs';

const { createLoadStats, createDataset, messageLib, vaderLib } = loadApp(['createLoadStats', 'createDataset', 'messageLib', 'vaderLib']);
const lib = makeLib();
const MB = 1024 * 1024;

/** A load of one 10 MB file, read from t = 0. */
function oneFile() {
  const st = createLoadStats({ steps: ['read', 'merge', 'owners', 'draw'], now: 0 });
  const file = {};
  st.beginRead([{ file, name: 'sms.xml', size: 10 * MB, s: 0 }], { msgs: [], calls: [], reactions: 0 }, 0);
  st.step('read', 'sms.xml', 0);
  st.startJob(0, [file], 0);
  return st;
}

describe('spec 016 load stats', () => {
  test('AC6: 1 MB every 100 ms is 10 MB/s, and time left is bytes left over that', () => {
    const st = oneFile();
    const s0 = createLoadStats({ steps: ['read'], now: 0 });
    const file = {};
    s0.beginRead([{ file, name: 'big.xml', size: 100 * MB, s: 0 }], { msgs: [], calls: [], reactions: 0 }, 0);
    s0.step('read', 'big.xml', 0);
    s0.startJob(0, [file], 0);
    for (let t = 100; t <= 3000; t += 100) s0.progress(0, t / 100, 100, t); // 1 MB per 100 ms
    const s = s0.snapshot(3000);
    assert.ok(Math.abs(s.bps - 10 * MB) < 1e-6 * MB, `about 10 MB/s, got ${s.bps / MB}`);
    assert.ok(Math.abs(s.left - ((100 - 30) * MB / (10 * MB)) * 1000) < 1, `left ${s.left}`);
    assert.equal(st.snapshot(0).left, null);
  });

  test('AC6: no time left before 1 s of reading, or with under 1 s to go', () => {
    const st = createLoadStats({ steps: ['read'], now: 0 });
    const file = {};
    st.beginRead([{ file, name: 'a', size: 10 * MB, s: 0 }], { msgs: [], calls: [], reactions: 0 }, 0);
    st.step('read', 'a', 0);
    st.startJob(0, [file], 0);
    st.progress(0, 1, 10, 500);
    assert.equal(st.snapshot(500).left, null, 'before 1 s');
    st.progress(0, 9.5, 10, 1500);
    assert.equal(st.snapshot(1500).left, null, 'under 1 s left');
  });

  test('AC3, AC7: counts, conversations and months follow what was kept', () => {
    const st = oneFile();
    const data = createDataset();
    const msgs = [
      makeMessage(lib, { at: '2024-03-05T10:00:00Z', k: 'alex', body: 'hi' }),
      makeMessage(lib, { at: '2024-03-06T10:00:00Z', k: 'alex', body: 'there', ph: 2, vd: 1 }),
      makeMessage(lib, { at: '2024-05-01T10:00:00Z', k: 'sam', body: 'yo', rx: [{ r: '❤️', c: 2, n: [] }] }),
      makeMessage(lib, { at: '2024-05-01T10:01:00Z', k: 'sam', body: 'Loved “yo”' }),
    ];
    const calls = [{ t: Date.parse('2024-05-02T10:00:00Z'), ty: 1, k: 'pat', o: 0, du: 0 }];
    const res = data.addBatch(msgs, calls);
    st.batch(0, data, res, [{ key: 'alex', name: 'Alex', s: 0, group: false }], 100);
    const s = st.snapshot(100);
    assert.deepEqual(s.counts, { messages: 3, calls: 1, conversations: 3, media: 3, reactions: 3, dupes: 0 });
    const mar = 2024 * 12 + 2;
    const may = 2024 * 12 + 4;
    assert.deepEqual([...s.months], [[mar, 2], [may, 1]]);
    assert.equal(s.first, mar);
    assert.equal(s.last, may);
    assert.equal(s.files[0].msgs, 3);
    assert.equal(s.files[0].calls, 1);
  });

  test('AC4: a batch that was already loaded counts as duplicates', () => {
    const st = oneFile();
    const data = createDataset();
    const msgs = () => [makeMessage(lib, { at: '2024-03-05T10:00:00Z', body: 'hi' }), makeMessage(lib, { at: '2024-03-05T10:01:00Z', body: 'ho' })];
    st.batch(0, data, data.addBatch(msgs(), []), [], 10);
    const res = data.addBatch([...msgs(), makeMessage(lib, { at: '2024-03-05T10:02:00Z', body: 'new' })], []);
    assert.deepEqual(res, { msgFrom: 2, callFrom: 0, dupes: 2 });
    st.batch(0, data, res, [], 20);
    assert.equal(st.snapshot(20).counts.dupes, 2);
    assert.equal(st.snapshot(20).counts.messages, 3);
  });

  test('AC9: steps tick off in order, each with its time', () => {
    const st = createLoadStats({ steps: ['demo', 'check', 'read', 'merge', 'owners', 'draw'], now: 0 });
    st.step('demo', '', 0);
    st.step('check', '', 400);
    st.step('read', 'x', 500);
    let s = st.snapshot(700);
    assert.deepEqual(s.steps.map((x) => [x.id, x.state, x.ms]), [
      ['demo', 'done', 400], ['check', 'done', 100], ['read', 'now', 200], ['merge', 'todo', null], ['owners', 'todo', null], ['draw', 'todo', null],
    ]);
    st.step('merge', '10', 900);
    st.step('owners', '', 950);
    st.step('draw', '', 1000);
    st.end(1200);
    s = st.snapshot(1200);
    assert.ok(s.steps.every((x) => x.state === 'done' && x.ms != null));
    assert.deepEqual(s.steps.map((x) => x.ms), [400, 100, 400, 50, 50, 200]);
  });

  test('AC8: a failed job marks its files failed; a read after it starts the rest again', () => {
    const st = createLoadStats({ steps: ['read'], now: 0 });
    const a = {}, b = {};
    const base = { msgs: [], calls: [], reactions: 0 };
    st.beginRead([{ file: a, name: 'a', size: 10, s: 0 }, { file: b, name: 'b', size: 10, s: 4 }], base, 0);
    st.startJob(0, [a], 0);
    st.endJob(0, {}, 10);
    st.startJob(1, [b], 10);
    st.endJob(1, { error: true }, 20);
    assert.deepEqual(st.snapshot(20).files.map((f) => f.state), ['done', 'failed']);
    st.beginRead([{ file: a, name: 'a', size: 10, s: 0 }], base, 30);
    assert.deepEqual(st.snapshot(30).files.map((f) => f.state), ['waiting', 'failed']);
  });

  test('AC16: conversations found are newest first, 8 at most', () => {
    const st = oneFile();
    const data = createDataset();
    const found = Array.from({ length: 11 }, (_, i) => ({ key: `k${i}`, name: `Name ${i}`, s: 0, group: false }));
    st.batch(0, data, data.addBatch([], []), found.slice(0, 5), 10);
    st.batch(0, data, data.addBatch([], []), found.slice(5), 20);
    const s = st.snapshot(20);
    assert.equal(s.found.length, 8);
    assert.equal(s.foundN, 11);
    assert.deepEqual(s.found.map((c) => c.name).slice(0, 3), ['Name 10', 'Name 9', 'Name 8']);
  });

  test('R15: contactMap hands each new conversation over once, with its name as it is then', () => {
    const { contactMap } = messageLib(vaderLib());
    const map = contactMap();
    const c = { key: '5551', name: '', addr: '+1 555 1', group: false };
    map.set('5551', c);
    c.name = 'Pat Lee';
    map.set('5551', c); // set again: not new
    map.set('g:x', { key: 'g:x', name: '', title: 'Road Trip', group: true, s: 5 });
    assert.deepEqual(map.takeFresh(), [
      { key: '5551', name: 'Pat Lee', s: 0, group: false },
      { key: 'g:x', name: 'Road Trip', s: 5, group: true },
    ]);
    assert.deepEqual(map.takeFresh(), []);
    assert.equal(map.size, 2);
  });
});
