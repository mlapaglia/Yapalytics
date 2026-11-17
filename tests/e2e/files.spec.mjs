/*
 * specs/006-file-manager.md in the browser: the Files button and dialog.
 */
import { writeFileSync } from 'node:fs';
import { test, expect, loadFiles, loadDemo } from './fixtures.mjs';
import { smsBackup } from '../helpers/sms.mjs';
import { resultJson, singleChatExport, zippedHtmlExport } from '../helpers/telegram.mjs';

// SMS: Alex Rivera (3) and Pat Lee (2). Telegram: a 1-on-1 with Alex Rivera (3).
const SMS_MESSAGES = [
  { address: '+15551234567', name: 'Alex Rivera', at: '2024-08-19T09:00:00Z', body: 'see you tomorrow' },
  { address: '+15551234567', name: 'Alex Rivera', at: '2024-08-19T09:05:00Z', sent: true, body: 'yes!' },
  { address: '+15551234567', name: 'Alex Rivera', at: '2024-08-21T12:00:00Z', body: 'that was fun' },
  { address: '+15559876543', name: 'Pat Lee', at: '2024-08-19T10:00:00Z', body: 'hi, new number' },
  { address: '+15559876543', name: 'Pat Lee', at: '2024-08-19T10:01:00Z', sent: true, body: 'got it' },
];
const sms = (name) => smsBackup(SMS_MESSAGES, name);
const telegram = () => resultJson(singleChatExport());
const SMS_PAT = '59876543';

const dialog = (page) => page.locator('#filesDlg');
const rows = (page) => page.locator('#filesList li[data-file]');
const row = (page, name) => rows(page).filter({ hasText: name });
const options = (page) => page.locator('#contactSel option').allTextContents();
const counts = (page) => page.evaluate(() => ({ msgs: S.msgs.length, telegram: S.msgs.filter((m) => m.s === 4).length }));

async function openDialog(page) {
  await page.click('#filesBtn');
  await expect(dialog(page)).toHaveAttribute('open', '');
}

async function apply(page) {
  await page.click('#filesApply');
  await expect(dialog(page)).not.toHaveAttribute('open', '');
}

/** Waits until the rebuilt dashboard is showing. */
async function dashboard(page) {
  await expect(page.locator('#landing')).toBeHidden({ timeout: 60_000 });
  await expect(page.locator('#dash')).toBeVisible();
}

