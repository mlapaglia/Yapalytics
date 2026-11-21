/*
 * Parser for Google Chat exports from Google Takeout (takeout-*.zip).
 *
 * Layout inside the zip (a large export is split into several zips; a conversation's
 * files can land in different parts, so all parts are indexed together):
 *   Takeout/Google Chat/Users/User <id>/user_info.json   { user: { name, email } }
 *   Takeout/Google Chat/Groups/<DM id | Space id>/group_info.json   { name?, members: [...] }
 *   Takeout/Google Chat/Groups/<DM id | Space id>/messages.json     { messages: [...] }
 *   Takeout/Google Chat/Groups/<DM id | Space id>/File-*             attachments
 *
 * Like smsParserWorker, the worker function is serialized into a Blob, so it must be
 * self-contained. Only the JSON entries are inflated (see zip.js); attachment sizes
 * come straight from the zip's central directory, so multi-GB exports load quickly.
 */
function googleChatParserWorker(self, lib) {
  'use strict';

  const { analyzeText, stampTime, addReaction, listZip, readEntryText } = lib;

  const BATCH_SIZE = 5000;

  // ---------------------------------------------------------------- dates

  // "Tuesday, August 20, 2024 at 12:00:22 PM UTC" (U+202F before PM), plus the
  // day-first "Tuesday, 7 February 2021 at 17:13:43 UTC" form.
  const DATE_RE = /^(?:[A-Za-z]+,?\s+)?(?:([A-Za-z]+)\.?\s+(\d{1,2})|(\d{1,2})\s+([A-Za-z]+)\.?),?\s+(\d{4})(?:\s+at|,)?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(?:([AaPp])\.?[Mm]\.?(?![A-Za-z]))?\s*(.*)$/;
  const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  const ZONES = {
    UTC: 0, GMT: 0, Z: 0, WET: 0, BST: 60, WEST: 60, CET: 60, CEST: 120, EET: 120, EEST: 180,
    EST: -300, EDT: -240, CST: -360, CDT: -300, MST: -420, MDT: -360, PST: -480, PDT: -420,
    AKST: -540, AKDT: -480, HST: -600, JST: 540, KST: 540, AEST: 600, AEDT: 660,
  };

  function zoneOffsetMinutes(z) {
    z = z.replace(/[[\]()]/g, '').trim().toUpperCase();
    if (!z) return 0;
    const m = z.match(/^(?:UTC|GMT)?\s*([+-])(\d{1,2})(?::?(\d{2}))?$/);
    if (m) return (m[1] === '-' ? -1 : 1) * (+m[2] * 60 + (+m[3] || 0));
    return ZONES[z] || 0;
  }

  function parseChatDate(s) {
    if (!s) return 0;
    const m = s.replace(/[  ]/g, ' ').trim().match(DATE_RE);
    if (!m) return 0;
    const monName = (m[1] || m[4]).slice(0, 3).toLowerCase();
    const mon = MONTHS[monName];
    if (mon === undefined) return 0;
    const day = +(m[2] || m[3]);
    let hour = +m[6];
    if (m[9]) hour = (hour % 12) + (m[9].toLowerCase() === 'p' ? 12 : 0);
    const t = Date.UTC(+m[5], mon, day, hour, +m[7], +(m[8] || 0));
    return t - zoneOffsetMinutes(m[10]) * 60000;
  }

  // ---------------------------------------------------------------- record building

  const GROUP_FILE_RE = /(?:^|\/)Google Chat\/Groups\/([^/]+)\/([^/]+)$/;
  const USER_INFO_RE = /(?:^|\/)Google Chat\/Users\/[^/]+\/user_info\.json$/;

  const PHOTO_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'bmp', 'tif', 'tiff']);
  const VIDEO_EXT = new Set(['mp4', 'mov', 'webm', '3gp', 'mkv', 'avi', 'm4v']);
  const AUDIO_EXT = new Set(['mp3', 'm4a', 'aac', 'ogg', 'opus', 'wav', 'amr', 'flac']);

  function mediaKind(name) {
    const dot = name.lastIndexOf('.');
    const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
    if (ext === 'gif') return 'gf';
    if (PHOTO_EXT.has(ext)) return 'ph';
    if (VIDEO_EXT.has(ext)) return 'vd';
    if (AUDIO_EXT.has(ext)) return 'au';
    return 'ot';
  }

  /** Takeout stores the nth repeat of an attachment name as "name(n).ext". */
  function diskName(name, n) {
    name = name.replace(/[?:*"<>|\\]/g, '_');
    if (!n) return name;
    const dot = name.lastIndexOf('.');
    return dot > 0 ? `${name.slice(0, dot)}(${n})${name.slice(dot)}` : `${name}(${n})`;
  }

  async function readEntryJson(e) {
    return JSON.parse(await readEntryText(e));
  }

  const lower = (s) => String(s || '').trim().toLowerCase();
  const personName = (p) => (p && (p.name || p.email)) || '';

  const contacts = new Map(); // key -> { key, name, addr, group, lastT, s }
  const counts = { chat: 0, skipped: 0, badDates: 0 };
  let msgBatch = [];

  function flush() {
    if (msgBatch.length) {
      self.postMessage({ type: 'batch', msgs: msgBatch, calls: [] });
      msgBatch = [];
    }
  }

  function pushMsg(rec) {
    msgBatch.push(rec);
    if (msgBatch.length >= BATCH_SIZE) flush();
  }

  /**
   * Thread key and contact for one Groups/<dir> conversation. Bots (GIPHY in old
   * Hangouts chats) don't count as members: their messages are skipped anyway, and a
   * chat with one other person plus a bot is a 1-on-1. A named space stays a group
   * even with one other person in it.
   */
  function describeGroup(dir, info, owner) {
    const id = dir.slice(dir.indexOf(' ') + 1) || dir;
    const namedSpace = dir.startsWith('Space ') && !!(info && info.name);
    const members = (info && info.members) || [];
    const others = members.filter((p) => p && p.user_type !== 'Bot' && (!owner || lower(p.email) !== owner));
    if (!namedSpace && others.length <= 1) {
      const other = others[0];
      const key = 'gc:' + (lower(other && other.email) || lower(personName(other)) || id);
      return { key, group: false, name: personName(other) || (others.length ? '' : 'Note to self'), addr: (other && other.email) || '' };
    }
    return { key: 'g:gc:' + id, group: true, name: (info && info.name) || '', addr: others.map(personName).filter(Boolean).join('~') };
  }

  function noteContact(g, t) {
    let c = contacts.get(g.key);
    if (!c) {
      c = { key: g.key, name: '', addr: g.addr, group: g.group, lastT: 0, s: 1 };
      contacts.set(g.key, c);
    }
    if (g.name && t >= c.lastT) { c.name = g.name; c.lastT = t; }
    if (!c.addr && g.addr) c.addr = g.addr;
  }

  async function parseZips(files) {
    const groups = new Map(); // dir -> { info, messages, files: Map(name -> size) }
    const userInfos = [];
    const groupOf = (dir) => {
      let g = groups.get(dir);
      if (!g) groups.set(dir, (g = { info: null, messages: null, files: new Map() }));
      return g;
    };

    for (let z = 0; z < files.length; z++) {
      for (const e of await listZip(files[z])) {
        e.z = z; // which of the zips it's in, so the page can load it later
        if (e.name.endsWith('/')) continue;
        if (USER_INFO_RE.test(e.name)) { userInfos.push(e); continue; }
        const m = e.name.match(GROUP_FILE_RE);
        if (!m) continue;
        const g = groupOf(m[1]);
        if (m[2] === 'messages.json') g.messages = e;
        else if (m[2] === 'group_info.json') g.info = e;
        else g.files.set(m[2], e);
      }
    }

    const withMessages = [...groups.entries()].filter(([, g]) => g.messages);
    if (!withMessages.length) throw new Error('No Google Chat data found in this zip. In Google Takeout, select "Google Chat" and export as .zip.');

    // Pass 1: who exported this, and who is in each conversation.
    let owner = '';
    for (const e of userInfos) {
      const u = (await readEntryJson(e)).user;
      if (u && u.email) { owner = lower(u.email); break; }
    }
    for (const [, g] of groups) {
      if (g.info) g.info = await readEntryJson(g.info);
    }
    if (!owner) {
      // Without user_info.json, the owner is the one person in every conversation. A bot
      // can be in every conversation too, so bots can't be the owner.
      let common = null;
      for (const [, g] of groups) {
        const humans = ((g.info && g.info.members) || []).filter((p) => p && p.user_type !== 'Bot');
        const emails = new Set(humans.map((p) => lower(p.email)).filter(Boolean));
        if (!emails.size) continue;
        common = common ? new Set([...common].filter((x) => emails.has(x))) : emails;
      }
      owner = (common && [...common][0]) || '';
    }

    // Pass 2: messages.
    const total = withMessages.reduce((s, [, g]) => s + g.messages.csize, 0) || 1;
    let loaded = 0;
    for (const [dir, g] of withMessages) {
      const data = await readEntryJson(g.messages);
      const messages = (data && data.messages) || [];
      if (!g.info) {
        // No group_info.json in the parts we were given: rebuild members from senders.
        const seen = new Map();
        for (const msg of messages) if (msg.creator) seen.set(lower(msg.creator.email) || msg.creator.name, msg.creator);
        g.info = { members: [...seen.values()] };
      }
      const desc = describeGroup(dir, g.info, owner);
      // Reactors are listed by email: name them from the members, and you as "You".
      const nameOf = new Map(((g.info && g.info.members) || []).map((p) => [lower(p.email), personName(p)]));
      const reactorName = (email) => (owner && lower(email) === owner ? 'You' : nameOf.get(lower(email)) || email);
      const repeats = new Map(); // attachment name -> times seen in this conversation

      for (const msg of messages) {
        const creator = msg.creator;
        if (!creator || msg.message_state === 'DELETED' || !msg.created_date) { counts.skipped++; continue; }
        if (creator.user_type === 'Bot') { counts.skipped++; continue; }
        const t = parseChatDate(msg.created_date);
        if (!t) { counts.skipped++; counts.badDates++; continue; }
        const text = msg.text || '';
        const files = msg.attached_files || [];
        if (!text && !files.length) { counts.skipped++; continue; }

        const o = owner && lower(creator.email) === owner ? 1 : 0;
        const rec = { t, o, m: 0, s: 1, k: desc.key, ph: 0, gf: 0, vd: 0, au: 0, ot: 0, mb: 0 };
        if (desc.group && !o) rec.sn = personName(creator);
        for (const f of files) {
          const name = f.export_name || f.original_name || '';
          const kind = mediaKind(name);
          rec[kind]++;
          const n = repeats.get(name) || 0;
          repeats.set(name, n + 1);
          const e = g.files.get(diskName(name, n));
          // Where the file is, so the message list can show it: zip index, local header offset, sizes, method.
          const att = { n: f.original_name || name, k: kind };
          if (e) {
            rec.mb += e.usize;
            Object.assign(att, { z: e.z, o: e.offset, c: e.csize, u: e.usize, m: e.method, p: e.name });
          }
          (rec.att || (rec.att = [])).push(att);
        }
        if (Array.isArray(msg.reactions)) {
          for (const r of msg.reactions) {
            const e = r && r.emoji;
            const emoji = e && (e.unicode || (e.custom_emoji && e.custom_emoji.name && `:${e.custom_emoji.name}:`));
            const who = Array.isArray(r && r.reactor_emails) ? r.reactor_emails.filter((x) => typeof x === 'string') : [];
            addReaction(rec, typeof emoji === 'string' ? emoji : '', who.length || 1, who.map(reactorName));
          }
        }
        analyzeText(text, rec);
        stampTime(rec);
        noteContact(desc, t);
        counts.chat++;
        pushMsg(rec);
      }

      flush();
      loaded += g.messages.csize;
      self.postMessage({ type: 'progress', loaded, total });
    }
  }

  self.onmessage = async (e) => {
    try {
      await parseZips(e.data.files);
      flush();
      self.postMessage({ type: 'done', contacts: [...contacts.values()], counts });
    } catch (err) {
      self.postMessage({ type: 'error', message: String((err && err.message) || err) });
    }
  };
}

/** Parse Google Takeout zip(s) together in one worker (split exports share one tree). */
function parseGoogleChatZips(files, callbacks) {
  return runParserWorker(googleChatParserWorker, { files: [...files] }, callbacks);
}
