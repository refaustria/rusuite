# UI: the ribbon

All three apps use the same Office-style ribbon from `packages/ui-shared/src/ribbon` (P6-1): a tab strip with the app name and
document title on the left, **File** + the app's tabs, a right slot (Show: Present) and the collapse toggle, over the active
tab's groups. Expanded it is ≤ 96 px tall (28 px strip + 64 px groups); collapsed it is the strip only.


### Write additions (P6-4)
Contextual **Table** tab (insert/delete rows and columns, shading, borders, header row, row height), contextual **Picture Format** tab (alt text, align, size, reset, delete), **Print layout** view with page gaps, greyed headers/footers (double-click to edit) and Draft view, non-modal find bar with highlighted matches, Paragraph dialog, format painter, highlight/font colour menus, View › Spelling.

### Write structure (P8-10)
- **References** tab: Table of contents ▾ (automatic table with 3, 2 or 1 levels → `InsertToc`, before the caret's block when the
  caret is at its start, else after it), Update table (`UpdateToc` with the page of every heading from the print-layout
  pagination); Footnotes: Insert footnote / endnote, Next / Previous footnote.
- **Insert**: Footnotes group (Insert footnote Ctrl+Alt+F, Insert endnote Ctrl+Alt+D → `InsertFootnote` at the caret; the caret
  moves into the new note), Text › Field ▾ (Page, Number of pages, Date, Time, File name, Author → `InsertField` with the
  current value as its cached result), Page number ▾ adds *Current position* (a page field) and *Format page numbers…*
  (format 1/i/I/a/A, continue or start at N → `SetSection`).
- **Layout**: Margins / Orientation / Size act on the caret's section (`SetSection { page }`; `SetPage` for documents without
  sections); Breaks ▾ (Page break; section breaks Next page / Continuous / Even page / Odd page → `SplitParagraph` +
  `InsertSectionBreak`).
- **Home › Paragraph › Multilevel list** ▾: 1 / 1.1 / 1.1.1, 1 / a) / i, Legal (I. / 1.1 with legal numbering): a new list
  definition (`RestoreNumbering`) applied to the selected paragraphs, keeping their levels. Right-click in a list: **Restart
  at 1** (`RestartList`) / **Continue numbering** (`ContinueList`).
- **Header and footer** dialog: Different first page (`titlePage`), Different odd & even pages, one text per slot; each
  changed slot is stored as blocks of the caret's section (`SetHeaderFooter`, `{PAGE}` → a page field).
