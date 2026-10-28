/*
 * ECharts option builders. Each builder takes aggregated data plus the current
 * theme tokens (read from CSS custom properties) and returns a full option object.
 */
const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
const HOUR_LABELS = Array.from({ length: 24 }, (_, h) => (h === 0 ? '12a' : h < 12 ? h + 'a' : h === 12 ? '12p' : h - 12 + 'p'));
const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const Charts = {
  instances: new Map(),

  /** Render (or re-render) a chart into the element with the given id. */
  set(id, option, { notMerge = true } = {}) {
    const el = document.getElementById(id);
    if (!el) return null;
    let chart = this.instances.get(id);
    if (!chart) {
      chart = echarts.init(el, null, { renderer: 'canvas' });
      this.instances.set(id, chart);
      new ResizeObserver(() => chart.resize()).observe(el);
    }
    chart.setOption(option, { notMerge, lazyUpdate: false });
    return chart;
  },

  get(id) {
    return this.instances.get(id);
  },
};

/** Theme tokens from CSS custom properties, so light/dark is defined in one place. */
function readTheme() {
  const cs = getComputedStyle(document.documentElement);
  const v = (name) => cs.getPropertyValue(name).trim();
  return {
    surface: v('--surface'),
    text: v('--text'),
    text2: v('--text-2'),
    muted: v('--muted'),
    grid: v('--grid'),
    axis: v('--axis'),
    border: v('--border-strong'),
    empty: v('--heat-empty'),
    series: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => v('--series-' + i)),
    heat: [0, 1, 2, 3, 4].map((i) => v('--heat-' + i)),
    get sent() { return this.series[0]; },
    get recv() { return this.series[1]; },
  };
}

// ------------------------------------------------------------------ shared parts

function baseOption(ui, { toolbox = true, boxZoom = false } = {}) {
  const feature = {};
  if (boxZoom) feature.dataZoom = { yAxisIndex: 'none', title: { zoom: 'Box zoom', back: 'Undo zoom' } };
  feature.restore = { title: 'Reset' };
  feature.saveAsImage = { title: 'Save PNG', backgroundColor: ui.surface, pixelRatio: 2 };
  return {
    backgroundColor: 'transparent',
    textStyle: { fontFamily: FONT, color: ui.text2 },
    animationDuration: 350,
    animationDurationUpdate: 300,
    legend: {
      top: 0,
      left: 0,
      icon: 'roundRect',
      itemWidth: 10,
      itemHeight: 10,
      itemGap: 14,
      textStyle: { color: ui.text2, fontSize: 12 },
      inactiveColor: ui.axis,
    },
    toolbox: toolbox
      ? { right: 0, top: -4, itemSize: 14, feature, iconStyle: { borderColor: ui.muted }, emphasis: { iconStyle: { borderColor: ui.text } } }
      : undefined,
    tooltip: tooltipBase(ui),
    grid: { left: 4, right: 12, top: 36, bottom: 4, containLabel: true },
  };
}

function tooltipBase(ui, trigger = 'axis', pointer = 'shadow') {
  return {
    trigger,
    confine: true,
    backgroundColor: ui.surface,
    borderColor: ui.border,
    borderWidth: 1,
    padding: [8, 10],
    textStyle: { color: ui.text, fontSize: 12, fontFamily: FONT },
    extraCssText: 'box-shadow: 0 4px 16px rgba(0,0,0,.12); border-radius: 8px;',
    axisPointer: pointer === 'shadow'
      ? { type: 'shadow', shadowStyle: { color: ui.grid, opacity: 0.5 } }
      : { type: 'line', lineStyle: { color: ui.muted, width: 1, type: 'dashed' } },
  };
}

function catAxis(ui, data, extra = {}) {
  return {
    type: 'category',
    data,
    axisLine: { lineStyle: { color: ui.axis } },
    axisTick: { show: false },
    axisLabel: { color: ui.muted, fontSize: 11 },
    ...extra,
  };
}

function valAxis(ui, extra = {}) {
  return {
    type: 'value',
    splitLine: { lineStyle: { color: ui.grid } },
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { color: ui.muted, fontSize: 11 },
    ...extra,
  };
}

function bar(name, data, color, ui, { stack, rounded = true, horizontal = false } = {}) {
  const r = rounded ? (horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]) : 0;
  return {
    name,
    type: 'bar',
    stack,
    data,
    barMaxWidth: 26,
    barCategoryGap: '28%',
    itemStyle: { color, borderRadius: r, borderColor: ui.surface, borderWidth: stack ? 1 : 0 },
    emphasis: { focus: 'series' },
  };
}

function line(name, data, color, extra = {}) {
  return {
    name,
    type: 'line',
    data,
    showSymbol: false,
    symbolSize: 8,
    smooth: 0.2,
    lineStyle: { width: 2, color },
    itemStyle: { color },
    emphasis: { focus: 'series' },
    ...extra,
  };
}

function insideZoom(extra = {}) {
  // ctrl/⌘ + wheel (or trackpad pinch) zooms; drag pans. Plain scroll keeps scrolling the page.
  return { type: 'inside', zoomOnMouseWheel: 'ctrl', moveOnMouseWheel: false, moveOnMouseMove: true, ...extra };
}

function sliderZoom(ui, extra = {}) {
  return {
    type: 'slider',
    height: 22,
    bottom: 6,
    borderColor: ui.grid,
    fillerColor: 'rgba(127,127,127,0.12)',
    backgroundColor: 'transparent',
    dataBackground: { lineStyle: { color: ui.axis }, areaStyle: { color: ui.grid } },
    selectedDataBackground: { lineStyle: { color: ui.sent }, areaStyle: { color: ui.sent, opacity: 0.25 } },
    handleStyle: { color: ui.surface, borderColor: ui.muted },
    moveHandleStyle: { color: ui.axis },
    textStyle: { color: ui.muted, fontSize: 11 },
    brushSelect: false,
    ...extra,
  };
}

/** Sent + Received stacked bars over a category axis. */
function sentRecvStack(ui, labels, A_sent, A_recv, { horizontal = false } = {}) {
  const opt = baseOption(ui, { boxZoom: !horizontal });
  const cat = catAxis(ui, labels, horizontal ? { inverse: true } : {});
  const val = valAxis(ui);
  if (horizontal) {
    opt.yAxis = cat;
    opt.xAxis = val;
  } else {
    opt.xAxis = cat;
    opt.yAxis = val;
  }
  opt.series = [
    bar('Sent', A_sent, ui.sent, ui, { stack: 'm', rounded: false, horizontal }),
    bar('Received', A_recv, ui.recv, ui, { stack: 'm', horizontal }),
  ];
  opt.tooltip.formatter = stackTooltip;
  return opt;
}

