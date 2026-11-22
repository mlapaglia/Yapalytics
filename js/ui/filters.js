/*
 * The filter bar: conversation picker, app buttons, group chats, dates and presets, and
 * the scope line under it. Its two panels have no tab, so they draw on any tab.
 */

/** The conversation picker's list: every conversation with messages or calls in the picked app, busiest first. */
function populateContacts() {
  const { source } = View.filter;
  // A linked person spans apps, so with an app picked only that app's messages count (spec 005 R6).
  const totals = new Map();
  for (const m of Data.msgs) if (source === 'all' || (m.s || 0) === source) totals.set(m.k, (totals.get(m.k) || 0) + 1);
  const callTotals = new Map();
  if (source === 'all' || source === 0) for (const c of Data.calls) callTotals.set(c.k, (callTotals.get(c.k) || 0) + 1);
  const keys = [...new Set([...totals.keys(), ...callTotals.keys()])]
    .filter((k) => source === 'all' || Data.keySources(k).includes(source));
  keys.sort((a, b) => (totals.get(b) || 0) - (totals.get(a) || 0) || (callTotals.get(b) || 0) - (callTotals.get(a) || 0));

  const sel = $('#contactSel');
  sel.innerHTML = '';
  const shown = source === 'all' ? Data.msgs.length : keys.reduce((s, k) => s + (totals.get(k) || 0), 0);
  const all = new Option(`All conversations (${fmtNum(shown)})`, 'all');
  Object.assign(all.dataset, { search: 'all conversations', name: 'All conversations', count: fmtNum(shown), aria: `All conversations, ${countWords(shown)}` });
  sel.add(all);
  for (const k of keys) {
    const n = totals.get(k) || 0;
    const cn = callTotals.get(k) || 0;
    const parts = [];
    if (n) parts.push(fmtNum(n));
    if (cn) parts.push(`${fmtNum(cn)} calls`);
    const c = Data.contacts.get(k);
    sel.add(c ? pickerOption(c, `${labelFor(k)} (${parts.join(', ')})`, parts.join(', '), countWords(n, cn)) : new Option(`${labelFor(k)} (${parts.join(', ')})`, k));
  }
  sel.value = View.filter.contact;
  refreshPicker(sel);
  const present = Data.loadedSources();
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

/** Focus the dashboard on one conversation (or 'all'). */
function setContact(key) {
  setPickerValue($('#contactSel'), key);
  View.set({ filter: { contact: key } });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function setSource(source) {
  View.set({ filter: { source, contact: 'all' } });
}

function dataBounds() {
  const all = [Data.msgs, Data.calls].filter((a) => a.length);
  const first = Math.min(...all.map((a) => a[0].t));
  const last = Math.max(...all.map((a) => a[a.length - 1].t));
  return { first, last };
}

function setRange(from, to) {
  View.set({ filter: { from, to } });
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
  $('#fromDate').value = toDateInput(View.filter.from ?? first);
  $('#toDate').value = toDateInput(View.filter.to ?? last);
  $('#fromDate').min = $('#toDate').min = toDateInput(first);
  $('#fromDate').max = $('#toDate').max = toDateInput(last);
  $$('#presets button').forEach((b) => b.classList.toggle('on', b.dataset.preset === 'all' && View.filter.from == null && View.filter.to == null));
}

function renderScope(n) {
  const src = View.filter.source === 'all' ? '' : ` (${sourceName(View.filter.source)})`;
  const all = View.filter.groups ? 'All conversations' : 'All 1-on-1 conversations';
  const who = View.filter.contact === 'all' ? all + src : labelFor(View.filter.contact);
  const { first, last } = dataBounds();
  const from = new Date(View.filter.from ?? first).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  const to = new Date(View.filter.to ?? last).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  $('#scope').textContent = `${who} · ${from} – ${to} · ${fmtNum(n)} messages`;
}

Panels.register({
  id: 'filters',
  topics: ['data', 'filter.source'],
  render: populateContacts,
});

Panels.register({
  id: 'scope',
  topics: ['data', 'selection'],
  render(ctx) {
    show('#profileBtn', !ctx.all);
    syncRangeUi();
    renderScope(ctx.msgs().length);
  },
});

function initFilters() {
  // Backspace in an empty search would remove the picked conversation, leaving the
  // dashboard with none. Picking "All conversations" is the way back to everything.
  makePicker($('#contactSel'), { onDelete: () => false });
  $('#contactSel').onchange = (e) => setContact(e.target.value);
  $('#sourceSeg').onclick = (e) => {
    // The buttons hold an app logo, so the click can land on the svg inside one.
    const v = e.target.closest('button[data-source]')?.dataset.source;
    if (v) setSource(v === 'all' ? 'all' : +v);
  };
  $('#groupsChk').onchange = (e) => View.set({ filter: { groups: e.target.checked } });
  $('#fromDate').onchange = (e) => setRange(fromDateInput(e.target.value, false), View.filter.to);
  $('#toDate').onchange = (e) => setRange(View.filter.from, fromDateInput(e.target.value, true));
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
  $('#profileBtn').onclick = () => openProfile(View.filter.contact);
}
