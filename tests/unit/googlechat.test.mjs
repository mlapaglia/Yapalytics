import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runParser } from '../helpers/worker.mjs';
import { FIXTURES, takeoutWithAttachments } from '../helpers/takeout.mjs';

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
