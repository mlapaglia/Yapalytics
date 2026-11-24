/* The Year in review tab: a picture of one year, drawn on a canvas so it can be saved. */

function wrappedStats(base, year) {
  const from = new Date(year, 0, 1).getTime();
  const to = new Date(year + 1, 0, 1).getTime();
  const msgs = base.filter((m) => m.t >= from && m.t < to);
  const A = aggregateMessages(msgs, View.convoGap);
  const C = aggregateContent(msgs, 'vader', { phrases: false }); // no signature phrases here (spec 019 AC19)
  const single = View.filter.contact !== 'all';
  const people = single
    ? senderBreakdown(msgs, View.filter.contact)
    : [...A.byContact.entries()]
      .map(([k, bc]) => ({ label: labelFor(k), n: bc.n[0] + bc.n[1] }))
      .sort((a, b) => b.n - a.n)
      .slice(0, 5);
  const emoji = [...A.emojiFreq.entries()].sort((a, b) => (b[1][0] + b[1][1]) - (a[1][0] + a[1][1])).slice(0, 3).map(([e]) => e);
  const word = [...C.wordFreq.entries()].sort((a, b) => (b[1][0] + b[1][1]) - (a[1][0] + a[1][1]))[0];
  const site = [...C.domains.entries()].sort((a, b) => (b[1][0] + b[1][1]) - (a[1][0] + a[1][1]))[0];
  let night = 0;
  for (const [n] of A.night.values()) night += n;
  let newPeople = 0;
  for (const k of A.byContact.keys()) {
    const t = Data.firstSeen.get(k);
    if (t >= from && t < to) newPeople++;
  }
  return { year, A, people, peopleTitle: single ? 'Who sent what' : 'Your people', emoji, word: word && word[0], site: site && site[0], nightPct: A.n ? (night / A.n) * 100 : 0, newPeople };
}

/**
 * Messages per sender in one conversation: you and the other person, or each group
 * member (when the export says who sent it). Top 5 rows, folding the rest into "Everyone else".
 */
function senderBreakdown(msgs, key) {
  const group = key.startsWith('g:');
  const byId = new Map();
  for (const m of msgs) {
    const id = m.o ? 'You' : group ? m.sn || m.sk || '' : key;
    byId.set(id, (byId.get(id) || 0) + 1);
  }
  const byLabel = new Map();
  for (const [id, n] of byId) {
    const label = id === 'You' ? 'You' : id ? senderLabel(id) : 'Unknown sender';
    byLabel.set(label, (byLabel.get(label) || 0) + n);
  }
  const rows = [...byLabel].map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n);
  if (rows.length <= 5) return rows;
  const rest = rows.slice(4).reduce((sum, r) => sum + r.n, 0);
  return [...rows.slice(0, 4), { label: `Everyone else (${rows.length - 4} people)`, n: rest, rest: true }];
}

