# 002 AI conversation analysis

Status: Draft (built, awaiting review) · PR:

## Problem

Every chart counts things: messages, words, reply times, mood per message. None of them
can say what a conversation was *about*, how its tone changed, or answer a question like
"when did we start planning the trip?". A language model can, but most users don't want
their messages sent to a company, and some don't have a GPU or a local AI app. So the
user should choose where the model runs.

## Goals and non-goals

- One panel that reads one conversation and reports a summary, each side's tone, notable
  moments with dates, and topics, and that can answer a question about it.
- Four places to run it: in the browser (WebLLM), in Ollama or LM Studio on the user's
  computer, or Claude with the user's own API key.
- Every backend gets the same prompt and returns the same report.
- Not in scope: analyzing all conversations at once; reading more of a conversation
  than fits in one request (no chunking or map-reduce, so the report covers the latest
  messages that fit, and says so); chat-style follow-ups; storing reports or keys.

## Requirements

- **R1** The panel works on one conversation, within the current date range. With
  "All conversations" selected it asks the user to pick one.
- **R2** The user picks a backend: **In this browser** (WebLLM), **Ollama**,
  **LM Studio** or **Claude**. Nothing is downloaded or sent until they click **Analyze**.
- **R3** The transcript holds the latest messages that fit the backend's budget (about
  8,000 characters in the browser, 36,000 with Ollama, 400,000 with Claude; for LM
  Studio see R12). The panel
  says how many messages and which dates it covers.
- **R4** An option hides names, phone numbers, email addresses and links. People become
  "You", "Them", or "Person A, B…" in groups. It is on by default for Claude and off
  for the local backends. This is best effort and the panel says so.
- **R5** For Claude, clicking **Analyze** first shows what will be sent: how many
  messages, the dates, an estimate of tokens and cost, and the transcript itself on
  request. Nothing is sent until **Send to Claude**.
- **R6** The Claude API key is used for that request and kept in memory only, never
  stored. Requests go straight from the browser to api.anthropic.com.
- **R7** The report shows a summary, a line on each side's tone, notable moments
  (date, title, detail, mood), topics and, if a question was asked, the answer.
  Clicking a moment's date shows that day in the message list.
- **R8** Model output is checked before it's shown. Moments with dates outside the
  transcript are dropped, and output that isn't usable shows an error, not a broken
  report.
- **R9** Errors say what to do: no WebGPU, Ollama unreachable (with the
  `OLLAMA_ORIGINS` fix), a bad API key, Claude declining, output too long.
- **R10** The landing page and README privacy text stay true: messages never leave the
  device unless the user sends a conversation to Claude with their own key.
- **R11** LM Studio (added after the first build): **Connect** lists the server's
  language models, marking the loaded ones, and fills the model field. Analysis
  requests are constrained to the report schema like the other backends.
- **R12** LM Studio's context length is set when a model is loaded, not per request.
  So the transcript budget follows the chosen model's loaded context when the server
  reports one (refreshed on Connect and on every **Analyze**). Otherwise it assumes
  LM Studio's common 4,096-token default, and the scope line says so.
- **R13** An optional LM Studio API token (for servers with **Require Authentication**
  on) is sent as `Authorization: Bearer …`, kept in memory only and never stored. A
  missing or wrong token gets its own error.
- **R14** LM Studio errors say what to do: unreachable (start the server and turn on
  **Enable CORS** in its Server Settings), token refused, model not found.
- **R15** LM Studio reasoning models work (found on a real server: Qwen3.8 27B on MLX).
  With a schema constraint, a thinking model's JSON comes back in
  `message.reasoning_content` and `message.content` is empty, because the model never
  leaves its thinking channel. So requests turn reasoning off with `reasoning_effort:
  "none"` when the model list says the model reasons and allows `off`. That costs
  nothing: the constraint applies from the first token, so the model can't think
  freely anyway. If `content` still has no JSON, the report is read from
  `reasoning_content`.

## Privacy

