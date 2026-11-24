/* specs/020-daily-rhythm.md in the browser. */
import { test, expect, loadFiles, openTab, chartOption } from './fixtures.mjs';
import { inApp } from './state.mjs';
import { smsBackup } from '../helpers/sms.mjs';

const DAY = 86400000;
const iso = (i, min) => new Date(Date.UTC(2024, 0, 1 + i, 0, min)).toISOString();

/**
 * AC8's history as an SMS backup: 10 of your messages a day to Alex from 9 AM to 11 PM
 * for 60 days, 6 hours later on Jan 28 – Feb 3, and Alex sending 120 messages on Feb 20
 * (usually 10 a day) for an unusual day.
 */
function awaySms() {
  const rows = [];
  const alex = { address: '+15551234567', name: 'Alex Rivera' };
  for (let i = 0; i < 60; i++) {
    const h = i >= 27 && i < 34 ? 6 : 0;
    for (let j = 0; j < 10; j++) rows.push({ ...alex, at: iso(i, Math.round((9 + h) * 60 + (14 * 60 * j) / 9)), sent: true, body: `note ${i}.${j}` });
    for (let j = 0; j < (i === 50 ? 120 : 10); j++) rows.push({ ...alex, at: iso(i, 12 * 60 + j), body: `reply ${i}.${j}` });
  }
  return smsBackup(rows);
}

/** A WhatsApp chat where you send 6 messages a day on 3 days. */
function whatsApp() {
  const lines = [];
  for (let d = 2; d <= 4; d++) for (let j = 0; j < 6; j++) lines.push(`1/${d}/24, ${10 + j}:00 - Me: note ${d}.${j}`, `1/${d}/24, ${10 + j}:05 - Sam: ok`);
  return { name: 'WhatsApp Chat with Sam.txt', mimeType: 'text/plain', buffer: Buffer.from(lines.join('\n') + '\n') };
}

const emptyText = async (page, id) => (await chartOption(page, id)).graphic?.[0]?.elements?.[0]?.style?.text ?? null;

test.describe('spec 020 daily rhythm', () => {
  test.describe('with an SMS history', () => {
    test.beforeEach(async ({ page }) => {
      await loadFiles(page, [awaySms()]);
      await openTab(page, 'sec-activity');
    });

    test('AC19: the Activity tab shows both cards, one shaded stretch, and both in Jump to…', async ({ page }) => {
      await expect(page.locator('#rhythmCard')).toBeVisible();
      await expect(page.locator('#unusualCard')).toBeVisible();
      await expect(page.locator('#rhythmBasis')).toContainText('From 60 days with at least 5 messages from you.');
      await expect.poll(async () => (await chartOption(page, 'c-rhythm'))?.series?.[1]?.markArea?.data?.length).toBe(1);
      const jump = await page.evaluate(() => [...document.querySelectorAll('#jumpSel option')].map((o) => o.textContent));
      expect(jump).toContain('When your day starts and ends');
      expect(jump).toContain('Unusual days');
    });

    test('AC11: the stretch is listed, and Read those days → picks its dates and opens Messages', async ({ page }) => {
      const row = page.locator('#awayList li');
      await expect(row).toHaveCount(1);
      await expect(row).toContainText('Jan 28 – Feb 3, 2024: your messages ran about 6 hours later than usual.');
      await expect(page.locator('#awayList')).toContainText('A guess from when you send messages');
      await row.getByRole('button', { name: 'Read those days →' }).click();
      await expect(page.locator('#tab-sec-messages')).toHaveAttribute('aria-selected', 'true');
      const f = await inApp(page, (app) => app.filter);
      expect([f.from, f.to]).toEqual([Date.UTC(2024, 0, 28), Date.UTC(2024, 1, 4) - 1]);
    });

    test('AC15: rows name the conversation for all conversations, and leave it out with one picked', async ({ page }) => {
      const row = page.locator('#unusualDays li');
      await expect(row).toHaveCount(1);
      await expect(row).toContainText('Tue, Feb 20, 2024 · Alex Rivera · 130 messages, 6.5× a normal day (usually about 20)');
      const key = await inApp(page, (app) => app.msgs[0].k);
      await page.selectOption('#contactSel', key);
      await expect(row).toContainText('Tue, Feb 20, 2024 · 130 messages');
      await expect(row).not.toContainText('Alex Rivera');
    });

    test('AC16: Read that day → opens that day of that conversation in Messages', async ({ page }) => {
      await page.locator('#unusualDays li').getByRole('button', { name: 'Read that day →' }).click();
      await expect(page.locator('#tab-sec-messages')).toHaveAttribute('aria-selected', 'true');
      const [f, key] = await inApp(page, (app) => [app.filter, app.msgs[0].k]);
      expect([f.contact, f.from, f.to]).toEqual([key, Date.UTC(2024, 1, 20), Date.UTC(2024, 1, 21) - 1]);
      await expect(page.locator('#browserCount')).toContainText('130');
    });
  });

  test('AC10 and AC6: WhatsApp alone can’t show time away, and 3 days are too few for the chart', async ({ page }) => {
    await loadFiles(page, [whatsApp()]);
    await openTab(page, 'sec-activity');
    await expect(page.locator('#awayList')).toHaveText(
      "Time away needs messages from SMS, Google Chat, Telegram, Instagram or Messenger. WhatsApp and iMessage exports don't say which time zone their times are in.");
    await expect.poll(() => emptyText(page, 'c-rhythm')).toBe('Not enough days with 5 or more messages from you');
    await expect(page.locator('#unusualDays')).toHaveText('Unusual days need a conversation with at least 200 messages.');
  });
});
