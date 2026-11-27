/* specs/001-ai-mood-scoring.md: the pure parts of AI mood scoring (AC4, AC10) and its controller (AC11–AC14). */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, makeMessage } from '../helpers/load.mjs';

const { vaderLib, messageLib, aggregateContent, moodScore, moodSign, aiMoodText, aiMoodPlan, aiMoodRound } = loadApp(['vaderLib', 'messageLib', 'aggregateContent', 'moodScore', 'moodSign', 'aiMoodText', 'aiMoodPlan', 'aiMoodRound']);
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

/*
 * The controller behind the scorer switch, with the model replaced: `AiMood.score` answers
 * at once (or after `onBatch`), and render/selection/setScorer stand in for the page.
 * A fresh AiMood per test, since it keeps what it has scored.
 */
function controller(msgs, { onBatch = () => {} } = {}) {
  const { AiMood, View } = loadApp(['AiMood', 'View']);
  const c = { AiMood, View, sent: [], selection: msgs, batches: 0 };
  AiMood.ready = true; // the model has loaded (the browser tests cover loading it)
  AiMood.render = () => {};
  AiMood.selection = () => c.selection;
  AiMood.setScorer = (s) => { View.moodScorer = s; };
  AiMood.score = async (texts) => {
    c.sent.push(...texts);
    c.batches++;
    await onBatch(c);
    return texts.map(() => [0.1, 0.8, 0.1]);
  };
  // Runs the dashboard starts on its own (selectionChanged) are awaited through c.running.
  const start = AiMood.start.bind(AiMood);
  AiMood.start = () => (c.running = start());
  /** The dashboard redrawn for `list`: new dates, filters or files. */
  c.select = (list) => {
    c.selection = list;
    AiMood.selectionChanged(list);
  };
  return c;
}

// 100 messages a day apart, each with its own text: more than three batches of 32.
const days = Array.from({ length: 100 }, (_, i) => new Date(Date.UTC(2024, 0, 1 + i)).toISOString());
const thread = () => days.map((at, i) => msg({ at, body: `message number ${i} about the weekend` }));
const latest = (msgs, n) => msgs.slice(-n); // a narrower date range
const texts = (msgs) => new Set(msgs.map((m) => aiMoodText(m.b)));

describe('spec 001: the scorer switch', () => {
  it('AC11: with a date range selected, only the messages in it are scored', async () => {
    const all = thread();
    const c = controller(latest(all, 30));
    await c.AiMood.choose();
    assert.equal(c.View.moodScorer, 'ai');
    assert.deepEqual(new Set(c.sent), texts(latest(all, 30)));
    assert.equal(c.sent.length, 30, 'each text once');
    assert.ok(latest(all, 30).every((m) => m.ai));
    assert.ok(all.slice(0, 70).every((m) => !m.ai), 'nothing outside the range');
  });

  it('AC12: widening the range with AI on scores the new messages, sending no text twice', async () => {
    const all = thread();
    const c = controller(latest(all, 30));
    await c.AiMood.choose();
    c.select(all);
    await c.running;
    assert.equal(c.sent.length, 100);
    assert.equal(new Set(c.sent).size, 100);
    assert.ok(all.every((m) => m.ai));
    assert.equal(c.View.moodScorer, 'ai');
  });

  it('AC13: narrowing the range during a run switches the run to the new range', async () => {
    const all = thread();
    const narrow = latest(all, 10);
    let atNarrow = null;
    const c = controller(all, {
      onBatch: (c) => {
        if (c.batches > 1) return;
        atNarrow = c.sent.length; // batch 1 is out
        c.select(narrow);
      },
    });
    await c.AiMood.choose();
    assert.ok(narrow.every((m) => m.ai), 'the new range is scored');
    assert.deepEqual(c.sent.slice(atNarrow).filter((t) => !texts(narrow).has(t)), [], 'nothing outside it after the switch');
    assert.ok(c.sent.length < 100, 'the rest of the old range was dropped');
    assert.equal(c.View.moodScorer, 'ai');
  });

  it('AC14: Stop while scoring a widened range with AI on switches to VADER', async () => {
    const all = thread();
    const c = controller(latest(all, 30), { onBatch: (c) => { if (c.stopNow) c.AiMood.stopClicked(); } });
    await c.AiMood.choose();
    assert.equal(c.View.moodScorer, 'ai');
    c.stopNow = true;
    c.select(all);
    await c.running;
    assert.equal(c.View.moodScorer, 'vader');
    assert.equal(c.AiMood.state, 'off');
    assert.ok(all.some((m) => !m.ai), 'part of the range is still unscored');
  });
});

describe('spec 006: managing loaded files', () => {
  it('AC13: AI mood scores survive leaving a file out, without the model running again', async () => {
    const all = thread();
    const c = controller(all);
    await c.AiMood.choose();
    const sent = c.sent.length;
    c.running = undefined;
    // Applying the Files dialog parses what's left again: new records, without AI scores.
    const reparsed = all.slice(0, 60).map((m) => msg({ at: new Date(m.t).toISOString(), body: m.b }));
    c.select(reparsed);
    assert.equal(c.running, undefined, 'no run started');
    assert.equal(c.sent.length, sent);
    assert.ok(reparsed.every((m) => m.ai));
    assert.equal(c.View.moodScorer, 'ai');
  });
});
