/*
 * What the loading screen shows (spec 016), worked out from what the loader tells it:
 * the steps, each file's state, bytes read, the records kept, and the conversations
 * found. No DOM, and the time is always passed in, so it can be unit tested.
 */

/** Steps in the order they run; a load shows the ones it uses (R8). */
const LOAD_STEPS = [
  { id: 'demo', label: 'Preparing the demo' },
  { id: 'check', label: 'Checking files' },
  { id: 'read', label: 'Reading files' },
  { id: 'merge', label: 'Merging and sorting' },
  { id: 'owners', label: "Who's you and linked people" },
  { id: 'draw', label: 'Drawing the dashboard' },
];
const RATE_WINDOW = 2000; // speeds are averaged over this long (R5)
const FOUND_SHOWN = 8; // conversations found that stay on screen (R15)

/**
 * A load's stats. `steps` lists the step ids this load goes through; `now` is the time
 * (ms) it starts.
 */
function createLoadStats({ steps = ['check', 'read', 'merge', 'owners', 'draw'], now = 0 } = {}) {
  const st = {
    t0: now,
    steps: LOAD_STEPS.filter((x) => steps.includes(x.id)).map((x) => ({ ...x, state: 'todo', start: null, ms: null })),
    step: null, // the current step's id
    detail: '', // what it's on: a file name, or a count of messages
    files: [], // { file, name, size, s, state: waiting|reading|done|failed, frac, msgs, calls, start, ms }
    jobs: new Map(), // job index -> its file rows
    readStart: null,
    // Counts (R4). Conversations and months include what was loaded before this read.
    msgs: 0,
    calls: 0,
    keys: new Set(),
    media: 0,
    rx: 0, // reactions on messages
    textRx: 0, // reactions sent as texts (Data.reactions)
    dupes: 0,
    months: new Map(), // month index (year * 12 + month) -> messages
    first: null,
    last: null,
    found: [], // newest first, at most FOUND_SHOWN: { key, name, s, group }
    foundN: 0,
    samples: [], // [time, bytes read, messages kept]
  };

  function bytesRead() {
    let b = 0;
    for (const f of st.files) b += f.state === 'done' ? f.size : f.frac * f.size;
    return b;
  }

  function sample(now) {
    st.samples.push([now, bytesRead(), st.msgs]);
    // Keep one sample older than the window, so the rate spans all of it.
    while (st.samples.length > 2 && st.samples[1][0] <= now - RATE_WINDOW) st.samples.shift();
  }

  function addMessage(m) {
    st.msgs++;
    st.keys.add(m.tk || m.k);
    st.media += (m.ph || 0) + (m.vd || 0) + (m.gf || 0);
    if (m.rx) for (const x of m.rx) st.rx += x.c;
    st.months.set(m.mo, (st.months.get(m.mo) || 0) + 1);
    if (st.first == null || m.mo < st.first) st.first = m.mo;
    if (st.last == null || m.mo > st.last) st.last = m.mo;
  }

  return {
    /** Move to step `id` (one of LOAD_STEPS), finishing the one before. `detail` says what it's on. */
    step(id, detail = '', now = 0) {
      if (st.step !== id) {
        for (const x of st.steps) {
          if (x.id === st.step && x.state === 'now') { x.state = 'done'; x.ms = now - x.start; }
        }
        const next = st.steps.find((x) => x.id === id);
        if (next) { next.state = 'now'; next.start = now; }
        st.step = id;
      }
      st.detail = detail;
    },

    /** Finish the current step (the load is over). The step line keeps saying what it last did. */
    end(now = 0) {
      for (const x of st.steps) if (x.state === 'now') { x.state = 'done'; x.ms = now - x.start; }
    },

    /**
     * Start reading `files` ([{ file, name, size, s }]), counting what `base` already
     * holds ({ msgs, calls, reactions }, Data's arrays). Files read before keep their
     * row; a read after a failure starts their counts again (spec 006).
     */
    beginRead(files, base, now = 0) {
      for (const f of files) {
        let row = st.files.find((r) => r.file === f.file);
        if (!row) st.files.push((row = { ...f }));
        Object.assign(row, { state: 'waiting', frac: 0, msgs: 0, calls: 0, start: null, ms: null });
      }
      Object.assign(st, { msgs: 0, calls: 0, keys: new Set(), media: 0, rx: 0, dupes: 0, months: new Map(), first: null, last: null, samples: [] });
      for (const m of base.msgs) addMessage(m);
      for (const c of base.calls) st.keys.add(c.tk || c.k);
      st.calls = base.calls.length;
      st.textRx = base.reactions;
      st.readStart = now;
      st.jobs = new Map();
      sample(now);
    },

    /** Job `i` starts on `files` (some of beginRead's, by `file`). */
    startJob(i, files, now = 0) {
      const rows = st.files.filter((r) => files.includes(r.file));
      st.jobs.set(i, rows);
      for (const r of rows) { r.state = 'reading'; r.start = now; }
    },

    /** The worker's progress on job `i`: `loaded` of `total` (its own units, usually bytes). */
    progress(i, loaded, total, now = 0) {
      const frac = total > 0 ? Math.min(1, loaded / total) : 0;
      for (const r of st.jobs.get(i) || []) r.frac = frac;
      sample(now);
    },

    /**
     * A batch from job `i` was added: Data.addBatch's result `res` ({ msgFrom, callFrom,
     * dupes }) over `data` ({ msgs, calls, reactions }), and the conversations it found.
     */
    batch(i, data, res, found = [], now = 0) {
      const rows = st.jobs.get(i) || [];
      const kept = data.msgs.length - res.msgFrom;
      const keptCalls = data.calls.length - res.callFrom;
      for (let j = res.msgFrom; j < data.msgs.length; j++) addMessage(data.msgs[j]);
      for (let j = res.callFrom; j < data.calls.length; j++) st.keys.add(data.calls[j].k);
      st.calls += keptCalls;
      st.dupes += res.dupes;
      st.textRx = data.reactions;
      // A job of several files shares its counts: they're on its first row.
      if (rows[0]) { rows[0].msgs += kept; rows[0].calls += keptCalls; }
      for (const c of found) {
        st.found.unshift(c);
        st.foundN++;
      }
      if (st.found.length > FOUND_SHOWN) st.found.length = FOUND_SHOWN;
      sample(now);
    },

    /** Job `i` is over, failed when `error`. */
    endJob(i, { error = false } = {}, now = 0) {
      for (const r of st.jobs.get(i) || []) {
        r.state = error ? 'failed' : 'done';
        r.frac = error ? r.frac : 1;
        r.ms = now - (r.start ?? now);
      }
      sample(now);
    },

    /** Everything the screen draws, at time `now`. */
    snapshot(now = 0) {
      const total = st.files.reduce((a, f) => a + f.size, 0);
      const read = bytesRead();
      const s0 = st.samples[0];
      const s1 = st.samples[st.samples.length - 1];
      const dt = s1 && s0 ? (s1[0] - s0[0]) / 1000 : 0;
      const bps = dt >= 0.25 ? (s1[1] - s0[1]) / dt : null;
      const mps = dt >= 0.25 ? (s1[2] - s0[2]) / dt : null;
      let left = null;
      if (st.step === 'read' && bps > 0 && now - st.readStart >= 1000) {
        left = ((total - read) / bps) * 1000;
        if (left < 1000) left = null;
      }
      return {
        step: st.step,
        detail: st.detail,
        steps: st.steps.map((x) => ({ id: x.id, label: x.label, state: x.state, ms: x.state === 'now' ? now - x.start : x.ms })),
        files: st.files.map(({ name, size, s, state, frac, msgs, calls, ms }) => ({ name, size, s, state, frac, msgs, calls, ms })),
        pct: total ? (read / total) * 100 : st.step && st.step !== 'demo' && st.step !== 'check' ? 100 : 0,
        bytes: read,
        total,
        counts: {
          messages: st.msgs,
          calls: st.calls,
          conversations: st.keys.size,
          media: st.media,
          reactions: st.rx + st.textRx,
          dupes: st.dupes,
        },
        bps,
        mps,
        elapsed: now - st.t0,
        left,
        months: st.months,
        first: st.first,
        last: st.last,
        found: st.found,
        foundN: st.foundN,
      };
    },
  };
}
