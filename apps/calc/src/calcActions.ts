// Calc editing actions shared by shortcuts, context menus and the ribbon:
// one function per user command, all going through the store.

import type { ContextMenuItem } from "@rusuite/ui-shared";
import { normalize } from "./grid/Selection";
import { t } from "./i18n";
import { hasFilters } from "./sortFilter/filter";
import { unhideableSheets, visibleSheets, type CalcStore } from "./state/store";

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
    /** Ctrl+X: marks the selection for a move (marching ants); a selected chart is cut. */
    cut: () => {
      if (store.charts.selected) {
        store.clearClip();
        void writeSystem(store.charts.copy());
        return store.charts.remove();
      }
      store.charts.forgetClip();
      void writeSystem(store.copy(true));
    },
    /** Ctrl+C (a selected chart: the chart). */
    copy: () => {
      if (store.charts.selected) {
        store.clearClip();
        return void writeSystem(store.charts.copy());
      }
      store.charts.forgetClip();
      void writeSystem(store.copy());
    },
    /** Ctrl+V from a menu: a copied chart, the internal clipboard, else the system clipboard's text. */
    paste: () => (store.charts.hasClip() && !store.hasClip() ? store.charts.paste() : pasteMode("all")),
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
    mergeCenter: () => store.mergeSelection("center"),
    mergeAcross: () => store.mergeSelection("across"),
    mergeCells: () => store.mergeSelection("cells"),
    unmergeCells: () => store.unmergeSelection(),
    /** Hide Sheet (the active one); not for the last visible sheet. */
    hideSheet: () => store.hideSheet(),
    canHideSheet: () => visibleSheets(store.getState().info?.sheets ?? []).length > 1,
    /** Unhide Sheet…: the dialog listing the hidden sheets. */
    unhideSheet: () => store.openDialog({ kind: "unhideSheet" }),
    canUnhideSheet: () => unhideableSheets(store.getState().info?.sheets ?? []).length > 0,
    /** Sort A to Z / Z to A by the active cell's column. */
    sortAsc: () => store.sortSelection(true),
    sortDesc: () => store.sortSelection(false),
    /** Custom Sort… (Data › Sort). */
    customSort: () => store.openCustomSort(),
    /** Filter on/off (Ctrl+Shift+L). */
    toggleFilter: () => store.toggleAutoFilter(),
    hasAutoFilter: () => store.autoFilter() !== null,
    /** Clear every column filter / apply them again. */
    clearFilters: () => store.clearFilters(),
    reapplyFilter: () => store.reapplyFilter(),
    hasFilters: () => hasFilters(store.autoFilter()),
    /** Data › Data Validation…. */
    dataValidation: () => store.openDialog({ kind: "dataValidation" }),
    // --- notes, comments, links (P8-26) ---
    /** Shift+F2: New Note / Edit Note. */
    editNote: () => store.comments.editNote(),
    deleteNote: () => store.comments.deleteNotes(),
    toggleNote: () => store.comments.toggleNote(),
    /** Ctrl+Shift+F2: New Comment (a cell with a thread opens it to reply). */
    newComment: () => store.comments.newComment(),
    deleteComment: () => store.comments.deleteThreads(),
    /** Opens the active cell's thread card (Reply to Comment). */
    replyComment: () => {
      const st = store.getState();
      const a = store.activeAnchor();
      store.comments.pin({ sheet: st.activeSheet, row: a.row, col: a.col });
    },
    /** Ctrl+K: Insert / Edit Link. */
    link: () => store.comments.openLinkDialog(),
    openLink: () => {
      const a = store.activeAnchor();
      return store.comments.follow({ sheet: store.getState().activeSheet, row: a.row, col: a.col });
    },
    removeLink: () => store.comments.removeLink(),
    /** What the active cell has, for the context menu. */
    annotationState: (): AnnotationState => {
      const at = { sheet: store.getState().activeSheet, ...store.activeAnchor() };
      const note = store.comments.note(at);
      return { note: !!note, noteVisible: !!note?.visible, thread: !!store.comments.thread(at), link: !!store.comments.link(at) || !!store.activeCell()?.link };
    },
  };
}

/** The active cell's annotations, for the cell context menu. */
export interface AnnotationState {
  note: boolean;
  noteVisible: boolean;
  thread: boolean;
  link: boolean;
}

export type CalcActions = ReturnType<typeof calcActions>;

type Item = Exclude<ContextMenuItem, { separator: true }>;
const item = (id: string, label: string, onSelect: () => unknown, shortcut?: string): Item => ({
  id, label, shortcut, onSelect: () => void onSelect(),
});
const SEP: ContextMenuItem = { separator: true };

