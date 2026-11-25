import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, makeMessage, messageLib } from '../helpers/load.mjs';

const lib = messageLib();
const {
  aggregateContent, signaturePhrases, buildDocFreq, conversationTerms, insideJokes, distinctiveWords,
  languageOf, wordsOf, languageSummary, otherLanguageConversations,
} = loadApp([
  'aggregateContent', 'signaturePhrases', 'buildDocFreq', 'conversationTerms', 'insideJokes', 'distinctiveWords',
  'languageOf', 'wordsOf', 'languageSummary', 'otherLanguageConversations',
]);
const DAY = 86400000;
const START = Date.parse('2024-01-01T12:00:00Z');

/** say(day, minute, o, body, k, extra) and the sorted messages. */
function builder() {
  const out = [];
  const say = (d, m, o, body, k = 'alex', extra = {}) =>
    out.push(makeMessage(lib, { at: new Date(START + d * DAY + m * 60e3).toISOString(), o, k, body, ...extra }));
  return { say, msgs: () => out.sort((a, b) => a.t - b.t) };
}

/** A month of ordinary back-and-forth with `k`, so phrase counts have a background. */
function chatter(b, k = 'alex', days = 30) {
  for (let d = 0; d < days; d++) {
    b.say(d, 0, 1, 'see you at the park later today', k);
    b.say(d, 1, 0, 'sounds great see you there', k);
    b.say(d, 2, 1, 'bring the frisbee and some snacks', k);
    b.say(d, 3, 0, 'will do, the weather looks good', k);
  }
}

const phrasesFor = (msgs, opts) => {
  const sig = signaturePhrases(aggregateContent(msgs, 'vader', opts).phrases);
  return Object.fromEntries(sig.map((x) => [x.id, x.phrases.map((p) => p.term)]));
};