- **Rendering**: fields are grey-shaded with their cached result, or the live value (page numbers from the pagination, date,
  time, file name); note references are superscript numbers in reference order (footnotes 1, 2…, endnotes i, ii…); the notes
  area after the body holds the editable notes (footnotes, then endnotes; double-click a reference to jump to its note and the
  note's number to jump back); in print layout each page also shows its footnotes at the bottom. A table of contents is a
  non-editable block (click an entry to go to the heading). List labels come from Rust (`listLabel`). A section end shows a
  dotted "Section break (Next page)" line; in print layout a new section starts a new page with its own page size, margins,
  headers/footers (first-page / even) and page numbering. Saving first sends `UpdateFields` for fields whose live value
  differs from the cached one.

### Write tables, pictures, paragraph borders and tabs (P8-17)
- **Sync**: merged cells map to ProseMirror `colspan` / `rowspan` (`gridSpan`; a `vMerge` region's first cell gets the rowspan
  and keeps the covered `continue` cells in its `continues` attribute, restored by `tableFromPM` — a row of continue cells only
  is an empty row); `InlineImage.anchor` is an image attribute (a change → `SetImageAnchor`); paragraph `borders` / `shading` /
  `tabs` travel in the paragraph's `extra`. Table commands use grid coordinates (`TableMap`); a cell selection grows to whole
  merged cells.
- **Table Design** tab: Table Style Options (Header Row, First Column, Total Row, Last Column, Banded Rows, Banded Columns →
  `look`), table styles gallery with previews (Table Grid, Plain Table 1, List Table 3, Grid Table 4 Accent 1–3 and the
  document's own table styles; ▾ also Clear; a table without a look gets Word's default look with its first style), Shading ▾
  and Borders ▾ (bottom/top/left/right, none, all, outside, inside, inside horizontal/vertical) for the selected cells
  (`SetCellProps`).
- **Table Layout** tab: Select ▾ (cell, column, row, table), Properties… (alignment, indent, automatic resize, allow row to
  break across pages, repeat header row), Delete ▾ / Insert above/below/left/right, Merge Cells, Split Cells… (columns × rows;
  rows must divide a merged region), Cell Size (row height / column width in cm, Distribute Rows / Columns, Row height…),
  Alignment 9-grid (cell vertical alignment + paragraph alignment) and Cell Margins…, Header row. The context menu adds Merge
  Cells, Split Cells…, Table Properties….
- **Rendering**: every cell gets its resolved formatting (`features/tableStyles.ts`, a mirror of
  `Document::resolve_cell_props`: style along `basedOn`, conditional formats by look, direct props; edges, fill, padding,
  vertical alignment, the style's text colour/bold) as a node decoration; table width, alignment and indent on the table.
  Borders "none" show as light gridlines on screen.
- **Picture Format › Arrange**: Position ▾ (In Line with Text; nine "With Text Wrapping" presets aligned to the margin) and Wrap
  Text ▾ (In Line, Square, Tight, Top and Bottom, Behind Text, In Front of Text); the **Layout Options** button next to a
  selected picture offers the same wrap choices. A selected floating picture is moved by dragging (offsets from the column and
  the paragraph). Square/Tight float (one side: the side with more room, `wrapSide` respected), Top and Bottom is a block,
  Behind / In Front are positioned outside the flow relative to the anchor paragraph (z-order below / above the text).
  Vertical positions relative to the margin or page stay at the anchor paragraph (no fixed page boxes in the editor).
- **Home › Paragraph**: Shading ▾ (fill), Borders ▾ (bottom/top/left/right toggle, no border, all, outside, inside = between,
  Borders and Shading… with setting, style, colour, width, sides and shading), Tabs… (position, alignment, leader, Set /
  Clear / Clear All). Paragraphs with equal borders form one box (top above the first, bottom below the last, "between"
  lines, the spacing inside); left/right borders sit in the indent like Word's.
- **Ruler** (View › Show › Ruler): the caret paragraph's column (a table cell's own), indents, tab stops; click adds a stop of
  the corner selector's kind, drag moves, drag off removes. Tab characters are laid out from the stops in effect (style chain +
  direct, `clear` entries; Word's default every 1.27 cm): left, centre, right, decimal, with dot / hyphen / underscore leaders.
  Tab outside tables and lists types a tab character.
- Print and Export PDF clone the editor DOM, so they show all of it.

## Building blocks (`@rusuite/ui-shared`)

| Export | Use |
| --- | --- |
| `Ribbon` | `tabs: RibbonTab[]` (`{ id, label, groups: { label, items }[], toolbarLabel? }`); empty groups and tabs without groups are omitted. Active tab controlled (`activeTab`/`onTabChange`) or not (`defaultTab`); collapse likewise (`collapsed`/`defaultCollapsed`/`onCollapsedChange`). `backstage` adds the File tab; `accent` colors it. |
| `Backstage` | Full-pane File view: Home, New, Open…, Save, Save As…, Print, Export PDF…, Close; the Home page lists the session's recent files (re-opened through `DocumentSession.openRecent`), the Print page shows `print` (see Printing). Commands without a handler are not shown; `fileDisabledReason` disables the file commands with a note. Esc / Back returns. `openBackstage(page)` opens it from anywhere (Ctrl+P). The Home page ends with the **Privacy** entry (P7-12, ADR 0009): where data is kept, the "Keep autosave copies in this browser" checkbox (default on; `DocumentSession.setKeepAutosave`, stored in `localStorage` `rusuite.keepAutosave`; off = no recovery entries, recent entries without content) and "Remove local copies from this browser" (`DocumentSession.clearLocalData` → `DocStorage.clearAll`: IndexedDB recent list, snapshots and recovery entries; desktop: recovery entries only, the recent list holds paths). |
| `RibbonButton` | Large (24 px icon over the label) or small (icon, optional label); `pressed` makes it a toggle (`aria-pressed`); tooltip = label + formatted `shortcut`. |
| `RibbonSplitButton`, `RibbonMenuButton` | Main action + arrow, or a button that only opens; the popup is a keyboard menu (`RibbonMenuItem[]`, with separators/section labels and radio items) or any panel. |
| `RibbonGallery`, `RibbonTableSizePicker` | Grid of choices with previews (inline in a group, or as a dropdown), arrow-key navigation; rows × columns picker. |
| `RibbonRow`, `RibbonStack`, `RibbonDivider`, `RIBBON_SELECT` | Layout of small controls (two rows per group). |
| `FontControls`, `StyleToggles`, `ColorControls`, `AlignmentControls`, `NumberFormatSelect`, `BordersDropdown` | The formatting toolbar's groups as standalone controls (the flat `Toolbar` still composes them). |
| `triggerShortcut(combo)` | Runs an entry of the app's `useShortcuts` map (dispatches the key on `window`), so ribbon commands reuse the ShortcutLayer's dialogs (Save As, help, New with its unsaved-changes question). |
| `UnsavedGuard`, `ConfirmDiscard`, `ensureSaved` | Unsaved-changes safety, see below. |
| `AutosaveStatus` | Status-bar item "Autosaved HH:MM" after the session stored a recovery snapshot (cleared by a save or a replaced document). |

## Keyboard

Alt pressed and released alone focuses the active tab (again: back to where the focus was). ←/→/Home/End move between tabs
(File included), Enter/Space activate (File opens the backstage), ↓ enters the tab's commands, Esc returns to the document.
Ctrl+F1 (or double-clicking a tab, or the chevron) collapses/expands; while collapsed, activating a tab shows its groups over the
document until a command runs, Esc, or a click elsewhere. Menus and galleries use the arrow keys; Esc closes them.

## Tabs per app

- **Calc**: Home (Undo; Clipboard: Paste ▾ values, Cut, Copy – `calcActions`; Font incl. borders; Alignment incl. wrap and
  Merge & Center ▾ (Merge & Center – a toggle that unmerges a merged selection –, Merge Across, Merge Cells, Unmerge Cells);
  Number: format, %, comma, decimals ±; Styles: Conditional Formatting ▾; Cells: Insert ▾, Delete ▾, Format ▾ (row height, column width, autofit, hide/unhide
  rows and columns, Hide Sheet / Unhide Sheet…, Format cells…); Editing: Clear, Find ▾ Replace, Sort & Filter ▾ (Sort A
  to Z, Sort Z to A, Custom Sort…, Filter, Clear, Reapply)), Insert (New sheet, rows/columns), Data (Sort & Filter: A→Z,
  Z→A, Sort (Custom Sort dialog), Filter toggle, Clear, Reapply; Data Tools: Data Validation…), View (Show: gridlines, headings, formula bar; zoom 50–200 % via CSS `zoom` on the grid with hit-testing
  scaled; Window: Freeze Panes ▾ (Freeze/Unfreeze Panes, Freeze Top Row, Freeze First Column); shortcuts help). Zoom,
  gridlines, headings and frozen panes are the active sheet's `SheetView` (`setSheetView` / `setFreeze`, undoable, saved in
  the file's `<sheetView>`); the formula bar toggle is the app's.
- **Calc sort and AutoFilter** (`apps/calc/src/sortFilter`, P8-5): Sort A→Z / Z→A from a single cell is the core's
  `sortSheetByColumn` (its region, or the AutoFilter range); a larger selection sorts itself with the header guessed,
  after Excel's Sort Warning ("Expand the selection" / "Continue with the current selection") when data continues beside a
  multi-row selection (the current region is computed from the cached cells, `sort.ts`). Custom Sort…: levels (column –
  header text with "My data has headers" –, sort as Automatic/Numbers/Text, order), Add/Delete/Copy level, move up/down,
  case sensitive; a column used twice is refused → `sortRange`. The cell context menu has Sort A to Z / Z to A / Custom
  Sort… (flat items: the shared ContextMenu has no submenus). Filter (Ctrl+Shift+L) → `setAutoFilter` (a single cell: its
  region). The header row gets dropdown buttons drawn on the canvas at the right edge of each header cell (`filter.ts`:
  layout, hit-testing with a 2 px slop, a funnel when filtered, an arrow on the sorted column); a press (pointer event) or
  Alt+↓ on a header cell opens the panel: Sort A to Z / Z to A (the AutoFilter range), Clear Filter From "…", Text or
  Number Filters ▸ (click to expand: Equals…, Does Not Equal…, Begins/Ends With…, Contains…, Greater/Less Than (Or Equal
  To)…, Between…, Custom Filter… → the Custom AutoFilter dialog with two criteria and And/Or; Top 10… dialog; Above/Below
  Average at once), a search box and the value check-list from `filterValues` with (Select All) (tri-state), counts and
  "(Blanks)"; OK → `setFilterColumn` (all values ticked = no filter; nothing ticked = OK disabled; while searching only the
  ticked results). Number vs Text Filters follows the majority of the cached cell kinds. Filtered rows arrive as hidden
  `filtered` rows; the row numbers of a filtered range turn blue and the status bar shows "n of m records found".
 frozen panes split the cell canvas into up to four quadrants (`panes.ts`: one viewport
  per quadrant, frozen ones fixed, a divider line, headers split the same way, pointer positions mapped per quadrant,
  scroll-into-view only for the scrolling part). Merged cells (`merges.ts`) paint as one cell (top-left content and fill over
  the range, inner gridlines masked, outer borders only, no overflow); selections snap to whole merges, the active cell is a
  merge's top-left cell (editing, typing, Delete and the name box use it), arrow keys skip covered cells, and paste / the
  fill handle refuse to change part of a merge with a toast. Merging cells that hold more than one value asks first (only
  the upper-left value is kept). Hidden sheets have no tab (tab menu Hide / Unhide… with a list of the hidden sheets;
  "very hidden" ones are not offered); the sheet a hide/unhide patch names (`activateSheet`) becomes active; the last
  visible sheet can be neither hidden nor deleted; hidden sheets are not printed.
  Dynamic arrays (P8-12, `grid/spill.ts`): selecting an array formula or a cell it spills into outlines the spill range in
  thin blue (dashed red while the formula shows `#SPILL!`); a spilled cell shows the formula greyed and read-only in the
  formula bar, typing into it is allowed and blocks the spill. A selected `#SPILL!` formula cell gets a warning indicator left
  of it (tooltip "Spill range isn't blank", menu: Select obstructing cells). Paste, the fill handle, Ctrl+D/R and sorting
  refuse to change spilled cells ("You can't change part of an array"); Delete on the formula cell removes the whole spill,
  on spilled cells alone it does nothing. Copying spilled cells copies their values (with their formula they paste blank and
  spill again); spilled cells count as data for Ctrl+arrows, regions and the used range. The formula editor knows `A1#`
  (coloured over the whole spill range), `@`, `#SPILL!` and `#CALC!`.
- **Calc conditional formatting** (P8-13, `apps/calc/src/condFormat`, `grid/cf.ts`): Home › Styles › Conditional
  Formatting ▾ is Excel's menu with flyouts (click, Enter or → opens one, ← / Esc closes it; hover opens too):
  Highlight Cells Rules (Greater Than… / Less Than… / Between… / Equal To… / Text that Contains… / Duplicate Values…) and
  Top/Bottom Rules (Top/Bottom 10 Items…, 10 %…, Above/Below Average…) open Excel's small dialogs with the six presets
  (Light Red Fill with Dark Red Text … Red Border) or Custom Format…; Data Bars (6 gradient colours), Color Scales (Excel's
  12) and Icon Sets (17, grouped Directional / Shapes / Indicators / Ratings) apply at once; New Rule… is the full dialog
  (the six rule types, 2-/3-colour scale, data bar and icon set editors with threshold types, cell value / specific text /
  blanks / errors, top/bottom, average, unique/duplicate, "Use a formula"; Format… edits the dxf: font style, underline,
  strikethrough, colours, outline border, number format); Clear Rules ▸ from the selection / the sheet; Manage Rules… lists
  the rules by priority for the selection or the sheet (description, format sample, editable "applies to", Stop If True;
  New / Edit / Delete, Move Up / Down) and sends its edits on OK / Apply as one compound (`manageCommands`: removals, then
  per position a reorder, update or add). New rules go on top (priority 1). The grid draws the snapshot's `cf` results:
  the dxf over the cell style, colour-scale fills (blank cells too), gradient data bars from the left (negative values red,
  left of a dotted zero axis fitted from the visible values), 16 px vector icons (`ICON_SETS`, shared with the gallery SVGs
  and the print view) with the text after them, and Show Bar/Icon Only. Patches with `cfSheets` re-fetch the active sheet's
  viewport (debounced 40 ms; other sheets reload when shown). The print view prints fills, bars (CSS gradients) and icons
  (inline SVG). `window.__calcCfOps` holds the last frame's bar/icon ops for the end-to-end tests.
- **Calc data validation** (P8-13, `apps/calc/src/validation`): Data › Data Tools › Data Validation… (Settings: Allow
  any / whole / decimal / list / date / time / text length / custom, operator, minimum/maximum or value – dates and times
  typed as dates –, list source `a,b,c` or `=$A$1:$A$5`, Ignore blank, In-cell dropdown; Input Message; Error Alert:
  Stop / Warning / Information, title, message; Clear All). Any value without an input message removes the validation. A
  selected list cell shows a ▼ button right of it (also Alt+↓) with the core's `listValues`; a picked value is written
  directly. The input message shows as a yellow note under the selected cell. Committing an edit in a validated cell asks
  the core (`validateInput`) first; a failed check shows Excel's alert while the editor stays open: Stop → Retry (back to
  the edit, text selected) / Cancel (discard); Warning "Continue?" → Yes (keep) / No (back) / Cancel; Information → OK /
  Cancel. Paste and fill are not checked (as in Excel); Circle Invalid Data is not offered.
