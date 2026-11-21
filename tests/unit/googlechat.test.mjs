import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runParser } from '../helpers/worker.mjs';
import { FIXTURES, takeoutWithAttachments, takeoutChats, ME, ALEX, SAM, GIPHY } from '../helpers/takeout.mjs';

const asFile = (spec) => new File([spec.buffer], spec.name, { type: spec.mimeType });
const parse = (spec) => runParser('googlechat.js', 'googleChatParserWorker', { files: [asFile(spec)] });

describe('spec 004 reactions on Google Chat messages', () => {
  it('AC12: names reactors from the members, you as "You", and custom emoji by name', async () => {
    const out = await parse(takeoutWithAttachments([
      {
        name: 'a.jpg',
        data: FIXTURES.landscapeJpg(),
        reactions: [
          { emoji: { unicode: '👍' }, reactor_emails: ['me@example.com', 'ALEX@example.com'] },
          { emoji: { custom_emoji: { name: 'partyparrot', uid: 'x1' } }, reactor_emails: ['alex@example.com'] },
          { emoji: { unicode: '🎉' }, reactor_emails: ['stranger@example.com'] },
        ],
      },
      { name: 'b.jpg', data: FIXTURES.landscapeJpg() },
    ]));
    assert.equal(out.msgs.length, 2, 'reactions are not messages');
    const [a, b] = out.msgs.sort((x, y) => x.t - y.t);
    assert.deepEqual(a.rx, [
      { r: '👍', c: 2, n: ['You', 'Alex'] },
      { r: ':partyparrot:', c: 1, n: ['Alex'] },
      { r: '🎉', c: 1, n: ['stranger@example.com'] },
    ]);
    assert.equal(b.rx, undefined);
  });
});

describe('spec 011 bots in Google Chat conversations', () => {
  const contactFor = (out, dirKey) => out.contacts.find((c) => c.key === dirKey);

  it('AC1: a DM with one person plus GIPHY is a 1-on-1 keyed by their email', async () => {
    const out = await parse(takeoutChats([
      { dir: 'DM old1', members: [ME, ALEX, GIPHY], from: [ME, ALEX, GIPHY] },
    ]));
    const c = contactFor(out, 'gc:alex@example.com');
    assert.ok(c, `got ${out.contacts.map((x) => x.key)}`);
    assert.equal(c.group, false);
    assert.equal(c.name, 'Alex');
    assert.equal(out.msgs.length, 2, "GIPHY's message is skipped");
    assert.ok(out.msgs.every((m) => m.k === 'gc:alex@example.com' && m.sn === undefined));
  });

  it('AC2: an unnamed space with one person plus GIPHY is a 1-on-1', async () => {
    const out = await parse(takeoutChats([
      { dir: 'Space old2', members: [ME, ALEX, GIPHY], from: [ME, ALEX] },
    ]));
    assert.equal(contactFor(out, 'gc:alex@example.com')?.group, false);
  });

  it('AC3: a named space with one other person stays a group', async () => {
    const out = await parse(takeoutChats([
      { dir: 'Space team', name: 'Team', members: [ME, ALEX, GIPHY], from: [ME, ALEX] },
    ]));
    assert.equal(contactFor(out, 'g:gc:team')?.group, true);
  });

  it('AC4: a chat with two other people plus GIPHY stays a group', async () => {
    const out = await parse(takeoutChats([
      { dir: 'Space old3', members: [ME, ALEX, SAM, GIPHY], from: [ME, ALEX, SAM] },
    ]));
    const c = contactFor(out, 'g:gc:old3');
    assert.equal(c?.group, true);
    assert.equal(c.addr, 'Alex~Sam', 'GIPHY is not listed as a member');
  });

  it('AC5: the GIPHY chat and a newer DM with the same person become one conversation', async () => {
    const out = await parse(takeoutChats([
      { dir: 'DM old1', members: [ME, ALEX, GIPHY], from: [ME, ALEX] },
      { dir: 'DM new1', members: [ME, ALEX], from: [ALEX] },
    ]));
    assert.deepEqual(out.contacts.map((c) => c.key), ['gc:alex@example.com']);
    assert.equal(out.msgs.length, 3);
  });

  it('AC6: without user_info.json, a bot in every chat is not taken for you', async () => {
    const bot = { ...GIPHY, email: 'giphy@example.com' };
    const out = await parse(takeoutChats([
      { dir: 'DM old1', members: [bot, ME, ALEX], from: [ME, ALEX] },
      { dir: 'DM old2', members: [bot, ME, SAM], from: [ME, SAM] },
    ], { userInfo: false }));
    assert.deepEqual(out.contacts.map((c) => [c.key, c.group]).sort(), [['gc:alex@example.com', false], ['gc:sam@example.com', false]]);
    assert.deepEqual(out.msgs.map((m) => m.o).sort(), [0, 0, 1, 1], 'your messages are yours');
  });
});
