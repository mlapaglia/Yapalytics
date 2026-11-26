/*
 * Reading export files into Data: the landing page's picker and demo, drag and drop,
 * reporting to the loading screen (load-screen.js, spec 016), and what follows a load
 * (owners, links, the dashboard).
 */

let fileSeq = 0;

/** How many parser workers run at once: a core is left for the page. */
const PARSE_WORKERS = () => Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));

/** An entry in Files.loaded (spec 006) for `file` of `kind` (detectFile's result). */
const fileEntry = (file, kind) => ({ id: ++fileSeq, file, name: file.name, size: file.size, lastModified: file.lastModified, kind, on: true });

/**
 * Changes to the loaded files run one at a time, each against what the last one left
 * (R15): a read that's still going can't be overtaken by a later change and then commit
 * its stale file list over it. The Files button is disabled meanwhile.
 */
let fileOps = Promise.resolve();

function queueFileOp(op) {
  Files.busy++;
  updateFilesButton();
  fileOps = fileOps.then(() => { LoadPerf.begin(); return op(); }).catch((err) => console.error(err)).finally(() => {
    LoadPerf.end();
    LoadScreen.stop();
    Files.busy--;
    updateFilesButton();
  });
  return fileOps;
}

/** Load files from the landing page or a drop: they join Files.loaded, checked. */
function loadFiles(fileList) {
  const picked = [...fileList]; // a drop's file list is emptied once the event is over
  return queueFileOp(() => loadPicked(picked));
}

/** Load the demo, showing the loading screen while its files are made (spec 016 R10). */
function loadDemo() {
  return queueFileOp(async () => {
    showProgress({ demo: true });
    LoadScreen.step('demo');
    await nextFrame();
    await loadPicked(LoadPerf.step('build demo files', buildDemoFiles));
  });
}

async function loadPicked(picked) {
  const files = picked.filter((f, i, all) =>
    f.size > 0 && !Files.loaded.some((e) => sameFile(e, f)) && all.findIndex((g) => sameFile(g, f)) === i);
  if (!files.length) {
    if (LoadScreen.active) hideProgress();
    return;
  }
  showProgress();
  LoadScreen.step('check');
  let entries;
  try {
    const kinds = await LoadPerf.step('detect file types', () => Promise.all(files.map(detectFile)));
    entries = files.map((f, i) => fileEntry(f, kinds[i]));
  } catch (err) {
    console.error(err);
    showLoadError('Could not read that file: ' + err.message);
    return;
  }
  await applyFiles([...Files.loaded, ...entries]);
}

/**
 * Show the loading screen (spec 016). `demo` and `check` say which steps the load has;
 * a load already showing it keeps its steps.
 */
function showProgress({ demo = false, check = true } = {}) {
  $('#dashError').hidden = true;
  $('#landing').hidden = false;
  $('#drop').hidden = true;
  $('#progress').hidden = false;
  $('#loadError').hidden = true;
  LoadScreen.start({ demo, check });
}

/** Back to what was showing before a load that turned out to have nothing new. */
function hideProgress() {
  LoadScreen.stop();
  $('#progress').hidden = true;
  $('#drop').hidden = false;
  if (Data.msgs.length || Data.calls.length) $('#landing').hidden = true;
}

/**
 * Parse Files.loaded entries and merge what they hold into the loaded data, deduplicating
 * against what's already there. Null when that worked; otherwise `{ error, failed }`, the
 * message and the files that couldn't be read (the failing parse job's, or all of them
 * when nothing at all is loaded). A failed read leaves the loaded data half-merged: the
 * caller reads the remaining files again (see applyFiles).
 */
