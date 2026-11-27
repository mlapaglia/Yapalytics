/*
 * Aggregations over parsed message / call records.
 *
 * Message record (from parser.js / googlechat.js):
 *   t  epoch ms      o  1 = sent, 0 = received      m  1 = MMS, 0 = SMS
 *   s  source: 0 = SMS Backup & Restore, 1 = Google Chat, 2 = WhatsApp, 3 = iMessage, 4 = Telegram, 5 = Instagram, 6 = Messenger
 *   sn sender name (Google Chat: group messages you received; WhatsApp / iMessage / Telegram / Instagram / Messenger: every message)
 *   sk sender's 1-on-1 thread key (SMS group messages you received)
 *   v  mood: VADER compound score in [-1, 1] (messages with words; not reactions)
 *   ai mood from the AI model, once scored: [negative, neutral, positive] probabilities (spec 001)
 *   sw number of swear words (only set when > 0)
 *   k  thread key ('g:' prefix = group chat; Google Chat keys contain 'gc:', WhatsApp 'wa:', iMessage 'im:', Telegram 'tg:', Instagram 'ig:', Messenger 'fb:' ('fb:e2ee:' from the encrypted chats download))
 *   b  text body                   l  length in characters
 *   wc word count    e  array of emoji or null      f  trait bit flags
 *   ph/gf/vd/au/ot   photo / gif / video / audio / other attachment counts
 *   mb attachment bytes   h hour   w weekday (0 = Sun)   d local day number   mo year*12+month
 *
 * Arrays indexed by direction use [received, sent] (i.e. index = record.o).
 */
/** The trait bits the parsers set on `f` (messageLib, parser.js). */
const TRAIT = messageLib().TRAIT;
const TRAITS = [
  { bit: TRAIT.QUESTION, label: 'Questions' },
  { bit: TRAIT.LINK, label: 'Links' },
  { bit: TRAIT.LAUGH, label: 'Laughs' },
  { bit: TRAIT.LOVE, label: 'Love' },
  { bit: TRAIT.CAPS, label: 'ALL CAPS' },
];
const T_REACTION = TRAIT.REACTION;
const T_LINK = TRAIT.LINK;

const LEN_BINS = [
  [1, 4], [5, 9], [10, 19], [20, 29], [30, 49], [50, 74], [75, 99],
  [100, 159], [160, 249], [250, 499], [500, Infinity],
];

const CONVO_GAP = 6 * 3600e3; // default silence that starts a new conversation
const CONVO_GAPS = [30 * 60e3, 3600e3, 3 * 3600e3, 6 * 3600e3, 12 * 3600e3, 24 * 3600e3]; // the choices offered

// Reply-time bin edges. Replies only count within the conversation gap, so the bins
// stop there (the last one cut short at the gap: "3–6 h" for 6 hours).
const REPLY_EDGES = [60e3, 5 * 60e3, 15 * 60e3, 60 * 60e3, 3 * 3600e3, 8 * 3600e3, 24 * 3600e3];

/** Reply-time bins up to `gap`: [{ max, label }], the last one open-ended. */
function replyBins(gap) {
  const bins = [];
  let lo = 0;
  for (const edge of REPLY_EDGES) {
    if (lo >= gap) break;
    const hi = Math.min(edge, gap);
    const inMin = hi <= 3600e3;
    const unit = inMin ? 60e3 : 3600e3;
    const label = lo ? `${lo / unit}–${hi / unit} ${inMin ? 'min' : 'h'}` : `< ${hi / unit} ${inMin ? 'min' : 'h'}`;
    bins.push({ max: hi, label });
    lo = hi;
  }
  bins[bins.length - 1].max = Infinity; // replies right at the gap still land in a bin
  return bins;
}

// A "session" is a run of messages in one thread with no conversation gap of silence.
const SESSION_BINS = [
  { max: 1, label: '1' },
  { max: 5, label: '2–5' },
  { max: 15, label: '6–15' },
  { max: 50, label: '16–50' },
  { max: 150, label: '51–150' },
  { max: Infinity, label: '150+' },
];
// Spec 017: messages in a row from one side of a 1-on-1 conversation.
const TURN_BINS = [
  { max: 1, label: '1' },
  { max: 2, label: '2' },
  { max: 3, label: '3' },
  { max: 5, label: '4–5' },
  { max: 10, label: '6–10' },
  { max: Infinity, label: '11+' },
];

/*
 * Spec 017 style sums, per side, over text messages (with text, not reactions):
 * [messages, words, emoji, questions, laughs, love, ALL CAPS, swearing]. Each marker is
 * one sum per message; `pct` ones are shares of messages.
 */
const STYLE_MARKERS = [
  { label: 'Words per message', i: 1 },
  { label: 'Emoji per message', i: 2 },
  { label: 'Questions', i: 3, pct: true },
  { label: 'Laughs', i: 4, pct: true },
  { label: 'Love', i: 5, pct: true },
  { label: 'ALL CAPS', i: 6, pct: true },
  { label: 'Swearing', i: 7, pct: true },
];
const STYLE_SUMS = 8;
const STYLE_WINDOW = 3; // a month's point covers it and the months before it, to steady small samples
const STYLE_MIN_MSGS = 30; // text messages from each side in a window for its month to count
const STYLE_MIN_HITS = 10; // a marker counts when it adds up to this many on the two sides together

/** A side's style markers (STYLE_MARKERS order) from its sums, or null with no text messages. */
function styleMarkers(sums) {
  return sums[0] ? STYLE_MARKERS.map((m) => sums[m.i] / sums[0]) : null;
}

