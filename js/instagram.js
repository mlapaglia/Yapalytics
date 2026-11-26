/*
 * Parser for Meta's message exports: Instagram's and Facebook's "Download your
 * information" (DYI) in JSON format, which share one layout, and Messenger's download of
 * end-to-end encrypted chats (spec 009). The worker message says which app: `{ files,
 * app: 'instagram' | 'messenger' }`.
 *
 * DYI accepts:
 *   - the export's .zip (or every part of a split export together): each conversation is
 *     [your_instagram_activity/ | your_facebook_activity/]messages/<folder>/<name>_<id>/message_N.json
 *     with its photos/, videos/ and audio/ beside them, so attachments can be opened;
 *   - message_N.json files on their own: messages are counted, attachments can't be opened.
 * Instagram keeps inbox/ and archived_threads/; Messenger also e2ee_cutover/ (the history
 * of chats that later became encrypted). message_requests/ and filtered_threads/ are skipped.
 *
 * Call notices, group events ("… left the group") and placeholder texts ("… sent an
 * attachment.") aren't messages, though a shared post or reel behind one is: its link,
 * caption and creator go in `sh` (spec 004), and the caption isn't counted as the sender's
 * text. "Liked a message" and "Reacted 😂 to your message" are reactions: they're passed
 * on flagged T_REACTION, so the page counts them as reactions. Reactions on a message
 * (its `reactions` field) never count as messages: they go in `rx`, with who reacted, to
 * be shown on the message (spec 004). Unsent messages are left out.
 *
 * DYI writes text as UTF-8 bytes escaped one per character ("Ã©" for "é"), so every
 * string is decoded again. Records carry the sender's display name in `sn`, and the page
 * sets `o` from Prefs.owners as for WhatsApp. When the export includes your profile
 * (Instagram's personal_information.json, Facebook's profile_information.json), each
 * contact gets `owner`, your name, as the page's first guess.
 *
 * The encrypted chats download is one <threadName>.json per chat ("Alex Rivera_6.json"),
 * with camelCase fields and proper UTF-8: { participants: [names], threadName, messages:
 * [{ senderName, text, timestamp, type, media: [{ uri: './media/…' }], reactions, isUnsent }] }.
 * It has no thread ids, so its conversations are keyed by threadName (spec 009 R2), and
 * named after it without the number. Group chats in it aren't known yet: every thread is
 * read as a 1-on-1.
 *
 * Like the other workers, this function is serialized into a Blob and must be self-contained.
 */
