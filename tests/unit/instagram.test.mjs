import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runParser } from '../helpers/worker.mjs';
import { asFile, igMessage, looseThread, splitExport, threadOf, zippedExport, zippedHtmlExport } from '../helpers/instagram.mjs';
import { loadScripts } from '../helpers/load.mjs';

const parse = (...specs) => runParser('instagram.js', 'metaParserWorker', { files: specs.map(asFile) });
const T0 = Date.parse('2024-08-20T10:00:00Z');
const T_REACTION = 16;
const byKey = (out, k) => out.msgs.filter((m) => m.k === k).sort((a, b) => a.t - b.t);

describe('Instagram parser: zipped export', () => {
  it('keeps inbox and archived conversations and skips message requests', async () => {
    const out = await parse(zippedExport());
    assert.deepEqual(out.contacts.map((c) => c.key).sort(), ['g:ig:roadtrip_2222', 'ig:alexrivera_1111', 'ig:samPatel_3333']);
    assert.equal(out.counts.skippedChats, 1);
    assert.ok(out.msgs.every((m) => m.s === 5 && m.o === 0), 'the page sets o from the owner');
  });

  it('merges message_1.json and message_2.json into one conversation', async () => {
    const out = await parse(zippedExport());
    assert.equal(out.contacts.filter((c) => c.key === 'ig:alexrivera_1111').length, 1);
    assert.equal(byKey(out, 'ig:alexrivera_1111').length, 7);
    assert.deepEqual(byKey(out, 'ig:alexrivera_1111').map((m) => (m.t - T0) / 1000), [60, 120, 180, 240, 300, 540, 600]);
  });

  it('decodes the text Meta writes as escaped UTF-8 bytes', async () => {
    const out = await parse(zippedExport());
    assert.ok(out.msgs.some((m) => m.b === 'café later? ☕️'));
    assert.equal(out.contacts.find((c) => c.group).name, 'Road Trip 🚗');
    const m = out.msgs.find((x) => x.b && x.b.startsWith('hey'));
    assert.deepEqual(m.e, ['😂']);
    assert.ok(m.f & 2, 'link');
    assert.ok(m.f & 4, 'laugh');
  });

  it('knows who you are from personal_information.json', async () => {
    const out = await parse(zippedExport());
    for (const c of out.contacts) assert.equal(c.owner, 'Jamie Park', c.key);
  });

  it('skips calls, group notices and empty messages, and flags likes as reactions', async () => {
    const out = await parse(zippedExport());
    assert.equal(out.counts.skipped, 5);
    const alex = byKey(out, 'ig:alexrivera_1111');
    assert.deepEqual(alex.filter((m) => m.f & T_REACTION).map((m) => m.b), ['Reacted 😂 to your message ', 'Liked a message']);
    assert.equal(out.counts.reactions, 2);
    assert.deepEqual(byKey(out, 'g:ig:roadtrip_2222').map((m) => m.b), ['me', 'who is driving?']);
  });

  it('counts photos and videos, and links the files in the zip', async () => {
    const alex = byKey(await parse(zippedExport()), 'ig:alexrivera_1111');
    const photos = alex.find((m) => m.ph);
    assert.equal(photos.ph, 2);
    assert.deepEqual(photos.att.map((a) => [a.n, a.k, a.z]), [['1801_1.jpg', 'ph', 0], ['1801_2.jpg', 'ph', 0]]);
    assert.ok(photos.mb > 0, 'attachment bytes are counted');
    const video = alex.find((m) => m.vd);
    assert.equal(video.att, undefined, 'the video is not in the zip');
  });

  it('names group senders and lists members', async () => {
    const out = await parse(zippedExport());
    const group = out.contacts.find((c) => c.key === 'g:ig:roadtrip_2222');
    assert.equal(group.group, true);
    assert.deepEqual(group.members.map(([n]) => n).sort(), ['Jamie Park', 'Sam Patel']);
  });

  it('finds photos in another part of a split export', async () => {
    const [part1, part2] = splitExport();
    const out = await parse(part1, part2);
    const photos = byKey(out, 'ig:alexrivera_1111').find((m) => m.ph);
    assert.deepEqual(photos.att.map((a) => [a.n, a.z]), [['1801_1.jpg', 1]], 'the second photo is in neither part');
    assert.equal(photos.ph, 2);
    assert.equal(out.contacts[0].owner, 'Jamie Park');
  });
});

