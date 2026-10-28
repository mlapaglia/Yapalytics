import { test, expect, loadDemo, scrollTo, chartOption } from './fixtures.mjs';

test.describe('demo data', () => {
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

  test('keeps reactions out of the messages and says how many', async ({ page }) => {
    await loadDemo(page);
    const r = await page.evaluate(() => {
      const look = /^(?:Liked|Loved|Disliked|Laughed at|Emphasized|Questioned|Reacted|Removed)\b|^[^\p{L}\p{N}\s]{1,12} to [“"]/u;
      return {
        reactions: S.reactions,
        flagged: S.msgs.filter((m) => m.f & 16).length,
        lookalikes: S.msgs.filter((m) => m.b && look.test(m.b)).map((m) => m.b).slice(0, 5),
      };
    });
    expect(r.reactions).toBeGreaterThan(0);
    expect(r.flagged).toBe(0);
    expect(r.lookalikes).toEqual([]);
    await expect(page.locator('#fileInfo')).toContainText(/reactions .* not counted as messages/);
  });

  test('renders the content section once it scrolls into view', async ({ page }) => {
    await loadDemo(page);
    await scrollTo(page, '#c-mood');
    await expect.poll(async () => (await chartOption(page, 'c-mood'))?.series?.length ?? 0).toBeGreaterThan(0);
    await expect(page.locator('#swearNote')).toContainText('per 1,000');
  });
});
