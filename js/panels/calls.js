/* The Calls tab (SMS Backup & Restore call logs). */

/** The conversations behind the Call contacts chart, most talk time first. */
let callRows = [];
const CALL_CONTACTS_ON = { click: (p) => { const row = callRows[p.dataIndex]; if (row && View.filter.contact === 'all') setContact(row.key); } };

function renderCalls(ui) {
  const section = $('#callsSection');
  const base = Select.calls();
  if (!base.length) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  const calls = inDates(base, View.filter.from, View.filter.to);
  const C = aggregateCalls(calls);
  const talk = C.talk[0] + C.talk[1];
  const connected = C.byType[0] + C.byType[1];
  const answeredDur = calls.filter((c) => (c.ty === 1 || c.ty === 2) && c.du > 0).length;
  $('#callKpis').innerHTML = html`${[
    kpi('Calls', fmtNum(C.n), `${fmtNum(C.byType[0])} out · ${fmtNum(C.byType[1])} in`),
    kpi('Talk time', fmtDuration(talk * 1000), `${fmtDuration(C.talk[1] * 1000)} out · ${fmtDuration(C.talk[0] * 1000)} in`),
    kpi('Average call', answeredDur ? fmtDuration((talk / answeredDur) * 1000) : '–', `across ${fmtNum(connected)} connected calls`),
    kpi('Longest call', C.longest ? fmtDuration(C.longest.du * 1000) : '–', C.longest ? `${labelFor(C.longest.k)} · ${new Date(C.longest.t).toLocaleDateString()}` : ''),
    kpi('Missed', fmtNum(C.byType[2]), `${fmtNum(C.byType[3])} voicemail · ${fmtNum(C.byType[4])} declined`),
  ]}`;

  if (!calls.length) {
    for (const id of ['c-call-trend', 'c-call-hour', 'c-call-dur', 'c-call-contacts']) Charts.set(id, emptyOption(ui, 'No calls in this selection'));
    return;
  }
  Charts.set('c-call-trend', callTrendOption(ui, C));
  Charts.set('c-call-hour', callHourOption(ui, C));
  Charts.set('c-call-dur', callDurOption(ui, C));
  callRows = [...C.contacts.entries()]
    .map(([key, v]) => ({ key, label: labelFor(key), n: v.n, talk: v.talk }))
    .filter((r) => r.talk > 0)
    .sort((a, b) => b.talk - a.talk)
    .slice(0, 15);
  Charts.set('c-call-contacts', callRows.length ? callContactsOption(ui, callRows) : emptyOption(ui, 'No connected calls'), { on: CALL_CONTACTS_ON });
}

Panels.register({
  id: 'calls',
  tab: 'callsSection',
  topics: ['data', 'selection', 'theme'],
  render: (ctx) => renderCalls(ctx.ui),
});
