/*
 * Settings, and the only code that touches localStorage (spec 014 step 6). Storage can
 * be missing or full (private windows, blocked sites), so every access is guarded here
 * once, and a setting that can't be saved just lasts until the page closes.
 * Keys and formats are the ones earlier versions wrote (R13).
 */

const STORE_KEYS = { theme: 'ms-theme', igPreviews: 'ms-ig-previews', people: 'ms-people', ai: 'yapa-ai' };

const Store = {
  /** The saved string, or null. */
  get(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  },

  /** Save a string; null removes the key. */
  set(key, value) {
    try {
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch (e) { /* storage unavailable */ }
  },

  /** The saved JSON value, or null when missing or unreadable. */
  getJSON(key) {
    try { return JSON.parse(Store.get(key) || 'null'); } catch (e) { return null; }
  },

  setJSON(key, value) {
    Store.set(key, value == null ? null : JSON.stringify(value));
  },
};

/** What the person chose that outlasts a load: theme, previews, who's you, linked people. */
const Prefs = {
  theme: 'auto', // 'auto' | 'light' | 'dark'
  igPreviews: false, // load Instagram's embeds of shared posts (spec 004, opt-in)
  // Your sender name per app whose records carry sender names (Sources: senderNames);
  // `auto` is false once picked by hand. Not saved: it belongs to the files loaded.
  owners: Object.fromEntries(Sources.list.filter((s) => s.senderNames).map((s) => [s.id, { name: '', auto: true }])),
  people: new Map(), // person key -> { key, name, threads }: saved links (spec 005), loaded or not; name '' = the default
  dismissed: new Set(), // signatures (linkSignature) of dismissed link suggestions

  load() {
    Prefs.theme = Store.get(STORE_KEYS.theme) || 'auto';
    Prefs.igPreviews = Store.get(STORE_KEYS.igPreviews) === '1';
    Prefs.loadPeople();
  },

  saveTheme(mode) {
    Prefs.theme = mode;
    Store.set(STORE_KEYS.theme, mode);
  },

  /** Turning previews off deletes the setting, so a failed write can't leave an old "on" behind. */
  saveIgPreviews(on) {
    Prefs.igPreviews = on;
    Store.set(STORE_KEYS.igPreviews, on ? '1' : null);
  },

  // ---------------------------------------------------------------- linked people (spec 005)

  /** Read the saved links, dropping anything malformed. */
  loadPeople() {
    Prefs.people = new Map();
    Prefs.dismissed = new Set();
    const data = Store.getJSON(STORE_KEYS.people);
    if (!data || data.v !== 1) return;
    for (const p of Array.isArray(data.people) ? data.people : []) {
      const threads = Array.isArray(p && p.threads) ? [...new Set(p.threads.filter((k) => typeof k === 'string'))] : [];
      if (threads.length > 1) Prefs.putPerson(threads, typeof p.name === 'string' ? p.name : '');
    }
    for (const d of Array.isArray(data.dismissed) ? data.dismissed : []) if (typeof d === 'string') Prefs.dismissed.add(d);
  },

  savePeople() {
    const people = [...Prefs.people.values()].map(({ name, threads }) => ({ name, threads }));
    Store.setJSON(STORE_KEYS.people, people.length || Prefs.dismissed.size ? { v: 1, people, dismissed: [...Prefs.dismissed] } : null);
  },

  putPerson(threads, name) {
    const key = personKeyOf(threads);
    Prefs.people.set(key, { key, name, threads: [...threads].sort() });
  },

  /** The saved person a conversation belongs to, loaded or not. */
  personOfThread(threadKey) {
    for (const p of Prefs.people.values()) if (p.threads.includes(threadKey)) return p;
    return null;
  },

  /** One person out of these conversations and any people they already belong to. */
  linkThreads(keys) {
    const all = new Set(keys);
    let name = '';
    for (const k of keys) {
      const p = Prefs.personOfThread(k);
      if (!p) continue;
      for (const t of p.threads) all.add(t);
      name = name || p.name;
      Prefs.people.delete(p.key);
    }
    if (all.size > 1) Prefs.putPerson([...all], name);
  },

  unlinkThread(key) {
    const p = Prefs.personOfThread(key);
    if (!p) return;
    Prefs.people.delete(p.key);
    const rest = p.threads.filter((k) => k !== key);
    if (rest.length > 1) Prefs.putPerson(rest, p.name);
  },
};
