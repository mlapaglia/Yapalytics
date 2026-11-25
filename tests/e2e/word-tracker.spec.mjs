import { test, expect, loadDemo, loadFiles, scrollTo, chartOption } from './fixtures.mjs';
import { inApp } from './state.mjs';
import { smsBackup } from '../helpers/sms.mjs';

/** What the tracker should show, computed straight from the selected messages. */
const expected = (page) => inApp(page, (app) => {
  const re = phraseRegex(app.phrase);
  let firstYou = null, firstThem = null, uses = [0, 0];
  for (const m of app.phraseMsgs) {
    if (!m.b || m.f & 16) continue;
    const hits = m.b.match(re);
    if (!hits) continue;
    uses[m.o] += hits.length;
    if (m.o && firstYou == null) firstYou = m.t;
    if (!m.o && firstThem == null) firstThem = m.t;
  }
  return { uses, firstYou, firstThem };
});
const barSums = async (page) => (await chartOption(page, 'c-phrase')).series.map((s) => s.data.reduce((a, d) => a + d[1], 0));
const emptyText = async (page) => (await chartOption(page, 'c-phrase')).graphic?.[0]?.elements?.[0]?.style?.text;

test.describe('word tracker', () => {
  test.beforeEach(async ({ page }) => {
    await loadDemo(page);
    await scrollTo(page, '#phraseCard');
    await expect.poll(() => chartOption(page, 'c-phrase')).not.toBeNull();
  });

  test('starts empty with suggestions', async ({ page }) => {
    await expect(page.locator('#phraseIdeas button')).toHaveCount(8);
    expect(await emptyText(page)).toContain('Type a word or phrase');
    await expect(page.locator('#phraseFirsts')).toBeEmpty();
  });

  test('counts a phrase for each side and says who said it first', async ({ page }) => {
    await page.fill('#phraseInput', 'lol');
    await expect(page.locator('#phraseNote')).toContainText('“lol”: you said it');
    const want = await expected(page);
    expect(want.uses[0] + want.uses[1]).toBeGreaterThan(0);
    expect(await barSums(page)).toEqual([want.uses[1], want.uses[0]]); // [You, Them]
    await expect(page.locator('#phraseNote')).toContainText(`you said it ${want.uses[1]} times, them ${want.uses[0]} times`);
    const firstSide = want.firstYou <= want.firstThem ? 'You' : null;
    if (firstSide) await expect(page.locator('.phrase-headline')).toContainText(/^You said it first/);
    else await expect(page.locator('.phrase-headline')).toContainText(/said it first, .* before you\./);
    await expect(page.locator('.phrase-quote mark').first()).toHaveText(/^lol$/i);
  });

  test('suggestion chips fill in the phrase', async ({ page }) => {
    await page.click('#phraseIdeas button:text-is("love you")');
    await expect(page.locator('#phraseInput')).toHaveValue('love you');
    await expect(page.locator('#phraseIdeas button.on')).toHaveText('love you');
    await expect(page.locator('#phraseNote')).toContainText('“love you”');
  });

  test('keeps the totals at every granularity', async ({ page }) => {
    await page.fill('#phraseInput', 'lol');
    await expect(page.locator('#phraseNote')).toContainText('“lol”');
    const { uses } = await expected(page);
    for (const gran of ['day', 'week', 'month', 'auto']) {
      await page.click(`#phraseGranSeg button[data-gran="${gran}"]`);
      await expect(page.locator(`#phraseGranSeg button[data-gran="${gran}"]`)).toHaveClass(/on/);
      expect(await barSums(page), gran).toEqual([uses[1], uses[0]]);
    }
  });

  test('a long daily view opens on the latest days with a slider', async ({ page }) => {
    await page.fill('#phraseInput', 'lol');
    await expect(page.locator('#phraseNote')).toContainText('“lol”');
    await page.click('#phraseGranSeg button[data-gran="day"]');
    const opt = await chartOption(page, 'c-phrase');
    expect(opt.series[0].data.length).toBeGreaterThan(150);
    expect(opt.dataZoom.some((z) => z.type === 'slider')).toBe(true);
  });

  test('auto shows days for a short range', async ({ page }) => {
    await page.fill('#phraseInput', 'lol');
    await expect(page.locator('#phraseNote')).toContainText('“lol”');
    await page.click('#presets button[data-preset="30"]');
    await scrollTo(page, '#phraseCard');
    const bars = async () => (await chartOption(page, 'c-phrase'))?.series?.[0]?.data?.length ?? Infinity;
    await expect.poll(bars).toBeLessThanOrEqual(31);
    const opt = await chartOption(page, 'c-phrase');
    expect(opt.series[0].data.length).toBeGreaterThanOrEqual(28);
  });

  test('follows the conversation filter', async ({ page }) => {
    await page.fill('#phraseInput', 'lol');
    await expect(page.locator('#phraseNote')).toContainText('“lol”');
    const all = await expected(page);
    const key = await page.locator('#contactSel option').nth(1).getAttribute('value');
    await page.selectOption('#contactSel', key);
    await scrollTo(page, '#phraseCard');
    await expect.poll(async () => (await expected(page)).uses[0]).toBeLessThan(all.uses[0]);
    const one = await expected(page);
    expect(await barSums(page)).toEqual([one.uses[1], one.uses[0]]);
  });

  test('says when nobody used the phrase', async ({ page }) => {
    await page.fill('#phraseInput', 'xyzzy plugh');
    await expect.poll(() => emptyText(page)).toBe('Nobody said “xyzzy plugh” in this selection');
    await expect(page.locator('#phraseFirsts')).toBeEmpty();
  });
});

test('word tracker: a reaction quoting a message is not saying it, hidden characters and all', async ({ page }) => {
  // Reactions as phones send them: a zero-width space first, a no-break space before
  // "to", direction marks around the quote.
  const alex = { address: '+15551234567', name: 'Alex Rivera' };
  const quote = 'big victory today for the team';
  const reactions = [`❤️ to “${quote}”`, `\u200bLoved “${quote}”`, `❤️\u00a0to “${quote}”`, `❤️ to \u2068“${quote}”\u2069`, `❤️ to \u200b“${quote}”\u200b`];
  await loadFiles(page, [smsBackup([
    { ...alex, at: '2026-08-01T12:00:00Z', body: quote },
    ...reactions.map((body, i) => ({ ...alex, at: `2026-08-0${2 + i}T12:00:00Z`, sent: true, body })),
  ])]);
  expect(await inApp(page, (app) => app.msgs.map((m) => m.b))).toEqual([quote]);
  await scrollTo(page, '#phraseCard');
  await page.fill('#phraseInput', 'big victory');
  await expect(page.locator('#phraseFirsts .phrase-headline')).toHaveText("You've never said it. Alex Rivera said it first.");
  await expect(page.locator('#phraseFirsts .phrase-first')).toHaveCount(1);
});
