/*
 * Panels without a tab that every tab depends on: which sections and cards the selection
 * has anything for (so the tab bar and "Jump to…" list only those), and AI mood scoring,
 * which follows the selection whatever tab is open.
 */

/** What the selection has, in one cheap pass (no aggregation): group chats, apps, attachments. */
function selectionFacts(msgs) {
  let group = false;
  let media = false;
  const apps = new Set();
  for (const m of msgs) {
    if (!group && m.k.startsWith('g:')) group = true;
    if (!media && (m.ph || m.vd || m.gf || m.au || m.ot)) media = true;
    apps.add(m.s || 0);
  }
  return { group, media, apps };
}

Panels.register({
  id: 'sections',
  topics: ['data', 'selection'],
  render(ctx) {
    const { all } = ctx;
    const { contact, source } = View.filter;
    const facts = selectionFacts(ctx.msgs());
    for (const sel of ['#relCard', '#leaderCard', '#driftCard']) show(sel, all);
    $('#c-newpeople').closest('.card').hidden = !all;
    show('#distinctCard', !all);
    show('#sec-groups', facts.group);
    show('#sec-sources', all && source === 'all' && facts.apps.size > 1);
    // Across apps (spec 007): only for linked people with messages on 2+ apps here.
    const X = ctx.cross();
    show('#sec-apps', source === 'all' && (all ? X.total.n > 0 : X.people.has(contact)));
    show('#sec-wrapped', ctx.base().length > 0);
    show('#callsSection', Select.calls().length > 0);
    show('#galleryCard', facts.media);
  },
});

Panels.register({
  id: 'mood-scoring',
  topics: ['data', 'selection', 'scorer'],
  // AI mood (spec 001) scores only this selection: pick up whatever it doesn't cover yet.
  render: (ctx) => AiMood.selectionChanged(ctx.msgs()),
});
