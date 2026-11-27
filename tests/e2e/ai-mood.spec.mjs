/*
 * specs/001-ai-mood-scoring.md in the browser. Transformers.js is replaced by a small
 * fake module served at its CDN URL, so the real worker, batching and UI run without
 * downloading the 126 MB model. The fake reads tone from a few keywords.
 * How a run follows the date range (AC11–AC14) and keeps scores across a Files change
 * (spec 006 AC13) is unit-tested with the model stubbed (ai-mood.test.mjs).
 */
import { test, expect, loadDemo, scrollTo, openTab, addFiles } from './fixtures.mjs';
import { inApp } from './state.mjs';
import { fullExport, resultJson } from '../helpers/telegram.mjs';

const LIB_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2/dist/transformers.min.js';

/** A stand-in for Transformers.js: `delay` ms per batch, so a run can be stopped midway. */
const fakeTransformers = (delay = 0) => `
export const env = {};
export async function pipeline(task, model, opts) {
  if (task !== 'text-classification' || opts.dtype !== 'q8' || opts.device !== 'wasm') throw new Error('unexpected pipeline ' + task + ' ' + model);
  for (const loaded of [0, 40, 100]) opts.progress_callback({ status: 'progress', file: 'onnx/model_quantized.onnx', loaded, total: 100 });
  const read = (t) => /love|great|haha|lol|thank|❤|😂/i.test(t) ? [0.05, 0.15, 0.8]
    : /\\b(?:no|not|ugh|hate|sorry|worst|sick|tired)\\b/i.test(t) ? [0.7, 0.2, 0.1] : [0.1, 0.8, 0.1];
  return async (texts) => {
    await new Promise((r) => setTimeout(r, ${delay}));
    const rows = texts.map((t) => { const [n, u, p] = read(t); return [{ label: 'neutral', score: u }, { label: 'positive', score: p }, { label: 'negative', score: n }]; });
    return texts.length === 1 ? rows[0] : rows;
  };
}`;

const serveFake = (page, delay) => page.route(LIB_URL, (route) => route.fulfill({ body: fakeTransformers(delay), contentType: 'text/javascript' }));

/** Records every text sent to the model. */
const spyOnScoring = (page) => page.evaluate(() => {
  window.__sent = [];
  const score = AiMood.score.bind(AiMood);
  AiMood.score = (texts) => { window.__sent.push(...texts); return score(texts); };
});

const state = (page) => inApp(page, (app) => ({
  scorer: app.moodScorer,
  aiState: AiMood.state,
  vader: app.msgs.filter((m) => m.v != null).length,
  ai: app.msgs.filter((m) => m.ai).length,
  missing: app.msgs.filter(aiMoodMissing).length,
  on: document.querySelector('#moodScorerSeg button.on')?.dataset.scorer,
  note: document.querySelector('#moodNote').textContent,
}));

async function openMood(page) {
  await loadDemo(page);
  await scrollTo(page, '#c-mood');
  await page.waitForFunction(() => echarts.getInstanceByDom(document.getElementById('c-mood'))?.getOption().series?.length === 4);
}

/**
 * Choose "AI model", accept the download notice, and wait for the run to finish and the
 * Mood card to redraw with the new scores: it counts them again in slices (spec 028), so
 * on a slow machine it still shows its placeholder note just after the switch.
 */
async function scoreWithAi(page) {
  await page.click('#moodScorerSeg [data-scorer="ai"]');
  await page.click('[data-ai-mood="start"]');
  await expect.poll(() => inApp(page, (app) => app.moodScorer), { timeout: 30_000 }).toBe('ai');
  await expect(page.locator('#moodNote')).toContainText('scored with the AI model');
}

