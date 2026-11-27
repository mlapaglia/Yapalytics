/*
 * Language patterns (spec 019): signature phrases, inside jokes, corrections, thanks and
 * sorry, and which language a message is in. Pure functions over message records.
 *
 * Whatever needs every message of the selection is counted in aggregateContent
 * (analysis.js), which calls the per-message helpers here, so the selection's text is
 * still split once (spec 014 R10). Inside jokes need far more per conversation, so they
 * have their own pass over the few conversations shown (conversationTerms).
 */

const PHRASE_MIN_USES = 5; // a signature phrase is used at least this often…
const PHRASE_MIN_DAYS = 3; // …on at least this many days
const PHRASE_MIN_Z = 2; // weighted log-odds z-score
const PHRASE_MIN_LIFT = 2; // and the person uses it at least this many times as often as everyone else
const PHRASE_PRIOR = 0.1; // the prior is everyone's counts, scaled by this
const PHRASE_LIMIT = 8; // phrases shown per person
const PHRASE_PEOPLE = 5; // people with a column, besides you
const PHRASE_CAP = 300000; // phrases kept per counter before the rarest are dropped
const KEEP_LONGER = 0.7; // a longer phrase replaces a shorter one inside it with this share of its uses

const JOKE_MIN_USES = 6;
const JOKE_MIN_EACH = 2; // uses by each side of a 1-on-1
const JOKE_MIN_DAYS = 3;
const JOKE_MIN_SPAN = 14 * 86400e3;
const JOKE_MAX_DF = 2; // conversations a joke's rare word may appear in
const JOKE_LIMIT = 10;

const CORRECTION_WINDOW = 5 * 60e3;
// One to three words with a star in front or behind: "*there", "* their", "there*". Not "*sigh*".
const CORRECTION_RE = /^\s*(?:\*\s*([\p{L}\p{N}'‘’ʼ]+(?:\s+[\p{L}\p{N}'‘’ʼ]+){0,2})|([\p{L}\p{N}'‘’ʼ]+(?:\s+[\p{L}\p{N}'‘’ʼ]+){0,2})\s*\*)\s*$/u;

const NOT_WORD_BEFORE = String.raw`(?<![\p{L}\p{N}_'‘’ʼ])`;
const NOT_WORD_AFTER = String.raw`(?![\p{L}\p{N}_'‘’ʼ])`;
const THANKS_RE = new RegExp(`${NOT_WORD_BEFORE}(?:thanks|thank\\s+you|thank\\s+u|thx|thnx|ty|tysm|tyvm|much\\s+appreciated|appreciate\\s+it)${NOT_WORD_AFTER}`, 'iu');
const SORRY_RE = new RegExp(`${NOT_WORD_BEFORE}(?:sorry|sry|soz|my\\s+bad|apologies|apologize|apologise)${NOT_WORD_AFTER}`, 'iu');
// Something every thanks or sorry contains, to skip the two tests above for most messages.
const POLITE_HINT_RE = /thank|thx|thnx|\bty|ppreciat|sorr|sry|soz|my\s+bad|apolog/i;

/** A filler word for phrases (R1): a stop word, a single letter or a number. */
const isFiller = (w) => w.length < 2 || STOPWORDS.has(w) || /^\d+$/.test(w);

/** The 2- and 3-word phrases in a message's words that have a word that isn't filler (R1). */
function phrasesOf(words) {
  const out = [];
  for (let i = 0; i + 1 < words.length; i++) {
    const a = words[i], b = words[i + 1];
    const filler = isFiller(a) && isFiller(b);
    if (!filler) out.push(`${a} ${b}`);
    if (i + 2 < words.length && (!filler || !isFiller(words[i + 2]))) out.push(`${a} ${b} ${words[i + 2]}`);
  }
  return out;
}

/**
 * Who gets a column of signature phrases (R4), from a cheap pass that doesn't read text.
 * One 1-on-1 (every message in one conversation that isn't a group): you and them. One
 * group: you and its 5 busiest members. Otherwise: you and the 5 people who sent you the
 * most in 1-on-1s. `who(m)` is a message's column, or null when it only counts as background.
 */
