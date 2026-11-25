/*
 * Reactions (spec 027): every reaction we can read, as one list of events, and what the
 * dashboard counts from them.
 *
 * Two kinds come in. Reactions stored on a message (`rx`: Instagram, Messenger,
 * Telegram, Google Chat, iMessage tapbacks) already know their message. Reactions sent
 * as texts (SMS/RCS: `Loved “see you soon 😊”`, `Loved an image`) are kept out of the
 * messages by the dataset and matched here to the message they quote, or to the latest
 * file of the kind they name, in the 24 hours before them.
 *
 * Reactions never count as messages. They count in the emoji statistics and the
 * reaction cards only.
 */

const REACT_WINDOW = 24 * 3600e3; // how far back a reaction text can match (R5, R6)
const REACT_MEDIAN_MIN = 10; // timed reactions a side needs for a median (R13)
const REACT_TOP = 5; // most-reacted messages shown (R16)
const REACT_WHO_MIN = 50; // messages from each side for a Who reacts the most row (R15)
const REACT_WHO_ROWS = 10;
const REACT_BINS = [
  { max: 60e3, label: '< 1 min' },
  { max: 5 * 60e3, label: '1–5 min' },
  { max: 15 * 60e3, label: '5–15 min' },
  { max: 3600e3, label: '15–60 min' },
  { max: 3 * 3600e3, label: '1–3 h' },
  { max: 8 * 3600e3, label: '3–8 h' },
  { max: 24 * 3600e3, label: '8–24 h' },
  { max: Infinity, label: '> 1 day' },
];

// An emoji with a text-style default (❤, ‼) gets the emoji-style selector, so Instagram's
// ❤ and a tapback's ❤️ count as one emoji.
const LONE_PICTO_RE = /^\p{Extended_Pictographic}$/u;
const EMOJI_STYLE_RE = /\p{Emoji_Presentation}/u;
function reactionEmoji(r) {
  return LONE_PICTO_RE.test(r) && !EMOJI_STYLE_RE.test(r) ? r + '️' : r;
}

// Quotes and the messages they quote are compared with invisible marks dropped, spaces
// collapsed, curly and straight quotes alike, and a trailing … dropped (R5).
const QUOTE_MARKS_RE = /[​‌‎‏‪-‮⁦-⁩﻿]/g;
function tidyQuote(s) {
  return s
    .replace(QUOTE_MARKS_RE, '')
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”„«»]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s?(?:…|\.\.\.)$/, '');
}

/** Does message `m` carry the kind of file a reaction names (R6)? */
function hasReactKind(m, mk) {
  switch (mk) {
    case 'ph': return m.ph > 0 || m.gf > 0;
    case 'vd': return m.vd > 0;
    case 'gf': return m.gf > 0;
    case 'au': return m.au > 0;
    case 'link': return !!(m.f & T_LINK);
    default: return m.ph + m.gf + m.vd + m.au + m.ot > 0;
  }
}

/** Index of the first record in time-sorted `list` later than `t`. */
function afterTime(list, t) {
  let a = 0, b = list.length;
  while (a < b) {
    const mid = (a + b) >> 1;
    if (list[mid].t <= t) a = mid + 1; else b = mid;
  }
  return a;
}

/**
 * The message reaction text `x` is on, from its thread's time-sorted messages, or null
 * (R5, R6): the latest one in the 24 hours before it with the quoted text (or one that
 * starts with it), or with the kind of file it names.
 */
function findReactionTarget(x, list) {
  const rv = x.rv;
  const from = x.t - REACT_WINDOW;
  const last = afterTime(list, x.t) - 1;
  if (rv.mk) {
    for (let i = last; i >= 0 && list[i].t >= from; i--) if (hasReactKind(list[i], rv.mk)) return list[i];
    return null;
  }
  const q = tidyQuote(rv.q || '');
  if (!q) return null;
  let startsWith = null;
  for (let i = last; i >= 0 && list[i].t >= from; i--) {
    const b = list[i].b;
    if (!b) continue;
    const tb = tidyQuote(b);
    if (!rv.cut && tb === q) return list[i];
    if (!startsWith && tb.startsWith(q)) {
      if (rv.cut) return list[i];
      startsWith = list[i];
    }
  }
  return startsWith;
}

const isGroupKey = (k) => k.startsWith('g:');
const monthOfTime = (t) => {
  const d = new Date(t);
  return d.getFullYear() * 12 + d.getMonth();
};

/** Is `name`, a reactor on a message from app `s`, you (spec 004 R9)? */
function isYouReacting(s, name, owners) {
  if (name === 'You') return true;
  return hasOwner(s) && !!owners[s] && (name === owners[s].name || isDefaultOwner(s, name));
}

/**
 * Every reaction in `D` as events (spec 027), and the chips matched reaction texts add
 * under their message in Messages (R8). Runs in rederive, after `o`, links and labels.
 *
 * An event: { r: emoji, you: 1 or 0, who: 'you', a sender or null, t: when (or null),
 * mo: month, m: the record it's filtered by (its message, or the text when unmatched),
 * target: its message or null, lag: ms to react or null, own: on the reactor's own
 * message (null when unknown), s: app, text: it came as a text }.
 */
