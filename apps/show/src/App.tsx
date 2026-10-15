import { useCallback, useEffect, useRef, useState } from "react";
import { pingCore, type ShowBackend } from "./backend";
import { SlideStage, SLIDE_H, SLIDE_W } from "./SlideStage";

/** Static placeholder slides until the model arrives (ADR 0008). */
export const SLIDES = ["Welcome to Rusuite Show", "Slide two", "Slide three"];

function StatusBar({ backend, slide }: { backend: ShowBackend; slide: number }) {
  const [ping, setPing] = useState("…");
  useEffect(() => {
    let live = true;
    (async () => {
      const text = await backend.ping();
      const ok = await pingCore(backend);
      if (live) setPing(`${text}${ok ? "" : " (core not answering)"}`);
    })().catch((e) => live && setPing(`ping failed: ${String(e)}`));
    return () => {
      live = false;
    };
  }, [backend]);
  return (
    <div className="flex items-center gap-4 border-t border-ui-border bg-ui-panel px-3 py-0.5 text-xs text-ui-muted" data-testid="status-bar">
      <span data-testid="backend-kind">{backend.kind}</span>
      <span data-testid="ping">{ping}</span>
      <span className="ml-auto" data-testid="slide-count">
        Slide {slide + 1} of {SLIDES.length}
      </span>
    </div>
  );
}

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

function Thumbnail({ index, active, onClick }: { index: number; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={`Slide ${index + 1}`}
      aria-current={active ? "true" : undefined}
      onClick={onClick}
      data-testid="thumbnail"
      className={`flex gap-2 rounded p-1 text-left text-xs ${active ? "bg-ui-active" : "hover:bg-ui-hover"}`}
    >
      <span className="w-4 pt-1 text-right text-ui-muted">{index + 1}</span>
      <span
        className="flex flex-1 items-center justify-center rounded border border-ui-border bg-white p-1 text-[9px] font-bold text-neutral-800"
        style={{ aspectRatio: `${SLIDE_W} / ${SLIDE_H}` }}
      >
        {SLIDES[index]}
      </span>
    </button>
  );
}

function Presenter({ slide, onSlide, onExit }: { slide: number; onSlide: (i: number) => void; onExit: () => void }) {
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  const root = useRef<HTMLDivElement>(null);
  const entered = useRef(false);

  useEffect(() => {
    const el = root.current;
    try {
      void el?.requestFullscreen?.()?.catch(() => undefined);
    } catch {
      // fullscreen unavailable: the overlay still covers the window
    }
    const onFs = () => {
      if (document.fullscreenElement) entered.current = true;
      else if (entered.current) onExit(); // user left fullscreen (e.g. Esc)
    };
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    document.addEventListener("fullscreenchange", onFs);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("fullscreenchange", onFs);
      window.removeEventListener("resize", onResize);
      if (document.fullscreenElement) void document.exitFullscreen?.()?.catch(() => undefined);
    };
  }, [onExit]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onExit();
      else if (["ArrowRight", "ArrowDown", "PageDown", " "].includes(e.key)) onSlide(Math.min(slide + 1, SLIDES.length - 1));
      else if (["ArrowLeft", "ArrowUp", "PageUp"].includes(e.key)) onSlide(Math.max(slide - 1, 0));
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [slide, onSlide, onExit]);

  return (
    <div ref={root} role="dialog" aria-label="Presentation" data-testid="presenter" className="fixed inset-0 z-50 flex items-center justify-center bg-black">
      <SlideStage title={SLIDES[slide]} width={size.width} height={size.height} editable={false} />
    </div>
  );
}

export default function App({ backend }: { backend: ShowBackend }) {
  const [slide, setSlide] = useState(0);
  const [presenting, setPresenting] = useState(false);
  const [canvasRef, size] = useElementSize<HTMLDivElement>();
  const exit = useCallback(() => setPresenting(false), []);

  useEffect(() => {
    void backend.setTitle("Rusuite Show").catch(() => undefined);
  }, [backend]);

  return (
    <main className="flex h-screen flex-col bg-ui-bg text-ui-fg">
      <div role="toolbar" aria-label="Presentation" className="flex items-center gap-2 border-b border-ui-border bg-ui-panel px-3 py-1">
        <span className="text-sm font-semibold">Rusuite Show</span>
        <button
          type="button"
          onClick={() => setPresenting(true)}
          className="ml-auto rounded bg-orange-700 px-3 py-1 text-sm font-medium text-white hover:bg-orange-800"
        >
          Present
        </button>
      </div>
      <div className="flex min-h-0 flex-1">
        <nav aria-label="Slides" className="flex w-48 shrink-0 flex-col gap-1 overflow-y-auto border-r border-ui-border bg-ui-panel p-2">
          {SLIDES.map((_, i) => (
            <Thumbnail key={i} index={i} active={i === slide} onClick={() => setSlide(i)} />
          ))}
        </nav>
        <div ref={canvasRef} className="flex min-w-0 flex-1 items-center justify-center overflow-hidden bg-ui-hover p-4" data-testid="canvas-area">
          <div className="shadow-lg" data-testid="stage-host">
            <SlideStage key={slide} title={SLIDES[slide]} width={Math.max(0, size.width - 32)} height={Math.max(0, size.height - 32)} />
          </div>
        </div>
      </div>
      <StatusBar backend={backend} slide={slide} />
      {presenting && <Presenter slide={slide} onSlide={setSlide} onExit={exit} />}
    </main>
  );
}
