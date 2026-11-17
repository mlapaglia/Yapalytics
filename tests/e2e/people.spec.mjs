import { test, expect, loadFiles, openTab, scrollTo } from './fixtures.mjs';
import { zippedExport } from '../helpers/instagram.mjs';
import { smsBackup } from '../helpers/sms.mjs';

// The Instagram export has 1-on-1s with Alex Rivera (5 messages) and Sam Patel (1), and
// the group Road Trip 🚗. The SMS backup adds Alex Rivera (3) and Pat Lee (2).
const sms = () => smsBackup([
  { address: '+15551234567', name: 'Alex Rivera', at: '2024-08-19T09:00:00Z', body: 'see you tomorrow' },
  { address: '+15551234567', name: 'Alex Rivera', at: '2024-08-19T09:05:00Z', sent: true, body: 'yes!' },
  { address: '+15551234567', name: 'Alex Rivera', at: '2024-08-21T12:00:00Z', body: 'that was fun' },
  { address: '+15559876543', name: 'Pat Lee', at: '2024-08-19T10:00:00Z', body: 'hi, it is Sam on my new number' },
  { address: '+15559876543', name: 'Pat Lee', at: '2024-08-19T10:01:00Z', sent: true, body: 'got it' },
]);
const files = () => [sms(), zippedExport()];
const IG_ALEX = 'ig:alexrivera_1111';
const IG_SAM = 'ig:samPatel_3333';
const SMS_ALEX = '51234567'; // SMS threads are keyed by the last 8 digits
const SMS_PAT = '59876543';

const options = (page) => page.locator('#contactSel option').allTextContents();
const dialog = (page) => page.locator('#peopleDlg');

async function openDialog(page) {
  await page.click('#peopleBtn');
  await expect(dialog(page)).toHaveAttribute('open', '');
}

async function linkByHand(page, a, b) {
  await openDialog(page);
  await page.selectOption('#peopleA', a);
  await page.selectOption('#peopleB', b);
  await page.click('#peopleLink');
}

const personKey = (page, threadKey) => page.evaluate((k) => S.personOf.get(k) || null, threadKey);

