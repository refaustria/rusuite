import { useCallback, useEffect, useMemo, useState } from "react";
import { Toolbar } from "@rusuite/ui-shared";
import { CalcApi, type CalcBackend } from "./backend/calcApi";
import { installDevTools, perfOverlayEnabled, pickBackend } from "./dev/devTools";
import { FormulaBar } from "./FormulaBar";
import { GridCanvas } from "./grid/GridCanvas";
import { toolbarValue } from "./grid/style";
import { ExportPdf, type ExportStage } from "./print/ExportPdf";
import { ShortcutLayer } from "./ShortcutLayer";
import { SheetTabs } from "./SheetTabs";
import { CalcStore, useCalc } from "./state/store";
import { Toasts } from "./Toasts";

function StatusBar({ store }: { store: CalcStore }) {
  const revision = useCalc(store, (s) => s.revision);
  const dirty = useCalc(store, (s) => s.dirty);
  const cycle = useCalc(store, (s) => s.cycle);
  const warnings = useCalc(store, (s) => s.warnings);
  return (
    <div className="flex items-center gap-4 border-t border-ui-border bg-ui-panel px-3 py-0.5 text-xs text-ui-muted" data-testid="status-bar">
      <span>Revision {revision}</span>
      <span>{dirty ? "Modified" : "Saved"}</span>
      {warnings.length > 0 && (
        <span data-testid="open-warnings" className="truncate text-amber-700" title={warnings.join("\n")}>
          {warnings.length === 1 ? warnings[0] : `${warnings.length} warnings: ${warnings.join("; ")}`}
        </span>
      )}
      {cycle && (
        <span role="status" className="font-medium text-red-700">
          {cycle}
        </span>
      )}
    </div>
  );
}

function FileButtons({ store, stage, onStage }: { store: CalcStore; stage: ExportStage; onStage: (s: ExportStage) => void }) {
  const btn = "h-7 rounded border border-ui-border bg-ui-bg px-2 text-sm text-ui-fg hover:bg-ui-hover";
  return (
    <div role="group" aria-label="File" className="flex items-center gap-1 border-b border-r border-ui-border bg-ui-panel px-1">
      <button type="button" className={btn} title="Open (Ctrl+O)" onClick={() => void store.openFile()}>
        Open
      </button>
      <button type="button" className={btn} title="Save (Ctrl+S)" onClick={() => void store.saveFile()}>
        Save
      </button>
      <ExportPdf store={store} stage={stage} onStage={onStage} />
    </div>
  );
}

function StyleToolbar({ store }: { store: CalcStore }) {
  useCalc(store, (s) => s.version);
  useCalc(store, (s) => s.selection);
  useCalc(store, (s) => s.activeSheet);
  const ready = useCalc(store, (s) => s.info !== null);
  return (
    <Toolbar
      value={toolbarValue(store.activeStyle())}
      disabled={!ready}
      onChange={(patch) => {
        void store.applyStyle(patch);
        store.focusGrid();
      }}
    />
  );
}

export default function App({ backend }: { backend: CalcBackend }) {
  const store = useMemo(() => new CalcStore(new CalcApi(pickBackend(backend))), [backend]);
  const [exportStage, setExportStage] = useState<ExportStage>("idle");
  const openExport = useCallback(() => {
    store.cancelEdit();
    setExportStage("setup");
  }, [store]);
  useEffect(() => {
    installDevTools(store);
    void store.init();
  }, [store]);

  const name = useCalc(store, (s) => s.name);
  const dirty = useCalc(store, (s) => s.dirty);
  useEffect(() => {
    void store.api.backend.setTitle(store.title()).catch(() => undefined);
  }, [store, name, dirty]);

  return (
    <main className="flex h-screen flex-col bg-ui-bg text-ui-fg">
      <div className="flex items-stretch">
        <FileButtons store={store} stage={exportStage} onStage={setExportStage} />
        <div className="min-w-0 flex-1">
          <StyleToolbar store={store} />
        </div>
      </div>
      <FormulaBar store={store} />
      <GridCanvas store={store} showPerf={perfOverlayEnabled()} />
      <SheetTabs store={store} />
      <StatusBar store={store} />
      <Toasts store={store} />
      <ShortcutLayer store={store} onExportPdf={openExport} />
    </main>
  );
}
