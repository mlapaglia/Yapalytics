/* The Messages tab: the message list, with mood scores, reactions, shares and app switches. */

/** What the list shows, for explaining a mood pill: the messages, and how many have a score per month and side. */
const Shown = { msgs: [], moodScored: null };

/** 'pos' | 'neg' | 'neu' for a message by the chosen scorer, or null when it has no score. */
function moodKind(m) {
  const s = moodSign(m, View.moodScorer);
  return s == null ? null : s > 0 ? 'pos' : s < 0 ? 'neg' : 'neu';
}

const MOOD_WORD = { pos: 'positive', neg: 'negative', neu: 'neutral' };

const fmtScore = (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(2);

/** messageLib with VADER, for explaining scores on the page (built on first use). */
const moodLib = () => (moodLib.lib = moodLib.lib || messageLib(vaderLib()));

/** Whether a message is one of those picked on the mood chart. */
function moodMatches(m, f) {
  if (m.mo !== f.mo || (f.o != null && m.o !== f.o)) return false;
  const k = moodKind(m);
  if (!k) return false;
  return f.kind === 'any' ? k !== 'neu' : k === f.kind;
}

function moodFilterLabel(f) {
  const kind = { pos: 'Positive', neg: 'Negative', any: 'Positive and negative' }[f.kind];
  const who = f.o === 1 ? ' you sent' : f.o === 0 ? ' you received' : '';
  return `${kind} messages${who} · ${monthName(monthToTs(f.mo))}`;
}

/** From the mood chart: list that month's positive or negative messages, and go there. */
function showMoodMessages(mo, o, kind) {
  View.browser.mood = { mo, o, kind };
  View.browser.limit = 200;
  View.browser.showMood = true;
  $('#moodChk').checked = true;
  renderBrowser(Select.range());
  Tabs.select('sec-messages');
}

/** Why a message scored as it did, and what it did to its month's bar. */
function moodWhyHtml(m) {
  const kind = moodKind(m);
  const n = (Shown.moodScored && Shown.moodScored.get(`${m.mo}|${m.o}`)) || 1;
  const month = monthName(monthToTs(m.mo));
  const whose = m.o ? 'you sent' : 'you received';
  const word = MOOD_WORD[kind];
  const effect = kind === 'neu'
    ? `Neutral, so it's in neither bar: one of the ${fmtNum(n)} messages ${whose} in ${month} with a mood score, it makes both bars a little shorter.`
    : `One of the ${fmtNum(n)} messages ${whose} in ${month} with a mood score: worth about ${(100 / n).toFixed(1)} points of the ${word} bar.`;
  if (View.moodScorer === 'ai') {
    // The model's three probabilities (spec 001, R9), with VADER's score to compare.
    const pct = (x) => Math.round(x * 100) + '%';
    const [neg, neu, pos] = m.ai;
    return html`<div class="mood-why">
    <div><b>${fmtScore(moodScore(m, 'ai'))} ${word}.</b> ${effect}</div>
    <div class="mood-words"><span class="mw pos">positive <b>${pct(pos)}</b></span><span class="mw">neutral <b>${pct(neu)}</b></span><span class="mw neg">negative <b>${pct(neg)}</b></span><span class="mw">VADER <b>${fmtScore(m.v)}</b></span></div>
    <div class="mood-note">How sure the AI model is of each reading. It takes the likeliest one; the score is positive minus negative.</div>
  </div>`;
  }
  const e = moodLib().explainMood(m.b);
  const fmtV = (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1);
  const words = e ? [...e.words].sort((a, b) => Math.abs(b.valence) - Math.abs(a.valence)) : [];
  const chips = words.map((w) => html`<span class="mw ${w.valence > 0 ? 'pos' : 'neg'}">${w.word} <b>${fmtV(w.valence)}</b>${w.lexicon !== w.valence ? html` <span class="was">was ${fmtV(w.lexicon)}</span>` : ''}</span>`);
  if (e && e.emphasis) chips.push(html`<span class="mw ${e.emphasis > 0 ? 'pos' : 'neg'}">! ? emphasis <b>${fmtV(e.emphasis)}</b></span>`);
  return html`<div class="mood-why">
    <div><b>${fmtScore(m.v)} ${word}.</b> ${effect}</div>
    ${chips.length ? html`<div class="mood-words">${chips}</div>` : html`<div class="mood-note">No words from VADER’s dictionary, so it scored 0.</div>`}
    <div class="mood-note">Each word's value (after “not”, “very”, ALL CAPS and “but”) adds up and is squeezed into −1…+1. +0.05 or more counts as positive, −0.05 or less as negative.</div>
  </div>`;
}

function initMoodDetails() {
  $('#moodChk').onchange = (e) => {
    View.browser.showMood = e.target.checked;
    renderBrowser(Select.range());
  };
  $('#igPreviewsChk').checked = Prefs.igPreviews;
  $('#igPreviewsChk').onchange = (e) => {
    Prefs.saveIgPreviews(e.target.checked);
    renderBrowser(Select.range());
  };
  $('#browserFilter').onclick = (e) => {
    if (!e.target.closest('[data-clear-mood]')) return;
    View.browser.mood = null;
    renderBrowser(Select.range());
  };
  $('#messages').addEventListener('click', (e) => {
    const pill = e.target.closest('.mood-pill');
    if (!pill) return;
    const bubble = pill.closest('.bubble');
    const open = bubble.querySelector('.mood-why');
    if (open) { open.remove(); return; }
    bubble.insertAdjacentHTML('beforeend', String(moodWhyHtml(Shown.msgs[+pill.dataset.i])));
  });
}

/** Reactions on a message (spec 004): one chip per emoji, with who reacted on hover. */
function reactionsRow(m) {
  const row = document.createElement('div');
  row.className = 'reactions';
  const me = hasOwner(m.s) && Prefs.owners[m.s].name;
  for (const x of m.rx) {
    const names = x.n.map((n) => (n === me ? 'You' : n));
    const more = x.c - names.length;
    const chip = document.createElement('span');
    chip.className = 'rx';
    chip.textContent = x.r;
    if (x.c > 1) {
      const n = document.createElement('b');
      n.textContent = fmtNum(x.c);
      chip.appendChild(n);
    }
    const who = names.length ? names.join(', ') + (more > 0 ? ` and ${fmtNum(more)} more` : '') : `${fmtNum(x.c)} ${x.c === 1 ? 'person' : 'people'}`;
    chip.title = `${x.r} ${who}`;
    chip.setAttribute('aria-label', `Reacted ${x.r} by ${who}`);
    row.appendChild(chip);
  }
  return row;
}

function renderBrowser(msgs) {
  const q = View.browser.query.trim().toLowerCase();
  const mood = View.browser.mood;
  const has = (s) => s && s.toLowerCase().includes(q);
  let list = q ? msgs.filter((m) => has(m.b) || (m.sh && (has(m.sh.x) || has(m.sh.w)))) : msgs;
  if (mood) list = list.filter((m) => moodMatches(m, mood));
  const start = Math.max(0, list.length - View.browser.limit);
  const shown = list.slice(start);
  const box = $('#messages');
  resetMessageMedia(box);
  box.innerHTML = '';
  $('#browserCount').textContent = `${fmtNum(list.length)} message${list.length === 1 ? '' : 's'}${q || mood ? ' matching' : ''} · showing latest ${fmtNum(shown.length)}`;
  $('#moreBtn').hidden = start === 0;
  const chip = $('#browserFilter');
  chip.hidden = !mood;
  if (mood) chip.innerHTML = html`<span>${moodFilterLabel(mood)}</span><button class="btn small ghost" type="button" data-clear-mood aria-label="Show all messages">✕</button>`;
  // Messages with a mood score per month and side: what one message is worth in the chart.
  if (View.browser.showMood) {
    Shown.moodScored = new Map();
    for (const m of msgs) if (moodSign(m, View.moodScorer) != null) Shown.moodScored.set(`${m.mo}|${m.o}`, (Shown.moodScored.get(`${m.mo}|${m.o}`) || 0) + 1);
  }
  Shown.msgs = shown;

  const frag = document.createDocumentFragment();
  const showWho = View.filter.contact === 'all' || View.filter.contact.startsWith('g:') || View.filter.contact.startsWith('p:');
  // Spec 010: a linked person's app edges, and switch markers when the list is the whole conversation.
  const appEdges = View.filter.contact.startsWith('p:') && View.filter.source === 'all';
  const marks = appEdges && !q && !mood ? appSwitchMarks(list, View.appsGap) : null;
  let lastDay = null;
  shown.forEach((m, j) => {
    if (m.d !== lastDay) {
      lastDay = m.d;
      const sep = document.createElement('div');
      sep.className = 'day-sep';
      sep.textContent = dayLabel(m.d);
      frag.appendChild(sep);
    }
    const mark = marks && marks.get(start + j);
    if (mark) frag.appendChild(appSwitchMarker(mark, m.k));
    const row = document.createElement('div');
    row.className = 'msg ' + (m.o ? 'sent' : 'recv') + (appEdges ? ` app-edge app-${m.s || 0}` : '');
    if (appEdges) row.style.cssText = appColor(m.s);
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    const sender = !m.o && m.k.startsWith('g:') && (m.sn || m.sk) ? senderLabel(m.sn || m.sk) : '';
    const via = m.tk ? sourceName(m.s) : ''; // a linked person's messages say which app (spec 005 R7)
    if (showWho && (View.filter.contact === 'all' || sender || via)) {
      const who = document.createElement('div');
      who.className = 'who';
      if (View.filter.contact !== 'all') who.textContent = sender || via;
      else if (sender) who.textContent = `${sender} · ${labelFor(m.k)}`;
      else who.textContent = (m.o ? 'To ' : 'From ') + labelFor(m.k) + (via ? ` · ${via}` : '');
      bubble.appendChild(who);
    }
    if (m.b) {
      const body = document.createElement('div');
      body.className = 'body';
      body.textContent = m.b;
      bubble.appendChild(body);
    }
    if (m.att) bubble.appendChild(messageAttachments(m));
    if (m.sh) bubble.appendChild(shareCard(m.sh, Prefs.igPreviews));
    if (m.rx) bubble.appendChild(reactionsRow(m));
    // Sources without attachment references only know how many there were.
    const att = [];
    if (!m.att) {
      if (m.ph) att.push(`📷 ${m.ph > 1 ? m.ph + ' photos' : 'Photo'}`);
      if (m.gf) att.push(`🎞️ ${m.gf > 1 ? m.gf + ' GIFs' : 'GIF'}`);
      if (m.vd) att.push(`🎬 ${m.vd > 1 ? m.vd + ' videos' : 'Video'}`);
      if (m.au) att.push(`🎤 ${m.au > 1 ? m.au + ' audio clips' : 'Audio'}`);
      if (m.ot) att.push(`📎 ${m.ot > 1 ? m.ot + ' files' : 'File'}`);
    }
    if (att.length) {
      const a = document.createElement('div');
      a.className = 'att';
      a.textContent = att.join('  ');
      bubble.appendChild(a);
    }
    const time = document.createElement('div');
    time.className = 'time';
    const kind = View.browser.showMood && moodKind(m);
    if (kind) {
      const score = fmtScore(moodScore(m, View.moodScorer));
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = `mood-pill ${kind}`;
      pill.dataset.i = j;
      pill.textContent = score;
      pill.title = `Mood score ${score} (${MOOD_WORD[kind]}). Click to see why.`;
      time.appendChild(pill);
    }
    time.append(new Date(m.t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }));
    bubble.appendChild(time);
    row.appendChild(bubble);
    frag.appendChild(row);
  });
  box.appendChild(frag);
  scrollBrowserToEnd();
}