function drawWrapped(canvas, W, ui) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  const sans = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  const emojiFont = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#13213f');
  g.addColorStop(0.55, '#2b1d52');
  g.addColorStop(1, '#4a1942');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const fit = (text, max) => {
    let t = String(text);
    if (ctx.measureText(t).width <= max) return t;
    while (t.length > 1 && ctx.measureText(t + '…').width > max) t = t.slice(0, -1);
    return t + '…';
  };
  const text = (str, x, y, size, { weight = 400, color = '#ffffff', align = 'left', max = w - 160, font = sans } = {}) => {
    ctx.font = `${weight} ${size}px ${font}`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.fillText(fit(str, max), x, y);
  };
  const soft = 'rgba(255,255,255,0.68)';
  const A = W.A;

  text(String(W.year), 80, 150, 120, { weight: 800 });
  text('in messages', 80, 205, 40, { color: soft });
  text(fmtNum(A.n), 80, 340, 110, { weight: 800, color: ui.series[3] });
  text(`messages · ${fmtNum(A.dir[1])} sent, ${fmtNum(A.dir[0])} received`, 80, 395, 32, { color: soft });

  // Top people with bars
  text(W.peopleTitle, 80, 490, 34, { weight: 700 });
  const maxN = Math.max(1, ...W.people.filter((p) => !p.rest).map((p) => p.n));
  W.people.forEach((p, i) => {
    const y = 535 + i * 62;
    if (p.rest) {
      // Combined senders can outnumber the top one, so no bar: just the count.
      text(`${p.label}: ${fmtNum(p.n)} messages`, 80, y + 32, 26, { color: soft, max: 920 });
      return;
    }
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.beginPath();
    ctx.roundRect(80, y, 560, 46, 10);
    ctx.fill();
    ctx.fillStyle = ui.series[i % ui.series.length];
    ctx.beginPath();
    ctx.roundRect(80, y, Math.max(46, (560 * p.n) / maxN), 46, 10);
    ctx.fill();
    text(p.label, 98, y + 32, 26, { weight: 600, max: 420 });
    text(fmtNum(p.n), 660, y + 32, 26, { color: soft, max: 200 });
  });
  if (!W.people.length) text('No messages this year', 80, 570, 28, { color: soft });

  // Top emoji
  text('Top emoji', 80, 900, 34, { weight: 700 });
  text(W.emoji.join('  ') || '—', 80, 985, 72, { font: emojiFont });

  // Stat tiles
  const tiles = [
    ['Busiest day', A.busiestDay ? `${fmtNum(A.busiestDay.n)} msgs` : '–', A.busiestDay ? fmtDate.dayOfMonth(dayToTs(A.busiestDay.d)) : ''],
    ['Night owl', `${W.nightPct.toFixed(1)}%`, 'after midnight'],
    ['Longest chat', A.longestSession ? `${fmtNum(A.longestSession.n)} msgs` : '–', A.longestSession ? labelFor(A.longestSession.k) : ''],
    ['Longest streak', A.longestStreak.len ? `${fmtNum(A.longestStreak.len)} days` : '–', 'in a row'],
    ['Top word', W.word || '–', 'most used'],
    ['New people', fmtNum(W.newPeople), W.site ? `top site: ${W.site}` : 'first messages'],
  ];
  tiles.forEach(([label, value, sub], i) => {
    const col = i % 3, row = Math.floor(i / 3);
    const x = 80 + col * 315, y = 1030 + row * 135;
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath();
    ctx.roundRect(x, y, 290, 118, 14);
    ctx.fill();
    text(label.toUpperCase(), x + 20, y + 34, 19, { weight: 600, color: soft, max: 250 });
    text(value, x + 20, y + 76, 34, { weight: 800, max: 250 });
    text(sub, x + 20, y + 104, 19, { color: soft, max: 250 });
  });
  text('Yapalytics', w - 80, h - 24, 22, { weight: 600, color: 'rgba(255,255,255,0.45)', align: 'right' });
}

function renderWrapped(ui, base) {
  const firstY = new Date(base[0].t).getFullYear();
  const lastY = new Date(base[base.length - 1].t).getFullYear();
  if (View.wrapYear == null || View.wrapYear < firstY || View.wrapYear > lastY) View.wrapYear = lastY;
  const wrap = $('#wrapYears');
  wrap.innerHTML = '';
  for (let y = firstY; y <= lastY; y++) {
    const b = document.createElement('button');
    b.textContent = y;
    b.className = y === View.wrapYear ? 'on' : '';
    b.addEventListener('click', () => View.set({ wrapYear: y }));
    wrap.appendChild(b);
  }
  drawWrapped($('#wrapCanvas'), wrappedStats(base, View.wrapYear), ui);
}

function saveWrapped() {
  $('#wrapCanvas').toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `Yapalytics-${View.wrapYear}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }, 'image/png');
}

Panels.register({
  id: 'wrapped',
  tab: 'sec-wrapped',
  topics: ['data', 'filter.contact', 'filter.source', 'filter.groups', 'gap', 'wrapped', 'theme'],
  render(ctx) {
    const base = ctx.base();
    if (base.length) renderWrapped(ctx.ui, base);
  },
  init() {
    $('#wrapSave').addEventListener('click', saveWrapped);
  },
});
