/* The Compare tab (spec 021): the date range side by side with an earlier period. */

/** "Mar 1 – May 31, 2026", or "Nov 29, 2025 – Feb 28, 2026" across a new year. */
function periodText(p) {
  const sameYear = new Date(p.from).getFullYear() === new Date(p.to).getFullYear();
  return `${sameYear ? fmtDate.dayOfMonth(p.from) : fmtDate.day(p.from)} – ${fmtDate.day(p.to)}`;
}

const daysText = (n) => `${fmtNum(n)} day${n === 1 ? '' : 's'}`;

/** The periods' short names, for column heads and chart legends; the headline gives their dates. */
const COMPARE_LABELS = ['Earlier', 'Date range'];

/** Column heads: each period's short name, with its dates under it on wide screens. */
function compareHeadRow(P) {
  const col = (label, p) => html`<th scope="col" title="${periodText(p)}">${label}<small class="cmp-dates">${periodText(p)}</small></th>`;
  return html`<tr><th></th>${col(COMPARE_LABELS[0], P.a)}${col(COMPARE_LABELS[1], P.b)}<th scope="col">Change</th></tr>`;
}

/** R2: both periods, and how long each is. */
function compareHeadline({ a, b }) {
  const both = `${periodText(b)} compared with ${periodText(a)}`;
  return a.days === b.days
    ? `${both} · ${daysText(b.days)} each`
    : `${both} · ${daysText(b.days)} and ${daysText(a.days)}. Changes compare messages per day.`;
}

/** A row's value as the table shows it. */
function compareValueText(fmt, v) {
  if (v == null) return '–';
  if (fmt === 'pct') return pctText(v);
  if (fmt === 'dur') return fmtDuration(v);
  if (fmt === 'int') return fmtNum(v);
  return v >= 100 ? fmtNum(v) : v.toFixed(1);
}

/** A change with its arrow: ▲ / ▼ say which way it went, nothing more. */
function compareChangeHtml(c) {
  if (!c) return '';
  const arrow = c.dir > 0 ? '▲ ' : c.dir < 0 ? '▼ ' : '';
  return html`<span class="cmp-change${c.dir ? '' : ' cmp-same'}">${arrow}${compareChangeText(c)}</span>`;
}

/** The start buttons (R4, R6): set the date range and what it's compared with, in one redraw. */
function startComparison(preset) {
  const { last } = dataBounds();
  const end = new Date(last);
  if (preset === 'ytd') {
    View.set({ filter: { from: new Date(end.getFullYear(), 0, 1).getTime(), to: null }, compare: { mode: 'year' } });
    return;
  }
  // The same dates as the 90-day and Last year presets (js/ui/filters.js).
  const days = +preset;
  const from = new Date(end.getFullYear(), end.getMonth(), end.getDate() - days + 1).getTime();
  View.set({ filter: { from, to: null }, compare: { mode: 'before' } });
}

function renderComparePeople(A, B, P) {
  const { top, fresh, quiet } = comparePeople(A, B, P.a.days, P.b.days);
  $('#comparePeople').innerHTML = top.length
    ? html`<thead>${compareHeadRow(P)}</thead>
      <tbody>${top.map((r) => html`<tr><th scope="row">${personLink(r.k, labelFor(r.k))}</th><td>${fmtNum(r.a)}</td><td>${fmtNum(r.b)}</td><td>${compareChangeHtml(r.change)}</td></tr>`)}</tbody>`
    : html`<tbody><tr><td class="muted">No messages in the date range</td></tr></tbody>`;
  const list = (title, rows, side, id) => html`<div class="cmp-list" id="${id}"><h3>${title}</h3>${rows.length
    ? html`<ul>${rows.map((r) => html`<li>${personLink(r.k, labelFor(r.k))} <span class="muted">${fmtNum(r[side])}</span></li>`)}</ul>`
    : html`<p class="muted">No one</p>`}</div>`;
  $('#compareLists').innerHTML = html`${list('New', fresh, 'b', 'compareNew')}${list('Went quiet', quiet, 'a', 'compareQuiet')}`;
}

