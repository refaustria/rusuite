import { useCallback, useEffect, useMemo, useState } from "react";
import { AutosaveStatus, applyPageRange, formatNumber, ConfirmDiscard, DocumentSession, RecoveryBanner, UnsavedGuard, withExtension, type AnySession } from "@rusuite/ui-shared";
import { CalcApi, type CalcBackend } from "./backend/calcApi";
import { installDevTools, perfOverlayEnabled, pickBackend } from "./dev/devTools";
import { FormulaBar } from "./FormulaBar";
import { GridCanvas } from "./grid/GridCanvas";
import { ChartFormatPane } from "./charts/FormatPane";
import { CommentsPane } from "./comments/CommentsPane";
import { PivotPane } from "./pivot/PivotPane";
import { PivotStaleBar } from "./pivot/StaleBar";
import { buildCalcPrintDoc } from "./print/calcPrintDoc";
import { CalcPrintPage, printCalc } from "./print/CalcPrintPage";
import { DEFAULT_CALC_PRINT, type CalcPrintOptions } from "./print/layout";
import { ShortcutLayer } from "./ShortcutLayer";
import { SheetTabs } from "./SheetTabs";
import { CalcStore, sheetViewOf, useCalc } from "./state/store";
import { Toasts } from "./Toasts";
import { cellAddress } from "./grid/address";
import { CalcRibbon, type CalcView } from "./ui/CalcRibbon";
import { t, useT } from "./i18n";

function StatusBar({ store, session, zoom }: { store: CalcStore; session: AnySession; zoom: number }) {
  const revision = useCalc(store, (s) => s.revision);
  const dirty = useCalc(store, (s) => s.dirty);
  const cycle = useCalc(store, (s) => s.cycle);
  const warnings = useCalc(store, (s) => s.warnings);
  const t = useT();
  // The hovered note's cell and author (Excel: "Cell B2 note by Ann").
  const noteBy = useCalc(store, (s) => {
    void s.version;
    const n = store.comments.hoverNote();
    return n ? t("calc.notes.status", { cell: cellAddress(n.row, n.col), author: n.author || t("calc.comments.unknownAuthor") }) : "";
  });
  // Excel's "n of m records found" while an AutoFilter filters the active sheet (a string: stable for the store hook).
  const records = useCalc(store, (s) => {
    void s.version;
    const r = store.recordsFound();
    return r ? t("calc.filter.records", { shown: formatNumber(r.shown), total: formatNumber(r.total) }) : "";
  });
  // Pivot tables whose source changed (Refresh brings them up to date).
  const stale = useCalc(store, (s) => {
    void s.version;
    return store.pivots.stale.size;
  });
  return (
    <div className="flex items-center gap-4 border-t border-ui-border bg-ui-panel px-3 py-0.5 text-xs text-ui-muted" data-testid="status-bar">
      <span>{t("calc.status.revision", { revision })}</span>
      <span>{dirty ? t("status.modified") : t("status.saved")}</span>
      <AutosaveStatus session={session} />
      {warnings.length > 0 && (
        <span data-testid="open-warnings" className="truncate text-amber-700" title={warnings.join("\n")}>
          {warnings.length === 1 ? warnings[0] : t("calc.status.warnings", { count: warnings.length, list: warnings.join("; ") })}
        </span>
      )}
      {records && <span data-testid="filter-records">{records}</span>}
      {stale > 0 && <span data-testid="pivot-stale-status" className="text-amber-700">{t("calc.pivot.staleStatus", { count: stale })}</span>}
      {noteBy && <span data-testid="note-status">{noteBy}</span>}
      {cycle && (
        <span role="status" className="font-medium text-red-700">
          {cycle}
        </span>
      )}
      <span className="ml-auto" data-testid="zoom">
        {formatNumber(Math.round(zoom * 100))} %
      </span>
    </div>
  );
}

