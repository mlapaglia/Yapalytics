/* The Media & links tab: attachments by kind and over time, the sites people share, and the attachments panel. */

Panels.register({
  id: 'media',
  tab: 'sec-media',
  topics: ['data', 'selection', 'theme'],
  render(ctx) {
    const { ui } = ctx;
    const A = ctx.agg();
    const anyMedia = MEDIA_TYPES.some((m) => A.media[m.key][0] + A.media[m.key][1]);
    Charts.set('c-media', anyMedia ? mediaOption(ui, A) : emptyOption(ui, 'No attachments in this selection'));
    Charts.set('c-media-trend', anyMedia ? mediaTrendOption(ui, A) : emptyOption(ui, 'No attachments in this selection'));
    const dm = domainsOption(ui, ctx.content());
    Charts.set('c-domains', dm.empty ? emptyOption(ui, 'No links in this selection') : dm.opt);
  },
});

Panels.register({
  id: 'gallery',
  tab: 'sec-media',
  topics: ['data', 'selection'],
  render(ctx) {
    if (!$('#galleryCard').hidden) renderGallery(ctx.msgs());
  },
});
