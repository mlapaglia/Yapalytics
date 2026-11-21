import { test, expect, loadFiles, TOM_SELECT_URL } from './fixtures.mjs';
import { zippedExport } from '../helpers/instagram.mjs';
import { smsBackup } from '../helpers/sms.mjs';

// The Instagram export has 1-on-1s with Alex Rivera and Sam Patel, and the group
// Road Trip 🚗 (Sam Patel, Alex Rivera and you). The SMS backup adds Alex Rivera and Pat Lee.
const sms = () => smsBackup([
  { address: '+15551234567', name: 'Alex Rivera', at: '2024-08-19T09:00:00Z', body: 'see you tomorrow' },
  { address: '+15551234567', name: 'Alex Rivera', at: '2024-08-19T09:05:00Z', sent: true, body: 'yes!' },
  { address: '+15559876543', name: 'Pat Lee', at: '2024-08-19T10:00:00Z', body: 'hi, it is Sam on my new number' },
  { address: '+15559876543', name: 'Pat Lee', at: '2024-08-19T10:01:00Z', sent: true, body: 'got it' },
]);
const files = () => [sms(), zippedExport()];
const IG_ALEX = 'ig:alexrivera_1111';
const IG_SAM = 'ig:samPatel_3333';
const SMS_ALEX = '51234567'; // SMS threads are keyed by the last 8 digits
const SMS_PAT = '59876543';

/** The picker Tom Select built for a <select id>: its control, its rows, one row by value. */
const control = (page, id) => page.locator(`#${id} + .ts-wrapper .ts-control`);
const rows = (page, id) => page.locator(`#${id}-ts-dropdown .option`);
const row = (page, id, value) => page.locator(`#${id}-ts-dropdown .option[data-value="${value}"]`);
const rowValues = (page, id) => rows(page, id).evaluateAll((els) => els.map((e) => e.dataset.value));

async function search(page, id, text) {
  await control(page, id).click();
  // Tom Select finishes focusing on a timeout; a key typed before then is dropped.
  await expect(page.locator(`#${id}-ts-dropdown`)).toBeVisible();
  await page.keyboard.type(text);
  await expect(page.locator(`#${id} + .ts-wrapper .dropdown-input`)).toHaveValue(text);
}

async function pick(page, id, text, value) {
  await search(page, id, text);
  await row(page, id, value).click();
}

const groupKey = (page) => page.evaluate(() => [...S.contacts.values()].find((c) => c.group && c.s === 5)?.key);

async function linkByHand(page, a, b) {
  await page.click('#peopleBtn');
  await pick(page, 'peopleA', 'pat', a);
  await pick(page, 'peopleB', 'sam', b);
  await page.click('#peopleLink');
  await page.locator('#peopleDlg .profile-close').click();
}

