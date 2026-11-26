/*
 * The vendored VADER (js/vendor/vader.js) splits text into words faster than
 * vader-sentiment 1.1.3 did. These check that it gives the same words and scores.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from '../helpers/load.mjs';

const { vaderLib } = loadApp(['vaderLib']);
const vader = vaderLib();

// Scores from the vendored VADER before the change (vader-sentiment 1.1.3's algorithm).
const KNOWN = [
  ['VADER is smart, handsome, and funny.', 0.8316], ['VADER is smart, handsome, and funny!', 0.8439],
  ['VADER is very smart, handsome, and funny.', 0.8545], ['VADER is VERY SMART, handsome, and FUNNY.', 0.9227],
  ['VADER is VERY SMART, handsome, and FUNNY!!!', 0.9342], ['The book was good.', 0.4404], ['The book was kind of good.', 0.3832],
  ['The plot was good, but the characters are uncompelling and the dialog is not great.', -0.7042],
  ["At least it isn't a horrible book.", 0.431], ['Make sure you :) or :D today!', 0.8633], ['Today SUX!', -0.5461],
  ["Today only kinda sux! But I'll get by, lol", 0.2228], ['"great," she said', 0], ["-good- and 'bad'", 0],
  ['never so happy!?!', 0.7949], ['not bad at all...', 0.431], ['that was the bomb!!', 0.6792],
  ['yeah right, cut the mustard', 0.0258], ["I don't love it", -0.5216], ['NOT GOOD', 0.4404], ['lol ok', 0.6124],
  ['sad;', -0.4767], [':( nope', -0.4404], ['happy!!!! happy!!', 0.7067], ['Is it good??? really???', 0.594],
];

// vader-sentiment 1.1.3's word splitting: every word of the text with each punctuation
// mark before and after it, looked up token by token.
const PUNC_LIST = ['.', '!', '?', ',', ';', ':', '-', "'", '"', '!!', '!!!', '??', '???', '?!?', '!?!', '?!?!', '!?!?'];
function originalWords(text) {
  const wordsOnly = text.replace(/[!"#$%&'()*+,-./:;<=>?@[\\\]^_`{|}~]/g, '').split(/\s/).filter((w) => w.length > 1);
  const dict = {};
  for (const p of PUNC_LIST) {
    for (const w of wordsOnly) {
      dict[`${p}${w}`] = w;
      dict[`${w}${p}`] = w;
    }
  }
  return text.split(/\s/).filter((t) => t.length > 1).map((t) => (Object.hasOwn(dict, t) ? dict[t] : t));
}

function fuzzTexts(n) {
  let seed = 7;
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = (a) => a[Math.floor(rand() * a.length)];
  const words = ("good bad love hate not never so this kind of but BUT very at least GREAT awful lol :) :( :D <3 isn't don't " +
    "can't dont yeah right cut the mustard extremely NOT ok fine wtf great!!! nice. wow? what?! no... -- ' \" ;) :-) ❤️ 😂 x y").split(' ');
  const marks = [...PUNC_LIST, '', '', '', '', ''];
  return Array.from({ length: n }, () => {
    const out = [];
    for (let i = 0, len = 1 + Math.floor(rand() * 15); i < len; i++) {
      const w = pick(words);
      const r = rand();
      out.push(r < 0.2 ? pick(marks) + w : r < 0.45 ? w + pick(marks) : w);
    }
    return out.join(rand() < 0.1 ? '  ' : ' ');
  });
}

describe('VADER word splitting', () => {
  it('scores known texts as before', () => {
    for (const [text, compound] of KNOWN) assert.equal(vader.polarityScores(text).compound, compound, text);
  });

  it('splits text into the same words as vader-sentiment 1.1.3', () => {
    for (const text of [...KNOWN.map(([t]) => t), ...fuzzTexts(5000)]) {
      assert.deepEqual(vader.explain(text).words.map((w) => w.word), originalWords(text), text);
    }
  });
});
