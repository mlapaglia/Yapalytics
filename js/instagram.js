/*
 * Parser for Instagram's "Download your information" export in JSON format. Accepts:
 *   - the export's .zip (or every part of a split export together): each conversation is
 *     [your_instagram_activity/]messages/inbox/<name>_<id>/message_1.json, message_2.json…
 *     with its photos/, videos/ and audio/ beside them, so attachments can be opened;
 *   - message_N.json files on their own: messages are counted, attachments can't be opened.
 *
 * Conversations in inbox/ and archived_threads/ are kept; message_requests/ are skipped.
 * Call notices, group events ("… left the group") and placeholder texts ("… sent an
 * attachment.") aren't messages. "Liked a message" and "Reacted 😂 to your message" are
 * reactions: they're passed on flagged T_REACTION, so the page counts them as reactions.
 * Reactions on a message (its `reactions` field) never count as messages.
 *
 * Meta writes text as UTF-8 bytes escaped one per character ("Ã©" for "é"), so
 * every string is decoded again. Records carry the sender's display name in `sn`, and the
 * page sets `o` from S.owners as for WhatsApp. When the export includes
 * personal_information.json, each contact gets `owner`, your name, as the page's first guess.
 *
 * Like the other workers, this function is serialized into a Blob and must be self-contained.
 */
