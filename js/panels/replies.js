/* The Replies tab: who sends what, reply times, conversations and habits, by the conversation gap picked in Settings (spec 015). */

Panels.register({
  id: 'replies',
  tab: 'sec-replies',
  topics: ['data', 'selection', 'gap', 'theme'],
  render(ctx) {
    const { ui } = ctx;
    const A = ctx.agg();
    ctx.put('c-split', () => splitOption(ui, A));
    ctx.put('c-share', () => shareOption(ui, A));
    const anyReply = A.reply[0].some(Boolean) || A.reply[1].some(Boolean);
    Charts.set('c-reply', anyReply ? replyOption(ui, A) : emptyOption(ui, 'No back-and-forth replies in this selection'));
    Charts.set('c-replyhour', anyReply ? replyByHourOption(ui, A) : emptyOption(ui, 'No back-and-forth replies in this selection'));
    ctx.put('c-sessions', () => sessionsOption(ui, A));
    ctx.put('c-behavior', () => behaviorOption(ui, A));
    const gapWords = fmtGapWords(View.convoGap);
    const ls = A.longestSession;
    $('#sessionNote').textContent = `A conversation ends after ${gapWords} of quiet` + (ls
      ? ` · Longest: ${fmtNum(ls.n)} messages over ${fmtDuration(ls.end - ls.start)} with ${labelFor(ls.k)} on ${fmtDate.day(ls.start)}`
      : '');
    $('#replyNote').textContent = `How quickly each side answers (within ${gapWords})`;
    $('#habitsNote').textContent = `Conversation starters (after ${fmtGapShort(View.convoGap)} of quiet), double texts and message traits`;
    renderDynamics(ctx, A, gapWords);
  },
});

const NO_ONE_ON_ONE = 'No 1-on-1 conversations in this selection';

/** Spec 017: how conversations end, questions that got a reply, turn-taking and style match. */
function renderDynamics(ctx, A, gapWords) {
  const { ui } = ctx;
  const oneOnOne = A.n - A.group > 0;
  const chart = (id, has, fn, empty) => Charts.set(id, has ? fn() : emptyOption(ui, oneOnOne ? empty : NO_ONE_ON_ONE));
  const { last, none } = A.endings;
  chart('c-endings', last[0] + last[1] + none[0] + none[1] > 0, () => endingsOption(ui, A), 'No finished conversations in this selection');
  const { asked } = A.questionReplies;
  chart('c-questions', asked[0] + asked[1] > 0, () => questionRepliesOption(ui, A), 'No questions in this selection');
  chart('c-turns', A.turns[0] + A.turns[1] > 0, () => turnsOption(ui, A), NO_ONE_ON_ONE);
  $('#endingsNote').textContent = `1-on-1 conversations, each ending after ${gapWords} of quiet`;
  const avg = (o) => (A.turns[o] ? (A.turnMsgs[o] / A.turns[o]).toFixed(1) : '–');
  $('#turnsNote').textContent = `Messages in a row before the other side answers (1-on-1 only) · You average ${avg(1)}, they average ${avg(0)}`;
  renderStyle(ctx, A);
}

/** Style match per month: the top 1-on-1 conversations, or the one picked with its markers. */
function renderStyle(ctx, A) {
  const { ui } = ctx;
  const box = $('#styleMarkers');
  box.innerHTML = '';
  let lines;
  if (ctx.all) {
    $('#styleNote').textContent = `How alike you and each of your top 1-on-1 conversations write, per month (0–100). Each point covers ${STYLE_WINDOW} months and needs ${STYLE_MIN_MSGS}+ messages from each side.`;
    lines = [...A.byContact.entries()]
      .filter(([k]) => !k.startsWith('g:'))
      .sort((a, b) => (b[1].n[0] + b[1].n[1]) - (a[1].n[0] + a[1].n[1]))
      .map(([k, bc]) => ({ name: plainName(k), data: styleSeries(bc.style) }))
      .filter((l) => l.data.length >= 3)
      .slice(0, 5);
  } else {
    $('#styleNote').textContent = `How alike you write, per month (0–100): words and emoji per message, and how often each side asks, laughs, says love you, shouts and swears. Each point covers ${STYLE_WINDOW} months and needs ${STYLE_MIN_MSGS}+ messages from each side.`;
    lines = [{ name: 'Style match', data: styleSeries(A.styleMonths) }].filter((l) => l.data.length);
  }
  if (ctx.none || !lines.length) {
    const empty = !ctx.none && !ctx.all && A.n === A.group
      ? 'Style match compares two people. Pick a 1-on-1 conversation.'
      : ctx.none ? 'No messages in this selection' : 'Not enough messages to compare styles';
    Charts.set('c-style', emptyOption(ui, empty));
  } else {
    Charts.set('c-style', styleOption(ui, lines));
  }
  if (!ctx.all) box.innerHTML = styleTableHtml(A.styleTotal);
}

/** Both sides' style markers over the selection, and how alike each one is. */
function styleTableHtml([them, you]) {
  const x = styleMarkers(you), y = styleMarkers(them);
  if (!x || !y) return '';
  const fmt = (m, v) => (m.pct ? pctText(v) : v.toFixed(1));
  const rows = STYLE_MARKERS.map((m, i) => {
    const match = markerMatch(them, you, m);
    return html`<tr><th scope="row">${m.label}</th><td>${fmt(m, x[i])}</td><td>${fmt(m, y[i])}</td><td title="${match == null ? 'Too rare to compare' : ''}">${match == null ? '–' : Math.round(match * 100)}</td></tr>`;
  });
  return html`<div class="table-wrap"><table class="vs style-table">
    <thead><tr><th></th><th scope="col">You</th><th scope="col">Them</th><th scope="col">Match</th></tr></thead>
    <tbody>${rows}<tr class="style-total"><th scope="row">Style match</th><td></td><td></td><td>${styleMatch(them, you) ?? '–'}</td></tr></tbody>
  </table></div>`;
}
