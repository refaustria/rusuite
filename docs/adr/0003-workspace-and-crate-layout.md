# ADR 0003 – Workspace and crate layout

- Status: accepted
- Date: 2026-10-15

## Context
The README prescribes a Cargo workspace with ten crates and a pnpm workspace for the frontend. This ADR fixes the dependency direction and a few conventions so parallel work does not entangle crates.

## Decision
- **Dependency direction (strict, enforced by review):**
  `fmt-ooxml` → nothing project-internal.
  `core-model` → nothing project-internal.
  `model-text` / `model-sheet` / `model-show` → `core-model`.
  `engine-formula` → `core-model` only (no `model-sheet`; the engine is fed cell values through a trait).
  `fmt-docx` / `fmt-xlsx` / `fmt-pptx` → `fmt-ooxml` + the matching model crate.
  `app-common` → `core-model` + model crates. Tauri apps (Phase 2+) → `app-common` + the fmt crates.
  Nothing depends on an `app-*` crate. Format crates never depend on each other.
- **Error handling:** each crate exposes its own `Error` enum via `thiserror`; no `anyhow` in library crates.
- **Serde everywhere in model crates** so that models double as IPC payloads and snapshot fixtures.
- **Tests:** unit tests next to code; integration tests in `crates/<name>/tests/`; snapshot tests with `insta`; reference files under `testdata/` only (never inside a crate).
- **Lints:** `#![forbid(unsafe_code)]` in every crate, `clippy::all` as warnings turned into errors by CI's `-D warnings`.
- **Frontend:** `packages/ui-shared` plus one package per app under `apps/`; pnpm workspace; Vitest for unit tests.

## Consequences
- `engine-formula` can be tested and shipped standalone (README goal).
- Adding a format feature means touching exactly one `fmt-*` crate and one model crate.

## Amendment 2026-10-15 – `fmt-ooxml` → `core-model`

`fmt-ooxml` now depends on `core-model`: the shared theme part parser/writer (`fmt_ooxml::theme`) produces and consumes `core_model::Theme`, which removed three private copies from `fmt-xlsx`, `fmt-docx` and `fmt-pptx` (P7-3). `core-model` is a leaf crate with no project-internal dependencies, so no cycle is possible and the rest of the direction rules stand. The dependency table in `docs/architecture.md` is authoritative for the current graph.
