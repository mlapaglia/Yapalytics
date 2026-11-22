/* UI wiring: file loading, filters, KPIs, chart rendering, message browser. */

const S = {
  msgs: [],
  calls: [],
  contacts: new Map(), // key -> { key, name, addr, group, lastT, s, label }; linked people (spec 005) add { person: true, threads, sources }
  people: new Map(), // person key -> { key, name, threads }: saved links (spec 005), loaded or not; name '' = the default
  personOf: new Map(), // conversation key -> person key, for the links that apply to what's loaded
  dismissed: new Set(), // signatures (linkSignature) of dismissed link suggestions
  suggestions: [], // suggestLinks result behind the People dialog
  seenMsgs: new Map(), // dedupe key -> the message kept (null for reactions sent as texts)
  seenCalls: new Set(),
  reactions: 0, // reactions sent as texts, left out of the messages
  filesBusy: 0, // file loads and Files dialog changes queued or running (spec 006 R15)
  filesPending: 0, // files added in the open Files dialog that are still being checked
  files: [], // loaded export files (spec 006): { id, file, name, size, lastModified, kind, on }, in the order added
  filesDraft: [], // the Files dialog's edited copy of `files` (rows it adds also have `added`, unreadable ones `error`)
  filter: { contact: 'all', source: 'all', groups: true, from: null, to: null },
  // Your sender name per app whose records carry sender names (Sources: senderNames);
  // `auto` is false once picked by hand.
  owners: Object.fromEntries(Sources.list.filter((s) => s.senderNames).map((s) => [s.id, { name: '', auto: true }])),
  firstSeen: new Map(), // key -> time of the first message ever loaded for that conversation
  archives: [], // loaded export files (zips, SMS XML); message attachments point into these by index (att.z)
  docFreq: null, // { sig, value } cache for "What you talk about"
  leader: { sort: 'n', asc: false, all: false }, // leaderboard sorting
  wrapYear: null,
  gran: 'auto',
  activeGran: 'month',
  convoGap: CONVO_GAP, // silence that ends a conversation (picked on the Conversation length card)
  appsGap: APPS_GAP, // the same, for the Across apps tab only (spec 007 R7)
  calYear: null,
  topRows: [],
  callRows: [],
  browserLimit: 200,
  browserQuery: '',
  browserMood: null, // { mo, o (null = both), kind: 'pos' | 'neg' | 'any' } picked on the mood chart
  showMood: false, // mood scores on the messages
  igPreviews: false, // load Instagram's embeds of shared posts (spec 004, opt-in, saved in localStorage)
  moodScorer: 'vader', // 'vader' | 'ai' (spec 001): which scores the mood chart and pills use
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

let fileSeq = 0;
/** An entry in S.files (spec 006) for `file` of `kind` (detectFile's result). */
const fileEntry = (file, kind) => ({ id: ++fileSeq, file, name: file.name, size: file.size, lastModified: file.lastModified, kind, on: true });

/**
 * Changes to the loaded files run one at a time, each against what the last one left
 * (R15): a read that's still going can't be overtaken by a later change and then commit
 * its stale file list over it. The Files button is disabled meanwhile.
 */
let fileOps = Promise.resolve();
function queueFileOp(op) {
  S.filesBusy++;
  updateFilesButton();
  fileOps = fileOps.then(op).catch((err) => console.error(err)).finally(() => {
    S.filesBusy--;
    updateFilesButton();
  });
  return fileOps;
}

/** Load files from the landing page, a drop or the demo: they join S.files, checked. */
function loadFiles(fileList) {
  const picked = [...fileList]; // a drop's file list is emptied once the event is over
  return queueFileOp(async () => {
    const files = picked.filter((f, i, all) =>
      f.size > 0 && !S.files.some((e) => sameFile(e, f)) && all.findIndex((g) => sameFile(g, f)) === i);
    if (!files.length) return;
    showProgress();
    let entries;
    try {
      const kinds = await Promise.all(files.map(detectFile));
      entries = files.map((f, i) => fileEntry(f, kinds[i]));
    } catch (err) {
      console.error(err);
      showLoadError('Could not read that file: ' + err.message);
      return;
    }
    await applyFiles([...S.files, ...entries]);
  });
}

function showProgress() {
  $('#landing').hidden = false;
  $('#drop').hidden = true;
  $('#progress').hidden = false;
  $('#loadError').hidden = true;
}

/**
 * Parse S.files entries and merge what they hold into the loaded data, deduplicating
 * against what's already there. Null when that worked; otherwise `{ error, failed }`, the
 * message and the files that couldn't be read (the failing parse job's, or all of them
 * when nothing at all is loaded). A failed read leaves the loaded data half-merged: the
 * caller reads the remaining files again (see applyFiles).
 */
async function readFiles(entries) {
  const bar = $('#progressBar');
  const text = $('#progressText');

  let badDates = ''; // an app's message when its dates couldn't be read
  let job = null;

  try {
    // One job per file or per app (Sources: jobs). Attachments point at their file by
    // index into the job's files (att.z); attBase moves that into S.archives.
    const jobs = [];
    for (const src of Sources.list) {
      const files = entries.filter((e) => e.kind === src.kind).map((e) => e.file);
      if (!files.length) continue;
      for (const group of src.jobs === 'each' ? files.map((f) => [f]) : [files]) {
        const job = { files: group, src, parse: (cb) => src.parse(group, cb) };
        if (src.archives) {
          job.attBase = S.archives.length;
          S.archives.push(...group);
        }
        jobs.push(job);
      }
    }

    for (let i = 0; i < jobs.length; i++) {
      job = jobs[i];
      const label = job.files.length > 1 ? `${job.files.length} files` : job.files[0].name;
      const done = await job.parse({
        onBatch(msgs, calls) {
          for (const m of msgs) {
            // WhatsApp / iMessage / Telegram / Instagram / Messenger records get `o` later (see applyOwners), so key them by sender.
            const key = `${m.t}|${hasOwner(m.s) ? m.sn : m.o}|${m.k}|${m.l}|${m.m}`;
            const seen = S.seenMsgs.get(key);
            if (seen !== undefined) {
              // The same message in an overlapping export: keep the reactions both list, and
              // its files if only this copy can open them (a thread file read before its zip).
              if (seen && m.rx) seen.rx = mergeReactions(seen.rx, m.rx);
              if (seen && m.att && !seen.att) {
                if (job.attBase) for (const a of m.att) if (a.z != null) a.z += job.attBase;
                seen.att = m.att;
                seen.mb = m.mb;
              }
              continue;
            }
            // Reactions sent as texts (tapbacks, "😂 to “…”") aren't messages. Reactions
            // on a message (Instagram, Messenger, Telegram, Google Chat) ride along in its rx.
            if (m.f & T_REACTION) { S.seenMsgs.set(key, null); S.reactions++; continue; }
            S.seenMsgs.set(key, m);
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
      if (job.src.badDatesError && done.counts.badDates) badDates = job.src.badDatesError;
    }
  } catch (err) {
    console.error(err);
    return { error: 'Could not read that file: ' + err.message, failed: job ? job.files : entries.map((e) => e.file) };
  }

  if (!S.msgs.length && !S.calls.length) {
    return {
      error: badDates || 'No messages or calls were found. Use an XML backup from SMS Backup & Restore (sms-*.xml or calls-*.xml), a Google Takeout zip that includes Google Chat, a WhatsApp chat export (.txt or .zip), an iMessage export, a Telegram export (result.json, or a zip of the export folder), an Instagram export (.zip, JSON format), or a Facebook Messenger export (.zip, JSON format, or the encrypted chats download).',
      failed: entries.map((e) => e.file),
    };
  }
  return null;
}

/** After files are read: sort, work out owners and links, keep the filters that still apply, and show the dashboard. */
function finishLoad() {
  S.msgs.sort((a, b) => a.t - b.t);
  S.calls.sort((a, b) => a.t - b.t);
  S.firstSeen = computeFirstSeen();
  S.docFreq = null;
  $('#igPreviewsLabel').hidden = !S.msgs.some((m) => m.sh && instagramEmbedUrl(m.sh.u));
  for (const c of S.contacts.values()) c.label = contactLabel(c);
  for (const s of Object.keys(S.owners)) if (S.owners[s].auto) S.owners[s].name = guessOwner(+s);
  applyOwners();
  applyLinks();
  // Files were left out or removed (spec 006 R10): an app or conversation that's gone goes back to All.
  const f = S.filter;
  if (f.source !== 'all' && !loadedSources().has(f.source)) f.source = 'all';
  if (f.contact !== 'all' && (!S.contacts.has(f.contact) || (f.source !== 'all' && !keySources(f.contact).includes(f.source)))) f.contact = 'all';
  $('#landing').hidden = true;
  $('#dash').hidden = false;
  populateContacts();
  refresh();
}

/**
 * Forget everything read from files (not the settings, filters or links), before reading
 * the checked files again. An AI report may describe messages that are gone (R11); AI
 * mood scores come back from AiMood.known as the charts draw.
 */
function resetLoaded() {
  if (AiAnalysis.busy) AiAnalysis.stop();
  AiAnalysis.clearReport();
  $('#dash').hidden = true; // its data is gone until the files are read again
  S.msgs = [];
  S.calls = [];
  S.contacts = new Map();
  S.personOf = new Map();
  S.seenMsgs = new Map();
  S.seenCalls = new Set();
  S.reactions = 0;
  S.firstSeen = new Map();
  S.docFreq = null;
  S.vocab = null;
  S.vocabMo = null;
  S.browserMood = null;
  S.browserLimit = 200;
  // S.archives stays: it's append-only, so an attachment index (att.z) from before never
  // points at a different file. Attachment previews are cached by that index.
}

/** Back to the landing page with nothing loaded (every file removed, spec 006 R9). */
function showLanding() {
  S.filter.contact = 'all';
  S.filter.source = 'all';
  $('#dash').hidden = true;
  $('#landing').hidden = false;
  $('#progress').hidden = true;
  $('#loadError').hidden = true;
  $('#drop').hidden = false;
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
  if (c.person) return '🔗 ' + contactName(c);
  const chat = Sources.byId(c.s).mark;
  if (c.group) return chat + '👥 ' + contactName(c);
  return (chat ? chat + ' ' : '') + contactName(c);
}

/** A conversation's name without the app and group marks (the pickers draw those, spec 012 R7). */
function contactName(c) {
  if (c.person) return formatAddr(c.name) || c.key;
  if (c.group) return (c.name ? c.name.split(', ') : c.addr.split('~')).map(formatAddr).join(', ');
  return formatAddr(c.name) || formatAddr(c.addr) || c.key;
}

function loadedSources() {
  return new Set([...S.contacts.values()].filter((c) => !c.person).map((c) => c.s || 0));
}

/**
 * Message sources of a conversation key (0 = SMS, 1 = Google Chat, 2 = WhatsApp,
 * 3 = iMessage, 4 = Telegram, 5 = Instagram): one, or several for a linked person.
 */
function keySources(key) {
  const c = S.contacts.get(key);
  return c && c.person ? c.sources : [(c && c.s) || 0];
}

// ------------------------------------------------------------------ export owner (WhatsApp, iMessage, Telegram, Instagram, Messenger)

const sameName = (a, b) => a.replace(/[\s~]/g, '').toLowerCase() === b.replace(/[\s~]/g, '').toLowerCase();

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

/** Set sent/received on WhatsApp / iMessage / Telegram / Instagram / Messenger records from S.owners, and update the Which one is you? dialog. */
function applyOwners() {
  for (const m of S.msgs) if (hasOwner(m.s)) m.o = m.sn === S.owners[m.s].name || isDefaultOwner(m.s, m.sn) ? 1 : 0;
  for (const c of S.contacts.values()) c.search = contactSearchText(c);
  const sources = Object.keys(S.owners).map(Number).filter((s) => ownerChoices(s).length);
  renderOwnerDialog(sources);
  updateOwnerButton(sources);
}

// ------------------------------------------------------------------ which one is you (spec 013)

/** An app's sender names with their message counts, most first. Empty when there's nothing to pick (every conversation names you "Me"). */
function ownerChoices(source) {
  const names = new Map();
  for (const c of ownerPool(source)) for (const [n, k] of c.members) names.set(n, (names.get(n) || 0) + k);
  return [...names.entries()].sort((a, b) => b[1] - a[1]);
}

/** Where an app's owner came from: the export's own profile, a guess, or your pick (R6). */
function ownerOrigin(source) {
  const { name, auto } = S.owners[source];
  if (!auto) return 'picked';
  return ownerPool(source).some((c) => c.owner && c.owner === name) ? 'export' : 'guess';
}
const OWNER_ORIGIN_TEXT = { export: 'From your export profile', guess: 'Guessed: check this', picked: 'Picked by you' };

/**
 * One row per app with senders to pick. Rows are rebuilt only when the apps or their
 * names change; picking a name only updates the row's value and origin, so focus stays
 * in the dialog.
 */
function renderOwnerDialog(sources) {
  const list = $('#ownerList');
  const sig = JSON.stringify(sources.map((s) => [s, ownerChoices(s)]));
  if (list.dataset.sig !== sig) {
    list.dataset.sig = sig;
    for (const sel of list.querySelectorAll('select')) sel.tomselect?.destroy();
    list.innerHTML = '';
    for (const s of sources) {
      const li = document.createElement('li');
      li.className = 'owner-row';
      li.dataset.source = s;
      li.dataset.app = sourceName(s);
      li.innerHTML = html`<label class="owner-app" for="owner-${s}">${logoSvg(s)}${sourceName(s)}</label>
        <div class="owner-pick"><select id="owner-${s}"></select><span class="owner-origin"></span></div>`;
      const sel = li.querySelector('select');
      for (const [n, k] of ownerChoices(s)) {
        const opt = new Option(n, n);
        Object.assign(opt.dataset, { search: n.toLowerCase(), name: n, count: fmtNum(k), aria: `${n}, ${countWords(k)}` });
        sel.add(opt);
      }
      sel.value = S.owners[s].name;
      list.appendChild(li); // before makePicker, so it finds the <label for>
      // An app always has an owner, so Backspace can't empty the picker (as for #contactSel).
      if (makePicker(sel, { onDelete: () => false })) sel.tomselect.control_input.placeholder = 'Search names';
      sel.onchange = () => setOwner(s, sel.value);
    }
  }
  for (const li of list.children) {
    const s = +li.dataset.source;
    setPickerValue(li.querySelector('select'), S.owners[s].name);
    const origin = ownerOrigin(s);
    const note = li.querySelector('.owner-origin');
    note.className = `owner-origin ${origin}`;
    note.textContent = OWNER_ORIGIN_TEXT[origin];
  }
}

/** Shown when an app has senders to pick; counts the apps whose owner is only a guess (R2, R9). */
function updateOwnerButton(sources) {
  const btn = $('#ownerBtn');
  const guessed = sources.filter((s) => ownerOrigin(s) === 'guess');
  btn.hidden = !sources.length;
  btn.textContent = guessed.length ? `👤 Which one is you? (${guessed.length})` : '👤 Which one is you?';
  btn.title = guessed.length
    ? `Check ${andList(guessed.map((s) => sourceName(s)))}: who's you was guessed`
    : "Pick which sender is you in apps whose exports don't say";
}

function initOwners() {
  const dlg = $('#ownerDlg');
  $('#ownerBtn').onclick = () => { if (!dlg.open) dlg.showModal(); };
  dlg.querySelector('.profile-close').onclick = () => dlg.close();
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); }); // the backdrop
}

function setOwner(source, name) {
  S.owners[source] = { name, auto: false };
  applyOwners();
  populateContacts();
  refresh();
}

/**
 * Lowercased text the conversation pickers search (spec 012 R1): the conversation's name and
 * addresses plus, for groups, every member's name. SMS group keys are 'g:' + the
 * members' 1-on-1 keys, so members' names come from their own contacts.
 */
function contactSearchText(c) {
  if (c.person) {
    return [c.label, c.name, ...c.threads.map((k) => S.contacts.get(k)).filter(Boolean).map(contactSearchText)].filter(Boolean).join('\n').toLowerCase();
  }
  const parts = [c.label, c.name, ...c.addr.split('~').filter((n) => !hasOwner(c.s) || (n !== S.owners[c.s].name && !isDefaultOwner(c.s, n)))];
  if (c.group && !c.s) {
    for (const k of c.key.slice(2).split('~')) {
      const member = S.contacts.get(k);
      if (member) parts.push(member.name, member.addr);
    }
  }
  return parts.filter(Boolean).join('\n').toLowerCase();
}

function labelFor(key) {
  const c = S.contacts.get(key);
  return c ? c.label : key;
}

// ------------------------------------------------------------------ linked people (spec 005)

const PEOPLE_STORE = 'ms-people';
/** A person's key: 'p:' + the first of its conversation keys, so it stays the same across reloads. */
const personKeyOf = (threads) => 'p:' + [...threads].sort()[0];
/** A conversation's own name, formatted: what its person can be called. */
const threadName = (c) => formatAddr(c.name) || formatAddr(c.addr) || c.key;
const isLinkable = (c) => !!c && !c.group && !c.person && c.key !== 'unknown';
const andList = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const REASON_TEXT = { name: 'name', phone: 'phone number', email: 'email' };

function readPeopleStore() {
  S.people = new Map();
  S.dismissed = new Set();
  let data = null;
  try { data = JSON.parse(localStorage.getItem(PEOPLE_STORE) || 'null'); } catch (e) { /* storage unavailable, or not ours */ }
  if (!data || data.v !== 1) return;
  for (const p of Array.isArray(data.people) ? data.people : []) {
    const threads = Array.isArray(p && p.threads) ? [...new Set(p.threads.filter((k) => typeof k === 'string'))] : [];
    if (threads.length > 1) putPerson(threads, typeof p.name === 'string' ? p.name : '');
  }
  for (const d of Array.isArray(data.dismissed) ? data.dismissed : []) if (typeof d === 'string') S.dismissed.add(d);
}

function writePeopleStore() {
  const people = [...S.people.values()].map(({ name, threads }) => ({ name, threads }));
  try {
    if (people.length || S.dismissed.size) localStorage.setItem(PEOPLE_STORE, JSON.stringify({ v: 1, people, dismissed: [...S.dismissed] }));
    else localStorage.removeItem(PEOPLE_STORE);
  } catch (e) { /* storage unavailable: links last until the page closes */ }
}

function putPerson(threads, name) {
  const key = personKeyOf(threads);
  S.people.set(key, { key, name, threads: [...threads].sort() });
}

/** The saved person a conversation belongs to, loaded or not. */
function savedPersonOf(threadKey) {
  for (const p of S.people.values()) if (p.threads.includes(threadKey)) return p;
  return null;
}

/** Messages per conversation, by the key each had before any link (calls-only conversations count 0). */
function threadCounts() {
  const n = new Map();
  for (const m of S.msgs) { const k = m.tk || m.k; n.set(k, (n.get(k) || 0) + 1); }
  for (const c of S.calls) { const k = c.tk || c.k; if (!n.has(k)) n.set(k, 0); }
  return n;
}

/**
 * Apply the saved links to what's loaded: a person with 2+ loaded conversations gets a
 * contact, and its messages and calls carry its key in `k` (the conversation's own key
 * moves to `tk`). Everything that groups by `k` then sees one conversation.
 */
function applyLinks() {
  for (const [k, c] of S.contacts) if (c.person) S.contacts.delete(k);
  const counts = threadCounts();
  S.personOf = new Map();
  for (const p of S.people.values()) {
    const parts = p.threads.filter((k) => counts.has(k)).map((k) => S.contacts.get(k)).filter(isLinkable);
    if (parts.length < 2) continue;
    const names = parts.map(threadName);
    const name = p.name && names.includes(p.name) ? p.name : defaultPersonName(parts.map((c) => ({ s: c.s, name: threadName(c), n: counts.get(c.key) })));
    for (const c of parts) S.personOf.set(c.key, p.key);
    S.contacts.set(p.key, {
      key: p.key, name, addr: '', group: false, person: true, members: [],
      threads: parts.map((c) => c.key),
      sources: [...new Set(parts.map((c) => c.s || 0))].sort((a, b) => a - b),
      lastT: Math.max(...parts.map((c) => c.lastT || 0)),
    });
  }
  const relink = (r) => {
    const own = r.tk || r.k;
    const p = S.personOf.get(own);
    if (p) { r.tk = own; r.k = p; } else if (r.tk) { r.k = r.tk; delete r.tk; }
  };
  for (const m of S.msgs) relink(m);
  for (const c of S.calls) relink(c);
  for (const c of S.contacts.values()) if (c.person) c.label = contactLabel(c);
  for (const c of S.contacts.values()) c.search = contactSearchText(c);
  S.firstSeen = computeFirstSeen();
  S.docFreq = null;
  const sel = S.filter.contact;
  if (S.personOf.has(sel)) S.filter.contact = S.personOf.get(sel);
  else if (sel.startsWith('p:') && !S.contacts.has(sel)) S.filter.contact = 'all';
}

/** Loaded 1-on-1 conversations, their message counts, and the links worth suggesting. */
function computeSuggestions() {
  S.threadN = threadCounts();
  S.linkable = [...S.threadN.keys()].map((k) => S.contacts.get(k)).filter(isLinkable);
  S.suggestions = suggestLinks(S.linkable, {
    personOf: S.personOf,
    dismissed: S.dismissed,
    ownNames: (s) => (hasOwner(s) ? [S.owners[s].name] : []),
  });
}

function updatePeopleButton() {
  computeSuggestions();
  const btn = $('#peopleBtn');
  const n = S.suggestions.length;
  btn.hidden = S.linkable.length < 2;
  btn.textContent = n ? `🔗 Link people (${n})` : '🔗 Link people';
  btn.title = n ? `${n} possible link${n === 1 ? '' : 's'} between conversations with the same person` : "Tie one person's conversations on different apps together";
  if ($('#peopleDlg').open) renderPeopleDialog();
}

/** Change the saved links, then show the dashboard with them. */
function changeLinks(fn) {
  fn();
  writePeopleStore();
  applyLinks();
  populateContacts(); // also re-renders the People dialog
  refresh();
}

/** One person out of these conversations and any people they already belong to. */
function linkThreads(keys) {
  const all = new Set(keys);
  let name = '';
  for (const k of keys) {
    const p = savedPersonOf(k);
    if (!p) continue;
    for (const t of p.threads) all.add(t);
    name = name || p.name;
    S.people.delete(p.key);
  }
  if (all.size > 1) putPerson([...all], name);
}

function unlinkThread(key) {
  const p = savedPersonOf(key);
  if (!p) return;
  S.people.delete(p.key);
  const rest = p.threads.filter((k) => k !== key);
  if (rest.length > 1) putPerson(rest, p.name);
}

function threadChip(key, extra = '') {
  const c = S.contacts.get(key);
  return html`<span class="chip person-chip">${threadName(c)} <small>${sourceName(c.s)} · ${fmtNum(S.threadN.get(key) || 0)}</small>${extra}</span>`;
}

function renderPeopleDialog() {
  const sug = S.suggestions;
  $('#peopleSuggest').innerHTML = html`<h3 class="profile-h">Suggestions</h3>${sug.length
    ? html`<ul class="people-list">${sug.map((x, i) => html`<li>
        <div class="chips">${x.keys.map((k) => threadChip(k))}</div>
        <span class="meta">Same ${x.reasons.map((r) => REASON_TEXT[r]).join(' and ')}</span>
        <span class="people-actions"><button class="btn small primary" type="button" data-accept="${i}">Link</button><button class="btn small ghost" type="button" data-dismiss="${i}">Dismiss</button></span>
      </li>`)}</ul>`
    : html`<p class="sub">Nothing to suggest. Conversations that share a name, phone number or email show up here.</p>`}`;

  const linked = [...S.contacts.values()].filter((c) => c.person).sort((a, b) => a.name.localeCompare(b.name));
  const unloaded = S.people.size - linked.length;
  $('#peopleLinked').innerHTML = html`<h3 class="profile-h">Linked people</h3>${linked.length
    ? html`<ul class="people-list">${linked.map((p) => {
      const names = [...new Set(p.threads.map((k) => threadName(S.contacts.get(k))))];
      return html`<li data-person="${p.key}">
        <select class="person-name" aria-label="Name for this person">${names.map((n) => html`<option${n === p.name ? raw(' selected') : ''}>${n}</option>`)}</select>
        <div class="chips">${p.threads.map((k) => threadChip(k, html`<button type="button" class="chip-x" data-unlink="${k}" aria-label="Unlink ${threadName(S.contacts.get(k))}" title="Unlink">✕</button>`))}</div>
        <button class="btn small ghost" type="button" data-unlink-all="${p.key}">Unlink all</button>
      </li>`;
    })}</ul>`
    : html`<p class="sub">None yet.</p>`}${unloaded > 0 ? html`<p class="sub">${fmtNum(unloaded)} more saved link${unloaded === 1 ? ' is' : 's are'} for conversations that aren't loaded.</p>` : ''}`;

  const linkable = [...S.linkable].sort((a, b) => threadName(a).localeCompare(threadName(b)));
  for (const sel of [$('#peopleA'), $('#peopleB')]) {
    const keep = sel.value;
    sel.innerHTML = '<option value="">Choose a conversation…</option>';
    for (const c of linkable) {
      const n = S.threadN.get(c.key) || 0;
      sel.add(pickerOption(c, `${threadName(c)} (${sourceName(c.s)}, ${fmtNum(n)})`, fmtNum(n), countWords(n)));
    }
    sel.value = S.linkable.some((c) => c.key === keep) ? keep : '';
    refreshPicker(sel);
  }
  syncPeopleLink();
}

function syncPeopleLink() {
  const a = $('#peopleA').value;
  const b = $('#peopleB').value;
  const same = a && S.personOf.has(a) && S.personOf.get(a) === S.personOf.get(b);
  $('#peopleLink').disabled = !a || !b || a === b || !!same;
}

/** Open the People dialog, with `preselect` (a conversation key) picked for linking by hand. */
function openPeopleDialog(preselect) {
  computeSuggestions();
  renderPeopleDialog();
  if (preselect && S.linkable.some((c) => c.key === preselect)) {
    setPickerValue($('#peopleA'), preselect);
    syncPeopleLink();
  }
  const dlg = $('#peopleDlg');
  if (!dlg.open) dlg.showModal();
}

function initPeople() {
  readPeopleStore();
  const dlg = $('#peopleDlg');
  // Their options come later, so the empty option can't give the placeholder yet.
  for (const sel of [$('#peopleA'), $('#peopleB')]) makePicker(sel, { placeholder: 'Choose a conversation…' });
  $('#peopleBtn').onclick = () => openPeopleDialog();
  dlg.querySelector('.profile-close').onclick = () => dlg.close();
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) { dlg.close(); return; } // the backdrop
    const t = e.target.closest('[data-accept], [data-dismiss], [data-unlink], [data-unlink-all]');
    if (!t) return;
    const d = t.dataset;
    if (d.accept != null) {
      const x = S.suggestions[+d.accept];
      if (x) changeLinks(() => linkThreads(x.keys));
    } else if (d.dismiss != null) {
      const x = S.suggestions[+d.dismiss];
      if (x) changeLinks(() => S.dismissed.add(linkSignature(x.keys)));
    } else if (d.unlink) changeLinks(() => unlinkThread(d.unlink));
    else if (d.unlinkAll) changeLinks(() => S.people.delete(d.unlinkAll));
  });
  dlg.addEventListener('change', (e) => {
    if (e.target.matches('select.person-name')) {
      const p = S.people.get(e.target.closest('[data-person]').dataset.person);
      if (p) changeLinks(() => { p.name = e.target.value; });
    } else if (e.target.id === 'peopleA' || e.target.id === 'peopleB') syncPeopleLink();
  });
  $('#peopleLink').onclick = () => {
    const keys = [$('#peopleA').value, $('#peopleB').value];
    setPickerValue($('#peopleA'), '');
    setPickerValue($('#peopleB'), '');
    changeLinks(() => linkThreads(keys));
  };
  $('#peopleForget').onclick = () => changeLinks(() => { S.people.clear(); S.dismissed.clear(); });
  // Another tab changed the links (R10): take its version, so this tab's next change
  // can't write back links that were forgotten there.
  window.addEventListener('storage', (e) => {
    if (e.key !== PEOPLE_STORE && e.key !== null) return; // null: all of the site's storage was cleared
    readPeopleStore();
    if ($('#dash').hidden) return;
    applyLinks();
    populateContacts();
    refresh();
  });
}

