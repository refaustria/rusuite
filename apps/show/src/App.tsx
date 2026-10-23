import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AutosaveStatus, BottomSheet, formatNumber, useCompact, useLocale, ConfirmDiscard, DocumentSession, RecoveryBanner, UnsavedGuard, readerWarningText, withExtension, type AnySession } from "@rusuite/ui-shared";
import { ShowApi } from "./api";
import type { ShowBackend } from "./backend";
import { EditorStage } from "./canvas/Stage";
import { DEFAULT_SHOW_PRINT, type ShowPrintOptions } from "./print/showPrintDoc";
import { buildShowDoc, printShow, ShowPrintPage } from "./print/ShowPrintPage";
import { SlideShow } from "./present/SlideShow";
import { launchAudience, type AudienceLink } from "./present/sync";
import { SlideList } from "./sidebar/SlideList";
import { SlideStrip } from "./sidebar/SlideStrip";
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
import { clampTouchZoom, pinchMetrics, touchDevice } from "./canvas/touch";
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

function StatusBar({ store, backend, session, zoom, notesSheet }: {
  store: ShowStore;
  backend: ShowBackend;
  session: AnySession;
  zoom: ShowZoom;
  /** Compact layout: the Notes chip opens the notes sheet instead of the pane (P10-M5). */
  notesSheet?: { open: boolean; toggle: () => void };
}) {
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
      {notesSheet ? (
        <button
          type="button"
          data-testid="notes-chip"
          aria-haspopup="dialog"
          aria-pressed={notesSheet.open}
          className={`ml-auto min-h-11 min-w-11 rounded-full border border-ui-border px-3 text-ui-fg ${notesSheet.open ? "bg-ui-active" : ""}`}
          onClick={notesSheet.toggle}
        >
          {t("show.notes")}
        </button>
      ) : (
        <button type="button" className={`ml-auto rounded px-1 hover:bg-ui-hover ${notesVisible ? "text-ui-fg" : ""}`} aria-pressed={notesVisible} onClick={() => store.toggleNotes()}>
          {t("show.notes")}
        </button>
      )}
      <span data-testid="zoom">
        {zoom === "fit" ? t("show.fitShort") : `${formatNumber(Math.round(zoom * 100))} %`}
      </span>
      <span data-testid="backend-kind">
        {backend.kind}
      </span>
    </div>
  );
}

/**
 * Touch on the canvas area (P10-M5): two fingers (outside the stage's own gestures) zoom the fitted slide,
 * one finger pans the area when the slide is larger than it. The stage stops the touches it handles itself.
 */
