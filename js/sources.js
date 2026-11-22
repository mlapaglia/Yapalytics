/*
 * Every app Yapalytics reads, described once (spec 014 R4). Code elsewhere asks an
 * entry what to do (`Sources.byId(m.s).senderNames`) instead of testing app numbers.
 *
 * An entry:
 *   id            `s` on message records and conversations. Never renumber: records carry it.
 *   kind          the name file detection and the Files dialog use.
 *   name          shown on screen.        logo  its #logo-… symbol in index.html.
 *   mark          emoji before a conversation's name in plain dropdowns ('' for none).
 *   exportName    what its export is called when listing what can be read ('' to leave it out).
 *   senderNames   records carry the sender's name in `sn`, and which name is you comes
 *                 from the export or a pick ("Which one is you?", spec 013).
 *   defaultOwner  the name the export gives you when it wasn't customized, or null.
 *   addrIds       a conversation's `addr` holds phone numbers or emails (so they can
 *                 match across apps, spec 005); otherwise it lists sender names.
 *   jobs          'each': every file is parsed on its own. 'together': all of the app's
 *                 files go to one parse (split exports, WhatsApp date formats).
 *   readTogether  a file added later must be read again with the app's files already
 *                 loaded (planFileChanges, spec 006 R7).
 *   archives      its files are kept so attachments can be opened (att.z indexes Data.archives).
 *   metaFormat    Meta's download format: a thread file on its own could be either app.
 *   shares        its messages can be shared posts (spec 004).
 *   nameRank      which app's name a linked person goes by first (lower first, spec 005 R5).
 *   badDatesError shown when nothing loaded because the export's dates couldn't be read.
 *   exportOf(c)   which export a conversation came from, when an app has two (spec 009 R12).
 *   parse(files, callbacks)   runs its parser (see runParserWorker).
 *   detect        { file(probe), zip(probe), …more zip rules } → true when the file is
 *                 this app's; throws when it is but can't be read (an HTML export).
 *                 DETECT_STEPS says the order they're tried in.
 */

const TELEGRAM_HTML = "This is Telegram's HTML export, which can't be read. Export again and choose “Machine-readable JSON” as the format.";
const INSTAGRAM_HTML = "This is Instagram's HTML export, which can't be read. Export again and choose “JSON” as the format.";
const MESSENGER_HTML = "This is Facebook's HTML export, which can't be read. Export again and choose “JSON” as the format.";
/** Instagram and Facebook keep each conversation in messages/<folder>/<name>_<id>/message_N.json. */
const META_THREAD = /(?:^|\/)messages\/[^/]+\/[^/]+\/message_\d+\.(?:json|html)$/;
const META_THREAD_FILE = /^message_\d+\.json$/i;
/** Signs that a DYI export, or one of its threads, is Facebook's rather than Instagram's (spec 009 R6, R7). */
const FACEBOOK_SIGN = /your_facebook_activity\/|"Facebook user"/i;
/** Enough of a JSON file to tell what it is. */
const JSON_PEEK = 65536;
/** A thread of Messenger's encrypted chats download (spec 009 R2), from the start of its JSON. */
const looksLikeEncryptedChat = (text) => /"threadName"\s*:/.test(text) && /"(?:senderName|participants)"\s*:/.test(text);
/** imessage-exporter txt starts with "May 17, 2022  5:29:42 PM"; WhatsApp with "1/2/24, …". */
const looksLikeIMessage = (text) =>
  /^\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{2}, \d{4} {1,2}\d{1,2}:\d{2}:\d{2} [AP]M/.test(text.replace(/^﻿/, ''));
const isZip = (f) => /\.zip$/i.test(f.name) || /zip/.test(f.type);

/**
 * What detection reads of a file, read once however many rules ask: the start of a
 * loose file, a zip's entries and the start of an entry, and the Meta layout of a zip.
 */
