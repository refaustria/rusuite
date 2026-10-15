# Task P3-1 – `model-text` document model (+ `core_model::units`)

Branch `p3/model-text`, worktree `/home/bojan/rusuite-wt/p3-model-text`. Scope: `crates/model-text/**` (deps: core-model, serde, thiserror; dev: insta, serde_json), `crates/core-model/src/units.rs` (+ `pub mod units;`). Read first: README (Rusuite Write scope), ADR 0001, 0003, 0006; `crates/core-model/src/*.rs`; `crates/model-sheet/src/{style.rs,snapshot.rs}` (conventions: camelCase serde, `merged_with`, snapshot DTO).

## `core_model::units`
`Twips(i32)`, `Emu(i64)`, `Pt(f64)` with `Copy, Eq/Ord where exact, Hash, serde as plain numbers`; conversions: `Twips::from_pt`, `to_pt`, `Emu::from_twips` (1 twip = 635 EMU), `Emu::from_pt` (12700), `Emu::from_cm`/`from_inch`, `to_px96` (96 dpi, f64); unit tests with reference values (1 inch = 1440 twips = 914400 EMU; 12 pt = 240 twips).

## Types (modules `block.rs`, `inline.rs`, `props.rs`, `style.rs`, `numbering.rs`, `page.rs`, `media.rs`, `document.rs`, `snapshot.rs`)
All serde camelCase, `Debug, Clone, PartialEq`; enums with data tagged `kind`.
```rust
pub struct NodeId(pub u64);
pub enum Block { Paragraph(Paragraph), Table(Table) }
pub struct Paragraph { pub id: NodeId, pub props: ParagraphProperties, pub inlines: Vec<Inline> }
pub enum Inline { Run(Run), Image(InlineImage), Break(BreakKind) }
pub struct Run { pub props: RunProperties /* core_model */, pub text: String }
pub enum BreakKind { Line, Page }
pub struct InlineImage { pub media: MediaId, pub width: Emu, pub height: Emu, pub alt: Option<String>, pub name: Option<String> }
pub struct Table { pub id: NodeId, pub props: TableProperties, pub rows: Vec<TableRow> }
pub struct TableRow { pub id: NodeId, pub props: RowProperties, pub cells: Vec<TableCell> }
pub struct TableCell { pub id: NodeId, pub props: CellProperties, pub blocks: Vec<Block> }   // always ≥ 1 paragraph
pub struct TableProperties { pub width: Option<TableWidth /* Auto | Twips | Pct(u16 /*50ths of %*/) */>, pub col_widths: Vec<Twips>, pub borders: Option<TableBorders { top, left, bottom, right, inside_h, inside_v: Option<BorderSide> }>, pub cell_margins: Option<CellMargins> }
pub struct RowProperties { pub height: Option<RowHeight { value: Twips, rule: AtLeast|Exact }>, pub header: bool }
pub struct CellProperties { pub width: Option<TableWidth>, pub shading: Option<Color>, pub borders: Option<TableBorders>, pub vertical_align: Option<VAlign{Top,Center,Bottom}> }
pub struct BorderSide { pub style: BorderStyle{Single,Double,Dashed,Dotted,Thick,None}, pub width: Twips /* eighths of a point in docx – convert */, pub color: Color }
pub struct ParagraphProperties { pub style: Option<String> /* style id */, pub alignment: Option<Alignment{Left,Center,Right,Justify}>, pub indent: Option<Indent { left: Option<Twips>, right: Option<Twips>, first_line: Option<Twips>, hanging: Option<Twips> }>, pub spacing: Option<Spacing { before: Option<Twips>, after: Option<Twips>, line: Option<LineSpacing{ Multiple(f64) | Exact(Twips) | AtLeast(Twips) }> }>, pub numbering: Option<NumberingRef { num_id: u32, level: u8 }>, pub keep_next: Option<bool>, pub page_break_before: Option<bool>, pub run_defaults: Option<RunProperties> /* paragraph mark formatting, rarely needed; keep */ }
```
- `ParagraphProperties::merged_with` / `is_empty` like `RunProperties`.
- `StyleSheet { pub defaults: Defaults { run: RunProperties, paragraph: ParagraphProperties }, styles: Vec<Style> }`, `Style { id: String, name: String, kind: StyleKind{Paragraph, Character, Table}, based_on: Option<String>, next: Option<String>, paragraph: ParagraphProperties, run: RunProperties, is_default: bool }`; `get(id)`, `insert`, `resolve_paragraph(style_id) -> ParagraphProperties` (walk `based_on`, cycle-safe), `resolve_run(style_id) -> RunProperties`. `StyleSheet::office_defaults()` = Normal, Title, Heading1–6 (Word's default: Calibri Light headings in accent1/dk2-ish colors – use theme colors: Heading 1 `Accent1` tint -0.25 → Word uses `2F5496` = accent1 darker 25%, size 16pt; Heading 2 13pt; Heading 3 12pt; Title 28pt Calibri Light dk2-ish `000000`? – take the values from a real Word 2016+ styles.xml: Title: 28pt, spacing after 0, Calibri Light; Heading 1: 16pt, color 2F5496 (theme accent1 shade), spacing before 240 twips, keepNext; Heading 2: 13pt, 2F5496; Heading 3: 12pt, 1F3763; Normal: Calibri 11pt, spacing after 160 twips, line 259 auto (= Multiple(1.08))). List Paragraph style (indent left 720).
- `NumberingDef { id: u32, levels: Vec<Level { kind: LevelKind{Bullet, Decimal, LowerLetter, UpperLetter, LowerRoman, UpperRoman}, text: String /* "%1." or "•" */, start: u32, indent: Option<Indent>, font: Option<FontFace> /* Symbol for bullets */ }> }`, `Numbering { defs: Vec<NumberingDef> }` with `bullet_default()` and `decimal_default()` constructors (9 levels each, Word's default indents 720/1440/…).
- `PageSetup { width: Twips, height: Twips, margins: Margins { top, right, bottom, left, header, footer: Twips }, orientation: Portrait|Landscape }` with `a4()` and `letter()` (Word defaults: margins 1440, header/footer 708).
- `MediaStore { HashMap<MediaId, Media { content_type: String, data: Vec<u8> }> }`, `MediaId(u32)`, `insert(content_type, data) -> MediaId` (dedup by content hash), serde via base64 in the snapshot (add `base64` dep? – no: serialize `data` with `serde_bytes`-style `Vec<u8>` default (JSON array) is too big; use a custom serializer to base64 WITHOUT a new crate: implement a tiny base64 encoder/decoder in `media.rs` (≈40 lines) with tests. Reason: keep deps minimal; calc-core already pulls `base64` – if you prefer reuse, add `base64` to model-text instead and say so).
- `Document { pub body: Vec<Block>, pub styles: StyleSheet, pub numbering: Numbering, pub page: PageSetup, pub media: MediaStore, next_id: u64 }` with `new()` (one empty Normal paragraph, office defaults, A4), `alloc_id()`, `find_block(NodeId) -> Option<&Block>` (recursive into tables), `find_block_mut`, `paragraphs() -> impl Iterator<&Paragraph>` (recursive, document order), `plain_text() -> String` (paragraphs joined by `\n`, tabs preserved, images as U+FFFC), `resolve_paragraph_props(&Paragraph) -> ParagraphProperties` (defaults → style → numbering level indent → direct), `resolve_run_props(&Paragraph, &Run) -> RunProperties` (defaults → paragraph style run → character style? (not in MVP) → direct), `normalize()` (merge adjacent runs with equal props, drop empty runs except keep one empty paragraph in empty cells/body), `word_count()`.
- Snapshot DTO `DocumentSnapshot` = the document itself (serde of `Document` directly is fine: ids persisted) – provide `to_json()/from_json()` and keep `next_id` consistent on load (max id + 1).

## Tests
- Units reference values; `Twips`/`Emu` serde as numbers.
- Style resolution: based_on chain (Heading1 → Normal), direct formatting wins, cycle in based_on does not loop.
- `normalize` merges runs and preserves text; `plain_text` with image/break/tab.
- `insta` JSON snapshots: `Document::new()`, a document with heading + bulleted list (2 items, level 0/1) + a 2×2 table with a shaded header row + an inline image; `StyleSheet::office_defaults()`.
- Media dedup; base64 roundtrip incl. padding cases.
- `cargo check -p model-text --target wasm32-unknown-unknown`; rustdoc `-D warnings`.