test.describe('spec 005 linked people', () => {
  test.beforeEach(async ({ page }) => {
    await loadFiles(page, files());
  });

  test('AC1: an exact match is suggested, and nothing merges by itself', async ({ page }) => {
    await expect(page.locator('#peopleBtn')).toHaveText('🔗 Link people (1)');
    const opts = await options(page);
    expect(opts.some((o) => o.startsWith('Alex Rivera (3)'))).toBe(true);
    expect(opts.some((o) => o.startsWith('📸 Alex Rivera (5)'))).toBe(true);
    expect(opts.some((o) => o.startsWith('🔗'))).toBe(false);
    await openDialog(page);
    const row = page.locator('#peopleSuggest li');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Same name');
    await expect(row.locator('.person-chip')).toHaveText([/Alex Rivera\s+SMS · 3/, /Alex Rivera\s+Instagram · 5/]);
  });

  test('AC2: accepting a suggestion makes one conversation everywhere', async ({ page }) => {
    await openDialog(page);
    await page.click('#peopleSuggest [data-accept="0"]');
    await expect(page.locator('#peopleSuggest li')).toHaveCount(0);
    await expect(page.locator('#peopleBtn')).toHaveText('🔗 Link people');
    const opts = await options(page);
    expect(opts.filter((o) => o.includes('Alex Rivera'))).toEqual(['🔗 Alex Rivera (8)']);
    const key = await personKey(page, IG_ALEX);
    expect(key).toBe(await personKey(page, SMS_ALEX));
    await page.locator('#peopleDlg .profile-close').click();
    await scrollTo(page, '#leaderTable');
    await expect(page.locator(`#leaderTable tbody tr[data-key="${key}"]`)).toHaveCount(1);
    await expect(page.locator(`#leaderTable tbody tr[data-key="${IG_ALEX}"], #leaderTable tbody tr[data-key="${SMS_ALEX}"]`)).toHaveCount(0);
  });

  test('AC5: group chats are never offered', async ({ page }) => {
    await openDialog(page);
    const picks = await page.locator('#peopleA option').allTextContents();
    expect(picks.some((o) => o.includes('Road Trip'))).toBe(false);
    expect(picks.length).toBe(5); // "Choose…" plus Alex ×2, Pat Lee and Sam Patel
    await expect(page.locator('#peopleSuggest')).not.toContainText('Road Trip');
  });

  test('AC6: linking by hand merges, and the profile names both apps', async ({ page }) => {
    await linkByHand(page, SMS_PAT, IG_SAM);
    const key = await personKey(page, IG_SAM);
    expect(key).toBeTruthy();
    expect(await options(page)).toContain('🔗 Pat Lee (3)');
    await page.locator('#peopleDlg .profile-close').click();
    await page.evaluate((k) => openProfile(k), key);
    await expect(page.locator('.profile-head .sub').first()).toContainText('1-on-1 on SMS and Instagram');
    await expect(page.locator('.profile-linked')).toContainText('Sam Patel (Instagram)');
    await expect(page.locator('[data-link-people]')).toHaveText('Manage links…');
  });

  test('AC6: a 1-on-1 profile opens the dialog with that conversation picked', async ({ page }) => {
    await page.evaluate((k) => openProfile(k), IG_SAM);
    await page.click('[data-link-people]');
    await expect(dialog(page)).toHaveAttribute('open', '');
    await expect(page.locator('#peopleA')).toHaveValue(IG_SAM);
    await page.selectOption('#peopleB', SMS_PAT);
    await page.click('#peopleLink');
    expect(await personKey(page, SMS_PAT)).toBeTruthy();
  });

  test('AC7: unlinking shows the conversations on their own again', async ({ page }) => {
    await openDialog(page);
    await page.click('#peopleSuggest [data-accept="0"]');
    await page.click(`#peopleLinked [data-unlink="${IG_ALEX}"]`);
    await expect(page.locator('#peopleLinked li')).toHaveCount(0);
    const opts = await options(page);
    expect(opts.some((o) => o.startsWith('Alex Rivera (3)'))).toBe(true);
    expect(opts.some((o) => o.startsWith('📸 Alex Rivera (5)'))).toBe(true);
    expect(await page.evaluate(() => S.msgs.some((m) => m.tk))).toBe(false);
  });

  test('AC8: links survive a reload, and Forget all links clears them', async ({ page }) => {
    await linkByHand(page, SMS_PAT, IG_SAM);
    await loadFiles(page, files()); // goes to the page again: a fresh start
    expect(await options(page)).toContain('🔗 Pat Lee (3)');
    await openDialog(page);
    await page.click('#peopleForget');
    expect((await options(page)).some((o) => o.startsWith('🔗'))).toBe(false);
    expect(await page.evaluate(() => localStorage.getItem('ms-people'))).toBeNull();
  });

  test('AC9: a dismissed suggestion stays dismissed after a reload', async ({ page }) => {
    await openDialog(page);
    await page.click('#peopleSuggest [data-dismiss="0"]');
    await expect(page.locator('#peopleBtn')).toHaveText('🔗 Link people');
    await loadFiles(page, files());
    await expect(page.locator('#peopleBtn')).toHaveText('🔗 Link people');
    expect((await options(page)).some((o) => o.startsWith('🔗'))).toBe(false);
  });

  test('AC10: the app filter counts and shows only that app', async ({ page }) => {
    await openDialog(page);
    await page.click('#peopleSuggest [data-accept="0"]');
    await page.locator('#peopleDlg .profile-close').click();
    await page.click('#sourceSeg [data-source="5"]');
    expect(await options(page)).toContain('🔗 Alex Rivera (5)');
    const key = await personKey(page, IG_ALEX);
    await page.selectOption('#contactSel', key);
    await openTab(page, 'sec-messages');
    await expect(page.locator('#browserCount')).toContainText('5 messages');
  });

  test('AC11: a linked person\'s messages name their app', async ({ page }) => {
    await openDialog(page);
    await page.click('#peopleSuggest [data-accept="0"]');
    await page.locator('#peopleDlg .profile-close').click();
    await openTab(page, 'sec-messages');
    const who = page.locator('#messages .who');
    await expect(who.filter({ hasText: 'From 🔗 Alex Rivera · SMS' }).first()).toBeVisible();
    await expect(who.filter({ hasText: 'From 🔗 Alex Rivera · Instagram' }).first()).toBeVisible();
    await page.selectOption('#contactSel', await personKey(page, IG_ALEX));
    await expect(who.filter({ hasText: /^Instagram$/ }).first()).toBeVisible();
    await expect(who.filter({ hasText: /^SMS$/ }).first()).toBeVisible();
  });

  test('AC12: with no links, nothing changes', async ({ page }) => {
    expect(await page.evaluate(() => S.msgs.some((m) => m.tk || m.k.startsWith('p:')))).toBe(false);
    expect(await page.evaluate(() => [...S.contacts.values()].some((c) => c.person))).toBe(false);
    const opts = await options(page);
    expect(opts[0]).toBe('All conversations (13)');
  });

  test('AC13: the People filter finds a person by any of its names', async ({ page }) => {
    await linkByHand(page, SMS_PAT, IG_SAM);
    await page.locator('#peopleDlg .profile-close').click();
    await page.fill('#peopleInput', 'sam patel');
    await expect.poll(() => options(page)).toContain('🔗 Pat Lee (3)');
  });

  test('AC14: the name defaults to the contact name and can be changed', async ({ page }) => {
    await linkByHand(page, IG_SAM, SMS_PAT);
    const name = page.locator('#peopleLinked select.person-name');
    await expect(name).toHaveValue('Pat Lee');
    await name.selectOption('Sam Patel');
    await expect.poll(() => options(page)).toContain('🔗 Sam Patel (3)');
    await loadFiles(page, files());
    expect(await options(page)).toContain('🔗 Sam Patel (3)');
  });
});
