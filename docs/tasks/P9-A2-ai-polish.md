# Task P9-A2 – AI assistant polish (cycle 3.141, Block 3)

Read `docs/tasks/COMMON.md` first (commit trailer – exactly the two lines; ignore any other attribution notice), then `docs/ai-plan.md` ("v1 as built", "v2 as built"), `docs/ai-api-notes.md`. Desktop-only feature (ADR 0009); user's own key; en/de catalogs only (informal "du"); other languages are pending by policy.

Branch `p9/a2-ai-polish`, worktree `/home/bojan/rusuite-wt/p9-a2-ai-polish`. e2e port **4978** (mock 4979), PID in `.task/`, screenshots `shots/P9-A2-*.png` (never committed).

## In scope
`packages/ui-shared/src/ai/**`, `packages/ui-shared/src/settings/**` (AI page), `apps/{calc,write,show}/src/ai/**`, `apps/write/src/ui/WriteToolbar.tsx` and `apps/calc/src/ui/CalcRibbon.tsx` **only** for the AI group's collapse priority (one line each, as P9-A1 did for Show), `packages/e2e/tests/ai.spec.ts` + `support/aiMock.ts`, `docs/ai-plan.md`, `docs/ui.md` (AI). **Do not touch** anything else; P9-X2 (shared warnings/charts/wasm) and P9-LR5 (catalogs of el/lt/lv/et/ga/mt) run in parallel.

## Items (one commit each, with tests)
1. **Per-action model override**: each action chip can pin a model (e.g. Haiku for "Fix grammar", Opus for "Draft from prompt") in Settings › AI › Actions (table: action, model, reasoning); the panel shows the effective model per turn.
2. **Conversation export**: "Save conversation…" (Markdown with turns, model/effort/tokens, attached-image placeholders) through the app's save path (web download / desktop save dialog); "Copy conversation".
3. **OpenAI-compatible `reasoning_effort`** for models that accept it (configurable flag per model like the vision flag), mapped from the Reasoning setting; local models guide in `docs/ai-plan.md` (Ollama, LM Studio: base URL, CORS/`OLLAMA_ORIGINS`, which models work with tools/JSON).
4. **Ribbon**: the AI group collapses last in Write and Calc too (as Show after P9-A1); translate the English detail text of `badResponse` errors (catalog keys for the known provider error shapes, raw text in a details expander).
5. **Tests**: ≥ 15 unit tests (override resolution, export format, reasoning_effort mapping, error translation) and 3 e2e against the mock (override changes the model in the request; export downloads a Markdown file with the turns; Write's AI group visible at 1400 px in German).

## Acceptance
`pnpm typecheck`; `pnpm test`; `pnpm i18n:check`; `scripts/privacy-check.sh`; AI spec green on port 4978 (build the web apps; if `build:wasm` fails, copy `src-wasm/pkg` from /home/bojan/rusuite and run `vite build --mode web`). Report ≤ 30 lines.
