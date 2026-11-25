/* The Mood & emoji tab: mood (VADER or the AI model, spec 001), swearing, emoji. */

/** Switch the mood chart and pills between VADER and the AI model's scores (spec 001). */
function setMoodScorer(scorer) {
  View.set({ moodScorer: scorer });
  AiMood.render(); // the switch shows the scorer just picked
}

/** Bars sit on the 1st of their month: the nearest month to a point in time. */
const moodMonthAt = (ts) => {
  const d = new Date(ts + 15 * DAY_MS);
  return d.getFullYear() * 12 + d.getMonth();
};

/** Bars open that month's messages of that side and direction; empty space, all of that month's. */
const MOOD_ON = {
  click(p) {
    if (p.componentType !== 'series' || !Array.isArray(p.value)) return;
    showMoodMessages(moodMonthAt(p.value[0]), p.seriesIndex < 2 ? 1 : 0, p.seriesIndex % 2 ? 'neg' : 'pos');
  },
  'zr:click'(e, chart) {
    if (e.target) return; // on a bar or label
    const pt = [e.offsetX, e.offsetY];
    if (!chart.containPixel('grid', pt)) return;
    showMoodMessages(moodMonthAt(chart.convertFromPixel({ gridIndex: 0 }, pt)[0]), null, 'any');
  },
};

/** Thanks & sorry (spec 019 R13): share of messages per month, and each side's overall share. */
function renderPolite(ui, C) {
  const { thanks, sorry } = C.politeTotal;
  const n = C.swearTotal.n; // messages with text
  const pct = (w, o) => (n[o] ? `${(w[o] / n[o] * 100).toFixed(1)}%` : '–');
  const any = thanks[0] + thanks[1] + sorry[0] + sorry[1];
  $('#politeNote').textContent = any
    ? `Share of messages that say thanks or sorry, per month. You say thanks in ${pct(thanks, 1)} of your messages; they do in ${pct(thanks, 0)}. You say sorry in ${pct(sorry, 1)}; they do in ${pct(sorry, 0)}.`
    : 'Share of messages that say thanks or sorry';
  Charts.set('c-polite', any ? politeOption(ui, C) : emptyOption(ui, n[0] + n[1] ? 'No thanks or sorry in this selection' : 'No messages with words in this selection'));
}

Panels.register({
  id: 'mood',
  tab: 'sec-mood',
  topics: ['data', 'selection', 'scorer', 'theme'],
  render(ctx) {
    const { ui } = ctx;
    const C = ctx.content();
    const mt = C.moodTotal;
    $('#moodNote').textContent = mt.n[0] + mt.n[1]
      ? `Share of messages that read positive (up) or negative (down), scored with ${View.moodScorer === 'ai' ? 'the AI model' : 'VADER'}. You: ${shareText(mt.pos[1], mt.n[1])} positive, ${shareText(mt.neg[1], mt.n[1])} negative · Them: ${shareText(mt.pos[0], mt.n[0])} positive, ${shareText(mt.neg[0], mt.n[0])} negative`
      : 'Share of messages that read positive (up) or negative (down) each month';
    if (mt.n[0] + mt.n[1]) $('#moodNote').textContent += '. Click a bar to read those messages.';
    Charts.set('c-mood', mt.n[0] + mt.n[1] ? moodOption(ui, C) : emptyOption(ui, 'No messages with words in this selection'), { on: MOOD_ON });
    const st = C.swearTotal;
    const per1k = (o) => (st.n[o] ? (st.w[o] / st.n[o] * 1000).toFixed(1) : '–');
    const topSwears = [...C.swearWords.entries()].sort((a, b) => (b[1][0] + b[1][1]) - (a[1][0] + a[1][1])).slice(0, 5).map(([w]) => w);
    $('#swearNote').textContent = st.w[0] + st.w[1]
      ? `Swear words per 1,000 messages. You: ${fmtNum(st.w[1])} (${per1k(1)} per 1,000) · Them: ${fmtNum(st.w[0])} (${per1k(0)} per 1,000) · Most used: ${topSwears.join(', ')}`
      : 'Swear words per 1,000 messages';
    Charts.set('c-swear', st.w[0] + st.w[1] ? swearOption(ui, C) : emptyOption(ui, 'No swearing in this selection 😇'));
    renderPolite(ui, C);
    const em = emojiOption(ui, ctx.agg());
    Charts.set('c-emoji', em.empty ? emptyOption(ui, 'No emoji in this selection') : em.opt);
    Charts.set('c-emojitrend', C.emojiTotals.size ? emojiTrendOption(ui, C) : emptyOption(ui, 'No emoji in this selection'));
  },
});