function dot(color) {
  return `<span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${color};margin-right:6px"></span>`;
}

function stackTooltip(params) {
  if (!params.length) return '';
  let total = 0;
  for (const p of params) total += +(Array.isArray(p.value) ? p.value[1] : p.value) || 0;
  let html = `<div style="font-weight:600;margin-bottom:4px">${params[0].axisValueLabel}</div>`;
  for (const p of params) {
    const v = +(Array.isArray(p.value) ? p.value[1] : p.value) || 0;
    html += `<div style="display:flex;justify-content:space-between;gap:16px"><span>${dot(p.color)}${p.seriesName}</span><b>${fmtNum(v)}</b></div>`;
  }
  if (params.length > 1) html += `<div style="display:flex;justify-content:space-between;gap:16px;margin-top:4px;border-top:1px solid rgba(127,127,127,.25);padding-top:4px"><span>Total</span><b>${fmtNum(total)}</b></div>`;
  return html;
}

// ------------------------------------------------------------------ message charts

const GRAN_MS = { day: 86400000, week: 7 * 86400000, month: 31 * 86400000 };

/** The granularity "Auto" picks for a span of days. */
function autoGran(spanDays) {
  return spanDays > 3 * 365 ? 'month' : spanDays > 180 ? 'week' : 'day';
}

/** Tooltip title for a day / week / month bucket. */
function fmtBucket(ts, gran) {
  const d = new Date(ts);
  if (gran === 'month') return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long' });
  if (gran === 'week') return 'Week of ' + d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  return d.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
}

/** Bucket the start of a day number into day / week (Sunday) / month timestamps. */
function bucketOfDay(d, gran) {
  if (gran === 'day') return dayToTs(d);
  const ts = dayToTs(d);
  const dt = new Date(ts);
  if (gran === 'week') return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() - dt.getDay()).getTime();
  return new Date(dt.getFullYear(), dt.getMonth(), 1).getTime();
}
function bucketEnd(ts, gran) {
  const dt = new Date(ts);
  if (gran === 'day') return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() + 1).getTime() - 1;
  if (gran === 'week') return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() + 7).getTime() - 1;
  return new Date(dt.getFullYear(), dt.getMonth() + 1, 1).getTime() - 1;
}
function nextBucket(ts, gran) {
  return bucketEnd(ts, gran) + 1;
}

function buildTimeline(days, gran) {
  // days: Map day -> [r, s]
  const keys = [...days.keys()].sort((a, b) => a - b);
  if (!keys.length) return { x: [], s: [], r: [] };
  const map = new Map();
  for (const d of keys) {
    const b = bucketOfDay(d, gran);
    let v = map.get(b);
    if (!v) map.set(b, (v = [0, 0]));
    const dv = days.get(d);
    v[0] += dv[0];
    v[1] += dv[1];
  }
  // Fill empty buckets so gaps show as zero
  const x = [], s = [], r = [];
  const lastB = bucketOfDay(keys[keys.length - 1], gran);
  for (let b = bucketOfDay(keys[0], gran); b <= lastB; b = nextBucket(b, gran)) {
    const v = map.get(b) || [0, 0];
    x.push(b);
    r.push(v[0]);
    s.push(v[1]);
  }
  return { x, s, r };
}

function timelineOption(ui, tl, gran, zoom) {
  const opt = baseOption(ui, { boxZoom: true });
  opt.grid = { left: 4, right: 12, top: 36, bottom: 44, containLabel: true };
  opt.xAxis = {
    type: 'time',
    axisLine: { lineStyle: { color: ui.axis } },
    axisTick: { show: false },
    axisLabel: { color: ui.muted, fontSize: 11, hideOverlap: true },
    splitLine: { show: false },
  };
  opt.yAxis = valAxis(ui);
  opt.tooltip = tooltipBase(ui, 'axis', 'line');
  opt.tooltip.formatter = (params) => {
    params.forEach((p) => (p.axisValueLabel = fmtBucket(p.value[0], gran)));
    return stackTooltip(params);
  };
  const s = tl.x.map((x, i) => [x, tl.s[i]]);
  const r = tl.x.map((x, i) => [x, tl.r[i]]);
  opt.series = [
    { ...bar('Sent', s, ui.sent, ui, { stack: 'm', rounded: false }), barCategoryGap: '15%', barMaxWidth: 40 },
    { ...bar('Received', r, ui.recv, ui, { stack: 'm' }), barCategoryGap: '15%', barMaxWidth: 40 },
  ];
  if (gran === 'day' && tl.x.length > 14) {
    const avg = tl.x.map((x, i) => {
      let sum = 0, n = 0;
      for (let j = Math.max(0, i - 6); j <= i; j++) { sum += tl.s[j] + tl.r[j]; n++; }
      return [x, Math.round((sum / n) * 10) / 10];
    });
    opt.series.push(line('7-day average', avg, ui.text2, { lineStyle: { width: 2, color: ui.text2 }, smooth: 0.3, z: 5 }));
  }
  opt.dataZoom = [
    sliderZoom(ui, { xAxisIndex: 0, startValue: zoom.from ?? undefined, endValue: zoom.to ?? undefined }),
    insideZoom({ xAxisIndex: 0, startValue: zoom.from ?? undefined, endValue: zoom.to ?? undefined }),
  ];
  return opt;
}

function hourOption(ui, A) {
  return sentRecvStack(ui, HOUR_LABELS, A.hour[1], A.hour[0]);
}

function dowOption(ui, A) {
  return sentRecvStack(ui, DOW_LABELS, A.dow[1], A.dow[0]);
}

