# AI connection via API – plan (owner direction 2026-10-15: "consider AI connection via API")

- Status: planned; owner decision 2026-10-15: **Anthropic first** (Claude Messages API, user's own key); OpenAI-compatible and local endpoints later. Must respect ADR 0009: data leaves the device only when the user explicitly invokes an AI action, directly to the provider the user configured with the user's own API key. No Rusuite-side proxy, no telemetry.

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
