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

## i18n follow-ups
- Locale-aware formula input/display (German `;`/`,`, function names) – owner decision pending; translated core messages via error codes; unused-key catalog check; wider gallery tiles for long German labels ("Überschri…"); Write Clipboard group overflow.

## Calc parity follow-ups
- QA deferred (P8-39): C-08 Format Cells needs Alignment/Font/Border/Fill/Protection tabs; C-13 Insert/Delete cells "shift cells" (core command); C-04 space intersection operator; C-05 circular reference shows #NUM! (Excel: 0 + warning); C-19 formula results do not inherit referenced cells' formats; C-21 Backspace should start an edit; C-22 German decimal commas (locale decision); C-23 typed formatted numbers do not widen default-width columns.
- Tables/data tools (P8-35): rewrite structured refs when a table column is deleted (formulas show #REF! today); custom table styles (dxf/tableStyles) and slicers; repeat columns + arbitrary title rows in print; Flash Fill, Consolidate, Auto Outline; .csv/.txt filter in the Tauri open dialog; fake backend lacks Subtotal and table row/col commands; ribbon checkboxes 24 px (guideline 32).
- Pivot UI (P8-33): Recommended PivotTables, Group, slicers/timelines, PivotChart, Fields/Items & Sets, Blank Rows; subtotal position + banded columns + ChangePivotSource + style table in patches + Show Details + pivot styles in print → P8-35 item 5.
- Pivot (P8-30): date/number grouping, calculated fields/items, value/label filters, sort by value, distinct count, pivot charts, slicers/timelines, "Show Report Filter Pages"; redo after undoing DuplicateSheet loses the copy's pivots; verify the pivot workbooks in real Excel.
- Comments (P8-26): `allComments` request for an across-sheets Comments pane; @mentions; threaded-comment extLst/person ids/initials kept; Remove Hyperlink should also clear link formatting (ui-shared style patch cannot unset); hyperlink colour slots in ui-shared's Office theme; print "as displayed" for a printed selection.
- Names/formats (P8-23): print backstage should pre-fill repeat rows/area from `Print_Titles`/`Print_Area`; Apply Names / Paste Names (F3); manual calculation mode + Calculate Now (F9); Excel-exact `_x` padding widths; trace arrows that follow edits; Error Checking / Evaluate Formula; German decimal display pending the owner's decision.
- Charts UI (P8-20): chart-area/plot-area fills and effects in the model (chart styles then become faithful); rotated category labels; keyboard nudging and element cycling; chart sheets; Show charts on the shared renderer; a contextual-tab look for the ribbon (Chart Design/Format are plain appended tabs today).
- Charts: text properties (fonts/sizes/colours) in chart XML; error bars; data tables; manual layouts; per-point labels; chart references to deleted sheets should become #REF!; Excel's exact auto axis-scaling algorithm; pptx/docx charts via `fmt_ooxml::chart` + embedded workbook; images in xlsx drawings; replace the openpyxl reference workbooks with Excel-authored ones.
- CF: core should send the data-bar axis position and min/max lengths (UI estimates the axis today); Excel 2010 data bar options (solid fill, border, negative colour); "A Date Occurring" and standard-deviation rules; copy/paste + Format Painter for CF rules and validations; a rule's number format is stored but not displayed; sort/paste do not move CF; sheet rename does not rewrite rule formulas; time-period rules; "Circle Invalid Data".
- Dynamic arrays: element-wise scalar functions over arrays (`LEN(A1:A3)`), `A:A` spilling, merged cells blocking spills, sort/fill/paste guards on spill ranges in model-sheet, TAKE/DROP/VSTACK/CHOOSECOLS/MMULT/LET/LAMBDA.
- Store the pane top-left cell (freeze while scrolled like Excel); grid mouse handlers → pointer events; Ctrl+PageUp/Down skipping hidden sheets; unhide several sheets; sort by colour/custom lists, colour/date-group filters, AutoFilter range growth, left-to-right sort, AGGREGATE, "sort warning" for adjacent data; hidden-by-hand rows inside a filtered range read back as filtered (xlsx cannot distinguish).

## Show parity follow-ups
- QA deferred (P8-40): S-01 rich in-place text editor (bullets/indents while typing); S-10 combo chart draws columns behind the area (shared renderer); S-14 Insert › Text box click-or-drag; S-17 default Effect Options for Push/Split/Zoom vs PowerPoint; colour swatch names, duotone previews, group numbering.
- Fidelity (P8-32): prompt text with formatting; exact PowerPoint table style definitions + "Best match" row; freeform tool on the preset path data; share preset data with Write; deeper text levels on layout placeholders; measure Show wasm load time in perf.
- Views (P8-28): save lock-aspect (`a:spLocks`) and last view on save → P8-32; outline view with rich text; per-layout guides (p15); ink layer under zoom; vertical text edited horizontally; custom shows.
- Charts/links/media (P8-24): Calc should re-export the shared chart presets/format helpers instead of the copy in apps/show/src/charts; media clips in the animation click sequence; media trim/bookmarks; link hit areas for grouped/rotated shapes in the show; Reuse Slides "keep source formatting" copies layouts but not the source master/theme; Show wasm size (fmt-pptx now pulls fmt-xlsx for the embedded workbook – consider a feature flag or lazy chunk).
- Design UI (P8-22): core commands for renaming layouts, adding placeholders, master text levels 2–9, picture/texture background fills, scale/fit on SetSlideSize; import LibreOffice decks' footer font size from the master; slide sorter view; Effects (theme effect styles) on the Design tab.
- Design (P8-19): honour a non-standard colour map when reading/writing colours; layouts keep level 1 of their list styles only; automatic date fields are written without current text (core has no clock – inject one); picture shapes lose adjust values; theme effects beyond outer shadow survive only while the theme is unchanged; "Reuse slides" import mapping layouts; theme import from .thmx/.potx; renderer-side helper for resolved backgrounds/footers.
- Show UI: core should return each preset's text rectangle and adjust-handle positions in `shapePaths` (UI approximates them, esp. stars/arrows); more table style families (Light/Themed/Dark); split-cell dialog (rows×cols); Format Shape pane sections for arrows and table cells; freeform/scribble tool; keyboard adjust handles; table border grips are 10 px (touch guideline 32 px).
- Show: write `tableStyles.xml` instead of explicit cell fills; PowerPoint's 3–4-turn connector detour routing; more presets (bent/U-turn arrows, ribbons, remaining callouts); PowerPoint site lists for the remaining presets; split a single table cell into a grid.
- Effect Options for sorter-selected slides; transitions when going back/jumping; badges for grouped shapes; emphasis auto-reverse; Animation Painter; Konva-rendered transitions in PDF export; Float In / Split effects; per-paragraph builds; p14 transitions.

## Write parity follow-ups
- QA deferred (P8-38): W-03 List Paragraph style for new lists (needs contextual spacing in the model); W-18 mixed portrait/landscape pages all drawn at the widest width; W-22 caption box starts with ": "; W-26 reader warnings stay English in the German UI (translate warning codes); W-28 Backspace at the start of a list item loses the indent; W-30 Word's extra shortcuts (grow/shrink font, small caps, all caps, double underline, Shift+F3, Ctrl+T, Ctrl+Q); Show › Design "Variants: Colors" overlaps its group label (vertical row check for Calc/Show in the ribbon-fit e2e).
- Drawings (P8-34): move preset geometry + adjust handles into core-model/ui-shared so Show and Write share one copy (write-core depends on model-show today); handles should rotate with the shape; drag-to-draw; linked text boxes; group shapes; dimmed crop mask; East Asian/complex-script fonts; VML-only legacy text boxes; soft edge/bevel.
- Pagination (P8-31): measure pagination in scripts/perf.sh (docs/perf.md is generated and would drop the hand-measured section); speed up flow/page data building (~20 ms per run on 12k lines); editable footnote continuations; "endnotes at section end" setting; different text widths per section within one page frame; cell borders stay open where a row splits; nested tables are not split.
- Links/columns (P8-27): hyperlinks on pictures and HYPERLINK fields; unequal column widths in the editor (CSS columns are equal); read the document's own theme fonts into the UI font box; Word's special-character shortcuts; long paragraphs/column boxes split across pages → P8-31.
- Comments (P8-25): formatting inside comment text; @mentions and people.xml identities; comments in footnotes; "Simple markup" mode; balloons following pagination gaps exactly in print layout; one Write unit test still fails intermittently under full-repo load (passes alone) – identify and fix.
- Styles (P8-21): Create a Style should make a linked style; Numbering… in Modify Style only offers existing lists; Word's bold/italic toggle semantics between styles; small caps + character spacing fields in RunProperties (Subtle/Intense Reference, Book Title); Manage Styles (sort/restrict), style sets; outline levels in the paragraph model; the Home › Font name/size boxes show empty for a plain Normal paragraph (should show the resolved theme font/size); the Write unit test "Insert › Table picks rows × columns" is timing-sensitive under load; run the wasm real-core sync tests in CI.
- Shortcuts: Write now uses F12 = Save As and Ctrl+Shift+S = Apply Styles (Word); Calc and Show should also accept F12 for Save As (consistency batch).
- Write UI (P8-17): merge-aware insertTableCol/deleteTableCol in the core (UI sends grid columns; merged tables can be off/rejected); page-relative vertical image placement needs real page boxes in the editor; CSS floats wrap on one side only (Word wraps both); tab layout treats a wrapping line as one line; removing a direct tab stop leaves a `clear` entry; ruler indent markers drag; border pen style/colour pickers on Table Design; View › Gridlines toggle.
- Tables: grid-aware insert/delete column commands (today cell indices + normalize_merges); layer table-style text formatting into run resolution; image crop and borders; Word's exact theme-colour fallback hex values.
- write-core: normalize runs in note paragraphs after edits (typed note text is saved one run per char); per-section text width in the editor; footnotes at page bottom in print output (currently at the end) and not duplicated in print layout; `ApplyNumbering` command for list presets; document author property for the AUTHOR field.
- Heading numbers in TOC entries; outlineLvl; section-level note formats; core field-update pass; split/join inside notes and headers; ADR 0006 numbering bullet to update (shared abstractNum now).

## Office parity – tracked in docs/parity-backlog.md (Phase 8)

## AI assistant – docs/ai-plan.md
- v1 merged 2026-10-16. Next: prompt caching for whole-document context; reasoning-effort choice for 5.5 models; attach a selected image (Write/Show); desktop smoke with a real key; Show's Home tab AI group may fall off-screen at 1400 px (ribbon collapse work); web CSP decision.

## Cloud connectors (user-owned accounts) – see docs/cloud-connectors-plan.md
- v1 (WebDAV) merged 2026-10-16. Next: S3 connector; generic OAuth PKCE connector with the user's own client id (Google Drive/OneDrive/Dropbox); shared desktop connection records across the three apps (per-app data dirs today); CORS setup guide for Nextcloud/ownCloud on the portal; desktop smoke test for the connector commands (keyring untested at runtime).
- `FileProvider` abstraction + backstage provider tabs; Google Drive (PKCE + Picker + Drive v3), OneDrive (MSAL + Graph), Dropbox, optional WebDAV; iCloud only through the native file system; CSP connect-src per enabled provider; tokens client-side only (ADR 0009). Needs the owner's OAuth app registrations.

## Mobile (Android, iOS) – after v0.1.0, see docs/mobile-plan.md
- Tauri mobile targets for the three apps; tablet-first layouts; touch editing; document picker + share sheet; Rust PDF generation; store publishing. Guardrails apply now (pointer events, responsive ribbon, Backend abstraction).

## Release / distribution
- Code signing + notarization (Windows/macOS warn today); auto-update (tauri-plugin-updater); CI check that the tag matches `tauri.conf.json` versions; bump actions to Node 24 variants when available.

## Calc (Phase 6 leftovers)
- Hidden sheets (reader drops the state); Move/Copy sheet dialog; coloured tab fill for inactive tabs; write `tabSelected`; 3-D references (`Sheet1:Sheet3!A1`) in the parser.
- References to cells overwritten by a cut-move should become `#REF!` (Excel); delete-sheet core command; month/weekday fill series; small General numbers in narrow cells (`1.2E-05`); `is_date_format` should recognise `[h]`/AM/PM codes for date fill series; Fill Down/Right buttons in the ribbon Editing group; move the gallery width fix into ui-shared `gallery.tsx`.

## Write (Phase 6 leftovers)
- Split long tables/lists across pages and repeat header rows in print layout; rich-text headers/footers (first/odd/even); "Page X of Y" in the status bar; borders on selected cells + table style presets; incremental pagination for long documents (print layout disables the content-visibility fast path).

## Show (Phase 6 leftovers)
- Presenter: edit notes in the console, pause/per-slide timer, choose screen for the audience window, pen drawing; snap to equal spacing; Selection pane; Format Background pane (gradient/picture); formatted notes; paste-slide elsewhere as one undo step; Alt during drag can focus the ribbon.

## Ribbon
- Groups that collapse into dropdowns on narrow windows; Quick Access Toolbar; remember collapsed state and zoom; Calc Data tab (sort/filter) if it enters scope; print preview in the backstage; Write font box shows the effective (style-derived) font.

## Desktop shells
- Atomic writes on save (temp + rename); warn when the remembered file changed on disk; run `scripts/desktop-smoke.sh` in CI under xvfb; Show Save As should skip the in-app name prompt on desktop (one line in apps/show/src/ShortcutLayer.tsx).

## Printing (follow-ups)
- Remember print settings per document / save Excel print areas and `pageSetup` to the file; split Write blocks longer than a page; Show slide ranges by slide number; WebKitGTK does not signal print completion (pages stay mounted 60 s).

## Phase 5 leftovers
- Write: windowed/paged editor so the contenteditable holds only visible pages (remaining ~2 ms typing p95 gap).
- Performance: paged/virtual Write editor for very long documents; range-level `ApplyStyle` patches in Calc (1M-cell style patch is 2.7 s because the patch carries every cell); cache parsed number formats; move the Playwright perf scripts into an e2e package so `scripts/perf.sh` needs no scratchpad files.
- Confirm-before-discard dialog shared by New/Open/Restore/window close; recovery entries age limit; Web Locks live-session check does not span desktop processes; web recent-list rules duplicated in TS.
- PDF export: Calc `UsedRange` request in the core (print view scans blocks); print area/selection; multi-sheet export; Write headers/footers; Show handouts; verify `window.print()` on WebKitGTK/WebView2 (Tauri 2.12 has no webview print API).
- Shortcuts: move Calc grid-navigation keys into the map; user-configurable shortcuts; Tiptap handles Mod-Alt-1..6 itself while focused.

## fmt-ooxml (follow-ups)
- Move namespace constants, `core.xml`/`app.xml` writers and media `extension_of` helpers into fmt-ooxml; Strict-aware shared relationship matching.

## Formats
- Compare rewritten files against Open XML SDK validator (Windows/.NET) in addition to LibreOffice – gives real "would Office repair this" signal.

## Later phases (noted while planning Phase 0)
- (none yet)
