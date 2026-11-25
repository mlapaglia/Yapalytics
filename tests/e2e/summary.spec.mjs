/* specs/025-summary-card.md in the browser. */
import { readFileSync } from 'node:fs';
import { test, expect, loadDemo } from './fixtures.mjs';
import { inApp } from './state.mjs';

const dlg = (page) => page.locator('#summaryDlg');
const preview = (page) => page.evaluate(() => document.getElementById('summaryCanvas').toDataURL('image/png'));

async function openSummary(page) {
  await page.click('#summaryBtn');
  await expect(dlg(page)).toHaveAttribute('open', '');
}

async function closeSummary(page) {
  await page.click('#summaryDlg .profile-close');
  await expect(dlg(page)).not.toHaveAttribute('open', '');
}

test.describe('spec 025 summary image', () => {
  test.beforeEach(async ({ page }) => {
    await loadDemo(page);
  });

  test('AC1: Overview has a Summary image button that opens a preview, an unticked Show names and Save PNG', async ({ page }) => {
    await expect(page.locator('#sec-glance #summaryBtn')).toBeVisible();
    await openSummary(page);
    await expect(page.locator('#summaryCanvas')).toBeVisible();
    await expect(page.locator('#summaryNames')).not.toBeChecked();
    await expect(page.locator('#summarySave')).toHaveText('Save PNG');
  });

  test('AC6: Save PNG downloads a 1080 × 1350 PNG named for today, with no network request', async ({ page }) => {
    await openSummary(page);
    const requests = [];
    page.on('request', (r) => { if (/^https?:/.test(r.url())) requests.push(r.url()); });
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#summarySave')]);
    const today = new Date().toISOString().slice(0, 10); // the browser runs in UTC (playwright.config)
    expect(download.suggestedFilename()).toBe(`Yapalytics-summary-${today}.png`);
    const png = readFileSync(await download.path());
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1080, 1350]);
    expect(requests).toEqual([]);
  });

  test('AC7: Show names goes back to unticked when the dialog opens again', async ({ page }) => {
    await openSummary(page);
    const off = await preview(page);
    await page.check('#summaryNames');
    await expect.poll(() => preview(page)).not.toBe(off); // the preview redraws with names
    await closeSummary(page);
    await openSummary(page);
    await expect(page.locator('#summaryNames')).not.toBeChecked();
    expect(await preview(page)).toBe(off);
  });

  test('AC8: with a date range that has no messages, the button is disabled', async ({ page }) => {
    await expect(page.locator('#summaryBtn')).toBeEnabled();
    // A day inside the demo's span with no messages
    const day = await inApp(page, (app) => {
      const days = new Set(app.msgs.map((m) => new Date(m.t).toISOString().slice(0, 10)));
      for (let t = app.msgs[0].t; t < app.msgs[app.msgs.length - 1].t; t += 86400e3) {
        const d = new Date(t).toISOString().slice(0, 10);
        if (!days.has(d)) return d;
      }
      return null;
    });
    expect(day).not.toBeNull();
    await page.fill('#toDate', day);
    await page.fill('#fromDate', day);
    await expect.poll(() => inApp(page, (app) => app.filter.from)).not.toBeNull();
    await expect(page.locator('#summaryBtn')).toBeDisabled();
  });

  test('AC9: the preview is the same in the light and dark themes', async ({ page }) => {
    const series1 = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--series-1').trim());
    await page.emulateMedia({ colorScheme: 'light' });
    expect(await series1()).toBe('#2a78d6'); // the themes' colours differ…
    await openSummary(page);
    const light = await preview(page);
    await closeSummary(page);
    await page.emulateMedia({ colorScheme: 'dark' });
    expect(await series1()).toBe('#3987e5');
    await openSummary(page);
    // …but the image doesn't
    expect(await preview(page)).toBe(light);
  });
});
