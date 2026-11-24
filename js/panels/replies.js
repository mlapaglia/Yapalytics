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
  },
});