function useCanvasTouch(
  area: HTMLDivElement | null,
  zoomRef: React.MutableRefObject<number>,
  setZoom: (z: number) => void,
  anchor: React.MutableRefObject<{ fx: number; fy: number; cx: number; cy: number } | null>,
) {
  useEffect(() => {
    if (!area) return;
    let gesture: { kind: "zoom"; d0: number; z0: number; z: number } | { kind: "pan"; x: number; y: number; left: number; top: number } | null = null;
    const pt = (t: Touch) => ({ x: t.clientX, y: t.clientY });
    const start = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const z0 = zoomRef.current;
        gesture = { kind: "zoom", d0: Math.max(1, pinchMetrics(pt(e.touches[0]!), pt(e.touches[1]!)).dist), z0, z: z0 };
      } else if (e.touches.length === 1) {
        const scrolls = area.scrollWidth > area.clientWidth + 1 || area.scrollHeight > area.clientHeight + 1;
        gesture = scrolls ? { kind: "pan", x: e.touches[0]!.clientX, y: e.touches[0]!.clientY, left: area.scrollLeft, top: area.scrollTop } : null;
      }
    };
    const move = (e: TouchEvent) => {
      if (!gesture) return;
      if (gesture.kind === "pan") {
        if (e.touches.length !== 1) return;
        if (e.cancelable) e.preventDefault();
        area.scrollLeft = gesture.left - (e.touches[0]!.clientX - gesture.x);
        area.scrollTop = gesture.top - (e.touches[0]!.clientY - gesture.y);
        return;
      }
      if (e.touches.length < 2) return;
      if (e.cancelable) e.preventDefault();
      const m = pinchMetrics(pt(e.touches[0]!), pt(e.touches[1]!));
      const z = clampTouchZoom(gesture.z0 * (m.dist / gesture.d0));
      if (z === gesture.z) return;
      gesture.z = z;
      const host = area.querySelector<HTMLElement>("[data-testid=stage-host]")?.getBoundingClientRect();
      const ar = area.getBoundingClientRect();
      anchor.current = host && host.width > 0 && host.height > 0
        ? { fx: (m.mid.x - host.left) / host.width, fy: (m.mid.y - host.top) / host.height, cx: m.mid.x - ar.left, cy: m.mid.y - ar.top }
        : null;
      setZoom(z);
    };
    const end = (e: TouchEvent) => {
      if (e.touches.length === 0 || gesture?.kind === "zoom") gesture = null;
    };
    area.addEventListener("touchstart", start, { passive: false });
    area.addEventListener("touchmove", move, { passive: false });
    area.addEventListener("touchend", end);
    area.addEventListener("touchcancel", end);
    return () => {
      area.removeEventListener("touchstart", start);
      area.removeEventListener("touchmove", move);
      area.removeEventListener("touchend", end);
      area.removeEventListener("touchcancel", end);
    };
  }, [area, zoomRef, setZoom, anchor]);
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
  // the compact layout (P10-M5): the slide strip, the notes as a sheet
  const compact = useCompact();
  const [notesSheet, setNotesSheet] = useState(false);
  // two fingers on the empty slide zoom the fitted slide (50–300 %), one finger pans it when it is larger (P10-M5)
  const [touchZoom, setTouchZoom] = useState(1);
  const touch = useMemo(() => compact || touchDevice(), [compact]);
  const [area, setArea] = useState<HTMLDivElement | null>(null);
  const areaRef = useCallback((el: HTMLDivElement | null) => {
    canvasRef(el);
    setArea(el);
  }, [canvasRef]);
  /** Where the fingers' midpoint was over the slide (fractions) and the area (px), kept there while zooming. */
  const zoomAnchor = useRef<{ fx: number; fy: number; cx: number; cy: number } | null>(null);
  const touchZoomRef = useRef(touchZoom);
  touchZoomRef.current = touchZoom;
  useCanvasTouch(area, touchZoomRef, setTouchZoom, zoomAnchor);
  useLayoutEffect(() => {
    const a = zoomAnchor.current;
    const host = area?.querySelector<HTMLElement>("[data-testid=stage-host]");
    if (!a || !area || !host) return;
    const r = host.getBoundingClientRect();
    const ar = area.getBoundingClientRect();
    area.scrollLeft += r.left + a.fx * r.width - (ar.left + a.cx);
    area.scrollTop += r.top + a.fy * r.height - (ar.top + a.cy);
  }, [touchZoom, area]);

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
  // File › Export PDF…: the Print pipeline with the current settings, straight to the system dialog ("Save as PDF").
  const exportPdf = useCallback(() => {
    void (async () => {
      await store.commitEdit();
      // the slide range and section are applied while building
      const doc = await buildShowDoc(store, printOptions);
      await printShow(store, backend, doc);
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
  const pad = compact ? 16 : 32;
  const tz = zoom === "fit" ? touchZoom : 1;
  const stageSize =
    zoom === "fit" || !pres
      ? { width: Math.max(0, size.width - pad - rulers) * tz, height: Math.max(0, size.height - pad - rulers) * tz }
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
      {compact && !masterView && view !== "outline" && !sorter && <SlideStrip store={store} />}
      <div className="flex min-h-0 flex-1">
        {masterView ? <MasterPanel store={store} /> : view === "outline" ? <OutlinePane store={store} /> : sorter || compact ? null : <SlideList store={store} />}
        {sorter ? (
          <SlideSorter store={store} />
        ) : (
        <div className="flex min-w-0 flex-1 flex-col">
        <div
          ref={areaRef}
          className={`flex min-w-0 flex-1 bg-ui-hover ${compact ? "p-2" : "p-4"} ${(zoom === "fit" && tz <= 1) || view === "notesPage" ? "items-center justify-center overflow-hidden" : "overflow-auto"}`}
          style={touch ? { touchAction: "pan-x pan-y" } : undefined}
          data-testid="canvas-area"
          data-touch-zoom={tz !== 1 ? Math.round(tz * 100) / 100 : undefined}
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
        {view !== "notesPage" && !compact && <NotesPane store={store} />}
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
      <StatusBar store={store} backend={backend} session={session} zoom={tz !== 1 ? stageScale : zoom} notesSheet={compact ? { open: notesSheet, toggle: () => setNotesSheet((v) => !v) } : undefined} />
      {compact && notesSheet && (
        <BottomSheet label={t("show.speakerNotes")} onClose={() => setNotesSheet(false)} testId="notes-sheet">
          <NotesPane store={store} sheet />
        </BottomSheet>
      )}
      <Toasts store={store} />
      <ShowDialogs store={store} printOptions={printOptions} onPrintOptions={setPrintOptions} />
      <ShortcutLayer store={store} guard={guard} enabled={!presenting} onPresent={presentFrom} onPresenterView={presenterView} />
      <ConfirmDiscard guard={guard} />
      {presenting && pres && <SlideShow store={store} mode={presenting.mode} link={presenting.link} rehearse={presenting.rehearse} record={presenting.record} customShow={presenting.customShow ?? null} onEnd={exit} />}
    </main>
  );
}
