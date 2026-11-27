/* specs/015-settings-dialog.md in the browser. */
import { test, expect, loadDemo, loadFiles, openTab, scrollTo, openSettings, closeSettings, openLinkPeople, chartOption } from './fixtures.mjs';
import { inApp } from './state.mjs';
import { zippedExport } from '../helpers/instagram.mjs';
import { smsBackup } from '../helpers/sms.mjs';
import { resultJson, singleGroupExport } from '../helpers/telegram.mjs';

const HOUR = 3600e3;
const dlg = (page) => page.locator('#settingsDlg');
const btn = (page) => page.locator('#settingsBtn');

async function pickGap(page, label) {
  await openSettings(page);
  await page.click(`#gapSeg button:text-is("${label}")`);
  await expect(page.locator('#gapSeg button.on')).toHaveText(label);
}

// Alex Rivera on SMS and on Instagram: one suggested link (spec 005).
const smsAlex = () => smsBackup([
  { address: '+15551234567', name: 'Alex Rivera', at: '2024-08-19T09:00:00Z', body: 'see you tomorrow' },
  { address: '+15551234567', name: 'Alex Rivera', at: '2024-08-19T09:05:00Z', sent: true, body: 'yes!' },
]);
const smsOnly = () => smsBackup([{ address: '+15559876543', name: 'Pat Lee', at: '2024-08-19T10:00:00Z', body: 'hi' }]);

