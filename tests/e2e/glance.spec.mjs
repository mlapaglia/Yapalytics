import { test, expect, loadDemo, loadFiles, scrollTo, chartOption } from './fixtures.mjs';
import { zippedFullExport } from '../helpers/telegram.mjs';

const NOW = new Date('2026-10-15T12:00:00Z');
const profile = (page) => page.locator('#profile');

test.describe('highlights', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(NOW);
    await loadDemo(page);
  });

  test('lists the notable findings with links to profiles', async ({ page }) => {
    const items = page.locator('#highlights li:not([hidden])');
    await expect(items.first()).toBeVisible();
    expect(await items.count()).toBeGreaterThanOrEqual(3);
    expect(await items.count()).toBeLessThanOrEqual(6);
    await expect(items.first()).toContainText('is your most-messaged conversation');
    await expect(page.locator('#highlights .person-link').first()).toBeVisible();
  });

  test('AC18 (spec 008): shows 6, and the rest behind Show more', async ({ page }) => {
    const shown = page.locator('#highlights li:not([hidden])');
    const more = page.locator('#highlightsMore');
    const all = await page.locator('#highlights li').count();
    expect(all).toBeGreaterThan(6);
    await expect(shown).toHaveCount(6);
    await expect(more).toHaveText(`Show ${all - 6} more`);
    await more.click();
    await expect(shown).toHaveCount(all);
    await expect(more).toHaveText('Show fewer');
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    await more.click();
    await expect(shown).toHaveCount(6);
    await expect(more).toHaveText(`Show ${all - 6} more`);
  });

  test('talk about one conversation when one is selected', async ({ page }) => {
    const key = await page.evaluate(() => S.topRows[0].key);
    await page.selectOption('#contactSel', key);
    await expect(page.locator('#highlights')).not.toContainText('most-messaged conversation');
    await expect(page.locator('#highlights')).toContainText(/here/);
  });
});

test.describe('profiles', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(NOW);
    await loadDemo(page);
  });

  test('open from a highlight with stats, a comparison, a chart and how it started', async ({ page }) => {
    const link = page.locator('#highlights .person-link').first();
    const name = (await link.textContent()).trim();
    await link.click();
    await expect(profile(page)).toHaveAttribute('open', '');
    await expect(page.locator('#profileName')).toHaveText(name);
    await expect(page.locator('.profile-kpis .kpi')).toHaveCount(6);
    await expect(page.locator('.vs tbody tr')).toHaveCount(8);
    await expect(page.locator('.vs thead th').nth(2)).toHaveText(name);
    await expect(page.locator('.first-msg')).toBeVisible();
    await expect.poll(async () => (await chartOption(page, 'c-profile'))?.series?.length ?? 0).toBe(2);
    // The numbers match the conversation's messages.
    const want = await page.evaluate((n) => {
      const key = [...S.contacts.values()].find((c) => plainName(c.key) === n).key;
      const msgs = S.msgs.filter((m) => m.k === key);
      return { n: msgs.length, you: msgs.filter((m) => m.o).length };
    }, name);
    await expect(page.locator('.profile-kpis .kpi').first()).toContainText(want.n.toLocaleString('en-US'));
    await expect(page.locator('.vs tbody tr').first()).toContainText(want.you.toLocaleString('en-US'));
  });

  test('open from the leaderboard, and focus the dashboard from there', async ({ page }) => {
    await scrollTo(page, '#leaderCard');
    const row = page.locator('#leaderTable tbody tr').nth(1);
    const key = await row.getAttribute('data-key');
    await row.click();
    await expect(profile(page)).toHaveAttribute('open', '');
    await page.click('[data-focus]');
    await expect(profile(page)).not.toHaveAttribute('open');
    await expect(page.locator('#contactSel')).toHaveValue(key);
    await expect(page.locator('#profileBtn')).toBeVisible();
    await page.click('#profileBtn');
    await expect(profile(page)).toHaveAttribute('open', '');
  });

  test('show the most active members of a group', async ({ page }) => {
    const key = await page.evaluate(() => [...S.contacts.keys()].find((k) => k.startsWith('g:') && S.msgs.some((m) => m.k === k)));
    await page.evaluate((k) => openProfile(k), key);
    await expect(page.locator('.profile-head .sub')).toContainText('Group chat');
    await expect(page.locator('.member-list li').first()).toBeVisible();
    await expect(page.locator('.vs thead th').nth(2)).toHaveText('Everyone else');
  });

  test('close with the X, the backdrop or Escape', async ({ page }) => {
    const open = () => page.locator('#highlights .person-link').first().click();
    await open();
    await page.click('#profile .profile-close');
    await expect(profile(page)).not.toHaveAttribute('open');
    await open();
    await page.mouse.click(10, 10);
    await expect(profile(page)).not.toHaveAttribute('open');
    await open();
    await page.keyboard.press('Escape');
    await expect(profile(page)).not.toHaveAttribute('open');
  });
});