/** Spec 010 R2/R9: the divider where a linked person's conversation moves to another app. */
function appSwitchMarker({ from, to, o }, key) {
  const name = plainName(key);
  // A first name reads best; a number or email is kept whole.
  const them = /[\d@]/.test(name) ? name : name.split(' ')[0];
  const who = o ? 'You moved' : `${them} moved`;
  const el = document.createElement('div');
  el.className = 'app-switch';
  el.setAttribute('role', 'separator');
  el.setAttribute('aria-label', `Switched from ${sourceName(from)} to ${sourceName(to)}. ${who}.`);
  const app = (s) => html`<span class="app-dot app-${s}" style="${appColor(s)}"></span>${sourceName(s)}`;
  el.innerHTML = html`<span class="app-switch-pill"><span class="app-route">${app(from)} → ${app(to)}</span> · <span class="app-mover">${who}</span></span>`;
  return el;
}

/**
 * The message list scrolls inside its own box, which has no size while the Messages tab
 * is hidden (spec 003). Scrolling to the latest message waits until the tab is shown,
 * and leaving the tab keeps the place for when it comes back.
 */
const BrowserScroll = { pinEnd: false, top: 0, draws: 0 };

function scrollBrowserToEnd() {
  const box = $('#messages');
  BrowserScroll.draws++;
  BrowserScroll.pinEnd = box.offsetParent === null;
  if (!BrowserScroll.pinEnd) box.scrollTop = box.scrollHeight;
}