describe('Instagram parser: what it can and cannot tell', () => {
  it('reads a message_1.json on its own, without attachments or an owner', async () => {
    const out = await parse(looseThread());
    assert.deepEqual(out.contacts.map((c) => [c.key, c.owner]), [['ig:alexrivera_1111', undefined]]);
    assert.equal(out.msgs.length, 3);
    assert.ok(out.msgs.every((m) => !m.att));
  });

  it('explains that the HTML export needs to be redone as JSON', async () => {
    await assert.rejects(parse(zippedHtmlExport()), /HTML export.*JSON/);
  });

  it('rejects files that are not Instagram exports', async () => {
    await assert.rejects(parse({ name: 'message_1.json', mimeType: 'application/json', buffer: Buffer.from('{oops') }), /isn't valid JSON/);
    await assert.rejects(parse({ name: 'message_1.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":1}') }), /doesn't look like an Instagram export/);
  });
});

describe('spec 004 Instagram shared posts: parser', () => {
  const reel = { link: 'https://www.instagram.com/reel/DesZwLVvHS6/?id=401_744', share_text: 'whatever makes her sleep??😅😅 so happy', original_content_owner: 'kianna.johnson' };

  it('AC1: keeps the link, caption and creator of a shared reel, and it is not a file', async () => {
    const out = await parse(threadOf(igMessage(0, 'Alex', { content: 'Alex sent an attachment.', share: reel })));
    assert.equal(out.msgs.length, 1, 'a share on its own is a message');
    const [m] = out.msgs;
    assert.deepEqual(m.sh, { u: reel.link, x: reel.share_text, w: reel.original_content_owner });
    assert.equal(m.b, '', 'the "sent an attachment." placeholder is not text');
    assert.equal(m.ot, 0);
  });

  it('AC1: the zipped export\'s shared reel', async () => {
    const share = byKey(await parse(zippedExport()), 'ig:alexrivera_1111').find((m) => m.sh);
    assert.deepEqual(share.sh, { u: 'https://www.instagram.com/reel/abc/?id=1_2', x: 'so true lol', w: 'tacotuesday' });
    assert.equal(share.ot, 0);
  });

  it('AC2: a link that is not http(s) is dropped, the caption is kept', async () => {
    const out = await parse(threadOf(
      igMessage(0, 'Alex', { content: 'Alex sent an attachment.', share: { link: 'javascript:alert(1)', share_text: 'look' } }),
      igMessage(60, 'Alex', { content: 'Alex sent an attachment.', share: { link: 'javascript:alert(1)' } }),
    ));
    assert.deepEqual(out.msgs.map((m) => m.sh), [{ u: '', x: 'look', w: '' }], 'a share with nothing left to show is skipped');
  });

  it('AC14: a shared profile keeps its username and display name', async () => {
    const out = await parse(threadOf(igMessage(0, 'Alex', {
      content: 'Alex sent an attachment.',
      share: { link: 'https://www.instagram.com/tacotuesday', profile_share_username: 'tacotuesday', profile_share_name: 'Taco Tuesday 🌮' },
    })));
    assert.deepEqual(out.msgs[0].sh, { u: 'https://www.instagram.com/tacotuesday', x: 'Taco Tuesday 🌮', w: 'tacotuesday' });
  });

  it('AC5: the caption is not counted as the sender\'s words, emoji or mood', async () => {
    const out = await runParser('instagram.js', 'metaParserWorker', { files: [asFile(threadOf(igMessage(0, 'Alex', { content: 'Alex sent an attachment.', share: reel })))] }, { vader: true });
    const [m] = out.msgs;
    assert.equal(m.wc, 0);
    assert.equal(m.e, null);
    assert.equal(m.v, undefined);
  });
});

describe('spec 004 Instagram shared posts: embed links', () => {
  const { instagramEmbedUrl } = loadScripts(['media.js'], ['instagramEmbedUrl']);

  it('AC3: maps post and reel links to their embed page, and nothing else', () => {
    assert.equal(instagramEmbedUrl('https://www.instagram.com/reel/DesZwLVvHS6/?id=4011694629953762490_744472028'), 'https://www.instagram.com/reel/DesZwLVvHS6/embed/');
    assert.equal(instagramEmbedUrl('https://instagram.com/reels/Abc_-1'), 'https://www.instagram.com/reel/Abc_-1/embed/');
    assert.equal(instagramEmbedUrl('https://www.instagram.com/p/C0de/'), 'https://www.instagram.com/p/C0de/embed/');
    assert.equal(instagramEmbedUrl('http://www.instagram.com/tv/XyZ/'), 'https://www.instagram.com/tv/XyZ/embed/');
    assert.equal(instagramEmbedUrl('https://www.instagram.com/stories/someone/123/'), null);
    assert.equal(instagramEmbedUrl('https://www.instagram.com/kianna.johnson/'), null);
    assert.equal(instagramEmbedUrl('https://evil.example/reel/abc/'), null);
    assert.equal(instagramEmbedUrl('https://instagram.com.evil.example/reel/abc/'), null);
    assert.equal(instagramEmbedUrl('javascript:alert(1)'), null);
    assert.equal(instagramEmbedUrl(''), null);
  });
});

describe('spec 004 reactions on Instagram messages', () => {
  it('AC10: keeps who reacted with what, merged by emoji, and they are not messages', async () => {
    const out = await parse(zippedExport());
    const alex = byKey(out, 'ig:alexrivera_1111');
    assert.equal(alex.length, 7, 'reactions on messages are not messages');
    const cafe = alex.find((m) => m.b === 'café later? ☕️');
    assert.deepEqual(cafe.rx, [{ r: '❤️', c: 2, n: ['Alex Rivera', 'Jamie Park'] }, { r: '😮', c: 1, n: ['Alex Rivera'] }]);
    assert.deepEqual(alex.find((m) => m.sh).rx, [{ r: '😂', c: 1, n: ['Jamie Park'] }]);
    assert.equal(alex.filter((m) => m.rx).length, 2);
  });
});
