/*
 * Daily rhythm (spec 020): when your day starts and ends, stretches when your messages ran
 * on another clock, and days far busier or quieter than normal for a conversation. Pure
 * functions over time-sorted message records; js/panels/activity.js draws them.
 *
 * A rhythm day runs from 4 am to 3:59 am the next morning, so a late night ends the day
 * before. Clock times in it are minutes after 4 am (0–1439): 1:30 am is 1290.
 */

const RHYTHM_DAY_START = 4;
const RHYTHM_MIN_MSGS = 5; // your messages for a rhythm day to count
const RHYTHM_MIN_DAYS = 14; // counted days for the chart
const RHYTHM_WEEK_MIN = 3; // counted days for a week to plot
const RHYTHM_MONTH_MIN = 8; // … and for a month
const RHYTHM_MAX_WEEKS = 104; // more than this, plot months
const RHYTHM_SPLIT_MIN = 10; // counted days for the weekday / weekend times

const AWAY_MIN_UTC = 8; // your messages from UTC apps for a day to have a centre
const AWAY_NEAR = 8; // the baseline leaves out the week each side…
const AWAY_FAR = 35; // …and looks this far
const AWAY_MIN_BASE = 10; // days in the baseline
const AWAY_MIN_SIDE = 4; // days for a side (before or after) to count
const AWAY_AGREE = 120; // minutes the two sides' medians may differ by
const AWAY_STEADY = 0.75; // with one side only: share of its days…
const AWAY_STEADY_MIN = 120; // …within this many minutes of its median
const AWAY_Z = 3; // …and this many times the usual day-to-day spread
const AWAY_SHIFT = 180; // minutes off the baseline for a day to be away
const AWAY_MIN_DAYS = 3; // judged days in a stretch
const AWAY_MAX_STEP = 3; // rhythm days between judged days in a stretch
const AWAY_MAX_SPAN = 42; // longer is a lasting change, not time away

const UNUSUAL_MIN_MSGS = 200;
const UNUSUAL_TOP = 25;
const UNUSUAL_WINDOW = 56;
const UNUSUAL_MIN_HISTORY = 28;
const UNUSUAL_MIN_ACTIVE = 10; // days with messages in the window, to judge a busy day

const DAY_MIN = 1440;

/** The rhythm day a message belongs to (a local day number). */
function rhythmDayOf(r) {
  return r.h >= RHYTHM_DAY_START ? r.d : r.d - 1;
}

/**
 * When rhythm day `d` starts: 4 am local time on that date. Built from the calendar date,
 * so it is 4 am on the days the clocks change too.
 */
function rhythmDayStart(d) {
  const t = new Date(dayToTs(d));
  return new Date(t.getFullYear(), t.getMonth(), t.getDate(), RHYTHM_DAY_START).getTime();
}

/** Minutes after 4 am (0–1439) of a message. */
function clockMinutes(r) {
  return (r.h * 60 + new Date(r.t).getMinutes() - RHYTHM_DAY_START * 60 + DAY_MIN) % DAY_MIN;
}

/** "11:55 PM": a clock time in the day (minutes after 4 am). */
function rhythmClock(min) {
  const m = (Math.round(min) + RHYTHM_DAY_START * 60) % DAY_MIN;
  return fmtDate.time(new Date(2000, 0, 1, Math.floor(m / 60), m % 60));
}

/** Sunday = 0 … Saturday = 6 of a local day number (day 0 was a Thursday). */
const weekdayOfDay = (d) => (((d + 4) % 7) + 7) % 7;

/**
 * Your messages (sent, not reactions) by rhythm day: Map(day -> { n, first, last, utc }),
 * `first` and `last` in minutes after 4 am, `utc` the clock times of those from apps in
 * `utcApps` (a Set of app ids whose times are real instants).
 */
