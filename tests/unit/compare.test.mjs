import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, makeMessage, messageLib } from '../helpers/load.mjs';

const lib = messageLib();
const {
  aggregateMessages, comparePeriods, compareRows, comparePeople, compareChange, compareChangeText, profileShares, compareHeadline,
} = loadApp(['aggregateMessages', 'comparePeriods', 'compareRows', 'comparePeople', 'compareChange', 'compareChangeText', 'profileShares', 'compareHeadline']);

const MIN = 60e3;
const DAY = 86400e3;
const day = (y, m, d) => new Date(y, m - 1, d).getTime();
const endOf = (y, m, d) => new Date(y, m - 1, d + 1).getTime() - 1;
const HISTORY = { first: day(2020, 1, 1), last: day(2026, 11, 1) };

/** `n` messages from `start`, one every `every` ms, with `sent` of them yours. */
function run(start, n, { sent = 0, k = 'alex', every = 3 * 3600e3, body = 'hey there' } = {}) {
  return Array.from({ length: n }, (_, i) => makeMessage(lib, { at: new Date(start + i * every).toISOString(), o: i < sent ? 1 : 0, k, body }));
}
const sorted = (msgs) => msgs.sort((a, b) => a.t - b.t);
const row = (rows, id) => rows.find((r) => r.id === id);

