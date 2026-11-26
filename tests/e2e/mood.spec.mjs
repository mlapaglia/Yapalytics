import { test, expect, loadDemo, scrollTo, chartSettled } from './fixtures.mjs';
import { inApp } from './state.mjs';

/** Center of a drawn bar on the mood chart: series 0 = you positive, 1 = you negative, 2 / 3 = them. */
const barPoint = (page, series, fromEnd = 3) => page.evaluate(([s, back]) => {
  const chart = echarts.getInstanceByDom(document.getElementById('c-mood'));
  const data = chart.getModel().getSeriesByIndex(s).getData();
  const i = data.count() - back;
  const box = data.getItemLayout(i);
  const r = chart.getDom().getBoundingClientRect();
  return { x: r.left + box.x + box.width / 2, y: r.top + box.y + box.height / 2, ts: data.getValues(i)[0] };
}, [series, fromEnd]);

const shownState = (page) => inApp(page, (app) => ({
  filter: app.browserMood,
  n: app.browserShown.length,
  pills: document.querySelectorAll('#messages .mood-pill').length,
  // Every listed message fits the filter, and its explanation agrees with its stored score.
  fit: app.browserShown.every((m) => {
    const f = app.browserMood;
    if (!f) return true;
    const kind = m.v >= 0.05 ? 'pos' : m.v <= -0.05 ? 'neg' : 'neu';
    return m.mo === f.mo && (f.o == null || m.o === f.o) && (f.kind === 'any' ? kind !== 'neu' : kind === f.kind);
  }),
  explained: app.browserShown.slice(-40).every((m) => m.v == null || app.explainMood(m.b).score === m.v),
}));

test.describe('mood details', () => {
  test.beforeEach(async ({ page }) => {
    await loadDemo(page);
    await scrollTo(page, '#c-mood');
    await page.waitForFunction(() => echarts.getInstanceByDom(document.getElementById('c-mood'))?.getOption().series?.length === 4);
    await chartSettled(page, 'c-mood'); // the bars are counted in slices, then grow in (spec 028)
  });

  test('clicking a bar lists that month’s messages of that side and mood, with scores', async ({ page }) => {
    const bar = await barPoint(page, 0);
    await page.mouse.click(bar.x, bar.y);
    await expect(page.locator('#browserFilter')).toBeVisible();
    await expect(page.locator('#browserFilter')).toContainText(/^Positive messages you sent · \w+ \d{4}/);
    await expect(page.locator('#moodChk')).toBeChecked();
    const s = await shownState(page);
    expect(s.filter).toMatchObject({ o: 1, kind: 'pos' });
    expect(s.n).toBeGreaterThan(0);
    expect(s.fit).toBe(true);
    expect(s.pills).toBe(s.n);
    expect(s.explained).toBe(true);
    // The list holds as many messages as the bar's share says.
    const share = await inApp(page, (app) => {
      const f = app.browserMood;
      const month = app.selection().filter((m) => m.mo === f.mo && m.o === 1 && m.v != null);
      return { pos: month.filter((m) => m.v >= 0.05).length, all: month.length };
    });
    await expect(page.locator('#browserCount')).toContainText(`${share.pos.toLocaleString('en-US')} messages matching`);
  });

  test('negative bars and the other side work too', async ({ page }) => {
    const bar = await barPoint(page, 3);
    await page.mouse.click(bar.x, bar.y);
    await expect(page.locator('#browserFilter')).toContainText(/^Negative messages you received/);
    const s = await shownState(page);
    expect(s.filter).toMatchObject({ o: 0, kind: 'neg' });
    expect(s.fit).toBe(true);
  });

  test('clicking empty space in a month lists all its positive and negative messages', async ({ page }) => {
    const bar = await barPoint(page, 0);
    await page.mouse.click(bar.x - 14, bar.y - 60 > 0 ? bar.y - 60 : bar.y); // beside the bars, same month
    await expect(page.locator('#browserFilter')).toContainText(/^Positive and negative messages · /);
    const s = await shownState(page);
    expect(s.filter).toMatchObject({ o: null, kind: 'any' });
    expect(s.fit).toBe(true);
  });

  test('a score explains itself: the words that counted and the effect on the bar', async ({ page }) => {
    const bar = await barPoint(page, 0);
    await page.mouse.click(bar.x, bar.y);
    const pill = page.locator('#messages .mood-pill').last();
    await pill.scrollIntoViewIfNeeded();
    await pill.click();
    const why = page.locator('#messages .mood-why');
    await expect(why).toHaveCount(1);
    await expect(why).toContainText(/[+−]\d\.\d\d positive\. One of the [\d,]+ messages you sent in \w+ \d{4} with a mood score: worth about [\d.]+ points of the positive bar\./);
    await expect(why.locator('.mw').first()).toBeVisible();
    await pill.click();
    await expect(why).toHaveCount(0);
  });

  test('clearing the filter brings every message back, and scores can be hidden', async ({ page }) => {
    const all = await inApp(page, (app) => app.selection().length);
    const bar = await barPoint(page, 0);
    await page.mouse.click(bar.x, bar.y);
    await page.click('[data-clear-mood]');
    await expect(page.locator('#browserFilter')).toBeHidden();
    await expect(page.locator('#browserCount')).toContainText(`${all.toLocaleString('en-US')} messages · showing`);
    await page.uncheck('#moodChk');
    await expect(page.locator('#messages .mood-pill')).toHaveCount(0);
    await page.check('#moodChk');
    expect(await page.locator('#messages .mood-pill').count()).toBeGreaterThan(0);
  });
});
