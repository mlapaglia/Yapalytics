/* UI wiring: file loading, filters, KPIs, chart rendering, message browser. */

const S = {
  msgs: [],
  calls: [],
  contacts: new Map(), // key -> { key, name, addr, group, lastT, s, label }
  seenMsgs: new Set(),
  seenCalls: new Set(),
  reactions: 0, // reactions sent as texts, left out of the messages
  files: [],
  filter: { contact: 'all', source: 'all', groups: true, people: [], from: null, to: null },
  peopleKeys: null, // Set of thread keys matching filter.people, or null when not filtering
  // Your sender name per source whose records carry sender names (WhatsApp, iMessage, Telegram, Instagram);
  // `auto` is false once picked by hand.
  owners: { 2: { name: '', auto: true }, 3: { name: '', auto: true }, 4: { name: '', auto: true }, 5: { name: '', auto: true } },
  firstSeen: new Map(), // key -> time of the first message ever loaded for that conversation
  archives: [], // loaded export files (zips, SMS XML); message attachments point into these by index (att.z)
  docFreq: null, // { sig, value } cache for "What you talk about"
  leader: { sort: 'n', asc: false, all: false }, // leaderboard sorting
  wrapYear: null,
  gran: 'auto',
  activeGran: 'month',
  convoGap: CONVO_GAP, // silence that ends a conversation (picked on the Conversation length card)
  calYear: null,
  topRows: [],
  callRows: [],
  browserLimit: 200,
  browserQuery: '',
  browserMood: null, // { mo, o (null = both), kind: 'pos' | 'neg' | 'any' } picked on the mood chart
  showMood: false, // mood scores on the messages
  phrase: '', // word tracker query
  phraseGran: 'auto', // word tracker bars: auto / day / week / month
  vocab: null, // aggregateContent result behind the Vocabulary card
  vocabMo: null, // month picked on the Vocabulary chart (null = the latest)
  otd: null, // { month, day } shown in On this day (null = today)
  phraseMsgs: [], // the selection the word tracker searches
  ui: null,
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

// ------------------------------------------------------------------ loading

const SOURCES = { 0: 'SMS', 1: 'Google Chat', 2: 'WhatsApp', 3: 'iMessage', 4: 'Telegram', 5: 'Instagram' };
const SOURCE_MARK = { 1: '💬', 2: '🟢', 3: '🔵', 4: '✈️', 5: '📸' };
const isZip = (f) => /\.zip$/i.test(f.name) || /zip/.test(f.type);
/** Records from these sources carry their sender in `sn` and get `o` from S.owners. */
const hasOwner = (s) => s === 2 || s === 3 || s === 4 || s === 5;
const TELEGRAM_HTML = "This is Telegram's HTML export, which can't be read. Export again and choose “Machine-readable JSON” as the format.";
const INSTAGRAM_HTML = "This is Instagram's HTML export, which can't be read. Export again and choose “JSON” as the format.";
/** Instagram keeps each conversation in messages/<folder>/<name>_<id>/message_N.json. */
const INSTAGRAM_THREAD = /(?:^|\/)messages\/[^/]+\/[^/]+\/message_\d+\.(?:json|html)$/;

/** imessage-exporter txt starts with "May 17, 2022  5:29:42 PM"; WhatsApp with "1/2/24, …". */
const looksLikeIMessage = (text) =>
  /^\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{2}, \d{4} {1,2}\d{1,2}:\d{2}:\d{2} [AP]M/.test(text.replace(/^\ufeff/, ''));

/** 'sms' | 'gchat' | 'whatsapp' | 'imessage' | 'telegram' | 'instagram', from the extension and what's inside. */
async function fileKind(f) {
  if (/^message_\d+\.json$/i.test(f.name)) return 'instagram';
  if (/\.json$/i.test(f.name)) return 'telegram';
  if (/^message_\d+\.html$/i.test(f.name)) throw new Error(INSTAGRAM_HTML);
  if (/\.html?$/i.test(f.name)) throw new Error(/^messages\d*\.html$/i.test(f.name) ? TELEGRAM_HTML : `${f.name} isn't an export this app can read`);
  if (/\.txt$/i.test(f.name)) return looksLikeIMessage(await f.slice(0, 4096).text()) ? 'imessage' : 'whatsapp';
  if (!isZip(f)) return 'sms';
  const { listZip, readEntryText } = zipLib();
  const entries = (await listZip(f)).filter((e) => !e.name.endsWith('/'));
  if (entries.some((e) => /(?:^|\/)Google Chat\//.test(e.name))) return 'gchat';
  const ig = entries.filter((e) => INSTAGRAM_THREAD.test(e.name));
  if (ig.some((e) => e.name.endsWith('.json'))) return 'instagram';
  if (ig.length) throw new Error(INSTAGRAM_HTML);
  // The other parts of a split Instagram export: media, or your profile.
  if (entries.some((e) => /(?:^|\/)(?:your_instagram_activity\/|personal_information\/|messages\/(?:inbox|archived_threads|message_requests)\/)/.test(e.name))) return 'instagram';
  if (entries.some((e) => /(?:^|\/)result\.json$/.test(e.name))) return 'telegram';
  if (entries.some((e) => /(?:^|\/)messages\d*\.html$/.test(e.name))) throw new Error(TELEGRAM_HTML);
  if (entries.some((e) => /(?:^|\/)(?:_chat|WhatsApp[^/]*)\.txt$/i.test(e.name))) return 'whatsapp';
  const txt = entries.find((e) => /\.txt$/i.test(e.name) && !/(?:^|\/)orphaned\.txt$/i.test(e.name)) || entries.find((e) => /\.txt$/i.test(e.name));
  if (txt) return looksLikeIMessage(await readEntryText(txt)) ? 'imessage' : 'whatsapp';
  throw new Error(`${f.name} isn't a Google Takeout, WhatsApp, iMessage, Telegram or Instagram export`);
}

async function loadFiles(fileList) {
  const files = [...fileList].filter((f) => f.size > 0);
  if (!files.length) return;
  $('#landing').hidden = false;
  $('#drop').hidden = true;
  $('#progress').hidden = false;
  $('#loadError').hidden = true;
  const bar = $('#progressBar');
  const text = $('#progressText');

  let chatBadDates = 0;

  try {
    // Each SMS backup is parsed on its own; all Takeout zips go together because a
    // split export spreads one conversation across parts, and all WhatsApp exports
    // go together so their date formats can be worked out from each other.
    const kinds = await Promise.all(files.map(fileKind));
    const of = (kind) => files.filter((f, i) => kinds[i] === kind);
    const jobs = of('sms').map((f) => {
      const attBase = S.archives.push(f) - 1;
      return { files: [f], attBase, parse: (cb) => parseBackupFile(f, cb) };
    });
    const gchat = of('gchat');
    if (gchat.length) {
      // Attachments reference their zip by index into this job's files; offset that into S.archives.
      const attBase = S.archives.length;
      S.archives.push(...gchat);
      jobs.push({ files: gchat, gchat: true, attBase, parse: (cb) => parseGoogleChatZips(gchat, cb) });
    }
    const wa = of('whatsapp');
    if (wa.length) jobs.push({ files: wa, parse: (cb) => parseWhatsAppFiles(wa, cb) });
    const im = of('imessage');
    if (im.length) jobs.push({ files: im, parse: (cb) => parseIMessageFiles(im, cb) });
    const tg = of('telegram');
    if (tg.length) {
      // Attachments in a zipped export point at their file by index into this job's files.
      const attBase = S.archives.length;
      S.archives.push(...tg);
      jobs.push({ files: tg, attBase, parse: (cb) => parseTelegramFiles(tg, cb) });
    }
    const ig = of('instagram');
    if (ig.length) {
      // All parts of a split export go together: a conversation's media can be in another part.
      const attBase = S.archives.length;
      S.archives.push(...ig);
      jobs.push({ files: ig, attBase, parse: (cb) => parseInstagramFiles(ig, cb) });
    }

    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i];
      const label = job.files.length > 1 ? `${job.files.length} files` : job.files[0].name;
      const before = S.msgs.length + S.calls.length;
      const done = await job.parse({
        onBatch(msgs, calls) {
          for (const m of msgs) {
            // WhatsApp / iMessage / Telegram / Instagram records get `o` later (see applyOwners), so key them by sender.
            const key = `${m.t}|${hasOwner(m.s) ? m.sn : m.o}|${m.k}|${m.l}|${m.m}`;
            if (S.seenMsgs.has(key)) continue;
            S.seenMsgs.add(key);
            // Reactions sent as texts (tapbacks, "😂 to “…”") aren't messages; the other
            // exports leave reactions out entirely.
            if (m.f & T_REACTION) { S.reactions++; continue; }
            if (m.att && job.attBase) for (const a of m.att) if (a.z != null) a.z += job.attBase;
            S.msgs.push(m);
          }
          for (const c of calls) {
            const key = `${c.t}|${c.ty}|${c.k}`;
            if (S.seenCalls.has(key)) continue;
            S.seenCalls.add(key);
            S.calls.push(c);
          }
        },
        onProgress(loaded, total) {
          const pct = ((i + loaded / total) / jobs.length) * 100;
          bar.style.width = pct.toFixed(1) + '%';
          text.textContent = `Reading ${label} (${i + 1}/${jobs.length}) · ${fmtBytes(loaded)} of ${fmtBytes(total)} · ${fmtNum(S.msgs.length)} messages, ${fmtNum(S.calls.length)} calls`;
        },
      });
      for (const c of done.contacts) {
        const cur = S.contacts.get(c.key);
        if (!cur) S.contacts.set(c.key, c);
        else {
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
      }
      if (job.gchat) chatBadDates += done.counts.badDates || 0;
      const added = S.msgs.length + S.calls.length - before;
      for (const f of job.files) S.files.push({ name: f.name, size: f.size, added });
    }
  } catch (err) {
    console.error(err);
    showLoadError('Could not read that file: ' + err.message);
    return;
  }

  if (!S.msgs.length && !S.calls.length) {
    showLoadError(chatBadDates
      ? 'The Google Chat dates are in a language this app can\'t read yet. Set your Google account language to English, export again, and retry.'
      : 'No messages or calls were found. Use an XML backup from SMS Backup & Restore (sms-*.xml or calls-*.xml), a Google Takeout zip that includes Google Chat, a WhatsApp chat export (.txt or .zip), an iMessage export, a Telegram export (result.json, or a zip of the export folder), or an Instagram export (.zip, JSON format).');
    return;
  }

  S.msgs.sort((a, b) => a.t - b.t);
  S.calls.sort((a, b) => a.t - b.t);
  S.firstSeen = computeFirstSeen();
  S.docFreq = null;
  for (const c of S.contacts.values()) c.label = contactLabel(c);
  for (const s of Object.keys(S.owners)) if (S.owners[s].auto) S.owners[s].name = guessOwner(+s);
  applyOwners();
  $('#landing').hidden = true;
  $('#dash').hidden = false;
  populateContacts();
  refresh();
}

function showLoadError(msg) {
  $('#progress').hidden = true;
  $('#drop').hidden = false;
  const el = $('#loadError');
  el.textContent = msg;
  el.hidden = false;
  if (S.msgs.length || S.calls.length) {
    $('#landing').hidden = true;
    $('#dash').hidden = false;
    alert(msg);
  }
}

function formatAddr(a) {
  if (!a) return '';
  const d = a.replace(/[^\d+]/g, '');
  const m = d.match(/^\+?1?(\d{3})(\d{3})(\d{4})$/);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : a;
}

function contactLabel(c) {
  const chat = SOURCE_MARK[c.s] || '';
  if (c.group) {
    if (c.name) return chat + '👥 ' + c.name.split(', ').map(formatAddr).join(', ');
    return chat + '👥 ' + c.addr.split('~').map(formatAddr).join(', ');
  }
  return (chat ? chat + ' ' : '') + (formatAddr(c.name) || formatAddr(c.addr) || c.key);
}

/** Message source of a thread key: 0 = SMS, 1 = Google Chat, 2 = WhatsApp, 3 = iMessage, 4 = Telegram, 5 = Instagram. */
function keySource(key) {
  const c = S.contacts.get(key);
  return (c && c.s) || 0;
}

function loadedSources() {
  return new Set([...S.contacts.values()].map((c) => c.s || 0));
}

// ------------------------------------------------------------------ export owner (WhatsApp, iMessage, Telegram, Instagram)

const sameName = (a, b) => a.replace(/[\s~]/g, '').toLowerCase() === b.replace(/[\s~]/g, '').toLowerCase();

/** imessage-exporter calls you "Me" unless the export used --custom-name / --use-caller-id. */
const isDefaultOwner = (s, name) => s === 3 && name === 'Me';

/**
 * Conversations whose owner has to be worked out: every WhatsApp, Telegram and Instagram
 * chat, and the iMessage ones exported with a custom name (no "Me" in them).
 */
function ownerPool(source) {
  return [...S.contacts.values()].filter((c) => c.s === source && !c.members.some(([n]) => isDefaultOwner(source, n)));
}

/**
 * WhatsApp and (custom-named) iMessage exports don't mark which sender is you. A
 * Telegram export often does, and so does an Instagram one that includes your personal
 * information (`owner` on their contacts: certain). Otherwise a 1-on-1
 * chat is named after the other person, so its other sender is you (strong evidence);
 * failing that you're the sender who shows up in the most chats, then the one with the
 * most messages.
 */
function guessOwner(source) {
  const score = new Map();
  const add = (name, n) => score.set(name, (score.get(name) || 0) + n);
  for (const c of ownerPool(source)) {
    if (c.owner) add(c.owner, 1e6);
    for (const [name, count] of c.members) add(name, 1 + count / 1e9);
    if (!c.group && c.members.length === 2 && c.members.some(([n]) => sameName(n, c.title))) {
      add(c.members.find(([n]) => !sameName(n, c.title))[0], 1000);
    }
  }
  return [...score.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n)[0] || '';
}

/** Set sent/received on WhatsApp / iMessage / Telegram / Instagram records from S.owners, and rebuild the pickers. */
function applyOwners() {
  for (const m of S.msgs) if (hasOwner(m.s)) m.o = m.sn === S.owners[m.s].name || isDefaultOwner(m.s, m.sn) ? 1 : 0;
  for (const c of S.contacts.values()) c.search = contactSearchText(c);
  matchPeople();

  const box = $('#ownerFields');
  box.innerHTML = '';
  for (const source of Object.keys(S.owners).map(Number)) {
    const names = new Map();
    for (const c of ownerPool(source)) for (const [n, k] of c.members) names.set(n, (names.get(n) || 0) + k);
    if (!names.size) continue; // nothing to pick, or every conversation names you "Me"
    const owner = S.owners[source].name;
    const field = document.createElement('label');
    field.className = 'field';
    field.title = `${SOURCES[source]} exports don't say which sender is you`;
    field.innerHTML = `<span>You on ${SOURCES[source]}</span><select></select>`;
    const sel = field.querySelector('select');
    for (const [n] of [...names.entries()].sort((a, b) => b[1] - a[1])) sel.add(new Option(n, n));
    sel.value = owner;
    sel.onchange = () => setOwner(source, sel.value);
    box.appendChild(field);
  }
}

function setOwner(source, name) {
  S.owners[source] = { name, auto: false };
  applyOwners();
  populateContacts();
  refresh();
}

/**
 * Lowercased text a people search matches against: the conversation's name and
 * addresses plus, for groups, every member's name. SMS group keys are 'g:' + the
 * members' 1-on-1 keys, so members' names come from their own contacts.
 */
function contactSearchText(c) {
  const parts = [c.label, c.name, ...c.addr.split('~').filter((n) => !hasOwner(c.s) || (n !== S.owners[c.s].name && !isDefaultOwner(c.s, n)))];
  if (c.group && !c.s) {
    for (const k of c.key.slice(2).split('~')) {
      const member = S.contacts.get(k);
      if (member) parts.push(member.name, member.addr);
    }
  }
  return parts.filter(Boolean).join('\n').toLowerCase();
}

/** Recompute S.peopleKeys from S.filter.people (any term matches). */
function matchPeople() {
  const terms = S.filter.people;
  if (!terms.length) { S.peopleKeys = null; return; }
  S.peopleKeys = new Set();
  for (const c of S.contacts.values()) {
    if (terms.some((t) => c.search.includes(t))) S.peopleKeys.add(c.key);
  }
}

function setPeople(text) {
  S.filter.people = [...new Set(text.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean))];
  matchPeople();
  if (S.peopleKeys && !S.peopleKeys.has(S.filter.contact)) S.filter.contact = 'all';
  S.browserLimit = 200;
  populateContacts();
  refresh();
}

function labelFor(key) {
  const c = S.contacts.get(key);
  return c ? c.label : key;
}

// ------------------------------------------------------------------ filters

function populateContacts() {
  const totals = new Map();
  for (const m of S.msgs) totals.set(m.k, (totals.get(m.k) || 0) + 1);
  const callTotals = new Map();
  for (const c of S.calls) callTotals.set(c.k, (callTotals.get(c.k) || 0) + 1);
  const { source } = S.filter;
  const people = S.peopleKeys;
  const keys = [...new Set([...totals.keys(), ...callTotals.keys()])]
    .filter((k) => (source === 'all' || keySource(k) === source) && (!people || people.has(k)));
  keys.sort((a, b) => (totals.get(b) || 0) - (totals.get(a) || 0) || (callTotals.get(b) || 0) - (callTotals.get(a) || 0));

  const sel = $('#contactSel');
  sel.innerHTML = '';
  const shown = source === 'all' && !people ? S.msgs.length : keys.reduce((s, k) => s + (totals.get(k) || 0), 0);
  const all = new Option(`All conversations (${fmtNum(shown)})`, 'all');
  sel.add(all);
  for (const k of keys) {
    const n = totals.get(k) || 0;
    const cn = callTotals.get(k) || 0;
    const parts = [];
    if (n) parts.push(fmtNum(n));
    if (cn) parts.push(`${fmtNum(cn)} calls`);
    sel.add(new Option(`${labelFor(k)} (${parts.join(', ')})`, k));
  }
  sel.value = S.filter.contact;
  const present = loadedSources();
  $('#sourceSeg').hidden = present.size < 2;
  $$('#sourceSeg button').forEach((b) => {
    b.hidden = b.dataset.source !== 'all' && !present.has(+b.dataset.source);
    b.classList.toggle('on', b.dataset.source === String(source));
  });
  $('#fileInfo').textContent = S.files.map((f) => f.name).join(', ') +
    (S.reactions ? ` · ${fmtNum(S.reactions)} reaction${S.reactions === 1 ? '' : 's'} (like “😂 to …” or “Loved an image”) not counted as messages` : '');
}

function setContact(key) {
  S.filter.contact = key;
  $('#contactSel').value = key;
  S.browserLimit = 200;
  refresh();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/** Messages matching the filters (not the date range); `contact` overrides the selected conversation. */
function baseMessages(contact = S.filter.contact) {
  const { groups, source } = S.filter;
  if (contact !== 'all') return S.msgs.filter((m) => m.k === contact);
  const people = S.peopleKeys;
  if (source === 'all' && groups && !people) return S.msgs;
  return S.msgs.filter((m) =>
    (source === 'all' || (m.s || 0) === source) && (groups || !m.k.startsWith('g:')) && (!people || people.has(m.k)));
}

function baseCalls() {
  const { contact, source } = S.filter;
  if (source !== 'all' && source !== 0) return []; // calls only come from SMS Backup & Restore
  if (contact !== 'all') return S.calls.filter((c) => c.k === contact);
  if (S.peopleKeys) return S.calls.filter((c) => S.peopleKeys.has(c.k));
  return S.calls;
}

function setSource(source) {
  S.filter.source = source;
  S.filter.contact = 'all';
  S.browserLimit = 200;
  populateContacts();
  refresh();
}

function inRange(arr) {
  const { from, to } = S.filter;
  if (from == null && to == null) return arr;
  const lo = from ?? -Infinity;
  const hi = to ?? Infinity;
  // arrays are time-sorted: binary search the window
  const lower = (x) => {
    let a = 0, b = arr.length;
    while (a < b) { const mid = (a + b) >> 1; if (arr[mid].t < x) a = mid + 1; else b = mid; }
    return a;
  };
  return arr.slice(lower(lo), hi === Infinity ? arr.length : lower(hi + 1));
}

function dataBounds() {
  const all = [S.msgs, S.calls].filter((a) => a.length);
  const first = Math.min(...all.map((a) => a[0].t));
  const last = Math.max(...all.map((a) => a[a.length - 1].t));
  return { first, last };
}

function setRange(from, to) {
  S.filter.from = from;
  S.filter.to = to;
  S.browserLimit = 200;
  refresh();
}

function toDateInput(ts) {
  if (ts == null) return '';
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fromDateInput(v, endOfDay) {
  if (!v) return null;
  const [y, m, d] = v.split('-').map(Number);
  return endOfDay ? new Date(y, m - 1, d + 1).getTime() - 1 : new Date(y, m - 1, d).getTime();
}

function syncRangeUi() {
  const { first, last } = dataBounds();
  $('#fromDate').value = toDateInput(S.filter.from ?? first);
  $('#toDate').value = toDateInput(S.filter.to ?? last);
  $('#fromDate').min = $('#toDate').min = toDateInput(first);
  $('#fromDate').max = $('#toDate').max = toDateInput(last);
  $$('#presets button').forEach((b) => b.classList.toggle('on', b.dataset.preset === 'all' && S.filter.from == null && S.filter.to == null));
}

// ------------------------------------------------------------------ rendering

function emptyOption(ui, text) {
  return {
    graphic: { type: 'text', left: 'center', top: 'middle', style: { text, fill: ui.muted, fontSize: 13, fontFamily: FONT } },
  };
}

function refresh({ timeline = true } = {}) {
  const ui = (S.ui = readTheme());
  const base = baseMessages();
  if (timeline) renderTimeline(ui, base);

  const msgs = inRange(base);
  const A = aggregateMessages(msgs, S.convoGap);
  renderKpis(A);
  renderHighlights(msgs, A);
  renderOnThisDay(base);
  show('#profileBtn', S.filter.contact !== 'all');
  syncRangeUi();
  renderScope(msgs.length);

  const none = !msgs.length;
  const put = (id, fn, emptyText = 'No messages in this selection') =>
    Charts.set(id, none ? emptyOption(ui, emptyText) : fn());

  put('c-hour', () => hourOption(ui, A));
  put('c-dow', () => dowOption(ui, A));
  put('c-heat', () => heatOption(ui, A));
  renderCalendar(ui, A, none);
  put('c-split', () => splitOption(ui, A));
  put('c-share', () => shareOption(ui, A));
  put('c-length', () => lengthOption(ui, A));
  put('c-length-trend', () => lengthTrendOption(ui, A));

  S.topRows = [...A.contacts.entries()]
    .map(([key, v]) => ({ key, label: labelFor(key), r: v[0], s: v[1], t: v[0] + v[1] }))
    .sort((a, b) => b.t - a.t)
    .slice(0, 40);
  put('c-contacts', () => topContactsOption(ui, S.topRows));
  $('#contactsNote').textContent = S.filter.contact === 'all'
    ? 'Click a bar to focus on that conversation.'
    : 'Showing one conversation. Pick “All conversations” to compare.';

  const em = emojiOption(ui, A);
  Charts.set('c-emoji', em.empty ? emptyOption(ui, 'No emoji in this selection') : em.opt);
  const wd = wordsOption(ui, A);
  Charts.set('c-words', wd.empty ? emptyOption(ui, 'No words in this selection') : wd.opt);

  const anyMedia = MEDIA_TYPES.some((m) => A.media[m.key][0] + A.media[m.key][1]);
  Charts.set('c-media', anyMedia ? mediaOption(ui, A) : emptyOption(ui, 'No attachments in this selection'));
  Charts.set('c-media-trend', anyMedia ? mediaTrendOption(ui, A) : emptyOption(ui, 'No attachments in this selection'));

  const anyReply = A.reply[0].some(Boolean) || A.reply[1].some(Boolean);
  Charts.set('c-reply', anyReply ? replyOption(ui, A) : emptyOption(ui, 'No back-and-forth replies in this selection'));
  put('c-behavior', () => behaviorOption(ui, A));

  // Activity
  const all = S.filter.contact === 'all';
  put('c-yoy', () => yearOverYearOption(ui, A));
  put('c-night', () => nightOwlOption(ui, A));
  const ln = A.latestNight;
  $('#nightNote').textContent = ln
    ? `Latest: ${new Date(ln.t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} on ${new Date(ln.t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })} with ${labelFor(ln.k)}`
    : 'Share of messages sent or received between midnight and 5am';

  // People
  show('#relCard', all);
  if (all) put('c-relationships', () => relationshipsOption(ui, A, labelFor));
  show('#leaderCard', all);
  if (all) renderLeaderboard(A);
  show('#driftCard', all);
  if (all) renderDrifted(A);
  $('#c-newpeople').closest('.card').hidden = !all;
  if (all) {
    const np = newPeopleRows(A);
    Charts.set('c-newpeople', np.length ? newPeopleOption(ui, np) : emptyOption(ui, 'No new conversations in this range'));
  }
  renderMilestones(A);

  // Group chats
  const groupRows = [...A.groupSenders.entries()]
    .map(([x, n]) => ({ label: senderLabel(x), n, you: x === 'You' }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 20);
  show('#sec-groups', A.group > 0);
  if (A.group > 0) {
    Charts.set('c-groupsenders', groupRows.some((r) => !r.you) ? groupSendersOption(ui, groupRows) : emptyOption(ui, 'Senders are unknown for these group messages'));
    put('c-groupshare', () => groupShareOption(ui, A));
  }

  // Replies & sessions
  Charts.set('c-replyhour', anyReply ? replyByHourOption(ui, A) : emptyOption(ui, 'No back-and-forth replies in this selection'));
  put('c-sessions', () => sessionsOption(ui, A));
  $$('#gapSeg button').forEach((b) => b.classList.toggle('on', +b.dataset.gap === S.convoGap));
  const gapWords = fmtGapWords(S.convoGap);
  const ls = A.longestSession;
  $('#sessionNote').textContent = `A conversation ends after ${gapWords} of quiet` + (ls
    ? ` · Longest: ${fmtNum(ls.n)} messages over ${fmtDuration(ls.end - ls.start)} with ${labelFor(ls.k)} on ${new Date(ls.start).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}`
    : '');
  $('#replyNote').textContent = `How quickly each side answers (within ${gapWords})`;
  $('#habitsNote').textContent = `Conversation starters (after ${fmtGapShort(S.convoGap)} of quiet), double texts and message traits`;

  // Content: the text-heavy pass only runs once the section is on (or near) the screen.
  show('#distinctCard', !all);
  S.phraseMsgs = msgs;
  lazyRender('#sec-content', () => {
    renderPhrase(ui);
    if (!all) {
      const rows = none ? [] : distinctiveWords(msgs, docFreqFor());
      $('#distinctNote').textContent = `Words that set ${labelFor(S.filter.contact)} apart from your other conversations`;
      Charts.set('c-distinct', rows.length ? distinctiveOption(ui, rows) : emptyOption(ui, 'Not enough words to compare yet'));
    }
    const C = aggregateContent(msgs);
    Charts.set('c-emojitrend', C.emojiTotals.size ? emojiTrendOption(ui, C) : emptyOption(ui, 'No emoji in this selection'));
    const dm = domainsOption(ui, C);
    Charts.set('c-domains', dm.empty ? emptyOption(ui, 'No links in this selection') : dm.opt);
    S.vocab = C;
    renderVocab(ui);
    const mt = C.moodTotal;
    const share = (n, d) => (d ? Math.round((n / d) * 100) + '%' : '–');
    $('#moodNote').textContent = mt.n[0] + mt.n[1]
      ? `Share of messages that read positive (up) or negative (down), scored with VADER. You: ${share(mt.pos[1], mt.n[1])} positive, ${share(mt.neg[1], mt.n[1])} negative · Them: ${share(mt.pos[0], mt.n[0])} positive, ${share(mt.neg[0], mt.n[0])} negative`
      : 'Share of messages that read positive (up) or negative (down) each month';
    if (mt.n[0] + mt.n[1]) $('#moodNote').textContent += '. Click a bar to read those messages.';
    wireMoodChart(Charts.set('c-mood', mt.n[0] + mt.n[1] ? moodOption(ui, C) : emptyOption(ui, 'No messages with words in this selection')));
    const st = C.swearTotal;
    const per1k = (o) => (st.n[o] ? (st.w[o] / st.n[o] * 1000).toFixed(1) : '–');
    const topSwears = [...C.swearWords.entries()].sort((a, b) => (b[1][0] + b[1][1]) - (a[1][0] + a[1][1])).slice(0, 5).map(([w]) => w);
    $('#swearNote').textContent = st.w[0] + st.w[1]
      ? `Swear words per 1,000 messages. You: ${fmtNum(st.w[1])} (${per1k(1)} per 1,000) · Them: ${fmtNum(st.w[0])} (${per1k(0)} per 1,000) · Most used: ${topSwears.join(', ')}`
      : 'Swear words per 1,000 messages';
    Charts.set('c-swear', st.w[0] + st.w[1] ? swearOption(ui, C) : emptyOption(ui, 'No swearing in this selection 😇'));
  });

  // Sources
  const multi = all && S.filter.source === 'all' && [...A.sourceMonths.values()].reduce((set, v) => (v.forEach((n, i) => n && set.add(i)), set), new Set()).size > 1;
  show('#sec-sources', multi);
  if (multi) Charts.set('c-platforms', platformMixOption(ui, A, SOURCES));

  show('#sec-wrapped', base.length > 0);
  if (base.length) lazyRender('#sec-wrapped', () => renderWrapped(ui, base));

  renderCalls(ui);
  renderBrowser(msgs);
  // Attachments panel: shown when the selection has any; built once it's near the screen.
  show('#galleryCard', anyMedia);
  if (anyMedia) lazyRender('#galleryCard', () => renderGallery(msgs));
  wireCharts();
}

// ------------------------------------------------------------------ people, groups, content, year in review

const show = (sel, on) => ($(sel).hidden = !on);
const DAY_MS = 86400000;
const ordinal = (n) => fmtNum(n) + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th');

/** First-ever message time per conversation, over everything loaded. */
function computeFirstSeen() {
  const first = new Map();
  for (const m of S.msgs) if (!first.has(m.k)) first.set(m.k, m.t);
  return first;
}

/** A person's display name for a group sender: a name, a phone number, or an SMS 1-on-1 key. */
function senderLabel(x) {
  if (x === 'You') return 'You';
  const own = S.contacts.get(x);
  if (own) return own.name || formatAddr(own.addr) || x;
  const digits = x.replace(/[^\d]/g, '');
  if (digits.length >= 7 && /^[+\d\s().-]+$/.test(x)) {
    const sms = S.contacts.get(digits.length > 8 ? digits.slice(-8) : digits);
    if (sms && sms.name) return sms.name;
  }
  return formatAddr(x);
}

/** Document frequencies for "What you talk about", cached per filter combination. */
function docFreqFor() {
  const sig = `${S.filter.source}|${S.filter.groups}|${S.filter.people.join(',')}|${S.msgs.length}`;
  if (!S.docFreq || S.docFreq.sig !== sig) S.docFreq = { sig, value: buildDocFreq(baseMessages('all')) };
  return S.docFreq.value;
}

const LEADER_COLS = [
  { key: 'label', title: 'Conversation', sort: (r) => r.label.toLowerCase(), fmt: (r) => escapeHtml(r.label) },
  { key: 'n', title: 'Messages', sort: (r) => r.n, fmt: (r) => fmtNum(r.n) },
  { key: 'sent', title: 'You sent', sort: (r) => r.sent, fmt: (r) => Math.round(r.sent * 100) + '%' },
  { key: 'yourReply', title: 'Your reply', sort: (r) => r.yourReply ?? Infinity, fmt: (r) => fmtDuration(r.yourReply), asc: true },
  { key: 'theirReply', title: 'Their reply', sort: (r) => r.theirReply ?? Infinity, fmt: (r) => fmtDuration(r.theirReply), asc: true },
  { key: 'started', title: 'You start', sort: (r) => r.started ?? -1, fmt: (r) => (r.started == null ? '–' : Math.round(r.started * 100) + '%') },
  { key: 'len', title: 'Avg length', sort: (r) => r.lenYou, fmt: (r) => `${r.lenYou} <span class="muted">/ ${r.lenThem}</span>` },
  { key: 'streak', title: 'Streak', sort: (r) => r.streak, fmt: (r) => `${fmtNum(r.streak)}d` },
  { key: 'sig', title: 'Signature', sort: (r) => r.sig || '', fmt: (r) => r.sig || '' , cls: 'emoji' },
  { key: 'first', title: 'First', sort: (r) => r.first, fmt: (r) => new Date(r.first).toLocaleDateString(undefined, { year: 'numeric', month: 'short' }) },
  { key: 'last', title: 'Last', sort: (r) => r.last, fmt: (r) => new Date(r.last).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) },
];

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function renderLeaderboard(A) {
  const avg = (bc, o) => (bc.lenN[o] ? Math.round(bc.lenSum[o] / bc.lenN[o]) : 0);
  const rows = [...A.byContact.entries()].map(([k, bc]) => {
    const n = bc.n[0] + bc.n[1];
    const st = bc.starters[0] + bc.starters[1];
    return {
      k, bc, n, label: labelFor(k), sent: bc.n[1] / n,
      yourReply: bc.replyMedian[1], theirReply: bc.replyMedian[0],
      started: st ? bc.starters[1] / st : null,
      lenYou: avg(bc, 1), lenThem: avg(bc, 0), streak: bc.longestRun, first: bc.first, last: bc.last,
    };
  });
  const col = LEADER_COLS.find((c) => c.key === S.leader.sort) || LEADER_COLS[1];
  const dir = S.leader.asc ? 1 : -1;
  rows.sort((a, b) => {
    const x = col.sort(a), y = col.sort(b);
    return (x < y ? -1 : x > y ? 1 : 0) * dir || b.n - a.n;
  });
  const shown = S.leader.all ? rows : rows.slice(0, 50);
  const total = emojiTotal(A.emojiFreq);
  for (const r of shown) r.sig = signatureEmoji(r.bc, A.emojiFreq, total);

  const table = $('#leaderTable');
  table.innerHTML = `<thead><tr>${LEADER_COLS.map((c) => `<th data-key="${c.key}" class="${c.key === col.key ? 'sorted' + (S.leader.asc ? ' asc' : '') : ''}">${c.title}</th>`).join('')}</tr></thead>` +
    `<tbody>${shown.map((r) => `<tr data-key="${escapeHtml(r.k)}">${LEADER_COLS.map((c) => `<td class="${c.cls || ''}">${c.fmt(r)}</td>`).join('')}</tr>`).join('')}</tbody>`;
  const more = $('#leaderMore');
  more.hidden = rows.length <= 50;
  more.textContent = S.leader.all ? 'Show top 50' : `Show all ${fmtNum(rows.length)}`;
}

function renderDrifted(A) {
  const DAYS = 90;
  const rows = [...A.byContact.entries()].map(([k, bc]) => ({ k, n: bc.n[0] + bc.n[1], last: bc.last })).sort((a, b) => b.n - a.n);
  const cut = Math.max(20, rows.length ? rows[Math.floor((rows.length - 1) / 4)].n : 0); // top quartile, at least 20 messages
  const quiet = rows.filter((r) => r.n >= cut && A.last - r.last > DAYS * DAY_MS).slice(0, 15);
  const list = $('#driftList');
  list.innerHTML = quiet.length
    ? quiet.map((r) => {
      const months = Math.round((A.last - r.last) / (30.4 * DAY_MS));
      return `<li data-key="${escapeHtml(r.k)}"><span>${escapeHtml(labelFor(r.k))}</span><span class="meta">${fmtNum(r.n)} messages · last ${new Date(r.last).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })} (${months < 1 ? '<1' : months} mo before the end of this range)</span></li>`;
    }).join('')
    : '<li class="empty">Nobody you talked to a lot has gone quiet in this range.</li>';
}

function newPeopleRows(A) {
  const byMonth = new Map();
  for (const k of A.byContact.keys()) {
    const t = S.firstSeen.get(k);
    if (t == null || t < A.first) continue; // first message is before this range
    const d = new Date(t);
    const mo = d.getFullYear() * 12 + d.getMonth();
    let row = byMonth.get(mo);
    if (!row) byMonth.set(mo, (row = { mo, n: 0, names: [] }));
    row.n++;
    row.names.push(labelFor(k));
  }
  return [...byMonth.values()].sort((a, b) => a.mo - b.mo);
}

function renderMilestones(A) {
  const top = new Set([...A.byContact.entries()].sort((a, b) => (b[1].n[0] + b[1].n[1]) - (a[1].n[0] + a[1].n[1])).slice(0, 10).map(([k]) => k));
  const items = A.milestones
    .filter((m) => m.k === null || top.has(m.k))
    .sort((a, b) => b.t - a.t)
    .slice(0, 40);
  const date = (t) => new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  $('#milestoneList').innerHTML = items.length
    ? items.map((m) => {
      const title = m.k === null ? `${ordinal(m.n)} message` : m.n === 1 ? `First message with ${labelFor(m.k)}` : `${ordinal(m.n)} message with ${labelFor(m.k)}`;
      return `<li><b>${escapeHtml(title)}</b><span class="meta">${date(m.t)}</span></li>`;
    }).join('')
    : '<li class="empty">No milestones in this selection.</li>';
}

// ------------------------------------------------------------------ mood details

const moodKind = (v) => (v >= MOOD_THRESHOLD ? 'pos' : v <= -MOOD_THRESHOLD ? 'neg' : 'neu');
const fmtScore = (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(2);
/** messageLib with VADER, for explaining scores on the page (built on first use). */
const moodLib = () => (moodLib.lib = moodLib.lib || messageLib(vaderLib()));

/** Whether a message is one of those picked on the mood chart. */
function moodMatches(m, f) {
  if (m.mo !== f.mo || m.v == null || (f.o != null && m.o !== f.o)) return false;
  const k = moodKind(m.v);
  return f.kind === 'any' ? k !== 'neu' : k === f.kind;
}

function moodFilterLabel(f) {
  const kind = { pos: 'Positive', neg: 'Negative', any: 'Positive and negative' }[f.kind];
  const who = f.o === 1 ? ' you sent' : f.o === 0 ? ' you received' : '';
  return `${kind} messages${who} · ${monthName(monthToTs(f.mo))}`;
}

/** From the mood chart: list that month's positive or negative messages, and go there. */
function showMoodMessages(mo, o, kind) {
  S.browserMood = { mo, o, kind };
  S.browserLimit = 200;
  S.showMood = true;
  $('#moodChk').checked = true;
  renderBrowser(inRange(baseMessages()));
  $('.browser').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** Bars open that month's messages of that side and direction; empty space, all of that month's. */
function wireMoodChart(chart) {
  if (!chart || chart.__moodWired) return;
  chart.__moodWired = true;
  // Bars sit on the 1st of their month: the nearest month to a point in time.
  const monthAt = (ts) => {
    const d = new Date(ts + 15 * DAY_MS);
    return d.getFullYear() * 12 + d.getMonth();
  };
  chart.on('click', (p) => {
    if (p.componentType !== 'series' || !Array.isArray(p.value)) return;
    showMoodMessages(monthAt(p.value[0]), p.seriesIndex < 2 ? 1 : 0, p.seriesIndex % 2 ? 'neg' : 'pos');
  });
  chart.getZr().on('click', (e) => {
    if (e.target) return; // on a bar or label
    const pt = [e.offsetX, e.offsetY];
    if (!chart.containPixel('grid', pt)) return;
    showMoodMessages(monthAt(chart.convertFromPixel({ gridIndex: 0 }, pt)[0]), null, 'any');
  });
}

/** Why a message scored as it did, and what it did to its month's bar. */
function moodWhyHtml(m) {
  const e = moodLib().explainMood(m.b);
  const kind = moodKind(m.v);
  const n = (S.moodScored && S.moodScored.get(`${m.mo}|${m.o}`)) || 1;
  const month = monthName(monthToTs(m.mo));
  const whose = m.o ? 'you sent' : 'you received';
  const word = { pos: 'positive', neg: 'negative', neu: 'neutral' }[kind];
  const effect = kind === 'neu'
    ? `Neutral, so it's in neither bar: one of the ${fmtNum(n)} messages ${whose} in ${month} with a mood score, it makes both bars a little shorter.`
    : `One of the ${fmtNum(n)} messages ${whose} in ${month} with a mood score: worth about ${(100 / n).toFixed(1)} points of the ${word} bar.`;
  const fmtV = (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1);
  const words = e ? [...e.words].sort((a, b) => Math.abs(b.valence) - Math.abs(a.valence)) : [];
  const chips = words.map((w) => `<span class="mw ${w.valence > 0 ? 'pos' : 'neg'}">${escapeHtml(w.word)} <b>${fmtV(w.valence)}</b>${w.lexicon !== w.valence ? ` <span class="was">was ${fmtV(w.lexicon)}</span>` : ''}</span>`);
  if (e && e.emphasis) chips.push(`<span class="mw ${e.emphasis > 0 ? 'pos' : 'neg'}">! ? emphasis <b>${fmtV(e.emphasis)}</b></span>`);
  return `<div class="mood-why">
    <div><b>${fmtScore(m.v)} ${word}.</b> ${escapeHtml(effect)}</div>
    ${chips.length ? `<div class="mood-words">${chips.join('')}</div>` : '<div class="mood-note">No words from VADER’s dictionary, so it scored 0.</div>'}
    <div class="mood-note">Each word's value (after “not”, “very”, ALL CAPS and “but”) adds up and is squeezed into −1…+1. +0.05 or more counts as positive, −0.05 or less as negative.</div>
  </div>`;
}

function initMoodDetails() {
  $('#moodChk').onchange = (e) => {
    S.showMood = e.target.checked;
    renderBrowser(inRange(baseMessages()));
  };
  $('#browserFilter').onclick = (e) => {
    if (!e.target.closest('[data-clear-mood]')) return;
    S.browserMood = null;
    renderBrowser(inRange(baseMessages()));
  };
  $('#messages').addEventListener('click', (e) => {
    const pill = e.target.closest('.mood-pill');
    if (!pill) return;
    const bubble = pill.closest('.bubble');
    const open = bubble.querySelector('.mood-why');
    if (open) { open.remove(); return; }
    bubble.insertAdjacentHTML('beforeend', moodWhyHtml(S.browserShown[+pill.dataset.i]));
  });
}

// ------------------------------------------------------------------ highlights, profiles, on this day

/** A conversation's name without its app mark, for sentences. */
function plainName(key) {
  const c = S.contacts.get(key);
  if (!c) return key;
  if (c.group) return c.name ? c.name.split(', ').map(formatAddr).join(', ') : c.addr.split('~').map(formatAddr).join(', ') || 'Group chat';
  return formatAddr(c.name) || formatAddr(c.addr) || key;
}

const personLink = (k, text = plainName(k)) => `<button type="button" class="person-link" data-profile="${escapeHtml(k)}">${escapeHtml(text)}</button>`;
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
const longDate = (t) => new Date(t).toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
const agoText = (t) => (Date.now() - t < DAY_MS ? 'today' : `${fmtGap(Date.now() - t)} ago`);

/** Highlight parts (strings, { b }, { k, text }) as HTML. */
function partsHtml(parts) {
  return parts.map((p) => (typeof p === 'string' ? escapeHtml(p) : p.k != null ? personLink(p.k, p.text) : `<b>${escapeHtml(p.b)}</b>`)).join('');
}

function renderHighlights(msgs, A) {
  const items = buildHighlights(msgs, A, { labelFor: plainName, senderLabel, single: S.filter.contact !== 'all' });
  $('#highlights').innerHTML = items.length
    ? items.map((h) => `<li><span class="hl-icon" aria-hidden="true">${escapeHtml(h.icon)}</span><span>${partsHtml(h.parts)}</span></li>`).join('')
    : '<li class="empty">Not enough messages here for highlights yet.</li>';
}

/** Who sent a message, for On this day: "You → Alex", "Alex", "Sam in Book Club". */
function momentSender(m) {
  const all = S.filter.contact === 'all';
  if (m.o) return all ? `You → ${plainName(m.k)}` : 'You';
  const group = m.k.startsWith('g:');
  const who = group && (m.sn || m.sk) ? senderLabel(m.sn || m.sk) : group ? 'Someone' : plainName(m.k);
  return group && all ? `${who} in ${plainName(m.k)}` : who;
}

/** On this day: the selected date (today by default) in earlier years, newest first. */
function renderOnThisDay(base) {
  const now = new Date();
  const today = { month: now.getMonth(), day: now.getDate() };
  const sel = S.otd || today;
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dayName = (d) => new Date(2000, d.month, d.day).toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
  $('#otdDate').textContent = dayName(sel);
  $('#otdToday').hidden = sel.month === today.month && sel.day === today.day;
  const box = $('#otd');
  const years = sameDayHistory(base, sel.month, sel.day, todayStart);
  if (!years.length) {
    const near = nearestDayWithHistory(daysWithHistory(base, todayStart), sel.month, sel.day);
    box.innerHTML = '<p class="empty">Nothing on this date in earlier years.</p>' +
      (near ? `<button class="btn small" type="button" data-otd-goto="${near.month}-${near.day}">Go to ${escapeHtml(dayName(near))}, the nearest day with messages →</button>` : '');
    return;
  }
  const single = S.filter.contact !== 'all';
  box.innerHTML = years.slice(0, 4).map(({ year, msgs }) => {
    const back = now.getFullYear() - year;
    const day = new Date(year, sel.month, sel.day).getTime();
    const top = single ? null : busiestConversation(msgs);
    const withWhom = top ? (top.of > 1 ? `, mostly with ${personLink(top.k)}` : ` with ${personLink(top.k)}`) : '';
    const moments = pickMoments(msgs, 3).map((m) =>
      `<div class="otd-msg ${m.o ? 'sent' : 'recv'}"><span class="otd-who">${escapeHtml(momentSender(m))}</span>${escapeHtml(clip(m.b, 140))}</div>`).join('');
    return `<section class="otd-year">
      <div class="otd-head"><b>${back ? `${back} year${back === 1 ? '' : 's'} ago` : 'Earlier this year'}</b> <span class="muted">${escapeHtml(longDate(day))} · ${fmtNum(msgs.length)} message${msgs.length === 1 ? '' : 's'}</span>${withWhom}</div>
      ${moments ? `<div class="otd-msgs">${moments}</div>` : ''}
      <button class="btn small ghost" type="button" data-otd-day="${day}">Read that day →</button>
    </section>`;
  }).join('');
}

/** Show one calendar day in the message list. */
function readDay(dayStart) {
  const d = new Date(dayStart);
  setRange(dayStart, new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime() - 1);
  $('.browser').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function moveOtd(days) {
  const now = new Date();
  const cur = S.otd || { month: now.getMonth(), day: now.getDate() };
  const d = new Date(2000, cur.month, cur.day + days); // a leap year, so Feb 29 is a stop
  S.otd = { month: d.getMonth(), day: d.getDate() };
  renderOnThisDay(baseMessages());
}

/** A profile of one conversation, over all its messages (filters and dates aside). */
function openProfile(key) {
  const msgs = S.msgs.filter((m) => m.k === key);
  if (!msgs.length) return;
  const A = aggregateMessages(msgs, S.convoGap);
  const F = profileFacts(msgs, A);
  const c = S.contacts.get(key) || {};
  const group = key.startsWith('g:');
  const name = plainName(key);
  const them = group ? 'Everyone else' : name;
  const pct = (a, b) => (b ? Math.round((a / b) * 100) + '%' : '–');
  const members = group ? new Set(msgs.filter((m) => !m.o).map((m) => m.sn || m.sk).filter(Boolean)).size + 1 : 0;
  const initials = group ? '👥' : (name.match(/\p{L}[\p{L}'-]*/gu) || []).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '#';
  const hue = [...key].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7) % 8;

  const tiles = [
    kpi('Messages', fmtNum(F.n), `${pct(F.you.messages, F.n)} from you`),
    kpi('Since', escapeHtml(new Date(F.first.t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })), agoText(F.first.t)),
    kpi('Last message', escapeHtml(new Date(F.last.t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })), agoText(F.last.t)),
    kpi('Longest streak', F.longestStreak.len ? `${fmtNum(F.longestStreak.len)} days` : '–', F.longestStreak.len ? `${shortDate(F.longestStreak.start)} – ${shortDate(F.longestStreak.end)}` : '', 'Consecutive days with at least one message'),
    kpi('Busiest month', F.busiestMonth ? new Date(monthToTs(F.busiestMonth.mo)).toLocaleDateString(undefined, { year: 'numeric', month: 'short' }) : '–', F.busiestMonth ? `${fmtNum(F.busiestMonth.n)} messages` : ''),
    kpi('Favorite time', hourText(F.peakHour), WEEKDAY_PLURAL[F.peakDow]),
  ];

  // You vs them: the side that leads on each row is marked.
  const vsRows = [
    ['Messages', F.you.messages, F.them.messages, fmtNum, 'high'],
    ['Starts conversations', F.you.starts, F.them.starts, fmtNum, 'high'],
    ['Usually replies in', F.you.reply, F.them.reply, fmtDuration, 'low'],
    ['Average length', F.you.avgLen, F.them.avgLen, (v) => `${fmtNum(v)} chars`, 'high'],
    ['Double texts', F.you.doubles, F.them.doubles, fmtNum, 'high'],
    ['Questions asked', F.you.questions, F.them.questions, fmtNum, 'high'],
    ['Late-night messages', F.you.night, F.them.night, fmtNum, 'high'],
    ['Favorite emoji', F.you.emoji, F.them.emoji, (v) => (v.length ? v.map(([e]) => e).join(' ') : '–'), null],
  ];
  // Only a clear difference counts (5%+, and different once formatted).
  const lead = (a, b, way, fmt) => {
    if (!way || a == null || b == null || fmt(a) === fmt(b) || Math.abs(a - b) < 0.05 * Math.max(a, b)) return ['', ''];
    const aWins = way === 'low' ? a < b : a > b;
    return aWins ? ['lead', ''] : ['', 'lead'];
  };
  const vs = `<table class="vs"><thead><tr><th></th><th>You</th><th>${escapeHtml(them)}</th></tr></thead><tbody>${vsRows.map(([label, a, b, fmt, way]) => {
    const [la, lb] = lead(a, b, way, fmt);
    return `<tr><th scope="row">${label}</th><td class="${la}">${escapeHtml(fmt(a))}</td><td class="${lb}">${escapeHtml(fmt(b))}</td></tr>`;
  }).join('')}</tbody></table>`;

  $('#profileTop').innerHTML = `
    <header class="profile-head">
      <div class="avatar" style="background: var(--series-${hue + 1})" aria-hidden="true">${escapeHtml(initials)}</div>
      <div>
        <h2 id="profileName">${escapeHtml(name)}</h2>
        <p class="sub">${group ? `Group chat · ${fmtNum(members)} people` : '1-on-1'} on ${escapeHtml(SOURCES[c.s || 0])} · all time</p>
      </div>
    </header>
    <div class="kpis profile-kpis">${tiles.join('')}</div>
    <h3 class="profile-h">You and ${escapeHtml(them === 'Everyone else' ? 'everyone else' : them)}</h3>
    ${vs}`;

  const words = distinctiveWords(msgs, docFreqFor(), 15);
  const started = F.firstText;
  const bottom = [];
  if (group) {
    const rows = senderBreakdown(msgs, key);
    bottom.push(`<h3 class="profile-h">Most active</h3><ol class="plain-list member-list">${rows.map((r) =>
      `<li><span>${escapeHtml(r.label)}</span><span class="meta">${fmtNum(r.n)} · ${pct(r.n, F.n)}</span></li>`).join('')}</ol>`);
  }
  if (words.length) {
    bottom.push(`<h3 class="profile-h">What you talk about</h3><p class="sub profile-sub">Words that set this conversation apart</p><div class="chips">${words.map((w) => `<span class="chip">${escapeHtml(w.w)}</span>`).join('')}</div>`);
  }
  if (started) {
    bottom.push(`<h3 class="profile-h">How it started</h3><blockquote class="first-msg"><p>${escapeHtml(clip(started.b, 280))}</p><footer>${escapeHtml(started.o ? 'You' : momentSender(started))}, ${escapeHtml(longDate(started.t))}</footer></blockquote>`);
  }
  bottom.push(`<div class="profile-actions"><button class="btn primary" type="button" data-focus="${escapeHtml(key)}">Focus the dashboard on ${escapeHtml(name)}</button></div>`);
  $('#profileBottom').innerHTML = bottom.join('');

  const dlg = $('#profile');
  if (!dlg.open) dlg.showModal();
  dlg.scrollTop = 0;
  const months = [];
  for (let mo = F.first.mo; mo <= F.last.mo; mo++) months.push(mo);
  const get = (o) => (mo) => (A.months.get(mo) || { c: [0, 0] }).c[o];
  Charts.set('c-profile', monthlyStackOption(S.ui, months, [
    { name: 'You', color: S.ui.sent, get: get(1) },
    { name: them, color: S.ui.recv, get: get(0) },
  ]));
}

function initGlance() {
  $('#otdPrev').onclick = () => moveOtd(-1);
  $('#otdNext').onclick = () => moveOtd(1);
  $('#otdToday').onclick = () => { S.otd = null; renderOnThisDay(baseMessages()); };
  $('#profileBtn').onclick = () => openProfile(S.filter.contact);
  const dlg = $('#profile');
  dlg.querySelector('.profile-close').onclick = () => dlg.close();
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); }); // the backdrop
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-profile], [data-otd-day], [data-otd-goto], [data-focus]');
    if (!t) return;
    if (t.dataset.profile) openProfile(t.dataset.profile);
    else if (t.dataset.otdDay) readDay(+t.dataset.otdDay);
    else if (t.dataset.otdGoto) {
      const [month, day] = t.dataset.otdGoto.split('-').map(Number);
      S.otd = { month, day };
      renderOnThisDay(baseMessages());
    } else if (t.dataset.focus) {
      dlg.close();
      setContact(t.dataset.focus);
    }
  });
}