| Backend | Downloaded | Message text goes to |
|---|---|---|
| In this browser | WebLLM 0.2.86 (jsDelivr) and the chosen model (0.9–3.7 GB, Hugging Face), cached by the browser | WebGPU in this tab |
| Ollama | nothing | the Ollama server at the URL the user gives (default `http://localhost:11434`) |
| LM Studio | nothing | the LM Studio server at the URL the user gives (default `http://localhost:1234`) |
| Claude | the Anthropic SDK 1.1.0 (jsDelivr) | api.anthropic.com, under the user's own key and Anthropic's API data terms (API data isn't used for training by default; organizations can arrange zero data retention with Anthropic) |

Settings (backend, Ollama and LM Studio URLs and models, model picks) are remembered
in localStorage. The Claude API key, the LM Studio token and the reports are not.

## Design

**UI.** A new dashboard section, **AI analysis**, after Content, with one wide card
(`#aiCard`):

- A backend switch: **In this browser** | **Ollama** | **LM Studio** | **Claude**.
- Settings for the chosen backend:
  - In this browser: model (Llama 3.2 3B ~2.3 GB, default; Llama 3.2 1B ~0.9 GB; Phi
    3.5 mini ~3.7 GB), plus "Needs WebGPU" or a warning if it's missing.
  - Ollama: server URL and model name, with **Connect** filling a list of installed
    models from `/api/tags`, and the `OLLAMA_ORIGINS` tip.
  - LM Studio: server URL, model, optional API token and **Connect**, with the
    **Enable CORS** tip.
  - Claude: API key (password field) and model (Claude Opus 5.5 default, Claude Sonnet
    5.5, Claude Haiku 5.5).
- **Hide names, numbers, emails and links**, an optional question field, and
  **Analyze**.
- A scope line: "Reads the latest 812 of 3,410 messages (Mar 2 – Nov 12, 2024)".
- The Claude confirmation (R5), progress or status text, then the report.

**Prompt.** The system prompt says it is analyzing a text conversation for "You", to
use only the transcript, to give dates as `YYYY-MM-DD` from the day headers, and to
reply in JSON matching the schema. The user message is the transcript, plus the
question if there is one.

**Transcript format.**

```
# Conversation with Them · 812 messages · 2024-03-02 to 2024-11-12
## 2024-03-02 (Sat)
14:02 You: running late, 10 min
14:05 Them: no worries [photo]
```

**Report schema** (JSON Schema, every object `additionalProperties: false`, every
field required, so every backend can constrain to it):

```
{ summary: string,
  tone: [{ speaker: string, description: string }],
  moments: [{ date: string, title: string, detail: string,
              mood: "positive" | "negative" | "mixed" | "neutral" }],
  topics: [string],
  answer: string }   // "" when no question was asked
```

**Backends.** Each one has a budget in `AI_BACKENDS` and a runner in `AiRunners`
(`js/ai-analysis.js`): `({ system, user, schema, settings, onStatus, signal }) → text`.
**Stop** aborts the request.

- `webllm`: `CreateMLCEngine(model, { initProgressCallback })`, then
  `chat.completions.create` with `response_format: { type: 'json_object', schema }`
  and `max_tokens: 1000`. The prebuilt models have a 4,096-token context: the
  8,000-character transcript (~2,300 tokens), the instructions and the reply have to
  fit in it.
  The engine is kept for the next run with the same model.
- `ollama`: `POST {url}/api/chat` with `format: schema`, `stream: false`,
  `options.num_ctx: 16384`.
- `lmstudio`: `POST {url}/v1/chat/completions` (OpenAI-compatible) with
  `response_format: { type: 'json_schema', json_schema: { name, strict: true, schema
  } }`, `temperature: 0.2`, `max_tokens: 1500`. LM Studio's native `/api/v1/chat` would
  let a request set its context length, but it has no structured output, and small
  local models need the schema constraint more than anything. Models come from the
  native `GET {url}/api/v1/models` (`type: 'llm'`, `loaded_instances[].config.
  context_length`, `capabilities.reasoning.allowed_options`), falling back to `GET
  {url}/v1/models` on servers older than 0.4. Of the ways to turn reasoning off on
  the OpenAI-compatible endpoint, only `reasoning_effort: "none"` worked (tested:
  `reasoning: { effort: "none" }`, `reasoning: "off"` and
  `chat_template_kwargs.enable_thinking: false` were ignored). LM Studio's docs say
  asking a model for a reasoning setting it doesn't support is an error, so it's only
  sent to models that allow `off`.
  Budget: `(context − 2,000) × 3` characters, at least 4,000, at most 400,000 (2,000
  tokens for the instructions and the reply; ~3 characters a token to stay safe).
- `claude`: the Anthropic SDK with `dangerouslyAllowBrowser: true`, then
  `messages.create` with `output_config: { effort: 'medium', format: { type:
  'json_schema', schema } }` and `max_tokens: 16000`. Claude Opus 5.5 and Sonnet 5.5
  requests opt into server-side refusal fallbacks (`fallbacks: 'default'`, beta
  `server-side-fallback-2026-07-01`). It checks `stop_reason` for `refusal` and
  `max_tokens` before reading the text.

Pure helpers, unit tested: `buildTranscript`, `redactText`, `parseAnalysis`,
`estimateClaude`, `ollamaRequest`, `claudeRequest`, and for LM Studio
`lmstudioRequest`, `lmstudioModels`, `lmstudioBudget`, `lmstudioReplyText`.

## Acceptance criteria

- **AC1** With "All conversations" selected, the card asks for a conversation and
  **Analyze** is disabled.
- **AC2** The scope line gives the number of messages and the dates in the transcript.
  The transcript keeps the latest messages that fit the budget, in order.
- **AC3** With redaction on, the transcript has no participant names, phone numbers,
  emails or links. With it off, it has real names.
- **AC4** Ollama: **Analyze** posts the transcript and schema to `/api/chat`, and the
  report renders a summary, tone, moments, topics and an answer when asked.
- **AC5** Clicking a moment's date shows that day in the message list.
- **AC6** Ollama unreachable: an error naming `OLLAMA_ORIGINS` and the page's origin.
- **AC7** Claude: **Analyze** shows the confirmation with messages, dates and an
  estimate, and makes no request until **Send to Claude**. **Cancel** sends nothing.
- **AC8** Claude: the request uses the chosen model, the key, and structured output. The
  report renders, and the key isn't in localStorage afterwards.
- **AC9** Claude: a 401 shows "That API key was rejected", and a refusal shows that
  Claude declined.
- **AC10** In this browser: without WebGPU the card says so and **Analyze** is disabled.
  With it, loading progress shows, then the report.
- **AC11** Output that isn't valid JSON, or that lacks the fields, shows an error.
  Moments outside the transcript's dates are dropped.
- **AC12** `buildTranscript`, `redactText`, `parseAnalysis`, `estimateClaude`,
  `ollamaRequest` and `claudeRequest` behave as described (unit tests).
- **AC13** LM Studio: **Connect** lists only language models, puts the loaded ones
  first with their context length, and fills the model field. Choosing a loaded model
  with a bigger context lets the transcript hold more messages.
- **AC14** LM Studio: **Analyze** posts the transcript to `/v1/chat/completions` with
  the schema as `response_format`, and the report renders.
- **AC15** LM Studio: a token, when given, is sent as a Bearer header and isn't in
  localStorage afterwards. A 401 says the token is missing or wrong. An unreachable
  server gets an error naming **Enable CORS**.
- **AC16** `lmstudioRequest`, `lmstudioModels` and `lmstudioBudget` behave as described
  (unit tests).
- **AC17** LM Studio with a reasoning model: the request carries `reasoning_effort:
  "none"` (only for models that allow `off`), and a reply whose JSON is in
  `reasoning_content` with an empty `content` still renders the report.

## Open questions

- Chunking long conversations (summarize each part, then the summaries) would cover all
  of a conversation instead of the latest part. Worth doing next?
- Chrome's built-in Prompt API (Gemini Nano) would be another backend with no download
  on supported Chrome builds. Add it once it's broadly available?
- LM Studio: should **Analyze** load an unloaded model with a bigger context
  (`POST /api/v1/models/load` with `context_length`) instead of leaving it to LM
  Studio's just-in-time loading at its default? It would read more of the
  conversation, but it changes what's loaded in the user's LM Studio and uses more
  memory.
