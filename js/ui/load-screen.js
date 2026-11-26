/*
 * The loading screen (spec 016): draws createLoadStats' snapshot once per animation
 * frame while files load. The loader reports to it through LoadScreen.step/beginRead/
 * startJob/progress/batch/endJob; nothing here touches the data.
 */

const LOAD_STEP_TEXT = {
  demo: () => 'Making up a few years of messages',
  check: () => 'Checking files',
  read: (d) => `Reading ${d}`,
  merge: (d) => `Sorting ${d} messages`,
  owners: () => "Working out who's you",
  draw: () => 'Drawing the dashboard',
};

const LOAD_COUNTS = [
  { key: 'messages', label: 'Messages', always: true },
  { key: 'calls', label: 'Calls' },
  { key: 'conversations', label: 'Conversations' },
  { key: 'media', label: 'Photos & videos' },
  { key: 'reactions', label: 'Reactions' },
  { key: 'dupes', label: 'Duplicates skipped' },
];

const FILE_STATE_TEXT = { waiting: 'Waiting', reading: 'Reading', done: 'Done', failed: "Couldn't read" };

/** A beat for the page to draw before going on (R9). Doesn't wait when the page is hidden. */
function nextFrame() {
  if (document.hidden) return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(resolve, 100); // a frame that never comes (the tab was hidden meanwhile)
    requestAnimationFrame(() => setTimeout(() => { clearTimeout(t); resolve(); }, 0));
  });
}