async function readFiles(entries) {
  let badDates = ''; // an app's message when its dates couldn't be read
  const jobs = [];
  const abort = new AbortController(); // stops the other workers when a job fails
  let failed = null; // { job, err }: the first job that failed

  try {
    // One job per file or per app (Sources: jobs). Attachments point at their file by
    // index into the job's files (att.z); attBase moves that into Data.archives.
    for (const src of Sources.list) {
      const files = entries.filter((e) => e.kind === src.kind).map((e) => e.file);
      if (!files.length) continue;
      for (const group of src.jobs === 'each' ? files.map((f) => [f]) : [files]) {
        const label = group.length > 1 ? `${group.length} ${src.name} files` : group[0].name;
        const job = { i: jobs.length, files: group, src, label, done: null };
        if (src.archives) job.attBase = Data.archive(group);
        jobs.push(job);
      }
    }
  } catch (err) {
    console.error(err);
    return { error: 'Could not read that file: ' + err.message, failed: entries.map((e) => e.file) };
  }

  LoadScreen.beginRead(entries);

  // An app's jobs run one after another, in order, in its own lane, so a message in two
  // of its overlapping exports keeps the copy it would if the files were read one at a
  // time. Lanes run at the same time, a few workers at once: messages of different apps
  // can't be duplicates of each other (their keys carry the app). Batches are added as
  // they arrive, so nothing waits in memory (spec 016 R7).
  const lanes = [];
  for (const job of jobs) {
    const lane = lanes.find((l) => l[0].src === job.src);
    if (lane) lane.push(job);
    else lanes.push([job]);
  }
  // The step line names the jobs being read. Jobs starting together are written once, and
  // a job ending waits a moment, so the next one in its lane taking its place changes
  // nothing: the line, a live region, changes only when what's read does (AC12).
  const reading = [];
  const showReading = () => {
    if (reading.length) LoadScreen.step('read', reading.length > 2 ? `${reading[0]} and ${reading.length - 1} more` : reading.join(' and '));
  };
  const add = (job, msgs, calls, found) => {
    const t0 = performance.now();
    const res = Data.addBatch(msgs, calls, job.attBase);
    const t1 = performance.now();
    LoadScreen.batch(job.i, res, found);
    LoadPerf.add(job.perf, 'Data.addBatch', t1 - t0, msgs.length + calls.length);
    LoadPerf.add(job.perf, 'LoadScreen.batch', performance.now() - t1, msgs.length + calls.length);
  };
  const run = async (job) => {
    reading.push(job.label);
    queueMicrotask(showReading);
    LoadScreen.startJob(job.i, job.files);
    job.perf = LoadPerf.startJob(job.label);
    try {
      job.done = await job.src.parse(job.files, {
        signal: abort.signal,
        perf: job.perf,
        onBatch: (msgs, calls, found) => add(job, msgs, calls, found),
        onProgress: (loaded, total) => LoadScreen.progress(job.i, loaded, total),
      });
      LoadScreen.endJob(job.i, false);
    } catch (err) {
      // The first failure stops every other worker at once. Theirs then fail as stopped,
      // which isn't a failure of their files.
      if (!abort.signal.aborted) {
        failed = { job, err };
        LoadScreen.endJob(job.i, true);
        abort.abort();
      }
    } finally {
      reading.splice(reading.indexOf(job.label), 1);
      setTimeout(showReading, 0);
    }
  };
  let nextLane = 0;
  const worker = async () => {
    while (nextLane < lanes.length && !abort.signal.aborted) {
      for (const job of lanes[nextLane++]) {
        if (abort.signal.aborted) break;
        await run(job);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARSE_WORKERS(), lanes.length) }, worker));

  if (failed) {
    console.error(failed.err);
    return { error: 'Could not read that file: ' + failed.err.message, failed: failed.job.files };
  }
  for (const job of jobs) {
    Data.addContacts(job.done.contacts); // in job order, whichever finished first
    if (job.src.badDatesError && job.done.counts.badDates) badDates = job.src.badDatesError;
  }

  if (!Data.msgs.length && !Data.calls.length) {
    return {
      error: badDates || 'No messages or calls were found. Use an XML backup from SMS Backup & Restore (sms-*.xml or calls-*.xml), a Google Takeout zip that includes Google Chat, a WhatsApp chat export (.txt or .zip), an iMessage export, a Telegram export (result.json, or a zip of the export folder), an Instagram export (.zip, JSON format), or a Facebook Messenger export (.zip, JSON format, or the encrypted chats download).',
      failed: entries.map((e) => e.file),
    };
  }
  return null;
}

/**
 * After files are read: sort, work out owners and links, keep the filters that still
 * apply, and show the dashboard. The loading screen draws between the steps (spec 016 R9).
 */
async function finishLoad() {
  LoadScreen.step('merge', fmtNum(Data.msgs.length));
  await nextFrame();
  LoadPerf.step('sort (Data.finish)', () => Data.finish());
  $('#igPreviewsLabel').hidden = !Data.msgs.some((m) => m.sh && instagramEmbedUrl(m.sh.u));
  LoadScreen.step('owners');
  await nextFrame();
  LoadPerf.step('guess owners', () => Data.guessOwners(Prefs.owners));
  rederive();
  // Files were left out or removed (spec 006 R10): an app or conversation that's gone goes back to All.
  const f = View.filter;
  if (f.source !== 'all' && !Data.loadedSources().has(f.source)) f.source = 'all';
  if (f.contact !== 'all' && (!Data.contacts.has(f.contact) || (f.source !== 'all' && !Data.keySources(f.contact).includes(f.source)))) f.contact = 'all';
  LoadScreen.step('draw');
  await nextFrame();
  $('#landing').hidden = true;
  $('#dash').hidden = false;
  LoadPerf.step('draw dashboard', () => Panels.invalidate(['*'])); // draws the open tab now
  LoadScreen.stop(); // after it, so the step's time is the drawing's
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
  Data.reset();
  View.vocabMo = null;
  View.browser.mood = null;
  View.browser.limit = 200;
  // Data.archives stays: it's append-only, so an attachment index (att.z) from before never
  // points at a different file. Attachment previews are cached by that index.
}

/** Back to the landing page with nothing loaded (every file removed, spec 006 R9). */
function showLanding() {
  View.filter.contact = 'all';
  View.filter.source = 'all';
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
  // With something still loaded, the dashboard comes back and says what went wrong (R17).
  if (Data.msgs.length || Data.calls.length) {
    $('#landing').hidden = true;
    $('#dash').hidden = false;
    $('#dashErrorText').textContent = msg;
    $('#dashError').hidden = false;
  }
}

/**
 * Work out owners, links and what hangs off them again (Data.rederive, spec 014 R6), then
 * bring the filter and Settings' "Which one is you?" section in line.
 */
function rederive() {
  LoadPerf.step('Data.rederive', () => Data.rederive({ owners: Prefs.owners, people: Prefs.people }));
  const sel = View.filter.contact;
  if (Data.personOf.has(sel)) View.filter.contact = Data.personOf.get(sel);
  else if (sel.startsWith('p:') && !Data.contacts.has(sel)) View.filter.contact = 'all';
  const sources = Object.keys(Prefs.owners).map(Number).filter((s) => Data.ownerChoices(s).length);
  LoadPerf.step('owner dialog', () => {
    renderOwnerDialog(sources);
    updateOwnerSection(sources);
  });
}

function initLoader() {
  $('#dashErrorClose').addEventListener('click', () => { $('#dashError').hidden = true; });
  $('#fileInput').addEventListener('change', (e) => {
    loadFiles(e.target.files);
    e.target.value = '';
  });
  $('#demoBtn').addEventListener('click', () => loadDemo());
  $$('[data-demo]').forEach((b) => { b.addEventListener('click', () => loadDemo()); });

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
}
