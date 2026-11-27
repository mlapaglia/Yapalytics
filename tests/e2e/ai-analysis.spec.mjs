/*
 * specs/002-ai-conversation-analysis.md in the browser. Nothing real is called: Ollama is
 * answered by a route on localhost:11434, and the Anthropic SDK and WebLLM are replaced
 * by small fake modules served at their CDN URLs, which record what they were asked.
 * The runners' requests, replies and errors are unit tests (ai-analysis.test.mjs: AC6,
 * AC8, AC11, AC15, AC17, AC19, AC20); these keep the card and one run per backend.
 */
import { test, expect, loadDemo, scrollTo, openTab } from './fixtures.mjs';
import { inApp } from './state.mjs';

const OLLAMA = 'http://localhost:11434';
const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.1.0/+esm';
const WEBLLM_URL = 'https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.86/lib/index.js';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };

/** A report whose moments fall on the transcript's first and last days, plus one outside it. */
const report = (first, last, answer = '') => ({
  summary: 'Mostly weekend plans and running jokes.',
  tone: [{ speaker: 'You', description: 'Warm and quick to joke.' }, { speaker: 'Them', description: 'Chatty, a little anxious.' }],
  moments: [
    { date: last, title: 'Booked the cabin', detail: 'Plans finally came together.', mood: 'positive' },
    { date: first, title: 'First message here', detail: 'Where the transcript starts.', mood: 'neutral' },
    { date: '1999-01-01', title: 'Made up', detail: 'Outside the transcript.', mood: 'mixed' },
  ],
  topics: ['weekend plans', 'work'],
  answer,
});

/** A fake @anthropic-ai/sdk: records each call on window.__claude and answers per window.__claudeMode. */
const FAKE_SDK = `
class APIError extends Error { constructor(status, message) { super(message); this.status = status; } }
class AuthenticationError extends APIError {}
class PermissionDeniedError extends APIError {}
class RateLimitError extends APIError {}
class BadRequestError extends APIError {}
class APIConnectionError extends APIError {}
export default class Anthropic {
  constructor(opts) {
    const create = (beta) => async (params, requestOptions) => {
      (window.__claude = window.__claude || []).push({ opts: { apiKey: opts.apiKey, dangerouslyAllowBrowser: opts.dangerouslyAllowBrowser }, beta, params });
      const mode = window.__claudeMode || 'ok';
      if (mode === 'auth') throw new AuthenticationError(401, 'invalid x-api-key');
      if (mode === 'refusal') return { stop_reason: 'refusal', content: [] };
      return { stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify(window.__claudeReport) }] };
    };
    this.messages = { create: create(false) };
    this.beta = { messages: { create: create(true) } };
  }
}
Object.assign(Anthropic, { APIError, AuthenticationError, PermissionDeniedError, RateLimitError, BadRequestError, APIConnectionError });
`;

/** A fake @mlc-ai/web-llm whose engine answers with window.__webllmReport. */
const FAKE_WEBLLM = `
export async function CreateMLCEngine(model, config) {
  window.__webllmModel = model;
  for (const progress of [0, 0.5, 1]) config.initProgressCallback({ progress, text: '' });
  return {
    unload: async () => {},
    interruptGenerate: () => {},
    chat: { completions: { create: async (req) => { window.__webllm = req; return { choices: [{ message: { content: JSON.stringify(window.__webllmReport) } }] }; } } },
  };
}`;

/** Loads the demo, picks its busiest 1-on-1 conversation and scrolls to the card. Returns its key, name and transcript days. */
async function openCard(page, backend) {
  await loadDemo(page);
  const key = await inApp(page, (app) => app.topRows.find((r) => !r.key.startsWith('g:')).key);
  await page.selectOption('#contactSel', key);
  await scrollTo(page, '#aiCard');
  if (backend) await page.click(`#aiBackendSeg [data-backend="${backend}"]`);
  await expect(page.locator('#aiScope')).toContainText('messages');
  return inApp(page, (app, k) => {
    const t = AiAnalysis.transcript(AiAnalysis.conversation());
    return { key: k, name: app.plainName(k), first: t.first, last: t.last, count: t.count };
  }, key);
}

