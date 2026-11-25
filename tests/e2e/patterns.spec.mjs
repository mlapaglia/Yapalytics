/* specs/019-language-patterns.md in the browser. */
import { test, expect, loadDemo, loadFiles, openTab, chartOption } from './fixtures.mjs';
import { inApp } from './state.mjs';
import { smsBackup } from '../helpers/sms.mjs';

/** The chart's placeholder text, or null when it draws data. */
const emptyText = async (page, id) => {
  const opt = await chartOption(page, id);
  return opt?.graphic?.[0]?.elements?.[0]?.style?.text ?? null;
};

/** distinctiveWords as it was before spec 019, to check "What you talk about" didn't change (AC12). */
const OLD_DISTINCTIVE = `(msgs, { df, docs }, limit = 25) => {
  const tf = new Map();
  for (const r of msgs) {
    if (!r.b || r.f & T_REACTION) continue;
    for (const tk of tokensOf(r.b)) {
      if (tk.length < 3 || STOPWORDS.has(tk)) continue;
      let v = tf.get(tk);
      if (!v) tf.set(tk, (v = [0, 0]));
      v[r.o]++;
    }
  }
  const rows = [];
  for (const [w, v] of tf) {
    const n = v[0] + v[1];
    if (n < 3) continue;
    const idf = Math.log(docs / (df.get(w) || 1));
    if (idf <= 0) continue;
    rows.push({ w, r: v[0], s: v[1], score: n * idf });
  }
  return rows.sort((a, b) => b.score - a.score).slice(0, limit);
}`;

