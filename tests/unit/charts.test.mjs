import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from '../helpers/load.mjs';

const { autoGran, bucketOfDay, buildTimeline, fmtBucket, phraseOption, tsToDay } = loadApp(['autoGran', 'bucketOfDay', 'buildTimeline', 'fmtBucket', 'phraseOption', 'tsToDay']);
const day = (iso) => tsToDay(Date.parse(iso));
const iso = (ts) => new Date(ts).toISOString().slice(0, 10);
// Chart options only read colors and sizes from the theme.
const ui = new Proxy({}, { get: (_, k) => (k === 'series' || k === 'heat' ? Array(8).fill('#888') : '#888') });

describe('autoGran', () => {
  it('picks days up to 6 months, weeks up to 3 years, then months', () => {
    assert.equal(autoGran(30), 'day');
    assert.equal(autoGran(180), 'day');
    assert.equal(autoGran(181), 'week');
    assert.equal(autoGran(3 * 365), 'week');
    assert.equal(autoGran(3 * 365 + 1), 'month');
  });
});

describe('bucketOfDay', () => {
  it('starts weeks on Sunday and months on the 1st', () => {
    assert.equal(iso(bucketOfDay(day('2024-08-21'), 'week')), '2024-08-18');
    assert.equal(iso(bucketOfDay(day('2024-08-18'), 'week')), '2024-08-18');
    assert.equal(iso(bucketOfDay(day('2024-08-21'), 'month')), '2024-08-01');
    assert.equal(iso(bucketOfDay(day('2024-08-21'), 'day')), '2024-08-21');
  });
});

describe('buildTimeline', () => {
  const days = new Map([[day('2024-08-01'), [1, 2]], [day('2024-08-03'), [0, 1]], [day('2024-09-15'), [4, 0]]]);

  it('fills empty buckets with zeros', () => {
    const tl = buildTimeline(days, 'day');
    assert.equal(tl.x.length, 46);
    assert.deepEqual([tl.r[0], tl.s[0]], [1, 2]);
    assert.deepEqual([tl.r[1], tl.s[1]], [0, 0]);
  });

  it('sums days into weeks and months', () => {
    const weeks = buildTimeline(days, 'week');
    assert.equal(iso(weeks.x[0]), '2024-07-28');
    assert.deepEqual([weeks.r[0], weeks.s[0]], [1, 3]);
    const months = buildTimeline(days, 'month');
    assert.deepEqual(months.x.map(iso), ['2024-08-01', '2024-09-01']);
    assert.deepEqual(months.r, [1, 4]);
    assert.deepEqual(months.s, [3, 0]);
  });

  it('is empty for no days', () => {
    assert.deepEqual(buildTimeline(new Map(), 'week'), { x: [], s: [], r: [] });
  });
});

describe('fmtBucket', () => {
  it('names the bucket for tooltips', () => {
    const ts = Date.parse('2024-08-18T00:00:00Z');
    assert.match(fmtBucket(ts, 'week'), /^Week of .*2024/);
    assert.match(fmtBucket(ts, 'month'), /2024/);
  });
});

describe('phraseOption', () => {
  const P = { days: new Map([[day('2024-08-02'), [1, 0]], [day('2024-08-20'), [2, 3]]]) };
  const sums = (opt) => opt.series.map((s) => s.data.reduce((a, d) => a + d[1], 0));

  it('spans the whole selection and keeps the totals at every granularity', () => {
    for (const gran of ['day', 'week', 'month']) {
      const opt = phraseOption(ui, P, day('2024-07-15'), day('2024-09-10'), gran);
      assert.deepEqual(sums(opt), [3, 3], gran); // [You, Them]
      assert.equal(iso(opt.series[0].data[0][0]), iso(bucketOfDay(day('2024-07-15'), gran)), gran);
    }
  });

  it('adds a slider over long daily views, opening on the latest 90 days', () => {
    const opt = phraseOption(ui, P, day('2023-01-01'), day('2024-09-10'), 'day');
    const slider = opt.dataZoom.find((z) => z.type === 'slider');
    assert.ok(slider);
    assert.equal(Math.round((slider.endValue - slider.startValue) / 86400000), 89);
    assert.equal(phraseOption(ui, P, day('2024-07-15'), day('2024-09-10'), 'day').dataZoom.some((z) => z.type === 'slider'), false);
  });
});