// ------------------------------------------------------------------ loaded files (spec 006)

/** A thread file on its own, whose app is a guess the user can change (spec 009 R13). */
const isGuessedThread = (e) => !e.error && !!Sources.byKind(e.kind)?.metaFormat && /^message_\d+\.json$/i.test(e.name);

/** The filter bar's Files button: how many files are loaded, and how many are in use (R1). Off while files are read (R15). */
function updateFilesButton() {
  const n = S.files.length;
  const on = S.files.filter((e) => e.on).length;
  const btn = $('#filesBtn');
  btn.textContent = `📁 Files (${on === n ? n : `${on} of ${n}`})`;
  btn.disabled = S.filesBusy > 0;
}

function openFilesDialog() {
  if (S.filesBusy) return;
  // The dialog edits a copy; Apply compares it with S.files, closing throws it away (R6).
  // Each opening gets a new array, so files still being checked for a closed one can't land here.
  S.filesDraft = S.files.map((e) => ({ ...e }));
  S.filesPending = 0;
  renderFilesDialog();
  const dlg = $('#filesDlg');
  if (!dlg.open) dlg.showModal();
}

function renderFilesDialog() {
  const draft = S.filesDraft;
  $('#filesList').innerHTML = draft.length
    ? html`${draft.map((e) => {
      const name = e.name;
      const mark = e.error
        ? html`<span class="files-warn" aria-hidden="true">⚠</span>`
        : html`<svg class="logo" aria-hidden="true"><use href="#logo-${Sources.byKind(e.kind).logo}"/></svg>`;
      // A thread file on its own could be either app: say which it's read as, and let the user change it (spec 009 R13).
      const app = isGuessedThread(e)
        ? html`<select class="files-app" aria-label="App for ${name}">${Sources.list.filter((src) => src.metaFormat).map((src) => html`<option value="${src.kind}"${e.kind === src.kind ? raw(' selected') : ''}>${src.name}</option>`)}</select>`
        : '';
      return html`<li data-file="${e.id}"${e.on ? '' : raw(' class="off"')}>
        <label class="files-pick"><input type="checkbox"${e.on ? raw(' checked') : ''}${e.error ? raw(' disabled') : ''}>${mark}<span class="files-name">${name}</span>${e.added ? html`<small class="files-new">new</small>` : ''}</label>
        ${app}<span class="files-size">${fmtBytes(e.size)}</span>
        <button class="chip-x files-x" type="button" data-remove="${e.id}" aria-label="Remove ${name}" title="Remove">✕</button>
        ${e.error ? html`<p class="files-error">${e.error}</p>` : ''}
      </li>`;
    })}`
    : html`<li class="files-empty">No files. Add some, or apply to start over.</li>`;
  syncFilesActions();
}

