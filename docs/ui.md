# UI: the ribbon

All three apps use the same Office-style ribbon from `packages/ui-shared/src/ribbon` (P6-1): a tab strip with the app name and
document title on the left, **File** + the app's tabs, a right slot (Show: Present) and the collapse toggle, over the active
tab's groups. Expanded it is ≤ 96 px tall (28 px strip + 64 px groups); collapsed it is the strip only.

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
| `triggerShortcut(combo)` | Runs an entry of the app's `useShortcuts` map (dispatches the key on `window`), so ribbon commands reuse the ShortcutLayer's dialogs (Save As, help, New with its discard prompt). |

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

Each app keeps its status bar; Calc and Show also show the zoom there.