function phraseWho(msgs) {
  const k0 = msgs.length ? msgs[0].k : null;
  const one = msgs.every((m) => m.k === k0);
  if (one && k0 && !k0.startsWith('g:')) return { mode: 'one', people: ['You', k0], who: (m) => (m.o ? 'You' : k0) };
  const group = one && !!k0;
  const idOf = group ? (m) => m.sn || m.sk || null : (m) => (m.k.startsWith('g:') ? null : m.k);
  const n = new Map();
  for (const m of msgs) {
    if (m.o) continue;
    const id = idOf(m);
    if (id) n.set(id, (n.get(id) || 0) + 1);
  }
  const top = [...n].sort((a, b) => b[1] - a[1]).slice(0, PHRASE_PEOPLE).map(([id]) => id);
  const set = new Set(top);
  return {
    mode: group ? 'group' : 'all',
    people: ['You', ...top],
    who: (m) => {
      if (m.o) return 'You';
      const id = idOf(m);
      return id && set.has(id) ? id : null;
    },
  };
}

/** A phrase counter that drops its rarest entries when it passes `cap` (lossy counting). */
function phraseCounter(cap) {
  return { map: new Map(), n: 0, floor: 0, cap };
}

/** Count one use of a phrase; person counters keep [uses, last day, days]. */
function countPhrase(c, p, day = null) {
  c.n++;
  const v = c.map.get(p);
  if (day == null) c.map.set(p, (v || 0) + 1);
  else if (!v) c.map.set(p, [1, day, 1]);
  else {
    v[0]++;
    if (v[1] !== day) { v[1] = day; v[2]++; }
  }
  if (c.map.size > c.cap) {
    // Drop the phrases used once, then twice, … until it's under 90% of the cap. A phrase
    // dropped and seen again starts over, so a count can be low by the uses it had when dropped.
    let t = 0;
    while (c.map.size > c.cap * 0.9) {
      t++;
      for (const [k, x] of c.map) if ((day == null ? x : x[0]) <= t) c.map.delete(k);
    }
    c.floor = Math.max(c.floor, t); // the most uses a dropped phrase had
  }
}

/**
 * Weighted log-odds with an informative Dirichlet prior (Monroe, Colaresi and Quinn,
 * "Fightin' Words", 2008): how much more one person uses a phrase than everyone else, as
 * a z-score. `y` the person's uses of the phrase and `n` of all phrases; `all` and `N`
 * the same for everyone, the prior being everyone's counts scaled by PHRASE_PRIOR.
 */
function phraseZ(y, n, all, N) {
  const a = PHRASE_PRIOR * all, a0 = PHRASE_PRIOR * N;
  const yj = all - y, nj = N - n;
  const delta = Math.log((y + a) / (n + a0 - y - a)) - Math.log((yj + a) / (nj + a0 - yj - a));
  return delta / Math.sqrt(1 / (y + a) + 1 / (yj + a));
}

/**
 * Of `rows` ({ term, n }), when one term's words are inside a longer one's, keep the longer
 * only if it has KEEP_LONGER of the shorter's uses; otherwise keep the shorter (R3).
 * Terms are words joined by single spaces, so the shorter terms inside one are its runs of
 * fewer words: those are looked up, rather than every row compared with every other.
 */
function dropNested(rows) {
  const gone = new Set();
  const words = new Map(rows.map((r) => [r, r.term.split(' ')]));
  const at = new Map(); // term -> its rows' indexes
  rows.forEach((r, i) => { const list = at.get(r.term); if (list) list.push(i); else at.set(r.term, [i]); });
  const byLen = [...rows].sort((a, b) => words.get(b).length - words.get(a).length);
  for (const long of byLen) {
    if (gone.has(long)) continue;
    const w = words.get(long);
    const inside = new Set();
    for (let size = 1; size < w.length; size++) {
      for (let i = 0; i + size <= w.length; i++) for (const j of at.get(w.slice(i, i + size).join(' ')) || []) inside.add(j);
    }
    for (const j of [...inside].sort((a, b) => a - b)) { // in rows' order, as they were compared
      const short = rows[j];
      if (gone.has(short)) continue;
      if (long.n >= KEEP_LONGER * short.n) gone.add(short);
      else { gone.add(long); break; }
    }
  }
  return rows.filter((r) => !gone.has(r));
}

/** Whether one phrase's last words are the other's first words ("pushed the fix", "fix can you"). */
function phrasesOverlap(a, b) {
  return wordsOverlap(a.split(' '), b.split(' '));
}

