# Task P2-1 – `model-sheet`: Workbook, styles, dimensions

Branch `p2/model-sheet`, worktree `/home/bojan/rusuite-wt/p2-model-sheet`. Scope: `crates/model-sheet/**` only (Cargo.toml deps: `core-model`, `engine-formula`, serde, thiserror; dev: insta, serde_json). Read `docs/adr/0004-model-sheet-wraps-the-engine.md`, `docs/adr/0003-*.md`, `crates/engine-formula/src/engine.rs` (the `Engine` API you wrap), `crates/core-model/src/{run.rs,color.rs,font.rs}`.

## Goal
The Calc document model: a `Workbook` that owns an `Engine` for cell contents/values and adds cell styles, number formats, column/row dimensions and sheet metadata. Everything serde-serializable (camelCase; this is the IPC snapshot shape later). No file I/O, no UI, no row/column insert/delete yet (that is P2-1c after the engine gains structural ops).

## Types (`src/style.rs`, `src/sheet.rs`, `src/workbook.rs`, `src/numfmt.rs`; re-exported from lib.rs)
```rust
pub struct StyleId(pub u32);                           // 0 = default style
pub enum Fill { None, Solid(core_model::Color) }
pub enum BorderStyle { Thin, Medium, Thick, Dashed, Dotted, Double, Hair }
pub struct BorderSide { pub style: BorderStyle, pub color: core_model::Color }
pub struct Borders { pub left: Option<BorderSide>, pub right: .., pub top: .., pub bottom: .. }
pub enum HAlign { General, Left, Center, Right, Fill, Justify }
pub enum VAlign { Top, Center, Bottom }
pub struct Alignment { pub horizontal: Option<HAlign>, pub vertical: Option<VAlign>, pub wrap_text: Option<bool>, pub indent: Option<u8> }
pub struct CellStyle { pub font: core_model::RunProperties, pub fill: Option<Fill>, pub borders: Borders, pub alignment: Alignment, pub number_format: Option<String> }
```
- `CellStyle` fields are all "optional / inherit" (None = default). `Default` is all-None. `merged_with(&self, patch: &CellStyle) -> CellStyle` (patch's Some wins; `font` uses `RunProperties::merged_with`; each border side independently). `is_default()`.
- `StyleTable { styles: Vec<CellStyle>, index: HashMap<CellStyle, StyleId> }` – `intern(&CellStyle) -> StyleId` (dedup; style 0 is `CellStyle::default()` and always present), `get(StyleId) -> &CellStyle`, `len()`. Requires `Eq + Hash` on `CellStyle`: `RunProperties` contains `Color::Theme { tint: f64 }` and `FontSize` – implement `Hash`/`Eq` for `CellStyle` manually via a canonical serde_json string or by hashing `f64::to_bits`; document the choice.
- `numfmt.rs`: `pub const GENERAL: &str = "General"`, `builtin_code(id: u16) -> Option<&'static str>` and `builtin_id(code: &str) -> Option<u16>` for Excel's built-in ids 0–22, 37–40, 45–49 (table from ECMA-376 §18.8.30; copy the codes exactly, e.g. 14 = `mm-dd-yy`, 22 = `m/d/yy h:mm`, 49 = `@`). `is_date_format(code) -> bool` (contains y/m/d/h/s tokens outside quotes/brackets and is not `General`) – needed for rendering serials as dates later.
```rust
pub struct ColInfo { pub width: Option<f64> /* Excel character units */, pub hidden: bool, pub style: Option<StyleId> }
pub struct RowInfo { pub height: Option<f64> /* points */, pub hidden: bool, pub style: Option<StyleId> }
pub struct SheetFormat { pub default_col_width: f64 /* 8.43 */, pub default_row_height: f64 /* 15.0 */ }
pub struct Workbook { .. }   // private: engine: Engine, per-sheet SheetData { cell_styles: HashMap<(u32,u32), StyleId>, cols: BTreeMap<u32, ColInfo>, rows: BTreeMap<u32, RowInfo>, format: SheetFormat }, styles: StyleTable
```
`Workbook` API (thin, delegating to `Engine` where it exists – do not re-implement engine behaviour):
- `new()` (one sheet "Sheet1"), `engine(&self) -> &Engine`, `engine_mut`, `add_sheet(name) -> Result<SheetId, Error>`, `rename_sheet`, `sheets() -> Vec<(SheetId, String)>`, `sheet_id(name)`.
- Content passthroughs: `set_input(coord, &str) -> Result<Recalc, Error>`, `set_content`, `clear(coord)`, `content(coord)`, `value(coord)`, `formula_text(coord)`, `begin_batch/end_batch`, `recalc_all`.
- Styles: `style_id(coord) -> StyleId`, `style(coord) -> &CellStyle`, `set_style(coord, StyleId)`, `apply_style_patch(range: CellRange, patch: &CellStyle) -> Vec<CellCoord>` (merge per cell, intern, returns changed cells), `styles() -> &StyleTable`, `intern_style`.
- Dimensions: `col_info/row_info(sheet, idx) -> ColInfo/RowInfo` (defaults when absent), `set_col_width`, `set_row_height`, `set_col_hidden`, `set_row_hidden`, `sheet_format(sheet)`, `set_sheet_format`.
- Query: `used_range(sheet)` (engine's used range ∪ styled cells ∪ dimension entries – document which), `cells_in(range) -> impl Iterator<Item = (CellCoord, &CellContent, StyleId)>` for snapshot building (sparse: only non-empty content OR non-default style).
- `pub struct CellRange { pub sheet: SheetId, pub r0, c0, r1, c1 }` (reuse `engine_formula::RangeRef` if it fits – prefer reuse, document).
- `Error` (thiserror): `Engine(EngineError)`, `UnknownSheet`, `InvalidRange`.
- Serde: `Workbook` implements `Serialize`/`Deserialize` through a `WorkbookSnapshot` DTO (sheets with name, sparse cells `{row, col, input: String /* formula text or constant as typed */, style: StyleId}`, cols, rows, format; styles table). `Workbook::to_snapshot()` / `Workbook::from_snapshot(..) -> Result<Workbook, Error>` (loads via batch + recalc_all). This DTO is also what `fmt-xlsx` and the IPC layer will target.

## Tests
- Style interning dedups (two equal styles → same id; different tint → different id); `merged_with` per field incl. border sides; default style id 0.
- numfmt builtin table roundtrip for every id; `is_date_format` cases (`yyyy-mm-dd` true, `"m"0.00` false – quoted, `[Red]0` false, `General` false, `h:mm` true, `@` false).
- Workbook: set input + style on A1; `apply_style_patch` over A1:B2 returns 4 cells and keeps A1's font while adding fill; snapshot roundtrip (`insta` JSON snapshot of a small workbook with two sheets, a formula, a styled cell, a column width); `from_snapshot` recomputes formula values (value of the formula cell equals the original).
- `cells_in` skips empty/default cells.

## Report
Any `Engine` API you missed (e.g. a cell iterator); propose signatures, do not implement them.