function instagramParserWorker(self, lib) {
  'use strict';

  const { analyzeText, stampTime, listZip, readEntryText, T_REACTION } = lib;

  const BATCH_SIZE = 5000;
  const KEPT_FOLDERS = new Set(['inbox', 'archived_threads']);
  const MEDIA_KIND = { photos: 'ph', videos: 'vd', audio_files: 'au', gifs: 'gf', files: 'ot' };
  const THREAD_RE = /(?:^|\/)messages\/([^/]+)\/([^/]+)\/message_\d+\.json$/;
  const HTML_EXPORT = "This is Instagram's HTML export, which can't be read. Export again and choose “JSON” as the format.";
  // English only, like the exports' own wording.
  const REACTION_RE = /^(?:Liked a message|Reacted .{1,16}? to your message)\s*$/u;
  const CALL_END_RE = /^(?:Video chat|Audio call|Video call) ended$/;
  // What follows the actor's name ("You" or the sender) in a notice that isn't a message.
  const NOTICE_RE = /^(?:(?:started|missed|joined) (?:a video chat|an audio call|a video call|the video chat|the call)|named the group .+|changed the group (?:photo|name)\b.*|added .+ to the group\.?|removed .+ from the group\.?|left the group\.?|sent an attachment\.)$/;
  const OLD_NOTICE_TYPES = new Set(['Call', 'Subscribe', 'Unsubscribe']); // older exports mark these

  const isZip = (f) => /\.zip$/i.test(f.name) || /zip/.test(f.type);
  const baseName = (p) => p.replace(/^.*\//, '');
  /** A path from its "messages/" folder on: attachment uris are relative to the export root. */
  const tailOf = (p) => { const m = /(?:^|\/)(messages\/.+)$/.exec(p); return m ? m[1] : p; };

  const utf8 = new TextDecoder('utf-8', { fatal: true });
  function fixText(s) {
    if (!/[\u0080-ÿ]/.test(s) || /[^\u0000-ÿ]/.test(s)) return s;
    try {
      return utf8.decode(Uint8Array.from(s, (c) => c.charCodeAt(0)));
    } catch {
      return s; // real Latin-1 text, not escaped UTF-8
    }
  }
  const parseJson = (text) => JSON.parse(text, (k, v) => (typeof v === 'string' ? fixText(v) : v));

  /** The notice part of `text` if it's "<You | sender> <notice>", else ''. */
  function noticeOf(text, sender) {
    const rest = text.startsWith('You ') ? text.slice(4) : sender && text.startsWith(sender + ' ') ? text.slice(sender.length + 1) : '';
    return NOTICE_RE.test(rest) ? rest : '';
  }

  const contacts = new Map();
  const counts = { instagram: 0, skipped: 0, skippedChats: 0, reactions: 0 };
  const skippedThreads = new Set();
  const senders = new Set();
  const ownerNames = []; // from personal_information.json
  let msgBatch = [];

  function flush() {
    if (msgBatch.length) {
      self.postMessage({ type: 'batch', msgs: msgBatch, calls: [] });
      msgBatch = [];
    }
  }

  /** Every message_N.json in the files ({ label, size, read(), path }), and zip entries by tail path. */
  async function findThreads(files) {
    const out = [];
    const byTail = new Map();
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
        if (THREAD_RE.test(e.name)) {
          out.push({ label: file.name, size: e.csize, read: () => readEntryText(e), path: e.name });
          found = true;
        } else if (/(?:^|\/)personal_information\.json$/.test(e.name)) {
          readOwner(parseJson(await readEntryText(e)));
        }
      }
      if (!found && entries.some((e) => /(?:^|\/)message_\d+\.html$/.test(e.name))) throw new Error(HTML_EXPORT);
      // A split export's other parts may hold only media, or only personal_information.
      if (!found && !entries.some((e) => /(?:^|\/)(?:messages\/|personal_information\.json$)/.test(e.name))) {
        throw new Error(`${file.name} has no Instagram messages inside`);
      }
    }
    return { threads: out, byTail };
  }

  /** Your name and username from personal_information.json. */
  function readOwner(data) {
    const info = data && Array.isArray(data.profile_user) && data.profile_user[0] && data.profile_user[0].string_map_data;
    if (!info) return;
    for (const field of ['Name', 'Username']) if (info[field] && info[field].value) ownerNames.push(info[field].value);
  }

  function parseThread(data, src, byTail) {
    if (!data || !Array.isArray(data.messages)) throw new Error(`${src.label} doesn't look like an Instagram export (no messages in it)`);
    const fromPath = THREAD_RE.exec(src.path);
    const threadPath = String(data.thread_path || (fromPath ? `${fromPath[1]}/${fromPath[2]}` : '') || data.title || 'unknown');
    const slash = threadPath.lastIndexOf('/');
    const folder = slash >= 0 ? threadPath.slice(0, slash) : 'inbox';
    const id = threadPath.slice(slash + 1);
    if (!KEPT_FOLDERS.has(folder)) {
      if (!skippedThreads.has(threadPath)) { skippedThreads.add(threadPath); counts.skippedChats++; }
      return;
    }

    const participants = (data.participants || []).map((p) => p && p.name).filter(Boolean);
    const group = participants.length > 2;
    const key = (group ? 'g:ig:' : 'ig:') + id;
    const title = data.title || participants.join(', ') || 'Instagram User';
    let c = contacts.get(key);
    if (!c) contacts.set(key, (c = { key, name: title, addr: '', group, lastT: 0, s: 5, title, members: [] }));
    const members = new Map(c.members);

    for (const m of data.messages) {
      const t = +m.timestamp_ms;
      const sender = m.sender_name || 'Instagram User';
      let text = typeof m.content === 'string' ? m.content : '';
      if (!t || OLD_NOTICE_TYPES.has(m.type) || m.call_duration != null || CALL_END_RE.test(text)) { counts.skipped++; continue; }
      const notice = noticeOf(text, sender);
      if (notice && notice !== 'sent an attachment.') { counts.skipped++; continue; }
      if (notice) text = ''; // placeholder for a shared post or reel

      const rec = { t, o: 0, m: 0, s: 5, k: key, sn: sender, ph: 0, gf: 0, vd: 0, au: 0, ot: 0, mb: 0 };
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
      if (m.share && !text && !media.length) rec.ot++;
      if (att.length) rec.att = att;
      if (!text && !media.length && !rec.ot) { counts.skipped++; continue; }

      analyzeText(text, rec);
      if (REACTION_RE.test(text)) { rec.f = T_REACTION; counts.reactions++; }
      stampTime(rec);
      if (rec.t > c.lastT) c.lastT = rec.t;
      senders.add(sender);
      members.set(sender, (members.get(sender) || 0) + 1);
      counts.instagram++;
      msgBatch.push(rec);
      if (msgBatch.length >= BATCH_SIZE) flush();
    }
    c.members = [...members];
    c.addr = [...members.keys()].join('~');
    flush();
  }

  async function parseFiles(files) {
    const { threads, byTail } = await findThreads(files);
    const total = threads.reduce((s, x) => s + x.size, 0) || 1;
    let loaded = 0;
    for (const src of threads) {
      let data;
      try {
        data = parseJson(await src.read());
      } catch (err) {
        throw new Error(`${src.label} isn't valid JSON, so it can't be an Instagram export`);
      }
      parseThread(data, src, byTail);
      loaded += src.size;
      self.postMessage({ type: 'progress', loaded, total });
    }

    // Messages show your display name, or your username when you have none.
    const owner = ownerNames.find((n) => senders.has(n));
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

/** Parse Instagram exports (zips, or message_N.json files) together in one worker. */
function parseInstagramFiles(files, callbacks) {
  return runParserWorker(instagramParserWorker, { files: [...files] }, callbacks);
}
