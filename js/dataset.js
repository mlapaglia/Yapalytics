/*
 * What's loaded from export files, and everything worked out from it (spec 014 R5, R6).
 * No DOM, so it's unit tested in Node. app.js holds one: `Data`.
 *
 * Records are the parsers' (see analysis.js). Two fields are worked out here and
 * written back on them, so everything that groups messages sees them:
 *   o   sent (1) or received (0), for apps whose exports name senders (Sources: senderNames)
 *   k   the conversation key; a linked person's key ('p:…') when the conversation is
 *       linked (spec 005), with the conversation's own key kept in `tk`.
 */

/** "(555) 123-4567" for a 10-digit North American number; anything else as it is. */
function formatAddr(a) {
  if (!a) return '';
  const d = a.replace(/[^\d+]/g, '');
  const m = d.match(/^\+?1?(\d{3})(\d{3})(\d{4})$/);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : a;
}

/** A conversation's name without the app and group marks (the pickers draw those, spec 012 R7). */
function contactName(c) {
  if (c.person) return formatAddr(c.name) || c.key;
  if (c.group) return (c.name ? c.name.split(', ') : c.addr.split('~')).map(formatAddr).join(', ');
  return formatAddr(c.name) || formatAddr(c.addr) || c.key;
}

/** A conversation's name for plain dropdowns and charts: its app's mark, 👥 for groups, 🔗 for people. */
function contactLabel(c) {
  if (c.person) return '🔗 ' + contactName(c);
  const chat = Sources.byId(c.s).mark;
  if (c.group) return chat + '👥 ' + contactName(c);
  return (chat ? chat + ' ' : '') + contactName(c);
}

/** A conversation's own name, formatted: what its person can be called. */
const threadName = (c) => formatAddr(c.name) || formatAddr(c.addr) || c.key;
/** A 1-on-1 conversation that can be linked to a person. */
const isLinkable = (c) => !!c && !c.group && !c.person && c.key !== 'unknown';
/** A person's key: 'p:' + the first of its conversation keys, so it stays the same across reloads. */
const personKeyOf = (threads) => 'p:' + [...threads].sort()[0];
/**
 * A 53-bit hash of a string (cyrb53), so the dedupe sets keep a number per message rather
 * than its key string (spec 014 R15). Two different keys share a hash about once in 2^53:
 * with a million messages, the chance that any two collide is about 1 in 18,000, and then
 * the later one would be dropped as a duplicate.
 */
function hashKey(str) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** Two sender names that are the same apart from case and spacing. */
const sameName = (a, b) => a.replace(/[\s~]/g, '').toLowerCase() === b.replace(/[\s~]/g, '').toLowerCase();

