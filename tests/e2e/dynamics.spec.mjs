/* specs/017-conversation-dynamics.md in the browser. */
import { test, expect, loadDemo, openTab, openSettings, closeSettings, chartOption } from './fixtures.mjs';
import { inApp } from './state.mjs';

const CHARTS = ['c-endings', 'c-questions', 'c-turns', 'c-style'];

/** The demo's busiest 1-on-1 conversation and busiest group chat. */
const busiest = (page) => inApp(page, (app) => {
  const n = new Map();
  for (const m of app.msgs) n.set(m.k, (n.get(m.k) || 0) + 1);
  const ranked = [...n].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  return { one: ranked.find((k) => !k.startsWith('g:')), group: ranked.find((k) => k.startsWith('g:')) };
});

/** The chart's placeholder text, or null when it draws data. */
const emptyText = async (page, id) => {
  const opt = await chartOption(page, id);
  return opt.graphic?.[0]?.elements?.[0]?.style?.text ?? null;
};

test.describe('spec 017 how two people talk', () => {
  test.beforeEach(async ({ page }) => {
    await loadDemo(page);
    await openTab(page, 'sec-replies');
  });

  test('AC12: the Replies tab draws the four cards; one conversation shows the style table, a group chat the empty text', async ({ page }) => {
    for (const id of CHARTS) {
      await expect(page.locator(`#${id} canvas`)).toHaveCount(1);
      expect(await emptyText(page, id), id).toBeNull();
    }
    await expect(page.locator('#styleMarkers table')).toHaveCount(0);

    const { one, group } = await busiest(page);
    await page.selectOption('#contactSel', one);
    await expect(page.locator('#styleMarkers tbody tr')).toHaveCount(8);
    await expect(page.locator('#styleMarkers tr.style-total td').last()).toHaveText(/^\d+$/);

    await page.selectOption('#contactSel', group);
    await expect.poll(() => emptyText(page, 'c-style')).toBe('Style match compares two people. Pick a 1-on-1 conversation.');
    await expect.poll(() => emptyText(page, 'c-endings')).toBe('No 1-on-1 conversations in this selection');
  });

  test('AC13: changing the conversation gap changes the endings note', async ({ page }) => {
    await expect(page.locator('#endingsNote')).toHaveText('1-on-1 conversations, each ending after 6 hours of quiet');
    await openSettings(page);
    await page.click('#gapSeg button:text-is("1h")');
    await closeSettings(page);
    await expect(page.locator('#endingsNote')).toHaveText('1-on-1 conversations, each ending after 1 hour of quiet');
  });
});
