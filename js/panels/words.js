/* The Words tab: message length, most used words, what sets a conversation apart, the word tracker and vocabulary. */

/** Vocabulary chart plus the new words of the picked month (the latest by default). */
function renderVocab(ui = currentTheme()) {
  const C = Select.content();
  const box = $('#vocabWords');
  const months = [...C.vocab.keys()].sort((a, b) => a - b);
  if (!months.length) {
    Charts.set('c-vocab', emptyOption(ui, 'No messages with words in this selection'));
    box.innerHTML = '';
    return;
  }
  // Default: the latest month that brought any new words.
  const latest = months.findLast((m) => C.vocabNew.get(m).some((x) => x.top.length)) ?? months[months.length - 1];
  const mo = months.includes(View.vocabMo) ? View.vocabMo : latest;
  Charts.set('c-vocab', vocabOption(ui, C, mo), { on: { 'zr:click': pickVocabMonth } });

  const fresh = C.vocabNew.get(mo);
  const col = (o, who) => {
    const { n, top } = fresh[o];
    const words = top.length
      ? top.map(([w, uses]) => html`<button type="button" class="vocab-chip" data-word="${w}" title="Track “${w}” in the Word tracker">${w}${uses > 1 ? html` <span class="muted">${fmtNum(uses)}</span>` : ''}</button>`)
      : html`<span class="muted">Nothing new</span>`;
    return html`<div class="vocab-col ${o ? 'sent' : 'recv'}">
      <div class="vocab-col-head"><b>${who}</b> · ${fmtNum(n)} new of ${fmtNum(C.vocab.get(mo)[o])} words</div>
      <div class="vocab-chips">${words}</div>
    </div>`;
  };
  const firstNote = mo === months[0] ? ' (the first month here, so every word counts as new)' : '';
  box.innerHTML = html`<div class="vocab-head"><b>New in ${new Date(monthToTs(mo)).toLocaleDateString(undefined, { year: 'numeric', month: 'long' })}</b>
    <span class="muted">Words each side used for the first time in this selection${firstNote}. Click the chart to pick a month, or a word to track it.</span></div>
    <div class="vocab-cols">${col(1, 'You')}${col(0, 'Them')}</div>`;
}

const PHRASE_IDEAS = ['lol', 'haha', 'love you', 'miss you', 'sorry', 'good morning', 'omw', '😂'];

/** The message around the phrase's first match, escaped, with the match highlighted. */
function phraseSnippet(body, re) {
  re.lastIndex = 0;
  const m = re.exec(body);
  if (!m) return html`${body}`;
  const at = m.index;
  const after = at + m[0].length;
  let start = Math.max(0, at - 60);
  let end = Math.min(body.length, after + 80);
  // Don't cut an emoji (a surrogate pair) in half.
  if (start > 0 && /[\uDC00-\uDFFF]/.test(body[start])) start--;
  if (end < body.length && /[\uDC00-\uDFFF]/.test(body[end])) end++;
  return html`${start ? '…' : ''}${body.slice(start, at)}<mark>${m[0]}</mark>${body.slice(after, end)}${end < body.length ? '…' : ''}`;
}