- **Write**: Home (Undo; Clipboard; Font; Paragraph: lists, indent, line spacing, alignment; Styles gallery Normal/Title/Heading
  1–6; Editing: Find and replace), Insert (Table picker, Picture, Page break, Line break), Layout (Margins, Orientation, Size →
  `SetPage`), View (zoom, shortcuts help).
- **Write**: Home (Undo; Clipboard; Font; Paragraph: lists, multilevel list, indent, line spacing, alignment, shading, borders,
  tabs; Styles gallery Normal/Title/Heading 1–6; Editing: Find and replace), Insert (Table picker, Picture, Header/Footer/Page
  number, Field, Footnotes, Page break, Line break), Layout (Margins, Orientation, Size → `SetSection`/`SetPage`, Breaks),
  References (Table of contents, Footnotes), View (views, ruler, zoom, spelling, shortcuts help); contextual Table Design and
  Table Layout in a table, Picture Format on a picture (P8-17).
- **Show**: Home (Undo; Clipboard: shapes/slides clipboard + Duplicate; Slides: New slide ▾ layouts, Layout ▾, Duplicate,
  Delete, Hide slide; Font + grow/shrink; Paragraph + line spacing ▾; Drawing: shapes gallery, Arrange ▾
  order/align/distribute/group, fill and outline), Insert (New slide, Table ▾ picker 10 × 8 + Insert table…, Picture,
  Shapes ▾ grouped library, Text box), Design (Background
  colour, Apply to all, Reset), Transitions (Preview; gallery None/Fade/Push/Wipe/Cover/Split/Cut/Zoom + Effect Options ▾;
  Timing: Duration, Apply to all, Advance slide On mouse click / After mm:ss), Animations (Preview; Animation styles ▾ grouped
  Entrance/Emphasis/Exit + None, Effect Options ▾; Add animation ▾, Animation pane; Timing: Start, Duration, Delay, Move
  earlier/later), View (Notes pane, present from beginning/current, Presenter view, zoom Fit/50–200 %, shortcuts help),
  contextual Shape Format while shapes are selected (Format shape…, Alt text…, Change picture…/Reset size; Insert shapes:
  Shapes ▾, Change shape ▾; Shape styles ▾, fill, outline, Arrows ▾, Connector type ▾ + Reroute; Arrange ▾, Rotate ▾), or
  Table Design + Layout while one table is selected; Present in the strip. Right-click menus on shapes, on the slide and on thumbnails (`apps/show/src/canvas/menus.ts`).

