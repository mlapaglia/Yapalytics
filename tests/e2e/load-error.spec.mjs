import { test, expect, loadFiles } from './fixtures.mjs';
import { smsBackup } from '../helpers/sms.mjs';

test.describe('spec 014 load errors', () => {
  test.use({ failOnConsoleError: false }); // the parse error is logged

  test('AC17: a file that fails to read while the dashboard shows is a message on the page, not an alert', async ({ page }) => {
    const dialogs = [];
    page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss(); });
    await loadFiles(page, [smsBackup([{ address: '+15551234567', name: 'Alex', at: '2024-08-19T09:00:00Z', body: 'hi' }])]);
    await expect(page.locator('#dashError')).toBeHidden();

    await page.setInputFiles('#fileInput', { name: 'result.json', mimeType: 'application/json', buffer: Buffer.from('{oops') });
    const banner = page.locator('#dashError');
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute('role', 'alert');
    await expect(banner).toContainText('Could not read that file');
    await expect(page.locator('#dash')).toBeVisible();
    expect(dialogs).toEqual([]);

    await page.click('#dashErrorClose');
    await expect(banner).toBeHidden();
  });
});
