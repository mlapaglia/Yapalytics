import { test, expect, loadDemo, scrollTo, chartOption } from './fixtures.mjs';

test.describe('demo data', () => {
  test('clicking an app logo in the source switch picks that app', async ({ page }) => {
    await loadDemo(page);
    await page.click('#sourceSeg button[data-source="2"] .logo');
    await expect(page.locator('#sourceSeg button[data-source="2"]')).toHaveClass(/\bon\b/);
    await expect(page.locator('#scope')).toContainText('(WhatsApp)');
  });

  test('loads every source and renders the dashboard', async ({ page }) => {
    await loadDemo(page);
    const bySource = await page.evaluate(() => {
      const n = {};
      for (const m of S.msgs) n[m.s || 0] = (n[m.s || 0] || 0) + 1;
      return n;
    });
    // SMS, Google Chat, WhatsApp, iMessage, Telegram and Instagram demo exports all parse.
    for (const s of ['0', '1', '2', '3', '4', '5']) expect(bySource[s], `source ${s}`).toBeGreaterThan(100);
    await expect(page.locator('#kpis .kpi').first()).toBeVisible();
    await expect(page.locator('#sourceSeg')).toBeVisible();
    const timeline = await chartOption(page, 'c-timeline');
    expect(timeline.series[0].data.length).toBeGreaterThan(10);
  });

  test('renders the content section once it scrolls into view', async ({ page }) => {
    await loadDemo(page);
    await scrollTo(page, '#c-mood');
    await expect.poll(async () => (await chartOption(page, 'c-mood'))?.series?.length ?? 0).toBeGreaterThan(0);
    await expect(page.locator('#swearNote')).toContainText('per 1,000');
  });
});