Each app keeps its status bar; Calc and Show also show the zoom there, all three the last autosave.

Every app's View tab also has **Language / Sprache** (English, Deutsch); the same picker sits at the bottom of the File
backstage. The UI language follows the browser by default and switches in place; see [i18n.md](i18n.md) (P7-11).

## Save and Save As on the desktop (P7-7)

The desktop shell remembers the document's file (`DocPath` in `apps/*/src-tauri/src/lib.rs`): Open (dialog or recent file)
binds it once the core opened the file, Save As re-binds it, New / a recovered document unbind it (the shell watches
`dispatch` replies). `Backend.saveFile(name, bytes, { saveAs })` → `save_file`: a plain **Save** (Ctrl+S, File › Save, Save in
the unsaved-changes question) of a bound document writes that file without a dialog; an untitled document or **Save As**
(Ctrl+Shift+S, File › Save As…) shows the native save dialog, starting in the current file's folder. The result is the
written file (`SaveResult`: `SavedFile { name, path }`), whose name becomes the document's name (`markSaved`) and the window
title. Calc and Write go straight to the native dialog for Save As; Show still asks for the name first and then opens the
dialog with it. The web shell is unchanged: Save downloads, Save As asks for the download's name.

## Unsaved changes (P7-6)

Before a command replaces or closes a modified document – New (Ctrl+N), Open (Ctrl+O, File › Open…), a recent file, Restore in
the recovery banner, File › Close and closing the window – the app asks **"Save changes to <name>?"** with **Save** /
**Don't save** / **Cancel** (Esc = Cancel), as Office does. Save runs the app's save flow and the command only proceeds when
the file was written: an untitled document is named first in the browser (the Save As prompt; the desktop's native save dialog
is the Save As), and a cancelled name prompt or save dialog cancels the command.