function yourDays(msgs, utcApps) {
  const days = new Map();
  for (const r of msgs) {
    if (!r.o || r.f & T_REACTION) continue;
    const d = rhythmDayOf(r);
    const c = clockMinutes(r);
    let v = days.get(d);
    if (!v) days.set(d, (v = { n: 0, first: c, last: c, utc: [] }));
    v.n++;
    if (c < v.first) v.first = c;
    if (c > v.last) v.last = c;
    if (utcApps.has(r.s || 0)) v.utc.push(c);
  }
  return days;
}

/**
 * Your usual first and last message times (R1–R4): per week, or per month past
 * RHYTHM_MAX_WEEKS weeks, the medians over the counted days, null where too few.
 */
function sleepSchedule(days) {
  const counted = [...days.entries()].filter(([, v]) => v.n >= RHYTHM_MIN_MSGS).sort((a, b) => a[0] - b[0]);
  const times = (list) => (list.length ? { first: median(list.map(([, v]) => v.first)), last: median(list.map(([, v]) => v.last)), n: list.length } : null);
  const out = { counted: counted.length, buckets: [], unit: 'week', usual: null, weekday: null, weekend: null };
  if (counted.length < RHYTHM_MIN_DAYS) return out;
  out.usual = times(counted);
  const weekend = counted.filter(([d]) => [0, 6].includes(weekdayOfDay(d)));
  const weekday = counted.filter(([d]) => ![0, 6].includes(weekdayOfDay(d)));
  if (weekday.length >= RHYTHM_SPLIT_MIN) out.weekday = times(weekday);
  if (weekend.length >= RHYTHM_SPLIT_MIN) out.weekend = times(weekend);

  const weekOf = (d) => d - ((weekdayOfDay(d) + 6) % 7); // the Monday
  const monthOf = (d) => { const t = new Date(dayToTs(d)); return t.getFullYear() * 12 + t.getMonth(); };
  const firstWeek = weekOf(counted[0][0]), lastWeek = weekOf(counted[counted.length - 1][0]);
  const byMonth = (lastWeek - firstWeek) / 7 + 1 > RHYTHM_MAX_WEEKS;
  out.unit = byMonth ? 'month' : 'week';
  const groups = new Map();
  for (const e of counted) {
    const key = byMonth ? monthOf(e[0]) : weekOf(e[0]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  const min = byMonth ? RHYTHM_MONTH_MIN : RHYTHM_WEEK_MIN;
  const from = byMonth ? monthOf(counted[0][0]) : firstWeek;
  const to = byMonth ? monthOf(counted[counted.length - 1][0]) : lastWeek;
  for (let key = from; key <= to; key += byMonth ? 1 : 7) {
    const list = groups.get(key) || [];
    const t = list.length >= min ? times(list) : null;
    out.buckets.push({ start: byMonth ? monthToTs(key) : dayToTs(key), first: t?.first ?? null, last: t?.last ?? null, n: list.length });
  }
  return out;
}

/** The signed difference a − b on the 24-hour circle, in −720…720 minutes. */
function clockDiff(a, b) {
  let x = (a - b) % DAY_MIN;
  if (x >= DAY_MIN / 2) x -= DAY_MIN;
  if (x < -DAY_MIN / 2) x += DAY_MIN;
  return x;
}

/** Circular mean of clock times (minutes), in 0–1439. */
function circularMean(mins) {
  let s = 0, c = 0;
  for (const m of mins) {
    const a = (m / DAY_MIN) * 2 * Math.PI;
    s += Math.sin(a);
    c += Math.cos(a);
  }
  const a = Math.atan2(s, c);
  return (((a / (2 * Math.PI)) * DAY_MIN) % DAY_MIN + DAY_MIN) % DAY_MIN;
}

/** Circular median: the value that's closest, around the circle, to all the others. */
function circularMedian(mins) {
  let best = null, bestSum = Infinity;
  for (const x of mins) {
    let sum = 0;
    for (const y of mins) sum += Math.abs(clockDiff(x, y));
    if (sum < bestSum) { bestSum = sum; best = x; }
  }
  return best;
}

/**
 * Stretches when your messages from UTC apps ran on another clock (R6–R8): [{ from, to
 * (rhythm days), shift (hours, signed), days (judged days) }], oldest first.
 *
 * A day is judged against the surrounding weeks (AWAY_NEAR to AWAY_FAR days each side),
 * and only when they show one usual clock. With days on both sides, the two sides must
 * agree: around a move or a long trip they don't, and the day says nothing about being
 * away. With one side only (the start or end of the history, or weeks of silence), that
 * side must be steady (AWAY_STEADY of its days within AWAY_STEADY_MIN of its median) and
 * match your clock over the whole selection.
 */
function awayStretches(days) {
  const centres = [];
  for (const [d, v] of days) if (v.n >= RHYTHM_MIN_MSGS && v.utc.length >= AWAY_MIN_UTC) centres.push({ d, c: circularMean(v.utc) });
  centres.sort((a, b) => a.d - b.d);
  const steady = (cs, base) => cs.filter((c) => Math.abs(clockDiff(c, base)) <= AWAY_STEADY_MIN).length >= AWAY_STEADY * cs.length;
  // Your clock over the whole selection: a one-sided baseline must match it too, or the
  // last weeks after a long trip would be judged against the trip.
  const overall = centres.length ? circularMedian(centres.map((x) => x.c)) : 0;
  const judged = [];
  let start = 0; // the first day in the window
  for (const x of centres) {
    const before = [], after = [];
    while (centres[start].d < x.d - AWAY_FAR) start++;
    for (let i = start; i < centres.length && centres[i].d <= x.d + AWAY_FAR; i++) {
      const y = centres[i];
      const gap = y.d - x.d;
      if (gap <= -AWAY_NEAR) before.push(y.c);
      else if (gap >= AWAY_NEAR) after.push(y.c);
    }
    let base, ref;
    if (before.length >= AWAY_MIN_SIDE && after.length >= AWAY_MIN_SIDE) {
      if (before.length + after.length < AWAY_MIN_BASE) continue;
      if (Math.abs(clockDiff(circularMedian(before), circularMedian(after))) > AWAY_AGREE) continue;
      ref = [...before, ...after];
      base = circularMedian(ref);
    } else {
      ref = before.length >= AWAY_MIN_SIDE ? before : after;
      if (ref.length < AWAY_MIN_BASE) continue;
      base = circularMedian(ref);
      if (!steady(ref, base) || Math.abs(clockDiff(base, overall)) > AWAY_AGREE) continue;
    }
    // How far an ordinary day strays from the baseline (a robust standard deviation, over
    // the days less than AWAY_SHIFT off it, so a trip in the window doesn't widen it): a
    // day is away only when it's well outside that, as well as AWAY_SHIFT off.
    const devs = ref.map((c) => Math.abs(clockDiff(c, base))).filter((x) => x < AWAY_SHIFT);
    const spread = devs.length ? 1.4826 * median(devs) : 0;
    judged.push({ d: x.d, base, shift: clockDiff(x.c, base), need: Math.max(AWAY_SHIFT, AWAY_Z * spread) });
  }

  // Runs of judged days that far off, in the same direction.
  const cores = [];
  let run = [];
  const close = () => {
    if (run.length >= AWAY_MIN_DAYS) cores.push(run);
    run = [];
  };
  for (const j of judged) {
    const away = Math.abs(j.shift) >= j.need;
    const prev = run[run.length - 1];
    if (prev && (!away || Math.sign(j.shift) !== Math.sign(prev.shift) || j.d - prev.d > AWAY_MAX_STEP)) close();
    if (away) run.push(j);
  }
  close();

  // The days at the ends of a longer trip can't be judged (the weeks on one side are
  // partly away), so each run grows over the days next to it that are still off the
  // run's baseline the same way.
  const index = new Map(centres.map((x, i) => [x.d, i]));
  const stretches = [];
  for (const core of cores) {
    const base = circularMedian(core.map((j) => j.base));
    const need = median(core.map((j) => j.need));
    const sign = Math.sign(core[0].shift);
    const off = (x) => {
      const s = clockDiff(x.c, base);
      return Math.sign(s) === sign && Math.abs(s) >= need;
    };
    let lo = index.get(core[0].d), hi = index.get(core[core.length - 1].d);
    while (lo > 0 && centres[lo].d - centres[lo - 1].d <= AWAY_MAX_STEP && off(centres[lo - 1])) lo--;
    while (hi < centres.length - 1 && centres[hi + 1].d - centres[hi].d <= AWAY_MAX_STEP && off(centres[hi + 1])) hi++;
    const last = stretches[stretches.length - 1];
    if (last && last.lo <= hi && lo <= last.hi && last.sign === sign) { last.lo = Math.min(last.lo, lo); last.hi = Math.max(last.hi, hi); }
    else stretches.push({ lo, hi, base, sign });
  }

  const out = [];
  for (const { lo, hi, base } of stretches) {
    const from = centres[lo].d, to = centres[hi].d;
    if (to - from + 1 > AWAY_MAX_SPAN) continue;
    const shifts = centres.slice(lo, hi + 1).map((x) => clockDiff(x.c, base));
    out.push({ from, to, shift: Math.round(median(shifts) / 60), days: hi - lo + 1 });
  }
  return out;
}

/** In ascending integer array `a`, the first index whose value is above `x` (a.length if none). */
function firstAbove(a, x) {
  let lo = 0, hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (a[mid] > x) hi = mid; else lo = mid + 1;
  }
  return lo;
}

/** The median of a[lo..hi), which is sorted ascending and not empty. */
function sortedMedian(a, lo, hi) {
  const len = hi - lo, mid = lo + (len >> 1);
  return len % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

/**
 * A robust standard deviation of a[lo..hi) (sorted ascending) around its median `m`: 1.4826
 * times the median distance from `m`, and at least √m and 1. The distances are read in
 * order by walking out from `m` both ways.
 */
function spread(a, lo, hi, m) {
  const len = hi - lo;
  let r = lo;
  while (r < hi && a[r] < m) r++;
  let l = r - 1;
  let prev = 0, cur = 0;
  for (let step = 0; step <= len >> 1; step++) {
    prev = cur;
    if (l >= lo && (r >= hi || m - a[l] <= a[r] - m)) cur = m - a[l--];
    else cur = a[r++] - m;
  }
  const mad = len % 2 ? cur : (prev + cur) / 2;
  return Math.max(1.4826 * mad, Math.sqrt(m), 1);
}

/**
 * Days far busier or quieter than normal for a conversation (R11, R12): [{ d, k, n, usual,
 * kind: 'busy' | 'quiet', score }], best first. Each day is judged against the
 * UNUSUAL_WINDOW days before it, once there are UNUSUAL_MIN_HISTORY of them.
 */
function unusualDays(msgs, { minMessages = UNUSUAL_MIN_MSGS, top = UNUSUAL_TOP } = {}) {
  const perConv = new Map(); // k -> Map(day -> n)
  const totals = new Map();
  for (const r of msgs) {
    let m = perConv.get(r.k);
    if (!m) perConv.set(r.k, (m = new Map()));
    m.set(r.d, (m.get(r.d) || 0) + 1);
    totals.set(r.k, (totals.get(r.k) || 0) + 1);
  }
  const convs = [...totals].filter(([, n]) => n >= minMessages).sort((a, b) => b[1] - a[1]).slice(0, top);
  const out = [];
  for (const [k] of convs) {
    const byDay = perConv.get(k);
    const keys = [...byDay.keys()];
    const first = Math.min(...keys), last = Math.max(...keys);
    const counts = [];
    for (let d = first; d <= last; d++) counts.push(byDay.get(d) || 0);
    // Length of the run of empty days each day sits in.
    const emptyRun = new Array(counts.length).fill(0);
    for (let i = 0; i < counts.length;) {
      if (counts[i]) { i++; continue; }
      let j = i;
      while (j < counts.length && !counts[j]) j++;
      for (let x = i; x < j; x++) emptyRun[x] = j - i;
      i = j;
    }
    // The window's counts, kept sorted as it slides: its median, and that of the days with
    // messages (a suffix of it), are read off it without sorting each day.
    const win = [];
    for (let i = 0; i < counts.length; i++) {
      if (i >= UNUSUAL_MIN_HISTORY) {
        const n = counts[i];
        // Busy: against the days that had messages, so a conversation that's quiet most days
        // but long when it happens doesn't make every ordinary chat a spike.
        const active = firstAbove(win, 0);
        let busy = false;
        if (n >= 30 && win.length - active >= UNUSUAL_MIN_ACTIVE) {
          const m = sortedMedian(win, active, win.length);
          if (n >= 3 * Math.max(m, 1)) {
            const s = spread(win, active, win.length, m);
            busy = (n - m) / s >= 5;
            if (busy) out.push({ d: first + i, k, n, usual: m, kind: 'busy', score: (n - m) / s });
          }
        }
        // Quiet: against every day, so only a conversation busy nearly every day has quiet days.
        const m = busy ? 0 : sortedMedian(win, 0, win.length);
        if (m >= 15 && n <= 0.15 * m && emptyRun[i] < 3) out.push({ d: first + i, k, n, usual: m, kind: 'quiet', score: (m - n) / spread(win, 0, win.length, m) });
      }
      // Slide: the window for day i + 1 is days i + 1 - UNUSUAL_WINDOW to i.
      win.splice(firstAbove(win, counts[i]), 0, counts[i]);
      if (i >= UNUSUAL_WINDOW) win.splice(firstAbove(win, counts[i - UNUSUAL_WINDOW] - 1), 1);
    }
  }
  return out.sort((a, b) => b.score - a.score || b.d - a.d);
}

/** The days the Unusual days card lists: the best `limit`, at most `perConv` from one conversation, newest first. */
function unusualList(days, { limit = 10, perConv = 2 } = {}) {
  const used = new Map();
  const out = [];
  for (const x of days) {
    if ((used.get(x.k) || 0) >= perConv) continue;
    used.set(x.k, (used.get(x.k) || 0) + 1);
    out.push(x);
    if (out.length >= limit) break;
  }
  return out.sort((a, b) => b.d - a.d);
}

/** R3: "Usually 8:40 AM – 11:55 PM · Weekdays … · Weekends …", or '' without enough days. */
function rhythmNoteText(sched) {
  if (!sched.usual) return '';
  const span = (x) => `${rhythmClock(x.first)} – ${rhythmClock(x.last)}`;
  return [`Usually ${span(sched.usual)}`, sched.weekday && `Weekdays ${span(sched.weekday)}`, sched.weekend && `Weekends ${span(sched.weekend)}`]
    .filter(Boolean).join(' · ');
}

/** "Mar 3 – Mar 12, 2024", or with both years when they differ. */
function dayRangeText(from, to) {
  const a = dayToTs(from), b = dayToTs(to);
  return new Date(a).getFullYear() === new Date(b).getFullYear()
    ? `${fmtDate.dayOfMonth(a)} – ${fmtDate.day(b)}`
    : `${fmtDate.day(a)} – ${fmtDate.day(b)}`;
}

/** "6 hours later" / "1 hour earlier". */
function shiftText(hours) {
  const n = Math.abs(hours);
  return `${n} hour${n === 1 ? '' : 's'} ${hours > 0 ? 'later' : 'earlier'}`;
}
