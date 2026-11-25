/* The Activity tab: timeline, hours, weekdays, calendar, year over year, night owl. */

/** The timeline's bars once Auto is worked out: what a zoom snaps to. */
let timelineGran = 'month';

/** The timeline's zoom picks the dates; Reset drops them. */
const TIMELINE_ON = { datazoom: () => onTimelineZoom(), restore: () => setRange(null, null) };

function renderTimeline(ui, base) {
  const days = new Map();
  for (const m of base) {
    let v = days.get(m.d);
    if (!v) days.set(m.d, (v = [0, 0]));
    v[m.o]++;
  }
  let gran = View.gran;
  if (gran === 'auto') {
    const keys = [...days.keys()];
    gran = autoGran(keys.length ? Math.max(...keys) - Math.min(...keys) : 0);
  }
  timelineGran = gran;
  $$('#granSeg button').forEach((b) => b.classList.toggle('on', b.dataset.gran === View.gran));
  if (!base.length) {
    Charts.set('c-timeline', emptyOption(ui, 'No messages in this selection'), { on: TIMELINE_ON });
    return;
  }
  const tl = buildTimeline(days, gran);
  Charts.set('c-timeline', timelineOption(ui, tl, gran, { from: View.filter.from, to: View.filter.to }), { on: TIMELINE_ON });
}

/** The timeline was zoomed: its window, snapped to whole bars, becomes the date range. The timeline itself stays as it is. */
let zoomTimer = null;
function onTimelineZoom() {
  const chart = Charts.get('c-timeline');
  clearTimeout(zoomTimer);
  zoomTimer = setTimeout(() => {
    const dz = chart.getOption().dataZoom[0];
    if (!dz) return;
    const full = dz.start <= 0.01 && dz.end >= 99.99;
    const gran = timelineGran;
    const filter = full
      ? { from: null, to: null }
      : { from: bucketOfDay(tsToDay(dz.startValue), gran), to: bucketEnd(bucketOfDay(tsToDay(dz.endValue), gran), gran) };
    View.set({ filter }, { except: ['timeline'] });
  }, 180);
}

function renderCalendar(ui, A, none) {
  const years = [...new Set(A.dayKeys.map((d) => new Date(dayToTs(d)).getFullYear()))].sort();
  const wrap = $('#calYears');
  wrap.innerHTML = '';
  if (none || !years.length) {
    Charts.set('c-calendar', emptyOption(ui, 'No messages in this selection'));
    return;
  }
  if (!years.includes(View.calYear)) View.calYear = years[years.length - 1];
  for (const y of years) {
    const b = document.createElement('button');
    b.textContent = y;
    b.className = y === View.calYear ? 'on' : '';
    b.addEventListener('click', () => {
      View.calYear = y;
      $$('#calYears button').forEach((x) => x.classList.toggle('on', x === b));
      Charts.set('c-calendar', calendarOption(currentTheme(), A, y));
    });
    wrap.appendChild(b);
  }
  Charts.set('c-calendar', calendarOption(ui, A, View.calYear));
}

Panels.register({
  id: 'timeline',
  tab: 'sec-activity',
  topics: ['data', 'filter.contact', 'filter.source', 'filter.groups', 'filter.dates', 'gran', 'theme'],
  render: (ctx) => renderTimeline(ctx.ui, ctx.base()),
  init() {
    $('#granSeg').addEventListener('click', (e) => {
      const g = e.target.dataset.gran;
      if (g) View.set({ gran: g });
    });
  },
});

Panels.register({
  id: 'activity',
  tab: 'sec-activity',
  topics: ['data', 'selection', 'theme'],
  render(ctx) {
    const { ui } = ctx;
    const A = ctx.agg();
    ctx.put('c-hour', () => hourOption(ui, A));
    ctx.put('c-dow', () => dowOption(ui, A));
    ctx.put('c-heat', () => heatOption(ui, A));
    renderCalendar(ui, A, ctx.none);
    ctx.put('c-yoy', () => yearOverYearOption(ui, A));
    ctx.put('c-night', () => nightOwlOption(ui, A));
    const ln = A.latestNight;
    $('#nightNote').textContent = ln
      ? `Latest: ${fmtDate.time(ln.t)} on ${fmtDate.day(ln.t)} with ${labelFor(ln.k)}`
      : 'Share of messages sent or received between midnight and 5am';
  },
});

