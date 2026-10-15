# ADR 0004 – `model-sheet` wraps `engine-formula::Engine`; one cell store

- Status: accepted
- Date: 2026-10-15

## Context
`engine-formula::Engine` (Phase 1) already stores cell contents per sheet, the dependency graph and computed values. `model-sheet` must add what a spreadsheet document needs beyond values: cell styles, number formats, column widths, row heights, sheet metadata. Two stores for cell data would have to be kept in sync on every edit, insert/delete and load.

## Decision
- `model_sheet::Workbook` **owns** an `engine_formula::Engine` and delegates all cell *content* (constants, formulas, computed values, recalculation, sheet names/ids) to it. `model-sheet` stores only what the engine does not: a deduplicated `StyleTable` (`StyleId` per cell, `StyleId(0)` = default), per-sheet column/row dimension maps, and workbook/sheet metadata.
- Structural operations (insert/delete rows/columns) are implemented in the engine for contents and formulas (`Engine::insert_rows` etc., with Excel reference-adjustment rules in `engine_formula::transform`) and in `model-sheet` for styles and dimensions; `Workbook` calls both in one method.
- Cell styles reuse `core_model::RunProperties` for the font part (ADR 0003: shared model), so Write/Show text formatting and Calc cell fonts are the same type.
- Number formats are stored as format-code strings (`"General"`, `"0.00"`, `"yyyy-mm-dd"`); `fmt-xlsx` maps the Excel built-in ids ↔ codes at the file boundary.

## Consequences
- `engine-formula` remains usable standalone (README goal) and gains structural operations it would need for any host anyway.
- `fmt-xlsx` reads into / writes from `Workbook` only; it never talks to the engine directly except through `Workbook` (which exposes batch loading via the engine's `begin_batch/end_batch`).
- View state (selection, active cell, scroll) is not part of `Workbook`; it belongs to `app-common`/the UI.

## Alternatives rejected
- A separate dense/sparse cell grid in `model-sheet` with the engine fed through `CellProvider`: duplicates storage and makes undo/redo and structural edits two-phase.
- Styles inside the engine: the engine is format-agnostic and should stay small.
