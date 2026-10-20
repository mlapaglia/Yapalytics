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

/** Scrolls a card into view below the sticky filter bar (lazy sections render when visible). */
export async function scrollTo(page, selector) {
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
