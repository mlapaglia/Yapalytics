import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, messageLib } from '../helpers/load.mjs';

const lib = messageLib();
const { tokensOf, T_REACTION, T_LINK, TRAITS } = loadApp(['tokensOf', 'T_REACTION', 'T_LINK', 'TRAITS']);
const analyze = (body) => {
  const rec = {};
  lib.analyzeText(body, rec);
  return rec;
};
// Trait bits, as the parsers set them.
const T = lib.TRAIT;

describe('trait bits', () => {
  it('are defined once, in messageLib, and analysis.js uses those', () => {
    assert.equal(T_REACTION, T.REACTION);
    assert.equal(T_LINK, T.LINK);
    assert.deepEqual(TRAITS.map((t) => t.bit), [T.QUESTION, T.LINK, T.LAUGH, T.LOVE, T.CAPS]);
  });
});

describe('analyzeText', () => {
  it('counts characters by code point, not UTF-16 unit', () => {
    assert.equal(analyze('hi 😂').l, 4);
  });

  it('counts words, keeping contractions whole', () => {
    assert.equal(analyze("I’ve got it, don't worry").wc, 5);
  });

  it('finds emoji, counting a ZWJ family once and skipping ©/®/™ and bare digits', () => {
    assert.deepEqual(analyze('family 👩‍👩‍👧 © 1 ™ 🇺🇸 👍🏽').e, ['👩‍👩‍👧', '🇺🇸', '👍🏽']);
    assert.equal(analyze('no emoji here').e, null);
  });

  it('flags message traits', () => {
    assert.ok(analyze('are you coming?').f & T.QUESTION);
    assert.ok(analyze('see https://example.com').f & T.LINK);
    assert.ok(analyze('hahaha').f & T.LAUGH);
    assert.ok(analyze('lmao').f & T.LAUGH);
    assert.ok(analyze('😂').f & T.LAUGH);
    assert.ok(analyze('love you').f & T.LOVE);
    assert.ok(analyze('LETS GOOO').f & T.CAPS);
    assert.equal(analyze('OK').f & T.CAPS, 0, 'too short to be shouting');
    assert.equal(analyze('Hello there').f, 0);
  });

  it('counts swear words', () => {
    assert.equal(analyze('damn this shit').sw, 2);
    assert.equal(analyze('hello').sw, undefined);
  });

  it('handles an empty body', () => {
    assert.deepEqual(analyze(''), { b: '', l: 0, wc: 0, e: null, f: 0 });
  });

  it('uses the same reaction bit as analysis.js', () => {
    assert.equal(lib.T_REACTION, T_REACTION);
  });
});

describe('stampTime (UTC)', () => {
  it('derives hour, weekday, day number and month index', () => {
    const rec = { t: Date.parse('2024-08-20T13:45:00Z') }; // a Tuesday
    lib.stampTime(rec);
    assert.equal(rec.h, 13);
    assert.equal(rec.w, 2);
    assert.equal(rec.d, Math.floor(rec.t / 86400000));
    assert.equal(rec.mo, 2024 * 12 + 7);
  });
});

describe('tokensOf', () => {
  it('lowercases, keeps contractions, drops 1-letter words and numbers', () => {
    assert.deepEqual(tokensOf('I’ve GOT 2 dogs, a cat and 100 fish'), ["i've", 'got', 'dogs', 'cat', 'and', 'fish']);
  });

  it('trims stray quotes around words', () => {
    assert.deepEqual(tokensOf("'hello' world'"), ['hello', 'world']);
  });
});
