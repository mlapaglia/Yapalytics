import { test, expect, loadFiles, openTab, openLinkPeople, closeLinkPeople } from './fixtures.mjs';
import { inApp } from './state.mjs';
import { igMessage, threadOf } from '../helpers/instagram.mjs';
import { smsBackup } from '../helpers/sms.mjs';

// Alex texts over SMS and messages on Instagram (igMessage times are seconds after
// 2024-08-20 10:00 UTC; tests run in UTC).
//   Aug 18: SMS in the morning, Instagram in the evening: two conversations, no switch.
//   Aug 20: SMS 09:58 (Alex) → IG 10:01 (Alex) → IG 10:02 (you) → SMS 10:05 (you) → IG 10:06 (Alex)
//           3 switches (Alex 2, you 1), one back-and-forth conversation.
const ALEX_NUMBER = '+15551234567';
const sms = (extra = []) => smsBackup([
  ...extra,
  { address: ALEX_NUMBER, name: 'Alex Rivera', at: '2024-08-18T09:00:00Z', body: 'morning' },
  { address: ALEX_NUMBER, name: 'Alex Rivera', at: '2024-08-18T09:02:00Z', sent: true, body: 'hi' },
  { address: ALEX_NUMBER, name: 'Alex Rivera', at: '2024-08-20T09:58:00Z', body: 'leaving now' },
  { address: ALEX_NUMBER, name: 'Alex Rivera', at: '2024-08-20T10:05:00Z', sent: true, body: 'on my way' },
]);
const instagram = () => threadOf(
  igMessage(360, 'Alex', { content: 'ok see you' }),
  igMessage(120, 'Jamie', { content: 'lol' }),
  igMessage(60, 'Alex', { content: 'look at this' }),
  igMessage(-38 * 3600, 'Alex', { content: 'saw this today' }), // Aug 18, 20:00
);
const SMS_ALEX = '51234567'; // SMS threads are keyed by the last 8 digits
const PERSON = 'p:' + SMS_ALEX; // the smallest of its conversation keys

const appsTab = (page) => page.locator('#tabList [data-panel="sec-apps"]');
/** A tile's value, found by its exact label ("Switches" isn't "Who switches"). */
const tile = (page, label, box = '#appsKpis') =>
  page.locator(`${box} .kpi`, { has: page.getByText(label, { exact: true }) }).locator('.kpi-value');

async function load(page, extraSms = []) {
  await loadFiles(page, [sms(extraSms), instagram()]);
  await page.evaluate(() => setOwner(5, 'Jamie'));
}

async function linkAlex(page) {
  const igKey = await inApp(page, (app) => [...app.contacts.values()].find((c) => c.s === 5 && !c.group).key);
  await openLinkPeople(page);
  await page.selectOption('#peopleA', SMS_ALEX);
  await page.selectOption('#peopleB', igKey);
  await page.click('#peopleLink');
  await closeLinkPeople(page);
  await expect.poll(() => inApp(page, (app) => app.personOf.size)).toBe(2);
}

