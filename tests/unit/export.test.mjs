import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadApp, loadScripts, makeMessage, messageLib } from '../helpers/load.mjs';

const lib = messageLib();
const { aggregateMessages, aggregateCalls, statsTables, toCsv, zipStore, Sources } = loadApp([
  'aggregateMessages', 'aggregateCalls', 'statsTables', 'toCsv', 'zipStore', 'Sources',
]);
const { zipLib } = loadScripts(['zip.js'], ['zipLib']);

const MIN = 60e3;
const DAY = 86400e3;
const START = Date.parse('2024-03-01T12:00:00Z');
const NAMES = { alex: 'Alex, Jr.', mom: '=HYPERLINK("x")', 'g:club': 'Book "Club"', '+15550100': '+1 555 0100' };
const SENDERS = { Priya: 'Priya Shah', Sam: '@sam' };

/**
 * A history: Alex on SMS (you reply in 1 minute, they in 10), Mom on WhatsApp, a group
 * chat on Telegram, and calls with Alex and a calls-only number.
 */
function history() {
  const msgs = [];
  const say = (t, o, k, body, rest = {}) => msgs.push(makeMessage(lib, { at: new Date(t).toISOString(), o, k, body, ...rest }));
  for (let d = 0; d < 40; d++) {
    const t = START + d * DAY;
    say(t, 0, 'alex', 'zebracorn sighting at https://example.org/zebracorn 😂');
    say(t + MIN, 1, 'alex', 'no way 😂');
    say(t + 11 * MIN, 0, 'alex', 'yes way');
  }
  for (let d = 0; d < 70; d += 7) {
    say(START + d * DAY + 3600e3, 1, 'mom', 'call me?', { s: 2 });
    say(START + d * DAY + 2 * 3600e3, 0, 'mom', 'ok', { s: 2, ph: 1 });
  }
  for (let d = 0; d < 10; d++) {
    say(START + d * DAY + 5 * 3600e3, 0, 'g:club', 'chapter 3?', { s: 4, sn: 'Priya' });
    say(START + d * DAY + 5 * 3600e3 + MIN, 0, 'g:club', 'yes', { s: 4, sn: 'Sam' });
    say(START + d * DAY + 5 * 3600e3 + 2 * MIN, 1, 'g:club', 'same', { s: 4 });
  }
  msgs.sort((a, b) => a.t - b.t);
  const calls = [];
  const call = (t, k, ty, du) => { const c = { t, k, ty, du }; lib.stampTime(c); calls.push(c); };
  call(START + 2 * DAY, 'alex', 2, 300);
  call(START + 3 * DAY, 'alex', 1, 61);
  call(START + 4 * DAY, '+15550100', 3, 0);
  return { msgs, calls };
}

const opts = (extra = {}) => ({
  labelFor: (k) => NAMES[k] || k,
  senderLabel: (x) => (x === 'You' ? 'You' : SENDERS[x] || x),
  appsOf: (k) => [{ alex: 0, mom: 2, 'g:club': 4 }[k] ?? 0],
  sources: Sources.list,
  ...extra,
});

function build(extra) {
  const { msgs, calls } = history();
  const A = aggregateMessages(msgs);
  const C = aggregateCalls(calls);
  const tables = statsTables(A, C, opts(extra));
  const get = (file) => tables.find((t) => t.file === file);
  /** A table's rows as objects keyed by header. */
  const objects = (file) => get(file).rows.map((r) => Object.fromEntries(get(file).header.map((h, i) => [h, r[i]])));
  return { msgs, calls, A, C, tables, get, objects };
}

/** Parses RFC 4180 CSV (after the byte-order mark) into rows of strings. */
function parseCsv(text) {
  assert.equal(text[0], '﻿');
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 1; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; } else if (ch === '\r' && text[i + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; } else cell += ch;
  }
  return rows;
}

