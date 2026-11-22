/*
 * Cross-app habits (spec 007): how a linked person's conversations (spec 005) move
 * between apps. Pure functions over message records; app.js renders them. Reads only
 * each message's app, time, direction, length, attachment counts and link/share flags,
 * never its text (R6).
 *
 * A conversation follows the session rule used everywhere else: no silence longer than
 * the conversation gap. Indexes by direction are [them, you] (record.o).
 */

/** R7: the conversation gaps the Across apps tab offers. Switching apps happens fast, so they're shorter than the dashboard's. */
const APPS_GAPS = [15 * 60e3, 30 * 60e3, 3600e3, 6 * 3600e3];
const APPS_GAP = 6 * 3600e3; // the default, the same as the rest of the dashboard's

/** What can come right before a switch (M8), in the order they're checked. */
const CROSS_TRIGGERS = ['share', 'link', 'media', 'text'];

/** M8: what kind of message `m` is, for the message that comes right before a switch. */
function switchTrigger(m) {
  if (m.sh) return 'share';
  if (m.f & T_LINK) return 'link';
  if (m.ph || m.vd || m.gf) return 'media';
  return 'text';
}

function newAppStats() {
  return { n: [0, 0], lenSum: 0, lenN: 0, visual: 0, links: 0, starts: [0, 0], hour: new Array(24).fill(0), replies: [[], []], replyMedian: [null, null] };
}

function newCrossStats() {
  return {
    n: 0,
    dir: [0, 0],
    apps: new Map(), // app (m.s) -> newAppStats()
    switches: 0,
    switchBy: [0, 0], // who sent the first message on the new app
    routes: new Map(), // 'from>to' -> [them, you]
    triggers: { share: 0, link: 0, media: 0, text: 0 },
    sessions: 0,
    multiSessions: 0, // conversations on 2+ apps
    bounceSessions: 0, // conversations that went back to an app they'd left
    days: 0, // active days (person-days when adding up several people)
    multiDays: 0, // of which on 2+ apps
    replies: [0, 0],
    crossReplies: [0, 0],
    crossMs: [[], []],
    sameMs: [[], []],
    crossMedian: [null, null],
    sameMedian: [null, null],
    months: new Map(), // mo -> messages per app [6]
    mainApp: null,
    busiest: null, // the conversation with the most switches: { k, start, end, d, switches, apps }
  };
}

/** Adds one person's messages (time-sorted) to P. */
function addCrossApp(P, k, list, gap) {
  let ses = null;
  const dayApps = new Map(); // day -> Set of apps
  const close = () => {
    P.sessions++;
    if (ses.apps.size > 1) P.multiSessions++;
    if (ses.bounced) P.bounceSessions++;
    if (ses.switches && (!P.busiest || ses.switches > P.busiest.switches)) {
      P.busiest = { k, start: ses.start, end: ses.prev.t, d: ses.d, switches: ses.switches, apps: [...ses.apps] };
    }
  };

  for (const m of list) {
    const s = m.s || 0;
    const o = m.o;
    P.n++;
    P.dir[o]++;
    let a = P.apps.get(s);
    if (!a) P.apps.set(s, (a = newAppStats()));
    a.n[o]++;
    if (m.l > 0 && !(m.f & T_REACTION)) { a.lenSum += m.l; a.lenN++; }
    if (m.ph || m.vd || m.gf) a.visual++;
    if (m.sh || (m.f & T_LINK)) a.links++;
    a.hour[m.h]++;
    let mm = P.months.get(m.mo);
    if (!mm) P.months.set(m.mo, (mm = Sources.zeros()));
    mm[s]++;
    let da = dayApps.get(m.d);
    if (!da) dayApps.set(m.d, (da = new Set()));
    da.add(s);

    if (!ses || m.t - ses.prev.t > gap) {
      if (ses) close();
      a.starts[o]++;
      ses = { start: m.t, d: m.d, prev: m, switches: 0, apps: new Set([s]), bounced: false };
      continue;
    }
    const prev = ses.prev;
    const ps = prev.s || 0;
    if (o !== prev.o) {
      const wait = m.t - prev.t;
      P.replies[o]++;
      a.replies[o].push(wait);
      if (s !== ps) { P.crossReplies[o]++; P.crossMs[o].push(wait); } else P.sameMs[o].push(wait);
    }
    if (s !== ps) {
      ses.switches++;
      P.switches++;
      P.switchBy[o]++;
      const route = ps + '>' + s;
      let r = P.routes.get(route);
      if (!r) P.routes.set(route, (r = [0, 0]));
      r[o]++;
      P.triggers[switchTrigger(prev)]++;
      if (ses.apps.has(s)) ses.bounced = true;
      ses.apps.add(s);
    }
    ses.prev = m;
  }
  if (ses) close();
  P.days += dayApps.size;
  for (const v of dayApps.values()) if (v.size > 1) P.multiDays++;
}

function finishCrossApp(P) {
  P.crossMedian = [median(P.crossMs[0]), median(P.crossMs[1])];
  P.sameMedian = [median(P.sameMs[0]), median(P.sameMs[1])];
  let main = null;
  for (const [s, a] of P.apps) {
    a.replyMedian = [median(a.replies[0]), median(a.replies[1])];
    if (main == null || a.n[0] + a.n[1] > P.apps.get(main).n[0] + P.apps.get(main).n[1]) main = s;
  }
  P.mainApp = main;
  P.shifts = mainAppShifts(P.months);
  return P;
}