/** "a, b or c". */
const orList = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}`);

/** Spec 020 R1–R10: when your day starts and ends, and time away. */
function renderRhythm(ui) {
  const R = Select.rhythm();
  const sched = R.schedule;
  $('#rhythmNote').textContent = rhythmNoteText(sched);
  $('#rhythmBasis').textContent = `From ${fmtNum(sched.counted)} day${sched.counted === 1 ? '' : 's'} with at least ${RHYTHM_MIN_MSGS} messages from you. ` +
    "Your first and last messages aren't when you wake up and go to sleep, but they move with them.";
  Charts.set('c-rhythm', sched.counted < RHYTHM_MIN_DAYS ? emptyOption(ui, 'Not enough days with 5 or more messages from you') : rhythmOption(ui, sched, R.away));

  const box = $('#awayList');
  if (!R.days.size) {
    box.innerHTML = '';
  } else if (![...R.days.values()].some((v) => v.utc.length)) {
    const names = (clock) => Sources.list.filter((x) => x.clock === clock).map((x) => x.name);
    box.innerHTML = html`<p class="muted rhythm-foot">Time away needs messages from ${orList(names('utc'))}. ${andList(names('wall'))} exports don't say which time zone their times are in.</p>`;
  } else if (!R.away.length) {
    box.innerHTML = '';
  } else {
    const rows = [...R.away].sort((a, b) => b.to - a.to).slice(0, 5);
    box.innerHTML = html`<h3 class="rhythm-head">Time away</h3><ul class="plain-list rhythm-rows">${rows.map((x) => html`<li>
      <span>${dayRangeText(x.from, x.to)}: your messages ran about <b>${shiftText(x.shift)}</b> than usual.</span>
      <button class="btn small ghost" type="button" data-away-from="${x.from}" data-away-to="${x.to}">Read those days →</button>
    </li>`)}</ul>
    <p class="muted rhythm-foot">A guess from when you send messages: travel, jet lag and night shifts all look like this.</p>`;
  }
}

/** Spec 020 R11–R14: days far busier or quieter than normal for a conversation. */
function renderUnusual(A) {
  const box = $('#unusualDays');
  const judged = [...A.byContact.values()].some((bc) => bc.n[0] + bc.n[1] >= UNUSUAL_MIN_MSGS);
  if (!judged) {
    box.innerHTML = html`<p class="muted">Unusual days need a conversation with at least ${UNUSUAL_MIN_MSGS} messages.</p>`;
    return;
  }
  const rows = unusualList(Select.unusual());
  if (!rows.length) {
    box.innerHTML = html`<p class="muted">Nothing out of the ordinary in this selection.</p>`;
    return;
  }
  const all = View.filter.contact === 'all';
  const usual = (x) => html` <span class="muted">(usually about ${fmtNum(x.usual)})</span>`;
  box.innerHTML = html`<ul class="plain-list rhythm-rows">${rows.map((x) => html`<li class="${x.kind}">
    <span>${fmtDate.weekday(dayToTs(x.d))}${all ? html` · ${labelFor(x.k)}` : ''} · ${x.kind === 'busy'
      ? html`<b>${fmtNum(x.n)}</b> messages, <b>${timesText(x.n / Math.max(x.usual, 1))}</b> a normal day${usual(x)}`
      : html`only <b>${fmtNum(x.n)}</b> message${x.n === 1 ? '' : 's'}${usual(x)}`}</span>
    <button class="btn small ghost" type="button" data-unusual-day="${x.d}" data-contact="${x.k}">Read that day →</button>
  </li>`)}</ul>`;
}

Panels.register({
  id: 'rhythm',
  tab: 'sec-activity',
  topics: ['data', 'selection', 'theme'],
  render(ctx) {
    renderRhythm(ctx.ui);
    renderUnusual(ctx.agg());
  },
  init() {
    $('#awayList').addEventListener('click', (e) => {
      const b = e.target.closest('[data-away-from]');
      if (!b) return;
      // Rhythm days run 4 am to 4 am, so the range does too. Like Read that day →, it
      // clears a mood pick, which would otherwise hold the list to another month.
      View.set({ filter: { from: rhythmDayStart(+b.dataset.awayFrom), to: rhythmDayStart(+b.dataset.awayTo + 1) - 1 }, browser: { mood: null } });
      Tabs.select('sec-messages');
    });
    $('#unusualDays').addEventListener('click', (e) => {
      const b = e.target.closest('[data-unusual-day]');
      if (!b) return;
      // With a conversation already picked, keep it (it may be a linked person spanning apps).
      readDay(dayToTs(+b.dataset.unusualDay), { contact: View.filter.contact === 'all' ? b.dataset.contact : null, clearMood: true });
    });
  },
});
