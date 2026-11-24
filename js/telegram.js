/*
 * Parser for Telegram Desktop exports in the "Machine-readable JSON" format
 * (https://core.telegram.org/import-export). Accepts:
 *   - result.json on its own: messages are counted, attachments can't be opened;
 *   - a .zip of the export folder: result.json plus chats/chat_NN/photos/… (a full
 *     export) or photos/… beside it (one chat), so attachments can be opened.
 * A full export (Settings › Advanced › Export Telegram data) has chats.list and
 * left_chats.list; a single-chat export (a chat's ⋮ › Export chat history) is one chat.
 *
 * Only conversations are kept: personal and bot chats (1-on-1) and groups. Channels,
 * Saved Messages and Replies are skipped, as are service messages (joins, pins, calls…).
 * Reactions are a field on messages in this format, so they never count as messages.
 *
 * Records carry the sender's display name in `sn`, and the page sets `o` from Prefs.owners as
 * for WhatsApp. Each contact also gets `owner`, your display name when the export shows
 * it: from personal_information in a full export, or as the sender of a 1-on-1 chat who
 * isn't the other person (a personal chat's id is the other person's user id). The page
 * uses it as its first guess. Times have second precision, so the nth message within one
 * second of a chat gets +n ms: order is kept and overlapping exports dedupe cleanly.
 *
 * Like the other workers, this function is serialized into a Blob and must be self-contained.
 */
