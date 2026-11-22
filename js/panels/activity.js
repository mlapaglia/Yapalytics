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
    b.onclick = () => {
      View.calYear = y;
      $$('#calYears button').forEach((x) => x.classList.toggle('on', x === b));
      Charts.set('c-calendar', calendarOption(currentTheme(), A, y));
    };
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
    $('#granSeg').onclick = (e) => {
      const g = e.target.dataset.gran;
      if (g) View.set({ gran: g });
    };
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
      ? `Latest: ${new Date(ln.t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} on ${new Date(ln.t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })} with ${labelFor(ln.k)}`
      : 'Share of messages sent or received between midnight and 5am';
  },
});