function buildReactions(D, owners) {
  const events = [];
  const chips = new Map(); // message -> [{ r, c, n }]
  const byThread = new Map();
  for (const m of D.msgs) {
    const k = m.tk || m.k;
    let list = byThread.get(k);
    if (!list) byThread.set(k, (list = []));
    list.push(m);
  }

  // Reaction texts, in time order so removals and changes apply to what came before (R7).
  const current = new Map(); // message -> Map(who -> event)
  for (const x of D.reactionTexts) {
    const thread = x.tk || x.k;
    const you = x.o ? 1 : 0;
    const who = you ? 'you' : x.sk || x.sn || thread;
    const r = reactionEmoji(x.rv.r);
    const target = findReactionTarget(x, byThread.get(thread) || []);
    if (x.rv.rm) {
      const per = target && current.get(target);
      const e = per && per.get(who);
      if (e && e.r === r) {
        e.gone = true;
        per.delete(who);
      }
      continue;
    }
    if (!target) {
      events.push({ r, you, who, t: x.t, mo: x.mo, m: x, target: null, lag: null, own: null, s: x.s, text: true });
      continue;
    }
    let per = current.get(target);
    if (!per) current.set(target, (per = new Map()));
    const prev = per.get(who);
    if (prev) {
      prev.r = r; // a changed reaction keeps the time of the first (R7)
      continue;
    }
    const own = you ? target.o === 1 : target.o === 0 && (!isGroupKey(thread) || (x.sk ? x.sk === target.sk : !!x.sn && x.sn === target.sn));
    const e = { r, you, who, t: x.t, mo: x.mo, m: target, target, lag: x.t - target.t, own, s: x.s, text: true };
    per.set(who, e);
    events.push(e);
  }
  for (const [m, per] of current) {
    const list = [];
    for (const e of per.values()) {
      const name = e.you ? 'You' : (D.contacts.get(e.who) || D.contacts.get(m.tk || m.k) || {}).label || e.who;
      const chip = list.find((c) => c.r === e.r);
      if (chip) { chip.c++; chip.n.push(name); } else list.push({ r: e.r, c: 1, n: [name] });
    }
    if (list.length) chips.set(m, list);
  }

  // Reactions stored on messages.
  for (const m of D.msgs) {
    if (!m.rx) continue;
    const group = isGroupKey(m.tk || m.k);
    for (const x of m.rx) {
      const r = reactionEmoji(x.r);
      x.n.forEach((name, i) => {
        const you = isYouReacting(m.s, name, owners) ? 1 : 0;
        const at = (x.at && x.at[i]) || null;
        const lag = at != null && at >= m.t ? at - m.t : null;
        // Apps that name senders say whose message it is; otherwise a 1-on-1's other side sent it.
        const own = you ? m.o === 1 : m.o === 0 && (m.sn ? m.sn === name : !group);
        events.push({ r, you, who: you ? 'you' : name, t: lag != null ? at : null, mo: lag != null ? monthOfTime(at) : m.mo, m, target: m, lag, own, s: m.s, text: false });
      });
      // Reactors the export counts but doesn't name (Telegram): someone else, we can't say who.
      for (let i = x.n.length; i < x.c; i++) {
        events.push({ r, you: 0, who: null, t: null, mo: m.mo, m, target: m, lag: null, own: group ? null : m.o === 0, s: m.s, text: false });
      }
    }
  }
  return { events: events.filter((e) => !e.gone), chips };
}

/** The events whose record is in the selection (R9): conversation, app, groups and dates. */
function selectReactions(events, { contact = 'all', source = 'all', groups = true, from = null, to = null } = {}) {
  return events.filter(({ m }) => (contact === 'all' ? groups || !isGroupKey(m.k) : m.k === contact)
    && (source === 'all' || (m.s || 0) === source)
    && (from == null || m.t >= from)
    && (to == null || m.t <= to));
}

/** Did reactor `e` send message `m`? */
function sentByReactor(m, e) {
  if (e.you) return m.o === 1;
  if (m.o === 1) return false;
  if (!isGroupKey(m.tk || m.k)) return true;
  return m.sk === e.who || m.sn === e.who;
}

/**
 * R14: does the reactor send nothing else in the conversation after reacting? The
 * conversation ends at the first silence longer than `gap`. Null when it can't be told
 * (no time, or someone unnamed in a group).
 */
function reactedInstead(e, byKey, gap) {
  if (e.t == null || (!e.you && e.who == null)) return null;
  const list = byKey.get(e.m.k) || [];
  let prev = e.t;
  for (let i = afterTime(list, e.t); i < list.length; i++) {
    const m = list[i];
    if (m.t - prev > gap) return true;
    if (sentByReactor(m, e)) return false;
    prev = m.t;
  }
  return true;
}

/**
 * What the reaction cards show for `events` (already selected). Sides are [them, you].
 *   n, perEmoji (emoji -> [them, you]), emojiMonths (mo -> Map(emoji -> n)),
 *   byConvo (key -> { n, emoji: Map }), hist (per side, over REACT_BINS), lags, median,
 *   timed, timedApps, own, instead and judged (reactions R14 could tell about),
 *   unmatched (reaction texts with no message), top ([{ m, n, chips }]).
 */
