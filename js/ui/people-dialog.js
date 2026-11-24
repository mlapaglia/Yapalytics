/* The People dialog (spec 005): suggested links, linked people and linking by hand. Matching is in links.js. */

/** What the dialog shows: loaded 1-on-1 conversations, their message counts, and the links worth suggesting. */
const PeopleDlg = { threadN: new Map(), linkable: [], suggestions: [] };

const REASON_TEXT = { name: 'name', phone: 'phone number', email: 'email' };

/** Loaded 1-on-1 conversations, their message counts, and the links worth suggesting. */
function computeSuggestions() {
  PeopleDlg.threadN = Data.threadCounts();
  PeopleDlg.linkable = [...PeopleDlg.threadN.keys()].map((k) => Data.contacts.get(k)).filter(isLinkable);
  PeopleDlg.suggestions = suggestLinks(PeopleDlg.linkable, {
    personOf: Data.personOf,
    dismissed: Prefs.dismissed,
    ownNames: (s) => (hasOwner(s) ? [Prefs.owners[s].name] : []),
  });
}

/** Settings' Linked people section (spec 015 R9): shown when there's something to link, with what's linked and suggested. */
function updateLinkSection() {
  computeSuggestions();
  const n = PeopleDlg.suggestions.length;
  const linked = [...Data.contacts.values()].filter((c) => c.person).length;
  $('#linkSection').hidden = PeopleDlg.linkable.length < 2;
  const parts = [linked ? `${fmtNum(linked)} ${linked === 1 ? 'person' : 'people'} linked across apps` : 'No one linked yet'];
  if (n) parts.push(`${fmtNum(n)} possible link${n === 1 ? '' : 's'} to check`);
  $('#linkSummary').textContent = parts.join(' · ');
  $('#peopleBtn').textContent = n ? `🔗 Link people… (${n})` : '🔗 Link people…';
  updateSettingsButton();
  if ($('#peopleDlg').open) renderPeopleDialog();
}

/** Change the saved links, then show the dashboard with them. */
function changeLinks(fn) {
  fn();
  Prefs.savePeople();
  rederive();
  Panels.invalidate(['data']); // the filter bar's panel also redraws the People dialog
}

function threadChip(key, extra = '') {
  const c = Data.contacts.get(key);
  return html`<span class="chip person-chip">${threadName(c)} <small>${sourceName(c.s)} · ${fmtNum(PeopleDlg.threadN.get(key) || 0)}</small>${extra}</span>`;
}

function renderPeopleDialog() {
  const sug = PeopleDlg.suggestions;
  $('#peopleSuggest').innerHTML = html`<h3 class="profile-h">Suggestions</h3>${sug.length
    ? html`<ul class="people-list">${sug.map((x, i) => html`<li>
        <div class="chips">${x.keys.map((k) => threadChip(k))}</div>
        <span class="meta">Same ${x.reasons.map((r) => REASON_TEXT[r]).join(' and ')}</span>
        <span class="people-actions"><button class="btn small primary" type="button" data-accept="${i}">Link</button><button class="btn small ghost" type="button" data-dismiss="${i}">Dismiss</button></span>
      </li>`)}</ul>`
    : html`<p class="sub">Nothing to suggest. Conversations that share a name, phone number or email show up here.</p>`}`;

  const linked = [...Data.contacts.values()].filter((c) => c.person).sort((a, b) => a.name.localeCompare(b.name));
  const unloaded = Prefs.people.size - linked.length;
  $('#peopleLinked').innerHTML = html`<h3 class="profile-h">Linked people</h3>${linked.length
    ? html`<ul class="people-list">${linked.map((p) => {
      const names = [...new Set(p.threads.map((k) => threadName(Data.contacts.get(k))))];
      return html`<li data-person="${p.key}">
        <select class="person-name" aria-label="Name for this person">${names.map((n) => html`<option${n === p.name ? raw(' selected') : ''}>${n}</option>`)}</select>
        <div class="chips">${p.threads.map((k) => threadChip(k, html`<button type="button" class="chip-x" data-unlink="${k}" aria-label="Unlink ${threadName(Data.contacts.get(k))}" title="Unlink">✕</button>`))}</div>
        <button class="btn small ghost" type="button" data-unlink-all="${p.key}">Unlink all</button>
      </li>`;
    })}</ul>`
    : html`<p class="sub">None yet.</p>`}${unloaded > 0 ? html`<p class="sub">${fmtNum(unloaded)} more saved link${unloaded === 1 ? ' is' : 's are'} for conversations that aren't loaded.</p>` : ''}`;

  const linkable = [...PeopleDlg.linkable].sort((a, b) => threadName(a).localeCompare(threadName(b)));
  for (const sel of [$('#peopleA'), $('#peopleB')]) {
    const keep = sel.value;
    sel.innerHTML = '<option value="">Choose a conversation…</option>';
    for (const c of linkable) {
      const n = PeopleDlg.threadN.get(c.key) || 0;
      sel.add(pickerOption(c, `${threadName(c)} (${sourceName(c.s)}, ${fmtNum(n)})`, fmtNum(n), countWords(n)));
    }
    sel.value = PeopleDlg.linkable.some((c) => c.key === keep) ? keep : '';
    refreshPicker(sel);
  }
  syncPeopleLink();
}

