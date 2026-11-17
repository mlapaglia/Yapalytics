import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadScripts, makeMessage, messageLib } from '../helpers/load.mjs';

const lib = messageLib();
const { aggregateCrossApp, mainAppShifts, crossAppHighlight, switchTrigger } = loadScripts(
  ['parser.js', 'analysis.js', 'insights.js', 'crossapp.js'],
  ['aggregateCrossApp', 'mainAppShifts', 'crossAppHighlight', 'switchTrigger'],
);

const GAP = 6 * 3600e3;
const MIN = 60e3;
const T0 = Date.parse('2024-03-02T12:00:00Z');
const SMS = 0;
const IG = 5;
const NAMES = { 0: 'SMS', 5: 'Instagram' };

/** A message from a linked person: `min` minutes after T0, on app `s`, `o` 1 = you. */
const msg = (min, s, o, { k = 'p:alex', body = 'hey', ...rest } = {}) =>
  makeMessage(lib, { at: new Date(T0 + min * MIN).toISOString(), s, o, k, tk: `${k}/${s}`, body, ...rest });

const run = (msgs) => aggregateCrossApp(msgs.sort((a, b) => a.t - b.t), GAP);

describe('spec 007 cross-app habits', () => {
  it('AC1: SMS → Instagram → SMS in one conversation is 2 switches and a back-and-forth conversation', () => {
    const X = run([msg(0, SMS, 0), msg(1, SMS, 1), msg(5, IG, 0), msg(6, IG, 1), msg(10, SMS, 0)]);
    const P = X.people.get('p:alex');
    assert.equal(P.switches, 2);
    assert.equal(P.sessions, 1);
    assert.equal(P.multiSessions, 1);
    assert.equal(P.bounceSessions, 1);
    assert.equal(P.days, 1);
    assert.equal(P.multiDays, 1);
    assert.equal(X.total.switches, 2);
    assert.deepEqual(X.busiest && { switches: X.busiest.switches, apps: X.busiest.apps.sort() }, { switches: 2, apps: [SMS, IG] });

    const apart = run([msg(0, SMS, 0), msg(1, SMS, 1), msg(8 * 60, IG, 0), msg(8 * 60 + 1, IG, 1), msg(16 * 60, SMS, 0)]);
    const Q = apart.people.get('p:alex');
    assert.equal(Q.switches, 0, 'a gap longer than the conversation gap is a new conversation, not a switch');
    assert.equal(Q.sessions, 3);
    assert.equal(Q.multiSessions, 0);
    assert.equal(Q.bounceSessions, 0);
  });

  it('AC1: one switch without coming back is multi-app but not back-and-forth', () => {
    const P = run([msg(0, SMS, 0), msg(5, IG, 1)]).people.get('p:alex');
    assert.equal(P.multiSessions, 1);
    assert.equal(P.bounceSessions, 0);
  });

  it('AC2: who switches is the sender of the first message on the new app; routes count each direction', () => {
    const P = run([
      msg(0, SMS, 1), msg(1, IG, 0), // they move to Instagram
      msg(2, IG, 1), msg(3, SMS, 1), // you move back to SMS
      msg(4, IG, 0), // they move to Instagram again
    ]).people.get('p:alex');
    assert.equal(P.switches, 3);
    assert.deepEqual(P.switchBy, [2, 1]);
    assert.deepEqual(P.routes.get('0>5'), [2, 0]);
    assert.deepEqual(P.routes.get('5>0'), [0, 1]);
  });

  it('AC3: the message before a switch says what set it off', () => {
    const P = run([
      msg(0, IG, 0, { sh: { u: 'https://www.instagram.com/reel/x/' } }), msg(1, SMS, 1),
      msg(2, SMS, 0, { body: 'look https://example.com/a' }), msg(3, IG, 1),
      msg(4, IG, 0, { ph: 1 }), msg(5, SMS, 1),
      msg(6, SMS, 0), msg(7, IG, 0),
    ]).people.get('p:alex');
    assert.deepEqual(P.triggers, { share: 1, link: 1, media: 1, text: 1 });
    assert.equal(switchTrigger({ sh: { u: 'x' }, f: 2, ph: 1 }), 'share', 'a share counts before a link or photo');
  });

  it('AC4: a reply on another app is a cross-app reply, with its time', () => {
    const P = run([msg(0, SMS, 1), msg(10, IG, 0), msg(12, IG, 1), msg(15, IG, 0)]).people.get('p:alex');
    assert.deepEqual(P.replies, [2, 1]);
    assert.deepEqual(P.crossReplies, [1, 0]);
    assert.deepEqual(P.crossMs, [[10 * MIN], []]);
    assert.deepEqual(P.sameMs, [[3 * MIN], [2 * MIN]]);
    assert.deepEqual(P.crossMedian, [10 * MIN, null]);
  });

  it('AC5: unlinked and group messages, and a linked person on one app, are not counted', () => {
    const X = run([
      msg(0, SMS, 0, { k: 'alex' }), msg(1, IG, 1, { k: 'alex' }), // unlinked (no p: key)
      msg(2, SMS, 0, { k: 'g:group' }), msg(3, IG, 1, { k: 'g:group' }),
      msg(4, SMS, 0, { k: 'p:sam' }), msg(5, SMS, 1, { k: 'p:sam' }), // linked, but only SMS here
    ]);
    assert.equal(X.people.size, 0);
    assert.equal(X.total.n, 0);
    assert.equal(X.total.switches, 0);
    assert.equal(X.busiest, null);
  });

  it('AC5: totals add up the people with 2+ apps', () => {
    const X = run([
      msg(0, SMS, 0), msg(1, IG, 1),
      msg(0, SMS, 0, { k: 'p:sam' }), msg(2, IG, 0, { k: 'p:sam' }), msg(3, SMS, 1, { k: 'p:sam' }),
    ]);
    assert.equal(X.people.size, 2);
    assert.equal(X.total.n, 5);
    assert.equal(X.total.switches, 3);
    assert.equal(X.total.sessions, 2);
    assert.equal(X.busiest.k, 'p:sam');
  });

  it('M10: per-app stats', () => {
    const P = run([msg(0, SMS, 1, { body: 'hello there' }), msg(1, SMS, 0), msg(2, IG, 0, { sh: { u: 'x' } }), msg(3, IG, 1, { ph: 1 })]).people.get('p:alex');
    const sms = P.apps.get(SMS);
    const ig = P.apps.get(IG);
    assert.deepEqual(sms.n, [1, 1]);
    assert.deepEqual(sms.starts, [0, 1]);
    assert.equal(ig.links, 1);
    assert.equal(ig.visual, 1);
    assert.equal(sms.hour[12], 2);
    assert.equal(P.mainApp, SMS, 'a tie goes to the first app seen');
  });
});

