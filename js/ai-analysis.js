/*
 * AI conversation analysis (specs/002-ai-conversation-analysis.md): a language model
 * reads one conversation and reports a summary, each side's tone, notable moments and
 * topics, and answers a question about it. It runs in this browser (WebLLM), in Ollama
 * on this computer, or with Claude under the user's own API key. Every backend gets the
 * same prompt and returns the same JSON report.
 *
 * The top half is pure helpers (transcript, redaction, parsing, request bodies) that
 * the unit tests load on their own. AiAnalysis below them is the card's controller.
 */

const WEBLLM_URL = 'https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.86/lib/index.js';
const ANTHROPIC_SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.1.0/+esm';

// LM Studio sets the context when a model loads; 4,096 tokens is its usual default.
const LMSTUDIO_DEFAULT_CONTEXT = 4096;
// Chat transcripts tokenize at about 2.4 characters a token (2.44–2.48 measured with
// Qwen3.8 27B): timestamps, names and emoji cost more than prose. Until LM Studio
// reports the real ratio for a model, budgets use this (spec 002, R16).
const LMSTUDIO_CHARS_PER_TOKEN = 2.4;
// Kept free in the context: the instructions (~450 tokens), the question, the
// 1,500-token reply and some slack.
const LMSTUDIO_RESERVED_TOKENS = 2500;

/**
 * Transcript budget in characters for an LM Studio model loaded with `context` tokens,
 * at `charsPerToken`, with a 5% margin so the prompt never overflows the context.
 */
function lmstudioBudget(context, charsPerToken = LMSTUDIO_CHARS_PER_TOKEN) {
  return Math.max(2000, Math.floor((context - LMSTUDIO_RESERVED_TOKENS) * charsPerToken * 0.95));
}

/**
 * Characters per token measured from one LM Studio reply's usage, or null when the
 * transcript was too small a part of the prompt for the number to describe it.
 */
function lmstudioMeasuredRatio(systemChars, userChars, promptTokens) {
  if (!(promptTokens > 0) || userChars < systemChars * 4) return null;
  const r = (systemChars + userChars) / promptTokens;
  return r > 0.5 && r < 10 ? Math.round(r * 100) / 100 : null;
}

// Budgets assume ~2.4 characters a token too, leaving room for the instructions and
// the reply: WebLLM's models have 4,096 tokens, Ollama gets num_ctx 16,384.
const AI_BACKENDS = {
  webllm: { label: 'In this browser', budgetChars: 5500 },
  ollama: { label: 'Ollama', budgetChars: 30000 },
  lmstudio: { label: 'LM Studio', budgetChars: lmstudioBudget(LMSTUDIO_DEFAULT_CONTEXT) }, // until the loaded context is known
  claude: { label: 'Claude', budgetChars: 400000 },
};

const WEBLLM_MODELS = [
  { id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC', label: 'Llama 3.2 3B (about 2.3 GB)' },
  { id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC', label: 'Llama 3.2 1B (about 0.9 GB, faster, rougher)' },
  { id: 'Phi-3.5-mini-instruct-q4f16_1-MLC', label: 'Phi 3.5 mini (about 3.7 GB)' },
];

// Prices in $ per million tokens. Haiku costs more above 100K input tokens.
const CLAUDE_MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', input: 4, fallbacks: true },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', input: 2, fallbacks: true },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', input: 0.1, longInput: 0.5, longAbove: 100000, fallbacks: false },
];

const ANALYSIS_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    tone: {
      type: 'array',
      items: {
        type: 'object',
        properties: { speaker: { type: 'string' }, description: { type: 'string' } },
        required: ['speaker', 'description'],
        additionalProperties: false,
      },
    },
    moments: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          date: { type: 'string' },
          title: { type: 'string' },
          detail: { type: 'string' },
          mood: { type: 'string', enum: ['positive', 'negative', 'mixed', 'neutral'] },
        },
        required: ['date', 'title', 'detail', 'mood'],
        additionalProperties: false,
      },
    },
    topics: { type: 'array', items: { type: 'string' } },
    answer: { type: 'string' },
  },
  required: ['summary', 'tone', 'moments', 'topics', 'answer'],
  additionalProperties: false,
};

const ANALYSIS_SYSTEM = `You read text-message conversations and describe them for the person who exported them, who appears as "You".

Use only what the transcript shows; don't guess at what it doesn't. Days start with "## YYYY-MM-DD" headers: give every date in that form, and only dates that appear in the transcript. Be specific and brief: name concrete events, plans and feelings rather than generalities.

Reply with a JSON object:
- summary: what the conversation is about and how it goes, in 3 to 5 sentences.
- tone: one entry per participant, "You" first, each a sentence on how they come across.
- moments: up to 8 notable moments (turning points, conflicts, plans, milestones, in-jokes), each with its date, a short title, a one-sentence detail, and its mood: positive, negative, mixed or neutral.
- topics: up to 8 short topic names.
- answer: the answer to the user's question if there is one, otherwise "".`;

/** An error whose message is meant for the user as is. */
class AiError extends Error {}

