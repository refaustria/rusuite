// "Export PDF…": setup dialog → print view (portal over the editor) →
// system print dialog → back to the editor.

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Dialog, printAndWait, type PageOrientation, type PaperName } from "@rusuite/ui-shared";
import type { CalcStore } from "../state/store";
import { loadUsedRange } from "./loadUsed";
import { CALC_PRINT_RULES, DEFAULT_PRINT_SETUP, calcPageCss, fitZoom, resolveOrientation, type PrintSetup } from "./printCss";
import { PrintTableView } from "./PrintTableView";
import { buildPrintTable, type PrintTable } from "./printTable";

const BTN = "h-7 rounded border border-ui-border bg-ui-bg px-2 text-sm text-ui-fg hover:bg-ui-hover";

function SetupDialog({ open, setup, onChange, onPrint, onClose }: {
  open: boolean;
  setup: PrintSetup;
  onChange: (s: PrintSetup) => void;
  onPrint: () => void;
  onClose: () => void;
}) {
  const field = "flex items-center justify-between gap-4 py-1 text-sm";
  return (
    <Dialog open={open} title="Export PDF" onClose={onClose}>
      <label className={field}>
        Paper
        <select aria-label="Paper" value={setup.paper} onChange={(e) => onChange({ ...setup, paper: e.target.value as PaperName })} className="rounded border border-ui-border bg-ui-bg px-1">
          <option value="A4">A4</option>
          <option value="Letter">Letter</option>
        </select>
      </label>
      <label className={field}>
        Orientation
        <select aria-label="Orientation" value={setup.orientation} onChange={(e) => onChange({ ...setup, orientation: e.target.value as PageOrientation | "auto" })} className="rounded border border-ui-border bg-ui-bg px-1">
          <option value="auto">Automatic</option>
          <option value="portrait">Portrait</option>
          <option value="landscape">Landscape</option>
        </select>
      </label>
      <label className={field}>
        Fit to page width
        <input type="checkbox" aria-label="Fit to page width" checked={setup.fitToWidth} onChange={(e) => onChange({ ...setup, fitToWidth: e.target.checked })} />
      </label>
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" className={BTN} onClick={onClose}>
          Cancel
        </button>
        <button type="button" className={BTN} onClick={onPrint}>
          Print…
        </button>
      </div>
    </Dialog>
  );
}

function PrintOverlay({ store, setup, onDone }: { store: CalcStore; setup: PrintSetup; onDone: () => void }) {
  const [table, setTable] = useState<PrintTable | null>(null);
  const printed = useRef(false);
  const backend = store.api.backend;

  useEffect(() => {
    let live = true;
    void (async () => {
      const sheet = store.getState().activeSheet;
      const { lastRow, lastCol } = await loadUsedRange(store, sheet);
      if (live) setTable(buildPrintTable(store.cache(sheet), store.styles(), Math.max(lastRow, 0), Math.max(lastCol, 0)));
    })().catch((e) => {
      store.pushError(e);
      onDone();
    });
    return () => {
      live = false;
    };
  }, [store, onDone]);

  const orientation = table ? resolveOrientation(setup, table.width, table.height) : "portrait";

  useEffect(() => {
    if (!table || printed.current) return;
    printed.current = true;
    const frame = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (f: () => void) => setTimeout(f, 0);
    frame(() => {
      void printAndWait(backend)
        .catch((e) => store.pushError(e))
        .finally(onDone);
    });
  }, [table, backend, store, onDone]);

  return createPortal(
    <div className="print-overlay fixed inset-0 z-[100] overflow-auto bg-white p-4 text-black" data-testid="print-view">
      <style>{`${table ? calcPageCss(setup, orientation) : ""}\n${CALC_PRINT_RULES}`}</style>
      <div className="print-bar mb-2 text-sm text-gray-600">Preparing PDF…</div>
      {table && <PrintTableView table={table} zoom={fitZoom(setup, orientation, table.width)} />}
    </div>,
    document.body,
  );
}

export type ExportStage = "idle" | "setup" | "printing";

/** The File-group button, the setup dialog and the print overlay (Ctrl+P lives in the ShortcutLayer map). */
export function ExportPdf({ store, stage, onStage }: { store: CalcStore; stage: ExportStage; onStage: (s: ExportStage) => void }) {
  const [setup, setSetup] = useState<PrintSetup>(DEFAULT_PRINT_SETUP);
  const open = useCallback(() => {
    store.cancelEdit();
    onStage("setup");
  }, [store, onStage]);
  const done = useCallback(() => onStage("idle"), [onStage]);
  return (
    <>
      <button type="button" className={BTN} title="Export PDF… (Ctrl+P)" onClick={open}>
        Export PDF…
      </button>
      <SetupDialog open={stage === "setup"} setup={setup} onChange={setSetup} onPrint={() => onStage("printing")} onClose={done} />
      {stage === "printing" && <PrintOverlay store={store} setup={setup} onDone={done} />}
    </>
  );
}