/** The hint and Apply, from the draft. Apply waits for added files still being checked (R6). */
function syncFilesActions() {
  const usable = S.filesDraft.filter((e) => !e.error);
  $('#filesHint').hidden = !(usable.length && !usable.some((e) => e.on));
  $('#filesApply').disabled = S.filesPending > 0 || !canApplyFiles(S.files, S.filesDraft);
}

/** Add files to the dialog's list as pending rows, checked, or marked with why they can't be read (R5, R8). */
async function addToDraft(fileList) {
  const draft = S.filesDraft;
  const files = [...fileList].filter((f, i, all) =>
    f.size > 0 && !draft.some((e) => sameFile(e, f)) && all.findIndex((g) => sameFile(g, f)) === i);
  if (!files.length) return;
  S.filesPending++;
  syncFilesActions();
  const entries = await Promise.all(files.map(async (f) => {
    try {
      return { ...fileEntry(f, await detectFile(f)), added: true };
    } catch (err) {
      return { ...fileEntry(f, null), on: false, error: err.message, added: true };
    }
  }));
  if (draft !== S.filesDraft) return; // the dialog was opened again since
  S.filesPending--;
  // Picked twice before the first pick's kinds were known: keep one row.
  draft.push(...entries.filter((e) => !draft.some((d) => sameFile(d, e))));
  renderFilesDialog();
}

/**
 * Make the loaded files match `draft` (the dialog's list, or S.files plus new files). A
 * file that fails to read is left out, and the dashboard goes back to exactly the checked
 * files that can be read (R14), so nothing stays loaded that the dialog can't take out.
 */
async function applyFiles(draft) {
  const plan = planFileChanges(S.files, draft);
  if (!plan.changed) return;
  let next = draft.filter((e) => !e.error).map(({ added, ...e }) => e);
  if (!plan.read.length && !plan.rebuild) {
    S.files = next; // only unchecked files removed
    updateFilesButton();
    return;
  }
  // A rebuild starts from nothing, so content another checked file also has stays (R7).
  if (plan.rebuild) resetLoaded();
  let read = plan.read;
  let error = '';
  while (read.length) {
    showProgress();
    const failure = await readFiles(read);
    if (!failure) break;
    error = failure.error;
    next = next.filter((e) => !failure.failed.includes(e.file));
    resetLoaded();
    read = next.filter((e) => e.on);
  }
  if (!read.length) {
    // Every file removed (R9), or none of the checked ones could be read.
    S.files = [];
    showLanding();
    if (error) showLoadError(error);
    return;
  }
  S.files = next;
  finishLoad();
  if (error) showLoadError(error);
}

