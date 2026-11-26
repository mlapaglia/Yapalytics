/*
 * The summary image (spec 025): the headline numbers of the selection on one picture,
 * made to be posted. It never holds message text, and people are "Person 1", "Group
 * chat 1"… unless Show names is ticked for that image.
 */

// The dark theme's series colours. The image has a fixed dark background, so it uses
// these whatever the page's theme is: the same image either way (R8).
const SUMMARY_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
const SUMMARY_W = 1080;
const SUMMARY_H = 1350;

/** "Mar 2019 – Nov 2026", or one month when the selection fits in it. */
function summarySpan(first, last) {
  const a = fmtDate.monthShort(first), b = fmtDate.monthShort(last);
  return a === b ? a : `${a} – ${b}`;
}

/**
 * Messages per sender in one conversation (like senderBreakdown), top 5 rows with the
 * rest folded into "Everyone else". With names off, the others are "Person 1", "Person
 * 2"… by messages, and no name is looked up. Your messages are keyed apart from every
 * sender name, so someone in a group chat who is called "You" stays someone else.
 */
const SUMMARY_SELF = Symbol('you');
function summarySenders(msgs, key, { names, senderLabel }) {
  const group = key.startsWith('g:');
  const byId = new Map();
  for (const m of msgs) {
    const id = m.o ? SUMMARY_SELF : group ? m.sn || m.sk || '' : key;
    byId.set(id, (byId.get(id) || 0) + 1);
  }
  let rows;
  if (names) {
    // Senders that share a label (linked people) are one row; you are always your own.
    const byLabel = new Map();
    for (const [id, n] of byId) {
      const label = id === SUMMARY_SELF ? 'You' : id ? senderLabel(id) : 'Unknown sender';
      const slot = id === SUMMARY_SELF ? SUMMARY_SELF : label;
      const row = byLabel.get(slot) || byLabel.set(slot, { label, n: 0 }).get(slot);
      row.n += n;
    }
    rows = [...byLabel.values()];
  } else {
    let rank = 0;
    rows = [...byId].sort((a, b) => b[1] - a[1]).map(([id, n]) => ({
      label: id === SUMMARY_SELF ? 'You' : id ? `Person ${++rank}` : 'Unknown sender',
      n,
    }));
  }
  rows.sort((a, b) => b.n - a.n);
  if (rows.length <= 5) return rows;
  const rest = rows.slice(4).reduce((sum, r) => sum + r.n, 0);
  return [...rows.slice(0, 4), { label: `Everyone else (${rows.length - 4} people)`, n: rest, rest: true }];
}

/**
 * Everything the summary image shows, as strings and numbers (R3). `contact` is the
 * picked conversation, or 'all'. With `names: false`, `labelFor` and `senderLabel` are
 * never called (R5). Nothing here comes from message text (R4).
 */