test.describe('spec 007 cross-app habits', () => {
  test('AC8: no tab without links; linking shows it with the switch count', async ({ page }) => {
    await load(page);
    await expect(appsTab(page)).toBeHidden();
    await linkAlex(page);
    await expect(appsTab(page)).toBeVisible();
    await openTab(page, 'sec-apps');
    await expect(tile(page, 'Switches')).toHaveText('3');
    await expect(tile(page, 'Multi-app conversations')).toHaveText('33%');
    await expect(tile(page, 'Back and forth')).toHaveText('33%');
    await expect(tile(page, 'Multi-app days')).toHaveText('100%');
    await expect(tile(page, 'Who switches')).toHaveText('They');
    await expect(page.locator('#appsTriggers li')).toHaveCount(4);
    await expect(page.locator('#appsTriggers li', { hasText: 'A plain message' })).toContainText('100% · 3');
  });

  test('AC9: one app picked hides the tab, and Overview takes over', async ({ page }) => {
    await load(page);
    await linkAlex(page);
    await openTab(page, 'sec-apps');
    await expect(appsTab(page)).toHaveAttribute('aria-selected', 'true');
    await page.click('#sourceSeg button[data-source="5"]');
    await expect(appsTab(page)).toBeHidden();
    await expect(page.locator('#tabList [data-panel="sec-glance"]')).toHaveAttribute('aria-selected', 'true');
  });

  test('AC10: the Linked people table opens the profile, which has an Across apps section', async ({ page }) => {
    await load(page);
    await linkAlex(page);
    await openTab(page, 'sec-apps');
    const rows = page.locator('#appsPeople tbody tr');
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText('Alex Rivera');
    await rows.locator('.person-link').click();
    await expect(page.locator('#profile')).toHaveAttribute('open', '');
    await expect(page.locator('#profileTop .profile-h', { hasText: 'Across apps' })).toBeVisible();
    await expect(page.locator('#profileTop .app-split-row')).toHaveCount(3);
    await expect(tile(page, 'Switches', '#profileTop')).toHaveText('3');
    await expect(tile(page, 'Who switches', '#profileTop')).toHaveText('Alex Rivera');
  });

  test('AC11: with the person selected, What each app is for has SMS and Instagram', async ({ page }) => {
    await load(page);
    await linkAlex(page);
    await page.selectOption('#contactSel', PERSON);
    await openTab(page, 'sec-apps');
    await expect(page.locator('#appsPeopleCard')).toBeHidden();
    await expect(page.locator('#appsFor thead th')).toHaveText(['', 'SMS', 'Instagram']);
    await expect(page.locator('#appsFor tbody tr', { hasText: 'Messages' }).locator('td')).toHaveText(['4', '4']);
    await expect(page.locator('#appsFor tbody tr', { hasText: 'From you' }).locator('td')).toHaveText(['50%', '25%']);
    await expect(page.locator('#appsKpis .kpi', { hasText: 'Cross-app replies' })).toContainText('1m vs');
  });

  test('AC12: a range that ends before the first switch has 0 switches', async ({ page }) => {
    await load(page);
    await linkAlex(page);
    await openTab(page, 'sec-apps');
    await page.fill('#toDate', '2024-08-18');
    await expect(tile(page, 'Switches')).toHaveText('0');
    await expect(appsTab(page)).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#appsJuggle')).toHaveText('No conversation here has moved between apps yet.');
  });

  test('M12: the biggest juggle reads that day with that person', async ({ page }) => {
    await load(page);
    await linkAlex(page);
    await inApp(page, (app) => app.showMoodMessages(app.msgs[0].mo - 1, 1, 'pos'));
    await expect(page.locator('#browserFilter')).toBeVisible();
    await openTab(page, 'sec-apps');
    await expect(page.locator('#appsJuggle')).toContainText('3 switches between SMS and Instagram with Alex Rivera');
    await page.click('#appsJuggle [data-otd-day]');
    await expect(page.locator('#tabList [data-panel="sec-messages"]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#contactSel')).toHaveValue(PERSON);
    await expect(page.locator('#fromDate')).toHaveValue('2024-08-20');
    await expect(page.locator('#toDate')).toHaveValue('2024-08-20');
    await expect(page.locator('#browserFilter')).toBeHidden();
    await expect(page.locator('#browserCount')).toContainText('5 messages · showing');
  });

  test('AC13: the tab has its own conversation gap, and 15 minutes splits a slow switch off', async ({ page }) => {
    // One more SMS 20 minutes after Alex's last Instagram message: a 4th switch at 6h and 1h, not at 15m.
    await load(page, [{ address: ALEX_NUMBER, name: 'Alex Rivera', at: '2024-08-20T10:26:00Z', sent: true, body: 'here now' }]);
    await linkAlex(page);
    await openTab(page, 'sec-apps');
    const seg = page.locator('#appsGapSeg button');
    await expect(seg).toHaveText(['15m', '30m', '1h', '6h']);
    await expect(page.locator('#appsGapSeg button.on')).toHaveText('6h');
    await expect(tile(page, 'Switches')).toHaveText('4');
    await page.click('#appsGapSeg button:text-is("1h")');
    await expect(tile(page, 'Switches')).toHaveText('4');
    await page.click('#appsGapSeg button:text-is("15m")');
    await expect(page.locator('#appsGapSeg button.on')).toHaveText('15m');
    await expect(tile(page, 'Switches')).toHaveText('3');
    await expect(page.locator('#appsNote')).toContainText('ends after 15 minutes of quiet');
    await expect(page.locator('#gapSeg button.on')).toHaveText('6h');
    expect(await inApp(page, (app) => [app.convoGap, app.appsGap])).toEqual([6 * 3600e3, 15 * 60e3]);
  });
});