test.describe('spec 006 managing loaded files', () => {
  test('AC1: the filter bar shows a Files button, and no file names or Add files button', async ({ page }) => {
    await loadFiles(page, [sms(), telegram()]);
    await expect(page.locator('#filesBtn')).toHaveText('📁 Files (2)');
    await expect(page.locator('#dash .filters')).not.toContainText('Add files');
    await expect(page.locator('#dash')).not.toContainText('sms-20240821.xml');
    await expect(page.locator('#dash')).not.toContainText('result.json');
  });

  test('AC2: the dialog lists each file with a checkbox, logo, name, size and remove button', async ({ page }) => {
    await loadFiles(page, [sms(), telegram()]);
    await openDialog(page);
    await expect(rows(page)).toHaveCount(2);
    const smsRow = row(page, 'sms-20240821.xml');
    await expect(smsRow.locator('input[type="checkbox"]')).toBeChecked();
    await expect(smsRow.locator('use')).toHaveAttribute('href', '#logo-sms');
    await expect(smsRow.locator('.files-size')).toHaveText(/^\d+(\.\d)? (B|KB)$/);
    await expect(smsRow.getByRole('button', { name: 'Remove sms-20240821.xml' })).toBeVisible();
    await expect(row(page, 'result.json').locator('use')).toHaveAttribute('href', '#logo-telegram');
  });

  test('AC3: unchecking a file leaves its conversations out, and checking it again brings them back', async ({ page }) => {
    await loadFiles(page, [sms(), telegram()]);
    const before = await counts(page);
    expect(before.telegram).toBe(3);
    await expect(page.locator('#sourceSeg')).toBeVisible();

    await openDialog(page);
    await row(page, 'result.json').locator('input').uncheck();
    await apply(page);
    await dashboard(page);
    await expect(page.locator('#filesBtn')).toHaveText('📁 Files (1 of 2)');
    expect((await options(page)).some((o) => o.startsWith('✈️'))).toBe(false);
    await expect(page.locator('#sourceSeg')).toBeHidden();
    expect(await counts(page)).toEqual({ msgs: before.msgs - 3, telegram: 0 });

    await openDialog(page);
    await expect(row(page, 'result.json')).toHaveClass(/\boff\b/);
    await row(page, 'result.json').locator('input').check();
    await apply(page);
    await dashboard(page);
    await expect(page.locator('#filesBtn')).toHaveText('📁 Files (2)');
    expect((await options(page)).some((o) => o.startsWith('✈️ Alex Rivera (3)'))).toBe(true);
    expect(await counts(page)).toEqual(before);
  });

  test('AC4: removing a file takes it out of the list and its conversations out of the picker', async ({ page }) => {
    await loadFiles(page, [sms(), telegram()]);
    await openDialog(page);
    await row(page, 'result.json').getByRole('button', { name: /^Remove/ }).click();
    await expect(rows(page)).toHaveCount(1);
    await apply(page);
    await dashboard(page);
    await expect(page.locator('#filesBtn')).toHaveText('📁 Files (1)');
    expect((await options(page)).some((o) => o.startsWith('✈️'))).toBe(false);
    await openDialog(page);
    await expect(rows(page)).toHaveText([/sms-20240821\.xml/]);
  });

  test('AC5: removing one of two overlapping exports keeps the messages the other has', async ({ page }) => {
    await loadFiles(page, [sms('sms-a.xml'), sms('sms-b.xml')]);
    expect((await counts(page)).msgs).toBe(5);
    await openDialog(page);
    await row(page, 'sms-a.xml').getByRole('button', { name: /^Remove/ }).click();
    await apply(page);
    await dashboard(page);
    await expect(page.locator('#filesBtn')).toHaveText('📁 Files (1)');
    expect((await counts(page)).msgs).toBe(5);
  });

  test('AC6: a file added in the dialog loads on Apply, and the same file is not listed twice', async ({ page }) => {
    await loadFiles(page, [sms()]);
    const path = test.info().outputPath('result.json');
    writeFileSync(path, telegram().buffer);
    await openDialog(page);
    await page.setInputFiles('#addInput', path);
    await expect(rows(page)).toHaveCount(2);
    await expect(row(page, 'result.json')).toContainText('new');
    await page.setInputFiles('#addInput', path);
    await expect(row(page, 'result.json')).toHaveCount(1);
    await apply(page);
    await dashboard(page);
    expect((await options(page)).some((o) => o.startsWith('✈️ Alex Rivera (3)'))).toBe(true);
    await expect(page.locator('#filesBtn')).toHaveText('📁 Files (2)');
    await openDialog(page);
    await page.setInputFiles('#addInput', path);
    await expect(rows(page)).toHaveCount(2);
    await expect(page.locator('#filesApply')).toBeDisabled();
  });

  test('AC7: closing the dialog without applying changes nothing', async ({ page }) => {
    await loadFiles(page, [sms(), telegram()]);
    const before = await counts(page);
    await openDialog(page);
    await row(page, 'result.json').locator('input').uncheck();
    await page.click('#filesCancel');
    await expect(dialog(page)).not.toHaveAttribute('open', '');
    await openDialog(page);
    await row(page, 'sms-20240821.xml').getByRole('button', { name: /^Remove/ }).click();
    await page.keyboard.press('Escape');
    await expect(dialog(page)).not.toHaveAttribute('open', '');
    await openDialog(page);
    await expect(rows(page)).toHaveCount(2);
    await expect(row(page, 'result.json').locator('input')).toBeChecked();
    await expect(page.locator('#filesBtn')).toHaveText('📁 Files (2)');
    expect(await counts(page)).toEqual(before);
  });

  test('AC8: Apply is disabled with no changes, and with every file unchecked', async ({ page }) => {
    await loadFiles(page, [sms(), telegram()]);
    await openDialog(page);
    await expect(page.locator('#filesApply')).toBeDisabled();
    await expect(page.locator('#filesHint')).toBeHidden();
    await row(page, 'result.json').locator('input').uncheck();
    await expect(page.locator('#filesApply')).toBeEnabled();
    await row(page, 'sms-20240821.xml').locator('input').uncheck();
    await expect(page.locator('#filesApply')).toBeDisabled();
    await expect(page.locator('#filesHint')).toHaveText('Check at least one file, or remove them all to start over.');
  });

  test('AC9: removing every file and applying goes back to the landing page', async ({ page }) => {
    await loadFiles(page, [sms(), telegram()]);
    await openDialog(page);
    await row(page, 'result.json').getByRole('button', { name: /^Remove/ }).click();
    await row(page, 'sms-20240821.xml').getByRole('button', { name: /^Remove/ }).click();
    await apply(page);
    await expect(page.locator('#landing')).toBeVisible();
    await expect(page.locator('#drop')).toBeVisible();
    await expect(page.locator('#dash')).toBeHidden();
    expect(await page.evaluate(() => ({ msgs: S.msgs.length, files: S.files.length }))).toEqual({ msgs: 0, files: 0 });
    // And the same file can be chosen again from the landing page.
    await page.setInputFiles('#fileInput', sms());
    await dashboard(page);
    await expect(page.locator('#filesBtn')).toHaveText('📁 Files (1)');
  });

  test('AC10: an unreadable file is marked on its row and skipped on Apply', async ({ page }) => {
    await loadFiles(page, [sms()]);
    await openDialog(page);
    await page.setInputFiles('#addInput', [zippedHtmlExport(), telegram()]);
    await expect(rows(page)).toHaveCount(3);
    const bad = row(page, 'ChatExport_html.zip');
    await expect(bad.locator('.files-error')).toContainText("This is Telegram's HTML export");
    await expect(bad.locator('input')).toBeDisabled();
    await apply(page);
    await dashboard(page);
    await expect(page.locator('#loadError')).toBeHidden();
    expect((await counts(page)).telegram).toBe(3);
    await expect(page.locator('#filesBtn')).toHaveText('📁 Files (2)');
  });

  test('AC11: the selected conversation stays if still loaded, and goes back to All if not', async ({ page }) => {
    await loadFiles(page, [sms(), telegram()]);
    await page.selectOption('#contactSel', SMS_PAT);
    await openDialog(page);
    await row(page, 'result.json').locator('input').uncheck();
    await apply(page);
    await dashboard(page);
    await expect(page.locator('#contactSel')).toHaveValue(SMS_PAT);

    await openDialog(page);
    await row(page, 'result.json').locator('input').check();
    await apply(page);
    await dashboard(page);
    const tg = await page.evaluate(() => [...S.contacts.values()].find((c) => c.s === 4).key);
    await page.selectOption('#contactSel', tg);
    await openDialog(page);
    await row(page, 'result.json').getByRole('button', { name: /^Remove/ }).click();
    await apply(page);
    await dashboard(page);
    await expect(page.locator('#contactSel')).toHaveValue('all');
    expect(await page.evaluate(() => S.filter.contact)).toBe('all');
  });

  test('AC12: an AI analysis report is cleared when a file is left out', async ({ page }) => {
    await loadFiles(page, [sms(), telegram()]);
    await page.selectOption('#contactSel', SMS_PAT);
    // A report for the selected conversation, which stays loaded.
    await page.evaluate(() => {
      AiAnalysis.report = { id: AiAnalysis.conversation().id };
      $('#aiReport').innerHTML = '<p>Earlier report</p>';
      $('#aiReport').hidden = false;
    });
    await openDialog(page);
    await row(page, 'result.json').locator('input').uncheck();
    await apply(page);
    await dashboard(page);
    expect(await page.evaluate(() => AiAnalysis.report)).toBeNull();
    await expect(page.locator('#aiReport')).toBeHidden();
    await expect(page.locator('#aiReport')).toBeEmpty();
  });

  test('AC15: the reactions note shows under the filters', async ({ page }) => {
    await loadDemo(page);
    await expect(page.locator('.scope #reactionInfo')).toContainText(/reactions .* not counted as messages/);
  });
});