/** phrasesOverlap on phrases already split into words. */
function wordsOverlap(x, y) {
  for (let i = 1; i < Math.min(x.length, y.length); i++) {
    if (x.slice(-i).join(' ') === y.slice(0, i).join(' ') || y.slice(-i).join(' ') === x.slice(0, i).join(' ')) return true;
  }
  return false;
}

/**
 * Of `rows` sorted best first, leave out each one that overlaps a better one with about
 * the same uses (KEEP_LONGER either way): they're pieces of one longer sentence (R3a).
 * Whether a row stays depends only on the rows before it, so with `limit` it stops once
 * that many stay.
 */
function dropOverlapping(rows, limit = Infinity) {
  const words = rows.map((r) => r.term.split(' '));
  const out = [];
  for (let i = 0; i < rows.length && out.length < limit; i++) {
    const r = rows[i];
    let overlaps = false;
    for (let j = 0; j < i && !overlaps; j++) {
      const b = rows[j];
      overlaps = Math.min(b.n, r.n) >= KEEP_LONGER * Math.max(b.n, r.n) && wordsOverlap(words[j], words[i]);
    }
    if (!overlaps) out.push(r);
  }
  return out;
}

/**
 * Each person's signature phrases (R2, R3): [{ id, phrases: [{ term, n, z }] }], in
 * `P.people` order. `P` is aggregateContent's `phrases`.
 */
function signaturePhrases(P, limit = PHRASE_LIMIT) {
  if (!P) return [];
  return P.people.map((id) => {
    const c = P.who.get(id);
    const rows = [];
    if (c) {
      for (const [term, [y, , days]] of c.map) {
        if (y < PHRASE_MIN_USES || days < PHRASE_MIN_DAYS) continue;
        // A count can be low after dropping (never by more than the floor); the background has the person's uses at least.
        const all = Math.max(P.all.map.get(term) || 0, y);
        const others = all - y, otherN = P.all.n - c.n;
        if (otherN > 0 && others / otherN * PHRASE_MIN_LIFT > y / c.n) continue;
        const z = phraseZ(y, c.n, all, P.all.n);
        if (z >= PHRASE_MIN_Z) rows.push({ term, n: y, z });
      }
    }
    return { id, phrases: dropOverlapping(dropNested(rows).sort((a, b) => b.z - a.z || b.n - a.n), limit) };
  });
}

