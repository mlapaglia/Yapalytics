import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runParser, sentAs } from '../helpers/worker.mjs';
import { asFile, metaJson } from '../helpers/instagram.mjs';
import {
  ALEX, ALEX_MEDIA, ME, alexEncrypted, e2eeMessage, encryptedExport, encryptedThread, facebookExport,
  facebookHtmlExport, fbMessage, splitFacebookExport,
} from '../helpers/messenger.mjs';

const parse = (...specs) => runParser('instagram.js', 'metaParserWorker', { files: specs.map(asFile), app: 'messenger' });
const T0 = Date.parse('2024-08-20T10:00:00Z');
const T_REACTION = 16;
const byKey = (out, k) => out.msgs.filter((m) => m.k === k).sort((a, b) => a.t - b.t);
const ALEX_DYI = 'fb:alexrivera_1111';
const ALEX_E2EE = `fb:e2ee:${ALEX}_6`;

describe('spec 009 Messenger: Facebook DYI export', () => {
  it('AC1: keeps inbox, archived and e2ee_cutover threads, and skips requests and filtered ones', async () => {
    const out = await parse(facebookExport());
    assert.deepEqual(out.contacts.map((c) => c.key).sort(), [ALEX_DYI, 'fb:samPatel_3333', 'g:fb:roadtrip_2222']);
    assert.equal(out.counts.skippedChats, 2);
    assert.ok(out.msgs.every((m) => m.s === 6 && m.o === 0), 'source 6; the page sets o from the owner');
    const group = out.contacts.find((c) => c.group);
    assert.equal(group.name, 'Road Trip 🚗');
    assert.deepEqual(group.members.map(([n]) => n).sort(), [ME, 'Sam Patel']);
  });

  it('AC2: finds a photo in another part of a split export', async () => {
    const [part1, part2] = splitFacebookExport();
    const out = await parse(part1, part2);
    const photo = byKey(out, ALEX_DYI).find((m) => m.ph);
    assert.equal(photo.ph, 1);
    assert.deepEqual(photo.att.map((a) => [a.n, a.k, a.z]), [['2201.jpg', 'ph', 1]]);
    assert.ok(photo.mb > 0);
    assert.equal(out.contacts[0].owner, ME);
  });

  it('AC4: leaves out calls, notices, unsent messages and bare placeholders; keeps a share; flags reactions', async () => {
    const out = await parse(facebookExport());
    const alex = byKey(out, ALEX_DYI);
    assert.deepEqual(alex.map((m) => (m.t - T0) / 1000), [0, 60, 120, 180, 420]);
    const share = alex.find((m) => m.sh);
    assert.deepEqual(share.sh, { u: 'https://example.com/recipe', x: '', w: '' });
    assert.equal(share.b, '', 'the placeholder is not text');
    assert.equal(alex.find((m) => m.ph).b, '', '"sent a photo." is not text');
    assert.deepEqual(alex.filter((m) => m.f & T_REACTION).map((m) => m.b), ['Reacted 😂 to your message ']);
    assert.deepEqual(byKey(out, 'g:fb:roadtrip_2222').map((m) => m.b), ['me', 'who is driving?']);
    assert.deepEqual(alex.find((m) => m.rx).rx, [{ r: '❤️', c: 1, n: [ALEX] }]);
  });

  it('AC5: decodes the escaped UTF-8 Facebook writes', async () => {
    const out = await parse(facebookExport());
    assert.ok(out.msgs.some((m) => m.b === 'café later? ☕️'));
    assert.deepEqual(out.msgs.find((m) => m.b === 'hey!! 😂').e, ['😂']);
  });

  it('AC6: knows who you are from profile_information.json', async () => {
    const out = await parse(facebookExport());
    for (const c of out.contacts) assert.equal(c.owner, ME, c.key);
  });

  it('AC1, AC10: a thread_path written from the export root still finds its folder', async () => {
    const thread = (path) => ({ name: 'message_1.json', mimeType: 'application/json', buffer: Buffer.from(metaJson({ participants: [{ name: ALEX }, { name: ME }], title: ALEX, thread_path: path, messages: [fbMessage(0, ALEX, { content: 'hi' })] })) });
    const kept = await parse(thread('your_facebook_activity/messages/inbox/alexrivera_1111'));
    assert.deepEqual(kept.contacts.map((c) => c.key), [ALEX_DYI]);
    assert.equal(kept.msgs.length, 1);
    const skipped = await parse(thread('your_facebook_activity/messages/message_requests/spam_4444'));
    assert.deepEqual([skipped.contacts.length, skipped.counts.skippedChats], [0, 1]);
  });

  it('AC8: explains that the HTML export needs to be redone as JSON', async () => {
    await assert.rejects(parse(facebookHtmlExport()), /Facebook's HTML export.*JSON/);
  });

  it('rejects a zip with no Messenger messages in it', async () => {
    await assert.rejects(parse({ name: 'photos.zip', mimeType: 'application/zip', buffer: (await import('../helpers/zip.mjs')).makeZip([{ name: 'a.jpg', data: 'x' }]) }), /no Messenger messages/);
  });

  it('AC6: picking another name under You on Messenger swaps sent and received', async () => {
    const out = await parse(facebookExport());
    assert.equal(sentAs(out, 6, 'Alex Rivera'), 3);
  });
});

describe('spec 009 Messenger: encrypted chats download', () => {
  it('AC3: a thread file loads as one conversation keyed by its threadName, without the unsent message', async () => {
    const out = await parse(encryptedThread());
    assert.deepEqual(out.contacts.map((c) => [c.key, c.group, c.s]), [[ALEX_E2EE, false, 6]]);
    const msgs = byKey(out, ALEX_E2EE);
    assert.equal(msgs.length, 7);
    assert.deepEqual([...new Set(msgs.map((m) => m.sn))].sort(), [ALEX, ME]);
    assert.ok(!msgs.some((m) => m.b === 'never mind'), 'unsent');
    const reacted = msgs.find((m) => m.rx);
    assert.equal(reacted.b, 'wait what? lol');
    assert.deepEqual(reacted.rx, [{ r: '😆', c: 1, n: [ALEX] }]);
    assert.equal(msgs.filter((m) => m.rx).length, 1);
  });

  it('AC5: leaves its text alone, since it is already proper UTF-8', async () => {
    const out = await parse(encryptedThread());
    assert.ok(out.msgs.some((m) => m.b === 'café 😃'));
    assert.ok(out.msgs.some((m) => m.b === 'I’m with you'));
  });

  it('AC14: a media message in the zip is a photo that can be opened; from the .json alone it is only counted', async () => {
    const zipped = byKey(await parse(encryptedExport()), ALEX_E2EE).find((m) => m.ph);
    assert.equal(zipped.ph, 1);
    assert.equal(zipped.b, '');
    assert.deepEqual(zipped.att.map((a) => [a.n, a.k, a.p]), [[ALEX_MEDIA.slice(6), 'ph', ALEX_MEDIA]]);
    assert.ok(zipped.mb > 0);
    const alone = byKey(await parse(encryptedThread()), ALEX_E2EE).find((m) => m.ph);
    assert.equal(alone.ph, 1);
    assert.equal(alone.att, undefined);
  });

  it('AC14: media kinds come from the file extension', async () => {
    const out = await parse(encryptedThread({
      participants: [ME, ALEX],
      threadName: `${ALEX}_6`,
      messages: [
        e2eeMessage(0, ALEX, { media: [{ uri: './media/a.mp4' }], type: 'media' }),
        e2eeMessage(1, ALEX, { media: [{ uri: './media/b.gif' }, { uri: './media/c.m4a' }], type: 'media' }),
        e2eeMessage(2, ALEX, { media: [{ uri: './media/d.pdf' }], type: 'media' }),
      ],
    }));
    const kinds = out.msgs.sort((a, b) => a.t - b.t).map((m) => ['ph', 'gf', 'vd', 'au', 'ot'].filter((k) => m[k]).join(','));
    assert.deepEqual(kinds, ['vd', 'gf,au', 'ot']);
  });

  it('R2: the download can keep its chats in a folder, even one called messages/', async () => {
    const out = await parse(encryptedExport('messages/'));
    assert.deepEqual(out.contacts.map((c) => c.key).sort(), [ALEX_E2EE, 'fb:e2ee:Sam Patel_2']);
    assert.deepEqual(byKey(out, ALEX_E2EE).find((m) => m.ph).att.map((a) => a.p), [`messages/${ALEX_MEDIA}`]);
  });

  it('R2: a zip of .json files that are not chats has no Messenger messages', async () => {
    const { makeZip } = await import('../helpers/zip.mjs');
    await assert.rejects(parse({ name: 'notes.zip', mimeType: 'application/zip', buffer: makeZip([{ name: 'notes.json', data: '{"a":1}' }]) }), /notes\.zip has no Messenger messages/);
  });

  it('AC18: is named after the other person, without the number', async () => {
    const out = await parse(encryptedThread());
    assert.equal(out.contacts[0].name, ALEX);
    assert.equal(out.contacts[0].title, ALEX);
  });

  it('AC12: everyone in the chat is a member, even with nothing sent, so you can be told apart', async () => {
    const out = await parse(encryptedThread({ participants: [ME, ALEX], threadName: `${ALEX}_6`, messages: [e2eeMessage(0, ALEX, { text: 'you there?' })] }));
    assert.deepEqual(Object.fromEntries(out.contacts[0].members), { [ME]: 0, [ALEX]: 1 });
    assert.equal(out.msgs.length, 1, 'no messages are added');
  });

  it('AC12: both threads of the zip are read, and each names its other person', async () => {
    const out = await parse(encryptedExport());
    assert.deepEqual(out.contacts.map((c) => [c.key, c.name]).sort(), [[ALEX_E2EE, ALEX], ['fb:e2ee:Sam Patel_2', 'Sam Patel']]);
  });

  it('AC7: a DYI export and an encrypted download together keep their own keys', async () => {
    const out = await parse(facebookExport(), encryptedExport());
    const keys = out.contacts.map((c) => c.key);
    assert.ok(keys.includes(ALEX_DYI) && keys.includes(ALEX_E2EE));
    assert.equal(out.contacts.find((c) => c.key === ALEX_E2EE).owner, ME, 'the profile names you in both');
  });

  it('a DYI thread in the same run still has its text decoded', async () => {
    const dyi = { name: 'message_1.json', mimeType: 'application/json', buffer: Buffer.from(metaJson({ participants: [{ name: ALEX }, { name: ME }], title: ALEX, thread_path: 'inbox/alex_1', messages: [fbMessage(0, ALEX, { content: 'crème brûlée' })] })) };
    const out = await parse(dyi, encryptedThread());
    assert.ok(out.msgs.some((m) => m.b === 'crème brûlée'));
    assert.equal(alexEncrypted().messages.length, 8);
  });
});
