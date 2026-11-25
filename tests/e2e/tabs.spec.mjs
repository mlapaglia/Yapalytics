/* specs/003-dashboard-tabs.md: one section at a time, picked from a sticky tab bar. */
import { test, expect, loadDemo, openTab } from './fixtures.mjs';
import { inApp } from './state.mjs';

const ALL_TABS = ['Overview', 'Messages', 'Activity', 'Compare', 'People', 'Groups', 'Replies', 'Words', 'Mood & emoji', 'Media & links', 'Calls', 'Sources', 'Year in review', 'AI analysis'];

/** The tabs shown, the selected one, and the sections on screen. */
const tabState = (page) => page.evaluate(() => ({
  tabs: [...document.querySelectorAll('#tabList [role="tab"]')].filter((b) => !b.hidden).map((b) => b.textContent),
  selected: [...document.querySelectorAll('#tabList [aria-selected="true"]')].map((b) => b.dataset.panel),
  visible: [...document.querySelectorAll('#dash > .dash-section')].filter((s) => s.offsetParent !== null).map((s) => s.id),
}));

/** Where a section starts, relative to the bottom of the tab bar (0 = right under it). */
const gapUnderTabs = (page, id) => page.evaluate((sec) =>
  document.getElementById(sec).getBoundingClientRect().top - document.getElementById('dashTabs').getBoundingClientRect().bottom, id);

const chartDrawn = (page, id) => page.evaluate((el) => !!echarts.getInstanceByDom(document.getElementById(el)), id);

