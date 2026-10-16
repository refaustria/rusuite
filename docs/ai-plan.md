# AI connection via API – plan (owner direction 2026-10-15: "consider AI connection via API")

- Status: **v1 implemented (P8-37, 2026-10-16)** – see "v1 as built" below. Owner decision 2026-10-15: **Anthropic first** (Claude Messages API, user's own key); OpenAI-compatible and local endpoints later. Must respect ADR 0009: data leaves the device only when the user explicitly invokes an AI action, directly to the provider the user configured with the user's own API key. No Rusuite-side proxy, no telemetry.

## Shape
- **Settings → AI**: provider (Anthropic Claude, OpenAI-compatible endpoint, local/self-hosted OpenAI-compatible e.g. Ollama/LM Studio), API key (stored like other settings: browser storage / app data, never in URLs), model selection, a visible note "Content you select is sent to <provider> when you use an AI action". CSP `connect-src` gets the enabled provider origin (`https://api.anthropic.com`, `https://api.openai.com`, user-entered local URL) – same mechanism as the cloud connectors.
- **Assistant panel** (ribbon: Home › "AI" / Ctrl+Shift+A) with a prompt box and context-aware actions:
  - Write: rewrite/shorten/expand/fix grammar/translate the selection; draft a section from a prompt; summarize the document; generate a table from text. Results are inserted as normal edits (undoable) – via the existing commands.
  - Calc: "formula from description" (inserts a formula into the active cell, explains it), "explain this formula", "clean/transform this range" (returns values/formulas into a destination range), chart suggestion later.
  - Show: generate an outline → slides (title + bullets), speaker notes for a slide, rewrite slide text, suggest layout.
- **Implementation**: `packages/ui-shared/src/ai/` with a provider adapter interface (`complete({system, messages, stream}) -> stream of text`), Anthropic Messages API and OpenAI-compatible adapters (fetch with streaming), prompt templates per action with the document context limited to the selection/sheet range/slide (never the whole file by default; explicit "include whole document" toggle with size warning). Use the Claude API reference skill when implementing. Tool-use/structured outputs for Calc formulas (JSON schema) and Show outlines.
- **Desktop**: same code; CORS is not an issue in Tauri webviews for `fetch` to provider APIs? – verify; otherwise route through a `tauri-plugin-http` call (still direct to the provider, no Rusuite server).
- **Tests**: adapters against recorded responses; actions against a fake provider; e2e with a mock server.

## Order
After the privacy hardening (CSP mechanism) and the first parity batches; before cloud connectors or in parallel (same settings infrastructure).


## v1 as built (P8-37, 2026-10-16)
- **Code**: `packages/ui-shared/src/ai/` – `types.ts` (`AiProvider { kind, name, origin, models(), test(), complete(req)
  → AsyncIterable<Delta> }`, deltas: text, toolUse, usage, stop, model; `AiError` kinds auth / rateLimit (retry-after) /
  overloaded / network / cors / csp / server / notFound / refusal / truncated / …), `providers/` (`http.ts` the one
  `fetch` + SSE parser + CSP detection; `anthropic.ts`: Messages API, `x-api-key`, `anthropic-version: 2023-06-01`,
  `anthropic-dangerous-direct-browser-access: true`, SSE, structured results as one **strict tool with `tool_choice:
  auto`** (the 5.5 models reject forced tool choice) validated again client-side; `temperature` only for models that
  accept it (not the 4.7+/5.x models); `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`) for Opus/Sonnet
  5.x on the official API; models `claude-sonnet-5-5` (default), `claude-opus-5-5`, `claude-haiku-5-5` + free text;
  `openai.ts`: `/chat/completions` streaming with `stream_options.include_usage`, JSON-schema `response_format`,
  configurable base URL, key optional), `settings.ts` (stores), `prompts.ts` (context, limits: selection 60 000 /
  document 400 000 characters, warning from 50 000), `schemas.ts` (formula, range, chart, slides, layout, table,
  draft), `controller.ts` (`Assistant` = `Backend.ai` = `session.ai`), `ui/` (panel, status, ribbon button).
  `packages/ui-shared/src/settings/` – the Options dialog (File › Options…) with the AI page. Apps: `apps/*/src/ai/`.
- **Settings › AI**: enable (off), provider, API key (masked; web `localStorage` unencrypted – said in the dialog;
  desktop OS keyring via `connector_secret_*`, entry `rusuite-ai-<provider>`), base URL (Anthropic: advanced; OpenAI-
  compatible: e.g. `http://localhost:11434/v1`), model, max tokens, temperature, "Include whole document" default,
  the data notice "Text you select is sent to <provider> only when you use an AI action", the origin that will be
  contacted, Test (lists the models), Forget key. Status bar "AI: <provider>" while enabled.
- **Panel** (Home › AI › Assistant, Ctrl+Shift+A; right task pane): action chips, prompt box (Enter sends), streamed
  answers with Insert / Replace selection / Copy or the action's Apply after a preview, Stop, token usage per turn and
  per document, model picker, "Include whole document" with the size warning. The conversation is in memory and
  cleared when another document is opened.
- **Actions**: Write – Rewrite, Shorten, Expand, Fix grammar & spelling, Tone (formal / friendly / concise), Translate
  (English, German, any language), Summarize document (asks to include the document), Draft from prompt (headings +
  paragraphs → one `insertBlocks`), Table from text (→ one `insertBlocks` with a table). Calc – Formula from
  description (checked with the formula parser; Insert disabled for invalid ones), Explain this formula, Transform
  range (preview, destination field + "Use selection", one `compound` of `setInput`s), Chart suggestion (preset +
  range → the normal chart insert). Show – Outline to slides (one `compound`: `addSlide` with explicit new ids +
  `setTextBody` + `setNotes`), Speaker notes for this slide, Rewrite slide text, Suggest a layout (the deck's own).
- **Desktop transport**: the webviews run with `csp: null`, so `fetch` reaches the provider directly; Anthropic sends
  CORS headers for browser calls with the header above, OpenAI's API answers CORS, Ollama allows `tauri://` origins
  by default (others: `OLLAMA_ORIGINS`). No `tauri-plugin-http` was added (ADR 0009 Decision 3); not verified in a
  running desktop build here (headless server) – a manual check with a real key is the remaining step.
- **Web CSP**: owner decision pending (ADR 0009 amendment, P8-37): prepared narrow line
  `set $csp_connect "'self' https://api.anthropic.com https://api.openai.com";` – not applied. Until then the panel
  shows the CSP message on the web.
- **Tests**: adapters against recorded SSE fixtures (`providers/fixtures/*.sse`: text, tool use, error event, refusal,
  OpenAI text and JSON), errors (401, 429 + retry-after, cut stream, CORS, CSP), prompts and limits, schemas,
  settings storage, controller (streaming, structured results, stop, history, document change), panel and settings UI;
  per-app adapters (Write mapping to `insertBlocks`, Calc context/compound, Show outline commands); e2e
  `packages/e2e/tests/ai.spec.ts` against `support/aiMock.ts` (port 4847).
