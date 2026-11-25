/*
 * Comparing two periods (spec 021): which dates the other period covers, and the
 * headline numbers, people and hour / weekday profiles of two aggregateMessages results
 * side by side. Pure functions; js/panels/compare.js draws them.
 *
 * B is the dashboard's date range, A the period it's compared with. Changes go from A to B.
 */

const COMPARE_MIN_DAYS = 7; // fewer days of history in A: nothing to compare with (R6)
const COMPARE_SAME = { pct: 0.05, pts: 2, dur: 0.1 }; // smaller changes read "about the same" (R8)
const COMPARE_THIN = { msgs: 20, replies: 10, starts: 8 }; // fewer: the side shows "–" (R9)

const cmpDayStart = (ts) => {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};
const cmpDayEnd = (ts) => {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime() - 1;
};

/** The same date a year earlier, at local midnight; Feb 29 becomes Feb 28. */
function yearEarlier(ts) {
  const d = new Date(ts);
  const y = d.getFullYear() - 1, m = d.getMonth();
  const last = new Date(y, m + 1, 0).getDate();
  return new Date(y, m, Math.min(d.getDate(), last)).getTime();
}

/**
 * Both periods. `range` is the date filter ({ from, to }, null = open), `compare` is
 * View.compare, and `first` / `last` bound the history: the selection's first message at
 * any date, and the last message loaded (Select.periods). Each period is
 * { from, to, span, days }: span counts its calendar days, days only
 * those between `first` and `last` (what per-day numbers divide by). `a` is null when B
 * has an open start: B is then the whole history, with nothing before it (R4).
 */
function comparePeriods(range, compare, { first, last }) {
  const firstDay = tsToDay(first), lastDay = tsToDay(last);
  const period = (from, to) => {
    const f = tsToDay(from), t = tsToDay(to);
    return { from, to, span: t - f + 1, days: Math.max(0, Math.min(t, lastDay) - Math.max(f, firstDay) + 1) };
  };
  const b = period(cmpDayStart(range.from ?? first), cmpDayEnd(range.to ?? last));
  if (range.from == null) return { a: null, b };
  const s = new Date(b.from);
  const before = period(new Date(s.getFullYear(), s.getMonth(), s.getDate() - b.span).getTime(), b.from - 1);
  let a = before;
  if (compare.mode === 'year') a = period(yearEarlier(b.from), cmpDayEnd(yearEarlier(cmpDayStart(b.to))));
  else if (compare.mode === 'custom') {
    const from = compare.from ?? before.from;
    const to = compare.to ?? before.to;
    a = period(cmpDayStart(Math.min(from, to)), cmpDayEnd(Math.max(from, to)));
  }
  return { a, b };
}

/**
 * The change from `a` to `b`: { kind: 'pct' | 'pts' | 'dur' | 'new' | 'same', value, dir }
 * (dir: 1 up, −1 down, 0 the same), or null when a side is missing. Shares are 0–1;
 * 'pts' values are percentage points.
 */
function compareChange(kind, a, b) {
  if (a == null || b == null) return null;
  const same = { kind: 'same', value: 0, dir: 0 };
  if (kind === 'pct') {
    if (a === 0) return b === 0 ? same : { kind: 'new', value: null, dir: 1 };
    const v = b / a - 1;
    return Math.abs(v) < COMPARE_SAME.pct ? same : { kind, value: v, dir: Math.sign(v) };
  }
  if (kind === 'pts') {
    const v = (b - a) * 100;
    return Math.abs(v) < COMPARE_SAME.pts ? same : { kind, value: v, dir: Math.sign(v) };
  }
  const v = b - a; // 'dur': milliseconds
  return Math.abs(v) < COMPARE_SAME.dur * a ? same : { kind, value: v, dir: Math.sign(v) };
}

/** "+38%", "−12%", "+6 pts", "2m faster", "new", "about the same", or '' for no change. */
function compareChangeText(c) {
  if (!c) return '';
  const sign = (v) => (v > 0 ? '+' : '−');
  switch (c.kind) {
    case 'same': return 'about the same';
    case 'new': return 'new';
    case 'pct': return `${sign(c.value)}${fmtNum(Math.abs(c.value) * 100)}%`;
    case 'pts': return `${sign(c.value)}${fmtNum(Math.abs(c.value))} pts`;
    case 'dur': return `${fmtDuration(Math.abs(c.value))} ${c.value < 0 ? 'faster' : 'slower'}`;
    default: return '';
  }
}

const cmpTotal = (X) => X.dir[0] + X.dir[1];
const cmpReplies = (X, o) => X.reply[o].reduce((s, n) => s + n, 0);

/*
 * The headline rows (R7). `get(X, days)` is a period's value or null; `thin(X)` says the
 * side is too thin to show (R9). `fmt` says how the panel writes the value.
 */
