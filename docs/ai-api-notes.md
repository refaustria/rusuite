# AI provider API notes (P8-37) – evidence for the request parameters

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

## Defensive retry
Independently of the above, both adapters retry a request **once** when the provider answers 400 with a message
naming an optional parameter as unexpected / unknown / unsupported (Anthropic: `fallbacks`, `temperature`,
`tool_choice`; OpenAI-compatible: `temperature`, `stream_options`), without that parameter, and remember it per
origin + model for the session (`providers/http.ts` `rejectedParam` / `markUnsupported`; tests with recorded 400
bodies in `providers/fixtures/*-400-*.json`).