/** Tabs (spec 003): a section is about to be hidden. */
function onTabHidden(section) {
  if (section.id === 'sec-messages') BrowserScroll.top = $('#messages').scrollTop;
}

/** Tabs (spec 003): a section was just shown. Its panels draw first, so the list is there to scroll. */
function onTabShown(section, { again = false } = {}) {
  const draws = BrowserScroll.draws;
  Panels.showTab(section.id);
  if (again || section.id !== 'sec-messages') return;
  if (BrowserScroll.draws !== draws) return; // just drawn for this showing: it's on the latest message
  const box = $('#messages');
  box.scrollTop = BrowserScroll.pinEnd ? box.scrollHeight : BrowserScroll.top;
  BrowserScroll.pinEnd = false;
}

let searchTimer = null;
Panels.register({
  id: 'messages',
  tab: 'sec-messages',
  topics: ['data', 'selection', 'browser', 'scorer', 'appsGap'], // appsGap: where app-switch markers go (spec 010)
  render: (ctx) => renderBrowser(ctx.msgs()),
  init() {
    initMoodDetails();
    $('#search').oninput = (e) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => View.set({ browser: { query: e.target.value, limit: 200 } }), 200);
    };
    $('#moreBtn').onclick = () => {
      const box = $('#messages');
      const fromBottom = box.scrollHeight - box.scrollTop;
      View.set({ browser: { limit: View.browser.limit + 500 } });
      box.scrollTop = box.scrollHeight - fromBottom;
    };
  },
});

