import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadScripts } from '../helpers/load.mjs';

const { normName, normPhone, identityTokens, suggestLinks, defaultPersonName, linkSignature } = loadScripts(
  ['people.js'],
  ['normName', 'normPhone', 'identityTokens', 'suggestLinks', 'defaultPersonName', 'linkSignature'],
);

// Conversations as the parsers describe them (only the fields matching reads).
const sms = (key, name, addr) => ({ key, s: 0, name, addr, group: false });
const ig = (key, name) => ({ key, s: 5, name, title: name, addr: '', group: false });
const wa = (key, name) => ({ key, s: 2, name, title: name, addr: '', group: false });
const gchat = (key, name, email) => ({ key, s: 1, name, addr: email, group: false });

describe('spec 005 linked people: matching', () => {
  it('normalizes names and phone numbers', () => {
    assert.equal(normName('  Álex   RIVERA '), 'alex rivera');
    assert.equal(normPhone('+1 (555) 123-4567'), '5551234567');
    assert.equal(normPhone('5551234567'), '5551234567');
    assert.equal(normPhone('+44 7700 900123'), normPhone('07700 900123'));
    assert.equal(normPhone('123'), '', 'too short to be a number');
    assert.equal(normPhone('Alex 555'), '', 'not only a number');
  });

  it('reads names, numbers and emails, but not placeholders or your own name', () => {
    assert.deepEqual(identityTokens(sms('55512345', 'Alex Rivera', '+1 555-123-4567')), ['n:alex rivera', 'p:5551234567']);
    assert.deepEqual(identityTokens(gchat('gc:1', 'Alex Rivera', 'Alex@Example.com')), ['n:alex rivera', 'e:alex@example.com']);
    assert.deepEqual(identityTokens(ig('ig:1', 'Instagram User')), []);
    assert.deepEqual(identityTokens(wa('wa:me', 'Jamie Park'), ['Jamie Park']), []);
    // The other apps' addr lists senders, which includes you: it isn't read.
    assert.deepEqual(identityTokens({ ...wa('wa:alex', 'Alex Rivera'), addr: 'Alex Rivera~Jamie Park' }), ['n:alex rivera']);
  });

  it('AC1: suggests the same name on SMS and Instagram', () => {
    const out = suggestLinks([sms('55512345', 'Alex Rivera', '+15551234567'), ig('ig:alex_1', 'alex rivera'), ig('ig:sam_2', 'Sam Patel')]);
    assert.deepEqual(out, [{ keys: ['55512345', 'ig:alex_1'], reasons: ['name'] }]);
  });

  it('AC3: suggests the same phone number however it is written', () => {
    const out = suggestLinks([sms('51234567', '', '+1 (555) 123-4567'), wa('wa:+1 555 123 4567', '+1 555 123 4567')]);
    assert.deepEqual(out, [{ keys: ['51234567', 'wa:+1 555 123 4567'], reasons: ['phone'] }]);
  });

  it('AC4: a name two conversations on one app share is ambiguous', () => {
    const out = suggestLinks([ig('ig:chris_1', 'Chris'), ig('ig:chris_2', 'Chris'), sms('11111111', 'Chris', '+15550000001')]);
    assert.deepEqual(out, []);
  });

  it('chains matches: a name links SMS to Instagram, a number links SMS to WhatsApp', () => {
    const out = suggestLinks([
      sms('51234567', 'Alex Rivera', '+15551234567'),
      ig('ig:alex_1', 'Alex Rivera'),
      wa('wa:+1 555 123 4567', '+1 555 123 4567'),
    ]);
    assert.deepEqual(out, [{ keys: ['51234567', 'ig:alex_1', 'wa:+1 555 123 4567'], reasons: ['name', 'phone'] }]);
  });

  it('leaves out groups already one person, and dismissed groups', () => {
    const threads = [sms('51234567', 'Alex Rivera', '+15551234567'), ig('ig:alex_1', 'Alex Rivera')];
    const personOf = new Map([['51234567', 'p:51234567'], ['ig:alex_1', 'p:51234567']]);
    assert.deepEqual(suggestLinks(threads, { personOf }), []);
    assert.deepEqual(suggestLinks(threads, { dismissed: new Set([linkSignature(['ig:alex_1', '51234567'])]) }), []);
    // One of them in a person, the other not: still worth suggesting (it joins that person).
    assert.equal(suggestLinks(threads, { personOf: new Map([['51234567', 'p:x']]) }).length, 1);
  });

  it('skips your own name on each app', () => {
    const threads = [wa('wa:jamie', 'Jamie Park'), ig('ig:jamie_1', 'Jamie Park')];
    assert.deepEqual(suggestLinks(threads, { ownNames: () => ['Jamie Park'] }), []);
  });
});

describe('spec 005 linked people: names', () => {
  it('AC14: a contact-book name wins over an Instagram handle and a number', () => {
    assert.equal(defaultPersonName([
      { s: 5, name: 'alexr.99', n: 900 },
      { s: 2, name: '+1 555 123 4567', n: 50 },
      { s: 0, name: 'Alex Rivera', n: 10 },
    ]), 'Alex Rivera');
  });

  it('falls back to the busier conversation, then to a number', () => {
    assert.equal(defaultPersonName([{ s: 5, name: 'alex_a', n: 3 }, { s: 5, name: 'alex_b', n: 30 }]), 'alex_b');
    assert.equal(defaultPersonName([{ s: 0, name: '(555) 123-4567', n: 3 }, { s: 5, name: 'Instagram User', n: 1 }]), '(555) 123-4567');
  });
});

describe('spec 009 Messenger in linked people', () => {
  const fb = (key, name) => ({ key, s: 6, name, title: name, addr: '', group: false });

  it('AC15: a Facebook export chat and an encrypted chat with one name link with Instagram', () => {
    const out = suggestLinks([ig('ig:alex_1', 'Alex Rivera'), fb('fb:alexrivera_1111', 'Alex Rivera'), fb('fb:e2ee:Alex Rivera_6', 'Alex Rivera')]);
    assert.deepEqual(out, [{ keys: ['fb:alexrivera_1111', 'fb:e2ee:Alex Rivera_6', 'ig:alex_1'], reasons: ['name'] }]);
  });

  it('AC15: two Facebook export chats with one name are still ambiguous, and so are two encrypted ones', () => {
    assert.deepEqual(suggestLinks([ig('ig:alex_1', 'Alex Rivera'), fb('fb:alex_1', 'Alex Rivera'), fb('fb:alex_2', 'Alex Rivera')]), []);
    assert.deepEqual(suggestLinks([ig('ig:alex_1', 'Alex Rivera'), fb('fb:e2ee:Alex Rivera_1', 'Alex Rivera'), fb('fb:e2ee:Alex Rivera_2', 'Alex Rivera')]), []);
  });

  it('R10: a default name comes from Messenger after Instagram, and "Facebook user" is not a name', () => {
    assert.equal(defaultPersonName([{ s: 6, name: 'Alex R', n: 900 }, { s: 5, name: 'alexr.99', n: 10 }]), 'alexr.99');
    assert.deepEqual(identityTokens(fb('fb:x', 'Facebook user')), []);
  });
});
