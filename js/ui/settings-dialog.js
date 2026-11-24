/*
 * The Settings dialog (spec 015): the conversation gap, group chats, who's you and
 * linked people. The owner rows are filled by owner-dialog.js and the Linked people
 * section by people-dialog.js; this file owns the button, the dialog and the gap.
 */

/** The button's count: suggested links plus apps whose owner is a guess (R2). */
function updateSettingsButton() {
  const links = PeopleDlg.suggestions.length;
  const why = [];
  if (links) why.push(`${fmtNum(links)} possible link${links === 1 ? '' : 's'} between conversations with the same person`);
  if (ownerGuessed.length) why.push(`Check ${andList(ownerGuessed.map((s) => sourceName(s)))}: who's you was guessed`);
  const n = links + ownerGuessed.length;
  const btn = $('#settingsBtn');
  btn.textContent = n ? `⚙️ Settings (${n})` : '⚙️ Settings';
  btn.title = why.length ? why.join(' · ') : "Conversation gap, group chats, who's you and linked people";
}

function openSettingsDialog() {
  const dlg = $('#settingsDlg');
  if (!dlg.open) dlg.showModal();
}

function markGap() {
  $$('#gapSeg button').forEach((b) => b.classList.toggle('on', +b.dataset.gap === View.convoGap));
}

// The gap buttons follow View.convoGap however it changes.
Panels.register({ id: 'settings', topics: ['gap'], render: markGap });

function initSettings() {
  View.convoGap = Prefs.convoGap; // the saved gap (R6)
  const dlg = $('#settingsDlg');
  $('#gapSeg').innerHTML = html`${CONVO_GAPS.map((g) => html`<button type="button" data-gap="${g}" title="A conversation ends after ${fmtGapWords(g)} of quiet">${fmtGapShort(g)}</button>`)}`;
  markGap();
  $('#gapSeg').addEventListener('click', (e) => {
    const g = +e.target.closest('button[data-gap]')?.dataset.gap;
    if (!g) return;
    Prefs.saveConvoGap(g);
    View.set({ convoGap: g });
  });
  $('#settingsBtn').addEventListener('click', openSettingsDialog);
  // "Change" next to a note that names a setting (R10).
  $('#dash').addEventListener('click', (e) => { if (e.target.closest('[data-settings]')) openSettingsDialog(); });
  dlg.querySelector('.profile-close').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); }); // the backdrop
}