export default function App({ backend }: { backend: CalcBackend }) {
  // Recent files, autosave, crash recovery: the store talks through the session's backend.
  const session = useMemo(() => new DocumentSession(pickBackend(backend)), [backend]);
  const store = useMemo(() => new CalcStore(new CalcApi(session.backend)), [session]);
  // Unsaved-changes question before New / Open / recent / Restore / Close and closing the window (P7-6).
  const guard = useMemo(
    () =>
      new UnsavedGuard(session.backend, {
        dirty: () => store.getState().dirty,
        name: () => store.getState().name,
        get defaultName() {
          return t("calc.defaultName");
        },
        save: async (asName) => {
          await store.saveFile(asName === undefined ? undefined : withExtension(asName, ".xlsx"));
          return !store.getState().dirty;
        },
      }),
    [session, store],
  );
  const [printOptions, setPrintOptions] = useState<CalcPrintOptions>(DEFAULT_CALC_PRINT);
  // Zoom, gridlines and headings belong to the active sheet (saved in the file); the formula bar is the app's.
  const [formulaBar, setFormulaBar] = useState(true);
  const sheetView = useCalc(store, (s) => sheetViewOf(s.info, s.activeSheet));
  const view: CalcView = { zoom: sheetView.zoom / 100, gridlines: sheetView.showGridlines, headings: sheetView.showHeadings, formulaBar };
  const setView = (v: CalcView) => {
    if (v.formulaBar !== formulaBar) setFormulaBar(v.formulaBar);
    const zoom = Math.max(10, Math.min(400, Math.round(v.zoom * 100)));
    void store.setSheetView({
      ...(zoom !== sheetView.zoom ? { zoom } : {}),
      ...(v.gridlines !== sheetView.showGridlines ? { showGridlines: v.gridlines } : {}),
      ...(v.headings !== sheetView.showHeadings ? { showHeadings: v.headings } : {}),
    });
  };
  // File › Export PDF…: the Print pipeline with the current settings, straight to the system dialog ("Save as PDF").
  const exportPdf = useCallback(() => {
    store.cancelEdit();
    void buildCalcPrintDoc(store, printOptions)
      .then((doc) => printCalc(store, applyPageRange(doc, printOptions.range)))
      .catch((e) => store.pushError(e));
  }, [store, printOptions]);
  useEffect(() => {
    installDevTools(store);
    void store.init();
  }, [store]);
  useEffect(() => {
    session.attach({
      restore: (json, name) => store.restoreRecovery(json, name),
      openFile: (file) => store.openBytes(file),
      onError: (e) => store.pushError(e),
      confirmReplace: async () => (await guard.ensureSaved()) === "proceed",
      // File › Save As › a connection (P8-36): the app's Save As under the chosen name.
      saveAs: (name) => guard.doc.save(name),
    });
    void session.start();
    return () => session.stop();
  }, [session, store, guard]);
  useEffect(() => guard.watchWindow(), [guard]);

  const name = useCalc(store, (s) => s.name);
  const dirty = useCalc(store, (s) => s.dirty);
  useEffect(() => {
    void store.api.backend.setTitle(store.title()).catch(() => undefined);
    guard.syncDirty();
  }, [store, guard, name, dirty]);

  return (
    <main className="flex h-screen flex-col bg-ui-bg text-ui-fg">
      <RecoveryBanner session={session} />
      <CalcRibbon
        store={store}
        session={session}
        onExportPdf={exportPdf}
        print={<CalcPrintPage store={store} options={printOptions} onChange={setPrintOptions} />}
        view={view}
        onViewChange={setView}
      />
      {view.formulaBar && <FormulaBar store={store} />}
      <PivotStaleBar store={store} />
      <div className="flex min-h-0 flex-1">
        <GridCanvas store={store} showPerf={perfOverlayEnabled()} />
        <ChartFormatPane store={store} />
        <CommentsPane store={store} />
        <PivotPane store={store} />
      </div>
      <SheetTabs store={store} />
      <StatusBar store={store} session={session} zoom={view.zoom} />
      <Toasts store={store} />
      <ShortcutLayer store={store} guard={guard} />
      <ConfirmDiscard guard={guard} />
    </main>
  );
}