/** Answers Ollama's API: /api/tags lists models, /api/chat replies with `content`. Records chat bodies. */
async function fakeOllama(page, content) {
  const bodies = [];
  await page.route(`${OLLAMA}/**`, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    if (req.url().endsWith('/api/tags')) return route.fulfill({ headers: CORS, json: { models: [{ name: 'llama3.2:latest' }, { name: 'qwen3:4b' }] } });
    bodies.push(req.postDataJSON());
    return route.fulfill({ headers: CORS, json: { message: { role: 'assistant', content: typeof content === 'function' ? content() : content } } });
  });
  return bodies;
}

const reportText = (page) => page.locator('#aiReport');

test.describe('spec 002: AI conversation analysis', () => {
  test('AC1: with all conversations selected, it asks for one and can’t run', async ({ page }) => {
    await loadDemo(page);
    await scrollTo(page, '#aiCard');
    await expect(page.locator('#aiPick')).toBeVisible();
    await expect(page.locator('#aiForm')).toBeHidden();
    await expect(page.locator('#aiRun')).toBeDisabled();
  });

  test('AC2: the scope line names the messages and dates the transcript covers', async ({ page }) => {
    const c = await openCard(page, 'ollama');
    await expect(page.locator('#aiScope')).toContainText(new RegExp(`Reads (all|the latest) ${c.count.toLocaleString('en-US')} `));
    // In the browser the budget is smaller, so it reads fewer of the same messages.
    await page.click('#aiBackendSeg [data-backend="webllm"]');
    const small = await page.evaluate(() => AiAnalysis.transcript(AiAnalysis.conversation()));
    expect(small.count).toBeLessThanOrEqual(c.count);
    expect(small.last).toBe(c.last);
  });

  test('AC4, AC5: Ollama gets the transcript and schema; the report renders and dates open that day', async ({ page }) => {
    let c;
    const bodies = await fakeOllama(page, () => JSON.stringify(report(c.first, c.last, 'Yes, in the spring.')));
    c = await openCard(page, 'ollama');
    await page.click('#aiOllamaConnect');
    await expect(page.locator('#aiOllamaNote')).toContainText('llama3.2:latest, qwen3:4b');
    await expect(page.locator('#aiOllamaModel')).toHaveValue('llama3.2:latest');
    await page.fill('#aiQuestion', 'Did we ever plan a trip?');
    await page.click('#aiRun');

    await expect(reportText(page)).toContainText('Mostly weekend plans and running jokes.');
    expect(bodies).toHaveLength(1);
    const body = bodies[0];
    expect(body).toMatchObject({ model: 'llama3.2:latest', stream: false });
    expect(body.format.required).toEqual(['summary', 'tone', 'moments', 'topics', 'answer']);
    expect(body.messages[1].content).toContain(`# Conversation with ${c.name}`);
    expect(body.messages[1].content).toContain('Question: Did we ever plan a trip?');

    await expect(reportText(page).locator('.ai-answer')).toContainText('Did we ever plan a trip?');
    await expect(reportText(page).locator('.ai-answer')).toContainText('Yes, in the spring.');
    await expect(reportText(page).locator('.ai-tone li')).toHaveCount(2);
    await expect(reportText(page).locator('.ai-moments li')).toHaveCount(2); // the made-up date is dropped
    await expect(reportText(page)).toContainText('1 moment with dates outside them left out');
    await expect(reportText(page).locator('.ai-topics .mw')).toHaveText(['weekend plans', 'work']);
    await expect(reportText(page)).toContainText('By Ollama (llama3.2:latest)');

    // AC5: the first moment (sorted by date) opens its day in the message list.
    await reportText(page).locator('.ai-date').first().click();
    const range = await inApp(page, (app) => ({ from: app.filter.from, to: app.filter.to }));
    const [y, m, d] = c.first.split('-').map(Number);
    expect(range.from).toBe(await page.evaluate(([yy, mm, dd]) => new Date(yy, mm - 1, dd).getTime(), [y, m, d]));
    expect(range.to - range.from).toBeLessThan(86400000);
    // The list shows exactly that day's messages. The demo is dated from today, so the
    // first day may hold a single message: "1 message".
    const onDay = await inApp(page, (app) => app.selection().length);
    expect(onDay).toBeGreaterThan(0);
    await expect(page.locator('#sec-messages')).toBeVisible(); // spec 003 R6: the date opens the Messages tab
    await expect(page.locator('#browserCount')).toHaveText(new RegExp(`^${onDay.toLocaleString('en-US')} messages? · showing latest`));
    await openTab(page, 'sec-ai');
    await expect(reportText(page)).toBeVisible(); // same conversation, so the report stays
  });

  test('AC3: redaction keeps the name out of what is sent, and turning it off puts it back', async ({ page }) => {
    let c;
    const bodies = await fakeOllama(page, () => JSON.stringify(report(c.first, c.last)));
    c = await openCard(page, 'ollama');
    await page.fill('#aiOllamaModel', 'llama3.2');
    await expect(page.locator('#aiRedact')).not.toBeChecked(); // off by default when nothing leaves the device
    await page.click('#aiRun');
    await expect(reportText(page)).toBeVisible();
    expect(bodies[0].messages[1].content).toContain(c.name);

    await page.check('#aiRedact');
    await page.click('#aiRun');
    await expect.poll(() => bodies.length).toBe(2);
    const sent = bodies[1].messages[1].content;
    expect(sent).not.toContain(c.name);
    for (const part of c.name.split(/\s+/).filter((p) => p.length >= 3)) expect(sent).not.toContain(part);
    expect(sent).toContain('# Conversation with Them');
  });

  test.describe('Claude', () => {
    test.beforeEach(async ({ page }) => {
      await page.route(SDK_URL, (route) => route.fulfill({ body: FAKE_SDK, contentType: 'text/javascript' }));
    });

    test('AC7: Analyze asks first with an estimate, and Cancel sends nothing', async ({ page }) => {
      const sdkRequests = [];
      page.on('request', (r) => { if (r.url() === SDK_URL) sdkRequests.push(r.url()); });
      const c = await openCard(page, 'claude');
      await expect(page.locator('#aiRedact')).toBeChecked(); // on by default for Claude
      await page.fill('#aiClaudeKey', 'sk-ant-test-key');
      await page.click('#aiRun');
      const confirm = page.locator('#aiStatus .ai-confirm');
      await expect(confirm).toContainText(`Send ${c.count.toLocaleString('en-US')} messages`);
      await expect(confirm).toContainText(/About [\d,]+ tokens: (under \$0\.01|about \$\d+\.\d\d) with Claude Opus 5\.5, plus the reply/);
      await expect(confirm).toContainText('Names, numbers, emails and links are hidden');
      await confirm.locator('summary').click();
      await expect(confirm.locator('pre')).toContainText('# Conversation with Them');
      await expect(confirm.locator('pre')).not.toContainText(c.name);
      expect(sdkRequests).toEqual([]);
      await page.click('[data-ai="cancel"]');
      await expect(page.locator('#aiStatus')).toBeHidden();
      expect(await page.evaluate(() => window.__claude)).toBeUndefined();
      expect(sdkRequests).toEqual([]);
    });

    test('AC8: Send uses the key, model and structured output; the report renders; the key isn’t stored', async ({ page }) => {
      const c = await openCard(page, 'claude');
      await page.evaluate((r) => { window.__claudeReport = r; }, report(c.first, c.last));
      await page.fill('#aiClaudeKey', 'sk-ant-test-key');
      await page.click('#aiRun');
      await page.click('[data-ai="send"]');
      await expect(reportText(page)).toContainText('Mostly weekend plans and running jokes.');
      await expect(reportText(page)).toContainText('By Claude Opus 5.5');
      const calls = await page.evaluate(() => window.__claude);
      expect(calls).toHaveLength(1);
      const { opts, beta, params } = calls[0];
      expect(opts).toEqual({ apiKey: 'sk-ant-test-key', dangerouslyAllowBrowser: true });
      expect(beta).toBe(true);
      expect(params).toMatchObject({ model: 'claude-opus-5-5', max_tokens: 16000, fallbacks: 'default', betas: ['server-side-fallback-2026-07-01'] });
      expect(params.output_config.format.type).toBe('json_schema');
      expect(params.messages[0].content).not.toContain(c.name);
      const stored = await page.evaluate(() => Object.keys(localStorage).map((k) => localStorage.getItem(k)).join('\n'));
      expect(stored).not.toContain('sk-ant-test-key');
      expect(stored).toContain('"backend":"claude"');
    });

    test('AC9: a rejected key and a refusal each explain themselves', async ({ page }) => {
      await openCard(page, 'claude');
      await page.fill('#aiClaudeKey', 'sk-ant-bad');
      await page.evaluate(() => { window.__claudeMode = 'auth'; });
      await page.click('#aiRun');
      await page.click('[data-ai="send"]');
      await expect(page.locator('#aiStatus .ai-error')).toHaveText('That API key was rejected. Check it in the Claude Console and try again.');

      await page.evaluate(() => { window.__claudeMode = 'refusal'; });
      await page.click('#aiRun');
      await page.click('[data-ai="send"]');
      await expect(page.locator('#aiStatus .ai-error')).toHaveText('Claude declined to analyze this conversation.');
      await expect(reportText(page)).toBeHidden();
    });
  });

  test.describe('in this browser', () => {
    test('AC10: without WebGPU it says so and won’t run', async ({ page }) => {
      await page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'gpu', { get: () => undefined, configurable: true }));
      await openCard(page, 'webllm');
      await expect(page.locator('#aiWebllmNote')).toContainText('no WebGPU');
      await expect(page.locator('#aiRun')).toBeDisabled();
    });

    test('AC10: with WebGPU it loads the model, then shows the report', async ({ page }) => {
      await page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'gpu', { get: () => ({ requestAdapter: async () => ({}) }), configurable: true }));
      await page.route(WEBLLM_URL, (route) => route.fulfill({ body: FAKE_WEBLLM, contentType: 'text/javascript' }));
      const c = await openCard(page, 'webllm');
      await expect(page.locator('#aiWebllmNote')).toContainText('Nothing leaves this device');
      await page.evaluate((r) => { window.__webllmReport = r; }, report(c.first, c.last));
      await page.selectOption('#aiWebllmModel', 'Llama-3.2-1B-Instruct-q4f16_1-MLC');
      await page.click('#aiRun');
      await expect(reportText(page)).toContainText('Mostly weekend plans and running jokes.');
      await expect(reportText(page)).toContainText('By In this browser (Llama-3.2-1B-Instruct)');
      const req = await page.evaluate(() => ({ model: window.__webllmModel, req: window.__webllm }));
      expect(req.model).toBe('Llama-3.2-1B-Instruct-q4f16_1-MLC');
      expect(req.req.response_format.type).toBe('json_object');
      expect(JSON.parse(req.req.response_format.schema).required).toContain('moments');
      expect(req.req.messages[1].content).toContain(`# Conversation with ${c.name}`);
    });
  });
});