- `ensureSaved(prompts, doc)` is the flow (`DocState`: `dirty()`, `name()`, `defaultName`, `save(asName?)`);
  `UnsavedGuard(backend, doc)` is the per-window controller (`ensureSaved()`, `run(action)`, the pending question rendered by
  `<ConfirmDiscard guard>`). Recent files and Restore ask through `SessionAdapter.confirmReplace`.
- Closing the window: web – the browser's native `beforeunload` prompt while dirty (`guard.watchWindow()`). Desktop – the
  UI keeps the shell's `CloseGuard` set while dirty (`set_close_guard`, `guard.syncDirty()`); the shell then holds a close
  request and emits `rusuite://close-requested`, the guard asks, clears the flag and closes the window again
  (`core:window:allow-close`).
- Recovery banner: entries older than 7 days are dropped (`RECOVERY_MAX_AGE_MS`); with several entries it offers
  **Discard all**.

## Show: slide show and presenter view (P7-8)

- **Slide show** (F5 / Shift+F5, Present): the slide full screen (`present/Presenter.tsx`), driven by the pure state machine
  `present/showState.ts` (`reduceShow`, `keyAction`, `clickAction`): click/tap right half next, left half previous; B/W
  blank the screen black/white; number + Enter jumps; after the last slide a black "End of slide show" slide, then exit;
  the pointer hides after 3 s idle. The slides are fixed when the show starts (hidden ones skipped unless started on one).
