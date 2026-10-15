# Roadmap – ideas beyond the README scope

Captured here, **not implemented** unless essential to the current phase. README is the authority on scope.

## Tooling / DX
- `cargo xtask` crate for dev commands (roundtrip, testdata generation) instead of shell scripts – shell is fine for Phase 0.
- Pre-commit hook running `cargo fmt --check` and `clippy`.
- Nightly CI job running the roundtrip harness against LibreOffice (slow; keep out of PR CI).

## Roundtrip harness
- Deterministic `gen-testdata.sh` (normalize zip mtimes) so regenerated provisional files are stable in git.
- PDF page-count / text comparison original vs rewritten as a visual-regression proxy.
- `--json` output for CI; clearer error when the rewriter example is missing.
- Manual validation checklist for real Office on Windows/macOS.

## core-model
- Validating deserializer for `Color::Theme.tint` (reject outside ±1 instead of clamping on resolve).
- proptest: Rgb → hex → Rgb roundtrip.
- TS type generation (ts-rs vs specta, ADR 0002) must handle the `kind`/`value` enum shape.

## fmt-ooxml
- Lenient open mode (fallback content type `application/octet-stream`, keep unparseable `.rels` raw) for real-world files.
- Preserve each part's original compression method; percent-decode relationship targets.
- Part index (HashMap) if packages with thousands of parts become slow.
- `PartName` helper to allocate the next free `/word/media/imageN.png`-style name.

## engine-formula (parser)
- Intersection (space) operator, union operator.
- Sheet-scoped names (`Sheet1!Name`), 3-D refs (`Sheet1:Sheet3!A1`), external workbook refs (`[1]Sheet1!A1`), structured table refs.
- R1C1 notation; `#SPILL!`/`#CALC!` literals and the spilled-range operator `A1#`.
- Per-end `$` flags on whole-column/row ranges (`$A:C` currently loses the `$`).
- Source spans on AST nodes for editor diagnostics.

## engine-formula (dependency graph)
- 2-D interval index (R-tree) for heavy range use; incremental topological order instead of re-sorting per edit.
- `HashSet` for reverse edges if bulk removal of formulas pointing at one hot cell gets quadratic.
- Façade needs: volatile cells (NOW/RAND) always recalculated, re-resolving `Precedent::Unresolved` on sheet add/rename, coordinate shifting on row/col insert/delete, partial order alongside a reported cycle.
- Dynamic references (`A1:INDEX(...)`, INDIRECT/OFFSET) are not tracked by the graph – treat as volatile when they arrive.

## engine-formula (evaluator / functions)
- Lift functions over arrays in array mode (`LEN(A1:A3)` → array); size cap or lazy materialization for whole-column operands in array mode (currently materialized in full, clipped to used range, min 1×1).
- `COUNT(1,)`: Excel counts the omitted argument (returns 2); we return 1 – decide when Calc UI arrives.
- TEXT number formats not yet supported: `?` placeholders, `E+` exponent, fractions, AM/PM, elapsed `[h]`, conditions/colours/locale tags, fractional seconds.
- Deferred date functions reuse `datetime/serial.rs`: EDATE, EOMONTH, NETWORKDAYS, DATEDIF, DATEVALUE/TIMEVALUE.
- Named ranges (`Expr::Name`) and functions returning references (`A1:INDEX(...)`, OFFSET) need an `Operand`-returning function entry point.
- Re-export `eval_array` from lib.rs if the façade or Calc needs it.