function initFiles() {
  const dlg = $('#filesDlg');
  $('#filesBtn').onclick = openFilesDialog;
  dlg.querySelector('.profile-close').onclick = () => dlg.close();
  $('#filesCancel').onclick = () => dlg.close();
  $('#filesApply').onclick = () => {
    const draft = S.filesDraft;
    dlg.close();
    queueFileOp(() => applyFiles(draft));
  };
  $('#addFilesBtn').onclick = () => $('#addInput').click();
  $('#addInput').onchange = (e) => {
    addToDraft(e.target.files);
    e.target.value = ''; // so picking the same file again fires change
  };
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) { dlg.close(); return; } // the backdrop
    const x = e.target.closest('[data-remove]');
    if (!x) return;
    // In place: files still being checked are added to this same array.
    const draft = S.filesDraft;
    const i = draft.findIndex((d) => d.id === +x.dataset.remove);
    if (i < 0) return;
    draft.splice(i, 1);
    renderFilesDialog();
    // Keep the keyboard where it was: the next row's remove button, else the previous one's, else Add files.
    const left = $$('#filesList [data-remove]');
    (left[Math.min(i, left.length - 1)] || $('#addFilesBtn')).focus();
  });
  dlg.addEventListener('change', (e) => {
    const li = e.target.closest('[data-file]');
    const d = li && S.filesDraft.find((d) => d.id === +li.dataset.file);
    if (!d) return;
    // Update the row rather than redraw the list, so the control keeps keyboard focus.
    if (e.target.type === 'checkbox') {
      d.on = e.target.checked;
      li.classList.toggle('off', !d.on);
    } else if (e.target.classList.contains('files-app')) {
      d.kind = e.target.value;
      li.querySelector('.logo use').setAttribute('href', `#logo-${Sources.byKind(d.kind).logo}`);
    } else return;
    syncFilesActions();
  });
}

// ------------------------------------------------------------------ conversation pickers (spec 012)

const logoSvg = (s) => html`<svg class="logo" aria-hidden="true"><use href="#logo-${Sources.byId(s).logo}"/></svg>`;
/** An app's chart colour as the --app custom property (spec 010's app edges and dots). */
const appColor = (s) => `--app: var(--series-${((s || 0) % 8) + 1})`;
const countWords = (n, calls = 0) => [n && `${fmtNum(n)} message${n === 1 ? '' : 's'}`, calls && `${fmtNum(calls)} call${calls === 1 ? '' : 's'}`].filter(Boolean).join(', ');

/**
 * Puts what a picker searches and draws on a conversation's <option> as data-*
 * attributes, which Tom Select reads as option fields. The option's text stays the
 * plain-dropdown label (R6).
 */
function pickerOption(c, text, count, words) {
  const opt = new Option(text, c.key);
  const sources = keySources(c.key);
  const name = contactName(c);
  Object.assign(opt.dataset, {
    search: c.search || name.toLowerCase(),
    name,
    sources: sources.join(','),
    kind: c.person ? 'person' : c.group ? 'group' : '',
    count,
    aria: [name, ...sources.map((s) => sourceName(s)), words].filter(Boolean).join(', '),
  });
  return opt;
}

/**
 * One picker row, and the picked item in the closed picker: logos, name, count (R7, R8).
 * A linked person's several logos already say it's joined, so it has no 🔗.
 */
function pickerRowHtml(d) {
  if (!d.name) return String(html`<div>${d.text}</div>`); // "Choose a conversation…"
  const logos = d.sources ? d.sources.split(',').map((s) => logoSvg(+s)) : [];
  const mark = (m) => html`<span class="pick-mark" aria-hidden="true">${m}</span>`;
  return String(html`<div class="pick-row" aria-label="${d.aria || d.name}">${logos.length ? html`<span class="pick-logos">${logos}</span>` : ''}${d.kind === 'group' ? mark('👥') : ''}<span class="pick-name">${d.name}</span>${d.count ? html`<span class="pick-count">${d.count}</span>` : ''}</div>`);
}

/** Makes a <select> searchable with Tom Select; null (a plain dropdown) when the library didn't load (R6). */
function makePicker(sel, opts = {}) {
  if (typeof TomSelect === 'undefined') return null;
  const ts = new TomSelect(sel, {
    // The search box sits at the top of the open list, so the closed picker keeps
    // showing the picked conversation instead of mixing it with what's typed.
    plugins: ['dropdown_input'],
    searchField: ['search'],
    maxOptions: null,
    refreshThrottle: 100, // ms after a key before the list filters (300 by default felt slow)
    closeAfterSelect: true,
    // Every match scores the same, so results keep the list's own order (most messages
    // first), and "All conversations" always stays (R2).
    score(query) {
      const match = this.getScoreFunction(query);
      return (item) => (item.value === 'all' || match(item) > 0 ? 1 : 0);
    },
    render: { option: pickerRowHtml, item: pickerRowHtml, no_results: () => '<div class="no-results">No conversations match</div>' },
    ...opts,
  });
  ts.control_input.placeholder = 'Search by name, number or member';
  // With dropdown_input the control is the combobox. A <label for> names it (Tom Select
  // links that up); a select named by aria-label needs its name copied across.
  if (sel.hasAttribute('aria-label') && !ts.focus_node.hasAttribute('aria-labelledby')) {
    ts.focus_node.setAttribute('aria-label', sel.getAttribute('aria-label'));
  }
  // Each opening starts a new search. Tom Select ignores clicks on the picker while
  // its search box has text, so a leftover search would also keep it from reopening.
  // A search still waiting out refreshThrottle would reopen the list, so drop it too.
  ts.on('dropdown_close', () => {
    clearTimeout(ts.refreshTimeout);
    ts.refreshTimeout = null;
    ts.setTextboxValue('');
  });
  // In a dialog the list takes up room (see styles.css), so bring all of it into view.
  if (sel.closest('dialog')) ts.on('dropdown_open', () => ts.dropdown.scrollIntoView({ block: 'nearest' }));
  // Typing on the closed picker opens it, and the key lands in the search box (R9).
  ts.control.addEventListener('keydown', (e) => {
    if (!ts.isOpen && e.key.length === 1 && e.key !== ' ' && !e.ctrlKey && !e.metaKey && !e.altKey) ts.open();
  });
  // Tom Select moves the picked <option> to the end of the <select>, which would
  // reorder the plain list. One value is all a single picker needs to write back.
  ts.updateOriginalInput = (o = {}) => {
    sel.value = ts.items[0] ?? '';
    if (ts.isSetup && !o.silent) ts.trigger('change', ts.getValue());
  };
  return ts;
}

/** Re-reads a picker's <option>s after they were rebuilt. */
function refreshPicker(sel) {
  const ts = sel.tomselect;
  if (!ts) return;
  const value = sel.value;
  ts.clear(true);
  ts.clearOptions();
  ts.sync();
  ts.setValue(value, true);
}

/**
 * Sets a picker's value without a change event. Skips a picker that already shows it
 * (it was just picked there): setting it again would reopen the list.
 */
function setPickerValue(sel, value) {
  sel.value = value;
  if (sel.tomselect && sel.tomselect.getValue() !== value) sel.tomselect.setValue(value, true);
}

// ------------------------------------------------------------------ filters

function populateContacts() {
  const { source } = S.filter;
  // A linked person spans apps, so with an app picked only that app's messages count (spec 005 R6).
  const totals = new Map();
  for (const m of S.msgs) if (source === 'all' || (m.s || 0) === source) totals.set(m.k, (totals.get(m.k) || 0) + 1);
  const callTotals = new Map();
  if (source === 'all' || source === 0) for (const c of S.calls) callTotals.set(c.k, (callTotals.get(c.k) || 0) + 1);
  const keys = [...new Set([...totals.keys(), ...callTotals.keys()])]
    .filter((k) => source === 'all' || keySources(k).includes(source));
  keys.sort((a, b) => (totals.get(b) || 0) - (totals.get(a) || 0) || (callTotals.get(b) || 0) - (callTotals.get(a) || 0));

  const sel = $('#contactSel');
  sel.innerHTML = '';
  const shown = source === 'all' ? S.msgs.length : keys.reduce((s, k) => s + (totals.get(k) || 0), 0);
  const all = new Option(`All conversations (${fmtNum(shown)})`, 'all');
  Object.assign(all.dataset, { search: 'all conversations', name: 'All conversations', count: fmtNum(shown), aria: `All conversations, ${countWords(shown)}` });
  sel.add(all);
  for (const k of keys) {
    const n = totals.get(k) || 0;
    const cn = callTotals.get(k) || 0;
    const parts = [];
    if (n) parts.push(fmtNum(n));
    if (cn) parts.push(`${fmtNum(cn)} calls`);
    const c = S.contacts.get(k);
    sel.add(c ? pickerOption(c, `${labelFor(k)} (${parts.join(', ')})`, parts.join(', '), countWords(n, cn)) : new Option(`${labelFor(k)} (${parts.join(', ')})`, k));
  }
  sel.value = S.filter.contact;
  refreshPicker(sel);
  const present = loadedSources();
  addSourceButtons();
  $('#sourceSeg').hidden = present.size < 2;
  $$('#sourceSeg button').forEach((b) => {
    b.hidden = b.dataset.source !== 'all' && !present.has(+b.dataset.source);
    b.classList.toggle('on', b.dataset.source === String(source));
  });
  updatePeopleButton();
  updateFilesButton();
}

/** The source filter's buttons: All, then one per app in the registry (added once each, so focus stays put). */
function addSourceButtons() {
  const seg = $('#sourceSeg');
  if (!seg.querySelector('[data-source="all"]')) seg.insertAdjacentHTML('beforeend', String(html`<button data-source="all">All</button>`));
  for (const src of Sources.list) {
    if (!seg.querySelector(`[data-source="${src.id}"]`)) seg.insertAdjacentHTML('beforeend', String(html`<button data-source="${src.id}">${logoSvg(src.id)}${src.name}</button>`));
  }
}

