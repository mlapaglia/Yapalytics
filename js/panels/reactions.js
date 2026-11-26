/* The reaction cards on the Mood & emoji tab (spec 027 R12–R16). */

/** "SMS, Instagram and Telegram" for a set of app ids. */
function reactAppNames(ids) {
  return andList([...ids].sort((a, b) => a - b).map((s) => Sources.byId(s)?.name || String(s)));
}

/** R12: reactions given and got, and the top reaction emoji. */
function renderReactionTotals(ui, R) {
  const total = R.n[0] + R.n[1];
  const note = $('#reactionsNote');
  if (!total) {
    note.textContent = 'Reactions you gave and got';
    Charts.set('c-reactions', emptyOption(ui, 'No reactions in this selection'));
    return;
  }
  const unmatched = R.unmatched
    ? ` ${fmtNum(R.unmatched)} reaction text${R.unmatched === 1 ? '' : 's'} couldn’t be matched to a message in the 24 hours before ${R.unmatched === 1 ? 'it' : 'them'}.`
    : '';
  note.textContent = `You gave ${fmtNum(R.n[1])} reactions and got ${fmtNum(R.n[0])}.${unmatched} A reaction text to a photo or video is matched to the latest one sent before it, since phones don’t say which.`;
  Charts.set('c-reactions', reactionsOption(ui, R));
}

/** R13: time to react, with each side's median. */
function renderReactTime(ui, R) {
  const note = $('#reactTimeNote');
  const timed = R.timed[0] + R.timed[1];
  if (!timed) {
    note.textContent = 'How long after a message someone reacted to it. SMS, Instagram, Messenger and Telegram exports say when.';
    Charts.set('c-reacttime', emptyOption(ui, R.n[0] + R.n[1] ? 'No reactions with a time in this selection' : 'No reactions in this selection'));
    return;
  }
  const med = (o) => (R.median[o] == null ? `too few to say (${fmtNum(R.timed[o])})` : fmtDuration(R.median[o]));
  note.textContent = `Median: you ${med(1)}, them ${med(0)}. Times come from ${reactAppNames(R.timedApps)}; other apps don’t say when someone reacted.`;
  Charts.set('c-reacttime', reactTimeOption(ui, R));
}

/** R14: reactions on your own message, and instead of a reply. */
function renderReactHow(ui, R) {
  if (!(R.n[0] + R.n[1])) {
    Charts.set('c-reacthow', emptyOption(ui, 'No reactions in this selection'));
    return;
  }
  Charts.set('c-reacthow', reactHowOption(ui, R));
}

function renderReactWho(R, A) {
  const box = $('#reactWho');
  const rows = reactWhoRows(R, A);
  if (!rows.length) {
    box.innerHTML = html`<p class="muted">${R.n[0] + R.n[1] ? `No conversation here has reactions and at least ${REACT_WHO_MIN} messages from each side.` : 'No reactions in this selection'}</p>`;
    return;
  }
  const rate = (x) => x.toFixed(1);
  box.innerHTML = html`<div class="table-wrap"><table class="vs react-who">
    <thead><tr><th></th><th scope="col" title="Their reactions on your messages, per 100 of your messages">They react</th><th scope="col" title="Your reactions on their messages, per 100 of their messages">You react</th></tr></thead>
    <tbody>${rows.map((r) => html`<tr data-key="${r.k}"><th scope="row"><button type="button" class="react-who-name" title="Open the profile">${labelFor(r.k)}</button></th><td title="${fmtNum(r.them)} reactions">${rate(r.themRate)}</td><td title="${fmtNum(r.you)} reactions">${rate(r.youRate)}</td></tr>`)}</tbody>
  </table></div>`;
}

const REACT_TOP_MEDIA = [['ph', '📷 Photo'], ['gf', '🎞️ GIF'], ['vd', '🎬 Video'], ['au', '🎤 Audio'], ['ot', '📎 File']];

/** R16: the most-reacted messages, with a button to read that day. */
function renderReactTop(R) {
  const box = $('#reactTop');
  if (!R.top.length) {
    box.innerHTML = html`<p class="muted">No reactions in this selection</p>`;
    return;
  }
  const all = View.filter.contact === 'all';
  box.innerHTML = html`<ul class="plain-list react-top">${R.top.map(({ m, n, chips }) => {
    const who = m.o ? 'You' : messageSender(m);
    // Where it was, as the word tracker says it: "to Alex" for yours, "in" a group.
    const where = !all ? '' : isGroupKey(m.k) ? `in ${labelFor(m.k)}` : m.o ? `to ${labelFor(m.k)}` : '';
    const text = m.b ? truncate(m.b, 160) : REACT_TOP_MEDIA.filter(([k]) => m[k]).map(([, label]) => label).join(' · ') || '📎 Attachment';
    return html`<li data-day="${m.d}" data-contact="${m.k}">
      <span class="react-top-text"><b>${who}</b>${where ? ` · ${where}` : ''} · <span class="muted">${fmtDate.day(m.t)}</span><br>${text}</span>
      <span class="react-top-side"><span class="reactions">${chips.map((c) => html`<span class="rx">${c.r}${c.c > 1 ? html`<b>${fmtNum(c.c)}</b>` : ''}</span>`)}</span>
      <button class="btn small ghost" type="button" data-read-day aria-label="Read that day (${fmtNum(n)} reactions)">Read →</button></span>
    </li>`;
  })}</ul>`;
}

Panels.register({
  id: 'reactions',
  tab: 'sec-mood',
  topics: ['data', 'selection', 'theme', 'gap'],
  render(ctx) {
    const { ui } = ctx;
    const R = Select.reactions();
    renderReactionTotals(ui, R);
    renderReactTime(ui, R);
    renderReactHow(ui, R);
    renderReactWho(R, ctx.agg());
    renderReactTop(R);
  },
  init() {
    $('#reactWho').addEventListener('click', (e) => {
      const tr = e.target.closest('tr[data-key]');
      if (tr) openProfile(tr.dataset.key);
    });
    $('#reactTop').addEventListener('click', (e) => {
      const b = e.target.closest('[data-read-day]');
      if (!b) return;
      const li = b.closest('li');
      // A search or mood pick from before could hide the message, so both are cleared.
      readDay(dayToTs(+li.dataset.day), { contact: View.filter.contact === 'all' ? li.dataset.contact : null, clearMood: true, clearSearch: true });
    });
  },
});
