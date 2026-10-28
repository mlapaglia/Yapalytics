import { test, expect } from './fixtures.mjs';

test.describe('landing page', () => {
  test('guides each source with links to the right places', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.hero h1')).toHaveText('See the patterns in your texts');
    await expect(page.locator('.source h3')).toHaveText(['SMS & MMS', 'Google Chat', 'WhatsApp', 'iMessage', 'Telegram', 'Instagram', 'Mix and match']);
    const hrefs = await page.locator('.source a').evaluateAll((as) => as.map((a) => a.href));
    for (const url of [
      'https://play.google.com/store/apps/details?id=com.riteshsahu.SMSBackupRestore',
      'https://takeout.google.com/',
      'https://faq.whatsapp.com/1180414079177245',
      'https://github.com/ReagentX/imessage-exporter',
      'https://desktop.telegram.org/',
      'https://accountscenter.instagram.com/info_and_permissions/dyi/',
    ]) expect(hrefs).toContain(url);
    // External links open in a new tab without giving it access to this one.
    for (const a of await page.locator('.source a').all()) {
      await expect(a).toHaveAttribute('target', '_blank');
      await expect(a).toHaveAttribute('rel', /noopener/);
    }
  });

});

test.describe('landing page errors', () => {
  test.use({ failOnConsoleError: false }); // the app logs the parse error it shows

  test('explains a file it cannot read, without leaving the page', async ({ page }) => {
    await page.goto('/');
    await page.setInputFiles('#fileInput', { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('just some notes\nnothing to see') });
    await expect(page.locator('#loadError')).toBeVisible();
    await expect(page.locator('#loadError')).toContainText("notes.txt doesn't look like a WhatsApp chat export");
    await expect(page.locator('.hero')).toBeVisible();
    await expect(page.locator('.sources')).toBeVisible();
    await expect(page.locator('#dash')).toBeHidden();
  });
});