const pad2 = (n) => String(n).padStart(2, '0');
/** "2024-03-02" for a timestamp, in local time. */
const isoDay = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Attachment notes for a message: "[photo]", "[2 videos]"… */
function attachmentTags(m) {
  const tag = (n, one, many) => (n ? [n > 1 ? `[${n} ${many}]` : `[${one}]`] : []);
  return [
    ...tag(m.ph, 'photo', 'photos'), ...tag(m.gf, 'GIF', 'GIFs'), ...tag(m.vd, 'video', 'videos'),
    ...tag(m.au, 'audio', 'audio clips'), ...tag(m.ot, 'file', 'files'),
    ...(m.sh ? ['[shared post]'] : []), // not its caption: that's the creator's words (spec 004)
  ].join(' ');
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const EMAIL_RE = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu;
const LINK_RE_AI = /(?:https?:\/\/|\bwww\.)\S+/gi;
const PHONE_RE = /\+?\(?\d[\d\s().-]{5,}\d/g;

/**
 * Best-effort scrub of a message body (spec 002, R4): links, emails and phone numbers
 * become [link], [email] and [phone]; people's names become their alias. `aliases` is
 * a Map of name → alias, longest names first (see aliasMap).
 */
function redactText(text, aliases = new Map()) {
  let out = text.replace(LINK_RE_AI, '[link]').replace(EMAIL_RE, '[email]');
  out = out.replace(PHONE_RE, (x) => {
    const digits = x.replace(/\D/g, '');
    // Dates and times look like numbers too: leave them be.
    if (digits.length < 7 || /^\d{4}-\d{1,2}-\d{1,2}$/.test(x.trim())) return x;
    return '[phone]';
  });
  for (const [name, alias] of aliases) {
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(name)}(?![\\p{L}\\p{N}])`, 'giu'), alias);
  }
  return out;
}

/**
 * Map of every way to write each person's name → their alias: the full name and each
 * part of 3+ letters ("Alex Smith" → "Alex Smith", "Alex", "Smith"), longest first so
 * full names are replaced before their parts. `people` is [{ name, alias }].
 */
function aliasMap(people) {
  const map = new Map();
  for (const { name, alias } of people) {
    if (!name || name === alias) continue;
    const full = name.trim();
    if (/[\p{L}]/u.test(full) && !map.has(full)) map.set(full, alias);
    for (const part of full.split(/[\s,~]+/)) {
      if (part.length >= 3 && /^[\p{L}'’-]+$/u.test(part) && !map.has(part)) map.set(part, alias);
    }
  }
  return new Map([...map].sort((a, b) => b[0].length - a[0].length));
}

/**
 * The transcript a model reads: the latest messages of `msgs` (one conversation, in
 * time order) that fit in `budgetChars`, under day headers, one line per message.
 * Options:
 *   speakerOf(m)  the sender's name for a received message (sent ones are "You")
 *   title         who the conversation is with, for the first line
 *   redact        hide names, numbers, emails and links (people become aliases)
 *   names         [real name] of people to scrub from the text when redacting, besides the speakers
 *   ownNames      [your names in the export], also scrubbed (to "You")
 *   group         whether it's a group chat (aliases "Person A"… instead of "Them")
 * Returns { text, count, total, first, last } (first / last: "YYYY-MM-DD").
 */
function buildTranscript(msgs, { budgetChars, speakerOf = () => 'Them', title = 'Them', redact = false, names = [], ownNames = [], group = false } = {}) {
  const usable = msgs.filter((m) => (m.b && m.b.trim()) || attachmentTags(m));
  // Walk back from the latest message until the budget is spent.
  let start = usable.length;
  let used = 0;
  let lastDay = null;
  while (start > 0) {
    const m = usable[start - 1];
    const cost = (m.b ? m.b.length : 0) + 24 + (m.d !== lastDay ? 18 : 0);
    if (used + cost > budgetChars && start < usable.length) break;
    used += cost;
    lastDay = m.d;
    start--;
  }
  const picked = usable.slice(start);

  // Speaker names, and their aliases when redacting.
  const alias = new Map();
  const nameOf = (m) => {
    if (m.o) return 'You';
    const real = speakerOf(m) || 'Someone';
    if (!redact) return real;
    if (!alias.has(real)) alias.set(real, group ? `Person ${String.fromCharCode(65 + (alias.size % 26))}${alias.size >= 26 ? Math.floor(alias.size / 26) + 1 : ''}` : 'Them');
    return alias.get(real);
  };
  const speakers = picked.map(nameOf);
  const scrub = redact
    ? aliasMap([
      ...[...alias].map(([name, a]) => ({ name, alias: a })),
      ...names.map((name) => ({ name, alias: group ? 'someone' : 'Them' })),
      ...ownNames.map((name) => ({ name, alias: 'You' })),
    ])
    : null;

  const lines = [];
  let day = null;
  picked.forEach((m, i) => {
    if (m.d !== day) {
      day = m.d;
      lines.push(`## ${isoDay(m.t)} (${WEEKDAY[new Date(m.t).getDay()]})`);
    }
    const dt = new Date(m.t);
    let body = (m.b || '').replace(/\s*\n\s*/g, ' / ').trim();
    if (scrub) body = redactText(body, scrub);
    const att = attachmentTags(m);
    lines.push(`${pad2(dt.getHours())}:${pad2(dt.getMinutes())} ${speakers[i]}: ${[body, att].filter(Boolean).join(' ')}`);
  });
  const first = picked.length ? isoDay(picked[0].t) : null;
  const last = picked.length ? isoDay(picked[picked.length - 1].t) : null;
  const who = redact ? (group ? `a group (${alias.size + 1} people)` : 'Them') : title;
  const head = `# Conversation with ${who} · ${picked.length} messages${first ? ` · ${first} to ${last}` : ''}`;
  return { text: [head, ...lines].join('\n'), count: picked.length, total: usable.length, first, last };
}

/** The user message: the transcript, then the question (if any). */
function analysisPrompt(transcript, question) {
  const q = (question || '').trim();
  return `${transcript}\n\n${q ? `Question: ${q}` : 'No question was asked, so leave "answer" empty.'}`;
}

/**
 * The model's reply as a report, checked (spec 002, R8): JSON (code fences and text
 * around it are tolerated), a summary or an answer, moments only on days in
 * [first, last], sorted. Throws AiError when it isn't usable.
 */
function parseAnalysis(raw, { first = null, last = null } = {}) {
  const s = String(raw || '');
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a < 0 || b <= a) throw new AiError("The model's reply wasn't a report. Try again, or try another model.");
  let o;
  try {
    o = JSON.parse(s.slice(a, b + 1));
  } catch (e) {
    throw new AiError("The model's reply wasn't valid JSON. Try again, or try another model.");
  }
  const str = (x) => (typeof x === 'string' ? x.trim() : '');
  const list = (x) => (Array.isArray(x) ? x : []);
  const summary = str(o.summary);
  const answer = str(o.answer);
  if (!summary && !answer) throw new AiError("The model's reply was missing the summary. Try again, or try another model.");
  const tone = list(o.tone)
    .map((t) => ({ speaker: str(t && t.speaker), description: str(t && t.description) }))
    .filter((t) => t.speaker && t.description);
  const MOODS = ['positive', 'negative', 'mixed', 'neutral'];
  const all = list(o.moments).map((m) => ({
    date: str(m && m.date),
    title: str(m && m.title),
    detail: str(m && m.detail),
    mood: MOODS.includes(str(m && m.mood)) ? str(m.mood) : 'neutral',
  }));
  const moments = all
    .filter((m) => /^\d{4}-\d{2}-\d{2}$/.test(m.date) && !isNaN(Date.parse(m.date)) && m.title && (!first || m.date >= first) && (!last || m.date <= last))
    .sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
  const topics = [...new Set(list(o.topics).map(str).filter(Boolean))].slice(0, 12);
  return { summary, tone, moments, topics, answer, dropped: all.length - moments.length };
}

