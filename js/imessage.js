/*
 * Parser for iMessage exports made with imessage-exporter
 * (https://github.com/ReagentX/imessage-exporter), txt format: `imessage-exporter -f txt`.
 *
 * The export is one .txt per conversation, named after the group ("Book Club - 42.txt",
 * the number is the chat id) or its participants ("Alex Rivera.txt",
 * "+15551234567, Jordan Lee.txt"), plus orphaned.txt for messages with no chat.
 * Each message is a block:
 *
 *   May 17, 2022  5:29:42 PM (Read by them after 1 hour, 49 seconds)
 *   Me
 *   Hello world
 *   Tapbacks:
 *       Loved by Sample Contact
 *       May 17, 2022  5:31:00 PM          <- thread replies are repeated here, indented,
 *       Sample Contact                       and also appear at the top level
 *       reply text
 *
 * and announcements are a single line ("May 17, 2022  5:29:42 PM You named the
 * conversation …"). Times are the exporting Mac's local time. Your own messages are
 * from "Me" unless the export used --custom-name / --use-caller-id, so like WhatsApp
 * every record carries its sender in `sn` and the page sets `o` (see guessOwner in app.js).
 *
 * Like the other workers, this function is serialized into a Blob and must be
 * self-contained.
 */
function iMessageParserWorker(self, lib) {
  'use strict';

  const { analyzeText, stampTime, listZip, readEntryText, contactMap } = lib;

  const BATCH_SIZE = 5000;
  const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
  // chrono "%b %d, %Y %l:%M:%S %p": "May 07, 2022  5:29:42 PM" (hour is space-padded)
  const TS_RE = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{2}), (\d{4}) {1,2}(\d{1,2}):(\d{2}):(\d{2}) ([AP]M)(.*)$/;
  const GROUP_HINT_RE = /\b(?:the conversation|group photo)\b/;

  const PHOTO_EXT = new Set(['heic', 'heif', 'jpg', 'jpeg', 'png', 'webp', 'bmp', 'tif', 'tiff']);
  const VIDEO_EXT = new Set(['mov', 'mp4', 'm4v', '3gp', 'avi', 'webm']);
  const AUDIO_EXT = new Set(['caf', 'm4a', 'amr', 'mp3', 'aac', 'wav', 'opus', 'ogg']);

  function fileKind(path) {
    const dot = path.lastIndexOf('.');
    const ext = dot >= 0 ? path.slice(dot + 1).toLowerCase() : '';
    if (ext === 'gif') return 'gf';
    if (PHOTO_EXT.has(ext)) return 'ph';
    if (VIDEO_EXT.has(ext)) return 'vd';
    if (AUDIO_EXT.has(ext)) return 'au';
    return 'ot';
  }

  // An attachment line is its embed path: the original file under ~/Library/Messages
  // or Library/SMS (attachments not copied) or the copy under the export's attachments/ folder.
  const ATTACHMENT_RE = /^(?:attachments[\\/]|(?:~?\/|[A-Za-z]:\\).*(?:Library\/(?:Messages|SMS)\/|[\\/]attachments[\\/])).*\.[A-Za-z0-9]{2,5}$/;
  const STICKER_RE = /^(?:[A-Z][a-z]+ )?Sticker from .+?(?:: (.+)| not found!)$/;
  const EXPRESSIVE_RE = /^Sent with (?:Slam|Loud|Gentle|Invisible Ink|Confetti|Echo|Fireworks|Balloons|Heart|Love|Lasers|Shooting Star|Sparkles|Spotlight|Celebration)$/;
  const DROP_LINES = new Set([
    'This message responded to an earlier message.',
    'This message was deleted from the conversation!',
    'Started sharing location!',
    'Stopped sharing location!',
    'SharePlay Message',
    'Ended',
  ]);
  const EDIT_FIRST_RE = /^\d{1,2}:\d{2}:\d{2} [AP]M (.*)$/;
  const EDIT_NEXT_RE = /^Edited .+? later: (.*)$/;

  function stampOf(m) {
    let h = +m[4] % 12;
    if (m[7] === 'PM') h += 12;
    return new Date(+m[3], MONTHS[m[1]], +m[2], h, +m[5], +m[6]).getTime();
  }

  /** Text, attachment kinds and attachment paths of one message body. */
  function readBody(lines) {
    const out = { text: [], kinds: [], paths: [] };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].replace(/\r$/, '');
      if (/^ {4}/.test(line)) continue; // tapbacks and repeated thread replies
      if (line === 'Tapbacks:' && /^ {4}/.test(lines[i + 1] || '')) continue;
      if (DROP_LINES.has(line) || EXPRESSIVE_RE.test(line) || /^Transcription: /.test(line)) continue;
      if (/ unsent this message part(?: .*)?!$/.test(line)) continue;
      if (line === 'Translated from:') { i++; continue; }
      let m;
      if (line === 'Attachment missing!' || /^Unable to locate attachment: /.test(line)) { out.kinds.push('ot'); continue; }
      if ((m = line.match(STICKER_RE))) { out.kinds.push('ph'); continue; }
      if (ATTACHMENT_RE.test(line)) { out.kinds.push(fileKind(line)); out.paths.push(line); continue; }
      // Edit history: "5:29:42 PM first" then "Edited 30 seconds later: second"; keep the last.
      if ((m = line.match(EDIT_FIRST_RE)) && EDIT_NEXT_RE.test(lines[i + 1] || '')) {
        let last = m[1];
        while (i + 1 < lines.length && (m = lines[i + 1].match(EDIT_NEXT_RE))) { last = m[1]; i++; }
        out.text.push(last);
        continue;
      }
      out.text.push(line);
    }
    return { text: out.text.join('\n').trim(), kinds: out.kinds, paths: out.paths };
  }

  /** Split one conversation file into { stamp, sender, lines } blocks. */
  function parseFile(text) {
    const msgs = [];
    let groupHint = false;
    let cur = null;
    for (const line of text.split('\n')) {
      const m = line.match(TS_RE);
      if (m) {
        const rest = m[8];
        if (rest && !/^ \(Read by /.test(rest)) {
          // Announcement: "May 17, 2022  5:29:42 PM Alex added Sam to the conversation."
          cur = null;
          if (GROUP_HINT_RE.test(rest)) groupHint = true;
          continue;
        }
        cur = { stamp: stampOf(m), sender: null, lines: [] };
        msgs.push(cur);
      } else if (cur) {
        if (cur.sender === null) cur.sender = line.replace(/\r$/, '').trim();
        else cur.lines.push(line);
      }
    }
    return { msgs, groupHint };
  }

  const norm = (s) => String(s || '').replace(/\s/g, '').toLowerCase();

  /** Conversation title and whether the file name alone marks it as a group. */
  function describeFile(name) {
    const base = name.replace(/^.*[\\/]/, '').replace(/\.txt$/i, '');
    const named = base.match(/^(.+) - (\d+)$/); // named group chat: "<name> - <chat id>"
    if (named) return { id: base, title: named[1], group: true };
    return { id: base, title: base, group: base.includes(', ') };
  }

  const contacts = contactMap();
  const counts = { imessage: 0, skipped: 0, files: 0 };
  let msgBatch = [];

  function flush() {
    if (msgBatch.length) {
      self.postMessage({ type: 'batch', msgs: msgBatch, calls: [], found: contacts.takeFresh() });
      msgBatch = [];
    }
  }

  /** Expand the input into { name, size, text(), sizes } conversation sources. */
  async function sources(files) {
    const out = [];
    for (const file of files) {
      if (!/\.zip$/i.test(file.name) && !/zip/.test(file.type)) {
        out.push({ name: file.name, size: file.size, text: () => file.text(), sizes: null });
        continue;
      }
      // A zipped export folder: every .txt is a conversation, attachments/ gives sizes.
      const entries = (await listZip(file)).filter((e) => !e.name.endsWith('/'));
      const sizes = new Map();
      for (const e of entries) {
        const i = e.name.lastIndexOf('attachments/');
        if (i >= 0) sizes.set(e.name.slice(i), e.usize);
      }
      for (const e of entries) {
        if (/\.txt$/i.test(e.name)) out.push({ name: e.name, size: e.csize, text: () => readEntryText(e), sizes });
      }
    }
    return out;
  }

  async function parseFiles(files) {
    const list = (await sources(files)).filter((src) => !/(?:^|[\\/])orphaned\.txt$/i.test(src.name));
    const total = list.reduce((s, x) => s + x.size, 0) || 1;
    let loaded = 0;
    for (const src of list) {
      const { msgs, groupHint } = parseFile((await src.text()).replace(/^﻿/, ''));
      loaded += src.size;
      if (!msgs.length) { self.postMessage({ type: 'progress', loaded, total }); continue; }
      counts.files++;

      const desc = describeFile(src.name);
      const kept = [];
      for (const m of msgs) {
        const body = readBody(m.lines);
        if (!m.sender || (!body.text && !body.kinds.length)) { counts.skipped++; continue; }
        kept.push({ stamp: m.stamp, sender: m.sender, body });
      }
      const members = new Map();
      for (const m of kept) members.set(m.sender, (members.get(m.sender) || 0) + 1);
      const group = desc.group || groupHint || members.size > 2;
      const key = (group ? 'g:im:' : 'im:') + norm(desc.id);
      let c = contacts.get(key);
      if (!c) contacts.set(key, (c = { key, name: desc.title, addr: '', group, lastT: 0, s: 3, title: desc.title, members: [] }));
      const all = new Map(c.members);
      for (const [n, k] of members) all.set(n, Math.max(all.get(n) || 0, k));
      c.members = [...all];
      c.addr = [...all.keys()].join('~');

      // Same-second messages get +n ms so order is kept and re-imports dedupe.
      let lastStamp = 0, n = 0;
      for (const m of kept) {
        n = m.stamp === lastStamp ? n + 1 : 0;
        lastStamp = m.stamp;
        const rec = { t: m.stamp + n, o: 0, m: 0, s: 3, k: key, sn: m.sender, ph: 0, gf: 0, vd: 0, au: 0, ot: 0, mb: 0 };
        for (const kind of m.body.kinds) rec[kind]++;
        if (src.sizes) {
          for (const p of m.body.paths) {
            const i = p.lastIndexOf('attachments/');
            if (i >= 0) rec.mb += src.sizes.get(p.slice(i)) || 0;
          }
        }
        analyzeText(m.body.text, rec);
        stampTime(rec);
        if (rec.t > c.lastT) c.lastT = rec.t;
        counts.imessage++;
        msgBatch.push(rec);
        if (msgBatch.length >= BATCH_SIZE) flush();
      }
      flush();
      self.postMessage({ type: 'progress', loaded, total });
    }
    if (!counts.files) throw new Error('No iMessage conversations found. Export with `imessage-exporter -f txt` and pick the .txt files (or a zip of the export folder).');
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

/** Parse imessage-exporter txt files (or zipped export folders) together in one worker. */
function parseIMessageFiles(files, callbacks) {
  return runParserWorker(iMessageParserWorker, { files: [...files] }, callbacks);
}
