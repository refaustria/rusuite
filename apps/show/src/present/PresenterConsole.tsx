// The presenter view in the main window (P7-8) while the audience window
// shows the slide: current slide, next slide, speaker notes (adjustable
// text size, editable – saved to the deck, undoable; P9-S5), the total
// and the slide's time (pause / resume, reset), slide counter, Previous /
// Next / Black / White / End, "See all slides", the pen, highlighter,
// laser pointer, eraser and magnifier (drawn on the audience screen too),
// Swap displays (desktop) and a slide strip to jump to any slide. Keys
// work as in the show itself (showState.ts, tools.ts).

import { useCallback, useEffect, useRef, useState } from "react";
import type { Slide } from "../generated/Slide";
import type { DeckContext } from "../canvas/SlideView";
import { SlideImage, useShowKeys } from "./Presenter";
import { AnimatedSlide } from "./AnimatedSlide";
import type { ShowAction, ShowState } from "./showState";
import { InkLayer, SeeAll, ToolBar, slideBox, useToolKeys, zoomTransform, type ToolsState } from "./ShowTools";
import { nextSlideTimer, resetTimer, slideElapsed, startTimer, toggleTimer, totalElapsed } from "./timer";
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
  /** The show's tools (shared with the audience window). */
  tools: ToolsState;
  setTools: (f: (s: ToolsState) => ToolsState) => void;
  /** The notes of a slide were edited (absent: read-only notes). */
  onNotes?: (slide: number, notes: string) => void;
  /** Swap displays (absent: not available here). */
  onSwap?: () => void;
}

/** The notes of `slideId`, editable; the text is saved when the field loses focus or the slide changes. */
function NotesEditor({ slideId, notes, size, onNotes, label, empty }: { slideId: number | undefined; notes: string; size: number; onNotes?: (slide: number, notes: string) => void; label: string; empty: string }) {
  const [draft, setDraft] = useState(notes);
  const pending = useRef<{ id: number; text: string } | null>(null);
  const save = useRef(onNotes);
  save.current = onNotes;
  const flush = () => {
    const p = pending.current;
    pending.current = null;
    if (p) save.current?.(p.id, p.text);
  };
  // another slide (or the deck changed the notes): show its text, saving the edit of the last one
  useEffect(() => {
    flush();
    setDraft(notes);
  }, [slideId, notes]);
  useEffect(() => () => flush(), []);
  return (
    <textarea
      className="min-h-0 flex-1 resize-none overflow-auto whitespace-pre-wrap rounded bg-black/30 p-3 leading-snug text-neutral-100 outline-none placeholder:text-white/40 focus:ring-1 focus:ring-orange-500"
      style={{ fontSize: size }}
      data-testid="console-notes"
      aria-label={label}
      placeholder={empty}
      readOnly={!onNotes || slideId === undefined}
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        if (slideId !== undefined) pending.current = { id: slideId, text: e.target.value };
      }}
      onBlur={flush}
      onKeyDown={(e) => {
        // Esc leaves the notes (the next Esc ends the show)
        if (e.key === "Escape") {
          e.stopPropagation();
          e.currentTarget.blur();
        }
      }}
    />
  );
}

const BTN = "rounded bg-white/10 px-3 py-1 text-sm hover:bg-white/20 disabled:opacity-40";