/** Levenshtein distance. */
function editDistance(a, b) {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** The word a message corrects ("*there" -> "there"), or null when it isn't shaped like a correction. */
function correctionWord(body) {
  const m = CORRECTION_RE.exec(body);
  if (!m) return null;
  return (m[1] || m[2]).split(/\s+/)[0].toLowerCase().replace(/[‘’ʼ]/g, "'");
}

/** Whether `word` fixes a word in the earlier message's `words`: close to one, without being it (R10). */
function correctsWord(word, words) {
  const max = Math.max(2, Math.floor(word.length / 3));
  return words.some((w) => w !== word && Math.abs(w.length - word.length) <= max && editDistance(w, word) <= max);
}

/**
 * aggregateContent's spec 019 counting for one message with text: its phrases (by
 * `who`, null when not counting them), whether it corrects its sender's previous message,
 * thanks and sorry, and its language. `text` is the body without links, `plain` its words.
 */
function countPatterns(C, r, text, plain, who, lastBy) {
  const o = r.o;
  if (who) {
    const id = who(r);
    const person = id && C.phrases.who.get(id);
    for (const p of phrasesOf(plain)) {
      countPhrase(C.phrases.all, p);
      if (person) countPhrase(person, p, r.d);
    }
  }

  // R10: a correction fixes a word of the same person's message just before it
  let senders = lastBy.get(r.k);
  if (!senders) lastBy.set(r.k, (senders = new Map()));
  const sender = o ? 1 : r.sn || r.sk || 0; // you, a named sender, or the other side of a 1-on-1
  if (r.b.includes('*')) {
    const prev = senders.get(sender);
    const fix = prev && r.t - prev.t <= CORRECTION_WINDOW ? correctionWord(r.b) : null;
    if (fix && correctsWord(fix, wordsOf(prev.f & T_LINK ? prev.b.replace(URL_RE, ' ') : prev.b))) {
      let v = C.corrections.get(r.mo);
      if (!v) C.corrections.set(r.mo, (v = [0, 0]));
      v[o]++;
      C.correctionsTotal[o]++;
      C.correctedWords[o].set(fix, (C.correctedWords[o].get(fix) || 0) + 1);
    }
  }
  senders.set(sender, r);

  // R12: thanks and sorry
  const maybe = POLITE_HINT_RE.test(r.b);
  const thanks = maybe && THANKS_RE.test(r.b), sorry = maybe && SORRY_RE.test(r.b);
  if (thanks || sorry) {
    let v = C.polite.get(r.mo);
    if (!v) C.polite.set(r.mo, (v = { thanks: [0, 0], sorry: [0, 0] }));
    if (thanks) { v.thanks[o]++; C.politeTotal.thanks[o]++; }
    if (sorry) { v.sorry[o]++; C.politeTotal.sorry[o]++; }
  }

  // R14: language
  const lang = languageOf(text, plain);
  if (!lang) { C.langNone[o]++; return; }
  let v = C.lang.get(lang);
  if (!v) C.lang.set(lang, (v = [0, 0]));
  v[o]++;
  let byK = C.langByContact.get(r.k);
  if (!byK) C.langByContact.set(r.k, (byK = new Map()));
  byK.set(lang, (byK.get(lang) || 0) + 1);
}

// ------------------------------------------------------------------ languages (R14)

/*
 * Common words of each Latin-script language. Each word is a point for every list it's
 * in, so the words only one language uses decide.
 */
const LANG_WORDS = {
  en: 'the and you are what where with have this that it\'s i\'m don\'t just going would about they there your how when to my me but not for can will was be of it we he she at all so do get i\'ll i\'ve house know really been were did',
  es: 'el los las que y es está estás estoy pero por para con muy bien qué cómo dónde cuándo hola gracias también mañana ahora hoy nada todo eso esto vamos quiero tengo puedo casa te la en lo se mi yo tú sí ya hay nos del al una un espero',
  pt: 'não você vocês está estou tá obrigado obrigada muito bem mas com para uma um eu ele ela isso isto aqui agora hoje amanhã sim também então onde quando como que de do da em no na os as é casa',
  fr: 'le les des est et je tu vous nous il elle pas pour avec dans sur mais oui merci bonjour salut c\'est j\'ai très bien ça qui que une un du au en la ce suis moi toi demain aujourd\'hui',
  de: 'der die das und ist ich du nicht ein eine mit auf für aber ja nein wie was wo wann heute morgen danke bitte sehr gut auch noch schon mir dich mich bin hast habe sind zu den dem',
  it: 'il lo gli che di è e non sono sei per con una un ma come cosa dove quando oggi domani grazie ciao bene molto anche ancora ho hai mi ti del della nel la casa',
  nl: 'de het een en is ik je jij niet met op voor maar ja nee wat waar wanneer vandaag morgen dank bedankt goed ook nog al zijn ben heb hebt van dat die er naar mij',
  pl: 'nie jest się że to ja ty co jak gdzie kiedy dzisiaj jutro dziękuję dzięki tak dobrze bardzo też już jeszcze mam masz ale dla na w z do czy mnie cię',
  tr: 've bir bu şu ne nasıl nerede değil var yok ben sen biz için ile ama evet hayır teşekkürler tamam çok iyi bugün yarın şimdi daha mi mı mu mü da de',
  id: 'yang dan di ke dari ini itu saya aku kamu anda tidak nggak gak apa bagaimana dimana kapan hari besok terima kasih ya sudah belum akan bisa mau dengan untuk juga sangat baik',
};
const LANG_WORD_MAP = new Map();
for (const [code, words] of Object.entries(LANG_WORDS)) {
  for (const w of words.split(' ')) {
    if (!LANG_WORD_MAP.has(w)) LANG_WORD_MAP.set(w, []);
    LANG_WORD_MAP.get(w).push(code);
  }
}
// Letters only one of these languages uses: a point each.
const LANG_LETTERS = [[/ñ/i, 'es'], [/[ãõ]/i, 'pt'], [/ß/, 'de'], [/[ğşı]/i, 'tr'], [/[łąęśźżćń]/i, 'pl']];

/** The script of a letter's code point, or null for one outside the scripts R14 names. */
function scriptOf(cp) {
  if (cp < 0x250) return 'Latin';
  if (cp >= 0x1e00 && cp <= 0x1eff) return 'Latin';
  if ((cp >= 0x370 && cp <= 0x3ff) || (cp >= 0x1f00 && cp <= 0x1fff)) return 'Greek';
  if (cp >= 0x400 && cp <= 0x52f) return 'Cyrillic';
  if (cp >= 0x590 && cp <= 0x5ff) return 'Hebrew';
  if ((cp >= 0x600 && cp <= 0x6ff) || (cp >= 0x750 && cp <= 0x77f) || (cp >= 0xfb50 && cp <= 0xfeff)) return 'Arabic';
  if (cp >= 0x900 && cp <= 0x97f) return 'Devanagari';
  if (cp >= 0xe00 && cp <= 0xe7f) return 'Thai';
  if ((cp >= 0xac00 && cp <= 0xd7af) || (cp >= 0x1100 && cp <= 0x11ff) || (cp >= 0x3130 && cp <= 0x318f)) return 'Hangul';
  if (cp >= 0x3040 && cp <= 0x309f) return 'Hiragana';
  if ((cp >= 0x30a0 && cp <= 0x30ff) || (cp >= 0x31f0 && cp <= 0x31ff) || (cp >= 0xff66 && cp <= 0xff9f)) return 'Katakana';
  if ((cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0x3400 && cp <= 0x4dbf) || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0x20000 && cp <= 0x2ebef)) return 'Han';
  return null;
}
const SCRIPT_LANG = { Greek: 'el', Hebrew: 'he', Thai: 'th', Hangul: 'ko', Devanagari: 'hi', Arabic: 'ar' };
const LETTER_RE = /\p{L}/u;

