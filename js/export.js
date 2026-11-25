/*
 * Exporting stats (spec 026): the numbers behind the dashboard as CSV files, one per
 * table, or all of them in a zip. Pure functions over aggregateMessages and
 * aggregateCalls; js/ui/export-dialog.js shows them and saves the files. No message
 * text goes into a file: only counts, times, durations, app names, emoji and names.
 *
 * Also the small zip writer (no compression) the demo builds its exports with.
 */

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MEDIA_COLUMNS = { ph: 'photos', vd: 'videos', gf: 'gifs', au: 'audio', ot: 'other_files' };

// Dates are local YYYY-MM-DD: isoDay and pad2 from js/ai-analysis.js.
/** YYYY-MM of a month number (year * 12 + month). */
const isoMonth = (mo) => `${Math.floor(mo / 12)}-${pad2((mo % 12) + 1)}`;
/** A fraction with up to 4 decimals, or null when there's nothing to divide by. */
const shareOf = (a, b) => (b ? Math.round((a / b) * 1e4) / 1e4 : null);
/** Whole seconds of a duration in ms, or null. */
const secondsOf = (ms) => (ms == null ? null : Math.round(ms / 1000));
/** An average with up to 2 decimals, or null. */
const avgOf = (sum, n) => (n ? Math.round((sum / n) * 100) / 100 : null);

/**
 * What a conversation and a group sender are called in the files: their names, or with
 * `anon` "Conversation N" and "Sender N", numbered by messages (most first) so a number
 * means the same conversation in every file. Calls-only conversations come after.
 */
