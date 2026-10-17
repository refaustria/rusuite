# Cycle plan – Rusuite 3.141 (owner direction 2026-10-17)

Owner's order for the cycle: **(1) Calc, Show and Write features → (2) all official EU languages → (3) AI assistant
round 2 → (4) version 3.141, release build.** Installers are built only at the end of the cycle ([docs/versioning.md](versioning.md));
the web at https://rusuit.es is deployed from `main` after each verified merge. Mobile, connectors round 2 and code
signing stay in [docs/plan-after-0.1.0.md](plan-after-0.1.0.md) for later cycles (signing is pulled in as soon as the
owner has the Apple Developer account, independent of this order).

Working mode: one agent per app in parallel (3 agents), each batch = one brief in `docs/tasks/P9-*.md`, verified and
merged by the PM, then the next batch of that app starts. Task ids: `P9-C<n>` Calc, `P9-S<n>` Show, `P9-W<n>` Write,
`P9-L<n>` languages, `P9-A<n>` AI, `P9-R1` release. e2e ports: Calc 491n, Show 492n, Write 493n, languages 494n, AI 495n.

## Block 1 – Features (Calc ∥ Show ∥ Write)

Sources: deferred items from the quality passes (`docs/qa/*`), the pre-release batches and `ROADMAP.md` (sections
"… parity follow-ups", "Phase 6 leftovers"), tier-2 items of `docs/parity-backlog.md`. Each batch below is one task.

### Calc
- **C1 Protection, Format Cells leftovers, sheet handling** – sheet/workbook protection (`sheetProtection`,
  `workbookProtection`, Review tab, locked/hidden cells honoured), partial-overlap CF/validation ranges and pivot sources
  adjusted on Insert/Delete, ribbon No Border/Outline, accounting underlines, pattern fills, rotated text rendering and
  print (diagonals), unhide several sheets, hidden sheets skipped by Ctrl+PageUp/Down, tab colours, Move/Copy sheet dialog.
- **C2 Tables and data tools round 2** – structured-reference rewrite on column delete, custom table styles (dxf,
  `tableStyles`), slicers for tables and pivots, Flash Fill, Consolidate, Auto Outline, repeat columns + title rows in
  print, .csv/.txt filter in the desktop Open dialog.
- **C3 Pivot round 2** – date/number grouping, calculated fields/items, value/label filters, sort by value, distinct
  count, Show Details, Recommended PivotTables, PivotChart, Show Report Filter Pages, subtotal position/banded columns.
- **C4 Formulas and names** – manual calculation mode + F9, Apply Names / Paste Names (F3), Error Checking, Evaluate
  Formula, trace arrows that follow edits, space intersection operator, 3-D references, AGGREGATE, dynamic-array
  functions (TAKE/DROP/VSTACK/HSTACK/CHOOSECOLS/CHOOSEROWS/LET/LAMBDA/MMULT), element-wise scalar functions over arrays,
  `A:A` spilling, spill guards for sort/fill/paste.
- **C5 Conditional formatting and sorting round 2** – "A Date Occurring", standard-deviation and time-period rules,
  data-bar options (solid fill, border, negative colour, axis from the core), copy/paste + Format Painter for CF and
  validation, rule number formats displayed, sort/paste move CF, sheet rename rewrites rule formulas, Circle Invalid Data,
  sort by colour/custom lists, colour/date-group filters, AutoFilter range growth, left-to-right sort, sort warning.
- **C6 Charts round 2 and sparklines** – chart-area/plot-area fills and effects, rotated category labels, error bars,
  data tables, per-point labels, manual layouts, chart sheets, keyboard nudging/element cycling, contextual-tab look,
  references to deleted sheets → #REF!; sparklines (model, xlsx `x14:sparklineGroups`, rendering, Insert › Sparklines).