const COMPARE_ROWS = [
  { id: 'perDay', label: 'Messages per day', kind: 'pct', fmt: 'num1', get: (X, days) => (days ? cmpTotal(X) / days : null) },
  { id: 'sent', label: 'You sent', kind: 'pts', fmt: 'pct', get: (X) => X.dir[1] / cmpTotal(X), thin: (X) => cmpTotal(X) < COMPARE_THIN.msgs },
  { id: 'active', label: 'Active days', kind: 'pts', fmt: 'pct', get: (X, days) => (days ? Math.min(1, X.activeDays / days) : null) },
  { id: 'convos', label: 'Conversations', kind: 'pct', fmt: 'int', get: (X) => X.contacts.size },
  { id: 'replyYou', label: 'Your reply time', kind: 'dur', fmt: 'dur', get: (X) => X.replyMedian[1], thin: (X) => cmpReplies(X, 1) < COMPARE_THIN.replies },
  { id: 'replyThem', label: 'Their reply time', kind: 'dur', fmt: 'dur', get: (X) => X.replyMedian[0], thin: (X) => cmpReplies(X, 0) < COMPARE_THIN.replies },
  { id: 'start', label: 'You start', kind: 'pts', fmt: 'pct', get: (X) => X.starters[1] / (X.starters[0] + X.starters[1]), thin: (X) => X.starters[0] + X.starters[1] < COMPARE_THIN.starts },
  { id: 'lenSent', label: 'Avg length, sent', kind: 'pct', fmt: 'int', get: (X) => X.lenSum[1] / X.lenN[1], thin: (X) => X.lenN[1] < COMPARE_THIN.msgs },
  { id: 'lenRecv', label: 'Avg length, received', kind: 'pct', fmt: 'int', get: (X) => X.lenSum[0] / X.lenN[0], thin: (X) => X.lenN[0] < COMPARE_THIN.msgs },
  { id: 'emoji', label: 'Emoji per 100 messages', kind: 'pct', fmt: 'num1', get: (X) => ((X.emoji[0] + X.emoji[1]) / cmpTotal(X)) * 100, thin: (X) => cmpTotal(X) < COMPARE_THIN.msgs },
  {
    id: 'media', label: 'Attachments per day', kind: 'pct', fmt: 'num1',
    get: (X, days) => (days ? MEDIA_TYPES.reduce((s, m) => s + X.media[m.key][0] + X.media[m.key][1], 0) / days : null),
  },
  {
    id: 'night', label: 'Night owl', kind: 'pts', fmt: 'pct', thin: (X) => cmpTotal(X) < COMPARE_THIN.msgs,
    get: (X) => {
      let n = 0;
      for (const [night] of X.night.values()) n += night;
      return n / cmpTotal(X);
    },
  },
];

/** R7–R9: [{ id, label, fmt, a, b, change }] for aggregates `A` and `B` over `aDays` and `bDays`. */
function compareRows(A, B, aDays, bDays) {
  const value = (row, X, days) => {
    if (row.thin?.(X)) return null;
    const v = row.get(X, days);
    return v == null || !isFinite(v) ? null : v;
  };
  return COMPARE_ROWS.map((row) => {
    const a = value(row, A, aDays), b = value(row, B, bDays);
    return { id: row.id, label: row.label, fmt: row.fmt, a, b, change: compareChange(row.kind, a, b) };
  });
}

/**
 * R10: the 10 busiest conversations in B with their messages in each period and the
 * change per day; new ones (none in A, 20+ in B) and ones that went quiet (20+ in A,
 * none in B), 5 each, busiest first.
 */
function comparePeople(A, B, aDays, bDays) {
  const n = (X, k) => {
    const c = X.contacts.get(k);
    return c ? c[0] + c[1] : 0;
  };
  const rows = [...new Set([...A.contacts.keys(), ...B.contacts.keys()])].map((k) => ({ k, a: n(A, k), b: n(B, k) }));
  const top = rows.filter((r) => r.b > 0).sort((x, y) => y.b - x.b || y.a - x.a).slice(0, 10)
    .map((r) => ({ ...r, change: aDays && bDays ? compareChange('pct', r.a / aDays, r.b / bDays) : null }));
  const fresh = rows.filter((r) => r.a === 0 && r.b >= COMPARE_THIN.msgs).sort((x, y) => y.b - x.b).slice(0, 5);
  const quiet = rows.filter((r) => r.b === 0 && r.a >= COMPARE_THIN.msgs).sort((x, y) => y.a - x.a).slice(0, 5);
  return { top, fresh, quiet };
}

/** R11: each hour's and weekday's share of a period's messages (0–1; all 0 with no messages). */
function profileShares(X) {
  const total = cmpTotal(X);
  const share = (pair) => pair[0].map((r, i) => (total ? (r + pair[1][i]) / total : 0));
  return { hour: share(X.hour), dow: share(X.dow) };
}