function setContact(key) {
  S.filter.contact = key;
  setPickerValue($('#contactSel'), key);
  S.browserLimit = 200;
  refresh();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/** Messages matching the filters (not the date range); `contact` overrides the selected conversation. */
function baseMessages(contact = S.filter.contact) {
  const { groups, source } = S.filter;
  // A linked person (spec 005) spans apps, so the app filter still applies to it.
  if (contact !== 'all') return S.msgs.filter((m) => m.k === contact && (source === 'all' || (m.s || 0) === source));
  if (source === 'all' && groups) return S.msgs;
  return S.msgs.filter((m) => (source === 'all' || (m.s || 0) === source) && (groups || !m.k.startsWith('g:')));
}

function baseCalls() {
  const { contact, source } = S.filter;
  if (source !== 'all' && source !== 0) return []; // calls only come from SMS Backup & Restore
  if (contact !== 'all') return S.calls.filter((c) => c.k === contact);
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
  // AI mood (spec 001) scores only this selection: pick up whatever it doesn't cover yet.
  AiMood.selectionChanged(msgs);
  const A = aggregateMessages(msgs, S.convoGap);
  const X = aggregateCrossApp(msgs, S.appsGap); // spec 007: cheap, no message text
  renderKpis(A);
  renderHighlights(msgs, A, X);
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
    const C = aggregateContent(msgs, S.moodScorer);
    Charts.set('c-emojitrend', C.emojiTotals.size ? emojiTrendOption(ui, C) : emptyOption(ui, 'No emoji in this selection'));
    const dm = domainsOption(ui, C);
    Charts.set('c-domains', dm.empty ? emptyOption(ui, 'No links in this selection') : dm.opt);
    S.vocab = C;
    renderVocab(ui);
    const mt = C.moodTotal;
    const share = (n, d) => (d ? Math.round((n / d) * 100) + '%' : '–');
    $('#moodNote').textContent = mt.n[0] + mt.n[1]
      ? `Share of messages that read positive (up) or negative (down), scored with ${S.moodScorer === 'ai' ? 'the AI model' : 'VADER'}. You: ${share(mt.pos[1], mt.n[1])} positive, ${share(mt.neg[1], mt.n[1])} negative · Them: ${share(mt.pos[0], mt.n[0])} positive, ${share(mt.neg[0], mt.n[0])} negative`
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

  // AI analysis (spec 002): the transcript is only built once the card is near the screen.
  lazyRender('#sec-ai', () => AiAnalysis.render());

  // Sources
  const multi = all && S.filter.source === 'all' && [...A.sourceMonths.values()].reduce((set, v) => (v.forEach((n, i) => n && set.add(i)), set), new Set()).size > 1;
  show('#sec-sources', multi);
  if (multi) Charts.set('c-platforms', platformMixOption(ui, A, sourceNames()));

  // Across apps (spec 007): only for linked people with messages on 2+ apps here
  const crossApp = S.filter.source === 'all' && (all ? X.total.n > 0 : X.people.has(S.filter.contact));
  show('#sec-apps', crossApp);
  if (crossApp) renderCrossApp(ui, X);

  show('#sec-wrapped', base.length > 0);
  if (base.length) lazyRender('#sec-wrapped', () => renderWrapped(ui, base));

  renderCalls(ui);
  renderBrowser(msgs);
  // Attachments panel: shown when the selection has any; built once it's near the screen.
  show('#galleryCard', anyMedia);
  if (anyMedia) lazyRender('#galleryCard', () => renderGallery(msgs));
  wireCharts();
  Tabs.sync();
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
  const sig = `${S.filter.source}|${S.filter.groups}|${S.msgs.length}`;
  if (!S.docFreq || S.docFreq.sig !== sig) S.docFreq = { sig, value: buildDocFreq(baseMessages('all')) };
  return S.docFreq.value;
}

const LEADER_COLS = [
  { key: 'label', title: 'Conversation', sort: (r) => r.label.toLowerCase(), fmt: (r) => r.label },
  { key: 'n', title: 'Messages', sort: (r) => r.n, fmt: (r) => fmtNum(r.n) },
  { key: 'sent', title: 'You sent', sort: (r) => r.sent, fmt: (r) => Math.round(r.sent * 100) + '%' },
  { key: 'yourReply', title: 'Your reply', sort: (r) => r.yourReply ?? Infinity, fmt: (r) => fmtDuration(r.yourReply), asc: true },
  { key: 'theirReply', title: 'Their reply', sort: (r) => r.theirReply ?? Infinity, fmt: (r) => fmtDuration(r.theirReply), asc: true },
  { key: 'started', title: 'You start', sort: (r) => r.started ?? -1, fmt: (r) => (r.started == null ? '–' : Math.round(r.started * 100) + '%') },
  { key: 'len', title: 'Avg length', sort: (r) => r.lenYou, fmt: (r) => html`${r.lenYou} <span class="muted">/ ${r.lenThem}</span>` },
  { key: 'streak', title: 'Streak', sort: (r) => r.streak, fmt: (r) => `${fmtNum(r.streak)}d` },
  { key: 'sig', title: 'Signature', sort: (r) => r.sig || '', fmt: (r) => r.sig || '' , cls: 'emoji' },
  { key: 'first', title: 'First', sort: (r) => r.first, fmt: (r) => new Date(r.first).toLocaleDateString(undefined, { year: 'numeric', month: 'short' }) },
  { key: 'last', title: 'Last', sort: (r) => r.last, fmt: (r) => new Date(r.last).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) },
];

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
  table.innerHTML = html`<thead><tr>${LEADER_COLS.map((c) => html`<th data-key="${c.key}" class="${c.key === col.key ? 'sorted' + (S.leader.asc ? ' asc' : '') : ''}">${c.title}</th>`)}</tr></thead>` +
    html`<tbody>${shown.map((r) => html`<tr data-key="${r.k}">${LEADER_COLS.map((c) => html`<td class="${c.cls || ''}">${c.fmt(r)}</td>`)}</tr>`)}</tbody>`;
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
    ? html`${quiet.map((r) => {
      const months = Math.round((A.last - r.last) / (30.4 * DAY_MS));
      return html`<li data-key="${r.k}"><span>${labelFor(r.k)}</span><span class="meta">${fmtNum(r.n)} messages · last ${new Date(r.last).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })} (${months < 1 ? '<1' : months} mo before the end of this range)</span></li>`;
    })}`
    : html`<li class="empty">Nobody you talked to a lot has gone quiet in this range.</li>`;
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
    ? html`${items.map((m) => {
      const title = m.k === null ? `${ordinal(m.n)} message` : m.n === 1 ? `First message with ${labelFor(m.k)}` : `${ordinal(m.n)} message with ${labelFor(m.k)}`;
      return html`<li><b>${title}</b><span class="meta">${date(m.t)}</span></li>`;
    })}`
    : html`<li class="empty">No milestones in this selection.</li>`;
}

// ------------------------------------------------------------------ mood details

/** 'pos' | 'neg' | 'neu' for a message by the chosen scorer, or null when it has no score. */
function moodKind(m) {
  const s = moodSign(m, S.moodScorer);
  return s == null ? null : s > 0 ? 'pos' : s < 0 ? 'neg' : 'neu';
}
const MOOD_WORD = { pos: 'positive', neg: 'negative', neu: 'neutral' };
const fmtScore = (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(2);
/** messageLib with VADER, for explaining scores on the page (built on first use). */
const moodLib = () => (moodLib.lib = moodLib.lib || messageLib(vaderLib()));

/** Switch the mood chart and pills between VADER and the AI model's scores (spec 001). */
function setMoodScorer(scorer) {
  S.moodScorer = scorer;
  AiMood.render();
  if (!$('#dash').hidden) refresh({ timeline: false });
}

/** Whether a message is one of those picked on the mood chart. */
function moodMatches(m, f) {
  if (m.mo !== f.mo || (f.o != null && m.o !== f.o)) return false;
  const k = moodKind(m);
  if (!k) return false;
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
  Tabs.select('sec-messages');
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
  const kind = moodKind(m);
  const n = (S.moodScored && S.moodScored.get(`${m.mo}|${m.o}`)) || 1;
  const month = monthName(monthToTs(m.mo));
  const whose = m.o ? 'you sent' : 'you received';
  const word = MOOD_WORD[kind];
  const effect = kind === 'neu'
    ? `Neutral, so it's in neither bar: one of the ${fmtNum(n)} messages ${whose} in ${month} with a mood score, it makes both bars a little shorter.`
    : `One of the ${fmtNum(n)} messages ${whose} in ${month} with a mood score: worth about ${(100 / n).toFixed(1)} points of the ${word} bar.`;
  if (S.moodScorer === 'ai') {
    // The model's three probabilities (spec 001, R9), with VADER's score to compare.
    const pct = (x) => Math.round(x * 100) + '%';
    const [neg, neu, pos] = m.ai;
    return html`<div class="mood-why">
    <div><b>${fmtScore(moodScore(m, 'ai'))} ${word}.</b> ${effect}</div>
    <div class="mood-words"><span class="mw pos">positive <b>${pct(pos)}</b></span><span class="mw">neutral <b>${pct(neu)}</b></span><span class="mw neg">negative <b>${pct(neg)}</b></span><span class="mw">VADER <b>${fmtScore(m.v)}</b></span></div>
    <div class="mood-note">How sure the AI model is of each reading. It takes the likeliest one; the score is positive minus negative.</div>
  </div>`;
  }
  const e = moodLib().explainMood(m.b);
  const fmtV = (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1);
  const words = e ? [...e.words].sort((a, b) => Math.abs(b.valence) - Math.abs(a.valence)) : [];
  const chips = words.map((w) => html`<span class="mw ${w.valence > 0 ? 'pos' : 'neg'}">${w.word} <b>${fmtV(w.valence)}</b>${w.lexicon !== w.valence ? html` <span class="was">was ${fmtV(w.lexicon)}</span>` : ''}</span>`);
  if (e && e.emphasis) chips.push(html`<span class="mw ${e.emphasis > 0 ? 'pos' : 'neg'}">! ? emphasis <b>${fmtV(e.emphasis)}</b></span>`);
  return html`<div class="mood-why">
    <div><b>${fmtScore(m.v)} ${word}.</b> ${effect}</div>
    ${chips.length ? html`<div class="mood-words">${chips}</div>` : html`<div class="mood-note">No words from VADER’s dictionary, so it scored 0.</div>`}
    <div class="mood-note">Each word's value (after “not”, “very”, ALL CAPS and “but”) adds up and is squeezed into −1…+1. +0.05 or more counts as positive, −0.05 or less as negative.</div>
  </div>`;
}

function initMoodDetails() {
  $('#moodChk').onchange = (e) => {
    S.showMood = e.target.checked;
    renderBrowser(inRange(baseMessages()));
  };
  try { S.igPreviews = localStorage.getItem('ms-ig-previews') === '1'; } catch (e) { /* storage unavailable */ }
  $('#igPreviewsChk').checked = S.igPreviews;
  $('#igPreviewsChk').onchange = (e) => {
    S.igPreviews = e.target.checked;
    // Turning previews off deletes the setting, so a failed write can't leave an old "on" behind.
    try {
      if (S.igPreviews) localStorage.setItem('ms-ig-previews', '1');
      else localStorage.removeItem('ms-ig-previews');
    } catch (err) { /* storage unavailable: reading it fails too, so previews start off */ }
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
    bubble.insertAdjacentHTML('beforeend', String(moodWhyHtml(S.browserShown[+pill.dataset.i])));
  });
}

// ------------------------------------------------------------------ highlights, profiles, on this day

/** A conversation's name without its app mark, for sentences. */
function plainName(key) {
  const c = S.contacts.get(key);
  if (!c) return key;
  if (c.person) return formatAddr(c.name) || key;
  if (c.group) return c.name ? c.name.split(', ').map(formatAddr).join(', ') : c.addr.split('~').map(formatAddr).join(', ') || 'Group chat';
  return formatAddr(c.name) || formatAddr(c.addr) || key;
}

const personLink = (k, text = plainName(k)) => html`<button type="button" class="person-link" data-profile="${k}">${text}</button>`;
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
const longDate = (t) => new Date(t).toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
const agoText = (t) => (Date.now() - t < DAY_MS ? 'today' : `${fmtGap(Date.now() - t)} ago`);

/** Highlight parts (strings, { b }, { k, text }) as HTML. */
function partsHtml(parts) {
  return html`${parts.map((p) => (typeof p === 'string' ? p : p.k != null ? personLink(p.k, p.text) : html`<b>${p.b}</b>`))}`;
}

