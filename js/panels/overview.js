/* The Overview tab: KPI tiles, highlights and On this day. */

function renderKpis(A) {
  const total = A.dir[0] + A.dir[1];
  const avgLen = (o) => (A.lenN[o] ? Math.round(A.lenSum[o] / A.lenN[o]) : 0);
  const media = (o) => MEDIA_TYPES.reduce((s, m) => s + A.media[m.key][o], 0);
  const convos = A.contacts.size;
  const groups = [...A.contacts.keys()].filter((k) => k.startsWith('g:')).length;
  let nightCount = 0;
  for (const [n] of A.night.values()) nightCount += n;
  const tiles = [
    kpi('Messages', fmtNum(total), `${fmtNum(A.dir[1])} sent · ${fmtNum(A.dir[0])} received`),
    kpi('You sent', shareText(A.dir[1], total), `of all messages`),
    kpi('Per day', A.spanDays ? (total / A.spanDays).toFixed(1) : '–', `${fmtNum(A.activeDays)} active of ${fmtNum(A.spanDays)} days`),
    kpi('Busiest day', A.busiestDay ? fmtNum(A.busiestDay.n) : '–', A.busiestDay ? dayLabel(A.busiestDay.d) : ''),
    kpi('Longest streak', A.longestStreak.len ? `${fmtNum(A.longestStreak.len)} days` : '–', A.longestStreak.len ? `${shortDate(A.longestStreak.start)} – ${shortDate(A.longestStreak.end)}` : '', 'Consecutive days with at least one message'),
    kpi('Longest silence', A.longestSilence.len ? `${fmtNum(A.longestSilence.len)} days` : '–', A.longestSilence.len ? `${shortDate(A.longestSilence.start)} – ${shortDate(A.longestSilence.end)}` : '', 'Longest run of days with no messages'),
    kpi('Conversations', fmtNum(convos), `${fmtNum(groups)} group chats`),
    kpi('Your reply time', fmtDuration(A.replyMedian[1]), `median · theirs ${fmtDuration(A.replyMedian[0])}`, `Median time to answer, within ${fmtGapWords(View.convoGap)}`),
    kpi('Avg length', html`${avgLen(1)} <small>/ ${avgLen(0)}</small>`, 'characters · sent / received'),
    kpi('Words', fmtNum(A.words[0] + A.words[1]), `${fmtNum(A.words[1])} sent · ${fmtNum(A.words[0])} received`),
    kpi('Emoji', fmtNum(A.emoji[0] + A.emoji[1]), `in ${shareText(A.emojiMsgs[0] + A.emojiMsgs[1], total)} of messages`),
    kpi('Attachments', fmtNum(media(0) + media(1)), `${fmtNum(A.media.ph[0] + A.media.ph[1])} photos · ${fmtNum(A.media.vd[0] + A.media.vd[1])} videos · ${fmtBytes(A.mediaBytes)}`),
    kpi('Night owl', shareText(nightCount, total), A.latestNight ? `latest ${fmtDate.time(A.latestNight.t)}` : 'no messages after midnight', 'Messages between midnight and 5am'),
    kpi('Longest conversation', A.longestSession ? html`${fmtNum(A.longestSession.n)} <small>msgs</small>` : '–', A.longestSession ? `${labelFor(A.longestSession.k)} · ${fmtDate.numeric(A.longestSession.start)}` : '', `Most messages with no ${fmtGapWords(View.convoGap)} of quiet in between`),
  ];
  $('#kpis').innerHTML = html`${tiles}`;
}

function renderHighlights(msgs, A, X) {
  const crossApp = X ? crossAppHighlight(X, { labelFor: plainName, names: sourceNames() }) : null;
  const items = buildHighlights(msgs, A, { labelFor: plainName, senderLabel, single: View.filter.contact !== 'all', crossApp, limit: Infinity, rhythm: Select.rhythm(), unusual: Select.unusual() });
  $('#highlights').innerHTML = items.length
    ? html`${items.map((h, i) => html`<li${i >= HIGHLIGHT_LIMIT ? raw(' class="hl-more" hidden') : ''}><span class="hl-icon" aria-hidden="true">${h.icon}</span><span>${partsHtml(h.parts)}</span></li>`)}`
    : html`<li class="empty">Not enough messages here for highlights yet.</li>`;
  showMoreHighlights(false);
}