export function PresenterConsole({ deck, slides, media, mediaVersion, show, onAction, status, tools, setTools, onNotes, onSwap }: PresenterConsoleProps) {
  const t = useT();
  const [timer, setTimer] = useState(() => startTimer(Date.now()));
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
  // the slide's time starts again on every slide
  const shownIndex = useRef(show.index);
  useEffect(() => {
    if (shownIndex.current === show.index) return;
    shownIndex.current = show.index;
    setTimer((x) => nextSlideTimer(x, Date.now()));
  }, [show.index]);

  const slide = slides[show.index];
  // the tools' keys first (Ctrl+P pen, G see all slides, + / − zoom, E erase …), then the show's
  const pointer = useRef({ x: 0.5, y: 0.5 });
  useToolKeys(setTools, slide?.id, pointer);
  useShowKeys(onAction);

  // Section names before the first shown slide of each section.
  const sectionStart = new Map<number, string>();
  for (const sec of deck.sections ?? []) {
    const first = slides.find((x) => sec.slideIds.includes(x.id));
    if (first && !sectionStart.has(first.id)) sectionStart.set(first.id, sec.name);
  }
  // "Next": the current slide after its next click while it has steps left (as the audience will see it).
  const moreSteps = !show.ended && show.step < (show.steps[show.index] ?? 0);
  const next = show.ended ? undefined : moreSteps ? slide : slides[show.index + 1];
  const nextStep = moreSteps ? show.step + 1 : 0;
  const notes = slide?.notes ?? "";
  const box = slideBox(deck, mainSize.width, mainSize.height);
  const paused = timer.pausedAt !== null;
  const sizeAt = NOTES_SIZES.indexOf(notesSize);
  const counter = show.ended ? t("show.end") : t("show.slideOf", { n: show.index + 1, count: slides.length });
  const screen = show.ended ? t("show.end") : show.blank === "black" ? t("show.blackScreen") : show.blank === "white" ? t("show.whiteScreen") : null;

  return (
    <div role="dialog" aria-label={t("show.presenterView")} data-testid="presenter-console" className="fixed inset-0 z-50 flex flex-col bg-neutral-900 text-neutral-100">
      <header className="flex items-center gap-4 border-b border-white/10 px-4 py-2">
        <span className={`font-mono text-2xl tabular-nums ${paused ? "text-white/50" : ""}`} data-testid="presenter-timer" data-paused={paused ? "true" : undefined} aria-label={t("show.elapsed")}>
          {formatElapsed(totalElapsed(timer, now))}
        </span>
        <button
          type="button"
          className={BTN}
          aria-pressed={paused}
          data-testid="timer-pause"
          onClick={() => {
            const x = Date.now();
            setTimer((s) => toggleTimer(s, x));
            setNow(x);
          }}
        >
          {paused ? t("show.resumeTimer") : t("show.pauseTimer")}
        </button>
        <button
          type="button"
          className={BTN}
          onClick={() => {
            const x = Date.now();
            setTimer((s) => resetTimer(s, x));
            setNow(x);
          }}
        >
          {t("show.resetTimer")}
        </button>
        <span className="font-mono text-sm tabular-nums text-white/70" data-testid="presenter-slide-timer" aria-label={t("show.slideTime")} title={t("show.slideTime")}>
          {formatElapsed(slideElapsed(timer, now))}
        </span>
        <span className="text-lg" data-testid="console-counter">
          {counter}
        </span>
        {show.autoStopped && <span className="text-sm text-white/60">{t("show.autoStopped")}</span>}
        {status && <span className="text-sm text-amber-300">{status}</span>}
        <span className="ml-auto text-sm text-white/60">{formatDate(now, { hour: "2-digit", minute: "2-digit" })}</span>
      </header>

      <div className="flex min-h-0 flex-1 gap-4 p-4">
        <section aria-label={t("show.currentSlide")} className="flex min-w-0 flex-[2] flex-col gap-2">
          <div
            ref={mainRef}
            className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden"
            data-testid="console-current"
            data-zoom={tools.zoom > 1 ? tools.zoom : undefined}
            data-tool={tools.mode}
            onPointerMove={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              pointer.current = { x: r.width ? (e.clientX - r.left) / r.width : 0.5, y: r.height ? (e.clientY - r.top) / r.height : 0.5 };
            }}
          >
            {slide && !show.ended && (
              <div className={`absolute inset-0 flex items-center justify-center ${screen ? "opacity-30" : ""}`} style={{ transform: zoomTransform(tools, mainSize.width, mainSize.height), transformOrigin: "0 0" }}>
                <AnimatedSlide deck={deck} slide={slide} media={media} mediaVersion={mediaVersion} width={mainSize.width} height={mainSize.height} step={show.step} />
                {!screen && <InkLayer tools={tools} setTools={setTools} slide={slide} box={box} scale={box.scale} />}
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
            <button type="button" className={BTN} aria-pressed={show.blank === "white"} onClick={() => onAction({ type: "blank", color: "white" })}>
              {t("show.whiteScreen")}
            </button>
            <ToolBar tools={tools} setTools={setTools} visible inline onPrev={() => onAction({ type: "prev" })} onNext={() => onAction({ type: "next" })} />
            {onSwap && (
              <button type="button" className={BTN} data-testid="swap-displays" title={t("show.swapDisplaysTip")} onClick={onSwap}>
                {t("show.swapDisplays")}
              </button>
            )}
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
          <NotesEditor slideId={show.ended ? undefined : slide?.id} notes={show.ended ? "" : notes} size={notesSize} onNotes={onNotes} label={t("show.speakerNotes")} empty={t("show.noNotes")} />
        </aside>
      </div>

      <nav aria-label={t("show.slides")} className="flex gap-2 overflow-x-auto border-t border-white/10 p-2">
        {slides.map((s, i) => [
          sectionStart.get(s.id) !== undefined && (
            <span key={`sec-${s.id}`} data-testid="console-section" className="flex shrink-0 items-center px-1 text-[10px] uppercase tracking-wide text-white/60 [writing-mode:vertical-rl]">
              {sectionStart.get(s.id)}
            </span>
          ),
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
          </button>,
        ])}
      </nav>
      {tools.seeAll && (
        <SeeAll
          deck={deck}
          slides={slides}
          media={media}
          current={show.index}
          width={typeof window === "undefined" ? 1200 : window.innerWidth}
          onPick={(i) => {
            setTools((s) => ({ ...s, seeAll: false }));
            onAction({ type: "goto", index: i });
          }}
        />
      )}
    </div>
  );
}