test.describe('spec 019 language patterns', () => {
  test.describe('with the demo', () => {
    test.beforeEach(async ({ page }) => {
      await loadDemo(page);
    });

    test('AC18: Words shows the four new cards, Mood & emoji shows Thanks & sorry, and Jump to… lists all five', async ({ page }) => {
      await openTab(page, 'sec-content');
      for (const id of ['phrasesCard', 'jokesCard', 'correctionsCard', 'languagesCard']) await expect(page.locator(`#${id}`)).toBeVisible();
      await expect(page.locator('#phrasesBox .people-col')).not.toHaveCount(0);
      await expect(page.locator('#c-corrections canvas')).toHaveCount(1);
      await openTab(page, 'sec-mood');
      await expect(page.locator('#politeCard')).toBeVisible();
      await expect(page.locator('#c-polite canvas')).toHaveCount(1);
      expect(await emptyText(page, 'c-polite')).toBeNull();
      const options = await page.locator('#jumpSel option').allTextContents();
      for (const title of ['Signature phrases', 'Inside jokes', 'Corrections', 'Languages', 'Thanks & sorry']) expect(options).toContain(title);
    });

    test('AC7: clicking a phrase chip tracks it in the Word tracker', async ({ page }) => {
      await openTab(page, 'sec-content');
      const chip = page.locator('#phrasesBox [data-word]').first();
      const word = await chip.getAttribute('data-word');
      expect(word).toBeTruthy();
      await chip.click();
      await expect(page.locator('#phraseInput')).toHaveValue(word);
      expect(await inApp(page, (app) => app.phrase)).toBe(word);
      await expect.poll(() => emptyText(page, 'c-phrase')).toBeNull();
    });

    test('AC10: one conversation’s inside jokes show uses, who said it first and when, and when it was last used', async ({ page }) => {
      const { k, jokes } = await inApp(page, () => {
        const df = Select.docFreq();
        for (const key of Data.byKey.keys()) {
          if (key.startsWith('g:')) continue;
          const j = insideJokes(conversationTerms(Data.messagesOf(key), df), df);
          if (j.length) return { k: key, jokes: j.map((x) => ({ term: x.term, n: x.n, first: `${x.first.o ? 'You' : momentSender(x.first)} · ${fmtDate.day(x.first.t)}`, last: fmtDate.day(x.last) })) };
        }
        return {};
      });
      expect(k, 'a demo conversation with an inside joke').toBeTruthy();
      await page.selectOption('#contactSel', k);
      await openTab(page, 'sec-content');
      const rows = page.locator('#jokesBox tbody tr');
      await expect(rows).toHaveCount(jokes.length);
      await expect(rows.first().locator('th, td')).toHaveText([jokes[0].term, String(jokes[0].n), jokes[0].first, jokes[0].last]);
    });

    test('AC12: “What you talk about” gives the same words as before', async ({ page }) => {
      const { same, total } = await inApp(page, (app, src) => {
        const old = eval(src);
        const df = Select.docFreq();
        let same = 0, total = 0;
        for (const key of Data.byKey.keys()) {
          total++;
          const msgs = Data.messagesOf(key);
          if (JSON.stringify(old(msgs, df)) === JSON.stringify(distinctiveWords(msgs, df, 25, conversationTerms(msgs, df)))) same++;
        }
        return { same, total };
      }, OLD_DISTINCTIVE);
      expect(total).toBeGreaterThan(10);
      expect(same).toBe(total);
    });

    test('AC17: a selection all in one language says so instead of drawing the chart', async ({ page }) => {
      await openTab(page, 'sec-content');
      await expect.poll(() => emptyText(page, 'c-languages')).toBe('Everything here is in English, as far as Yapalytics can tell');
    });

    test('AC19: Year in review counts no phrases and its numbers are the same', async ({ page }) => {
      const r = await inApp(page, () => {
        const base = Select.base();
        const year = new Date(base[base.length - 1].t).getFullYear();
        const orig = window.aggregateContent;
        const opts = [];
        window.aggregateContent = (msgs, scorer, o) => { opts.push(o); return orig(msgs, scorer, o); };
        let stats;
        try { stats = wrappedStats(base, year); } finally { window.aggregateContent = orig; }
        const from = new Date(year, 0, 1).getTime(), to = new Date(year + 1, 0, 1).getTime();
        const full = orig(base.filter((m) => m.t >= from && m.t < to));
        const top = (map) => [...map.entries()].sort((a, b) => (b[1][0] + b[1][1]) - (a[1][0] + a[1][1]))[0]?.[0];
        return { opts, word: stats.word, site: stats.site, fullWord: top(full.wordFreq), fullSite: top(full.domains) };
      });
      expect(r.opts).toEqual([{ phrases: false }]);
      expect(r.word).toBe(r.fullWord);
      expect(r.site).toBe(r.fullSite);
    });
  });

  test('AC11: for all conversations, Inside jokes lists at most 8, one per conversation, each linking to its profile', async ({ page }) => {
    const jokes = ['moose', 'llama', 'pickle', 'waffle', 'noodle', 'biscuit', 'pretzel', 'walrus', 'gizmo'];
    const msgs = [];
    const day = (d, h) => new Date(Date.UTC(2024, 0, 1 + d, h)).toISOString();
    jokes.forEach((joke, i) => {
      const address = `+1555000${String(i).padStart(4, '0')}`;
      const name = `Friend ${i + 1}`;
      for (let d = 0; d < 50; d++) {
        msgs.push({ address, name, at: day(d, 10), sent: true, body: 'see you at the park later today' });
        msgs.push({ address, name, at: day(d, 11), body: 'sounds great see you there' });
        msgs.push({ address, name, at: day(d, 12), sent: true, body: 'bring the frisbee please' });
        msgs.push({ address, name, at: day(d, 13), body: 'will do' });
      }
      for (let j = 0; j < 4; j++) {
        msgs.push({ address, name, at: day(j * 10, 15), sent: true, body: `that is so ${joke} of you` });
        msgs.push({ address, name, at: day(j * 10 + 1, 15), body: `classic ${joke} move` });
      }
    });
    await loadFiles(page, [smsBackup(msgs)]);
    await openTab(page, 'sec-content');
    const rows = page.locator('#jokesBox tbody tr');
    await expect(rows).toHaveCount(8);
    await expect(rows.locator('th .person-link[data-profile]')).toHaveCount(8);
    const terms = await rows.locator('[data-word]').evaluateAll((els) => els.map((e) => e.dataset.word));
    expect(new Set(terms).size).toBe(8);
    for (const t of terms) expect(jokes.some((j) => t.includes(j))).toBe(true);
  });
});
