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

const HL_DAY = 86400e3;
const HL_YEAR = 365.25 * HL_DAY;
const traitIndex = (bit) => TRAITS.findIndex((t) => t.bit === bit);
const LOVE_EXAMPLES = ' (love you, ❤️, 😘)';

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

  moreHighlights(msgs, A, { add, person, single, rows, busy, oneOnOne, total });
  dynamicsHighlights(A, { add, person, single, rows, oneOnOne });

  // How a linked person moves between apps (spec 007 R5): crossAppHighlight's pick
  if (crossApp) out.push(crossApp);

  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** The larger of two counts over the smaller (at least 1), and whether the second is larger. */
function leanOf(a, b) {
  return { ratio: Math.max(a, b) / Math.max(Math.min(a, b), 1), second: b > a };
}

/** Spec 008: moments, relationships over time, how two people talk, and habits. */
function moreHighlights(msgs, A, { add, person, single, rows, busy, oneOnOne, total }) {
  const firstT = msgs[0].t;
  const lastT = msgs[msgs.length - 1].t;
  // 1-on-1 conversations to compare the two sides of: the busy ones, or the one selected
  const pairs = single ? rows.filter((r) => !r.group && r.n >= 50) : oneOnOne;
  const solo = single && !rows[0].group ? rows[0] : null;

  // AC1: the busiest day
  const bd = A.busiestDay;
  const avgDay = total / Math.max(A.activeDays, 1);
  if (bd && bd.n >= 100 && bd.n >= 4 * avgDay) {
    const score = 28 + Math.min(12, Math.log2(bd.n / avgDay) * 3);
    const when = fmtDate.weekday(dayToTs(bd.d));
    if (single) add('busiestDay', score, '🗓️', ['The busiest day here was ', when, ': ', { b: fmtNum(bd.n) }, ' messages.']);
    else {
      const top = busiestConversation(msgs.filter((m) => m.d === bd.d));
      const parts = ['Your busiest day was ', when, ': ', { b: fmtNum(bd.n) }, ' messages'];
      if (top.n / bd.n >= 0.5) parts.push(', ', { b: pctText(top.n / bd.n) }, ' with ', person(top.k));
      add('busiestDay', score, '🗓️', [...parts, '.']);
    }
  }

  // AC2: the longest conversation without a break
  const ls = A.longestSession;
  if (ls && ls.n >= 100) {
    const over = { b: fmtDuration(ls.end - ls.start) };
    add('marathon', 27 + Math.min(10, Math.log2(ls.n / 100) * 4), '🏃', single
      ? ['The longest conversation here: ', { b: fmtNum(ls.n) }, ' messages over ', over, ' on ', fmtDate.weekday(ls.start), '.']
      : ['Your longest conversation: ', { b: fmtNum(ls.n) }, ' messages with ', person(ls.k), ' over ', over, ' on ', fmtDate.weekday(ls.start), '.']);
  }

  // AC3: the message latest in the night
  const ln = A.latestNight;
  if (ln && ln.tod >= 180) {
    add('latest', 16 + (ln.tod - 180) / 20, '🦉', single
      ? ['The latest late-night message here: ', { b: fmtDate.time(ln.t) }, ', on ', fmtDate.weekday(ln.t), '.']
      : ['Your latest late-night message: ', { b: fmtDate.time(ln.t) }, ', with ', person(ln.k), ' on ', fmtDate.weekday(ln.t), '.']);
  }

  // AC4: the biggest milestone in the last 6 months (a conversation's beats the total on a tie)
  let ms = null;
  for (const m of A.milestones) {
    if (m.n < 1000 || m.t < lastT - 182 * HL_DAY || (single && m.k == null)) continue;
    if (!ms || m.n > ms.n || (m.n === ms.n && ms.k == null)) ms = m;
  }
  if (ms) {
    const n = { b: fmtNum(ms.n) };
    add('milestone', ms.t >= lastT - 30 * HL_DAY ? 38 : 30, '🎉', single
      ? ['This conversation passed ', n, ' messages on ', fmtDate.weekday(ms.t), '.']
      : ms.k == null
        ? ['You passed ', n, ' messages in total on ', fmtDate.weekday(ms.t), '.']
        : ['You passed ', n, ' messages with ', person(ms.k), ' on ', fmtDate.weekday(ms.t), '.']);
  }

  // AC5: the oldest conversation that's still going
  let old = null;
  for (const r of single ? rows : busy) {
    if (r.bc.last < lastT - 91 * HL_DAY) continue;
    if (!old || r.bc.first < old.bc.first) old = r;
  }
  const oldFirst = single ? firstT : old?.bc.first;
  const years = old ? Math.floor((lastT - oldFirst) / HL_YEAR) : 0;
  if (years >= (single ? 2 : 3)) {
    const since = [' since ', { b: fmtDate.monthShort(oldFirst) }, ': over ', { b: years === 1 ? '1 year' : `${years} years` }, '.'];
    add('oldest', 16 + Math.min(16, years * 1.5), '🕰️', single ? ["You've been talking here", ...since] : ["You've been texting ", person(old.k), ...since]);
  }

  // AC6: a new conversation that's already near the top
  if (!single && lastT - firstT >= 365 * HL_DAY) {
    for (let i = 1; i < Math.min(rows.length, 5); i++) {
      const r = rows[i];
      if (r.n < 50 || r.bc.first < lastT - 182 * HL_DAY) continue;
      add('newcomer', 36 + (4 - i) * 2, '✨', ['Your conversation with ', person(r.k), ' started in ', { b: fmtDate.monthShort(r.bc.first) }, ' and is already your ', { b: `#${i + 1}` }, '.']);
      break;
    }
  }

  // AC7: the longest silence in a conversation that picked back up
  let gap = null;
  for (const r of single ? rows : oneOnOne) {
    for (const g of r.bc.silences) {
      if (g.len < 90 || g.before < 20 || r.n - g.before < 20) continue;
      if (!gap || g.len > gap.g.len) gap = { k: r.k, g };
    }
  }
  if (gap) {
    const days = { b: `${fmtNum(gap.g.len)} days` };
    add('reunion', 24 + Math.min(14, gap.g.len / 60), '🤝', single
      ? ['The longest silence here: ', days, ', until ', fmtDate.weekday(gap.g.end), '.']
      : ['You and ', person(gap.k), ' went ', days, ' without a message, then picked back up on ', fmtDate.weekday(gap.g.end), '.']);
  }

  // AC8: the biggest calendar year
  if (A.yearMonths.size >= 3) {
    const byYear = new Map([...A.yearMonths].map(([y, months]) => [y, months.reduce((a, b) => a + b, 0)]));
    const [year, n] = [...byYear].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
    const start = new Date(firstT);
    const prevWhole = year - 1 > start.getFullYear() || (year - 1 === start.getFullYear() && start.getMonth() === 0 && start.getDate() === 1);
    const ratio = prevWhole && byYear.get(year - 1) ? n / byYear.get(year - 1) : 0;
    const parts = [{ b: String(year) }, single ? ' was the biggest year here: ' : ' was your biggest year: ', { b: fmtNum(n) }, ' messages'];
    if (ratio >= 1.3) parts.push(', ', { b: timesText(ratio) }, ' as many as in ', String(year - 1));
    add('year', 17 + (ratio >= 1.3 ? Math.min(8, Math.log2(ratio) * 4) : 0), '📅', [...parts, '.']);
  }

  // AC9: who laughs more, per message
  const laughI = traitIndex(4);
  let laugh = null;
  for (const r of pairs) {
    const { n, traits } = r.bc;
    if (n[0] < 20 || n[1] < 20) continue;
    const them = traits[0][laughI], you = traits[1][laughI];
    const youMore = you / n[1] > them / n[0]; // by the real rates (laughs per message)
    const [hi, hiN, lo, loN] = youMore ? [you, n[1], them, n[0]] : [them, n[0], you, n[1]];
    if (hi < 20) continue;
    // A side that never laughs counts as 1 laugh, so the ratio stays finite; that can only shrink it
    const ratio = hi / hiN / (Math.max(lo, 1) / loN);
    if (ratio >= 2 && (!laugh || ratio > laugh.ratio)) laugh = { k: r.k, ratio, you: youMore };
  }
  if (laugh) {
    const x = { b: timesText(laugh.ratio) };
    add('laughs', 24 + Math.min(10, Math.log2(laugh.ratio) * 4), '😂', laugh.you
      ? ['You laugh (lol, haha, 😂) ', x, ' as often as ', person(laugh.k), ' does.']
      : [person(laugh.k), ' laughs (lol, haha, 😂) ', x, ' as often as you do.']);
  }

  // AC10: who asks the questions
  const askI = traitIndex(1);
  let ask = null;
  for (const r of pairs) {
    const you = r.bc.traits[1][askI], all = you + r.bc.traits[0][askI];
    if (all < 30) continue;
    const share = you / all, lean = Math.abs(share - 0.5);
    if (lean >= 0.15 && (!ask || lean > ask.lean)) ask = { k: r.k, share, lean };
  }
  if (ask) {
    const pct = { b: pctText(Math.max(ask.share, 1 - ask.share)) };
    const where = single ? [' of the questions here.'] : ask.share >= 0.5 ? [' of the questions with ', person(ask.k), '.'] : [' of the questions between you.'];
    add('questions', 21 + ask.lean * 30, '❓', ask.share >= 0.5 ? ['You ask ', pct, ...where] : [person(ask.k), ' asks ', pct, ...where]);
  }

  // AC11: who double-texts
  let dbl = null;
  for (const r of pairs) {
    const [them, you] = r.bc.doubles;
    const { ratio, second } = leanOf(them, you);
    if (Math.max(them, you) >= 30 && ratio >= 2.5 && (!dbl || ratio > dbl.ratio)) dbl = { k: r.k, ratio, you: second };
  }
  if (dbl) {
    const x = { b: timesText(dbl.ratio) };
    add('doubles', 23 + Math.min(10, Math.log2(dbl.ratio) * 3), '💬', dbl.you
      ? ['You double-text ', person(dbl.k), ' ', x, ' as often as they double-text you.']
      : [person(dbl.k), ' double-texts you ', x, ' as often as you double-text them.']);
  }

  // AC12: the fastest replier, out of at least two
  if (!single) {
    const fast = oneOnOne.filter((r) => r.bc.replyN[0] >= 30 && r.bc.replyMedian[0] != null).sort((a, b) => a.bc.replyMedian[0] - b.bc.replyMedian[0]);
    if (fast.length >= 2 && fast[0].bc.replyMedian[0] <= 120e3) {
      add('fastest', 19, '⚡', [person(fast[0].k), ' is your fastest replier: they usually answer in ', { b: fmtDuration(fast[0].bc.replyMedian[0]) }, '.']);
    }
  }

  // AC13: an emoji that belongs to one conversation
  if (!single) {
    const all = emojiTotal(A.emojiFreq);
    let sig = null;
    for (const r of busy.slice(0, 15)) {
      const e = signatureEmoji(r.bc, A.emojiFreq, all);
      const uses = e && r.bc.emoji.get(e);
      if (!uses || uses < 5) continue;
      let mine = 0;
      for (const n of r.bc.emoji.values()) mine += n;
      const g = A.emojiFreq.get(e);
      const lift = uses / mine / ((g[0] + g[1]) / all);
      if (lift >= 5 && (!sig || lift > sig.lift)) sig = { k: r.k, e, lift };
    }
    if (sig) add('sigEmoji', 21 + Math.min(10, Math.log2(sig.lift) * 2), sig.e, [{ b: sig.e }, ' is your emoji with ', person(sig.k), ': used ', { b: timesText(sig.lift) }, ' as often there as across all your conversations.']);
  }

  // AC14: photos
  if (!single) {
    const topBy = (o) => rows.reduce((best, r) => (!best || r.bc.ph[o] > best.bc.ph[o] ? r : best), null);
    const sent = A.media.ph[1], got = A.media.ph[0];
    const to = topBy(1), from = topBy(0);
    if (sent >= 30 && to.bc.ph[1] / sent >= 0.3) {
      add('photos', 19 + (to.bc.ph[1] / sent) * 10, '📸', [person(to.k), ' gets ', { b: pctText(to.bc.ph[1] / sent) }, ' of the photos you send.']);
    } else if (got >= 30 && from.bc.ph[0] / got >= 0.3) {
      add('photos', 19 + (from.bc.ph[0] / got) * 10, '📸', [person(from.k), ' sends you the most photos: ', { b: fmtNum(from.bc.ph[0]) }, '.']);
    }
  } else if (solo) {
    const [them, you] = A.media.ph;
    const { ratio, second } = leanOf(them, you);
    if (them + you >= 30 && ratio >= 2) {
      const x = { b: timesText(ratio) };
      add('photos', 19, '📸', second ? ['You send ', x, ' as many photos as ', person(solo.k), ' here.'] : [person(solo.k), ' sends ', x, ' as many photos as you here.']);
    }
  }

  // AC15: the weekend conversation and the early-morning one
  const windows = [
    { kind: 'weekend', icon: '🛋️', min: 0.5, count: (bc) => bc.weekend, overall: (A.dow[0][0] + A.dow[1][0] + A.dow[0][6] + A.dow[1][6]) / total,
      all: ' is your weekend conversation: ', what: 'on a Saturday or Sunday' },
    { kind: 'morning', icon: '🌅', min: 0.35, count: (bc) => bc.morning, overall: [0, 1].reduce((a, o) => a + A.hour[o].slice(MORNING_HOURS[0], MORNING_HOURS[1]).reduce((x, y) => x + y, 0), 0) / total,
      all: ' is your early-morning conversation: ', what: `between ${hourText(MORNING_HOURS[0])} and ${hourText(MORNING_HOURS[1])}` },
  ];
  for (const w of windows) {
    const need = single ? w.min : Math.max(w.min, w.overall + 0.15);
    let best = null;
    for (const r of single ? rows : busy) {
      if (r.n < 100) continue;
      const share = w.count(r.bc) / r.n;
      if (share >= need && (!best || share > best.share)) best = { k: r.k, share };
    }
    if (!best) continue;
    const pct = { b: pctText(best.share) };
    add(w.kind, 18 + (best.share - w.min) * 20, w.icon, single
      ? [pct, ` of messages here are ${w.what}.`]
      : [person(best.k), w.all, pct, ` of your messages with them are ${w.what}.`]);
  }

  // AC16: love-you messages
  const loveI = traitIndex(32);
  const loveAll = A.traits[0][loveI] + A.traits[1][loveI];
  if (!single && loveAll >= 20) {
    const top = rows.reduce((best, r) => {
      const n = r.bc.traits[0][loveI] + r.bc.traits[1][loveI];
      return !best || n > best.n ? { k: r.k, n } : best;
    }, null);
    if (top.n / loveAll >= 0.4) add('love', 22 + (top.n / loveAll) * 10, '❤️', [{ b: pctText(top.n / loveAll) }, ` of your love-you messages${LOVE_EXAMPLES} are with `, person(top.k), '.']);
  } else if (solo && loveAll >= 20) {
    const { ratio, second } = leanOf(A.traits[0][loveI], A.traits[1][loveI]);
    if (ratio >= 2) {
      const x = { b: timesText(ratio) };
      add('love', 22, '❤️', second
        ? ['You send ', x, ` as many love-you messages${LOVE_EXAMPLES} as `, person(solo.k), ' here.']
        : [person(solo.k), ' sends ', x, ` as many love-you messages${LOVE_EXAMPLES} as you here.`]);
    }
  }
}