function renderHighlights(msgs, A, X) {
  const crossApp = X ? crossAppHighlight(X, { labelFor: plainName, names: sourceNames() }) : null;
  const items = buildHighlights(msgs, A, { labelFor: plainName, senderLabel, single: S.filter.contact !== 'all', crossApp, limit: Infinity });
  $('#highlights').innerHTML = items.length
    ? html`${items.map((h, i) => html`<li${i >= HIGHLIGHT_LIMIT ? raw(' class="hl-more" hidden') : ''}><span class="hl-icon" aria-hidden="true">${h.icon}</span><span>${partsHtml(h.parts)}</span></li>`)}`
    : html`<li class="empty">Not enough messages here for highlights yet.</li>`;
  showMoreHighlights(false);
}

/** Spec 008 R3: show or hide the highlights past the first HIGHLIGHT_LIMIT. */
function showMoreHighlights(open) {
  const more = $('#highlights').querySelectorAll('.hl-more');
  const btn = $('#highlightsMore');
  for (const li of more) li.hidden = !open;
  btn.hidden = !more.length;
  btn.textContent = open ? 'Show fewer' : `Show ${more.length} more`;
  btn.setAttribute('aria-expanded', String(open));
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
    box.innerHTML = html`<p class="empty">Nothing on this date in earlier years.</p>${near ? html`<button class="btn small" type="button" data-otd-goto="${near.month}-${near.day}">Go to ${dayName(near)}, the nearest day with messages →</button>` : ''}`;
    return;
  }
  const single = S.filter.contact !== 'all';
  box.innerHTML = html`${years.slice(0, 4).map(({ year, msgs }) => {
    const back = now.getFullYear() - year;
    const day = new Date(year, sel.month, sel.day).getTime();
    const top = single ? null : busiestConversation(msgs);
    const withWhom = top ? (top.of > 1 ? html`, mostly with ${personLink(top.k)}` : html` with ${personLink(top.k)}`) : '';
    const moments = pickMoments(msgs, 3).map((m) =>
      html`<div class="otd-msg ${m.o ? 'sent' : 'recv'}"><span class="otd-who">${momentSender(m)}</span>${clip(m.b, 140)}</div>`);
    return html`<section class="otd-year">
      <div class="otd-head"><b>${back ? `${back} year${back === 1 ? '' : 's'} ago` : 'Earlier this year'}</b> <span class="muted">${longDate(day)} · ${fmtNum(msgs.length)} message${msgs.length === 1 ? '' : 's'}</span>${withWhom}</div>
      ${moments.length ? html`<div class="otd-msgs">${moments}</div>` : ''}
      <button class="btn small ghost" type="button" data-otd-day="${day}">Read that day →</button>
    </section>`;
  })}`;
}

/** Show one calendar day in the message list. */
function readDay(dayStart) {
  const d = new Date(dayStart);
  setRange(dayStart, new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime() - 1);
  Tabs.select('sec-messages');
}

function moveOtd(days) {
  const now = new Date();
  const cur = S.otd || { month: now.getMonth(), day: now.getDate() };
  const d = new Date(2000, cur.month, cur.day + days); // a leap year, so Feb 29 is a stop
  S.otd = { month: d.getMonth(), day: d.getDate() };
  renderOnThisDay(baseMessages());
}

/** Spec 007 R4: how a linked person's conversations move between apps, for the profile. */
function profileCrossApp(key, msgs, name) {
  const P = aggregateCrossApp(msgs, S.appsGap).people.get(key);
  if (!P) return '';
  const K = crossKpis(P, name);
  return html`<h3 class="profile-h">Across apps</h3><div class="app-splits">${appSplitHtml(P, name)}</div>
    <div class="kpis profile-kpis apps-kpis">${K.switches}${K.who}${K.replies}</div>`;
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
    kpi('Since', new Date(F.first.t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }), agoText(F.first.t)),
    kpi('Last message', new Date(F.last.t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }), agoText(F.last.t)),
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
  const vs = html`<table class="vs"><thead><tr><th></th><th>You</th><th>${them}</th></tr></thead><tbody>${vsRows.map(([label, a, b, fmt, way]) => {
    const [la, lb] = lead(a, b, way, fmt);
    return html`<tr><th scope="row">${label}</th><td class="${la}">${fmt(a)}</td><td class="${lb}">${fmt(b)}</td></tr>`;
  })}</tbody></table>`;

  $('#profileTop').innerHTML = html`
    <header class="profile-head">
      <div class="avatar" style="background: var(--series-${hue + 1})" aria-hidden="true">${initials}</div>
      <div>
        <h2 id="profileName">${name}</h2>
        <p class="sub">${group ? `Group chat · ${fmtNum(members)} people` : '1-on-1'} on ${c.person ? andList(c.sources.map((s) => sourceName(s))) : sourceName(c.s)} · all time</p>
        ${c.person ? html`<p class="sub profile-linked">Linked: ${c.threads.map((k) => `${threadName(S.contacts.get(k))} (${sourceName(S.contacts.get(k).s)})`).join(', ')}</p>` : ''}
      </div>
    </header>
    <div class="kpis profile-kpis">${tiles}</div>
    <h3 class="profile-h">You and ${them === 'Everyone else' ? 'everyone else' : them}</h3>
    ${vs}${c.person ? profileCrossApp(key, msgs, name) : ''}`;

  const words = distinctiveWords(msgs, docFreqFor(), 15);
  const started = F.firstText;
  const bottom = [];
  if (group) {
    const rows = senderBreakdown(msgs, key);
    bottom.push(html`<h3 class="profile-h">Most active</h3><ol class="plain-list member-list">${rows.map((r) =>
      html`<li><span>${r.label}</span><span class="meta">${fmtNum(r.n)} · ${pct(r.n, F.n)}</span></li>`)}</ol>`);
  }
  if (words.length) {
    bottom.push(html`<h3 class="profile-h">What you talk about</h3><p class="sub profile-sub">Words that set this conversation apart</p><div class="chips">${words.map((w) => html`<span class="chip">${w.w}</span>`)}</div>`);
  }
  if (started) {
    bottom.push(html`<h3 class="profile-h">How it started</h3><blockquote class="first-msg"><p>${clip(started.b, 280)}</p><footer>${started.o ? 'You' : momentSender(started)}, ${longDate(started.t)}</footer></blockquote>`);
  }
  const linkLabel = c.person ? 'Manage links…' : isLinkable(c) ? 'Same person on another app? Link…' : '';
  const linkBtn = linkLabel ? html`<button class="btn" type="button" data-link-people="${key}">${linkLabel}</button>` : '';
  bottom.push(html`<div class="profile-actions">${linkBtn}<button class="btn primary" type="button" data-focus="${key}">Focus the dashboard on ${name}</button></div>`);
  $('#profileBottom').innerHTML = html`${bottom}`;

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
  $('#highlightsMore').onclick = (e) => showMoreHighlights(e.currentTarget.getAttribute('aria-expanded') !== 'true');
  $('#profileBtn').onclick = () => openProfile(S.filter.contact);
  const dlg = $('#profile');
  dlg.querySelector('.profile-close').onclick = () => dlg.close();
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); }); // the backdrop
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-profile], [data-otd-day], [data-otd-goto], [data-focus], [data-link-people]');
    if (!t) return;
    if (t.dataset.profile) openProfile(t.dataset.profile);
    else if (t.dataset.otdDay) {
      if (t.dataset.contact && S.contacts.has(t.dataset.contact)) { // the biggest juggle (spec 007) names its person
        S.filter.contact = t.dataset.contact;
        setPickerValue($('#contactSel'), t.dataset.contact);
      }
      S.browserMood = null;
      readDay(+t.dataset.otdDay);
    }
    else if (t.dataset.otdGoto) {
      const [month, day] = t.dataset.otdGoto.split('-').map(Number);
      S.otd = { month, day };
      renderOnThisDay(baseMessages());
    } else if (t.dataset.focus) {
      dlg.close();
      setContact(t.dataset.focus);
    } else if (t.dataset.linkPeople) {
      dlg.close();
      openPeopleDialog(t.dataset.linkPeople);
    }
  });
}

// ------------------------------------------------------------------ cross-app habits (spec 007)

const shareText = (a, b) => (b ? Math.round((a / b) * 100) + '%' : '–');
const sortedApps = (P) => [...P.apps.keys()].sort((a, b) => a - b);
const appNames = (apps) => andList([...apps].sort((a, b) => a - b).map((s) => sourceName(s)));
const monthText = (mo) => new Date(monthToTs(mo)).toLocaleDateString(undefined, { year: 'numeric', month: 'short' });
const TRIGGER_TEXT = { share: 'A shared post', link: 'A link', media: 'A photo, video or GIF', text: 'A plain message' };

/** M1: a bar of each app's share. `counts`: [[app, n]]. */
function appSplitBar(counts, cls = '') {
  const total = counts.reduce((s, [, n]) => s + n, 0);
  const parts = counts.filter(([, n]) => n).map(([s, n]) => ({ s, n, text: `${sourceName(s)} ${shareText(n, total)}` }));
  const bar = html`<div class="app-split ${cls}" role="img" aria-label="${parts.map((p) => p.text).join(', ')}">${parts.map((p) =>
    html`<span style="flex: ${p.n} 1 0; background: var(--series-${p.s + 1})" title="${p.text}"></span>`)}</div>`;
  return { bar, parts };
}

/** M1 for both sides: everyone, you, them. */
function appSplitHtml(P, them) {
  const apps = sortedApps(P);
  const row = (label, n) => {
    const { bar, parts } = appSplitBar(apps.map((s) => [s, n(P.apps.get(s))]));
    return html`<div class="app-split-row"><span class="app-split-label">${label}</span>${bar}<span class="app-split-legend">${parts.map((p) =>
      html`<span><i style="background: var(--series-${p.s + 1})"></i>${p.text}</span>`)}</span></div>`;
  };
  return html`${row('Both of you', (a) => a.n[0] + a.n[1])}${row('You', (a) => a.n[1])}${row(them, (a) => a.n[0])}`;
}

/** M6: who makes most of the moves, as [who, "68%"], or null without switches. */
function whoSwitches(P, them) {
  if (!P.switches) return null;
  const you = P.switchBy[1] / P.switches;
  return you >= 0.5 ? ['You', shareText(P.switchBy[1], P.switches)] : [them, shareText(P.switchBy[0], P.switches)];
}

/** The Switching apps tiles (M2–M6, M9). `them`: the other side's name, or 'They'. */
function crossKpis(P, them) {
  const replies = P.replies[0] + P.replies[1];
  const cross = P.crossReplies[0] + P.crossReplies[1];
  const crossMs = median([...P.crossMs[0], ...P.crossMs[1]]);
  const sameMs = median([...P.sameMs[0], ...P.sameMs[1]]);
  const who = whoSwitches(P, them);
  return {
    switches: kpi('Switches', fmtNum(P.switches), `${P.sessions ? (P.switches / P.sessions).toFixed(1) : '–'} per conversation`, 'Times the next message in a conversation came on a different app'),
    multi: kpi('Multi-app conversations', shareText(P.multiSessions, P.sessions), `${fmtNum(P.multiSessions)} of ${fmtNum(P.sessions)} conversations`, 'Conversations that used more than one app'),
    bounce: kpi('Back and forth', shareText(P.bounceSessions, P.sessions), 'left an app and came back', 'Conversations that moved to another app and then back again'),
    days: kpi('Multi-app days', shareText(P.multiDays, P.days), `${fmtNum(P.multiDays)} of ${fmtNum(P.days)} active days`, 'Days with messages on more than one app'),
    who: kpi('Who switches', who ? who[0] : '–', who ? `${who[0] === 'You' || who[0] === 'They' ? 'make' : 'makes'} ${who[1]} of the moves` : 'no switches yet', 'Who sent the first message on the new app'),
    replies: kpi('Cross-app replies', shareText(cross, replies), `answered on another app · ${fmtDuration(crossMs)} vs ${fmtDuration(sameMs)} same-app`, 'Replies sent on a different app than the message they answer, and the median reply time for each'),
  };
}

