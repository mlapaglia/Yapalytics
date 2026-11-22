import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadApp, loadScripts, makeMessage, messageLib } from '../helpers/load.mjs';

const { createDataset } = loadApp(['createDataset']);
const lib = messageLib();

// An Instagram chat between Alex and Jamie (records name their sender), and an SMS one with Alex.
const ig = (at, sn, body, extra = {}) => makeMessage(lib, { at, s: 5, k: 'ig:alex_1', sn, body, ...extra });
const sms = (at, o, body) => makeMessage(lib, { at, s: 0, k: '5551234', o, body });
const IG_CHAT = { key: 'ig:alex_1', name: 'Alex', title: 'Alex', addr: 'Alex~Jamie', group: false, lastT: 0, s: 5, members: [['Alex', 2], ['Jamie', 1]] };
const SMS_CHAT = { key: '5551234', name: 'Alex', addr: '+1 555 1234', group: false, lastT: 0, s: 0, members: [] };
const OWNERS = { 2: { name: '' }, 3: { name: '' }, 4: { name: '' }, 5: { name: 'Jamie' }, 6: { name: '' } };

/** The two overlapping exports: the second has the shared message's photo and another reaction. */
function exportsOf() {
  const first = [
    ig('2024-03-01T10:00:00Z', 'Alex', 'hi'),
    ig('2024-03-01T10:01:00Z', 'Jamie', 'hey', { rx: [{ r: '❤️', c: 1, n: ['Alex'] }] }),
  ];
  const second = [
    ig('2024-03-01T10:01:00Z', 'Jamie', 'hey', { rx: [{ r: '😂', c: 1, n: ['Sam'] }], att: [{ n: 'p.jpg', k: 'ph', z: 0 }], mb: 10 }),
    ig('2024-03-01T10:02:00Z', 'Alex', 'Loved “hey”'), // a reaction sent as text
    ig('2024-03-01T10:03:00Z', 'Alex', 'bye'),
  ];
  return { first, second };
}

describe('spec 014 dataset', () => {
  it('AC8: overlapping exports keep each message once, merge reactions, and keep the copy that has attachments, in either order', () => {
    for (const order of ['first, second', 'second, first']) {
      const { first, second } = exportsOf();
      const D = createDataset();
      const base = D.archive(['a.zip']) + D.archive(['b.zip']); // the second export's files start at 1
      const batches = order === 'first, second' ? [[first, 0], [second, base]] : [[second, base], [first, 0]];
      for (const [msgs, attBase] of batches) D.addBatch(msgs, [], attBase);
      D.finish();
      assert.deepEqual(D.msgs.map((m) => m.b), ['hi', 'hey', 'bye'], order);
      const hey = D.msgs[1];
      assert.deepEqual(hey.rx.map((x) => x.r).sort(), ['❤️', '😂'], order);
      assert.equal(hey.att.length, 1, order);
      assert.equal(hey.att[0].z, 1, `${order}: the attachment points at the second export's file`);
      assert.equal(D.reactions, 1, order);
    }
  });

  it('merges a conversation read from two exports: newest name, every member', () => {
    const D = createDataset();
    D.addContacts([{ ...IG_CHAT, name: 'Alex R', lastT: 1, members: [['Alex', 2], ['Jamie', 1]] }]);
    D.addContacts([{ ...IG_CHAT, name: 'Alex Rivera', lastT: 5, members: [['Alex', 3], ['Sam', 1]] }]);
    const c = D.contacts.get('ig:alex_1');
    assert.equal(c.name, 'Alex Rivera');
    assert.deepEqual(c.members, [['Alex', 3], ['Jamie', 1], ['Sam', 1]]);
    assert.equal(c.addr, 'Alex~Jamie~Sam');
  });

  it('guesses the owner: a 1-on-1 named after one sender makes the other you', () => {
    const D = createDataset();
    D.addContacts([{ ...IG_CHAT }]);
    const owners = { 5: { name: '', auto: true }, 6: { name: 'Picked', auto: false } };
    D.guessOwners(owners);
    assert.equal(owners[5].name, 'Jamie');
    assert.equal(owners[6].name, 'Picked');
    assert.equal(D.ownerOrigin(5, owners[5]), 'guess');
    assert.equal(D.ownerOrigin(6, owners[6]), 'picked');
  });

  it('AC9: rederive sets sent/received and links, the same however often it runs', () => {
    const D = createDataset();
    D.addBatch([ig('2024-03-01T10:00:00Z', 'Alex', 'hi'), ig('2024-03-01T10:01:00Z', 'Jamie', 'hey'), sms('2024-02-01T09:00:00Z', 0, 'text me')], []);
    D.addContacts([{ ...IG_CHAT }, { ...SMS_CHAT }]);
    D.finish();
    const people = new Map([['p:5551234', { key: 'p:5551234', name: '', threads: ['5551234', 'ig:alex_1'] }]]);
    const snapshot = () => ({
      msgs: D.msgs.map((m) => [m.b, m.o, m.k, m.tk]),
      person: D.contacts.get('p:5551234') && { ...D.contacts.get('p:5551234'), search: undefined },
      personOf: [...D.personOf],
      firstSeen: [...D.firstSeen],
      own: D.messagesOf('p:5551234').map((m) => m.b),
    });
    D.rederive({ owners: OWNERS, people });
    const once = snapshot();
    assert.deepEqual(once.msgs, [
      ['text me', 0, 'p:5551234', '5551234'],
      ['hi', 0, 'p:5551234', 'ig:alex_1'],
      ['hey', 1, 'p:5551234', 'ig:alex_1'],
    ]);
    assert.deepEqual(once.person.sources, [0, 5]);
    assert.equal(once.person.name, 'Alex');
    assert.deepEqual(once.own, ['text me', 'hi', 'hey']);
    assert.deepEqual(once.firstSeen, [['p:5551234', Date.parse('2024-02-01T09:00:00Z')]]);
    const v = D.version;
    D.rederive({ owners: OWNERS, people });
    assert.deepEqual(snapshot(), once);
    assert.equal(D.version, v + 1);

    // Unlinked: each message gets its own conversation back.
    D.rederive({ owners: OWNERS, people: new Map() });
    assert.deepEqual(D.msgs.map((m) => [m.k, m.tk]), [['5551234', undefined], ['ig:alex_1', undefined], ['ig:alex_1', undefined]]);
    assert.equal(D.contacts.has('p:5551234'), false);
  });

  it('searches a conversation by its names, not your own', () => {
    const D = createDataset();
    D.addContacts([{ ...IG_CHAT }]);
    D.rederive({ owners: OWNERS, people: new Map() });
    const text = D.contacts.get('ig:alex_1').search;
    assert.ok(text.includes('alex'));
    assert.ok(!text.includes('jamie'));
  });

  it('AC10: the dataset, registry, selection and settings load without a page, and never touch one', () => {
    // Each loads after what it reads as it loads (index.html's order).
    loadScripts(['sources.js', 'store.js', 'dataset.js', 'analysis.js', 'crossapp.js', 'select.js'], []);
    for (const file of ['sources.js', 'dataset.js', 'select.js', 'store.js']) {
      const src = readFileSync(new URL(`../../js/${file}`, import.meta.url), 'utf8');
      assert.doesNotMatch(src, /\bdocument\b|\bwindow\b|\$\(/, file);
      // Settings are the one thing kept in the browser's storage, and only store.js touches it.
      if (file !== 'store.js') assert.doesNotMatch(src, /localStorage/, file);
    }
  });
});
