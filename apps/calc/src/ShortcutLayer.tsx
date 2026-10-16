// Keyboard shortcuts of Calc: one `useShortcuts` map plus the dialogs some
// of them open (Save As, insert/delete, help). Grid navigation (arrows,
// Ctrl+Arrow, Shift+Arrow, Tab, Enter, Page keys, Home/End, Ctrl+A) and the
// in-cell editor keys (Enter/Tab/Esc/Alt+Enter) live in the components.

import { useMemo, useState } from "react";
import { Dialog, openBackstage, PromptDialog, ShortcutHelp, useShortcuts, withExtension, type HelpRow, type ShortcutMap, type UnsavedGuard } from "@rusuite/ui-shared";
import { colSelection, isWholeCols, isWholeRows, normalize, rowSelection } from "./grid/Selection";
import { calcActions } from "./calcActions";
import { CalcDialogs } from "./CalcDialogs";
import { ValidationAlertDialog } from "./validation/ValidationDialogs";
import { t as translate, useT } from "./i18n";
import type { CalcStore } from "./state/store";
import { openCreateTable } from "./tables/TableRibbon";

const inGrid = (e: KeyboardEvent) => (e.target as HTMLElement | null)?.hasAttribute?.("data-calc-grid") ?? false;

/** Keys handled inside the grid / cell editor components, listed for the help dialog. */
export const nativeRows = (t = translate): HelpRow[] => [
  { combo: "Mod+ArrowRight", label: t("calc.sc.jumpEdge"), group: t("sc.navigation") },
  { combo: "Mod+Shift+ArrowRight", label: t("calc.sc.extendEdge"), group: t("sc.navigation") },
  { combo: "Mod+A", label: t("cmd.selectAll"), group: t("sc.navigation") },
  { combo: "Alt+Enter", label: t("calc.sc.lineBreak"), group: t("group.editing") },
  { combo: "Mod+C", label: t("calc.sc.copy"), group: t("sc.edit") },
  { combo: "Mod+X", label: t("calc.sc.cut"), group: t("sc.edit") },
  { combo: "Mod+V", label: t("calc.sc.paste"), group: t("sc.edit") },
  { combo: "Escape", label: t("calc.sc.cancelCopy"), group: t("sc.edit") },
  { combo: "Alt+ArrowDown", label: t("calc.sc.filterMenu"), group: t("calc.sortFilter") },
];

