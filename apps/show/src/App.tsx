import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ShowApi } from "./api";
import type { ShowBackend } from "./backend";
import { EditorStage } from "./canvas/Stage";
import { Presenter } from "./present/Presenter";
import { SlideList } from "./sidebar/SlideList";
import { ShortcutLayer } from "./ShortcutLayer";
import { ShowStore, useShow } from "./state/store";
import { ShowToolbar } from "./ui/ShowToolbar";
import { Toasts } from "./ui/Toasts";

function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

function StatusBar({ store, backend }: { store: ShowStore; backend: ShowBackend }) {
  const pres = useShow(store, (s) => s.pres);
  const current = useShow(store, (s) => s.current);
  const revision = useShow(store, (s) => s.revision);
  const dirty = useShow(store, (s) => s.dirty);
  const name = useShow(store, (s) => s.name);
  const info = useShow(store, (s) => s.info);
  const warnings = useShow(store, (s) => s.warnings);
  const n = pres?.slides.length ?? 0;
  const i = pres ? pres.slides.findIndex((s) => s.id === current) : -1;
  return (
    <div className="flex items-center gap-4 border-t border-ui-border bg-ui-panel px-3 py-0.5 text-xs text-ui-muted" data-testid="status-bar">
      <span data-testid="slide-count">{n ? `Slide ${i + 1} of ${n}` : "No slides"}</span>
      <span data-testid="doc-name">{name ?? "Untitled"}</span>
      <span data-testid="dirty">{dirty ? "Modified" : "Saved"}</span>
      <span data-testid="revision">rev {Math.max(0, revision)}</span>
      {info && <span data-testid="info">{info}</span>}
      {warnings.length > 0 && (
        <span data-testid="warnings" title={warnings.join("\n")} className="truncate text-amber-600">
          {warnings.length} warning{warnings.length === 1 ? "" : "s"}: {warnings[0]}
        </span>
      )}
      <span className="ml-auto" data-testid="backend-kind">
        {backend.kind}
      </span>
    </div>
  );
}

export default function App({ backend, store: given }: { backend: ShowBackend; store?: ShowStore }) {
  const store = useMemo(() => given ?? new ShowStore(new ShowApi(backend)), [backend, given]);
  const [presenting, setPresenting] = useState(false);
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
    void backend.setTitle(`${dirty ? "• " : ""}${name ?? "Untitled"} – Rusuite Show`).catch(() => undefined);
  }, [backend, dirty, name]);

  const startPresenting = useCallback(() => {
    void store.commitEdit();
    setPresenting(true);
  }, [store]);
  const presentFrom = useCallback(
    (fromStart: boolean) => {
      const first = store.getState().pres?.slides[0]?.id;
      if (fromStart && first !== undefined) store.selectSlide(first);
      startPresenting();
    },
    [store, startPresenting],
  );
  const exit = useCallback(() => setPresenting(false), []);
  const slides = pres?.slides ?? [];
  const index = Math.max(0, slides.findIndex((s) => s.id === current));
  const onIndex = useCallback(
    (i: number) => {
      const id = store.getState().pres?.slides[i]?.id;
      if (id !== undefined) store.selectSlide(id);
    },
    [store],
  );

  return (
    <main className="flex h-screen flex-col bg-ui-bg text-ui-fg">
      <ShowToolbar store={store} onPresent={startPresenting} />
      <div className="flex min-h-0 flex-1">
        <SlideList store={store} />
        <div ref={canvasRef} className="flex min-w-0 flex-1 items-center justify-center overflow-hidden bg-ui-hover p-4" data-testid="canvas-area">
          <div className="shadow-lg" data-testid="stage-host">
            <EditorStage store={store} width={Math.max(0, size.width - 32)} height={Math.max(0, size.height - 32)} />
          </div>
        </div>
      </div>
      <StatusBar store={store} backend={backend} />
      <Toasts store={store} />
      <ShortcutLayer store={store} enabled={!presenting} onPresent={presentFrom} />
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