// ---- lazy sections: render expensive sections only when they're on (or near) the screen

const Lazy = { pending: new Map(), visible: new Set(), observer: null };

function lazyRender(sel, fn) {
  Lazy.pending.set(sel, fn);
  if (Lazy.visible.has(sel)) runLazy(sel);
}

function runLazy(sel) {
  const fn = Lazy.pending.get(sel);
  if (!fn) return;
  Lazy.pending.delete(sel);
  fn();
}

function observeLazySections() {
  Lazy.observer = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const sel = '#' + e.target.id;
      if (e.isIntersecting) {
        Lazy.visible.add(sel);
        runLazy(sel);
      } else {
        Lazy.visible.delete(sel);
      }
    }
  }, { rootMargin: '600px 0px' });
  for (const sel of ['#sec-content', '#sec-wrapped', '#galleryCard']) Lazy.observer.observe($(sel));
}

// ---- year in review (canvas)

function wrappedStats(base, year) {
  const from = new Date(year, 0, 1).getTime();
  const to = new Date(year + 1, 0, 1).getTime();
  const msgs = base.filter((m) => m.t >= from && m.t < to);
  const A = aggregateMessages(msgs, S.convoGap);
  const C = aggregateContent(msgs);
  const single = S.filter.contact !== 'all';
  const people = single
    ? senderBreakdown(msgs, S.filter.contact)
    : [...A.byContact.entries()]
      .map(([k, bc]) => ({ label: labelFor(k), n: bc.n[0] + bc.n[1] }))
      .sort((a, b) => b.n - a.n)
      .slice(0, 5);
  const emoji = [...A.emojiFreq.entries()].sort((a, b) => (b[1][0] + b[1][1]) - (a[1][0] + a[1][1])).slice(0, 3).map(([e]) => e);
  const word = [...A.wordFreq.entries()].sort((a, b) => (b[1][0] + b[1][1]) - (a[1][0] + a[1][1]))[0];
  const site = [...C.domains.entries()].sort((a, b) => (b[1][0] + b[1][1]) - (a[1][0] + a[1][1]))[0];
  let night = 0;
  for (const [n] of A.night.values()) night += n;
  let newPeople = 0;
  for (const k of A.byContact.keys()) {
    const t = S.firstSeen.get(k);
    if (t >= from && t < to) newPeople++;
  }
  return { year, A, people, peopleTitle: single ? 'Who sent what' : 'Your people', emoji, word: word && word[0], site: site && site[0], nightPct: A.n ? (night / A.n) * 100 : 0, newPeople };
}