test.describe('spec 012 searchable conversation pickers', () => {
  test.beforeEach(async ({ page }) => {
    await loadFiles(page, files());
  });

  test('AC1: typing a member\'s name lists their group chats', async ({ page }) => {
    const group = await groupKey(page);
    expect(group).toBeTruthy();
    await search(page, 'contactSel', 'sam patel');
    await expect.poll(() => rowValues(page, 'contactSel')).toContain(group);
  });

  test('AC2: typing part of a phone number finds the 1-on-1', async ({ page }) => {
    await search(page, 'contactSel', '98765');
    await expect.poll(() => rowValues(page, 'contactSel')).toEqual(['all', SMS_PAT]);
  });

  test('AC3: picking a result selects that conversation', async ({ page }) => {
    await pick(page, 'contactSel', 'pat lee', SMS_PAT);
    await expect(page.locator('#contactSel')).toHaveValue(SMS_PAT);
    expect(await page.evaluate(() => S.filter.contact)).toBe(SMS_PAT);
    await expect(page.locator('#scope')).toContainText('Pat Lee');
    await expect(control(page, 'contactSel')).toContainText('Pat Lee');
  });

  test('AC4: a linked person is found by any of its names', async ({ page }) => {
    await linkByHand(page, SMS_PAT, IG_SAM);
    const person = await page.evaluate((k) => S.personOf.get(k), SMS_PAT);
    await search(page, 'contactSel', 'sam patel');
    await expect.poll(() => rowValues(page, 'contactSel')).toContain(person);
    await expect(row(page, 'contactSel', person)).toContainText('Pat Lee');
  });

  test('AC5: the Link by hand pickers search and link', async ({ page }) => {
    await page.click('#peopleBtn');
    await search(page, 'peopleA', 'pat lee');
    await expect.poll(() => rowValues(page, 'peopleA')).toEqual([SMS_PAT]);
    await row(page, 'peopleA', SMS_PAT).click();
    await pick(page, 'peopleB', 'sam', IG_SAM);
    await expect(page.locator('#peopleLink')).toBeEnabled();
    await page.click('#peopleLink');
    expect(await page.evaluate(([a, b]) => S.personOf.get(a) === S.personOf.get(b) && S.personOf.has(a), [SMS_PAT, IG_SAM])).toBe(true);
  });

  test('AC6: with an app filter, only that app is searched', async ({ page }) => {
    await page.click('#sourceSeg button[data-source="5"]');
    await search(page, 'contactSel', 'pat lee');
    await expect.poll(() => rowValues(page, 'contactSel')).toEqual(['all']);
    await expect(rows(page, 'contactSel')).toContainText(['All conversations']);
  });

  test('AC7: the People text box is gone', async ({ page }) => {
    await expect(page.locator('#peopleInput')).toHaveCount(0);
  });

  test('AC8: rows and the picked item show the app logo', async ({ page }) => {
    await search(page, 'contactSel', 'alex');
    await expect(row(page, 'contactSel', IG_ALEX).locator('use')).toHaveAttribute('href', '#logo-instagram');
    await expect(row(page, 'contactSel', IG_ALEX)).not.toContainText('📸');
    await expect(row(page, 'contactSel', SMS_ALEX).locator('use')).toHaveAttribute('href', '#logo-sms');
    await row(page, 'contactSel', IG_ALEX).click();
    await expect(control(page, 'contactSel').locator('.item use')).toHaveAttribute('href', '#logo-instagram');
  });

  test('AC9: a linked person shows each app\'s logo and no 🔗', async ({ page }) => {
    await linkByHand(page, SMS_PAT, IG_SAM);
    const person = await page.evaluate((k) => S.personOf.get(k), SMS_PAT);
    await search(page, 'contactSel', 'pat');
    const r = row(page, 'contactSel', person);
    await expect(r.locator('use')).toHaveCount(2);
    expect(await r.locator('use').evaluateAll((els) => els.map((e) => e.getAttribute('href')).sort()))
      .toEqual(['#logo-instagram', '#logo-sms']);
    await expect(r).not.toContainText('🔗');
  });

  test('AC10: the Link by hand rows show the app logo', async ({ page }) => {
    await page.click('#peopleBtn');
    await expect(control(page, 'peopleA').locator('.items-placeholder')).toHaveAttribute('placeholder', 'Choose a conversation…');
    await search(page, 'peopleA', 'alex');
    await expect(row(page, 'peopleA', IG_ALEX).locator('use')).toHaveAttribute('href', '#logo-instagram');
    await expect(row(page, 'peopleA', SMS_ALEX).locator('use')).toHaveAttribute('href', '#logo-sms');
  });

  test('AC11: each row\'s accessible text names its app', async ({ page }) => {
    await search(page, 'contactSel', 'alex');
    // The row Tom Select renders is the option itself.
    await expect(row(page, 'contactSel', IG_ALEX)).toHaveAttribute('aria-label', /^Alex Rivera, Instagram, \d+ messages?$/);
    await expect(row(page, 'contactSel', SMS_ALEX)).toHaveAttribute('aria-label', /^Alex Rivera, SMS, 2 messages$/);
    await expect(row(page, 'contactSel', SMS_ALEX).locator('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  test('R9: each picker\'s combobox has a name', async ({ page }) => {
    // The focusable control, not the hidden <select> (which keeps its own name).
    await expect(control(page, 'contactSel')).toHaveAttribute('role', 'combobox');
    await expect(control(page, 'contactSel')).toHaveAccessibleName('Conversation');
    await page.click('#peopleBtn');
    await expect(control(page, 'peopleA')).toHaveAccessibleName('Conversation to link');
    await expect(control(page, 'peopleB')).toHaveAccessibleName('Conversation with the same person');
  });

  test('R9: Backspace in an empty search keeps the conversation', async ({ page }) => {
    await pick(page, 'contactSel', 'pat lee', SMS_PAT);
    await control(page, 'contactSel').click();
    await expect(page.locator('#contactSel-ts-dropdown')).toBeVisible();
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Escape');
    await expect(page.locator('#contactSel')).toHaveValue(SMS_PAT);
    expect(await page.evaluate(() => S.filter.contact)).toBe(SMS_PAT);
    await expect(control(page, 'contactSel')).toContainText('Pat Lee');
  });

  test('AC13: the keyboard picks, and Escape keeps the conversation', async ({ page }) => {
    await control(page, 'contactSel').focus();
    await page.keyboard.type('alex');
    await expect(page.locator('#contactSel + .ts-wrapper .dropdown-input')).toHaveValue('alex');
    await expect.poll(async () => (await rowValues(page, 'contactSel')).includes(IG_ALEX)).toBe(true);
    await page.keyboard.press('ArrowDown');
    const active = await page.locator('#contactSel-ts-dropdown .option.active').getAttribute('data-value');
    expect(active).not.toBe('all');
    await page.keyboard.press('Enter');
    await expect(page.locator('#contactSel')).toHaveValue(active);

    await search(page, 'contactSel', 'pat');
    await page.keyboard.press('Escape');
    await expect(page.locator('#contactSel-ts-dropdown')).toBeHidden();
    await expect(page.locator('#contactSel')).toHaveValue(active);
    expect(await page.evaluate(() => S.filter.contact)).toBe(active);
  });

  test('AC14: the closed picker follows the dark theme', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await pick(page, 'contactSel', 'pat lee', SMS_PAT);
    await page.locator('#scope').click(); // close the picker
    const colours = await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.style.cssText = 'background: var(--surface); color: var(--text)';
      document.body.append(probe);
      const want = getComputedStyle(probe);
      const got = getComputedStyle(document.querySelector('#contactSel + .ts-wrapper .ts-control'));
      const r = { want: [want.backgroundColor, want.color], got: [got.backgroundColor, got.color] };
      probe.remove();
      return r;
    });
    expect(colours.got).toEqual(colours.want);
  });

  test('R2: All conversations stays first, and the plain list keeps its order', async ({ page }) => {
    const values = () => page.locator('#contactSel option').evaluateAll((els) => els.map((e) => e.value));
    const before = await values();
    expect(before[0]).toBe('all');
    await pick(page, 'contactSel', 'pat lee', SMS_PAT);
    expect(await values()).toEqual(before);
    await pick(page, 'contactSel', 'all', 'all');
    const after = await values();
    expect(after).toEqual(before);
    expect(new Set(after).size).toBe(after.length);
  });
});

test.describe('spec 012 without the picker library', () => {
  test('AC12: the plain dropdown still works', async ({ page }) => {
    await page.route(TOM_SELECT_URL, (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
    await loadFiles(page, files());
    await expect(page.locator('.ts-wrapper')).toHaveCount(0);
    await expect(page.locator('#contactSel')).toBeVisible();
    await page.selectOption('#contactSel', SMS_PAT);
    expect(await page.evaluate(() => S.filter.contact)).toBe(SMS_PAT);
    await expect(page.locator('#scope')).toContainText('Pat Lee');
  });
});