const LMSTUDIO = 'http://localhost:1234';

/**
 * Answers LM Studio's API: /api/v1/models lists two language models (one loaded with a
 * 32K context) and an embedding model; /v1/chat/completions replies with `content`.
 * With `token`, requests without "Bearer <token>" get a 401. Records chat requests.
 */
async function fakeLmStudio(page, { content, token = null } = {}) {
  const chats = [];
  await page.route(`${LMSTUDIO}/**`, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    if (token && req.headers().authorization !== `Bearer ${token}`) {
      return route.fulfill({ status: 401, headers: CORS, json: { error: { message: 'Invalid or missing API token' } } });
    }
    if (req.url().endsWith('/api/v1/models')) {
      return route.fulfill({ headers: CORS, json: { models: [
        { type: 'llm', key: 'google/gemma-3-4b', loaded_instances: [], max_context_length: 131072 },
        { type: 'embedding', key: 'nomic-ai/nomic-embed-text-v1.5', loaded_instances: [] },
        { type: 'llm', key: 'qwen/qwen3-8b', variants: ['qwen/qwen3-8b@q4_k_m'], loaded_instances: [{ id: 'qwen/qwen3-8b', config: { context_length: 32768 } }], max_context_length: 40960 },
      ] } });
    }
    const body = req.postDataJSON();
    chats.push({ body, auth: req.headers().authorization });
    return route.fulfill({ headers: CORS, json: { choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: content() } }] } });
  });
  return chats;
}