/**
 * Messages per sender in one conversation: you and the other person, or each group
 * member (when the export says who sent it). Top 5 rows, folding the rest into "Everyone else".
 */
function senderBreakdown(msgs, key) {
  const group = key.startsWith('g:');
  const byId = new Map();
  for (const m of msgs) {
    const id = m.o ? 'You' : group ? m.sn || m.sk || '' : key;
    byId.set(id, (byId.get(id) || 0) + 1);
  }
  const byLabel = new Map();
  for (const [id, n] of byId) {
    const label = id === 'You' ? 'You' : id ? senderLabel(id) : 'Unknown sender';
    byLabel.set(label, (byLabel.get(label) || 0) + n);
  }
  const rows = [...byLabel].map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n);
  if (rows.length <= 5) return rows;
  const rest = rows.slice(4).reduce((sum, r) => sum + r.n, 0);
  return [...rows.slice(0, 4), { label: `Everyone else (${rows.length - 4} people)`, n: rest, rest: true }];
}

function drawWrapped(canvas, W, ui) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  const sans = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  const emojiFont = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#13213f');
  g.addColorStop(0.55, '#2b1d52');
  g.addColorStop(1, '#4a1942');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const fit = (text, max) => {
    let t = String(text);
    if (ctx.measureText(t).width <= max) return t;
    while (t.length > 1 && ctx.measureText(t + '…').width > max) t = t.slice(0, -1);
    return t + '…';
  };
  const text = (str, x, y, size, { weight = 400, color = '#ffffff', align = 'left', max = w - 160, font = sans } = {}) => {
    ctx.font = `${weight} ${size}px ${font}`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.fillText(fit(str, max), x, y);
  };
  const soft = 'rgba(255,255,255,0.68)';
  const A = W.A;

  text(String(W.year), 80, 150, 120, { weight: 800 });
  text('in messages', 80, 205, 40, { color: soft });
  text(fmtNum(A.n), 80, 340, 110, { weight: 800, color: ui.series[3] });
  text(`messages · ${fmtNum(A.dir[1])} sent, ${fmtNum(A.dir[0])} received`, 80, 395, 32, { color: soft });

  // Top people with bars
  text(W.peopleTitle, 80, 490, 34, { weight: 700 });
  const maxN = Math.max(1, ...W.people.filter((p) => !p.rest).map((p) => p.n));
  W.people.forEach((p, i) => {
    const y = 535 + i * 62;
    if (p.rest) {
      // Combined senders can outnumber the top one, so no bar: just the count.
      text(`${p.label}: ${fmtNum(p.n)} messages`, 80, y + 32, 26, { color: soft, max: 920 });
      return;
    }
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.beginPath();
    ctx.roundRect(80, y, 560, 46, 10);
    ctx.fill();
    ctx.fillStyle = ui.series[i % ui.series.length];
    ctx.beginPath();
    ctx.roundRect(80, y, Math.max(46, (560 * p.n) / maxN), 46, 10);
    ctx.fill();
    text(p.label, 98, y + 32, 26, { weight: 600, max: 420 });
    text(fmtNum(p.n), 660, y + 32, 26, { color: soft, max: 200 });
  });
  if (!W.people.length) text('No messages this year', 80, 570, 28, { color: soft });

  // Top emoji
  text('Top emoji', 80, 900, 34, { weight: 700 });
  text(W.emoji.join('  ') || '—', 80, 985, 72, { font: emojiFont });

  // Stat tiles
  const tiles = [
    ['Busiest day', A.busiestDay ? `${fmtNum(A.busiestDay.n)} msgs` : '–', A.busiestDay ? new Date(dayToTs(A.busiestDay.d)).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''],
    ['Night owl', `${W.nightPct.toFixed(1)}%`, 'after midnight'],
    ['Longest chat', A.longestSession ? `${fmtNum(A.longestSession.n)} msgs` : '–', A.longestSession ? labelFor(A.longestSession.k) : ''],
    ['Longest streak', A.longestStreak.len ? `${fmtNum(A.longestStreak.len)} days` : '–', 'in a row'],
    ['Top word', W.word || '–', 'most used'],
    ['New people', fmtNum(W.newPeople), W.site ? `top site: ${W.site}` : 'first messages'],
  ];
  tiles.forEach(([label, value, sub], i) => {
    const col = i % 3, row = Math.floor(i / 3);
    const x = 80 + col * 315, y = 1030 + row * 135;
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath();
    ctx.roundRect(x, y, 290, 118, 14);
    ctx.fill();
    text(label.toUpperCase(), x + 20, y + 34, 19, { weight: 600, color: soft, max: 250 });
    text(value, x + 20, y + 76, 34, { weight: 800, max: 250 });
    text(sub, x + 20, y + 104, 19, { color: soft, max: 250 });
  });
  text('Yapalytics', w - 80, h - 24, 22, { weight: 600, color: 'rgba(255,255,255,0.45)', align: 'right' });
}

