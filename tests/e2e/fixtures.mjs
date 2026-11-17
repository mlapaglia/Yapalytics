/*
 * Shared setup for the browser tests:
 * - the CDN scripts (echarts, heic-to) are served from node_modules, so runs don't
 *   depend on the network and use exactly the pinned versions;
 * - any page error or console error fails the test (opt out with failOnConsoleError).
 * Tests reach into the page's globals (S, aggregatePhrase…) to check numbers: the app
 * is plain scripts, so those are its public surface.
 */
import { test as base, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const nodeModule = (path) => fileURLToPath(new URL(`../../node_modules/${path}`, import.meta.url));
export const ECHARTS_URL = 'https://cdn.jsdelivr.net/npm/echarts@6.1.0/dist/echarts.min.js';
export const HEIC_TO_URL = 'https://cdn.jsdelivr.net/npm/heic-to@1.6.5/dist/iife/heic-to.js';
export const HEIC_TO_PATH = nodeModule('heic-to/dist/iife/heic-to.js');
const LOCAL = {
  [ECHARTS_URL]: nodeModule('echarts/dist/echarts.min.js'),
  [HEIC_TO_URL]: HEIC_TO_PATH,
};

export const test = base.extend({
  failOnConsoleError: [true, { option: true }],

  page: async ({ page, failOnConsoleError }, use) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => {
      if (m.type() === 'error' && !/favicon/.test(m.text()) && !/404/.test(m.text())) errors.push(m.text());
    });
    // Later routes take precedence: block everything external, then allow the pinned scripts.
    // Tests can add their own route for HEIC_TO_URL to delay or block it.
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
    for (const [url, path] of Object.entries(LOCAL)) {
      await page.route(url, (route) => route.fulfill({ path, contentType: 'text/javascript' }));
    }
    await use(page);
    if (failOnConsoleError) expect(errors, 'page or console errors').toEqual([]);
  },
});

export { expect };

/** Opens the app and loads the built-in demo data. */
export async function loadDemo(page) {
  await page.goto('/');
  await page.click('#demoBtn');
  await expect(page.locator('#dash')).toBeVisible({ timeout: 60_000 });
}

/** Opens the app and loads export files ({ name, mimeType, buffer } or paths). */
export async function loadFiles(page, files) {
  await page.goto('/');
  await page.setInputFiles('#fileInput', files);
  await expect(page.locator('#dash')).toBeVisible({ timeout: 60_000 });
}

/** Adds export files from the Files dialog (spec 006) and applies, waiting for the dashboard. */
export async function addFiles(page, files) {
  await page.click('#filesBtn');
  const rows = await page.locator('#filesList li[data-file]').count();
  await page.setInputFiles('#addInput', files);
  await expect(page.locator('#filesList li[data-file]')).toHaveCount(rows + (Array.isArray(files) ? files.length : 1));
  await page.click('#filesApply');
  await expect(page.locator('#landing')).toBeHidden({ timeout: 60_000 });
  await expect(page.locator('#dash')).toBeVisible();
}

/** Scrolls a card into view below the sticky filter bar (lazy sections render when visible). */
/**
 * Opens the dashboard tab (spec 003) that holds an element, by clicking its tab. Does
 * nothing for elements outside the tabs, or when the tab is already open.
 */
export async function openTabOf(page, selector) {
  const panel = await page.evaluate((sel) => document.querySelector(sel)?.closest('.dash-section')?.id ?? null, selector);
  if (!panel) return;
  const tab = page.locator(`#tabList [data-panel="${panel}"]`);
  if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click();
}

/** Opens a dashboard tab by its section id, e.g. 'sec-messages'. */
export async function openTab(page, panel) {
  await page.click(`#tabList [data-panel="${panel}"]`);
}

export async function scrollTo(page, selector) {
  await openTabOf(page, selector);
  await page.locator(selector).scrollIntoViewIfNeeded();
  await page.evaluate((sel) => {
    document.querySelector(sel).scrollIntoView({ block: 'center' });
  }, selector);
}

/** The ECharts option currently rendered in a chart element (null until the chart exists). */
export function chartOption(page, id) {
  return page.evaluate((el) => {
    const chart = echarts.getInstanceByDom(document.getElementById(el));
    return chart ? chart.getOption() : null;
  }, id);
}