const clipboardItems = (a: CalcActions): ContextMenuItem[] => [
  item("cut", t("cmd.cut"), a.cut, "Ctrl+X"),
  item("copy", t("cmd.copy"), a.copy, "Ctrl+C"),
  item("paste", t("cmd.paste"), a.paste, "Ctrl+V"),
  item("paste-values", t("calc.pasteValues"), a.pasteValues, "Ctrl+Shift+V"),
];

/** The context menu's note/comment/link entries for the active cell (Excel's order). */
export function annotationItems(a: CalcActions, st: AnnotationState): ContextMenuItem[] {
  return [
    st.thread ? item("reply-comment", t("calc.comments.reply"), a.replyComment) : item("new-comment", t("calc.comments.new"), a.newComment, "Ctrl+Shift+F2"),
    ...(st.thread ? [item("delete-comment", t("calc.comments.delete"), a.deleteComment)] : []),
    item("note", st.note ? t("calc.notes.edit") : t("calc.notes.new"), a.editNote, "Shift+F2"),
    ...(st.note ? [item("toggle-note", st.noteVisible ? t("calc.notes.hide") : t("calc.notes.show"), a.toggleNote), item("delete-note", t("calc.notes.delete"), a.deleteNote)] : []),
    SEP,
    st.link ? item("edit-link", t("calc.link.edit"), a.link, "Ctrl+K") : item("link", t("calc.link.button"), a.link, "Ctrl+K"),
    ...(st.link ? [item("open-link", t("calc.link.open"), a.openLink), item("remove-link", t("calc.link.remove"), a.removeLink)] : []),
  ];
}

/** Right-click on cells; `hasMerge`: the selection touches a merged cell (Unmerge enabled); `annot`: the active cell's notes/comments/links. */
export function cellMenu(a: CalcActions, hasMerge = false, annot?: AnnotationState): ContextMenuItem[] {
  return [
    ...clipboardItems(a),
    SEP,
    ...(annot ? [...annotationItems(a, annot), SEP] : []),
    item("insert-rows", t("calc.insertRows"), a.insertRows),
    item("insert-cols", t("calc.insertCols"), a.insertCols),
    item("delete-rows", t("calc.deleteRows"), a.deleteRows),
    item("delete-cols", t("calc.deleteCols"), a.deleteCols),
    SEP,
    item("clear", t("calc.clearContents"), a.clearContents, "Del"),
    SEP,
    item("sort-asc", t("calc.sortAsc"), a.sortAsc),
    item("sort-desc", t("calc.sortDesc"), a.sortDesc),
    item("custom-sort", t("calc.customSort"), a.customSort),
    SEP,
    item("merge-center", t("calc.mergeCenter"), a.mergeCenter),
    item("merge-cells", t("calc.mergeCells"), a.mergeCells),
    { ...item("unmerge", t("calc.unmergeCells"), a.unmergeCells), disabled: !hasMerge },
    SEP,
    item("format", t("calc.formatCellsDots"), a.formatCells, "Ctrl+1"),
    item("row-height", t("calc.rowHeightDots"), a.rowHeight),
    item("col-width", t("calc.colWidthDots"), a.colWidth),
  ];
}

/** Right-click on column headers. */
export function colHeaderMenu(a: CalcActions): ContextMenuItem[] {
  return [
    ...clipboardItems(a),
    SEP,
    item("insert-cols", t("calc.insertCols"), a.insertCols),
    item("delete-cols", t("calc.deleteCols"), a.deleteCols),
    item("clear", t("calc.clearContents"), a.clearContents, "Del"),
    SEP,
    item("format", t("calc.formatCellsDots"), a.formatCells, "Ctrl+1"),
    item("col-width", t("calc.colWidthDots"), a.colWidth),
    item("autofit", t("calc.autofitColWidth2"), a.autofitCols),
    item("hide", t("calc.hide"), a.hideCols),
    item("unhide", t("calc.unhide"), a.unhideCols),
  ];
}

/** Right-click on row headers. */
export function rowHeaderMenu(a: CalcActions): ContextMenuItem[] {
  return [
    ...clipboardItems(a),
    SEP,
    item("insert-rows", t("calc.insertRows"), a.insertRows),
    item("delete-rows", t("calc.deleteRows"), a.deleteRows),
    item("clear", t("calc.clearContents"), a.clearContents, "Del"),
    SEP,
    item("format", t("calc.formatCellsDots"), a.formatCells, "Ctrl+1"),
    item("row-height", t("calc.rowHeightDots"), a.rowHeight),
    item("hide", t("calc.hide"), a.hideRows),
    item("unhide", t("calc.unhide"), a.unhideRows),
  ];
}