function fileProbe(file) {
  const heads = new Map();
  const entryHeads = new Map();
  let entries = null;
  let meta = null;
  const probe = {
    file,
    name: file.name,
    /** The first `n` bytes as text. */
    head(n) {
      if (!heads.has(n)) heads.set(n, file.slice(0, n).text());
      return heads.get(n);
    },
    /** A zip's file entries (no folders). */
    entries() {
      if (!entries) entries = zipLib().listZip(file).then((all) => all.filter((e) => !e.name.endsWith('/')));
      return entries;
    },
    /** The start of a zip entry as text. */
    entryHead(e, n = JSON_PEEK) {
      if (!entryHeads.has(e)) entryHeads.set(e, zipLib().readEntryText(e));
      return entryHeads.get(e).then((t) => t.slice(0, n));
    },
    async has(re) {
      return (await probe.entries()).some((e) => re.test(e.name));
    },
    /** The first .txt that isn't imessage-exporter's orphaned.txt, else any .txt, else null. */
    async chatText() {
      const all = await probe.entries();
      return all.find((e) => /\.txt$/i.test(e.name) && !/(?:^|\/)orphaned\.txt$/i.test(e.name)) || all.find((e) => /\.txt$/i.test(e.name)) || null;
    },
    /**
     * A zip in Meta's layout: its thread files, whether any is JSON, and whether it's
     * Facebook's (its folders or profile file, or a thread that points into Facebook's).
     */
    meta() {
      if (!meta) {
        meta = (async () => {
          const all = await probe.entries();
          const threads = all.filter((e) => META_THREAD.test(e.name));
          const json = threads.find((e) => e.name.endsWith('.json'));
          const facebook = all.some((e) => /(?:^|\/)(?:your_facebook_activity\/|profile_information\.json$)/.test(e.name)) ||
            (!all.some((e) => /(?:^|\/)your_instagram_activity\//.test(e.name)) && !!json && FACEBOOK_SIGN.test(await probe.entryHead(json)));
          return { threads, json: !!json, facebook };
        })();
      }
      return meta;
    },
  };
  return probe;
}

const Sources = {
  list: [
    {
      id: 0, kind: 'sms', name: 'SMS', logo: 'sms', mark: '', exportName: '',
      senderNames: false, defaultOwner: null, addrIds: true,
      jobs: 'each', readTogether: false, archives: true, metaFormat: false, shares: false, nameRank: 0,
      parse: (files, cb) => parseBackupFile(files[0], cb),
      // SMS Backup & Restore's XML: whatever isn't a zip and nothing else claimed.
      detect: { file: (p) => !isZip(p.file) },
    },
    {
      id: 1, kind: 'gchat', name: 'Google Chat', logo: 'googlechat', mark: '💬', exportName: 'Google Takeout',
      senderNames: false, defaultOwner: null, addrIds: true,
      jobs: 'together', readTogether: true, archives: true, metaFormat: false, shares: false, nameRank: 3,
      badDatesError: 'The Google Chat dates are in a language this app can\'t read yet. Set your Google account language to English, export again, and retry.',
      parse: (files, cb) => parseGoogleChatZips(files, cb),
      detect: { zip: (p) => p.has(/(?:^|\/)Google Chat\//) },
    },
    {
      id: 2, kind: 'whatsapp', name: 'WhatsApp', logo: 'whatsapp', mark: '🟢', exportName: 'WhatsApp',
      senderNames: true, defaultOwner: null, addrIds: false,
      jobs: 'together', readTogether: true, archives: false, metaFormat: false, shares: false, nameRank: 2,
      parse: (files, cb) => parseWhatsAppFiles(files, cb),
      detect: {
        file: (p) => /\.txt$/i.test(p.name),
        zip: (p) => p.has(/(?:^|\/)(?:_chat|WhatsApp[^/]*)\.txt$/i),
        anyText: async (p) => !!(await p.chatText()),
      },
    },
    {
      id: 3, kind: 'imessage', name: 'iMessage', logo: 'imessage', mark: '🔵', exportName: 'iMessage',
      // imessage-exporter calls you "Me" unless the export used --custom-name / --use-caller-id.
      senderNames: true, defaultOwner: 'Me', addrIds: false,
      jobs: 'together', readTogether: false, archives: false, metaFormat: false, shares: false, nameRank: 1,
      parse: (files, cb) => parseIMessageFiles(files, cb),
      detect: {
        file: async (p) => /\.txt$/i.test(p.name) && looksLikeIMessage(await p.head(4096)),
        zip: async (p) => {
          const txt = await p.chatText();
          return !!txt && looksLikeIMessage(await p.entryHead(txt, Infinity));
        },
      },
    },
    {
      id: 4, kind: 'telegram', name: 'Telegram', logo: 'telegram', mark: '✈️', exportName: 'Telegram',
      senderNames: true, defaultOwner: null, addrIds: false,
      jobs: 'together', readTogether: false, archives: true, metaFormat: false, shares: false, nameRank: 4,
      parse: (files, cb) => parseTelegramFiles(files, cb),
      detect: {
        file: (p) => {
          if (/^messages\d*\.html$/i.test(p.name)) throw new Error(TELEGRAM_HTML);
          return /\.json$/i.test(p.name);
        },
        zip: (p) => p.has(/(?:^|\/)result\.json$/),
        html: async (p) => {
          if (await p.has(/(?:^|\/)messages\d*\.html$/)) throw new Error(TELEGRAM_HTML);
          return false;
        },
      },
    },
    {
      id: 5, kind: 'instagram', name: 'Instagram', logo: 'instagram', mark: '📸', exportName: 'Instagram',
      senderNames: true, defaultOwner: null, addrIds: false,
      jobs: 'together', readTogether: true, archives: true, metaFormat: true, shares: true, nameRank: 5,
      parse: (files, cb) => parseInstagramFiles(files, cb),
      detect: {
        // A thread on its own (Messenger's rule runs first): a guess the Files dialog can change (spec 009 R7, R13).
        file: (p) => {
          if (/^message_\d+\.html$/i.test(p.name)) throw new Error(INSTAGRAM_HTML);
          return META_THREAD_FILE.test(p.name);
        },
        zip: async (p) => {
          const { threads, json } = await p.meta();
          if (json) return true;
          if (threads.length) throw new Error(INSTAGRAM_HTML);
          // The other parts of a split export: media, or your profile.
          return p.has(/(?:^|\/)(?:your_instagram_activity\/|personal_information\/|messages\/(?:inbox|archived_threads|message_requests)\/)/);
        },
      },
    },
    {
      id: 6, kind: 'messenger', name: 'Messenger', logo: 'messenger', mark: '⚡', exportName: 'Messenger',
      senderNames: true, defaultOwner: null, addrIds: false,
      jobs: 'together', readTogether: true, archives: true, metaFormat: true, shares: true, nameRank: 6,
      parse: (files, cb) => parseMessengerFiles(files, cb),
      // The encrypted chats download counts apart from Facebook's DYI export.
      exportOf: (c) => (/^(?:g:)?fb:e2ee:/.test(c.key) ? '6e' : '6'),
      detect: {
        file: async (p) => {
          if (META_THREAD_FILE.test(p.name)) return FACEBOOK_SIGN.test(await p.head(JSON_PEEK));
          return /\.json$/i.test(p.name) && looksLikeEncryptedChat(await p.head(JSON_PEEK));
        },
        // Facebook's DYI export, or a part of it: tried before Instagram's, which has the same layout.
        zip: async (p) => {
          const { threads, json, facebook } = await p.meta();
          if (!facebook) return false;
          if (threads.length && !json) throw new Error(MESSENGER_HTML);
          return true;
        },
        // The encrypted chats download: a .json per chat, maybe next to other .json files.
        encrypted: async (p) => {
          for (const e of (await p.entries()).filter((x) => /\.json$/i.test(x.name))) {
            if (looksLikeEncryptedChat(await p.entryHead(e))) return true;
          }
          return false;
        },
      },
    },
  ],

  byId(id) {
    return this.list.find((s) => s.id === (id || 0));
  },

  byKind(kind) {
    return this.list.find((s) => s.kind === kind);
  },

  /** A zeroed array with a slot per app id. */
  zeros() {
    return new Array(Math.max(...this.list.map((s) => s.id)) + 1).fill(0);
  },
};

/** Records from these apps carry their sender in `sn` and get `o` from Prefs.owners. */
const hasOwner = (s) => !!Sources.byId(s)?.senderNames;
/** The name an app's export calls you by when it wasn't customized. */
const isDefaultOwner = (s, name) => name != null && Sources.byId(s)?.defaultOwner === name;
/** An app's name on screen. */
const sourceName = (s) => Sources.byId(s)?.name ?? String(s);
/** { id: name } for every app, for code that takes a lookup (charts, highlights). */
const sourceNames = () => Object.fromEntries(Sources.list.map((s) => [s.id, s.name]));

/**
 * The order detection tries rules in, first match wins: [kind, rule name]. Loose files go
 * through the `file` steps, zips through the `zip` ones. An app missing here (one added
 * later) has its rules tried first, as an app recognized by its own name is the surest.
 */
const DETECT_STEPS = {
  file: [['messenger', 'file'], ['instagram', 'file'], ['telegram', 'file'], ['', 'html'], ['imessage', 'file'], ['whatsapp', 'file'], ['sms', 'file']],
  zip: [['gchat', 'zip'], ['messenger', 'zip'], ['instagram', 'zip'], ['telegram', 'zip'], ['messenger', 'encrypted'], ['telegram', 'html'], ['whatsapp', 'zip'], ['imessage', 'zip'], ['whatsapp', 'anyText']],
};

/** Any other HTML file: not an export this app can read. */
const unreadableHtml = (p) => {
  if (/\.html?$/i.test(p.name)) throw new Error(`${p.name} isn't an export this app can read`);
  return false;
};

/** The kind of app a file is an export of; throws with the reason when it can't be read. */
async function detectFile(file) {
  const probe = fileProbe(file);
  const named = new Set([...DETECT_STEPS.file, ...DETECT_STEPS.zip].map(([kind]) => kind));
  const extra = (phase) => Sources.list.filter((s) => !named.has(s.kind) && s.detect?.[phase]).map((s) => [s.kind, phase]);
  const run = async (steps) => {
    for (const [kind, rule] of steps) {
      const hit = kind ? await Sources.byKind(kind).detect[rule](probe) : unreadableHtml(probe);
      if (hit) return kind;
    }
    return null;
  };
  const loose = await run([...extra('file'), ...DETECT_STEPS.file]);
  if (loose) return loose;
  const zipped = await run([...extra('zip'), ...DETECT_STEPS.zip]);
  if (zipped) return zipped;
  const names = Sources.list.map((s) => s.exportName).filter(Boolean);
  throw new Error(`${file.name} isn't a ${names.slice(0, -1).join(', ')} or ${names.at(-1)} export`);
}
