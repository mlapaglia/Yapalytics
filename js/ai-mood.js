/*
 * AI mood scoring (specs/001-ai-mood-scoring.md): a sentiment model that runs in this
 * tab, as an alternative to VADER. Nothing is fetched until the user asks for it; then
 * Transformers.js (jsDelivr) and the model (Hugging Face) download once and the browser
 * caches them. Message text only ever goes to a Web Worker in this tab.
 */

const AI_MOOD_LIB_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2/dist/transformers.min.js';
const AI_MOOD_MODEL = 'Xenova/twitter-roberta-base-sentiment-latest';
const AI_MOOD_MODEL_MB = 126;
const AI_MOOD_BATCH = 32;
const AI_MOOD_MAX_CHARS = 1000;

/**
 * The text the model sees for a message body, prepared the way the model's authors
 * prepared tweets: @mentions become "@user" and links become "http".
 */
function aiMoodText(body) {
  const text = body
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.length > 1 && w[0] === '@' ? '@user' : /^(?:https?:\/\/|www\.)/i.test(w) ? 'http' : w))
    .join(' ');
  return text.length > AI_MOOD_MAX_CHARS ? [...text].slice(0, AI_MOOD_MAX_CHARS).join('') : text;
}

/** Whether a message should have an AI score and doesn't yet: the messages VADER scores. */
const aiMoodMissing = (m) => m.v != null && !m.ai;

/**
 * What's left to score: each unique model text once (shortest first, so a batch pads
 * little), the messages behind each text, and how many messages that is. Messages whose
 * text is in `known` (text -> scores from an earlier run) get those scores here instead.
 */
function aiMoodPlan(msgs, known = null) {
  const byText = new Map();
  let count = 0;
  for (const m of msgs) {
    if (!aiMoodMissing(m)) continue;
    const t = aiMoodText(m.b);
    const p = known && known.get(t);
    if (p) {
      m.ai = p;
      continue;
    }
    let list = byText.get(t);
    if (!list) byText.set(t, (list = []));
    list.push(m);
    count++;
  }
  const texts = [...byText.keys()].sort((a, b) => a.length - b.length);
  return { texts, byText, count };
}

/**
 * The model, in a module Web Worker: `T` is the Transformers.js module. Serialized into
 * the worker source like the parser workers, so it must be self-contained.
 * In {type:'load', model} → out {type:'progress', loaded, total}…, then {type:'ready'}.
 * In {type:'score', id, texts} → out {type:'scored', id, results: [[neg, neu, pos]…]}.
 * Failures → {type:'error', id?, message}.
 */
function aiMoodWorker(self, T) {
  let classify = null;
  self.onmessage = async (e) => {
    const d = e.data;
    try {
      if (d.type === 'load') {
        if (T.env) T.env.allowLocalModels = false;
        const files = new Map(); // file -> [loaded, total]
        classify = await T.pipeline('text-classification', d.model, {
          dtype: 'q8',
          device: 'wasm',
          progress_callback: (p) => {
            if (p.status !== 'progress' || !p.total) return;
            files.set(p.file, [p.loaded, p.total]);
            let loaded = 0;
            let total = 0;
            for (const [l, t] of files.values()) { loaded += l; total += t; }
            self.postMessage({ type: 'progress', loaded, total });
          },
        });
        self.postMessage({ type: 'ready' });
      } else if (d.type === 'score') {
        const out = await classify(d.texts, { top_k: null });
        // One text gives one list of labels; several give a list per text.
        const rows = Array.isArray(out[0]) ? out : [out];
        const results = rows.map((labels) => {
          const p = {};
          for (const { label, score } of labels) p[String(label).toLowerCase()] = score;
          return [p.negative || 0, p.neutral || 0, p.positive || 0];
        });
        self.postMessage({ type: 'scored', id: d.id, results });
      }
    } catch (err) {
      self.postMessage({ type: 'error', id: d.id, message: String((err && err.message) || err) });
    }
  };
}

/** Rounded probabilities as stored on messages: [negative, neutral, positive]. */
const aiMoodRound = (p) => p.map((x) => Math.round(x * 1000) / 1000);

