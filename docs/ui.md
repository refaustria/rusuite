# UI: the ribbon

All three apps use the same Office-style ribbon from `packages/ui-shared/src/ribbon` (P6-1): a tab strip with the app name and
document title on the left, **File** + the app's tabs, a right slot (Show: Present) and the collapse toggle, over the active
tab's groups. Expanded it is ≤ 96 px tall (28 px strip + 64 px groups); collapsed it is the strip only.


### Write additions (P6-4)
Contextual **Table** tab (insert/delete rows and columns, shading, borders, header row, row height), contextual **Picture Format** tab (alt text, align, size, reset, delete), **Print layout** view with page gaps, greyed headers/footers (double-click to edit) and Draft view, non-modal find bar with highlighted matches, Paragraph dialog, format painter, highlight/font colour menus, View › Spelling.

## Building blocks (`@rusuite/ui-shared`)

| Export | Use |
| --- | --- |
| `Ribbon` | `tabs: RibbonTab[]` (`{ id, label, groups: { label, items }[], toolbarLabel? }`); empty groups and tabs without groups are omitted. Active tab controlled (`activeTab`/`onTabChange`) or not (`defaultTab`); collapse likewise (`collapsed`/`defaultCollapsed`/`onCollapsedChange`). `backstage` adds the File tab; `accent` colors it. |
| `Backstage` | Full-pane File view: New, Open…, Save, Save As…, Export PDF…, Close and the session's recent files (re-opened through `DocumentSession.openRecent`). Commands without a handler are not shown; `fileDisabledReason` disables the file commands with a note. Esc / Back returns. |
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

- **Calc**: Home (Undo; Clipboard: Paste ▾ values, Cut, Copy – `calcActions`; Font incl. borders; Alignment incl. wrap; Number:
  format, %, comma, decimals ±; Cells: Insert ▾, Delete ▾, Format ▾ (row height, column width, autofit, hide/unhide, Format
  cells…); Editing: Clear, Find ▾ Replace), Insert (New sheet, rows/columns), View (gridlines, formula bar, zoom 50–200 % via CSS
  `zoom` on the grid with hit-testing scaled, shortcuts help).
- **Write**: Home (Undo; Clipboard; Font; Paragraph: lists, indent, line spacing, alignment; Styles gallery Normal/Title/Heading
  1–6; Editing: Find and replace), Insert (Table picker, Picture, Page break, Line break), Layout (Margins, Orientation, Size →
  `SetPage`), View (zoom, shortcuts help).
- **Show**: Home (Undo; Clipboard: shapes/slides clipboard + Duplicate; Slides: New slide ▾ layouts, Layout ▾, Duplicate,
  Delete, Hide slide; Font + grow/shrink; Paragraph + line spacing ▾; Drawing: shapes gallery, Arrange ▾
  order/align/distribute/group, fill and outline), Insert (New slide, Picture, Shapes ▾, Text box), Design (Background
  colour, Apply to all, Reset), View (Notes pane, present from beginning/current, zoom Fit/50–200 %, shortcuts help),
  contextual Shape Format while shapes are selected (Format shape…, Alt text…, Change picture…/Reset size, Arrange ▾);
  Present in the strip. Right-click menus on shapes, on the slide and on thumbnails (`apps/show/src/canvas/menus.ts`).

Each app keeps its status bar; Calc and Show also show the zoom there, all three the last autosave.

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
