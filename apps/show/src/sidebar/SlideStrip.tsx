// The compact layout's slide list (P10-M5): a horizontal strip of thumbnails (72 px high) under the top bar. A tap
// selects the slide (the current one is highlighted and scrolled into view), a long press opens the slide sheet
// (New, Duplicate, Delete, Hide, Layout…, Transition…), and a long press followed by a drag reorders: the finger
// carries the slide, an insertion line shows where it lands. A mouse drag (narrow desktop windows) reorders too.
//
// The strip sits under the top bar rather than above the command bar: the slide is read from the top down
// (slides, then the slide, like the desktop's list on the left), the strip stays put when the on-screen keyboard
// pushes the command bar up, and thumbs operating the bar do not hit it by accident.

import { useEffect, useRef, useState } from "react";
import { ContextMenu, type ContextMenuItem } from "@rusuite/ui-shared";
import type { NodeId } from "../generated/NodeId";
import { useShow, type ShowStore } from "../state/store";
import { stableDeck } from "../design/deck";
import { DeckThumb } from "../ui/Thumbs";
import { slidePx } from "../geometry";
import { slideDropIndex } from "../state/commands";
import { compactThumbnailMenu, layoutMenu } from "../canvas/menus";
import { useT } from "../i18n";

/** Height of the strip (px). */
export const STRIP_HEIGHT = 72;
/** Height of a thumbnail picture in the strip (px). */
export const STRIP_THUMB_HEIGHT = 50;
/** A mouse drag starts after this many px; a touch drag needs the long press first. */
const DRAG_SLOP = 8;

/** The insertion index (0…count) for a pointer at `x` over thumbnails with the given left/right edges. */
export function stripDropIndex(edges: readonly { left: number; right: number }[], x: number): number {
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i]!;
    if (x < (e.left + e.right) / 2) return i;
  }
  return edges.length;
}

interface Press {
  id: number;
  slide: NodeId;
  index: number;
  x: number;
  y: number;
  touch: boolean;
  /** The long press answered (touch): moving now drags, lifting opens the sheet. */
  armed: boolean;
  dragging: boolean;
  at: { x: number; y: number };
}