/**
 * Cross-app stats for the linked people (`p:` keys) in a time-sorted selection. People
 * whose messages here are all on one app are left out (R1, AC5). Returns
 * { people: Map(k -> stats), total: stats over all of them, busiest }.
 */
function aggregateCrossApp(msgs, gap) {
  const byPerson = new Map();
  for (const m of msgs) {
    if (!m.k.startsWith('p:')) continue;
    let list = byPerson.get(m.k);
    if (!list) byPerson.set(m.k, (list = []));
    list.push(m);
  }
  const people = new Map();
  const total = newCrossStats();
  for (const [k, list] of byPerson) {
    const first = list[0].s || 0;
    if (list.every((m) => (m.s || 0) === first)) continue;
    const P = newCrossStats();
    addCrossApp(P, k, list, gap);
    addCrossApp(total, k, list, gap);
    people.set(k, finishCrossApp(P));
  }
  finishCrossApp(total);
  return { people, total, busiest: total.busiest };
}

/**
 * Spec 010: where one linked person's conversation moves between apps, for markers in
 * the message list. `list` is that person's time-sorted messages. A switch is M2's: two
 * consecutive messages in one conversation (no quiet longer than `gap`) on different
 * apps. Returns Map(index in list -> { from, to, o }), o being who sent the first
 * message on the new app.
 */
function appSwitchMarks(list, gap) {
  const marks = new Map();
  for (let i = 1; i < list.length; i++) {
    const prev = list[i - 1];
    const m = list[i];
    const from = prev.s || 0;
    const to = m.s || 0;
    if (from !== to && m.t - prev.t <= gap) marks.set(i, { from, to, o: m.o });
  }
  return marks;
}

/** The app with the most messages in a [6] count, or null when there are fewer than `min`. */
function leadingApp(counts, min) {
  let lead = 0;
  let sum = 0;
  for (let i = 0; i < counts.length; i++) {
    sum += counts[i];
    if (counts[i] > counts[lead]) lead = i;
  }
  return sum >= min ? lead : null;
}

const SHIFT_WINDOW = 3; // months
const SHIFT_MIN = 30; // messages in a window for its leader to count
const SHIFT_HOLD = 3; // windows after the change that must keep the new leader

/**
 * M11: when the main app changed. A shift is when the app with the most messages over 3
 * months changes, that window has 30+ messages, and the next 3 windows keep the new
 * leader, so one busy month can't make a shift on its own. `months`: mo -> [7], one count per app.
 * Returns [{ mo (the window's last month), from, to }].
 */
function mainAppShifts(months) {
  const mos = [...months.keys()].sort((a, b) => a - b);
  if (!mos.length) return [];
  const leaders = [];
  for (let mo = mos[0] + SHIFT_WINDOW - 1; mo <= mos[mos.length - 1]; mo++) {
    const sum = Sources.zeros();
    for (let x = mo - SHIFT_WINDOW + 1; x <= mo; x++) {
      const v = months.get(x);
      if (v) for (let i = 0; i < sum.length; i++) sum[i] += v[i] || 0;
    }
    leaders.push({ mo, lead: leadingApp(sum, SHIFT_MIN) });
  }
  const out = [];
  let cur = null;
  for (let i = 0; i < leaders.length; i++) {
    const { lead } = leaders[i];
    if (lead == null || lead === cur) continue;
    if (cur == null) { cur = lead; continue; }
    if (i + SHIFT_HOLD >= leaders.length) break; // too recent to tell
    let holds = true;
    for (let j = i + 1; j <= i + SHIFT_HOLD; j++) if (leaders[j].lead !== lead) { holds = false; break; }
    if (!holds) continue;
    out.push({ mo: leaders[i].mo, from: cur, to: lead });
    cur = lead;
  }
  return out;
}

/**
 * R5: the strongest cross-app finding, as a highlight ({ kind, score, icon, parts }), or
 * null. `names`: app number -> name. `labelFor`: person key -> name.
 */
function crossAppHighlight(X, { labelFor = (k) => k, names = {} } = {}) {
  let best = null;
  const offer = (score, icon, parts) => { if (!best || score > best.score) best = { kind: 'apps', score, icon, parts }; };
  for (const [k, P] of X.people) {
    const person = { k, text: labelFor(k) };
    const apps = andList([...P.apps.keys()].sort((a, b) => a - b).map((s) => names[s] || String(s)));
    if (P.switches >= 10) {
      const you = P.switchBy[1] / P.switches;
      const share = Math.max(you, 1 - you);
      if (share >= 0.65) {
        offer(30 + (share - 0.5) * 40, '🔀', you >= 0.5
          ? ['When you and ', person, ' switch apps mid-conversation, you make the move ', { b: pctText(share) }, ' of the time.']
          : ['When you and ', person, ' switch apps mid-conversation, ', person, ' makes the move ', { b: pctText(share) }, ' of the time.']);
      }
    }
    if (P.sessions >= 10 && P.bounceSessions / P.sessions >= 0.2) {
      const share = P.bounceSessions / P.sessions;
      offer(28 + share * 30, '🔁', ['You and ', person, ' bounce back and forth between ', apps, ' in ', { b: pctText(share) }, ' of your conversations.']);
    }
    const shift = P.shifts[P.shifts.length - 1];
    if (shift) {
      const when = fmtDate.monthShort(monthToTs(shift.mo));
      offer(34, '🧭', ['You and ', person, ' moved from ', { b: names[shift.from] || String(shift.from) }, ' to ', { b: names[shift.to] || String(shift.to) }, ' around ', when, '.']);
    }
  }
  return best;
}
