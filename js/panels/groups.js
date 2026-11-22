/* The Groups tab: who talks most in group chats, and how much of it is group chat. */

Panels.register({
  id: 'groups',
  tab: 'sec-groups',
  topics: ['data', 'selection', 'theme'],
  render(ctx) {
    const { ui } = ctx;
    const A = ctx.agg();
    if (!A.group) return;
    const rows = [...A.groupSenders.entries()]
      .map(([x, n]) => ({ label: senderLabel(x), n, you: x === 'You' }))
      .sort((a, b) => b.n - a.n)
      .slice(0, 20);
    Charts.set('c-groupsenders', rows.some((r) => !r.you) ? groupSendersOption(ui, rows) : emptyOption(ui, 'Senders are unknown for these group messages'));
    ctx.put('c-groupshare', () => groupShareOption(ui, A));
  },
});