/** How alike one marker is on two sides, 0–1, or null when it's too rare to compare. */
function markerMatch(a, b, m) {
  if (a[m.i] + b[m.i] < STYLE_MIN_HITS) return null;
  const x = a[m.i] / a[0], y = b[m.i] / b[0];
  return 1 - Math.abs(x - y) / (x + y);
}

/**
 * How alike two sides write, 0–100: 1 − |a − b| / (a + b) for each marker (Language Style
 * Matching's formula), averaged over the markers seen STYLE_MIN_HITS times. Null when a
 * side has no text messages or no marker is common enough.
 */
function styleMatch(a, b) {
  if (!a[0] || !b[0]) return null;
  let sum = 0, n = 0;
  for (const m of STYLE_MARKERS) {
    const v = markerMatch(a, b, m);
    if (v == null) continue;
    sum += v;
    n++;
  }
  return n ? Math.round((sum / n) * 100) : null;
}

/**
 * [[mo, match]] for each month with messages, over that month and the STYLE_WINDOW − 1
 * before it, when the window has STYLE_MIN_MSGS text messages from each side.
 */
function styleSeries(months) {
  const out = [];
  for (const mo of [...months.keys()].sort((a, b) => a - b)) {
    const win = pair(STYLE_SUMS);
    for (let w = 0; w < STYLE_WINDOW; w++) {
      const v = months.get(mo - w);
      if (v) for (let o = 0; o < 2; o++) for (let i = 0; i < STYLE_SUMS; i++) win[o][i] += v[o][i];
    }
    if (win[0][0] < STYLE_MIN_MSGS || win[1][0] < STYLE_MIN_MSGS) continue;
    const m = styleMatch(win[0], win[1]);
    if (m != null) out.push([mo, m]);
  }
  return out;
}

const NIGHT_END_HOUR = 5; // "night owl" = messages from midnight until 5am
const MORNING_HOURS = [5, 9]; // "early morning" = messages from 5am until 9am
const LONG_SILENCE_DAYS = 30; // silences in a conversation this long or longer are kept (byContact.silences)
const CONTACT_MILESTONES = new Set([1, 1000, 10000, 50000, 100000]);
const TOTAL_MILESTONES = new Set([10000, 50000, 100000, 250000, 500000, 1000000]);

const MEDIA_TYPES = [
  { key: 'ph', label: 'Photos' },
  { key: 'vd', label: 'Videos' },
  { key: 'gf', label: 'GIFs' },
  { key: 'au', label: 'Audio' },
  { key: 'ot', label: 'Other files' },
];

const CALL_TYPES = [
  { type: 2, label: 'Outgoing' },
  { type: 1, label: 'Incoming' },
  { type: 3, label: 'Missed' },
  { type: 4, label: 'Voicemail' },
  { type: 5, label: 'Declined / blocked' }, // 5 rejected + 6 blocked
];
const CALL_DUR_BINS = [
  { max: 60, label: '< 1 min' },
  { max: 300, label: '1–5 min' },
  { max: 900, label: '5–15 min' },
  { max: 1800, label: '15–30 min' },
  { max: 3600, label: '30–60 min' },
  { max: Infinity, label: '1 h +' },
];

const STOPWORDS = new Set((
  "a about above after again against all am an and any are aren't as at be because been before being below between both but by " +
  "can can't cannot could couldn't did didn't do does doesn't doing don't down during each few for from further had hadn't has hasn't " +
  "have haven't having he he'd he'll he's her here here's hers herself him himself his how how's i i'd i'll i'm i've if in into is " +
  "isn't it it's its itself let's me more most mustn't my myself no nor not of off on once only or other ought our ours ourselves " +
  "out over own same shan't she she'd she'll she's should shouldn't so some such than that that's the their theirs them themselves " +
  "then there there's these they they'd they'll they're they've this those through to too under until up very was wasn't we we'd " +
  "we'll we're we've were weren't what what's when when's where where's which while who who's whom why why's with won't would " +
  "wouldn't you you'd you'll you're you've your yours yourself yourselves im ive dont cant didnt doesnt isnt wasnt thats whats " +
  "youre ill id its u ur just also get got will like one go going yeah yes ok okay oh lol im it's gonna wanna gotta know think " +
  "really well now want need can just see https http www com"
).split(/\s+/));

/** Local-midnight timestamp for a local day number. */
function dayToTs(d) {
  const u = new Date(d * 86400000);
  return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate()).getTime();
}
function tsToDay(ts) {
  const dt = new Date(ts);
  return Math.floor((ts - dt.getTimezoneOffset() * 60000) / 86400000);
}
function monthToTs(mo) {
  return new Date(Math.floor(mo / 12), mo % 12, 1).getTime();
}
function dayLabel(d) {
  return fmtDate.weekday(dayToTs(d));
}

/**
 * The median of `arr`, or null when it's empty. Found by quickselect, not by sorting: the
 * same value in linear time. An array with NaN is sorted as before (NaN sorts last).
 */
function median(arr) {
  const n = arr.length;
  if (!n) return null;
  const s = Float64Array.from(arr);
  const mid = n >> 1;
  if (n < 32 || s.some(Number.isNaN)) {
    s.sort();
    return n % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }
  const hi = selectNth(s, mid);
  if (n % 2) return hi;
  let lo = s[0]; // everything before `mid` is ≤ hi now: the largest of it comes just before hi
  for (let i = 1; i < mid; i++) if (s[i] > lo) lo = s[i];
  return (lo + hi) / 2;
}