function renderWrapped(ui, base) {
  const firstY = new Date(base[0].t).getFullYear();
  const lastY = new Date(base[base.length - 1].t).getFullYear();
  if (S.wrapYear == null || S.wrapYear < firstY || S.wrapYear > lastY) S.wrapYear = lastY;
  const wrap = $('#wrapYears');
  wrap.innerHTML = '';
  for (let y = firstY; y <= lastY; y++) {
    const b = document.createElement('button');
    b.textContent = y;
    b.className = y === S.wrapYear ? 'on' : '';
    b.onclick = () => { S.wrapYear = y; renderWrapped(S.ui, baseMessages()); };
    wrap.appendChild(b);
  }
  drawWrapped($('#wrapCanvas'), wrappedStats(base, S.wrapYear), ui);
}

function saveWrapped() {
  $('#wrapCanvas').toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `Yapalytics-${S.wrapYear}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }, 'image/png');
}

function renderScope(n) {
  const src = S.filter.source === 'all' ? '' : ` (${SOURCES[S.filter.source]})`;
  const { people, groups } = S.filter;
  const all = people.length
    ? `${groups ? 'Conversations' : '1-on-1 conversations'} with ${people.map((p) => `“${p}”`).join(' or ')}`
    : groups ? 'All conversations' : 'All 1-on-1 conversations';
  const who = S.filter.contact === 'all' ? all + src : labelFor(S.filter.contact);
  const { first, last } = dataBounds();
  const from = new Date(S.filter.from ?? first).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  const to = new Date(S.filter.to ?? last).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  $('#scope').textContent = `${who} · ${from} – ${to} · ${fmtNum(n)} messages`;
}

function renderTimeline(ui, base) {
  const days = new Map();
  for (const m of base) {
    let v = days.get(m.d);
    if (!v) days.set(m.d, (v = [0, 0]));
    v[m.o]++;
  }
  let gran = S.gran;
  if (gran === 'auto') {
    const keys = [...days.keys()];
    gran = autoGran(keys.length ? Math.max(...keys) - Math.min(...keys) : 0);
  }
  S.activeGran = gran;
  $$('#granSeg button').forEach((b) => b.classList.toggle('on', b.dataset.gran === S.gran));
  if (!base.length) {
    Charts.set('c-timeline', emptyOption(ui, 'No messages in this selection'));
    return;
  }
  const tl = buildTimeline(days, gran);
  Charts.set('c-timeline', timelineOption(ui, tl, gran, { from: S.filter.from, to: S.filter.to }));
}

function onTimelineZoom() {
  const chart = Charts.get('c-timeline');
  clearTimeout(S.zoomTimer);
  S.zoomTimer = setTimeout(() => {
    const dz = chart.getOption().dataZoom[0];
    if (!dz) return;
    const full = dz.start <= 0.01 && dz.end >= 99.99;
    const gran = S.activeGran;
    if (full) {
      S.filter.from = S.filter.to = null;
    } else {
      S.filter.from = bucketOfDay(tsToDay(dz.startValue), gran);
      S.filter.to = bucketEnd(bucketOfDay(tsToDay(dz.endValue), gran), gran);
    }
    S.browserLimit = 200;
    refresh({ timeline: false });
  }, 180);
}

function renderCalendar(ui, A, none) {
  const years = [...new Set(A.dayKeys.map((d) => new Date(dayToTs(d)).getFullYear()))].sort();
  const wrap = $('#calYears');
  wrap.innerHTML = '';
  if (none || !years.length) {
    Charts.set('c-calendar', emptyOption(ui, 'No messages in this selection'));
    return;
  }
  if (!years.includes(S.calYear)) S.calYear = years[years.length - 1];
  for (const y of years) {
    const b = document.createElement('button');
    b.textContent = y;
    b.className = y === S.calYear ? 'on' : '';
    b.onclick = () => {
      S.calYear = y;
      $$('#calYears button').forEach((x) => x.classList.toggle('on', x === b));
      Charts.set('c-calendar', calendarOption(S.ui, A, y));
    };
    wrap.appendChild(b);
  }
  Charts.set('c-calendar', calendarOption(ui, A, S.calYear));
}

function kpi(label, value, sub = '', title = '') {
  return `<div class="kpi" title="${title}"><div class="kpi-label">${label}</div><div class="kpi-value">${value}</div><div class="kpi-sub">${sub}</div></div>`;
}

function shortDate(d) {
  return new Date(dayToTs(d)).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function renderKpis(A) {
  const total = A.dir[0] + A.dir[1];
  const pct = (a, b) => (b ? Math.round((a / b) * 100) + '%' : '–');
  const avgLen = (o) => (A.lenN[o] ? Math.round(A.lenSum[o] / A.lenN[o]) : 0);
  const media = (o) => MEDIA_TYPES.reduce((s, m) => s + A.media[m.key][o], 0);
  const convos = A.contacts.size;
  const groups = [...A.contacts.keys()].filter((k) => k.startsWith('g:')).length;
  let nightCount = 0;
  for (const [n] of A.night.values()) nightCount += n;
  const tiles = [
    kpi('Messages', fmtNum(total), `${fmtNum(A.dir[1])} sent · ${fmtNum(A.dir[0])} received`),
    kpi('You sent', pct(A.dir[1], total), `of all messages`),
    kpi('Per day', A.spanDays ? (total / A.spanDays).toFixed(1) : '–', `${fmtNum(A.activeDays)} active of ${fmtNum(A.spanDays)} days`),
    kpi('Busiest day', A.busiestDay ? fmtNum(A.busiestDay.n) : '–', A.busiestDay ? dayLabel(A.busiestDay.d) : ''),
    kpi('Longest streak', A.longestStreak.len ? `${fmtNum(A.longestStreak.len)} days` : '–', A.longestStreak.len ? `${shortDate(A.longestStreak.start)} – ${shortDate(A.longestStreak.end)}` : '', 'Consecutive days with at least one message'),
    kpi('Longest silence', A.longestSilence.len ? `${fmtNum(A.longestSilence.len)} days` : '–', A.longestSilence.len ? `${shortDate(A.longestSilence.start)} – ${shortDate(A.longestSilence.end)}` : '', 'Longest run of days with no messages'),
    kpi('Conversations', fmtNum(convos), `${fmtNum(groups)} group chats`),
    kpi('Your reply time', fmtDuration(A.replyMedian[1]), `median · theirs ${fmtDuration(A.replyMedian[0])}`, `Median time to answer, within ${fmtGapWords(S.convoGap)}`),
    kpi('Avg length', `${avgLen(1)} <small>/ ${avgLen(0)}</small>`, 'characters · sent / received'),
    kpi('Words', fmtNum(A.words[0] + A.words[1]), `${fmtNum(A.words[1])} sent · ${fmtNum(A.words[0])} received`),
    kpi('Emoji', fmtNum(A.emoji[0] + A.emoji[1]), `in ${pct(A.emojiMsgs[0] + A.emojiMsgs[1], total)} of messages`),
    kpi('Attachments', fmtNum(media(0) + media(1)), `${fmtNum(A.media.ph[0] + A.media.ph[1])} photos · ${fmtNum(A.media.vd[0] + A.media.vd[1])} videos · ${fmtBytes(A.mediaBytes)}`),
    kpi('Night owl', pct(nightCount, total), A.latestNight ? `latest ${new Date(A.latestNight.t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : 'no messages after midnight', 'Messages between midnight and 5am'),
    kpi('Longest conversation', A.longestSession ? `${fmtNum(A.longestSession.n)} <small>msgs</small>` : '–', A.longestSession ? `${escapeHtml(labelFor(A.longestSession.k))} · ${new Date(A.longestSession.start).toLocaleDateString()}` : '', `Most messages with no ${fmtGapWords(S.convoGap)} of quiet in between`),
  ];
  $('#kpis').innerHTML = tiles.join('');
}

