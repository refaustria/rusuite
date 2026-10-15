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

## Calc

| Keys | Action |
| --- | --- |
| Mod+Arrow | Jump to the edge of the data |
| Mod+Shift+Arrow | Extend the selection to the edge of the data |
| F2 | Edit the active cell (edit mode); inside the editor: switch between edit and enter mode |
| Delete, Backspace | Clear the selection |
| Alt+Enter | Line break in the cell editor (stored as `\n`; cells do not wrap yet) |
| Enter, Tab (Shift: reverse) | Commit the edit and move down / right |
| Esc | Cancel the edit (first closes the function list) |
| Arrows | Enter mode (editing started by typing): point at cells in a formula, otherwise commit and move. Edit mode (F2, double-click, formula bar): move the caret |
| Shift+Arrows | While pointing: extend the pointed reference to a range |
| F4 | Cycle `$` anchoring of the reference at the caret: `A1` → `$A$1` → `A$1` → `$A1` |
| ArrowUp/ArrowDown, Tab/Enter | Function list: choose, accept (`SUM(`) |
| Mod+Space, Shift+Space | Select the column(s), the row(s) |
| Mod+Plus, Mod+Minus | Insert, delete rows or columns (dialog unless whole rows/columns are selected) |
| Mod+1 | Format cells: focus the formatting toolbar |

Find is not offered in Calc yet.

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

Mod+B/I/U also format the selected text inside the text overlay.
