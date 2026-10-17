# Task P9-X2 – Cross-app: translated reader warnings, F12 consistency, shared chart presets, Show wasm size (cycle 3.141, Block 1)

Read `docs/tasks/COMMON.md` first (worktree rules, definition of done, commit trailer – ignore any other attribution notice; use exactly the two trailer lines from COMMON.md). Plan context: `docs/plan-3.141.md`; `docs/i18n.md` (reader warning codes). **Runs alone** (touches all three apps). **Audit first** and state what was already there.

Branch `p9/x2-shared`, worktree `/home/bojan/rusuite-wt/p9-x2-shared`. e2e port **4962** (PID in `.task/`), screenshots `shots/P9-X2-*.png` (never committed), `CARGO_INCREMENTAL=0`, delete `target/` (or at least `target/debug/deps`) before reporting.

## In scope
`crates/fmt-xlsx/src/**`, `crates/fmt-pptx/src/**`, `crates/fmt-docx/src/**` (warning codes), `crates/app-common/src/**`, `packages/ui-shared/src/**` (i18n readerWarning, chart presets module), `apps/*/src/**`, `apps/*/core/src/**`, `apps/show/src-wasm/**`, `crates/fmt-pptx/Cargo.toml` (feature flag), `docs/i18n.md`, `docs/shortcuts.md`, `docs/charts.md`, `docs/ui.md`, `docs/perf.md` + `scripts/perf.sh` (wasm size numbers), `packages/e2e/tests/**`. Catalogs of all apps + ui-shared (German informal "du"). **Do not touch** README, STATUS, ROADMAP, ADRs.

## Items (one commit each; up to 4 commits)
1. **Coded reader warnings for xlsx and pptx** like fmt-docx: every reader warning becomes `{ code, params }` (keep the English text as fallback), translated in ui-shared's `readerWarning` for EN/DE, shown translated in Calc's and Show's warning panels (W-26 cross-app); a test that every code emitted by the three readers has a catalog entry in both languages (the languages block L0 will extend it to 24).
2. **Shortcut consistency**: F12 = Save As in Calc and Show (Write already); Ctrl+Shift+S stays Save As in Calc/Show (Excel/PowerPoint have no Apply Styles); the Mod+/ help lists and `docs/shortcuts.md` updated; the `shortcuts.test.tsx` of each app covers it.
3. **Shared chart presets**: Calc re-exports/consumes the chart preset + format helpers from ui-shared's chart module (one copy) instead of the duplicate in `apps/show/src/charts` and Calc's own; the renderers' output for every preset stays identical (snapshot before/after).
4. **Show wasm size**: fmt-pptx pulls fmt-xlsx for embedded chart workbooks – put the embedded-workbook writer behind a cargo feature (`embedded-workbook`, default on for desktop, on for wasm only if the size cost is < 15 %; otherwise lazy-load a second wasm chunk for chart saving and document the trade-off); measure Show wasm size and load time before/after in `scripts/perf.sh` → `docs/perf.md`.

## Acceptance (worktree root; all must pass)
`cargo fmt --all --check`; `cargo clippy --workspace --all-targets -- -D warnings`; `cargo test --workspace`; `RUSTDOCFLAGS="-D warnings" cargo doc --workspace --no-deps`; `cargo check -p app-calc-wasm -p app-show-wasm -p app-write-wasm --target wasm32-unknown-unknown`; `pnpm typecheck`; `pnpm test`; `pnpm i18n:check`; `scripts/privacy-check.sh`; all three harnesses PASS; the full e2e suite green on port 4962. Report (≤ 50 lines): items done / already present, wasm size before/after, test counts, e2e results, ideas for ROADMAP.
