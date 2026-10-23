import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AutosaveStatus, formatNumber, useLocale, ConfirmDiscard, DocumentSession, RecoveryBanner, UnsavedGuard, readerWarningText, withExtension, type AnySession } from "@rusuite/ui-shared";
import { ShowApi } from "./api";
import type { ShowBackend } from "./backend";
import { EditorStage } from "./canvas/Stage";
import { DEFAULT_SHOW_PRINT, type ShowPrintOptions } from "./print/showPrintDoc";
import { buildShowDoc, printShow, ShowPrintPage } from "./print/ShowPrintPage";
import { SlideShow } from "./present/SlideShow";
import { launchAudience, type AudienceLink } from "./present/sync";
import { SlideList } from "./sidebar/SlideList";
import { ShortcutLayer } from "./ShortcutLayer";
import { ShowStore, useShow } from "./state/store";
import { fitScale, slidePx } from "./geometry";
import { ShowRibbon, type ShowZoom } from "./ui/ShowToolbar";
import { NotesPane } from "./ui/NotesPane";
import { AnimationPane } from "./ui/AnimationPane";
import { BackgroundPane } from "./ui/DesignTab";
import { MasterPanel } from "./ui/MasterView";
import { ShowDialogs } from "./ui/ShowDialogs";
import { ChartFormatPane } from "./charts/FormatPane";
import { ReusePane } from "./reuse/ReusePane";
import { PosterInput } from "./media/PlaybackTab";
import { SoundInput } from "./ui/AnimTabs";
import { Toasts } from "./ui/Toasts";
import { t, useT } from "./i18n";
import { SlideSorter } from "./views/SlideSorter";
import { OutlinePane } from "./views/OutlinePane";
import { NotesPageView } from "./views/NotesPageView";
import { ReadingView } from "./views/ReadingView";
import { SelectionPane } from "./ui/SelectionPane";
import { FormatShapePane } from "./ui/FormatShapePane";
import { RULER_PX, RulerFrame } from "./canvas/Rulers";
import { rulerUnit } from "./canvas/guides";
import { AssistantPane } from "@rusuite/ui-shared";
import { showAiAdapter } from "./ai/showAi";

/** Observes an element's client size. A callback ref, so a remounted element is measured and observed again. */
function useElementSize<T extends HTMLElement>() {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: T | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!el) return;
    const measure = () =>
      setSize((prev) => (prev.width === el.clientWidth && prev.height === el.clientHeight ? prev : { width: el.clientWidth, height: el.clientHeight }));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    observer.current = ro;
  }, []);
  useEffect(() => () => observer.current?.disconnect(), []);
  return [ref, size] as const;
}

function StatusBar({ store, backend, session, zoom }: { store: ShowStore; backend: ShowBackend; session: AnySession; zoom: ShowZoom }) {
  const t = useT();
  const pres = useShow(store, (s) => s.pres);
  const current = useShow(store, (s) => s.current);
  const revision = useShow(store, (s) => s.revision);
  const dirty = useShow(store, (s) => s.dirty);
  const name = useShow(store, (s) => s.name);
  const info = useShow(store, (s) => s.info);
  const warnings = useShow(store, (s) => s.warnings);
  const notesVisible = useShow(store, (s) => s.notesVisible);
  const n = pres?.slides.length ?? 0;
  const i = pres ? pres.slides.findIndex((s) => s.id === current) : -1;
  const hidden = i >= 0 && !!pres?.slides[i]?.hidden;
  return (
    <div className="flex items-center gap-4 border-t border-ui-border bg-ui-panel px-3 py-0.5 text-xs text-ui-muted" data-testid="status-bar">
      <span data-testid="slide-count">{n ? `${t("show.slideOf", { n: i + 1, count: n })}${hidden ? t("show.hiddenSuffix") : ""}` : t("show.noSlides")}</span>
      <span data-testid="doc-name">{name ?? t("doc.untitled")}</span>
      <span data-testid="dirty">{dirty ? t("status.modified") : t("status.saved")}</span>
      <span data-testid="revision">rev {Math.max(0, revision)}</span>
      <AutosaveStatus session={session} />
      {info && <span data-testid="info">{info}</span>}
      {warnings.length > 0 && (
        <span data-testid="warnings" title={warnings.map((w) => readerWarningText(w)).join("\n")} className="truncate text-amber-600">
          {t("status.warnings", { count: warnings.length, first: warnings[0] ? readerWarningText(warnings[0]) : "" })}
        </span>
      )}
      <button type="button" className={`ml-auto rounded px-1 hover:bg-ui-hover ${notesVisible ? "text-ui-fg" : ""}`} aria-pressed={notesVisible} onClick={() => store.toggleNotes()}>
        {t("show.notes")}
      </button>
      <span data-testid="zoom">
        {zoom === "fit" ? t("show.fitShort") : `${formatNumber(Math.round(zoom * 100))} %`}
      </span>
      <span data-testid="backend-kind">
        {backend.kind}
      </span>
    </div>
  );
}

