/* specs/002-ai-conversation-analysis.md: the pure parts of conversation analysis (AC12, with AC2, AC3, AC11). */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, makeMessage, messageLib } from '../helpers/load.mjs';

const {
  buildTranscript, redactText, aliasMap, parseAnalysis, estimateClaude, ollamaRequest, claudeRequest,
  analysisPrompt, ollamaUnreachable, ANALYSIS_SCHEMA, AiError,
  lmstudioRequest, lmstudioModels, lmstudioBudget, lmstudioHeaders, lmstudioUnreachable, AI_BACKENDS, lmstudioReplyText, lmstudioMeasuredRatio, lmstudioFind, lmstudioScopeNote,
} = loadApp([
  'buildTranscript', 'redactText', 'aliasMap', 'parseAnalysis', 'estimateClaude', 'ollamaRequest', 'claudeRequest',
  'analysisPrompt', 'ollamaUnreachable', 'ANALYSIS_SCHEMA', 'AiError',
  'lmstudioRequest', 'lmstudioModels', 'lmstudioBudget', 'lmstudioHeaders', 'lmstudioUnreachable', 'AI_BACKENDS', 'lmstudioReplyText', 'lmstudioMeasuredRatio', 'lmstudioFind', 'lmstudioScopeNote',
]);
const lib = messageLib();
const msg = (at, body, o = 0, rest = {}) => makeMessage(lib, { at, body, o, ...rest });

const convo = [
  msg('2024-03-02T14:02:00Z', 'running late, 10 min', 1),
  msg('2024-03-02T14:05:00Z', 'no worries\nsee you soon', 0, { ph: 1 }),
  msg('2024-03-04T09:30:00Z', '', 0, { vd: 2 }),
  msg('2024-03-04T09:31:00Z', 'call me on 555-123-4567 or alex.smith@mail.com, Alex', 0),
  msg('2024-03-04T09:40:00Z', 'Alex, check https://example.com/x?y=1 before 2024-03-09', 1),
];

