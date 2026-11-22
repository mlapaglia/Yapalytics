import { test, expect, loadDemo, openTab, chartOption } from './fixtures.mjs';
import { inApp } from './state.mjs';

/** Records the ids of the charts drawn from now on. */
const recordCharts = (page) => page.evaluate(() => {
  window.__drawn = [];
  const set = Charts.set.bind(Charts);
  Charts.set = (id, ...rest) => {
    window.__drawn.push(id);
    return set(id, ...rest);
  };
});
const drawn = (page) => page.evaluate(() => window.__drawn.splice(0));

/** Counts how often message text is split into words (tokensOf) from now on. */
const countTokenizing = (page) => page.evaluate(() => {
  window.__tokenized = 0;
  const real = tokensOf;
  window.tokensOf = (body) => {
    window.__tokenized++;
    return real(body);
  };
});
const tokenized = (page) => page.evaluate(() => window.__tokenized);

/** The busiest 1-on-1 conversation's key. */
const busiest = (page) => inApp(page, (app) => app.topRows.find((r) => !r.key.startsWith('g:')).key);

test.describe('spec 014 panels', () => {
  test('AC12: on Overview, a new conversation draws no other tab\'s charts; Activity draws them when opened', async ({ page }) => {
    await loadDemo(page);
    await recordCharts(page);
    const key = await busiest(page);
    await page.selectOption('#contactSel', key);
    await expect(page.locator('#scope')).not.toContainText('All conversations');
    // Overview has no charts; the filter bar and the tab bar have none either.
    expect(await drawn(page)).toEqual([]);

    await openTab(page, 'sec-activity');
    expect(await drawn(page)).toEqual(expect.arrayContaining(['c-timeline', 'c-hour', 'c-dow', 'c-heat', 'c-calendar', 'c-yoy', 'c-night']));
    const timeline = await chartOption(page, 'c-timeline');
    const shown = timeline.series.slice(0, 2).reduce((n, s) => n + s.data.reduce((a, [, v]) => a + v, 0), 0);
    expect(shown).toBe(await inApp(page, (app) => app.selection().length));
  });

  test('AC13: Overview never splits message text into words; opening Words does, once per message', async ({ page }) => {
    await page.goto('/');
    await countTokenizing(page);
    await page.click('#demoBtn');
    await expect(page.locator('#dash')).toBeVisible({ timeout: 60_000 });
    await page.selectOption('#contactSel', await busiest(page));
    await page.selectOption('#contactSel', 'all');
    expect(await tokenized(page)).toBe(0);

    await openTab(page, 'sec-content');
    await expect.poll(() => tokenized(page)).toBeGreaterThan(0);
    // Each message with text once, and a message with a link once more without its links (R10).
    const expected = await inApp(page, (app) => {
      const text = app.selection().filter((m) => m.b && !(m.f & 16));
      return text.length + text.filter((m) => m.f & 2).length;
    });
    expect(await tokenized(page)).toBe(expected);
    // The other content tabs reuse that pass.
    await openTab(page, 'sec-mood');
    await openTab(page, 'sec-media');
    expect(await tokenized(page)).toBe(expected);
  });
});