/**
 * The controller behind the scorer switch on the Mood card. States: off, asking (the
 * download notice), loading, scoring, error. Uses the app's S, $, inRange, baseMessages
 * and setMoodScorer. It only scores the messages the Mood chart shows: the selected
 * dates, conversation and filters.
 */
const AiMood = {
  state: 'off',
  worker: null,
  ready: false,
  loading: null, // Promise while the model loads
  failLoad: null, // rejects `loading`
  pending: new Map(), // request id -> { resolve, reject }
  inflight: null, // Promise of the batch being scored
  nextId: 0,
  run: 0, // bumped to stop the current run
  replan: false, // the selection changed during a run: plan again after this batch
  known: new Map(), // model text -> scores, so a text is scored once however the range moves
  pct: 0,
  done: 0,
  total: 0,
  error: '',

  /** The messages the Mood chart shows. */
  selection() {
    return inRange(baseMessages());
  },

  /** The user picked "AI model". */
  choose() {
    if (!aiMoodPlan(this.selection(), this.known).count) return setMoodScorer('ai');
    if (this.ready) return this.start();
    this.state = 'asking';
    this.render();
  },

  /** Back to VADER: stop any run (scores so far are kept). */
  chooseVader() {
    this.stop();
    setMoodScorer('vader');
  },

  cancel() {
    this.state = 'off';
    this.render();
  },

  /** Load the model if needed, then score every selected message still missing an AI score. */
  async start() {
    const run = ++this.run;
    this.error = '';
    try {
      if (!this.ready) {
        this.state = 'loading';
        this.pct = 0;
        this.render();
        await this.load();
        if (run !== this.run) return;
      }
      // A batch sent before a Stop may still be out: let its results land, so this run
      // doesn't score those texts again.
      if (this.inflight) await this.inflight.catch(() => {});
      if (run !== this.run) return;
      for (;;) {
        this.replan = false;
        const plan = aiMoodPlan(this.selection(), this.known);
        if (!plan.count) break;
        this.state = 'scoring';
        this.done = 0;
        this.total = plan.count;
        this.render();
        for (let i = 0; i < plan.texts.length; i += AI_MOOD_BATCH) {
          const texts = plan.texts.slice(i, i + AI_MOOD_BATCH);
          const results = await this.score(texts);
          // Results are valid even if the run was stopped meanwhile: keep them.
          texts.forEach((t, j) => {
            const p = aiMoodRound(results[j]);
            this.known.set(t, p);
            for (const m of plan.byText.get(t)) m.ai = p;
            this.done += plan.byText.get(t).length;
          });
          if (run !== this.run) return;
          if (this.replan) break;
          this.render();
        }
        // A changed selection, or files added while scoring, are picked up by the next pass.
      }
      this.state = 'off';
      this.render();
      setMoodScorer('ai');
    } catch (err) {
      if (run !== this.run) return;
      console.warn('AI mood scoring failed:', err);
      this.state = 'error';
      this.error = this.ready
        ? 'Scoring stopped because the model ran into a problem.'
        : 'The AI model couldn’t be downloaded. Check your connection (and any content blockers) and try again.';
      // Part of the selection has no AI score, so the chart goes back to VADER.
      if (S.moodScorer === 'ai') setMoodScorer('vader');
      else this.render();
    }
  },

  /** Stop the current run. A download in progress is abandoned; a loaded model is kept. */
  stop() {
    this.run++;
    if (!this.ready && this.worker) this.reset(new Error('stopped'));
    this.state = 'off';
    this.render();
  },

  /**
   * The dashboard is being drawn for `msgs` (the selection): new dates, filters or files.
   * A run in progress re-plans for it. With the AI scorer on, texts scored before are
   * filled in at once (before the charts draw) and anything else gets scored.
   */
  selectionChanged(msgs) {
    if (this.state === 'scoring') this.replan = true;
    else if (S.moodScorer === 'ai' && this.state === 'off' && msgs.some(aiMoodMissing) && aiMoodPlan(msgs, this.known).count) this.start();
  },

  load() {
    if (this.loading) return this.loading;
    this.loading = new Promise((resolve, reject) => {
      this.failLoad = reject;
      const src = `import * as T from ${JSON.stringify(AI_MOOD_LIB_URL)};\n(${aiMoodWorker})(self, T);`;
      const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      const worker = new Worker(url, { type: 'module' });
      this.worker = worker;
      worker.onmessage = (e) => {
        const d = e.data;
        if (d.type === 'progress') {
          this.pct = d.total ? d.loaded / d.total : 0;
          if (this.state === 'loading') this.render();
        } else if (d.type === 'ready') {
          URL.revokeObjectURL(url);
          this.ready = true;
          this.failLoad = null;
          resolve();
        } else if (d.type === 'scored') {
          const p = this.pending.get(d.id);
          this.pending.delete(d.id);
          if (p) p.resolve(d.results);
        } else if (d.type === 'error') {
          const p = d.id != null && this.pending.get(d.id);
          if (p) {
            this.pending.delete(d.id);
            p.reject(new Error(d.message));
          } else this.reset(new Error(d.message));
        }
      };
      worker.onerror = (e) => {
        e.preventDefault();
        URL.revokeObjectURL(url);
        this.reset(new Error(e.message || 'The AI model worker failed to start'));
      };
      worker.postMessage({ type: 'load', model: AI_MOOD_MODEL });
    });
    return this.loading;
  },

  /** Drop the worker and fail whatever was waiting on it. */
  reset(err) {
    if (this.worker) this.worker.terminate();
    this.worker = null;
    this.ready = false;
    this.loading = null;
    if (this.failLoad) this.failLoad(err);
    this.failLoad = null;
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  },

  score(texts) {
    const id = ++this.nextId;
    this.inflight = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ type: 'score', id, texts });
    });
    return this.inflight;
  },

  /** The status line under the Mood card's header, and the scorer switch. */
  render() {
    const busy = this.state === 'asking' || this.state === 'loading' || this.state === 'scoring';
    $$('#moodScorerSeg button').forEach((b) => b.classList.toggle('on', b.dataset.scorer === (busy ? 'ai' : S.moodScorer)));
    const box = $('#aiMoodStatus');
    if (!box) return;
    let markup = '';
    if (this.state === 'asking') {
      markup = html`<p>The AI model reads tone better than VADER, sarcasm included. It's about ${AI_MOOD_MODEL_MB} MB, downloaded once from Hugging Face and jsDelivr, then it runs in this tab: your messages never leave this device.</p>
        <div class="ai-actions"><button class="btn small primary" type="button" data-ai-mood="start">Download and score</button><button class="btn small ghost" type="button" data-ai-mood="cancel">Cancel</button></div>`;
    } else if (this.state === 'loading') {
      markup = html`<p><span class="spinner" aria-hidden="true"></span>Downloading the model… ${Math.round(this.pct * 100)}%</p>
        <div class="ai-actions"><button class="btn small ghost" type="button" data-ai-mood="stop">Stop</button></div>`;
    } else if (this.state === 'scoring') {
      markup = html`<p><span class="spinner" aria-hidden="true"></span>Scoring ${fmtNum(this.done)} of ${fmtNum(this.total)} messages…</p>
        <div class="ai-actions"><button class="btn small ghost" type="button" data-ai-mood="stop">Stop</button></div>`;
    } else if (this.state === 'error') {
      markup = html`<p class="ai-error">${this.error}</p>
        <div class="ai-actions"><button class="btn small" type="button" data-ai-mood="start">Try again</button></div>`;
    }
    box.innerHTML = markup;
    box.hidden = !markup;
  },

  init() {
    $('#moodScorerSeg').onclick = (e) => {
      const s = e.target.dataset.scorer;
      if (!s) return;
      if (s === 'ai') {
        if (S.moodScorer !== 'ai' && this.state !== 'loading' && this.state !== 'scoring') this.choose();
      } else if (S.moodScorer !== 'vader' || this.state !== 'off') this.chooseVader();
    };
    $('#aiMoodStatus').onclick = (e) => {
      const action = e.target.dataset.aiMood;
      if (action === 'start') this.start();
      else if (action === 'cancel') this.cancel();
      else if (action === 'stop') {
        // With AI on, part of the selection would be unscored: back to VADER.
        this.stop();
        if (S.moodScorer === 'ai') setMoodScorer('vader');
      }
    };
    this.render();
  },
};
