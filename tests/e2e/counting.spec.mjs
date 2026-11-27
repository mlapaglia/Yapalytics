/* specs/028-responsive-words-tab.md: counting words in slices, without freezing the page. */
import { test, expect, loadDemo, openTab } from './fixtures.mjs';
import { inApp } from './state.mjs';

/** Slices of 1 ms, so counting the demo takes many of them and can be watched. */
const slowly = (page) => page.evaluate(() => {
  Background.budget = 1;
  Background.last = [];
});
const counted = (page) => page.waitForFunction(() => !Background.jobs.size && !Counting.shown.size);

/** From now on, counts the frames drawn while there's counting to do, in window.__frames. */
const countFrames = (page) => page.evaluate(() => {
  window.__frames = 0;
  const tick = () => {
    if (Background.jobs.size) window.__frames++;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

/** The signature phrases the Words tab shows, as text, for comparing. */
const phrasesShown = (page) => page.locator('#phrasesBox').innerText();

/** What the phrases box shows for the current selection, counted in one go. */
const phrasesInOneGo = (page) => page.evaluate(() => {
  const sig = signaturePhrases(aggregateContent(Select.range(), View.moodScorer).phrases);
  return sig.map((col) => col.phrases.map((p) => p.term));
});
const phrasesNow = (page) => page.$$eval('#phrasesBox .people-col', (cols) => cols.map((c) => [...c.querySelectorAll('[data-word]')].map((b) => b.dataset.word)));

/** The busiest 1-on-1 conversation's key. */
const busiest = (page) => inApp(page, (app) => app.topRows.find((r) => !r.key.startsWith('g:')).key);

test.describe('spec 028 counting words in slices', () => {
  test.beforeEach(async ({ page }) => {
    await loadDemo(page);
    await slowly(page);
  });

  test('AC2: the Words tab shows "Counting words…", keeps drawing, then shows the counts', async ({ page }) => {
    await countFrames(page);
    await openTab(page, 'sec-content');
    await expect(page.locator('#phrasesBox')).toContainText(/Counting words… \d+%/);
    await counted(page);
    expect(await page.evaluate(() => window.__frames)).toBeGreaterThanOrEqual(2);
    await expect(page.locator('#phrasesBox')).not.toContainText('Counting words');
    expect(await phrasesNow(page)).toEqual(await phrasesInOneGo(page));
    // The longest slice stayed near the budget: nothing near the old multi-second freeze.
    const longest = await page.evaluate(() => Math.max(...Background.last.map((j) => j.longest)));
    expect(longest).toBeLessThan(100);
  });

  test('AC3: picking another conversation while counting shows only its counts', async ({ page }) => {
    const key = await busiest(page);
    await openTab(page, 'sec-content');
    await expect(page.locator('#phrasesBox')).toContainText('Counting words');
    await page.selectOption('#contactSel', key);
    await counted(page);
    expect(await phrasesNow(page)).toEqual(await phrasesInOneGo(page));
    // The count for every conversation was dropped, never finished: it was never shown.
    const contentJobs = await page.evaluate(() => Background.last.filter((j) => j.slot === 'content').length);
    expect(contentJobs).toBe(1);
  });

  test('AC5: Mood & emoji and Media & links wait for the counts, then draw them', async ({ page }) => {
    await openTab(page, 'sec-mood');
    const waiting = await page.evaluate(() => [...Counting.shown.keys()].sort());
    expect(waiting).toEqual(['c-emojitrend', 'c-mood', 'c-polite', 'c-swear']);
    await counted(page);
    expect(await page.evaluate(() => Charts.get('c-mood').getOption().series.length)).toBe(4);

    await openTab(page, 'sec-media');
    await page.evaluate(() => View.set({ filter: { groups: false } })); // tens of thousands of messages to count again
    expect(await page.evaluate(() => [...Counting.shown.keys()])).toEqual(['c-domains']);
    await counted(page);
    expect(await page.evaluate(() => !!Charts.get('c-domains').getOption().series)).toBe(true);
  });

  test('AC6: a profile opened while counting shows "What you talk about"', async ({ page }) => {
    const key = await busiest(page);
    await openTab(page, 'sec-content');
    await expect(page.locator('#phrasesBox')).toContainText('Counting words');
    await inApp(page, (app, k) => app.openProfile(k), key);
    const want = await page.evaluate((k) => distinctiveWords(Data.messagesOf(k), buildDocFreq(Data.msgs), 15).map((w) => w.w), key);
    expect(want.length).toBeGreaterThan(0);
    await expect(page.locator('#profile .chips .chip')).toHaveText(want);
  });

  test('AC10: picking a conversation while All conversations\' inside jokes are counted drops the others\'', async ({ page }) => {
    const termsJobs = () => page.evaluate(() => [...Background.jobs.keys()].filter((s) => s.startsWith('terms:')));
    // Count every conversation in slices, and stop slicing as soon as three or more
    // conversations' counts are waiting, until the test goes on (window.__resume).
    const waiting = page.evaluate(() => new Promise((resolve) => {
      Background.syncBelow = 0;
      const slice = Background.slice;
      Background.slice = function () {
        slice.call(this);
        const terms = [...this.jobs.keys()].filter((s) => s.startsWith('terms:'));
        if (terms.length < 3) return;
        this.slice = () => {};
        window.__resume = () => {
          Background.slice = slice;
          Background.schedule();
        };
        resolve(terms);
      };
    }));
    await openTab(page, 'sec-content');
    const pending = await waiting;
    // The last of the busiest conversations: its count hasn't started yet.
    const key = pending.at(-1).slice('terms:'.length);
    expect(await termsJobs()).toEqual(pending); // nothing has moved since
    await page.selectOption('#contactSel', key);
    // The picked conversation's own is kept, the rest are dropped at once.
    expect(await termsJobs()).toEqual([`terms:${key}`]);
    const finished = await page.evaluate(() => Background.last.length);
    await page.evaluate(() => window.__resume());
    await counted(page);
    const after = await page.evaluate((n) => Background.last.slice(n).map((j) => j.slot), finished);
    expect(after.filter((s) => s.startsWith('terms:') && s !== `terms:${key}`)).toEqual([]);
    await expect(page.locator('#jokesBox')).not.toContainText('Counting words');
  });

  test('AC8: a card jumped to while counting stays in view when the counts arrive', async ({ page }) => {
    const value = await page.evaluate(() => [...document.querySelectorAll('#jumpSel option')].find((o) => o.textContent === 'Swearing').value);
    await page.selectOption('#jumpSel', value);
    await expect(page.locator('#c-swear')).toBeVisible();
    expect(await page.evaluate(() => Counting.shown.has('c-swear'))).toBe(true);
    await counted(page);
    const swearCard = page.locator('#sec-mood article.card', { has: page.locator('#c-swear') });
    await expect.poll(async () => {
      const top = await swearCard.evaluate((el) => el.getBoundingClientRect().top);
      const navBottom = await page.evaluate(() => document.getElementById('dashTabs').getBoundingClientRect().bottom);
      return Math.round(top - navBottom);
    }).toBe(12);
  });
});
