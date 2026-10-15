# Keyboard shortcuts

`Mod` is Ctrl on Windows/Linux and Cmd on macOS. Press `Mod+/` in any app to list the shortcuts.

## How they are wired

`packages/ui-shared/src/shortcuts` provides `useShortcuts(map)`: a map from combo (`"Mod+Shift+S"`) to `{ label, group, run, inField?, when? }`, bound to `window` keydown (bubbling, so the editor's own handling goes first and handled events are skipped). By default a shortcut does not fire when the key comes from an input, textarea, contenteditable, menu or dialog; `inField: true` opts in (file and help keys). `when` is an extra guard (Calc: the grid has focus). Entries without `run` document keys that the editor binds itself (Tiptap marks, Write undo/redo). Each app registers its map in `src/ShortcutLayer.tsx`; each map is tested by firing keyboard events (`src/shortcuts.test.tsx`, `packages/ui-shared/src/shortcuts/shortcuts.test.tsx`).

`Mod+P` is bound to a no-op placeholder in every app; the PDF export task replaces it.

## All apps

| Keys | Action |
| --- | --- |
| Mod+N | New document (asks before discarding unsaved changes) |
| Mod+O | Open |
| Mod+S | Save |
| Mod+Shift+S | Save as (asks for a file name) |
| Mod+P | Print / export PDF (placeholder) |
| Mod+Z, Mod+Y, Mod+Shift+Z | Undo, redo, redo |
| Mod+B, Mod+I, Mod+U | Bold, italic, underline |
| Mod+/ | Shortcut help |

## Calc

| Keys | Action |
| --- | --- |
| Mod+Arrow | Jump to the edge of the data |
| Mod+Shift+Arrow | Extend the selection to the edge of the data |
| F2 | Edit the active cell |
| Delete, Backspace | Clear the selection |
| Alt+Enter | Line break in the cell editor (stored as `\n`; cells do not wrap yet) |
| Mod+Space, Shift+Space | Select the column(s), the row(s) |
| Mod+Plus, Mod+Minus | Insert, delete rows or columns (dialog unless whole rows/columns are selected) |
| Mod+1 | Format cells: focus the formatting toolbar |

Find is not offered in Calc yet.

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