test.describe('spec 010 app switches in the message list', () => {
  const markers = (page) => page.locator('#messages .app-switch');
  const pickAlex = async (page) => {
    await page.selectOption('#contactSel', PERSON);
    await openTab(page, 'sec-messages');
  };

  test('AC4: reading the biggest juggle\'s day shows one marker per switch', async ({ page }) => {
    await load(page);
    await linkAlex(page);
    await page.selectOption('#contactSel', PERSON);
    await openTab(page, 'sec-apps');
    await expect(page.locator('#appsJuggle')).toContainText('3 switches');
    await page.click('#appsJuggle [data-otd-day]');
    await expect(page.locator('#browserCount')).toContainText('5 messages · showing');
    await expect(markers(page)).toHaveCount(3);
  });

  test('AC5: a marker names the route and who moved', async ({ page }) => {
    await load(page);
    await linkAlex(page);
    await pickAlex(page);
    await expect(markers(page)).toHaveCount(3);
    await expect(markers(page).locator('.app-route')).toHaveText(['SMS → Instagram', 'Instagram → SMS', 'SMS → Instagram']);
    await expect(markers(page).locator('.app-mover')).toHaveText(['Alex moved', 'You moved', 'Alex moved']);
    await expect(markers(page).first()).toHaveAttribute('role', 'separator');
    await expect(markers(page).first()).toHaveAttribute('aria-label', 'Switched from SMS to Instagram. Alex moved.');
    // Each marker sits right before the first message on the new app.
    const next = markers(page).nth(1).locator('xpath=following-sibling::div[1]');
    await expect(next).toHaveClass(/app-0/);
    await expect(next).toContainText('on my way');
  });

  test('AC6: 15 minutes on the Across apps picker drops the marker for a 20-minute switch', async ({ page }) => {
    await load(page, [{ address: ALEX_NUMBER, name: 'Alex Rivera', at: '2024-08-20T10:26:00Z', sent: true, body: 'here now' }]);
    await linkAlex(page);
    await page.selectOption('#contactSel', PERSON);
    await openTab(page, 'sec-apps');
    await page.click('#appsGapSeg button:text-is("15m")');
    await openTab(page, 'sec-messages');
    await expect(markers(page)).toHaveCount(3);
    await openTab(page, 'sec-apps');
    await page.click('#appsGapSeg button:text-is("6h")');
    await openTab(page, 'sec-messages');
    await expect(markers(page)).toHaveCount(4);
  });

  test('AC7: every linked bubble has its app\'s edge and still names its app', async ({ page }) => {
    await load(page);
    await linkAlex(page);
    await pickAlex(page);
    const rows = page.locator('#messages .msg');
    const n = await rows.count();
    expect(n).toBe(8);
    await expect(page.locator('#messages .msg.app-edge')).toHaveCount(n);
    await expect(page.locator('#messages .msg.app-0 .who')).toHaveText(Array(4).fill('SMS'));
    await expect(page.locator('#messages .msg.app-5 .who')).toHaveText(Array(4).fill('Instagram'));
  });

  test('AC8: a search hides the markers', async ({ page }) => {
    await load(page);
    await linkAlex(page);
    await pickAlex(page);
    await expect(markers(page)).toHaveCount(3);
    await page.fill('#search', 'o');
    await expect(page.locator('#browserCount')).toContainText('matching');
    await expect(markers(page)).toHaveCount(0);
    await expect(page.locator('#messages .msg.app-edge').first()).toBeVisible();
  });

  test('AC9: no markers under All conversations or with one app picked', async ({ page }) => {
    await load(page);
    await linkAlex(page);
    await openTab(page, 'sec-messages');
    await expect(page.locator('#messages .msg').first()).toBeVisible();
    await expect(markers(page)).toHaveCount(0);
    await expect(page.locator('#messages .msg.app-edge')).toHaveCount(0);
    await expect(page.locator('#messages .who', { hasText: 'From 🔗 Alex Rivera · Instagram' }).first()).toBeVisible();
    await page.selectOption('#contactSel', PERSON);
    await expect(markers(page)).toHaveCount(3);
    await page.click('#sourceSeg button[data-source="5"]');
    await expect(page.locator('#messages .msg')).toHaveCount(4);
    await expect(markers(page)).toHaveCount(0);
    await expect(page.locator('#messages .msg.app-edge')).toHaveCount(0);
  });

  test('AC10: an unlinked conversation has no markers or edges', async ({ page }) => {
    await load(page);
    await page.selectOption('#contactSel', SMS_ALEX);
    await openTab(page, 'sec-messages');
    await expect(page.locator('#messages .msg')).toHaveCount(4);
    await expect(markers(page)).toHaveCount(0);
    await expect(page.locator('#messages .msg.app-edge')).toHaveCount(0);
  });

  test('AC11: showing earlier messages keeps the markers in place, once each', async ({ page }) => {
    // 250 more SMS on Aug 19 from midnight: the first is 4 hours after Alex's Aug 18
    // Instagram message, so it's a 4th switch, which only shows with the earlier messages.
    const extra = Array.from({ length: 250 }, (_, i) => ({
      address: ALEX_NUMBER, name: 'Alex Rivera', at: new Date(Date.parse('2024-08-19T00:00:00Z') + i * 60e3).toISOString(), sent: i % 2 === 0, body: `filler ${i}`,
    }));
    await load(page, extra);
    await linkAlex(page);
    await pickAlex(page);
    await expect(page.locator('#moreBtn')).toBeVisible();
    const labels = ['Switched from SMS to Instagram. Alex moved.', 'Switched from Instagram to SMS. You moved.', 'Switched from SMS to Instagram. Alex moved.'];
    await expect(markers(page)).toHaveCount(3);
    const before = await markers(page).evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') + ' / ' + el.nextElementSibling.textContent));
    await page.click('#moreBtn');
    await expect(page.locator('#moreBtn')).toBeHidden();
    await expect(markers(page)).toHaveCount(4);
    const after = await markers(page).evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') + ' / ' + el.nextElementSibling.textContent));
    expect(after.slice(1)).toEqual(before);
    expect(after.map((a) => a.split(' / ')[0])).toEqual(['Switched from Instagram to SMS. You moved.', ...labels]);
  });
});