/**
 * A message's language code (R14), or null: too short, a tie, or a script it doesn't
 * know. `text` is the message without links; `words` its words (wordsOf).
 */
function languageOf(text, words) {
  let latin = 0, letters = 0;
  let counts = null;
  let ascii = true;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code > 127) { ascii = false; break; }
    const c = code | 32;
    if (c >= 97 && c <= 122) latin++;
  }
  if (ascii) letters = latin;
  else {
    latin = 0;
    counts = {};
    for (const ch of text) {
      if (!LETTER_RE.test(ch)) continue;
      letters++;
      const s = scriptOf(ch.codePointAt(0)) || 'Other';
      counts[s] = (counts[s] || 0) + 1;
    }
    latin = counts.Latin || 0;
  }
  if (letters < 3) return null;
  if (counts && latin < 0.6 * letters) {
    const kana = (counts.Hiragana || 0) + (counts.Katakana || 0);
    const han = counts.Han || 0;
    if (kana && kana + han >= 0.6 * letters) return 'ja';
    if (han >= 0.6 * letters) return 'zh';
    if ((counts.Cyrillic || 0) >= 0.6 * letters) return /[іїєґ]/i.test(text) ? 'uk' : 'ru';
    for (const [script, code] of Object.entries(SCRIPT_LANG)) if ((counts[script] || 0) >= 0.6 * letters) return code;
    return null;
  }
  if (latin < 0.6 * letters || words.length < 3) return null;
  const points = {};
  for (const w of words) {
    const langs = LANG_WORD_MAP.get(w);
    if (langs) for (const l of langs) points[l] = (points[l] || 0) + 1;
  }
  if (counts) for (const [re, l] of LANG_LETTERS) if (re.test(text)) points[l] = (points[l] || 0) + 1;
  let best = null, top = 0, second = 0;
  for (const [l, p] of Object.entries(points)) {
    if (p > top) { second = top; top = p; best = l; }
    else if (p > second) second = p;
  }
  return top >= 2 && top > second ? best : null;
}

/** A language's name in the browser's language ("Spanish"), or the code. */
function languageName(code) {
  try {
    return new Intl.DisplayNames([navigator.language || 'en'], { type: 'language' }).of(code) || code;
  } catch {
    return code;
  }
}

/** Your main language and every language's share, from aggregateContent's `lang` (R15–R17). */
function languageSummary(C) {
  const rows = [...C.lang.entries()].map(([code, v]) => ({ code, r: v[0], s: v[1], n: v[0] + v[1] })).sort((a, b) => b.n - a.n);
  const total = rows.reduce((a, x) => a + x.n, 0);
  const mine = [...rows].sort((a, b) => b.s - a.s)[0];
  const others = rows.filter((x) => x !== rows[0]).reduce((a, x) => a + x.n, 0);
  return { rows, total, main: mine && mine.s ? mine.code : rows[0]?.code ?? null, single: rows.length > 0 && rows.every((x) => x === rows[0] || x.n < 0.05 * total), others };
}

