/* The Words tab: message length, most used words, what sets a conversation apart, the word tracker and vocabulary. */

/** Vocabulary chart plus the new words of the picked month (the latest by default). */
function renderVocab(ui = currentTheme()) {
  const C = Select.content();
  const box = $('#vocabWords');
  if (!C) {
    box.innerHTML = '';
    return Counting.chart('c-vocab', 'content', { 'zr:click': pickVocabMonth });
  }
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
  box.innerHTML = html`<div class="vocab-head"><b>New in ${fmtDate.month(monthToTs(mo))}</b>
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
    const when = fmtDate.day(m.t);
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
  const C = Select.content();
  if (!C) return;
  const keys = [...C.vocab.keys()];
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
  topics: ['data', 'selection', 'theme', 'content'],
  render(ctx) {
    const { ui } = ctx;
    const A = ctx.agg();
    ctx.put('c-length', () => lengthOption(ui, A));
    ctx.put('c-length-trend', () => lengthTrendOption(ui, A));
    const C = ctx.content();
    if (!C) return ctx.countingChart('c-words');
    const wd = wordsOption(ui, C);
    Charts.set('c-words', wd.empty ? emptyOption(ui, 'No words in this selection') : wd.opt);
  },
});

Panels.register({
  id: 'distinct',
  tab: 'sec-content',
  topics: ['data', 'selection', 'theme', 'content'],
  render(ctx) {
    if (ctx.all) return;
    const k = View.filter.contact;
    $('#distinctNote').textContent = `Words that set ${labelFor(k)} apart from your other conversations`;
    const df = ctx.none ? null : Select.docFreq();
    if (!ctx.none && !df) return ctx.countingChart('c-distinct', 'docFreq');
    const terms = df && Select.terms(k);
    if (df && !terms) return ctx.countingChart('c-distinct', Select.termsSlot(k));
    const rows = ctx.none ? [] : distinctiveWords(ctx.msgs(), df, 25, terms);
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
    $('#phraseIdeas').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (b) trackPhrase(b.textContent);
    });
    $('#phraseGranSeg').addEventListener('click', (e) => {
      const g = e.target.dataset.gran;
      if (g) View.set({ phraseGran: g });
    });
    $('#phraseInput').addEventListener('input', (e) => {
      clearTimeout(phraseTimer);
      phraseTimer = setTimeout(() => View.set({ phrase: e.target.value }), 250);
    });
  },
});

// ------------------------------------------------------------------ language patterns (spec 019)

/** A phrase or joke chip that tracks it in the Word tracker; `k` also picks that conversation. */
const trackChip = (term, n, k = null) => html`<button type="button" class="vocab-chip" data-word="${term}"${k ? html` data-k="${k}"` : ''} title="Track “${term}” in the Word tracker">${term}${n ? html` <span class="muted">${fmtNum(n)}</span>` : ''}</button>`;

/** Track a chip's phrase (R5, R9): for a joke from All conversations, in its conversation. */
function trackChipClick(e) {
  const b = e.target.closest('[data-word]');
  if (!b) return;
  if (b.dataset.k) {
    setPickerValue($('#contactSel'), b.dataset.k);
    View.set({ filter: { contact: b.dataset.k } });
  }
  trackPhrase(b.dataset.word);
  $('#phraseCard').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/** A phrases column's name: you, a conversation (a link to its profile) or a group member. */
function phrasePerson(P, id) {
  if (id === 'You') return 'You';
  return P.mode === 'group' ? html`${senderLabel(id)}` : personLink(id);
}

Panels.register({
  id: 'phrases',
  tab: 'sec-content',
  topics: ['data', 'selection', 'theme', 'content'],
  render(ctx) {
    const box = $('#phrasesBox');
    if (ctx.none) {
      box.innerHTML = html`<p class="muted">No messages in this selection</p>`;
      return;
    }
    $('#phrasesNote').textContent = `Phrases each person uses far more than everyone else here, ${PHRASE_MIN_USES}+ times on ${PHRASE_MIN_DAYS}+ days. Click one to track it.`;
    const C = ctx.content();
    if (!C) return ctx.countingBox('phrasesBox');
    const sig = signaturePhrases(C.phrases);
    box.innerHTML = html`<div class="people-cols">${sig.map(({ id, phrases }) => html`<div class="people-col ${id === 'You' ? 'sent' : 'recv'}">
      <div class="vocab-col-head"><b>${phrasePerson(C.phrases, id)}</b></div>
      <div class="vocab-chips">${phrases.length ? phrases.map((p) => trackChip(p.term, p.n)) : html`<span class="muted">Nothing stands out</span>`}</div>
    </div>`)}</div>`;
  },
  init() {
    $('#phrasesBox').addEventListener('click', trackChipClick);
  },
});

/** Who used a joke first, and when. */
const jokeFirst = (j) => `${j.first.o ? 'You' : momentSender(j.first)} · ${fmtDate.day(j.first.t)}`;

Panels.register({
  id: 'jokes',
  tab: 'sec-content',
  topics: ['data', 'selection', 'theme', 'content'],
  render(ctx) {
    const box = $('#jokesBox');
    const none = (text) => (box.innerHTML = html`<p class="muted">${text}</p>`);
    if (ctx.none) return none('No messages in this selection');
    const df = Select.docFreq();
    if (!ctx.all) {
      $('#jokesNote').textContent = `Words and phrases used ${JOKE_MIN_USES}+ times by both sides, on ${JOKE_MIN_DAYS}+ days over 2+ weeks, that hardly come up in your other conversations. Click one to track it.`;
      if (!df) return ctx.countingBox('jokesBox', 'docFreq');
      const k = View.filter.contact;
      const terms = Select.terms(k);
      if (!terms) return ctx.countingBox('jokesBox', Select.termsSlot(k));
      const jokes = insideJokes(terms, df);
      if (!jokes.length) return none('No inside jokes here yet');
      box.innerHTML = html`<div class="table-wrap"><table class="vs jokes-table">
        <thead><tr><th scope="col">Joke</th><th scope="col">Uses</th><th scope="col">First</th><th scope="col">Last used</th></tr></thead>
        <tbody>${jokes.map((j) => html`<tr><th scope="row">${trackChip(j.term)}</th><td>${fmtNum(j.n)}</td><td>${jokeFirst(j)}</td><td>${fmtDate.day(j.last)}</td></tr>`)}</tbody>
      </table></div>`;
      return;
    }
    $('#jokesNote').textContent = 'The top inside joke of each of your busiest conversations: used by both sides over weeks, and hardly anywhere else. Click one to track it there.';
    if (!df) return ctx.countingBox('jokesBox', 'docFreq');
    const keys = [...ctx.agg().byContact.entries()]
      .map(([k, bc]) => ({ k, n: bc.n[0] + bc.n[1] }))
      .filter((x) => x.n >= 200)
      .sort((a, b) => b.n - a.n)
      .slice(0, 8)
      .map(({ k }) => k);
    const terms = keys.map((k) => Select.terms(k)); // starts counting each, one after another
    const wait = terms.findIndex((t) => !t);
    if (wait >= 0) return ctx.countingBox('jokesBox', Select.termsSlot(keys[wait]));
    const rows = keys.map((k, i) => ({ k, joke: insideJokes(terms[i], df, 1)[0] })).filter((x) => x.joke);
    if (!rows.length) return none('No inside jokes found in your busiest conversations');
    box.innerHTML = html`<div class="table-wrap"><table class="vs jokes-table">
      <thead><tr><th scope="col">Conversation</th><th scope="col">Joke</th><th scope="col">Uses</th><th scope="col">Last used</th></tr></thead>
      <tbody>${rows.map(({ k, joke }) => html`<tr><th scope="row">${personLink(k)}</th><td>${trackChip(joke.term, 0, k)}</td><td>${fmtNum(joke.n)}</td><td>${fmtDate.day(joke.last)}</td></tr>`)}</tbody>
    </table></div>`;
  },
  init() {
    $('#jokesBox').addEventListener('click', trackChipClick);
  },
});

Panels.register({
  id: 'corrections',
  tab: 'sec-content',
  topics: ['data', 'selection', 'theme', 'content'],
  render(ctx) {
    const { ui } = ctx;
    const C = ctx.content();
    const box = $('#correctedWords');
    if (!C) {
      box.innerHTML = '';
      $('#correctionsNote').textContent = 'Messages like “*there” that fix a typo, per 1,000 messages';
      return ctx.countingChart('c-corrections');
    }
    const t = C.correctionsTotal;
    if (ctx.none || !(t[0] + t[1])) {
      Charts.set('c-corrections', emptyOption(ui, ctx.none ? 'No messages in this selection' : 'No corrections (*word) in this selection'));
      box.innerHTML = '';
      $('#correctionsNote').textContent = 'Messages like “*there” that fix a typo, per 1,000 messages';
      return;
    }
    $('#correctionsNote').textContent = `Messages like “*there” that fix a typo in the same person’s message just before, per 1,000 messages. You: ${fmtNum(t[1])} · Them: ${fmtNum(t[0])}`;
    Charts.set('c-corrections', correctionsOption(ui, C));
    const top = (o) => [...C.correctedWords[o]].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 5);
    const col = (o, who) => html`<div class="people-col ${o ? 'sent' : 'recv'}"><div class="vocab-col-head"><b>${who}</b> · most corrected</div>
      <div class="vocab-chips">${top(o).length ? top(o).map(([w, n]) => html`<span class="vocab-chip static">${w} <span class="muted">${fmtNum(n)}</span></span>`) : html`<span class="muted">None</span>`}</div></div>`;
    box.innerHTML = html`<div class="people-cols">${col(1, 'You')}${col(0, 'Them')}</div>`;
  },
});

Panels.register({
  id: 'languages',
  tab: 'sec-content',
  topics: ['data', 'selection', 'theme', 'content'],
  render(ctx) {
    const { ui } = ctx;
    const C = ctx.content();
    const list = $('#langConvos');
    list.innerHTML = '';
    if (!C) {
      $('#languagesNote').textContent = 'Messages by the language they’re in';
      return ctx.countingChart('c-languages');
    }
    const L = languageSummary(C);
    const unclear = C.langNone[0] + C.langNone[1];
    $('#languagesNote').textContent = L.total
      ? `Messages by the language they’re in, worked out in this browser from common words and alphabets. ${fmtNum(unclear)} were too short or unclear to tell.`
      : 'Messages by the language they’re in';
    if (ctx.none || !L.total) {
      Charts.set('c-languages', emptyOption(ui, ctx.none ? 'No messages in this selection' : 'No messages long enough to tell their language'));
      return;
    }
    if (L.single) Charts.set('c-languages', emptyOption(ui, `Everything here is in ${languageName(L.rows[0].code)}, as far as Yapalytics can tell`));
    else Charts.set('c-languages', languagesOption(ui, L.rows));
    if (!ctx.all) return;
    const convos = otherLanguageConversations(C, L.main);
    if (!convos.length) return;
    list.innerHTML = html`<p class="lang-head"><b>Conversations in other languages</b></p><ul class="lang-convos">${convos.map((x) => html`<li>${personLink(x.k)} <span class="muted">${x.langs.slice(0, 3).map(([code, n]) => `${languageName(code)} ${pctText(n / x.n)}`).join(' · ')}</span></li>`)}</ul>`;
  },
});

Panels.register({
  id: 'vocab',
  tab: 'sec-content',
  topics: ['data', 'selection', 'vocab', 'theme', 'content'],
  render: (ctx) => renderVocab(ctx.ui),
  init() {
    $('#vocabWords').addEventListener('click', (e) => {
      const b = e.target.closest('[data-word]');
      if (!b) return;
      trackPhrase(b.dataset.word);
      $('#phraseCard').scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  },
});