function renderCalls(ui) {
  const section = $('#callsSection');
  const base = baseCalls();
  if (!base.length) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  const calls = inRange(base);
  const C = aggregateCalls(calls);
  const talk = C.talk[0] + C.talk[1];
  const connected = C.byType[0] + C.byType[1];
  const answeredDur = calls.filter((c) => (c.ty === 1 || c.ty === 2) && c.du > 0).length;
  $('#callKpis').innerHTML = [
    kpi('Calls', fmtNum(C.n), `${fmtNum(C.byType[0])} out · ${fmtNum(C.byType[1])} in`),
    kpi('Talk time', fmtDuration(talk * 1000), `${fmtDuration(C.talk[1] * 1000)} out · ${fmtDuration(C.talk[0] * 1000)} in`),
    kpi('Average call', answeredDur ? fmtDuration((talk / answeredDur) * 1000) : '–', `across ${fmtNum(connected)} connected calls`),
    kpi('Longest call', C.longest ? fmtDuration(C.longest.du * 1000) : '–', C.longest ? `${labelFor(C.longest.k)} · ${new Date(C.longest.t).toLocaleDateString()}` : ''),
    kpi('Missed', fmtNum(C.byType[2]), `${fmtNum(C.byType[3])} voicemail · ${fmtNum(C.byType[4])} declined`),
  ].join('');

  if (!calls.length) {
    for (const id of ['c-call-trend', 'c-call-hour', 'c-call-dur', 'c-call-contacts']) Charts.set(id, emptyOption(ui, 'No calls in this selection'));
    return;
  }
  Charts.set('c-call-trend', callTrendOption(ui, C));
  Charts.set('c-call-hour', callHourOption(ui, C));
  Charts.set('c-call-dur', callDurOption(ui, C));
  S.callRows = [...C.contacts.entries()]
    .map(([key, v]) => ({ key, label: labelFor(key), n: v.n, talk: v.talk }))
    .filter((r) => r.talk > 0)
    .sort((a, b) => b.talk - a.talk)
    .slice(0, 15);
  Charts.set('c-call-contacts', S.callRows.length ? callContactsOption(ui, S.callRows) : emptyOption(ui, 'No connected calls'));
}