/**
 * Conversations whose main language isn't yours, or whose second language has 20% or more
 * of their messages (R16): [{ k, n, langs: [[code, n], …] }], at most `limit`.
 */
function otherLanguageConversations(C, main, limit = 10) {
  const out = [];
  for (const [k, m] of C.langByContact) {
    const langs = [...m].sort((a, b) => b[1] - a[1]);
    const n = langs.reduce((a, x) => a + x[1], 0);
    if (n < 20) continue;
    const second = langs[1];
    if (langs[0][0] !== main || (second && second[1] >= 0.2 * n)) out.push({ k, n, langs });
  }
  const notMine = (x) => 1 - (x.langs.find(([c]) => c === main)?.[1] || 0) / x.n;
  return out.sort((a, b) => notMine(b) - notMine(a) || b.n - a.n).slice(0, limit);
}

// ------------------------------------------------------------------ inside jokes (R6–R9)

/**
 * Words and phrases of one conversation, for inside jokes and "What you talk about":
 * `words: Map(word -> stats)` from every word (tokensOf, links included, as
 * distinctiveWords has always counted them), and, given the document frequencies,
 * `phrases: Map(phrase -> stats)` of the 2- and 3-word phrases (links left out) with a
 * word of 3+ letters in at most JOKE_MAX_DF conversations. Stats: { n: [r, s], who: Set,
 * days, first (record), last (time) }. Each message's text is split once (twice with a link).
 * A generator (spec 028); conversationTerms runs it in one go.
 */
function* conversationTermsSteps(msgs, docFreq = null) {
  const group = msgs.length > 0 && msgs[0].k.startsWith('g:');
  const words = new Map();
  const phrases = new Map();
  const add = (map, term, r) => {
    let v = map.get(term);
    if (!v) map.set(term, (v = { n: [0, 0], who: new Set(), days: 0, lastDay: null, first: r, last: r.t }));
    v.n[r.o]++;
    v.who.add(r.o ? 'You' : group ? r.sn || r.sk || '?' : 'Them');
    if (v.lastDay !== r.d) { v.lastDay = r.d; v.days++; }
    v.last = r.t;
  };
  const plain = [];
  let done = 0;
  const steps = docFreq ? msgs.length * 2 : msgs.length; // the phrases are a second pass
  for (const r of msgs) {
    if (++done % STEP_MSGS === 0) yield done / steps;
    if (!r.b || r.f & T_REACTION) continue;
    const all = wordsOf(r.b);
    for (const w of all) if (isToken(w)) add(words, w, r);
    if (docFreq) plain.push([r, r.f & T_LINK ? wordsOf(r.b.replace(URL_RE, ' ')) : all]);
  }
  if (docFreq) {
    const rare = (w) => w.length >= 3 && (docFreq.df.get(w) || 0) <= JOKE_MAX_DF;
    done = msgs.length;
    for (const [r, ws] of plain) {
      if (++done % STEP_MSGS === 0) yield done / steps;
      for (const p of phrasesOf(ws)) if (p.split(' ').some(rare)) add(phrases, p, r);
    }
  }
  return { group, words, phrases };
}

/** conversationTerms in one go. */
function conversationTerms(msgs, docFreq = null) {
  return runSteps(conversationTermsSteps(msgs, docFreq));
}

/**
 * The inside jokes in a conversation's terms (R6, R7), best first: [{ term, n, days,
 * first (record), last (time), score }]. A word must itself be rare; phrases already are.
 */
function insideJokes(terms, { df }, limit = JOKE_LIMIT) {
  const rows = [];
  const consider = (term, v) => {
    const n = v.n[0] + v.n[1];
    if (n < JOKE_MIN_USES || v.days < JOKE_MIN_DAYS || v.last - v.first.t < JOKE_MIN_SPAN) return;
    if (terms.group ? v.who.size < 2 : v.n[0] < JOKE_MIN_EACH || v.n[1] < JOKE_MIN_EACH) return;
    rows.push({ term, n, days: v.days, first: v.first, last: v.last, score: n * Math.log2(v.days) });
  };
  for (const [w, v] of terms.words) if (w.length >= 3 && (df.get(w) || 0) <= JOKE_MAX_DF) consider(w, v);
  for (const [p, v] of terms.phrases) consider(p, v);
  return dropOverlapping(dropNested(rows).sort((a, b) => b.score - a.score || (a.term < b.term ? -1 : 1)), limit);
}
