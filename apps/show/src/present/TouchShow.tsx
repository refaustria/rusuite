// The slide show with fingers (P10-M5): a swipe left / right is next / previous (animation steps too), a tap on
// the left third goes back, elsewhere on; a long press opens a small overlay with the slide number, the slides as
// a grid to jump to ("Go to slide…"), the pen and the laser pointer (the show's ink tool, drawn with one finger) and
// Exit. On phones and tablets the show asks for landscape (Screen Orientation API, failures ignored).

import type { Slide } from "../generated/Slide";
import type { DeckContext } from "../canvas/SlideView";
import { DeckThumb } from "../ui/Thumbs";
import { useT } from "../i18n";
import { DEFAULT_HIGHLIGHTER, DEFAULT_PEN } from "./tools";
import type { ToolsState } from "./ShowTools";
import type { ShowAction } from "./showState";

/** A horizontal move of at least this many px (and mostly sideways) is a swipe. */
export const SWIPE_MIN = 50;

/** The show action of a finger lifted after moving `dx` × `dy` px (`null`: no swipe). */
export function swipeAction(dx: number, dy: number): ShowAction | null {
  if (Math.abs(dx) < SWIPE_MIN || Math.abs(dx) < 1.5 * Math.abs(dy)) return null;
  return dx < 0 ? { type: "next" } : { type: "prev" };
}

/** The show action of a tap at `x` on a `width` wide screen: the left third goes back, the rest on. */
export function tapAction(x: number, width: number): ShowAction {
  return x < width / 3 ? { type: "prev" } : { type: "next", via: "click" };
}

/** Asks for landscape while the show runs (where the API exists; a refusal is ignored). Returns the undo. */
export function lockLandscape(): () => void {
  const o = typeof screen === "undefined" ? undefined : (screen.orientation as (ScreenOrientation & { lock?: (o: string) => Promise<void> }) | undefined);
  try {
    void o?.lock?.("landscape")?.catch(() => undefined);
  } catch {
    // not supported
  }
  return () => {
    try {
      o?.unlock?.();
    } catch {
      // not supported
    }
  };
}

const BTN = "flex min-h-11 min-w-11 items-center justify-center rounded-full bg-white/10 px-4 text-sm text-white hover:bg-white/20 aria-pressed:bg-orange-600";

export function TouchShowOverlay({ deck, slides, media, current, width, tools, setTools, onGoto, onExit, onClose }: {
  deck: DeckContext;
  slides: Slide[];
  media: ReadonlyMap<number, string>;
  current: number;
  width: number;
  /** The show's tools (pen, laser); absent: the fallback show without tools. */
  tools?: ToolsState;
  setTools?: (f: (s: ToolsState) => ToolsState) => void;
  onGoto: (index: number) => void;
  onExit: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const cols = Math.max(2, Math.min(6, Math.floor((width - 32) / 160)));
  const thumb = Math.floor((Math.min(width, 1100) - 32 - (cols - 1) * 12) / cols);
  const mode = (m: "pen" | "laser") =>
    setTools?.((s) => ({ ...s, mode: s.mode === m ? "arrow" : m, penColor: m === "pen" && s.penColor === DEFAULT_HIGHLIGHTER ? DEFAULT_PEN : s.penColor }));
  return (
    <div
      role="dialog"
      aria-label={t("show.touch.showMenu")}
      data-testid="touch-overlay"
      className="absolute inset-0 z-30 flex flex-col bg-neutral-900/90 text-white"
      onClick={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) onClose();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <div className="flex flex-wrap items-center gap-2 p-3 pt-[max(12px,env(safe-area-inset-top))]">
        <span className="mr-auto text-base font-medium" data-testid="touch-overlay-counter">
          {t("show.slideOf", { n: current + 1, count: slides.length })}
        </span>
        {tools && setTools && (
          <>
            <button type="button" className={BTN} aria-pressed={tools.mode === "pen"} onClick={() => mode("pen")}>
              {t("show.tools.pen")}
            </button>
            <button type="button" className={BTN} aria-pressed={tools.mode === "laser"} onClick={() => mode("laser")}>
              {t("show.tools.laser")}
            </button>
          </>
        )}
        <button type="button" className={BTN} onClick={onClose}>
          {t("show.touch.backToShow")}
        </button>
        <button type="button" className={`${BTN} bg-orange-700`} onClick={onExit}>
          {t("show.endShow")}
        </button>
      </div>
      <div className="px-3 text-xs text-white/70">{t("show.touch.goToSlide")}</div>
      <div className="min-h-0 flex-1 overflow-auto p-3" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div role="group" aria-label={t("show.touch.goToSlide")} className="grid gap-3" style={{ gridTemplateColumns: `repeat(${cols}, ${thumb}px)` }}>
          {slides.map((s, i) => (
            <button
              key={s.id}
              type="button"
              aria-label={t("show.slideN", { n: i + 1 })}
              aria-current={i === current ? "true" : undefined}
              className={`flex min-h-11 flex-col items-start gap-1 rounded p-1 text-left text-xs text-white/80 ${i === current ? "outline outline-2 outline-orange-500" : ""}`}
              onClick={() => onGoto(i)}
            >
              <DeckThumb deck={deck} slide={s} media={media} width={thumb - 8} />
              {i + 1}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
