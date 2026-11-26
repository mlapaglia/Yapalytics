/*
 * Load timings: where a load's time goes, in the parser workers and on the page. The
 * last load's are in LoadPerf.last; open the app with ?perf to have each load print
 * them to the console. Only names and durations are kept, never message text.
 */

/**
 * A parser worker's lib (messageLib + VADER + zipLib, as runParserWorker builds it) with
 * its parsing functions timed. Serialized into the worker source like zipLib, so it must
 * be self-contained. Each call's time adds to a named total; the worker's final message
 * ('done' or 'error') carries them in `perf`: { name: { ms, n } }, plus `total`, the
 * time from the job arriving to that message.
 */
function perfLib(self, messageLib, vaderLib, zipLib) {
  'use strict';

  const now = () => performance.now();
  const totals = {};
  const add = (name, ms, n = 1) => {
    const x = totals[name] || (totals[name] = { ms: 0, n: 0 });
    x.ms += ms;
    x.n += n;
  };
  const wrap = (name, fn) => function (...args) {
    const t = now();
    try { return fn.apply(this, args); } finally { add(name, now() - t); }
  };
  const wrapAsync = (name, fn) => async function (...args) {
    const t = now();
    try { return await fn.apply(this, args); } finally { add(name, now() - t); }
  };
  /** Time `fn()` (sync or async) under `name`. Parsers use it for their own steps. */
  const timed = (name, fn) => {
    const t = now();
    const out = fn();
    if (out && typeof out.then === 'function') return out.finally(() => add(name, now() - t));
    add(name, now() - t);
    return out;
  };

  // The worker clock starts with the worker, so this is how long the worker took to start.
  add('worker start', now());
  const t0 = now();
  const vader = vaderLib();
  vader.polarityScores = wrap('analyzeText › VADER', vader.polarityScores);
  const lib = Object.assign(messageLib(vader), zipLib());
  add('lib setup', now() - t0);

  lib.analyzeText = wrap('analyzeText', lib.analyzeText);
  lib.stampTime = wrap('stampTime', lib.stampTime);
  lib.listZip = wrapAsync('zip directory', lib.listZip);
  lib.readEntryText = wrapAsync('inflate', lib.readEntryText);
  lib.timed = timed;
  JSON.parse = wrap('JSON.parse', JSON.parse);

  let start = null;
  self.addEventListener('message', () => { if (start == null) start = now(); }); // before the parser's own onmessage

  // Posting copies the message (structured clone) on this thread.
  const post = self.postMessage.bind(self);
  self.postMessage = (msg) => {
    if (msg.type === 'done' || msg.type === 'error') {
      add('total', now() - (start ?? now()));
      msg.perf = totals;
      return post(msg);
    }
    const t = now();
    post(msg);
    if (msg.type === 'batch') add('post batches', now() - t, msg.msgs.length + msg.calls.length);
  };

  return lib;
}

/**
 * The page's side: steps of a load (detect, each parse job, merge, owners, draw) and the
 * work done on the page while the workers parse.
 */
const LoadPerf = {
  enabled: typeof location !== 'undefined' && /[?&]perf\b/.test(location.search),
  cur: null,
  last: null,

  begin() {
    this.cur = { t0: performance.now(), steps: [], jobs: [] };
  },

  /** Time `fn()` (sync or async) as a step of the load. */
  step(name, fn) {
    const t = performance.now();
    const done = () => this.cur && this.cur.steps.push({ name, ms: performance.now() - t });
    const out = fn();
    if (out && typeof out.then === 'function') return out.finally(done);
    done();
    return out;
  },

  /** A parse job starts: its page-side totals, filled by `add` and `endJob`. */
  startJob(label) {
    const job = { label, t0: performance.now(), page: {}, worker: null, ms: 0, msgs: 0 };
    this.cur?.jobs.push(job);
    return job;
  },

  add(job, name, ms, n = 1) {
    const x = job.page[name] || (job.page[name] = { ms: 0, n: 0 });
    x.ms += ms;
    x.n += n;
  },

  endJob(job, workerPerf) {
    job.ms = performance.now() - job.t0;
    job.worker = workerPerf || null;
  },

  end() {
    if (!this.cur) return;
    if (!this.cur.steps.length && !this.cur.jobs.length) { this.cur = null; return; }
    this.cur.ms = performance.now() - this.cur.t0;
    this.last = this.cur;
    this.cur = null;
    if (this.enabled) this.print(this.last);
  },

  /** Rows for console.table: [{ where, step, ms, '%', calls }]. */
  rows(run = this.last) {
    if (!run) return [];
    const rows = [];
    const row = (where, step, ms, n) => rows.push({ where, step, ms: Math.round(ms), '%': +((ms / run.ms) * 100).toFixed(1), calls: n ?? '' });
    for (const s of run.steps) row('page', s.name, s.ms);
    for (const j of run.jobs) {
      row(j.label, 'job (wall)', j.ms);
      const w = j.worker || {};
      const known = ['inflate', 'zip directory', 'JSON.parse', 'analyzeText', 'stampTime', 'post batches', 'fixAll', 'wait for file', 'decode UTF-8'];
      for (const [name, x] of Object.entries(w)) if (name !== 'total') row(`${j.label} · worker`, name, x.ms, x.n);
      if (w.total) {
        const other = w.total.ms - known.reduce((a, k) => a + (w[k]?.ms || 0), 0);
        row(`${j.label} · worker`, 'other parsing', other);
      }
      for (const [name, x] of Object.entries(j.page)) row(`${j.label} · page`, name, x.ms, x.n);
    }
    row('all', 'load (wall)', run.ms);
    return rows;
  },

  print(run) {
    console.groupCollapsed(`Load took ${(run.ms / 1000).toFixed(2)} s`);
    console.table(this.rows(run));
    console.groupEnd();
  },
};