describe('spec 019 language patterns', () => {
  it('AC1: a phrase only they use, on 5 days, is their signature phrase and not yours', () => {
    const b = builder();
    chatter(b);
    for (let d = 0; d < 5; d++) { b.say(d, 10, 0, 'no way dude'); b.say(d, 11, 0, 'no way dude'); }
    const p = phrasesFor(b.msgs());
    assert.ok(p.alex.includes('no way dude'), JSON.stringify(p));
    assert.ok(!p.You.includes('no way dude'));
  });

  it('AC2: a phrase used 10 times, all on one day, isn’t a signature phrase', () => {
    const b = builder();
    chatter(b);
    for (let i = 0; i < 10; i++) b.say(3, 10 + i, 0, 'no way dude');
    assert.ok(!phrasesFor(b.msgs()).alex.includes('no way dude'));
  });

  it('AC3: a 3-word phrase replaces a 2-word one inside it only with 70% of its uses', () => {
    const b = builder();
    chatter(b);
    for (let d = 0; d < 8; d++) b.say(d, 10, 0, 'on my way');
    b.say(9, 10, 0, 'out of my way');
    let p = phrasesFor(b.msgs());
    assert.ok(p.alex.includes('on my way') && !p.alex.includes('my way'), JSON.stringify(p.alex));

    const c = builder();
    chatter(c);
    for (let d = 0; d < 8; d++) c.say(d, 10, 0, 'on my way');
    for (let d = 0; d < 12; d++) c.say(d, 20, 0, 'out of my way');
    p = phrasesFor(c.msgs());
    assert.ok(p.alex.includes('my way') && !p.alex.includes('on my way'), JSON.stringify(p.alex));
  });

  it('AC4: a phrase of only filler words is never a signature phrase', () => {
    const b = builder();
    chatter(b);
    for (let d = 0; d < 10; d++) b.say(d, 10, 0, 'you know');
    const C = aggregateContent(b.msgs());
    assert.ok(![...C.phrases.all.map.keys()].includes('you know'));
  });

  it('AC5: for all conversations, the columns are you and the top 5 people by 1-on-1 messages', () => {
    const b = builder();
    ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'].forEach((k, i) => {
      for (let j = 0; j < 20 - i * 2; j++) b.say(j, i, 0, 'hello there', k);
    });
    for (let j = 0; j < 100; j++) b.say(j, 30, 0, 'group chat noise here', 'g:club', { sn: 'Zed' });
    b.say(0, 40, 1, 'hi everyone', 'g:club');
    const C = aggregateContent(b.msgs());
    assert.deepEqual(C.phrases.people, ['You', 'p1', 'p2', 'p3', 'p4', 'p5']);
    assert.equal(C.phrases.mode, 'all');
  });

  it('AC6: with the phrase cap at 100 and 1,000 one-off phrases, a phrase used 30 times keeps about its count and ranks first', () => {
    const b = builder();
    for (let d = 0; d < 40; d++) for (const o of [0, 1]) b.say(d, o, o, 'see you at the park later today');
    for (let i = 0; i < 1000; i++) {
      b.say(Math.floor(i / 25), 30 + (i % 25), 0, `zork${i} blip${i}`);
      b.say(Math.floor(i / 25), 30 + (i % 25), 1, `fizz${i} buzz${i}`);
    }
    for (let i = 0; i < 30; i++) b.say(i, 59, 0, 'cosmic latte');
    const C = aggregateContent(b.msgs(), 'vader', { phraseCap: 100 });
    assert.ok(C.phrases.all.map.size <= 100 && C.phrases.who.get('alex').map.size <= 100);
    const top = signaturePhrases(C.phrases).find((x) => x.id === 'alex').phrases[0];
    assert.equal(top.term, 'cosmic latte');
    assert.ok(top.n >= 20 && top.n <= 30, `count ${top.n}`);
  });

  /** "moose" in one conversation, by both sides over 30 days; elsewhere in `others` conversations. */
  function moose(others = 0, { theirs = 4 } = {}) {
    const b = builder();
    chatter(b, 'alex');
    for (let i = 0; i < 4; i++) b.say(i * 9, 20, 1, 'that was so moose of you');
    for (let i = 0; i < theirs; i++) b.say(i * 9 + 1, 20, 0, 'classic moose behaviour');
    for (let i = 0; i < 4; i++) chatter(b, `other${i}`, 3);
    for (let i = 0; i < others; i++) b.say(5, 40, 0, 'saw a moose today', `other${i}`);
    const msgs = b.msgs();
    const df = buildDocFreq(msgs);
    return insideJokes(conversationTerms(msgs.filter((m) => m.k === 'alex'), df), df).map((j) => j.term);
  }

  it('AC8: a rare word both sides keep using is an inside joke; one used in 3 other conversations isn’t', () => {
    assert.ok(moose(0).includes('moose'), JSON.stringify(moose(0)));
    assert.ok(!moose(3).includes('moose'));
  });

  it('AC9: a rare word used 8 times by only one side isn’t an inside joke', () => {
    const b = builder();
    chatter(b, 'alex');
    for (let i = 0; i < 8; i++) b.say(i * 4, 20, 1, 'that was so moose of you');
    for (let i = 0; i < 4; i++) chatter(b, `other${i}`, 3);
    const msgs = b.msgs();
    const df = buildDocFreq(msgs);
    assert.ok(!insideJokes(conversationTerms(msgs.filter((m) => m.k === 'alex'), df), df).some((j) => j.term.includes('moose')));
    assert.equal(moose(0, { theirs: 0 }).includes('moose'), false);
  });

  it('AC12: distinctiveWords reads its counts from conversationTerms and gives the same rows either way', () => {
    const b = builder();
    chatter(b, 'alex');
    chatter(b, 'sam', 10);
    for (let d = 0; d < 6; d++) b.say(d, 30, 0, 'the moose went to https://example.com/moose-facts again', 'alex');
    const msgs = b.msgs();
    const df = buildDocFreq(msgs);
    const alex = msgs.filter((m) => m.k === 'alex');
    const a = distinctiveWords(alex, df);
    assert.deepEqual(distinctiveWords(alex, df, 25, conversationTerms(alex, df)), a);
    assert.ok(a.some((r) => r.w === 'moose'));
    assert.ok(a.some((r) => r.w === 'example'), 'link pieces still count, as before');
  });

  it('AC13: “*there” a minute after “I’ll be ther soon” is a correction; actions, late ones and unrelated words aren’t', () => {
    const run = (second, gapMin = 1) => {
      const b = builder();
      b.say(0, 0, 1, 'I’ll be ther soon');
      b.say(0, gapMin, 1, second);
      return aggregateContent(b.msgs());
    };
    const C = run('*there');
    assert.deepEqual(C.correctionsTotal, [0, 1]);
    assert.equal(C.correctedWords[1].get('there'), 1);
    assert.deepEqual(run('*sigh*').correctionsTotal, [0, 0]);
    assert.deepEqual(run('*there', 10).correctionsTotal, [0, 0]);
    assert.deepEqual(run('*banana').correctionsTotal, [0, 0]);
    // their message doesn't fix yours
    const b = builder();
    b.say(0, 0, 1, 'I’ll be ther soon');
    b.say(0, 1, 0, '*there');
    assert.deepEqual(aggregateContent(b.msgs()).correctionsTotal, [0, 0]);
  });

  it('AC14: thanks and sorry are whole words', () => {
    const b = builder();
    ['Thank you!!', 'thx', 'Thanks', 'so thankful'].forEach((t, i) => b.say(0, i, 1, t));
    ['Sorry', 'my bad', 'sry', 'a sorrowful day'].forEach((t, i) => b.say(0, 10 + i, 0, t));
    const C = aggregateContent(b.msgs());
    assert.deepEqual(C.politeTotal, { thanks: [0, 3], sorry: [3, 0] });
  });

  it('AC15: languages from common words and alphabets', () => {
    const lang = (t) => languageOf(t, wordsOf(t));
    assert.equal(lang('¿Dónde estás? Te espero en la casa'), 'es');
    assert.equal(lang('Where are you? I’m at the house'), 'en');
    assert.equal(lang('ok'), null);
    assert.equal(lang('Привіт, як справи?'), 'uk');
    assert.equal(lang('こんにちは'), 'ja');
    assert.equal(lang('你好吗'), 'zh');
  });

  it('AC16: a conversation mostly in another language is listed; one with 2 messages in it isn’t', () => {
    const b = builder();
    for (let i = 0; i < 40; i++) b.say(i, 0, 1, 'where are you, I am at the house', 'mom');
    for (let i = 0; i < 30; i++) b.say(i, 5, 0, '¿Dónde estás? Te espero en la casa', 'sofia');
    for (let i = 0; i < 5; i++) b.say(i, 6, 1, 'what are you doing this weekend', 'sofia');
    for (let i = 0; i < 2; i++) b.say(i, 7, 0, '¿Dónde estás? Te espero en la casa', 'pat');
    const C = aggregateContent(b.msgs());
    const L = languageSummary(C);
    assert.equal(L.main, 'en');
    const listed = otherLanguageConversations(C, L.main).map((x) => x.k);
    assert.deepEqual(listed, ['sofia']);
  });

  it('AC17: a selection all in one language is single', () => {
    const b = builder();
    chatter(b);
    assert.equal(languageSummary(aggregateContent(b.msgs())).single, true);
    b.say(40, 0, 0, '¿Dónde estás? Te espero en la casa');
    for (let i = 0; i < 20; i++) b.say(41 + i, 0, 0, '¿Dónde estás? Te espero en la casa');
    assert.equal(languageSummary(aggregateContent(b.msgs())).single, false);
  });

  it('AC19: phrases: false counts no phrases and leaves every other number the same', () => {
    const b = builder();
    chatter(b);
    b.say(31, 0, 0, 'check https://example.com/x thanks!');
    const msgs = b.msgs();
    const on = aggregateContent(msgs), off = aggregateContent(msgs, 'vader', { phrases: false });
    assert.equal(off.phrases, null);
    assert.ok(on.phrases);
    const plain = (C) => JSON.stringify({ ...C, phrases: null }, (k, v) => (v instanceof Map ? [...v] : v instanceof Set ? [...v] : v));
    assert.equal(plain(off), plain(on));
  });
});