function metaParserWorker(self, lib) {
  'use strict';

  const { analyzeText, stampTime, addReaction, reactionTime, listZip, readEntryText, T_REACTION, contactMap } = lib;

  const APPS = {
    instagram: {
      s: 5,
      prefix: 'ig:',
      name: 'Instagram',
      nobody: 'Instagram User',
      kept: new Set(['inbox', 'archived_threads']),
      html: "This is Instagram's HTML export, which can't be read. Export again and choose “JSON” as the format.",
      profile: /(?:^|\/)personal_information\.json$/,
    },
    messenger: {
      s: 6,
      prefix: 'fb:',
      name: 'Messenger',
      nobody: 'Facebook user',
      kept: new Set(['inbox', 'archived_threads', 'e2ee_cutover']),
      html: "This is Facebook's HTML export, which can't be read. Export again and choose “JSON” as the format.",
      profile: /(?:^|\/)profile_information\.json$/,
    },
  };
  let app = APPS.instagram;

  const BATCH_SIZE = 5000;
  const MEDIA_KIND = { photos: 'ph', videos: 'vd', audio_files: 'au', gifs: 'gf', files: 'ot' };
  const THREAD_RE = /(?:^|\/)messages\/([^/]+)\/([^/]+)\/message_\d+\.json$/;
  // English only, like the exports' own wording.
  const REACTION_RE = /^(?:Liked a message|Reacted .{1,16}? to your message)\s*$/u;
  const CALL_END_RE = /^(?:Video chat|Audio call|Video call) ended$/;
  // What follows the actor's name ("You" or the sender) in a notice that isn't a message.
  const NOTICE_RE = /^(?:(?:started|missed|joined) (?:a video chat|an audio call|a video call|the video chat|the call)|named the group .+|changed the group (?:photo|name)\b.*|added .+ to the group\.?|removed .+ from the group\.?|left the group\.?|set the nickname for .+|set (?:your|his|her|their) own nickname to .+|cleared the nickname for .+|changed the (?:chat )?theme\b.*|set the (?:quick reaction|emoji) to .+|sent an attachment\.|sent an? (?:photo|video|GIF|sticker|voice message|audio clip|link)\.)$/;
  // Notices that stand in for an attachment or a share: the message stays if something is behind them.
  const PLACEHOLDER_RE = /^sent an? (?:attachment|photo|video|GIF|sticker|voice message|audio clip|link)\.$/;
  const OLD_NOTICE_TYPES = new Set(['Call', 'Subscribe', 'Unsubscribe']); // older exports mark these
  const EXT_KIND = [
    [/\.(?:jpe?g|png|heic|heif|webp|bmp)$/i, 'ph'],
    [/\.gif$/i, 'gf'],
    [/\.(?:mp4|mov|m4v|webm|3gp|avi)$/i, 'vd'],
    [/\.(?:m4a|aac|mp3|ogg|oga|opus|wav|amr)$/i, 'au'],
  ];

  const isZip = (f) => /\.zip$/i.test(f.name) || /zip/.test(f.type);
  const baseName = (p) => p.replace(/^.*\//, '');
  const dirName = (p) => p.replace(/[^/]*$/, '');
  /** A path from its "messages/" folder on: DYI attachment uris are relative to the export root. */
  const tailOf = (p) => { const m = /(?:^|\/)(messages\/.+)$/.exec(p); return m ? m[1] : p; };
  /** The link if it's http(s), else '': it ends up in an href. */
  const webLink = (s) => { try { return /^https?:$/.test(new URL(s).protocol) ? s : ''; } catch { return ''; } };
  const str = (v) => (typeof v === 'string' ? v : '');
  const kindOfFile = (name) => (EXT_KIND.find(([re]) => re.test(name)) || [, 'ot'])[1];

  const utf8 = new TextDecoder('utf-8', { fatal: true });
  function fixText(s) {
    if (!/[\u0080-ÿ]/.test(s) || /[^\u0000-ÿ]/.test(s)) return s;
    try {
      return utf8.decode(Uint8Array.from(s, (c) => c.charCodeAt(0)));
    } catch {
      return s; // real Latin-1 text, not escaped UTF-8
    }
  }
  /** Every string in DYI data decoded again (R4). */
  function fixAll(v) {
    if (typeof v === 'string') return fixText(v);
    if (Array.isArray(v)) return v.map(fixAll);
    if (v && typeof v === 'object') {
      const out = {};
      for (const k of Object.keys(v)) out[k] = fixAll(v[k]);
      return out;
    }
    return v;
  }
  /** A thread from the encrypted chats download, rather than DYI. */
  const isEncrypted = (data) => !!data && typeof data.threadName === 'string' && Array.isArray(data.messages);

  /** The notice part of `text` if it's "<You | sender> <notice>", else ''. */
  function noticeOf(text, sender) {
    const rest = text.startsWith('You ') ? text.slice(4) : sender && text.startsWith(sender + ' ') ? text.slice(sender.length + 1) : '';
    return NOTICE_RE.test(rest) ? rest : '';
  }

  const contacts = contactMap();
  const counts = { instagram: 0, messenger: 0, skipped: 0, skippedChats: 0, reactions: 0 };
  const skippedThreads = new Set();
  const senders = new Set();
  const ownerNames = []; // from the profile file
  const needChats = new Set(); // zips that are only .json files: at least one has to be a chat
  let msgBatch = [];

  function flush() {
    if (msgBatch.length) {
      self.postMessage({ type: 'batch', msgs: msgBatch, calls: [], found: contacts.takeFresh() });
      msgBatch = [];
    }
  }

  /**
   * Every thread file in the files ({ label, size, read(), path }), zip entries by DYI
   * tail path and by full path, and which files are the encrypted chats download.
   */
  async function findThreads(files) {
    const out = [];
    const byTail = new Map();
    const byPath = new Map();
    needChats.clear();
    for (let z = 0; z < files.length; z++) {
      const file = files[z];
      if (!isZip(file)) {
        out.push({ label: file.name, size: file.size, read: () => file.text(), path: '' });
        continue;
      }
      const entries = (await listZip(file)).filter((e) => !e.name.endsWith('/'));
      let found = false;
      for (const e of entries) {
        e.z = z; // which file it's in, so the page can load it later
        byTail.set(tailOf(e.name), e);
        byPath.set(e.name, e);
        if (THREAD_RE.test(e.name)) {
          out.push({ label: file.name, size: e.csize, read: () => readEntryText(e), path: e.name });
          found = true;
        } else if (app.profile.test(e.name)) {
          readOwner(fixAll(JSON.parse(await readEntryText(e))));
        }
      }
      if (found) continue;
      if (entries.some((e) => /(?:^|\/)message_\d+\.html$/.test(e.name))) throw new Error(app.html);
      // A split export's other parts may hold only media, or only your profile.
      const part = entries.some((e) => /(?:^|\/)(?:messages\/|personal_information\/|your_(?:instagram|facebook)_activity\/)/.test(e.name));
      // Messenger's encrypted chats download: a .json per chat, with media/ beside them, in a
      // folder or not. Which .json files are chats is only known once they're read.
      const chats = app === APPS.messenger ? entries.filter((e) => /\.json$/i.test(e.name) && !app.profile.test(e.name)) : [];
      for (const e of chats) out.push({ label: file.name, size: e.csize, read: () => readEntryText(e), path: e.name, chat: z });
      if (!part && !chats.length) throw new Error(`${file.name} has no ${app.name} messages inside`);
      if (!part) needChats.add(z);
    }
    return { threads: out, byTail, byPath };
  }

  /** Your name from the profile file: Instagram's name and username, or Facebook's full name. */
  function readOwner(data) {
    const info = data && Array.isArray(data.profile_user) && data.profile_user[0] && data.profile_user[0].string_map_data;
    if (info) for (const field of ['Name', 'Username']) if (info[field] && info[field].value) ownerNames.push(info[field].value);
    const fb = data && (data.profile_v2 || data.profile);
    if (fb && fb.name && fb.name.full_name) ownerNames.push(fb.name.full_name);
  }

  function contactFor(key, title, group) {
    let c = contacts.get(key);
    if (!c) contacts.set(key, (c = { key, name: title, addr: '', group, lastT: 0, s: app.s, title, members: [] }));
    return c;
  }

  /** Count `rec` as a message of conversation `c`. */
  function keep(rec, text, sender, c, members) {
    analyzeText(text, rec);
    if (REACTION_RE.test(text)) { rec.f = T_REACTION; counts.reactions++; }
    stampTime(rec);
    if (rec.t > c.lastT) c.lastT = rec.t;
    senders.add(sender);
    members.set(sender, (members.get(sender) || 0) + 1);
    counts[app === APPS.messenger ? 'messenger' : 'instagram']++;
    msgBatch.push(rec);
    if (msgBatch.length >= BATCH_SIZE) flush();
  }

  function parseThread(data, src, byTail) {
    if (!data || !Array.isArray(data.messages)) throw new Error(`${src.label} doesn't look like an ${app.name} export (no messages in it)`);
    const fromPath = THREAD_RE.exec(src.path);
    // "inbox/<name>_<id>", or the same from the export's root ("your_facebook_activity/messages/inbox/…").
    const threadPath = String(data.thread_path || (fromPath ? `${fromPath[1]}/${fromPath[2]}` : '') || data.title || 'unknown').replace(/^(?:.*\/)?messages\//, '');
    const slash = threadPath.lastIndexOf('/');
    const folder = slash >= 0 ? threadPath.slice(0, slash) : 'inbox';
    const id = threadPath.slice(slash + 1);
    if (!app.kept.has(folder)) {
      if (!skippedThreads.has(threadPath)) { skippedThreads.add(threadPath); counts.skippedChats++; }
      return;
    }

    const participants = (data.participants || []).map((p) => p && p.name).filter(Boolean);
    const group = participants.length > 2;
    const c = contactFor((group ? 'g:' : '') + app.prefix + id, data.title || participants.join(', ') || app.nobody, group);
    const members = new Map(c.members);

    for (const m of data.messages) {
      const t = +m.timestamp_ms;
      const sender = m.sender_name || app.nobody;
      let text = typeof m.content === 'string' ? m.content : '';
      if (!t || m.is_unsent === true || OLD_NOTICE_TYPES.has(m.type) || m.call_duration != null || CALL_END_RE.test(text)) { counts.skipped++; continue; }
      const notice = noticeOf(text, sender);
      if (notice && !PLACEHOLDER_RE.test(notice)) { counts.skipped++; continue; }
      if (notice) text = ''; // placeholder for an attachment, or a shared post or reel

      const rec = { t, o: 0, m: 0, s: app.s, k: c.key, sn: sender, ph: 0, gf: 0, vd: 0, au: 0, ot: 0, mb: 0 };
      const att = [];
      const media = Object.keys(MEDIA_KIND).flatMap((field) => (Array.isArray(m[field]) ? m[field].map((x) => [MEDIA_KIND[field], x]) : []));
      if (m.sticker) media.push(['ph', m.sticker]);
      for (const [kind, x] of media) {
        rec[kind]++;
        const e = x && x.uri && byTail.get(tailOf(x.uri));
        if (e) {
          rec.mb += e.usize;
          att.push({ n: baseName(e.name), k: kind, t: '', z: e.z, o: e.offset, c: e.csize, u: e.usize, m: e.method, p: e.name });
        }
      }
      if (m.share && typeof m.share === 'object') {
        const s = m.share;
        // A shared profile has its username and display name instead of a creator and caption.
        const sh = { u: webLink(str(s.link)), x: str(s.share_text) || str(s.profile_share_name), w: str(s.original_content_owner) || str(s.profile_share_username) };
        if (sh.u || sh.x || sh.w) rec.sh = sh;
      }
      if (att.length) rec.att = att;
      if (!text && !media.length && !rec.sh) { counts.skipped++; continue; }
      if (Array.isArray(m.reactions)) for (const r of m.reactions) if (r) addReaction(rec, str(r.reaction), 1, [str(r.actor)], [reactionTime(r.timestamp_ms ?? r.timestamp)]);
      keep(rec, text, sender, c, members);
    }
    c.members = [...members];
    c.addr = [...members.keys()].join('~');
    flush();
  }

  /** A chat from Messenger's encrypted chats download (R2). Its media uris are relative to the thread file. */
  function parseEncryptedThread(data, src, byPath) {
    const threadName = data.threadName.trim() || baseName(src.path || src.label).replace(/\.json$/i, '');
    const participants = (Array.isArray(data.participants) ? data.participants : []).map(str).filter(Boolean);
    const title = threadName.replace(/_\d+$/, '') || participants.join(', ') || app.nobody;
    const c = contactFor(app.prefix + 'e2ee:' + threadName, title, false);
    const members = new Map(c.members);
    // Everyone in the chat, even with nothing sent: you're the one it isn't named after, and
    // a chat where only they wrote mustn't make them you.
    for (const p of participants) if (!members.has(p)) members.set(p, 0);
    const dir = dirName(src.path);

    for (const m of data.messages) {
      if (!m || typeof m !== 'object') continue;
      const t = +m.timestamp;
      const sender = str(m.senderName) || app.nobody;
      let text = str(m.text);
      if (!t || m.isUnsent === true || CALL_END_RE.test(text)) { counts.skipped++; continue; }
      const notice = noticeOf(text, sender);
      if (notice && !PLACEHOLDER_RE.test(notice)) { counts.skipped++; continue; }
      if (notice) text = '';

      const rec = { t, o: 0, m: 0, s: app.s, k: c.key, sn: sender, ph: 0, gf: 0, vd: 0, au: 0, ot: 0, mb: 0 };
      const media = (Array.isArray(m.media) ? m.media : []).filter((x) => x && typeof x === 'object');
      const att = [];
      for (const x of media) {
        const uri = str(x.uri);
        const kind = kindOfFile(uri);
        rec[kind]++;
        const e = uri && byPath.get(dir + uri.replace(/^\.\//, ''));
        if (e) {
          rec.mb += e.usize;
          att.push({ n: baseName(e.name), k: kind, t: '', z: e.z, o: e.offset, c: e.csize, u: e.usize, m: e.method, p: e.name });
        }
      }
      if (att.length) rec.att = att;
      if (!text && !media.length) { counts.skipped++; continue; }
      if (Array.isArray(m.reactions)) for (const r of m.reactions) if (r) addReaction(rec, str(r.reaction), 1, [str(r.actor)], [reactionTime(r.timestamp_ms ?? r.timestamp)]);
      keep(rec, text, sender, c, members);
    }
    c.members = [...members];
    c.addr = [...members.keys()].join('~');
    flush();
  }

  async function parseFiles(files) {
    const { threads, byTail, byPath } = await findThreads(files);
    const total = threads.reduce((s, x) => s + x.size, 0) || 1;
    let loaded = 0;
    for (const src of threads) {
      let data;
      try {
        data = JSON.parse(await src.read());
      } catch (err) {
        throw new Error(`${src.label} isn't valid JSON, so it can't be an ${app.name} export`);
      }
      if (app === APPS.messenger && isEncrypted(data)) {
        parseEncryptedThread(data, src, byPath);
        needChats.delete(src.chat);
      } else if (src.chat == null) parseThread(fixAll(data), src, byTail);
      // else: a .json in a zip that isn't a chat (some other part of an export)
      loaded += src.size;
      self.postMessage({ type: 'progress', loaded, total });
    }
    const empty = [...needChats][0];
    if (empty != null) throw new Error(`${files[empty].name} has no ${app.name} messages inside`);

    // Messages show your display name, or your username when you have none.
    const owner = ownerNames.find((n) => senders.has(n));
    if (owner) for (const c of contacts.values()) c.owner = owner;
  }

  self.onmessage = async (e) => {
    try {
      app = APPS[e.data.app] || APPS.instagram;
      await parseFiles(e.data.files);
      flush();
      self.postMessage({ type: 'done', contacts: [...contacts.values()], counts });
    } catch (err) {
      self.postMessage({ type: 'error', message: String((err && err.message) || err) });
    }
  };
}

/** Parse Instagram exports (zips, or message_N.json files) together in one worker. */
function parseInstagramFiles(files, callbacks) {
  return runParserWorker(metaParserWorker, { files: [...files], app: 'instagram' }, callbacks);
}

/** Parse Messenger exports (Facebook DYI zips or message_N.json files, and encrypted chats downloads) together in one worker. */
function parseMessengerFiles(files, callbacks) {
  return runParserWorker(metaParserWorker, { files: [...files], app: 'messenger' }, callbacks);
}
