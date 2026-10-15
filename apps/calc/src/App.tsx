import { useCallback, useEffect, useMemo, useState } from "react";
import { DocumentSession, RecoveryBanner } from "@rusuite/ui-shared";
import { CalcApi, type CalcBackend } from "./backend/calcApi";
import { installDevTools, perfOverlayEnabled, pickBackend } from "./dev/devTools";
import { FormulaBar } from "./FormulaBar";
import { GridCanvas } from "./grid/GridCanvas";
import { ExportPdf, type ExportStage } from "./print/ExportPdf";
import { ShortcutLayer } from "./ShortcutLayer";
import { SheetTabs } from "./SheetTabs";
import { CalcStore, useCalc } from "./state/store";
import { Toasts } from "./Toasts";
import { CalcRibbon, DEFAULT_CALC_VIEW, type CalcView } from "./ui/CalcRibbon";

function StatusBar({ store, zoom }: { store: CalcStore; zoom: number }) {
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
      <span className="ml-auto" data-testid="zoom">
        {Math.round(zoom * 100)} %
      </span>
    </div>
  );
}

export default function App({ backend }: { backend: CalcBackend }) {
  // Recent files, autosave, crash recovery: the store talks through the session's backend.
  const session = useMemo(() => new DocumentSession(pickBackend(backend)), [backend]);
  const store = useMemo(() => new CalcStore(new CalcApi(session.backend)), [session]);
  const [exportStage, setExportStage] = useState<ExportStage>("idle");
  const [view, setView] = useState<CalcView>(DEFAULT_CALC_VIEW);
  const openExport = useCallback(() => {
    store.cancelEdit();
    setExportStage("setup");
  }, [store]);
  useEffect(() => {
    installDevTools(store);
    void store.init();
  }, [store]);
  useEffect(() => {
    session.attach({
      restore: (json, name) => store.restoreRecovery(json, name),
      openFile: (file) => store.openBytes(file),
      onError: (e) => store.pushError(e),
    });
    void session.start();
    return () => session.stop();
  }, [session, store]);

  const name = useCalc(store, (s) => s.name);
  const dirty = useCalc(store, (s) => s.dirty);
  useEffect(() => {
    void store.api.backend.setTitle(store.title()).catch(() => undefined);
  }, [store, name, dirty]);

  return (
    <main className="flex h-screen flex-col bg-ui-bg text-ui-fg">
      <RecoveryBanner session={session} />
      <CalcRibbon store={store} session={session} onExportPdf={openExport} view={view} onViewChange={setView} />
      {/* The Export PDF flow (setup dialog, print view); its own button is replaced by File › Export PDF… */}
      <div className="contents [&>button]:hidden">
        <ExportPdf store={store} stage={exportStage} onStage={setExportStage} />
      </div>
      {view.formulaBar && <FormulaBar store={store} />}
      <GridCanvas store={store} showPerf={perfOverlayEnabled()} zoom={view.zoom} gridlines={view.gridlines} />
      <SheetTabs store={store} />
      <StatusBar store={store} zoom={view.zoom} />
      <Toasts store={store} />
      <ShortcutLayer store={store} onExportPdf={openExport} />
    </main>
  );
}
