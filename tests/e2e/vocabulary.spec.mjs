import { test, expect, loadDemo, scrollTo, chartOption } from './fixtures.mjs';
import { inApp } from './state.mjs';

/**
 * The demo reuses a fixed set of phrases, so after its first month few words are new.
 * Add messages with brand-new words to a month mid-range; returns that month's index.
 */
const injectNewWords = (page) => inApp(page, (app) => {
  const months = [...new Set(app.msgs.map((m) => m.mo))].sort((a, b) => a - b);
  const mo = months[months.length - 7];
  const base = app.msgs.find((m) => m.mo === mo && m.s === 0);
  const lib = messageLib();
  const make = (o, body, i) => {
    const m = { ...base, o, t: base.t + i * 1000, att: undefined };
    lib.analyzeText(body, m);
    lib.stampTime(m);
    return m;
  };
  app.addMessages([
    make(1, 'the axolotl and the quokka were zooming around', 1),
    make(1, 'axolotl again, honestly the axolotl is my favorite', 2),
    make(0, 'did you see the narwhal documentary', 3),
  ]);
  return mo;
});

/** The month the Vocabulary chart has marked. */
const markedMonth = async (page) => {
  const ts = (await chartOption(page, 'c-vocab')).series[0].markLine.data[0].xAxis;
  const d = new Date(ts);
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
};

/** Words listed as new that were used earlier, or not used that month, by that side. */
const wronglyNew = (page) => inApp(page, (app) => {
  const opt = echarts.getInstanceByDom(document.getElementById('c-vocab')).getOption();
  const sel = new Date(opt.series[0].markLine.data[0].xAxis);
  const mo = sel.getFullYear() * 12 + sel.getMonth();
  const earlier = [new Set(), new Set()];
  const during = [new Set(), new Set()];
  for (const m of app.phraseMsgs) {
    if (!m.b || m.f & 16 || m.mo > mo) continue;
    for (const t of tokensOf(m.b)) (m.mo < mo ? earlier : during)[m.o].add(t);
  }
  const wrong = [];
  for (const col of document.querySelectorAll('.vocab-col')) {
    const o = col.classList.contains('sent') ? 1 : 0;
    for (const b of col.querySelectorAll('[data-word]')) {
      if (earlier[o].has(b.dataset.word) || !during[o].has(b.dataset.word)) wrong.push(b.dataset.word);
    }
  }
  return wrong;
});

test.describe('vocabulary', () => {
  test.beforeEach(async ({ page }) => {
    await loadDemo(page);
  });

  test("lists each side's new words for the latest month that has any", async ({ page }) => {
    const mo = await injectNewWords(page);
    await scrollTo(page, '#c-vocab');
    await expect(page.locator('.vocab-col.sent [data-word]').first()).toBeVisible();
    expect(await markedMonth(page)).toBeGreaterThanOrEqual(mo);
    expect(await wronglyNew(page)).toEqual([]);
  });

  test('ranks new words by use and picks months by clicking the chart', async ({ page }) => {
    const mo = await injectNewWords(page);
    await scrollTo(page, '#c-vocab');
    await expect(page.locator('.vocab-head')).toBeVisible();
    // Click the injected month: convert its timestamp to a pixel on the chart.
    const pt = await page.evaluate((m) => {
      const chart = echarts.getInstanceByDom(document.getElementById('c-vocab'));
      const [x, y] = chart.convertToPixel({ gridIndex: 0 }, [monthToTs(m), 50]);
      const r = chart.getDom().getBoundingClientRect();
      return { x: r.left + x, y: r.top + y };
    }, mo);
    await page.mouse.click(pt.x, pt.y);
    await expect.poll(() => markedMonth(page)).toBe(mo);
    await expect(page.locator('.vocab-col.sent [data-word]').first()).toHaveAttribute('data-word', 'axolotl');
    await expect(page.locator('.vocab-col.sent')).toContainText('quokka');
    await expect(page.locator('.vocab-col.recv')).toContainText('narwhal');
    expect(await wronglyNew(page)).toEqual([]);
  });

  test('clicking a word tracks it in the word tracker', async ({ page }) => {
    await injectNewWords(page);
    await scrollTo(page, '#c-vocab');
    const chip = page.locator('.vocab-col [data-word]').first();
    const word = await chip.getAttribute('data-word');
    await chip.click();
    await expect(page.locator('#phraseInput')).toHaveValue(word);
    await expect(page.locator('#phraseNote')).toContainText(`“${word}”`);
  });

  test('says when every word is new in the first month', async ({ page }) => {
    await scrollTo(page, '#c-vocab');
    await expect(page.locator('.vocab-head')).toBeVisible(); // the section renders once on screen
    await inApp(page, (app) => app.setVocabMonth(Math.min(...app.vocab.vocab.keys())));
    await expect(page.locator('.vocab-head')).toContainText('every word counts as new');
  });
});
