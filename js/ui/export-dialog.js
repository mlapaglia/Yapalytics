/*
 * The Export stats dialog (spec 026): the tables of statsTables (js/export.js) for the
 * selection, each with a Download button, and all of them as a zip. Files are made in
 * the page and saved with saveBlob; nothing is sent anywhere or stored.
 */

const ExportDlg = { tables: [] };

/** statsTables for what's picked: its messages, its calls in the date range, the names choice. */
function exportTables() {
  const calls = inDates(Select.calls(), View.filter.from, View.filter.to);
  return statsTables(Select.agg(), calls.length ? aggregateCalls(calls) : null, {
    anon: $('#exportAnon').checked,
    labelFor: plainName,
    senderLabel,
    appsOf: (k) => Data.keySources(k),
    sources: Sources.list,
    reactions: Select.reactions(),
  });
}

const csvBlob = (t) => new Blob([toCsv(t.header, t.rows)], { type: 'text/csv;charset=utf-8' });

function renderExportList() {
  ExportDlg.tables = exportTables();
  const rows = (n) => `${fmtNum(n)} row${n === 1 ? '' : 's'}`;
  $('#exportList').innerHTML = html`${ExportDlg.tables.map((t) => html`<li>
    <div class="export-what"><b>${t.file}</b><span class="sub">${t.title} · ${rows(t.rows.length)}</span></div>
    <button class="btn small" type="button" data-file="${t.file}" aria-label="Download ${t.file}">Download</button>
  </li>`)}`;
  $('#exportCount').textContent = `${ExportDlg.tables.length} files`;
}

function openExportDialog() {
  if ($('#exportBtn').disabled) return;
  $('#exportAnon').checked = false; // names are in by default, every time (R7)
  $('#exportScope').textContent = $('#scope').textContent;
  renderExportList();
  const dlg = $('#exportDlg');
  if (!dlg.open) dlg.showModal();
}

function initExport() {
  const dlg = $('#exportDlg');
  $('#exportBtn').addEventListener('click', openExportDialog);
  $('#exportAnon').addEventListener('change', renderExportList);
  $('#exportList').addEventListener('click', (e) => {
    const file = e.target.closest('button[data-file]')?.dataset.file;
    const t = file && ExportDlg.tables.find((x) => x.file === file);
    if (t) saveBlob(csvBlob(t), t.file);
  });
  $('#exportAll').addEventListener('click', () => {
    const files = ExportDlg.tables.map((t) => ({ file: t.file, csv: toCsv(t.header, t.rows) }));
    saveBlob(zipStore(files), `yapalytics-stats-${isoDay(Date.now())}.zip`);
  });
  dlg.querySelector('.profile-close').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); }); // the backdrop
}