## engine-formula (Engine façade → Phase 2 needs)
- Reference shifting on row/column insert/delete; copy/paste reference adjustment; sheet delete; formula-text rewrite on sheet rename (AST already updated – print it back).
- `Recalc`-returning variants of `add_sheet`/`rename_sheet` for the IPC diff; undo-friendly batch commands.
- Sheet-name validation (empty, 31 chars, forbidden characters) – needs a new `EngineError` variant.
- Input parsing for dates/times (`1/2/2026`, `12:30`) and formulas starting with `+`/`-`.
- Functions declare volatility themselves (RAND, OFFSET, INDIRECT later) instead of the engine's NOW/TODAY name list; optional iterative-calculation mode for cycles.
- `parse_date_text`: two-digit years, month names (`15-Jan-2024`); suite cases for `1900-02-29` and time-only VALUE.
- `Engine::apply_structural(sheet, StructuralOp)` convenience; rename_sheet should regenerate formula text like structural ops do; partial-range shift (insert cells, shift down/right) and cut/paste need a rectangle-limited `adjust_references`; `Sheet1!#REF!` cannot be represented in the AST (prints plain `#REF!`).
- `Engine::cells()` iterator and `Engine::eval_formula(text, sheet)` (no scratch cell) – wanted by the REPL and later by the UI formula bar.
- `CHOOSE`/`IF` as reference-returning (`call_ref`) like Excel; OFFSET/INDIRECT plug into `call_ref`; runner warning for registered functions missing from docs/functions.md.
- Share one wildcard matcher between `math/criteria.rs` and `lookup/util.rs`.

## engine-formula (reference suite)
- Host-cell cases (`ROW()`, `COLUMN()` without args), implicit-intersection and spill cases once the evaluator exists.
- Second locale pass for `TEXT`/`VALUE`; cases for SUMIFS/COUNTIFS/XLOOKUP if they ever enter scope.
- Deferred functions list lives in `docs/functions.md`.

