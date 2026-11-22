/* The Replies tab: who sends what, reply times, conversations and habits, by the picked conversation gap. */

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
    $$('#gapSeg button').forEach((b) => b.classList.toggle('on', +b.dataset.gap === View.convoGap));
    const gapWords = fmtGapWords(View.convoGap);
    const ls = A.longestSession;
    $('#sessionNote').textContent = `A conversation ends after ${gapWords} of quiet` + (ls
      ? ` · Longest: ${fmtNum(ls.n)} messages over ${fmtDuration(ls.end - ls.start)} with ${labelFor(ls.k)} on ${fmtDate.day(ls.start)}`
      : '');
    $('#replyNote').textContent = `How quickly each side answers (within ${gapWords})`;
    $('#habitsNote').textContent = `Conversation starters (after ${fmtGapShort(View.convoGap)} of quiet), double texts and message traits`;
  },
  init() {
    $('#gapSeg').innerHTML = html`${CONVO_GAPS.map((g) => html`<button data-gap="${g}" title="A conversation ends after ${fmtGapWords(g)} of quiet"${g === View.convoGap ? raw(' class="on"') : ''}>${fmtGapShort(g)}</button>`)}`;
    $('#gapSeg').addEventListener('click', (e) => {
      const g = +e.target.dataset.gap;
      if (g) View.set({ convoGap: g });
    });
  },
});
