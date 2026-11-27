/* specs/016-loading-screen.md in the browser. */
import { test, expect, loadFiles, addFiles } from './fixtures.mjs';
import { inApp } from './state.mjs';
import { smsBackup } from '../helpers/sms.mjs';

/**
 * Records the loading screen while it runs: every step line, the names found and
 * whether reading was still going, its text, sideways scroll, running animations and
 * animation frames. Read it back with `recorded(page)`.
 */
async function record(page) {
  await page.addInitScript(() => {
    const rec = (window.__rec = { steps: [], stepWrites: 0, maxFound: 0, foundWhileReading: 0, texts: [], maxScroll: 0, anims: 0, demoMsgsAtStart: null, frames: 0, maxChip: 0, chipOverflow: 0 });
    // Draws between one frame's callbacks and the next's: what one frame drew (AC15).
    Object.assign(rec, { lastDraws: 0, maxDrawsPerFrame: 0, framesWithDraws: 0 });
    const tick = () => {
      rec.frames++;
      // eslint-disable-next-line no-undef
      const draws = typeof LoadScreen === 'undefined' ? 0 : LoadScreen.draws;
      const d = draws - rec.lastDraws;
      rec.lastDraws = draws;
      rec.maxDrawsPerFrame = Math.max(rec.maxDrawsPerFrame, d);
      if (d > 0) rec.framesWithDraws++;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    document.addEventListener('DOMContentLoaded', () => {
      const step = document.getElementById('loadStep');
      const progress = document.getElementById('progress');
      new MutationObserver((list) => {
        rec.stepWrites += list.length;
        const t = step.textContent;
        rec.steps.push(t);
        // eslint-disable-next-line no-undef
        if (rec.demoMsgsAtStart === null && t.startsWith('Making up')) rec.demoMsgsAtStart = Data.msgs.length;
      }).observe(step, { childList: true, characterData: true, subtree: true });
      new MutationObserver(() => {
        if (!progress.checkVisibility()) return; // hidden, or the dashboard has replaced it
        const found = document.getElementById('loadFound').children.length;
        rec.maxFound = Math.max(rec.maxFound, found);
        const reading = [...document.querySelectorAll('#loadFiles li')].some((li) => li.dataset.state === 'reading');
        if (found && reading) rec.foundWhileReading = Math.max(rec.foundWhileReading, found);
        if (rec.texts.length < 2000) rec.texts.push(progress.innerText);
        const root = document.documentElement;
        rec.maxScroll = Math.max(rec.maxScroll, root.scrollWidth - root.clientWidth);
        const box = document.getElementById('loadFound');
        for (const li of box.children) {
          const w = li.getBoundingClientRect().width;
          rec.maxChip = Math.max(rec.maxChip, w);
          rec.chipOverflow = Math.max(rec.chipOverflow, li.getBoundingClientRect().right - box.getBoundingClientRect().right);
        }
        rec.anims = Math.max(rec.anims, document.getAnimations().filter((a) => progress.contains(a.effect?.target)).length);
      }).observe(progress, { childList: true, subtree: true, characterData: true, attributes: true });
    });
  });
}
const recorded = (page) => page.evaluate(() => window.__rec);

/**
 * Pretends the computer has `cores` cores, before the page loads: the loader starts one
 * parse worker fewer, up to 4 (PARSE_WORKERS), so 4 cores read three files at once and
 * 2 cores read one at a time.
 */
const cores = (page, n) => page.addInitScript((c) => Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', { get: () => c, configurable: true }), n);

async function loadDemoRecorded(page) {
  await page.goto('/');
  await page.click('#demoBtn');
  await expect(page.locator('#dash')).toBeVisible({ timeout: 60_000 });
}

const sms = (n = 3, fileName) => smsBackup(Array.from({ length: n }, (_, i) => ({
  address: `+1555000${String(i % 30).padStart(4, '0')}`,
  name: `Friend ${i % 30}`,
  at: new Date(Date.UTC(2023, 0, 1) + i * 3600e3).toISOString(),
  sent: i % 2 === 0,
  body: `message number ${i}`,
})), fileName);
const whatsApp = () => ({ name: 'WhatsApp Chat with Sam.txt', mimeType: 'text/plain', buffer: Buffer.from('1/2/24, 10:00 - Sam: hi\n1/2/24, 10:01 - Me: hey Sam\n2/3/24, 09:00 - Sam: see you\n') });

test.describe('spec 016 loading screen', () => {
  test('AC1: one row and one bar segment per file, with logos and sizes', async ({ page }) => {
    const files = [sms(40), whatsApp()];
    await loadFiles(page, files);
    const rows = page.locator('#loadFiles li');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0).locator('use')).toHaveAttribute('href', '#logo-sms');
    await expect(rows.nth(1).locator('use')).toHaveAttribute('href', '#logo-whatsapp');
    await expect(rows.nth(0)).toContainText(files[0].name);
    await expect(rows.nth(1)).toContainText('WhatsApp Chat with Sam.txt');
    const grow = await page.locator('#loadSegs .load-seg').evaluateAll((els) => els.map((e) => Number(e.style.flexGrow)));
    expect(grow).toEqual(files.map((f) => f.buffer.length));
  });

  test('AC2: the step line names the files being read, then sorting, owners and drawing', async ({ page }) => {
    await cores(page, 4);
    await record(page);
    const files = [sms(40), whatsApp()];
    await loadFiles(page, files);
    const n = await inApp(page, (app) => app.msgs.length);
    const steps = (await recorded(page)).steps;
    // Different apps are read at the same time; whichever finishes first leaves the other named.
    const reading = steps.slice(1, steps.indexOf(`Sorting ${n} messages`));
    expect(reading[0]).toBe(`Reading ${files[0].name} and WhatsApp Chat with Sam.txt`);
    for (const step of reading.slice(1)) expect([`Reading ${files[0].name}`, 'Reading WhatsApp Chat with Sam.txt']).toContain(step);
    expect(steps[0]).toBe('Checking files');
    expect(steps.slice(steps.indexOf(`Sorting ${n} messages`))).toEqual([`Sorting ${n} messages`, "Working out who's you", 'Drawing the dashboard']);
  });

  test('AC20: with one worker, the step line names one file at a time, in order', async ({ page }) => {
    await cores(page, 2);
    await record(page);
    const files = [sms(40), whatsApp()];
    await loadFiles(page, files);
    const n = await inApp(page, (app) => app.msgs.length);
    const { steps } = await recorded(page);
    const reading = steps.slice(1, steps.indexOf(`Sorting ${n} messages`));
    expect([...new Set(reading)]).toEqual([`Reading ${files[0].name}`, 'Reading WhatsApp Chat with Sam.txt']);
    const jobs = await inApp(page, () => LoadPerf.last.jobs.map((j) => ({ label: j.label, start: j.t0, end: j.t0 + j.ms })));
    expect(jobs.map((j) => j.label)).toEqual([files[0].name, 'WhatsApp Chat with Sam.txt']);
    expect(jobs[1].start).toBeGreaterThanOrEqual(jobs[0].end);
  });

  test('AC3: the counts match what was loaded', async ({ page }) => {
    await loadFiles(page, [sms(40), whatsApp()]);
    const { snap, want } = await inApp(page, (app) => {
      const keys = new Set([...app.msgs.map((m) => m.tk || m.k), ...app.calls.map((c) => c.tk || c.k)]);
      return { snap: app.loadSnapshot, want: { messages: app.msgs.length, calls: app.calls.length, conversations: keys.size } };
    });
    expect({ messages: snap.counts.messages, calls: snap.counts.calls, conversations: snap.counts.conversations }).toEqual(want);
    await expect(page.locator('#loadCounts [data-count="messages"] dd')).toHaveText(String(want.messages));
  });

  test('AC4: an overlapping export shows the duplicates it skipped', async ({ page }) => {
    await loadFiles(page, sms(6, 'sms-1.xml'));
    await addFiles(page, sms(9, 'sms-2.xml')); // the first 6 again, and 3 new
    const snap = await inApp(page, (app) => app.loadSnapshot);
    expect(snap.counts.dupes).toBe(6);
    expect(snap.counts.messages).toBe(9);
    await expect(page.locator('#loadCounts [data-count="dupes"]')).toBeAttached();
    await expect(page.locator('#loadCounts [data-count="dupes"] dd')).toHaveText('6');
  });

  test('AC5: a WhatsApp-only load shows no Calls count', async ({ page }) => {
    await loadFiles(page, whatsApp());
    await expect(page.locator('#loadCounts [data-count="calls"]')).toHaveAttribute('hidden', '');
    await expect(page.locator('#loadCounts [data-count="messages"]')).not.toHaveAttribute('hidden', '');
  });

  test('AC7: the timeline covers the months read, and names the first and last', async ({ page }) => {
    await loadFiles(page, sms(40 * 24)); // an hour apart: Jan and Feb 2023
    const { snap, months, caption } = await inApp(page, (app) => {
      const months = new Map();
      for (const m of app.msgs) months.set(m.mo, (months.get(m.mo) || 0) + 1);
      const mos = [...months.keys()].sort((a, b) => a - b);
      const label = (mo) => fmtDate.monthShort(new Date(Math.floor(mo / 12), mo % 12, 1));
      return { snap: app.loadSnapshot, months: [...months].sort((a, b) => a[0] - b[0]), caption: `${label(mos[0])} – ${label(mos.at(-1))}` };
    });
    expect([...snap.months].sort((a, b) => a[0] - b[0])).toEqual(months);
    expect(snap.first).toBe(months[0][0]);
    expect(snap.last).toBe(months.at(-1)[0]);
    await expect(page.locator('#loadRange')).toHaveText(caption);
  });

  test.describe('a file that fails', () => {
    test.use({ failOnConsoleError: false }); // the parse error is logged

    test('AC8: each file ends done with what it added, and a bad file ends failed', async ({ page }) => {
      const good = sms(12);
      await loadFiles(page, [good, { name: 'result.json', mimeType: 'application/json', buffer: Buffer.from('{oops') }]);
      await expect(page.locator('#dashError')).toBeVisible();
      const rows = page.locator('#loadFiles li');
      await expect(rows.filter({ hasText: good.name })).toHaveAttribute('data-state', 'done');
      await expect(rows.filter({ hasText: good.name })).toContainText('12 messages');
      await expect(rows.filter({ hasText: 'result.json' })).toHaveAttribute('data-state', 'failed');
      await expect(rows.filter({ hasText: 'result.json' })).toContainText("Couldn't read");
    });
  });

  test.describe('with the demo', () => {
    test.beforeEach(async ({ page }) => {
      await record(page);
    });

    // One demo load, recorded, checked for each of these.
    test('AC9, AC10, AC11, AC12, AC15: the steps, the text and the drawing of one demo load', async ({ page }) => {
      await loadDemoRecorded(page);
      const rec = await recorded(page);

      // AC9: every step ticks off with a time, starting with Preparing the demo.
      const snap = await inApp(page, (app) => app.loadSnapshot);
      expect(snap.steps.map((x) => x.id)).toEqual(['demo', 'check', 'read', 'merge', 'owners', 'draw']);
      for (const x of snap.steps) {
        expect(x.state, x.id).toBe('done');
        expect(x.ms, x.id).toBeGreaterThanOrEqual(0);
      }
      await expect(page.locator('#loadSteps li[data-state="done"]')).toHaveCount(6);
      await expect(page.locator('#loadSteps li').first()).toContainText('Preparing the demo');
      // The demo's Takeout comes in two zips, read together: they share one count (R7).
      const takeout = page.locator('#loadFiles li', { hasText: 'takeout-' });
      await expect(takeout).toHaveCount(2);
      for (const row of await takeout.all()) await expect(row.locator('.load-file-state')).toContainText('from these 2 files');

      // AC10: the loading screen shows before the demo data exists.
      expect(rec.demoMsgsAtStart, 'AC10').toBe(0);

      // AC11: no message text or sender names on the loading screen.
      expect(rec.texts.length).toBeGreaterThan(0);
      const { bodies, senders } = await inApp(page, (app) => {
        const convo = new Set([...app.contacts.values()].flatMap((c) => [c.name, c.title, c.addr]).filter(Boolean));
        return {
          bodies: [...new Set(app.msgs.map((m) => m.b).filter((b) => b && b.length >= 12))],
          senders: [...new Set(app.msgs.map((m) => m.sn).filter((n) => n && !convo.has(n) && ![...convo].some((c) => c.includes(n))))],
        };
      });
      const all = rec.texts.join('\n');
      expect(bodies.filter((b) => all.includes(b)), 'AC11 message text').toEqual([]);
      expect(senders.filter((n) => all.includes(n)), 'AC11 sender names').toEqual([]);

      // AC12: the live region changes only when the step does.
      expect(rec.stepWrites, 'AC12').toBe(rec.steps.length);
      for (let i = 1; i < rec.steps.length; i++) expect(rec.steps[i], 'AC12').not.toBe(rec.steps[i - 1]);
      // Files of different apps are read at once (R7): each changes the line as it starts and as it ends.
      expect(rec.steps.length, 'AC12').toBeLessThanOrEqual(6 + 2 * snap.files.length);
      await expect(page.locator('#loadStep')).toHaveAttribute('aria-live', 'polite');

      // AC15: the screen draws at most once per animation frame.
      expect(await inApp(page, (app) => app.loadDraws), 'AC15 draws').toBeGreaterThan(0);
      expect(rec.framesWithDraws, 'AC15 frames that drew').toBeGreaterThan(0);
      expect(rec.maxDrawsPerFrame, 'AC15 draws in any one frame').toBe(1);
    });

    test('AC13: with reduced motion nothing on the loading screen animates', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await loadDemoRecorded(page);
      expect((await recorded(page)).anims).toBe(0);
    });

    for (const colorScheme of ['light', 'dark']) {
      test(`AC14: no sideways scroll at 360px (${colorScheme})`, async ({ page }) => {
        await page.emulateMedia({ colorScheme });
        await page.setViewportSize({ width: 360, height: 800 });
        await loadDemoRecorded(page);
        const rec = await recorded(page);
        expect(rec.texts.length).toBeGreaterThan(0);
        expect(rec.maxScroll).toBeLessThanOrEqual(0);
      });
    }

  });

  test('AC16: SMS conversation names show while the file is still being read, 8 at most', async ({ page }) => {
    await record(page);
    await loadFiles(page, sms(60_000)); // batches of 5,000: names arrive with the first
    const rec = await recorded(page);
    expect(rec.foundWhileReading).toBeGreaterThan(0);
    expect(rec.maxFound).toBeLessThanOrEqual(8);
    const logos = await page.locator('#loadFound use').evaluateAll((els) => els.map((e) => e.getAttribute('href')));
    expect(logos.length).toBe(8);
    expect(new Set(logos)).toEqual(new Set(['#logo-sms']));
  });

  for (const [label, name] of [
    ['with spaces', 'The Extremely Long Group Chat Name That Someone Thought Was Funny At The Time '.repeat(4)],
    ['without spaces', 'x'.repeat(400)],
  ]) {
    test(`R15: a very long conversation name (${label}) is cut short, at 360px and on desktop`, async ({ page }) => {
      await record(page);
      for (const width of [360, 1280]) {
        await page.setViewportSize({ width, height: 800 });
        await loadFiles(page, smsBackup([{ address: '+15551234567', name, at: '2024-08-19T09:00:00Z', body: 'hi' }]));
        const rec = await recorded(page);
        expect(rec.maxChip, `chip width at ${width}px`).toBeGreaterThan(0);
        expect(rec.maxChip, `chip width at ${width}px`).toBeLessThanOrEqual(240);
        expect(rec.chipOverflow, `past the list's edge at ${width}px`).toBeLessThanOrEqual(0);
        expect(rec.maxScroll, `sideways scroll at ${width}px`).toBeLessThanOrEqual(0);
        await expect(page.locator('#loadFound li span')).toHaveAttribute('title', name);
      }
    });
  }

  test('AC18: different apps are read at the same time, one app\'s files in order', async ({ page }) => {
    const big = sms(30000, 'sms-big.xml');
    const small = sms(5, 'sms-small.xml'); // the same 5 messages the big one starts with
    await cores(page, 4);
    await loadFiles(page, [big, small, whatsApp()]);
    const { rows, jobs } = await inApp(page, (app) => ({
      rows: app.loadSnapshot.files.map((f) => ({ name: f.name, msgs: f.msgs })),
      jobs: Object.fromEntries(LoadPerf.last.jobs.map((j) => [j.label, { start: j.t0, end: j.t0 + j.ms }])),
    }));
    expect(rows).toEqual([
      { name: 'sms-big.xml', msgs: 30000 },
      { name: 'sms-small.xml', msgs: 0 }, // its messages are the duplicates
      { name: 'WhatsApp Chat with Sam.txt', msgs: 3 },
    ]);
    // The same app: the small backup only starts once the big one is done.
    expect(jobs['sms-small.xml'].start).toBeGreaterThanOrEqual(jobs['sms-big.xml'].end);
    // Another app: read while the big backup is.
    expect(jobs['WhatsApp Chat with Sam.txt'].start).toBeLessThan(jobs['sms-big.xml'].end);
  });

  test.describe('a file that fails', () => {
    test.use({ failOnConsoleError: false }); // the parse error is logged

    test('AC19: stops the files still being read at once', async ({ page }) => {
      const broken = { name: 'result.json', mimeType: 'application/json', buffer: Buffer.from('{oops') };
      await cores(page, 4);
      await page.goto('/');
      await page.setInputFiles('#fileInput', [sms(60000, 'sms-big.xml'), broken]);
      await expect(page.locator('#loadError, #dashErrorText').first()).toContainText(/Could not read that file: .*valid JSON/, { timeout: 60_000 });
      const jobs = await inApp(page, () => LoadPerf.last.jobs.map((j) => ({ label: j.label, done: !!j.worker })));
      // The first read of the SMS backup was stopped (its worker never reported), then it was read on its own.
      expect(jobs).toEqual([
        { label: 'sms-big.xml', done: false },
        { label: 'result.json', done: true },
        { label: 'sms-big.xml', done: true },
      ]);
      expect(await inApp(page, (app) => app.msgs.length)).toBe(60000);
    });
  });

  test('AC17: a conversation name with markup shows as text', async ({ page }) => {
    const name = '<img src=x onerror=alert(1)>';
    page.on('dialog', () => { throw new Error('a dialog opened'); });
    await loadFiles(page, smsBackup([{ address: '+15551234567', name, at: '2024-08-19T09:00:00Z', body: 'hi' }]));
    await expect(page.locator('#loadFound li')).toHaveText([name]);
    await expect(page.locator('#loadFound img')).toHaveCount(0);
  });
});