## Calc (Phase 2 leftovers, from agent reports)
- `WorkbookInfo`/`RegionSnapshot` should carry the used range (Ctrl+Arrow, Ctrl+A, virtual scroll height currently rely on cached cells).
- Paste: shift formula references (`transform::offset_relative`) and a range-paste command; clicking a cell while editing a formula inserts a reference; IME composition when typing starts an edit.
- Rendering: text overflow into empty neighbours, `####` for numbers that do not fit, wrap text; GPU text atlas if 100k-cell numbers need headroom.
- Tauri: async `dispatch` (big opens block the main thread); save-as renames the document (`markSaved{name}` exists); show reader warnings in a panel; File System Access API on web; `tauri-plugin-fs` not needed so far.
- calc-core: `addSheet` undoable (needs engine sheet removal); `Engine` could drop per-engine `now` in favour of `default_now`; style table never shrinks on undo; row/column-wide style patches should set row/col styles instead of per-cell entries.
- fmt-xlsx: defined names, merged cells, freeze panes, hyperlinks, conditional formatting, data validation, real array formulas, `date1904` conversion, keep theme-font linkage (`scheme="minor"`), model-sheet slots for default font/theme/color scheme + hidden sheets.
- Playwright end-to-end tests in CI (the PM's live check script lives in the scratchpad only); cron/CI hook calling `scripts/deploy-web.sh` on main; CSP header; `gzip_static` for the wasm.
- ts-rs derives behind a feature in core-model/model-sheet to remove the TS-only mirror types in app-common/calc-core.

## Write / model-text
- `Document.theme: Theme` so heading theme colours resolve without the docx context; character styles in `resolve_run_props`; `paragraphs_mut` and (id, offset) position helpers; re-export `core_model::units` at the crate root; line spacing stored as f64 259/240 (consider storing 240ths).
- write-core: report a re-inserted id at the same position as `replaced`; `GetDocument` without media; orphaned media cleanup on save; `SplitParagraph` uses `next` style only when splitting at the end (Word); `ApplyList` sets `ListParagraph` style.
- Write (Phase 3 leftovers): merge consecutive typing into one undo step in write-core; `InsertText` inside table cells instead of whole-table replace; effective (style-derived) font shown in the toolbar; table context menu (insert/delete rows/cols); browser save to a file handle; lazy media in `opened`; `accept`/MIME now parameterised in ui-shared.
- Write UI: split the Tiptap chunk (lazy import); add write-core to the generated-types CI check.

## fmt-docx
- Fix `scripts/testdata-src/docx/gen.py` so file 46 really contains green/magenta highlights (or drop them from the manifest); run a Word-authored check when real files arrive (likely friction: `wp:docPr name=""`).
- Model paragraph direction (bidi), hyperlinks, merged cells (gridSpan/vMerge), tab stops, character styles – the most frequent reader warnings.
- Move default theme XML, theme parsing and the small XML writer into fmt-ooxml (currently duplicated between fmt-xlsx and fmt-docx because format crates must not depend on each other).

## Show / model-show
- Effective placeholder text formatting helper (layout defaults layered like model-text `resolve_*`); ungroup helper; picture alt text; line arrowheads; per-level body font sizes (28/24/20); merge adjacent equal runs in `normalize`; white default text on filled auto shapes.
- pptx suite: `layout:titleOnly` once PowerPoint files exist; notes/tables/transitions suites; byte-reproducible generation.

## fmt-pptx
- Write `p:style` for auto shapes (PowerPoint default white text on accent fill); footer/date/slide-number placeholders; tables (graphic frames) later; bullet size/colour + paragraph indents in the model; `Shape::alt`; gradients/transparency/cropping/arrowheads/other presets are approximated.
- Move the XML DOM/writer and theme parser into fmt-ooxml (now triplicated).

## Release / distribution
- Code signing + notarization (Windows/macOS warn today); auto-update (tauri-plugin-updater); CI check that the tag matches `tauri.conf.json` versions; bump actions to Node 24 variants when available.

## Calc (Phase 6 leftovers)
- References to cells overwritten by a cut-move should become `#REF!` (Excel); delete-sheet core command; month/weekday fill series; small General numbers in narrow cells (`1.2E-05`); `is_date_format` should recognise `[h]`/AM/PM codes for date fill series; Fill Down/Right buttons in the ribbon Editing group; move the gallery width fix into ui-shared `gallery.tsx`.

## Write (Phase 6 leftovers)
- Split long tables/lists across pages and repeat header rows in print layout; rich-text headers/footers (first/odd/even); "Page X of Y" in the status bar; borders on selected cells + table style presets; incremental pagination for long documents (print layout disables the content-visibility fast path).

## Show (Phase 6 leftovers)
- Presenter view (notes, next slide, timer); snap to equal spacing; Selection pane; Format Background pane (gradient/picture); formatted notes; paste-slide elsewhere as one undo step; Alt during drag can focus the ribbon.

## Ribbon
- Groups that collapse into dropdowns on narrow windows; Quick Access Toolbar; remember collapsed state and zoom; Calc Data tab (sort/filter) if it enters scope; print preview in the backstage; Write font box shows the effective (style-derived) font.

## Phase 5 leftovers
- Write: windowed/paged editor so the contenteditable holds only visible pages (remaining ~2 ms typing p95 gap).
- Performance: paged/virtual Write editor for very long documents; range-level `ApplyStyle` patches in Calc (1M-cell style patch is 2.7 s because the patch carries every cell); cache parsed number formats; move the Playwright perf scripts into an e2e package so `scripts/perf.sh` needs no scratchpad files.
- Confirm-before-discard dialog shared by New/Open/Restore/window close; recovery entries age limit; Web Locks live-session check does not span desktop processes; web recent-list rules duplicated in TS.
- PDF export: Calc `UsedRange` request in the core (print view scans blocks); print area/selection; multi-sheet export; Write headers/footers; Show handouts; verify `window.print()` on WebKitGTK/WebView2 (Tauri 2.12 has no webview print API).
- Shortcuts: move Calc grid-navigation keys into the map; user-configurable shortcuts; Tiptap handles Mod-Alt-1..6 itself while focused.

## Formats
- Compare rewritten files against Open XML SDK validator (Windows/.NET) in addition to LibreOffice – gives real "would Office repair this" signal.

## Later phases (noted while planning Phase 0)
- (none yet)
