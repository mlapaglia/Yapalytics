import { test, expect } from './fixtures.mjs';

/*
 * Spec 014 R4: an app is one registry entry plus its parser. This adds an eighth app in
 * the page, recognized by its file extension, and loads a file of it next to a WhatsApp
 * export (the source filter shows once two apps are loaded).
 */
test.describe('spec 014 app registry', () => {
  test('AC6: an app added to the registry is detected, read and offered in the source filter', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      Sources.list.push({
        id: 7, kind: 'signal', name: 'Signal', logo: 'sms', mark: '', exportName: 'Signal',
        senderNames: false, defaultOwner: null, addrIds: false,
        jobs: 'together', readTogether: false, archives: false, metaFormat: false, shares: false, nameRank: 7,
        detect: { file: (p) => /\.signal$/i.test(p.name) },
        // Stands in for a parser worker: two messages with Alex.
        async parse(files, { onBatch, onProgress }) {
          const lib = messageLib();
          const msg = (t, o, body) => {
            const m = { t, o, s: 7, k: 'sg:alex', m: 0, ph: 0, gf: 0, vd: 0, au: 0, ot: 0, mb: 0 };
            lib.analyzeText(body, m);
            lib.stampTime(m);
            return m;
          };
          const t = Date.UTC(2024, 2, 1, 12);
          onBatch([msg(t, 0, 'hi from signal'), msg(t + 60e3, 1, 'hello back')], []);
          onProgress(files[0].size, files[0].size);
          return { contacts: [{ key: 'sg:alex', name: 'Alex', addr: '', group: false, lastT: t + 60e3, s: 7, members: [] }], counts: {} };
        },
      });
    });
    await page.setInputFiles('#fileInput', [
      { name: 'alex.signal', mimeType: 'application/octet-stream', buffer: Buffer.from('signal backup') },
      { name: 'WhatsApp Chat with Sam.txt', mimeType: 'text/plain', buffer: Buffer.from('1/2/24, 10:00 - Sam: hi\n1/2/24, 10:01 - Me: hey Sam\n') },
    ]);
    await expect(page.locator('#dash')).toBeVisible();

    const button = page.locator('#sourceSeg button[data-source="7"]');
    await expect(button).toBeVisible();
    await expect(button).toHaveText('Signal');
    await expect(button.locator('use')).toHaveAttribute('href', '#logo-sms');
    await button.click();
    await expect(page.locator('#scope')).toContainText('(Signal)');
    await expect(page.locator('#scope')).toContainText('2 messages');
  });
});
