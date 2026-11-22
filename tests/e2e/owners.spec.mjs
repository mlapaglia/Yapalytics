import { test, expect, loadDemo, loadFiles } from './fixtures.mjs';
import { inApp } from './state.mjs';
import { smsBackup } from '../helpers/sms.mjs';

// The demo's WhatsApp owner is guessed; Telegram, Instagram and Messenger name you in
// their export profiles.
const dialog = (page) => page.locator('#ownerDlg');
const row = (page, app) => page.locator(`#ownerList li[data-app="${app}"]`);
const control = (page, app) => row(page, app).locator('.ts-control');
const SOURCE = { WhatsApp: 2, Instagram: 5 };

/** Messages from an app, and how many count as sent by you. */
const counts = (page, s) => inApp(page, (app, s) => {
  const ms = app.msgs.filter((m) => m.s === s);
  return { n: ms.length, sent: ms.filter((m) => m.o === 1).length };
}, s);

/** An app's sender names other than the current owner, most messages first. */
const others = (page, app) => row(page, app).locator('select option').evaluateAll((els) =>
  els.filter((e) => !e.selected).map((e) => e.value));

async function openDialog(page) {
  await page.click('#ownerBtn');
  await expect(dialog(page)).toHaveAttribute('open', '');
}

async function pickOwner(page, app, name) {
  await control(page, app).click();
  await expect(row(page, app).locator('.ts-dropdown')).toBeVisible();
  await page.keyboard.type(name);
  await row(page, app).locator(`.ts-dropdown .option[data-value="${name}"]`).click();
}

test.describe('spec 013 which one is you', () => {
  test.beforeEach(async ({ page }) => {
    await loadDemo(page);
  });

  test('AC1: the filter bar has no You on dropdowns, and shows the button', async ({ page }) => {
    await expect(page.locator('.filters')).not.toContainText('You on');
    await expect(page.locator('#ownerFields')).toHaveCount(0);
    await expect(page.locator('#ownerBtn')).toBeVisible();
    await expect(page.locator('#ownerBtn')).toContainText('Which one is you?');
  });

  test('AC3: the dialog lists each app with its logo and current owner', async ({ page }) => {
    await openDialog(page);
    expect(await page.locator('#ownerList li').evaluateAll((els) => els.map((e) => e.dataset.app)))
      .toEqual(['WhatsApp', 'Telegram', 'Instagram', 'Messenger']);
    await expect(row(page, 'WhatsApp').locator('.owner-app use')).toHaveAttribute('href', '#logo-whatsapp');
    await expect(row(page, 'Instagram').locator('.owner-app use')).toHaveAttribute('href', '#logo-instagram');
    await expect(row(page, 'Instagram').locator('select')).toHaveValue('Jamie Park');
    await expect(control(page, 'Instagram')).toContainText('Jamie Park');
    await expect(control(page, 'Instagram')).toHaveAccessibleName('Instagram');
  });

  test('AC4: picking a name relabels that app only, and the dialog stays open', async ({ page }) => {
    const wa = await counts(page, SOURCE.WhatsApp);
    const ig = await counts(page, SOURCE.Instagram);
    await openDialog(page);
    const [name] = await others(page, 'Instagram');
    await pickOwner(page, 'Instagram', name);
    await expect.poll(() => counts(page, SOURCE.Instagram)).not.toEqual(ig);
    const after = await counts(page, SOURCE.Instagram);
    expect(after.n).toBe(ig.n);
    expect(await inApp(page, (app, s) => app.msgs.filter((m) => m.s === s && m.o === 1).every((m) => m.sn === app.owners[s].name), SOURCE.Instagram)).toBe(true);
    expect(await counts(page, SOURCE.WhatsApp)).toEqual(wa);
    await expect(dialog(page)).toHaveAttribute('open', '');
    await expect(row(page, 'Instagram').locator('select')).toHaveValue(name);
  });

  test('AC5: typing narrows a row to matching senders', async ({ page }) => {
    await openDialog(page);
    const [name] = await others(page, 'WhatsApp');
    const part = name.split(' ')[0].slice(0, 3).toLowerCase();
    await control(page, 'WhatsApp').click();
    await expect(row(page, 'WhatsApp').locator('.ts-dropdown')).toBeVisible();
    await page.keyboard.type(part);
    const shown = row(page, 'WhatsApp').locator('.ts-dropdown .option');
    await expect.poll(async () => (await shown.allTextContents()).every((t) => t.toLowerCase().includes(part))).toBe(true);
    const all = await row(page, 'WhatsApp').locator('select option').count();
    expect(await shown.count()).toBeLessThan(all);
    await expect(shown.filter({ hasText: name })).toHaveCount(1);
  });

  test('AC6: each row says where its owner came from', async ({ page }) => {
    await openDialog(page);
    await expect(row(page, 'Instagram').locator('.owner-origin')).toHaveText('From your export profile');
    await expect(row(page, 'WhatsApp').locator('.owner-origin')).toHaveText('Guessed: check this');
    const [name] = await others(page, 'WhatsApp');
    await pickOwner(page, 'WhatsApp', name);
    await expect(row(page, 'WhatsApp').locator('.owner-origin')).toHaveText('Picked by you');
  });

  test('R5: Backspace in an empty search keeps the owner shown', async ({ page }) => {
    await openDialog(page);
    await control(page, 'Instagram').click();
    await expect(row(page, 'Instagram').locator('.ts-dropdown')).toBeVisible();
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Escape');
    await expect(row(page, 'Instagram').locator('select')).toHaveValue('Jamie Park');
    await expect(control(page, 'Instagram')).toContainText('Jamie Park');
    expect(await inApp(page, (app) => app.owners[5].name)).toBe('Jamie Park');
  });

  test('AC7: ✕, the backdrop and Escape close the dialog', async ({ page }) => {
    await openDialog(page);
    await dialog(page).locator('.profile-close').click();
    await expect(dialog(page)).not.toHaveAttribute('open', '');

    await openDialog(page);
    await page.mouse.click(5, 5); // the backdrop
    await expect(dialog(page)).not.toHaveAttribute('open', '');

    await openDialog(page);
    await page.keyboard.press('Escape');
    await expect(dialog(page)).not.toHaveAttribute('open', '');
  });

  test('AC8: the button counts apps whose owner is a guess', async ({ page }) => {
    const btn = page.locator('#ownerBtn');
    await expect(btn).toHaveText('👤 Which one is you? (1)');
    await expect(btn).toHaveAttribute('title', "Check WhatsApp: who's you was guessed");
    await openDialog(page);
    const [name] = await others(page, 'WhatsApp');
    await pickOwner(page, 'WhatsApp', name);
    await expect(btn).toHaveText('👤 Which one is you?');
    await expect(btn).toHaveAttribute('title', "Pick which sender is you in apps whose exports don't say");
  });
});

test('spec 013 AC2: with only an SMS backup, the button is hidden', async ({ page }) => {
  await loadFiles(page, smsBackup([{ address: '+15559876543', name: 'Pat Lee', at: '2024-08-19T10:00:00Z', body: 'hi' }]));
  await expect(page.locator('#ownerBtn')).toBeHidden();
});