test.describe('spec 002: LM Studio', () => {
  test('AC13: Connect lists the language models, loaded first, and a bigger context reads more', async ({ page }) => {
    await fakeLmStudio(page, { content: () => '{}' });
    await openCard(page, 'lmstudio');
    await page.click('#aiLmstudioConnect');
    await expect(page.locator('#aiLmstudioNote')).toHaveText('Connected. Loaded: qwen/qwen3-8b (32,768-token context). Also downloaded: google/gemma-3-4b.');
    await expect(page.locator('#aiLmstudioModel')).toHaveValue('qwen/qwen3-8b');
    expect(await page.locator('#aiLmstudioModels option').evaluateAll((os) => os.map((o) => o.value))).toEqual(['qwen/qwen3-8b', 'google/gemma-3-4b']);
    await expect(page.locator('#aiScope')).toContainText("the model's 32,768-token context in LM Studio");
    const loaded = await page.evaluate(() => AiAnalysis.transcript(AiAnalysis.conversation()).count);
    // Picking the unloaded model goes back to the default budget, which reads less.
    await page.fill('#aiLmstudioModel', 'google/gemma-3-4b');
    await page.locator('#aiLmstudioModel').blur();
    await expect(page.locator('#aiScope')).toContainText("LM Studio's usual 4,096-token context");
    const unloaded = await page.evaluate(() => AiAnalysis.transcript(AiAnalysis.conversation()).count);
    expect(loaded).toBeGreaterThan(unloaded);
  });

  test('AC18: showing the LM Studio backend finds the loaded context without a click', async ({ page }) => {
    await fakeLmStudio(page, { content: () => '{}' });
    await openCard(page, 'lmstudio');
    await expect(page.locator('#aiLmstudioModel')).toHaveValue('qwen/qwen3-8b'); // filled in, since it was empty
    await expect(page.locator('#aiScope')).toContainText("the model's 32,768-token context in LM Studio");
    await expect(page.locator('#aiLmstudioNote')).toContainText('Loaded: qwen/qwen3-8b (32,768-token context)');
    const budget = await page.evaluate(() => AiAnalysis.budget());
    expect(budget).toBe(await page.evaluate(() => lmstudioBudget(32768)));
  });

  test('AC21: a model the server doesn’t have is swapped for the loaded one; an unloaded listed one is kept', async ({ page }) => {
    let c;
    const chats = await fakeLmStudio(page, { content: () => JSON.stringify(report(c.first, c.last)) });
    // Saved from an earlier visit: a model this server doesn't have.
    await page.addInitScript(() => {
      if (!sessionStorage.getItem('seeded')) {
        localStorage.setItem('yapa-ai', JSON.stringify({ backend: 'lmstudio', lmstudioModel: 'old/gone-model' }));
        sessionStorage.setItem('seeded', '1');
      }
    });
    c = await openCard(page);
    await expect(page.locator('#aiLmstudioModel')).toHaveValue('qwen/qwen3-8b');
    await expect(page.locator('#aiLmstudioNote')).toContainText('LM Studio doesn\'t have "old/gone-model", so switched to qwen/qwen3-8b.');
    await expect(page.locator('#aiScope')).toContainText("the model's 32,768-token context in LM Studio");

    // Typed just before Analyze (the automatic listing is throttled): Analyze checks again.
    await page.fill('#aiLmstudioModel', 'qwen/qwen3-8b-typo');
    await page.click('#aiRun');
    await expect(reportText(page)).toContainText('By LM Studio (qwen/qwen3-8b)');
    expect(chats.at(-1).body.model).toBe('qwen/qwen3-8b');

    // Listed but not loaded: LM Studio loads it on request, so it stays.
    await page.fill('#aiLmstudioModel', 'google/gemma-3-4b');
    await page.click('#aiRun');
    await expect.poll(() => chats.length).toBe(2);
    expect(chats.at(-1).body.model).toBe('google/gemma-3-4b');
    await expect(page.locator('#aiLmstudioModel')).toHaveValue('google/gemma-3-4b');
  });

  test('AC14: Analyze posts the transcript with the schema as response_format, and the report renders', async ({ page }) => {
    let c;
    const chats = await fakeLmStudio(page, { content: () => JSON.stringify(report(c.first, c.last)) });
    c = await openCard(page, 'lmstudio');
    await page.fill('#aiLmstudioModel', 'qwen/qwen3-8b'); // no Connect: Analyze asks for the context itself
    await page.click('#aiRun');
    await expect(reportText(page)).toContainText('Mostly weekend plans and running jokes.');
    await expect(reportText(page)).toContainText('By LM Studio (qwen/qwen3-8b)');
    expect(chats).toHaveLength(1);
    const { body, auth } = chats[0];
    expect(auth).toBeUndefined();
    expect(body.model).toBe('qwen/qwen3-8b');
    expect(body.response_format.type).toBe('json_schema');
    expect(body.response_format.json_schema.schema.required).toEqual(['summary', 'tone', 'moments', 'topics', 'answer']);
    expect(body.messages[1].content).toContain(`# Conversation with ${c.name}`);
    // The 32K context was picked up on Analyze, so it read more than the 4K default allows.
    const sent = Number(body.messages[1].content.match(/· ([\d]+) messages/)[1]);
    expect(sent).toBeGreaterThan(await page.evaluate(() => buildTranscript(AiAnalysis.conversation().msgs, { budgetChars: lmstudioBudget(4096) }).count));
  });

  test.describe('with a token required', () => {
    test.use({ failOnConsoleError: false }); // the browser logs the 401s this test provokes

    test('AC15: a required token is asked for, sent as Bearer, and never stored', async ({ page }) => {
      let c;
      const chats = await fakeLmStudio(page, { token: 'lm-secret', content: () => JSON.stringify(report(c.first, c.last)) });
      c = await openCard(page, 'lmstudio');
      await page.fill('#aiLmstudioModel', 'qwen/qwen3-8b');
      await page.click('#aiRun');
      await expect(page.locator('#aiStatus .ai-error')).toContainText('LM Studio asked for an API token');
      await page.click('#aiLmstudioConnect');
      await expect(page.locator('#aiLmstudioNote')).toContainText('LM Studio asked for an API token');

      await page.fill('#aiLmstudioToken', 'lm-secret');
      await page.click('#aiRun');
      await expect(reportText(page)).toContainText('By LM Studio (qwen/qwen3-8b)');
      expect(chats.at(-1).auth).toBe('Bearer lm-secret');
      const stored = await page.evaluate(() => Object.keys(localStorage).map((k) => localStorage.getItem(k)).join('\n'));
      expect(stored).not.toContain('lm-secret');
      expect(stored).toContain('"lmstudioModel":"qwen/qwen3-8b"');
    });
  });
});
