# AI provider API notes (P8-37, P9-A1) – evidence for the request parameters

Sources fetched 2026-10-16 (docs.anthropic.com redirects to platform.claude.com). Each parameter the Anthropic adapter
(`packages/ui-shared/src/ai/providers/anthropic.ts`) sends or omits, with the documentation it relies on.

## 1. `fallbacks: "default"` (server-side refusal fallback, beta)
- https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback – "Set the `fallbacks` parameter to the
  string `"default"` and send the `server-side-fallback-2026-07-01` beta header."
- Same page: "Server-side fallback is in beta on the Claude API. The `fallbacks` parameter is not supported on the
  Message Batches API … and is not available on Amazon Bedrock, Google Cloud, or Microsoft Foundry." and "Claude
  Haiku 5.5 has no server-side fallback: with `fallbacks: "default"`, a declined request stays declined, and a list of
  fallback models returns a 400 error."
- https://platform.claude.com/docs/en/models/opus-5-5/whats-new-opus-5-5 – "retry on another model with server-side
  fallback (`fallbacks: "default"`, in beta, retries on the model Anthropic recommends for that category)".
- Adapter: sent only to the official API origin, only for Opus 5 / 5.5, Sonnet 5.5 and Fable 5 / 5.1 (never Haiku),
  always with `anthropic-beta: server-side-fallback-2026-07-01`.

## 2. Forced tool choice is rejected by the 5.5 models → `tool_choice: {"type": "auto"}` + `strict: true`
- https://platform.claude.com/docs/en/models/opus-5-5/whats-new-opus-5-5 – "Claude Opus 5.5 doesn't support forced
  tool use. `tool_choice` set to `{"type": "any"}` or `{"type": "tool", "name": "..."}` returns a 400
  `invalid_request_error`: `tool_choice: type "tool" and "any" are not supported for this model.`"
- https://platform.claude.com/docs/en/models/sonnet-5-5/migration-guide – "Claude Sonnet 5.5 rejects both with a 400
  error … Send `tool_choice: {"type": "auto"}`, and mark the tool `strict: true` so its input matches the schema."

## 3. Sampling parameters (`temperature`) are rejected by the 5.5 models → omitted
- https://platform.claude.com/docs/en/models/opus-5-5/migration-guide – "**Sampling parameters:** Omit `temperature`,
  `top_p`, and `top_k`, or leave them at their defaults: any other value is rejected."
- https://platform.claude.com/docs/en/models/sonnet-5-5/migration-guide – "Remove non-default `temperature`,
  `top_p`, and `top_k` values."
- Adapter: `temperature` is sent only to Claude 3.x / 4.0–4.6 / Haiku 4.5 ids (`acceptsTemperature`); every other id –
  including Opus 4.7 / 4.8, for which I found no page to quote – gets none. Omitting it is always valid (the default
  applies), so this errs on the safe side.

