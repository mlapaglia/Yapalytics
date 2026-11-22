/* A conversation's profile (spec 008): its numbers over all time, whatever the filters. */

/** Spec 007 R4: how a linked person's conversations move between apps, for the profile. */
function profileCrossApp(key, msgs, name) {
  const P = aggregateCrossApp(msgs, View.appsGap).people.get(key);
  if (!P) return '';
  const K = crossKpis(P, name);
  return html`<h3 class="profile-h">Across apps</h3><div class="app-splits">${appSplitHtml(P, name)}</div>
    <div class="kpis profile-kpis apps-kpis">${K.switches}${K.who}${K.replies}</div>`;
}

/** A profile of one conversation, over all its messages (filters and dates aside). */
function openProfile(key) {
  const msgs = Data.messagesOf(key);
  if (!msgs.length) return;
  const A = aggregateMessages(msgs, View.convoGap);
  const F = profileFacts(msgs, A);
  const c = Data.contacts.get(key) || {};
  const group = key.startsWith('g:');
  const name = plainName(key);
  const them = group ? 'Everyone else' : name;
  const members = group ? new Set(msgs.filter((m) => !m.o).map((m) => m.sn || m.sk).filter(Boolean)).size + 1 : 0;
  const initials = group ? '👥' : (name.match(/\p{L}[\p{L}'-]*/gu) || []).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '#';
  const hue = [...key].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7) % 8;

  const tiles = [
    kpi('Messages', fmtNum(F.n), `${shareText(F.you.messages, F.n)} from you`),
    kpi('Since', fmtDate.day(F.first.t), agoText(F.first.t)),
    kpi('Last message', fmtDate.day(F.last.t), agoText(F.last.t)),
    kpi('Longest streak', F.longestStreak.len ? `${fmtNum(F.longestStreak.len)} days` : '–', F.longestStreak.len ? `${shortDate(F.longestStreak.start)} – ${shortDate(F.longestStreak.end)}` : '', 'Consecutive days with at least one message'),
    kpi('Busiest month', F.busiestMonth ? fmtDate.monthShort(monthToTs(F.busiestMonth.mo)) : '–', F.busiestMonth ? `${fmtNum(F.busiestMonth.n)} messages` : ''),
    kpi('Favorite time', hourText(F.peakHour), WEEKDAY_PLURAL[F.peakDow]),
  ];

  // You vs them: the side that leads on each row is marked.
  const vsRows = [
    ['Messages', F.you.messages, F.them.messages, fmtNum, 'high'],
    ['Starts conversations', F.you.starts, F.them.starts, fmtNum, 'high'],
    ['Usually replies in', F.you.reply, F.them.reply, fmtDuration, 'low'],
    ['Average length', F.you.avgLen, F.them.avgLen, (v) => `${fmtNum(v)} chars`, 'high'],
    ['Double texts', F.you.doubles, F.them.doubles, fmtNum, 'high'],
    ['Questions asked', F.you.questions, F.them.questions, fmtNum, 'high'],
    ['Late-night messages', F.you.night, F.them.night, fmtNum, 'high'],
    ['Favorite emoji', F.you.emoji, F.them.emoji, (v) => (v.length ? v.map(([e]) => e).join(' ') : '–'), null],
  ];
  // Only a clear difference counts (5%+, and different once formatted).
  const lead = (a, b, way, fmt) => {
    if (!way || a == null || b == null || fmt(a) === fmt(b) || Math.abs(a - b) < 0.05 * Math.max(a, b)) return ['', ''];
    const aWins = way === 'low' ? a < b : a > b;
    return aWins ? ['lead', ''] : ['', 'lead'];
  };
  const vs = html`<table class="vs"><thead><tr><th></th><th>You</th><th>${them}</th></tr></thead><tbody>${vsRows.map(([label, a, b, fmt, way]) => {
    const [la, lb] = lead(a, b, way, fmt);
    return html`<tr><th scope="row">${label}</th><td class="${la}">${fmt(a)}</td><td class="${lb}">${fmt(b)}</td></tr>`;
  })}</tbody></table>`;

  $('#profileTop').innerHTML = html`
    <header class="profile-head">
      <div class="avatar" style="background: var(--series-${hue + 1})" aria-hidden="true">${initials}</div>
      <div>
        <h2 id="profileName">${name}</h2>
        <p class="sub">${group ? `Group chat · ${fmtNum(members)} people` : '1-on-1'} on ${c.person ? andList(c.sources.map((s) => sourceName(s))) : sourceName(c.s)} · all time</p>
        ${c.person ? html`<p class="sub profile-linked">Linked: ${c.threads.map((k) => `${threadName(Data.contacts.get(k))} (${sourceName(Data.contacts.get(k).s)})`).join(', ')}</p>` : ''}
      </div>
    </header>
    <div class="kpis profile-kpis">${tiles}</div>
    <h3 class="profile-h">You and ${them === 'Everyone else' ? 'everyone else' : them}</h3>
    ${vs}${c.person ? profileCrossApp(key, msgs, name) : ''}`;

  const words = distinctiveWords(msgs, Select.docFreq(), 15);
  const started = F.firstText;
  const bottom = [];
  if (group) {
    const rows = senderBreakdown(msgs, key);
    bottom.push(html`<h3 class="profile-h">Most active</h3><ol class="plain-list member-list">${rows.map((r) =>
      html`<li><span>${r.label}</span><span class="meta">${fmtNum(r.n)} · ${shareText(r.n, F.n)}</span></li>`)}</ol>`);
  }
  if (words.length) {
    bottom.push(html`<h3 class="profile-h">What you talk about</h3><p class="sub profile-sub">Words that set this conversation apart</p><div class="chips">${words.map((w) => html`<span class="chip">${w.w}</span>`)}</div>`);
  }
  if (started) {
    bottom.push(html`<h3 class="profile-h">How it started</h3><blockquote class="first-msg"><p>${clip(started.b, 280)}</p><footer>${started.o ? 'You' : momentSender(started)}, ${fmtDate.weekday(started.t)}</footer></blockquote>`);
  }
  const linkLabel = c.person ? 'Manage links…' : isLinkable(c) ? 'Same person on another app? Link…' : '';
  const linkBtn = linkLabel ? html`<button class="btn" type="button" data-link-people="${key}">${linkLabel}</button>` : '';
  bottom.push(html`<div class="profile-actions">${linkBtn}<button class="btn primary" type="button" data-focus="${key}">Focus the dashboard on ${name}</button></div>`);
  $('#profileBottom').innerHTML = html`${bottom}`;

  const dlg = $('#profile');
  if (!dlg.open) dlg.showModal();
  dlg.scrollTop = 0;
  const months = [];
  for (let mo = F.first.mo; mo <= F.last.mo; mo++) months.push(mo);
  const get = (o) => (mo) => (A.months.get(mo) || { c: [0, 0] }).c[o];
  const ui = currentTheme();
  Charts.set('c-profile', monthlyStackOption(ui, months, [
    { name: 'You', color: ui.sent, get: get(1) },
    { name: them, color: ui.recv, get: get(0) },
  ]));
}

function initProfile() {
  const dlg = $('#profile');
  dlg.querySelector('.profile-close').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); }); // the backdrop
  // Names across the dashboard open profiles; a profile's buttons focus it or link it.
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-profile], [data-focus], [data-link-people]');
    if (!t) return;
    if (t.dataset.profile) openProfile(t.dataset.profile);
    else if (t.dataset.focus) {
      dlg.close();
      setContact(t.dataset.focus);
    } else if (t.dataset.linkPeople) {
      dlg.close();
      openPeopleDialog(t.dataset.linkPeople);
    }
  });
}
