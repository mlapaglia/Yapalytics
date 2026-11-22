/* "Which one is you?" (spec 013): picking your sender name in apps whose exports don't say. */

const OWNER_ORIGIN_TEXT = { export: 'From your export profile', guess: 'Guessed: check this', picked: 'Picked by you' };

/**
 * One row per app with senders to pick. Rows are rebuilt only when the apps or their
 * names change; picking a name only updates the row's value and origin, so focus stays
 * in the dialog.
 */
function renderOwnerDialog(sources) {
  const list = $('#ownerList');
  const sig = JSON.stringify(sources.map((s) => [s, Data.ownerChoices(s)]));
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
      for (const [n, k] of Data.ownerChoices(s)) {
        const opt = new Option(n, n);
        Object.assign(opt.dataset, { search: n.toLowerCase(), name: n, count: fmtNum(k), aria: `${n}, ${countWords(k)}` });
        sel.add(opt);
      }
      sel.value = Prefs.owners[s].name;
      list.appendChild(li); // before makePicker, so it finds the <label for>
      // An app always has an owner, so Backspace can't empty the picker (as for #contactSel).
      if (makePicker(sel, { onDelete: () => false })) sel.tomselect.control_input.placeholder = 'Search names';
      sel.addEventListener('change', () => setOwner(s, sel.value));
    }
  }
  for (const li of list.children) {
    const s = +li.dataset.source;
    setPickerValue(li.querySelector('select'), Prefs.owners[s].name);
    const origin = Data.ownerOrigin(s, Prefs.owners[s]);
    const note = li.querySelector('.owner-origin');
    note.className = `owner-origin ${origin}`;
    note.textContent = OWNER_ORIGIN_TEXT[origin];
  }
}

/** Shown when an app has senders to pick; counts the apps whose owner is only a guess (R2, R9). */
function updateOwnerButton(sources) {
  const btn = $('#ownerBtn');
  const guessed = sources.filter((s) => Data.ownerOrigin(s, Prefs.owners[s]) === 'guess');
  btn.hidden = !sources.length;
  btn.textContent = guessed.length ? `👤 Which one is you? (${guessed.length})` : '👤 Which one is you?';
  btn.title = guessed.length
    ? `Check ${andList(guessed.map((s) => sourceName(s)))}: who's you was guessed`
    : "Pick which sender is you in apps whose exports don't say";
}

function initOwners() {
  const dlg = $('#ownerDlg');
  $('#ownerBtn').addEventListener('click', () => { if (!dlg.open) dlg.showModal(); });
  dlg.querySelector('.profile-close').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); }); // the backdrop
}

function setOwner(source, name) {
  Prefs.owners[source] = { name, auto: false };
  rederive();
  Panels.invalidate(['data']);
}