## 4. Reasoning: `thinking` + `output_config.effort` (P9-A1)
Checked 2026-10-18 against the Claude API reference bundled with Claude Code (skill `claude-api`, model table cached
2026-10-06; not re-fetched live – the owner's smoke test below confirms it against the real API). Exact fields:
- Effort is **`output_config: {"effort": "low" | "medium" | "high" | "xhigh" | "max"}`** – inside `output_config`, not
  top level; GA, no beta header. Default `high`, except Opus 5.5 and Haiku 5.5 (`medium`).
- Adaptive thinking is **`thinking: {"type": "adaptive"}`**; `budget_tokens` is rejected (400) on the 5.x models and
  Opus 4.7/4.8. The thinking text is **`display: "omitted"` by default** on the 5.x / 4.7+ models (empty thinking
  blocks); `display: "summarized"` streams a readable summary as `content_block_delta` / `thinking_delta`
  (`delta.thinking`), plus a `signature_delta` that we ignore.
- Turning thinking off differs per model: Sonnet 5.5 rejects `{"type":"disabled"}` and takes
  **`{"type": "between_tools"}`** (no other field, effort high or below); Opus 5.5 (and Fable 5 / 5.1) cannot disable
  thinking at all – the lowest setting is effort `low`; Haiku 5.5, Opus 5, Sonnet 5 and Opus 4.6–4.8 accept
  `{"type":"disabled"}` (Opus 5 / Haiku 5.5 only at effort high or below).
- Mapping in `providers/anthropic.ts` `reasoningParams`: Low / Medium / High → `thinking: {type: "adaptive", display:
  "summarized"}` + `output_config: {effort}`; Off → `between_tools` (Sonnet 5.5), `output_config: {effort: "low"}`
  without `thinking` (Opus 5.5, Fable), `{type: "disabled"}` (the others). Claude 3.x / 4.0–4.5 and unknown ids get
  neither field. `temperature` is never sent together with adaptive thinking. `thinking` and `output_config` are in
  the defensive-retry list (a 400 naming them → one retry without).
- **Thinking blocks are not replayed.** The conversation history we send is text only (earlier answers' text), so
  there are no thinking blocks whose signatures could fail the 5.x "preserved thinking" prefix check (editing earlier
  turns invalidates later thinking blocks); the cost is that follow-ups do not see the earlier reasoning.

## 5. Prompt caching (P9-A1)
- `cache_control: {"type": "ephemeral"}` on a content block (system text blocks included) marks a cache breakpoint
  (5-minute TTL, refreshed on each hit; `ttl: "1h"` optional; at most 4 breakpoints). The cache is a prefix match in the
  order tools → system → messages; any byte change before the breakpoint misses.
- With "Include whole document" the adapter sends `system: [{type: "text", text: <document>, cache_control:
  {type: "ephemeral"}}, {type: "text", text: <instructions>}]` – the document first so that actions with different
  instructions share it (tools come before the system prompt, so structured actions share it only among themselves).
- Usage: `message_start.message.usage` carries `input_tokens` (the uncached part), `cache_creation_input_tokens` and
  `cache_read_input_tokens`; `message_delta.usage` carries the cumulative `output_tokens` (and may repeat the input
  fields – they replace, not add). The panel's "input" is the sum of the three.
- Minimum cacheable prefix: 512 tokens on the 5.x models (1024–4096 on older ones) – a short document silently caches
  nothing (`cache_creation_input_tokens: 0`).
- OpenAI-compatible: there is no cache marker in chat completions. OpenAI caches long identical prefixes on its own and
  reports `usage.prompt_tokens_details.cached_tokens` (shown as "from cache"); local servers (Ollama, LM Studio) do
  not cache across requests. The document is put first in the system message so that the prefix repeats.

## 6. Images (P9-A1)
- Image blocks: `{"type": "image", "source": {"type": "base64", "media_type": "image/png" | "image/jpeg" |
  "image/gif" | "image/webp", "data": <base64 without newlines>}}`, placed before the text block of the same user
  message. OpenAI-compatible: `{"type": "image_url", "image_url": {"url": "data:<type>;base64,<data>"}}`.
- Size: at most 5 MB per image (API limit, we check the encoded bytes); the brief's 1568 px long side is the classic
  recommendation (larger images are scaled down by the API and cost more tokens). Note: Opus 4.7+ / Sonnet 5 and newer
  accept high-resolution images up to 2576 px; we keep 1568 px (fewer image tokens, enough for alt text and charts).
- Live page for the details: https://platform.claude.com/docs/en/build-with-claude/vision.md (not fetched here).

## 7. Test with a 1-token request (P9-A1)
Settings › Test lists the models (`GET /v1/models`) and then sends `max_tokens: 1` to the chosen model (no thinking
fields, so it is cheap and valid on every model); `stop_reason: "max_tokens"` is success. A 401 from the list stops
there (the key is wrong); a 404 from the list (servers without a model list) still counts as connected when the model
answers.

## Defensive retry
Independently of the above, both adapters retry a request **once** when the provider answers 400 with a message
naming an optional parameter as unexpected / unknown / unsupported (Anthropic: `fallbacks`, `temperature`,
`tool_choice`, `thinking`, `output_config`; OpenAI-compatible: `temperature`, `stream_options`), without that parameter, and remember it per
origin + model for the session (`providers/http.ts` `rejectedParam` / `markUnsupported`; tests with recorded 400
bodies in `providers/fixtures/*-400-*.json`).
