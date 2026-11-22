import { test, expect, loadDemo, scrollTo, chartOption } from './fixtures.mjs';
import { inApp } from './state.mjs';

const GAPS = [
  { label: '30m', words: '30 minutes', lastBin: '15–30 min' },
  { label: '1h', words: '1 hour', lastBin: '15–60 min' },
  { label: '3h', words: '3 hours', lastBin: '1–3 h' },
  { label: '6h', words: '6 hours', lastBin: '3–6 h' },
  { label: '12h', words: '12 hours', lastBin: '8–12 h' },
  { label: '24h', words: '24 hours', lastBin: '8–24 h' },
];

/** The stats behind the charts, recomputed for the current selection and gap. */
const stats = (page) => inApp(page, (app) => {
  const A = aggregateMessages(app.selection(), app.convoGap);
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  return {
    n: A.n,
    sessions: A.sessions,
    starters: A.starters[0] + A.starters[1],
    replies: sum(A.reply[0]) + sum(A.reply[1]),
    doubles: A.doubleTexts[0] + A.doubleTexts[1],
  };
});

test.describe('conversation cutoff', () => {
  test.beforeEach(async ({ page }) => {
    await loadDemo(page);
    await scrollTo(page, '#c-sessions');
  });

  test('starts at 6 hours', async ({ page }) => {
    await expect(page.locator('#gapSeg button')).toHaveText(GAPS.map((g) => g.label));
    await expect(page.locator('#gapSeg button.on')).toHaveText('6h');
    await expect(page.locator('#sessionNote')).toContainText('A conversation ends after 6 hours of quiet');
  });

  for (const gap of GAPS) {
    test(`${gap.label}: every chart and label follows it`, async ({ page }) => {
      await page.click(`#gapSeg button:text-is("${gap.label}")`);
      await expect(page.locator('#gapSeg button.on')).toHaveText(gap.label);
      await expect(page.locator('#sessionNote')).toContainText(`A conversation ends after ${gap.words} of quiet`);
      await expect(page.locator('#replyNote')).toHaveText(`How quickly each side answers (within ${gap.words})`);
      await expect(page.locator('#habitsNote')).toContainText(`Conversation starters (after ${gap.label} of quiet)`);
      await expect(page.locator('.kpi', { hasText: 'reply time' })).toHaveAttribute('title', `Median time to answer, within ${gap.words}`);

      const s = await stats(page);
      expect(s.starters + s.replies + s.doubles, 'every message is a starter, a reply or a double text').toBe(s.n);
      expect(s.sessions).toBe(s.starters);
      const sessions = await chartOption(page, 'c-sessions');
      expect(sessions.series[0].data.reduce((a, d) => a + (d.value ?? d), 0)).toBe(s.sessions);
      const reply = await chartOption(page, 'c-reply');
      expect(reply.xAxis[0].data.at(-1)).toBe(gap.lastBin);
    });
  }

  test('a longer cutoff means fewer, longer conversations', async ({ page }) => {
    const counts = [];
    for (const gap of GAPS) {
      await page.click(`#gapSeg button:text-is("${gap.label}")`);
      await expect(page.locator('#gapSeg button.on')).toHaveText(gap.label);
      counts.push((await stats(page)).sessions);
    }
    for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeLessThanOrEqual(counts[i - 1]);
    expect(counts.at(-1)).toBeLessThan(counts[0]);
  });

  test('the cutoff survives other filter changes', async ({ page }) => {
    await page.click('#gapSeg button:text-is("24h")');
    const key = await page.locator('#contactSel option').nth(1).getAttribute('value');
    await page.selectOption('#contactSel', key);
    await expect(page.locator('#gapSeg button.on')).toHaveText('24h');
    await expect(page.locator('#replyNote')).toHaveText('How quickly each side answers (within 24 hours)');
  });
});
