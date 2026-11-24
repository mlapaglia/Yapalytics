import { test, expect, loadFiles, loadDemo, scrollTo, chartOption, ownerPicker } from './fixtures.mjs';
import { inApp } from './state.mjs';
import { fullExport, resultJson, singleGroupExport, zippedFullExport, zippedHtmlExport } from '../helpers/telegram.mjs';

/** Telegram messages loaded: total, and how many count as sent by you. */
const telegramCounts = (page) => inApp(page, (app) => {
  const tg = app.msgs.filter((m) => m.s === 4);
  return { n: tg.length, sent: tg.filter((m) => m.o === 1).length };
});

test.describe('Telegram', () => {
  test('loads a zipped full export and knows which messages are yours', async ({ page }) => {
    await loadFiles(page, zippedFullExport());
    expect(await telegramCounts(page)).toEqual({ n: 14, sent: 6 }); // Jamie Park sent 6 of the 14 kept messages
    const picker = await ownerPicker(page, 'Telegram');
    await expect(picker).toHaveValue('Jamie Park');
    const options = await page.locator('#contactSel option').allTextContents();
    expect(options.some((o) => o.startsWith('✈️ Alex Rivera'))).toBe(true);
    expect(options.some((o) => o.startsWith('✈️👥 Weekend Crew'))).toBe(true);
    expect(options.some((o) => /Tech News|BotFather/.test(o) && o.includes('Tech News')), 'channels are skipped').toBe(false);
  });

  test('picking a different owner swaps sent and received', async ({ page }) => {
    await loadFiles(page, resultJson(fullExport()));
    const picker = await ownerPicker(page, 'Telegram');
    await picker.selectOption('Alex Rivera');
    // Alex Rivera's kept messages: 3 in your chat (the empty one is skipped) and 1 in the group.
    await expect.poll(async () => (await telegramCounts(page)).sent).toBe(4);
  });

  test('opens a photo from the zipped export in the viewer', async ({ page }) => {
    await loadFiles(page, zippedFullExport());
    await scrollTo(page, '#galleryCard');
    const tile = page.locator('#galleryGrid .tile[title^="photo_1@"]');
    await expect(tile).toHaveClass(/loaded/, { timeout: 30_000 });
    await tile.click();
    await page.waitForFunction(() => document.querySelector('#viewer .viewer-stage img')?.naturalWidth);
    expect(await page.$eval('#viewer .viewer-stage img', (i) => [i.naturalWidth, i.naturalHeight])).toEqual([1600, 1200]);
    await expect(page.locator('#viewer .viewer-caption')).toContainText('Alex Rivera');
  });

  test('result.json alone counts photos it cannot show', async ({ page }) => {
    await loadFiles(page, resultJson(fullExport()));
    await scrollTo(page, '#galleryCard');
    await expect(page.locator('#galleryNote')).toContainText('zip the whole export folder');
  });

  test('a single group export leaves the owner to pick', async ({ page }) => {
    await loadFiles(page, resultJson(singleGroupExport()));
    await expect(await ownerPicker(page, 'Telegram')).toHaveCount(1);
    await expect(page.locator('#ownerSection')).toBeVisible();
    expect((await telegramCounts(page)).n).toBe(2);
  });

  test('shows up in the demo, the source switch and the platform mix', async ({ page }) => {
    await loadDemo(page);
    await expect(page.locator('#sourceSeg button[data-source="4"]')).toBeVisible();
    await page.click('#sourceSeg button[data-source="4"]');
    await expect(page.locator('#scope')).toContainText('(Telegram)');
    await page.click('#sourceSeg button[data-source="all"]');
    await scrollTo(page, '#c-platforms');
    await expect.poll(async () => (await chartOption(page, 'c-platforms'))?.series?.map((s) => s.name) ?? []).toContain('Telegram');
  });
});

test.describe('Telegram errors', () => {
  test.use({ failOnConsoleError: false }); // the app logs the error it shows

  test('explains that the HTML export needs to be redone as JSON', async ({ page }) => {
    await page.goto('/');
    await page.setInputFiles('#fileInput', zippedHtmlExport());
    await expect(page.locator('#loadError')).toContainText('Machine-readable JSON');
    await expect(page.locator('#dash')).toBeHidden();
  });
});
