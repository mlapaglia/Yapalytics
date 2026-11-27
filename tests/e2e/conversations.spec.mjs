/*
 * The conversation cutoff in the browser. Settings AC3 and AC4 (settings.spec.mjs) check
 * that every chart and label follows a picked gap; the numbers for each gap are unit
 * tests (analysis.test.mjs: replyBins, fmtGapWords, aggregateMessages).
 */
import { test, expect, loadDemo, scrollTo, openSettings, closeSettings } from './fixtures.mjs';

/** Picks a gap in Settings (spec 015) and closes it, so the charts behind are in view again. */
async function pickGap(page, label) {
  await openSettings(page);
  await page.click(`#gapSeg button:text-is("${label}")`);
  await expect(page.locator('#gapSeg button.on')).toHaveText(label);
  await closeSettings(page);
}

test.describe('conversation cutoff', () => {
  test.beforeEach(async ({ page }) => {
    await loadDemo(page);
    await scrollTo(page, '#c-sessions');
  });

  test('the cutoff survives other filter changes', async ({ page }) => {
    await pickGap(page, '24h');
    const key = await page.locator('#contactSel option').nth(1).getAttribute('value');
    await page.selectOption('#contactSel', key);
    await expect(page.locator('#gapSeg button.on')).toHaveText('24h');
    await expect(page.locator('#replyNote')).toHaveText('How quickly each side answers (within 24 hours)');
  });
});