test.describe('spec 001: AI mood scoring', () => {
  test('AC1: loading data downloads nothing and scores with VADER', async ({ page }) => {
    const requests = [];
    page.on('request', (r) => { if (r.url().includes('huggingface')) requests.push(r.url()); });
    await openMood(page);
    const s = await state(page);
    expect(s).toMatchObject({ scorer: 'vader', on: 'vader', ai: 0 });
    expect(s.note).toContain('scored with VADER');
    expect(requests).toEqual([]);
  });

  test('AC2: the download notice comes first, and Cancel keeps VADER without a request', async ({ page }) => {
    const requests = [];
    page.on('request', (r) => { if (r.url() === LIB_URL) requests.push(r.url()); });
    await serveFake(page);
    await openMood(page);
    await page.click('#moodScorerSeg [data-scorer="ai"]');
    const status = page.locator('#aiMoodStatus');
    await expect(status).toContainText('126 MB');
    await expect(status).toContainText('never leave this device');
    expect(requests).toEqual([]);
    await page.click('[data-ai-mood="cancel"]');
    await expect(status).toBeHidden();
    expect(await state(page)).toMatchObject({ scorer: 'vader', on: 'vader', ai: 0 });
    expect(requests).toEqual([]);
  });

  test('AC3, AC4: scoring covers every VADER-scored message, each unique text once, and switches the chart', async ({ page }) => {
    await serveFake(page);
    await openMood(page);
    await spyOnScoring(page);
    await scoreWithAi(page);
    const s = await state(page);
    expect(s.ai).toBe(s.vader);
    expect(s.missing).toBe(0);
    expect(s.on).toBe('ai');
    expect(s.note).toContain('scored with the AI model');
    await expect(page.locator('#aiMoodStatus')).toBeHidden();
    const sent = await inApp(page, (app) => ({ n: window.__sent.length, unique: new Set(window.__sent).size, texts: new Set(app.msgs.filter((m) => m.v != null).map((m) => aiMoodText(m.b))).size }));
    expect(sent.n).toBe(sent.unique);
    expect(sent.n).toBe(sent.texts);
    // The chart now counts by the model: the share of positive messages matches its labels.
    const check = await inApp(page, (app) => {
      const C = aggregateContent(app.selection(), 'ai');
      const series = echarts.getInstanceByDom(document.getElementById('c-mood')).getOption().series[0].data;
      const mo = [...C.mood.keys()].sort((a, b) => a - b).at(-1);
      const m = C.mood.get(mo);
      return { chart: series.at(-1)[1], expected: m.n[1] ? Math.round((m.pos[1] / m.n[1]) * 1000) / 10 : null };
    });
    expect(check.chart).toBe(check.expected);
  });

  test('AC5: Stop keeps VADER and the scores so far; the next run only scores what is missing', async ({ page }) => {
    // The demo's ~27,000 scored messages are only ~74 unique texts (3 batches), so make
    // each batch slow enough to stop after the first one lands.
    await serveFake(page, 500);
    await openMood(page);
    await spyOnScoring(page);
    await page.click('#moodScorerSeg [data-scorer="ai"]');
    await page.click('[data-ai-mood="start"]');
    await expect(page.locator('#aiMoodStatus')).toContainText(/Scoring [\d,]+ of [\d,]+ messages/);
    await expect.poll(() => page.evaluate(() => window.__sent.length)).toBeGreaterThan(32); // batch 1 is back, batch 2 is out
    await page.click('[data-ai-mood="stop"]');
    await expect(page.locator('#aiMoodStatus')).toBeHidden();
    const stopped = await state(page);
    expect(stopped).toMatchObject({ scorer: 'vader', on: 'vader' });
    expect(stopped.ai).toBeGreaterThan(0);
    expect(stopped.missing).toBeGreaterThan(0);
    expect(stopped.note).toContain('scored with VADER');

    const firstRun = await page.evaluate(() => { const sent = window.__sent; window.__sent = []; return sent; });
    await page.click('#moodScorerSeg [data-scorer="ai"]'); // model already loaded: no notice, straight to scoring
    await expect.poll(() => inApp(page, (app) => app.moodScorer), { timeout: 30_000 }).toBe('ai');
    const secondRun = await page.evaluate(() => window.__sent);
    expect(secondRun.filter((t) => firstRun.includes(t))).toEqual([]);
    expect((await state(page)).missing).toBe(0);
  });

  test('AC6: after a finished run, switching to VADER and back is instant', async ({ page }) => {
    await serveFake(page);
    await openMood(page);
    await scoreWithAi(page);
    await spyOnScoring(page);
    await page.click('#moodScorerSeg [data-scorer="vader"]');
    expect(await state(page)).toMatchObject({ scorer: 'vader', on: 'vader' });
    await expect(page.locator('#moodNote')).toContainText('scored with VADER');
    await page.click('#moodScorerSeg [data-scorer="ai"]');
    expect(await state(page)).toMatchObject({ scorer: 'ai', on: 'ai' });
    await expect(page.locator('#aiMoodStatus')).toBeHidden();
    expect(await page.evaluate(() => window.__sent.length)).toBe(0);
  });

  test('AC7: pills show AI scores and explain them with the three probabilities and VADER', async ({ page }) => {
    await serveFake(page);
    await openMood(page);
    await scoreWithAi(page);
    await openTab(page, 'sec-messages');
    await page.check('#moodChk');
    const pill = page.locator('#messages .mood-pill').last();
    await pill.scrollIntoViewIfNeeded();
    const expected = await inApp(page, (app) => {
      const m = app.browserShown[+document.querySelectorAll('#messages .mood-pill')[document.querySelectorAll('#messages .mood-pill').length - 1].dataset.i];
      return { score: fmtScore(moodScore(m, 'ai')), kind: moodKind(m), vader: fmtScore(m.v) };
    });
    await expect(pill).toHaveText(expected.score);
    await expect(pill).toHaveClass(new RegExp(expected.kind));
    await pill.click();
    const why = page.locator('#messages .mood-why');
    await expect(why).toContainText(/positive \d+%/);
    await expect(why).toContainText(/neutral \d+%/);
    await expect(why).toContainText(/negative \d+%/);
    await expect(why).toContainText(`VADER ${expected.vader}`);
  });

  test.describe('when the model can’t load', () => {
    test.use({ failOnConsoleError: false }); // the blocked download logs a network error

    test('AC8: an error with Try again, and the chart stays on VADER', async ({ page }) => {
      await page.route(LIB_URL, (route) => route.abort());
      await openMood(page);
      await page.click('#moodScorerSeg [data-scorer="ai"]');
      await page.click('[data-ai-mood="start"]');
      const status = page.locator('#aiMoodStatus');
      await expect(status).toContainText('couldn’t be downloaded', { timeout: 15_000 });
      await expect(status.locator('[data-ai-mood="start"]')).toHaveText('Try again');
      expect(await state(page)).toMatchObject({ scorer: 'vader', on: 'vader', ai: 0 });
      // Once the CDN is reachable, Try again works.
      await page.unroute(LIB_URL);
      await serveFake(page);
      await page.click('[data-ai-mood="start"]');
      await expect.poll(() => inApp(page, (app) => app.moodScorer), { timeout: 30_000 }).toBe('ai');
    });
  });

  test('AC9: files added while AI is on are scored, and the chart stays on AI', async ({ page }) => {
    await serveFake(page);
    await openMood(page);
    await scoreWithAi(page);
    const before = (await state(page)).ai;
    await addFiles(page, resultJson(fullExport()));
    await expect.poll(() => inApp(page, (app) => app.msgs.some((m) => m.s === 4))).toBe(true);
    await expect.poll(async () => (await state(page)).missing, { timeout: 30_000 }).toBe(0);
    const s = await state(page);
    expect(s.ai).toBeGreaterThan(before);
    expect(s).toMatchObject({ scorer: 'ai', on: 'ai' });
  });
});
