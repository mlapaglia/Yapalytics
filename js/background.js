/*
 * Counting in slices (spec 028), so the page keeps drawing while words are counted.
 *
 * A job is a generator that yields how far it is (0–1) now and then and returns its
 * result. The runner advances it for `budget` ms, then lets the browser draw and handle
 * input before going on. Each slot ('content', 'docFreq', 'terms:<key>') holds one job:
 * starting one with another key drops the one there, which is never resumed. Jobs run one
 * at a time, in the order they were started.
 */
const Background = {
  budget: 30, // ms of counting per slice (R1); tests lower it
  syncBelow: 5000, // selections smaller than this are counted at once: a placeholder would only flash…
  syncMs: 50, // …as long as counting at once takes this long at most in one turn, all asks together
  syncUntil: 0, // when this turn's counting at once has to stop (0: none yet this turn)
  jobs: new Map(), // slot -> { slot, key, steps, onDone, progress, ms, slices, longest }
  last: [], // finished jobs: { slot, ms, slices, longest }, newest last
  timer: null,
  tickAt: 0, // when the placeholders' percentages were last rewritten

  /** The job in `slot` for `key`, started (with `makeSteps()`) unless it's already there. */
  run(slot, key, makeSteps, onDone) {
    const cur = this.jobs.get(slot);
    if (cur && cur.key === key) return cur;
    this.jobs.delete(slot); // the job there, if any, is dropped
    const job = { slot, key, steps: makeSteps(), onDone, progress: 0, ms: 0, slices: 0, longest: 0 };
    this.jobs.set(slot, job);
    this.schedule();
    return job;
  },

  /** Drop every job whose slot starts with `prefix`, except `keep`'s. */
  drop(prefix, keep = null) {
    for (const slot of [...this.jobs.keys()]) if (slot.startsWith(prefix) && slot !== keep) this.jobs.delete(slot);
  },

  /** How far `slot`'s job is, 0–1 (0 when there's none). */
  progress(slot) {
    return this.jobs.get(slot)?.progress ?? 0;
  },

  /** Run `slot`'s job for `key` to the end now (R7). */
  finish(slot, key) {
    const job = this.jobs.get(slot);
    if (job && job.key === key) this.advance(job, Infinity);
  },

  /**
   * Run `slot`'s job for `key` to the end now if it fits in what's left of this turn's
   * syncMs; if not, it goes on in slices. Every ask in one turn (one render) shares the
   * syncMs, so several small selections asked for together can't freeze the page.
   */
  finishInTurn(slot, key) {
    const job = this.jobs.get(slot);
    if (!job || job.key !== key) return;
    if (!this.syncUntil) {
      this.syncUntil = performance.now() + this.syncMs;
      queueMicrotask(() => { this.syncUntil = 0; }); // the turn is over
    }
    if (performance.now() < this.syncUntil) this.advance(job, this.syncUntil);
  },

  schedule() {
    if (this.timer != null || !this.jobs.size) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.slice();
    }, 0);
  },

  /** One slice: advance the oldest jobs until the budget is spent, and always by a step. */
  slice() {
    if (!this.jobs.size) return;
    const deadline = performance.now() + this.budget;
    do this.advance(this.jobs.values().next().value, deadline);
    while (this.jobs.size && performance.now() < deadline);
    const now = performance.now();
    if (this.jobs.size && now - this.tickAt >= 500) {
      this.tickAt = now;
      Counting.refresh();
    }
    this.schedule();
  },

  /** Advance `job` until `deadline`; when it's done, hand its result on. */
  advance(job, deadline) {
    const t0 = performance.now();
    let r;
    do {
      r = job.steps.next();
      if (!r.done) job.progress = r.value;
    } while (!r.done && performance.now() < deadline);
    const ms = performance.now() - t0;
    job.ms += ms;
    job.slices++;
    job.longest = Math.max(job.longest, ms);
    if (!r.done) return;
    if (this.jobs.get(job.slot) === job) this.jobs.delete(job.slot);
    this.last.push({ slot: job.slot, ms: job.ms, slices: job.slices, longest: job.longest });
    if (this.last.length > 50) this.last.shift();
    if (LoadPerf.enabled) console.info(`Counted ${job.slot} in ${Math.round(job.ms)} ms, ${job.slices} slices, longest ${Math.round(job.longest)} ms`);
    job.onDone(r.value);
  },

  /** Counts arrived: redraw what waits for them, after whatever is running now. */
  changed() {
    clearTimeout(this.redraw);
    this.redraw = setTimeout(() => {
      Panels.invalidate(['content']);
      Tabs.keepJump();
    }, 0);
  },
};

/**
 * "Counting words… 40%" placeholders (R2), by element id. The runner rewrites their
 * percentage at most twice a second; drawing a panel forgets the ones it drew, so a late
 * percentage never covers real counts.
 */
const Counting = {
  shown: new Map(), // id -> { slot, owner, draw(text) }

  text: (slot) => `Counting words… ${Math.floor(Background.progress(slot) * 100)}%`,

  /**
   * Show the placeholder in chart `id` while `slot` counts. `on` is the chart's own event
   * handlers: Charts.set attaches them only when it creates the chart, which may be now.
   */
  chart(id, slot, on = {}) {
    this.show(id, slot, (text) => Charts.set(id, emptyOption(currentTheme(), text), { on }));
  },

  /** Show the placeholder in element `id` (a box of text or a table) while `slot` counts. */
  box(id, slot) {
    this.show(id, slot, (text) => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = html`<p class="muted counting">${text}</p>`;
    });
  },

  show(id, slot, draw) {
    this.shown.set(id, { slot, owner: Panels.drawing, draw });
    draw(this.text(slot));
  },

  /** Forget the placeholders `panel` drew: it's drawing again. */
  forget(panel) {
    for (const [id, x] of this.shown) if (x.owner === panel) this.shown.delete(id);
  },

  refresh() {
    for (const [id, x] of this.shown) {
      if (Background.jobs.has(x.slot)) x.draw(this.text(x.slot));
      else this.shown.delete(id);
    }
  },
};
