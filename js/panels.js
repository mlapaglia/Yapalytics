/*
 * Dashboard panels (spec 014 step 7). Each card, or group of cards drawn together, is a
 * panel: the tab it sits on, the topics it depends on, and how to draw it.
 *
 *   Panels.register({
 *     id: 'leaderboard', tab: 'sec-people', topics: ['data', 'selection', 'gap', 'leader'],
 *     init() { … wire its own controls, once … },
 *     render(ctx) { … ctx.agg(), ctx.ui … },
 *   });
 *
 * Something changes (View.set, a load, the theme): Panels.invalidate(topics) marks the
 * panels that depend on it, then draws the marked ones on screen — the open tab's, and
 * those with `tab: null` (filter bar, scope line, which tabs exist). The rest are drawn
 * when their tab opens (R9).
 *
 * Topics: 'data' (a load, owners, links), 'selection' plus 'filter.contact',
 * 'filter.source', 'filter.groups' and 'filter.dates', 'gap', 'appsGap', 'theme',
 * 'scorer', 'aiScores', and one per panel control ('gran', 'leader', 'calendar', 'otd',
 * 'phrase', 'vocab', 'wrapped', 'browser').
 */

/** The theme's colours (charts.js readTheme), read again only after the theme changes. */
let themeCache = null;
const currentTheme = () => (themeCache = themeCache || readTheme());

const Panels = {
  list: [],

  register(panel) {
    this.list.push({ tab: null, topics: [], dirty: true, ...panel });
  },

  /** Wire every panel's own controls. */
  init() {
    for (const p of this.list) p.init?.(this.ctx);
  },

  /**
   * Mark the panels that depend on any of `topics` ('*' for all) as out of date, and draw
   * those on screen. `except` lists panel ids to leave as they are (the timeline, when
   * its own zoom moved the dates).
   */
  invalidate(topics, { except = [] } = {}) {
    if (topics.includes('theme')) themeCache = null;
    for (const p of this.list) {
      if (except.includes(p.id)) continue;
      if (topics.includes('*') || p.topics.some((t) => topics.includes(t))) p.dirty = true;
    }
    this.flush();
  },

  /** Draw what's out of date and on screen; then let the tab bar catch up. */
  flush() {
    if ($('#dash').hidden) return;
    // Panels without a tab first: they decide which sections show, and so which tab is open.
    for (const p of this.list) if (p.dirty && p.tab == null) this.draw(p);
    Tabs.sync();
    for (const p of this.list) if (p.dirty && p.tab === Tabs.current) this.draw(p);
  },

  /** A tab was opened: draw what it has out of date. */
  showTab(id) {
    if ($('#dash').hidden) return;
    for (const p of this.list) if (p.dirty && p.tab === id) this.draw(p);
  },

  draw(p) {
    p.dirty = false;
    p.render(this.ctx);
  },

  /** What panels draw from. Everything comes from caches (Select), worked out on first use. */
  ctx: {
    get ui() { return currentTheme(); },
    base: () => Select.base(),
    msgs: () => Select.range(),
    agg: () => Select.agg(),
    content: () => Select.content(),
    cross: () => Select.cross(),
    /** "All conversations" is picked. */
    get all() { return View.filter.contact === 'all'; },
    /** Nothing in the selection. */
    get none() { return !Select.range().length; },
    /** Draw a chart, or the empty message when the selection has no messages. */
    put(id, fn, emptyText = 'No messages in this selection') {
      return Charts.set(id, this.none ? emptyOption(this.ui, emptyText) : fn());
    },
  },
};

/** A chart's placeholder text when there's nothing to draw. */
function emptyOption(ui, text) {
  return {
    graphic: { type: 'text', left: 'center', top: 'middle', style: { text, fill: ui.muted, fontSize: 13, fontFamily: FONT } },
  };
}

/** Topics each View field is part of (spec 014 step 7). */
const VIEW_TOPICS = {
  convoGap: ['gap'], appsGap: ['appsGap'], gran: ['gran'], moodScorer: ['scorer'], phrase: ['phrase'], phraseGran: ['phrase'],
  vocabMo: ['vocab'], calYear: ['calendar'], wrapYear: ['wrapped'], otd: ['otd'], leader: ['leader'], browser: ['browser'],
};
const FILTER_TOPICS = { contact: 'filter.contact', source: 'filter.source', groups: 'filter.groups', from: 'filter.dates', to: 'filter.dates' };

/**
 * Change what's picked and redraw what depends on it. `patch` holds View fields;
 * `filter`, `leader` and `browser` are merged into the existing objects. Picking another
 * selection starts the message list at the latest messages again.
 */
View.set = (patch, opts) => {
  const topics = new Set();
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'filter') {
      for (const [k, v] of Object.entries(value)) {
        if (View.filter[k] === v) continue;
        View.filter[k] = v;
        topics.add('selection').add(FILTER_TOPICS[k]);
      }
    } else if (key === 'leader' || key === 'browser') {
      Object.assign(View[key], value);
      for (const t of VIEW_TOPICS[key]) topics.add(t);
    } else {
      View[key] = value;
      for (const t of VIEW_TOPICS[key]) topics.add(t);
    }
  }
  if (topics.has('selection') && !(patch.browser && 'limit' in patch.browser)) {
    View.browser.limit = 200;
    topics.add('browser');
  }
  if (topics.size) Panels.invalidate([...topics], opts);
};