function aggregateReactions(events, { gap = Infinity, byKey = new Map() } = {}) {
  const R = {
    n: [0, 0],
    perEmoji: new Map(),
    emojiMonths: new Map(),
    byConvo: new Map(),
    hist: pair(REACT_BINS.length),
    lags: [[], []],
    median: [null, null],
    timed: [0, 0],
    timedApps: new Set(),
    own: [0, 0],
    instead: [0, 0],
    judged: [0, 0],
    unmatched: 0,
    top: [],
  };
  const byTarget = new Map();
  for (const e of events) {
    const o = e.you;
    R.n[o]++;
    let pe = R.perEmoji.get(e.r);
    if (!pe) R.perEmoji.set(e.r, (pe = [0, 0]));
    pe[o]++;
    let em = R.emojiMonths.get(e.mo);
    if (!em) R.emojiMonths.set(e.mo, (em = new Map()));
    em.set(e.r, (em.get(e.r) || 0) + 1);
    let bc = R.byConvo.get(e.m.k);
    if (!bc) R.byConvo.set(e.m.k, (bc = { n: [0, 0], emoji: new Map() }));
    bc.n[o]++;
    bc.emoji.set(e.r, (bc.emoji.get(e.r) || 0) + 1);
    if (e.own) R.own[o]++;
    if (e.text && !e.target) R.unmatched++;
    if (e.lag != null) {
      R.timed[o]++;
      R.timedApps.add(e.s || 0);
      R.lags[o].push(e.lag);
      R.hist[o][REACT_BINS.findIndex((b) => e.lag < b.max)]++;
    }
    const instead = reactedInstead(e, byKey, gap);
    if (instead != null) {
      R.judged[o]++;
      if (instead) R.instead[o]++;
    }
    if (e.target) {
      let tg = byTarget.get(e.target);
      if (!tg) byTarget.set(e.target, (tg = []));
      tg.push(e);
    }
  }
  for (const o of [0, 1]) if (R.lags[o].length >= REACT_MEDIAN_MIN) R.median[o] = median(R.lags[o]);
  R.top = [...byTarget]
    .sort((a, b) => b[1].length - a[1].length || b[0].t - a[0].t)
    .slice(0, REACT_TOP)
    .map(([m, list]) => {
      const chips = [];
      for (const e of list) {
        const c = chips.find((x) => x.r === e.r);
        if (c) c.c++; else chips.push({ r: e.r, c: 1 });
      }
      return { m, n: list.length, chips };
    });
  return R;
}

/**
 * R15: per conversation, the reactions each side gave per 100 messages from the other,
 * for conversations with at least REACT_WHO_MIN messages from each side.
 */
function reactWhoRows(R, A) {
  const rows = [];
  for (const [k, c] of R.byConvo) {
    const bc = A.byContact.get(k);
    if (!bc || bc.n[0] < REACT_WHO_MIN || bc.n[1] < REACT_WHO_MIN) continue;
    rows.push({ k, n: c.n[0] + c.n[1], them: c.n[0], you: c.n[1], themRate: (c.n[0] / bc.n[1]) * 100, youRate: (c.n[1] / bc.n[0]) * 100 });
  }
  return rows.sort((a, b) => b.n - a.n).slice(0, REACT_WHO_ROWS);
}

// ---------------------------------------------------------------- emoji with reactions (R11a)

/** Typed emoji counts (emoji -> [them, you]) plus the reactions in `R`, as a new map. */
function withReactionEmoji(freq, R) {
  const out = new Map();
  for (const [e, v] of freq) out.set(e, [v[0], v[1]]);
  if (R) {
    for (const [e, v] of R.perEmoji) {
      let x = out.get(e);
      if (!x) out.set(e, (x = [0, 0]));
      x[0] += v[0];
      x[1] += v[1];
    }
  }
  return out;
}

/** A conversation's typed emoji (`bc.emoji`) plus its reactions, shaped like `bc` for signatureEmoji. */
function convoEmojiWithReactions(bc, R, k) {
  const emoji = new Map(bc.emoji);
  const c = R && R.byConvo.get(k);
  if (c) for (const [e, n] of c.emoji) emoji.set(e, (emoji.get(e) || 0) + n);
  return { emoji };
}

/** Emoji over time with reactions: aggregateContent's emojiMonths and emojiTotals plus `R`'s. */
function emojiTrendWithReactions(C, R) {
  const emojiMonths = new Map();
  for (const [mo, m] of C.emojiMonths) emojiMonths.set(mo, new Map(m));
  const emojiTotals = new Map(C.emojiTotals);
  if (R) {
    for (const [mo, m] of R.emojiMonths) {
      let x = emojiMonths.get(mo);
      if (!x) emojiMonths.set(mo, (x = new Map()));
      for (const [e, n] of m) {
        x.set(e, (x.get(e) || 0) + n);
        emojiTotals.set(e, (emojiTotals.get(e) || 0) + n);
      }
    }
  }
  return { emojiMonths, emojiTotals };
}
