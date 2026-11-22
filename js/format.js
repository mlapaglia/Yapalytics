/*
 * Text for numbers, durations, sizes, shares and dates: the one place each format is
 * written down (spec 014 step 8). Dates follow the browser's language, through cached
 * Intl.DateTimeFormat objects, which are cheaper than toLocaleDateString in long lists.
 */

/** "1,234": a count, rounded; "–" for none. */
const fmtNum = (n) => (n == null ? '–' : Math.round(n).toLocaleString());

function fmtDuration(ms) {
  if (ms == null || !isFinite(ms)) return '–';
  const s = ms / 1000;
  if (s < 60) return Math.round(s) + 's';
  if (s < 3600) return Math.round(s / 60) + 'm';
  if (s < 86400) {
    const h = Math.floor(s / 3600);
    const m = Math.round((s % 3600) / 60);
    return m ? `${h}h ${m}m` : `${h}h`;
  }
  return (s / 86400).toFixed(1) + 'd';
}

function fmtBytes(b) {
  if (!b) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(b) / Math.log(1024)));
  return (b / Math.pow(1024, i)).toFixed(i ? 1 : 0) + ' ' + u[i];
}

/** "30 minutes", "1 hour", "6 hours": a conversation gap in words. */
function fmtGapWords(ms) {
  const [n, unit] = ms < 3600e3 ? [ms / 60e3, 'minute'] : [ms / 3600e3, 'hour'];
  return `${n} ${unit}${n === 1 ? '' : 's'}`;
}

/** "30m", "1h", "24h": a conversation gap, short. */
function fmtGapShort(ms) {
  return ms < 3600e3 ? `${ms / 60e3}m` : `${ms / 3600e3}h`;
}

/** "4h 10m", "3 days", "5 months", "2.5 years": how far apart two moments are. */
function fmtGap(ms) {
  const days = ms / 86400000;
  if (days < 1) return fmtDuration(ms);
  const plural = (n, unit) => `${n} ${unit}${n === 1 ? '' : 's'}`;
  if (days < 60) return plural(Math.round(days), 'day');
  if (days < 730) return plural(Math.round(days / 30.44), 'month');
  return `${(days / 365.25).toFixed(1).replace(/\.0$/, '')} years`;
}

/** "42%" for 0.42. */
const pctText = (x) => Math.round(x * 100) + '%';

/** "42%" of a part in a whole, or "–" when the whole is 0. */
const shareText = (a, b) => (b ? Math.round((a / b) * 100) + '%' : '–');

/** "3.5×", "12×": how many times as much. */
const timesText = (x) => (x >= 10 ? Math.round(x) : Math.round(x * 10) / 10) + '×';

/** "1st", "22nd", "113th". */
const ordinal = (n) => fmtNum(n) + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th');

/** "a, b and c". */
const andList = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

const DATE_FORMATS = {
  day: { year: 'numeric', month: 'short', day: 'numeric' }, // Mar 5, 2024
  weekday: { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' }, // Tue, Mar 5, 2024
  long: { year: 'numeric', month: 'long', day: 'numeric' }, // March 5, 2024
  month: { year: 'numeric', month: 'long' }, // March 2024
  monthShort: { year: 'numeric', month: 'short' }, // Mar 2024
  dayOfMonth: { month: 'short', day: 'numeric' }, // Mar 5
  dayOfMonthLong: { month: 'long', day: 'numeric' }, // March 5
  numeric: {}, // 3/5/2024
  time: { hour: 'numeric', minute: '2-digit' }, // 5:29 PM
  hour: { hour: 'numeric' }, // 5 PM
};

/** fmtDate.day(t), fmtDate.month(t)…: a time (ms or Date) in one of DATE_FORMATS. */
const fmtDate = Object.fromEntries(Object.entries(DATE_FORMATS).map(([name, opts]) => {
  let format = null; // made on first use, so loading this file reads nothing from the browser
  return [name, (t) => (format = format || new Intl.DateTimeFormat(undefined, opts)).format(t instanceof Date ? t : new Date(t))];
}));

/** "5 PM": an hour of the day (0–23). */
const hourText = (h) => fmtDate.hour(new Date(2000, 0, 1, h));
