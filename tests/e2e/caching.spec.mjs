import { test, expect, loadDemo, loadFiles, openTab } from './fixtures.mjs';
import { zippedExport } from '../helpers/instagram.mjs';
import { smsBackup } from '../helpers/sms.mjs';

/** Counts calls to the page's aggregateMessages from now on. */
const countAggregates = (page) => page.evaluate(() => {
  window.__aggregates = 0;
  const real = aggregateMessages;
  window.aggregateMessages = (...args) => {
    window.__aggregates++;
    return real(...args);
  };
});
const aggregates = (page) => page.evaluate(() => window.__aggregates);

test.describe('spec 014 cached selection', () => {
  test('AC11: the theme, leaderboard sorting, On this day and the message search reuse the numbers', async ({ page }) => {
    await loadDemo(page);
    await countAggregates(page);

    await page.click('#themeBtn');
    await page.click('#otdPrev');
    await openTab(page, 'sec-people');
    await page.click('#leaderTable th[data-key="sent"]');
    await page.click('#leaderTable th[data-key="sent"]'); // and back the other way
    await expect(page.locator('#leaderTable th.sorted')).toHaveClass(/asc/);
    await openTab(page, 'sec-messages');
    await page.fill('#search', 'lol');
    await expect(page.locator('#browserCount')).toContainText('matching');
    expect(await aggregates(page)).toBe(0);

    // A new selection works them out again, once a tab that shows them is open.
    await page.click('#presets [data-preset="90"]');
    await openTab(page, 'sec-glance');
    await expect.poll(() => aggregates(page)).toBe(1);
  });
});

// The same exports as the linked-people tests: SMS and Instagram, with Alex and Pat/Sam on both.
const files = () => [
  smsBackup([
    { address: '+15551234567', name: 'Alex Rivera', at: '2024-08-19T09:00:00Z', body: 'see you tomorrow' },
    { address: '+15551234567', name: 'Alex Rivera', at: '2024-08-19T09:05:00Z', sent: true, body: 'yes!' },
    { address: '+15559876543', name: 'Pat Lee', at: '2024-08-19T10:00:00Z', body: 'hi, it is Sam on my new number' },
    { address: '+15559876543', name: 'Pat Lee', at: '2024-08-19T10:01:00Z', sent: true, body: 'got it' },
  ]),
  zippedExport(),
];

test.describe('spec 014 settings', () => {
  test('AC14: settings saved before the restructuring still apply', async ({ page }) => {
    // Exactly what the previous version wrote.
    await page.addInitScript(() => {
      if (sessionStorage.getItem('seeded')) return;
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem('ms-theme', 'dark');
      localStorage.setItem('ms-ig-previews', '1');
      localStorage.setItem('ms-people', JSON.stringify({
        v: 1,
        people: [{ name: '', threads: ['59876543', 'ig:samPatel_3333'] }],
        dismissed: ['51234567\nig:alexrivera_1111'],
      }));
      localStorage.setItem('yapa-ai', JSON.stringify({ backend: 'ollama', ollamaUrl: 'http://127.0.0.1:9', ollamaModel: 'llama3.2' }));
    });
    await loadFiles(page, files());

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('#themeBtn')).toHaveText('☾ Dark');
    await expect(page.locator('#igPreviewsChk')).toBeChecked();
    // Pat and Sam are one person; the Alex suggestion stays dismissed.
    expect(await page.locator('#contactSel option').allTextContents()).toContain('🔗 Pat Lee (3)');
    await expect(page.locator('#peopleBtn')).toHaveText('🔗 Link people');
    await expect(page.locator('#aiBackendSeg button[data-backend="ollama"]')).toHaveClass(/on/);
    await expect(page.locator('#aiOllamaUrl')).toHaveValue('http://127.0.0.1:9');
    await expect(page.locator('#aiOllamaModel')).toHaveValue('llama3.2');

    // Changing a setting writes the same format back.
    await page.click('#themeBtn');
    expect(await page.evaluate(() => localStorage.getItem('ms-theme'))).toBe('auto');
    // Its label only shows with Instagram posts in the messages; the setting is there either way.
    await page.locator('#igPreviewsChk').evaluate((el) => el.click());
    expect(await page.evaluate(() => localStorage.getItem('ms-ig-previews'))).toBeNull();
  });
});