const peakHour = (hours) => hours.reduce((best, n, h) => (n > hours[best] ? h : best), 0);

function renderCrossApp(ui, X) {
  const all = S.filter.contact === 'all';
  const P = all ? X.total : X.people.get(S.filter.contact);
  const them = all ? 'They' : plainName(S.filter.contact);
  const gapWords = fmtGapWords(S.appsGap);
  $$('#appsGapSeg button').forEach((b) => b.classList.toggle('on', +b.dataset.gap === S.appsGap));
  $('#appsNote').textContent = all
    ? `${fmtNum(X.people.size)} linked ${X.people.size === 1 ? 'person' : 'people'} on more than one app in this selection · a conversation ends after ${gapWords} of quiet`
    : `You and ${them} on ${appNames(P.apps.keys())} · a conversation ends after ${gapWords} of quiet`;
  $('#appsSplit').innerHTML = appSplitHtml(P, all ? 'Them' : them);
  $('#appsKpis').innerHTML = html`${Object.values(crossKpis(P, them))}`;

  // M12: the conversation with the most switches
  const b = P.busiest;
  if (b) {
    const d = new Date(b.start);
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    $('#appsJuggle').innerHTML = html`Biggest juggle: <b>${fmtNum(b.switches)} switch${b.switches === 1 ? '' : 'es'}</b> between ${appNames(b.apps)}${all ? html` with ${personLink(b.k)}` : ''} on ${longDate(b.start)}. ` +
      html`<button class="btn small ghost" type="button" data-otd-day="${day}" data-contact="${b.k}">Read that day →</button>`;
  } else $('#appsJuggle').textContent = 'No conversation here has moved between apps yet.';

  // Linked people (All conversations only)
  show('#appsPeopleCard', all);
  if (all) {
    const rows = [...X.people].sort((a, b) => b[1].switches - a[1].switches || b[1].n - a[1].n);
    $('#appsPeople').innerHTML = html`<thead><tr><th>Person</th><th>Messages</th><th>Apps</th><th>Switches</th><th>Per conversation</th><th>Multi-app</th><th>Who switches</th><th>Main app</th></tr></thead>` +
      html`<tbody>${rows.map(([k, Q]) => {
        const who = whoSwitches(Q, plainName(k));
        const { bar } = appSplitBar(sortedApps(Q).map((s) => [s, Q.apps.get(s).n[0] + Q.apps.get(s).n[1]]), 'mini');
        return html`<tr data-person="${k}"><td>${personLink(k)}</td><td>${fmtNum(Q.n)}</td><td class="apps-cell">${bar}</td><td>${fmtNum(Q.switches)}</td>
          <td>${Q.sessions ? (Q.switches / Q.sessions).toFixed(1) : '–'}</td><td>${shareText(Q.multiSessions, Q.sessions)}</td>
          <td>${who ? `${who[0]} ${who[1]}` : '–'}</td><td>${sourceName(Q.mainApp)}</td></tr>`;
      })}</tbody>`;
  }

  // M11: main app over time
  Charts.set('c-appshare', appShareOption(ui, P.months, sourceNames()));
  const shifts = all ? [...X.people].flatMap(([k, Q]) => Q.shifts.map((s) => ({ ...s, k }))) : P.shifts;
  const moves = shifts.sort((a, b) => a.mo - b.mo).map((s, i) =>
    html`${i ? '; ' : ''}${all ? html`${personLink(s.k)}: m` : 'M'}oved from ${sourceName(s.from)} to ${sourceName(s.to)} around ${monthText(s.mo)}`);
  $('#appsShareNote').innerHTML = html`Each app’s share of messages per month${moves.length ? html`. ${moves}.` : ''}`;

  // M7, M8: routes and what sets off a switch
  Charts.set('c-routes', P.switches ? switchRoutesOption(ui, P.routes, sourceNames()) : emptyOption(ui, 'No switches in this selection'));
  const kinds = CROSS_TRIGGERS.filter((t) => t !== 'share' || [...P.apps.keys()].some((s) => Sources.byId(s).shares) || P.triggers.share);
  $('#appsTriggers').innerHTML = P.switches
    ? html`${kinds.map((t) => html`<li><span>${TRIGGER_TEXT[t]}</span><span class="meter" aria-hidden="true"><i style="width: ${(P.triggers[t] / P.switches) * 100}%"></i></span><span class="meta">${shareText(P.triggers[t], P.switches)} · ${fmtNum(P.triggers[t])}</span></li>`)}`
    : html`<li class="empty">No switches in this selection.</li>`;

  // M10: what each app is for
  const apps = sortedApps(P);
  const avg = (a) => (a.lenN ? Math.round(a.lenSum / a.lenN) : 0);
  const n = (a) => a.n[0] + a.n[1];
  const rows = [
    ['Messages', (a) => fmtNum(n(a))],
    ['From you', (a) => shareText(a.n[1], n(a))],
    ['Average length', (a) => `${fmtNum(avg(a))} chars`],
    ['Photos & videos', (a) => shareText(a.visual, n(a))],
    ['Links & shares', (a) => shareText(a.links, n(a))],
    ['Busiest hour', (a) => hourText(peakHour(a.hour))],
    ['Conversations you start', (a) => fmtNum(a.starts[1])],
    [`Conversations ${all ? 'they start' : `${them} starts`}`, (a) => fmtNum(a.starts[0])],
    ['You usually reply in', (a) => fmtDuration(a.replyMedian[1])],
    [`${all ? 'They usually reply' : `${them} usually replies`} in`, (a) => fmtDuration(a.replyMedian[0])],
  ];
  $('#appsForNote').textContent = 'A conversation counts on the app it started on; a reply on the app it was sent on';
  $('#appsFor').innerHTML = html`<thead><tr><th></th>${apps.map((s) => html`<th scope="col">${sourceName(s)}</th>`)}</tr></thead>
    <tbody>${rows.map(([label, fmt]) => html`<tr><th scope="row">${label}</th>${apps.map((s) => html`<td>${fmt(P.apps.get(s))}</td>`)}</tr>`)}</tbody>`;
}

// ---- lazy sections: render expensive sections only when they're on (or near) the screen

// visible: the observed elements on (or near) the screen. An element's key is its
// data-lazy, or its own id: the Words, Mood and Media tabs share the content pass.
const Lazy = { pending: new Map(), visible: new Set(), observer: null };
const lazyKey = (el) => el.dataset.lazy || '#' + el.id;

function lazyRender(sel, fn) {
  Lazy.pending.set(sel, fn);
  if ([...Lazy.visible].some((el) => lazyKey(el) === sel)) runLazy(sel);
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
      if (e.isIntersecting) {
        Lazy.visible.add(e.target);
        runLazy(lazyKey(e.target));
      } else {
        Lazy.visible.delete(e.target);
      }
    }
  }, { rootMargin: '600px 0px' });
  for (const el of lazyElements()) Lazy.observer.observe(el);
}

const lazyElements = () => $$('#sec-content, #sec-mood, #sec-media, #sec-ai, #sec-wrapped, #galleryCard');

/**
 * A tab was just opened (spec 003): render its lazy parts now, not when the observer
 * notices, so the layout is final before anything scrolls to a card in it.
 */