function exportNames(A, C, { anon, labelFor, senderLabel }) {
  if (!anon) return { conv: labelFor, sender: senderLabel };
  const byCount = (a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  const conv = new Map();
  for (const [k] of [...A.byContact].map(([k, bc]) => [k, bc.n[0] + bc.n[1]]).sort(byCount)) conv.set(k, `Conversation ${conv.size + 1}`);
  if (C) for (const [k] of [...C.contacts].map(([k, v]) => [k, v.n]).sort(byCount)) if (!conv.has(k)) conv.set(k, `Conversation ${conv.size + 1}`);
  const sender = new Map();
  for (const [x] of [...A.groupSenders].filter(([x]) => x !== 'You').sort(byCount)) sender.set(x, `Sender ${sender.size + 1}`);
  return { conv: (k) => conv.get(k), sender: (x) => (x === 'You' ? 'You' : sender.get(x)) };
}

/**
 * The tables of R3: [{ file, title, header, rows }], values raw (R4). `C` is
 * aggregateCalls of the selection's calls, or null. `appsOf(k)` gives a conversation's
 * app ids; `sources` is the app registry ({ id, kind, name }).
 */
function statsTables(A, C, { anon = false, labelFor = (k) => k, senderLabel = (x) => x, appsOf = () => [0], sources = [] } = {}) {
  const names = exportNames(A, C, { anon, labelFor, senderLabel });
  const appName = (id) => sources.find((s) => s.id === id)?.name ?? String(id);
  const tables = [];
  const add = (file, title, header, rows) => tables.push({ file, title, header, rows });

  // summary.csv
  const media = (o) => MEDIA_TYPES.reduce((s, m) => s + A.media[m.key][o], 0);
  let night = 0;
  for (const [n] of A.night.values()) night += n;
  const keys = [...A.contacts.keys()];
  add('summary.csv', 'Summary', ['metric', 'value'], [
    ['messages', A.dir[0] + A.dir[1]],
    ['sent', A.dir[1]],
    ['received', A.dir[0]],
    ['first_message', A.first == null ? null : isoDay(A.first)],
    ['last_message', A.last == null ? null : isoDay(A.last)],
    ['active_days', A.activeDays],
    ['span_days', A.spanDays],
    ['busiest_day', A.busiestDay ? isoDay(dayToTs(A.busiestDay.d)) : null],
    ['busiest_day_messages', A.busiestDay ? A.busiestDay.n : null],
    ['longest_streak_days', A.longestStreak.len],
    ['longest_silence_days', A.longestSilence.len],
    ['conversations', keys.length],
    ['group_chats', keys.filter((k) => k.startsWith('g:')).length],
    ['your_median_reply_s', secondsOf(A.replyMedian[1])],
    ['their_median_reply_s', secondsOf(A.replyMedian[0])],
    ['words_sent', A.words[1]],
    ['words_received', A.words[0]],
    ['emoji_sent', A.emoji[1]],
    ['emoji_received', A.emoji[0]],
    ['attachments_sent', media(1)],
    ['attachments_received', media(0)],
    ['night_messages', night],
    ['conversation_gap_s', secondsOf(A.gap)],
  ]);

  // conversations.csv, most messages first
  const convs = [...A.byContact.entries()]
    .map(([k, bc]) => ({ k, bc, n: bc.n[0] + bc.n[1] }))
    .sort((a, b) => b.n - a.n || (a.k < b.k ? -1 : 1));
  add('conversations.csv', 'Conversations',
    ['conversation', 'apps', 'group', 'messages', 'sent', 'received', 'sent_share', 'your_median_reply_s', 'their_median_reply_s',
      'you_start_share', 'avg_length_sent', 'avg_length_received', 'longest_streak_days', 'first_message', 'last_message'],
    convs.map(({ k, bc, n }) => [
      names.conv(k), appsOf(k).map(appName).join('; '), k.startsWith('g:'), n, bc.n[1], bc.n[0], shareOf(bc.n[1], n),
      secondsOf(bc.replyMedian[1]), secondsOf(bc.replyMedian[0]), shareOf(bc.starters[1], bc.starters[0] + bc.starters[1]),
      avgOf(bc.lenSum[1], bc.lenN[1]), avgOf(bc.lenSum[0], bc.lenN[0]), bc.longestRun, isoDay(bc.first), isoDay(bc.last),
    ]));

  // months.csv, with a column per app that has messages here
  const months = [...A.months.keys()].sort((a, b) => a - b);
  const apps = sources.filter((s) => months.some((mo) => (A.sourceMonths.get(mo) || [])[s.id]));
  add('months.csv', 'Months',
    ['month', 'sent', 'received', 'avg_length_sent', 'avg_length_received', 'one_on_one', 'group', 'night', ...apps.map((s) => s.kind)],
    months.map((mo) => {
      const m = A.months.get(mo);
      const g = A.groupMonths.get(mo) || [0, 0];
      const sm = A.sourceMonths.get(mo) || [];
      return [isoMonth(mo), m.c[1], m.c[0], avgOf(m.len[1], m.lenN[1]), avgOf(m.len[0], m.lenN[0]), g[0], g[1], (A.night.get(mo) || [0])[0], ...apps.map((s) => sm[s.id] || 0)];
    }));

  add('days.csv', 'Days', ['date', 'sent', 'received'],
    [...A.days.keys()].sort((a, b) => a - b).map((d) => [isoDay(dayToTs(d)), A.days.get(d)[1], A.days.get(d)[0]]));

  add('hours.csv', 'Hours of the day', ['hour', 'sent', 'received', 'your_median_reply_s', 'their_median_reply_s'],
    Array.from({ length: 24 }, (_, h) => [h, A.hour[1][h], A.hour[0][h], secondsOf(A.replyHourMedian[1][h]), secondsOf(A.replyHourMedian[0][h])]));

  add('weekdays.csv', 'Days of the week', ['weekday', 'sent', 'received'],
    WEEKDAY_NAMES.map((name, w) => [name, A.dow[1][w], A.dow[0][w]]));

  add('heatmap.csv', 'Weekday by hour', ['weekday', 'hour', 'messages'],
    WEEKDAY_NAMES.flatMap((name, w) => Array.from({ length: 24 }, (_, h) => [name, h, A.heat[w * 24 + h]])));

  add('reply_times.csv', 'Reply times', ['bin', 'your_replies', 'their_replies'],
    A.replyBins.map((b, i) => [b.label, A.reply[1][i], A.reply[0][i]]));

  add('emoji.csv', 'Emoji', ['emoji', 'sent', 'received'],
    [...A.emojiFreq.entries()]
      .sort((a, b) => b[1][0] + b[1][1] - (a[1][0] + a[1][1]) || (a[0] < b[0] ? -1 : 1))
      .map(([e, v]) => [e, v[1], v[0]]));

  add('attachments.csv', 'Attachments', ['month', ...MEDIA_TYPES.map((m) => MEDIA_COLUMNS[m.key])],
    [...A.mediaMonths.keys()].sort((a, b) => a - b).map((mo) => {
      const mm = A.mediaMonths.get(mo);
      return [isoMonth(mo), ...MEDIA_TYPES.map((m) => mm[m.key])];
    }));

  // Only when the selection has calls (R3, AC10)
  if (C && C.n) {
    add('calls.csv', 'Calls', ['conversation', 'calls', 'talk_s'],
      [...C.contacts.entries()]
        .sort((a, b) => b[1].n - a[1].n || b[1].talk - a[1].talk || (a[0] < b[0] ? -1 : 1))
        .map(([k, v]) => [names.conv(k), v.n, Math.round(v.talk)]));
  }

  // Only when the selection has group chats
  if (A.group) {
    add('group_senders.csv', 'Group chat senders', ['sender', 'messages'],
      [...A.groupSenders.entries()]
        .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
        .map(([x, n]) => [names.sender(x), n]));
  }
  return tables;
}

/** A text cell that a spreadsheet would read as a formula gets a ' in front (R6). */
const FORMULA_START = /^[=+\-@\t\r]/;

/** One CSV field (R4–R6): numbers as they are, text guarded and quoted when it needs to be. */
function csvCell(v) {
  if (v == null) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  let s = String(v);
  if (FORMULA_START.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** A table as RFC 4180 CSV: a header row, CRLF line ends, and a byte-order mark for Excel. */
function toCsv(header, rows) {
  return '﻿' + [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

/** CRC-32 of bytes (zip entries, PNG chunks). */
function crc32(b, c = 0xffffffff) {
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * A zip with no compression. entries: [[path, string | Uint8Array]], strings saved as
 * UTF-8. `when` (a Date) is the entries' modified time; without it the time is left 0.
 */
function storedZip(entries, { when = null } = {}) {
  const enc = new TextEncoder();
  const chunks = [];
  const central = [];
  const dosTime = when ? (when.getHours() << 11) | (when.getMinutes() << 5) | (when.getSeconds() >> 1) : 0;
  const dosDate = when ? ((when.getFullYear() - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate() : 0;
  let offset = 0;
  for (const [path, content] of entries) {
    const name = enc.encode(path);
    const data = typeof content === 'string' ? enc.encode(content) : content;
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(10, dosTime, true);
    local.setUint16(12, dosDate, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    chunks.push(local, name, data);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(12, dosTime, true);
    cd.setUint16(14, dosDate, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, data.length, true);
    cd.setUint32(24, data.length, true);
    cd.setUint16(28, name.length, true);
    cd.setUint32(42, offset, true);
    central.push(cd, name);
    offset += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((s, c) => s + c.byteLength, 0);
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(8, entries.length, true);
  eocd.setUint16(10, entries.length, true);
  eocd.setUint32(12, cdSize, true);
  eocd.setUint32(16, offset, true);
  return new Blob([...chunks, ...central, eocd], { type: 'application/zip' });
}

/** The CSV files as a zip Blob (R8). files: [{ file, csv }]. */
function zipStore(files, when = new Date()) {
  return storedZip(files.map((f) => [f.file, f.csv]), { when });
}

/** Saves a Blob as a download, with no network request: a link to an object URL. */
function saveBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
