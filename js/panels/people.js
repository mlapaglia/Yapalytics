/* The People tab: top conversations, relationships, leaderboard, drifted apart, new people, milestones. */

/** The top conversations (most messages first) behind the Top conversations chart. */
function topConversations(A) {
  return [...A.contacts.entries()]
    .map(([key, v]) => ({ key, label: labelFor(key), r: v[0], s: v[1], t: v[0] + v[1] }))
    .sort((a, b) => b.t - a.t)
    .slice(0, 40);
}
let topRows = [];

const LEADER_COLS = [
  { key: 'label', title: 'Conversation', sort: (r) => r.label.toLowerCase(), fmt: (r) => r.label },
  { key: 'n', title: 'Messages', sort: (r) => r.n, fmt: (r) => fmtNum(r.n) },
  { key: 'sent', title: 'You sent', sort: (r) => r.sent, fmt: (r) => Math.round(r.sent * 100) + '%' },
  { key: 'yourReply', title: 'Your reply', sort: (r) => r.yourReply ?? Infinity, fmt: (r) => fmtDuration(r.yourReply), asc: true },
  { key: 'theirReply', title: 'Their reply', sort: (r) => r.theirReply ?? Infinity, fmt: (r) => fmtDuration(r.theirReply), asc: true },
  { key: 'started', title: 'You start', sort: (r) => r.started ?? -1, fmt: (r) => (r.started == null ? '–' : Math.round(r.started * 100) + '%') },
  { key: 'len', title: 'Avg length', sort: (r) => r.lenYou, fmt: (r) => html`${r.lenYou} <span class="muted">/ ${r.lenThem}</span>` },
  { key: 'streak', title: 'Streak', sort: (r) => r.streak, fmt: (r) => `${fmtNum(r.streak)}d` },
  { key: 'sig', title: 'Signature', sort: (r) => r.sig || '', fmt: (r) => r.sig || '' , cls: 'emoji' },
  { key: 'first', title: 'First', sort: (r) => r.first, fmt: (r) => fmtDate.monthShort(r.first) },
  { key: 'last', title: 'Last', sort: (r) => r.last, fmt: (r) => fmtDate.day(r.last) },
];

function renderLeaderboard(A) {
  const avg = (bc, o) => (bc.lenN[o] ? Math.round(bc.lenSum[o] / bc.lenN[o]) : 0);
  const rows = [...A.byContact.entries()].map(([k, bc]) => {
    const n = bc.n[0] + bc.n[1];
    const st = bc.starters[0] + bc.starters[1];
    return {
      k, bc, n, label: labelFor(k), sent: bc.n[1] / n,
      yourReply: bc.replyMedian[1], theirReply: bc.replyMedian[0],
      started: st ? bc.starters[1] / st : null,
      lenYou: avg(bc, 1), lenThem: avg(bc, 0), streak: bc.longestRun, first: bc.first, last: bc.last,
    };
  });
  const col = LEADER_COLS.find((c) => c.key === View.leader.sort) || LEADER_COLS[1];
  const dir = View.leader.asc ? 1 : -1;
  rows.sort((a, b) => {
    const x = col.sort(a), y = col.sort(b);
    return (x < y ? -1 : x > y ? 1 : 0) * dir || b.n - a.n;
  });
  const shown = View.leader.all ? rows : rows.slice(0, 50);
  // Typed and reacted emoji (spec 027 R11a)
  const R = Select.reactions();
  const emojiFreq = withReactionEmoji(A.emojiFreq, R);
  const total = emojiTotal(emojiFreq);
  for (const r of shown) r.sig = signatureEmoji(convoEmojiWithReactions(r.bc, R, r.k), emojiFreq, total);

  const table = $('#leaderTable');
  table.innerHTML = html`<thead><tr>${LEADER_COLS.map((c) => html`<th data-key="${c.key}" class="${c.key === col.key ? 'sorted' + (View.leader.asc ? ' asc' : '') : ''}">${c.title}</th>`)}</tr></thead>` +
    html`<tbody>${shown.map((r) => html`<tr data-key="${r.k}">${LEADER_COLS.map((c) => html`<td class="${c.cls || ''}">${c.fmt(r)}</td>`)}</tr>`)}</tbody>`;
  const more = $('#leaderMore');
  more.hidden = rows.length <= 50;
  more.textContent = View.leader.all ? 'Show top 50' : `Show all ${fmtNum(rows.length)}`;
}