function heatOption(ui, A) {
  const data = [];
  let max = 0;
  for (let w = 0; w < 7; w++) for (let h = 0; h < 24; h++) {
    const v = A.heat[w * 24 + h];
    max = Math.max(max, v);
    data.push([h, w, v]);
  }
  const opt = baseOption(ui);
  delete opt.legend;
  opt.grid = { left: 4, right: 12, top: 28, bottom: 44, containLabel: true };
  opt.xAxis = catAxis(ui, HOUR_LABELS, { splitArea: { show: false } });
  opt.yAxis = catAxis(ui, DOW_LABELS, { inverse: true, axisLine: { show: false } });
  opt.visualMap = {
    min: 0,
    max: Math.max(1, max),
    calculable: false,
    orient: 'horizontal',
    left: 'center',
    bottom: 0,
    itemHeight: 160,
    itemWidth: 10,
    text: ['More', 'Less'],
    textStyle: { color: ui.muted, fontSize: 11 },
    inRange: { color: ui.heat },
  };
  opt.tooltip = tooltipBase(ui, 'item');
  opt.tooltip.formatter = (p) => `<b>${DOW_LABELS[p.value[1]]} ${HOUR_LABELS[p.value[0]]}</b><br>${fmtNum(p.value[2])} messages`;
  opt.series = [{
    type: 'heatmap',
    data,
    itemStyle: { borderColor: ui.surface, borderWidth: 2, borderRadius: 3 },
    emphasis: { itemStyle: { borderColor: ui.text, borderWidth: 1 } },
  }];
  return opt;
}

