import { test, expect, loadFiles, loadDemo, scrollTo, chartOption } from './fixtures.mjs';
import { looseThread, splitExport, zippedExport, zippedHtmlExport } from '../helpers/instagram.mjs';

/** Instagram messages loaded: total, and how many count as sent by you. */
const instagramCounts = (page) => page.evaluate(() => {
  const ig = S.msgs.filter((m) => m.s === 5);
  return { n: ig.length, sent: ig.filter((m) => m.o === 1).length };
});

test.describe('Instagram', () => {
  test('loads the export zip and knows which messages are yours', async ({ page }) => {
    await loadFiles(page, zippedExport());
    // 8 messages kept (2 likes are reactions); Jamie Park sent 2 of them.
    expect(await instagramCounts(page)).toEqual({ n: 8, sent: 2 });
    expect(await page.evaluate(() => S.reactions)).toBe(2);
    const picker = page.locator('#ownerFields label', { hasText: 'You on Instagram' }).locator('select');
    await expect(picker).toHaveValue('Jamie Park');
    const options = await page.locator('#contactSel option').allTextContents();
    expect(options.some((o) => o.startsWith('📸 Alex Rivera'))).toBe(true);
    expect(options.some((o) => o.startsWith('📸👥 Road Trip 🚗'))).toBe(true);
    expect(options.some((o) => o.includes('Spam Bot')), 'message requests are skipped').toBe(false);
  });

  test('picking a different owner swaps sent and received', async ({ page }) => {
    await loadFiles(page, zippedExport());
    const picker = page.locator('#ownerFields label', { hasText: 'You on Instagram' }).locator('select');
    await picker.selectOption('Alex Rivera');
    await expect.poll(async () => (await instagramCounts(page)).sent).toBe(4);
  });

  test('opens a photo from another part of a split export', async ({ page }) => {
    await loadFiles(page, splitExport());
    await scrollTo(page, '#galleryCard');
    const tile = page.locator('#galleryGrid .tile[title^="1801_1"]');
    await expect(tile).toHaveClass(/loaded/, { timeout: 30_000 });
    await tile.click();
    await page.waitForFunction(() => document.querySelector('#viewer .viewer-stage img')?.naturalWidth);
    expect(await page.$eval('#viewer .viewer-stage img', (i) => [i.naturalWidth, i.naturalHeight])).toEqual([1600, 1200]);
    await expect(page.locator('#viewer .viewer-caption')).toContainText('Alex Rivera');
  });

  test('a message_1.json on its own guesses you from the chat title', async ({ page }) => {
    await loadFiles(page, looseThread());
    await expect(page.locator('#ownerFields label', { hasText: 'You on Instagram' }).locator('select')).toHaveValue('Jamie Park');
    expect(await instagramCounts(page)).toEqual({ n: 3, sent: 1 });
  });

  test('shows up in the demo, the source switch and the platform mix', async ({ page }) => {
    await loadDemo(page);
    await expect(page.locator('#sourceSeg button[data-source="5"]')).toBeVisible();
    await page.click('#sourceSeg button[data-source="5"]');
    await expect(page.locator('#scope')).toContainText('(Instagram)');
    await page.click('#sourceSeg button[data-source="all"]');
    await scrollTo(page, '#c-platforms');
    await expect.poll(async () => (await chartOption(page, 'c-platforms'))?.series?.map((s) => s.name) ?? []).toContain('Instagram');
  });
});

test.describe('Instagram errors', () => {
  test.use({ failOnConsoleError: false }); // the app logs the error it shows

  test('explains that the HTML export needs to be redone as JSON', async ({ page }) => {
    await page.goto('/');
    await page.setInputFiles('#fileInput', zippedHtmlExport());
    await expect(page.locator('#loadError')).toContainText('Instagram');
    await expect(page.locator('#loadError')).toContainText('JSON');
    await expect(page.locator('#dash')).toBeHidden();
  });
});