function renderLazyIn(section) {
  for (const el of lazyElements()) if (!el.hidden && section.contains(el)) runLazy(lazyKey(el));
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
  const src = S.filter.source === 'all' ? '' : ` (${sourceName(S.filter.source)})`;
  const all = S.filter.groups ? 'All conversations' : 'All 1-on-1 conversations';
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

/** A KPI tile. Text is escaped; pass html`…` for a value or sub with markup (<small>). */
function kpi(label, value, sub = '', title = '') {
  return html`<div class="kpi" title="${title}"><div class="kpi-label">${label}</div><div class="kpi-value">${value}</div><div class="kpi-sub">${sub}</div></div>`;
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
    kpi('Avg length', html`${avgLen(1)} <small>/ ${avgLen(0)}</small>`, 'characters · sent / received'),
    kpi('Words', fmtNum(A.words[0] + A.words[1]), `${fmtNum(A.words[1])} sent · ${fmtNum(A.words[0])} received`),
    kpi('Emoji', fmtNum(A.emoji[0] + A.emoji[1]), `in ${pct(A.emojiMsgs[0] + A.emojiMsgs[1], total)} of messages`),
    kpi('Attachments', fmtNum(media(0) + media(1)), `${fmtNum(A.media.ph[0] + A.media.ph[1])} photos · ${fmtNum(A.media.vd[0] + A.media.vd[1])} videos · ${fmtBytes(A.mediaBytes)}`),
    kpi('Night owl', pct(nightCount, total), A.latestNight ? `latest ${new Date(A.latestNight.t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : 'no messages after midnight', 'Messages between midnight and 5am'),
    kpi('Longest conversation', A.longestSession ? html`${fmtNum(A.longestSession.n)} <small>msgs</small>` : '–', A.longestSession ? `${labelFor(A.longestSession.k)} · ${new Date(A.longestSession.start).toLocaleDateString()}` : '', `Most messages with no ${fmtGapWords(S.convoGap)} of quiet in between`),
  ];
  $('#kpis').innerHTML = html`${tiles}`;
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
  $('#callKpis').innerHTML = html`${[
    kpi('Calls', fmtNum(C.n), `${fmtNum(C.byType[0])} out · ${fmtNum(C.byType[1])} in`),
    kpi('Talk time', fmtDuration(talk * 1000), `${fmtDuration(C.talk[1] * 1000)} out · ${fmtDuration(C.talk[0] * 1000)} in`),
    kpi('Average call', answeredDur ? fmtDuration((talk / answeredDur) * 1000) : '–', `across ${fmtNum(connected)} connected calls`),
    kpi('Longest call', C.longest ? fmtDuration(C.longest.du * 1000) : '–', C.longest ? `${labelFor(C.longest.k)} · ${new Date(C.longest.t).toLocaleDateString()}` : ''),
    kpi('Missed', fmtNum(C.byType[2]), `${fmtNum(C.byType[3])} voicemail · ${fmtNum(C.byType[4])} declined`),
  ]}`;

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
      ? top.map(([w, uses]) => html`<button type="button" class="vocab-chip" data-word="${w}" title="Track “${w}” in the Word tracker">${w}${uses > 1 ? html` <span class="muted">${fmtNum(uses)}</span>` : ''}</button>`)
      : html`<span class="muted">Nothing new</span>`;
    return html`<div class="vocab-col ${o ? 'sent' : 'recv'}">
      <div class="vocab-col-head"><b>${who}</b> · ${fmtNum(n)} new of ${fmtNum(C.vocab.get(mo)[o])} words</div>
      <div class="vocab-chips">${words}</div>
    </div>`;
  };
  const firstNote = mo === months[0] ? ' (the first month here, so every word counts as new)' : '';
  box.innerHTML = html`<div class="vocab-head"><b>New in ${new Date(monthToTs(mo)).toLocaleDateString(undefined, { year: 'numeric', month: 'long' })}</b>
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
  if (!m) return html`${body}`;
  const at = m.index;
  const after = at + m[0].length;
  let start = Math.max(0, at - 60);
  let end = Math.min(body.length, after + 80);
  // Don't cut an emoji (a surrogate pair) in half.
  if (start > 0 && /[\uDC00-\uDFFF]/.test(body[start])) start--;
  if (end < body.length && /[\uDC00-\uDFFF]/.test(body[end])) end++;
  return html`${start ? '…' : ''}${body.slice(start, at)}<mark>${m[0]}</mark>${body.slice(after, end)}${end < body.length ? '…' : ''}`;
}

/** Who said it first, and each side's first use quoted. */
function phraseFirstsHtml(P, re) {
  const [them, you] = P.first;
  const name = (m) => (m.o ? 'You' : messageSender(m));
  let head;
  if (you && them) {
    const [a, b] = you.t <= them.t ? [you, them] : [them, you];
    head = html`<b>${name(a)}</b> said it first, ${fmtGap(b.t - a.t)} before ${a.o ? name(b) : 'you'}.`;
  } else {
    head = you ? 'Only you have said it.' : html`You've never said it. <b>${name(them)}</b> said it first.`;
  }
  const card = (m) => {
    const when = new Date(m.t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    const conv = labelFor(m.k);
    const where = m.k.startsWith('g:') ? `in ${conv}` : m.o ? `to ${conv}` : '';
    return html`<div class="phrase-first ${m.o ? 'sent' : 'recv'}">
      <div class="phrase-first-head"><b>${name(m)}</b> first said it · ${when}${where ? ` · ${where}` : ''}</div>
      <div class="phrase-quote">${phraseSnippet(m.b, re)}</div>
    </div>`;
  };
  return html`<p class="phrase-headline">${head}</p><div class="phrase-first-grid">${[you, them].filter(Boolean).map(card)}</div>`;
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

/** Reactions on a message (spec 004): one chip per emoji, with who reacted on hover. */
function reactionsRow(m) {
  const row = document.createElement('div');
  row.className = 'reactions';
  const me = hasOwner(m.s) && S.owners[m.s].name;
  for (const x of m.rx) {
    const names = x.n.map((n) => (n === me ? 'You' : n));
    const more = x.c - names.length;
    const chip = document.createElement('span');
    chip.className = 'rx';
    chip.textContent = x.r;
    if (x.c > 1) {
      const n = document.createElement('b');
      n.textContent = fmtNum(x.c);
      chip.appendChild(n);
    }
    const who = names.length ? names.join(', ') + (more > 0 ? ` and ${fmtNum(more)} more` : '') : `${fmtNum(x.c)} ${x.c === 1 ? 'person' : 'people'}`;
    chip.title = `${x.r} ${who}`;
    chip.setAttribute('aria-label', `Reacted ${x.r} by ${who}`);
    row.appendChild(chip);
  }
  return row;
}

function renderBrowser(msgs) {
  const q = S.browserQuery.trim().toLowerCase();
  const mood = S.browserMood;
  const has = (s) => s && s.toLowerCase().includes(q);
  let list = q ? msgs.filter((m) => has(m.b) || (m.sh && (has(m.sh.x) || has(m.sh.w)))) : msgs;
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
  if (mood) chip.innerHTML = html`<span>${moodFilterLabel(mood)}</span><button class="btn small ghost" type="button" data-clear-mood aria-label="Show all messages">✕</button>`;
  // Messages with a mood score per month and side: what one message is worth in the chart.
  if (S.showMood) {
    S.moodScored = new Map();
    for (const m of msgs) if (moodSign(m, S.moodScorer) != null) S.moodScored.set(`${m.mo}|${m.o}`, (S.moodScored.get(`${m.mo}|${m.o}`) || 0) + 1);
  }
  S.browserShown = shown;

  const frag = document.createDocumentFragment();
  const showWho = S.filter.contact === 'all' || S.filter.contact.startsWith('g:') || S.filter.contact.startsWith('p:');
  // Spec 010: a linked person's app edges, and switch markers when the list is the whole conversation.
  const appEdges = S.filter.contact.startsWith('p:') && S.filter.source === 'all';
  const marks = appEdges && !q && !mood ? appSwitchMarks(list, S.appsGap) : null;
  let lastDay = null;
  shown.forEach((m, j) => {
    if (m.d !== lastDay) {
      lastDay = m.d;
      const sep = document.createElement('div');
      sep.className = 'day-sep';
      sep.textContent = dayLabel(m.d);
      frag.appendChild(sep);
    }
    const mark = marks && marks.get(start + j);
    if (mark) frag.appendChild(appSwitchMarker(mark, m.k));
    const row = document.createElement('div');
    row.className = 'msg ' + (m.o ? 'sent' : 'recv') + (appEdges ? ` app-edge app-${m.s || 0}` : '');
    if (appEdges) row.style.cssText = appColor(m.s);
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    const sender = !m.o && m.k.startsWith('g:') && (m.sn || m.sk) ? senderLabel(m.sn || m.sk) : '';
    const via = m.tk ? sourceName(m.s) : ''; // a linked person's messages say which app (spec 005 R7)
    if (showWho && (S.filter.contact === 'all' || sender || via)) {
      const who = document.createElement('div');
      who.className = 'who';
      if (S.filter.contact !== 'all') who.textContent = sender || via;
      else if (sender) who.textContent = `${sender} · ${labelFor(m.k)}`;
      else who.textContent = (m.o ? 'To ' : 'From ') + labelFor(m.k) + (via ? ` · ${via}` : '');
      bubble.appendChild(who);
    }
    if (m.b) {
      const body = document.createElement('div');
      body.className = 'body';
      body.textContent = m.b;
      bubble.appendChild(body);
    }
    if (m.att) bubble.appendChild(messageAttachments(m));
    if (m.sh) bubble.appendChild(shareCard(m.sh, S.igPreviews));
    if (m.rx) bubble.appendChild(reactionsRow(m));
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
    const kind = S.showMood && moodKind(m);
    if (kind) {
      const score = fmtScore(moodScore(m, S.moodScorer));
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = `mood-pill ${kind}`;
      pill.dataset.i = j;
      pill.textContent = score;
      pill.title = `Mood score ${score} (${MOOD_WORD[kind]}). Click to see why.`;
      time.appendChild(pill);
    }
    time.append(new Date(m.t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }));
    bubble.appendChild(time);
    row.appendChild(bubble);
    frag.appendChild(row);
  });
  box.appendChild(frag);
  scrollBrowserToEnd();
}

/** Spec 010 R2/R9: the divider where a linked person's conversation moves to another app. */
function appSwitchMarker({ from, to, o }, key) {
  const name = plainName(key);
  // A first name reads best; a number or email is kept whole.
  const them = /[\d@]/.test(name) ? name : name.split(' ')[0];
  const who = o ? 'You moved' : `${them} moved`;
  const el = document.createElement('div');
  el.className = 'app-switch';
  el.setAttribute('role', 'separator');
  el.setAttribute('aria-label', `Switched from ${sourceName(from)} to ${sourceName(to)}. ${who}.`);
  const app = (s) => html`<span class="app-dot app-${s}" style="${appColor(s)}"></span>${sourceName(s)}`;
  el.innerHTML = html`<span class="app-switch-pill"><span class="app-route">${app(from)} → ${app(to)}</span> · <span class="app-mover">${who}</span></span>`;
  return el;
}

/**
 * The message list scrolls inside its own box, which has no size while the Messages tab
 * is hidden (spec 003). Scrolling to the latest message waits until the tab is shown,
 * and leaving the tab keeps the place for when it comes back.
 */
const BrowserScroll = { pinEnd: false, top: 0 };

function scrollBrowserToEnd() {
  const box = $('#messages');
  BrowserScroll.pinEnd = box.offsetParent === null;
  if (!BrowserScroll.pinEnd) box.scrollTop = box.scrollHeight;
}

/** Tabs (spec 003): a section is about to be hidden. */
function onTabHidden(section) {
  if (section.id === 'sec-messages') BrowserScroll.top = $('#messages').scrollTop;
}

/** Tabs (spec 003): a section was just shown. */
function onTabShown(section) {
  renderLazyIn(section);
  if (section.id !== 'sec-messages') return;
  const box = $('#messages');
  box.scrollTop = BrowserScroll.pinEnd ? box.scrollHeight : BrowserScroll.top;
  BrowserScroll.pinEnd = false;
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

  $('#fileInput').onchange = (e) => {
    loadFiles(e.target.files);
    e.target.value = '';
  };
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
    if (!e.dataTransfer.files.length) return;
    // With the Files dialog open, dropped files join its list; otherwise they load right away (spec 006 R12).
    if ($('#filesDlg').open) addToDraft(e.dataTransfer.files);
    else loadFiles(e.dataTransfer.files);
  });

  // Backspace in an empty search would remove the picked conversation, leaving the
  // dashboard with none. Picking "All conversations" is the way back to everything.
  makePicker($('#contactSel'), { onDelete: () => false });
  $('#contactSel').onchange = (e) => setContact(e.target.value);
  $('#sourceSeg').onclick = (e) => {
    // The buttons hold an app logo, so the click can land on the svg inside one.
    const v = e.target.closest('button[data-source]')?.dataset.source;
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
  $('#gapSeg').innerHTML = html`${CONVO_GAPS.map((g) => html`<button data-gap="${g}" title="A conversation ends after ${fmtGapWords(g)} of quiet">${fmtGapShort(g)}</button>`)}`;
  $('#gapSeg').onclick = (e) => {
    const g = +e.target.dataset.gap;
    if (!g) return;
    S.convoGap = g;
    refresh({ timeline: false });
  };
  $('#appsGapSeg').innerHTML = html`${APPS_GAPS.map((g) => html`<button data-gap="${g}" title="A conversation ends after ${fmtGapWords(g)} of quiet">${fmtGapShort(g)}</button>`)}`;
  $('#appsGapSeg').onclick = (e) => {
    const g = +e.target.dataset.gap;
    if (!g) return;
    S.appsGap = g;
    refresh({ timeline: false });
  };
  $('#granSeg').onclick = (e) => {
    const g = e.target.dataset.gran;
    if (!g) return;
    S.gran = g;
    renderTimeline(S.ui, baseMessages());
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
  initPeople();
  initOwners();
  initFiles();
  initMoodDetails();
  AiMood.init();
  AiAnalysis.init();
  initViewer();
  initGallery();
  Tabs.init();
  observeLazySections();

  $('#search').oninput = (e) => {
    clearTimeout(S.searchTimer);
    S.searchTimer = setTimeout(() => {
      S.browserQuery = e.target.value;
      S.browserLimit = 200;
      renderBrowser(inRange(baseMessages()));
    }, 200);
  };
  $('#phraseIdeas').innerHTML = html`${PHRASE_IDEAS.map((p) => html`<button type="button" class="btn small">${p}</button>`)}`;
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