describe('spec 021 comparing two periods', () => {
  it('AC1: the period before has the same number of days, ending the day before', () => {
    const { a, b } = comparePeriods({ from: day(2026, 3, 1), to: endOf(2026, 5, 31) }, { mode: 'before' }, HISTORY);
    assert.equal(b.days, 92);
    assert.equal(a.days, 92);
    assert.equal(a.from, day(2025, 11, 29));
    assert.equal(a.to, endOf(2026, 2, 28));
  });

  it('AC2: a year earlier moves the dates back a year, and Feb 29 becomes Feb 28', () => {
    const { a } = comparePeriods({ from: day(2026, 3, 1), to: endOf(2026, 5, 31) }, { mode: 'year' }, HISTORY);
    assert.equal(a.from, day(2025, 3, 1));
    assert.equal(a.to, endOf(2025, 5, 31));
    const leap = comparePeriods({ from: day(2024, 2, 1), to: endOf(2024, 2, 29) }, { mode: 'year' }, HISTORY);
    assert.equal(leap.a.from, day(2023, 2, 1));
    assert.equal(leap.a.to, endOf(2023, 2, 28));
  });

  it('AC3: a period that starts before the first message counts only its days with history', () => {
    const P = comparePeriods(
      { from: day(2026, 4, 1), to: endOf(2026, 4, 30) },
      { mode: 'custom', from: day(2026, 1, 1), to: endOf(2026, 3, 31) },
      { first: day(2026, 3, 1) + 10 * 3600e3, last: day(2026, 4, 30) },
    );
    assert.equal(P.a.span, 90);
    assert.equal(P.a.days, 31);
  });

  it('AC4: 900 messages over 90 days against 1,800 is 10 and 20 a day, +100%', () => {
    const A = aggregateMessages(run(day(2026, 1, 1), 900, { every: 90 * DAY / 900 }));
    const B = aggregateMessages(run(day(2026, 4, 1), 1800, { every: 90 * DAY / 1800 }));
    const r = row(compareRows(A, B, 90, 90), 'perDay');
    assert.equal(r.a, 10);
    assert.equal(r.b, 20);
    assert.equal(compareChangeText(r.change), '+100%');
  });

  it('AC5: you sent 40% then 46% is +6 pts; 10 messages in a period is too few to show', () => {
    const A = aggregateMessages(sorted(run(day(2026, 1, 1), 100, { sent: 40 })));
    const B = aggregateMessages(sorted(run(day(2026, 4, 1), 100, { sent: 46 })));
    assert.equal(compareChangeText(row(compareRows(A, B, 30, 30), 'sent').change), '+6 pts');
    const thin = aggregateMessages(sorted(run(day(2026, 1, 1), 10, { sent: 4 })));
    const r = row(compareRows(thin, B, 30, 30), 'sent');
    assert.equal(r.a, null);
    assert.equal(r.change, null);
  });

  it('AC6: your reply time from 10m to 4m is "6m faster"; 9 replies is too few', () => {
    const replies = (start, n, wait) => sorted(Array.from({ length: n }, (_, i) => [
      makeMessage(lib, { at: new Date(start + i * DAY).toISOString(), o: 0, body: 'you there' }),
      makeMessage(lib, { at: new Date(start + i * DAY + wait).toISOString(), o: 1, body: 'yes' }),
    ]).flat());
    const A = aggregateMessages(replies(day(2026, 1, 1), 15, 10 * MIN));
    const B = aggregateMessages(replies(day(2026, 4, 1), 15, 4 * MIN));
    assert.equal(compareChangeText(row(compareRows(A, B, 30, 30), 'replyYou').change), '6m faster');
    const few = aggregateMessages(replies(day(2026, 4, 1), 9, 4 * MIN));
    const r = row(compareRows(A, few, 30, 30), 'replyYou');
    assert.equal(r.b, null);
    assert.equal(r.change, null);
  });

  it('AC7: 100 and 103 a day is about the same; 0 and 40 is new', () => {
    assert.equal(compareChangeText(compareChange('pct', 100, 103)), 'about the same');
    assert.equal(compareChangeText(compareChange('pct', 0, 40)), 'new');
    // The same through the attachments row
    const pics = (start, n, ph) => run(start, n).map((m) => Object.assign(m, { ph }));
    const A = aggregateMessages(pics(day(2026, 1, 1), 30, 0));
    const B = aggregateMessages(pics(day(2026, 4, 1), 30, 1));
    assert.equal(compareChangeText(row(compareRows(A, B, 30, 30), 'media').change), 'new');
  });

  it('AC8: the top list, New and Went quiet', () => {
    const A = aggregateMessages(sorted([...run(day(2026, 1, 1), 10, { k: 'alex' }), ...run(day(2026, 1, 1), 50, { k: 'jo' })]));
    const B = aggregateMessages(sorted([
      ...run(day(2026, 4, 1), 100, { k: 'alex' }), ...run(day(2026, 4, 1), 40, { k: 'sam' }), ...run(day(2026, 4, 1), 15, { k: 'kim' }),
    ]));
    const { top, fresh, quiet } = comparePeople(A, B, 30, 30);
    const alex = top.find((r) => r.k === 'alex');
    assert.deepEqual([alex.a, alex.b], [10, 100]);
    assert.equal(compareChangeText(alex.change), '+900%');
    assert.deepEqual(fresh.map((r) => r.k), ['sam']);
    assert.deepEqual(quiet.map((r) => r.k), ['jo']);
    assert.ok(!fresh.some((r) => r.k === 'kim') && !quiet.some((r) => r.k === 'kim'));
  });

  it('AC9: hour shares and weekday shares each add up to 100%', () => {
    const X = aggregateMessages(run(day(2026, 1, 1), 500, { every: 77 * MIN }));
    const { hour, dow } = profileShares(X);
    const sum = (xs) => xs.reduce((s, x) => s + x, 0);
    assert.equal(hour.length, 24);
    assert.equal(dow.length, 7);
    assert.ok(Math.abs(sum(hour) - 1) < 1e-9);
    assert.ok(Math.abs(sum(dow) - 1) < 1e-9);
  });

  it('AC10: custom periods of 30 and 60 days compare per day, and the header says so', () => {
    const P = comparePeriods(
      { from: day(2026, 3, 1), to: endOf(2026, 4, 29) },
      { mode: 'custom', from: day(2026, 1, 1), to: endOf(2026, 1, 30) },
      HISTORY,
    );
    assert.deepEqual([P.a.days, P.b.days], [30, 60]);
    assert.match(compareHeadline(P), /compared with .* · 60 days and 30 days\. Changes compare messages per day\.$/);
    const A = aggregateMessages(run(P.a.from, 300, { every: 30 * DAY / 300 }));
    const B = aggregateMessages(run(P.b.from, 600, { every: 60 * DAY / 600 }));
    const r = row(compareRows(A, B, P.a.days, P.b.days), 'perDay');
    assert.deepEqual([r.a, r.b], [10, 10]);
    assert.equal(compareChangeText(r.change), 'about the same');
    // Equal periods say so once
    const even = comparePeriods({ from: day(2026, 3, 1), to: endOf(2026, 5, 31) }, { mode: 'before' }, HISTORY);
    assert.equal(compareHeadline(even), 'Mar 1 – May 31, 2026 compared with Nov 29, 2025 – Feb 28, 2026 · 92 days each');
  });

  it('R4: with an open start there is nothing before to compare with', () => {
    assert.equal(comparePeriods({ from: null, to: null }, { mode: 'before' }, HISTORY).a, null);
  });
});