- **C7 Cells and comments round 2** – text overflow/`####`/wrap edge cases from the QA log, pane top-left cell stored
  (freeze while scrolled), pointer events on the grid, hyperlink colour slots, Remove Hyperlink clears formatting,
  across-sheet Comments pane (`allComments`), @mentions kept, "as displayed" print of a selection, pictures in sheets
  polish, page break preview.

### Show
- **S1 Rich in-place text editing and master text** – bullets/numbering/levels/alignment/run formatting while typing,
  Shift+Enter, `spAutoFit`/`normAutofit`, formatted prompt text, master/layout in-place editing, master indents per
  level, levels 2–9, rename layouts/add placeholders, Insert › Text box click-or-drag.
- **S2 Tables round 2** – exact PowerPoint table style definitions + "Best match" row, `tableStyles.xml` written,
  Light/Themed/Dark families, split cell rows×cols, Format Shape sections for table cells, 32 px border grips.
- **S3 Shapes round 2** – freeform/scribble tool, remaining presets (bent/U-turn arrows, ribbons, callouts), core returns
  text rectangle + adjust-handle positions in `shapePaths`, keyboard adjust handles, PowerPoint connector detour routing,
  rotate handles with shapes.
- **S4 Views and design round 2** – outline view with rich text, slide sorter polish (Effect Options for sorter
  selection), custom shows, per-layout guides (p15), Selection pane, Format Background pane (gradient/picture/texture),
  lock-aspect + last view saved, Effects on the Design tab, picture/texture background fills, scale/fit on SetSlideSize,
  slide numbers for ranges in print.
- **S5 Animations and transitions round 2** – Float In / Split effects, per-paragraph builds, Animation Painter,
  emphasis auto-reverse, transitions when going back/jumping, p14 transitions, PowerPoint's default Effect Options
  (Push/Split/Zoom), media clips in the click sequence, media trim/bookmarks, Konva-rendered transitions in PDF export.
- **S6 Presenter and reuse** – edit notes in the console, pause/per-slide timer, screen choice, pen drawing, rehearse
  timings; Reuse Slides with the source master/theme; combo chart z-order; LibreOffice footer font import; honour
  non-standard colour maps; theme import from .thmx/.potx.

### Write
- **W1 Lists, numbering and Word shortcuts** – contextual spacing model + List Paragraph style, Backspace at list start
  (Word), levels from real indents, `ApplyNumbering` presets, numbering/bullet/multilevel galleries with Word's presets,
  Define New Number Format, heading numbering (numbers in TOC entries, `outlineLvl`), Set Numbering Value / Restart /
  Continue, Word's remaining shortcuts (grow/shrink font, small caps, all caps, double underline, Ctrl+T, Ctrl+Q,
  Shift+F3 at sentence end), caption box fix.
- **W2 Pagination round 3** – mixed portrait/landscape pages at their own widths, per-section text widths, editable
  footnote continuations, endnotes at section end, nested table splitting, open cell borders where a row splits,
  footnotes at the page bottom in print output, pagination in `scripts/perf.sh`, faster flow/page data building.
- **W3 Styles round 2 and templates** – linked styles from Create a Style, Manage Styles (sort/restrict), style sets,
  Numbering… in Modify Style, small caps + character spacing in RunProperties, resolved font/size in the Home boxes,
  Word's bold/italic toggle semantics, `.dotx` templates (read, New from template), document properties dialog, AUTHOR
  field from the document author.
- **W4 Drawings round 2** – linked text boxes, group shapes, drag-to-draw, dimmed crop mask, soft edge/bevel, hyperlinks
  on pictures + HYPERLINK fields, image crop and borders, page-relative vertical placement with real page boxes, floats
  wrapping on both sides. (The shared preset geometry move into core-model is a separate cross-app task, X1.)
- **W5 Tables round 2** – merge-aware grid insert/delete column commands in the core, table-style text formatting layered
  into run resolution, border pen style/colour pickers on Table Design, View › Gridlines, ruler indent markers drag,
  unequal column widths in the editor, Word's special-character shortcuts, symbols dialog.