function summaryStats(msgs, A, { contact = 'all', names = false, labelFor = (k) => k, senderLabel = (x) => x, appName = (s) => String(s), reactions = null } = {}) {
  const single = contact !== 'all';
  const total = A.dir[0] + A.dir[1];
  const group = single && contact.startsWith('g:');
  const media = MEDIA_TYPES.reduce((s, m) => s + A.media[m.key][0] + A.media[m.key][1], 0);
  let night = 0;
  for (const [n] of A.night.values()) night += n;

  const tiles = [
    { label: 'Per day', value: A.spanDays ? (total / A.spanDays).toFixed(1) : '–', sub: 'messages' },
    { label: 'Active days', value: fmtNum(A.activeDays), sub: `of ${fmtNum(A.spanDays)} days` },
    { label: 'Longest streak', value: A.longestStreak.len ? `${fmtNum(A.longestStreak.len)} days` : '–', sub: 'in a row' },
    { label: 'Busiest day', value: A.busiestDay ? fmtNum(A.busiestDay.n) : '–', sub: A.busiestDay ? fmtDate.day(dayToTs(A.busiestDay.d)) : '' },
    { label: 'Your reply', value: fmtDuration(A.replyMedian[1]), sub: `median · theirs ${fmtDuration(A.replyMedian[0])}` },
  ];
  if (!single) {
    const groups = [...A.contacts.keys()].filter((k) => k.startsWith('g:')).length;
    tiles.push({ label: 'Conversations', value: fmtNum(A.contacts.size), sub: `${fmtNum(groups)} group chats` });
  }
  tiles.push(
    { label: 'Night owl', value: shareText(night, total), sub: 'midnight to 5 am' },
    { label: 'Attachments', value: fmtNum(media), sub: `${fmtNum(A.media.ph[0] + A.media.ph[1])} photos` },
  );

  let bars;
  if (single) bars = summarySenders(msgs, contact, { names, senderLabel });
  else {
    const rank = { person: 0, group: 0 };
    bars = [...A.byContact.entries()]
      .map(([k, bc]) => ({ k, n: bc.n[0] + bc.n[1] }))
      .sort((a, b) => b.n - a.n)
      .slice(0, 5)
      .map(({ k, n }) => ({
        label: names ? labelFor(k) : k.startsWith('g:') ? `Group chat ${++rank.group}` : `Person ${++rank.person}`,
        n,
      }));
  }

  const emoji = [...withReactionEmoji(A.emojiFreq, reactions).entries()] // typed and reacted (spec 027 R11a)
    .sort((a, b) => (b[1][0] + b[1][1]) - (a[1][0] + a[1][1]))
    .slice(0, 3)
    .map(([e]) => e);

  const perApp = new Map();
  for (const counts of A.sourceMonths.values()) counts.forEach((n, s) => { if (n) perApp.set(s, (perApp.get(s) || 0) + n); });
  const apps = perApp.size >= 2
    ? [...perApp].sort((a, b) => b[1] - a[1]).map(([s, n]) => ({ s, name: appName(s), n, share: n / total }))
    : [];

  return {
    span: total ? summarySpan(A.first, A.last) : '',
    title: !single ? 'All conversations' : names ? labelFor(contact) : group ? 'A group chat' : 'A conversation',
    total,
    sent: A.dir[1],
    received: A.dir[0],
    tiles,
    barsTitle: single ? 'Who sent what' : 'Top conversations',
    bars,
    emoji,
    apps,
  };
}