// ------------------------------------------------------------------ message browser

// ------------------------------------------------------------------ vocabulary

/** Vocabulary chart plus the new words of the picked month (the latest by default). */
function renderVocab(ui = S.ui) {
  const C = S.vocab;
  const box = $('#vocabWords');
  const months = [...C.vocab.keys()].sort((a, b) => a - b);
  if (!months.length) {
    Charts.set('c-vocab', emptyOption(ui, 'No messages with words in this selection'));
    box.innerHTML = '';
    return;
  }
  // Default: the latest month that brought any new words.
  const latest = months.findLast((m) => C.vocabNew.get(m).some((x) => x.top.length)) ?? months[months.length - 1];
  const mo = months.includes(S.vocabMo) ? S.vocabMo : latest;
  const chart = Charts.set('c-vocab', vocabOption(ui, C, mo));
  if (!chart.__wired) {
    // Click anywhere on the plot: pick the nearest month.
    chart.__wired = true;
    chart.getZr().on('click', (e) => {
      const pt = [e.offsetX, e.offsetY];
      if (!chart.containPixel('grid', pt)) return;
      const d = new Date(chart.convertFromPixel({ gridIndex: 0 }, pt)[0] + 15 * 86400000);
      const keys = [...S.vocab.vocab.keys()];
      const want = d.getFullYear() * 12 + d.getMonth();
      S.vocabMo = keys.reduce((best, k) => (Math.abs(k - want) < Math.abs(best - want) ? k : best), keys[0]);
      renderVocab();
    });
  }

  const fresh = C.vocabNew.get(mo);
  const col = (o, who) => {
    const { n, top } = fresh[o];
    const words = top.length
      ? top.map(([w, uses]) => `<button type="button" class="vocab-chip" data-word="${escapeHtml(w)}" title="Track “${escapeHtml(w)}” in the Word tracker">${escapeHtml(w)}${uses > 1 ? ` <span class="muted">${fmtNum(uses)}</span>` : ''}</button>`).join('')
      : '<span class="muted">Nothing new</span>';
    return `<div class="vocab-col ${o ? 'sent' : 'recv'}">
      <div class="vocab-col-head"><b>${who}</b> · ${fmtNum(n)} new of ${fmtNum(C.vocab.get(mo)[o])} words</div>
      <div class="vocab-chips">${words}</div>
    </div>`;
  };
  const firstNote = mo === months[0] ? ' (the first month here, so every word counts as new)' : '';
  box.innerHTML = `<div class="vocab-head"><b>New in ${escapeHtml(new Date(monthToTs(mo)).toLocaleDateString(undefined, { year: 'numeric', month: 'long' }))}</b>
    <span class="muted">Words each side used for the first time in this selection${firstNote}. Click the chart to pick a month, or a word to track it.</span></div>
    <div class="vocab-cols">${col(1, 'You')}${col(0, 'Them')}</div>`;
}