/** Spec 017: how two people talk. Last word, no reply, questions that got a reply, and style match. */
function dynamicsHighlights(A, { add, person, single, rows, oneOnOne }) {
  const pairs = single ? rows.filter((r) => !r.group && r.n >= 50) : oneOnOne;
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

  // AC7: who has the last word
  let last = null;
  for (const r of pairs) {
    const [them, you] = r.bc.lastWord;
    const n = them + you;
    if (n < 30) continue;
    const share = Math.max(them, you) / n;
    if (share >= 0.7 && (!last || share > last.share)) last = { k: r.k, share, you: you > them };
  }
  if (last) {
    const pct = { b: pctText(last.share) };
    const where = single ? ' of conversations here.' : null;
    add('lastWord', 26 + (last.share - 0.5) * 40, '🎤', last.you
      ? ['You get the last word in ', pct, ...(where ? [where] : [' of your conversations with ', person(last.k), '.'])]
      : [person(last.k), ' gets the last word in ', pct, where || ' of your conversations.']);
  }

  // AC8: who writes and hears nothing back
  let none = null;
  for (const r of pairs) {
    const [them, you] = r.bc.noReply;
    const { ratio, second } = leanOf(them, you);
    if (Math.max(them, you) >= 15 && ratio >= 3 && (!none || ratio > none.ratio)) none = { k: r.k, ratio, you: second, hi: Math.max(them, you), lo: Math.min(them, you) };
  }
  if (none) {
    const p = person(none.k);
    const within = ` and heard nothing back within ${fmtGapWords(A.gap)}.`;
    const other = none.lo === 0 ? ' It never went the other way.' : none.lo === 1 ? [' It went the other way ', { b: 'once' }, '.'] : [' It went the other way ', { b: fmtNum(none.lo) }, ' times.'];
    add('noReply', 26 + Math.min(10, Math.log2(none.ratio) * 4), '📭', [
      { b: fmtNum(none.hi) }, ...(none.you ? [' times you messaged ', p] : [' times ', p, ' messaged you']), within, other,
    ].flat());
  }

  // AC9: whose questions get a reply
  let ask = null;
  for (const r of pairs) {
    const { qAsked, qReplied } = r.bc;
    if (qAsked[0] < 30 || qAsked[1] < 30) continue;
    const them = qReplied[0] / qAsked[0], you = qReplied[1] / qAsked[1];
    const points = Math.round(Math.abs(you - them) * 100);
    if (points >= 25 && (!ask || points > ask.points)) ask = { k: r.k, them, you, points };
  }
  if (ask) {
    const p = person(ask.k);
    add('questionReplies', 24 + ask.points / 4, '💭', ask.you > ask.them
      ? [{ b: pctText(ask.you) }, ' of your questions get a reply from ', p, ', but only ', { b: pctText(ask.them) }, ' of theirs get one from you.']
      : [{ b: pctText(ask.them) }, ' of ', p, "'s questions get a reply from you, but only ", { b: pctText(ask.you) }, ' of yours get one from them.']);
  }

  // AC10: writing more alike than before
  let like = null;
  for (const r of pairs) {
    const series = styleSeries(r.bc.style);
    if (series.length < 6 || series[series.length - 1][0] - series[0][0] < 11) continue;
    const from = Math.round(mean(series.slice(0, 3).map((x) => x[1])));
    const to = Math.round(mean(series.slice(-3).map((x) => x[1])));
    if (to - from >= 15 && (!like || to - from > like.to - like.from)) like = { k: r.k, from, to };
  }
  if (like) {
    const up = [' style match up from ', { b: String(like.from) }, ' to ', { b: String(like.to) }, '.'];
    add('converge', 28 + Math.min(12, (like.to - like.from) / 3), '🪞', single
      ? ['You write more alike here than you used to:', ...up]
      : ['You and ', person(like.k), ' write more alike than you used to:', ...up]);
  }
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