/** Draws the summary `sum` (summaryStats) on a SUMMARY_W × SUMMARY_H canvas. */
function drawSummary(canvas, sum) {
  const { w, background, text, box } = canvasKit(canvas);
  const soft = CANVAS_SOFT;
  const color = (i) => SUMMARY_COLORS[i % SUMMARY_COLORS.length];
  background();
  text('Yapalytics', w - 80, 92, 22, { weight: 600, color: 'rgba(255,255,255,0.45)', align: 'right', max: 200 });

  // Who and when
  text(sum.span, 80, 92, 30, { color: soft, max: 640 });
  text(sum.title, 80, 168, 58, { weight: 800, max: w - 160 });

  // Total
  text(fmtNum(sum.total), 80, 300, 110, { weight: 800, color: SUMMARY_COLORS[3] });
  text(`messages · ${fmtNum(sum.sent)} sent, ${fmtNum(sum.received)} received`, 80, 352, 30, { color: soft });

  // Tiles: 4 to a row
  const tileW = 215, tileH = 118, gap = 20;
  sum.tiles.forEach((t, i) => {
    const x = 80 + (i % 4) * (tileW + gap), y = 400 + Math.floor(i / 4) * (tileH + gap);
    box(x, y, tileW, tileH, 14, 'rgba(255,255,255,0.08)');
    text(t.label.toUpperCase(), x + 18, y + 34, 17, { weight: 600, color: soft, max: tileW - 36 });
    text(t.value, x + 18, y + 76, 32, { weight: 800, max: tileW - 36 });
    text(t.sub, x + 18, y + 104, 17, { color: soft, max: tileW - 36 });
  });

  // People
  const top = 400 + 2 * (tileH + gap) + 52;
  text(sum.barsTitle, 80, top, 34, { weight: 700 });
  const maxN = Math.max(1, ...sum.bars.filter((b) => !b.rest).map((b) => b.n));
  sum.bars.forEach((b, i) => {
    const y = top + 26 + i * 60;
    if (b.rest) {
      text(`${b.label}: ${fmtNum(b.n)} messages`, 80, y + 32, 26, { color: soft, max: 920 });
      return;
    }
    box(80, y, 700, 46, 10, 'rgba(255,255,255,0.10)');
    box(80, y, Math.max(46, (700 * b.n) / maxN), 46, 10, color(i));
    text(b.label, 98, y + 32, 26, { weight: 600, max: 520 });
    text(fmtNum(b.n), 800, y + 32, 26, { color: soft, max: 200 });
  });

  // Emoji and apps, side by side
  const low = top + 26 + 5 * 60 + 60;
  text('Top emoji', 80, low, 34, { weight: 700 });
  // One at a time: the emoji font's spaces are wide, and cutting a run to fit could split an emoji.
  if (!sum.emoji.length) text('—', 80, low + 82, 64, { color: soft });
  sum.emoji.forEach((e, i) => text(e, 80 + i * 120, low + 82, 64, { font: CANVAS_EMOJI, max: 110 }));
  if (sum.apps.length) {
    const x = 560, width = 440;
    text('Apps', x, low, 34, { weight: 700 });
    // One bar split by app, then the top 3 named and the rest as "Other".
    const shown = sum.apps.length > 4 ? [...sum.apps.slice(0, 3), { name: 'Other', share: sum.apps.slice(3).reduce((s, a) => s + a.share, 0) }] : sum.apps;
    let left = x;
    shown.forEach((a, i) => {
      const part = i === shown.length - 1 ? x + width - left : Math.round(width * a.share);
      if (part > 0) box(left, low + 24, part, 22, 4, color(i));
      left += part;
    });
    shown.forEach((a, i) => {
      const y = low + 86 + i * 30;
      box(x, y - 16, 16, 16, 4, color(i));
      text(`${a.name} ${pctText(a.share)}`, x + 26, y, 22, { color: soft, max: width - 26 });
    });
  }
}

/** The selection's summary (spec 025), as the dialog shows it now. */
const Summary = { msgs: null, A: null, R: null, contact: 'all' };

function drawSummaryPreview() {
  const sum = summaryStats(Summary.msgs, Summary.A, {
    contact: Summary.contact, names: $('#summaryNames').checked, labelFor: plainName, senderLabel, appName: sourceName, reactions: Summary.R,
  });
  drawSummary($('#summaryCanvas'), sum);
}

/** Opens the dialog on the selection as it is now, names off (R2, R6). */
function openSummaryDialog() {
  Summary.msgs = Select.range();
  Summary.A = Select.agg();
  Summary.R = Select.reactions();
  Summary.contact = View.filter.contact;
  if (!Summary.msgs.length) return;
  $('#summaryNames').checked = false;
  drawSummaryPreview();
  const dlg = $('#summaryDlg');
  if (!dlg.open) dlg.showModal();
}

/** `Yapalytics-summary-YYYY-MM-DD.png`, today's date in local time (R7). */
function summaryFileName(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `Yapalytics-summary-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}.png`;
}

function saveSummary() {
  $('#summaryCanvas').toBlob((blob) => {
    if (blob) saveBlob(blob, summaryFileName());
  }, 'image/png');
}

// The button is off when the selection has no messages (R9).
Panels.register({
  id: 'summary-button',
  tab: 'sec-glance',
  topics: ['data', 'selection'],
  render(ctx) {
    $('#summaryBtn').disabled = ctx.none;
  },
  init() {
    const dlg = $('#summaryDlg');
    $('#summaryBtn').addEventListener('click', openSummaryDialog);
    $('#summaryNames').addEventListener('change', drawSummaryPreview);
    $('#summarySave').addEventListener('click', saveSummary);
    dlg.querySelector('.profile-close').addEventListener('click', () => dlg.close());
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); }); // the backdrop
  },
});