function createDataset() {
  // What's been read, by hashKey of its dedupe key, so an overlapping export adds nothing twice.
  let seenMsgs = new Map(); // hash -> the message kept (null for reactions sent as texts)
  let seenCalls = new Set(); // hashes

  const D = {
    msgs: [],
    calls: [],
    contacts: new Map(), // key -> { key, name, addr, group, lastT, s, members, label, search }; people add { person, threads, sources }
    archives: [], // loaded export files; attachments point into these by index (att.z). Append-only.
    reactions: 0, // reactions sent as texts, left out of the messages
    personOf: new Map(), // conversation key -> person key, for the links that apply to what's loaded
    firstSeen: new Map(), // key -> time of the first message loaded for that conversation
    byKey: new Map(), // key -> its messages, time-sorted
    version: 0, // bumped by rederive: anything cached from the records is stale

    /** Keep export files for opening attachments; returns where they start in `archives`. */
    archive(files) {
      const base = D.archives.length;
      D.archives.push(...files);
      return base;
    },

    /**
     * Add a parser batch, leaving out what's already loaded. `attBase` moves the batch's
     * attachment indexes (into its job's files) into `archives`. Returns where the kept
     * messages and calls start in `msgs` and `calls`, and how many were duplicates
     * (spec 016 R4).
     */
    addBatch(msgs, calls, attBase = 0) {
      const rebase = (att) => { if (attBase) for (const a of att) if (a.z != null) a.z += attBase; };
      const msgFrom = D.msgs.length;
      const callFrom = D.calls.length;
      let dupes = 0;
      for (const m of msgs) {
        // Apps that name senders get `o` in rederive, so key them by sender.
        const key = hashKey(`${m.t}|${hasOwner(m.s) ? m.sn : m.o}|${m.k}|${m.l}|${m.m}`);
        const seen = seenMsgs.get(key);
        if (seen !== undefined) {
          // The same message in an overlapping export: keep the reactions both list, and
          // its files if only this copy can open them (a thread file read before its zip).
          if (seen && m.rx) seen.rx = mergeReactions(seen.rx, m.rx);
          if (seen && m.att && !seen.att) {
            rebase(m.att);
            seen.att = m.att;
            seen.mb = m.mb;
          }
          dupes++;
          continue;
        }
        // Reactions sent as texts (tapbacks, "😂 to “…”") aren't messages. Reactions
        // on a message (Instagram, Messenger, Telegram, Google Chat) ride along in its rx.
        if (m.f & T_REACTION) { seenMsgs.set(key, null); D.reactions++; continue; }
        seenMsgs.set(key, m);
        if (m.att) rebase(m.att);
        D.msgs.push(m);
      }
      for (const c of calls) {
        const key = hashKey(`${c.t}|${c.ty}|${c.k}`);
        if (seenCalls.has(key)) continue;
        seenCalls.add(key);
        D.calls.push(c);
      }
      return { msgFrom, callFrom, dupes };
    },

    /** Merge a parser's conversations into what's loaded: newest name, every member. */
    addContacts(list) {
      for (const c of list) {
        const cur = D.contacts.get(c.key);
        if (!cur) {
          D.contacts.set(c.key, c);
          continue;
        }
        if (c.name && c.lastT >= cur.lastT) { cur.name = c.name; cur.lastT = c.lastT; }
        if (!cur.addr) cur.addr = c.addr;
        if (c.owner && !cur.owner) cur.owner = c.owner;
        if (c.members) {
          const all = new Map(cur.members);
          for (const [n, k] of c.members) all.set(n, Math.max(all.get(n) || 0, k));
          cur.members = [...all];
          cur.addr = [...all.keys()].join('~');
        }
      }
    },

    /** After a load: messages and calls in time order. */
    finish() {
      D.msgs.sort((a, b) => a.t - b.t);
      D.calls.sort((a, b) => a.t - b.t);
    },

    /** Forget everything read (not `archives`: attachment indexes from before stay valid). */
    reset() {
      D.msgs = [];
      D.calls = [];
      D.contacts = new Map();
      D.reactions = 0;
      D.personOf = new Map();
      D.firstSeen = new Map();
      D.byKey = new Map();
      seenMsgs = new Map();
      seenCalls = new Set();
      D.version++;
    },

    // ---------------------------------------------------------------- who's you (spec 013)

    /**
     * Conversations whose owner has to be worked out: every one of the app's, except
     * those whose export calls you by its default name (imessage-exporter's "Me").
     */
    ownerPool(source) {
      return [...D.contacts.values()].filter((c) => c.s === source && !c.members.some(([n]) => isDefaultOwner(source, n)));
    },

    /**
     * Most exports don't mark which sender is you. Some do (`owner` on their
     * conversations: certain). Otherwise a 1-on-1 chat is named after the other person,
     * so its other sender is you (strong evidence); failing that you're the sender who
     * shows up in the most chats, then the one with the most messages.
     */
    guessOwner(source) {
      const score = new Map();
      const add = (name, n) => score.set(name, (score.get(name) || 0) + n);
      for (const c of D.ownerPool(source)) {
        if (c.owner) add(c.owner, 1e6);
        for (const [name, count] of c.members) add(name, 1 + count / 1e9);
        if (!c.group && c.members.length === 2 && c.members.some(([n]) => sameName(n, c.title))) {
          add(c.members.find(([n]) => !sameName(n, c.title))[0], 1000);
        }
      }
      return [...score.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n)[0] || '';
    },

    /** Guess every owner that wasn't picked by hand. `owners`: { [app id]: { name, auto } }, changed in place. */
    guessOwners(owners) {
      for (const s of Object.keys(owners)) if (owners[s].auto) owners[s].name = D.guessOwner(+s);
    },

    /** An app's sender names with their message counts, most first. Empty when there's nothing to pick. */
    ownerChoices(source) {
      const names = new Map();
      for (const c of D.ownerPool(source)) for (const [n, k] of c.members) names.set(n, (names.get(n) || 0) + k);
      return [...names.entries()].sort((a, b) => b[1] - a[1]);
    },

    /** Where an app's owner came from: 'export' (its own profile), 'guess', or 'picked'. */
    ownerOrigin(source, { name, auto }) {
      if (!auto) return 'picked';
      return D.ownerPool(source).some((c) => c.owner && c.owner === name) ? 'export' : 'guess';
    },

    // ---------------------------------------------------------------- conversations

    /** Apps with loaded conversations. */
    loadedSources() {
      return new Set([...D.contacts.values()].filter((c) => !c.person).map((c) => c.s || 0));
    },

    /** Apps of a conversation key: one, or several for a linked person. */
    keySources(key) {
      const c = D.contacts.get(key);
      return c && c.person ? c.sources : [(c && c.s) || 0];
    },

    /** Messages per conversation, by the key each had before any link (calls-only conversations count 0). */
    threadCounts() {
      const n = new Map();
      for (const m of D.msgs) { const k = m.tk || m.k; n.set(k, (n.get(k) || 0) + 1); }
      for (const c of D.calls) { const k = c.tk || c.k; if (!n.has(k)) n.set(k, 0); }
      return n;
    },

    /** A conversation's messages (a linked person's: all of its conversations'), time-sorted. */
    messagesOf(key) {
      return D.byKey.get(key) || [];
    },

    /**
     * Lowercased text the conversation pickers search (spec 012 R1): the conversation's
     * name and addresses (not your own name) plus, for SMS groups, each member's name
     * and number from their own conversations ('g:' + the members' 1-on-1 keys).
     */
    searchText(c, owners) {
      if (c.person) {
        return [c.label, c.name, ...c.threads.map((k) => D.contacts.get(k)).filter(Boolean).map((t) => D.searchText(t, owners))]
          .filter(Boolean).join('\n').toLowerCase();
      }
      const mine = (n) => hasOwner(c.s) && (n === owners[c.s].name || isDefaultOwner(c.s, n));
      const parts = [c.label, c.name, ...c.addr.split('~').filter((n) => !mine(n))];
      if (c.group && !c.s) {
        for (const k of c.key.slice(2).split('~')) {
          const member = D.contacts.get(k);
          if (member) parts.push(member.name, member.addr);
        }
      }
      return parts.filter(Boolean).join('\n').toLowerCase();
    },

    // ---------------------------------------------------------------- rederive

    /**
     * Work out everything that depends on the records, owners and saved links (R6), in
     * this order, which later steps depend on:
     *   1. `o` on records of apps that name senders, from `owners`
     *   2. links: a person with 2+ loaded conversations gets a contact, and their
     *      records' `k` becomes its key (the conversation's own key moves to `tk`)
     *   3. labels, then search text (which includes the label)
     *   4. first-seen times and the by-conversation index
     * `owners`: { [app id]: { name } }. `people`: saved links, Map(person key -> { key, name, threads }).
     */
    rederive({ owners, people }) {
      for (const m of D.msgs) if (hasOwner(m.s)) m.o = m.sn === owners[m.s].name || isDefaultOwner(m.s, m.sn) ? 1 : 0;

      for (const [k, c] of D.contacts) if (c.person) D.contacts.delete(k);
      const counts = D.threadCounts();
      D.personOf = new Map();
      for (const p of people.values()) {
        const parts = p.threads.filter((k) => counts.has(k)).map((k) => D.contacts.get(k)).filter(isLinkable);
        if (parts.length < 2) continue;
        const names = parts.map(threadName);
        const name = p.name && names.includes(p.name) ? p.name : defaultPersonName(parts.map((c) => ({ s: c.s, name: threadName(c), n: counts.get(c.key) })));
        for (const c of parts) D.personOf.set(c.key, p.key);
        D.contacts.set(p.key, {
          key: p.key, name, addr: '', group: false, person: true, members: [],
          threads: parts.map((c) => c.key),
          sources: [...new Set(parts.map((c) => c.s || 0))].sort((a, b) => a - b),
          lastT: Math.max(...parts.map((c) => c.lastT || 0)),
        });
      }
      const relink = (r) => {
        const own = r.tk || r.k;
        const p = D.personOf.get(own);
        if (p) { r.tk = own; r.k = p; } else if (r.tk) { r.k = r.tk; delete r.tk; }
      };
      for (const m of D.msgs) relink(m);
      for (const c of D.calls) relink(c);

      for (const c of D.contacts.values()) c.label = contactLabel(c);
      for (const c of D.contacts.values()) c.search = D.searchText(c, owners);

      D.firstSeen = new Map();
      D.byKey = new Map();
      for (const m of D.msgs) {
        let list = D.byKey.get(m.k);
        if (!list) {
          D.byKey.set(m.k, (list = []));
          D.firstSeen.set(m.k, m.t);
        }
        list.push(m);
      }
      D.version++;
    },
  };
  return D;
}
