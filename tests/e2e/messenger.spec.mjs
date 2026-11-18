/*
 * specs/009-messenger-import.md in the browser: Facebook's export, Messenger's encrypted
 * chats download, and how they sit next to the other apps.
 */
import { test, expect, loadFiles, loadDemo, scrollTo, chartOption, openTab } from './fixtures.mjs';
import { zippedExport as instagramExport } from '../helpers/instagram.mjs';
import { resultJson, singleChatExport } from '../helpers/telegram.mjs';
import {
  encryptedExport, encryptedThread, facebookExport, facebookHtmlExport, looseFacebookThread, plainThread,
  samEncryptedThread, splitFacebookExport,
} from '../helpers/messenger.mjs';

/** Messages of an app loaded: total, and how many count as sent by you. */
const countsOf = (page, s = 6) => page.evaluate((s) => {
  const msgs = S.msgs.filter((m) => m.s === s);
  return { n: msgs.length, sent: msgs.filter((m) => m.o === 1).length };
}, s);
const picker = (page) => page.locator('#ownerFields label', { hasText: 'You on Messenger' }).locator('select');
const options = (page) => page.locator('#contactSel option').allTextContents();

test.describe('spec 009 Messenger', () => {
  test('AC1, AC6: loads Facebook\'s export, skips requests, and knows which messages are yours', async ({ page }) => {
    await loadFiles(page, facebookExport());
    // Alex: 4 kept (the like is a reaction), Road Trip: 2, Sam: 1. You sent 2.
    expect(await countsOf(page)).toEqual({ n: 7, sent: 2 });
    expect(await page.evaluate(() => S.reactions)).toBe(1);
    await expect(picker(page)).toHaveValue('Jamie Park');
    const opts = await options(page);
    expect(opts.some((o) => o.startsWith('⚡ Alex Rivera'))).toBe(true);
    expect(opts.some((o) => o.startsWith('⚡👥 Road Trip 🚗'))).toBe(true);
    expect(opts.some((o) => o.includes('Spam Bot') || o.includes('Crypto Deals')), 'requests and filtered chats are skipped').toBe(false);
  });

  test('AC6: picking another name under You on Messenger swaps sent and received', async ({ page }) => {
    await loadFiles(page, facebookExport());
    await picker(page).selectOption('Alex Rivera');
    await expect.poll(async () => (await countsOf(page)).sent).toBe(3);
  });

  test('AC2: opens a photo from another part of a split export', async ({ page }) => {
    await loadFiles(page, splitFacebookExport());
    await scrollTo(page, '#galleryCard');
    const tile = page.locator('#galleryGrid .tile[title^="2201"]');
    await expect(tile).toHaveClass(/loaded/, { timeout: 30_000 });
    await tile.click();
    await page.waitForFunction(() => document.querySelector('#viewer .viewer-stage img')?.naturalWidth);
    await expect(page.locator('#viewer .viewer-caption')).toContainText('Alex Rivera');
  });

  test('AC3, AC18: an encrypted thread file is one conversation named after the other person', async ({ page }) => {
    await loadFiles(page, encryptedThread());
    expect((await countsOf(page)).n).toBe(7);
    const opts = await options(page);
    expect(opts.some((o) => o.startsWith('⚡ Alex Rivera ('))).toBe(true);
    expect(opts.some((o) => o.includes('Alex Rivera_6')), 'the number is not shown').toBe(false);
  });

  test('AC12: you are guessed from the encrypted threads, one or several', async ({ page }) => {
    await loadFiles(page, encryptedExport());
    await expect(picker(page)).toHaveValue('Jamie Park');
    expect(await countsOf(page)).toEqual({ n: 9, sent: 5 });
    await loadFiles(page, samEncryptedThread());
    await expect(picker(page)).toHaveValue('Jamie Park');
    expect(await countsOf(page)).toEqual({ n: 2, sent: 1 });
  });

  test('AC14: a photo in the encrypted download opens', async ({ page }) => {
    await loadFiles(page, encryptedExport());
    await scrollTo(page, '#galleryCard');
    const tile = page.locator('#galleryGrid .tile[title^="482a04c4"]');
    await expect(tile).toHaveClass(/loaded/, { timeout: 30_000 });
    await tile.click();
    await page.waitForFunction(() => document.querySelector('#viewer .viewer-stage img')?.naturalWidth);
    expect(await page.$eval('#viewer .viewer-stage img', (i) => [i.naturalWidth, i.naturalHeight])).toEqual([1600, 1200]);
  });

  test('AC18: the same encrypted chat loaded twice counts once', async ({ page }) => {
    await loadFiles(page, [encryptedThread(), encryptedExport()]);
    expect(await page.evaluate(() => S.msgs.filter((m) => m.k === 'fb:e2ee:Alex Rivera_6').length)).toBe(7);
  });

  test('AC7: Instagram and Facebook exports chosen together stay two apps', async ({ page }) => {
    await loadFiles(page, [instagramExport(), facebookExport()]);
    const apps = await page.evaluate(() => {
      const out = {};
      for (const m of S.msgs) (out[m.s] ||= new Set()).add(m.k.replace(/^g:/, '').slice(0, 3));
      return Object.fromEntries(Object.entries(out).map(([s, p]) => [s, [...p]]));
    });
    expect(apps).toEqual({ 5: ['ig:'], 6: ['fb:'] });
  });

  test('AC9: the source switch has Messenger, and Platform mix has a Messenger series', async ({ page }) => {
    await loadFiles(page, [instagramExport(), facebookExport()]);
    await expect(page.locator('#sourceSeg button[data-source="6"]')).toBeVisible();
    await page.click('#sourceSeg button[data-source="6"]');
    await expect(page.locator('#scope')).toContainText('(Messenger)');
    expect((await options(page)).filter((o) => /^(?:📸|⚡)/.test(o)).every((o) => o.startsWith('⚡'))).toBe(true);
    await page.click('#sourceSeg button[data-source="all"]');
    await scrollTo(page, '#c-platforms');
    await expect.poll(async () => (await chartOption(page, 'c-platforms'))?.series?.map((s) => s.name) ?? []).toEqual(['Instagram', 'Messenger']);
  });

  test('AC10: a message_1.json on its own is guessed from what is in it', async ({ page }) => {
    await loadFiles(page, looseFacebookThread());
    expect((await countsOf(page, 6)).n).toBe(4);
    await loadFiles(page, plainThread());
    expect((await countsOf(page, 6)).n).toBe(0);
    expect((await countsOf(page, 5)).n).toBe(2);
  });

  test('AC13: a Telegram result.json next to encrypted thread files is still Telegram', async ({ page }) => {
    await loadFiles(page, [resultJson(singleChatExport()), encryptedThread()]);
    expect((await countsOf(page, 4)).n).toBeGreaterThan(0);
    expect((await countsOf(page, 6)).n).toBe(7);
  });

  test('AC11: the same friend on Instagram and in both Messenger exports is suggested as one person', async ({ page }) => {
    await loadFiles(page, [instagramExport(), facebookExport(), encryptedExport()]);
    await page.click('#peopleBtn');
    const row = page.locator('#peopleSuggest li', { hasText: 'Alex Rivera' });
    await expect(row.locator('.person-chip')).toHaveText([/Messenger · 4/, /Messenger · 7/, /Instagram · 5/]);
    await row.locator('[data-accept]').click();
    await page.locator('#peopleDlg .profile-close').click();
    const person = await page.evaluate(() => S.personOf.get('ig:alexrivera_1111'));
    expect(person).toBe(await page.evaluate(() => S.personOf.get('fb:e2ee:Alex Rivera_6')));
    await page.selectOption('#contactSel', person);
    await page.click('#profileBtn');
    await expect(page.locator('#profileTop')).toContainText('on Instagram and Messenger');
  });

  test('AC16: the Files dialog can switch a message_1.json between Instagram and Messenger', async ({ page }) => {
    await loadFiles(page, plainThread());
    await page.click('#filesBtn');
    const app = page.locator('#filesList li[data-file]', { hasText: 'message_1.json' }).locator('select.files-app');
    await expect(app).toHaveValue('instagram');
    await expect(page.locator('#filesApply')).toBeDisabled();
    await app.selectOption('messenger');
    await expect(page.locator('#filesApply')).toBeEnabled();
    await page.click('#filesApply');
    await expect.poll(() => countsOf(page, 6)).toEqual({ n: 2, sent: 1 });
    expect((await countsOf(page, 5)).n).toBe(0);
    expect(await page.evaluate(() => [...new Set(S.msgs.map((m) => m.k))])).toEqual(['fb:alexrivera_1111']);

    await page.click('#filesBtn');
    await expect(app).toHaveValue('messenger');
    await app.selectOption('instagram');
    await page.click('#filesApply');
    await expect.poll(async () => (await countsOf(page, 5)).n).toBe(2);
    expect((await countsOf(page, 6)).n).toBe(0);
  });

  test('AC17: the demo has Messenger, links Noor across apps, and shows switches between them', async ({ page }) => {
    await loadDemo(page);
    await expect(page.locator('#sourceSeg button[data-source="6"]')).toBeVisible();
    await page.click('#peopleBtn');
    const row = page.locator('#peopleSuggest li', { hasText: 'Noor Haddad' });
    await expect(row.locator('.person-chip')).toHaveCount(3);
    await expect(row).toContainText('Instagram');
    await expect(row).toContainText('Messenger');
    await row.locator('[data-accept]').click();
    await page.locator('#peopleDlg .profile-close').click();
    await openTab(page, 'sec-apps');
    await scrollTo(page, '#c-routes');
    await expect.poll(async () => JSON.stringify((await chartOption(page, 'c-routes')) ?? {})).toMatch(/Instagram → Messenger|Messenger → Instagram/);
  });
});

test.describe('spec 009 Messenger errors', () => {
  test.use({ failOnConsoleError: false }); // the app logs the error it shows

  test('AC8: explains that Facebook\'s HTML export needs to be redone as JSON', async ({ page }) => {
    await page.goto('/');
    await page.setInputFiles('#fileInput', facebookHtmlExport());
    await expect(page.locator('#loadError')).toContainText('Facebook');
    await expect(page.locator('#loadError')).toContainText('JSON');
    await expect(page.locator('#dash')).toBeHidden();
  });
});
