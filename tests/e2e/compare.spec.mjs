/* specs/021-period-comparison.md in the browser. */
import { test, expect, loadDemo, openTab } from './fixtures.mjs';
import { inApp } from './state.mjs';

// Dates as the date inputs hold them ('2026-03-01'); the page runs in UTC (playwright.config.mjs).
const DAY = 86400e3;
const ts = (v) => Date.parse(`${v}T00:00:00Z`);
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const addDays = (v, n) => iso(ts(v) + n * DAY);
const addYears = (v, n) => `${+v.slice(0, 4) + n}${v.slice(4)}`;
const fmtDay = (v) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(ts(v));
const fmtMonthDay = (v) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(ts(v));
/** As the Compare tab writes a period: "Mar 1 – May 31, 2026", or with both years. */
const range = (from, to) => `${from.slice(0, 4) === to.slice(0, 4) ? fmtMonthDay(from) : fmtDay(from)} – ${fmtDay(to)}`;

const headline = (page) => page.locator('#compareHeadline');
const dates = async (page) => ({ from: await page.inputValue('#fromDate'), to: await page.inputValue('#toDate') });

test.describe('spec 021 comparing two periods', () => {
  test.beforeEach(async ({ page }) => {
    await loadDemo(page);
    await openTab(page, 'sec-compare');
  });

  test('AC11: on All, the tab offers three starts; the 90-day one sets the dates as the 90-day preset does', async ({ page }) => {
    await expect(page.locator('#compareStart')).toBeVisible();
    await expect(page.locator('#compareStart [data-compare-preset]')).toHaveText([
      'Last 90 days vs the 90 before', 'Last 365 days vs the 365 before', 'This year so far vs the same days last year',
    ]);
    await expect(page.locator('#compareCard')).toBeHidden();

    await page.click('[data-compare-preset="90"]');
    await expect(page.locator('#compareCard')).toBeVisible();
    await expect(page.locator('#compareStart')).toBeHidden();
    const { from, to } = await dates(page);
    await expect(headline(page)).toHaveText(`${range(from, to)} compared with ${range(addDays(from, -90), addDays(from, -1))} · 90 days each`);
    await expect(page.locator('#compareRows tbody tr')).toHaveCount(12);
    // R13: short names in the column heads, the dates under them
    await expect(page.locator('#compareRows thead th[scope="col"]')).toHaveText([
      `Earlier${range(addDays(from, -90), addDays(from, -1))}`, `Date range${range(from, to)}`, 'Change',
    ]);

    await page.click('#presets [data-preset="all"]');
    await page.click('#presets [data-preset="90"]');
    expect(await dates(page)).toEqual({ from, to });
  });

  test('AC12: A year earlier moves A back a year; picking a conversation redraws both and hides People', async ({ page }) => {
    await page.click('[data-compare-preset="90"]');
    const { from, to } = await dates(page);
    await expect(page.locator('#comparePeopleCard')).toBeVisible();
    await page.click('#compareMode [data-mode="year"]');
    await expect(headline(page)).toHaveText(`${range(from, to)} compared with ${range(addYears(from, -1), addYears(to, -1))} · 90 days each`);
    expect(await dates(page)).toEqual({ from, to });

    const allMsgs = await page.locator('#compareRows tr[data-row="perDay"]').textContent();
    const one = await inApp(page, (app) => {
      const n = new Map();
      for (const m of app.msgs) if (!m.k.startsWith('g:')) n.set(m.k, (n.get(m.k) || 0) + 1);
      return [...n].sort((a, b) => b[1] - a[1])[0][0];
    });
    await page.selectOption('#contactSel', one);
    await expect(page.locator('#comparePeopleCard')).toBeHidden();
    await expect(page.locator('#compareRows tr[data-row="perDay"]')).not.toHaveText(allMsgs);
    const want = await inApp(page, (app, k) => {
      const ms = app.msgs.filter((m) => m.k === k);
      const count = (a, b) => ms.filter((m) => m.t >= a && m.t <= b).length;
      return { b: count(app.filter.from, Infinity) };
    }, one);
    await expect(page.locator('#compareRows tr[data-row="perDay"] td').nth(1)).toHaveText((want.b / 90).toFixed(1));
  });

  test('AC13: moving the start date moves B, and A ends the day before it', async ({ page }) => {
    await page.click('[data-compare-preset="90"]');
    const { from, to } = await dates(page);
    const start = addDays(from, -30);
    await page.fill('#fromDate', start);
    await expect(headline(page)).toHaveText(`${range(start, to)} compared with ${range(addDays(start, -120), addDays(start, -1))} · 120 days each`);
  });

  test('AC14: Custom shows two dates; setting them changes A and nothing else', async ({ page }) => {
    await page.click('[data-compare-preset="90"]');
    const { from, to } = await dates(page);
    await expect(page.locator('#compareCustom')).toBeHidden();
    await page.click('#compareMode [data-mode="custom"]');
    await expect(page.locator('#compareCustom')).toBeVisible();
    await expect(page.locator('#cmpFrom')).toHaveValue(addDays(from, -90));
    await expect(page.locator('#cmpTo')).toHaveValue(addDays(from, -1));

    const aFrom = addDays(from, -200), aTo = addDays(from, -171); // 30 days
    await page.fill('#cmpFrom', aFrom);
    await page.fill('#cmpTo', aTo);
    await expect(headline(page)).toHaveText(`${range(from, to)} compared with ${range(aFrom, aTo)} · 90 days and 30 days. Changes compare messages per day.`);
    expect(await dates(page)).toEqual({ from, to });
    expect(await inApp(page, (app) => app.filter.to)).toBeNull();
  });

  test('AC15: a range from the first day of history has nothing before it', async ({ page }) => {
    await page.click('[data-compare-preset="90"]');
    const first = await page.getAttribute('#fromDate', 'min');
    await page.fill('#fromDate', first);
    await expect(page.locator('#compareStartNote')).toHaveText(`There's no history before ${fmtDay(first)} to compare with.`);
    await expect(page.locator('#compareStart [data-compare-preset]')).toHaveCount(3);
    await expect(page.locator('#compareCard')).toBeHidden();
  });
});
