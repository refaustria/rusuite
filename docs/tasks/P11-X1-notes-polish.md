# Task P11-X1 – Notes: polish, follow-ups, e2e stability

Read `docs/tasks/COMMON.md` (incl. "Cycle 3.14159"), the spec, `docs/plan-3.14159.md`, `STATUS.md` (cycle 3.14159
section: all follow-ups listed there), `docs/ui.md` (Notes), and the Notes code (`apps/notes/**`, `crates/notes-*`,
`crates/model-notes`, `services/notes-relay`).

Branch `p11/x1-notes-polish`, worktree `/home/bojan/rusuite-wt/p11-x1-notes-polish`. Model: Opus. e2e port 5142.
**Do NOT spawn sub-agents** (owner rule: one agent at a time). Commit often (one commit per item group).

## Items
1. **Owner-style walkthrough** (web, 1400 px and 1024 px, light + dark, en + de): new notebook → sections/section
   groups → pages/subpages → typing, lists, tables, pictures, tags/to-dos, Tasks view, search, page links, history,
   canvas + ink, import/export, share dialog, print. Screenshots `shots/P11-X1-*.png` (not committed). Fix every
   visual or interaction glitch you find that is in reach (alignment, focus rings, empty states, wording, keyboard
   navigation, tooltips with shortcuts, consistency with Write/Calc/Show ribbons and backstage). List the ones you
   left with reasons.
2. **Follow-ups from earlier tasks:**
   - `docs/notes-format.md` §5/§7: binary interface is stale (apply_import, separate convert module) – update.
   - Conversion runs on the main thread → move import/export conversion into a Web Worker (the convert wasm loaded in
     the worker); progress + cancel keep working; e2e still green. On desktop the native path stays.
   - Main wasm +0.5 MB gz vs N1: find the cause (twiggy / `wasm-opt` / features); fix if cheap, else explain.
   - Sharing: updates > 1 MB at first share are rejected – chunk the initial upload (snapshot split or several
     envelopes within the relay limit), with a test with a > 3 MB notebook (images as blobs stay separate).
   - Desktop: "Remove local data" also offers to delete the notebook folders (explicit confirmation, lists paths);
     AI key without OS keyring → app-data file fallback with the same warning as the other apps; desktop CSP: allow
     the user's configured custom AI host origin (as the other desktop apps do – check how they handle it); desktop
     "Export PDF" like the other desktop apps (if they have a direct path; else leave print dialog and say so).
   - Permanent e2e: Notes ribbon fit (no overflowing labels) at 1024 px for fr, de, fi, hu, el.
   - e2e stability: Write `ai.spec.ts` "whole document is cached" intermittent timeout – find the cause and fix
     (test or app); run it 20× in a loop green.
3. **Large-notebook sanity** (review focus 5) re-measure after the above: open page < 300 ms, search < 100 ms with the
   500-page fixture; first share of a 500-page notebook completes (report time).

## Acceptance (worktree root)
`pnpm typecheck`; `pnpm test`; `pnpm i18n:check --strict` (new texts in all 24 languages – translate them yourself,
informal address); `scripts/privacy-check.sh`; `cargo fmt --all --check` + clippy/tests for touched crates; wasm
check for both notes wasm crates; `cargo check -p app-notes`; `pnpm --filter notes build:web`; full e2e with
`BASE_URL=http://127.0.0.1:5142` + your own serve.mjs (and a relay on 5143 for the sharing specs:
`NOTES_RELAY_PORT=5143 NOTES_RELAY_DIR=<tmp>`). Stop every server/relay by its real PID (`ss -ltnp`), confirm ports
free. `cargo clean` your target at the end if > 10 GB.

## In scope
`apps/notes/**`, `crates/notes-*`, `crates/model-notes`, `services/notes-relay` (chunking only if needed),
`apps/write/**` + `packages/e2e/**` for the ai.spec flake, `packages/ui-shared/**` (generic fixes only, say which),
`docs/{notes-format,ui,notes-sync-protocol}.md`.

## Report (≤ 50 lines): walkthrough fixes (count + highlights), each follow-up done/left, wasm size finding, perf
numbers, test results, rough edges left for later.
