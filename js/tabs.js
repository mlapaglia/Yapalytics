/*
 * Dashboard tabs (specs/003-dashboard-tabs.md): the dashboard shows one section at a
 * time, picked from a tab bar that stays under the filters, and "Jump to…" lists every
 * chart. Sections are the `.dash-section` elements in #dash, labelled by `data-tab`.
 * A section the code hides (`hidden`, e.g. Groups with no group chats) loses its tab.
 * The open tab is in the URL as `#/<data-slug>` (the `#/` keeps it from matching an
 * element id), so Back and Forward move between tabs.
 * Uses the app's $, $$, escapeHtml and renderLazyIn.
 */
const Tabs = {
  current: 'sec-glance',
  cards: [], // [{ el, sec, title }] for the jump menu, in page order

  sections() {
    return $$('#dash > .dash-section');
  },

  init() {
    const sections = this.sections();
    $('#tabList').innerHTML = sections
      .map((sec) => `<button type="button" role="tab" id="tab-${sec.id}" aria-controls="${sec.id}" data-panel="${sec.id}">${escapeHtml(sec.dataset.tab)}</button>`)
      .join('');
    for (const sec of sections) {
      sec.setAttribute('role', 'tabpanel');
      sec.setAttribute('aria-labelledby', `tab-${sec.id}`);
    }
    this.cards = sections.flatMap((sec) =>
      [...sec.querySelectorAll('article.card')].map((el) => ({ el, sec, title: el.querySelector('h2')?.textContent.trim() || '' })));

    $('#tabList').onclick = (e) => {
      const b = e.target.closest('[data-panel]');
      if (b) this.select(b.dataset.panel);
    };
    $('#tabList').onkeydown = (e) => this.onKey(e);
    $('#jumpSel').onchange = (e) => {
      const card = this.cards[+e.target.value];
      e.target.value = '';
      if (card) this.jump(card);
    };

    // The tab bar sticks under the filter bar, whose height changes as it wraps.
    const filters = $('#dash .filters');
    const nav = $('#dashTabs');
    const measure = () => {
      const dash = $('#dash');
      dash.style.setProperty('--filters-h', filters.offsetHeight + 'px');
      dash.style.setProperty('--tabs-h', nav.offsetHeight + 'px');
    };
    new ResizeObserver(measure).observe(filters);
    new ResizeObserver(measure).observe(nav);

    // Back / Forward, or a typed URL: open the tab it names (Overview if none or gone).
    window.addEventListener('popstate', () => {
      const sec = this.fromUrl();
      this.select(sec && !sec.hidden ? sec.id : 'sec-glance', { history: 'none' });
    });
    // Opened with a tab in the URL: it's selected once the data is loaded.
    this.select(this.fromUrl()?.id || this.current, { scroll: false, history: 'none' });
  },

  /** The section the URL names, or null. */
  fromUrl() {
    const m = /^#\/([\w-]+)$/.exec(location.hash);
    return (m && this.sections().find((sec) => sec.dataset.slug === m[1])) || null;
  },

  /**
   * Put the open tab in the URL: 'push' adds a history entry, 'replace' doesn't. Only
   * while the dashboard shows, so the landing page keeps a plain URL.
   */
  writeUrl(mode) {
    if ($('#dash').hidden) return;
    const hash = '#/' + document.getElementById(this.current).dataset.slug;
    if (location.hash === hash) return;
    if (mode === 'push') history.pushState(null, '', hash);
    else history.replaceState(null, '', hash);
  },

  /**
   * Show one section. `scroll` brings its top under the tab bar if the page is below it.
   * `history`: 'push' (a new entry, so Back returns here), 'replace' or 'none'.
   */
  select(id, { scroll = true, focus = false, history = 'push' } = {}) {
    const target = document.getElementById(id);
    if (!target || target.hidden || !target.classList.contains('dash-section')) return;
    this.current = id;
    if (history !== 'none') this.writeUrl(history);
    for (const sec of this.sections()) sec.classList.toggle('active', sec === target);
    renderLazyIn(target);
    for (const b of $$('#tabList [role="tab"]')) {
      const on = b.dataset.panel === id;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      if (on) {
        if (focus) b.focus();
        b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    }
    if (scroll) {
      const navBottom = $('#dashTabs').getBoundingClientRect().bottom;
      const gap = target.getBoundingClientRect().top - navBottom;
      if (gap < 0) window.scrollBy({ top: gap });
    }
  },

  /** Show a card's section and scroll the card into view. */
  jump({ el, sec }) {
    this.select(sec.id, { scroll: false });
    requestAnimationFrame(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  },

  /** Arrow keys, Home and End move between the tabs that are shown (ARIA tabs pattern). */
  onKey(e) {
    const tabs = $$('#tabList [role="tab"]').filter((b) => !b.hidden);
    const i = tabs.findIndex((b) => b.dataset.panel === this.current);
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (next == null) return;
    e.preventDefault();
    const b = tabs[(next + tabs.length) % tabs.length];
    // Arrowing across tabs replaces the entry, so Back doesn't step through each one.
    this.select(b.dataset.panel, { focus: true, history: 'replace' });
  },

  /**
   * After a redraw: hide the tabs of sections that have nothing to show, fall back to
   * Overview if the current one went away, and list the visible cards in "Jump to…".
   */
  sync() {
    for (const b of $$('#tabList [role="tab"]')) b.hidden = document.getElementById(b.dataset.panel).hidden;
    if (document.getElementById(this.current).hidden) this.select('sec-glance', { scroll: false, history: 'none' });
    // The first draw after loading data puts the tab in the URL; a fallback replaces it.
    this.writeUrl('replace');
    const groups = [];
    this.cards.forEach((c, i) => {
      if (c.sec.hidden || c.el.hidden || !c.title) return;
      let g = groups.at(-1);
      if (!g || g.sec !== c.sec) groups.push((g = { sec: c.sec, options: [] }));
      g.options.push(`<option value="${i}">${escapeHtml(c.title)}</option>`);
    });
    $('#jumpSel').innerHTML = '<option value="">Jump to…</option>' +
      groups.map((g) => `<optgroup label="${escapeHtml(g.sec.dataset.tab)}">${g.options.join('')}</optgroup>`).join('');
  },
};