/** Rough size and input cost of a Claude request: { tokens, cost } ($). */
function estimateClaude(chars, modelId) {
  const model = CLAUDE_MODELS.find((m) => m.id === modelId) || CLAUDE_MODELS[0];
  // Chat text runs about 3.5 characters a token; the instructions and schema add ~600.
  const tokens = Math.ceil(chars / 3.5) + 600;
  const rate = model.longAbove && tokens > model.longAbove ? model.longInput : model.input;
  return { tokens, cost: (tokens * rate) / 1e6 };
}

/** Ollama /api/chat request body, with the output constrained to the schema. */
function ollamaRequest({ model, system, user, schema = ANALYSIS_SCHEMA }) {
  return {
    path: '/api/chat',
    body: {
      model,
      stream: false,
      format: schema,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      options: { num_ctx: 16384, temperature: 0.2 },
    },
  };
}

/**
 * Claude Messages request: structured output to the schema, medium effort. Opus and
 * Sonnet opt into server-side refusal fallbacks, which needs the beta endpoint.
 */
function claudeRequest({ model, system, user, schema = ANALYSIS_SCHEMA }) {
  const info = CLAUDE_MODELS.find((m) => m.id === model) || CLAUDE_MODELS[0];
  const params = {
    model: info.id,
    max_tokens: 16000,
    system,
    messages: [{ role: 'user', content: user }],
    output_config: { effort: 'medium', format: { type: 'json_schema', schema } },
  };
  if (!info.fallbacks) return { beta: false, params };
  return { beta: true, params: { ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } };
}

/**
 * LM Studio chat request: the OpenAI-compatible endpoint, because it's the one with
 * structured output (the native /api/v1/chat has none). See spec 002, R11.
 */
function lmstudioRequest({ model, system, user, schema = ANALYSIS_SCHEMA, reasoningOff = false }) {
  const body = {
    model,
    stream: false,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    response_format: { type: 'json_schema', json_schema: { name: 'conversation_report', strict: true, schema } },
    temperature: 0.2,
    max_tokens: 1500,
  };
  // A thinking model writes schema-constrained JSON into its thinking channel and
  // leaves `content` empty. The constraint stops it thinking freely anyway, so turn
  // reasoning off (spec 002, R15). Only for models that allow it: others error.
  if (reasoningOff) body.reasoning_effort = 'none';
  return { path: '/v1/chat/completions', body };
}

/**
 * The text of an LM Studio chat choice: `content`, or `reasoning_content` when only
 * that holds the JSON (a thinking model whose reasoning couldn't be turned off).
 */
function lmstudioReplyText(choice) {
  const msg = (choice && choice.message) || {};
  const content = typeof msg.content === 'string' ? msg.content : '';
  if (content.includes('{')) return content;
  const reasoning = typeof msg.reasoning_content === 'string' ? msg.reasoning_content : '';
  return reasoning.includes('{') ? reasoning : content;
}

/**
 * Language models from an LM Studio model list: [{ key, loaded, context }], loaded
 * ones first. Reads the native /api/v1/models shape ({ models: [{ type, key,
 * loaded_instances: [{ config: { context_length } }] }] }) or the OpenAI-compatible
 * /v1/models one ({ data: [{ id }] }), which says nothing about loading.
 */
function lmstudioModels(json) {
  if (json && Array.isArray(json.models)) {
    return json.models
      .filter((m) => m && m.type === 'llm' && m.key)
      .map((m) => {
        const loaded = Array.isArray(m.loaded_instances) && m.loaded_instances.length > 0;
        const contexts = loaded ? m.loaded_instances.map((i) => i && i.config && i.config.context_length).filter(Number.isFinite) : [];
        // A reasoning model that lets reasoning be turned off (spec 002, R15).
        const r = m.capabilities && m.capabilities.reasoning;
        const thinks = !!r && (!Array.isArray(r.allowed_options) || r.allowed_options.includes('off'));
        // Every name LM Studio answers to for this model (spec 002, R17), lowercased.
        const names = [m.key, ...(Array.isArray(m.variants) ? m.variants : []), ...(loaded ? m.loaded_instances.map((i) => i && i.id) : [])]
          .filter((n) => typeof n === 'string' && n)
          .map((n) => n.toLowerCase());
        return { key: m.key, loaded, context: contexts.length ? Math.max(...contexts) : null, thinks, names: [...new Set(names)] };
      })
      .sort((a, b) => b.loaded - a.loaded);
  }
  if (json && Array.isArray(json.data)) {
    return json.data.filter((m) => m && m.id && !/embed/i.test(m.id)).map((m) => ({ key: m.id, loaded: false, context: null, thinks: false, names: [m.id.toLowerCase()] }));
  }
  return [];
}

/**
 * The listed model a name in the model field means, matched the way LM Studio matches
 * it: the key, a variant ("qwen/qwen3.8-27b@4bit") or a loaded instance id, in any
 * capitalization (spec 002, R17). Null when none matches.
 */
function lmstudioFind(models, name) {
  const n = String(name || '').trim().toLowerCase();
  if (!n || !Array.isArray(models)) return null;
  const base = n.replace(/@[^/@]*$/, ''); // "key@4bit" -> "key", for variants the list doesn't name
  return models.find((m) => m.names.includes(n)) || models.find((m) => m.names.includes(base)) || null;
}

/**
 * Why the transcript stops where it does with LM Studio (spec 002, R17): the chosen
 * model's loaded context, or why the usual 4,096 tokens are assumed instead.
 * `models` is null until the server has been listed.
 */
