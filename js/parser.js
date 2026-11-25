/*
 * Text analysis and time stamping shared by every parser worker. Like the workers,
 * it is serialized into the worker source, so it must be self-contained. `vader`
 * (from js/vendor/vader.js) is optional; without it messages get no mood score.
 */
function messageLib(vader) {
  'use strict';

  // Swear words, grouped into families so "fucking" and "fuck" count as one word.
  const SWEAR_FAMILIES = [
    ['fuck', /^(?:mother)?f+u+c+k+\w*$|^(?:fuk|fukk|fucc|fking|fkn|fk)\w*$/],
    ['shit', /^(?:bull|horse|dip|chicken)?sh+[i1]+t+(?:s|ty|tier|tiest|ting|ted|head|show|load|stain|e)?$/],
    ['damn', /^(?:god)?dam(?:n|m)\w*$|^dammit$/],
    ['bitch', /^bitch\w*$/],
    ['ass', /^(?:ass|asses|arse|arses|asshole|assholes|jackass|dumbass|dumbasses|badass|smartass|fatass|lazyass)$/],
    ['bastard', /^bastards?$/],
    ['crap', /^crap(?:s|py|pier|piest|ped)?$/],
    ['piss', /^piss(?:ed|es|ing|y)?$/],
    ['dick', /^dick(?:s|head|heads)?$/],
    ['cock', /^cock(?:s|sucker|suckers)?$/],
    ['hell', /^hell$/],
    ['cunt', /^cunts?$/],
    ['twat', /^twats?$/],
    ['wanker', /^wank(?:er|ers|ing)?$/],
    ['prick', /^pricks?$/],
    ['bollocks', /^bollocks$/],
    ['douche', /^douche(?:s|bag|bags)?$/],
    ['wtf', /^wtf$/],
    ['stfu', /^stfu$/],
    ['gtfo', /^gtfo$/],
    ['fml', /^fml$/],
    ['omfg', /^omfg$/],
  ];
  const SWEAR_ANY = new RegExp(SWEAR_FAMILIES.map(([, re]) => re.source).join('|'));

  /** Family name ("fuck", "shit", …) of a lowercase word, or null. */
  function swearFamily(word) {
    if (!SWEAR_ANY.test(word)) return null;
    for (const [name, re] of SWEAR_FAMILIES) if (re.test(word)) return name;
    return null;
  }

  // VADER has no emoji, so (like the Python VADER) emoji are swapped for words it scores.
  const EMOJI_WORDS = {
    '😂': 'lol', '🤣': 'lol', '😆': 'lol', '😹': 'lol', '😅': 'lol',
    '😀': 'happy', '😃': 'happy', '😄': 'happy', '😁': 'happy', '😊': 'smile', '🙂': 'smile', '☺': 'smile', '😺': 'smile', '😸': 'smile', '😇': 'smile',
    '❤': 'love', '😍': 'love', '🥰': 'love', '😘': 'kiss', '😚': 'kiss', '💕': 'love', '💖': 'love', '💗': 'love', '💓': 'love', '💞': 'love', '💘': 'love', '😻': 'love',
    '💙': 'love', '💚': 'love', '💛': 'love', '💜': 'love', '🧡': 'love', '🤍': 'love', '🤗': 'hug',
    '🥳': 'celebrate', '🎉': 'celebrate', '🎊': 'celebrate', '🤩': 'wow', '😎': 'cool', '👍': 'good', '👏': 'great', '🙌': 'yay', '💯': 'great', '🔥': 'cool', '✨': 'nice', '🙏': 'thanks', '😋': 'nice',
    '😢': 'sad', '😞': 'sad', '😔': 'sad', '😟': 'worried', '🙁': 'sad', '☹': 'sad', '😥': 'sad', '😓': 'tired', '😩': 'tired', '😫': 'tired', '😭': 'crying', '💔': 'heartbroken',
    '😡': 'furious', '🤬': 'furious', '😠': 'angry', '😤': 'annoyed', '🙄': 'annoyed', '😒': 'annoyed', '😕': 'confused', '😬': 'awkward',
    '😱': 'shocked', '😨': 'scared', '😰': 'worried', '🤢': 'disgusted', '🤮': 'disgusting', '🤒': 'sick', '😷': 'sick', '👎': 'bad',
  };

  // Emoji: flags, keycaps, and pictographs with optional variation selector,
  // skin tone and ZWJ sequences (👩‍👩‍👧 counts once).
  const EMOJI_RE = /\p{RI}\p{RI}|[#*0-9]️?⃣|\p{Extended_Pictographic}(?:️|\p{EMod})?(?:‍\p{Extended_Pictographic}(?:️|\p{EMod})?)*/gu;
  const NOT_EMOJI = new Set(['©', '®', '™']);
  const WORD_RE = /[\p{L}\p{N}'‘’ʼ]+/gu; // curly apostrophes keep "I’ve" one word
  const LINK_RE = /https?:\/\/|www\.[a-z0-9-]+\./i;
  const LAUGH_RE = /\b(?:lol+|lmf?ao+|rofl|(?:ha){2,}h?|(?:he){2,}|(?:ja){2,})\b|😂|🤣|😆|💀/iu;
  const LOVE_RE = /\b(?:love (?:you|u|ya)|luv (?:you|u)|ily|xoxo)\b|❤|😍|🥰|😘|💕|💗|💖/iu;
  // Reactions that arrive as a text: iPhone tapbacks (Loved “…”, Laughed at an image,
  // Reacted 😂 to “…”, Removed a heart from “…”) and Google Messages ones (😂 to “…,
  // often cut short with no closing quote). Reactions to media name only the kind of
  // file, so those must be the whole message.
  // Phones can put invisible direction marks around the parts (Android wraps the quoted
  // text in isolates) and no-break spaces between them, so the check reads the start of
  // the message with those marks dropped and any run of spaces as one plain space. A quote
  // can run on, but a reaction to media must be all there is, past those 200 characters too.
  const REACT_VERB = String.raw`(?:Liked|Loved|Disliked|Laughed at|Emphasi[sz]ed|Questioned|Reacted .{1,16}? to|Removed .{1,40}? from|[^\p{L}\p{N}\s]{1,12} to)`;
  const REACT_MEDIA = String.raw`an? (?:image|photo|picture|movie|video|GIF|gif|sticker|attachment|audio message|voice message|file|location|contact|link)[.!]?$`;
  const REACTION_QUOTE_RE = new RegExp(String.raw`^${REACT_VERB} [“"‘'„‚«‹「]`, 'u');
  const REACTION_MEDIA_RE = new RegExp(String.raw`^${REACT_VERB} ${REACT_MEDIA}`, 'u');
  const REACT_MARKS_RE = /[\u200b\u200c\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g; // not U+200D, which joins emoji
  const REACT_HEAD = 200;
  const tidyReaction = (s) => s.replace(REACT_MARKS_RE, '').replace(/\s+/g, ' ').trim();
  function isReactionText(body) {
    const head = tidyReaction(body.slice(0, REACT_HEAD));
    if (REACTION_QUOTE_RE.test(head)) return true;
    return REACTION_MEDIA_RE.test(head) && (body.length <= REACT_HEAD || !tidyReaction(body.slice(REACT_HEAD)));
  }
  const UPPER_RE = /\p{Lu}/u;
  const LOWER_RE = /\p{Ll}/u;

  // Trait bit flags on rec.f. Defined only here: analysis.js reads them from messageLib().TRAIT.
  const TRAIT = { QUESTION: 1, LINK: 2, LAUGH: 4, CAPS: 8, REACTION: 16, LOVE: 32 };
  const { QUESTION: T_QUESTION, LINK: T_LINK, LAUGH: T_LAUGH, CAPS: T_CAPS, REACTION: T_REACTION, LOVE: T_LOVE } = TRAIT;

  function analyzeText(body, rec) {
    rec.b = body;
    if (!body) { rec.l = 0; rec.wc = 0; rec.e = null; rec.f = 0; return; }
    let len = 0;
    for (const _ of body) len++;
    rec.l = len;
    const words = body.match(WORD_RE);
    rec.wc = words ? words.length : 0;
    let emo = body.match(EMOJI_RE);
    if (emo) {
      emo = emo.filter((x) => !NOT_EMOJI.has(x) && !/^[#*0-9]$/.test(x));
      if (!emo.length) emo = null;
    }
    rec.e = emo;
    let f = 0;
    if (isReactionText(body)) f |= T_REACTION;
    else {
      if (body.indexOf('?') >= 0) f |= T_QUESTION;
      if (LINK_RE.test(body)) f |= T_LINK;
      if (LAUGH_RE.test(body)) f |= T_LAUGH;
      if (LOVE_RE.test(body)) f |= T_LOVE;
      if (len >= 4 && UPPER_RE.test(body) && !LOWER_RE.test(body)) {
        const letters = body.match(/\p{L}/gu);
        if (letters && letters.length >= 4) f |= T_CAPS;
      }
    }
    rec.f = f;
    if (f & T_REACTION) return;

    let sw = 0;
    if (words) for (const w of words) if (swearFamily(w.toLowerCase())) sw++;
    if (sw) rec.sw = sw;

    if (vader) {
      // Mood: VADER compound score in [-1, 1], with emoji turned into words it knows.
      const text = emo ? body.replace(EMOJI_RE, (x) => ` ${EMOJI_WORDS[x.replace(/\uFE0F/g, '')] || ''} `) : body;
      if (/[\p{L}]/u.test(text)) rec.v = Math.round(vader.polarityScores(text).compound * 100) / 100;
    }
  }

  /**
   * Why a message got its mood score: the same text VADER scored for rec.v (emoji
   * swapped for words), with the words that counted (emoji shown as themselves), each
   * word's valence after modifiers and its lexicon value, and the ! / ? emphasis.
   * Null when the message has no score.
   */
  function explainMood(body) {
    if (!vader || !vader.explain || !body) return null;
    // Build the same text analyzeText scores, noting which word position each emoji
    // became: VADER splits on whitespace and drops 1-character pieces.
    const wordCount = (s) => s.split(/\s/).filter((t) => t.length > 1).length;
    const emojiAt = new Map(); // word index -> emoji
    let text = '';
    let last = 0;
    for (const m of body.matchAll(EMOJI_RE)) {
      text += body.slice(last, m.index);
      const word = EMOJI_WORDS[m[0].replace(/\uFE0F/g, '')] || '';
      if (word) emojiAt.set(wordCount(text), m[0]);
      text += ` ${word} `;
      last = m.index + m[0].length;
    }
    text += body.slice(last);
    if (!/[\p{L}]/u.test(text)) return null;
    const e = vader.explain(text);
    const round = (x) => Math.round(x * 100) / 100;
    const words = [];
    e.words.forEach((w, i) => {
      if (w.valence) words.push({ word: emojiAt.get(i) || w.word, valence: round(w.valence), lexicon: round(w.lexicon) });
    });
    return { score: round(e.compound), words, emphasis: round(e.emphasis) };
  }

  function stampTime(rec) {
    const dt = new Date(rec.t);
    rec.h = dt.getHours();
    rec.w = dt.getDay();
    rec.d = Math.floor((rec.t - dt.getTimezoneOffset() * 60000) / 86400000); // local day number
    rec.mo = dt.getFullYear() * 12 + dt.getMonth();
  }

  /**
   * Notes a reaction on a message (spec 004): rec.rx is [{ r: emoji, c: count, n: [who] }],
   * one entry per emoji in the order first seen. `names` may be fewer than `count`
   * (Telegram lists only recent reactors). Reactions never count as messages.
   */
  function addReaction(rec, emoji, count, names) {
    if (!emoji || !(count > 0)) return;
    const list = rec.rx || (rec.rx = []);
    let x = list.find((y) => y.r === emoji);
    if (!x) list.push((x = { r: emoji, c: 0, n: [] }));
    x.c += count;
    for (const n of names) if (n && !x.n.includes(n)) x.n.push(n);
  }

  /**
   * A parser's conversations (key -> conversation) that also remembers which were added
   * since takeFresh() last ran, so each batch can carry the conversations it found
   * (spec 016 R15). Names are read when taken, so one set after creation is included.
   */
  function contactMap() {
    const map = new Map();
    let fresh = [];
    const set = map.set;
    map.set = function (key, c) {
      if (!map.has(key)) fresh.push(c);
      return set.call(map, key, c);
    };
    map.takeFresh = () => {
      const found = fresh.map((c) => ({ key: c.key, name: c.name || c.title || c.addr || '', s: c.s || 0, group: !!c.group }));
      fresh = [];
      return found;
    };
    return map;
  }

  return { analyzeText, stampTime, swearFamily, explainMood, addReaction, contactMap, TRAIT, T_REACTION };
}

/*
 * Streaming parser for SMS Backup & Restore XML files (sms-*.xml and calls-*.xml).
 *
 * The whole function below is serialized into a Blob and run as a Web Worker, so it
 * must be fully self-contained (no references to outer scope). Running it from a Blob
 * also means the site works when opened straight from disk (file://).
 *
 * Files can be several GB because MMS attachments are embedded as base64 `data`
 * attributes. The scanner never buffers those: it skips over them and only records
 * their length, so memory stays proportional to the text content.
 */
/**
 * Reactions on one message that turned up in two overlapping exports (spec 004): each
 * emoji keeps the larger count and everyone named in either. It doesn't depend on which
 * export was loaded first, which says nothing about which is newer; the price is that a
 * reaction removed between the two exports stays.
 */
function mergeReactions(a, b) {
  const out = (a || []).map((x) => ({ r: x.r, c: x.c, n: [...x.n] }));
  for (const y of b || []) {
    const x = out.find((z) => z.r === y.r);
    if (!x) { out.push({ r: y.r, c: y.c, n: [...y.n] }); continue; }
    for (const n of y.n) if (!x.n.includes(n)) x.n.push(n);
    x.c = Math.max(x.c, y.c, x.n.length);
  }
  return out.length ? out : undefined;
}

function smsParserWorker(self, lib) {
  'use strict';

  const { analyzeText, stampTime, contactMap } = lib;

  const CHUNK_BYTES = 8 * 1024 * 1024;
  const BATCH_SIZE = 5000;

  // ---------------------------------------------------------------- XML scanning

  const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  const ENTITY_RE = /&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g;

  // SMS Backup & Restore writes emoji as separate UTF-16 surrogate entities
  // (&#55357;&#56832;), so code units <= 0xFFFF go through fromCharCode and
  // recombine naturally.
  function decodeEntities(s) {
    if (s.indexOf('&') < 0) return s;
    return s.replace(ENTITY_RE, (m, e) => {
      if (e.charCodeAt(0) === 35 /* # */) {
        const hex = e[1] === 'x' || e[1] === 'X';
        const n = hex ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        if (!(n >= 0) || n > 0x10ffff) return m;
        return n <= 0xffff ? String.fromCharCode(n) : String.fromCodePoint(n);
      }
      return ENTITIES[e] !== undefined ? ENTITIES[e] : m;
    });
  }

  function isWs(c) {
    return c === 32 || c === 10 || c === 13 || c === 9;
  }

  /** UTF-8 byte length of s[from, to). */
  function utf8len(s, from, to) {
    let n = 0;
    for (let i = from; i < to; i++) {
      const c = s.charCodeAt(i);
      if (c < 0x80) n++;
      else if (c < 0x800) n += 2;
      else if (c >= 0xd800 && c < 0xdc00 && i + 1 < to) { n += 4; i++; } // surrogate pair
      else n += 3;
    }
    return n;
  }

  // Resumable tag scanner. Feed it decoded text in arbitrary chunks; it calls
  // onOpen(name, attrs, selfClosing) and onClose(name). Attributes named in
  // `skipAttrs` are not stored; instead attrs[name + 'Len'] holds their length and
  // attrs[name + 'At'] the file byte offset where their value starts, so a skipped
  // base64 attachment can be read back later. `startByte` is where the decoded
  // text starts in the file (3 after a UTF-8 byte order mark).
  function createScanner(onOpen, onClose, skipAttrs, startByte = 0) {
    let buf = '';
    let pos = 0;
    let tag = null; // { name, attrs } while inside a start tag
    let skipQuote = null;
    let skipLen = 0;
    let skipName = '';
    // Byte accounting: buf[0] is at file byte `base`; buf[0..mark) is `markBytes` bytes.
    // Skipped values are base64 (ASCII), so they're counted by length, not re-scanned.
    let base = startByte;
    let mark = 0;
    let markBytes = 0;
    const byteAt = (idx) => {
      markBytes += utf8len(buf, mark, idx);
      mark = idx;
      return base + markBytes;
    };
    const skipAscii = (idx) => {
      markBytes += idx - mark;
      mark = idx;
    };

    function run() {
      const b = buf;
      const n = b.length;
      for (;;) {
        if (skipQuote !== null) {
          const end = b.indexOf(skipQuote, pos);
          if (end < 0) { skipLen += n - pos; pos = n; return; }
          skipLen += end - pos;
          skipAscii(end);
          tag.attrs[skipName + 'Len'] = skipLen;
          pos = end + 1;
          skipQuote = null;
        }

        if (tag === null) {
          const lt = b.indexOf('<', pos);
          if (lt < 0) { pos = n; return; }
          if (n - lt < 4) { pos = lt; return; }
          const c1 = b.charCodeAt(lt + 1);
          if (c1 === 33 /* ! */) {
            const isComment = b.startsWith('<!--', lt);
            const end = isComment ? b.indexOf('-->', lt + 4) : b.indexOf('>', lt);
            if (end < 0) { pos = lt; return; }
            pos = end + (isComment ? 3 : 1);
            continue;
          }
          if (c1 === 63 /* ? */) {
            const end = b.indexOf('?>', lt);
            if (end < 0) { pos = lt; return; }
            pos = end + 2;
            continue;
          }
          if (c1 === 47 /* / */) {
            const end = b.indexOf('>', lt);
            if (end < 0) { pos = lt; return; }
            pos = end + 1;
            onClose(b.slice(lt + 2, end).trim());
            continue;
          }
          let i = lt + 1;
          while (i < n) {
            const c = b.charCodeAt(i);
            if (isWs(c) || c === 62 || c === 47) break;
            i++;
          }
          if (i >= n) { pos = lt; return; }
          tag = { name: b.slice(lt + 1, i), attrs: {} };
          pos = i;
        }

        // Inside a start tag: read one attribute or the tag end.
        let i = pos;
        while (i < n && isWs(b.charCodeAt(i))) i++;
        if (i >= n) { pos = i; return; }
        const c = b.charCodeAt(i);
        if (c === 62 /* > */) {
          const t = tag;
          tag = null;
          pos = i + 1;
          onOpen(t.name, t.attrs, false);
          continue;
        }
        if (c === 47 /* / */) {
          if (i + 1 >= n) { pos = i; return; }
          const t = tag;
          tag = null;
          pos = i + 2;
          onOpen(t.name, t.attrs, true);
          onClose(t.name);
          continue;
        }
        const eq = b.indexOf('=', i);
        if (eq < 0) { pos = i; return; }
        let j = eq + 1;
        while (j < n && isWs(b.charCodeAt(j))) j++;
        if (j >= n) { pos = i; return; }
        const quote = b[j];
        const name = b.slice(i, eq).trim();
        if (skipAttrs.has(name)) {
          skipQuote = quote;
          skipLen = 0;
          skipName = name;
          pos = j + 1;
          tag.attrs[name + 'At'] = byteAt(pos);
          continue;
        }
        const end = b.indexOf(quote, j + 1);
        if (end < 0) { pos = i; return; }
        tag.attrs[name] = decodeEntities(b.slice(j + 1, end));
        pos = end + 1;
      }
    }

    return {
      feed(text) {
        if (skipQuote !== null) skipAscii(pos);
        base = byteAt(pos);
        mark = 0;
        markBytes = 0;
        buf = pos < buf.length ? buf.slice(pos) + text : text;
        pos = 0;
        run();
      },
    };
  }

  // ---------------------------------------------------------------- record building

  function normAddr(a) {
    const s = String(a || '').trim().replace(/[\s\-().]/g, '');
    if (!s) return '';
    const digits = s.replace(/^\+/, '');
    if (/^\d+$/.test(digits)) return digits.length > 8 ? digits.slice(-8) : digits;
    return s.toLowerCase();
  }

  const owners = new Set(); // normalized numbers known to belong to the device owner

  function threadKey(address) {
    if (!address) return 'unknown';
    if (address.indexOf('~') >= 0) {
      const parts = [...new Set(address.split('~').map(normAddr).filter((p) => p && !owners.has(p)))].sort();
      if (parts.length > 1) return 'g:' + parts.join('~');
      return parts[0] || 'unknown';
    }
    return normAddr(address) || 'unknown';
  }

  function cleanName(n) {
    if (!n || n === 'null' || n === '(Unknown)') return '';
    return n;
  }

  const contacts = contactMap(); // key -> { key, name, addr, group, lastT }

  function noteContact(key, address, name, t) {
    let c = contacts.get(key);
    if (!c) {
      c = { key, name: '', addr: address || '', group: key.startsWith('g:'), lastT: 0 };
      contacts.set(key, c);
    }
    name = cleanName(name);
    if (name && t >= c.lastT) { c.name = name; c.lastT = t; }
    if (!c.addr && address) c.addr = address;
  }

  function toMillis(v) {
    let t = +v;
    if (!t) return 0;
    if (t < 1e11) t *= 1000; // a few old exports used seconds
    return t;
  }

  let msgBatch = [];
  let callBatch = [];
  const counts = { sms: 0, mms: 0, calls: 0, skipped: 0 };

  function flush() {
    if (msgBatch.length || callBatch.length) {
      self.postMessage({ type: 'batch', msgs: msgBatch, calls: callBatch, found: contacts.takeFresh() });
      msgBatch = [];
      callBatch = [];
    }
  }

  function pushMsg(rec) {
    msgBatch.push(rec);
    if (msgBatch.length >= BATCH_SIZE) flush();
  }

  function handleSms(a) {
    const type = +a.type;
    const t = toMillis(a.date);
    if ((type !== 1 && type !== 2) || !t) { counts.skipped++; return; }
    const k = threadKey(a.address);
    noteContact(k, a.address, a.contact_name, t);
    const rec = { t, o: type === 2 ? 1 : 0, m: 0, s: 0, k, ph: 0, gf: 0, vd: 0, au: 0, ot: 0, mb: 0 };
    analyzeText(a.body == null ? '' : a.body, rec);
    stampTime(rec);
    counts.sms++;
    pushMsg(rec);
  }

  function handleMms(m) {
    const a = m.a;
    const box = +a.msg_box;
    const t = toMillis(a.date);
    const mtype = +a.m_type;
    if ((box !== 1 && box !== 2) || !t || mtype === 134 || mtype === 136) { counts.skipped++; return; }

    // Learn the owner's number from the "From" address of sent messages.
    if (box === 2) {
      for (const ad of m.addrs) {
        if (ad.type === '137' && ad.address && ad.address !== 'insert-address-token') owners.add(normAddr(ad.address));
      }
    }

    let address = a.address || '';
    if (!address || /@rcs\.google\.com$/i.test(address)) {
      // RCS placeholder thread: the real participants are in <addrs>.
      const list = [];
      for (const ad of m.addrs) {
        if (!ad.address || ad.address === 'insert-address-token') continue;
        if (box === 2 && ad.type === '137') continue;
        if (owners.has(normAddr(ad.address))) continue;
        list.push(ad.address);
      }
      address = list.join('~');
    }

    const k = threadKey(address);
    noteContact(k, address, a.contact_name, t);

    const rec = { t, o: box === 2 ? 1 : 0, m: 1, s: 0, k, ph: 0, gf: 0, vd: 0, au: 0, ot: 0, mb: 0 };
    if (box === 1 && k.startsWith('g:')) {
      // Who sent it: the "From" address, keyed like that person's 1-on-1 thread.
      const from = m.addrs.find((ad) => ad.type === '137' && ad.address && ad.address !== 'insert-address-token');
      if (from) rec.sk = normAddr(from.address);
    }
    const parts = m.parts.slice().sort((x, y) => (+x.seq || 0) - (+y.seq || 0));
    const texts = [];
    for (const p of parts) {
      const ct = (p.ct || '').toLowerCase();
      if (ct === 'application/smil') continue;
      if (ct === 'text/plain') {
        if (p.text && p.text !== 'null') texts.push(p.text);
        continue;
      }
      let k;
      if (ct.startsWith('image/')) k = ct === 'image/gif' ? 'gf' : 'ph';
      else if (ct.startsWith('video/')) k = 'vd';
      else if (ct.startsWith('audio/')) k = 'au';
      else k = 'ot';
      rec[k]++;
      if (p.dataLen) rec.mb += Math.floor(p.dataLen * 0.75);
      // Where the base64 data sits in this file, so the message list can decode and show it.
      const name = [p.cl, p.name, p.fn].find((x) => x && x !== 'null') || 'attachment';
      const att = { n: name, k, t: ct };
      if (p.dataLen && p.dataAt != null) Object.assign(att, { z: 0, b: p.dataAt, l: p.dataLen, u: Math.floor(p.dataLen * 0.75) });
      (rec.att || (rec.att = [])).push(att);
    }
    analyzeText(texts.join('\n'), rec);
    stampTime(rec);
    counts.mms++;
    pushMsg(rec);
  }

  function handleCall(a) {
    const t = toMillis(a.date);
    if (!t) { counts.skipped++; return; }
    const k = normAddr(a.number) || 'unknown';
    noteContact(k, a.number, a.contact_name, t);
    const rec = { t, ty: +a.type || 0, du: +a.duration || 0, k };
    stampTime(rec);
    callBatch.push(rec);
    counts.calls++;
    if (callBatch.length >= BATCH_SIZE) flush();
  }

  let currentMms = null;

  function onOpen(name, attrs) {
    switch (name) {
      case 'sms': handleSms(attrs); break;
      case 'mms': currentMms = { a: attrs, parts: [], addrs: [] }; break;
      case 'part': if (currentMms) currentMms.parts.push(attrs); break;
      case 'addr': if (currentMms) currentMms.addrs.push(attrs); break;
      case 'call': handleCall(attrs); break;
    }
  }

  function onClose(name) {
    if (name === 'mms' && currentMms) {
      handleMms(currentMms);
      currentMms = null;
    }
  }

  async function parseFile(file) {
    // TextDecoder drops a leading byte order mark, so decoded text starts 3 bytes in.
    const head = new Uint8Array(await file.slice(0, 3).arrayBuffer());
    const bom = head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf ? 3 : 0;
    const scanner = createScanner(onOpen, onClose, new Set(['data']), bom);
    const decoder = new TextDecoder('utf-8');
    let offset = 0;
    while (offset < file.size) {
      const buf = await file.slice(offset, offset + CHUNK_BYTES).arrayBuffer();
      offset += buf.byteLength;
      scanner.feed(decoder.decode(buf, { stream: offset < file.size }));
      flush();
      self.postMessage({ type: 'progress', loaded: offset, total: file.size });
    }
    scanner.feed(decoder.decode());
    flush();
  }

  self.onmessage = async (e) => {
    const { file } = e.data;
    try {
      await parseFile(file);
      self.postMessage({ type: 'done', contacts: [...contacts.values()], counts });
    } catch (err) {
      self.postMessage({ type: 'error', message: String((err && err.message) || err) });
    }
  };
}

/**
 * Run a parser worker over `payload`. Callbacks: onBatch(msgs, calls, found), onProgress(loaded, total).
 * `found` lists the conversations first seen in that batch (spec 016 R15).
 * Resolves with the worker's final { type:'done', contacts, counts } message.
 */
function runParserWorker(workerFn, payload, { onBatch, onProgress }) {
  return new Promise((resolve, reject) => {
    const lib = `Object.assign((${messageLib})((${vaderLib})()), (${zipLib})())`;
    const src = `(${workerFn})(self, ${lib});`;
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    const worker = new Worker(url);
    worker.onmessage = (e) => {
      const d = e.data;
      if (d.type === 'batch') onBatch(d.msgs, d.calls, d.found || []);
      else if (d.type === 'progress') onProgress(d.loaded, d.total);
      else if (d.type === 'done' || d.type === 'error') {
        worker.terminate();
        URL.revokeObjectURL(url);
        if (d.type === 'done') resolve(d);
        else reject(new Error(d.message));
      }
    };
    worker.onerror = (e) => {
      worker.terminate();
      URL.revokeObjectURL(url);
      reject(new Error(e.message || 'Worker failed'));
    };
    worker.postMessage(payload);
  });
}

/** Parse one SMS Backup & Restore XML file in a fresh worker. */
function parseBackupFile(file, callbacks) {
  return runParserWorker(smsParserWorker, { file }, callbacks);
}
