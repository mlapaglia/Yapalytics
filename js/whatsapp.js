/*
 * Parser for WhatsApp "Export chat" files. Each export is one conversation:
 *   Android: "WhatsApp Chat with Alice.txt", or a .zip holding that .txt plus media
 *   iOS:     "WhatsApp Chat - Alice.zip" holding "_chat.txt" plus media
 *
 * Message lines look like
 *   Android: "1/3/25, 7:22 PM - Alice: hi"         (date order and clock follow the phone's locale)
 *   iOS:     "[03/01/2025, 19:22:10] Alice: hi"
 * and lines without that header continue the previous message. Lines with no
 * "Name: " are system notices; on iOS, system notices and attachments start with U+200E.
 *
 * Exports don't say which participant is you, so every record carries its sender in
 * `sn` and is emitted with o = 0; the page works out the owner (see guessWaOwner in
 * app.js) and sets `o`. Timestamps only have minute (Android) or second (iOS)
 * precision, so the nth message within the same stamp gets +n ms: order is kept and
 * re-importing an overlapping export dedupes cleanly.
 *
 * Like the other workers, this function is serialized into a Blob and must be
 * self-contained.
 */
function whatsAppParserWorker(self, lib) {
  'use strict';

  const { analyzeText, stampTime, listZip, readEntryText, contactMap } = lib;

  const BATCH_SIZE = 5000;

  // Date parts, time, optional AM/PM ("PM", "p.m.", "p. m."), then "] " (iOS) or " - " (Android).
  const HEAD_RE = /^\[?(\d{1,4})[./-](\d{1,2})[./-](\d{1,4})\.?,? (\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?(?: ?([AaPp])\.? ?[Mm]\.?)?(?:\] | [-–] )([\s\S]*)$/;
  const BIDI_RE = /[‎‏‪-‮⁦-⁩]/g;
  // A "sender" containing these words is really a system notice whose text had a colon.
  const SYSTEM_SENDER_RE = / (?:changed|created|added|removed|left|joined|deleted|turned|pinned|started|ended|updated|reset|blocked|unblocked|invited)\b|Messages and calls/;
  const GROUP_HINT_RE = /\b(?:created (?:the )?group|added|removed|left|joined using|changed the group|changed this group|changed the subject|group's)\b/i;
  const OMITTED_RE = /^(image|video|audio|GIF|sticker|document|Contact card)\b.*\bomitted$|^.*\bdocument omitted$/i;
  const DELETED_RE = /^(?:This message was deleted|You deleted this message)\.?$/;
  const EDITED_RE = /\s*‎?<This message was edited>$/;

  const PHOTO_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'bmp']);
  const VIDEO_EXT = new Set(['mp4', 'mov', '3gp', 'webm', 'mkv', 'avi', 'm4v']);
  const AUDIO_EXT = new Set(['opus', 'ogg', 'mp3', 'm4a', 'aac', 'wav', 'amr']);
  const OMITTED_KIND = { image: 'ph', video: 'vd', audio: 'au', gif: 'gf', sticker: 'ph' };

  function fileKind(name) {
    const dot = name.lastIndexOf('.');
    const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
    if (ext === 'gif' || /-GIF-/.test(name)) return 'gf';
    if (PHOTO_EXT.has(ext)) return 'ph';
    if (VIDEO_EXT.has(ext)) return 'vd';
    if (AUDIO_EXT.has(ext)) return 'au';
    return 'ot';
  }

  const norm = (s) => String(s || '').replace(BIDI_RE, '').replace(/[\s~]/g, '').toLowerCase();
  const cleanSender = (s) => s.replace(BIDI_RE, '').replace(/^~\s*/, '').trim();

  /** "WhatsApp Chat with Alice.txt", "WhatsApp Chat - Alice.zip" (+ a few translations) -> "Alice". */
  function titleFromFileName(name) {
    const base = name.replace(/^.*\//, '').replace(/\.(txt|zip)$/i, '').replace(/\s*\(\d+\)$/, '').trim();
    const m = base.match(/^WhatsApp[ -]Chat\s+(?:with|-|mit|con|com|avec|met|med|z)\s+(.+)$/i) ||
      base.match(/^(?:Chat de WhatsApp con|Conversa do WhatsApp com|Discussion WhatsApp avec|Chat WhatsApp con)\s+(.+)$/i);
    return m ? m[1].trim() : '';
  }

  /** Split an export into raw messages. */
  function parseChat(text) {
    const msgs = [];
    const chat = { msgs, groupHint: false, sysTitle: '' };
    let cur = null;
    const finish = () => {
      if (!cur) return;
      const rest = cur.rest.join('\n').replace(/\s+$/, '');
      cur.rest = null;
      const colon = rest.indexOf(': ');
      const sender = colon > 0 ? cleanSender(rest.slice(0, colon)) : '';
      if (!sender || SYSTEM_SENDER_RE.test(sender)) {
        cur.system = true;
        if (GROUP_HINT_RE.test(rest)) chat.groupHint = true;
      } else {
        cur.sender = sender;
        cur.body = rest.slice(colon + 2);
      }
      msgs.push(cur);
      cur = null;
    };
    for (let line of text.split(/\r?\n/)) {
      line = line.replace(/[  ]/g, ' ');
      const m = line.replace(/^[﻿‎‏]+/, '').match(HEAD_RE);
      if (m) {
        finish();
        cur = { a: m[1], b: m[2], c: m[3], h: +m[4], mi: +m[5], sec: +(m[6] || 0), ap: m[7] || '', rest: [m[8]] };
      } else if (cur) {
        cur.rest.push(line);
      }
    }
    finish();
    return chat;
  }

  /** Which of the date parts is the day / month / year: 'dmy', 'mdy', 'ymd', or null if unclear. */
  function dateOrder(msgs) {
    let firstBig = false, secondBig = false;
    for (const m of msgs) {
      if (m.a.length === 4) return 'ymd';
      if (+m.a > 12) firstBig = true;
      if (+m.b > 12) secondBig = true;
    }
    if (firstBig && !secondBig) return 'dmy';
    if (secondBig && !firstBig) return 'mdy';
    return null;
  }

  function stampOf(m, order) {
    const [d, mo, y] = order === 'ymd' ? [+m.c, +m.b, +m.a] : order === 'mdy' ? [+m.b, +m.a, +m.c] : [+m.a, +m.b, +m.c];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return 0;
    const h = m.ap ? (m.h % 12) + (/p/i.test(m.ap) ? 12 : 0) : m.h;
    return new Date(y < 100 ? 2000 + y : y, mo - 1, d, h, m.mi, m.sec).getTime();
  }

  /** Text, attachment kinds and attachment file names of one message body. */
  function readBody(body) {
    body = body.replace(EDITED_RE, '');
    const out = { text: '', kinds: [], files: [], skip: false };
    if (DELETED_RE.test(body) || body === 'null') { out.skip = true; return out; }
    const lines = body.split('\n');
    const first = lines[0];
    const bare = first.replace(BIDI_RE, '').trim();
    let m;
    if ((m = bare.match(/^<attached: (.+)>$/))) {
      out.files.push(m[1]);
      out.kinds.push(fileKind(m[1]));
    } else if ((m = bare.match(/^(.+\.[A-Za-z0-9]{2,5}) \(file attached\)$/))) {
      out.files.push(m[1]);
      out.kinds.push(fileKind(m[1]));
    } else if (bare === '<Media omitted>') {
      out.kinds.push('ot');
    } else if ((m = bare.match(OMITTED_RE))) {
      out.kinds.push(OMITTED_KIND[(m[1] || 'document').toLowerCase()] || 'ot');
    } else if (/^[‎‏]/.test(first)) {
      out.skip = true; // iOS system notice ("‎Missed voice call", "‎Alice added Bob", …)
      out.system = true;
      return out;
    } else {
      out.text = body;
      return out;
    }
    out.text = lines.slice(1).join('\n').trim(); // caption after the attachment line
    return out;
  }

  const contacts = contactMap();
  const counts = { whatsapp: 0, skipped: 0, badDates: 0 };
  let msgBatch = [];

  function flush() {
    if (msgBatch.length) {
      self.postMessage({ type: 'batch', msgs: msgBatch, calls: [], found: contacts.takeFresh() });
      msgBatch = [];
    }
  }

  /** Read the chat text (and attachment sizes, for zips) of one export file. */
  async function readExport(file) {
    if (!/\.zip$/i.test(file.name) && !/zip/.test(file.type)) return { text: await file.text(), sizes: new Map(), title: titleFromFileName(file.name) };
    const entries = (await listZip(file)).filter((e) => !e.name.endsWith('/'));
    const chatEntry =
      entries.find((e) => /(?:^|\/)_chat\.txt$/.test(e.name)) ||
      entries.find((e) => /(?:^|\/)WhatsApp[^/]*\.txt$/i.test(e.name)) ||
      (entries.filter((e) => /\.txt$/i.test(e.name) && !e.name.includes('/')).length === 1 ? entries.find((e) => /\.txt$/i.test(e.name) && !e.name.includes('/')) : null);
    if (!chatEntry) throw new Error(`${file.name} has no WhatsApp chat (.txt) inside`);
    const sizes = new Map(entries.map((e) => [e.name.replace(/^.*\//, ''), e.usize]));
    const title = titleFromFileName(chatEntry.name) || titleFromFileName(file.name);
    return { text: await readEntryText(chatEntry), sizes, title };
  }

  async function parseFiles(files, locale) {
    // Pass 1: read every export, so an ambiguous date order (all days <= 12) can be
    // settled by the other files before falling back to the browser's locale.
    const chats = [];
    const total = files.reduce((s, f) => s + f.size, 0) || 1;
    let loaded = 0;
    for (const file of files) {
      const { text, sizes, title } = await readExport(file);
      const chat = parseChat(text.replace(/^﻿/, ''));
      if (!chat.msgs.length) throw new Error(`${file.name} doesn't look like a WhatsApp chat export`);
      chat.sizes = sizes;
      chat.title = title;
      chat.fileName = file.name;
      chat.order = dateOrder(chat.msgs);
      chats.push(chat);
      loaded += file.size;
      self.postMessage({ type: 'progress', loaded: loaded / 2, total });
    }
    const votes = { dmy: 0, mdy: 0, ymd: 0 };
    for (const c of chats) if (c.order) votes[c.order]++;
    const best = Object.keys(votes).sort((x, y) => votes[y] - votes[x])[0];
    const fallback = votes[best] ? best : /^en(?:-US|-PH)?$/i.test(locale || '') ? 'mdy' : 'dmy';

    // Pass 2: build records.
    loaded = 0;
    for (const chat of chats) {
      const order = chat.order || fallback;
      const kept = [];
      for (const m of chat.msgs) {
        if (m.system) { counts.skipped++; continue; }
        const body = readBody(m.body);
        if (body.system && !chat.sysTitle) chat.sysTitle = m.sender; // iOS notices are "sent" by the chat itself
        if (body.system && GROUP_HINT_RE.test(m.body)) chat.groupHint = true;
        if (body.skip || (!body.text && !body.kinds.length)) { counts.skipped++; continue; }
        const stamp = stampOf(m, order);
        if (!stamp) { counts.skipped++; counts.badDates++; continue; }
        kept.push({ stamp, sender: m.sender, body });
      }

      const title = chat.title || chat.sysTitle || chat.fileName.replace(/\.(txt|zip)$/i, '');
      const members = new Map();
      for (const m of kept) members.set(m.sender, (members.get(m.sender) || 0) + 1);
      const titleIsMember = [...members.keys()].some((n) => norm(n) === norm(title));
      const group = chat.groupHint || members.size > 2 || (members.size === 2 && !titleIsMember);
      const key = (group ? 'g:wa:' : 'wa:') + norm(title);
      let c = contacts.get(key);
      if (!c) contacts.set(key, (c = { key, name: title, addr: '', group, lastT: 0, s: 2, title, members: [] }));
      const all = new Map(c.members);
      for (const [n, k] of members) all.set(n, Math.max(all.get(n) || 0, k));
      c.members = [...all];
      c.addr = [...all.keys()].join('~');

      let lastStamp = 0, n = 0;
      for (const m of kept) {
        n = m.stamp === lastStamp ? n + 1 : 0;
        lastStamp = m.stamp;
        const rec = { t: m.stamp + n, o: 0, m: 0, s: 2, k: key, sn: m.sender, ph: 0, gf: 0, vd: 0, au: 0, ot: 0, mb: 0 };
        for (const kind of m.body.kinds) rec[kind]++;
        for (const f of m.body.files) rec.mb += chat.sizes.get(f) || 0;
        analyzeText(m.body.text, rec);
        stampTime(rec);
        if (rec.t > c.lastT) c.lastT = rec.t;
        counts.whatsapp++;
        msgBatch.push(rec);
        if (msgBatch.length >= BATCH_SIZE) flush();
      }
      flush();
      loaded += 1;
      self.postMessage({ type: 'progress', loaded: total / 2 + (loaded / chats.length) * (total / 2), total });
    }
  }

  self.onmessage = async (e) => {
    try {
      await parseFiles(e.data.files, e.data.locale);
      flush();
      self.postMessage({ type: 'done', contacts: [...contacts.values()], counts });
    } catch (err) {
      self.postMessage({ type: 'error', message: String((err && err.message) || err) });
    }
  };
}

/** Parse WhatsApp chat exports (.txt or .zip) together in one worker. */
function parseWhatsAppFiles(files, callbacks) {
  return runParserWorker(whatsAppParserWorker, { files: [...files], locale: navigator.language }, callbacks);
}