function calendarOption(ui, A, year) {
  const data = [];
  const vals = [];
  for (const [d, v] of A.days) {
    const ts = dayToTs(d);
    const dt = new Date(ts);
    if (dt.getFullYear() !== year) continue;
    const tot = v[0] + v[1];
    const iso = `${year}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    data.push([iso, tot, v[1], v[0]]);
    vals.push(tot);
  }
  vals.sort((a, b) => a - b);
  const p95 = vals.length ? vals[Math.floor(vals.length * 0.95)] || vals[vals.length - 1] : 1;
  const opt = baseOption(ui);
  delete opt.legend;
  delete opt.grid;
  opt.tooltip = tooltipBase(ui, 'item');
  opt.tooltip.formatter = (p) => {
    const d = new Date(p.value[0] + 'T00:00:00');
    return `<b>${d.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })}</b><br>` +
      `${fmtNum(p.value[1])} messages<br>${dot(ui.sent)}${fmtNum(p.value[2])} sent &nbsp; ${dot(ui.recv)}${fmtNum(p.value[3])} received`;
  };
  opt.visualMap = {
    min: 0,
    max: Math.max(1, p95),
    calculable: false,
    orient: 'horizontal',
    right: 12,
    bottom: 0,
    itemHeight: 140,
    itemWidth: 10,
    text: ['More', 'Less'],
    textStyle: { color: ui.muted, fontSize: 11 },
    inRange: { color: ui.heat },
    dimension: 1,
  };
  opt.calendar = {
    range: String(year),
    top: 24,
    left: 36,
    right: 12,
    bottom: 36,
    cellSize: ['auto', 'auto'],
    splitLine: { show: false },
    itemStyle: { color: ui.empty, borderColor: ui.surface, borderWidth: 2 },
    dayLabel: { firstDay: 0, color: ui.muted, fontSize: 10, nameMap: ['S', 'M', 'T', 'W', 'T', 'F', 'S'] },
    monthLabel: { color: ui.muted, fontSize: 11 },
    yearLabel: { show: false },
  };
  opt.series = [{
    type: 'heatmap',
    coordinateSystem: 'calendar',
    data,
    itemStyle: { borderColor: ui.surface, borderWidth: 2, borderRadius: 2 },
  }];
  return opt;
}

function splitOption(ui, A) {
  const opt = baseOption(ui);
  delete opt.grid;
  opt.legend.top = 'auto';
  opt.legend.bottom = 0;
  opt.legend.left = 'center';
  opt.tooltip = tooltipBase(ui, 'item');
  opt.tooltip.formatter = (p) => `${dot(p.color)}<b>${p.name}</b><br>${fmtNum(p.value)} messages (${p.percent}%)`;
  const total = A.dir[0] + A.dir[1];
  opt.title = {
    text: fmtNum(total),
    subtext: 'messages',
    left: 'center',
    top: '36%',
    textStyle: { color: ui.text, fontSize: 22, fontWeight: 600, fontFamily: FONT },
    subtextStyle: { color: ui.muted, fontSize: 12 },
    itemGap: 2,
  };
  opt.series = [{
    type: 'pie',
    radius: ['52%', '74%'],
    center: ['50%', '45%'],
    padAngle: 1.5,
    itemStyle: { borderRadius: 4, borderColor: ui.surface, borderWidth: 2 },
    label: { color: ui.text2, formatter: '{b}\n{d}%', fontSize: 12 },
    labelLine: { lineStyle: { color: ui.axis } },
    data: [
      { name: 'Sent', value: A.dir[1], itemStyle: { color: ui.sent } },
      { name: 'Received', value: A.dir[0], itemStyle: { color: ui.recv } },
    ],
  }];
  return opt;
}

function shareOption(ui, A) {
  const keys = [...A.months.keys()].sort((a, b) => a - b);
  const data = keys.map((mo) => {
    const c = A.months.get(mo).c;
    const tot = c[0] + c[1];
    return [monthToTs(mo), tot ? Math.round((c[1] / tot) * 1000) / 10 : null, tot];
  });
  const opt = baseOption(ui, { boxZoom: true });
  delete opt.legend;
  opt.grid.top = 28;
  opt.xAxis = { type: 'time', axisLine: { lineStyle: { color: ui.axis } }, axisTick: { show: false }, axisLabel: { color: ui.muted, fontSize: 11, hideOverlap: true }, splitLine: { show: false } };
  opt.yAxis = valAxis(ui, { min: 0, max: 100, axisLabel: { color: ui.muted, fontSize: 11, formatter: '{value}%' } });
  opt.tooltip = tooltipBase(ui, 'axis', 'line');
  opt.tooltip.formatter = (ps) => {
    const p = ps[0];
    const d = new Date(p.value[0]).toLocaleDateString(undefined, { year: 'numeric', month: 'long' });
    return `<b>${d}</b><br>You sent <b>${p.value[1]}%</b> of ${fmtNum(p.value[2])} messages`;
  };
  opt.series = [line('% sent by you', data, ui.sent, {
    showSymbol: data.length < 40,
    areaStyle: { color: ui.sent, opacity: 0.08 },
    markLine: {
      silent: true,
      symbol: 'none',
      lineStyle: { color: ui.muted, type: 'dashed', width: 1 },
      label: { color: ui.muted, formatter: 'even split', position: 'insideEndTop', fontSize: 11 },
      data: [{ yAxis: 50 }],
    },
  })];
  opt.dataZoom = [insideZoom({ xAxisIndex: 0 })];
  return opt;
}

function lengthOption(ui, A) {
  const labels = LEN_BINS.map(([a, b]) => (b === Infinity ? `${a}+` : `${a}–${b}`));
  const pct = (arr) => {
    const tot = arr.reduce((x, y) => x + y, 0) || 1;
    return arr.map((v) => Math.round((v / tot) * 1000) / 10);
  };
  const opt = baseOption(ui, { boxZoom: true });
  opt.xAxis = catAxis(ui, labels, { name: 'characters', nameLocation: 'middle', nameGap: 26, nameTextStyle: { color: ui.muted, fontSize: 11 } });
  opt.yAxis = valAxis(ui, { axisLabel: { color: ui.muted, fontSize: 11, formatter: '{value}%' } });
  opt.grid.bottom = 18;
  const counts = [A.lenHist[1], A.lenHist[0]];
  opt.tooltip.formatter = (ps) => {
    let html = `<div style="font-weight:600;margin-bottom:4px">${ps[0].axisValueLabel} characters</div>`;
    for (const p of ps) html += `<div style="display:flex;justify-content:space-between;gap:16px"><span>${dot(p.color)}${p.seriesName}</span><span><b>${p.value}%</b> · ${fmtNum(counts[p.seriesIndex][p.dataIndex])}</span></div>`;
    return html;
  };
  opt.series = [
    bar('Sent', pct(A.lenHist[1]), ui.sent, ui),
    bar('Received', pct(A.lenHist[0]), ui.recv, ui),
  ];
  return opt;
}

function lengthTrendOption(ui, A) {
  const keys = [...A.months.keys()].sort((a, b) => a - b);
  const mk = (o) => keys.map((mo) => {
    const m = A.months.get(mo);
    return [monthToTs(mo), m.lenN[o] ? Math.round((m.len[o] / m.lenN[o]) * 10) / 10 : null];
  });
  const opt = baseOption(ui, { boxZoom: true });
  opt.xAxis = { type: 'time', axisLine: { lineStyle: { color: ui.axis } }, axisTick: { show: false }, axisLabel: { color: ui.muted, fontSize: 11, hideOverlap: true }, splitLine: { show: false } };
  opt.yAxis = valAxis(ui);
  opt.tooltip = tooltipBase(ui, 'axis', 'line');
  opt.tooltip.formatter = (ps) => {
    const d = new Date(ps[0].value[0]).toLocaleDateString(undefined, { year: 'numeric', month: 'long' });
    let html = `<div style="font-weight:600;margin-bottom:4px">${d}</div>`;
    for (const p of ps) html += `<div style="display:flex;justify-content:space-between;gap:16px"><span>${dot(p.color)}${p.seriesName}</span><b>${p.value[1] ?? '–'} chars</b></div>`;
    return html;
  };
  opt.series = [line('Sent', mk(1), ui.sent, { connectNulls: true }), line('Received', mk(0), ui.recv, { connectNulls: true })];
  opt.dataZoom = [insideZoom({ xAxisIndex: 0 })];
  return opt;
}

function truncate(s, n) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function topContactsOption(ui, rows) {
  // rows: [{ key, label, s, r }] already sorted desc
  const opt = sentRecvStack(ui, rows.map((x) => truncate(x.label, 24)), rows.map((x) => x.s), rows.map((x) => x.r), { horizontal: true });
  opt.dataZoom = rows.length > 15 ? [insideZoom({ yAxisIndex: 0, startValue: 0, endValue: 14 }), sliderZoom(ui, { yAxisIndex: 0, orient: 'vertical', right: 0, top: 36, bottom: 8, width: 14, height: undefined, showDetail: false, showDataShadow: false })] : undefined;
  if (opt.dataZoom) opt.grid.right = 26;
  opt.tooltip.formatter = (ps) => {
    ps.forEach((p) => (p.axisValueLabel = rows[p.dataIndex].label));
    return stackTooltip(ps) + '<div style="color:#888;margin-top:4px;font-size:11px">Click to focus this conversation</div>';
  };
  return opt;
}

function emojiOption(ui, A, limit = 20) {
  const rows = [...A.emojiFreq.entries()]
    .map(([e, v]) => ({ e, r: v[0], s: v[1], t: v[0] + v[1] }))
    .sort((a, b) => b.t - a.t)
    .slice(0, limit);
  const opt = sentRecvStack(ui, rows.map((x) => x.e), rows.map((x) => x.s), rows.map((x) => x.r), { horizontal: true });
  // Every row gets its emoji (ECharts would otherwise skip labels it thinks overlap),
  // sized to fit 20 rows in the card.
  opt.yAxis.axisLabel = { interval: 0, fontSize: 14, lineHeight: 16, color: ui.text, fontFamily: EMOJI_FONT };
  return { opt, empty: rows.length === 0 };
}

function wordsOption(ui, A, limit = 25) {
  const rows = [...A.wordFreq.entries()]
    .map(([w, v]) => ({ w, r: v[0], s: v[1], t: v[0] + v[1] }))
    .sort((a, b) => b.t - a.t)
    .slice(0, limit);
  return { opt: sentRecvStack(ui, rows.map((x) => x.w), rows.map((x) => x.s), rows.map((x) => x.r), { horizontal: true }), empty: rows.length === 0 };
}

function mediaOption(ui, A) {
  const labels = MEDIA_TYPES.map((m) => m.label);
  return sentRecvStack(ui, labels, MEDIA_TYPES.map((m) => A.media[m.key][1]), MEDIA_TYPES.map((m) => A.media[m.key][0]));
}

function mediaTrendOption(ui, A) {
  const keys = [...A.mediaMonths.keys()].sort((a, b) => a - b);
  const opt = baseOption(ui, { boxZoom: true });
  opt.xAxis = { type: 'time', axisLine: { lineStyle: { color: ui.axis } }, axisTick: { show: false }, axisLabel: { color: ui.muted, fontSize: 11, hideOverlap: true }, splitLine: { show: false } };
  opt.yAxis = valAxis(ui);
  opt.tooltip = tooltipBase(ui, 'axis', 'shadow');
  opt.tooltip.formatter = (ps) => {
    ps.forEach((p) => (p.axisValueLabel = new Date(p.value[0]).toLocaleDateString(undefined, { year: 'numeric', month: 'long' })));
    return stackTooltip(ps.filter((p) => p.value[1]));
  };
  opt.series = MEDIA_TYPES.map((m, i) => ({
    ...bar(m.label, keys.map((mo) => [monthToTs(mo), A.mediaMonths.get(mo)[m.key]]), ui.series[i], ui, { stack: 'media', rounded: i === MEDIA_TYPES.length - 1 }),
    barMaxWidth: 18,
  }));
  opt.dataZoom = [insideZoom({ xAxisIndex: 0 })];
  return opt;
}

function replyOption(ui, A) {
  const pct = (arr) => {
    const tot = arr.reduce((x, y) => x + y, 0) || 1;
    return arr.map((v) => Math.round((v / tot) * 1000) / 10);
  };
  const counts = [A.reply[1], A.reply[0]];
  const opt = baseOption(ui, { boxZoom: true });
  opt.xAxis = catAxis(ui, A.replyBins.map((b) => b.label));
  opt.yAxis = valAxis(ui, { axisLabel: { color: ui.muted, fontSize: 11, formatter: '{value}%' } });
  opt.tooltip.formatter = (ps) => {
    let html = `<div style="font-weight:600;margin-bottom:4px">Replied within ${ps[0].axisValueLabel}</div>`;
    for (const p of ps) html += `<div style="display:flex;justify-content:space-between;gap:16px"><span>${dot(p.color)}${p.seriesName}</span><span><b>${p.value}%</b> · ${fmtNum(counts[p.seriesIndex][p.dataIndex])}</span></div>`;
    return html;
  };
  opt.series = [bar('Your replies', pct(A.reply[1]), ui.sent, ui), bar('Their replies', pct(A.reply[0]), ui.recv, ui)];
  return opt;
}

function behaviorOption(ui, A) {
  const labels = ['Started convo', 'Double-texted', ...TRAITS.map((t) => t.label)];
  const s = [A.starters[1], A.doubleTexts[1], ...A.traits[1]];
  const r = [A.starters[0], A.doubleTexts[0], ...A.traits[0]];
  const opt = baseOption(ui, { boxZoom: false });
  opt.yAxis = catAxis(ui, labels, { inverse: true });
  opt.xAxis = valAxis(ui);
  opt.series = [bar('Sent', s, ui.sent, ui, { horizontal: true }), bar('Received', r, ui.recv, ui, { horizontal: true })];
  opt.series.forEach((x) => (x.barMaxWidth = 12));
  return opt;
}

// ------------------------------------------------------------------ call charts

function callTrendOption(ui, C) {
  const keys = [...C.months.keys()].sort((a, b) => a - b);
  const opt = baseOption(ui, { boxZoom: true });
  opt.xAxis = { type: 'time', axisLine: { lineStyle: { color: ui.axis } }, axisTick: { show: false }, axisLabel: { color: ui.muted, fontSize: 11, hideOverlap: true }, splitLine: { show: false } };
  opt.yAxis = valAxis(ui);
  opt.tooltip = tooltipBase(ui, 'axis', 'shadow');
  opt.tooltip.formatter = (ps) => {
    ps.forEach((p) => (p.axisValueLabel = new Date(p.value[0]).toLocaleDateString(undefined, { year: 'numeric', month: 'long' })));
    return stackTooltip(ps.filter((p) => p.value[1]));
  };
  opt.series = CALL_TYPES.map((ct, i) => ({
    ...bar(ct.label, keys.map((mo) => [monthToTs(mo), C.months.get(mo)[i]]), ui.series[i], ui, { stack: 'calls', rounded: i === CALL_TYPES.length - 1 }),
    barMaxWidth: 18,
  }));
  opt.dataZoom = [insideZoom({ xAxisIndex: 0 }), sliderZoom(ui, { xAxisIndex: 0 })];
  opt.grid.bottom = 40;
  return opt;
}

function callHourOption(ui, C) {
  const opt = baseOption(ui, { boxZoom: true });
  opt.xAxis = catAxis(ui, HOUR_LABELS);
  opt.yAxis = valAxis(ui);
  opt.tooltip.formatter = (ps) => stackTooltip(ps.filter((p) => p.value));
  opt.series = CALL_TYPES.map((ct, i) => bar(ct.label, C.hour[i], ui.series[i], ui, { stack: 'calls', rounded: i === CALL_TYPES.length - 1 }));
  return opt;
}

function callDurOption(ui, C) {
  const opt = baseOption(ui, { boxZoom: true });
  opt.xAxis = catAxis(ui, CALL_DUR_BINS.map((b) => b.label));
  opt.yAxis = valAxis(ui);
  opt.series = [bar('Outgoing', C.durHist[1], ui.series[0], ui), bar('Incoming', C.durHist[0], ui.series[1], ui)];
  return opt;
}

function callContactsOption(ui, rows) {
  const opt = baseOption(ui);
  delete opt.legend;
  opt.grid.top = 28;
  opt.yAxis = catAxis(ui, rows.map((x) => truncate(x.label, 24)), { inverse: true });
  opt.xAxis = valAxis(ui, { axisLabel: { color: ui.muted, fontSize: 11, formatter: (v) => fmtDuration(v * 1000) } });
  opt.tooltip.formatter = (ps) => {
    const r = rows[ps[0].dataIndex];
    return `<b>${r.label}</b><br>${fmtDuration(r.talk * 1000)} talk time<br>${fmtNum(r.n)} calls`;
  };
  opt.series = [bar('Talk time', rows.map((x) => x.talk), ui.series[0], ui, { horizontal: true })];
  return opt;
}

// ------------------------------------------------------------------ people, rhythm, content, sources

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';

function timeAxis(ui) {
  return { type: 'time', axisLine: { lineStyle: { color: ui.axis } }, axisTick: { show: false }, axisLabel: { color: ui.muted, fontSize: 11, hideOverlap: true }, splitLine: { show: false } };
}

const monthName = (ts) => new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'long' });

/** Stacked monthly bars: `series` = [{ name, color, get(mo) }] over sorted month keys. */
function monthlyStackOption(ui, months, series, { percent = false } = {}) {
  const opt = baseOption(ui, { boxZoom: true });
  opt.xAxis = timeAxis(ui);
  opt.yAxis = valAxis(ui, percent ? { max: 100, axisLabel: { color: ui.muted, fontSize: 11, formatter: '{value}%' } } : {});
  opt.tooltip = tooltipBase(ui, 'axis', 'shadow');
  opt.tooltip.formatter = (ps) => {
    ps.forEach((p) => (p.axisValueLabel = monthName(p.value[0])));
    return stackTooltip(ps.filter((p) => p.value[1]).map((p) => (percent ? { ...p, value: [p.value[0], p.value[2]] } : p)));
  };
  const totals = months.map((mo) => series.reduce((s, x) => s + x.get(mo), 0) || 1);
  opt.series = series.map((x, i) => ({
    ...bar(x.name, months.map((mo, j) => {
      const v = x.get(mo);
      return percent ? [monthToTs(mo), Math.round((v / totals[j]) * 1000) / 10, v] : [monthToTs(mo), v];
    }), x.color, ui, { stack: 'm', rounded: i === series.length - 1 }),
    barMaxWidth: 18,
  }));
  opt.dataZoom = [insideZoom({ xAxisIndex: 0 })];
  return opt;
}

function yearOverYearOption(ui, A) {
  const years = [...A.yearMonths.keys()].sort((a, b) => a - b).slice(-8);
  const opt = baseOption(ui, { boxZoom: true });
  opt.xAxis = catAxis(ui, MONTH_LABELS, { boundaryGap: false });
  opt.yAxis = valAxis(ui);
  opt.tooltip = tooltipBase(ui, 'axis', 'line');
  opt.tooltip.formatter = (ps) => {
    let html = `<div style="font-weight:600;margin-bottom:4px">${ps[0].axisValueLabel}</div>`;
    for (const p of [...ps].reverse()) {
      const total = A.yearMonths.get(+p.seriesName).reduce((a, b) => a + b, 0);
      html += `<div style="display:flex;justify-content:space-between;gap:16px"><span>${dot(p.color)}${p.seriesName}</span><span><b>${p.value == null ? '–' : fmtNum(p.value)}</b> <span style="color:#888">· ${fmtNum(total)} in year</span></span></div>`;
    }
    return html;
  };
  opt.series = years.map((y, i) => {
    const latest = i === years.length - 1;
    const color = ui.series[(years.length - 1 - i) % ui.series.length];
    // Months with no messages before the first / after the last message stay empty.
    const data = A.yearMonths.get(y).map((v, m) => (v || (A.first <= new Date(y, m + 1, 1).getTime() && A.last >= new Date(y, m, 1).getTime()) ? v : null));
    return line(String(y), data, color, { showSymbol: true, symbolSize: latest ? 7 : 5, lineStyle: { width: latest ? 3 : 1.5, color, opacity: latest ? 1 : 0.75 } });
  });
  return opt;
}

function nightOwlOption(ui, A) {
  const keys = [...A.night.keys()].sort((a, b) => a - b);
  const data = keys.map((mo) => {
    const [n, tot] = A.night.get(mo);
    return [monthToTs(mo), tot ? Math.round((n / tot) * 1000) / 10 : null, n, tot];
  });
  const opt = baseOption(ui, { boxZoom: true });
  delete opt.legend;
  opt.grid.top = 28;
  opt.xAxis = timeAxis(ui);
  opt.yAxis = valAxis(ui, { min: 0, axisLabel: { color: ui.muted, fontSize: 11, formatter: '{value}%' } });
  opt.tooltip = tooltipBase(ui, 'axis', 'line');
  opt.tooltip.formatter = (ps) => {
    const v = ps[0].value;
    return `<b>${monthName(v[0])}</b><br><b>${v[1]}%</b> after midnight · ${fmtNum(v[2])} of ${fmtNum(v[3])} messages`;
  };
  opt.series = [line('After midnight', data, ui.series[3], { showSymbol: data.length < 40, areaStyle: { color: ui.series[3], opacity: 0.1 } })];
  opt.dataZoom = [insideZoom({ xAxisIndex: 0 })];
  return opt;
}

function sessionsOption(ui, A) {
  const opt = baseOption(ui, { boxZoom: true });
  delete opt.legend;
  opt.grid.top = 28;
  opt.grid.bottom = 18;
  opt.xAxis = catAxis(ui, SESSION_BINS.map((b) => b.label), { name: 'messages per conversation', nameLocation: 'middle', nameGap: 26, nameTextStyle: { color: ui.muted, fontSize: 11 } });
  opt.yAxis = valAxis(ui);
  opt.tooltip.formatter = (ps) => `<b>${ps[0].axisValueLabel} messages</b><br>${fmtNum(ps[0].value)} conversations`;
  opt.series = [bar('Conversations', A.sessionHist, ui.series[2], ui)];
  return opt;
}

/** Top conversations' monthly volume, stacked, plus everyone else as "Other". */
function relationshipsOption(ui, A, labelFor, top = 8) {
  const ranked = [...A.byContact.entries()].sort((a, b) => (b[1].n[0] + b[1].n[1]) - (a[1].n[0] + a[1].n[1]));
  const head = ranked.slice(0, top);
  const months = [...A.months.keys()].sort((a, b) => a - b);
  const opt = baseOption(ui, { boxZoom: true });
  opt.legend.type = 'scroll';
  opt.legend.right = 90;
  opt.xAxis = timeAxis(ui);
  opt.yAxis = valAxis(ui);
  opt.tooltip = tooltipBase(ui, 'axis', 'line');
  opt.tooltip.formatter = (ps) => {
    ps.forEach((p) => (p.axisValueLabel = monthName(p.value[0])));
    return stackTooltip(ps.filter((p) => p.value[1]).sort((a, b) => b.value[1] - a.value[1]));
  };
  const area = (name, get, color) => ({
    ...line(name, months.map((mo) => [monthToTs(mo), get(mo)]), color, { stack: 'people', smooth: 0.3, lineStyle: { width: 1, color } }),
    areaStyle: { color, opacity: 0.55 },
  });
  opt.series = head.map(([k, bc], i) => area(truncate(labelFor(k), 22), (mo) => bc.months.get(mo) || 0, ui.series[i % ui.series.length]));
  if (ranked.length > top) {
    opt.series.push(area('Other', (mo) => {
      const tot = A.months.get(mo).c;
      return tot[0] + tot[1] - head.reduce((s, [, bc]) => s + (bc.months.get(mo) || 0), 0);
    }, ui.axis));
  }
  opt.dataZoom = [insideZoom({ xAxisIndex: 0 })];
  return opt;
}

function newPeopleOption(ui, rows) {
  // rows: [{ mo, n, names: [] }] sorted by month
  const opt = baseOption(ui, { boxZoom: true });
  delete opt.legend;
  opt.grid.top = 28;
  opt.xAxis = timeAxis(ui);
  opt.yAxis = valAxis(ui, { minInterval: 1 });
  opt.tooltip = tooltipBase(ui, 'axis', 'shadow');
  opt.tooltip.formatter = (ps) => {
    const r = rows[ps[0].dataIndex];
    const names = r.names.slice(0, 8).map((n) => `<div>${n}</div>`).join('');
    return `<b>${monthName(ps[0].value[0])}</b><br>${fmtNum(r.n)} new conversation${r.n === 1 ? '' : 's'}${names ? `<div style="color:#888;margin-top:4px">${names}${r.names.length > 8 ? '…' : ''}</div>` : ''}`;
  };
  opt.series = [{ ...bar('New conversations', rows.map((r) => [monthToTs(r.mo), r.n]), ui.series[4], ui), barMaxWidth: 14 }];
  opt.dataZoom = [insideZoom({ xAxisIndex: 0 })];
  return opt;
}

function groupSendersOption(ui, rows) {
  // rows: [{ label, n, you }] sorted desc
  const opt = baseOption(ui);
  delete opt.legend;
  opt.grid.top = 28;
  opt.yAxis = catAxis(ui, rows.map((r) => truncate(r.label, 24)), { inverse: true });
  opt.xAxis = valAxis(ui);
  opt.tooltip.formatter = (ps) => `<b>${rows[ps[0].dataIndex].label}</b><br>${fmtNum(ps[0].value)} messages in group chats`;
  opt.series = [{
    ...bar('Messages', rows.map((r) => ({ value: r.n, itemStyle: { color: r.you ? ui.sent : ui.recv } })), ui.recv, ui, { horizontal: true }),
    barMaxWidth: 16,
  }];
  return opt;
}

function groupShareOption(ui, A) {
  const months = [...A.groupMonths.keys()].sort((a, b) => a - b);
  return monthlyStackOption(ui, months, [
    { name: '1-on-1', color: ui.series[0], get: (mo) => A.groupMonths.get(mo)[0] },
    { name: 'Group chats', color: ui.series[2], get: (mo) => A.groupMonths.get(mo)[1] },
  ], { percent: true });
}

function replyByHourOption(ui, A) {
  const mins = (arr) => arr.map((v) => (v == null ? null : Math.round(v / 6000) / 10));
  const opt = baseOption(ui, { boxZoom: true });
  opt.xAxis = catAxis(ui, HOUR_LABELS, { boundaryGap: false });
  opt.yAxis = valAxis(ui, { axisLabel: { color: ui.muted, fontSize: 11, formatter: (v) => `${v}m` } });
  opt.tooltip = tooltipBase(ui, 'axis', 'line');
  opt.tooltip.formatter = (ps) => {
    let html = `<div style="font-weight:600;margin-bottom:4px">Replies sent at ${ps[0].axisValueLabel}</div>`;
    for (const p of ps) html += `<div style="display:flex;justify-content:space-between;gap:16px"><span>${dot(p.color)}${p.seriesName}</span><b>${p.value == null ? '–' : fmtDuration(p.value * 60000)}</b></div>`;
    return html;
  };
  opt.series = [
    line('You', mins(A.replyHourMedian[1]), ui.sent, { showSymbol: true, symbolSize: 5, connectNulls: true }),
    line('Them', mins(A.replyHourMedian[0]), ui.recv, { showSymbol: true, symbolSize: 5, connectNulls: true }),
  ];
  return opt;
}

function distinctiveOption(ui, rows) {
  const opt = sentRecvStack(ui, rows.map((r) => r.w), rows.map((r) => r.s), rows.map((r) => r.r), { horizontal: true });
  return opt;
}

function emojiTrendOption(ui, C, top = 8) {
  const emojis = [...C.emojiTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, top).map(([e]) => e);
  const months = [...C.emojiMonths.keys()].sort((a, b) => a - b);
  const opt = monthlyStackOption(ui, months, emojis.map((e, i) => ({ name: e, color: ui.series[i % ui.series.length], get: (mo) => C.emojiMonths.get(mo).get(e) || 0 })));
  opt.legend.textStyle = { ...opt.legend.textStyle, fontSize: 15, fontFamily: EMOJI_FONT };
  return opt;
}

/** Uses of the tracked phrase per day / week / month, you vs them, over the whole selection. */
function phraseOption(ui, P, firstDay, lastDay, gran) {
  // Empty ends so the axis spans the selection, not just the days it was used.
  const days = new Map(P.days);
  if (!days.has(firstDay)) days.set(firstDay, [0, 0]);
  if (!days.has(lastDay)) days.set(lastDay, [0, 0]);
  const tl = buildTimeline(days, gran);
  const opt = baseOption(ui, { boxZoom: true });
  opt.xAxis = timeAxis(ui);
  opt.yAxis = valAxis(ui, { minInterval: 1 });
  opt.tooltip = tooltipBase(ui, 'axis', 'shadow');
  opt.tooltip.formatter = (ps) => {
    ps.forEach((p) => (p.axisValueLabel = fmtBucket(p.value[0], gran)));
    return stackTooltip(ps);
  };
  opt.series = [
    { ...bar('You', tl.x.map((x, i) => [x, tl.s[i]]), ui.sent, ui, { stack: 'p', rounded: false }), barMaxWidth: 18 },
    { ...bar('Them', tl.x.map((x, i) => [x, tl.r[i]]), ui.recv, ui, { stack: 'p' }), barMaxWidth: 18 },
  ];
  // Too many bars to see at once (days over years): open on the latest 90 with a slider to pan.
  if (tl.x.length > 150) {
    const win = { xAxisIndex: 0, startValue: tl.x[tl.x.length - 90], endValue: tl.x[tl.x.length - 1] };
    opt.grid = { ...opt.grid, bottom: 44 };
    opt.dataZoom = [sliderZoom(ui, win), insideZoom(win)];
  } else {
    opt.dataZoom = [insideZoom({ xAxisIndex: 0 })];
  }
  return opt;
}

function domainsOption(ui, C, limit = 15) {
  const rows = [...C.domains.entries()]
    .map(([d, v]) => ({ d, r: v[0], s: v[1], t: v[0] + v[1] }))
    .sort((a, b) => b.t - a.t)
    .slice(0, limit);
  return { opt: sentRecvStack(ui, rows.map((x) => x.d), rows.map((x) => x.s), rows.map((x) => x.r), { horizontal: true }), empty: !rows.length };
}

/** Different words per month, you vs them; the tooltip and `selMo` marker show new words. */
function vocabOption(ui, C, selMo) {
  const keys = [...C.vocab.keys()].sort((a, b) => a - b);
  const mk = (o) => keys.map((mo) => [monthToTs(mo), C.vocab.get(mo)[o] || null]);
  const opt = baseOption(ui, { boxZoom: true });
  opt.xAxis = timeAxis(ui);
  opt.yAxis = valAxis(ui);
  opt.tooltip = tooltipBase(ui, 'axis', 'line');
  opt.tooltip.formatter = (ps) => {
    const d = new Date(ps[0].value[0]);
    const fresh = C.vocabNew.get(d.getFullYear() * 12 + d.getMonth());
    let html = `<div style="font-weight:600;margin-bottom:4px">${monthName(ps[0].value[0])}</div>`;
    for (const p of ps) {
      const nw = fresh && fresh[p.seriesIndex === 0 ? 1 : 0];
      html += `<div style="display:flex;justify-content:space-between;gap:16px"><span>${dot(p.color)}${p.seriesName}</span><b>${p.value[1] == null ? '–' : fmtNum(p.value[1])} words</b></div>`;
      if (nw && nw.top.length) {
        html += `<div style="margin:0 0 4px 14px;color:#888;max-width:260px;white-space:normal">new: ${nw.top.slice(0, 6).map(([w]) => escapeHtml(w)).join(', ')}${nw.n > 6 ? '…' : ''}</div>`;
      }
    }
    return html + '<div style="margin-top:4px;color:#888">Click to list the new words</div>';
  };
  opt.series = [line('You', mk(1), ui.sent, { connectNulls: true }), line('Them', mk(0), ui.recv, { connectNulls: true })];
  if (selMo != null) {
    opt.series[0].markLine = {
      silent: true,
      symbol: 'none',
      label: { show: false },
      lineStyle: { color: ui.muted, type: 'dashed', width: 1 },
      data: [{ xAxis: monthToTs(selMo) }],
    };
  }
  opt.dataZoom = [insideZoom({ xAxisIndex: 0 })];
  return opt;
}

/** Share of messages that read positive (up) and negative (down) per month, you vs them. */
function moodOption(ui, C) {
  const keys = [...C.mood.keys()].sort((a, b) => a - b);
  const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : null);
  const series = (name, o, sign, color, opacity) => ({
    ...bar(name, keys.map((mo) => {
      const m = C.mood.get(mo);
      const v = pct(sign > 0 ? m.pos[o] : m.neg[o], m.n[o]);
      return [monthToTs(mo), v == null ? null : sign * v];
    }), color, ui, { stack: o ? 'you' : 'them', rounded: false }),
    itemStyle: { color, opacity, borderRadius: sign > 0 ? [3, 3, 0, 0] : [0, 0, 3, 3] },
    barMaxWidth: 9,
  });
  const opt = baseOption(ui, { boxZoom: true });
  opt.xAxis = timeAxis(ui);
  opt.yAxis = valAxis(ui, { axisLabel: { color: ui.muted, fontSize: 11, formatter: (v) => `${Math.abs(v)}%` } });
  opt.tooltip = tooltipBase(ui, 'axis', 'shadow');
  opt.tooltip.formatter = (ps) => {
    const mo = keys[ps[0].dataIndex];
    const m = C.mood.get(mo);
    const row = (label, o, color) => m.n[o]
      ? `<div style="display:flex;justify-content:space-between;gap:16px"><span>${dot(color)}${label}</span><span><b>${pct(m.pos[o], m.n[o])}%</b> positive · <b>${pct(m.neg[o], m.n[o])}%</b> negative <span style="color:#888">of ${fmtNum(m.n[o])}</span></span></div>`
      : '';
    return `<div style="font-weight:600;margin-bottom:4px">${monthName(monthToTs(mo))}</div>${row('You', 1, ui.sent)}${row('Them', 0, ui.recv)}<div style="margin-top:4px;color:#888">Click a bar to read those messages</div>`;
  };
  // Positive and negative bars share a name, so the legend toggles both together.
  opt.legend.data = ['You', 'Them'];
  opt.series = [
    series('You', 1, 1, ui.sent, 1),
    series('You', 1, -1, ui.sent, 0.5),
    series('Them', 0, 1, ui.recv, 1),
    series('Them', 0, -1, ui.recv, 0.5),
  ];
  opt.dataZoom = [insideZoom({ xAxisIndex: 0 })];
  return opt;
}

/** Swear words per 1,000 messages, per month, you vs them. */
function swearOption(ui, C) {
  const keys = [...C.swear.keys()].sort((a, b) => a - b);
  const rate = (o) => keys.map((mo) => {
    const m = C.swear.get(mo);
    return [monthToTs(mo), m.n[o] ? Math.round((m.w[o] / m.n[o]) * 10000) / 10 : null, m.w[o], m.n[o]];
  });
  const opt = baseOption(ui, { boxZoom: true });
  opt.xAxis = timeAxis(ui);
  opt.yAxis = valAxis(ui, { min: 0 });
  opt.tooltip = tooltipBase(ui, 'axis', 'line');
  opt.tooltip.formatter = (ps) => {
    let html = `<div style="font-weight:600;margin-bottom:4px">${monthName(ps[0].value[0])}</div>`;
    for (const p of ps) {
      const [, v, w, n] = p.value;
      html += `<div style="display:flex;justify-content:space-between;gap:16px"><span>${dot(p.color)}${p.seriesName}</span><span><b>${v == null ? '–' : v}</b> per 1,000 messages <span style="color:#888">(${fmtNum(w)} in ${fmtNum(n)})</span></span></div>`;
    }
    return html;
  };
  opt.series = [line('You', rate(1), ui.sent, { connectNulls: true }), line('Them', rate(0), ui.recv, { connectNulls: true })];
  opt.dataZoom = [insideZoom({ xAxisIndex: 0 })];
  return opt;
}

function platformMixOption(ui, A, names) {
  const months = [...A.sourceMonths.keys()].sort((a, b) => a - b);
  const present = [0, 1, 2, 3, 4, 5].filter((s) => months.some((mo) => A.sourceMonths.get(mo)[s]));
  return monthlyStackOption(ui, months, present.map((s) => ({ name: names[s], color: ui.series[s], get: (mo) => A.sourceMonths.get(mo)[s] })));
}
