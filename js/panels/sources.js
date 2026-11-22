/* The Sources tab: each app's share of messages per month (with All conversations and every app). */

Panels.register({
  id: 'sources',
  tab: 'sec-sources',
  topics: ['data', 'selection', 'theme'],
  render(ctx) {
    if (!$('#sec-sources').hidden) Charts.set('c-platforms', platformMixOption(ctx.ui, ctx.agg(), sourceNames()));
  },
});