describe('spec 002: buildTranscript', () => {
  it('AC2, AC12: day headers, times, speakers and attachments, in order', () => {
    const t = buildTranscript(convo, { budgetChars: 10000, title: 'Alex Smith', speakerOf: () => 'Alex Smith' });
    assert.equal(t.text, [
      '# Conversation with Alex Smith · 5 messages · 2024-03-02 to 2024-03-04',
      '## 2024-03-02 (Sat)',
      '14:02 You: running late, 10 min',
      '14:05 Alex Smith: no worries / see you soon [photo]',
      '## 2024-03-04 (Mon)',
      '09:30 Alex Smith: [2 videos]',
      '09:31 Alex Smith: call me on 555-123-4567 or alex.smith@mail.com, Alex',
      '09:40 You: Alex, check https://example.com/x?y=1 before 2024-03-09',
    ].join('\n'));
    assert.deepEqual({ count: t.count, total: t.total, first: t.first, last: t.last }, { count: 5, total: 5, first: '2024-03-02', last: '2024-03-04' });
  });

  it('AC2, AC12: keeps the latest messages that fit the budget, always at least one', () => {
    const t = buildTranscript(convo, { budgetChars: 140 });
    assert.ok(t.count < 5 && t.count >= 1);
    assert.equal(t.total, 5);
    assert.equal(t.last, '2024-03-04');
    assert.ok(t.text.endsWith('before 2024-03-09'), 'ends with the latest message');
    assert.ok(!t.text.includes('running late'), 'the oldest message is the first to go');
    assert.equal(buildTranscript(convo, { budgetChars: 1 }).count, 1);
  });

  it('AC3, AC12: redaction hides names, phone numbers, emails and links', () => {
    const t = buildTranscript(convo, {
      budgetChars: 10000, title: 'Alex Smith', speakerOf: () => 'Alex Smith', redact: true, names: ['Alex Smith', '+15551234567'], ownNames: ['Jordan'],
    });
    assert.ok(!/Alex|Smith|555|@mail|example\.com/.test(t.text), t.text);
    assert.match(t.text, /^# Conversation with Them · 5 messages/);
    assert.match(t.text, /09:31 Them: call me on \[phone\] or \[email\], Them/);
    assert.match(t.text, /09:40 You: Them, check \[link\] before 2024-03-09/, 'dates stay');
  });

  it('AC3, AC12: in groups each person gets a letter, by first appearance', () => {
    const group = [
      msg('2024-05-01T10:00:00Z', 'hi all', 0, { sn: 'Sam Lee' }),
      msg('2024-05-01T10:01:00Z', 'hey Sam', 0, { sn: 'Riley' }),
      msg('2024-05-01T10:02:00Z', 'Riley you coming?', 0, { sn: 'Sam Lee' }),
      msg('2024-05-01T10:03:00Z', 'yes', 1),
    ];
    const t = buildTranscript(group, { budgetChars: 10000, group: true, redact: true, speakerOf: (m) => m.sn });
    assert.deepEqual(t.text.split('\n').slice(2), [
      '10:00 Person A: hi all',
      '10:01 Person B: hey Person A',
      '10:02 Person A: Person B you coming?',
      '10:03 You: yes',
    ]);
    assert.match(t.text, /^# Conversation with a group \(3 people\)/);
  });

  it('skips messages with no text and no attachments', () => {
    const t = buildTranscript([msg('2024-03-02T14:02:00Z', '   ', 1), msg('2024-03-02T14:03:00Z', 'ok', 0)], { budgetChars: 1000 });
    assert.equal(t.count, 1);
    assert.equal(t.total, 1);
  });
});

describe('spec 002: redactText and aliasMap', () => {
  it('AC12: replaces full names before their parts, whole words only, any case', () => {
    const aliases = aliasMap([{ name: 'Alex Smith', alias: 'Them' }, { name: 'Jo Li', alias: 'You' }]);
    assert.deepEqual([...aliases.keys()], ['Alex Smith', 'Smith', 'Jo Li', 'Alex'], 'parts under 3 letters are left out, full names never');
    assert.equal(redactText('ALEX SMITH and alex, not Alexandra; jo li here', aliases), 'Them and Them, not Alexandra; You here');
  });
  it('AC12: leaves times, short numbers and dates alone', () => {
    assert.equal(redactText('at 14:30, room 12, on 2024-03-09, call +1 (555) 123-4567'), 'at 14:30, room 12, on 2024-03-09, call [phone]');
  });
});

describe('spec 002: parseAnalysis', () => {
  const good = {
    summary: 'Planning a trip.',
    tone: [{ speaker: 'You', description: 'Upbeat.' }, { speaker: 'Them', description: '' }],
    moments: [
      { date: '2024-03-04', title: 'Booked it', detail: 'Flights done.', mood: 'positive' },
      { date: '2024-03-02', title: 'First idea', detail: '', mood: 'excited' },
      { date: '2023-01-01', title: 'Made up', detail: 'Not in the transcript.', mood: 'neutral' },
      { date: 'March 3', title: 'Bad date', detail: '', mood: 'neutral' },
    ],
    topics: ['travel', 'travel', ' money ', ''],
    answer: '',
  };

  it('AC11, AC12: keeps valid parts, drops moments outside the transcript, sorts by date', () => {
    const r = parseAnalysis(JSON.stringify(good), { first: '2024-03-02', last: '2024-03-04' });
    assert.equal(r.summary, 'Planning a trip.');
    assert.deepEqual(r.tone, [{ speaker: 'You', description: 'Upbeat.' }]);
    assert.deepEqual(r.moments.map((m) => [m.date, m.mood]), [['2024-03-02', 'neutral'], ['2024-03-04', 'positive']]);
    assert.equal(r.dropped, 2);
    assert.deepEqual(r.topics, ['travel', 'money']);
  });
  it('AC11: tolerates code fences and text around the JSON', () => {
    const r = parseAnalysis('Here you go:\n```json\n' + JSON.stringify(good) + '\n```');
    assert.equal(r.summary, 'Planning a trip.');
  });
  it('AC11: rejects replies that are not JSON or lack a summary and answer', () => {
    assert.throws(() => parseAnalysis('Sorry, I cannot help with that.'), AiError);
    assert.throws(() => parseAnalysis('{"summary": "unfinished'), AiError);
    assert.throws(() => parseAnalysis('{"topics": ["a"]}'), /missing the summary/);
  });
});

describe('spec 002: request builders', () => {
  it('AC12: estimateClaude counts about 3.5 characters a token, at the model’s price', () => {
    assert.deepEqual(estimateClaude(35000, 'claude-opus-5-5'), { tokens: 10600, cost: (10600 * 4) / 1e6 });
    assert.equal(estimateClaude(35000, 'claude-haiku-5-5').cost, (10600 * 0.1) / 1e6);
    assert.equal(estimateClaude(400000, 'claude-haiku-5-5').cost, (Math.ceil(400000 / 3.5 + 600) * 0.5) / 1e6, 'long prompts cost more on Haiku');
  });
  it('AC4, AC12: ollamaRequest posts to /api/chat, constrained to the schema', () => {
    const { path, body } = ollamaRequest({ model: 'llama3.2', system: 'sys', user: 'transcript' });
    assert.equal(path, '/api/chat');
    assert.equal(body.model, 'llama3.2');
    assert.equal(body.stream, false);
    assert.equal(body.format, ANALYSIS_SCHEMA);
    assert.deepEqual(body.messages, [{ role: 'system', content: 'sys' }, { role: 'user', content: 'transcript' }]);
  });
  it('AC8, AC12: claudeRequest uses structured output, and refusal fallbacks on Opus and Sonnet', () => {
    const opus = claudeRequest({ model: 'claude-opus-5-5', system: 'sys', user: 'u' });
    assert.equal(opus.beta, true);
    assert.equal(opus.params.model, 'claude-opus-5-5');
    assert.deepEqual(opus.params.output_config, { effort: 'medium', format: { type: 'json_schema', schema: ANALYSIS_SCHEMA } });
    assert.deepEqual(opus.params.betas, ['server-side-fallback-2026-07-01']);
    assert.equal(opus.params.fallbacks, 'default');
    assert.equal(opus.params.max_tokens, 16000);

    const haiku = claudeRequest({ model: 'claude-haiku-5-5', system: 'sys', user: 'u' });
    assert.equal(haiku.beta, false);
    assert.equal(haiku.params.fallbacks, undefined);
    assert.equal(claudeRequest({ model: 'nope', system: '', user: '' }).params.model, 'claude-opus-5-5', 'unknown models fall back to the default');
  });
  it('every schema object forbids extra fields and requires all of its fields', () => {
    const objects = [];
    const walk = (s) => {
      if (s.type === 'object') objects.push(s);
      for (const v of Object.values(s.properties || {})) walk(v);
      if (s.items) walk(s.items);
    };
    walk(ANALYSIS_SCHEMA);
    for (const o of objects) {
      assert.equal(o.additionalProperties, false);
      assert.deepEqual([...o.required].sort(), Object.keys(o.properties).sort());
    }
  });
  it('analysisPrompt adds the question, or says there is none', () => {
    assert.match(analysisPrompt('T', ' when? '), /^T\n\nQuestion: when\?$/);
    assert.match(analysisPrompt('T', ''), /leave "answer" empty/);
  });
  it('AC6: the Ollama error names OLLAMA_ORIGINS and the page’s origin', () => {
    assert.match(ollamaUnreachable('http://localhost:11434', 'https://yapalytics.online'), /OLLAMA_ORIGINS=https:\/\/yapalytics\.online/);
  });
});

describe('spec 002: LM Studio', () => {
  it('AC16: lmstudioRequest uses the OpenAI-compatible endpoint with the schema as response_format', () => {
    const { path, body } = lmstudioRequest({ model: 'qwen/qwen3-8b', system: 'sys', user: 'transcript' });
    assert.equal(path, '/v1/chat/completions');
    assert.equal(body.model, 'qwen/qwen3-8b');
    assert.equal(body.stream, false);
    assert.deepEqual(body.messages, [{ role: 'system', content: 'sys' }, { role: 'user', content: 'transcript' }]);
    assert.deepEqual(body.response_format, { type: 'json_schema', json_schema: { name: 'conversation_report', strict: true, schema: ANALYSIS_SCHEMA } });
    assert.equal(body.max_tokens, 1500);
  });

  it('AC16: lmstudioModels keeps language models, loaded first, with their largest loaded context', () => {
    const models = lmstudioModels({
      models: [
        { type: 'llm', key: 'google/gemma-3-4b', loaded_instances: [] },
        { type: 'embedding', key: 'nomic-embed', loaded_instances: [{ id: 'x', config: { context_length: 2048 } }] },
        { type: 'llm', key: 'qwen/qwen3-8b', loaded_instances: [{ id: 'a', config: { context_length: 8192 } }, { id: 'b', config: { context_length: 32768 } }] },
        { type: 'llm', key: 'odd/no-config', loaded_instances: [{ id: 'c' }] },
      ],
    });
    assert.deepEqual(models.map(({ names, ...m }) => m), [
      { key: 'qwen/qwen3-8b', loaded: true, context: 32768, thinks: false },
      { key: 'odd/no-config', loaded: true, context: null, thinks: false },
      { key: 'google/gemma-3-4b', loaded: false, context: null, thinks: false },
    ]);
    assert.deepEqual(models[0].names, ['qwen/qwen3-8b', 'a', 'b'], 'the key and loaded instance ids');
  });

  it('AC16: lmstudioModels reads the OpenAI-compatible list from older servers', () => {
    assert.deepEqual(lmstudioModels({ object: 'list', data: [{ id: 'llama-3.2-3b-instruct' }, { id: 'text-embedding-nomic-embed-text-v1.5' }] }), [
      { key: 'llama-3.2-3b-instruct', loaded: false, context: null, thinks: false, names: ['llama-3.2-3b-instruct'] },
    ]);
    assert.deepEqual(lmstudioModels(null), []);
  });

  it('AC16, AC18: lmstudioBudget keeps 2,500 tokens free and a 5% margin, with no cap but the context', () => {
    assert.equal(lmstudioBudget(4096), 3638); // ~1,516 tokens at 2.4 characters a token
    assert.equal(lmstudioBudget(16384), 31655);
    assert.equal(lmstudioBudget(207104), 466497, 'a 207K context: ~194K tokens of transcript');
    assert.equal(lmstudioBudget(207104, 2.44), 474272, 'a measured ratio');
    assert.equal(lmstudioBudget(1048576), 2385053, 'no 400,000-character cap any more');
    assert.equal(lmstudioBudget(2048), 2000, 'never below 2,000 characters');
    assert.equal(AI_BACKENDS.lmstudio.budgetChars, lmstudioBudget(4096), 'assumes 4,096 tokens until the server says otherwise');
  });

  it('R3: the browser and Ollama budgets fit their contexts at 2.4 characters a token', () => {
    const fits = (chars, context, reply) => chars / 2.4 + 600 + reply < context; // 600: instructions and wrapper
    assert.ok(fits(AI_BACKENDS.webllm.budgetChars, 4096, 1000));
    assert.ok(fits(AI_BACKENDS.ollama.budgetChars, 16384, 1500));
  });

  it('AC19: lmstudioMeasuredRatio reads characters per token from usage, only when the transcript dominates', () => {
    assert.equal(lmstudioMeasuredRatio(1300, 49720, 20899), 2.44); // the real 51K-character run
    assert.equal(lmstudioMeasuredRatio(1300, 3000, 1500), null, 'mostly instructions: says little about chat');
    assert.equal(lmstudioMeasuredRatio(1300, 49720, undefined), null);
    assert.equal(lmstudioMeasuredRatio(1300, 49720, 0), null);
    assert.equal(lmstudioMeasuredRatio(1300, 49720, 2), null, 'nonsense counts are ignored');
  });

  it('AC15: the token goes in a Bearer header only when given', () => {
    assert.deepEqual(lmstudioHeaders({ lmstudioToken: '  tok-123 ' }, true), { 'Content-Type': 'application/json', Authorization: 'Bearer tok-123' });
    assert.deepEqual(lmstudioHeaders({ lmstudioToken: '' }), {});
  });

  it('AC15: the unreachable error names Enable CORS', () => {
    assert.match(lmstudioUnreachable('http://localhost:1234'), /Couldn't reach LM Studio at http:\/\/localhost:1234\..*Enable CORS/);
  });

  it('AC17: lmstudioModels marks reasoning models whose reasoning can be turned off', () => {
    const models = lmstudioModels({ models: [
      // As a real LM Studio 0.4 server reports Qwen3.8 27B.
      { type: 'llm', key: 'qwen/qwen3.8-27b', loaded_instances: [{ id: 'q', config: { context_length: 207104 } }], capabilities: { vision: true, trained_for_tool_use: true, reasoning: { allowed_options: ['off', 'low', 'medium', 'xhigh', 'on'], default: 'xhigh' } } },
      { type: 'llm', key: 'always/thinks', loaded_instances: [], capabilities: { reasoning: { allowed_options: ['on'], default: 'on' } } },
      { type: 'llm', key: 'plain/model', loaded_instances: [], capabilities: { vision: false, trained_for_tool_use: true } },
    ] });
    assert.deepEqual(models.map((m) => [m.key, m.thinks]), [['qwen/qwen3.8-27b', true], ['always/thinks', false], ['plain/model', false]]);
  });

  it('AC17: lmstudioRequest turns reasoning off only when asked', () => {
    assert.equal(lmstudioRequest({ model: 'm', system: 's', user: 'u', reasoningOff: true }).body.reasoning_effort, 'none');
    assert.equal('reasoning_effort' in lmstudioRequest({ model: 'm', system: 's', user: 'u' }).body, false);
  });

  it('AC17: lmstudioReplyText reads the JSON from reasoning_content when content is empty', () => {
    const json = '{"summary": "x"}';
    // What the real server returned for a thinking model with the schema constraint.
    assert.equal(lmstudioReplyText({ finish_reason: 'stop', message: { role: 'assistant', content: '', reasoning_content: json, tool_calls: [] } }), json);
    assert.equal(lmstudioReplyText({ message: { content: json, reasoning_content: 'thinking about {it}' } }), json, 'content wins when it has JSON');
    assert.equal(lmstudioReplyText({ message: { content: 'no idea', reasoning_content: 'hmm' } }), 'no idea');
    assert.equal(lmstudioReplyText(undefined), '');
  });

  // The real server's entry for Qwen3.8 27B (LM Studio 0.4, MLX), trimmed.
  const REAL = lmstudioModels({ models: [
    { type: 'llm', key: 'qwen/qwen3.8-27b', variants: ['qwen/qwen3.8-27b@4bit'], selected_variant: 'qwen/qwen3.8-27b@4bit',
      loaded_instances: [{ id: 'qwen/qwen3.8-27b', config: { context_length: 207104, parallel: 4 } }],
      capabilities: { reasoning: { allowed_options: ['off', 'low', 'medium', 'xhigh', 'on'], default: 'xhigh' } } },
    { type: 'llm', key: 'google/gemma-3-4b', loaded_instances: [] },
    { type: 'embedding', key: 'text-embedding-nomic-embed-text-v1.5', loaded_instances: [] },
  ] });

  it('AC20: lmstudioFind matches the key, a variant or an instance id, in any capitalization', () => {
    for (const name of ['qwen/qwen3.8-27b', 'qwen/qwen3.8-27b@4bit', 'Qwen/Qwen3.8-27B', ' QWEN/QWEN3.8-27B@4BIT ', 'qwen/qwen3.8-27b@8bit']) {
      assert.equal(lmstudioFind(REAL, name)?.key, 'qwen/qwen3.8-27b', name);
    }
    assert.equal(lmstudioFind(REAL, 'qwen3.8-27b'), null, 'LM Studio rejects this too');
    assert.equal(lmstudioFind(REAL, ''), null);
    assert.equal(lmstudioFind(null, 'qwen/qwen3.8-27b'), null);
  });

  it('AC20: lmstudioScopeNote names the context, or says why it can’t use it', () => {
    assert.equal(lmstudioScopeNote(REAL, 'qwen/qwen3.8-27b@4bit'), "as much as fits the model's 207,104-token context in LM Studio");
    assert.match(lmstudioScopeNote(REAL, 'google/gemma-3-4b'), /"google\/gemma-3-4b" isn't loaded.*\(loaded now: qwen\/qwen3\.8-27b\)$/);
    assert.match(lmstudioScopeNote(REAL, 'llama3'), /LM Studio doesn't list a model called "llama3" \(loaded now: qwen\/qwen3\.8-27b\)$/);
    assert.match(lmstudioScopeNote(REAL, ''), /Pick a model/);
    assert.match(lmstudioScopeNote(null, 'qwen/qwen3.8-27b'), /^as much as fits LM Studio's usual 4,096-token context\. Load the model/);
  });
});
