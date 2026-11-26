/* Searchable conversation pickers (spec 012), with Tom Select; plain dropdowns when it didn't load. */

/**
 * Puts what a picker searches and draws on a conversation's <option> as data-*
 * attributes, which Tom Select reads as option fields. The option's text stays the
 * plain-dropdown label (R6).
 */
function pickerOption(c, text, count, words) {
  const opt = new Option(text, c.key);
  const sources = Data.keySources(c.key);
  const name = contactName(c);
  Object.assign(opt.dataset, {
    search: c.search || name.toLowerCase(),
    name,
    sources: sources.join(','),
    kind: c.person ? 'person' : c.group ? 'group' : '',
    count,
    aria: [name, ...sources.map((s) => sourceName(s)), words].filter(Boolean).join(', '),
  });
  return opt;
}

/**
 * One picker row, and the picked item in the closed picker: logos, name, count (R7, R8).
 * A linked person's several logos already say it's joined, so it has no 🔗.
 */
function pickerRowHtml(d) {
  if (!d.name) return String(html`<div>${d.text}</div>`); // "Choose a conversation…"
  const logos = d.sources ? d.sources.split(',').map((s) => logoSvg(+s)) : [];
  const mark = (m) => html`<span class="pick-mark" aria-hidden="true">${m}</span>`;
  return String(html`<div class="pick-row" aria-label="${d.aria || d.name}">${logos.length ? html`<span class="pick-logos">${logos}</span>` : ''}${d.kind === 'group' ? mark('👥') : ''}<span class="pick-name">${d.name}</span>${d.count ? html`<span class="pick-count">${d.count}</span>` : ''}</div>`);
}

/** Makes a <select> searchable with Tom Select; null (a plain dropdown) when the library didn't load (R6). */
function makePicker(sel, opts = {}) {
  if (typeof TomSelect === 'undefined') return null;
  const ts = new TomSelect(sel, {
    // The search box sits at the top of the open list, so the closed picker keeps
    // showing the picked conversation instead of mixing it with what's typed.
    plugins: ['dropdown_input'],
    searchField: ['search'],
    maxOptions: null,
    refreshThrottle: 100, // ms after a key before the list filters (300 by default felt slow)
    closeAfterSelect: true,
    // "All conversations" always stays first (R2). Then conversations whose own name
    // matches come before ones found only by a member, number or handle (R1), so
    // "matt" puts Matt above group chats they're in. Within each, results keep the list's
    // own order (most messages first): Tom Select breaks score ties by that order.
    score(query) {
      const match = this.getScoreFunction(query);
      return (item) => {
        if (item.value === 'all') return 3;
        if (!(match(item) > 0)) return 0;
        return item.name && match({ search: item.name }) > 0 ? 2 : 1;
      };
    },
    render: { option: pickerRowHtml, item: pickerRowHtml, no_results: () => '<div class="no-results">No conversations match</div>' },
    ...opts,
  });
  ts.control_input.placeholder = 'Search by name, number or member';
  // With dropdown_input the control is the combobox. A <label for> names it (Tom Select
  // links that up); a select named by aria-label needs its name copied across.
  if (sel.hasAttribute('aria-label') && !ts.focus_node.hasAttribute('aria-labelledby')) {
    ts.focus_node.setAttribute('aria-label', sel.getAttribute('aria-label'));
  }
  // Each opening starts a new search. Tom Select ignores clicks on the picker while
  // its search box has text, so a leftover search would also keep it from reopening.
  // A search still waiting out refreshThrottle would reopen the list, so drop it too.
  ts.on('dropdown_close', () => {
    clearTimeout(ts.refreshTimeout);
    ts.refreshTimeout = null;
    ts.setTextboxValue('');
  });
  // In a dialog the list takes up room (see styles.css), so bring all of it into view.
  if (sel.closest('dialog')) ts.on('dropdown_open', () => ts.dropdown.scrollIntoView({ block: 'nearest' }));
  // Typing on the closed picker opens it, and the key lands in the search box (R9).
  ts.control.addEventListener('keydown', (e) => {
    if (!ts.isOpen && e.key.length === 1 && e.key !== ' ' && !e.ctrlKey && !e.metaKey && !e.altKey) ts.open();
  });
  // Tom Select moves the picked <option> to the end of the <select>, which would
  // reorder the plain list. One value is all a single picker needs to write back.
  ts.updateOriginalInput = (o = {}) => {
    sel.value = ts.items[0] ?? '';
    if (ts.isSetup && !o.silent) ts.trigger('change', ts.getValue());
  };
  return ts;
}

/** Re-reads a picker's <option>s after they were rebuilt. */
function refreshPicker(sel) {
  const ts = sel.tomselect;
  if (!ts) return;
  const value = sel.value;
  ts.clear(true);
  ts.clearOptions();
  ts.sync();
  ts.setValue(value, true);
}

/**
 * Sets a picker's value without a change event. Skips a picker that already shows it
 * (it was just picked there): setting it again would reopen the list.
 */
function setPickerValue(sel, value) {
  sel.value = value;
  if (sel.tomselect && sel.tomselect.getValue() !== value) sel.tomselect.setValue(value, true);
}
