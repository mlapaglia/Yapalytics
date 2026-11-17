/*
 * Plain-language findings: Highlights (short sentences about the selection), the facts
 * behind a person's profile, and On this day (the same date in earlier years). Pure
 * functions over message records and aggregateMessages results; app.js renders them.
 *
 * A highlight's text is a list of parts: strings, { b } for emphasis, and { k, text } for a
 * conversation (rendered as a link to its profile).
 */

const HIGHLIGHT_LIMIT = 6;
const WEEKDAY_PLURAL = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];

const pctText = (x) => Math.round(x * 100) + '%';
const timesText = (x) => (x >= 10 ? Math.round(x) : Math.round(x * 10) / 10) + '×';
const hourText = (h) => new Date(2000, 0, 1, h).toLocaleTimeString(undefined, { hour: 'numeric' });

/** Index of the busiest slot, adding [received, sent] arrays together. */
function peakOf([r, s]) {
  let best = 0;
  for (let i = 1; i < r.length; i++) if (r[i] + s[i] > r[best] + s[best]) best = i;
  return best;
}

/**
 * The most notable findings in a selection, most interesting first (at most one of each
 * kind). `single`: the selection is one conversation, so sentences talk about "here".
 */
function buildHighlights(msgs, A, { labelFor = (k) => k, senderLabel = (x) => x, single = false, limit = HIGHLIGHT_LIMIT, crossApp = null } = {}) {
  if (!msgs.length) return [];
  const out = [];
  const add = (kind, score, icon, parts) => out.push({ kind, score, icon, parts });
  const person = (k) => ({ k, text: labelFor(k) });
  const total = A.dir[0] + A.dir[1];
  const rows = [...A.byContact.entries()]
    .map(([k, bc]) => ({ k, bc, n: bc.n[0] + bc.n[1], group: k.startsWith('g:') }))
    .sort((a, b) => b.n - a.n);
  const busy = rows.filter((r) => r.n >= 50).slice(0, 25);
  const oneOnOne = busy.filter((r) => !r.group);

  // Who you talk to most
  if (!single && rows.length > 1) {
    const top = rows[0];
    add('top', 50 + (top.n / total) * 50, '🏆', [person(top.k), ' is your most-messaged conversation: ', { b: fmtNum(top.n) }, ' messages, ', { b: pctText(top.n / total) }, ' of everything.']);
  }

  // Who carries one conversation
  if (single && total >= 20) {
    const share = A.dir[1] / total;
    const others = rows[0].group ? 'The others' : person(rows[0].k);
    if (share >= 0.6) add('balance', 30, '⚖️', ['You send ', { b: pctText(share) }, ' of the messages here.']);
    else if (share <= 0.4) add('balance', 30, '⚖️', [others, rows[0].group ? ' send ' : ' sends ', { b: pctText(1 - share) }, ' of the messages here.']);
  }

  // The most lopsided reply speeds
  let gap = null;
  for (const r of oneOnOne) {
    const [them, you] = r.bc.replyMedian;
    if (them == null || you == null) continue;
    const slow = Math.max(them, you);
    const ratio = slow / Math.max(Math.min(them, you), 1000);
    if (ratio >= 3 && slow >= 10 * 60e3 && (!gap || ratio > gap.ratio)) gap = { k: r.k, them, you, ratio };
  }
  if (gap) {
    const p = person(gap.k);
    add('reply', 40 + Math.min(30, Math.log2(gap.ratio) * 8), '⏱️', gap.you < gap.them
      ? ['You usually reply to ', p, ' in ', { b: fmtDuration(gap.you) }, '; they take ', { b: fmtDuration(gap.them) }, '.']
      : [p, ' usually replies in ', { b: fmtDuration(gap.them) }, '; you take ', { b: fmtDuration(gap.you) }, '.']);
  }

  // Who starts the conversations
  let starts = null;
  for (const r of oneOnOne) {
    const n = r.bc.starters[0] + r.bc.starters[1];
    if (n < 8) continue;
    const share = r.bc.starters[1] / n;
    const lean = Math.abs(share - 0.5);
    if (lean >= 0.2 && (!starts || lean > starts.lean)) starts = { k: r.k, share, lean };
  }
  if (starts) {
    add('starts', 35 + starts.lean * 40, '👋', starts.share >= 0.5
      ? ['You start ', { b: pctText(starts.share) }, ' of conversations with ', person(starts.k), '.']
      : [person(starts.k), ' starts ', { b: pctText(1 - starts.share) }, ' of your conversations.']);
  }

  // Rising and fading conversations: the last 3 months against the 3 before
  const lastMo = msgs[msgs.length - 1].mo;
  if (lastMo - msgs[0].mo >= 5) {
    const sum = (bc, from, to) => {
      let n = 0;
      for (let mo = from; mo <= to; mo++) n += bc.months.get(mo) || 0;
      return n;
    };
    let up = null, down = null;
    for (const r of busy.slice(0, 15)) {
      const recent = sum(r.bc, lastMo - 2, lastMo);
      const before = sum(r.bc, lastMo - 5, lastMo - 3);
      if (before >= 30 && recent <= before * 0.4) {
        const drop = 1 - recent / before;
        if (!down || drop > down.drop) down = { k: r.k, drop, before };
      }
      if (before >= 5 && recent >= 30 && recent >= before * 2.5) {
        const x = recent / before;
        if (!up || x > up.x) up = { k: r.k, x };
      }
    }
    if (down && down.drop === 1) {
      add('down', 45, '📉', single
        ? ['No messages here in the last 3 months, after ', { b: fmtNum(down.before) }, ' in the 3 before.']
        : ['No messages with ', person(down.k), ' in the last 3 months, after ', { b: fmtNum(down.before) }, ' in the 3 before.']);
    } else if (down) {
      add('down', 45, '📉', [single ? 'Messages here are' : ['Your messages with ', person(down.k), ' are'], ' down ', { b: pctText(down.drop) }, ' in the last 3 months compared with the 3 before.'].flat());
    }
    if (up) add('up', 44, '📈', single
      ? ["You're texting ", { b: timesText(up.x) }, ' as much in the last 3 months as in the 3 before.']
      : ["You're texting ", person(up.k), ' ', { b: timesText(up.x) }, ' as much in the last 3 months as in the 3 before.']);
  }

  // Longest daily streak with one conversation
  const streak = rows.reduce((best, r) => (!best || r.bc.longestRun > best.bc.longestRun ? r : best), null);
  if (streak && streak.bc.longestRun >= 7) {
    const days = { b: `${fmtNum(streak.bc.longestRun)} days` };
    add('streak', 25 + Math.min(20, streak.bc.longestRun / 3), '🔥', single
      ? ['Your longest run here: ', days, ' in a row with at least one message.']
      : ['Your longest streak with one conversation: ', days, ' in a row with ', person(streak.k), '.']);
  }

  // Who the late nights are with
  if (!single) {
    const night = new Map();
    let all = 0;
    for (const m of msgs) {
      if (m.h >= NIGHT_END_HOUR) continue;
      all++;
      night.set(m.k, (night.get(m.k) || 0) + 1);
    }
    const [k, n] = [...night].sort((a, b) => b[1] - a[1])[0] || [];
    if (all >= 20 && n / all >= 0.4) add('night', 22, '🌙', [{ b: pctText(n / all) }, ' of your late-night texts (midnight to 5 am) are with ', person(k), '.']);
  }

  // Who writes longer messages
  let length = null;
  for (const r of oneOnOne.slice(0, 10)) {
    const { lenSum, lenN } = r.bc;
    if (lenN[0] < 30 || lenN[1] < 30) continue;
    const ratio = (lenSum[1] / lenN[1]) / (lenSum[0] / lenN[0]);
    const lean = Math.max(ratio, 1 / ratio);
    if (lean >= 2 && (!length || lean > length.lean)) length = { k: r.k, ratio, lean };
  }
  if (length) {
    add('length', 18, '✍️', length.ratio > 1
      ? ['You write ', { b: timesText(length.lean) }, ' longer messages than ', person(length.k), ' does.']
      : [person(length.k), ' writes ', { b: timesText(length.lean) }, ' longer messages than you.']);
  }

  // Your go-to emoji
  const emoji = [...A.emojiFreq].sort((a, b) => b[1][1] - a[1][1])[0];
  if (emoji && emoji[1][1] >= 10) add('emoji', 20, emoji[0], ['Your go-to emoji', single ? ' here' : '', ' is ', { b: emoji[0] }, ', sent ', { b: fmtNum(emoji[1][1]) }, ' times.']);

  // Daily rhythm
  if (total >= 50) {
    add('rhythm', 15, '🕘', [single ? 'This conversation is busiest around ' : 'You text most around ', { b: hourText(peakOf(A.hour)) }, ', and ', { b: WEEKDAY_PLURAL[peakOf(A.dow)] }, ' are the busiest day.']);
  }

  // The loudest person in group chats
  const loud = [...A.groupSenders].filter(([x]) => x !== 'You').sort((a, b) => b[1] - a[1])[0];
  if (loud && loud[1] >= 50 && (!single || rows[0].group)) {
    add('groups', 12, '👥', [{ b: senderLabel(loud[0]) }, single ? ' is the most active member here, with ' : ' is the most active in your group chats, with ', { b: fmtNum(loud[1]) }, ' messages.']);
  }

  // How a linked person moves between apps (spec 007 R5): crossAppHighlight's pick
  if (crossApp) out.push(crossApp);

  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** A highlight's parts as plain text (for tests and titles). */
function highlightText(h) {
  return h.parts.map((p) => (typeof p === 'string' ? p : p.b ?? p.text)).join('');
}

/** Everything a profile shows about one conversation, from its messages and their aggregate. */
function profileFacts(msgs, A) {
  const questions = TRAITS.findIndex((t) => t.bit === 1);
  const side = (o) => ({
    messages: A.dir[o],
    avgLen: A.lenN[o] ? Math.round(A.lenSum[o] / A.lenN[o]) : 0,
    reply: A.replyMedian[o],
    starts: A.starters[o],
    doubles: A.doubleTexts[o],
    questions: questions >= 0 ? A.traits[o][questions] : 0,
    night: A.hour[o].slice(0, NIGHT_END_HOUR).reduce((a, b) => a + b, 0),
    emoji: [...A.emojiFreq].filter(([, v]) => v[o]).sort((a, b) => b[1][o] - a[1][o]).slice(0, 3).map(([e, v]) => [e, v[o]]),
    words: A.words[o],
  });
  const months = [...A.months.entries()].map(([mo, v]) => ({ mo, n: v.c[0] + v.c[1] }));
  return {
    n: A.n,
    first: msgs[0] || null,
    firstText: msgs.find((m) => m.b) || null,
    last: msgs[msgs.length - 1] || null,
    activeDays: A.activeDays,
    spanDays: A.spanDays,
    longestStreak: A.longestStreak,
    busiestDay: A.busiestDay,
    busiestMonth: months.sort((a, b) => b.n - a.n || a.mo - b.mo)[0] || null,
    longestSession: A.longestSession,
    peakHour: msgs.length ? peakOf(A.hour) : null,
    peakDow: msgs.length ? peakOf(A.dow) : null,
    you: side(1),
    them: side(0),
  };
}

/**
 * Messages on `month` (0–11) / `day` in local time, before `before` (a timestamp), grouped
 * by year, newest first: [{ year, msgs }].
 */
function sameDayHistory(msgs, month, day, before = Infinity) {
  const byYear = new Map();
  for (const m of msgs) {
    if (m.mo % 12 !== month || m.t >= before) continue; // cheap test first: most messages fail it
    const d = new Date(m.t);
    if (d.getDate() !== day) continue;
    const y = d.getFullYear();
    let list = byYear.get(y);
    if (!list) byYear.set(y, (list = []));
    list.push(m);
  }
  return [...byYear].sort((a, b) => b[0] - a[0]).map(([year, list]) => ({ year, msgs: list }));
}

/** The calendar days (month * 100 + day) that have messages before `before`. */
function daysWithHistory(msgs, before = Infinity) {
  const days = new Set();
  for (const m of msgs) {
    if (m.t >= before) continue;
    const d = new Date(m.t);
    days.add(d.getMonth() * 100 + d.getDate());
  }
  return days;
}

/** The closest calendar day to month/day (either side) that has messages, or null. */
function nearestDayWithHistory(days, month, day) {
  for (let off = 1; off <= 183; off++) {
    for (const sign of [1, -1]) {
      const d = new Date(2000, month, day + sign * off); // 2000 is a leap year, so Feb 29 exists
      if (days.has(d.getMonth() * 100 + d.getDate())) return { month: d.getMonth(), day: d.getDate() };
    }
  }
  return null;
}

/** Up to `n` messages that give a feel for a day: readable texts, spread through it. */
function pickMoments(msgs, n = 3) {
  const readable = msgs.filter((m) => m.b && m.l >= 12 && m.l <= 180);
  const pool = readable.length >= n ? readable : msgs.filter((m) => m.b);
  if (pool.length <= n) return pool;
  return Array.from({ length: n }, (_, i) => pool[Math.floor(((i + 0.5) * pool.length) / n)]);
}

/** The conversation with the most messages in a list, and how many: { k, n } or null. */
function busiestConversation(msgs) {
  const counts = new Map();
  for (const m of msgs) counts.set(m.k, (counts.get(m.k) || 0) + 1);
  const [k, n] = [...counts].sort((a, b) => b[1] - a[1])[0] || [];
  return k == null ? null : { k, n, of: counts.size };
}
