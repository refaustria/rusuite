# AI connection via API – plan (owner direction 2026-10-15: "consider AI connection via API")

- Status: **v1 implemented (P8-37, 2026-10-16)**, **v2 (P9-A1, 2026-10-18)**, **v3 polish (P9-A2, 2026-10-18)** – see "v1 as built", "v2 as built" and "v3 as built" below. Owner decision 2026-10-15: **Anthropic first** (Claude Messages API, user's own key); OpenAI-compatible and local endpoints later. Must respect ADR 0009: data leaves the device only when the user explicitly invokes an AI action, directly to the provider the user configured with the user's own API key. No Rusuite-side proxy, no telemetry.

**Decision 2026-10-16: desktop only.** The website keeps `connect-src 'self'`; this feature is offered in the desktop apps only and hidden on the web (see ADR 0009 decision).

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


## v2 as built (P9-A1, 2026-10-18)
Desktop only as before (the web hides the entry points); the user's own key; no Rusuite server. API fields and their
sources: `docs/ai-api-notes.md` §4–7.
- **Prompt caching** – "Include whole document" sends the document apart from the messages (`AiRequest.documentContext`,
  `prompts.ts` `documentContext`): Anthropic gets it as the first system block with `cache_control: {type:
  "ephemeral"}`, so the follow-up turns of a conversation read it from the cache; OpenAI-compatible endpoints get it at
  the start of the system message (no marker; OpenAI's own `cached_tokens` is shown). Usage deltas carry
  `cacheReadTokens` / `cacheWriteTokens`; the panel shows them per turn and per document. The controller fingerprints
  the sent document (`textHash`): per turn "sent" / "same" / "changed" (an edited document is simply a new block and
  cache entry); a new conversation or document starts over.
- **Reasoning** – Settings › AI › Reasoning (Off / Low / Medium / High, default Low) → `reasoningParams` per model
  (adaptive thinking with `display: "summarized"` + `output_config.effort`; Off → `between_tools` on Sonnet 5.5,
  effort low on Opus 5.5 / Fable, `disabled` elsewhere; nothing for older or unknown models). Actions declare a
  minimum (`AiAction.effort`: Formula from description, Transform range → Medium); Off stays off. `thinking_delta`
  streams into a collapsed "Thinking…" expander, never inserted; each turn records model and effort. Thinking blocks
  are not replayed in the history (text only). Default Max tokens 16 000.
- **Pictures** – `images.ts`: image blocks (base64, ≤ 1568 px long side, ≤ 5 MB; PNG, JPEG when the PNG is too
  large; small data URLs of accepted types unchanged), chart scenes drawn at 2× on white, `chartDataTable`. Pending
  attachments (`Assistant.attach`, at most 5) and an action's own pictures (`AiAction.attachments`) go before the task
  text of the next turn. Write: Attach selected picture; Describe picture → alt text (Set as alt text →
  `setImageAttrs` → `SetImageAlt`). Show: Attach selected picture, Attach current slide as image
  (`renderSlideImages`, the print path), Describe picture → alt text (`setAltText`), Explain this chart (chart PNG +
  data table → Add to speaker notes). Calc: Explain this chart (the grid's scene + `chartData` → Insert as note under
  the chart's top-left cell, `setNote`). OpenAI-compatible: pictures only for model ids marked "accepts pictures"
  (`AiSettings.visionModels`), otherwise the `noVision` error before anything is sent.
- **Language** – Settings › AI › Reply in: interface language (default; answers in the UI language, text for the
  document keeps the document's language), the document's language, or one of the 24 languages (`languageRule` in the
  system prompt). All new panel texts, chips and errors are catalog keys (en + de; the other languages pending).
- **Test** – the model list plus a 1-token request to the chosen model; the result names the error class (API key /
  rate limit or overload / model or request / connection / provider error) – `Assistant.test` → `testResultText`.
- **Ribbon** – the AI group collapses last (`aiRibbonGroup` `collapsePriority: -1`; Show's Home tab uses it; Write and
  Calc followed in P9-A2).
- **Tests** – `packages/ui-shared/src/ai/round2.test.ts` (caching blocks and usage from recorded SSE fixtures
  `anthropic-cache-write.sse`, `anthropic-cache-read.sse`, `openai-cached.sse`, `anthropic-thinking.sse`; effort
  mapping per model; image building and downscaling; chart data tables; reply-language prompts; Test results;
  settings persistence; ribbon collapse order), per-app tests (alt text through the editor, chart / picture actions),
  e2e `packages/e2e/tests/ai.spec.ts` "AI assistant round 2 (P9-A1)" against `support/aiMock.ts` (the mock now
  simulates cache writes/reads and streams thinking summaries).

## v3 as built (P9-A2, 2026-10-18)
- **Per-action overrides** – `AiSettings.actionOverrides[provider][actionId] = { model?, effort? }`
  (`settings.ts`, lenient parsing), resolved by `overrides.ts` `resolveAction` (model = pin or the general model;
  effort = pin or the setting, then raised to `AiAction.effort`; none where the model takes no effort). The controller
  records `model` / `modelPinned` on the turn at the start, so the panel shows the effective model while it streams.
  Settings › AI › Actions lists `ai.actionList()` (set by the mounted panel: the free prompt + the app's chips).
- **Conversation export** – `export.ts` `conversationMarkdown(turns, {app, provider, now})`: title, date, provider, per
  turn the prompt, context, model / reasoning / tokens (cache), `[Picture sent: <label>]` placeholders (never image
  data), the answer (structured results as a JSON block), errors, stopped turns; localized (en / de keys `ai.export.*`).
  `saveTextFile`: the desktop shell's `export_file` when it has one (Show; it does not bind the document), otherwise a
  browser/webview download. Not `Backend.saveFile`: that one writes over the document's file or remote connection and
  re-binds it. Write and Calc shells have no `export_file` yet (ROADMAP: add it, as Show has) – there the webview's
  download is used.
- **`reasoning_effort`** – `openai.ts`: `AiRequest.effort` → `reasoning_effort` (low / medium / high as is; Off =
  `minimal` on api.openai.com, `none` on other servers); only for models in `AiSettings.reasoningModels` (checkbox
  "This model accepts reasoning_effort", like the vision flag). A server that rejects it gets one retry without it
  (`OPENAI_OPTIONAL`, remembered for the session).
- **Errors** – `errorParts(e)` → `{text, detail}`: `badResponse` messages of the providers and `schemas.ts` map to
  `ai.err.bad.*` sentences (`translateBadResponse`); unknown ones show only the localized head. The raw text (and the
  provider's own message for the other kinds) is `AiTurn.errorDetail`, shown in a collapsed "Details".
- **Ribbon** – Write and Calc no longer override the AI group's `collapsePriority` (it is `-1`, last).
- **Tests** – `ai/polish.test.ts` (override resolution, export format, `reasoning_effort` mapping, error translation),
  `ui/ui.test.tsx` (model line, copy, Actions table), e2e `ai.spec.ts` "AI assistant polish (P9-A2)".

### Local models (Ollama, LM Studio, other OpenAI-compatible servers)
Provider "OpenAI-compatible", no key needed. The requests come from the desktop app's webview (`tauri://localhost` on
Linux/macOS, `http://tauri.localhost` on Windows), so the server must allow that origin (CORS).
- **Ollama**: base URL `http://localhost:11434/v1`. Ollama allows `localhost` origins and `tauri://*` by default; if the
  panel says the server "does not allow requests from this page", set `OLLAMA_ORIGINS="tauri://localhost,http://tauri.localhost"`
  (or `*`) and restart Ollama (systemd: `systemctl edit ollama` › `Environment=`; macOS: `launchctl setenv`; Windows:
  user environment variable). Model ids are the tags from `ollama list` (`llama3.2`, `qwen3:8b`, `gpt-oss:20b`).
- **LM Studio**: start the local server (Developer tab), base URL `http://localhost:1234/v1`, turn on "Enable CORS".
  Model ids are the ones the server lists (Test shows them).
- **Which models work**: structured actions (Formula, Transform range, Chart, Outline, Layout, Table, Draft) use the
  JSON-schema `response_format`, so the model and server must support structured output (Ollama: any model, enforced by
  grammar; LM Studio: models with "structured output"; llama.cpp-based servers: yes). Small models (< 7B) often return
  schema-valid but weak results – prefer the text actions (Rewrite, Fix grammar, Summarize) with them. Tool calling is
  not used. Pictures only with vision models (llava, qwen2.5-vl, gemma3 …) marked "This model accepts pictures".
  `reasoning_effort` only for reasoning models (gpt-oss; Ollama also accepts `none` for qwen3 / deepseek-r1 style
  thinking) marked "This model accepts reasoning_effort". Local servers do not cache documents across requests.

### Desktop smoke with a real key (owner checklist)
Use a desktop build (`pnpm --filter <app> tauri dev` or an installed build) and your own Anthropic key; about 20 short
requests, a few cents with Sonnet 5.5.
1. File › Options… › AI: enable, paste the key, Model Claude Sonnet 5.5, **Test** → "Connected. The provider lists N
   models. claude-sonnet-5-5 answered." Change the model to `claude-sonnet-5-5-x` (Other…) → Test → "The key works, but
   … failed – model or request: …". Put back Sonnet 5.5; enter a wrong key → "Test failed – API key: …". Save the
   right key.
2. Write: paste 2–3 pages of text, open the Assistant (Ctrl+Shift+A), tick **Include whole document**, ask "Summarize
   section 2", then "Which numbers are mentioned?" → the second turn shows "… from cache" (> 0) in its usage line. Edit
   the document and ask again → "The document changed since the last question: sent again."
3. Reasoning: Options › AI › Reasoning **High** → Fix grammar on a paragraph → a "Thinking…" expander (collapsed) with
   a readable summary; Replace selection inserts only the corrected text. Set **Off** → no expander. Repeat once with
   Opus 5.5 and Haiku 5.5 (Off must not fail: Opus 5.5 runs at effort low, Haiku with thinking disabled).
4. Write: insert a picture, select it → **Describe picture → alt text** → Set as alt text → right-click › Edit Alt Text
   shows it. Attach selected picture + ask "What colours are in it?".
5. Calc: a small table + a column chart, select the chart → **Explain this chart** → the answer quotes the table's
   values → Insert as note → the note appears at the chart's top-left cell.
6. Show: **Attach current slide as image** + "What could be improved on this slide?"; select a chart → Explain this
   chart → Add to speaker notes.
7. View › Language › Deutsch → ask a free question in English → the answer comes in German; Fix grammar on an English
   paragraph keeps it English.
8. Optional, OpenAI-compatible (e.g. Ollama with `llava`): attach a picture without "This model accepts pictures" →
   the panel refuses before sending; tick it → the picture is sent.
