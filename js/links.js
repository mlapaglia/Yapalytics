/*
 * Linked people (spec 005): one person's 1-on-1 conversations across apps. This file
 * holds the pure parts — matching and naming — so they can be unit tested. The saved
 * links are in store.js (Prefs), applying them in dataset.js, the dialog in
 * ui/people-dialog.js. Only conversation names, numbers and emails are read here,
 * never message text.
 */

/** Names that stand for "someone" rather than a person, so they never match. */
const PLACEHOLDER_NAMES = new Set(['instagram user', 'deleted account', 'me', 'unknown', 'facebook user']);


const PERSON_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PERSON_PHONE_RE = /^[+\d\s\-().]+$/;

/** "  Álex   RIVERA " → "alex rivera": case, accents and spacing don't count. */
function normName(s) {
  return String(s || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** The digits that identify a phone number (the last 10, so a country or trunk prefix doesn't count), or '' if it isn't one. */
function normPhone(s) {
  s = String(s || '').trim();
  if (!PERSON_PHONE_RE.test(s)) return '';
  const digits = s.replace(/\D/g, '');
  return digits.length >= 7 ? digits.slice(-10) : '';
}

const isEmail = (s) => PERSON_EMAIL_RE.test(String(s || '').trim());
/** A name a person could go by: has a letter, isn't a number, email or placeholder. */
const isRealName = (s) => !!s && /\p{L}/u.test(s) && !isEmail(s) && !normPhone(s) && !PLACEHOLDER_NAMES.has(normName(s));

/**
 * What a 1-on-1 conversation could be matched on: `n:` name, `p:` phone, `e:` email.
 * SMS and Google Chat also have an address (number or email); the other apps' addr
 * lists senders, which includes you, so only their names count. `ownNames` are your
 * own names on that app, which never match.
 */
function identityTokens(c, ownNames = []) {
  const own = new Set(ownNames.filter(Boolean).map(normName));
  const values = [c.name, c.title];
  if (Sources.byId(c.s)?.addrIds) values.push(...String(c.addr || '').split('~'));
  const out = new Set();
  for (const v of values) {
    if (!v) continue;
    if (isEmail(v)) { out.add('e:' + v.trim().toLowerCase()); continue; }
    const phone = normPhone(v);
    if (phone) { out.add('p:' + phone); continue; }
    const n = normName(v);
    if (/\p{L}/u.test(n) && !PLACEHOLDER_NAMES.has(n) && !own.has(n)) out.add('n:' + n);
  }
  return [...out];
}

/**
 * Which export a conversation comes from, for telling apart two people with one name
 * (R3): its app, except that Messenger's encrypted chats download counts apart from
 * Facebook's DYI export, since a chat's older and newer history sit one in each (spec 009 R12).
 */
const exportOf = (t) => {
  const src = Sources.byId(t.s);
  return src?.exportOf ? src.exportOf(t) : String(t.s || 0);
};

/** A suggestion's identity: its conversation keys, sorted. Dismissals are stored by it. */
const linkSignature = (keys) => [...keys].sort().join('\n');

/**
 * Suggested links (R3): groups of 1-on-1 conversations that share a name, number or
 * email. `threads` are { key, s, name, title, addr }; a name counts only when no app has
 * two conversations with it. Groups already inside one person, and dismissed groups,
 * are left out. Returns [{ keys, reasons: ['name' | 'phone' | 'email'] }], biggest first.
 */
function suggestLinks(threads, { personOf = new Map(), dismissed = new Set(), ownNames = () => [] } = {}) {
  const byToken = new Map(); // token -> threads having it
  for (const t of threads) {
    for (const tok of identityTokens(t, ownNames(t.s))) {
      if (!byToken.has(tok)) byToken.set(tok, []);
      byToken.get(tok).push(t);
    }
  }

  const parent = new Map(threads.map((t) => [t.key, t.key]));
  const find = (k) => { while (parent.get(k) !== k) { parent.set(k, parent.get(parent.get(k))); k = parent.get(k); } return k; };
  const reasons = new Map(); // root -> Set of reasons, merged on union
  const KIND = { n: 'name', p: 'phone', e: 'email' };

  for (const [tok, list] of byToken) {
    if (list.length < 2) continue;
    const kind = KIND[tok[0]];
    if (kind === 'name') {
      const perApp = new Map();
      for (const t of list) perApp.set(exportOf(t), (perApp.get(exportOf(t)) || 0) + 1);
      if ([...perApp.values()].some((n) => n > 1)) continue; // ambiguous: two people with this name in one export
    }
    let root = find(list[0].key);
    const why = new Set(reasons.get(root) || []).add(kind);
    for (const t of list.slice(1)) {
      const r = find(t.key);
      if (r === root) continue;
      for (const x of reasons.get(r) || []) why.add(x);
      parent.set(r, root);
    }
    root = find(root);
    reasons.set(root, why);
  }

  const groups = new Map();
  for (const t of threads) {
    const r = find(t.key);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(t.key);
  }
  const out = [];
  for (const [root, keys] of groups) {
    if (keys.length < 2) continue;
    const people = new Set(keys.map((k) => personOf.get(k)));
    if (people.size === 1 && !people.has(undefined)) continue; // already one person
    if (dismissed.has(linkSignature(keys))) continue;
    out.push({ keys: [...keys].sort(), reasons: ['name', 'phone', 'email'].filter((x) => reasons.get(root).has(x)) });
  }
  return out.sort((a, b) => b.keys.length - a.keys.length || a.keys[0].localeCompare(b.keys[0]));
}

/**
 * The name a person goes by by default (R5): the first real name in app order (Sources:
 * nameRank, SMS → iMessage → WhatsApp → Google Chat → Telegram → Instagram → Messenger), the busier
 * conversation first on a tie. `threads` are { s, name, n }.
 */
function defaultPersonName(threads) {
  const rank = (t) => Sources.byId(t.s)?.nameRank ?? Infinity;
  const real = threads.filter((t) => isRealName(t.name)).sort((a, b) => rank(a) - rank(b) || (b.n || 0) - (a.n || 0));
  if (real.length) return real[0].name;
  const any = threads.find((t) => t.name);
  return any ? any.name : '';
}