- **W6 Comments, notes and fields round 2** – formatting inside comments, @mentions/people.xml, comments in footnotes,
  Simple Markup, balloons following pagination gaps in print layout, note runs normalised after edits, split/join inside
  notes and headers, section-level note formats, core field-update pass, TOC heading numbers.

### Cross-app (run alone, after the batches that touch the same files)
- **X1** shared preset geometry + adjust handles in core-model/ui-shared (Show + Write one copy), rotate handles.
- **X2** translated reader warnings for xlsx/pptx (codes like fmt-docx), F12 Save As in Calc/Show, shared chart presets
  re-exported by Calc instead of the copy in Show, Show wasm size (feature flag for the embedded workbook).

## Block 2 – Languages: all 24 official EU languages
Existing: English, German. New catalogs (22): Bulgarian `bg`, Croatian `hr`, Czech `cs`, Danish `da`, Dutch `nl`,
Estonian `et`, Finnish `fi`, French `fr`, Greek `el`, Hungarian `hu`, Irish `ga`, Italian `it`, Latvian `lv`,
Lithuanian `lt`, Maltese `mt`, Polish `pl`, Portuguese `pt`, Romanian `ro`, Slovak `sk`, Slovenian `sl`, Spanish `es`,
Swedish `sv`. Catalog size today: ~200 KB English across ui-shared, Calc, Write, Show and the portal.
- **L0 Infrastructure** – `LOCALES` with native names, `Intl.PluralRules` categories (`zero/one/two/few/many/other` keys;
  Polish/Czech/Slovak/Lithuanian/Latvian/Irish/Maltese/Romanian/Slovenian need more than one/other), `i18n-check` generic
  over every locale file (parity + placeholders + plural completeness per language), language picker with native names
  (ribbon View group, backstage, portal switch becomes a list), `navigator.language` best match (`pt-BR` → `pt`,
  `de-AT` → `de`), per-language shortcut key names in `formatCombo` (`Strg`/`Ctrl`/`Ctrl` …, Delete key names), desktop
  dialog filter names, `<html lang>`, per-language render test generator, e2e for a sample, overflow screenshots for
  long languages (Finnish, Hungarian, Greek, German).
- **L1–L11 Translations** – two languages per task, all five catalogs each: terminology follows the Microsoft Office
  localisation of that language (ribbon tabs, command names, dialog titles), register as Office uses in that language
  **except German (informal "du", owner rule)** – owner may override per language; placeholders, plural forms and
  shortcut combos untouched; glossary file per language (`docs/i18n-glossary/<lang>.md`) listing the Office terms used;
  a second agent reviews each language against the glossary (spot check 200 strings) before merge.
- **L12 Portal and docs** – portal pages in all languages (menu, feature texts, Coming soon, Downloads), `docs/i18n.md`
  updated, website language selector.

## Block 3 – AI assistant round 2
- **A1** prompt caching for whole-document context; reasoning-effort choice for the 5.5 models; assistant answers in the
  UI language; attach a selected image (Write/Show); "explain this chart" (Calc/Show); desktop smoke with a real key
  (owner provides a test key once); Show's Home AI group placement at 1400 px.
- **A2** (if time) local models guide (Ollama/LM Studio), per-action model override, conversation export.

## Block 4 – Release 3.141 (P9-R1)
`scripts/set-version.sh 3.141.0`, public name "3.141" in release title/Downloads/About, release notes
`docs/release-notes/3.141.md`, CHANGELOG, NOTICE refresh (`cargo license`), Office check pack regenerated for the owner,
tag `v3.141.0`, release.yml run, Downloads page regenerated, signing if the Apple account exists by then.

## Owner decisions open for this cycle
1. Register per language (default: as Microsoft Office does in that language; German stays "du").
2. Whether the web keeps being deployed from `main` during the cycle (current assumption: yes) or waits for 3.141.
3. Apple Developer Program (signing) – pulled into the cycle as soon as the secrets exist.
4. A test API key for the AI desktop smoke (Block 3).
