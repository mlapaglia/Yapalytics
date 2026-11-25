/* specs/026-stats-export.md in the browser. */
import { readFileSync } from 'node:fs';
import { test, expect, loadDemo, openSettings, closeSettings, scrollTo } from './fixtures.mjs';
import { inApp } from './state.mjs';
import { loadScripts } from '../helpers/load.mjs';

const { zipLib } = loadScripts(['zip.js'], ['zipLib']);
const dlg = (page) => page.locator('#exportDlg');

async function openExport(page) {
  await page.click('#exportBtn');
  await expect(dlg(page)).toHaveAttribute('open', '');
}

/** A CSV's rows (no quoted fields in these tables' numbers), after the byte-order mark. */
const rowsOf = (csv) => csv.replace(/^﻿/, '').trimEnd().split('\r\n').map((l) => l.split(','));
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

test.describe('spec 026 exporting stats as CSV', () => {
  test.beforeEach(async ({ page }) => {
    await loadDemo(page);
  });

  test('AC1: Export stats opens a dialog listing the tables with row counts; an empty range disables it', async ({ page }) => {
    await expect(page.locator('.scope #exportBtn')).toBeEnabled();
    await openExport(page);
    const items = dlg(page).locator('#exportList li');
    await expect(items.locator('b')).toHaveText([
      'summary.csv', 'conversations.csv', 'months.csv', 'days.csv', 'hours.csv', 'weekdays.csv', 'heatmap.csv',
      'reply_times.csv', 'emoji.csv', 'attachments.csv', 'calls.csv', 'group_senders.csv',
    ]);
    await expect(items.filter({ hasText: 'summary.csv' })).toContainText('Summary · 23 rows');
    await expect(items.filter({ hasText: 'heatmap.csv' })).toContainText('168 rows');
    await expect(dlg(page).locator('#exportAnon')).not.toBeChecked();
    await dlg(page).locator('.profile-close').click();

    const first = await page.inputValue('#fromDate');
    const last = await page.inputValue('#toDate');
    await page.fill('#fromDate', last);
    await page.fill('#toDate', first);
    await expect(page.locator('#exportBtn')).toBeDisabled();
  });

  test('AC2: the demo’s summary and conversations match the Overview tiles and the leaderboard', async ({ page }) => {
    await openExport(page);
    const files = await inApp(page, (app) => app.exportFiles);
    const csv = Object.fromEntries(files.map((f) => [f.file, rowsOf(f.csv)]));
    const summary = Object.fromEntries(csv['summary.csv'].slice(1));
    await dlg(page).locator('.profile-close').click();

    const tile = (label) => page.locator('.kpi', { has: page.locator('.kpi-label', { hasText: new RegExp(`^${label}$`) }) }).locator('.kpi-value');
    const num = (s) => Number(s.replace(/[^\d]/g, ''));
    expect(num(await tile('Messages').textContent())).toBe(+summary.messages);
    expect(num(await tile('Conversations').textContent())).toBe(+summary.conversations);
    expect(num(await tile('Busiest day').textContent())).toBe(+summary.busiest_day_messages);
    expect(await tile('Longest streak').textContent()).toBe(`${summary.longest_streak_days} days`);

    await scrollTo(page, '#leaderTable');
    const top = page.locator('#leaderTable tbody tr').first();
    const [head, ...rows] = csv['conversations.csv'];
    const col = (name) => head.indexOf(name);
    expect(num(await top.locator('td').nth(1).textContent())).toBe(+rows[0][col('messages')]);
    expect(await top.locator('td').nth(2).textContent()).toBe(`${Math.round(rows[0][col('sent_share')] * 100)}%`);
    expect(await top.locator('td').nth(7).textContent()).toBe(`${rows[0][col('longest_streak_days')]}d`);
  });

  test('AC9: Download saves one file, Download all a zip of every file with the same bytes, and nothing goes out', async ({ page }) => {
    const requests = [];
    page.on('request', (r) => { if (/^https?:/.test(r.url())) requests.push(r.url()); });
    await openExport(page);
    const files = await inApp(page, (app) => app.exportFiles);
    await page.waitForLoadState('networkidle');
    requests.length = 0;

    const [one] = await Promise.all([
      page.waitForEvent('download'),
      dlg(page).locator('#exportList li', { hasText: 'months.csv' }).getByRole('button', { name: 'Download months.csv' }).click(),
    ]);
    expect(one.suggestedFilename()).toBe('months.csv');
    const months = readFileSync(await one.path());
    expect(new Uint8Array(months)).toEqual(new TextEncoder().encode(files.find((f) => f.file === 'months.csv').csv));

    const [all] = await Promise.all([page.waitForEvent('download'), dlg(page).locator('#exportAll').click()]);
    expect(all.suggestedFilename()).toBe(`yapalytics-stats-${today()}.zip`);
    const zip = new File([readFileSync(await all.path())], all.suggestedFilename());
    const { listZip, readEntryBlob } = zipLib();
    const entries = await listZip(zip);
    expect(entries.map((e) => e.name)).toEqual(files.map((f) => f.file));
    for (const [i, e] of entries.entries()) {
      expect(new Uint8Array(await (await readEntryBlob(e)).arrayBuffer())).toEqual(new TextEncoder().encode(files[i].csv));
    }
    expect(requests).toEqual([]);
  });

  test('AC7: replacing names changes every file and keeps the list', async ({ page }) => {
    await openExport(page);
    const named = await inApp(page, (app) => app.exportFiles);
    await dlg(page).locator('#exportAnon').check();
    await expect.poll(async () => (await inApp(page, (app) => app.exportFiles)).find((f) => f.file === 'conversations.csv').csv).toContain('Conversation 1,');
    const anon = await inApp(page, (app) => app.exportFiles);
    expect(anon.map((f) => f.file)).toEqual(named.map((f) => f.file));
    const names = await inApp(page, (app) => [...new Set(app.selection().map((m) => app.plainName(m.k)))]);
    const text = anon.map((f) => f.csv).join('\n');
    for (const n of names) expect(text, n).not.toContain(n);
    await dlg(page).locator('.profile-close').click();
    await openExport(page);
    await expect(dlg(page).locator('#exportAnon')).not.toBeChecked();
  });

  test('AC10: group_senders.csv goes when group chats are left out; calls.csv goes with an app that has no calls', async ({ page }) => {
    await openSettings(page);
    await page.locator('#groupsChk').uncheck();
    await closeSettings(page);
    await openExport(page);
    await expect(dlg(page).locator('#exportList b', { hasText: 'group_senders.csv' })).toHaveCount(0);
    await expect(dlg(page).locator('#exportList b', { hasText: 'calls.csv' })).toHaveCount(1);
    await dlg(page).locator('.profile-close').click();

    await page.click('#sourceSeg button[data-source="2"]'); // WhatsApp: no calls
    await openExport(page);
    await expect(dlg(page).locator('#exportList b', { hasText: 'calls.csv' })).toHaveCount(0);
    await expect(dlg(page).locator('#exportList b').first()).toHaveText('summary.csv');
  });
});
