import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, messageLib } from '../helpers/load.mjs';

const lib = messageLib();
const isReaction = (body) => {
  const rec = {};
  lib.analyzeText(body, rec);
  return Boolean(rec.f & lib.T_REACTION);
};

describe('reactions sent as texts', () => {
  const reactions = {
    'Google Messages, cut short with no closing quote': '😂 to “ Ya I was actually messing around with an app that lets you fake being an',
    'Google Messages, full quote': '❤️ to “see you soon”',
    'Google Messages, straight quotes': '👍 to "ok"',
    'Google Messages, media': '❤️ to an image',
    'iPhone loved': 'Loved “see you soon 😊”',
    'iPhone liked': 'Liked “dinner at 7?”',
    'iPhone laughed': 'Laughed at “lol”',
    'iPhone emphasized': 'Emphasized “WHAT”',
    'British spelling': 'Emphasised “WHAT”',
    'iPhone questioned': 'Questioned “huh”',
    'iPhone disliked': 'Disliked “no”',
    'iPhone loved an image': 'Loved an image',
    'iPhone laughed at an image': 'Laughed at an image',
    'iPhone video ("movie")': 'Emphasized a movie',
    'iPhone attachment': 'Questioned an attachment',
    'iPhone GIF': 'Liked a GIF',
    'iPhone audio message': 'Loved an audio message',
    'iPhone sticker': 'Liked a sticker',
    'iOS emoji reaction': 'Reacted 😂 to “that was funny”',
    'iOS emoji reaction with skin tone, to media': 'Reacted 🫶🏽 to an image',
    'reacted with': 'Reacted with 🔥 to “nice”',
    'removed tapback': 'Removed a heart from “see you soon”',
    'removed tapback from media': 'Removed a like from an image',
    'removed emoji reaction': 'Removed 😂 from “lol”',
  };
  for (const [what, body] of Object.entries(reactions)) {
    it(`detects ${what}`, () => assert.equal(isReaction(body), true, body));
  }

  const messages = {
    'a sentence starting with Loved': 'Loved the movie last night',
    'a media phrase that continues': 'Liked an image you sent me yesterday',
    'text before "to"': 'lol to be honest',
    'emoji then "to" without a quote': '😂 to me that is funny',
    'a quote mid-sentence': 'Going to “the place”',
    'short reply': 'Loved it!',
    'love you': 'love you',
    'Laughed at, not quoted': 'Laughed at that so hard',
    'Removed, not a reaction': 'Removed the stain from my shirt',
    'loved an image, mid-sentence': 'I loved an image of the sunset',
    'Reacted, not a reaction': 'Reacted badly to the news',
  };
  for (const [what, body] of Object.entries(messages)) {
    it(`leaves ${what} as a message`, () => assert.equal(isReaction(body), false, body));
  }

  it('skips word, swear and mood analysis for reactions', () => {
    const rec = {};
    lib.analyzeText('Loved “damn that is great”', rec);
    assert.equal(rec.sw, undefined);
    assert.equal(rec.v, undefined);
    assert.equal(rec.f, lib.T_REACTION);
  });
});

describe('spec 004 reactions on messages', () => {
  it('AC9: addReaction merges by emoji, adds up counts and keeps each name once', () => {
    const rec = {};
    lib.addReaction(rec, '❤️', 1, ['Alex']);
    lib.addReaction(rec, '😮', 1, ['Alex']);
    lib.addReaction(rec, '❤️', 2, ['Alex', 'Sam']);
    lib.addReaction(rec, '', 1, ['Nobody']);
    lib.addReaction(rec, '👍', 0, ['Nobody']);
    assert.deepEqual(rec.rx, [{ r: '❤️', c: 3, n: ['Alex', 'Sam'] }, { r: '😮', c: 1, n: ['Alex'] }]);
    const none = {};
    lib.addReaction(none, '', 1, []);
    assert.equal(none.rx, undefined, 'no rx without a reaction');
  });

  it('AC16: mergeReactions keeps the larger count per emoji and everyone named, in either order', () => {
    const { mergeReactions } = loadApp(['mergeReactions']);
    const older = [{ r: '❤️', c: 1, n: ['Alex'] }];
    const newer = [{ r: '❤️', c: 1, n: ['Alex'] }, { r: '😂', c: 1, n: ['Jamie'] }];
    const want = [{ r: '❤️', c: 1, n: ['Alex'] }, { r: '😂', c: 1, n: ['Jamie'] }];
    assert.deepEqual(mergeReactions(older, newer), want);
    assert.deepEqual(mergeReactions(newer, older), want);
    // Telegram: a count above the names listed is kept; names from both are kept.
    assert.deepEqual(mergeReactions([{ r: '👍', c: 3, n: ['Sam'] }], [{ r: '👍', c: 2, n: ['Alex'] }]), [{ r: '👍', c: 3, n: ['Sam', 'Alex'] }]);
    assert.deepEqual(mergeReactions([{ r: '👍', c: 1, n: ['Sam'] }], [{ r: '👍', c: 1, n: ['Alex'] }]), [{ r: '👍', c: 2, n: ['Sam', 'Alex'] }]);
    assert.equal(mergeReactions(undefined, []), undefined);
    assert.notEqual(mergeReactions(older, [])[0], older[0], 'returns copies, not the inputs');
  });
});
