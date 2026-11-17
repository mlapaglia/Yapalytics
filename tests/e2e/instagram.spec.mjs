import { test, expect, loadFiles, loadDemo, scrollTo, chartOption, openTab } from './fixtures.mjs';
import { igMessage, looseThread, splitExport, threadOf, zippedExport, zippedHtmlExport } from '../helpers/instagram.mjs';

/** Instagram messages loaded: total, and how many count as sent by you. */
const instagramCounts = (page) => page.evaluate(() => {
  const ig = S.msgs.filter((m) => m.s === 5);
  return { n: ig.length, sent: ig.filter((m) => m.o === 1).length };
});

test.describe('Instagram', () => {
  test('loads the export zip and knows which messages are yours', async ({ page }) => {
    await loadFiles(page, zippedExport());
    // 8 messages kept (2 likes are reactions); Jamie Park sent 2 of them.
    expect(await instagramCounts(page)).toEqual({ n: 8, sent: 2 });
    expect(await page.evaluate(() => S.reactions)).toBe(2);
    const picker = page.locator('#ownerFields label', { hasText: 'You on Instagram' }).locator('select');
    await expect(picker).toHaveValue('Jamie Park');
    const options = await page.locator('#contactSel option').allTextContents();
    expect(options.some((o) => o.startsWith('📸 Alex Rivera'))).toBe(true);
    expect(options.some((o) => o.startsWith('📸👥 Road Trip 🚗'))).toBe(true);
    expect(options.some((o) => o.includes('Spam Bot')), 'message requests are skipped').toBe(false);
  });

  test('picking a different owner swaps sent and received', async ({ page }) => {
    await loadFiles(page, zippedExport());
    const picker = page.locator('#ownerFields label', { hasText: 'You on Instagram' }).locator('select');
    await picker.selectOption('Alex Rivera');
    await expect.poll(async () => (await instagramCounts(page)).sent).toBe(4);
  });

  test('opens a photo from another part of a split export', async ({ page }) => {
    await loadFiles(page, splitExport());
    await scrollTo(page, '#galleryCard');
    const tile = page.locator('#galleryGrid .tile[title^="1801_1"]');
    await expect(tile).toHaveClass(/loaded/, { timeout: 30_000 });
    await tile.click();
    await page.waitForFunction(() => document.querySelector('#viewer .viewer-stage img')?.naturalWidth);
    expect(await page.$eval('#viewer .viewer-stage img', (i) => [i.naturalWidth, i.naturalHeight])).toEqual([1600, 1200]);
    await expect(page.locator('#viewer .viewer-caption')).toContainText('Alex Rivera');
  });

  test('a message_1.json on its own guesses you from the chat title', async ({ page }) => {
    await loadFiles(page, looseThread());
    await expect(page.locator('#ownerFields label', { hasText: 'You on Instagram' }).locator('select')).toHaveValue('Jamie Park');
    expect(await instagramCounts(page)).toEqual({ n: 3, sent: 1 });
  });

  test('shows up in the demo, the source switch and the platform mix', async ({ page }) => {
    await loadDemo(page);
    await expect(page.locator('#sourceSeg button[data-source="5"]')).toBeVisible();
    await page.click('#sourceSeg button[data-source="5"]');
    await expect(page.locator('#scope')).toContainText('(Instagram)');
    await page.click('#sourceSeg button[data-source="all"]');
    await scrollTo(page, '#c-platforms');
    await expect.poll(async () => (await chartOption(page, 'c-platforms'))?.series?.map((s) => s.name) ?? []).toContain('Instagram');
  });
});

test.describe('Instagram errors', () => {
  test.use({ failOnConsoleError: false }); // the app logs the error it shows

  test('explains that the HTML export needs to be redone as JSON', async ({ page }) => {
    await page.goto('/');
    await page.setInputFiles('#fileInput', zippedHtmlExport());
    await expect(page.locator('#loadError')).toContainText('Instagram');
    await expect(page.locator('#loadError')).toContainText('JSON');
    await expect(page.locator('#dash')).toBeHidden();
  });
});