export function SlideStrip({ store }: { store: ShowStore }) {
  const t = useT();
  const pres = useShow(store, (s) => s.pres);
  const current = useShow(store, (s) => s.current);
  const mediaVersion = useShow(store, (s) => s.mediaVersion);
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; items: ContextMenuItem[] } | null>(null);
  const [drag, setDrag] = useState<{ from: number; to: number; x: number } | null>(null);
  const press = useRef<Press | null>(null);
  const list = useRef<HTMLDivElement>(null);

  // The current slide in view (a tap on the stage's arrows, undo, a new slide …).
  useEffect(() => {
    const el = list.current?.querySelector<HTMLElement>('[aria-current="true"]');
    el?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [current, pres?.slides.length]);

  // An armed long press keeps the finger: the strip must not scroll while a slide is carried.
  useEffect(() => {
    const el = list.current;
    if (!el) return;
    const onMove = (e: TouchEvent) => {
      if (press.current?.armed && e.cancelable) e.preventDefault();
    };
    el.addEventListener("touchmove", onMove, { passive: false });
    return () => el.removeEventListener("touchmove", onMove);
  }, [pres !== null]);

  if (!pres) return <nav aria-label={t("show.slides")} data-testid="slide-strip" className="shrink-0 border-b border-ui-border bg-ui-panel" style={{ height: STRIP_HEIGHT }} />;
  const deck = stableDeck(pres);
  const slides = pres.slides;
  const size = slidePx(pres.slideSize);
  const thumbWidth = Math.round((STRIP_THUMB_HEIGHT * size.width) / size.height);

  const openMenu = (slide: NodeId, at: { x: number; y: number }) => {
    store.selectSlide(slide);
    setMenu({
      at,
      items: compactThumbnailMenu(store, slide, () => setMenu({ at, items: layoutMenu(store, slide) })),
    });
  };
  const edges = () =>
    Array.from(list.current?.querySelectorAll<HTMLElement>('[data-testid="thumbnail"]') ?? []).map((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right };
    });
  const finish = () => {
    press.current = null;
    setDrag(null);
  };
  const drop = (p: Press, x: number) => {
    const to = stripDropIndex(edges(), x);
    const index = slideDropIndex(p.index, Math.min(to, slides.length - 1), to >= slides.length);
    if (index !== null) void store.moveSlide(p.slide, index);
  };

  return (
    <nav
      aria-label={t("show.slides")}
      data-testid="slide-strip"
      className="relative shrink-0 border-b border-ui-border bg-ui-panel"
      style={{ height: STRIP_HEIGHT }}
    >
      <div
        ref={list}
        className="flex h-full items-center gap-2 overflow-x-auto overflow-y-hidden px-2 [scrollbar-width:none]"
        style={{ touchAction: "pan-x" }}
        data-testid="slide-strip-list"
      >
        {slides.map((slide, i) => {
          const selected = slide.id === current;
          return (
            <div
              key={slide.id}
              role="button"
              tabIndex={0}
              aria-label={t("show.slideN", { n: i + 1 })}
              aria-current={selected ? "true" : undefined}
              data-testid="thumbnail"
              data-hidden={slide.hidden ? "true" : undefined}
              className={`relative flex shrink-0 select-none flex-col items-center rounded p-0.5 ${selected ? "bg-ui-active ring-2 ring-orange-600" : ""} ${drag?.from === i ? "opacity-40" : ""}`}
              style={{ minWidth: 44, minHeight: 44, WebkitTouchCallout: "none" }}
              onClick={() => store.selectSlide(slide.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  store.selectSlide(slide.id);
                }
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                const p = press.current;
                // A long press with the finger still down: lifting opens the sheet, moving carries the slide.
                if (p && p.touch && p.slide === slide.id && !p.dragging) {
                  p.armed = true;
                  p.at = { x: e.clientX, y: e.clientY };
                  setDrag({ from: i, to: i, x: e.clientX });
                  return;
                }
                openMenu(slide.id, { x: e.clientX, y: e.clientY });
              }}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                press.current = { id: e.pointerId, slide: slide.id, index: i, x: e.clientX, y: e.clientY, touch: e.pointerType !== "mouse", armed: false, dragging: false, at: { x: e.clientX, y: e.clientY } };
              }}
              onPointerMove={(e) => {
                const p = press.current;
                if (!p || p.id !== e.pointerId) return;
                const far = Math.hypot(e.clientX - p.x, e.clientY - p.y) > DRAG_SLOP;
                if (!p.dragging && far && (p.armed || (!p.touch && e.buttons & 1))) {
                  p.dragging = true;
                  (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
                }
                if (p.dragging) setDrag({ from: p.index, to: stripDropIndex(edges(), e.clientX), x: e.clientX });
              }}
              onPointerUp={(e) => {
                const p = press.current;
                if (!p || p.id !== e.pointerId) return;
                if (p.dragging) drop(p, e.clientX);
                else if (p.armed) openMenu(p.slide, p.at);
                finish();
              }}
              onPointerCancel={finish}
            >
              <span className={`overflow-hidden rounded-sm border border-ui-border bg-white ${slide.hidden ? "opacity-40" : ""}`} style={{ width: thumbWidth, height: STRIP_THUMB_HEIGHT }}>
                <DeckThumb deck={deck} slide={slide} media={store.media} mediaVersion={mediaVersion} width={thumbWidth} />
              </span>
              <span className={`text-[10px] leading-3 text-ui-muted ${slide.hidden ? "line-through" : ""}`}>{i + 1}</span>
              {drag && drag.from !== null && drag.to === i && drag.to !== drag.from && drag.to !== drag.from + 1 && (
                <span data-testid="drop-indicator" className="pointer-events-none absolute -left-1.5 bottom-1 top-1 w-0.5 rounded bg-orange-600" />
              )}
              {drag && i === slides.length - 1 && drag.to === slides.length && drag.from !== slides.length - 1 && (
                <span data-testid="drop-indicator" className="pointer-events-none absolute -right-1.5 bottom-1 top-1 w-0.5 rounded bg-orange-600" />
              )}
            </div>
          );
        })}
      </div>
      <ContextMenu at={menu?.at ?? null} label={t("show.slideActions")} items={menu?.items ?? []} onClose={() => setMenu(null)} />
    </nav>
  );
}
