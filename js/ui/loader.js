/*
 * Reading export files into Data: the landing page's picker and demo, drag and drop,
 * the progress bar, and what follows a load (owners, links, the dashboard).
 */

let fileSeq = 0;

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
  fileOps = fileOps.then(op).catch((err) => console.error(err)).finally(() => {
    Files.busy--;
    updateFilesButton();
  });
  return fileOps;
}

/** Load files from the landing page, a drop or the demo: they join Files.loaded, checked. */
function loadFiles(fileList) {
  const picked = [...fileList]; // a drop's file list is emptied once the event is over
  return queueFileOp(async () => {
    const files = picked.filter((f, i, all) =>
      f.size > 0 && !Files.loaded.some((e) => sameFile(e, f)) && all.findIndex((g) => sameFile(g, f)) === i);
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
    await applyFiles([...Files.loaded, ...entries]);
  });
}

function showProgress() {
  $('#landing').hidden = false;
  $('#drop').hidden = true;
  $('#progress').hidden = false;
  $('#loadError').hidden = true;
}

/**
 * Parse Files.loaded entries and merge what they hold into the loaded data, deduplicating
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
    // index into the job's files (att.z); attBase moves that into Data.archives.
    const jobs = [];
    for (const src of Sources.list) {
      const files = entries.filter((e) => e.kind === src.kind).map((e) => e.file);
      if (!files.length) continue;
      for (const group of src.jobs === 'each' ? files.map((f) => [f]) : [files]) {
        const job = { files: group, src, parse: (cb) => src.parse(group, cb) };
        if (src.archives) job.attBase = Data.archive(group);
        jobs.push(job);
      }
    }

    for (let i = 0; i < jobs.length; i++) {
      job = jobs[i];
      const label = job.files.length > 1 ? `${job.files.length} files` : job.files[0].name;
      const done = await job.parse({
        onBatch: (msgs, calls) => Data.addBatch(msgs, calls, job.attBase),
        onProgress(loaded, total) {
          const pct = ((i + loaded / total) / jobs.length) * 100;
          bar.style.width = pct.toFixed(1) + '%';
          text.textContent = `Reading ${label} (${i + 1}/${jobs.length}) · ${fmtBytes(loaded)} of ${fmtBytes(total)} · ${fmtNum(Data.msgs.length)} messages, ${fmtNum(Data.calls.length)} calls`;
        },
      });
      Data.addContacts(done.contacts);
      if (job.src.badDatesError && done.counts.badDates) badDates = job.src.badDatesError;
    }
  } catch (err) {
    console.error(err);
    return { error: 'Could not read that file: ' + err.message, failed: job ? job.files : entries.map((e) => e.file) };
  }

  if (!Data.msgs.length && !Data.calls.length) {
    return {
      error: badDates || 'No messages or calls were found. Use an XML backup from SMS Backup & Restore (sms-*.xml or calls-*.xml), a Google Takeout zip that includes Google Chat, a WhatsApp chat export (.txt or .zip), an iMessage export, a Telegram export (result.json, or a zip of the export folder), an Instagram export (.zip, JSON format), or a Facebook Messenger export (.zip, JSON format, or the encrypted chats download).',
      failed: entries.map((e) => e.file),
    };
  }
  return null;
}

/** After files are read: sort, work out owners and links, keep the filters that still apply, and show the dashboard. */
function finishLoad() {
  Data.finish();
  $('#igPreviewsLabel').hidden = !Data.msgs.some((m) => m.sh && instagramEmbedUrl(m.sh.u));
  Data.guessOwners(Prefs.owners);
  rederive();
  // Files were left out or removed (spec 006 R10): an app or conversation that's gone goes back to All.
  const f = View.filter;
  if (f.source !== 'all' && !Data.loadedSources().has(f.source)) f.source = 'all';
  if (f.contact !== 'all' && (!Data.contacts.has(f.contact) || (f.source !== 'all' && !Data.keySources(f.contact).includes(f.source)))) f.contact = 'all';
  $('#landing').hidden = true;
  $('#dash').hidden = false;
  Panels.invalidate(['*']);
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
  if (Data.msgs.length || Data.calls.length) {
    $('#landing').hidden = true;
    $('#dash').hidden = false;
    alert(msg);
  }
}

/**
 * Work out owners, links and what hangs off them again (Data.rederive, spec 014 R6), then
 * bring the filter and the "Which one is you?" button and dialog in line.
 */
function rederive() {
  Data.rederive({ owners: Prefs.owners, people: Prefs.people });
  const sel = View.filter.contact;
  if (Data.personOf.has(sel)) View.filter.contact = Data.personOf.get(sel);
  else if (sel.startsWith('p:') && !Data.contacts.has(sel)) View.filter.contact = 'all';
  const sources = Object.keys(Prefs.owners).map(Number).filter((s) => Data.ownerChoices(s).length);
  renderOwnerDialog(sources);
  updateOwnerButton(sources);
}

function initLoader() {
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
}
