# Keyboard shortcuts

`Mod` is Ctrl on Windows/Linux and Cmd on macOS. Press `Mod+/` in any app to list the shortcuts. The keys are the same in every UI language; the German UI
labels Ctrl as **Strg** (and Delete as **Entf**) in the help dialog, tooltips and menus, as German Office does
([i18n.md](i18n.md)).

## How they are wired

`packages/ui-shared/src/shortcuts` provides `useShortcuts(map)`: a map from combo (`"Mod+Shift+S"`) to `{ label, group, run, inField?, when? }`, bound to `window` keydown (bubbling, so the editor's own handling goes first and handled events are skipped). By default a shortcut does not fire when the key comes from an input, textarea, contenteditable, menu or dialog; `inField: true` opts in (file and help keys). `when` is an extra guard (Calc: the grid has focus). Entries without `run` document keys that the editor binds itself (Tiptap marks, Write undo/redo). Each app registers its map in `src/ShortcutLayer.tsx`; each map is tested by firing keyboard events (`src/shortcuts.test.tsx`, `packages/ui-shared/src/shortcuts/shortcuts.test.tsx`).

`Mod+P` opens **File › Print** (the backstage Print page with settings and preview) in all three apps via `openBackstage("print")`; the Print button there opens the system print dialog. File › Export PDF… prints with the current settings without the page.

## All apps

| Keys | Action |
| --- | --- |
| Mod+N | New document (asks before discarding unsaved changes) |
| Mod+O | Open |
| Mod+S | Save |
| Mod+S on the desktop | Saves to the document's file without asking (untitled: the save dialog) |
| Mod+Shift+S | Save as (web: asks for a file name; desktop: the native save dialog). Write: F12, as in Word (Mod+Shift+S is Apply Styles there) |
| Enter, Tab, Esc in "Save changes to …?" | The question before New, Open, a recent file, Restore, Close or closing the window with unsaved changes: Enter = Save (focused first), Tab moves to Don't save / Cancel, Esc = Cancel |
| Mod+P | File › Print (settings and preview); PageUp/PageDown in the preview change the page |
| Mod+Z, Mod+Y, Mod+Shift+Z | Undo, redo, redo |
| Mod+B, Mod+I, Mod+U | Bold, italic, underline |
| Mod+/ | Shortcut help |
| Alt (press and release) | Focus the ribbon tabs (again: back to the document); ←/→ move, Enter/Space open a tab, ↓ enters its commands, Esc leaves |
| Ctrl+F1 | Collapse / expand the ribbon |

## Calc

| Keys | Action |
| --- | --- |
| Arrows, Tab, Enter | Move the active cell; a merged cell is one cell (covered cells are skipped, Shift+Arrow extends past the whole merge) |
| Mod+Arrow | Jump to the edge of the data |
| Mod+Shift+Arrow | Extend the selection to the edge of the data |
| F2 | Edit the active cell (edit mode); inside the editor: switch between edit and enter mode |
| Delete | Clear the selection |
| Backspace | Edit the active cell starting empty (Enter clears it, Esc keeps the old content); a selected chart, picture or note box is deleted |
| Alt+Enter | Line break in the cell editor (stored as `\n`; committing turns wrap text on and grows the row) |
| Enter, Tab (Shift: reverse) | Commit the edit and move down / right |
| Mod+Enter | Commit the edit without moving; a selected range gets the entry in every cell (relative references shift, formats stay) |
| Esc | Cancel the edit (first closes the function list) |
| Arrows | Enter mode (editing started by typing): point at cells in a formula, otherwise commit and move. Edit mode (F2, double-click, formula bar): move the caret |
| Shift+Arrows | While pointing: extend the pointed reference to a range |
| F4 | Cycle `$` anchoring of the reference at the caret: `A1` → `$A$1` → `A$1` → `$A1` |
| ArrowUp/ArrowDown, Tab/Enter | Function list: choose, accept (`SUM(`) |
| Mod+Space, Shift+Space | Select the column(s), the row(s) |
| Mod+Plus, Mod+Minus | Insert, delete: whole rows/columns selected act at once; otherwise Excel's Insert / Delete dialog (Shift cells right / down – left / up –, Entire row, Entire column; a selection taller than wide preselects the sideways shift) |
| Mod+1 | Format Cells, on the Number tab (General, Number, Currency, Percentage, Date, Time, Text, Custom, live preview); the tabs Alignment, Font, Border, Fill and Protection apply with it as one undo step |
| Mod+Shift+~, Mod+Shift+!, Mod+Shift+@, Mod+Shift+#, Mod+Shift+$, Mod+Shift+%, Mod+Shift+^ | Number format General, `#,##0.00`, `h:mm AM/PM`, `d-mmm-yy`, currency, `0%`, `0.00E+00` (the Shift+digit keys of a US layout) |
| Mod+5 | Strikethrough |
| Mod+;, Mod+Shift+: | Start the cell editor with today's date / the current time (Enter stores it as a date / time) |
| Mod+PageDown, Mod+PageUp | Next / previous visible sheet, skipping hidden ones (desktop; browsers keep these keys for their tabs; the grid no longer treats them as PageDown / PageUp, P9-C1) |
| Mod+C, Mod+X | Copy, cut: the range gets a marching-ants outline; a cut moves the cells on the next paste |
| Mod+V | Paste at the selection's top-left (relative references shift; the block repeats over a selection that is a multiple of it). Text from other programs is pasted as plain values (TSV) |
| Mod+Shift+V | Paste values only (formulas paste their current values; destination formats kept) |
| Esc | Leave copy / cut mode (the marching ants disappear); turn the Format Painter off (P9-C5) |
| Home › Format Painter, double-click | Format Painter that stays on for several ranges until Esc or a click on the button (P9-C5; Excel has no default key for it) |
| Mod+D, Mod+R | Fill down, fill right: copy the selection's first row down / first column right over the rest of it (a single row or column is filled from the one above / to the left); relative references shift |
| Mod+F, Mod+H | Find, find and replace (sheet or workbook, match case, entire cell; inputs and displayed values are searched) |
| Shift+F11 | Insert a sheet before the active one |
| Mod+Shift+L | AutoFilter on / off (a single cell: its current region) |
| Alt+ArrowDown | On an AutoFilter header cell: open its filter dropdown (Esc closes it); on a list-validated cell: open its list |
| Shift+F2 | New note / edit the note of the active cell (in place; Esc or clicking away saves) |
| Mod+Shift+F2 | New comment (a cell with a thread: open it to reply; Mod+Enter posts) |
| Mod+K | Insert or edit a hyperlink |
| Mod+click | Follow the hyperlink (or `HYPERLINK()` formula) of a cell |
| Delete | With a note box selected: delete the note |
| Esc | Deselect a note box, close a comment card |
| Mod+A, Mod+Shift+* | Inside a pivot table: select the whole table (page fields included) |
| Alt+F5, Mod+Alt+F5 | Refresh the selected pivot table, refresh all pivot tables |
| Alt+ArrowDown | On a pivot table's `Row Labels` / `Column Labels` / field header or page cell: open its filter dropdown |
| Delete | On a selection covering whole pivot tables: delete them (after a question); part of a table is refused |
| F9 | Calculate Now: recalculate the pending cells of every sheet (manual calculation, P9-C4) |
| Shift+F9 | Calculate Sheet: recalculate the active sheet's pending cells |
| F3 | Paste Names: insert a defined name at the caret of the formula being edited (outside an edit: start `=Name`), or Paste List |
| Mod+E | Flash Fill: fill the active column's empty cells from the examples typed into it (P9-C2) |
| Enter, Esc | While Flash Fill's greyed suggestions show (after a second example): fill them / drop them |
| Alt+S, Alt+C | On a focused slicer: Multi-Select on / off, Clear Filter |
| Mod+click | On a slicer button: add or remove the item (like Multi-Select) |
| Delete, Esc | On a selected slicer: delete it (and its filter), deselect it |

### Mouse

- **Filter buttons** (the ▾ boxes on an AutoFilter's header row): click to open the filter dropdown (sort, clear, text / number filters, search, value list).
- **Pivot tables**: click a −/+ button (or double-click the item's label) to collapse / expand an item; click a header's or page cell's ▾ for its filter dropdown. In the PivotTable Fields pane drag fields between the list and the areas (and within them); dropping an area entry outside the areas removes it. While editing a formula, clicking a value of a pivot table inserts a `GETPIVOTDATA` formula (Analyze › Options ▾ › Generate GetPivotData).
- **Slicers** (P9-C2): click a button to filter to that item, Ctrl+click or Multi-Select to add or remove items; drag the frame to move the slicer, its corner handles to resize it.
- **Fill handle** (the small square at the selection's bottom-right): drag down, up, right or left to fill. One cell is copied (relative references shift); two or more numbers continue their linear trend (1, 2 → 3, 4, …); a date steps by a day; text ending in a number counts up (`Item1` → `Item2`). Hold Ctrl while releasing to swap series and copy. Double-click the handle to fill down to the end of the neighbouring column's data.
- **Right-click** cells, row headers or column headers for a context menu (cut/copy/paste/paste values, insert/delete rows and columns, clear contents, sort A to Z / Z to A / custom sort (cells), format cells, row height / column width, hide/unhide, autofit column width). The menu is keyboard navigable (arrows, Home/End, Enter, Esc).
- **Sheet tabs**: right-click for Insert sheet, Delete sheet (asks first when the sheet has content; references to it become `#REF!`, Undo brings it back), Rename, Duplicate (`Name (2)`, formulas referring to the sheet itself point at the copy), Move left / right and Tab colour… (shown as the tab's underline, saved as `sheetPr/tabColor`). Drag a tab to reorder. Ribbon Insert › Sheet offers the same for the active sheet. All of it is undoable.
- **Merged cells**: clicking any part of a merged cell selects the whole merge (its top-left cell is the active cell); dragging or Shift+clicking grows the range to whole merges; double-click or typing edits the top-left cell. Right-click cells for Merge & Center, Merge Cells and Unmerge Cells (also Home › Merge & Center ▾ with Merge Across).
- **Sheet tabs**: Hide and Unhide… (lists the hidden sheets) are also in the tab menu, and in Home › Format.
- **Frozen panes** (View › Freeze Panes ▾): frozen rows and columns stay in place while the rest scrolls; clicks and drags work across the divider.
- Double-click a column boundary to autofit the column, a row boundary to autofit the row. Autofit measures the cells loaded in the view cache (the visible area plus prefetched blocks), not the whole sheet.
- **Notes and comments**: hover a cell with a red triangle (note) or a purple bubble (comment) to see it; click a shown note box to select it, drag to move it, drag its handles to resize it, double-click to edit. Hover a link for its ScreenTip; Ctrl+click follows it.
- Cut/paste moves the cells and their formulas keep their text; references to the moved cells (an area only when it lies entirely inside the moved block), in the moved formulas and anywhere in the workbook, follow them, as in Excel.

### Formula editing (point mode)

The cell editor and the formula bar edit the same text. While the text starts with `=` and the caret is after `=`, an operator, `(` or `,`, or on a reference, the editor is in point mode: clicking a cell inserts its reference (`A1`), dragging inserts a range (`A1:B3`), clicking a column/row header inserts `A:A` / `1:1`, Shift+click extends the pointed reference, and clicking a sheet tab and then a cell inserts `Sheet2!A1` (the edit continues in the formula bar and Enter returns to the edited cell). Each reference is coloured in the text and outlined on the grid in the same colour. Typing a function name lists the matching functions (the `fx` button lists all of them); inside a call a tip shows the signature with the current argument in bold.

Outside point mode, clicking another cell commits. Leaving the editor otherwise (toolbar, other controls) keeps the edit open. A formula that cannot be parsed is not committed: an inline message (for example "Unexpected end of formula – fix or press Esc to discard") appears and the text stays editable.

## Write

| Keys | Action |
| --- | --- |
| Mod+E, Mod+L, Mod+R, Mod+J | Center, left, right, justify |
| Mod+Shift+L | Bulleted list |
| Mod+Alt+1..3 | Heading 1..3 style (a toggle: again = Normal); the editor's keymap and the shortcut map run the same command (`SetStyle`), before Tiptap's own heading keys (Tiptap still binds 4..6) |
| Mod+F | Find: the find bar highlights every match in the document; Enter / Shift+Enter (or ↓ / ↑) go to the next / previous match; Esc closes it and removes the highlights |
| Mod+H | Find and replace (the bar with the replace field: Replace = the current match, Replace all = Rust `FindReplace`) |
| Mod+=, Mod+Shift+= | Subscript, superscript (bound in the editor) |
| Mod+Space | Remove character formatting of the selection (bound in the editor) |
| Mod+Shift+N | Normal style (Word; Home › Clear All Formatting has no key) |
| Mod+], Mod+[ | Font size 1 pt larger / smaller (each run of the selection from its own size; at the caret: the typing formatting) |
| Mod+Shift+>, Mod+Shift+< | Grow / shrink font: the next size of Word's list (8, 9, 10, 10.5, 11, 12, 14 … 28, 36, 48, 72; above 72 in steps of 10) |
| Mod+B, Mod+I, Mod+U | Bold, italic, underline relative to the style (Word's toggle semantics, P9-W3): in a bold heading Mod+B un-bolds (`w:b w:val="0"`), again it removes the direct value; decided by the selection's start |
| Mod+Shift+K, Mod+Shift+A | Small caps, all caps (toggles relative to the style; they exclude each other) |
| Mod+Shift+D | Double underline (toggle) |
| Mod+Shift+W | Word underline: the words-only underline (`w:u w:val="words"`; the spaces between the words stay without a line; toggle) |
| Shift+F1 | Show / hide the Reveal Formatting pane (P9-W3) |
| Shift+F3 | Change case of the selection (or the word at the caret; right after a sentence's period: the word before it): lowercase → Capitalize Each Word → UPPERCASE → lowercase; a selection that ends a sentence (`.` `!` `?`) cycles through Sentence case instead of Capitalize Each Word |
| Mod+T, Mod+Shift+T | Hanging indent: the text moves to the next / previous 1.27 cm step, the first line stays |
| Mod+Q | Remove paragraph formatting (alignment, indents, spacing, borders, shading, tabs, keep options; the style and the list stay) |
| Backspace at the start of a list item | First removes the number / bullet (the text keeps the level's indent), the second Backspace moves the paragraph to the margin (Word: Backspace at the start of an indented paragraph removes its left / first-line indent), the third joins it to the previous paragraph |
| Mod+Shift+C, Mod+Shift+V | Copy formatting (format painter stays on until Esc), paste formatting onto the selection |
| Mod+1, Mod+2, Mod+5 | Line spacing single, double, 1.5 |
| Mod+0 | Add / remove 12 pt space before the paragraph |
| Mod+M, Mod+Shift+M | Increase, decrease indent (list level inside lists) |
| Tab, Shift+Tab | In a table: next / previous cell; Tab in the last cell appends a row (formatted like the last one). In a list item Tab / Shift+Tab change the level; elsewhere Tab types a tab character (it goes to the next tab stop) |
| Esc | Stops the format painter |
| Mod+Alt+F, Mod+Alt+D | Insert footnote, insert endnote (the caret moves into the note) |
| Mod+Alt+M | New comment on the selection (or the word at the caret); in the comment box Ctrl+Enter posts, Esc cancels |
| F12 | Save as (Word's key; web: file name and Save as type – Word Document / Word Template; desktop: the native save dialog, `.docx` or `.dotx`) |
| Mod+N | New blank document at once (File › New shows the template gallery) |
| Mod+Shift+S | Apply Styles box: type a style name (autocomplete from the document's styles), Enter applies it; an unknown name creates a style from the selection; Esc closes (bound in the editor too, so it is no longer strikethrough) |
| Mod+Alt+Shift+S | Show / hide the Styles pane |
| Mod+H › More | Find and Replace with formatting: Use wildcards, Format ▾ (Font…, Paragraph…, Style…, Highlight) for the Find and the Replace field, No Formatting |
| Mod+K | Insert Hyperlink (on a link: edit it; Remove Link in the dialog) — bound in the editor |
| Mod+G, F5 | Go To: a page (print layout), a bookmark or a heading — bound in the editor (F5 does not reload the page while the editor has the focus) |
| Alt+F10 | Show / hide the Selection Pane (P9-W4; bound in the editor) |
| Arrow keys, Mod+arrow keys | With floating pictures or shapes selected: move them by Word's grid (0.13 in) / by one pixel (P9-W4) |
| Enter, Esc | While a shape is armed for drawing (Insert › Shapes): insert it at the caret at its default size / cancel (P9-W4) |
| Mod+Shift+Enter | Split Table above the caret's row (in the first row: an empty paragraph above the table; P9-W5) |
| Delete, Backspace | In the empty paragraph between two tables: join the tables (P9-W5) |
| Mod+Alt+- (also Num -), Mod+Num - | Em dash, en dash (P9-W5) |
| Mod+Shift+Space | Non-breaking space (P9-W5) |
| Mod+Shift+- | Non-breaking hyphen (`w:noBreakHyphen`; P9-W5) |
| Mod+- | Optional hyphen (`w:softHyphen`; P9-W5) |
| Mod+Alt+C, Mod+Alt+R, Mod+Alt+T, Mod+Alt+. | ©, ®, ™, … (P9-W5; keys by position, so they work on German keyboards; AltGr is not affected) |
| Esc | Ends the Border Painter (Table Design; P9-W5) |
| F9 | Update Field: the fields of the selection (REF, PAGEREF, NOTEREF, SEQ, STYLEREF and the property fields TITLE, AUTHOR, SUBJECT, KEYWORDS, COMMENTS, LASTSAVEDBY, DOCPROPERTY computed by the core, page/date/time/file name/save date/SECTIONPAGES by the UI; locked fields are skipped); Mod+A then F9 updates every field and the tables of contents in one undo step (P9-W6) |
| Alt+F9 | Show / hide the codes of all fields (`{ PAGE }`; P9-W6) |
| Shift+F9 | Show / hide the codes of the selected fields (P9-W6) |
| Mod+F11, Mod+Shift+F11 | Lock / unlock the selection's fields (`w:fldLock`; P9-W6) |
| Mod+B, Mod+I, Mod+U, @ | In a comment's balloon editor: bold, italic, underline; `@` lists the people to mention (↑/↓, Enter or Tab inserts, Esc closes the list); Mod+Enter posts, Esc cancels (P9-W6) |

In the browser a few of Word's keys belong to the browser and never reach the page: Mod+T (new tab), Mod+Shift+T
(reopen tab), Mod+Shift+N (new private window) and Mod+Shift+W (close the window) in Chrome, Mod+Q (quit) in Firefox on
Linux. The desktop app gets them all.

### Mouse

- **Pictures**: click selects a picture and shows eight handles; dragging a corner resizes proportionally, a side handle changes one dimension (one `SetImageSize` on release). Delete / Backspace removes a selected picture. Pictures pasted (Ctrl+V of a screenshot or copied image) or dropped on the page are inserted at the caret / drop point, scaled to the text width.
- **Tables**: the pointer becomes a resize cursor on a cell's right border (merged cells: the border after their last grid column); dragging moves the border (the neighbouring column gives or takes the difference, the last border widens the table) → `SetTableProps { colWidths }`. Shift+click (or a drag) across cells selects a rectangle of cells (grown to whole merged cells) for Merge Cells, Borders ▾, Shading, alignment.
- **Floating pictures**: drag a selected floating picture to move it (new offsets from the column and the paragraph → `SetImageAnchor`); the Layout Options button next to a selected picture switches its text wrapping.
- **Shapes, groups, canvases (P9-W4)**: after picking a shape in Insert › Shapes, click on the page for the default size or drag to draw it (Shift: square, lines at 45°); drawn on a drawing canvas it becomes part of the canvas. Dragging a selected floating shape snaps to the column's edges and centre; hold Alt to move it freely. The handles turn with a rotated shape. Shift+click or Ctrl+click adds pictures and shapes to the selection (for Group, Align, Distribute); a click on a member of a selected group selects the member, a drag moves it inside the group. Ctrl+click on a linked picture or shape follows its link. In a later box of linked text boxes a click puts the caret into the story there. Create Link: click Create Link, then the empty text box to link.
- **Ruler indents and table columns (P9-W5)**: drag the first-line triangle (first line only), the hanging triangle (the other lines; the first line stays), the box under it (both) or the right triangle; in a table drag a column marker to change the column widths. Alt while dragging: no snapping. Units follow the locale (cm / inches) or File › Options › Advanced.
- **Border Painter (P9-W5)**: with Table Design › Border Painter on (or after picking a Border Style), click a cell edge to give it the pen's style, weight and colour.
- **Ruler**: click to add a tab stop of the kind shown in the corner selector (click the selector to cycle Left / Center / Right / Decimal / Bar); drag a stop along the ruler to move it, down off the ruler to remove it; double-click a stop for Tabs….
- **Comments**: click commented text to select its thread (balloon / pane card); click a balloon to select it; with Show Comments off, click a margin comment icon to show the comments.
- **Right-click** in the document: Cut/Copy/Paste, New Comment, picture commands (alt text, reset size, delete) on a picture, Edit / Open / Remove Link on a linked picture or shape (P9-W4), table commands (insert rows above/below, columns left/right, delete rows/columns/table, Merge Cells, Split Cells…, row height…, Table Properties…) in a table, Paragraph…, Clear formatting.
- **Format painter** (Home › Clipboard): click copies the formatting at the caret for one use, double-click keeps it on; the next mouse selection (or the word clicked) gets it.
- **Headers and footers** are shown greyed in the page margins (print layout); double-click one to edit both in the Header and footer dialog (`{PAGE}` = page number).
- **Notes**: double-click a footnote/endnote reference to jump to its note; double-click the note's number (or a footnote at the bottom of a page) to jump back / into the note.
- **Table of contents**: click an entry to go to its heading.
- **Links**: Ctrl+click (Cmd+click) follows a link — a place in the document scrolls there, a web or e-mail address opens in a new tab; the tooltip shows the ScreenTip and "Ctrl+Click to follow link". Right-click on a link: Edit Link…, Open Link, Remove Link; elsewhere Link…; on a field (or a selection): Update Field.
- **Right-click in a list**: Restart at 1, Continue numbering.
- **Styles gallery** (Home › Styles): click applies the style (a character style to the selection or the word at the caret, a linked style to a partial selection as its character half); right-click (or the context-menu key) for Update *style* to Match Selection, Modify…, Select All *n* Instances, Rename…, Remove from Style Gallery.
- **Styles pane**: click a style to apply it; the ▾ next to each style opens the same menu plus Delete…; right-click works too.
- **Navigation pane** (View › Show › Navigation Pane): click a heading to go there.

## Show

| Keys | Action |
| --- | --- |
| Mod+C, Mod+X, Mod+V | Copy, cut, paste shapes (in the slide sorter: slides) |
| Mod+D | Duplicate |
| Mod+G, Mod+Shift+G | Group, ungroup |
| Mod+], Mod+[ | Bring forward, send backward |
| Mod+Shift+], Mod+Shift+[ | Bring to front, send to back |
| Arrows, Shift+Arrows | Nudge by 1 px (with Snap objects to grid: by the grid step onto the grid), by 10 px |
| Mod+Arrows | Nudge by 1 px, also while snapping to the grid |
| Shift+F9 | Show / hide the gridlines |
| Alt+F9 | Show / hide the drawing guides (the two centre guides when there are none) |
| Delete, Backspace | Delete the selection |
| Enter, F2 | Edit the text of the selected shape |
| Escape | Deselect; cancels drawing a shape chosen in the Shapes gallery, a Custom Path being drawn or the Animation Painter; leaves a focused adjust handle or Edit Points first |
| Tab, Shift+Tab | Focus the selected shape's next / previous adjust handle (Slide Master view: next / previous text level) |
| Arrows, Shift+Arrows (handle focused) | Move the focused adjust handle by 1 px, by 10 px |
| Click, drag, double-click (Freeform: Shape) | Add a corner, draw freehand, end the shape open; a click on the start point closes it |
| Enter, Escape (Freeform: Shape) | End the freeform open |
| Ctrl+click (Edit Points) | On a vertex: delete it; on the outline: add a vertex |
| Mod+A | Select all shapes |
| F5 | Present from the first slide |
| Shift+F5 | Present from the current slide |
| Alt+F5 | Presenter view: notes, next slide and timer here, the slide in a second window |

| Mod+Shift+>, Mod+Shift+< | Increase, decrease font size |

While editing a shape's text in place (P9-S1):

| Keys | Action |
| --- | --- |
| Enter | New paragraph (same level, bullet and alignment) |
| Shift+Enter | Line break inside the paragraph (`a:br`) |
| Tab, Shift+Tab | Increase, decrease the list level (levels 1–9) |
| Mod+A | Select all text of the shape |
| Mod+B, Mod+I, Mod+U | Bold, italic, underline of the selection |
| Mod+], Mod+[ | Increase, decrease font size (PowerPoint's size steps) |
| Mod+Shift+>, Mod+Shift+< | Increase, decrease font size |
| Mod+Z, Mod+Y | Undo, redo the typing of the session |
| Escape, Mod+Enter | End editing |

In the Outline View (P9-S3):

| Keys | Action |
| --- | --- |
| Tab, Shift+Tab | Demote, promote the selected lines (a demoted title joins the previous slide, a promoted line starts a slide) |
| Alt+Shift+→, Alt+Shift+← | Demote, promote (as Tab, Shift+Tab) |
| Alt+Shift+↑, Alt+Shift+↓ | Move the selected lines up, down |
| Alt+Shift+−, Alt+Shift++ | Collapse, expand the slide (only its title shows) |
| Alt+Shift+1, Alt+Shift+9 | Collapse all, expand all |
| Enter | New line at the same level (after a title: a new slide) |
| Mod+B, Mod+I, Mod+U | Bold, italic, underline of the selection |
| Mod+Z | Undo the typing not yet written back (else the last command) |

In the thumbnail pane and the Slide Sorter (P9-S3):

| Keys | Action |
| --- | --- |
| Mod+↑, Mod+↓ | Move the selected slides one place up, down (across section borders) |
| ←, → (on the pane's edge) | Narrow, widen the thumbnail pane |

### During the slide show

The same keys work in the full-window show (F5), in the presenter view and in its slide show window.

| Keys / mouse | Action |
| --- | --- |
| →, ↓, PageDown, Space, Enter, N; click on the right half | Next animation step, then the next slide (after the last one: a black "End of slide show" slide, then exit) |
| ←, ↑, PageUp, Backspace, P; click on the left half | Back one animation step, then the previous slide (with all its steps done) |
| Home, End | First, last slide |
| number + Enter | Go to that slide (`5` Enter) |
| B or `.`, W or `,` | Black / white screen (again or any step: back to the slide) |
| S | Stop / restart the automatic advance (Transitions › After) |
| Mod+L, Mod+P, Mod+I, Mod+E, Mod+A | Laser pointer, pen, highlighter, eraser, arrow (again: back to the arrow) |
| E, Mod+M | Erase all ink on the slide, show / hide ink |
| G or − | See all slides (click one to go there) |
| +, − | Zoom into the slide about the pointer, zoom out |
| Esc | Leave zoom / See all slides / the pen first; else end the show |

In the presenter view (P9-S5) the same keys draw, zoom and show "See all slides" in the console and on the slide show
window. Typing in the presenter view's notes edits them (the show keys do not apply there); Esc leaves the notes. At
the end of a show with ink: "Keep ink annotations?" (Keep / Discard).

Hidden slides are skipped unless the show starts on one. The mouse pointer hides after 3 s without movement. With
Transitions › On mouse click off, a click does not leave the slide (the keys still do).

In the Animation pane: ↑/↓ select an animation, Alt+↑/↓ move it earlier/later (PowerPoint's click-step semantics,
P9-S4), Delete removes it. Esc or a click stops a Preview on the stage.

Animations (P9-S4):

| Keys / mouse | Action |
| --- | --- |
| Drag on the stage (Add Animation › Custom Path) | Draw the motion path of the selected shape; Esc cancels |
| Drag a vertex of the selected motion path | Move the vertex (Edit Points); the path is saved on release |
| Click / double-click Animation Painter, then click shapes | Copy the selected shape's animations onto one / several shapes; Esc ends |
| ↑ / ↓ in a spinner (Duration, Delay, Fade In / Out), or its arrows | 0.25 s up / down within PowerPoint's limits |
| Click on a trigger shape (slide show) | Play the trigger's next animation step (the show does not advance) |

### Shapes, connectors and tables

| Keys / mouse | Action |
| --- | --- |
| Click in the Shapes gallery, then drag on the slide | Draw the shape (a click alone inserts the default size; Shift keeps the aspect ratio, lines snap to 45°) |
| Enter / Space on a Shapes gallery item | Insert it at the default size in the slide centre |
| Drag a yellow diamond | Change the shape's adjust value (corner radius, arrow head, callout tail …); an elbow connector's middle segment |
| Drag a connector end onto a shape | Glue it to the nearest connection site (grey dots, red when it snaps) |
| Click in a table cell | Edit the cell; drag across cells to select them; drag a column / row border to resize |
| Tab, Shift+Tab (in a cell) | Next / previous cell; Tab in the last cell adds a row |
| Arrows at the text's edges (in a cell) | Move to the cell above / below / left / right |
| Enter (in a cell) | New paragraph |

Mod+B/I/U also format the selected text inside the text overlay; there Tab / Shift+Tab change the list level of the
selected paragraphs. While dragging or resizing, shapes snap to the slide and to other shapes (smart guides, equal
spacing), to the drawing guides while they are shown and to the grid when Snap objects to grid is on; hold Alt to move
freely. Shift keeps the aspect ratio while resizing a shape (pictures keep it by default; Shift frees it).

### Views, guides and the Selection pane (P8-28)

| Keys / mouse | Action |
| --- | --- |
| Click, Mod+click, Shift+click (Slide Sorter) | Select a slide, add / remove one, select a range |
| Drag selected slides (Slide Sorter) | Move them before the slide under the pointer (also into another section) |
| Delete, Mod+D, Mod+A, Enter (Slide Sorter) | Delete, duplicate, select all slides, open in Normal view (also double-click) |
| Tab, Shift+Tab (Outline View) | Demote / promote the selected lines (a promoted body line becomes a slide) |
| Drag a guide; Mod+drag; drag off the slide | Move it; copy it; delete it (right-click: add, delete, colour) |
| Double-click / F2 (Selection pane) | Rename the shape |
| PageUp, PageDown (Notes Page) | Previous / next slide |

### Pictures, master view and sections (P8-22)

| Keys / mouse | Action |
| --- | --- |
| Picture Format › Crop, then drag a black handle | Move that edge of the crop (outwards pads); drag inside the frame to move the image under it |
| Enter, or a click outside the picture (crop mode) | Apply the crop |
| Esc (crop mode) | Leave crop mode without changes |
| ↑ / ↓ in the Slide Master panel | Select the master / the previous or next layout |
| Click a section header in the slide panel | Collapse / expand the section (right-click: rename, remove, move, collapse / expand all) |
| Drag a slide onto a section header | Move the slide to the start of that section |
