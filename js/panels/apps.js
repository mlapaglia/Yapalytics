/* The Across apps tab (spec 007): how linked people move between apps. */

const shareText = (a, b) => (b ? Math.round((a / b) * 100) + '%' : '–');

const sortedApps = (P) => [...P.apps.keys()].sort((a, b) => a - b);

const appNames = (apps) => andList([...apps].sort((a, b) => a - b).map((s) => sourceName(s)));

const monthText = (mo) => new Date(monthToTs(mo)).toLocaleDateString(undefined, { year: 'numeric', month: 'short' });

const TRIGGER_TEXT = { share: 'A shared post', link: 'A link', media: 'A photo, video or GIF', text: 'A plain message' };

/** M1: a bar of each app's share. `counts`: [[app, n]]. */
function appSplitBar(counts, cls = '') {
  const total = counts.reduce((s, [, n]) => s + n, 0);
  const parts = counts.filter(([, n]) => n).map(([s, n]) => ({ s, n, text: `${sourceName(s)} ${shareText(n, total)}` }));
  const bar = html`<div class="app-split ${cls}" role="img" aria-label="${parts.map((p) => p.text).join(', ')}">${parts.map((p) =>
    html`<span style="flex: ${p.n} 1 0; background: var(--series-${p.s + 1})" title="${p.text}"></span>`)}</div>`;
  return { bar, parts };
}

/** M1 for both sides: everyone, you, them. */
function appSplitHtml(P, them) {
  const apps = sortedApps(P);
  const row = (label, n) => {
    const { bar, parts } = appSplitBar(apps.map((s) => [s, n(P.apps.get(s))]));
    return html`<div class="app-split-row"><span class="app-split-label">${label}</span>${bar}<span class="app-split-legend">${parts.map((p) =>
      html`<span><i style="background: var(--series-${p.s + 1})"></i>${p.text}</span>`)}</span></div>`;
  };
  return html`${row('Both of you', (a) => a.n[0] + a.n[1])}${row('You', (a) => a.n[1])}${row(them, (a) => a.n[0])}`;
}

/** M6: who makes most of the moves, as [who, "68%"], or null without switches. */
function whoSwitches(P, them) {
  if (!P.switches) return null;
  const you = P.switchBy[1] / P.switches;
  return you >= 0.5 ? ['You', shareText(P.switchBy[1], P.switches)] : [them, shareText(P.switchBy[0], P.switches)];
}

/** The Switching apps tiles (M2–M6, M9). `them`: the other side's name, or 'They'. */
function crossKpis(P, them) {
  const replies = P.replies[0] + P.replies[1];
  const cross = P.crossReplies[0] + P.crossReplies[1];
  const crossMs = median([...P.crossMs[0], ...P.crossMs[1]]);
  const sameMs = median([...P.sameMs[0], ...P.sameMs[1]]);
  const who = whoSwitches(P, them);
  return {
    switches: kpi('Switches', fmtNum(P.switches), `${P.sessions ? (P.switches / P.sessions).toFixed(1) : '–'} per conversation`, 'Times the next message in a conversation came on a different app'),
    multi: kpi('Multi-app conversations', shareText(P.multiSessions, P.sessions), `${fmtNum(P.multiSessions)} of ${fmtNum(P.sessions)} conversations`, 'Conversations that used more than one app'),
    bounce: kpi('Back and forth', shareText(P.bounceSessions, P.sessions), 'left an app and came back', 'Conversations that moved to another app and then back again'),
    days: kpi('Multi-app days', shareText(P.multiDays, P.days), `${fmtNum(P.multiDays)} of ${fmtNum(P.days)} active days`, 'Days with messages on more than one app'),
    who: kpi('Who switches', who ? who[0] : '–', who ? `${who[0] === 'You' || who[0] === 'They' ? 'make' : 'makes'} ${who[1]} of the moves` : 'no switches yet', 'Who sent the first message on the new app'),
    replies: kpi('Cross-app replies', shareText(cross, replies), `answered on another app · ${fmtDuration(crossMs)} vs ${fmtDuration(sameMs)} same-app`, 'Replies sent on a different app than the message they answer, and the median reply time for each'),
  };
}

const peakHour = (hours) => hours.reduce((best, n, h) => (n > hours[best] ? h : best), 0);

