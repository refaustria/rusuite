# Keyboard shortcuts

`Mod` is Ctrl on Windows/Linux and Cmd on macOS. Press `Mod+/` in any app to list the shortcuts.

## How they are wired

`packages/ui-shared/src/shortcuts` provides `useShortcuts(map)`: a map from combo (`"Mod+Shift+S"`) to `{ label, group, run, inField?, when? }`, bound to `window` keydown (bubbling, so the editor's own handling goes first and handled events are skipped). By default a shortcut does not fire when the key comes from an input, textarea, contenteditable, menu or dialog; `inField: true` opts in (file and help keys). `when` is an extra guard (Calc: the grid has focus). Entries without `run` document keys that the editor binds itself (Tiptap marks, Write undo/redo). Each app registers its map in `src/ShortcutLayer.tsx`; each map is tested by firing keyboard events (`src/shortcuts.test.tsx`, `packages/ui-shared/src/shortcuts/shortcuts.test.tsx`).

`Mod+P` runs the app's "Export PDF…" (webview print) through the same map: Calc opens its print setup dialog, Write and Show go straight to the print view / print dialog.

## All apps

| Keys | Action |
| --- | --- |
| Mod+N | New document (asks before discarding unsaved changes) |
| Mod+O | Open |
| Mod+S | Save |
| Mod+Shift+S | Save as (asks for a file name) |
| Mod+P | Export PDF… |
| Mod+Z, Mod+Y, Mod+Shift+Z | Undo, redo, redo |
| Mod+B, Mod+I, Mod+U | Bold, italic, underline |
| Mod+/ | Shortcut help |
| Alt (press and release) | Focus the ribbon tabs (again: back to the document); ←/→ move, Enter/Space open a tab, ↓ enters its commands, Esc leaves |
| Ctrl+F1 | Collapse / expand the ribbon |

## Calc

| Keys | Action |
| --- | --- |
| Mod+Arrow | Jump to the edge of the data |
| Mod+Shift+Arrow | Extend the selection to the edge of the data |
| F2 | Edit the active cell (edit mode); inside the editor: switch between edit and enter mode |
| Delete, Backspace | Clear the selection |
| Alt+Enter | Line break in the cell editor (stored as `\n`; committing turns wrap text on and grows the row) |
| Enter, Tab (Shift: reverse) | Commit the edit and move down / right |
| Esc | Cancel the edit (first closes the function list) |
| Arrows | Enter mode (editing started by typing): point at cells in a formula, otherwise commit and move. Edit mode (F2, double-click, formula bar): move the caret |
| Shift+Arrows | While pointing: extend the pointed reference to a range |
| F4 | Cycle `$` anchoring of the reference at the caret: `A1` → `$A$1` → `A$1` → `$A1` |
| ArrowUp/ArrowDown, Tab/Enter | Function list: choose, accept (`SUM(`) |
| Mod+Space, Shift+Space | Select the column(s), the row(s) |
| Mod+Plus, Mod+Minus | Insert, delete rows or columns (dialog unless whole rows/columns are selected) |
| Mod+1 | Format cells: number format dialog (General, Number, Currency, Percentage, Date, Time, Text, Custom) with a live preview |
| Mod+C, Mod+X | Copy, cut: the range gets a marching-ants outline; a cut moves the cells on the next paste |
| Mod+V | Paste at the selection's top-left (relative references shift; the block repeats over a selection that is a multiple of it). Text from other programs is pasted as plain values (TSV) |
| Mod+Shift+V | Paste values only (formulas paste their current values; destination formats kept) |
| Esc | Leave copy / cut mode (the marching ants disappear) |
| Mod+F, Mod+H | Find, find and replace (sheet or workbook, match case, entire cell; inputs and displayed values are searched) |

### Mouse

- **Fill handle** (the small square at the selection's bottom-right): drag down, up, right or left to fill. One cell is copied (relative references shift); two or more numbers continue their linear trend (1, 2 → 3, 4, …); a date steps by a day; text ending in a number counts up (`Item1` → `Item2`). Hold Ctrl while releasing to swap series and copy. Double-click the handle to fill down to the end of the neighbouring column's data.
- **Right-click** cells, row headers, column headers or sheet tabs for a context menu (cut/copy/paste/paste values, insert/delete rows and columns, clear contents, format cells, row height / column width, hide/unhide, autofit column width, rename sheet). The menu is keyboard navigable (arrows, Home/End, Enter, Esc).
- Double-click a column boundary to autofit the column, a row boundary to autofit the row. Autofit measures the cells loaded in the view cache (the visible area plus prefetched blocks), not the whole sheet.
- Cut/paste moves the cells and their formulas keep their text; formulas elsewhere that refer to the moved cells are not adjusted yet.

### Formula editing (point mode)

The cell editor and the formula bar edit the same text. While the text starts with `=` and the caret is after `=`, an operator, `(` or `,`, or on a reference, the editor is in point mode: clicking a cell inserts its reference (`A1`), dragging inserts a range (`A1:B3`), clicking a column/row header inserts `A:A` / `1:1`, Shift+click extends the pointed reference, and clicking a sheet tab and then a cell inserts `Sheet2!A1` (the edit continues in the formula bar and Enter returns to the edited cell). Each reference is coloured in the text and outlined on the grid in the same colour. Typing a function name lists the matching functions (the `fx` button lists all of them); inside a call a tip shows the signature with the current argument in bold.

Outside point mode, clicking another cell commits. Leaving the editor otherwise (toolbar, other controls) keeps the edit open. A formula that cannot be parsed is not committed: an inline message (for example "Unexpected end of formula – fix or press Esc to discard") appears and the text stays editable.

## Write

| Keys | Action |
| --- | --- |
| Mod+E, Mod+L, Mod+R, Mod+J | Center, left, right, justify |
| Mod+Shift+L | Bulleted list |
| Mod+Alt+1..3 | Heading 1..3 (Tiptap also binds 4..6) |
| Mod+F, Mod+H | Find and replace |

## Show

| Keys | Action |
| --- | --- |
| Mod+C, Mod+X, Mod+V | Copy, cut, paste shapes (in the slide sorter: slides) |
| Mod+D | Duplicate |
| Mod+G, Mod+Shift+G | Group, ungroup |
| Mod+], Mod+[ | Bring forward, send backward |
| Mod+Shift+], Mod+Shift+[ | Bring to front, send to back |
| Arrows, Shift+Arrows | Nudge by 1 px, by 10 px |
| Delete, Backspace | Delete the selection |
| Enter, F2 | Edit the text of the selected shape |
| Escape | Deselect |
| Mod+A | Select all shapes |
| F5 | Present from the first slide |
| Shift+F5 | Present from the current slide |

| Mod+Shift+>, Mod+Shift+< | Increase, decrease font size |

Mod+B/I/U also format the selected text inside the text overlay; there Tab / Shift+Tab change the list level of the
selected paragraphs. While dragging or resizing, shapes snap to the slide and to other shapes (smart guides); hold Alt to
move freely. Shift keeps the aspect ratio while resizing a shape (pictures keep it by default; Shift frees it). Arrow-key
nudges never snap.
