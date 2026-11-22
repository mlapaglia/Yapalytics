import { test, expect, loadDemo, scrollTo, chartOption, openTab } from './fixtures.mjs';
import { inApp } from './state.mjs';

test.describe('demo data', () => {
  test('clicking an app logo in the source switch picks that app', async ({ page }) => {
    await loadDemo(page);
    await page.click('#sourceSeg button[data-source="2"] .logo');
    await expect(page.locator('#sourceSeg button[data-source="2"]')).toHaveClass(/\bon\b/);
    await expect(page.locator('#scope')).toContainText('(WhatsApp)');
  });

  test('loads every source and renders the dashboard', async ({ page }) => {
    await loadDemo(page);
    const bySource = await inApp(page, (app) => {
      const n = {};
      for (const m of app.msgs) n[m.s || 0] = (n[m.s || 0] || 0) + 1;
      return n;
    });
    // SMS, Google Chat, WhatsApp, iMessage, Telegram, Instagram and Messenger demo exports all parse.
    for (const s of ['0', '1', '2', '3', '4', '5', '6']) expect(bySource[s], `source ${s}`).toBeGreaterThan(100);
    await expect(page.locator('#kpis .kpi').first()).toBeVisible();
    await expect(page.locator('#sourceSeg')).toBeVisible();
    await openTab(page, 'sec-activity'); // drawn when its tab opens (spec 014 R9)
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
