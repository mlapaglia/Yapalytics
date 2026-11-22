import { test, expect, loadFiles } from './fixtures.mjs';
import { inApp } from './state.mjs';

/*
 * Spec 014 R3: names from an export never become markup. A group chat and a sender are
 * named with markup that would set window.__xss if it ran; every place that shows them
 * must show the text instead.
 */
const GROUP = '<img src=x onerror=window.__xss=1>';
const SENDER = '<img src=y onerror=window.__xss=2>';
const FRIEND = '<svg onload=window.__xss=3>';

// On this day shows today's date in earlier years: put messages on it in 2020 (a leap
// year, so Feb 29 works too). 1/25 fixes the date order as month/day.
const now = new Date();
const today = `${now.getUTCMonth() + 1}/${now.getUTCDate()}/20`;
const chat = (lines) => Buffer.from(lines.join('\n'));
const FILES = [
  {
    name: `WhatsApp Chat with ${GROUP}.txt`,
    mimeType: 'text/plain',
    buffer: chat([
      '1/25/20, 12:00 - Me: hello group',
      '1/25/20, 12:01 - Alice: hi',
      `1/25/20, 12:02 - ${SENDER}: hey there everyone`,
      `1/25/20, 12:03 - ${SENDER}: it's me again`,
      `${today}, 12:00 - ${SENDER}: remember this day`,
      `${today}, 12:05 - Me: yes I do`,
      '2/3/21, 12:00 - Alice: later',
    ]),
  },
  {
    name: `WhatsApp Chat with ${FRIEND}.txt`,
    mimeType: 'text/plain',
    buffer: chat([
      `1/26/20, 09:00 - ${FRIEND}: morning`,
      '1/26/20, 09:01 - Me: morning to you',
      `3/4/21, 09:00 - ${FRIEND}: still here`,
    ]),
  },
  {
    name: 'WhatsApp Chat with Bob.txt',
    mimeType: 'text/plain',
    buffer: chat(['1/27/20, 10:00 - Bob: yo', '1/27/20, 10:01 - Me: hey Bob']),
  },
];

async function openTabOf(page, selector) {
  await page.evaluate((sel) => Tabs.select(document.querySelector(sel).closest('.dash-section').id), selector);
}

/** Show a chart's tooltip for its first item and return the tooltip's text. */
async function tooltipText(page, id) {
  await openTabOf(page, `#${id}`);
  await page.evaluate((id) => {
    const chart = Charts.get(id);
    chart.resize();
    chart.dispatchAction({ type: 'showTip', seriesIndex: 0, dataIndex: 0 });
  }, id);
  await expect.poll(() => page.locator(`#${id}`).textContent()).not.toBe('');
  return page.locator(`#${id}`).textContent();
}

const noScriptRan = (page) => page.evaluate(() => window.__xss);

test.describe('spec 014 escaping', () => {
  test.beforeEach(async ({ page }) => {
    await loadFiles(page, FILES);
  });

  test('AC1: chart tooltips show conversation and sender names as text', async ({ page }) => {
    expect(await tooltipText(page, 'c-contacts')).toContain(GROUP);
    expect(await tooltipText(page, 'c-groupsenders')).toContain(SENDER);
    // Series names there are cut to 22 characters.
    expect(await tooltipText(page, 'c-relationships')).toContain(GROUP.slice(0, 15));
    expect(await tooltipText(page, 'c-newpeople')).toContain(GROUP);
    expect(await noScriptRan(page)).toBeUndefined();
  });

  test('AC2: lists, dialogs and the message list show names as text', async ({ page }) => {
    // Overview: On this day names the sender and the group.
    await expect(page.locator('#otd')).toContainText(SENDER);
    await expect(page.locator('#otd')).toContainText(GROUP);

    // The conversation picker.
    await page.locator('.filters .ts-control').first().click();
    await expect(page.locator('.filters .ts-dropdown')).toContainText(GROUP);
    await page.keyboard.press('Escape');

    // People: the leaderboard, then the group's profile.
    await openTabOf(page, '#leaderTable');
    await expect(page.locator('#leaderTable')).toContainText(GROUP);
    await page.locator('#leaderTable tbody tr', { hasText: GROUP }).click();
    await expect(page.locator('#profile')).toHaveAttribute('open', '');
    await expect(page.locator('#profileName')).toHaveText(GROUP);
    await expect(page.locator('#profileBottom')).toContainText(SENDER);
    await page.locator('#profile .profile-close').click();

    // Messages: sender names on group messages.
    await openTabOf(page, '#messages');
    await expect(page.locator('#messages')).toContainText(SENDER);

    // Which one is you: the sender list.
    await page.click('#ownerBtn');
    await page.locator('#ownerList li[data-app="WhatsApp"] .ts-control').click();
    await expect(page.locator('#ownerList li[data-app="WhatsApp"] .ts-dropdown')).toContainText(SENDER);
    await page.keyboard.press('Escape');
    await page.locator('#ownerDlg .profile-close').click();

    // People dialog: link the friend and Bob by hand, then check the linked chips.
    await page.click('#peopleBtn');
    await inApp(page, (app) => {
      const keys = [...document.querySelectorAll('#peopleA option')].map((o) => o.value).filter(Boolean);
      app.pickToLink(keys[0], keys[1]);
    });
    await page.click('#peopleLink');
    await expect(page.locator('#peopleLinked')).toContainText(FRIEND);

    expect(await noScriptRan(page)).toBeUndefined();
  });

  test('R3: nothing on the page shows escaped markup as text', async ({ page }) => {
    // Each tab is checked while it's open: a hidden tab's text isn't in innerText.
    for (const sel of ['#kpis', '#leaderTable', '#c-groupsenders', '#messages', '#appsKpis', '#c-words']) {
      await openTabOf(page, sel);
      const text = await page.evaluate(() => document.body.innerText);
      for (const entity of ['&lt;', '&gt;', '&amp;', '&quot;', '&#39;']) expect(text, `${sel}'s tab`).not.toContain(entity);
    }
  });
});
