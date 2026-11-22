import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from '../helpers/load.mjs';

const { vaderLib, messageLib } = loadApp(['vaderLib', 'messageLib']);
const vader = vaderLib();
const lib = messageLib(vader);
const scored = (body) => {
  const rec = {};
  lib.analyzeText(body, rec);
  return rec.v;
};
const word = (e, w) => e.words.find((x) => x.word === w);

describe('VADER explain()', () => {
  const texts = [
    'I love this so much!!',
    'this is not good',
    'The food was good but the service was terrible',
    'I am VERY HAPPY today',
    'meh',
    'kind of sad, honestly',
    'what?? why would you do that???',
    'never been better',
  ];

  it('gives the same compound score as polarityScores', () => {
    for (const t of texts) assert.equal(vader.explain(t).compound, vader.polarityScores(t).compound, t);
  });

  it('has one entry per word, with valences after modifiers', () => {
    const e = vader.explain('this is not good');
    assert.deepEqual(e.words.map((w) => w.word), ['this', 'is', 'not', 'good']);
    const good = word(e, 'good');
    assert.equal(good.lexicon, 1.9);
    assert.ok(good.valence < 0, '"not" flips "good"');
  });

  it('weights words after "but" more than those before', () => {
    const e = vader.explain('The food was good but the service was terrible');
    assert.equal(word(e, 'good').valence, word(e, 'good').lexicon * 0.5);
    assert.equal(word(e, 'terrible').valence, word(e, 'terrible').lexicon * 1.5);
  });

  it('reports the push from exclamation marks in the direction of the text', () => {
    assert.ok(vader.explain('I love this so much!!').emphasis > 0);
    assert.ok(vader.explain('I hate this!!').emphasis < 0);
    assert.equal(vader.explain('I love this').emphasis, 0);
  });

  it('ignores words that only look like object properties', () => {
    assert.equal(word(vader.explain('the constructor called'), 'constructor').lexicon, 0);
  });
});

describe('explainMood', () => {
  const bodies = [
    'love you so much ❤️',
    'not great tbh',
    'this traffic is the worst 😡',
    'no way 😂😂',
    'ok',
    'sorry, rough day 😞',
    'LETS GOOO 🎉',
  ];

  it('matches the score stored on the message', () => {
    for (const b of bodies) {
      const e = lib.explainMood(b);
      assert.equal(e ? e.score : undefined, scored(b), b);
    }
  });

  it('shows emoji that counted as themselves', () => {
    const e = lib.explainMood('no way 😂😂');
    assert.deepEqual(e.words.map((w) => w.word), ['no', '😂', '😂']);
    assert.ok(word(e, '😂').valence > 0);
  });

  it('tells a typed word from the same word an emoji stands for', () => {
    assert.deepEqual(lib.explainMood('lol 😂 ok').words.map((w) => w.word), ['lol', '😂', 'ok']);
    assert.deepEqual(lib.explainMood('hi😂, lol').words.map((w) => w.word), ['😂', 'lol']);
  });

  it('lists only the words that moved the score', () => {
    const e = lib.explainMood('not great tbh');
    assert.deepEqual(e.words.map((w) => w.word), ['great']);
    assert.equal(e.words[0].lexicon, 3.1);
    assert.ok(e.words[0].valence < 0);
  });

  it('has nothing to explain without words', () => {
    assert.equal(lib.explainMood('👍🏽'), null);
    assert.equal(lib.explainMood(''), null);
    assert.equal(messageLib(null).explainMood('love it'), null, 'no VADER, no score');
  });
});