/** Spec 008 R3: show or hide the highlights past the first HIGHLIGHT_LIMIT. */
function showMoreHighlights(open) {
  const more = $('#highlights').querySelectorAll('.hl-more');
  const btn = $('#highlightsMore');
  for (const li of more) li.hidden = !open;
  btn.hidden = !more.length;
  btn.textContent = open ? 'Show fewer' : `Show ${more.length} more`;
  btn.setAttribute('aria-expanded', String(open));
}

/** On this day: the selected date (today by default) in earlier years, newest first. */
function renderOnThisDay(base) {
  const now = new Date();
  const today = { month: now.getMonth(), day: now.getDate() };
  const sel = View.otd || today;
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dayName = (d) => fmtDate.dayOfMonthLong(new Date(2000, d.month, d.day));
  $('#otdDate').textContent = dayName(sel);
  $('#otdToday').hidden = sel.month === today.month && sel.day === today.day;
  const box = $('#otd');
  const years = sameDayHistory(base, sel.month, sel.day, todayStart);
  if (!years.length) {
    const near = nearestDayWithHistory(daysWithHistory(base, todayStart), sel.month, sel.day);
    box.innerHTML = html`<p class="empty">Nothing on this date in earlier years.</p>${near ? html`<button class="btn small" type="button" data-otd-goto="${near.month}-${near.day}">Go to ${dayName(near)}, the nearest day with messages →</button>` : ''}`;
    return;
  }
  const single = View.filter.contact !== 'all';
  box.innerHTML = html`${years.slice(0, 4).map(({ year, msgs }) => {
    const back = now.getFullYear() - year;
    const day = new Date(year, sel.month, sel.day).getTime();
    const top = single ? null : busiestConversation(msgs);
    const withWhom = top ? (top.of > 1 ? html`, mostly with ${personLink(top.k)}` : html` with ${personLink(top.k)}`) : '';
    const moments = pickMoments(msgs, 3).map((m) =>
      html`<div class="otd-msg ${m.o ? 'sent' : 'recv'}"><span class="otd-who">${momentSender(m)}</span>${clip(m.b, 140)}</div>`);
    return html`<section class="otd-year">
      <div class="otd-head"><b>${back ? `${back} year${back === 1 ? '' : 's'} ago` : 'Earlier this year'}</b> <span class="muted">${fmtDate.weekday(day)} · ${fmtNum(msgs.length)} message${msgs.length === 1 ? '' : 's'}</span>${withWhom}</div>
      ${moments.length ? html`<div class="otd-msgs">${moments}</div>` : ''}
      <button class="btn small ghost" type="button" data-otd-day="${day}">Read that day →</button>
    </section>`;
  })}`;
}

function moveOtd(days) {
  const now = new Date();
  const cur = View.otd || { month: now.getMonth(), day: now.getDate() };
  const d = new Date(2000, cur.month, cur.day + days); // a leap year, so Feb 29 is a stop
  View.set({ otd: { month: d.getMonth(), day: d.getDate() } });
}

Panels.register({
  id: 'kpis',
  tab: 'sec-glance',
  topics: ['data', 'selection', 'gap'],
  render: (ctx) => renderKpis(ctx.agg()),
});

Panels.register({
  id: 'highlights',
  tab: 'sec-glance',
  topics: ['data', 'selection', 'gap', 'appsGap'],
  render: (ctx) => renderHighlights(ctx.msgs(), ctx.agg(), ctx.cross()),
  init() {
    $('#highlightsMore').addEventListener('click', (e) => showMoreHighlights(e.currentTarget.getAttribute('aria-expanded') !== 'true'));
  },
});

Panels.register({
  id: 'otd',
  tab: 'sec-glance',
  topics: ['data', 'filter.contact', 'filter.source', 'filter.groups', 'otd'],
  render: (ctx) => renderOnThisDay(ctx.base()),
  init() {
    $('#otdPrev').addEventListener('click', () => moveOtd(-1));
    $('#otdNext').addEventListener('click', () => moveOtd(1));
    $('#otdToday').addEventListener('click', () => View.set({ otd: null }));
    // "Read that day" (here and on the Across apps tab), and "Go to" the nearest day with messages.
    document.addEventListener('click', (e) => {
      const t = e.target.closest('[data-otd-day], [data-otd-goto]');
      if (!t) return;
      if (t.dataset.otdDay) {
        // The biggest juggle (spec 007) names its person.
        const contact = t.dataset.contact && Data.contacts.has(t.dataset.contact) ? t.dataset.contact : null;
        readDay(+t.dataset.otdDay, { contact, clearMood: true });
      } else {
        const [month, day] = t.dataset.otdGoto.split('-').map(Number);
        View.set({ otd: { month, day } });
      }
    });
  },
});