function telegramParserWorker(self, lib) {
  'use strict';

  const { analyzeText, stampTime, addReaction, listZip, readEntryText, contactMap } = lib;

  const BATCH_SIZE = 5000;
  const ONE_ON_ONE = new Set(['personal_chat', 'bot_chat']);
  const GROUPS = new Set(['private_group', 'private_supergroup', 'public_supergroup']);
  const MEDIA_KIND = { sticker: 'ph', animation: 'gf', video_file: 'vd', video_message: 'vd', voice_message: 'au', audio_file: 'au' };
  const HTML_EXPORT = "This is Telegram's HTML export, which can't be read. Export again and choose “Machine-readable JSON” as the format.";

  const isZip = (f) => /\.zip$/i.test(f.name) || /zip/.test(f.type);
  const baseName = (p) => p.replace(/^.*\//, '');

  /** Message text: a string, or an array of strings and { type, text } entities. */
  function textOf(t) {
    if (typeof t === 'string') return t;
    if (Array.isArray(t)) return t.map((p) => (typeof p === 'string' ? p : (p && p.text) || '')).join('');
    return '';
  }

  /** The kind of attachment a message carries ('ph' | 'gf' | 'vd' | 'au' | 'ot'), or ''. */
  function kindOf(m) {
    if (m.photo) return 'ph';
    if (MEDIA_KIND[m.media_type]) return MEDIA_KIND[m.media_type];
    if (m.file) {
      const type = String(m.mime_type || '');
      if (type === 'image/gif') return 'gf';
      if (type.startsWith('image/')) return 'ph';
      if (type.startsWith('video/')) return 'vd';
      if (type.startsWith('audio/')) return 'au';
      return 'ot';
    }
    if (m.contact_information || m.location_information) return 'ot';
    return '';
  }

  const contacts = contactMap();
  const counts = { telegram: 0, skipped: 0, skippedChats: 0, badDates: 0 };
  const ownerIds = new Set(); // from_id values that are you
  const namesById = new Map(); // from_id -> Map(display name -> messages)
  let msgBatch = [];

  function flush() {
    if (msgBatch.length) {
      self.postMessage({ type: 'batch', msgs: msgBatch, calls: [], found: contacts.takeFresh() });
      msgBatch = [];
    }
  }

  /** Every result.json in the files: { label, read(), entries (zip only), base folder }. */
  async function findExports(files) {
    const out = [];
    for (let z = 0; z < files.length; z++) {
      const file = files[z];
      if (!isZip(file)) {
        out.push({ label: file.name, size: file.size, read: () => file.text(), entries: null, base: '' });
        continue;
      }
      const entries = (await listZip(file)).filter((e) => !e.name.endsWith('/'));
      for (const e of entries) e.z = z; // which file it's in, so the page can load it later
      const results = entries.filter((e) => /(?:^|\/)result\.json$/.test(e.name));
      if (!results.length) {
        throw new Error(entries.some((e) => /(?:^|\/)messages\d*\.html$/.test(e.name)) ? HTML_EXPORT : `${file.name} has no Telegram result.json inside`);
      }
      const byPath = new Map(entries.map((e) => [e.name, e]));
      for (const r of results) {
        out.push({ label: `${file.name}`, size: r.csize, read: () => readEntryText(r), entries: byPath, base: r.name.slice(0, -'result.json'.length) });
      }
    }
    return out;
  }

  /** The chats in one result.json, and your user id if it's a full export. */
  function chatsOf(data, label) {
    if (data && Array.isArray(data.messages)) return [data]; // one chat
    if (!data || !data.chats) throw new Error(`${label} doesn't look like a Telegram export (no chats or messages in it)`);
    const me = data.personal_information && data.personal_information.user_id;
    if (me != null) ownerIds.add('user' + me);
    return [...((data.chats && data.chats.list) || []), ...((data.left_chats && data.left_chats.list) || [])];
  }

  function parseChat(chat, src) {
    const group = GROUPS.has(chat.type);
    if (!group && !ONE_ON_ONE.has(chat.type)) { counts.skippedChats++; return; }
    const key = (group ? 'g:tg:' : 'tg:') + chat.id;
    const title = chat.name || (group ? 'Group' : 'Deleted Account');
    const peer = 'user' + chat.id;
    let c = contacts.get(key);
    if (!c) contacts.set(key, (c = { key, name: title, addr: '', group, lastT: 0, s: 4, title, members: [] }));
    const members = new Map(c.members);

    let lastSec = 0, n = 0;
    for (const m of chat.messages || []) {
      if (m.type !== 'message') { counts.skipped++; continue; }
      const sec = +m.date_unixtime || Math.floor(Date.parse(m.date) / 1000);
      if (!sec) { counts.skipped++; counts.badDates++; continue; }
      const text = textOf(m.text) || (m.poll && m.poll.question) || '';
      const kind = kindOf(m);
      if (!text && !kind) { counts.skipped++; continue; }

      const sender = m.from || 'Deleted Account';
      if (m.from_id) {
        let names = namesById.get(m.from_id);
        if (!names) namesById.set(m.from_id, (names = new Map()));
        names.set(sender, (names.get(sender) || 0) + 1);
        if (chat.type === 'personal_chat' && m.from_id !== peer && m.from_id.startsWith('user')) ownerIds.add(m.from_id);
      }
      members.set(sender, (members.get(sender) || 0) + 1);

      n = sec === lastSec ? n + 1 : 0;
      lastSec = sec;
      const rec = { t: sec * 1000 + n, o: 0, m: 0, s: 4, k: key, sn: sender, ph: 0, gf: 0, vd: 0, au: 0, ot: 0, mb: 0 };
      if (kind) {
        rec[kind]++;
        const path = m.photo || m.file;
        // Left-out files read "(File not included. Change data exporting settings to download.)".
        const e = path && !path.startsWith('(') && src.entries && src.entries.get(src.base + path);
        if (e) {
          rec.mb += e.usize;
          rec.att = [{ n: m.file_name || baseName(path), k: kind, t: m.mime_type || '', z: e.z, o: e.offset, c: e.csize, u: e.usize, m: e.method, p: e.name }];
        } else if (m.file_size) {
          rec.mb += +m.file_size || 0;
        }
      }
      // Custom emoji (a sticker file) and paid star reactions have no emoji to show.
      if (Array.isArray(m.reactions)) {
        for (const r of m.reactions) {
          if (!r || r.type !== 'emoji' || typeof r.emoji !== 'string') continue;
          const recent = Array.isArray(r.recent) ? r.recent.map((x) => x && x.from).filter((x) => typeof x === 'string') : [];
          addReaction(rec, r.emoji, +r.count || recent.length || 1, recent);
        }
      }
      analyzeText(text, rec);
      stampTime(rec);
      if (rec.t > c.lastT) c.lastT = rec.t;
      counts.telegram++;
      msgBatch.push(rec);
      if (msgBatch.length >= BATCH_SIZE) flush();
    }
    c.members = [...members];
    c.addr = [...members.keys()].join('~');
    flush();
  }

  async function parseFiles(files) {
    const exports = await findExports(files);
    const total = exports.reduce((s, x) => s + x.size, 0) || 1;
    let loaded = 0;
    for (const src of exports) {
      let data;
      try {
        data = JSON.parse(await src.read());
      } catch (err) {
        throw new Error(`${src.label} isn't valid JSON, so it can't be a Telegram export`);
      }
      for (const chat of chatsOf(data, src.label)) parseChat(chat, src);
      loaded += src.size;
      self.postMessage({ type: 'progress', loaded, total });
    }

    // Your display name: the name most often shown on messages sent from your user id.
    let owner = '', best = 0;
    for (const id of ownerIds) {
      for (const [name, k] of namesById.get(id) || []) if (k > best) { owner = name; best = k; }
    }
    if (owner) for (const c of contacts.values()) c.owner = owner;
  }

  self.onmessage = async (e) => {
    try {
      await parseFiles(e.data.files);
      flush();
      self.postMessage({ type: 'done', contacts: [...contacts.values()], counts });
    } catch (err) {
      self.postMessage({ type: 'error', message: String((err && err.message) || err) });
    }
  };
}

/** Parse Telegram exports (result.json or a zip of the export folder) together in one worker. */
function parseTelegramFiles(files, callbacks) {
  return runParserWorker(telegramParserWorker, { files: [...files] }, callbacks);
}
