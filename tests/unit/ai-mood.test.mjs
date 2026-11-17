/* specs/001-ai-mood-scoring.md: the pure parts of AI mood scoring (AC10, AC4). */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadScripts, makeMessage } from '../helpers/load.mjs';

const { vaderLib, messageLib, aggregateContent, moodScore, moodSign, aiMoodText, aiMoodPlan, aiMoodRound } = loadScripts(
  ['vendor/vader.js', 'parser.js', 'analysis.js', 'ai-mood.js'],
  ['vaderLib', 'messageLib', 'aggregateContent', 'moodScore', 'moodSign', 'aiMoodText', 'aiMoodPlan', 'aiMoodRound'],
);
const lib = messageLib(vaderLib());
const msg = (spec) => makeMessage(lib, { at: '2024-03-05T12:00:00Z', ...spec });

describe('spec 001: aiMoodText', () => {
  it('AC10: turns @mentions into @user and links into http, like the model’s training data', () => {
    assert.equal(aiMoodText('@alex look https://x.com/a/b and www.site.com @'), '@user look http and http @');
  });
  it('AC10: keeps emoji and collapses whitespace and line breaks', () => {
    assert.equal(aiMoodText('love you\n\n  so much ❤️'), 'love you so much ❤️');
  });
  it('AC10: caps very long messages at 1,000 characters without splitting an emoji', () => {
    const out = aiMoodText('😂'.repeat(1200));
    assert.equal([...out].length, 1000);
    assert.ok(out.endsWith('😂'));
  });
});

describe('spec 001: aiMoodPlan', () => {
  it('AC4, AC10: each unique text once, shortest first, with every message behind it', () => {
    const a = msg({ body: 'lol sure' });
    const b = msg({ body: 'lol   sure' }); // same text once prepared
    const c = msg({ body: 'see you at five then' });
    const plan = aiMoodPlan([c, a, b]);
    assert.deepEqual(plan.texts, ['lol sure', 'see you at five then']);
    assert.deepEqual(plan.byText.get('lol sure'), [a, b]);
    assert.equal(plan.count, 3);
  });
  it('AC10: plans exactly the messages VADER scores that have no AI score yet', () => {
    const scored = msg({ body: 'great news' });
    scored.ai = [0.01, 0.1, 0.89];
    const noWords = msg({ body: '' });
    const numbers = msg({ body: '12345' }); // no letters: VADER leaves it unscored
    const todo = msg({ body: 'ugh not again' });
    const plan = aiMoodPlan([scored, noWords, numbers, todo]);
    assert.deepEqual(plan.texts, ['ugh not again']);
    assert.equal(plan.count, 1);
  });
  it('AC10, AC12: texts scored in an earlier run get their scores instead of being planned again', () => {
    const p = [0.05, 0.15, 0.8];
    const seen = msg({ body: 'lol   sure' });
    const fresh = msg({ body: 'see you at five then' });
    const plan = aiMoodPlan([seen, fresh], new Map([['lol sure', p]]));
    assert.equal(seen.ai, p);
    assert.deepEqual(plan.texts, ['see you at five then']);
    assert.equal(plan.count, 1);
  });
});

describe('spec 001: moodScore and moodSign', () => {
  it('AC10: VADER uses the compound score and the ±0.05 cut-off', () => {
    assert.equal(moodScore({ v: 0.3 }), 0.3);
    assert.equal(moodSign({ v: 0.05 }), 1);
    assert.equal(moodSign({ v: -0.05 }), -1);
    assert.equal(moodSign({ v: 0.04 }), 0);
    assert.equal(moodSign({}), null);
  });
  it('AC10: the AI score is positive minus negative, and its label is the likeliest class', () => {
    const r = { v: 0.3, ai: [0.1, 0.5, 0.4] };
    assert.equal(moodScore(r, 'ai'), 0.3);
    assert.equal(moodSign(r, 'ai'), 0, 'neutral is likeliest, though the score is +0.3');
    assert.equal(moodSign({ ai: [0.85, 0.13, 0.02] }, 'ai'), -1);
    assert.equal(moodSign({ ai: [0.02, 0.18, 0.8] }, 'ai'), 1);
    assert.equal(moodScore({ v: 0.3 }, 'ai'), null, 'not scored by the model yet');
    assert.equal(moodSign({ v: 0.3 }, 'ai'), null);
  });
  it('rounds stored probabilities to 3 places', () => {
    assert.deepEqual(aiMoodRound([0.12345, 0.5, 0.37655]), [0.123, 0.5, 0.377]);
  });
});

describe('spec 001: aggregateContent with the AI scorer', () => {
  it('AC10: counts positive and negative by the model, and skips messages it has not scored', () => {
    const sarcasm = msg({ body: "yeah right, like that'll happen 🙄", o: 1 });
    sarcasm.ai = [0.85, 0.13, 0.02];
    const plans = msg({ body: 'ok see you at 5', o: 1 });
    plans.ai = [0.02, 0.9, 0.08];
    const unscored = msg({ body: 'love it', o: 1 });
    const msgs = [sarcasm, plans, unscored];

    const vader = aggregateContent(msgs).moodTotal;
    assert.deepEqual({ pos: vader.pos[1], neg: vader.neg[1], n: vader.n[1] }, { pos: 3, neg: 0, n: 3 }, 'VADER reads all three as positive');

    const ai = aggregateContent(msgs, 'ai').moodTotal;
    assert.deepEqual({ pos: ai.pos[1], neg: ai.neg[1], n: ai.n[1] }, { pos: 0, neg: 1, n: 2 });
  });
});