function lmstudioScopeNote(models, name) {
  const usual = `LM Studio's usual ${LMSTUDIO_DEFAULT_CONTEXT.toLocaleString('en-US')}-token context`;
  const m = lmstudioFind(models, name);
  if (m && m.context) return `as much as fits the model's ${m.context.toLocaleString('en-US')}-token context in LM Studio`;
  const loaded = (models || []).filter((x) => x.loaded).map((x) => x.key);
  const pick = loaded.length ? ` (loaded now: ${loaded.join(', ')})` : '';
  if (!models) return `as much as fits ${usual}. Load the model with a longer context in LM Studio to read more`;
  if (!String(name || '').trim()) return `as much as fits ${usual}. Pick a model${pick}`;
  if (!m) return `as much as fits ${usual}: LM Studio doesn't list a model called "${String(name).trim()}"${pick}`;
  if (!m.loaded) return `as much as fits ${usual}: "${m.key}" isn't loaded, so LM Studio will load it at its default context. Load it with a longer context to read more${pick}`;
  return `as much as fits ${usual}. Load the model with a longer context in LM Studio to read more`;
}

/** What to tell the user when LM Studio can't be reached (spec 002, R14). */
function lmstudioUnreachable(base) {
  return `Couldn't reach LM Studio at ${base}. Start its server (Developer tab → Start server, or "lms server start") and turn on Enable CORS in its Server Settings so this page can reach it.`;
}

const LMSTUDIO_TOKEN_ERROR = 'LM Studio asked for an API token, or refused the one given. Copy a token from Server Settings → Manage Tokens in LM Studio into the API token field.';

/** Headers for LM Studio: the token as a Bearer header when there is one (spec 002, R13). */
function lmstudioHeaders(settings, json = false) {
  const h = json ? { 'Content-Type': 'application/json' } : {};
  const token = (settings.lmstudioToken || '').trim();
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

/** What to tell the user when Ollama can't be reached (spec 002, AC6). */
function ollamaUnreachable(base, origin) {
  return `Couldn't reach Ollama at ${base}. Check that it's running, and that it allows this page: set OLLAMA_ORIGINS=${origin} and restart Ollama (for the Mac app: launchctl setenv OLLAMA_ORIGINS "${origin}", then quit and reopen it).`;
}

// ------------------------------------------------------------------ backends

const AiRunners = {
  /** WebLLM on WebGPU, in this tab. The engine is kept for the next run with the same model. */
  async webllm({ system, user, schema, settings, onStatus, signal }) {
    if (!(await AiAnalysis.hasWebGPU())) throw new AiError("This browser can't run models on the GPU (no WebGPU). Try Chrome or Edge on a recent computer, or use Ollama.");
    const webllm = await import(WEBLLM_URL);
    const A = AiAnalysis;
    if (!A.engine || A.engineModel !== settings.webllmModel) {
      if (A.engine && A.engine.unload) await A.engine.unload();
      A.engine = null;
      onStatus('Loading the model…');
      A.engine = await webllm.CreateMLCEngine(settings.webllmModel, {
        initProgressCallback: (r) => onStatus(`Loading the model (downloaded once, then cached)… ${Math.round((r.progress || 0) * 100)}%`),
      });
      A.engineModel = settings.webllmModel;
    }
    if (signal.aborted) return '';
    signal.addEventListener('abort', () => A.engine && A.engine.interruptGenerate && A.engine.interruptGenerate());
    onStatus('Reading the conversation…');
    const reply = await A.engine.chat.completions.create({
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      response_format: { type: 'json_object', schema: JSON.stringify(schema) },
      temperature: 0.2,
      max_tokens: 1000,
    });
    return reply.choices[0].message.content;
  },

  /** Ollama's chat API on this computer (or wherever the user points it). */
  async ollama({ system, user, schema, settings, onStatus, signal }) {
    const base = settings.ollamaUrl.replace(/\/+$/, '');
    const model = settings.ollamaModel.trim();
    if (!model) throw new AiError('Enter an Ollama model name, or click Connect to pick one.');
    const { path, body } = ollamaRequest({ model, system, user, schema });
    onStatus(`Reading the conversation with ${model}…`);
    let res;
    try {
      res = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
    } catch (e) {
      if (signal.aborted) return '';
      throw new AiError(ollamaUnreachable(base, location.origin));
    }
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 300);
      if (res.status === 404) throw new AiError(`Ollama doesn't have the model "${model}". Run "ollama pull ${model}", or click Connect to pick one you have.`);
      throw new AiError(`Ollama returned an error (${res.status})${detail ? `: ${detail}` : ''}`);
    }
    const data = await res.json();
    return (data.message && data.message.content) || '';
  },

  /** LM Studio's OpenAI-compatible chat API on this computer (or wherever the user points it). */
  async lmstudio({ system, user, schema, settings, onStatus, signal }) {
    const base = settings.lmstudioUrl.replace(/\/+$/, '');
    const model = settings.lmstudioModel.trim();
    if (!model) throw new AiError('Enter an LM Studio model, or click Connect to pick one.');
    const { path, body } = lmstudioRequest({ model, system, user, schema, reasoningOff: !!(AiAnalysis.lmModel(model) || {}).thinks });
    onStatus(`Reading the conversation with ${model}… (LM Studio loads the model first if it isn't loaded)`);
    let res;
    try {
      res = await fetch(base + path, { method: 'POST', headers: lmstudioHeaders(settings, true), body: JSON.stringify(body), signal });
    } catch (e) {
      if (signal.aborted) return '';
      throw new AiError(lmstudioUnreachable(base));
    }
    if (res.status === 401 || res.status === 403) throw new AiError(LMSTUDIO_TOKEN_ERROR);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      let detail = text;
      try {
        const err = JSON.parse(text).error;
        detail = (err && err.message) || (typeof err === 'string' ? err : text);
      } catch (e) { /* not JSON: keep the text */ }
      if (/not found|no model|invalid model|failed to load/i.test(detail)) throw new AiError(`LM Studio couldn't use the model "${model}"${detail ? ` (${detail.slice(0, 200)})` : ''}. Click Connect to pick one you have.`);
      throw new AiError(`LM Studio returned an error (${res.status})${detail ? `: ${detail.slice(0, 300)}` : ''}`);
    }
    const data = await res.json();
    // Learn this model's characters per token from what LM Studio counted (spec 002, R16).
    const ratio = lmstudioMeasuredRatio(system.length, user.length, data.usage && data.usage.prompt_tokens);
    if (ratio) AiAnalysis.noteLmRatio(model, ratio);
    const choice = data.choices && data.choices[0];
    if (choice && choice.finish_reason === 'length') throw new AiError("The model's reply ran out of room and was cut off. Load the model with a longer context in LM Studio, or pick a shorter date range.");
    return lmstudioReplyText(choice);
  },

  /** Claude through the Anthropic SDK, straight from this browser under the user's key. */
  async claude({ system, user, schema, settings, onStatus, signal }) {
    const key = settings.claudeKey.trim();
    if (!key) throw new AiError('Enter your Anthropic API key first.');
    const { default: Anthropic } = await import(ANTHROPIC_SDK_URL);
    const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
    const { beta, params } = claudeRequest({ model: settings.claudeModel, system, user, schema });
    onStatus('Claude is reading the conversation… (this can take a minute)');
    let msg;
    try {
      msg = beta ? await client.beta.messages.create(params, { signal }) : await client.messages.create(params, { signal });
    } catch (err) {
      if (signal.aborted) return '';
      if (err instanceof Anthropic.AuthenticationError) throw new AiError('That API key was rejected. Check it in the Claude Console and try again.');
      if (err instanceof Anthropic.PermissionDeniedError) throw new AiError("That API key isn't allowed to use this model.");
      if (err instanceof Anthropic.RateLimitError) throw new AiError('Anthropic is rate-limiting this key. Wait a minute and try again.');
      if (err instanceof Anthropic.BadRequestError) throw new AiError(`Anthropic couldn't take the request: ${err.message}`);
      if (err instanceof Anthropic.APIConnectionError) throw new AiError("Couldn't reach Anthropic. Check your connection and try again.");
      if (err instanceof Anthropic.APIError) throw new AiError(`Anthropic returned an error (${err.status}): ${err.message}`);
      throw err;
    }
    if (msg.stop_reason === 'refusal') throw new AiError('Claude declined to analyze this conversation.');
    if (msg.stop_reason === 'max_tokens') throw new AiError("Claude's reply ran too long and was cut off. Try a shorter date range or a narrower question.");
    return msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  },
};