test.describe('spec 015 settings dialog', () => {
  test.describe('with the demo', () => {
    test.beforeEach(async ({ page }) => {
      await loadDemo(page);
    });

    test('AC1: the filter bar has Settings and none of what moved into it', async ({ page }) => {
      await expect(page.locator('.filters #settingsBtn')).toBeVisible();
      await expect(page.locator('.filters #peopleBtn, .filters #ownerBtn, .filters #groupsChk')).toHaveCount(0);
      await expect(page.locator('#ownerBtn, #ownerDlg')).toHaveCount(0);
    });

    test('AC2: Settings opens with the six gaps, 6h marked, and group chats included', async ({ page }) => {
      await openSettings(page);
      await expect(page.locator('#gapSeg button')).toHaveText(['30m', '1h', '3h', '6h', '12h', '24h']);
      await expect(page.locator('#gapSeg button.on')).toHaveText('6h');
      await expect(page.locator('#groupsChk')).toBeChecked();
    });

    test('AC3: picking a gap applies at once and the dialog stays open', async ({ page }) => {
      await pickGap(page, '1h');
      await expect(dlg(page)).toHaveAttribute('open', '');
      expect(await inApp(page, (app) => app.convoGap)).toBe(HOUR);
      await closeSettings(page);
      await openTab(page, 'sec-replies');
      await expect(page.locator('#replyNote')).toHaveText('How quickly each side answers (within 1 hour)');
      await expect(page.locator('#sessionNote')).toContainText('A conversation ends after 1 hour of quiet');
      await expect(page.locator('#habitsNote')).toContainText('Conversation starters (after 1h of quiet)');
      await expect.poll(async () => (await chartOption(page, 'c-reply'))?.xAxis[0].data.at(-1)).toBe('15–60 min');
      await openTab(page, 'sec-glance');
      await expect(page.locator('.kpi', { hasText: 'reply time' })).toHaveAttribute('title', 'Median time to answer, within 1 hour');
    });

    test('AC4: Overview, the leaderboard and Replies use the picked gap', async ({ page }) => {
      await pickGap(page, '24h');
      await closeSettings(page);
      const want = await inApp(page, (app) => {
        const A = aggregateMessages(app.selection(), 24 * 3600e3);
        const top = [...A.byContact.entries()].sort((a, b) => b[1].n[0] + b[1].n[1] - a[1].n[0] - a[1].n[1])[0];
        return {
          reply: fmtDuration(A.replyMedian[1]),
          longest: fmtNum(A.longestSession.n),
          topKey: top[0],
          topReply: fmtDuration(top[1].replyMedian[1]),
          sessions: A.sessions,
        };
      });
      await openTab(page, 'sec-glance');
      await expect(page.locator('.kpi', { hasText: 'Your reply time' }).locator('.kpi-value')).toHaveText(want.reply);
      await expect(page.locator('.kpi', { hasText: 'Longest conversation' }).locator('.kpi-value')).toContainText(want.longest);

      await scrollTo(page, '#leaderTable');
      const col = await page.locator('#leaderTable thead th').evaluateAll((ths) => ths.findIndex((th) => th.dataset.key === 'yourReply'));
      await expect(page.locator(`#leaderTable tbody tr[data-key="${want.topKey}"] td`).nth(col)).toHaveText(want.topReply);

      await scrollTo(page, '#c-sessions');
      const sessions = await page.evaluate(() => echarts.getInstanceByDom(document.getElementById('c-sessions')).getOption());
      expect(sessions.series[0].data.reduce((a, d) => a + (d.value ?? d), 0)).toBe(want.sessions);
    });

    test('AC5: the Conversation length card has no gap buttons', async ({ page }) => {
      await openTab(page, 'sec-replies');
      await expect(page.locator('#sec-replies .seg')).toHaveCount(0);
      await expect(page.locator('#settingsDlg #gapSeg')).toHaveCount(1);
    });

    test('AC6: the picked gap is used again after a reload', async ({ page }) => {
      await pickGap(page, '3h');
      expect(await page.evaluate(() => localStorage.getItem('yapa-convo-gap'))).toBe(String(3 * HOUR));
      // Going to the page again. A small backup, not the demo again: two demo loads take
      // over 20 s on CI, close to the test timeout.
      await loadFiles(page, smsOnly());
      expect(await inApp(page, (app) => app.convoGap)).toBe(3 * HOUR);
      await openTab(page, 'sec-replies');
      await expect(page.locator('#replyNote')).toHaveText('How quickly each side answers (within 3 hours)');
      await openSettings(page);
      await expect(page.locator('#gapSeg button.on')).toHaveText('3h');
      // Going back to the default forgets the setting.
      await page.click('#gapSeg button:text-is("6h")');
      expect(await page.evaluate(() => localStorage.getItem('yapa-convo-gap'))).toBeNull();
    });

    test('AC9: Include group chats in Settings filters group chats', async ({ page }) => {
      const hasGroups = () => inApp(page, (app) => app.selection().some((m) => m.k.startsWith('g:')));
      expect(await hasGroups()).toBe(true);
      await openSettings(page);
      await page.uncheck('#groupsChk');
      expect(await hasGroups()).toBe(false);
      await expect(page.locator('#scope')).toContainText('All 1-on-1 conversations');
      await page.check('#groupsChk');
      expect(await hasGroups()).toBe(true);
      await expect(page.locator('#scope')).toContainText('All conversations');
    });

    test('AC12: picking an owner in Settings flips sent and received and lowers the count', async ({ page }) => {
      const count = async () => Number(((await btn(page).textContent()).match(/\((\d+)\)/) || [0, 0])[1]);
      const before = await count();
      expect(before).toBeGreaterThan(0); // the demo's WhatsApp owner is a guess
      const sent = () => inApp(page, (app) => app.msgs.filter((m) => m.s === 2 && m.o === 1).length);
      const was = await sent();
      await openSettings(page);
      const row = page.locator('#ownerList li[data-app="WhatsApp"]');
      const name = await row.locator('select option').evaluateAll((els) => els.find((e) => !e.selected).value);
      await row.locator('.ts-control').click();
      await page.keyboard.type(name);
      await row.locator(`.ts-dropdown .option[data-value="${name}"]`).click();
      await expect.poll(sent).not.toBe(was);
      await expect.poll(count).toBe(before - 1);
      await expect(dlg(page)).toHaveAttribute('open', '');
    });

    test('AC15: Change on each Replies note opens Settings', async ({ page }) => {
      await openTab(page, 'sec-replies');
      for (const note of ['#replyNote', '#sessionNote', '#habitsNote']) {
        await page.locator(`p:has(${note}) [data-settings]`).click();
        await expect(dlg(page)).toHaveAttribute('open', '');
        await closeSettings(page);
      }
    });

    test('AC16: the conversation gap leaves the Across apps gap alone', async ({ page }) => {
      const apps = await inApp(page, (app) => app.appsGap);
      await pickGap(page, '1h');
      expect(await inApp(page, (app) => app.appsGap)).toBe(apps);
      await expect(page.locator('#settingsDlg #appsGapSeg')).toHaveCount(0);
      await expect(page.locator('#sec-apps #appsGapSeg')).toHaveCount(1);
    });

    test('AC17: ✕, the backdrop and Escape close Settings', async ({ page }) => {
      await openSettings(page);
      await dlg(page).locator('.profile-close').click();
      await expect(dlg(page)).not.toHaveAttribute('open', '');

      await openSettings(page);
      await page.mouse.click(5, 5); // the backdrop
      await expect(dlg(page)).not.toHaveAttribute('open', '');

      await openSettings(page);
      await page.keyboard.press('Escape');
      await expect(dlg(page)).not.toHaveAttribute('open', '');
    });

    test('AC18: the keyboard opens Settings and picks a gap', async ({ page }) => {
      await btn(page).focus();
      await page.keyboard.press('Enter');
      await expect(dlg(page)).toHaveAttribute('open', '');
      expect(await page.evaluate(() => document.getElementById('settingsDlg').contains(document.activeElement))).toBe(true);
      const onGap = () => page.evaluate(() => document.activeElement?.dataset.gap);
      for (let i = 0; i < 10 && (await onGap()) !== String(3600e3); i++) await page.keyboard.press('Tab');
      expect(await onGap()).toBe(String(3600e3));
      await page.keyboard.press('Space');
      expect(await inApp(page, (app) => app.convoGap)).toBe(3600e3);
      await page.keyboard.press('Tab');
      await page.keyboard.press('Enter');
      expect(await inApp(page, (app) => app.convoGap)).toBe(3 * 3600e3);
    });
  });

  // Which saved values are unusable is a unit test (store.test.mjs AC7); this one checks
  // the dialog shows the fallback.
  test('AC7: an unusable saved gap falls back to 6 hours', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('yapa-convo-gap', '7200000'));
    await loadFiles(page, smsOnly());
    expect(await inApp(page, (app) => app.convoGap)).toBe(6 * HOUR);
    await openSettings(page);
    await expect(page.locator('#gapSeg button.on')).toHaveText('6h');
  });

  test('AC8: with storage unavailable, picking a gap still applies it', async ({ page }) => {
    await page.addInitScript(() => {
      for (const k of ['getItem', 'setItem', 'removeItem']) Storage.prototype[k] = () => { throw new Error('blocked'); };
    });
    await loadFiles(page, smsOnly());
    await pickGap(page, '12h');
    expect(await inApp(page, (app) => app.convoGap)).toBe(12 * HOUR);
  });

  test('AC10: with only SMS, Settings has no owner or link section and no count', async ({ page }) => {
    await loadFiles(page, smsOnly());
    await expect(btn(page)).toHaveText('⚙️ Settings');
    await openSettings(page);
    await expect(page.locator('#ownerSection')).toBeHidden();
    await expect(page.locator('#linkSection')).toBeHidden();
  });

  test('AC11: the button counts a guessed owner and a suggested link', async ({ page }) => {
    await loadFiles(page, [smsAlex(), zippedExport(), resultJson(singleGroupExport())]);
    await expect(btn(page)).toHaveText('⚙️ Settings (2)');
    await expect(btn(page)).toHaveAttribute('title', /1 possible link between conversations with the same person/);
    await expect(btn(page)).toHaveAttribute('title', /Check Telegram: who's you was guessed/);
    await openSettings(page);
    await expect(page.locator('#ownerHead')).toHaveText('Which one is you? (1)');
    await expect(page.locator('#linkSummary')).toHaveText('No one linked yet · 1 possible link to check');
  });

  test('AC13: Link people opens on top of Settings and accepting lowers the count', async ({ page }) => {
    await loadFiles(page, [smsAlex(), zippedExport()]);
    await expect(btn(page)).toHaveText('⚙️ Settings (1)');
    await openLinkPeople(page);
    await page.click('#peopleSuggest [data-accept="0"]');
    await expect(btn(page)).toHaveText('⚙️ Settings');
    await page.locator('#peopleDlg .profile-close').click();
    await expect(page.locator('#peopleDlg')).not.toHaveAttribute('open', '');
    await expect(dlg(page)).toHaveAttribute('open', '');
    await expect(page.locator('#linkSummary')).toHaveText('1 person linked across apps');
  });

  test('AC14: the profile still opens Link people directly', async ({ page }) => {
    await loadFiles(page, [smsAlex(), zippedExport()]);
    const key = await inApp(page, (app) => [...app.contacts.values()].find((c) => c.s === 5 && !c.group).key);
    await inApp(page, (app, k) => app.openProfile(k), key);
    await page.click('[data-link-people]');
    await expect(page.locator('#peopleDlg')).toHaveAttribute('open', '');
    await expect(dlg(page)).not.toHaveAttribute('open', '');
  });
});
