/* The Files dialog (spec 006): which loaded files are in use, adding and removing them. Pure parts are in files.js. */

/** Loaded export files and the dialog's working copy. */
const Files = {
  loaded: [], // { id, file, name, size, lastModified, kind, on }, in the order added
  draft: [], // the dialog's edited copy of `loaded` (rows it adds also have `added`, unreadable ones `error`)
  busy: 0, // file loads and dialog changes queued or running (R15)
  pending: 0, // files added in the open dialog that are still being checked
};

/** A thread file on its own, whose app is a guess the user can change (spec 009 R13). */
const isGuessedThread = (e) => !e.error && !!Sources.byKind(e.kind)?.metaFormat && /^message_\d+\.json$/i.test(e.name);

/** The filter bar's Files button: how many files are loaded, and how many are in use (R1). Off while files are read (R15). */
function updateFilesButton() {
  const n = Files.loaded.length;
  const on = Files.loaded.filter((e) => e.on).length;
  const btn = $('#filesBtn');
  btn.textContent = `📁 Files (${on === n ? n : `${on} of ${n}`})`;
  btn.disabled = Files.busy > 0;
}

function openFilesDialog() {
  if (Files.busy) return;
  // The dialog edits a copy; Apply compares it with Files.loaded, closing throws it away (R6).
  // Each opening gets a new array, so files still being checked for a closed one can't land here.
  Files.draft = Files.loaded.map((e) => ({ ...e }));
  Files.pending = 0;
  renderFilesDialog();
  const dlg = $('#filesDlg');
  if (!dlg.open) dlg.showModal();
}

function renderFilesDialog() {
  const draft = Files.draft;
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
  const usable = Files.draft.filter((e) => !e.error);
  $('#filesHint').hidden = !(usable.length && !usable.some((e) => e.on));
  $('#filesApply').disabled = Files.pending > 0 || !canApplyFiles(Files.loaded, Files.draft);
}

/** Add files to the dialog's list as pending rows, checked, or marked with why they can't be read (R5, R8). */
async function addToDraft(fileList) {
  const draft = Files.draft;
  const files = [...fileList].filter((f, i, all) =>
    f.size > 0 && !draft.some((e) => sameFile(e, f)) && all.findIndex((g) => sameFile(g, f)) === i);
  if (!files.length) return;
  Files.pending++;
  syncFilesActions();
  const entries = await Promise.all(files.map(async (f) => {
    try {
      return { ...fileEntry(f, await detectFile(f)), added: true };
    } catch (err) {
      return { ...fileEntry(f, null), on: false, error: err.message, added: true };
    }
  }));
  if (draft !== Files.draft) return; // the dialog was opened again since
  Files.pending--;
  // Picked twice before the first pick's kinds were known: keep one row.
  draft.push(...entries.filter((e) => !draft.some((d) => sameFile(d, e))));
  renderFilesDialog();
}

/**
 * Make the loaded files match `draft` (the dialog's list, or Files.loaded plus new files). A
 * file that fails to read is left out, and the dashboard goes back to exactly the checked
 * files that can be read (R14), so nothing stays loaded that the dialog can't take out.
 */
async function applyFiles(draft) {
  const plan = planFileChanges(Files.loaded, draft);
  if (!plan.changed) return;
  let next = draft.filter((e) => !e.error).map(({ added, ...e }) => e);
  if (!plan.read.length && !plan.rebuild) {
    Files.loaded = next; // only unchecked files removed
    updateFilesButton();
    return;
  }
  // A rebuild starts from nothing, so content another checked file also has stays (R7).
  if (plan.rebuild) resetLoaded();
  let read = plan.read;
  let error = '';
  while (read.length) {
    showProgress({ check: false }); // a load from the landing page already started it, with Checking files
    const failure = await readFiles(read);
    if (!failure) break;
    error = failure.error;
    next = next.filter((e) => !failure.failed.includes(e.file));
    resetLoaded();
    read = next.filter((e) => e.on);
  }
  if (!read.length) {
    // Every file removed (R9), or none of the checked ones could be read.
    Files.loaded = [];
    showLanding();
    if (error) showLoadError(error);
    return;
  }
  Files.loaded = next;
  await finishLoad();
  if (error) showLoadError(error);
}

function initFiles() {
  const dlg = $('#filesDlg');
  $('#filesBtn').addEventListener('click', openFilesDialog);
  dlg.querySelector('.profile-close').addEventListener('click', () => dlg.close());
  $('#filesCancel').addEventListener('click', () => dlg.close());
  $('#filesApply').addEventListener('click', () => {
    const draft = Files.draft;
    dlg.close();
    queueFileOp(() => applyFiles(draft));
  });
  $('#addFilesBtn').addEventListener('click', () => $('#addInput').click());
  $('#addInput').addEventListener('change', (e) => {
    addToDraft(e.target.files);
    e.target.value = ''; // so picking the same file again fires change
  });
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) { dlg.close(); return; } // the backdrop
    const x = e.target.closest('[data-remove]');
    if (!x) return;
    // In place: files still being checked are added to this same array.
    const draft = Files.draft;
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
    const d = li && Files.draft.find((d) => d.id === +li.dataset.file);
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