test.describe('on this day', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(NOW);
  });

  test('shows today in earlier years, and reads a day in the message list', async ({ page }) => {
    await loadDemo(page);
    await expect(page.locator('#otdDate')).toHaveText('October 15');
    await expect(page.locator('#otdToday')).toBeHidden();
    const years = page.locator('.otd-year');
    await expect(years.first()).toContainText(/1 year ago\s+Wed, Oct 15, 2025/);
    const counted = Number((await years.first().locator('.otd-head .muted').textContent()).match(/([\d,]+) message/)[1].replace(/,/g, ''));
    await years.first().locator('[data-otd-day]').click();
    await expect(page.locator('#fromDate')).toHaveValue('2025-10-15');
    await expect(page.locator('#toDate')).toHaveValue('2025-10-15');
    await expect(page.locator('#browserCount')).toContainText(`${counted.toLocaleString('en-US')} message`);
  });

  test('reading a day clears a previous mood chart filter', async ({ page }) => {
    await loadDemo(page);
    const year = page.locator('.otd-year').first();
    const counted = Number((await year.locator('.otd-head .muted').textContent()).match(/([\d,]+) message/)[1].replace(/,/g, ''));
    const day = Number(await year.locator('[data-otd-day]').getAttribute('data-otd-day'));
    await page.evaluate((t) => {
      const d = new Date(t);
      showMoodMessages(d.getFullYear() * 12 + d.getMonth() - 1, 1, 'pos');
    }, day);
    await expect(page.locator('#browserFilter')).toBeVisible();
    await page.click('#tabList [data-panel="sec-glance"]');
    await year.locator('[data-otd-day]').click();
    await expect(page.locator('#browserFilter')).toBeHidden();
    await expect(page.locator('#browserCount')).toContainText(`${counted.toLocaleString('en-US')} message`);
    await expect(page.locator('#fromDate')).toHaveValue('2025-10-15');
    await expect(page.locator('#toDate')).toHaveValue('2025-10-15');
  });

  test('moves between days and back to today', async ({ page }) => {
    await loadDemo(page);
    await page.click('#otdPrev');
    await expect(page.locator('#otdDate')).toHaveText('October 14');
    await expect(page.locator('#otdToday')).toBeVisible();
    await page.click('#otdNext');
    await page.click('#otdNext');
    await expect(page.locator('#otdDate')).toHaveText('October 16');
    await page.click('#otdToday');
    await expect(page.locator('#otdDate')).toHaveText('October 15');
  });

  test('jumps to the nearest day with messages when the date has none', async ({ page }) => {
    await loadFiles(page, zippedFullExport()); // every message is on August 20, 2024
    await expect(page.locator('#otd .empty')).toHaveText('Nothing on this date in earlier years.');
    await page.click('[data-otd-goto]');
    await expect(page.locator('#otdDate')).toHaveText('August 20');
    await expect(page.locator('.otd-year').first()).toContainText('2 years ago');
    await expect(page.locator('.otd-msg').first()).toBeVisible();
  });
});
