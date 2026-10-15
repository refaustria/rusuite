import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AutosaveStatus, ConfirmDiscard, DocumentSession, RecoveryBanner, UnsavedGuard, printAndWait, withExtension, type AnySession } from "@rusuite/ui-shared";
import { ShowApi } from "./api";
import type { ShowBackend } from "./backend";
import { EditorStage } from "./canvas/Stage";
import { PrintView } from "./print/PrintView";
import { Presenter } from "./present/Presenter";
import { SlideList } from "./sidebar/SlideList";
import { ShortcutLayer } from "./ShortcutLayer";
import { ShowStore, useShow } from "./state/store";
import { slidePx } from "./geometry";
import { ShowRibbon, type ShowZoom } from "./ui/ShowToolbar";
import { NotesPane } from "./ui/NotesPane";
import { ShowDialogs } from "./ui/ShowDialogs";
import { Toasts } from "./ui/Toasts";

/** Observes an element's client size. A callback ref, so a remounted element (e.g. after the print view replaced the
 *  editor) is measured and observed again. */
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
      <span data-testid="slide-count">{n ? `Slide ${i + 1} of ${n}${hidden ? " (hidden)" : ""}` : "No slides"}</span>
      <span data-testid="doc-name">{name ?? "Untitled"}</span>
      <span data-testid="dirty">{dirty ? "Modified" : "Saved"}</span>
      <span data-testid="revision">rev {Math.max(0, revision)}</span>
      <AutosaveStatus session={session} />
      {info && <span data-testid="info">{info}</span>}
      {warnings.length > 0 && (
        <span data-testid="warnings" title={warnings.join("\n")} className="truncate text-amber-600">
          {warnings.length} warning{warnings.length === 1 ? "" : "s"}: {warnings[0]}
        </span>
      )}
      <button type="button" className={`ml-auto rounded px-1 hover:bg-ui-hover ${notesVisible ? "text-ui-fg" : ""}`} aria-pressed={notesVisible} onClick={() => store.toggleNotes()}>
        Notes
      </button>
      <span data-testid="zoom">
        {zoom === "fit" ? "Fit" : `${Math.round(zoom * 100)} %`}
      </span>
      <span data-testid="backend-kind">
        {backend.kind}
      </span>
    </div>
  );
}

export default function App({ backend, store: given }: { backend: ShowBackend; store?: ShowStore }) {
  // Recent files, autosave, crash recovery: the store talks through the session's backend.
  const session = useMemo(() => new DocumentSession(backend), [backend]);
  const store = useMemo(() => given ?? new ShowStore(new ShowApi(session.backend)), [session, given]);
  // Unsaved-changes question before New / Open / recent / Restore / Close and closing the window (P7-6).
  const guard = useMemo(
    () =>
      new UnsavedGuard(backend, {
        dirty: () => store.getState().dirty,
        name: () => store.getState().name,
        defaultName: "Presentation.pptx",
        save: async (asName) => {
          await store.save(asName === undefined ? undefined : withExtension(asName, ".pptx"));
          return !store.getState().dirty;
        },
      }),
    [backend, store],
  );
  const [presenting, setPresenting] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [zoom, setZoom] = useState<ShowZoom>("fit");
  const [canvasRef, size] = useElementSize<HTMLDivElement>();
  const pres = useShow(store, (s) => s.pres);
  const current = useShow(store, (s) => s.current);
  const dirty = useShow(store, (s) => s.dirty);
  const name = useShow(store, (s) => s.name);
  const mediaVersion = useShow(store, (s) => s.mediaVersion);

  useEffect(() => {
    void store.init().then(() => store.probeFileIo());
    if (import.meta.env.DEV) (window as unknown as { __showStore?: ShowStore }).__showStore = store;
  }, [store]);

  useEffect(() => {
    session.attach({
      restore: (json, name) => store.restoreRecovery(json, name),
      openFile: (file) => store.openBytes(file),
      onError: (e) => store.pushError(e),
      confirmReplace: async () => (await guard.ensureSaved()) === "proceed",
    });
    void session.start();
    return () => session.stop();
  }, [session, store, guard]);
  useEffect(() => guard.watchWindow(), [guard]);

  useEffect(() => {
    void backend.setTitle(`${dirty ? "• " : ""}${name ?? "Untitled"} – Rusuite Show`).catch(() => undefined);
    guard.syncDirty();
  }, [backend, guard, dirty, name]);

  const startPresenting = useCallback(() => {
    void store.commitEdit();
    setPresenting(true);
  }, [store]);
  const exportPdf = useCallback(() => {
    void store.commitEdit();
    setPrinting(true);
  }, [store]);
  const printReady = useCallback(() => {
    void printAndWait(backend)
      .catch((e) => store.pushError(e))
      .finally(() => setPrinting(false));
  }, [backend, store]);
  const presentFrom = useCallback(
    (fromStart: boolean) => {
      const first = store.getState().pres?.slides[0]?.id;
      if (fromStart && first !== undefined) store.selectSlide(store.getState().pres?.slides.find((s) => !s.hidden)?.id ?? first);
      startPresenting();
    },
    [store, startPresenting],
  );
  const exit = useCallback(() => setPresenting(false), []);
  // The show skips hidden slides (unless started from one, as in PowerPoint).
  const slides = useMemo(() => (pres?.slides ?? []).filter((s) => !s.hidden || s.id === current), [pres, current]);
  const index = Math.max(0, slides.findIndex((s) => s.id === current));
  const onIndex = useCallback(
    (i: number) => {
      const id = slides[i]?.id;
      if (id !== undefined) store.selectSlide(id);
    },
    [store, slides],
  );

  // Fit: the canvas area minus its padding; a fixed zoom: the slide at that scale.
  const stageSize =
    zoom === "fit" || !pres
      ? { width: Math.max(0, size.width - 32), height: Math.max(0, size.height - 32) }
      : { width: slidePx(pres.slideSize).width * zoom, height: slidePx(pres.slideSize).height * zoom };

  if (printing && pres) return <PrintView deck={pres} slides={pres.slides} media={store.media} onReady={printReady} />;

  return (
    <main className="flex h-screen flex-col bg-ui-bg text-ui-fg">
      <RecoveryBanner session={session} />
      <ShowRibbon store={store} session={session} onPresent={presentFrom} onExportPdf={exportPdf} zoom={zoom} onZoom={setZoom} />
      <div className="flex min-h-0 flex-1">
        <SlideList store={store} />
        <div className="flex min-w-0 flex-1 flex-col">
        <div
          ref={canvasRef}
          className={`flex min-w-0 flex-1 bg-ui-hover p-4 ${zoom === "fit" ? "items-center justify-center overflow-hidden" : "overflow-auto"}`}
          data-testid="canvas-area"
        >
          <div className="m-auto shrink-0 shadow-lg" data-testid="stage-host">
            <EditorStage store={store} width={stageSize.width} height={stageSize.height} />
          </div>
        </div>
        <NotesPane store={store} />
        </div>
      </div>
      <StatusBar store={store} backend={backend} session={session} zoom={zoom} />
      <Toasts store={store} />
      <ShowDialogs store={store} />
      <ShortcutLayer store={store} guard={guard} enabled={!presenting} onPresent={presentFrom} onExportPdf={exportPdf} />
      <ConfirmDiscard guard={guard} />
      {presenting && pres && slides.length > 0 && (
        <Presenter
          deck={pres}
          slides={slides}
          media={store.media}
          mediaVersion={mediaVersion}
          index={index}
          onIndex={onIndex}
          onExit={exit}
        />
      )}
    </main>
  );
}