function renderDrifted(A) {
  const DAYS = 90;
  const rows = [...A.byContact.entries()].map(([k, bc]) => ({ k, n: bc.n[0] + bc.n[1], last: bc.last })).sort((a, b) => b.n - a.n);
  const cut = Math.max(20, rows.length ? rows[Math.floor((rows.length - 1) / 4)].n : 0); // top quartile, at least 20 messages
  const quiet = rows.filter((r) => r.n >= cut && A.last - r.last > DAYS * DAY_MS).slice(0, 15);
  const list = $('#driftList');
  list.innerHTML = quiet.length
    ? html`${quiet.map((r) => {
      const months = Math.round((A.last - r.last) / (30.4 * DAY_MS));
      return html`<li data-key="${r.k}"><span>${labelFor(r.k)}</span><span class="meta">${fmtNum(r.n)} messages · last ${fmtDate.day(r.last)} (${months < 1 ? '<1' : months} mo before the end of this range)</span></li>`;
    })}`
    : html`<li class="empty">Nobody you talked to a lot has gone quiet in this range.</li>`;
}

function newPeopleRows(A) {
  const byMonth = new Map();
  for (const k of A.byContact.keys()) {
    const t = Data.firstSeen.get(k);
    if (t == null || t < A.first) continue; // first message is before this range
    const d = new Date(t);
    const mo = d.getFullYear() * 12 + d.getMonth();
    let row = byMonth.get(mo);
    if (!row) byMonth.set(mo, (row = { mo, n: 0, names: [] }));
    row.n++;
    row.names.push(labelFor(k));
  }
  return [...byMonth.values()].sort((a, b) => a.mo - b.mo);
}

function renderMilestones(A) {
  const top = new Set([...A.byContact.entries()].sort((a, b) => (b[1].n[0] + b[1].n[1]) - (a[1].n[0] + a[1].n[1])).slice(0, 10).map(([k]) => k));
  const items = A.milestones
    .filter((m) => m.k === null || top.has(m.k))
    .sort((a, b) => b.t - a.t)
    .slice(0, 40);
  const date = (t) => fmtDate.long(t);
  $('#milestoneList').innerHTML = items.length
    ? html`${items.map((m) => {
      const title = m.k === null ? `${ordinal(m.n)} message` : m.n === 1 ? `First message with ${labelFor(m.k)}` : `${ordinal(m.n)} message with ${labelFor(m.k)}`;
      return html`<li><b>${title}</b><span class="meta">${date(m.t)}</span></li>`;
    })}`
    : html`<li class="empty">No milestones in this selection.</li>`;
}

Panels.register({
  id: 'people',
  tab: 'sec-people',
  topics: ['data', 'selection', 'theme'],
  render(ctx) {
    const { ui, all } = ctx;
    const A = ctx.agg();
    topRows = topConversations(A);
    // Clicking a bar focuses that conversation.
    const focus = { click: (p) => { const row = topRows[p.dataIndex]; if (row && View.filter.contact === 'all') setContact(row.key); } };
    Charts.set('c-contacts', ctx.none ? emptyOption(ui, 'No messages in this selection') : topContactsOption(ui, topRows), { on: focus });
    $('#contactsNote').textContent = all
      ? 'Click a bar to focus on that conversation.'
      : 'Showing one conversation. Pick “All conversations” to compare.';
    if (all) {
      ctx.put('c-relationships', () => relationshipsOption(ui, A, labelFor));
      renderDrifted(A);
      const np = newPeopleRows(A);
      Charts.set('c-newpeople', np.length ? newPeopleOption(ui, np) : emptyOption(ui, 'No new conversations in this range'));
    }
    renderMilestones(A);
  },
  init() {
    $('#driftList').addEventListener('click', (e) => {
      const li = e.target.closest('li[data-key]');
      if (li) openProfile(li.dataset.key);
    });
  },
});

Panels.register({
  id: 'leaderboard',
  tab: 'sec-people',
  topics: ['data', 'selection', 'gap', 'leader'],
  render(ctx) {
    if (ctx.all) renderLeaderboard(ctx.agg());
  },
  init() {
    $('#leaderTable').addEventListener('click', (e) => {
      const th = e.target.closest('th');
      if (th) {
        const key = th.dataset.key;
        const col = LEADER_COLS.find((c) => c.key === key);
        View.set({ leader: View.leader.sort === key ? { asc: !View.leader.asc } : { sort: key, asc: !!col.asc } });
        return;
      }
      const tr = e.target.closest('tbody tr');
      if (tr) openProfile(tr.dataset.key);
    });
    $('#leaderMore').addEventListener('click', () => View.set({ leader: { all: !View.leader.all } }));
  },
});