function syncPeopleLink() {
  const a = $('#peopleA').value;
  const b = $('#peopleB').value;
  const same = a && Data.personOf.has(a) && Data.personOf.get(a) === Data.personOf.get(b);
  $('#peopleLink').disabled = !a || !b || a === b || !!same;
}

/** Open the People dialog, with `preselect` (a conversation key) picked for linking by hand. */
function openPeopleDialog(preselect) {
  computeSuggestions();
  renderPeopleDialog();
  if (preselect && PeopleDlg.linkable.some((c) => c.key === preselect)) {
    setPickerValue($('#peopleA'), preselect);
    syncPeopleLink();
  }
  const dlg = $('#peopleDlg');
  if (!dlg.open) dlg.showModal();
}

function initPeople() {
  const dlg = $('#peopleDlg');
  // Their options come later, so the empty option can't give the placeholder yet.
  for (const sel of [$('#peopleA'), $('#peopleB')]) makePicker(sel, { placeholder: 'Choose a conversation…' });
  $('#peopleBtn').addEventListener('click', () => openPeopleDialog());
  dlg.querySelector('.profile-close').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) { dlg.close(); return; } // the backdrop
    const t = e.target.closest('[data-accept], [data-dismiss], [data-unlink], [data-unlink-all]');
    if (!t) return;
    const d = t.dataset;
    if (d.accept != null) {
      const x = PeopleDlg.suggestions[+d.accept];
      if (x) changeLinks(() => Prefs.linkThreads(x.keys));
    } else if (d.dismiss != null) {
      const x = PeopleDlg.suggestions[+d.dismiss];
      if (x) changeLinks(() => Prefs.dismissed.add(linkSignature(x.keys)));
    } else if (d.unlink) changeLinks(() => Prefs.unlinkThread(d.unlink));
    else if (d.unlinkAll) changeLinks(() => Prefs.people.delete(d.unlinkAll));
  });
  dlg.addEventListener('change', (e) => {
    if (e.target.matches('select.person-name')) {
      const p = Prefs.people.get(e.target.closest('[data-person]').dataset.person);
      if (p) changeLinks(() => { p.name = e.target.value; });
    } else if (e.target.id === 'peopleA' || e.target.id === 'peopleB') syncPeopleLink();
  });
  $('#peopleLink').addEventListener('click', () => {
    const keys = [$('#peopleA').value, $('#peopleB').value];
    setPickerValue($('#peopleA'), '');
    setPickerValue($('#peopleB'), '');
    changeLinks(() => Prefs.linkThreads(keys));
  });
  $('#peopleForget').addEventListener('click', () => changeLinks(() => { Prefs.people.clear(); Prefs.dismissed.clear(); }));
  // Another tab changed the links (R10): take its version, so this tab's next change
  // can't write back links that were forgotten there.
  window.addEventListener('storage', (e) => {
    if (e.key !== STORE_KEYS.people && e.key !== null) return; // null: all of the site's storage was cleared
    Prefs.loadPeople();
    if ($('#dash').hidden) return;
    rederive();
    Panels.invalidate(['data']);
  });
}
