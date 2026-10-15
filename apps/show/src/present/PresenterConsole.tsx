// The presenter view in the main window (P7-8) while the audience window
// shows the slide: current slide, next slide, speaker notes (adjustable
// text size), elapsed time with reset, slide counter, Previous / Next /
// Black / End and a slide strip to jump to any slide. Keys work as in the
// show itself (showState.ts).

import { useCallback, useEffect, useRef, useState } from "react";
import type { Slide } from "../generated/Slide";
import type { DeckContext } from "../canvas/SlideView";
import { SlideImage, useShowKeys } from "./Presenter";
import { AnimatedSlide } from "./AnimatedSlide";
import type { ShowAction, ShowState } from "./showState";
import { formatDate } from "@rusuite/ui-shared";
import { useT } from "../i18n";

const NOTES_SIZES = [12, 14, 16, 18, 20, 24, 28, 32, 40];
const NOTES_SIZE_KEY = "rusuite.show.notesSize";

/** `h:mm:ss` (minutes and seconds below an hour). */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${two(m)}:${two(s)}`;
}

/** Observes an element's client size (0 × 0 without `ResizeObserver`, e.g. jsdom: then `fallback`). */
function useBox<T extends HTMLElement>(fallback: { width: number; height: number }) {
  const [size, setSize] = useState(fallback);
  const ro = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: T | null) => {
    ro.current?.disconnect();
    ro.current = null;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => setSize((p) => (p.width === el.clientWidth && p.height === el.clientHeight ? p : { width: el.clientWidth, height: el.clientHeight }));
    measure();
    ro.current = new ResizeObserver(measure);
    ro.current.observe(el);
  }, []);
  useEffect(() => () => ro.current?.disconnect(), []);
  return [ref, size] as const;
}

function loadNotesSize(): number {
  try {
    const v = Number(window.localStorage.getItem(NOTES_SIZE_KEY));
    return NOTES_SIZES.includes(v) ? v : 18;
  } catch {
    return 18;
  }
}

export interface PresenterConsoleProps {
  deck: DeckContext;
  slides: Slide[];
  media: ReadonlyMap<number, string>;
  mediaVersion: number;
  show: ShowState;
  onAction: (a: ShowAction) => void;
  /** Shown in the header while the audience window is being opened. */
  status?: string;
}

const BTN = "rounded bg-white/10 px-3 py-1 text-sm hover:bg-white/20 disabled:opacity-40";

export function PresenterConsole({ deck, slides, media, mediaVersion, show, onAction, status }: PresenterConsoleProps) {
  const t = useT();
  const [start, setStart] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [notesSize, setNotesSize] = useState(loadNotesSize);
  const [mainRef, mainSize] = useBox<HTMLDivElement>({ width: 800, height: 450 });
  const [nextRef, nextSize] = useBox<HTMLDivElement>({ width: 320, height: 180 });
  const stripItem = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  useEffect(() => {
    try {
      window.localStorage.setItem(NOTES_SIZE_KEY, String(notesSize));
    } catch {
      // No storage: the size is not remembered.
    }
  }, [notesSize]);
  useEffect(() => stripItem.current?.scrollIntoView?.({ block: "nearest", inline: "nearest" }), [show.index]);

  useShowKeys(onAction);

  const slide = slides[show.index];
  // "Next": the current slide after its next click while it has steps left (as the audience will see it).
  const moreSteps = !show.ended && show.step < (show.steps[show.index] ?? 0);
  const next = show.ended ? undefined : moreSteps ? slide : slides[show.index + 1];
  const nextStep = moreSteps ? show.step + 1 : 0;
  const notes = slide?.notes ?? "";
  const sizeAt = NOTES_SIZES.indexOf(notesSize);
  const counter = show.ended ? t("show.end") : t("show.slideOf", { n: show.index + 1, count: slides.length });
  const screen = show.ended ? t("show.end") : show.blank === "black" ? t("show.blackScreen") : show.blank === "white" ? t("show.whiteScreen") : null;

  return (
    <div role="dialog" aria-label={t("show.presenterView")} data-testid="presenter-console" className="fixed inset-0 z-50 flex flex-col bg-neutral-900 text-neutral-100">
      <header className="flex items-center gap-4 border-b border-white/10 px-4 py-2">
        <span className="font-mono text-2xl tabular-nums" data-testid="presenter-timer" aria-label={t("show.elapsed")}>
          {formatElapsed(now - start)}
        </span>
        <button
          type="button"
          className={BTN}
          onClick={() => {
            const t = Date.now();
            setStart(t);
            setNow(t);
          }}
        >
          {t("show.resetTimer")}
        </button>
        <span className="text-lg" data-testid="console-counter">
          {counter}
        </span>
        {show.autoStopped && <span className="text-sm text-white/60">{t("show.autoStopped")}</span>}
        {status && <span className="text-sm text-amber-300">{status}</span>}
        <span className="ml-auto text-sm text-white/60">{formatDate(now, { hour: "2-digit", minute: "2-digit" })}</span>
      </header>

      <div className="flex min-h-0 flex-1 gap-4 p-4">
        <section aria-label={t("show.currentSlide")} className="flex min-w-0 flex-[2] flex-col gap-2">
          <div ref={mainRef} className="relative flex min-h-0 flex-1 items-center justify-center" data-testid="console-current">
            {slide && !show.ended && (
              <div className={screen ? "opacity-30" : undefined}>
                <AnimatedSlide deck={deck} slide={slide} media={media} mediaVersion={mediaVersion} width={mainSize.width} height={mainSize.height} step={show.step} />
              </div>
            )}
            {screen && (
              <span className="absolute rounded bg-black/70 px-3 py-1 text-lg" data-testid="console-screen">
                {screen}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" className={BTN} onClick={() => onAction({ type: "prev" })}>
              {t("show.previous")}
            </button>
            <button type="button" className={BTN} onClick={() => onAction({ type: "next" })}>
              {t("show.next")}
            </button>
            <button type="button" className={BTN} aria-pressed={show.blank === "black"} onClick={() => onAction({ type: "blank", color: "black" })}>
              {t("show.blackScreen")}
            </button>
            <button type="button" className={`${BTN} ml-auto bg-orange-700 hover:bg-orange-800`} onClick={() => onAction({ type: "exit" })}>
              {t("show.endShow")}
            </button>
          </div>
        </section>

        <aside className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="text-xs uppercase tracking-wide text-white/50">{t("show.nextHeading")}</div>
          <div ref={nextRef} className="flex aspect-video w-full items-center justify-center bg-black/40" data-testid="console-next">
            {next ? (
              <AnimatedSlide key={`${next.id}:${nextStep}`} deck={deck} slide={next} media={media} mediaVersion={mediaVersion} width={nextSize.width} height={nextSize.height} step={nextStep} still />
            ) : (
              <span className="text-sm text-white/50">{show.ended ? "" : t("show.end")}</span>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-white/50">
            {t("show.notes")}
            <span className="ml-auto flex gap-1 normal-case">
              <button type="button" className={BTN} aria-label={t("show.smallerNotes")} disabled={sizeAt <= 0} onClick={() => setNotesSize(NOTES_SIZES[sizeAt - 1] ?? notesSize)}>
                A−
              </button>
              <button
                type="button"
                className={BTN}
                aria-label={t("show.largerNotes")}
                disabled={sizeAt >= NOTES_SIZES.length - 1}
                onClick={() => setNotesSize(NOTES_SIZES[sizeAt + 1] ?? notesSize)}
              >
                A+
              </button>
            </span>
          </div>
          <div
            className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap rounded bg-black/30 p-3 leading-snug"
            style={{ fontSize: notesSize }}
            data-testid="console-notes"
            aria-label={t("show.speakerNotes")}
          >
            {notes || <span className="text-white/40">{t("show.noNotes")}</span>}
          </div>
        </aside>
      </div>

      <nav aria-label={t("show.slides")} className="flex gap-2 overflow-x-auto border-t border-white/10 p-2">
        {slides.map((s, i) => (
          <button
            key={s.id}
            ref={i === show.index ? stripItem : undefined}
            type="button"
            aria-label={t("show.goTo", { n: i + 1 })}
            aria-current={i === show.index && !show.ended ? "true" : undefined}
            className={`relative shrink-0 rounded border-2 ${i === show.index && !show.ended ? "border-orange-500" : "border-transparent hover:border-white/40"}`}
            onClick={() => onAction({ type: "goto", index: i })}
            data-testid="console-strip-item"
          >
            <SlideImage deck={deck} slide={s} media={media} mediaVersion={mediaVersion} width={112} height={63} />
            <span className="absolute bottom-0 left-0 bg-black/60 px-1 text-[10px]">{i + 1}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
