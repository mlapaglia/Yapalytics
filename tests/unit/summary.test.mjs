import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, makeMessage, messageLib } from '../helpers/load.mjs';

const lib = messageLib();
const { aggregateMessages, summaryStats, fmtDuration, fmtDate, dayToTs, MEDIA_TYPES, summaryFileName } = loadApp([
  'aggregateMessages', 'summaryStats', 'fmtDuration', 'fmtDate', 'dayToTs', 'MEDIA_TYPES', 'summaryFileName',
]);
const DAY = 86400000;
const START = Date.parse('2024-03-01T12:00:00Z');

const names = { alex: 'Alex', sam: 'Sam', 'g:club': 'Book Club', '+1555': 'Jordan', '+1666': 'Riley' };
const labelFor = (k) => names[k] || k;
const senderLabel = (x) => names[x] || x;
const noNames = () => { throw new Error('looked up a name with names off'); };

/** Alex (most messages, on SMS), Sam (on WhatsApp) and a group chat. */
function history(body = 'hey 😂') {
  const out = [];
  const at = (d, h, o, k, extra = {}) => out.push(makeMessage(lib, { at: new Date(START + d * DAY + h * 3600e3).toISOString(), o, k, body, ...extra }));
  for (let d = 0; d < 40; d++) { at(d, 0, 1, 'alex'); at(d, 0.1, 0, 'alex', { ph: 1 }); }
  for (let d = 0; d < 20; d += 2) { at(d, 3, 0, 'sam', { s: 2 }); at(d, 3.1, 1, 'sam', { s: 2 }); }
  for (let d = 0; d < 10; d++) {
    at(d, 15, 0, 'g:club', { sn: '+1555' });
    at(d, 15.1, 0, 'g:club', { sn: '+1555' });
    at(d, 15.2, 0, 'g:club', { sn: '+1666' });
    at(d, 15.3, 1, 'g:club');
  }
  at(41, 2, 1, 'alex', { body: 'late ❤️' });
  return out.sort((a, b) => a.t - b.t);
}

const stats = (msgs, opts) => summaryStats(msgs, aggregateMessages(msgs), { labelFor, senderLabel, ...opts });

describe('spec 025 summary image', () => {
  it('AC2: the top conversations are Person 1, Person 2… with names off, and their names with names on', () => {
    const msgs = history();
    const off = stats(msgs, { names: false, labelFor: noNames, senderLabel: noNames });
    assert.deepEqual(off.bars.map((b) => b.label), ['Person 1', 'Group chat 1', 'Person 2']);
    assert.deepEqual(off.bars.map((b) => b.n), [81, 40, 20]);
    assert.equal(off.title, 'All conversations');
    const on = stats(msgs, { names: true });
    assert.deepEqual(on.bars.map((b) => b.label), ['Alex', 'Book Club', 'Sam']);
  });

  it('AC3: one conversation is "A conversation", a group chat "A group chat", with You and stand-ins', () => {
    const all = history();
    const alex = all.filter((m) => m.k === 'alex');
    const one = stats(alex, { contact: 'alex', names: false, labelFor: noNames, senderLabel: noNames });
    assert.equal(one.title, 'A conversation');
    assert.equal(one.barsTitle, 'Who sent what');
    assert.deepEqual(one.bars.map((b) => [b.label, b.n]), [['You', 41], ['Person 1', 40]]);
    assert.ok(!one.tiles.some((t) => t.label === 'Conversations'));

    const club = all.filter((m) => m.k === 'g:club');
    const group = stats(club, { contact: 'g:club', names: false, labelFor: noNames, senderLabel: noNames });
    assert.equal(group.title, 'A group chat');
    assert.deepEqual(group.bars.map((b) => [b.label, b.n]).sort(), [['Person 1', 20], ['Person 2', 10], ['You', 10]]);
    const named = stats(club, { contact: 'g:club', names: true });
    assert.equal(named.title, 'Book Club');
    assert.deepEqual(named.bars.map((b) => b.label).sort(), ['Jordan', 'Riley', 'You']);
  });

  it('AC3: a group sender named "You" is a stand-in, not you, names on or off', () => {
    const at = (h, o, extra = {}) => makeMessage(lib, { at: new Date(START + h * 3600e3).toISOString(), o, k: 'g:club', body: 'hi', ...extra });
    const msgs = [at(0, 1), at(1, 0, { sn: 'You' })];
    const off = stats(msgs, { contact: 'g:club', names: false, labelFor: noNames, senderLabel: noNames });
    assert.deepEqual(off.bars.map((b) => [b.label, b.n]).sort(), [['Person 1', 1], ['You', 1]]);
    const on = stats(msgs, { contact: 'g:club', names: true });
    assert.deepEqual(on.bars.map((b) => [b.label, b.n]), [['You', 1], ['You', 1]]);
  });

  it('AC4: no word or link site from the messages is in the summary, names on or off', () => {
    const msgs = history('zebracorn https://example.org/page 😂');
    for (const n of [false, true]) {
      const json = JSON.stringify(stats(msgs, { names: n }));
      assert.ok(!json.includes('zebracorn'), json);
      assert.ok(!json.includes('example.org'), json);
    }
  });

  it('AC5: totals, tiles, top emoji and app shares match the Overview numbers', () => {
    const msgs = history();
    const A = aggregateMessages(msgs);
    const s = summaryStats(msgs, A, { names: false, appName: (id) => ({ 0: 'SMS', 2: 'WhatsApp' })[id] });
    const total = A.dir[0] + A.dir[1];
    assert.deepEqual([s.total, s.sent, s.received], [total, A.dir[1], A.dir[0]]);
    const tile = Object.fromEntries(s.tiles.map((t) => [t.label, t]));
    assert.equal(tile['Per day'].value, (total / A.spanDays).toFixed(1));
    assert.equal(tile['Active days'].value, String(A.activeDays));
    assert.equal(tile['Longest streak'].value, `${A.longestStreak.len} days`);
    assert.equal(tile['Busiest day'].value, String(A.busiestDay.n));
    assert.equal(tile['Busiest day'].sub, fmtDate.day(dayToTs(A.busiestDay.d)));
    assert.equal(tile['Your reply'].value, fmtDuration(A.replyMedian[1]));
    assert.equal(tile['Your reply'].sub, `median · theirs ${fmtDuration(A.replyMedian[0])}`);
    assert.equal(tile.Conversations.value, '3');
    assert.equal(tile.Conversations.sub, '1 group chats');
    let night = 0;
    for (const [n] of A.night.values()) night += n;
    assert.equal(tile['Night owl'].value, Math.round((night / total) * 100) + '%');
    const media = MEDIA_TYPES.reduce((n, m) => n + A.media[m.key][0] + A.media[m.key][1], 0);
    assert.equal(tile.Attachments.value, String(media));
    assert.deepEqual(s.emoji, ['😂', '❤️']);
    assert.deepEqual(s.apps.map((a) => [a.name, a.n]), [['SMS', total - 20], ['WhatsApp', 20]]);
    assert.equal(s.apps.reduce((n, a) => n + a.share, 0), 1);
    assert.equal(s.span, 'Mar 2024 – Apr 2024');
  });

  it('R3: one app gives no app shares', () => {
    const alex = history().filter((m) => m.k === 'alex');
    assert.deepEqual(stats(alex, { contact: 'alex' }).apps, []);
  });

  it('R7: the file is named for today', () => {
    assert.equal(summaryFileName(new Date(2026, 0, 5)), 'Yapalytics-summary-2026-01-05.png');
  });
});
