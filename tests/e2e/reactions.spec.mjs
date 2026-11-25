/* specs/027-reactions.md in the browser. */
import { test, expect, loadDemo, loadFiles, openTab, scrollTo, chartOption } from './fixtures.mjs';
import { inApp } from './state.mjs';
import { smsBackup } from '../helpers/sms.mjs';

const alex = { address: '+15551234567', name: 'Alex Rivera' };
const at = (min) => new Date(Date.UTC(2024, 2, 1, 12, min)).toISOString();

test.describe('spec 027 reactions', () => {
  test('AC2: a tapback shows under the message it reacts to, and isn’t a message itself', async ({ page }) => {
    await loadFiles(page, [smsBackup([
      { ...alex, at: at(0), body: 'see you soon 😊' },
      { ...alex, at: at(3), sent: true, body: 'Loved “see you soon 😊”' },
    ])]);
    expect(await inApp(page, (app) => app.msgs.map((m) => m.b))).toEqual(['see you soon 😊']);
    await openTab(page, 'sec-messages');
    const chip = page.locator('#messages .msg', { hasText: 'see you soon 😊' }).locator('.rx');
    await expect(chip).toHaveText('❤️');
    await expect(chip).toHaveAttribute('title', '❤️ You');
  });

  test('AC15: Read → on a most-reacted message opens its day in Messages', async ({ page }) => {
    await loadFiles(page, [smsBackup([
      { ...alex, at: at(0), body: 'big news' },
      { ...alex, at: at(1), sent: true, body: 'Loved “big news”' },
      { ...alex, at: new Date(Date.UTC(2024, 2, 5, 9)).toISOString(), body: 'later' },
    ])]);
    await openTab(page, 'sec-mood');
    await scrollTo(page, '#reactTopCard');
    const row = page.locator('#reactTop li');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('big news');
    await row.getByRole('button', { name: /Read that day/ }).click();
    await expect(page.locator('#tab-sec-messages')).toHaveAttribute('aria-selected', 'true');
    const f = await inApp(page, (app) => app.filter);
    expect([f.from, f.to]).toEqual([Date.UTC(2024, 2, 1), Date.UTC(2024, 2, 2) - 1]);
  });

  test.describe('with the demo', () => {
    test.beforeEach(async ({ page }) => {
      await loadDemo(page);
      await openTab(page, 'sec-mood');
    });

    test('AC11: Top emoji shows typed and reacted parts, and the Reactions box turns them off', async ({ page }) => {
      await scrollTo(page, '#c-emoji');
      const names = async () => (await chartOption(page, 'c-emoji')).series.map((s) => s.name);
      await expect.poll(names).toEqual(['You typed', 'You reacted', 'They typed', 'They reacted']);
      await page.locator('#emojiRxChk').uncheck();
      await expect.poll(names).toEqual(['Sent', 'Received']);
      await expect(page.locator('#emojiNote')).toHaveText('Typed in messages, sent and received');
    });

    test('AC17: the five reaction cards have data and are in Jump to…', async ({ page }) => {
      for (const id of ['c-reactions', 'c-reacttime', 'c-reacthow']) {
        await scrollTo(page, `#${id}`);
        await expect.poll(async () => (await chartOption(page, id))?.series?.some((s) => s.data.some((v) => +v > 0))).toBe(true);
      }
      await expect(page.locator('#reactionsNote')).toContainText('You gave');
      await expect(page.locator('#reactTimeNote')).toContainText('Median: you');
      await scrollTo(page, '#reactWhoCard');
      expect(await page.locator('#reactWho tbody tr').count()).toBeGreaterThan(0);
      await expect(page.locator('#reactTop li')).toHaveCount(5);
      const jump = await page.evaluate(() => [...document.querySelectorAll('#jumpSel option')].map((o) => o.textContent));
      for (const title of ['Reactions', 'Time to react', 'How you react', 'Who reacts the most', 'Most-reacted messages']) expect(jump).toContain(title);
    });
  });
});
