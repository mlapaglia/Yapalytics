/*
 * Aggregations over parsed message / call records.
 *
 * Message record (from parser.js / googlechat.js):
 *   t  epoch ms      o  1 = sent, 0 = received      m  1 = MMS, 0 = SMS
 *   s  source: 0 = SMS Backup & Restore, 1 = Google Chat, 2 = WhatsApp, 3 = iMessage, 4 = Telegram, 5 = Instagram
 *   sn sender name (Google Chat: group messages you received; WhatsApp / iMessage / Telegram / Instagram: every message)
 *   sk sender's 1-on-1 thread key (SMS group messages you received)
 *   v  mood: VADER compound score in [-1, 1] (messages with words; not reactions)
 *   sw number of swear words (only set when > 0)
 *   k  thread key ('g:' prefix = group chat; Google Chat keys contain 'gc:', WhatsApp 'wa:', iMessage 'im:', Telegram 'tg:', Instagram 'ig:')
 *   b  text body                   l  length in characters
 *   wc word count    e  array of emoji or null      f  trait bit flags
 *   ph/gf/vd/au/ot   photo / gif / video / audio / other attachment counts
 *   mb attachment bytes   h hour   w weekday (0 = Sun)   d local day number   mo year*12+month
 *
 * Arrays indexed by direction use [received, sent] (i.e. index = record.o).
 */
const TRAITS = [
  { bit: 1, label: 'Questions' },
  { bit: 2, label: 'Links' },
  { bit: 4, label: 'Laughs' },
  { bit: 32, label: 'Love' },
  { bit: 8, label: 'ALL CAPS' },
];
const T_REACTION = 16;
const T_LINK = 2;

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

/** "30 minutes", "1 hour", "6 hours": a conversation gap in words. */
function fmtGapWords(ms) {
  const [n, unit] = ms < 3600e3 ? [ms / 60e3, 'minute'] : [ms / 3600e3, 'hour'];
  return `${n} ${unit}${n === 1 ? '' : 's'}`;
}

/** "30m", "1h", "24h": a conversation gap, short. */
function fmtGapShort(ms) {
  return ms < 3600e3 ? `${ms / 60e3}m` : `${ms / 3600e3}h`;
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
const NIGHT_END_HOUR = 5; // "night owl" = messages from midnight until 5am
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
  return new Date(dayToTs(d)).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', weekday: 'short' });
}