describe('spec 007 main app shifts', () => {
  const MO = 2024 * 12;
  /** months: [sms, ig] counts per month from MO. */
  const months = (rows) => new Map(rows.map(([sms, ig], i) => [MO + i, [sms, 0, 0, 0, 0, ig]]));

  it('AC6: a clear move from SMS to Instagram is one shift, at the window where Instagram takes the lead', () => {
    const rows = [...Array(6).fill([40, 5]), ...Array(8).fill([5, 40])];
    const shifts = mainAppShifts(months(rows));
    assert.equal(shifts.length, 1);
    assert.deepEqual({ from: shifts[0].from, to: shifts[0].to }, { from: SMS, to: IG });
    // Windows end at MO+2…; the window ending at MO+7 is 40+5+5 SMS vs 5+40+40 IG: Instagram leads.
    assert.equal(shifts[0].mo, MO + 7);
  });

  it('AC6: one busy month on the other app is not a shift', () => {
    const rows = [...Array(6).fill([40, 5]), [5, 200], ...Array(6).fill([40, 5])];
    assert.deepEqual(mainAppShifts(months(rows)), []);
  });

  it('AC6: windows under 30 messages have no leader', () => {
    const rows = [...Array(6).fill([8, 1]), ...Array(8).fill([1, 8])];
    assert.deepEqual(mainAppShifts(months(rows)), []);
  });

  it('AC6: a move in the last 3 months is too recent to call', () => {
    const rows = [...Array(6).fill([40, 5]), ...Array(3).fill([5, 40])];
    assert.deepEqual(mainAppShifts(months(rows)), []);
  });
});

describe('spec 007 highlight', () => {
  /** n conversations a day apart, each with one switch made by `who` (1 = you). */
  const switching = (n, who) => {
    const out = [];
    for (let i = 0; i < n; i++) out.push(msg(i * 24 * 60, SMS, 1 - who), msg(i * 24 * 60 + 1, IG, who));
    return run(out);
  };
  const text = (h) => h.parts.map((p) => (typeof p === 'string' ? p : p.b ?? p.text)).join('');

  it('AC7: the side that makes 65%+ of 10+ switches gets a highlight', () => {
    const h = crossAppHighlight(switching(10, 0), { labelFor: () => 'Alex', names: NAMES });
    assert.equal(h.kind, 'apps');
    assert.equal(text(h), 'When you and Alex switch apps mid-conversation, Alex makes the move 100% of the time.');
    const mine = crossAppHighlight(switching(12, 1), { labelFor: () => 'Alex', names: NAMES });
    assert.match(text(mine), /you make the move 100% of the time/);
  });

  it('AC7: too few switches, or an even split, gives no highlight', () => {
    assert.equal(crossAppHighlight(switching(9, 0), { names: NAMES }), null);
    const even = [];
    for (let i = 0; i < 10; i++) even.push(msg(i * 24 * 60, SMS, i % 2), msg(i * 24 * 60 + 1, IG, 1 - (i % 2)));
    assert.equal(crossAppHighlight(run(even), { names: NAMES }), null);
  });

  it('R5: conversations that bounce back and forth get a highlight', () => {
    const out = [];
    for (let i = 0; i < 10; i++) {
      const t = i * 24 * 60;
      out.push(msg(t, SMS, i % 2), msg(t + 1, IG, 1 - (i % 2)), msg(t + 2, SMS, i % 2));
    }
    const h = crossAppHighlight(run(out), { labelFor: () => 'Alex', names: NAMES });
    assert.equal(text(h), 'You and Alex bounce back and forth between SMS and Instagram in 100% of your conversations.');
  });
});
