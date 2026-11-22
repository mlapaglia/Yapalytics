/* The AI analysis tab (spec 002): the card follows the selection; the transcript is built only while the tab is open. */

Panels.register({
  id: 'ai',
  tab: 'sec-ai',
  topics: ['data', 'selection'],
  render: () => AiAnalysis.render(),
});