function renderCompare(ctx) {
  const P = Select.periods();
  const { mode } = View.compare;
  $$('#compareMode button').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
  const ok = !!(P?.a && P.a.days >= COMPARE_MIN_DAYS);
  $('#compareMode').hidden = !P?.a;
  $('#compareCustom').hidden = !P?.a || mode !== 'custom';
  $('#compareStart').hidden = ok;
  $('#compareCard').hidden = !ok;
  $('#compareWhenCard').hidden = !ok;
  $('#comparePeopleCard').hidden = !ok || !ctx.all;

  if (!P) {
    $('#compareHeadline').textContent = 'No messages in this selection';
    return;
  }
  if (P.a) {
    const { first, last } = dataBounds();
    for (const el of [$('#cmpFrom'), $('#cmpTo')]) {
      el.min = toDateInput(first);
      el.max = toDateInput(last);
    }
    $('#cmpFrom').value = toDateInput(P.a.from);
    $('#cmpTo').value = toDateInput(P.a.to);
  }
  if (!P.a) {
    $('#compareHeadline').textContent = `${periodText(P.b)} · your whole history here`;
    $('#compareStartNote').textContent = 'Pick a date range above to compare it with an earlier one, or start with one of these:';
    return;
  }
  if (!ok) {
    $('#compareHeadline').textContent = periodText(P.b);
    $('#compareStartNote').textContent = `There's no history before ${fmtDate.day(P.b.from)} to compare with.`;
    return;
  }

  const A = Select.compareAgg();
  const B = ctx.agg();
  const labels = COMPARE_LABELS;
  $('#compareHeadline').textContent = compareHeadline(P);
  const rows = compareRows(A, B, P.a.days, P.b.days);
  $('#compareRows').innerHTML = html`<thead>${compareHeadRow(P)}</thead>
    <tbody>${rows.map((r) => html`<tr data-row="${r.id}"><th scope="row">${r.label}</th><td>${compareValueText(r.fmt, r.a)}</td><td>${compareValueText(r.fmt, r.b)}</td><td>${compareChangeHtml(r.change)}</td></tr>`)}</tbody>`;
  if (ctx.all) renderComparePeople(A, B, P);

  const { ui } = ctx;
  const pa = profileShares(A), pb = profileShares(B);
  const has = A.n > 0 || B.n > 0;
  Charts.set('c-cmp-hour', has ? compareHourOption(ui, pa.hour, pb.hour, labels) : emptyOption(ui, 'No messages in either period'));
  Charts.set('c-cmp-dow', has ? compareDowOption(ui, pa.dow, pb.dow, labels) : emptyOption(ui, 'No messages in either period'));
}

Panels.register({
  id: 'compare',
  tab: 'sec-compare',
  topics: ['data', 'selection', 'gap', 'compare', 'theme'],
  render: renderCompare,
  init() {
    $('#compareStart').addEventListener('click', (e) => {
      const p = e.target.closest('[data-compare-preset]')?.dataset.comparePreset;
      if (p) startComparison(p);
    });
    $('#compareMode').addEventListener('click', (e) => {
      const mode = e.target.closest('[data-mode]')?.dataset.mode;
      if (!mode || mode === View.compare.mode) return;
      // Custom starts from the period it replaces, so nothing jumps until a date is changed.
      const a = Select.periods()?.a;
      View.set({ compare: mode === 'custom' && a ? { mode, from: a.from, to: a.to } : { mode } });
    });
    $('#cmpFrom').addEventListener('change', (e) => {
      const from = fromDateInput(e.target.value, false);
      if (from != null) View.set({ compare: { from } });
    });
    $('#cmpTo').addEventListener('change', (e) => {
      const to = fromDateInput(e.target.value, true);
      if (to != null) View.set({ compare: { to } });
    });
  },
});