- **Presenter view** (Alt+F5, View › Presenter view): the main window shows the presenter console
  (`present/PresenterConsole.tsx`): current slide, next slide, speaker notes with A−/A+ text size (remembered), elapsed
  timer with reset, clock, slide counter, Previous / Next / Black screen / End show and a slide strip to jump. A second
  window (`?audience=<id>`, rendered by `present/Audience.tsx` without a backend) shows the slide; on the web it is a
  `window.open` popup (fullscreen on its first click or key), on the desktop a `WebviewWindow` labelled `audience`
  (fullscreen on a second monitor when there is one; capabilities `presenter.json`, `audience.json`).
- **Sync** (`present/sync.ts`): `BroadcastChannel` on the web, Tauri events on the desktop, behind `SyncChannel`. The
  presenter owns the show and sends `deck` (slides, theme, media) and `state` `{slideIndex, blackout, ended}`; the audience
  sends `hello`, its keys/clicks as `action`, and `bye` when closed (which ends the show); `end` closes it.
- If the window cannot be opened (popup blocked), the show runs in the main window with a speaker notes overlay and a
  Notes toggle in the corner.

## Show: shape library, connectors and tables (P8-16)

- **Outlines** (`apps/show/src/shapes/paths.ts`): every auto shape and connector is drawn from the core's `shapePaths`
  (one Konva `Path` per sub-path with its fill / stroke flags). One process-wide cache keyed by geometry + box size +
  adjust values, so a patch that changes any of them makes a new entry (LRU, 5000 entries); missing outlines are fetched
  in one batch per tick and the renderers re-render when they arrive (a rectangle / ellipse fallback meanwhile). The editor,
  thumbnails, presenter and print use the same cache (print awaits `ensure`); the audience window gets the slides'
  entries with the `deck` message. Text inside non-rectangular presets uses an approximate text rectangle
  (`shapes/presets.ts` `textRect`: inscribed rectangle for ellipses, middle half for diamonds, lower middle for triangles …).
- **Insert › Shapes** (`ui/ShapeGallery.tsx`): Recently used (kept in `localStorage`), Lines (straight / elbow / curved
  connectors with and without arrowheads), Rectangles, Basic shapes, Block arrows, Flowchart, Stars and banners, Callouts;
  icons from the same outlines. A pointer click arms drawing (`ShowState.drawMode`, crosshair, `data-draw-mode` on the
  stage): drag a box (Shift: square) or click for the default 1-inch size at the click; Esc or a right-click cancels.
  Enter / Space on an item inserts it centred at once. Home › Drawing has a compact gallery plus More shapes ▾.
- **Adjust handles** (`shapes/handles.ts`, `canvas/EditHandles.tsx`): yellow diamonds for the presets' `a:ahXY` handles
  (linear in the adjust value along one axis; callout tails on both), live preview while dragging, one `SetGeometry` on
  release (all adjust values of the shape).
- **Connectors** (`shapes/connectors.ts`): drawing or dragging an end over a shape shows its connection sites (grey, red
  when within 12 px); releasing on one glues it (`AddShape` with `start`/`end`, or `SetTransform` + `SetConnector`: the
  core lets go of ends whose shape did not move and re-glues them from the patch, then reroutes). End handles are green
  when glued. An elbow with two turns has a middle handle (`adj1`). Shape Format › Arrows (9 presets + Small / Medium /
  Large), Connector type (Straight / Elbow / Curved) and Reroute connectors (each glued end to the site nearest to the
  other end). Duplicating / pasting keeps a connector glued only to shapes copied with it.
- **Tables** (`shapes/tables.ts`, `canvas/tableLayout.ts`, `canvas/TableOverlay.tsx`): drawn on the canvas (fills, text,
  borders; rows grow with their text), with the six built-in styles Medium Style 2 – Accent 1…6 computed like the core's
  `Table::style_cell` (unknown style ids draw no style formatting). While one table is selected a DOM layer (pointer
  events, inset 5 px so the Transformer handles and the frame for moving stay reachable) takes clicks (edit the cell in
  the text overlay), drags across cells (cell selection, highlighted) and drags on column / row borders (`SetTableGrid`;
  neighbouring columns share the change, rows grow); right-click opens the table menu. In a cell Tab / Shift+Tab and the
  arrows at the text's edges move between cells (Tab in the last cell adds a row), Enter makes a new paragraph; the text is
  committed with `SetTableCellText`. Table Design: style options (header / total row, banded rows / columns, first / last
  column → `SetTableStyle`), table styles gallery + Clear table, Shading and Borders (all, outside, inside, none, each
  side; explicit lines in `SetTableCellProps`) for the cell selection (else the edited cell, else the whole table).
  Layout: Delete ▾ rows / columns / table, Insert above / below / left / right (as many as selected), Merge / Split cells,
  Distribute rows / columns, horizontal and vertical alignment, Cell margins ▾ (Normal / None / Narrow / Wide).