function renderCrossApp(ui, X) {
  const all = View.filter.contact === 'all';
  const P = all ? X.total : X.people.get(View.filter.contact);
  const them = all ? 'They' : plainName(View.filter.contact);
  const gapWords = fmtGapWords(View.appsGap);
  $$('#appsGapSeg button').forEach((b) => b.classList.toggle('on', +b.dataset.gap === View.appsGap));
  $('#appsNote').textContent = all
    ? `${fmtNum(X.people.size)} linked ${X.people.size === 1 ? 'person' : 'people'} on more than one app in this selection · a conversation ends after ${gapWords} of quiet`
    : `You and ${them} on ${appNames(P.apps.keys())} · a conversation ends after ${gapWords} of quiet`;
  $('#appsSplit').innerHTML = appSplitHtml(P, all ? 'Them' : them);
  $('#appsKpis').innerHTML = html`${Object.values(crossKpis(P, them))}`;

  // M12: the conversation with the most switches
  const b = P.busiest;
  if (b) {
    const d = new Date(b.start);
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    $('#appsJuggle').innerHTML = html`Biggest juggle: <b>${fmtNum(b.switches)} switch${b.switches === 1 ? '' : 'es'}</b> between ${appNames(b.apps)}${all ? html` with ${personLink(b.k)}` : ''} on ${longDate(b.start)}. ` +
      html`<button class="btn small ghost" type="button" data-otd-day="${day}" data-contact="${b.k}">Read that day →</button>`;
  } else $('#appsJuggle').textContent = 'No conversation here has moved between apps yet.';

  // Linked people (All conversations only)
  show('#appsPeopleCard', all);
  if (all) {
    const rows = [...X.people].sort((a, b) => b[1].switches - a[1].switches || b[1].n - a[1].n);
    $('#appsPeople').innerHTML = html`<thead><tr><th>Person</th><th>Messages</th><th>Apps</th><th>Switches</th><th>Per conversation</th><th>Multi-app</th><th>Who switches</th><th>Main app</th></tr></thead>` +
      html`<tbody>${rows.map(([k, Q]) => {
        const who = whoSwitches(Q, plainName(k));
        const { bar } = appSplitBar(sortedApps(Q).map((s) => [s, Q.apps.get(s).n[0] + Q.apps.get(s).n[1]]), 'mini');
        return html`<tr data-person="${k}"><td>${personLink(k)}</td><td>${fmtNum(Q.n)}</td><td class="apps-cell">${bar}</td><td>${fmtNum(Q.switches)}</td>
          <td>${Q.sessions ? (Q.switches / Q.sessions).toFixed(1) : '–'}</td><td>${shareText(Q.multiSessions, Q.sessions)}</td>
          <td>${who ? `${who[0]} ${who[1]}` : '–'}</td><td>${sourceName(Q.mainApp)}</td></tr>`;
      })}</tbody>`;
  }

  // M11: main app over time
  Charts.set('c-appshare', appShareOption(ui, P.months, sourceNames()));
  const shifts = all ? [...X.people].flatMap(([k, Q]) => Q.shifts.map((s) => ({ ...s, k }))) : P.shifts;
  const moves = shifts.sort((a, b) => a.mo - b.mo).map((s, i) =>
    html`${i ? '; ' : ''}${all ? html`${personLink(s.k)}: m` : 'M'}oved from ${sourceName(s.from)} to ${sourceName(s.to)} around ${monthText(s.mo)}`);
  $('#appsShareNote').innerHTML = html`Each app’s share of messages per month${moves.length ? html`. ${moves}.` : ''}`;

  // M7, M8: routes and what sets off a switch
  Charts.set('c-routes', P.switches ? switchRoutesOption(ui, P.routes, sourceNames()) : emptyOption(ui, 'No switches in this selection'));
  const kinds = CROSS_TRIGGERS.filter((t) => t !== 'share' || [...P.apps.keys()].some((s) => Sources.byId(s).shares) || P.triggers.share);
  $('#appsTriggers').innerHTML = P.switches
    ? html`${kinds.map((t) => html`<li><span>${TRIGGER_TEXT[t]}</span><span class="meter" aria-hidden="true"><i style="width: ${(P.triggers[t] / P.switches) * 100}%"></i></span><span class="meta">${shareText(P.triggers[t], P.switches)} · ${fmtNum(P.triggers[t])}</span></li>`)}`
    : html`<li class="empty">No switches in this selection.</li>`;

  // M10: what each app is for
  const apps = sortedApps(P);
  const avg = (a) => (a.lenN ? Math.round(a.lenSum / a.lenN) : 0);
  const n = (a) => a.n[0] + a.n[1];
  const rows = [
    ['Messages', (a) => fmtNum(n(a))],
    ['From you', (a) => shareText(a.n[1], n(a))],
    ['Average length', (a) => `${fmtNum(avg(a))} chars`],
    ['Photos & videos', (a) => shareText(a.visual, n(a))],
    ['Links & shares', (a) => shareText(a.links, n(a))],
    ['Busiest hour', (a) => hourText(peakHour(a.hour))],
    ['Conversations you start', (a) => fmtNum(a.starts[1])],
    [`Conversations ${all ? 'they start' : `${them} starts`}`, (a) => fmtNum(a.starts[0])],
    ['You usually reply in', (a) => fmtDuration(a.replyMedian[1])],
    [`${all ? 'They usually reply' : `${them} usually replies`} in`, (a) => fmtDuration(a.replyMedian[0])],
  ];
  $('#appsForNote').textContent = 'A conversation counts on the app it started on; a reply on the app it was sent on';
  $('#appsFor').innerHTML = html`<thead><tr><th></th>${apps.map((s) => html`<th scope="col">${sourceName(s)}</th>`)}</tr></thead>
    <tbody>${rows.map(([label, fmt]) => html`<tr><th scope="row">${label}</th>${apps.map((s) => html`<td>${fmt(P.apps.get(s))}</td>`)}</tr>`)}</tbody>`;
}

Panels.register({
  id: 'apps',
  tab: 'sec-apps',
  topics: ['data', 'selection', 'appsGap', 'theme'],
  render(ctx) {
    if (!$('#sec-apps').hidden) renderCrossApp(ctx.ui, ctx.cross());
  },
  init() {
    $('#appsGapSeg').innerHTML = html`${APPS_GAPS.map((g) => html`<button data-gap="${g}" title="A conversation ends after ${fmtGapWords(g)} of quiet"${g === View.appsGap ? raw(' class="on"') : ''}>${fmtGapShort(g)}</button>`)}`;
    $('#appsGapSeg').onclick = (e) => {
      const g = +e.target.dataset.gap;
      if (g) View.set({ appsGap: g });
    };
  },
});