function median(arr) {
  if (!arr.length) return null;
  const s = Float64Array.from(arr).sort();
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
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
    wordFreq: new Map(), // word -> [r, s]
    first: null,
    last: null,
    // key -> { n:[r,s], first, last, starters:[r,s], replyMedian:[r,s], lenSum, lenN, emoji: Map, months: Map, longestRun }
    byContact: new Map(),
    night: new Map(), // mo -> [night, total]
    latestNight: null, // { t, k, tod } latest time-of-night message
    yearMonths: new Map(), // year -> [12 month counts]
    replyByHour: [Array.from({ length: 24 }, () => []), Array.from({ length: 24 }, () => [])],
    sourceMonths: new Map(), // mo -> [sms, google chat, whatsapp, imessage]
    groupMonths: new Map(), // mo -> [1-on-1, group]
    groupSenders: new Map(), // sender ('You', name, or SMS 1-on-1 key) -> messages in group chats
    sessions: 0,
    sessionHist: zeros(SESSION_BINS.length),
    longestSession: null, // { k, start, end, n }
    milestones: [], // { t, k (null = overall), n }
  };
  const lastByThread = new Map(); // key -> open session { k, t, o, start, n }
  let total = 0;

  const closeSession = (ss) => {
    A.sessions++;
    for (let i = 0; i < SESSION_BINS.length; i++) {
      if (ss.n <= SESSION_BINS[i].max) { A.sessionHist[i]++; break; }
    }
    if (!A.longestSession || ss.n > A.longestSession.n) A.longestSession = { k: ss.k, start: ss.start, end: ss.t, n: ss.n };
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
      bc = { n: [0, 0], first: r.t, last: r.t, starters: [0, 0], replies: [[], []], lenSum: [0, 0], lenN: [0, 0], emoji: new Map(), months: new Map(), lastDay: null, run: 0, longestRun: 0 };
      A.byContact.set(r.k, bc);
    }
    bc.n[o]++;
    bc.last = r.t;
    bc.months.set(r.mo, (bc.months.get(r.mo) || 0) + 1);
    if (bc.lastDay !== r.d) {
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
    if (!sm) A.sourceMonths.set(r.mo, (sm = [0, 0, 0, 0, 0, 0]));
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

      for (const tk of tokensOf(r.b)) {
        if (STOPWORDS.has(tk)) continue;
        let wf = A.wordFreq.get(tk);
        if (!wf) A.wordFreq.set(tk, (wf = [0, 0]));
        wf[o]++;
      }
    }

    for (let i = 0; i < TRAITS.length; i++) if (r.f & TRAITS[i].bit) A.traits[o][i]++;

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
    if (!prev || r.t - prev.t > gap) {
      A.starters[o]++;
      bc.starters[o]++;
      if (prev) closeSession(prev);
      lastByThread.set(r.k, { k: r.k, t: r.t, o, start: r.t, n: 1 });
      continue;
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
    }
    prev.t = r.t;
    prev.o = o;
    prev.n++;
  }
  for (const ss of lastByThread.values()) closeSession(ss);
  for (const bc of A.byContact.values()) {
    bc.replyMedian = [median(bc.replies[0]), median(bc.replies[1])];
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
const URL_RE = /(?:https?:\/\/|\bwww\.)\S+/gi;
const VOCAB_NEW_TOP = 30; // new words kept per side per month
const URL_HOST_RE = /(?:https?:\/\/|\bwww\.)([^\s/?#:<>"')\]]+)/gi;
const DOMAIN_ALIASES = { 'youtu.be': 'youtube.com', 'x.com': 'twitter.com', 'vm.tiktok.com': 'tiktok.com', 'instagr.am': 'instagram.com', 'amzn.to': 'amazon.com', 'a.co': 'amazon.com', 'goo.gl': 'google.com', 'maps.app.goo.gl': 'google.com' };

/**
 * Lowercased word tokens of a message body, at least 2 characters and not just digits.
 * Curly / modifier apostrophes (I’ve, Iʼm) become ' so contractions stay one word.
 */
function tokensOf(body) {
  const m = body.toLowerCase().replace(/[‘’ʼ]/g, "'").match(TOKEN_RE);
  if (!m) return [];
  const out = [];
  for (let tk of m) {
    tk = tk.replace(/^'+|'+$/g, '');
    if (tk.length >= 2 && !/^\d+$/.test(tk)) out.push(tk);
  }
  return out;
}

function domainOf(host) {
  let h = host.toLowerCase().replace(/\.+$/, '');
  if (DOMAIN_ALIASES[h]) return DOMAIN_ALIASES[h];
  h = h.replace(/^(?:www\d?|m|mobile)\./, '');
  return DOMAIN_ALIASES[h] || h;
}

let swearFamilyOf = null; // messageLib().swearFamily, created on first use

/**
 * Second pass for the text-heavy views: emoji per month, shared link domains,
 * vocabulary (unique words) per month, mood (positive / negative share) per month
 * and swearing.
 */
function aggregateContent(msgs) {
  const C = {
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
  };
  swearFamilyOf = swearFamilyOf || messageLib().swearFamily;
  const vocabCounts = new Map(); // mo -> [Map(word -> uses) received, sent]
  for (const r of msgs) {
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
    const tokens = tokensOf(r.b);
    let vc = vocabCounts.get(r.mo);
    if (!vc) vocabCounts.set(r.mo, (vc = [new Map(), new Map()]));
    // Words only: leave out the pieces of links.
    for (const tk of r.f & T_LINK ? tokensOf(r.b.replace(URL_RE, ' ')) : tokens) vc[o].set(tk, (vc[o].get(tk) || 0) + 1);
    if (r.v != null) {
      let md = C.mood.get(r.mo);
      if (!md) C.mood.set(r.mo, (md = { pos: [0, 0], neg: [0, 0], n: [0, 0] }));
      md.n[o]++;
      C.moodTotal.n[o]++;
      if (r.v >= MOOD_THRESHOLD) { md.pos[o]++; C.moodTotal.pos[o]++; }
      else if (r.v <= -MOOD_THRESHOLD) { md.neg[o]++; C.moodTotal.neg[o]++; }
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

/** Number of conversations each word appears in (document frequency for TF-IDF). */
function buildDocFreq(msgs) {
  const perThread = new Map();
  for (const r of msgs) {
    if (!r.b || r.f & T_REACTION) continue;
    let set = perThread.get(r.k);
    if (!set) perThread.set(r.k, (set = new Set()));
    for (const tk of tokensOf(r.b)) set.add(tk);
  }
  const df = new Map();
  for (const set of perThread.values()) for (const tk of set) df.set(tk, (df.get(tk) || 0) + 1);
  return { df, docs: perThread.size };
}

/**
 * Words that set one conversation apart: frequency here times log(conversations /
 * conversations using the word). Filler words and words used fewer than 3 times are skipped.
 */
function distinctiveWords(msgs, { df, docs }, limit = 25) {
  const tf = new Map();
  for (const r of msgs) {
    if (!r.b || r.f & T_REACTION) continue;
    for (const tk of tokensOf(r.b)) {
      if (tk.length < 3 || STOPWORDS.has(tk)) continue;
      let v = tf.get(tk);
      if (!v) tf.set(tk, (v = [0, 0]));
      v[r.o]++;
    }
  }
  const rows = [];
  for (const [w, v] of tf) {
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
