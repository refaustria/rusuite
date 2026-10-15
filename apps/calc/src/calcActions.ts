// Calc editing actions shared by shortcuts, context menus and the ribbon:
// one function per user command, all going through the store.

import type { ContextMenuItem } from "@rusuite/ui-shared";
import { normalize } from "./grid/Selection";
import type { CalcStore } from "./state/store";

/** Writes text to the system clipboard (best effort: permissions may deny it). */
async function writeSystem(text: string): Promise<void> {
  try {
    await navigator.clipboard?.writeText(text);
  } catch {
    // The internal clipboard still has the copy.
  }
}

/** Reads the system clipboard's text (best effort). */
async function readSystem(): Promise<string | undefined> {
  try {
    return await navigator.clipboard?.readText();
  } catch {
    return undefined;
  }
}

/** Every editing action of the Calc UI, bound to `store`. */
export function calcActions(store: CalcStore) {
  const selectedCols = () => {
    const r = normalize(store.getState().selection);
    const cols: number[] = [];
    for (let c = r.c0; c <= Math.min(r.c1, r.c0 + 999); c++) cols.push(c);
    return cols;
  };
  const pasteMode = async (mode: "all" | "valuesOnly") => {
    if (store.hasClip()) return store.paste(undefined, mode);
    const text = await readSystem();
    if (text) return store.paste(text, mode);
  };
  return {
    /** Ctrl+X: marks the selection for a move (marching ants). */
    cut: () => void writeSystem(store.copy(true)),
    /** Ctrl+C. */
    copy: () => void writeSystem(store.copy()),
    /** Ctrl+V from a menu: the internal clipboard, else the system clipboard's text. */
    paste: () => pasteMode("all"),
    /** Ctrl+Shift+V: values only. */
    pasteValues: () => pasteMode("valuesOnly"),
    insertRows: () => store.structure("insert", "rows"),
    insertCols: () => store.structure("insert", "cols"),
    deleteRows: () => store.structure("delete", "rows"),
    deleteCols: () => store.structure("delete", "cols"),
    clearContents: () => store.clearSelection(),
    /** Ctrl+D: copy the first row of the selection down. */
    fillDown: () => store.fillCopy("down"),
    /** Ctrl+R: copy the first column of the selection right. */
    fillRight: () => store.fillCopy("right"),
    /** Ctrl+1: Format Cells (number format). */
    formatCells: () => store.openDialog({ kind: "numberFormat" }),
    find: () => store.openDialog({ kind: "find", replace: false }),
    replace: () => store.openDialog({ kind: "find", replace: true }),
    rowHeight: () => store.openDialog({ kind: "rowHeight" }),
    colWidth: () => store.openDialog({ kind: "colWidth" }),
    hideRows: () => store.setHidden("rows", true),
    unhideRows: () => store.setHidden("rows", false),
    hideCols: () => store.setHidden("cols", true),
    unhideCols: () => store.setHidden("cols", false),
    /** Autofit the selected columns to their (cached) content. */
    autofitCols: () => store.autofitCols(selectedCols()),
    /** Autofit every column with content (measures loaded cells only). */
    autofitAllCols: () => store.autofitAllCols(),
    toggleWrap: () => store.toggleWrap(),
  };
}

export type CalcActions = ReturnType<typeof calcActions>;

type Item = Exclude<ContextMenuItem, { separator: true }>;
const item = (id: string, label: string, onSelect: () => unknown, shortcut?: string): Item => ({
  id, label, shortcut, onSelect: () => void onSelect(),
});
const SEP: ContextMenuItem = { separator: true };

const clipboardItems = (a: CalcActions): ContextMenuItem[] => [
  item("cut", "Cut", a.cut, "Ctrl+X"),
  item("copy", "Copy", a.copy, "Ctrl+C"),
  item("paste", "Paste", a.paste, "Ctrl+V"),
  item("paste-values", "Paste values", a.pasteValues, "Ctrl+Shift+V"),
];

/** Right-click on cells. */
export function cellMenu(a: CalcActions): ContextMenuItem[] {
  return [
    ...clipboardItems(a),
    SEP,
    item("insert-rows", "Insert rows", a.insertRows),
    item("insert-cols", "Insert columns", a.insertCols),
    item("delete-rows", "Delete rows", a.deleteRows),
    item("delete-cols", "Delete columns", a.deleteCols),
    SEP,
    item("clear", "Clear contents", a.clearContents, "Del"),
    SEP,
    item("format", "Format cells…", a.formatCells, "Ctrl+1"),
    item("row-height", "Row height…", a.rowHeight),
    item("col-width", "Column width…", a.colWidth),
  ];
}

/** Right-click on column headers. */
export function colHeaderMenu(a: CalcActions): ContextMenuItem[] {
  return [
    ...clipboardItems(a),
    SEP,
    item("insert-cols", "Insert columns", a.insertCols),
    item("delete-cols", "Delete columns", a.deleteCols),
    item("clear", "Clear contents", a.clearContents, "Del"),
    SEP,
    item("format", "Format cells…", a.formatCells, "Ctrl+1"),
    item("col-width", "Column width…", a.colWidth),
    item("autofit", "Autofit column width", a.autofitCols),
    item("hide", "Hide", a.hideCols),
    item("unhide", "Unhide", a.unhideCols),
  ];
}

/** Right-click on row headers. */
export function rowHeaderMenu(a: CalcActions): ContextMenuItem[] {
  return [
    ...clipboardItems(a),
    SEP,
    item("insert-rows", "Insert rows", a.insertRows),
    item("delete-rows", "Delete rows", a.deleteRows),
    item("clear", "Clear contents", a.clearContents, "Del"),
    SEP,
    item("format", "Format cells…", a.formatCells, "Ctrl+1"),
    item("row-height", "Row height…", a.rowHeight),
    item("hide", "Hide", a.hideRows),
    item("unhide", "Unhide", a.unhideRows),
  ];
}