// ------------------------------------------------------------------ word tracker

const PHRASE_IDEAS = ['lol', 'haha', 'love you', 'miss you', 'sorry', 'good morning', 'omw', '😂'];

/** "4h 10m", "3 days", "5 months", "2.5 years": how far apart two moments are. */
function fmtGap(ms) {
  const days = ms / 86400000;
  if (days < 1) return fmtDuration(ms);
  const plural = (n, unit) => `${n} ${unit}${n === 1 ? '' : 's'}`;
  if (days < 60) return plural(Math.round(days), 'day');
  if (days < 730) return plural(Math.round(days / 30.44), 'month');
  return `${(days / 365.25).toFixed(1).replace(/\.0$/, '')} years`;
}

/** The message around the phrase's first match, escaped, with the match highlighted. */
function phraseSnippet(body, re) {
  re.lastIndex = 0;
  const m = re.exec(body);
  if (!m) return escapeHtml(body);
  const at = m.index;
  const after = at + m[0].length;
  let start = Math.max(0, at - 60);
  let end = Math.min(body.length, after + 80);
  // Don't cut an emoji (a surrogate pair) in half.
  if (start > 0 && /[\uDC00-\uDFFF]/.test(body[start])) start--;
  if (end < body.length && /[\uDC00-\uDFFF]/.test(body[end])) end++;
  return `${start ? '…' : ''}${escapeHtml(body.slice(start, at))}<mark>${escapeHtml(m[0])}</mark>${escapeHtml(body.slice(after, end))}${end < body.length ? '…' : ''}`;
}

