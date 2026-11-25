import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, makeMessage, messageLib } from '../helpers/load.mjs';

const lib = messageLib();
const {
  aggregateMessages, buildHighlights, highlightText, rhythmDayOf, clockMinutes, rhythmClock, yourDays, sleepSchedule,
  awayStretches, unusualDays, unusualList, rhythmNoteText, timesText, rhythmDayStart,
} = loadApp([
  'aggregateMessages', 'buildHighlights', 'highlightText', 'rhythmDayOf', 'clockMinutes', 'rhythmClock', 'yourDays', 'sleepSchedule',
  'awayStretches', 'unusualDays', 'unusualList', 'rhythmNoteText', 'timesText', 'rhythmDayStart',
]);

const UTC = new Set([0, 1, 4, 5, 6]);
const D0 = Date.UTC(2024, 0, 1) / 86400000; // Mon, Jan 1, 2024 as a day number (tests run in UTC)
const plain = (s) => s.replace(/\s/g, ' ');

/** A message on day `i` after Jan 1, 2024, `min` minutes after midnight (may run past 24 h). */
const at = (i, min, { o = 1, k = 'alex', s = 0, body = 'hi' } = {}) =>
  makeMessage(lib, { at: new Date(Date.UTC(2024, 0, 1 + i, 0, min)).toISOString(), o, k, s, body });

const sorted = (msgs) => msgs.sort((a, b) => a.t - b.t);

/** One counted day: `n` of your messages, evenly from `first` to `last` (minutes after midnight). */
function day(i, first, last, n = 5, opts) {
  return Array.from({ length: n }, (_, j) => at(i, Math.round(first + ((last - first) * j) / (n - 1)), opts));
}

/** AC8's history: 10 of your messages a day from 9 AM to 11 PM, shifted `shift` hours on days [from, from + len). */
function awayHistory({ shift = 6, from = 27, len = 7, total = 60, s = 0 } = {}) {
  const out = [];
  for (let i = 0; i < total; i++) {
    const h = i >= from && i < from + len ? shift : 0;
    out.push(...day(i, (9 + h) * 60, (23 + h) * 60, 10, { s }));
  }
  return sorted(out);
}

const rhythmOf = (msgs) => {
  const days = yourDays(msgs, UTC);
  return { days, schedule: sleepSchedule(days), away: awayStretches(days) };
};

const highlights = (msgs, opts = {}) => {
  const A = aggregateMessages(msgs);
  const hl = buildHighlights(msgs, A, { labelFor: (k) => ({ alex: 'Alex', zed: 'Zed' })[k] || k, limit: Infinity, ...opts });
  return Object.fromEntries(hl.map((h) => [h.kind, plain(highlightText(h))]));
};

