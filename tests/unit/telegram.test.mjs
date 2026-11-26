import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runParser } from '../helpers/worker.mjs';
import {
  asFile, fullExport, resultJson, singleChatExport, singleGroupExport,
  zippedFullExport, zippedHtmlExport, zippedSingleChatExport,
} from '../helpers/telegram.mjs';

const parse = (...specs) => runParser('telegram.js', 'telegramParserWorker', { files: specs.map(asFile) });
const T0 = Date.parse('2024-08-20T10:00:00Z');
const byKey = (out, k) => out.msgs.filter((m) => m.k === k);

describe('Telegram parser: full export', () => {
  it('keeps 1-on-1, bot and group chats (including left ones) and skips channels and Saved Messages', async () => {
    const out = await parse(resultJson(fullExport()));
    assert.deepEqual(out.contacts.map((c) => c.key).sort(), ['g:tg:4440', 'g:tg:6660', 'tg:222', 'tg:93372553']);
    assert.equal(out.counts.skippedChats, 2);
    assert.equal(out.msgs.length, 14);
    assert.ok(out.msgs.every((m) => m.s === 4 && m.o === 0), 'the page sets o from the owner');
  });

  it('knows who you are from personal_information', async () => {
    const out = await parse(resultJson(fullExport()));
    for (const c of out.contacts) assert.equal(c.owner, 'Jamie Park', c.key);
  });

  it('skips service messages and empty ones, and never counts reactions as messages', async () => {
    const out = await parse(resultJson(fullExport()));
    assert.equal(out.counts.skipped, 2);
    const alex = byKey(out, 'tg:222');
    assert.equal(alex.length, 7);
    assert.equal(alex.filter((m) => m.b === 'nice').length, 1);
  });

  it('joins text made of entities, and analyzes it', async () => {
    const out = await parse(resultJson(fullExport()));
    const m = out.msgs.find((x) => x.b && x.b.startsWith('check'));
    assert.equal(m.b, 'check https://example.com lol');
    assert.ok(m.f & 2, 'link');
    assert.ok(m.f & 4, 'laugh');
    assert.equal(m.sn, 'Alex Rivera');
  });

  it('keeps order within a second by adding milliseconds', async () => {
    const [first, second] = byKey(await parse(resultJson(fullExport())), 'tg:222');
    assert.equal(first.t, T0);
    assert.equal(second.t, T0 + 1);
    assert.equal(first.h, 10);
  });

  it('counts photos, voice messages, stickers and GIFs by kind', async () => {
    const alex = byKey(await parse(resultJson(fullExport())), 'tg:222');
    const kinds = (m) => ['ph', 'gf', 'vd', 'au', 'ot'].filter((k) => m[k]).join();
    assert.deepEqual(alex.map(kinds), ['', '', 'ph', 'au', 'ph', '', 'gf']);
    assert.equal(alex.at(-1).b, 'party time', 'a caption is the message text');
  });

  it('names group senders, including deleted accounts, and lists members', async () => {
    const out = await parse(resultJson(fullExport()));
    assert.deepEqual(byKey(out, 'g:tg:4440').map((m) => m.sn), ['Alex Rivera', 'Sam Patel', 'Jamie Park', 'Deleted Account']);
    const group = out.contacts.find((c) => c.key === 'g:tg:4440');
    assert.equal(group.group, true);
    assert.equal(group.name, 'Weekend Crew');
    assert.deepEqual(group.members.map(([n]) => n).sort(), ['Alex Rivera', 'Deleted Account', 'Jamie Park', 'Sam Patel']);
  });

  it("can't link attachments from result.json alone", async () => {
    const out = await parse(resultJson(fullExport()));
    assert.ok(out.msgs.every((m) => !m.att));
  });
});

describe('Telegram parser: zipped export folder', () => {
  it('links attachments to their files in the zip', async () => {
    const out = await parse(zippedFullExport());
    const alex = byKey(out, 'tg:222');
    const photo = alex.find((m) => m.ph && m.att && m.att[0].n.startsWith('photo_1'));
    assert.deepEqual(
      { n: photo.att[0].n, k: photo.att[0].k, z: photo.att[0].z, p: photo.att[0].p },
      { n: 'photo_1@20-08-2024_10-02-00.jpg', k: 'ph', z: 0, p: 'DataExport_2024-08-21/chats/chat_01/photos/photo_1@20-08-2024_10-02-00.jpg' },
    );
    assert.ok(photo.mb > 0, 'attachment bytes are counted');
    const sticker = alex.find((m) => m.att && m.att[0].n === 'sticker.webp');
    assert.equal(sticker.att[0].t, 'image/webp');
  });

  it('leaves files that are missing or were not exported unlinked', async () => {
    const alex = byKey(await parse(zippedFullExport()), 'tg:222');
    assert.equal(alex.find((m) => m.au).att, undefined, 'voice message was not included in the export');
    assert.equal(alex.find((m) => m.gf).att, undefined, 'GIF is not in the zip');
  });

  it('reads a single chat export, working out who you are from the chat id', async () => {
    const out = await parse(zippedSingleChatExport());
    assert.deepEqual(out.contacts.map((c) => [c.key, c.owner]), [['tg:222', 'Jamie Park']]);
    const photo = out.msgs.find((m) => m.att);
    assert.equal(photo.att[0].p, 'ChatExport_2024-08-21/photos/photo_7@20-08-2024_11-25-20.jpg');
  });

  it('merges the same chat from several exports into one conversation', async () => {
    const out = await parse(resultJson(fullExport()), zippedSingleChatExport());
    assert.equal(out.contacts.filter((c) => c.key === 'tg:222').length, 1);
    assert.equal(byKey(out, 'tg:222').length, 10);
  });
});

describe('Telegram parser: what it can and cannot tell', () => {
  it('leaves the owner open for a single group export', async () => {
    const out = await parse(resultJson(singleGroupExport()));
    assert.equal(out.contacts[0].owner, undefined);
    assert.equal(out.contacts[0].key, 'g:tg:4440');
  });

  it('explains that the HTML export needs to be redone as JSON', async () => {
    await assert.rejects(parse(zippedHtmlExport()), /HTML export.*Machine-readable JSON/);
  });

  it('rejects files that are not Telegram exports', async () => {
    await assert.rejects(parse({ name: 'result.json', mimeType: 'application/json', buffer: Buffer.from('{oops') }), /isn't valid JSON/);
    await assert.rejects(parse(resultJson({ hello: 'world' })), /doesn't look like a Telegram export/);
  });

  it('keeps a single chat export as one chat', async () => {
    const out = await parse(resultJson(singleChatExport()));
    assert.equal(out.msgs.length, 3);
    assert.equal(out.msgs[2].ph, 1);
  });
});

describe('spec 004 reactions on Telegram messages', () => {
  it('AC11: keeps emoji reactions with their count and the people listed, and skips custom emoji', async () => {
    const out = await parse(resultJson(fullExport()));
    const nice = out.msgs.find((m) => m.b === 'nice');
    // spec 027 AC8: each listed reactor keeps when they reacted (the export's local time).
    assert.deepEqual(nice.rx, [{ r: '👍', c: 3, n: ['Jamie Park'], at: [new Date(2024, 7, 20, 10, 6).getTime()] }]);
    assert.equal(out.msgs.filter((m) => m.rx).length, 1);
  });
});