/** "3.4 s", "1 min 12 s". */
function fmtSeconds(ms) {
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  return `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
}

/** "about 12 s left", "about 3 min left". */
function fmtLeft(ms) {
  const s = ms / 1000;
  return s < 90 ? `about ${Math.max(1, Math.round(s))} s left` : `about ${Math.round(s / 60)} min left`;
}

/** A month index (year * 12 + month) as "Mar 2016". */
const fmtMonthIndex = (mo) => fmtDate.monthShort(new Date(Math.floor(mo / 12), mo % 12, 1));

const LoadScreen = {
  stats: null,
  active: false,
  raf: 0,
  draws: 0, // for spec 016 AC15
  last: null, // the last snapshot drawn, kept after the load for tests
  shown: {}, // counts as last drawn (they count up towards the snapshot's)
  drawn: {}, // text last written, by element, so unchanged text isn't written again
  fileSig: '',
  foundN: -1,
  monthsSig: '',

  get reduced() { return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches; },
  now: () => performance.now(),

  /** Start the screen for a load: `demo` makes it first, `check` detects file types (R8). */
  start({ demo = false, check = true } = {}) {
    if (this.active) return;
    const steps = [...(demo ? ['demo'] : []), ...(check ? ['check'] : []), 'read', 'merge', 'owners', 'draw'];
    this.stats = createLoadStats({ steps, now: this.now() });
    this.active = true;
    this.shown = {};
    this.drawn = {};
    this.fileSig = '';
    this.foundN = -1;
    this.monthsSig = '';
    this.accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#2a78d6';
    $('#loadFound').replaceChildren();
    $('#loadFiles').replaceChildren();
    $('#loadSegs').replaceChildren();
    this.drawSteps(this.stats.snapshot(this.now()));
    const frame = () => {
      if (!this.active) return;
      this.draw();
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  },

  /** The load is over: draw where it ended, counts at their values, and stop. */
  stop() {
    if (!this.active) return;
    this.stats.end(this.now());
    this.active = false;
    cancelAnimationFrame(this.raf);
    this.draw({ final: true });
  },

  /** Move to a step. Its line is written now, so a step shorter than a frame still shows (R2). */
  step(id, detail = '') {
    if (!this.active) return;
    this.stats.step(id, detail, this.now());
    this.put($('#loadStep'), LOAD_STEP_TEXT[id](detail));
  },

  /** Reading starts on Files.loaded `entries`, on top of what Data already holds. */
  beginRead(entries) {
    if (!this.active) return;
    const files = entries.map((e) => ({ file: e.file, name: e.name, size: e.size, s: Sources.list.find((src) => src.kind === e.kind)?.id ?? 0 }));
    this.stats.beginRead(files, { msgs: Data.msgs, calls: Data.calls, reactions: Data.reactions }, this.now());
  },
  startJob(i, files) { if (this.active) this.stats.startJob(i, files, this.now()); },
  progress(i, loaded, total) { if (this.active) this.stats.progress(i, loaded, total, this.now()); },
  batch(i, res, found) {
    if (this.active) this.stats.batch(i, { msgs: Data.msgs, calls: Data.calls, reactions: Data.reactions }, res, found, this.now());
  },
  /** Job `i` is over; `at` is when its worker finished, if that was before now. */
  endJob(i, error, at = this.now()) { if (this.active) this.stats.endJob(i, { error }, at); },

  /** Write `text` into `el` if it isn't there already. */
  put(el, text) {
    if (el.textContent !== text) el.textContent = text;
  },

  /** Draw the current snapshot; `final` (the load is over) shows the counts' values without counting up. */
  draw({ final = false } = {}) {
    const snap = this.stats.snapshot(this.now());
    if (!final) this.draws++; // the frame loop's draws (spec 016 AC15)
    this.last = snap;
    this.final = final;

    // The current step (R2). Only its text is in the live region, so only it is announced.
    this.put($('#loadStep'), snap.step ? LOAD_STEP_TEXT[snap.step](snap.detail) : 'Starting…');

    this.drawFiles(snap);
    this.put($('#loadPct'), `${Math.floor(snap.pct)}%`);
    this.drawCounts(snap);

    // Speed and time (R5).
    const speed = [];
    if (snap.step === 'read' && snap.bps != null) {
      speed.push(`${fmtBytes(snap.bps)}/s`);
      if (snap.mps != null) speed.push(`${fmtNum(snap.mps)} messages/s`);
    }
    speed.push(`${fmtSeconds(snap.elapsed)} elapsed`);
    if (snap.left != null) speed.push(fmtLeft(snap.left));
    this.put($('#loadSpeed'), speed.join(' · '));

    this.drawTimeline(snap);
    this.drawFound(snap);
    this.drawSteps(snap);
  },

  /** Bar segments and file rows (R3, R7): built when the files change, updated in place after. */
  drawFiles(snap) {
    const sig = snap.files.map((f) => `${f.name}|${f.size}`).join('\n');
    const segs = $('#loadSegs');
    const list = $('#loadFiles');
    if (sig !== this.fileSig) {
      this.fileSig = sig;
      segs.replaceChildren();
      list.replaceChildren();
      for (const f of snap.files) {
        const seg = document.createElement('div');
        seg.className = 'load-seg';
        seg.style.cssText = `${appColor(f.s)}; flex-grow: ${Math.max(f.size, 1)}`;
        seg.title = f.name;
        seg.innerHTML = '<div class="load-fill"></div>';
        segs.appendChild(seg);
        const li = document.createElement('li');
        li.className = 'load-file';
        li.innerHTML = html`${logoSvg(f.s)}<span class="load-file-name"></span><span class="load-file-size">${fmtBytes(f.size)}</span><span class="load-file-state"></span>`;
        li.querySelector('.load-file-name').textContent = f.name;
        list.appendChild(li);
      }
    }
    snap.files.forEach((f, i) => {
      const fill = segs.children[i]?.firstChild;
      if (fill) fill.style.width = `${(f.state === 'done' ? 1 : f.frac) * 100}%`;
      const li = list.children[i];
      if (!li) return;
      li.dataset.state = f.state;
      let text = FILE_STATE_TEXT[f.state];
      if (f.state === 'reading') text += ` ${Math.floor(f.frac * 100)}%`;
      if (f.state === 'done') {
        const parts = [];
        if (f.msgs) parts.push(`${fmtNum(f.msgs)} messages`);
        if (f.calls) parts.push(`${fmtNum(f.calls)} calls`);
        // Files read together added their messages together: say so, not that each added them all.
        const from = parts.length && f.shared > 1 ? ` from these ${f.shared} files` : '';
        text = `${parts.join(', ') || 'Done'}${from} · ${fmtSeconds(f.ms)}`;
      }
      this.put(li.querySelector('.load-file-state'), text);
    });
  },

  /** Live counts (R4): each appears once it's above zero, and counts up to its value. */
  drawCounts(snap) {
    const box = $('#loadCounts');
    if (!box.children.length) {
      box.innerHTML = html`${LOAD_COUNTS.map((c) => html`<div class="load-count" data-count="${c.key}" hidden><dt>${c.label}</dt><dd>0</dd></div>`)}`;
    }
    const jump = this.final || this.reduced;
    for (const c of LOAD_COUNTS) {
      const target = snap.counts[c.key];
      const el = box.querySelector(`[data-count="${c.key}"]`);
      el.hidden = !c.always && !target;
      let v = this.shown[c.key] ?? 0;
      v = jump || Math.abs(target - v) < 2 ? target : v + (target - v) * 0.3;
      this.shown[c.key] = v;
      this.put(el.lastChild, fmtNum(v));
    }
  },

  /** Messages per month (R6), redrawn only when the counts change. */
  drawTimeline(snap) {
    const sig = `${snap.counts.messages}|${snap.first}|${snap.last}`;
    if (sig === this.monthsSig) return;
    this.monthsSig = sig;
    const canvas = $('#loadTimeline');
    const cap = $('#loadRange');
    if (snap.first == null) {
      this.put(cap, '');
      canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    this.put(cap, snap.first === snap.last ? fmtMonthIndex(snap.first) : `${fmtMonthIndex(snap.first)} – ${fmtMonthIndex(snap.last)}`);
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    const n = snap.last - snap.first + 1;
    let max = 1;
    for (const v of snap.months.values()) if (v > max) max = v;
    const bw = w / n;
    const gap = bw > 4 * dpr ? dpr : 0;
    ctx.fillStyle = this.accent;
    for (const [mo, v] of snap.months) {
      const bh = Math.max(dpr, (v / max) * h);
      ctx.fillRect((mo - snap.first) * bw, h - bh, Math.max(dpr, bw - gap), bh);
    }
  },

  /**
   * Conversations found (R15), newest first. Only new names are added, so the ones on
   * screen don't fade in again. Names go in as text, never markup.
   */
  drawFound(snap) {
    if (snap.foundN === this.foundN) return;
    this.foundN = snap.foundN;
    const list = $('#loadFound');
    const shown = new Set([...list.children].map((li) => li.found));
    for (let i = snap.found.length - 1; i >= 0; i--) {
      const c = snap.found[i];
      if (shown.has(c)) continue;
      const li = document.createElement('li');
      li.found = c;
      li.innerHTML = String(logoSvg(c.s));
      const name = document.createElement('span');
      name.textContent = c.name || 'Unknown';
      name.title = name.textContent; // the whole name, when a long one is cut short
      li.append(name);
      list.prepend(li);
    }
    const keep = new Set(snap.found);
    for (const li of [...list.children]) if (!keep.has(li.found)) li.remove();
  },

  drawSteps(snap) {
    const list = $('#loadSteps');
    const ids = snap.steps.map((x) => x.id).join();
    if (list.dataset.ids !== ids) {
      list.dataset.ids = ids;
      list.innerHTML = html`${snap.steps.map((x) => html`<li data-step="${x.id}"><span class="load-step-label">${x.label}</span><span class="load-step-ms"></span></li>`)}`;
    }
    snap.steps.forEach((x, i) => {
      const li = list.children[i];
      li.dataset.state = x.state;
      this.put(li.lastChild, x.ms == null ? '' : fmtSeconds(x.ms));
    });
  },
};