export default function App({ backend, store: given }: { backend: ShowBackend; store?: ShowStore }) {
  const locale = useLocale();
  // Recent files, autosave, crash recovery: the store talks through the session's backend.
  const session = useMemo(() => new DocumentSession(backend), [backend]);
  const store = useMemo(() => given ?? new ShowStore(new ShowApi(session.backend)), [session, given]);
  const aiAdapter = useMemo(() => showAiAdapter(store), [store]);
  // Unsaved-changes question before New / Open / recent / Restore / Close and closing the window (P7-6).
  const guard = useMemo(
    () =>
      new UnsavedGuard(backend, {
        dirty: () => store.getState().dirty,
        name: () => store.getState().name,
        get defaultName() {
          return t("show.defaultName");
        },
        save: async (asName) => {
          await store.save(asName === undefined ? undefined : withExtension(asName, ".pptx"));
          return !store.getState().dirty;
        },
      }),
    [backend, store],
  );
  const [presenting, setPresenting] = useState<{ mode: "single" | "presenter"; link?: AudienceLink; rehearse?: boolean; record?: boolean; customShow?: number } | null>(null);
  const [printOptions, setPrintOptions] = useState<ShowPrintOptions>(DEFAULT_SHOW_PRINT);
  // the zoom is part of the window state saved with the file (P9-S3)
  const zoom = useShow(store, (s) => s.zoom) as ShowZoom;
  const setZoom = useCallback((z: ShowZoom) => store.setZoom(z), [store]);
  const [canvasRef, size] = useElementSize<HTMLDivElement>();
  const pres = useShow(store, (s) => s.pres);
  const dirty = useShow(store, (s) => s.dirty);
  const name = useShow(store, (s) => s.name);
  const masterView = useShow(store, (s) => s.masterView !== null);
  const view = useShow(store, (s) => s.view);
  const showRuler = useShow(store, (s) => !!s.pres?.view?.showRuler);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    void store.init().then(() => store.probeFileIo()).then(() => store.loadThemes());
    if (import.meta.env.DEV) (window as unknown as { __showStore?: ShowStore }).__showStore = store;
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

  useEffect(() => {
    void backend.setTitle(`${dirty ? "• " : ""}${name ?? t("doc.untitled")} – Rusuite Show`).catch(() => undefined);
    guard.syncDirty();
  }, [backend, guard, dirty, name, locale]);

  const startPresenting = useCallback(
    (mode: "single" | "presenter" = "single", rehearse = false, customShow?: number, record = false) => {
      if (!store.getState().pres?.slides.length) return;
      void store.commitEdit();
      if (store.getState().view === "reading") store.setView("normal");
      // The audience window opens right here, inside the key / click handler (popup blockers).
      setPresenting(mode === "presenter" ? { mode, link: launchAudience() } : { mode, rehearse, record, ...(customShow === undefined ? {} : { customShow }) });
    },
    [store],
  );
  // Custom Slide Show ▾ / Custom Shows › Show (P9-S3)
  const showRequest = useShow(store, (s) => s.showRequest);
  useEffect(() => {
    if (!showRequest) return;
    store.clearShowRequest();
    startPresenting("single", false, showRequest.customShow);
  }, [showRequest, store, startPresenting]);
  // File › Export PDF… / Share as PDF: the Print pipeline with the current settings – a PDF without a dialog where
  // the backend renders PDFs (P10-M6), else straight to the system dialog ("Save as PDF").
  const exportPdf = useCallback((mode?: "share") => {
    void (async () => {
      await store.commitEdit();
      // the slide range and section are applied while building
      const doc = await buildShowDoc(store, printOptions);
      await printShow(store, backend, doc, mode === "share" ? "share" : "pdf");
    })().catch((e) => store.pushError(e));
  }, [backend, store, printOptions]);
  const presentFrom = useCallback(
    (fromStart: boolean, rehearse = false, record = false) => {
      const pres = store.getState().pres;
      const first = pres?.slides[0]?.id;
      // Set Up Slide Show › Custom show: From Beginning runs it
      const custom = pres?.showSettings?.customShow;
      if (fromStart && !rehearse && !record && custom !== undefined && pres?.customShows?.some((c) => c.id === custom && c.slideIds.length)) {
        startPresenting("single", false, custom);
        return;
      }
      if (fromStart && pres && first !== undefined) {
        // Set Up Slide Show › From … To …: the first slide of the range
        const range = pres.showSettings?.range;
        const pool = range ? pres.slides.slice(range.start - 1, range.end) : pres.slides;
        store.selectSlide(pool.find((s) => !s.hidden)?.id ?? pool[0]?.id ?? first);
      }
      startPresenting("single", rehearse, undefined, record);
    },
    [store, startPresenting],
  );
  /** Alt+F5 / View › Presenter view: from the current slide, the slide in a second window. */
  const presenterView = useCallback(() => {
    if (store.getState().current !== null) startPresenting("presenter");
  }, [store, startPresenting]);
  const exit = useCallback(() => setPresenting(null), []);

  // Fit: the canvas area minus its padding (and the rulers); a fixed zoom: the slide at that scale.
  const rulers = showRuler && !masterView ? RULER_PX : 0;
  const stageSize =
    zoom === "fit" || !pres
      ? { width: Math.max(0, size.width - 32 - rulers), height: Math.max(0, size.height - 32 - rulers) }
      : { width: slidePx(pres.slideSize).width * zoom, height: slidePx(pres.slideSize).height * zoom };
  const stageScale = pres ? fitScale(stageSize.width, stageSize.height, pres.slideSize) : 0;
  const stage = <EditorStage store={store} width={stageSize.width} height={stageSize.height} />;
  const sorter = view === "sorter" && !masterView;

  return (
    <main className="flex h-screen flex-col bg-ui-bg text-ui-fg" data-rs-app="">
      <RecoveryBanner session={session} />
      <ShowRibbon store={store} session={session} onPresent={presentFrom} onPresenterView={presenterView} onExportPdf={exportPdf} onRehearse={() => presentFrom(true, true)} onRecord={(fromStart) => presentFrom(fromStart, false, true)}
        print={<ShowPrintPage store={store} backend={backend} options={printOptions} onChange={setPrintOptions} />}
        zoom={zoom}
        onZoom={setZoom}
      />
      <div className="flex min-h-0 flex-1">
        {masterView ? <MasterPanel store={store} /> : view === "outline" ? <OutlinePane store={store} /> : sorter ? null : <SlideList store={store} />}
        {sorter ? (
          <SlideSorter store={store} />
        ) : (
        <div className="flex min-w-0 flex-1 flex-col">
        <div
          ref={canvasRef}
          className={`flex min-w-0 flex-1 bg-ui-hover p-4 ${zoom === "fit" || view === "notesPage" ? "items-center justify-center overflow-hidden" : "overflow-auto"}`}
          data-testid="canvas-area"
          data-view={masterView ? "master" : view}
        >
          {view === "notesPage" && !masterView ? (
            <NotesPageView store={store} width={size.width} height={size.height} />
          ) : (
            <div
              className="m-auto shrink-0 shadow-lg"
              data-testid="stage-host"
              onPointerMove={(e) => {
                if (!rulers || stageScale <= 0) return;
                const host = e.currentTarget.querySelector("[data-testid=editor-stage]");
                const r = host?.getBoundingClientRect();
                if (r) setCursor({ x: (e.clientX - r.left) / stageScale, y: (e.clientY - r.top) / stageScale });
              }}
              onPointerLeave={() => setCursor(null)}
            >
              {rulers && pres ? (
                <RulerFrame size={pres.slideSize} scale={stageScale} unit={rulerUnit(locale)} cursor={cursor}>
                  {stage}
                </RulerFrame>
              ) : (
                stage
              )}
            </div>
          )}
        </div>
        {view !== "notesPage" && <NotesPane store={store} />}
        </div>
        )}
        <AnimationPane store={store} />
        <BackgroundPane store={store} />
        <ChartFormatPane store={store} />
        <ReusePane store={store} />
        {!sorter && <SelectionPane store={store} />}
        {!sorter && <FormatShapePane store={store} />}
        <AssistantPane ai={session.ai} adapter={aiAdapter} />
      </div>
      {view === "reading" && !masterView && !presenting && <ReadingView store={store} onPresent={() => presentFrom(false)} />}
      <PosterInput store={store} />
      <SoundInput store={store} />
      <StatusBar store={store} backend={backend} session={session} zoom={zoom} />
      <Toasts store={store} />
      <ShowDialogs store={store} printOptions={printOptions} onPrintOptions={setPrintOptions} />
      <ShortcutLayer store={store} guard={guard} enabled={!presenting} onPresent={presentFrom} onPresenterView={presenterView} />
      <ConfirmDiscard guard={guard} />
      {presenting && pres && <SlideShow store={store} mode={presenting.mode} link={presenting.link} rehearse={presenting.rehearse} record={presenting.record} customShow={presenting.customShow ?? null} onEnd={exit} />}
    </main>
  );
}