test.describe('spec 003: dashboard tabs', () => {
  test.beforeEach(async ({ page }) => {
    await loadDemo(page);
  });

  test('AC1: the demo shows every tab, with Overview selected and only Overview on screen', async ({ page }) => {
    expect(await tabState(page)).toEqual({ tabs: ALL_TABS, selected: ['sec-glance'], visible: ['sec-glance'] });
    await expect(page.locator('#kpis')).toBeVisible();
    await expect(page.locator('#highlightsCard')).toBeVisible();
    await expect(page.locator('#c-timeline')).toBeHidden();
    const roles = await page.evaluate(() => ({
      list: document.getElementById('tabList').getAttribute('role'),
      panel: document.getElementById('sec-glance').getAttribute('role'),
      labelledBy: document.getElementById('sec-glance').getAttribute('aria-labelledby'),
    }));
    expect(roles).toEqual({ list: 'tablist', panel: 'tabpanel', labelledBy: 'tab-sec-glance' });
  });

  test('AC2: clicking a tab shows only that section and selects the tab', async ({ page }) => {
    await page.click('#tabList [data-panel="sec-activity"]');
    await expect(page.locator('#tab-sec-activity')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#tab-sec-glance')).toHaveAttribute('aria-selected', 'false');
    const s = await tabState(page);
    expect(s.visible).toEqual(['sec-activity']);
    await expect(page.locator('#c-timeline')).toBeVisible();
    // A chart drawn while its tab was hidden gets its real size once shown.
    await expect.poll(() => page.evaluate(() => echarts.getInstanceByDom(document.getElementById('c-timeline'))?.getWidth() ?? 0)).toBeGreaterThan(300);
  });

  test('AC3: switching tabs while scrolled down puts the new section under the tab bar', async ({ page }) => {
    await openTab(page, 'sec-content');
    await page.evaluate(() => window.scrollTo(0, 3000));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(1000);
    await page.click('#tabList [data-panel="sec-replies"]');
    expect(Math.abs(await gapUnderTabs(page, 'sec-replies'))).toBeLessThan(2);
    // At the top of the page, switching doesn't scroll.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.click('#tabList [data-panel="sec-people"]');
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });

  test('AC4: a section with nothing to show loses its tab, and Overview takes over', async ({ page }) => {
    await openTab(page, 'sec-sources');
    await page.click('#sourceSeg [data-source="2"]'); // WhatsApp only: one app, no platform mix
    await expect(page.locator('#tab-sec-sources')).toBeHidden();
    const s = await tabState(page);
    expect(s.selected).toEqual(['sec-glance']);
    expect(s.visible).toEqual(['sec-glance']);
    expect(s.tabs).not.toContain('Sources');
    // Back to every app: the tab returns, and Overview stays selected.
    await page.click('#sourceSeg [data-source="all"]');
    await expect(page.locator('#tab-sec-sources')).toBeVisible();
    expect((await tabState(page)).selected).toEqual(['sec-glance']);
  });

  test('AC5: Jump to… selects the card’s tab and scrolls it into view under the bars', async ({ page }) => {
    const groups = await page.evaluate(() => [...document.querySelectorAll('#jumpSel optgroup')].map((g) => g.label));
    expect(groups).toEqual(ALL_TABS);
    const value = await page.evaluate(() => [...document.querySelectorAll('#jumpSel option')].find((o) => o.textContent === 'Swearing').value);
    await page.selectOption('#jumpSel', value);
    await expect(page.locator('#tab-sec-mood')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#jumpSel')).toHaveValue('');
    const swearCard = page.locator('#sec-mood article.card', { has: page.locator('#c-swear') });
    await expect(swearCard).toBeInViewport();
    await expect.poll(async () => {
      const top = await swearCard.evaluate((el) => el.getBoundingClientRect().top);
      const navBottom = await page.evaluate(() => document.getElementById('dashTabs').getBoundingClientRect().bottom);
      return Math.round(top - navBottom);
    }).toBe(12); // scroll-margin-top below the sticky bars
  });

  test('AC6: a bar on the Mood chart opens the Messages tab, filtered to those messages', async ({ page }) => {
    await openTab(page, 'sec-mood');
    await page.waitForFunction(() => echarts.getInstanceByDom(document.getElementById('c-mood'))?.getOption().series?.length === 4);
    await page.locator('#c-mood').scrollIntoViewIfNeeded();
    const bar = await page.evaluate(() => {
      const chart = echarts.getInstanceByDom(document.getElementById('c-mood'));
      const data = chart.getModel().getSeriesByIndex(0).getData();
      const box = data.getItemLayout(data.count() - 3);
      const r = chart.getDom().getBoundingClientRect();
      return { x: r.left + box.x + box.width / 2, y: r.top + box.y + box.height / 2 };
    });
    await page.mouse.click(bar.x, bar.y);
    await expect(page.locator('#tab-sec-messages')).toHaveAttribute('aria-selected', 'true');
    expect((await tabState(page)).visible).toEqual(['sec-messages']);
    await expect(page.locator('#browserFilter')).toContainText(/^Positive messages you sent/);
  });

  test('AC7: the content pass waits for a content tab, and any of the three runs it', async ({ page }) => {
    await openTab(page, 'sec-activity');
    await openTab(page, 'sec-replies');
    expect(await chartDrawn(page, 'c-mood')).toBe(false);
    expect(await chartDrawn(page, 'c-swear')).toBe(false);
    await openTab(page, 'sec-media'); // not the tab the Mood chart is on
    await expect.poll(() => chartDrawn(page, 'c-domains')).toBe(true);
    // Each tab draws its own charts when it's shown (spec 014 R9), from the one content pass.
    expect(await chartDrawn(page, 'c-mood')).toBe(false);
    await openTab(page, 'sec-mood');
    await expect.poll(() => chartDrawn(page, 'c-mood')).toBe(true);
  });

  test('AC8: arrow keys, Home and End move between the shown tabs', async ({ page }) => {
    await page.focus('#tab-sec-glance');
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#tab-sec-messages')).toBeFocused();
    await expect(page.locator('#tab-sec-messages')).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('End');
    await expect(page.locator('#tab-sec-ai')).toBeFocused();
    await expect(page.locator('#tab-sec-ai')).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowRight'); // wraps around
    await expect(page.locator('#tab-sec-glance')).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('#tab-sec-ai')).toBeFocused();
    await page.keyboard.press('Home');
    await expect(page.locator('#tab-sec-glance')).toHaveAttribute('aria-selected', 'true');
    // Only the selected tab is in the Tab order.
    expect(await page.evaluate(() => [...document.querySelectorAll('#tabList [role="tab"]')].filter((b) => b.tabIndex === 0).map((b) => b.id))).toEqual(['tab-sec-glance']);
  });

  test('AC9: changing the filters keeps the selected tab', async ({ page }) => {
    await openTab(page, 'sec-people');
    await page.click('#presets button[data-preset="90"]');
    await expect(page.locator('#presets button[data-preset="90"]')).toBeVisible();
    await expect.poll(() => inApp(page, (app) => app.filter.from)).not.toBeNull();
    expect((await tabState(page)).selected).toEqual(['sec-people']);
    await page.selectOption('#contactSel', { index: 1 });
    expect((await tabState(page)).selected).toEqual(['sec-people']);
    expect((await tabState(page)).visible).toEqual(['sec-people']);
  });

  test('AC11: the open tab is in the URL, and Back and Forward move between tabs', async ({ page }) => {
    const hash = () => page.evaluate(() => location.hash);
    expect(await hash()).toBe('#/overview');
    await page.click('#tabList [data-panel="sec-people"]');
    expect(await hash()).toBe('#/people');
    await page.click('#tabList [data-panel="sec-mood"]');
    expect(await hash()).toBe('#/mood');
    await page.goBack();
    await expect(page.locator('#tab-sec-people')).toHaveAttribute('aria-selected', 'true');
    expect((await tabState(page)).visible).toEqual(['sec-people']);
    await page.goBack();
    await expect(page.locator('#tab-sec-glance')).toHaveAttribute('aria-selected', 'true');
    await page.goForward();
    await expect(page.locator('#tab-sec-people')).toHaveAttribute('aria-selected', 'true');
    // The data is still loaded: going back and forth only switches tabs.
    await expect(page.locator('#dash')).toBeVisible();
    // Arrow keys replace the entry instead of adding one per tab.
    const before = await page.evaluate(() => history.length);
    await page.focus('#tab-sec-people');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    expect(await hash()).toBe('#/replies');
    expect(await page.evaluate(() => history.length)).toBe(before);
    // A link into the message list adds one, so Back returns to the chart.
    await page.click('#tabList [data-panel="sec-glance"]');
    await page.click('#otd [data-otd-day]');
    expect(await hash()).toBe('#/messages');
    await page.goBack();
    await expect(page.locator('#tab-sec-glance')).toHaveAttribute('aria-selected', 'true');
  });

  test('AC12: a tab the URL names that has nothing to show falls back to Overview, replacing the URL', async ({ page }) => {
    await page.click('#tabList [data-panel="sec-sources"]');
    await page.click('#sourceSeg [data-source="2"]');
    await expect(page.locator('#tab-sec-glance')).toHaveAttribute('aria-selected', 'true');
    expect(await page.evaluate(() => location.hash)).toBe('#/overview');
    // Typing a hidden tab's URL, or an unknown one, opens Overview and says so in the URL.
    for (const typed of ['#/sources', '#/nope']) {
      await page.click('#tabList [data-panel="sec-people"]');
      await page.evaluate((h) => { location.hash = h; }, typed);
      await expect(page.locator('#tab-sec-glance')).toHaveAttribute('aria-selected', 'true');
      await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/overview');
    }
  });
});

test('spec 003 AC13: opened with a tab in the URL, that tab shows once the data loads', async ({ page }) => {
  await page.goto('/#/mood');
  await page.click('#demoBtn');
  await expect(page.locator('#dash')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('#tab-sec-mood')).toHaveAttribute('aria-selected', 'true');
  expect((await tabState(page)).visible).toEqual(['sec-mood']);
  await expect.poll(() => chartDrawn(page, 'c-mood')).toBe(true);
  expect(await page.evaluate(() => location.hash)).toBe('#/mood');
});

test('spec 003 AC13: a tab that starts hidden (Calls) is still opened from the URL once its data loads', async ({ page }) => {
  await page.goto('/#/calls');
  await page.click('#demoBtn'); // the demo has a calls backup
  await expect(page.locator('#dash')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('#tab-callsSection')).toHaveAttribute('aria-selected', 'true');
  expect((await tabState(page)).visible).toEqual(['callsSection']);
  expect(await page.evaluate(() => location.hash)).toBe('#/calls');
});

test.describe('spec 003: the message list', () => {
  /** How far the list is from its bottom, in pixels (0 = showing the latest message). */
  const fromBottom = (page) => page.evaluate(() => {
    const box = document.getElementById('messages');
    return Math.round(box.scrollHeight - box.clientHeight - box.scrollTop);
  });

  test('AC14: Messages opens on the latest messages, and keeps its place when you come back', async ({ page }) => {
    await loadDemo(page); // the list is drawn while Overview is open
    await openTab(page, 'sec-messages');
    expect(await page.evaluate(() => document.getElementById('messages').scrollHeight > document.getElementById('messages').clientHeight)).toBe(true);
    expect(await fromBottom(page)).toBeLessThanOrEqual(1);
    await page.evaluate(() => { document.getElementById('messages').scrollTop = 500; });
    await openTab(page, 'sec-activity');
    await openTab(page, 'sec-messages');
    expect(await page.evaluate(() => document.getElementById('messages').scrollTop)).toBe(500);
    // A list redrawn while hidden (here, a new date range) opens on its latest message.
    await openTab(page, 'sec-activity');
    await page.click('#presets button[data-preset="90"]');
    await openTab(page, 'sec-messages');
    expect(await fromBottom(page)).toBeLessThanOrEqual(1);
    // Clicking Messages again while it's open leaves the list where it is.
    await page.evaluate(() => { document.getElementById('messages').scrollTop = 300; });
    await openTab(page, 'sec-messages');
    expect(await page.evaluate(() => document.getElementById('messages').scrollTop)).toBe(300);
    // A link into the list while it's open (here "Read that day") still ends on the latest message.
    await inApp(page, (app) => app.readDay(app.msgs.at(-1).t - (app.msgs.at(-1).t % 86400000)));
    expect(await fromBottom(page)).toBeLessThanOrEqual(1);
  });
});

test.describe('spec 003: dashboard tabs on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('AC10: the tab bar sticks to the top of the screen when scrolled', async ({ page }) => {
    await loadDemo(page);
    await openTab(page, 'sec-content');
    await page.evaluate(() => window.scrollTo(0, 3000));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(1000);
    expect(await page.evaluate(() => Math.round(document.getElementById('dashTabs').getBoundingClientRect().top))).toBe(0);
    // The strip scrolls sideways, and the selected tab is scrolled into it.
    await page.click('#tabList [data-panel="sec-ai"]');
    const fits = await page.evaluate(() => {
      const list = document.getElementById('tabList').getBoundingClientRect();
      const tab = document.getElementById('tab-sec-ai').getBoundingClientRect();
      return { overflows: document.getElementById('tabList').scrollWidth > list.width, inView: tab.left >= list.left - 1 && tab.right <= list.right + 1 };
    });
    expect(fits).toEqual({ overflows: true, inView: true });
  });
});