/** Rearranges `a` (a Float64Array without NaN) so a[k] is its k-th smallest value, smaller ones before it; returns a[k]. */
function selectNth(a, k) {
  let left = 0, right = a.length - 1;
  while (right > left) {
    // Median of three as the pivot, then Hoare's partition.
    const m = (left + right) >> 1;
    let x = a[left], y = a[m], z = a[right];
    const pivot = x < y ? (y < z ? y : x < z ? z : x) : (x < z ? x : y < z ? z : y);
    let i = left, j = right;
    while (i <= j) {
      while (a[i] < pivot) i++;
      while (a[j] > pivot) j--;
      if (i <= j) { const t = a[i]; a[i] = a[j]; a[j] = t; i++; j--; }
    }
    if (k <= j) right = j;
    else if (k >= i) left = i;
    else break; // a[j+1..i-1] all equal the pivot, and k is among them
  }
  return a[k];
}

const zeros = (n) => new Array(n).fill(0);
const pair = (n) => [zeros(n), zeros(n)];

/**
 * One pass over the (already filtered, time-sorted) messages. `gap` is the silence
 * that ends a conversation (sessions, starters, double texts, which messages are replies).
 */
function aggregateMessages(msgs, gap = CONVO_GAP) {
  const replyBinsA = replyBins(gap);
  const A = {
    n: msgs.length,
    gap,
    replyBins: replyBinsA,
    dir: [0, 0],
    sms: 0,
    mms: 0,
    group: 0,
    hour: pair(24),
    dow: pair(7),
    heat: zeros(7 * 24),
    days: new Map(), // day -> [recv, sent]
    months: new Map(), // mo -> { c:[r,s], len:[r,s], lenN:[r,s] }
    lenHist: pair(LEN_BINS.length),
    lenSum: [0, 0],
    lenN: [0, 0],
    words: [0, 0],
    emoji: [0, 0],
    emojiMsgs: [0, 0],
    emojiFreq: new Map(), // emoji -> [r, s]
    media: { ph: [0, 0], vd: [0, 0], gf: [0, 0], au: [0, 0], ot: [0, 0] },
    mediaBytes: 0,
    mediaMonths: new Map(), // mo -> { ph, vd, gf, au, ot }
    traits: pair(TRAITS.length),
    contacts: new Map(), // key -> [r, s]
    reply: pair(replyBinsA.length),
    replyTimes: [[], []],
    starters: [0, 0],
    doubleTexts: [0, 0],
    first: null,
    last: null,
    // key -> { n:[r,s], first, last, starters:[r,s], replyMedian:[r,s], replyN:[r,s], lenSum, lenN, emoji: Map,
    //   months: Map, longestRun, traits:[[r],[s]], doubles:[r,s], ph:[r,s], weekend, morning,
    //   silences: [{ len (silent days, at least LONG_SILENCE_DAYS), end (time messages resumed), before (messages before it) }],
    //   spec 017 (1-on-1 only): lastWord:[r,s], noReply:[r,s], qAsked:[r,s], qReplied:[r,s], style: Map(mo -> [sums r, sums s]) }
    byContact: new Map(),
    night: new Map(), // mo -> [night, total]
    latestNight: null, // { t, k, tod } latest time-of-night message
    yearMonths: new Map(), // year -> [12 month counts]
    replyByHour: [Array.from({ length: 24 }, () => []), Array.from({ length: 24 }, () => [])],
    sourceMonths: new Map(), // mo -> messages per app (index = s, see Sources)
    groupMonths: new Map(), // mo -> [1-on-1, group]
    groupSenders: new Map(), // sender ('You', name, or SMS 1-on-1 key) -> messages in group chats
    sessions: 0,
    sessionHist: zeros(SESSION_BINS.length),
    longestSession: null, // { k, start, end, n }
    milestones: [], // { t, k (null = overall), n }
    // Spec 017, 1-on-1 conversations only. Endings and question replies count settled
    // conversations: ones that ended more than a gap before the selection's last message.
    endings: { last: [0, 0], none: [0, 0] }, // last word (both wrote) / no reply (only that side wrote)
    questionReplies: { asked: [0, 0], replied: [0, 0] },
    turnHist: pair(TURN_BINS.length),
    turns: [0, 0],
    turnMsgs: [0, 0], // messages in those turns
    styleMonths: new Map(), // mo -> [sums r, sums s] (STYLE_MARKERS)
    styleTotal: pair(STYLE_SUMS),
  };
  // key -> open session { k, t, o, start, n } plus, for 1-on-1 threads (spec 017),
  // { bc, sides (bit 1 received, bit 2 sent), turn, pending:[r,s] questions, asked, replied }
  const lastByThread = new Map();
  let total = 0;

  const closeTurn = (o, n) => {
    A.turns[o]++;
    A.turnMsgs[o] += n;
    for (let i = 0; i < TURN_BINS.length; i++) {
      if (n <= TURN_BINS[i].max) { A.turnHist[o][i]++; break; }
    }
  };

  const closeSession = (ss, settled = true) => {
    A.sessions++;
    for (let i = 0; i < SESSION_BINS.length; i++) {
      if (ss.n <= SESSION_BINS[i].max) { A.sessionHist[i]++; break; }
    }
    if (!A.longestSession || ss.n > A.longestSession.n) A.longestSession = { k: ss.k, start: ss.start, end: ss.t, n: ss.n };
    if (!ss.bc) return;
    closeTurn(ss.o, ss.turn);
    if (!settled) return;
    const { bc } = ss;
    if (ss.sides === 3) { A.endings.last[ss.o]++; bc.lastWord[ss.o]++; }
    else { A.endings.none[ss.o]++; bc.noReply[ss.o]++; }
    for (let o = 0; o < 2; o++) {
      A.questionReplies.asked[o] += ss.asked[o];
      A.questionReplies.replied[o] += ss.replied[o];
      bc.qAsked[o] += ss.asked[o];
      bc.qReplied[o] += ss.replied[o];
    }
  };

  for (const r of msgs) {
    const o = r.o;
    A.dir[o]++;
    if (r.m) A.mms++;
    else A.sms++;
    const isGroup = r.k.charCodeAt(0) === 103 /* g */ && r.k.startsWith('g:');
    if (isGroup) A.group++;

    let bc = A.byContact.get(r.k);
    if (!bc) {
      bc = {
        n: [0, 0], first: r.t, last: r.t, starters: [0, 0], replies: [[], []], lenSum: [0, 0], lenN: [0, 0], emoji: new Map(), months: new Map(),
        lastDay: null, run: 0, longestRun: 0, traits: pair(TRAITS.length), doubles: [0, 0], ph: [0, 0], weekend: 0, morning: 0, silences: [],
        lastWord: [0, 0], noReply: [0, 0], qAsked: [0, 0], qReplied: [0, 0], style: new Map(),
      };
      A.byContact.set(r.k, bc);
    }
    const before = bc.n[0] + bc.n[1];
    bc.n[o]++;
    bc.last = r.t;
    if (r.w === 0 || r.w === 6) bc.weekend++;
    if (r.h >= MORNING_HOURS[0] && r.h < MORNING_HOURS[1]) bc.morning++;
    if (r.ph) bc.ph[o] += r.ph;
    bc.months.set(r.mo, (bc.months.get(r.mo) || 0) + 1);
    if (bc.lastDay !== r.d) {
      const silent = bc.lastDay == null ? 0 : r.d - bc.lastDay - 1;
      if (silent >= LONG_SILENCE_DAYS) bc.silences.push({ len: silent, end: r.t, before });
      bc.run = bc.lastDay === r.d - 1 ? bc.run + 1 : 1;
      bc.lastDay = r.d;
      if (bc.run > bc.longestRun) bc.longestRun = bc.run;
    }
    const cn = bc.n[0] + bc.n[1];
    if (CONTACT_MILESTONES.has(cn)) A.milestones.push({ t: r.t, k: r.k, n: cn });
    if (TOTAL_MILESTONES.has(++total)) A.milestones.push({ t: r.t, k: null, n: total });

    let nm = A.night.get(r.mo);
    if (!nm) A.night.set(r.mo, (nm = [0, 0]));
    nm[1]++;
    if (r.h < NIGHT_END_HOUR) {
      nm[0]++;
      const tod = r.h * 60 + new Date(r.t).getMinutes();
      if (!A.latestNight || tod > A.latestNight.tod) A.latestNight = { t: r.t, k: r.k, tod };
    }

    const year = Math.floor(r.mo / 12);
    let ym = A.yearMonths.get(year);
    if (!ym) A.yearMonths.set(year, (ym = zeros(12)));
    ym[r.mo % 12]++;

    let sm = A.sourceMonths.get(r.mo);
    if (!sm) A.sourceMonths.set(r.mo, (sm = Sources.zeros()));
    sm[r.s || 0]++;

    let gm = A.groupMonths.get(r.mo);
    if (!gm) A.groupMonths.set(r.mo, (gm = [0, 0]));
    gm[isGroup ? 1 : 0]++;
    if (isGroup) {
      const who = o ? 'You' : r.sn || r.sk;
      if (who) A.groupSenders.set(who, (A.groupSenders.get(who) || 0) + 1);
    }

    A.hour[o][r.h]++;
    A.dow[o][r.w]++;
    A.heat[r.w * 24 + r.h]++;

    let day = A.days.get(r.d);
    if (!day) A.days.set(r.d, (day = [0, 0]));
    day[o]++;

    let mon = A.months.get(r.mo);
    if (!mon) A.months.set(r.mo, (mon = { c: [0, 0], len: [0, 0], lenN: [0, 0] }));
    mon.c[o]++;

    let c = A.contacts.get(r.k);
    if (!c) A.contacts.set(r.k, (c = [0, 0]));
    c[o]++;

    // Spec 017: every 1-on-1 month gets a style bucket, so a month of only photos still gets
    // a point when its window has enough text. Only text messages add to the sums.
    let bm = null;
    if (!isGroup) {
      bm = bc.style.get(r.mo);
      if (!bm) bc.style.set(r.mo, (bm = pair(STYLE_SUMS)));
    }

    const isReaction = r.f & T_REACTION;
    if (r.l > 0 && !isReaction) {
      for (let i = 0; i < LEN_BINS.length; i++) {
        if (r.l <= LEN_BINS[i][1]) { A.lenHist[o][i]++; break; }
      }
      A.lenSum[o] += r.l;
      A.lenN[o]++;
      bc.lenSum[o] += r.l;
      bc.lenN[o]++;
      mon.len[o] += r.l;
      mon.lenN[o]++;
      A.words[o] += r.wc;
      if (!isGroup) {
        // Per conversation here; A.styleMonths and A.styleTotal add them up after the loop.
        const v = bm[o], f = r.f;
        v[0]++;
        v[1] += r.wc;
        if (r.e) v[2] += r.e.length;
        if (f & TRAIT.QUESTION) v[3]++;
        if (f & TRAIT.LAUGH) v[4]++;
        if (f & TRAIT.LOVE) v[5]++;
        if (f & TRAIT.CAPS) v[6]++;
        if (r.sw) v[7]++;
      }
    }

    for (let i = 0; i < TRAITS.length; i++) {
      if (r.f & TRAITS[i].bit) { A.traits[o][i]++; bc.traits[o][i]++; }
    }

    if (r.e) {
      A.emoji[o] += r.e.length;
      A.emojiMsgs[o]++;
      for (const em of r.e) {
        let ef = A.emojiFreq.get(em);
        if (!ef) A.emojiFreq.set(em, (ef = [0, 0]));
        ef[o]++;
        bc.emoji.set(em, (bc.emoji.get(em) || 0) + 1);
      }
    }

    if (r.ph || r.vd || r.gf || r.au || r.ot) {
      let mm = A.mediaMonths.get(r.mo);
      if (!mm) A.mediaMonths.set(r.mo, (mm = { ph: 0, vd: 0, gf: 0, au: 0, ot: 0 }));
      for (const mt of MEDIA_TYPES) {
        const v = r[mt.key];
        if (v) { A.media[mt.key][o] += v; mm[mt.key] += v; }
      }
      A.mediaBytes += r.mb;
    }

    // Reply times / conversation starters / sessions, per thread
    const prev = lastByThread.get(r.k);
    const question = r.f & TRAIT.QUESTION ? 1 : 0;
    if (!prev || r.t - prev.t > gap) {
      A.starters[o]++;
      bc.starters[o]++;
      if (prev) closeSession(prev);
      const ss = { k: r.k, t: r.t, o, start: r.t, n: 1 };
      if (!isGroup) Object.assign(ss, { bc, sides: 1 << o, turn: 1, pending: [0, 0], asked: [0, 0], replied: [0, 0] });
      if (!isGroup && question) { ss.asked[o]++; ss.pending[o]++; }
      lastByThread.set(r.k, ss);
      continue;
    }
    if (prev.bc) {
      // Spec 017: turns, and the other side's questions waiting for a reply
      prev.sides |= 1 << o;
      if (prev.o === o) prev.turn++;
      else {
        closeTurn(prev.o, prev.turn);
        prev.turn = 1;
        prev.replied[1 - o] += prev.pending[1 - o];
        prev.pending[1 - o] = 0;
      }
      if (question) { prev.asked[o]++; prev.pending[o]++; }
    }
    if (prev.o !== o) {
      const wait = r.t - prev.t;
      for (let i = 0; i < replyBinsA.length; i++) {
        if (wait < replyBinsA[i].max) { A.reply[o][i]++; break; }
      }
      A.replyTimes[o].push(wait);
      bc.replies[o].push(wait);
      A.replyByHour[o][r.h].push(wait);
    } else {
      A.doubleTexts[o]++;
      bc.doubles[o]++;
    }
    prev.t = r.t;
    prev.o = o;
    prev.n++;
  }
  // A conversation still open at the end is settled only if it ended over a gap before the last message.
  const endT = msgs.length ? msgs[msgs.length - 1].t : 0;
  for (const ss of lastByThread.values()) closeSession(ss, endT - ss.t > gap);
  for (const bc of A.byContact.values()) {
    for (const [mo, sums] of bc.style) {
      let sm = A.styleMonths.get(mo);
      if (!sm) A.styleMonths.set(mo, (sm = pair(STYLE_SUMS)));
      for (let o = 0; o < 2; o++) {
        for (let i = 0; i < STYLE_SUMS; i++) {
          sm[o][i] += sums[o][i];
          A.styleTotal[o][i] += sums[o][i];
        }
      }
    }
    bc.replyMedian = [median(bc.replies[0]), median(bc.replies[1])];
    bc.replyN = [bc.replies[0].length, bc.replies[1].length];
    bc.replies = null;
  }
  A.replyHourMedian = A.replyByHour.map((hours) => hours.map(median));
  A.replyByHour = null;

  if (msgs.length) {
    A.first = msgs[0].t;
    A.last = msgs[msgs.length - 1].t;
  }

  // Day-level summaries
  const dayKeys = [...A.days.keys()].sort((a, b) => a - b);
  let best = null;
  let longest = { len: 0, start: null, end: null };
  let run = 0, runStart = null;
  for (let i = 0; i < dayKeys.length; i++) {
    const d = dayKeys[i];
    const v = A.days.get(d);
    const tot = v[0] + v[1];
    if (!best || tot > best.n) best = { d, n: tot };
    if (i > 0 && d === dayKeys[i - 1] + 1) run++;
    else { run = 1; runStart = d; }
    if (run > longest.len) longest = { len: run, start: runStart, end: d };
  }
  let gapMax = { len: 0, start: null, end: null };
  for (let i = 1; i < dayKeys.length; i++) {
    const g = dayKeys[i] - dayKeys[i - 1] - 1;
    if (g > gapMax.len) gapMax = { len: g, start: dayKeys[i - 1], end: dayKeys[i] };
  }
  A.dayKeys = dayKeys;
  A.busiestDay = best;
  A.longestStreak = longest;
  A.longestSilence = gapMax;
  A.activeDays = dayKeys.length;
  A.spanDays = dayKeys.length ? dayKeys[dayKeys.length - 1] - dayKeys[0] + 1 : 0;
  A.replyMedian = [median(A.replyTimes[0]), median(A.replyTimes[1])];
  A.replyTimes = null; // free memory
  return A;
}