/** Who said it first, and each side's first use quoted. */
function phraseFirstsHtml(P, re) {
  const [them, you] = P.first;
  const name = (m) => (m.o ? 'You' : messageSender(m));
  let head;
  if (you && them) {
    const [a, b] = you.t <= them.t ? [you, them] : [them, you];
    head = `<b>${escapeHtml(name(a))}</b> said it first, ${fmtGap(b.t - a.t)} before ${a.o ? escapeHtml(name(b)) : 'you'}.`;
  } else {
    head = you ? 'Only you have said it.' : `You've never said it. <b>${escapeHtml(name(them))}</b> said it first.`;
  }
  const card = (m) => {
    const when = new Date(m.t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    const conv = labelFor(m.k);
    const where = m.k.startsWith('g:') ? `in ${conv}` : m.o ? `to ${conv}` : '';
    return `<div class="phrase-first ${m.o ? 'sent' : 'recv'}">
      <div class="phrase-first-head"><b>${escapeHtml(name(m))}</b> first said it · ${when}${where ? ` · ${escapeHtml(where)}` : ''}</div>
      <div class="phrase-quote">${phraseSnippet(m.b, re)}</div>
    </div>`;
  };
  return `<p class="phrase-headline">${head}</p><div class="phrase-first-grid">${[you, them].filter(Boolean).map(card).join('')}</div>`;
}

/** Word tracker: uses of S.phrase per month in the current selection, and who said it first. */
function renderPhrase(ui = S.ui) {
  const q = S.phrase.trim();
  $$('#phraseIdeas button').forEach((b) => b.classList.toggle('on', b.textContent === q));
  $$('#phraseGranSeg button').forEach((b) => b.classList.toggle('on', b.dataset.gran === S.phraseGran));
  const msgs = S.phraseMsgs;
  const re = q && phraseRegex(q);
  const note = $('#phraseNote');
  const firsts = $('#phraseFirsts');
  const P = re && msgs.length ? aggregatePhrase(msgs, re) : null;
  const total = P ? P.uses[0] + P.uses[1] : 0;
  if (!total) {
    note.textContent = 'How often a word or phrase comes up over time, and who said it first';
    firsts.innerHTML = '';
    const why = !msgs.length ? 'No messages in this selection' : re ? `Nobody said “${q}” in this selection` : 'Type a word or phrase, or pick one above';
    Charts.set('c-phrase', emptyOption(ui, why));
    return;
  }
  const times = (n) => `${fmtNum(n)} time${n === 1 ? '' : 's'}`;
  note.textContent = `“${q}”: you said it ${times(P.uses[1])}, them ${times(P.uses[0])}`;
  const firstDay = msgs[0].d;
  const lastDay = msgs[msgs.length - 1].d;
  const gran = S.phraseGran === 'auto' ? autoGran(lastDay - firstDay) : S.phraseGran;
  Charts.set('c-phrase', phraseOption(ui, P, firstDay, lastDay, gran));
  firsts.innerHTML = phraseFirstsHtml(P, re);
}

function renderBrowser(msgs) {
  const q = S.browserQuery.trim().toLowerCase();
  const mood = S.browserMood;
  let list = q ? msgs.filter((m) => m.b && m.b.toLowerCase().includes(q)) : msgs;
  if (mood) list = list.filter((m) => moodMatches(m, mood));
  const start = Math.max(0, list.length - S.browserLimit);
  const shown = list.slice(start);
  const box = $('#messages');
  resetMessageMedia(box);
  box.innerHTML = '';
  $('#browserCount').textContent = `${fmtNum(list.length)} message${list.length === 1 ? '' : 's'}${q || mood ? ' matching' : ''} · showing latest ${fmtNum(shown.length)}`;
  $('#moreBtn').hidden = start === 0;
  const chip = $('#browserFilter');
  chip.hidden = !mood;
  if (mood) chip.innerHTML = `<span>${escapeHtml(moodFilterLabel(mood))}</span><button class="btn small ghost" type="button" data-clear-mood aria-label="Show all messages">✕</button>`;
  // Messages with a mood score per month and side: what one message is worth in the chart.
  if (S.showMood) {
    S.moodScored = new Map();
    for (const m of msgs) if (m.v != null) S.moodScored.set(`${m.mo}|${m.o}`, (S.moodScored.get(`${m.mo}|${m.o}`) || 0) + 1);
  }
  S.browserShown = shown;

  const frag = document.createDocumentFragment();
  const showWho = S.filter.contact === 'all' || S.filter.contact.startsWith('g:');
  let lastDay = null;
  for (const m of shown) {
    if (m.d !== lastDay) {
      lastDay = m.d;
      const sep = document.createElement('div');
      sep.className = 'day-sep';
      sep.textContent = dayLabel(m.d);
      frag.appendChild(sep);
    }
    const row = document.createElement('div');
    row.className = 'msg ' + (m.o ? 'sent' : 'recv');
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    const sender = !m.o && m.k.startsWith('g:') && (m.sn || m.sk) ? senderLabel(m.sn || m.sk) : '';
    if (showWho && (S.filter.contact === 'all' || sender)) {
      const who = document.createElement('div');
      who.className = 'who';
      if (S.filter.contact !== 'all') who.textContent = sender;
      else if (sender) who.textContent = `${sender} · ${labelFor(m.k)}`;
      else who.textContent = (m.o ? 'To ' : 'From ') + labelFor(m.k);
      bubble.appendChild(who);
    }
    if (m.b) {
      const body = document.createElement('div');
      body.className = 'body';
      body.textContent = m.b;
      bubble.appendChild(body);
    }
    if (m.att) bubble.appendChild(messageAttachments(m));
    // Sources without attachment references only know how many there were.
    const att = [];
    if (!m.att) {
      if (m.ph) att.push(`📷 ${m.ph > 1 ? m.ph + ' photos' : 'Photo'}`);
      if (m.gf) att.push(`🎞️ ${m.gf > 1 ? m.gf + ' GIFs' : 'GIF'}`);
      if (m.vd) att.push(`🎬 ${m.vd > 1 ? m.vd + ' videos' : 'Video'}`);
      if (m.au) att.push(`🎤 ${m.au > 1 ? m.au + ' audio clips' : 'Audio'}`);
      if (m.ot) att.push(`📎 ${m.ot > 1 ? m.ot + ' files' : 'File'}`);
    }
    if (att.length) {
      const a = document.createElement('div');
      a.className = 'att';
      a.textContent = att.join('  ');
      bubble.appendChild(a);
    }
    const time = document.createElement('div');
    time.className = 'time';
    if (S.showMood && m.v != null) {
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = `mood-pill ${moodKind(m.v)}`;
      pill.dataset.i = shown.indexOf(m);
      pill.textContent = fmtScore(m.v);
      pill.title = `Mood score ${fmtScore(m.v)} (${moodKind(m.v) === 'neu' ? 'neutral' : moodKind(m.v) === 'pos' ? 'positive' : 'negative'}). Click to see why.`;
      time.appendChild(pill);
    }
    time.append(new Date(m.t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }));
    bubble.appendChild(time);
    row.appendChild(bubble);
    frag.appendChild(row);
  }
  box.appendChild(frag);
  box.scrollTop = box.scrollHeight;
}

// ------------------------------------------------------------------ theme

function applyTheme(mode) {
  const root = document.documentElement;
  if (mode === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', mode);
  try { localStorage.setItem('ms-theme', mode); } catch (e) { /* storage unavailable */ }
  $('#themeBtn').textContent = { auto: '◐ Auto', light: '☀︎ Light', dark: '☾ Dark' }[mode];
  $('#themeBtn').dataset.mode = mode;
  if (!$('#dash').hidden) refresh();
}

// ------------------------------------------------------------------ events

function init() {
  let mode = 'auto';
  try { mode = localStorage.getItem('ms-theme') || 'auto'; } catch (e) { /* ignore */ }
  applyTheme(mode);
  $('#themeBtn').onclick = () => {
    const order = ['auto', 'light', 'dark'];
    applyTheme(order[(order.indexOf($('#themeBtn').dataset.mode) + 1) % 3]);
  };
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (!$('#dash').hidden) refresh();
  });

  $('#fileInput').onchange = (e) => loadFiles(e.target.files);
  $('#addInput').onchange = (e) => loadFiles(e.target.files);
  $('#demoBtn').onclick = () => loadFiles(buildDemoFiles());
  $$('[data-demo]').forEach((b) => { b.onclick = () => loadFiles(buildDemoFiles()); });

  // Drag & drop anywhere on the page
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; document.body.classList.add('dragging'); });
  window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); } });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    document.body.classList.remove('dragging');
    if (e.dataTransfer.files.length) loadFiles(e.dataTransfer.files);
  });

  $('#contactSel').onchange = (e) => setContact(e.target.value);
  $('#sourceSeg').onclick = (e) => {
    const v = e.target.dataset.source;
    if (v) setSource(v === 'all' ? 'all' : +v);
  };
  $('#groupsChk').onchange = (e) => {
    S.filter.groups = e.target.checked;
    refresh();
  };
  $('#fromDate').onchange = (e) => setRange(fromDateInput(e.target.value, false), S.filter.to);
  $('#toDate').onchange = (e) => setRange(S.filter.from, fromDateInput(e.target.value, true));
  $('#presets').onclick = (e) => {
    const p = e.target.dataset.preset;
    if (!p) return;
    if (p === 'all') return setRange(null, null);
    const { last } = dataBounds();
    const end = new Date(last);
    const days = { '30': 30, '90': 90, '365': 365 }[p];
    const from = new Date(end.getFullYear(), end.getMonth(), end.getDate() - days + 1).getTime();
    setRange(from, null);
  };
  $('#gapSeg').innerHTML = CONVO_GAPS.map((g) => `<button data-gap="${g}" title="A conversation ends after ${fmtGapWords(g)} of quiet">${fmtGapShort(g)}</button>`).join('');
  $('#gapSeg').onclick = (e) => {
    const g = +e.target.dataset.gap;
    if (!g) return;
    S.convoGap = g;
    refresh({ timeline: false });
  };
  $('#granSeg').onclick = (e) => {
    const g = e.target.dataset.gran;
    if (!g) return;
    S.gran = g;
    renderTimeline(S.ui, baseMessages());
  };

  $('#peopleInput').oninput = (e) => {
    clearTimeout(S.peopleTimer);
    S.peopleTimer = setTimeout(() => setPeople(e.target.value), 200);
  };

  $('#leaderTable').onclick = (e) => {
    const th = e.target.closest('th');
    if (th) {
      const key = th.dataset.key;
      const col = LEADER_COLS.find((c) => c.key === key);
      if (S.leader.sort === key) S.leader.asc = !S.leader.asc;
      else S.leader = { ...S.leader, sort: key, asc: !!col.asc };
      refresh({ timeline: false });
      return;
    }
    const tr = e.target.closest('tbody tr');
    if (tr) openProfile(tr.dataset.key);
  };
  $('#leaderMore').onclick = () => {
    S.leader.all = !S.leader.all;
    refresh({ timeline: false });
  };
  $('#driftList').onclick = (e) => {
    const li = e.target.closest('li[data-key]');
    if (li) openProfile(li.dataset.key);
  };
  $('#wrapSave').onclick = saveWrapped;
  initGlance();
  initMoodDetails();
  initViewer();
  initGallery();
  observeLazySections();

  $('#search').oninput = (e) => {
    clearTimeout(S.searchTimer);
    S.searchTimer = setTimeout(() => {
      S.browserQuery = e.target.value;
      S.browserLimit = 200;
      renderBrowser(inRange(baseMessages()));
    }, 200);
  };
  $('#phraseIdeas').innerHTML = PHRASE_IDEAS.map((p) => `<button type="button" class="btn small">${escapeHtml(p)}</button>`).join('');
  $('#phraseIdeas').onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    $('#phraseInput').value = S.phrase = b.textContent;
    renderPhrase();
  };
  $('#vocabWords').onclick = (e) => {
    const b = e.target.closest('[data-word]');
    if (!b) return;
    $('#phraseInput').value = S.phrase = b.dataset.word;
    renderPhrase();
    $('#phraseCard').scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  $('#phraseGranSeg').onclick = (e) => {
    const g = e.target.dataset.gran;
    if (!g) return;
    S.phraseGran = g;
    renderPhrase();
  };
  $('#phraseInput').oninput = (e) => {
    clearTimeout(S.phraseTimer);
    S.phraseTimer = setTimeout(() => {
      S.phrase = e.target.value;
      renderPhrase();
    }, 250);
  };
  $('#moreBtn').onclick = () => {
    const box = $('#messages');
    const fromBottom = box.scrollHeight - box.scrollTop;
    S.browserLimit += 500;
    renderBrowser(inRange(baseMessages()));
    box.scrollTop = box.scrollHeight - fromBottom;
  };

}

/** Chart instances are created lazily by Charts.set, so event handlers are attached once they exist. */
function wireCharts() {
  const tl = Charts.get('c-timeline');
  if (tl && !tl.__wired) {
    tl.__wired = true;
    tl.on('datazoom', onTimelineZoom);
    tl.on('restore', () => setRange(null, null));
  }
  const clickToFocus = (id, rows) => {
    const chart = Charts.get(id);
    if (!chart || chart.__wired) return;
    chart.__wired = true;
    chart.on('click', (p) => {
      const row = rows()[p.dataIndex];
      if (row && S.filter.contact === 'all') setContact(row.key);
    });
  };
  clickToFocus('c-contacts', () => S.topRows);
  clickToFocus('c-call-contacts', () => S.callRows);
}

document.addEventListener('DOMContentLoaded', init);