test.describe('spec 004 Instagram shared posts', () => {
  const REEL = 'https://www.instagram.com/reel/abc/?id=1_2';
  const EMBED = 'https://www.instagram.com/reel/abc/embed/';

  /** The zipped export, Alex's chat open in Messages; the share card's bubble. */
  async function openShare(page) {
    await loadFiles(page, zippedExport());
    await page.selectOption('#contactSel', 'ig:alexrivera_1111');
    await openTab(page, 'sec-messages');
    return page.locator('#messages .bubble', { has: page.locator('.share-card') });
  }

  test('AC1: a shared reel shows its creator, caption and a link that opens in a new tab', async ({ page }) => {
    const bubble = await openShare(page);
    await expect(bubble).toHaveCount(1);
    await expect(bubble.locator('.share-owner')).toHaveText('@tacotuesday');
    await expect(bubble.locator('.share-text')).toHaveText('so true lol');
    const link = bubble.locator('a.share-link');
    await expect(link).toHaveText('Open on Instagram ↗');
    await expect(link).toHaveAttribute('href', REEL);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(bubble).not.toContainText('📎');
  });

  test('AC4: with previews off nothing is loaded from Instagram', async ({ page }) => {
    const requests = [];
    page.on('request', (r) => { if (/instagram\.com/.test(r.url())) requests.push(r.url()); });
    const bubble = await openShare(page);
    await expect(page.locator('#igPreviewsLabel')).toBeVisible();
    await expect(page.locator('#igPreviewsChk')).not.toBeChecked();
    await expect(bubble.locator('.share-card')).toBeVisible();
    await expect(page.locator('#messages iframe')).toHaveCount(0);
    expect(requests).toEqual([]);
  });

  test('AC6: turning previews on shows the embed, and the choice is remembered', async ({ page }) => {
    const loaded = [];
    await page.route(/^https:\/\/www\.instagram\.com\//, (route) => {
      loaded.push(route.request().url());
      route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>embed</title>' });
    });
    const bubble = await openShare(page);
    await page.check('#igPreviewsChk');
    const frame = bubble.locator('.share-preview iframe');
    await expect(frame).toHaveAttribute('src', EMBED);
    await expect.poll(() => loaded).toEqual([EMBED]);
    await expect(bubble.locator('a.share-cover')).toHaveAttribute('href', REEL);
    await expect(bubble.locator('a.share-cover')).toHaveAttribute('target', '_blank');

    await page.reload();
    const again = await openShare(page);
    await expect(page.locator('#igPreviewsChk')).toBeChecked();
    await expect(again.locator('.share-preview iframe')).toHaveAttribute('src', EMBED);
  });

  test('AC2, AC15: a bad link gets no link; Instagram links say so, others don\'t, and only posts get a preview', async ({ page }) => {
    const share = (sec, s) => igMessage(sec, 'Alex', { content: 'Alex sent an attachment.', share: s });
    await page.route(/^https:\/\/www\.instagram\.com\//, (route) => route.fulfill({ contentType: 'text/html', body: '' }));
    await loadFiles(page, threadOf(
      share(0, { link: 'javascript:alert(1)', share_text: 'bad link', original_content_owner: 'bad' }),
      share(60, { link: 'https://www.instagram.com/stories/storyteller/123/', original_content_owner: 'storyteller' }),
      share(120, { link: 'https://www.instagram.com/tacotuesday', profile_share_username: 'tacotuesday', profile_share_name: 'Taco Tuesday' }),
      share(180, { link: 'https://youtu.be/abc', share_text: 'a video' }),
      share(240, { link: 'https://www.instagram.com/p/Post1/', share_text: 'a post', original_content_owner: 'poster' }),
    ));
    await openTab(page, 'sec-messages');
    await page.check('#igPreviewsChk');
    const card = (text) => page.locator('#messages .share-card', { hasText: text });
    await expect(card('bad link')).toBeVisible();
    await expect(card('bad link').locator('a')).toHaveCount(0);
    await expect(card('@storyteller').locator('a.share-link')).toHaveText('Open on Instagram ↗');
    await expect(card('@tacotuesday')).toContainText('Taco Tuesday');
    await expect(card('@tacotuesday').locator('a.share-link')).toHaveText('Open on Instagram ↗');
    await expect(card('a video').locator('a.share-link')).toHaveText('Open link ↗');
    await expect(page.locator('#messages iframe')).toHaveCount(1);
    await expect(card('@poster').locator('iframe')).toHaveAttribute('src', 'https://www.instagram.com/p/Post1/embed/');
  });

  test('AC7: searching finds a share by its caption or creator', async ({ page }) => {
    await openShare(page);
    await page.fill('#search', 'true lol');
    await expect(page.locator('#messages .bubble')).toHaveCount(1);
    await expect(page.locator('#messages .share-owner')).toHaveText('@tacotuesday');
    await page.fill('#search', 'tacotues');
    await expect(page.locator('#messages .bubble')).toHaveCount(1);
  });

  test('AC8: a share is not counted as a file', async ({ page }) => {
    await loadFiles(page, zippedExport());
    // Alex's two photos and one video (not in the zip): the share isn't an attachment.
    const media = await page.evaluate(() => S.msgs.reduce((s, m) => s + m.ph + m.gf + m.vd + m.au + m.ot, 0));
    expect(media).toBe(3);
    await scrollTo(page, '#galleryCard');
    await expect(page.locator('#galleryNote')).toContainText(/^1 more can't be shown/);
  });
});

test.describe('spec 004 reactions on messages', () => {
  test('AC13: reactions show under the message, naming you by the owner picked', async ({ page }) => {
    await loadFiles(page, zippedExport());
    const before = await instagramCounts(page);
    await page.selectOption('#contactSel', 'ig:alexrivera_1111');
    await openTab(page, 'sec-messages');
    const cafe = page.locator('#messages .bubble', { hasText: 'café later?' });
    const heart = cafe.locator('.rx', { hasText: '❤️' });
    await expect(heart).toHaveText('❤️2');
    await expect(heart).toHaveAttribute('title', '❤️ Alex Rivera, You');
    await expect(cafe.locator('.rx', { hasText: '😮' })).toHaveAttribute('title', '😮 Alex Rivera');
    const share = page.locator('#messages .bubble', { has: page.locator('.share-card') });
    await expect(share.locator('.rx')).toHaveAttribute('title', '😂 You');

    const picker = page.locator('#ownerFields label', { hasText: 'You on Instagram' }).locator('select');
    await picker.selectOption('Alex Rivera');
    await openTab(page, 'sec-messages');
    await expect(page.locator('#messages .bubble', { hasText: 'café later?' }).locator('.rx', { hasText: '❤️' })).toHaveAttribute('title', '❤️ You, Jamie Park');
    expect((await instagramCounts(page)).n).toBe(before.n);
  });
});
