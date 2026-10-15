// Presentation mode: a frontend-only render of the model (ADR 0008).
// Fullscreen via the Fullscreen API, falling back to a full-window
// overlay; the slide is scaled to the screen.

import { useEffect, useRef, useState } from "react";
import { Layer, Stage } from "react-konva";
import type { Slide } from "../generated/Slide";
import { fitScale, slidePx } from "../geometry";
import { SlideView, type DeckContext } from "../canvas/SlideView";

/** The slide index after `key` (`"exit"` for Esc, `null` = not a presenter key). */
export function presenterKey(key: string, index: number, count: number): number | "exit" | null {
  const last = Math.max(0, count - 1);
  switch (key) {
    case "Escape":
      return "exit";
    case "ArrowRight":
    case "ArrowDown":
    case "PageDown":
    case " ":
    case "Enter":
    case "n":
      return Math.min(index + 1, last);
    case "ArrowLeft":
    case "ArrowUp":
    case "PageUp":
    case "Backspace":
    case "p":
      return Math.max(index - 1, 0);
    case "Home":
      return 0;
    case "End":
      return last;
    default:
      return null;
  }
}

export interface PresenterProps {
  deck: DeckContext;
  slides: Slide[];
  media: ReadonlyMap<number, string>;
  mediaVersion: number;
  index: number;
  onIndex: (i: number) => void;
  onExit: () => void;
}

export function Presenter({ deck, slides, media, mediaVersion, index, onIndex, onExit }: PresenterProps) {
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  const root = useRef<HTMLDivElement>(null);
  const entered = useRef(false);

  useEffect(() => {
    try {
      const p = root.current?.requestFullscreen?.();
      void p?.catch(() => undefined);
    } catch {
      // Fullscreen unavailable: the overlay still covers the window.
    }
    const onFs = () => {
      if (document.fullscreenElement) entered.current = true;
      else if (entered.current) onExit(); // the user left fullscreen (Esc)
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
      const next = presenterKey(e.key, index, slides.length);
      if (next === null) return;
      e.preventDefault();
      e.stopPropagation();
      if (next === "exit") onExit();
      else onIndex(next);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [index, slides.length, onIndex, onExit]);

  const slide = slides[index];
  const scale = fitScale(size.width, size.height, deck.slideSize);
  const px = slidePx(deck.slideSize);
  return (
    <div
      ref={root}
      role="dialog"
      aria-label="Presentation"
      data-testid="presenter"
      className="fixed inset-0 z-50 flex cursor-pointer items-center justify-center bg-black"
      onClick={() => onIndex(Math.min(index + 1, slides.length - 1))}
    >
      {slide && scale > 0 && (
        <Stage width={px.width * scale} height={px.height * scale} scaleX={scale} scaleY={scale} listening={false}>
          <Layer listening={false}>
            <SlideView deck={deck} slide={slide} media={media} mediaVersion={mediaVersion} />
          </Layer>
        </Stage>
      )}
      <span className="pointer-events-none absolute bottom-2 right-3 text-xs text-white/40" data-testid="presenter-counter">
        {index + 1} / {slides.length}
      </span>
    </div>
  );
}