const TOKEN_RE = /[\p{L}\p{N}']+/gu;
const MOOD_THRESHOLD = 0.05; // VADER's standard cut-off for positive / negative

/*
 * Two mood scorers (spec 001): 'vader' reads r.v, the VADER compound score; 'ai' reads
 * r.ai = [negative, neutral, positive] probabilities from the sentiment model. The AI
 * score is positive − negative, and its label is the most likely class.
 */

/** A message's mood score in [-1, 1] by `scorer`, or null when it has none. */
function moodScore(r, scorer = 'vader') {
  if (scorer === 'ai') return r.ai ? Math.round((r.ai[2] - r.ai[0]) * 100) / 100 : null;
  return r.v == null ? null : r.v;
}

/** 1 positive, -1 negative, 0 neutral, or null when the message has no score by `scorer`. */
function moodSign(r, scorer = 'vader') {
  if (scorer === 'ai') {
    const p = r.ai;
    if (!p) return null;
    return p[2] > p[1] && p[2] > p[0] ? 1 : p[0] > p[1] && p[0] >= p[2] ? -1 : 0;
  }
  if (r.v == null) return null;
  return r.v >= MOOD_THRESHOLD ? 1 : r.v <= -MOOD_THRESHOLD ? -1 : 0;
}
const URL_RE = /(?:https?:\/\/|\bwww\.)\S+/gi;
const VOCAB_NEW_TOP = 30; // new words kept per side per month
const URL_HOST_RE = /(?:https?:\/\/|\bwww\.)([^\s/?#:<>"')\]]+)/gi;
const DOMAIN_ALIASES = { 'youtu.be': 'youtube.com', 'x.com': 'twitter.com', 'vm.tiktok.com': 'tiktok.com', 'instagr.am': 'instagram.com', 'amzn.to': 'amazon.com', 'a.co': 'amazon.com', 'goo.gl': 'google.com', 'maps.app.goo.gl': 'google.com' };

/**
 * Every lowercased word of a message body, in order: single letters and numbers too.
 * Curly / modifier apostrophes (I’ve, Iʼm) become ' so contractions stay one word.
 */
function wordsOf(body) {
  const m = body.toLowerCase().replace(/[‘’ʼ]/g, "'").match(TOKEN_RE);
  if (!m) return [];
  const out = [];
  for (let tk of m) {
    tk = tk.replace(/^'+|'+$/g, '');
    if (tk) out.push(tk);
  }
  return out;
}

/** A word that counts as a token: at least 2 characters and not just digits. */
const isToken = (w) => w.length >= 2 && !/^\d+$/.test(w);

/** Lowercased word tokens of a message body: its words without single letters and numbers. */
function tokensOf(body) {
  return wordsOf(body).filter(isToken);
}

function domainOf(host) {
  let h = host.toLowerCase().replace(/\.+$/, '');
  if (DOMAIN_ALIASES[h]) return DOMAIN_ALIASES[h];
  h = h.replace(/^(?:www\d?|m|mobile)\./, '');
  return DOMAIN_ALIASES[h] || h;
}

let swearFamilyOf = null; // messageLib().swearFamily, created on first use

/** Counting generators (spec 028) yield how far they are, 0–1, every this many messages. */
const STEP_MSGS = 1000;
/** …and every this many words where they add up words already counted (buildDocFreqSteps). */
const STEP_WORDS = 20000;

/** Runs a counting generator to the end and returns its result. */
function runSteps(steps) {
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
  }
}

/**
 * Second pass for the text-heavy views: the most used words, emoji per month, shared
 * link domains, vocabulary (unique words) per month, mood (positive / negative share) per
 * month, scored by `scorer` ('vader' or 'ai'), and swearing; and (spec 019) signature
 * phrases, corrections, thanks and sorry, and languages. It's the only pass over the
 * dashboard's selection that splits message text into words (spec 014 R10): once per
 * message, and a message with a link once more without its links. `phrases: false`
 * skips counting phrases (Year in review shows none); `phraseCap` bounds each phrase counter.
 * A generator (spec 028): it yields how far it is and returns the counts; aggregateContent
 * runs it in one go.
 */
function* aggregateContentSteps(msgs, scorer = 'vader', { phrases = true, phraseCap = PHRASE_CAP } = {}) {
  const C = {
    wordFreq: new Map(), // word -> [r, s], filler words left out
    emojiMonths: new Map(), // mo -> Map(emoji -> n)
    emojiTotals: new Map(), // emoji -> n
    domains: new Map(), // domain -> [r, s]
    vocab: new Map(), // mo -> [unique words received, unique words sent]
    // mo -> [received, sent] { n: words used for the first time in this selection (filler
    //   words left out), top: [[word, uses that month]] of those, most used first }
    vocabNew: new Map(),
    mood: new Map(), // mo -> { pos: [r, s], neg: [r, s], n: [r, s] } (messages with a mood score)
    moodTotal: { pos: [0, 0], neg: [0, 0], n: [0, 0] },
    swear: new Map(), // mo -> { w: [r, s] swear words, n: [r, s] messages }
    swearTotal: { w: [0, 0], n: [0, 0] },
    swearWords: new Map(), // family -> [r, s]
    // Spec 019. phrases: { mode, people, who: Map(person -> counter of [uses, last day, days]),
    //   all: counter of uses } (phraseCounter, patterns.js), or null with phrases: false
    phrases: null,
    corrections: new Map(), // mo -> [r, s]
    correctionsTotal: [0, 0],
    correctedWords: [new Map(), new Map()], // word -> corrections, per side
    polite: new Map(), // mo -> { thanks: [r, s], sorry: [r, s] } messages
    politeTotal: { thanks: [0, 0], sorry: [0, 0] },
    lang: new Map(), // language code -> [r, s] messages
    langNone: [0, 0], // messages with text but no language (too short, unclear)
    langByContact: new Map(), // k -> Map(code -> messages)
  };
  swearFamilyOf = swearFamilyOf || messageLib().swearFamily;
  const vocabCounts = new Map(); // mo -> [Map(word -> uses) received, sent]
  let who = null;
  if (phrases) {
    const pw = phraseWho(msgs);
    who = pw.who;
    C.phrases = { mode: pw.mode, people: pw.people, who: new Map(pw.people.map((id) => [id, phraseCounter(phraseCap)])), all: phraseCounter(phraseCap) };
  }
  const lastBy = new Map(); // conversation + sender -> { t, words } of their previous message (corrections)
  let done = 0;
  for (const r of msgs) {
    if (++done % STEP_MSGS === 0) yield done / msgs.length;
    const o = r.o;
    if (r.e) {
      let em = C.emojiMonths.get(r.mo);
      if (!em) C.emojiMonths.set(r.mo, (em = new Map()));
      for (const e of r.e) {
        em.set(e, (em.get(e) || 0) + 1);
        C.emojiTotals.set(e, (C.emojiTotals.get(e) || 0) + 1);
      }
    }
    if (!r.b || r.f & T_REACTION) continue;
    if (r.f & T_LINK) {
      for (const m of r.b.matchAll(URL_HOST_RE)) {
        const d = domainOf(m[1]);
        if (!d.includes('.')) continue;
        let v = C.domains.get(d);
        if (!v) C.domains.set(d, (v = [0, 0]));
        v[o]++;
      }
    }
    const words = wordsOf(r.b);
    const tokens = words.filter(isToken);
    // Words only: leave out the pieces of links.
    const text = r.f & T_LINK ? r.b.replace(URL_RE, ' ') : r.b;
    const plain = r.f & T_LINK ? wordsOf(text) : words;
    for (const tk of tokens) {
      if (STOPWORDS.has(tk)) continue;
      let wf = C.wordFreq.get(tk);
      if (!wf) C.wordFreq.set(tk, (wf = [0, 0]));
      wf[o]++;
    }
    let vc = vocabCounts.get(r.mo);
    if (!vc) vocabCounts.set(r.mo, (vc = [new Map(), new Map()]));
    for (const tk of r.f & T_LINK ? plain.filter(isToken) : tokens) vc[o].set(tk, (vc[o].get(tk) || 0) + 1);
    const sign = moodSign(r, scorer);
    if (sign != null) {
      let md = C.mood.get(r.mo);
      if (!md) C.mood.set(r.mo, (md = { pos: [0, 0], neg: [0, 0], n: [0, 0] }));
      md.n[o]++;
      C.moodTotal.n[o]++;
      if (sign > 0) { md.pos[o]++; C.moodTotal.pos[o]++; }
      else if (sign < 0) { md.neg[o]++; C.moodTotal.neg[o]++; }
    }
    let sm = C.swear.get(r.mo);
    if (!sm) C.swear.set(r.mo, (sm = { w: [0, 0], n: [0, 0] }));
    sm.n[o]++;
    C.swearTotal.n[o]++;
    if (r.sw) {
      sm.w[o] += r.sw;
      C.swearTotal.w[o] += r.sw;
      for (const tk of tokens) {
        const fam = swearFamilyOf(tk);
        if (!fam) continue;
        let v = C.swearWords.get(fam);
        if (!v) C.swearWords.set(fam, (v = [0, 0]));
        v[o]++;
      }
    }
    countPatterns(C, r, text, plain, who, lastBy);
  }
  // Month by month, each side's words that it hadn't used earlier in the selection.
  const seen = [new Set(), new Set()];
  for (const mo of [...vocabCounts.keys()].sort((a, b) => a - b)) {
    const counts = vocabCounts.get(mo);
    C.vocab.set(mo, [counts[0].size, counts[1].size]);
    C.vocabNew.set(mo, counts.map((words, o) => {
      let n = 0;
      const top = [];
      for (const [w, uses] of words) {
        if (seen[o].has(w)) continue;
        seen[o].add(w);
        if (w.length < 3 || STOPWORDS.has(w) || /\d/.test(w)) continue;
        n++;
        top.push([w, uses]);
      }
      top.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
      return { n, top: top.slice(0, VOCAB_NEW_TOP) };
    }));
  }
  return C;
}

/** aggregateContent in one go: what aggregateContentSteps works out, without slices. */
function aggregateContent(...args) {
  return runSteps(aggregateContentSteps(...args));
}

/**
 * A matcher for a tracked word or phrase: any case, whole words only (so "lol" skips
 * "lollipop"), any run of spaces between words, and curly apostrophes match straight ones.
 */
function phraseRegex(q) {
  const words = q.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const esc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/['‘’ʼ]/g, "['‘’ʼ]");
  return new RegExp(`(?<![\\p{L}\\p{N}_])${words.map(esc).join('\\s+')}(?![\\p{L}\\p{N}_])`, 'giu');
}

/** Uses of a phrase (see phraseRegex) per day and per side, and each side's first use. */
function aggregatePhrase(msgs, re) {
  const P = {
    days: new Map(), // day -> [r, s] uses
    uses: [0, 0],
    msgs: [0, 0], // messages with at least one use
    first: [null, null], // earliest message using it, received / sent
  };
  for (const r of msgs) {
    if (!r.b || r.f & T_REACTION) continue;
    const m = r.b.match(re);
    if (!m) continue;
    const o = r.o;
    let v = P.days.get(r.d);
    if (!v) P.days.set(r.d, (v = [0, 0]));
    v[o] += m.length;
    P.uses[o] += m.length;
    P.msgs[o]++;
    if (!P.first[o]) P.first[o] = r; // msgs are time-sorted
  }
  return P;
}

/** How much of buildDocFreqSteps' progress is the message loop: adding up takes about a tenth. */
const DF_LOOP = 0.9;

/** Number of conversations each word appears in (document frequency for TF-IDF), in slices (spec 028). */
function* buildDocFreqSteps(msgs) {
  const perThread = new Map();
  let done = 0;
  for (const r of msgs) {
    if (++done % STEP_MSGS === 0) yield DF_LOOP * done / msgs.length;
    if (!r.b || r.f & T_REACTION) continue;
    let set = perThread.get(r.k);
    if (!set) perThread.set(r.k, (set = new Set()));
    for (const tk of tokensOf(r.b)) set.add(tk);
  }
  // Adding up the conversations' words: millions of them over a big archive, so in slices
  // too. Counting them inside the loop instead would take longer (a has() per word).
  let total = 0;
  for (const set of perThread.values()) total += set.size;
  const df = new Map();
  let added = 0;
  for (const set of perThread.values()) {
    for (const tk of set) {
      df.set(tk, (df.get(tk) || 0) + 1);
      if (++added % STEP_WORDS === 0) yield DF_LOOP + (1 - DF_LOOP) * added / total;
    }
  }
  return { df, docs: perThread.size };
}

/** buildDocFreq in one go. */
function buildDocFreq(msgs) {
  return runSteps(buildDocFreqSteps(msgs));
}

/**
 * Words that set one conversation apart: frequency here times log(conversations /
 * conversations using the word). Filler words and words used fewer than 3 times are skipped.
 * `terms` is the conversation's conversationTerms (patterns.js), shared with inside jokes (spec 019 R19).
 */
function distinctiveWords(msgs, { df, docs }, limit = 25, terms = conversationTerms(msgs)) {
  const rows = [];
  for (const [w, { n: v }] of terms.words) {
    if (w.length < 3 || STOPWORDS.has(w)) continue;
    const n = v[0] + v[1];
    if (n < 3) continue;
    const idf = Math.log(docs / (df.get(w) || 1));
    if (idf <= 0) continue;
    rows.push({ w, r: v[0], s: v[1], score: n * idf });
  }
  return rows.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Total emoji uses in an emojiFreq map (pass to signatureEmoji when calling it in a loop). */
function emojiTotal(emojiFreq) {
  let all = 0;
  for (const v of emojiFreq.values()) all += v[0] + v[1];
  return all;
}

/** The emoji used far more in this conversation than overall (at least 3 uses). */
function signatureEmoji(bc, emojiFreq, all = emojiTotal(emojiFreq)) {
  let mine = 0;
  for (const n of bc.emoji.values()) mine += n;
  let best = null, bestScore = 0;
  for (const [e, n] of bc.emoji) {
    if (n < 3) continue;
    const g = emojiFreq.get(e);
    const score = n / mine / ((g[0] + g[1]) / all);
    if (score > bestScore) { bestScore = score; best = e; }
  }
  return best;
}

function aggregateCalls(calls) {
  const typeIndex = (t) => (t === 6 ? 4 : CALL_TYPES.findIndex((c) => c.type === t));
  const C = {
    n: calls.length,
    byType: zeros(CALL_TYPES.length),
    talk: [0, 0], // seconds [incoming, outgoing]
    hour: CALL_TYPES.map(() => zeros(24)),
    months: new Map(), // mo -> counts per type
    durHist: [zeros(CALL_DUR_BINS.length), zeros(CALL_DUR_BINS.length)], // [incoming, outgoing]
    contacts: new Map(), // key -> { n, talk }
    longest: null,
  };
  for (const c of calls) {
    const ti = typeIndex(c.ty);
    if (ti < 0) continue;
    C.byType[ti]++;
    C.hour[ti][c.h]++;
    let m = C.months.get(c.mo);
    if (!m) C.months.set(c.mo, (m = zeros(CALL_TYPES.length)));
    m[ti]++;
    let ct = C.contacts.get(c.k);
    if (!ct) C.contacts.set(c.k, (ct = { n: 0, talk: 0 }));
    ct.n++;
    if ((c.ty === 1 || c.ty === 2) && c.du > 0) {
      const io = c.ty === 2 ? 1 : 0;
      C.talk[io] += c.du;
      ct.talk += c.du;
      for (let i = 0; i < CALL_DUR_BINS.length; i++) {
        if (c.du < CALL_DUR_BINS[i].max) { C.durHist[io][i]++; break; }
      }
      if (!C.longest || c.du > C.longest.du) C.longest = c;
    }
  }
  return C;
}