// ------------------------------------------------------------------ the card

const AI_SETTINGS_KEY = 'yapa-ai';

const AiAnalysis = {
  backend: 'webllm',
  settings: {
    webllmModel: WEBLLM_MODELS[0].id,
    ollamaUrl: 'http://localhost:11434',
    ollamaModel: '',
    lmstudioUrl: 'http://localhost:1234',
    lmstudioModel: '',
    lmstudioToken: '', // memory only: never saved
    lmRatios: {}, // LM Studio model key -> measured characters per token
    claudeModel: CLAUDE_MODELS[0].id,
    claudeKey: '', // memory only: never saved
  },
  lmModels: null, // LM Studio's language models from the last listing ({ key, loaded, context, thinks, names })
  lmDetected: null, // { url, at } of the last automatic model listing
  lmDetecting: false,
  redactTouched: false,
  busy: false,
  run: 0,
  abort: null,
  engine: null,
  engineModel: null,
  gpu: null, // Promise<boolean>
  report: null, // { id }: the conversation() id it belongs to

  hasWebGPU() {
    if (!this.gpu) {
      this.gpu = !navigator.gpu
        ? Promise.resolve(false)
        : navigator.gpu.requestAdapter().then((a) => !!a, () => false);
    }
    return this.gpu;
  },

  /** The selected conversation and how to name its people, or null for "All conversations". */
  conversation() {
    const key = S.filter.contact;
    if (key === 'all') return null;
    const c = Data.contacts.get(key) || {};
    const group = key.startsWith('g:');
    const msgs = inRange(baseMessages());
    // A linked person (spec 005) goes by the names of all its conversations.
    const parts = c.person ? c.threads.map((k) => Data.contacts.get(k)).filter(Boolean) : [c];
    const own = [...new Set(parts.filter((p) => hasOwner(p.s)).map((p) => S.owners[p.s].name).filter(Boolean))];
    const names = [...new Set([c.name, ...parts.flatMap((p) => [p.name, ...(p.addr ? p.addr.split('~') : []), ...(p.members || []).map(([n]) => n)])])]
      .filter((n) => n && !own.includes(n));
    return {
      key,
      // What a report belongs to: a linked person's report goes stale when its conversations change.
      id: c.person ? `${key}|${c.threads.join('|')}` : key,
      msgs,
      group,
      title: plainName(key),
      names,
      ownNames: own,
      speakerOf: (m) => (group ? (m.sn || m.sk ? senderLabel(m.sn || m.sk) : 'Someone') : plainName(key)),
    };
  },

  /** LM Studio's loaded context for the chosen model, or null when the server hasn't said. */
  /** The listed LM Studio model `name` (default: the model field) means, or null. */
  lmModel(name = this.settings.lmstudioModel) {
    return lmstudioFind(this.lmModels, name);
  },

  lmstudioContext() {
    const m = this.lmModel();
    return (m && m.context) || null;
  },

  /** Characters per token for the chosen LM Studio model: measured, or the default. */
  lmstudioRatio() {
    const m = this.lmModel();
    return this.settings.lmRatios[m ? m.key : this.settings.lmstudioModel.trim()] || LMSTUDIO_CHARS_PER_TOKEN;
  },

  noteLmRatio(model, ratio) {
    const m = this.lmModel(model);
    this.settings.lmRatios[m ? m.key : model] = ratio;
    this.save();
  },

  /** List LM Studio's models without a click (spec 002, R12): at most every 30 s per server. */
  autoDetectLm() {
    const url = this.settings.lmstudioUrl;
    const last = this.lmDetected;
    if (this.lmDetecting || (last && last.url === url && Date.now() - last.at < 30000)) return;
    this.lmDetecting = true;
    this.lmDetected = { url, at: Date.now() };
    this.connectLmStudio({ quiet: true }).finally(() => { this.lmDetecting = false; });
  },

  budget() {
    if (this.backend === 'lmstudio') return lmstudioBudget(this.lmstudioContext() || LMSTUDIO_DEFAULT_CONTEXT, this.lmstudioRatio());
    return AI_BACKENDS[this.backend].budgetChars;
  },

  transcript(conv) {
    return buildTranscript(conv.msgs, {
      budgetChars: this.budget(),
      speakerOf: conv.speakerOf,
      title: conv.title,
      redact: $('#aiRedact').checked,
      names: conv.names,
      ownNames: conv.ownNames,
      group: conv.group,
    });
  },

  /** Brings the card in line with the selection and settings. */
  render() {
    $$('#aiBackendSeg button').forEach((b) => b.classList.toggle('on', b.dataset.backend === this.backend));
    $$('#aiForm .ai-settings').forEach((el) => { el.hidden = el.dataset.for !== this.backend; });
    const conv = this.conversation();
    $('#aiPick').hidden = !!conv;
    $('#aiForm').classList.toggle('disabled', !conv);
    if (this.report && (!conv || this.report.id !== conv.id)) this.clearReport();
    const t = conv && this.transcript(conv);
    // A pending Claude confirmation describes what was selected then: drop it if that changed.
    if (this.pending && (!conv || this.pending.t.text !== t.text)) this.hideStatus();
    if (!conv) {
      $('#aiScope').textContent = '';
      $('#aiRun').disabled = true;
      return;
    }
    let fits = '';
    if (t.count < t.total) {
      if (this.backend === 'webllm') fits = ': as much as fits a model in this browser';
      else if (this.backend === 'lmstudio') {
        fits = `: ${lmstudioScopeNote(this.lmModels, this.settings.lmstudioModel)}`;
      } else fits = `: as much as fits in one request to ${AI_BACKENDS[this.backend].label}`;
    }
    if (this.backend === 'lmstudio') {
      // Big prompts take a while to read: ~470 tokens a second for a 27B model on a Mac.
      const tokens = Math.round(t.text.length / this.lmstudioRatio() / 1000) * 1000;
      if (tokens >= 20000) fits += `. That's about ${fmtNum(tokens)} tokens, so the model may take several minutes to read it`;
      this.autoDetectLm();
    }
    $('#aiScope').textContent = !t.count
      ? 'No messages with text in this date range.'
      : `Reads ${t.count === t.total ? `all ${fmtNum(t.count)}` : `the latest ${fmtNum(t.count)} of ${fmtNum(t.total)}`} messages (${fmtDayRange(t.first, t.last)})${fits}.`;
    $('#aiRun').disabled = this.busy || !t.count;
    if (this.backend === 'webllm') {
      this.hasWebGPU().then((ok) => {
        $('#aiWebllmNote').textContent = ok
          ? 'Runs on this computer’s GPU. The model downloads once, then the browser keeps it. Nothing leaves this device.'
          : 'This browser can’t run models on the GPU (no WebGPU). Try Chrome or Edge on a recent computer, or use Ollama.';
        $('#aiWebllmNote').classList.toggle('ai-error', !ok);
        if (!ok && this.backend === 'webllm') $('#aiRun').disabled = true;
      });
    }
  },

  setBackend(backend) {
    this.backend = backend;
    if (!this.redactTouched) $('#aiRedact').checked = backend === 'claude';
    this.hideStatus();
    this.save();
    this.render();
  },

  /** Analyze clicked: Claude asks first (spec 002, R5); local backends just run. */
  async analyze() {
    const conv = this.conversation();
    if (!conv || this.busy) return;
    this.readSettings();
    if (this.backend === 'lmstudio') {
      // The budget follows the model's loaded context (spec 002, R12): ask again, it may
      // have changed. This also swaps out a model the server doesn't have (AC21).
      await this.connectLmStudio({ quiet: true });
    }
    const t = this.transcript(conv);
    if (!t.count) return;
    if (this.backend !== 'claude') return this.send(conv, t);
    if (!this.settings.claudeKey.trim()) return this.showStatus(html`<p class="ai-error">Enter your Anthropic API key first.</p>`);
    const model = CLAUDE_MODELS.find((m) => m.id === this.settings.claudeModel) || CLAUDE_MODELS[0];
    const est = estimateClaude(analysisPrompt(t.text, $('#aiQuestion').value).length + ANALYSIS_SYSTEM.length, model.id);
    const cost = est.cost < 0.01 ? 'under $0.01' : `about $${est.cost.toFixed(2)}`;
    this.showStatus(html`<div class="ai-confirm">
      <p><b>Send ${fmtNum(t.count)} messages (${fmtDayRange(t.first, t.last)}) to Anthropic?</b> About ${fmtNum(Math.round(est.tokens / 1000) * 1000)} tokens: ${cost} with ${model.label}, plus the reply. ${$('#aiRedact').checked ? 'Names, numbers, emails and links are hidden (best effort).' : 'Names, numbers, emails and links are included as they are.'}</p>
      <details id="aiPreview"><summary>See exactly what will be sent</summary><pre></pre></details>
      <div class="ai-actions"><button class="btn small primary" type="button" data-ai="send">Send to Claude</button><button class="btn small ghost" type="button" data-ai="cancel">Cancel</button></div>
    </div>`);
    $('#aiPreview').ontoggle = (e) => {
      const pre = e.target.querySelector('pre');
      if (e.target.open && !pre.textContent) pre.textContent = `${ANALYSIS_SYSTEM}\n\n---\n\n${analysisPrompt(t.text, $('#aiQuestion').value)}`;
    };
    this.pending = { conv, t };
  },

  async send(conv, t) {
    const run = ++this.run;
    const backend = this.backend;
    this.busy = true;
    this.pending = null;
    this.abort = new AbortController();
    const question = $('#aiQuestion').value;
    $('#aiRun').disabled = true;
    const onStatus = (text) => {
      if (run === this.run) this.showStatus(html`<p><span class="spinner" aria-hidden="true"></span>${text}</p><div class="ai-actions"><button class="btn small ghost" type="button" data-ai="stop">Stop</button></div>`);
    };
    onStatus('Starting…');
    try {
      const raw = await AiRunners[backend]({
        system: ANALYSIS_SYSTEM,
        user: analysisPrompt(t.text, question),
        schema: ANALYSIS_SCHEMA,
        settings: { ...this.settings },
        onStatus,
        signal: this.abort.signal,
      });
      if (run !== this.run) return;
      const report = parseAnalysis(raw, t);
      this.hideStatus();
      // The selection changed while the model read (another conversation, or a person's links): drop the result.
      const now = this.conversation();
      if (!now || now.id !== conv.id) return;
      this.showReport(conv.id, report, { backend, t, question });
    } catch (err) {
      if (run !== this.run) return;
      if (!(err instanceof AiError)) console.warn('AI analysis failed:', err);
      const msg = err instanceof AiError ? err.message : `Something went wrong: ${(err && err.message) || err}`;
      this.showStatus(html`<p class="ai-error">${msg}</p>`);
    } finally {
      if (run === this.run) {
        this.busy = false;
        this.render();
      }
    }
  },

  stop() {
    this.run++;
    if (this.abort) this.abort.abort();
    this.busy = false;
    this.hideStatus();
    this.render();
  },

  showReport(id, r, { backend, t, question }) {
    const who = backend === 'webllm' ? `${AI_BACKENDS.webllm.label} (${this.settings.webllmModel.replace(/-q4f16.*$/, '')})`
      : backend === 'ollama' ? `Ollama (${this.settings.ollamaModel})`
        : backend === 'lmstudio' ? `LM Studio (${this.settings.lmstudioModel})`
        : (CLAUDE_MODELS.find((m) => m.id === this.settings.claudeModel) || CLAUDE_MODELS[0]).label;
    const moodWord = { positive: 'Positive', negative: 'Negative', mixed: 'Mixed', neutral: 'Neutral' };
    const day = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    const report = html`
      ${question.trim() && r.answer ? html`<section class="ai-answer"><h3>${question.trim()}</h3><p>${r.answer}</p></section>` : ''}
      ${r.summary ? html`<h3>Summary</h3><p>${r.summary}</p>` : ''}
      ${r.tone.length ? html`<h3>Tone</h3><ul class="ai-tone">${r.tone.map((x) => html`<li><b>${x.speaker}</b> ${x.description}</li>`)}</ul>` : ''}
      ${r.moments.length ? html`<h3>Moments</h3><ol class="ai-moments">${r.moments.map((m) => html`<li><button type="button" class="ai-date" data-day="${m.date}" title="Read that day">${day(m.date)}</button><span class="ai-dot ${m.mood}" title="${moodWord[m.mood]}"></span><span><b>${m.title}</b>${m.detail ? `: ${m.detail}` : ''}</span></li>`)}</ol>` : ''}
      ${r.topics.length ? html`<h3>Topics</h3><div class="ai-topics">${r.topics.map((x) => html`<span class="mw">${x}</span>`)}</div>` : ''}
      <p class="mood-note">By ${who}, from the ${t.count === t.total ? '' : 'latest '}${fmtNum(t.count)} messages (${fmtDayRange(t.first, t.last)}).${r.dropped ? ` ${r.dropped} moment${r.dropped === 1 ? '' : 's'} with dates outside them left out.` : ''} AI can get things wrong: check the messages.</p>`;
    this.report = { id };
    $('#aiReport').innerHTML = report;
    $('#aiReport').hidden = false;
  },

  clearReport() {
    this.report = null;
    $('#aiReport').innerHTML = '';
    $('#aiReport').hidden = true;
  },

  showStatus(html) {
    $('#aiStatus').innerHTML = html;
    $('#aiStatus').hidden = false;
  },

  hideStatus() {
    $('#aiStatus').innerHTML = '';
    $('#aiStatus').hidden = true;
    this.pending = null;
  },

  async connectOllama() {
    this.readSettings();
    const base = this.settings.ollamaUrl.replace(/\/+$/, '');
    const note = $('#aiOllamaNote');
    note.classList.remove('ai-error');
    note.textContent = 'Connecting…';
    try {
      const res = await fetch(`${base}/api/tags`);
      if (!res.ok) throw new Error(String(res.status));
      const names = ((await res.json()).models || []).map((m) => m.name).filter(Boolean);
      $('#aiOllamaModels').innerHTML = html`${names.map((n) => html`<option value="${n}">`)}`;
      if (names.length && !$('#aiOllamaModel').value.trim()) $('#aiOllamaModel').value = names[0];
      this.readSettings();
      this.save();
      note.textContent = names.length
        ? `Connected. Installed models: ${names.join(', ')}.`
        : 'Connected, but no models are installed. Run "ollama pull llama3.2" (or another model) first.';
    } catch (e) {
      note.textContent = ollamaUnreachable(base, location.origin);
      note.classList.add('ai-error');
    }
  },

  /**
   * LM Studio's language models ({ key, loaded, context }), remembering each loaded
   * model's context. Native list first; servers before 0.4 only have /v1/models.
   */
  async fetchLmModels() {
    const base = this.settings.lmstudioUrl.replace(/\/+$/, '');
    const get = async (path) => {
      let res;
      try {
        res = await fetch(base + path, { headers: lmstudioHeaders(this.settings) });
      } catch (e) {
        throw new AiError(lmstudioUnreachable(base));
      }
      if (res.status === 401 || res.status === 403) throw new AiError(LMSTUDIO_TOKEN_ERROR);
      return res;
    };
    let res = await get('/api/v1/models');
    if (res.status === 404) res = await get('/v1/models');
    if (!res.ok) throw new AiError(`LM Studio returned an error (${res.status}) listing its models.`);
    const models = lmstudioModels(await res.json());
    this.lmModels = models;
    return models;
  },

  /** Connect clicked, or (quiet) the automatic listing: a failure then leaves the note as it was. */
  async connectLmStudio({ quiet = false } = {}) {
    this.readSettings();
    const note = $('#aiLmstudioNote');
    if (!quiet) {
      note.classList.remove('ai-error');
      note.textContent = 'Connecting…';
    }
    try {
      const models = await this.fetchLmModels();
      $('#aiLmstudioModels').innerHTML = html`${models.map((m) => html`<option value="${m.key}">`)}`;
      // Fill in a model if there's none, and replace one the server doesn't list, which
      // LM Studio would reject (spec 002, R12). A listed, unloaded model is kept.
      const field = $('#aiLmstudioModel');
      const typed = field.value.trim();
      let switched = '';
      if (models.length && (!typed || !lmstudioFind(models, typed))) {
        const pick = (models.find((m) => m.loaded) || models[0]).key;
        if (typed) switched = `LM Studio doesn't have "${typed}", so switched to ${pick}. `;
        field.value = pick;
      }
      this.readSettings();
      this.save();
      const loaded = models.filter((m) => m.loaded);
      const rest = models.filter((m) => !m.loaded);
      note.textContent = !models.length
        ? 'Connected, but LM Studio has no language models yet. Download one in LM Studio first.'
        : `${switched}Connected. ${loaded.length ? `Loaded: ${loaded.map((m) => (m.context ? `${m.key} (${fmtNum(m.context)}-token context)` : m.key)).join(', ')}. ` : ''}${rest.length ? `${loaded.length ? 'Also downloaded' : 'Downloaded'}: ${rest.map((m) => m.key).join(', ')}.` : ''}`.trim();
      note.classList.remove('ai-error');
    } catch (e) {
      if (quiet) return;
      note.textContent = e instanceof AiError ? e.message : lmstudioUnreachable(this.settings.lmstudioUrl);
      note.classList.add('ai-error');
    }
    this.render();
  },

  readSettings() {
    this.settings.webllmModel = $('#aiWebllmModel').value;
    this.settings.ollamaUrl = $('#aiOllamaUrl').value.trim() || 'http://localhost:11434';
    this.settings.ollamaModel = $('#aiOllamaModel').value.trim();
    this.settings.lmstudioUrl = $('#aiLmstudioUrl').value.trim() || 'http://localhost:1234';
    this.settings.lmstudioModel = $('#aiLmstudioModel').value.trim();
    this.settings.lmstudioToken = $('#aiLmstudioToken').value; // memory only: never saved
    this.settings.claudeModel = $('#aiClaudeModel').value;
    this.settings.claudeKey = $('#aiClaudeKey').value; // memory only: never saved
  },

  save() {
    const { claudeKey, lmstudioToken, ...keep } = this.settings;
    try { localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify({ backend: this.backend, ...keep })); } catch (e) { /* storage unavailable */ }
  },

  load() {
    try {
      const saved = JSON.parse(localStorage.getItem(AI_SETTINGS_KEY) || 'null');
      if (saved) {
        if (AI_BACKENDS[saved.backend]) this.backend = saved.backend;
        for (const k of ['webllmModel', 'ollamaUrl', 'ollamaModel', 'lmstudioUrl', 'lmstudioModel', 'claudeModel']) if (typeof saved[k] === 'string') this.settings[k] = saved[k];
        if (saved.lmRatios && typeof saved.lmRatios === 'object') {
          for (const [k, v] of Object.entries(saved.lmRatios)) if (typeof v === 'number' && v > 0.5 && v < 10) this.settings.lmRatios[k] = v;
        }
      }
    } catch (e) { /* storage unavailable or corrupt: defaults */ }
    if (!WEBLLM_MODELS.some((m) => m.id === this.settings.webllmModel)) this.settings.webllmModel = WEBLLM_MODELS[0].id;
    if (!CLAUDE_MODELS.some((m) => m.id === this.settings.claudeModel)) this.settings.claudeModel = CLAUDE_MODELS[0].id;
  },

  init() {
    this.load();
    $('#aiWebllmModel').innerHTML = html`${WEBLLM_MODELS.map((m) => html`<option value="${m.id}">${m.label}</option>`)}`;
    $('#aiClaudeModel').innerHTML = html`${CLAUDE_MODELS.map((m) => html`<option value="${m.id}">${m.label}</option>`)}`;
    $('#aiWebllmModel').value = this.settings.webllmModel;
    $('#aiClaudeModel').value = this.settings.claudeModel;
    $('#aiOllamaUrl').value = this.settings.ollamaUrl;
    $('#aiOllamaModel').value = this.settings.ollamaModel;
    $('#aiLmstudioUrl').value = this.settings.lmstudioUrl;
    $('#aiLmstudioModel').value = this.settings.lmstudioModel;
    $('#aiRedact').checked = this.backend === 'claude';
    $('#aiOllamaNote').textContent = `Ollama has to allow this page: start it with OLLAMA_ORIGINS=${location.origin}. Your browser may ask to allow access to your local network.`;

    $('#aiBackendSeg').onclick = (e) => {
      const b = e.target.dataset.backend;
      if (b && b !== this.backend && !this.busy) this.setBackend(b);
    };
    for (const sel of ['#aiWebllmModel', '#aiClaudeModel', '#aiOllamaUrl', '#aiOllamaModel', '#aiLmstudioUrl', '#aiLmstudioModel']) {
      // The LM Studio model decides the transcript budget, so the scope line follows it.
      $(sel).onchange = () => { this.readSettings(); this.save(); this.render(); };
    }
    $('#aiRedact').onchange = () => {
      this.redactTouched = true;
      this.hideStatus();
      this.render();
    };
    $('#aiOllamaConnect').onclick = () => this.connectOllama();
    $('#aiLmstudioConnect').onclick = () => this.connectLmStudio();
    $('#aiRun').onclick = () => this.analyze();
    $('#aiQuestion').onkeydown = (e) => { if (e.key === 'Enter') this.analyze(); };
    $('#aiStatus').onclick = (e) => {
      const a = e.target.dataset.ai;
      if (a === 'send' && this.pending) this.send(this.pending.conv, this.pending.t);
      else if (a === 'cancel') this.hideStatus();
      else if (a === 'stop') this.stop();
    };
    $('#aiReport').onclick = (e) => {
      const b = e.target.closest('[data-day]');
      if (!b) return;
      const [y, m, d] = b.dataset.day.split('-').map(Number);
      readDay(new Date(y, m - 1, d).getTime());
    };
    this.render();
  },
};

/** "Mar 2 – Nov 12, 2024" for two "YYYY-MM-DD" days. */
function fmtDayRange(first, last) {
  if (!first) return 'no messages';
  const d = (iso) => new Date(`${iso}T12:00:00`);
  const a = d(first);
  const b = d(last);
  const full = { year: 'numeric', month: 'short', day: 'numeric' };
  if (first === last) return a.toLocaleDateString(undefined, full);
  const sameYear = a.getFullYear() === b.getFullYear();
  return `${a.toLocaleDateString(undefined, sameYear ? { month: 'short', day: 'numeric' } : full)} – ${b.toLocaleDateString(undefined, full)}`;
}