## Show: transitions and animations (P8-8)

- **Model rules in the UI** (`apps/show/src/anim/effects.ts`): the rules of `crates/model-show/src/anim.rs` mirrored for the
  menus (directions per transition kind / effect, defaults, which effects exist per kind), the labels (transition
  directions name the side the slide comes from: `left` = "From Right"; animation directions the side of the shape) and
  the click numbers (every On Click animation starts a number, With/After Previous share it, leading ones are 0).
- **Transitions tab** → `setTransition` for the current slide (a new kind gets its default duration and direction and keeps
  the advance settings; "None" with On mouse click and no After = no transition) and `applyTransitionToAll`. Effect
  Options lists only the kind's directions. The slide sorter shows a small star under the number of slides with a
  transition or animations.
- **Animations tab**: the gallery applies its effect to the selected animation, else to each selected shape's first one
  (`updateAnimation`, default duration, direction reset when it no longer fits), shapes without one get a new On Click
  animation (`addAnimation`); None removes them. Add animation always appends. Effect Options / Start / Duration / Delay
  patch the selected animation, else every animation of the selected shapes. While the Animations tab or the pane is
  shown, number badges sit left of the animated shapes on the stage (a badge selects its animation).
- **Animation pane** (`ui/AnimationPane.tsx`, right of the stage): rows in play order with number, kind star (green
  entrance, gold emphasis, red exit), shape name and effect; click / arrows select, Delete or the bin removes, Alt+↑/↓ and
  the ▲/▼ buttons move, dragging a row by its grip (pointer events) drops it at the insertion line (`reorderAnimation`);
  Play all previews.
- **Preview** (both tabs) plays on the editor stage (`canvas/AnimOverlay.tsx`): the transition from the previous slide
  (black before the first), or the slide's whole sequence; a click or Esc stops it.
- **Playback** (`anim/playback.ts`, pure; `anim/driver.ts`, Konva): a slide's animations form click groups (group 0 =
  animations before the first On Click one, played when the slide appears); With Previous starts with the previous
  animation, After Previous when it ends, each plus its delay. Shapes whose first animation is an entrance start hidden;
  `shapeStates(slide, n)` rebuilds the visibility and Grow/Shrink scale after any number of groups, so ← can step back.
  Effects are frames of `effectFrame` (fade, fly from outside the slide, wipe via a clip, zoom), Spin and Grow/Shrink are
  Konva tweens. Transitions animate two slide pictures with the Web Animations API (`transitionFrames`: fade, push / cover
  with direction, wipe and split via `clip-path`, zoom; cut/none instant).
- **In the show** (`present/AnimatedSlide.tsx`): `ShowState.step` counts the click steps done on the slide; next plays the
  next group before moving on, ← goes back one step (onto the previous slide with all its steps done); jumps start at
  step 0. "On mouse click" off means a click does not leave the slide (keys and the timer still do). "After" advances
  automatically once the step's animations (and the transition) have finished; S stops / restarts it. The sync `state`
  message carries `step`, so the audience window and the presenter console's Next preview (the current slide after its
  next click while steps are left) follow. The show element has `data-step`, the slide `data-hidden-shapes`.

## Printing (P7-9)

**File › Print** (Ctrl+P) is the Office print page: on the left the **Print** button, a note that copies, printer and
two-sided printing are chosen in the system print dialog (where "Save as PDF" makes a PDF), and the settings; on the right
the **preview** with page navigation and the page count. **File › Export PDF…** is a secondary entry: the same pipeline with
the current settings, straight to the system dialog (desktop and browser alike: pick "Save as PDF" there).

- **Pipeline** (`packages/ui-shared/src/print.ts`): each app builds a `PrintDoc` – one HTML string per page, every page laid
  out on the whole sheet (margins are padding; `@page { size: W H; margin: 0 }`), so the preview's page count is the printed
  one. The preview shows it in an `<iframe srcdoc>` (`print/PrintPreview.tsx`, sandboxed without scripts); printing mounts
  it as `#rusuite-print-root`, the only visible element under `@media print`, then calls `Backend.print()`
  (`printDocument`). Page ranges (`All` / `1-3,5`, `7-`, `-2`) drop the pages outside the range (`parsePageRange`,
  `applyPageRange`). The settings component is `PrintPanel` with `PrintSelect`/`PrintCheck`/`PrintNumber`/`PrintText`,
  the document is built by `usePrintDoc(build)` (debounced, stale builds dropped).
- **Calc** (`apps/calc/src/print`): active sheet / entire workbook (every sheet from a new page, `&P`/`&N` over the whole
  printout) / selection; orientation, paper A4/Letter/Legal/A3, Excel margin presets, scaling (100 %, custom %, fit sheet on
  one page, fit all columns, fit all rows); wide sheets paginate into page columns, ordered down, then over; gridlines, row
  and column headings, rows to repeat at the top; header and footer as left/center/right slots with `&P &N &D &T &A &F`. Merged
  cells print as one cell (`colspan`/`rowspan`, cut at page breaks).
