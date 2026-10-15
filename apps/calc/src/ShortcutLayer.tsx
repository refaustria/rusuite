// Keyboard shortcuts of Calc: one `useShortcuts` map plus the dialogs some
// of them open (Save As, insert/delete, help). Grid navigation (arrows,
// Ctrl+Arrow, Shift+Arrow, Tab, Enter, Page keys, Home/End, Ctrl+A) and the
// in-cell editor keys (Enter/Tab/Esc/Alt+Enter) live in the components.

import { useMemo, useState } from "react";
import { Dialog, PromptDialog, ShortcutHelp, useShortcuts, withExtension, type HelpRow, type ShortcutMap, type UnsavedGuard } from "@rusuite/ui-shared";
import { colSelection, isWholeCols, isWholeRows, normalize, rowSelection } from "./grid/Selection";
import { calcActions } from "./calcActions";
import { CalcDialogs } from "./CalcDialogs";
import type { CalcStore } from "./state/store";

const inGrid = (e: KeyboardEvent) => (e.target as HTMLElement | null)?.hasAttribute?.("data-calc-grid") ?? false;

/** Keys handled inside the grid / cell editor components, listed for the help dialog. */
export const NATIVE_ROWS: HelpRow[] = [
  { combo: "Mod+ArrowRight", label: "Jump to the edge of the data (any arrow)", group: "Navigation" },
  { combo: "Mod+Shift+ArrowRight", label: "Extend the selection to the edge of the data", group: "Navigation" },
  { combo: "Mod+A", label: "Select all", group: "Navigation" },
  { combo: "Alt+Enter", label: "Line break in the cell editor (turns wrap text on)", group: "Editing" },
  { combo: "Mod+C", label: "Copy (marching ants until Esc or an edit)", group: "Edit" },
  { combo: "Mod+X", label: "Cut: the paste moves the cells", group: "Edit" },
  { combo: "Mod+V", label: "Paste (formulas shift; repeats over a multiple selection)", group: "Edit" },
  { combo: "Escape", label: "Cancel copy / cut mode", group: "Edit" },
];

function StructureDialog({ kind, onClose, store }: { kind: "insert" | "delete" | null; onClose: () => void; store: CalcStore }) {
  const [axis, setAxis] = useState<"rows" | "cols">("rows");
  const Label = kind === "insert" ? "Insert" : "Delete";
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
          Entire row
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="axis" checked={axis === "cols"} onChange={() => setAxis("cols")} />
          Entire column
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" className="h-7 rounded border border-ui-border px-3 hover:bg-ui-hover" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="h-7 rounded border border-ui-border px-3 hover:bg-ui-hover">
            OK
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function ShortcutLayer({ store, guard, onExportPdf }: { store: CalcStore; guard: UnsavedGuard; onExportPdf: () => void }) {
  const [helpOpen, setHelpOpen] = useState(false);
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const [structure, setStructure] = useState<"insert" | "delete" | null>(null);

  const map = useMemo<ShortcutMap>(() => {
    const File = "File";
    const grid = "Grid";
    const actions = calcActions(store);
    /** Insert/delete: whole-row or whole-column selections skip the dialog. */
    const structural = (kind: "insert" | "delete") => () => {
      const r = normalize(store.getState().selection);
      if (isWholeRows(r)) void store.structure(kind, "rows");
      else if (isWholeCols(r)) void store.structure(kind, "cols");
      else setStructure(kind);
    };
    return {
      "Mod+N": { label: "New workbook", group: File, inField: true, run: () => void guard.run(() => store.newFile()) },
      "Mod+O": { label: "Open", group: File, inField: true, run: () => void guard.run(() => store.openFile()) },
      "Mod+S": { label: "Save", group: File, inField: true, run: () => void store.saveFile() },
      // Desktop: the native save dialog is the Save As; web: name the download first.
      "Mod+Shift+S": {
        label: "Save as",
        group: File,
        inField: true,
        run: () => (store.api.backend.kind === "tauri" ? void store.saveFile(undefined, true) : setSaveAsOpen(true)),
      },
      "Mod+P": { label: "Export PDF…", group: File, inField: true, run: () => onExportPdf() },
      "Mod+/": { label: "Keyboard shortcuts", inField: true, run: () => setHelpOpen(true) },
      "Mod+Z": { label: "Undo", group: "Edit", when: inGrid, run: () => void store.undo() },
      "Mod+Y": { label: "Redo", group: "Edit", when: inGrid, run: () => void store.redo() },
      "Mod+Shift+Z": { label: "Redo", group: "Edit", when: inGrid, run: () => void store.redo() },
      "Mod+B": { label: "Bold", group: "Format", when: inGrid, run: () => void store.toggleFont("bold") },
      "Mod+I": { label: "Italic", group: "Format", when: inGrid, run: () => void store.toggleFont("italic") },
      "Mod+U": { label: "Underline", group: "Format", when: inGrid, run: () => void store.toggleFont("underline") },
      "Mod+1": { label: "Format cells (number format)", group: "Format", when: inGrid, run: () => actions.formatCells() },
      "Mod+F": { label: "Find", group: "Edit", when: inGrid, run: () => actions.find() },
      "Mod+H": { label: "Find and replace", group: "Edit", when: inGrid, run: () => actions.replace() },
      "Mod+Shift+V": { label: "Paste values only", group: "Edit", when: inGrid, run: () => void actions.pasteValues() },
      "Mod+D": { label: "Fill down (copy the first row)", group: "Edit", when: inGrid, run: () => void actions.fillDown() },
      "Mod+R": { label: "Fill right (copy the first column)", group: "Edit", when: inGrid, run: () => void actions.fillRight() },
      F2: { label: "Edit cell", group: "Edit", when: inGrid, run: () => store.beginEdit(null) },
      Delete: { label: "Clear cells", group: "Edit", when: inGrid, run: () => void store.clearSelection() },
      Backspace: { label: "Clear cells", group: "Edit", when: inGrid, run: () => void store.clearSelection() },
      "Mod+Space": {
        label: "Select column",
        group: grid,
        when: inGrid,
        run: () => {
          const s = store.getState().selection;
          store.select(colSelection(s.anchor.col, s.focus.col));
        },
      },
      "Shift+Space": {
        label: "Select row",
        group: grid,
        when: inGrid,
        run: () => {
          const s = store.getState().selection;
          store.select(rowSelection(s.anchor.row, s.focus.row));
        },
      },
      "Shift+F11": { label: "Insert sheet (before the active one)", group: "Sheets", when: inGrid, run: () => void store.insertSheet() },
      "Mod+Plus": { label: "Insert rows / columns", group: grid, when: inGrid, run: structural("insert") },
      "Mod+Minus": { label: "Delete rows / columns", group: grid, when: inGrid, run: structural("delete") },
    };
  }, [store, guard, onExportPdf]);

  useShortcuts(map);

  return (
    <>
      <ShortcutHelp open={helpOpen} onClose={() => setHelpOpen(false)} shortcuts={map} extra={NATIVE_ROWS} />
      <PromptDialog
        open={saveAsOpen}
        title="Save as"
        label="File name"
        initial={store.getState().name ?? "Workbook.xlsx"}
        confirmLabel="Save"
        onClose={() => setSaveAsOpen(false)}
        onSubmit={(name) => {
          setSaveAsOpen(false);
          void store.saveFile(withExtension(name, ".xlsx"));
        }}
      />
      <StructureDialog kind={structure} store={store} onClose={() => setStructure(null)} />
      <CalcDialogs store={store} />
    </>
  );
}