/** Who said it first, and each side's first use quoted. */
function phraseFirstsHtml(P, re) {
  const [them, you] = P.first;
  const name = (m) => (m.o ? 'You' : messageSender(m));
  let head;
  if (you && them) {
    const [a, b] = you.t <= them.t ? [you, them] : [them, you];
    head = html`<b>${name(a)}</b> said it first, ${fmtGap(b.t - a.t)} before ${a.o ? name(b) : 'you'}.`;
  } else {
    head = you ? 'Only you have said it.' : html`You've never said it. <b>${name(them)}</b> said it first.`;
  }
  const card = (m) => {
    const when = new Date(m.t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    const conv = labelFor(m.k);
    const where = m.k.startsWith('g:') ? `in ${conv}` : m.o ? `to ${conv}` : '';
    return html`<div class="phrase-first ${m.o ? 'sent' : 'recv'}">
      <div class="phrase-first-head"><b>${name(m)}</b> first said it · ${when}${where ? ` · ${where}` : ''}</div>
      <div class="phrase-quote">${phraseSnippet(m.b, re)}</div>
    </div>`;
  };
  return html`<p class="phrase-headline">${head}</p><div class="phrase-first-grid">${[you, them].filter(Boolean).map(card)}</div>`;
}

/** Word tracker: uses of View.phrase per month in the current selection, and who said it first. */
function renderPhrase(ui = currentTheme()) {
  const q = View.phrase.trim();
  $$('#phraseIdeas button').forEach((b) => b.classList.toggle('on', b.textContent === q));
  $$('#phraseGranSeg button').forEach((b) => b.classList.toggle('on', b.dataset.gran === View.phraseGran));
  const msgs = Select.range();
  const re = q && phraseRegex(q);
  const note = $('#phraseNote');
  const firsts = $('#phraseFirsts');
  const P = re && msgs.length ? aggregatePhrase(msgs, re) : null;
  const total = P ? P.uses[0] + P.uses[1] : 0;
  if (!total) {
    note.textContent = 'How often a word or phrase comes up over time, and who said it first';
    firsts.innerHTML = '';
    const why = !msgs.length ? 'No messages in this selection' : re ? `Nobody said “${q}” in this selection` : 'Type a word or phrase, or pick one above';
    Charts.set('c-phrase', emptyOption(ui, why));
    return;
  }
  const times = (n) => `${fmtNum(n)} time${n === 1 ? '' : 's'}`;
  note.textContent = `“${q}”: you said it ${times(P.uses[1])}, them ${times(P.uses[0])}`;
  const firstDay = msgs[0].d;
  const lastDay = msgs[msgs.length - 1].d;
  const gran = View.phraseGran === 'auto' ? autoGran(lastDay - firstDay) : View.phraseGran;
  Charts.set('c-phrase', phraseOption(ui, P, firstDay, lastDay, gran));
  firsts.innerHTML = phraseFirstsHtml(P, re);
}

/** A click anywhere on the Vocabulary plot picks the nearest month. */
function pickVocabMonth(e, chart) {
  const pt = [e.offsetX, e.offsetY];
  if (!chart.containPixel('grid', pt)) return;
  const d = new Date(chart.convertFromPixel({ gridIndex: 0 }, pt)[0] + 15 * DAY_MS);
  const keys = [...Select.content().vocab.keys()];
  const want = d.getFullYear() * 12 + d.getMonth();
  View.set({ vocabMo: keys.reduce((best, k) => (Math.abs(k - want) < Math.abs(best - want) ? k : best), keys[0]) });
}

/** Track a word or phrase: put it in the box and redraw the tracker. */
function trackPhrase(text) {
  $('#phraseInput').value = text;
  View.set({ phrase: text });
}

Panels.register({
  id: 'words',
  tab: 'sec-content',
  topics: ['data', 'selection', 'theme'],
  render(ctx) {
    const { ui } = ctx;
    const A = ctx.agg();
    ctx.put('c-length', () => lengthOption(ui, A));
    ctx.put('c-length-trend', () => lengthTrendOption(ui, A));
    const wd = wordsOption(ui, ctx.content());
    Charts.set('c-words', wd.empty ? emptyOption(ui, 'No words in this selection') : wd.opt);
  },
});

Panels.register({
  id: 'distinct',
  tab: 'sec-content',
  topics: ['data', 'selection', 'theme'],
  render(ctx) {
    if (ctx.all) return;
    const rows = ctx.none ? [] : distinctiveWords(ctx.msgs(), Select.docFreq());
    $('#distinctNote').textContent = `Words that set ${labelFor(View.filter.contact)} apart from your other conversations`;
    Charts.set('c-distinct', rows.length ? distinctiveOption(ctx.ui, rows) : emptyOption(ctx.ui, 'Not enough words to compare yet'));
  },
});

let phraseTimer = null;
Panels.register({
  id: 'phrase',
  tab: 'sec-content',
  topics: ['data', 'selection', 'phrase', 'theme'],
  render: (ctx) => renderPhrase(ctx.ui),
  init() {
    $('#phraseIdeas').innerHTML = html`${PHRASE_IDEAS.map((p) => html`<button type="button" class="btn small">${p}</button>`)}`;
    $('#phraseIdeas').onclick = (e) => {
      const b = e.target.closest('button');
      if (b) trackPhrase(b.textContent);
    };
    $('#phraseGranSeg').onclick = (e) => {
      const g = e.target.dataset.gran;
      if (g) View.set({ phraseGran: g });
    };
    $('#phraseInput').oninput = (e) => {
      clearTimeout(phraseTimer);
      phraseTimer = setTimeout(() => View.set({ phrase: e.target.value }), 250);
    };
  },
});

Panels.register({
  id: 'vocab',
  tab: 'sec-content',
  topics: ['data', 'selection', 'vocab', 'theme'],
  render: (ctx) => renderVocab(ctx.ui),
  init() {
    $('#vocabWords').onclick = (e) => {
      const b = e.target.closest('[data-word]');
      if (!b) return;
      trackPhrase(b.dataset.word);
      $('#phraseCard').scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
  },
});