function StructureDialog({ kind, onClose, store }: { kind: "insert" | "delete" | null; onClose: () => void; store: CalcStore }) {
  const t = useT();
  const [axis, setAxis] = useState<"rows" | "cols">("rows");
  const Label = kind === "insert" ? t("tab.insert") : t("cmd.delete");
  return (
    <Dialog open={kind !== null} title={Label} onClose={onClose}>
      <form
        className="flex w-64 flex-col gap-2 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (kind) void store.structure(kind, axis);
          onClose();
          store.focusGrid();
        }}
      >
        <label className="flex items-center gap-2">
          <input type="radio" name="axis" checked={axis === "rows"} onChange={() => setAxis("rows")} />
          {t("calc.sc.entireRow")}
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="axis" checked={axis === "cols"} onChange={() => setAxis("cols")} />
          {t("calc.sc.entireCol")}
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" className="h-7 rounded border border-ui-border px-3 hover:bg-ui-hover" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button type="submit" className="h-7 rounded border border-ui-border px-3 hover:bg-ui-hover">
            {t("common.ok")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function ShortcutLayer({ store, guard }: { store: CalcStore; guard: UnsavedGuard }) {
  const t = useT();
  const [helpOpen, setHelpOpen] = useState(false);
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const [structure, setStructure] = useState<"insert" | "delete" | null>(null);

  const map = useMemo<ShortcutMap>(() => {
    const File = t("sc.file");
    const grid = t("calc.sc.grid");
    const actions = calcActions(store);
    /** Delete: a selected chart or note box goes, else the cell contents (notes stay, as in Excel). */
    const deleteKey = () => {
      const note = store.comments.selectedNote;
      if (note) {
        store.comments.selectedNote = null;
        return store.apply({ type: "deleteNote", sheet: note.sheet, r0: note.row, c0: note.col, r1: note.row, c1: note.col });
      }
      if (store.pictures.selected) return store.pictures.remove();
      return store.charts.selected ? store.charts.remove() : store.clearSelection();
    };
    /** Data › Group / Ungroup (Alt+Shift+→ / ←): whole columns group columns, anything else rows. */
    const group = (ungroup: boolean) => () => {
      const r = normalize(store.getState().selection);
      const cols = isWholeCols(r) && !isWholeRows(r);
      const sheet = store.getState().activeSheet;
      void store.apply({ type: "groupOutline", sheet, axis: cols ? "cols" : "rows", i0: cols ? r.c0 : r.r0, i1: cols ? r.c1 : r.r1, ungroup });
    };
    /** Insert/delete: whole-row or whole-column selections skip the dialog. */
    const structural = (kind: "insert" | "delete") => () => {
      const r = normalize(store.getState().selection);
      if (isWholeRows(r)) void store.structure(kind, "rows");
      else if (isWholeCols(r)) void store.structure(kind, "cols");
      else setStructure(kind);
    };
    return {
      "Mod+N": { label: t("calc.sc.newWorkbook"), group: File, inField: true, run: () => void guard.run(() => store.newFile()) },
      "Mod+O": { label: t("cmd.open"), group: File, inField: true, run: () => void guard.run(() => store.openFile()) },
      "Mod+S": { label: t("cmd.save"), group: File, inField: true, run: () => void store.saveFile() },
      // Desktop: the native save dialog is the Save As; web: name the download first.
      "Mod+Shift+S": {
        label: t("cmd.saveAs"),
        group: File,
        inField: true,
        run: () => (store.api.backend.kind === "tauri" ? void store.saveFile(undefined, true) : setSaveAsOpen(true)),
      },
      "Mod+P": {
        label: t("sc.printTip"),
        group: File,
        inField: true,
        run: () => {
          store.cancelEdit();
          openBackstage("print");
        },
      },
      "Mod+/": { label: t("shortcuts.title"), inField: true, run: () => setHelpOpen(true) },
      "Mod+Z": { label: t("cmd.undo"), group: t("sc.edit"), when: inGrid, run: () => void store.undo() },
      "Mod+Y": { label: t("cmd.redo"), group: t("sc.edit"), when: inGrid, run: () => void store.redo() },
      "Mod+Shift+Z": { label: t("cmd.redo"), group: t("sc.edit"), when: inGrid, run: () => void store.redo() },
      "Mod+B": { label: t("fmt.bold"), group: t("sc.format"), when: inGrid, run: () => void store.toggleFont("bold") },
      "Mod+I": { label: t("fmt.italic"), group: t("sc.format"), when: inGrid, run: () => void store.toggleFont("italic") },
      "Mod+U": { label: t("fmt.underline"), group: t("sc.format"), when: inGrid, run: () => void store.toggleFont("underline") },
      "Mod+1": { label: t("calc.sc.formatCells"), group: t("sc.format"), when: inGrid, run: () => actions.formatCells() },
      "Mod+F": { label: t("cmd.find"), group: t("sc.edit"), when: inGrid, run: () => actions.find() },
      "Mod+H": { label: t("cmd.findReplace"), group: t("sc.edit"), when: inGrid, run: () => actions.replace() },
      "Mod+Shift+V": { label: t("calc.sc.pasteValues"), group: t("sc.edit"), when: inGrid, run: () => void actions.pasteValues() },
      "Mod+D": { label: t("calc.sc.fillDown"), group: t("sc.edit"), when: inGrid, run: () => void actions.fillDown() },
      "Mod+R": { label: t("calc.sc.fillRight"), group: t("sc.edit"), when: inGrid, run: () => void actions.fillRight() },
      F2: { label: t("calc.sc.editCell"), group: t("sc.edit"), when: inGrid, run: () => store.beginEdit(null) },
      // A selected chart is deleted instead (Excel).
      Delete: { label: t("calc.sc.clearCells"), group: t("sc.edit"), when: inGrid, run: () => void deleteKey() },
      Backspace: { label: t("calc.sc.clearCells"), group: t("sc.edit"), when: inGrid, run: () => void deleteKey() },
      "Shift+F2": { label: t("calc.notes.newEdit"), group: t("calc.tab.review"), when: inGrid, run: () => actions.editNote() },
      "Mod+Shift+F2": { label: t("calc.comments.new"), group: t("calc.tab.review"), when: inGrid, run: () => actions.newComment() },
      "Mod+K": { label: t("calc.link.button"), group: t("tab.insert"), when: inGrid, run: () => actions.link() },
      "Mod+Space": {
        label: t("calc.sc.selectCol"),
        group: grid,
        when: inGrid,
        run: () => {
          const s = store.getState().selection;
          store.select(colSelection(s.anchor.col, s.focus.col));
        },
      },
      "Shift+Space": {
        label: t("calc.sc.selectRow"),
        group: grid,
        when: inGrid,
        run: () => {
          const s = store.getState().selection;
          store.select(rowSelection(s.anchor.row, s.focus.row));
        },
      },
      "Mod+Shift+L": { label: t("calc.sc.toggleFilter"), group: t("calc.sortFilter"), when: inGrid, run: () => void actions.toggleFilter() },
      "Shift+F11": { label: t("calc.sc.insertSheet"), group: t("calc.sheets"), when: inGrid, run: () => void store.insertSheet() },
      "Mod+Plus": { label: t("calc.sc.insertRowsCols"), group: grid, when: inGrid, run: structural("insert") },
      "Mod+Minus": { label: t("calc.sc.deleteRowsCols"), group: grid, when: inGrid, run: structural("delete") },
      "Mod+`": { label: t("calc.audit.showFormulas"), group: t("calc.tab.formulas"), when: inGrid, run: () => store.toggleShowFormulas() },
      "Mod+G": { label: t("calc.goTo.title"), group: t("sc.navigation"), when: inGrid, run: () => store.openDialog({ kind: "goTo" }) },
      F5: { label: t("calc.goTo.title"), group: t("sc.navigation"), when: inGrid, run: () => store.openDialog({ kind: "goTo" }) },
      "Shift+F3": { label: t("calc.fn.insert"), group: t("calc.tab.formulas"), inField: true, run: () => store.openDialog({ kind: "insertFunction" }) },
      "Mod+F3": { label: t("calc.names.manager"), group: t("calc.tab.formulas"), when: inGrid, run: () => store.openDialog({ kind: "nameManager" }) },
      "Mod+Shift+F3": { label: t("calc.names.createFromSelection"), group: t("calc.tab.formulas"), when: inGrid, run: () => store.openDialog({ kind: "createNames" }) },
      "Alt+=": { label: t("calc.fn.autoSum"), group: t("calc.tab.formulas"), when: inGrid, run: () => store.autoSum("SUM") },
      // Insert › Table (Excel: Ctrl+T and Ctrl+L).
      "Mod+T": { label: t("calc.table.create"), group: t("tab.insert"), when: inGrid, run: () => openCreateTable(store) },
      "Mod+L": { label: t("calc.table.create"), group: t("tab.insert"), when: inGrid, run: () => openCreateTable(store) },
      "Mod+Alt+V": { label: t("calc.ps.title"), group: t("sc.edit"), when: inGrid, run: () => store.openDialog({ kind: "pasteSpecial" }) },
      "Alt+Shift+ArrowRight": { label: t("calc.outline.group"), group: t("calc.tab.data"), when: inGrid, run: group(false) },
      "Alt+Shift+ArrowLeft": { label: t("calc.outline.ungroup"), group: t("calc.tab.data"), when: inGrid, run: group(true) },
      // PivotTable Analyze › Refresh / Refresh All (Excel's keys).
      "Alt+F5": {
        label: t("calc.pivot.refresh"),
        group: t("calc.pivot.pivotTable"),
        when: inGrid,
        run: () => {
          const p = store.pivots.active();
          if (p) void store.pivots.refresh(p.id);
        },
      },
      "Mod+Alt+F5": { label: t("calc.pivot.refreshAll"), group: t("calc.pivot.pivotTable"), when: inGrid, run: () => void store.pivots.refresh(null) },
    };
  }, [store, guard, t]);

  useShortcuts(map);

  return (
    <>
      <ShortcutHelp open={helpOpen} onClose={() => setHelpOpen(false)} shortcuts={map} extra={nativeRows(t)} />
      <PromptDialog
        open={saveAsOpen}
        title={t("cmd.saveAs")}
        label={t("saveAs.fileName")}
        initial={store.getState().name ?? t("calc.defaultName")}
        confirmLabel={t("cmd.save")}
        onClose={() => setSaveAsOpen(false)}
        onSubmit={(name) => {
          setSaveAsOpen(false);
          // A `.csv` name saves the active sheet as CSV (with its options and Excel's warning).
          if (/\.csv$/i.test(name.trim())) store.openDialog({ kind: "saveCsv", name: name.trim() });
          else void store.saveFile(withExtension(name, ".xlsx"));
        }}
      />
      <StructureDialog kind={structure} store={store} onClose={() => setStructure(null)} />
      <CalcDialogs store={store} />
      <ValidationAlertDialog store={store} />
    </>
  );
}