describe('spec 026 exporting stats as CSV', () => {
  it('AC2: conversations.csv matches aggregateMessages, and summary.csv the Overview numbers', () => {
    const { A, objects } = build();
    const alex = objects('conversations.csv').find((r) => r.conversation === 'Alex, Jr.');
    const bc = A.byContact.get('alex');
    assert.deepEqual(
      [alex.messages, alex.sent, alex.received, alex.your_median_reply_s, alex.their_median_reply_s, alex.you_start_share, alex.apps, alex.group],
      [120, 40, 80, 60, 600, 0, 'SMS', false],
    );
    assert.equal(alex.your_median_reply_s, Math.round(bc.replyMedian[1] / 1000));
    assert.equal(alex.sent_share, 0.3333);
    assert.equal(alex.first_message, '2024-03-01');
    assert.equal(alex.last_message, '2024-04-09');
    assert.deepEqual(objects('conversations.csv').map((r) => r.messages), [120, 30, 20]); // most first
    const s = Object.fromEntries(objects('summary.csv').map((r) => [r.metric, r.value]));
    const media = (o) => ['ph', 'vd', 'gf', 'au', 'ot'].reduce((n, k) => n + A.media[k][o], 0);
    assert.deepEqual(
      [s.messages, s.sent, s.received, s.conversations, s.group_chats, s.active_days, s.span_days, s.attachments_received, s.conversation_gap_s],
      [A.dir[0] + A.dir[1], A.dir[1], A.dir[0], A.contacts.size, 1, A.activeDays, A.spanDays, media(0), 6 * 3600],
    );
    assert.equal(s.your_median_reply_s, Math.round(A.replyMedian[1] / 1000));
    assert.equal(s.busiest_day_messages, A.busiestDay.n);
    assert.equal(s.first_message, '2024-03-01');
  });

  it('AC3: months.csv has a row per month and a column per app here; days.csv adds up to the total', () => {
    const { A, get, objects } = build();
    const months = get('months.csv');
    assert.deepEqual(months.header.slice(-3), ['sms', 'whatsapp', 'telegram']);
    assert.deepEqual(months.rows.map((r) => r[0]), ['2024-03', '2024-04', '2024-05']);
    for (const r of objects('months.csv')) assert.equal(r.sms + r.whatsapp + r.telegram, r.sent + r.received);
    const days = objects('days.csv');
    assert.equal(days.reduce((n, r) => n + r.sent + r.received, 0), A.n);
    assert.equal(days[0].date, '2024-03-01');
    assert.equal(objects('weekdays.csv')[0].weekday, 'Sunday');
    assert.equal(get('heatmap.csv').rows.length, 168);
    assert.equal(get('hours.csv').rows.length, 24);
  });

  it('AC4: toCsv quotes commas, quotes and line breaks, uses CRLF and starts with a byte-order mark', () => {
    const csv = toCsv(['name', 'note'], [['Smith, Jr.', 'say "hi"'], ['two\nlines', 'plain']]);
    assert.equal(csv, '﻿name,note\r\n"Smith, Jr.","say ""hi"""\r\n"two\nlines",plain\r\n');
    assert.deepEqual(parseCsv(csv), [['name', 'note'], ['Smith, Jr.', 'say "hi"'], ['two\nlines', 'plain']]);
    assert.equal(toCsv(['e'], [['😂'], ['Zoë']]), '﻿e\r\n😂\r\nZoë\r\n');
  });

  it('AC5: text that looks like a formula gets a quote mark in front; numbers never do', () => {
    const csv = toCsv(['v'], [['=HYPERLINK("x")'], ['+1 555 0100'], [-3], ['-Alex'], ['@home'], ['\tx'], ['\rx'], ['a=b']]);
    assert.equal(csv, '﻿v\r\n"\'=HYPERLINK(""x"")"\r\n\'+1 555 0100\r\n-3\r\n\'-Alex\r\n\'@home\r\n\'\tx\r\n"\'\rx"\r\na=b\r\n');
    const { get } = build();
    const conv = toCsv(get('conversations.csv').header, get('conversations.csv').rows);
    assert.ok(conv.includes('"\'=HYPERLINK(""x"")"'));
    const senders = toCsv(get('group_senders.csv').header, get('group_senders.csv').rows);
    assert.ok(senders.includes("'@sam"));
  });

  it('AC6: a missing median is an empty cell, a share a fraction, a count a plain integer', () => {
    const { get, objects } = build();
    // You write first to Mom and never answer her: you have no median reply there.
    const mom = objects('conversations.csv').find((r) => r.apps === 'WhatsApp');
    assert.equal(mom.your_median_reply_s, null);
    assert.equal(mom.their_median_reply_s, 3600);
    const convs = get('conversations.csv');
    const line = toCsv(convs.header, convs.rows).split('\r\n').find((l) => l.includes('HYPERLINK'));
    assert.match(line, /,WhatsApp,false,20,10,10,0\.5,,3600,1,/);
    const hours = get('hours.csv');
    const csv = toCsv(hours.header, hours.rows);
    assert.match(csv.split('\r\n')[1], /^0,0,0,,$/); // nobody wrote at midnight: no medians
    assert.equal(toCsv(['n', 's'], [[12345, 0.6342]]), '﻿n,s\r\n12345,0.6342\r\n');
    for (const r of objects('conversations.csv')) assert.ok(r.sent_share >= 0 && r.sent_share <= 1 && String(r.sent_share).length <= 6);
  });

  it('AC7: with names replaced no file has a name, and a conversation has the same number everywhere', () => {
    const { tables } = build({ anon: true });
    const text = tables.map((t) => toCsv(t.header, t.rows)).join('\n');
    for (const name of [...Object.values(NAMES), ...Object.values(SENDERS), 'Alex', 'Priya', 'Sam', '15550100']) assert.ok(!text.includes(name), name);
    const conv = tables.find((t) => t.file === 'conversations.csv').rows.map((r) => r[0]);
    assert.deepEqual(conv, ['Conversation 1', 'Conversation 2', 'Conversation 3']);
    const calls = tables.find((t) => t.file === 'calls.csv').rows;
    assert.deepEqual(calls.map((r) => r[0]), ['Conversation 1', 'Conversation 4']); // Alex, then the calls-only number
    assert.deepEqual(tables.find((t) => t.file === 'group_senders.csv').rows.map((r) => r[0]), ['Sender 1', 'Sender 2', 'You']);
  });

  it('AC8: no table holds words or links from the messages', () => {
    const { tables } = build();
    const text = tables.map((t) => toCsv(t.header, t.rows)).join('\n');
    for (const s of ['zebracorn', 'example.org', 'sighting', 'chapter']) assert.ok(!text.includes(s), s);
    assert.ok(text.includes('😂')); // emoji are counted
  });

  it('AC9: the zip opens with the app’s own reader and holds every file with the same bytes', async () => {
    const { tables } = build();
    const files = tables.map((t) => ({ file: t.file, csv: toCsv(t.header, t.rows) }));
    const blob = zipStore(files, new Date(2026, 10, 24, 9, 30));
    const zip = new File([await blob.arrayBuffer()], 'stats.zip');
    const { listZip, readEntryBlob } = zipLib();
    const entries = await listZip(zip);
    assert.deepEqual(entries.map((e) => e.name), files.map((f) => f.file));
    for (const [i, e] of entries.entries()) {
      const got = new Uint8Array(await (await readEntryBlob(e)).arrayBuffer());
      assert.deepEqual(got, new TextEncoder().encode(files[i].csv), e.name);
    }
    // The modified time, read from the first local header (MS-DOS time at byte 10, date at 12).
    // Read here rather than from `unzip -l`, whose date format differs between systems.
    const head = new DataView(await blob.arrayBuffer());
    assert.equal(head.getUint32(0, true), 0x04034b50);
    const time = head.getUint16(10, true), date = head.getUint16(12, true);
    assert.deepEqual([(date >> 9) + 1980, (date >> 5) & 15, date & 31, time >> 11, (time >> 5) & 63], [2026, 11, 24, 9, 30]);
    // And with a standard tool, when there is one.
    let unzip = true;
    try { execFileSync('unzip', ['-v'], { stdio: 'ignore' }); } catch { unzip = false; }
    if (unzip) {
      const dir = mkdtempSync(join(tmpdir(), 'yap-zip-'));
      try {
        const path = join(dir, 'stats.zip');
        writeFileSync(path, Buffer.from(await blob.arrayBuffer()));
        const out = execFileSync('unzip', ['-t', path], { encoding: 'utf8' });
        assert.match(out, /No errors detected/);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('AC10: calls.csv only with calls, group_senders.csv only with group chats', () => {
    const { msgs } = history();
    const oneOnOne = msgs.filter((m) => !m.k.startsWith('g:'));
    const files = (A, C) => statsTables(A, C, opts()).map((t) => t.file);
    assert.ok(files(aggregateMessages(msgs), aggregateCalls(history().calls)).includes('calls.csv'));
    assert.ok(!files(aggregateMessages(msgs), null).includes('calls.csv'));
    assert.ok(files(aggregateMessages(msgs), null).includes('group_senders.csv'));
    assert.ok(!files(aggregateMessages(oneOnOne), null).includes('group_senders.csv'));
    assert.deepEqual(files(aggregateMessages(oneOnOne), null), [
      'summary.csv', 'conversations.csv', 'months.csv', 'days.csv', 'hours.csv', 'weekdays.csv', 'heatmap.csv', 'reply_times.csv', 'emoji.csv', 'attachments.csv',
    ]);
  });
});