- **Write** (`apps/write/src/print`): the editor's top-level blocks cloned onto pages, measured at the printed text width and
  packed with the print layout's `computeBreaks` – with the document's own page setup at 100 % the pages are the editor's
  pages; overrides for paper, orientation, margins and a content scale; headers/footers with `{PAGE}` on every page.
- **Show** (`apps/show/src/print`): slide pictures from the editor's `SlideView` on off-screen Konva stages (cached per
  slide); layouts full-page slides (paper "Slide size" or a paper size), notes pages (slide + speaker notes), handouts with
  2/3/4/6 numbered, framed slides per page (3: with note lines); frame slides, scale to fit (or a percentage), print hidden
  slides.

**Desktop** (`print_webview` in each `src-tauri/src/lib.rs`, used by `TauriBackend.print()`, falling back to
`window.print()`): `tauri::WebviewWindow::print()` exists in Tauri 2.12 (desktop only; its doc comment says "only supported
on macOS", but wry implements all three):
- **Linux (WebKitGTK)**: `webkit2gtk::PrintOperation::run_dialog` – the GTK print dialog (printers, "Print to File" as PDF/PS,
  copies, page setup). The command is synchronous, so it runs on the main thread and returns when the dialog closes; WebKitGTK
  does not reliably fire `afterprint`, so the print root stays mounted for 60 s (`DESKTOP_PRINT_KEEP_MS`) or until the next
  print, in case the pages are rendered after the dialog returned.
- **macOS (WKWebView)**: `NSPrintOperation` (macOS 11+) with the system print panel, whose PDF menu saves a PDF.
- **Windows (WebView2)**: wry evaluates `window.print()` – Chromium's print preview dialog with "Save as PDF".
## Logos and the portal (P7-10)

One family in `apps/portal/logos/` (hand-written SVG, 1024 viewBox): a full-bleed rounded tile (`rx` 225 = 22 %) in the app's
dark tone, a glyph inside the 512 px live area (256–768) built from rounded rects (`rx` 40, 96–112 px bars), the app's light
tone for the glyph and white for its one "active" element.

| Logo | Tile / light tone | Glyph |
| --- | --- | --- |
| `calc.svg` | `#1E7A46` / `#2DA866` | 2×2 cells, the selected cell white |
| `write.svg` | `#1F4E9A` / `#3B7DD8` | three text lines, the short heading line white |
| `show.svg` | `#C2410C` / `#F0763A` | 16:9 slide on a stand, white play triangle |
| `rusuite.svg` | `#1E293B` | three slanted bars in the three light tones |

`<name>-mono.svg` replaces the light tone with white at 55 % opacity (one hue plus white); they are the favicons (inlined as
data URIs in `apps/*/index.html`, `logos/rusuite-mono.svg` for the portal). `<name>.png` are 1024 px exports
(`rsvg-convert`, see docs/setup.md), the source of the Tauri icons in `apps/*/src-tauri/icons/`.

The portal (`apps/portal/index.html` + `styles.css`, no build step, ~12 KB with the SVGs) is the site root: header with the
mark and the one-line pitch, a card per app (logo, name, one sentence, "Open … in browser" in the app colour, "Desktop
downloads" → GitHub releases), footer with the alpha note, the repo link and the build from `/version.json`. Light/dark via
`prefers-color-scheme`, system fonts, no external requests. An **EN / DE** switch (top right, `apps/portal/i18n.js` + `apps/portal/locales/`) translates the page
and stores the choice where the apps read it; a German browser gets German by default (P7-11).

## Privacy (P7-12, ADR 0009)

- nginx sends a `Content-Security-Policy` (`connect-src 'self'`, no third-party origins; `style-src 'unsafe-inline'` stays because React `style` props and the print preview `srcdoc` need it), `Referrer-Policy: no-referrer` and a minimal `Permissions-Policy`. The policy is defined once in `deploy/nginx/resuite.inceptum.at.conf`; the `$csp_connect` line is the single place for future provider origins (`docs/cloud-connectors-plan.md`). `packages/e2e/serve.mjs` reads the same policy, so the local e2e run enforces it too. Pages must not use inline scripts (the portal's version script is `version.js`).
- `scripts/privacy-check.sh` (CI) rejects `fetch(`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`, `EventSource`, `navigator.share` outside the portal's `version.js`/`i18n.js`, and HTTP clients in `apps/*/src-tauri/Cargo.toml`.
- e2e `privacy.spec.ts` records all requests of each app while opening, editing, autosaving and saving and asserts they are the page's own static files; it also covers the Privacy entry (EN/DE; `PRIVACY_SHOTS=<dir>` saves screenshots).
- The portal says it in one sentence and links `privacy.html`.