describe('spec 020 daily rhythm', () => {
  describe('your day', () => {
    it('AC1: 1:30 am belongs to the day before, shows as 1:30 AM and sorts after 11 PM', () => {
      const late = at(64, 90); // Tue, Mar 5, 2024 at 1:30 am
      const evening = at(63, 23 * 60);
      assert.equal(rhythmDayOf(late), D0 + 63);
      assert.equal(clockMinutes(late), 1290);
      assert.equal(plain(rhythmClock(clockMinutes(late))), '1:30 AM');
      assert.ok(clockMinutes(late) > clockMinutes(evening));
      const days = yourDays(sorted([evening, late]), UTC);
      assert.equal(days.get(D0 + 63).last, 1290);
    });

    it('AC2: a day needs 5 of your messages to count; received ones don’t count', () => {
      const msgs = [];
      for (let i = 0; i < 14; i++) msgs.push(...day(i, 600, 1200, 5));
      msgs.push(...day(20, 600, 1200, 4), ...day(20, 600, 1200, 30, { o: 0 }));
      assert.equal(sleepSchedule(yourDays(sorted(msgs), UTC)).counted, 14);
      msgs.push(at(20, 1210));
      assert.equal(sleepSchedule(yourDays(sorted(msgs), UTC)).counted, 15);
    });

    it('AC3: a week with 2 counted days is a gap; first messages at 7, 8 and 9 AM give 8 AM', () => {
      const msgs = [];
      [7, 8, 9].forEach((h, i) => msgs.push(...day(i, h * 60, 22 * 60))); // Mon–Wed, Jan 1–3
      msgs.push(...day(7, 600, 1300), ...day(8, 600, 1300)); // Jan 8–9: 2 days
      for (let i = 14; i < 19; i++) msgs.push(...day(i, 600, 1300));
      for (let i = 21; i < 26; i++) msgs.push(...day(i, 600, 1300));
      const s = sleepSchedule(yourDays(sorted(msgs), UTC));
      assert.equal(s.unit, 'week');
      assert.equal(s.buckets.length, 4);
      assert.equal(plain(rhythmClock(s.buckets[0].first)), '8:00 AM');
      assert.equal(s.buckets[1].first, null);
      assert.equal(s.buckets[1].n, 2);
    });

    it('AC4: weekday and weekend times, each with 10+ days', () => {
      const msgs = [];
      let weekend = 0, weekday = 0;
      for (let i = 0; weekday < 20 || weekend < 10; i++) {
        const dow = (i + 1) % 7; // Jan 1, 2024 was a Monday
        if (dow === 0 || dow === 6) { if (weekend < 10) { msgs.push(...day(i, 600, 25 * 60)); weekend++; } }
        else if (weekday < 20) { msgs.push(...day(i, 480, 1380)); weekday++; }
      }
      const s = sleepSchedule(yourDays(sorted(msgs), UTC));
      const note = plain(rhythmNoteText(s));
      assert.match(note, /^Usually \S+ \S\S – \S+ \S\S · Weekdays 8:00 AM – 11:00 PM · Weekends 10:00 AM – 1:00 AM$/);
      const fewer = sorted(msgs.filter((m) => !(m.w === 6 && m.d === Math.max(...msgs.filter((x) => x.w === 6).map((x) => x.d)))));
      assert.doesNotMatch(plain(rhythmNoteText(sleepSchedule(yourDays(fewer, UTC)))), /Weekends/);
    });

    it('AC5: more than 104 weeks are plotted by month', () => {
      const msgs = [];
      for (let i = 0; i < 110 * 7; i += 2) msgs.push(...day(i, 600, 1300));
      const s = sleepSchedule(yourDays(sorted(msgs), UTC));
      assert.equal(s.unit, 'month');
      assert.ok(s.buckets.length >= 25 && s.buckets.length <= 27);
      // Every whole month has its median; a month with fewer than 8 counted days (the last, cut short) is a gap.
      assert.ok(s.buckets.every((b) => (b.n >= 8 ? b.first === 600 - 240 : b.first === null)));
      assert.ok(s.buckets.filter((b) => b.first != null).length >= 25);
    });

    it('AC6: 13 counted days are too few for the chart', () => {
      const msgs = [];
      for (let i = 0; i < 13; i++) msgs.push(...day(i, 600, 1300));
      const s = sleepSchedule(yourDays(sorted(msgs), UTC));
      assert.equal(s.counted, 13);
      assert.deepEqual(s.buckets, []);
      assert.equal(rhythmNoteText(s), '');
    });

    it('AC7: bedtime says you sign off later; 30 minutes doesn’t fire; one conversation never shows it', () => {
      const history = (late) => {
        const msgs = [];
        for (let i = 0; i < 456; i++) msgs.push(...day(i, 18 * 60, i < 365 ? 23 * 60 + 30 : late, 5));
        return sorted(msgs);
      };
      const msgs = history(24 * 60 + 45);
      assert.equal(highlights(msgs, { rhythm: rhythmOf(msgs) }).bedtime,
        "You've been signing off 1h 15m later in the last 3 months than in the year before: around 12:45 AM, up from 11:30 PM.");
      const small = history(24 * 60);
      assert.equal(highlights(small, { rhythm: rhythmOf(small) }).bedtime, undefined);
      assert.equal(highlights(msgs, { rhythm: rhythmOf(msgs), single: true }).bedtime, undefined);
    });
  });

  describe('time away', () => {
    it('AC8: 7 days running 6 hours late make one stretch', () => {
      assert.deepEqual(awayStretches(yourDays(awayHistory(), UTC)), [{ from: D0 + 27, to: D0 + 33, shift: 6, days: 7 }]);
    });

    it('AC11: a rhythm day starts at 4 am local time, on the days the clocks change too', () => {
      assert.equal(rhythmDayStart(D0 + 27), Date.UTC(2024, 0, 28, 4));
      const tz = process.env.TZ;
      try {
        process.env.TZ = 'America/New_York';
        const day = (m, d) => Date.UTC(2024, m, d) / 86400000;
        assert.equal(rhythmDayStart(day(2, 10)), Date.UTC(2024, 2, 10, 8)); // clocks went forward at 2 am: 4 am EDT
        assert.equal(rhythmDayStart(day(10, 3)), Date.UTC(2024, 10, 3, 9)); // clocks went back at 2 am: 4 am EST
      } finally {
        process.env.TZ = tz;
      }
    });

    it('AC9: a 2-hour shift, a shift on only 2 days, or one that lasts 50 days give none', () => {
      assert.deepEqual(awayStretches(yourDays(awayHistory({ shift: 2 }), UTC)), []);
      assert.deepEqual(awayStretches(yourDays(awayHistory({ len: 2 }), UTC)), []);
      assert.deepEqual(awayStretches(yourDays(awayHistory({ from: 50, len: 50, total: 150 }), UTC)), []);
    });

    it('AC9: a shift that starts and never ends (a move) gives none', () => {
      assert.deepEqual(awayStretches(yourDays(awayHistory({ from: 60, len: 1000, total: 120 }), UTC)), []);
    });

    it('AC20: a 30-day trip is one stretch over all 30 days, though its first and last days can’t be judged alone', () => {
      assert.deepEqual(awayStretches(yourDays(awayHistory({ from: 50, len: 30, total: 150 }), UTC)), [{ from: D0 + 50, to: D0 + 79, shift: 6, days: 30 }]);
    });

    it('AC21: a trip in the last days of the history is found; the weeks after a long trip aren’t taken for one', () => {
      assert.deepEqual(awayStretches(yourDays(awayHistory({ from: 52, len: 7, total: 62 }), UTC)).map((x) => [x.from, x.to, x.shift]), [[D0 + 52, D0 + 58, 6]]);
      assert.deepEqual(awayStretches(yourDays(awayHistory({ from: 5, len: 7, total: 60 }), UTC)).map((x) => [x.from, x.to, x.shift]), [[D0 + 5, D0 + 11, 6]]);
      assert.deepEqual(awayStretches(yourDays(awayHistory({ from: 50, len: 50, total: 120 }), UTC)), []);
    });

    it('AC22: a year of messages at random hours of the day gives no stretch', () => {
      let seed = 11;
      const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      // The demo's hour weights: mostly afternoon and evening, some after midnight.
      const W = [3, 1.5, 0.6, 0.3, 0.2, 0.3, 1, 3, 5, 6, 6, 7, 9, 8, 7, 7, 8, 9, 11, 12, 13, 12, 9, 6];
      const total = W.reduce((a, b) => a + b, 0);
      const hour = () => { let x = rand() * total; for (let h = 0; h < 24; h++) if ((x -= W[h]) < 0) return h; return 23; };
      const msgs = [];
      for (let i = 0; i < 365; i++) for (let j = 0; j < 12; j++) msgs.push(at(i, hour() * 60 + Math.floor(rand() * 60)));
      assert.deepEqual(awayStretches(yourDays(sorted(msgs), UTC)), []);
    });

    it('AC10: the same history from WhatsApp gives no stretch', () => {
      const days = yourDays(awayHistory({ s: 2 }), UTC);
      assert.ok([...days.values()].every((v) => v.utc.length === 0));
      assert.deepEqual(awayStretches(days), []);
    });

    it('AC18: away names the stretch, and never for one conversation', () => {
      const msgs = awayHistory();
      assert.equal(highlights(msgs, { rhythm: rhythmOf(msgs) }).away,
        'From Jan 28 to Feb 3, 2024 your messages ran about 6 hours later than usual. Away somewhere?');
      assert.equal(highlights(msgs, { rhythm: rhythmOf(msgs), single: true }).away, undefined);
    });
  });

  describe('unusual days', () => {
    /** `perDay(i)` messages from them on each of `days` days, at noon. */
    const conv = (k, days, perDay) => {
      const out = [];
      for (let i = 0; i < days; i++) for (let j = 0; j < perDay(i); j++) out.push(at(i, 600 + j, { o: 0, k }));
      return out;
    };
    const normal = (i) => 18 + (i % 5); // 18–22, about 20

    it('AC12: a day of 200 among days of about 20 is busy, 10× usual; a day of 45 isn’t', () => {
      const msgs = sorted(conv('alex', 90, (i) => (i === 60 ? 200 : i === 75 ? 45 : normal(i))));
      const days = unusualDays(msgs);
      assert.equal(days.length, 1);
      const [x] = days;
      assert.deepEqual([x.d, x.k, x.n, x.usual, x.kind], [D0 + 60, 'alex', 200, 20, 'busy']);
      assert.equal(timesText(x.n / x.usual), '10×');
    });

    it('AC13: a day of 2 among days of about 40 is quiet; a run of 10 empty days lists none', () => {
      const quiet = unusualDays(sorted(conv('alex', 90, (i) => (i === 60 ? 2 : 38 + (i % 5)))));
      assert.deepEqual(quiet.map((x) => [x.d, x.kind]), [[D0 + 60, 'quiet']]);
      const gap = unusualDays(sorted(conv('alex', 90, (i) => (i >= 50 && i < 60 ? 0 : 38 + (i % 5)))));
      assert.deepEqual(gap, []);
    });

    it('AC23: in a conversation that talks every third day, an ordinary day of 40 isn’t busy, and 200 is, against those days', () => {
      const sparse = (big) => sorted(conv('alex', 120, (i) => (i % 3 ? 0 : i === 90 ? big : 38 + (i % 5))));
      assert.deepEqual(unusualDays(sparse(40)), []);
      const [x] = unusualDays(sparse(200));
      assert.deepEqual([x.d, x.kind, x.usual], [D0 + 90, 'busy', 40]);
    });

    it('AC14: a spike in the first 28 days isn’t listed, and a conversation of 150 isn’t judged', () => {
      assert.deepEqual(unusualDays(sorted(conv('alex', 90, (i) => (i === 10 ? 200 : normal(i))))), []);
      assert.deepEqual(unusualDays(sorted(conv('zed', 40, (i) => (i === 35 ? 100 : 1)))), []);
    });

    it('AC15: the list holds at most 10 days and 2 from one conversation, newest first', () => {
      const msgs = [];
      for (const k of ['a', 'b', 'c', 'd', 'e', 'f']) msgs.push(...conv(k, 120, (i) => ([40, 60, 80, 100].includes(i) ? 200 : normal(i))));
      const list = unusualList(unusualDays(sorted(msgs)));
      assert.equal(list.length, 10);
      const per = new Map();
      for (const x of list) per.set(x.k, (per.get(x.k) || 0) + 1);
      assert.ok([...per.values()].every((n) => n <= 2));
      for (let i = 1; i < list.length; i++) assert.ok(list[i - 1].d >= list[i].d);
    });

    it('AC17: spike names a big day with someone, unless it is the busiest day; "here" for one conversation', () => {
      const alex = conv('alex', 90, (i) => (i === 60 ? 200 : normal(i)));
      const zed = conv('zed', 1, () => 300); // the busiest day, too early to be judged
      const both = sorted([...alex, ...zed]);
      assert.equal(highlights(both, { unusual: unusualDays(both) }).spike, 'Fri, Mar 1, 2024 was a big day with Alex: 200 messages, 10× a normal day.');
      const only = sorted([...alex]);
      assert.equal(highlights(only, { unusual: unusualDays(only) }).spike, undefined);
      const single = sorted(conv('alex', 90, (i) => (i === 60 ? 200 : i === 5 ? 300 : normal(i))));
      assert.equal(highlights(single, { unusual: unusualDays(single), single: true }).spike, 'Fri, Mar 1, 2024 was a big day here: 200 messages, 10× a normal day.');
    });
  });
});
