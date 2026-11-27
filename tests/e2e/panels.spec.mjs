import { test, expect, loadDemo, openTab, chartOption } from './fixtures.mjs';
import { inApp } from './state.mjs';

/** Records the ids of the charts drawn from now on. */
const recordCharts = (page) => page.evaluate(() => {
  window.__drawn = [];
  const set = Charts.set.bind(Charts);
  Charts.set = (id, ...rest) => {
    window.__drawn.push(id);
    return set(id, ...rest);
  };
});
const drawn = (page) => page.evaluate(() => window.__drawn.splice(0));

/**
 * Counts how often message text is split into words (wordsOf, which tokensOf uses) from
 * now on: everywhere, and inside the selection's text pass (aggregateContent).
 */
const countTokenizing = (page) => page.evaluate(() => {
  window.__tokenized = 0;
  window.__inContent = 0;
  const real = wordsOf;
  const content = aggregateContent;
  let inside = false;
  window.wordsOf = (body) => {
    window.__tokenized++;
    if (inside) window.__inContent++;
    return real(body);
  };
  window.aggregateContent = (...args) => {
    inside = true;
    try { return content(...args); } finally { inside = false; }
  };
  // The dashboard counts in slices (spec 028): each slice is inside the pass too.
  const steps = aggregateContentSteps;
  window.aggregateContentSteps = function* (...args) {
    const it = steps(...args);
    for (;;) {
      inside = true;
      let r;
      try { r = it.next(); } finally { inside = false; }
      if (r.done) return r.value;
      yield r.value;
    }
  };
});
const tokenized = (page) => page.evaluate(() => window.__tokenized);
const tokenizedInContent = (page) => page.evaluate(() => window.__inContent);

/** The busiest 1-on-1 conversation's key. */
const busiest = (page) => inApp(page, (app) => app.topRows.find((r) => !r.key.startsWith('g:')).key);

test.describe('spec 014 panels', () => {
  test('AC12: on Overview, a new conversation draws no other tab\'s charts; Activity draws them when opened', async ({ page }) => {
    await loadDemo(page);
    await recordCharts(page);
    const key = await busiest(page);
    await page.selectOption('#contactSel', key);
    await expect(page.locator('#scope')).not.toContainText('All conversations');
    // Overview has no charts; the filter bar and the tab bar have none either.
    expect(await drawn(page)).toEqual([]);

    await openTab(page, 'sec-activity');
    expect(await drawn(page)).toEqual(expect.arrayContaining(['c-timeline', 'c-hour', 'c-dow', 'c-heat', 'c-calendar', 'c-yoy', 'c-night']));
    const timeline = await chartOption(page, 'c-timeline');
    const shown = timeline.series.slice(0, 2).reduce((n, s) => n + s.data.reduce((a, [, v]) => a + v, 0), 0);
    expect(shown).toBe(await inApp(page, (app) => app.selection().length));
  });

  test('AC13: Overview never splits message text into words; opening Words does, once per message', async ({ page }) => {
    await page.goto('/');
    await countTokenizing(page);
    await page.click('#demoBtn');
    await expect(page.locator('#dash')).toBeVisible({ timeout: 60_000 });
    await page.selectOption('#contactSel', await busiest(page));
    await page.selectOption('#contactSel', 'all');
    expect(await tokenized(page)).toBe(0);

    await openTab(page, 'sec-content');
    await expect.poll(() => tokenizedInContent(page)).toBeGreaterThan(0);
    // The selection's pass: each message with text once, and a message with a link once
    // more without its links (R10). Inside jokes (spec 019) add their own cached passes
    // over the conversations they show and the word counts across conversations, as
    // "What you talk about" does for one conversation.
    const expected = await inApp(page, (app) => {
      const text = app.selection().filter((m) => m.b && !(m.f & 16));
      return text.length + text.filter((m) => m.f & 2).length;
    });
    expect(await tokenizedInContent(page)).toBe(expected);
    // The other content tabs reuse those passes.
    const all = await tokenized(page);
    await openTab(page, 'sec-mood');
    await openTab(page, 'sec-media');
    expect(await tokenized(page)).toBe(all);
  });
});
