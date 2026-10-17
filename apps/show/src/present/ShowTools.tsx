// Slide-show tools on the full-window show (P8-28): pointer options –
// laser pointer (Ctrl+L, a red dot following the pointer), pen (Ctrl+P)
// and highlighter (Ctrl+I) in a colour, eraser (Ctrl+E; E erases all ink
// of the slide), arrow (Ctrl+A) –, ink kept for the session only, "See
// all slides" (G or −) and the magnifier (+ / −, about the pointer; Esc
// zooms out). A small tool bar appears in the lower left on pointer
// movement (pointer events, 32 px buttons). Pure parts: `tools.ts`.
// The presenter view (P9-S5) shares one tools state with the audience
// window: ink, laser pointer and zoom are drawn on both (`readOnly` there).

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { Slide } from "../generated/Slide";
import type { DeckContext } from "../canvas/SlideView";
import { fitScale, slidePx } from "../geometry";
import { DeckThumb } from "../ui/Thumbs";
import { useT } from "../i18n";
import {
  DEFAULT_HIGHLIGHTER, DEFAULT_PEN, PEN_COLORS, eraseAt, seeAllColumns, svgPoints, toolKey, withStrokes, zoomOffset, zoomStep,
  type Ink, type InkStroke, type PointerMode,
} from "./tools";

export interface ToolsState {
  mode: PointerMode;
  penColor: string;
  ink: Ink;
  inkVisible: boolean;
  seeAll: boolean;
  zoom: number;
  /** Zoom centre as a fraction (0–1) of the show area's width and height (the same on every screen). */
  focus: { x: number; y: number };
  /** The laser pointer (slide px; `null` = off the slide). */
  laser: { x: number; y: number } | null;
}

export const INITIAL_TOOLS: ToolsState = { mode: "arrow", penColor: DEFAULT_PEN, ink: new Map(), inkVisible: true, seeAll: false, zoom: 1, focus: { x: 0.5, y: 0.5 }, laser: null };

/** The tools' state with a setter whose updater runs at once (keys decide synchronously whether they were handled). */
export function useTools(penColor?: string): [ToolsState, (f: (s: ToolsState) => ToolsState) => void] {
  // Set Up Slide Show › Pen color
  const [tools, setState] = useState(() => (penColor ? { ...INITIAL_TOOLS, penColor } : INITIAL_TOOLS));
  const ref = useRef(tools);
  const set = useCallback((f: (s: ToolsState) => ToolsState) => {
    const next = f(ref.current);
    if (next === ref.current) return;
    ref.current = next;
    setState(next);
  }, []);
  return [tools, set];
}

/** Whether the tools take the pointer (a click must not advance the show). */
export const toolsCapture = (s: ToolsState): boolean => s.seeAll || s.zoom > 1 || s.mode === "pen" || s.mode === "highlighter" || s.mode === "eraser";

/** Whether a key event comes from a text field (the presenter view's notes): no show or tool keys there. */
export const typingIn = (e: KeyboardEvent): boolean => {
  const el = e.target as HTMLElement | null;
  return !!el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT" || el.tagName === "SELECT" || el.isContentEditable);
};

/** The tools' keys on `window` (capture phase, before the show's navigation keys); `pointer` as fractions of the show area. */
export function useToolKeys(setTools: (f: (s: ToolsState) => ToolsState) => void, slideId: number | undefined, pointer: React.MutableRefObject<{ x: number; y: number }>, enabled = true) {
  const idRef = useRef(slideId);
  idRef.current = slideId;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (typingIn(e)) return;
      let handled = true;
      setTools((s) => {
        if (e.key === "Escape" && (s.seeAll || s.zoom > 1 || s.mode !== "arrow")) {
          return s.seeAll ? { ...s, seeAll: false } : s.zoom > 1 ? { ...s, zoom: 1 } : { ...s, mode: "arrow" };
        }
        const a = toolKey(e, s.zoom > 1);
        if (!a) {
          handled = false;
          return s;
        }
        switch (a.type) {
          case "mode": return { ...s, mode: s.mode === a.mode && a.mode !== "arrow" ? "arrow" : a.mode, penColor: a.mode === "highlighter" ? DEFAULT_HIGHLIGHTER : a.mode === "pen" && s.penColor === DEFAULT_HIGHLIGHTER ? DEFAULT_PEN : s.penColor };
          case "eraseAll": return idRef.current === undefined ? s : { ...s, ink: withStrokes(s.ink, idRef.current, []) };
          case "toggleInk": return { ...s, inkVisible: !s.inkVisible };
          case "seeAll": return { ...s, seeAll: !s.seeAll, zoom: 1 };
          case "zoom": {
            const zoom = zoomStep(s.zoom, a.dir);
            return { ...s, zoom, focus: zoom > 1 && s.zoom === 1 ? { ...pointer.current } : s.focus };
          }
        }
      });
      // `useTools`' updater runs synchronously
      if (handled) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [enabled, setTools, pointer]);
}

/**
 * Ink, laser pointer and eraser over the slide (`box`: the slide's screen
 * rectangle inside the show area). `readOnly`: only shows them (the
 * audience window of the presenter view).
 */
export function InkLayer({ tools, setTools, slide, box, scale, readOnly = false }: {
  tools: ToolsState;
  setTools: (f: (s: ToolsState) => ToolsState) => void;
  slide: Slide;
  box: { x: number; y: number; width: number; height: number };
  scale: number;
  readOnly?: boolean;
}) {
  const [drawing, setDrawing] = useState<InkStroke | null>(null);
  const laser = tools.mode === "laser" ? tools.laser : null;
  const setLaser = (p: { x: number; y: number } | null) => setTools((s) => (s.laser === p || (s.laser && p && s.laser.x === p.x && s.laser.y === p.y) ? s : { ...s, laser: p }));
  const strokes = tools.ink.get(slide.id) ?? [];
  const toSlide = (e: React.PointerEvent) => {
    const r = (e.currentTarget as Element).getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  };
  const capture = !readOnly && (tools.mode === "pen" || tools.mode === "highlighter" || tools.mode === "eraser");
  const erase = (p: { x: number; y: number }) => setTools((s) => ({ ...s, ink: withStrokes(s.ink, slide.id, eraseAt(s.ink.get(slide.id) ?? [], p, 10 / scale)) }));
  return (
    <svg
      data-testid="ink-layer"
      data-strokes={strokes.length}
      data-mode={tools.mode}
      className="absolute"
      style={{ zIndex: 5, left: box.x, top: box.y, width: box.width, height: box.height, pointerEvents: capture || (tools.mode === "laser" && !readOnly) ? "auto" : "none", cursor: capture ? "crosshair" : tools.mode === "laser" ? "none" : undefined, touchAction: "none" }}
      viewBox={`0 0 ${box.width / scale} ${box.height / scale}`}
      onPointerDown={(e) => {
        if (!capture || e.button !== 0) return;
        e.stopPropagation();
        (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
        const p = toSlide(e);
        if (tools.mode === "eraser") erase(p);
        else setDrawing({ mode: tools.mode === "highlighter" ? "highlighter" : "pen", color: tools.penColor, points: [p] });
      }}
      onPointerMove={(e) => {
        if (readOnly) return;
        const p = toSlide(e);
        if (tools.mode === "laser") setLaser({ x: Math.round(p.x), y: Math.round(p.y) });
        if (!capture || !(e.buttons & 1)) return;
        if (tools.mode === "eraser") erase(p);
        else if (drawing) setDrawing({ ...drawing, points: [...drawing.points, p] });
      }}
      onPointerUp={(e) => {
        if (!capture) return;
        e.stopPropagation();
        const d = drawing;
        setDrawing(null);
        if (d) setTools((s) => ({ ...s, ink: withStrokes(s.ink, slide.id, [...(s.ink.get(slide.id) ?? []), d]) }));
      }}
      onPointerLeave={() => !readOnly && tools.mode === "laser" && setLaser(null)}
      onClick={(e) => capture && e.stopPropagation()}
    >
      {tools.inkVisible &&
        [...strokes, ...(drawing ? [drawing] : [])].map((s, i) => (
          <polyline
            key={i}
            points={svgPoints(s.points)}
            fill="none"
            stroke={s.color}
            strokeWidth={s.mode === "highlighter" ? 14 : 3}
            strokeOpacity={s.mode === "highlighter" ? 0.45 : 1}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      {tools.mode === "laser" && laser && (
        <circle data-testid="laser" cx={laser.x} cy={laser.y} r={7} fill="#ff1a1a" stroke="#ffb3b3" strokeWidth={2} style={{ filter: "drop-shadow(0 0 6px #ff3030)" }} />
      )}
    </svg>
  );
}

/** "See all slides": every slide of the show as a thumbnail; a click goes there. */
export function SeeAll({ deck, slides, media, current, width, onPick }: { deck: DeckContext; slides: Slide[]; media: ReadonlyMap<number, string>; current: number; width: number; onPick: (i: number) => void }) {
  const t = useT();
  const cols = seeAllColumns(slides.length, width);
  const thumb = Math.floor((width - 64 - (cols - 1) * 16) / cols);
  return (
    <div
      role="dialog"
      aria-label={t("show.tools.seeAll")}
      data-testid="see-all"
      className="absolute inset-0 z-10 overflow-auto bg-neutral-900/95 p-8"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${cols}, ${thumb}px)` }}>
        {slides.map((s, i) => (
          <button
            key={s.id}
            type="button"
            aria-label={t("show.slideN", { n: i + 1 })}
            className={`flex flex-col items-start gap-1 rounded p-1 text-left text-xs text-white/80 ${i === current ? "outline outline-2 outline-orange-500" : "hover:bg-white/10"}`}
            onClick={() => onPick(i)}
          >
            <DeckThumb deck={deck} slide={s} media={media} width={thumb - 8} />
            {i + 1}
          </button>
        ))}
      </div>
    </div>
  );
}

const TB = "flex h-8 w-8 items-center justify-center rounded-full bg-black/40 text-white/80 hover:bg-black/70 hover:text-white";

/** The tool bar in the lower left (shown while the pointer moves); `inline`: always shown, in the flow, without Previous / Next (the presenter view has its own). */
export function ToolBar({ tools, setTools, onPrev, onNext, visible, extra, inline = false }: {
  tools: ToolsState;
  setTools: (f: (s: ToolsState) => ToolsState) => void;
  onPrev: () => void;
  onNext: () => void;
  visible: boolean;
  extra?: ReactNode;
  inline?: boolean;
}) {
  const t = useT();
  const [menu, setMenu] = useState(false);
  const pick = (mode: PointerMode, penColor?: string) => setTools((s) => ({ ...s, mode, penColor: penColor ?? (mode === "highlighter" ? DEFAULT_HIGHLIGHTER : s.penColor) }));
  const item = (label: string, onClick: () => void, checked?: boolean) => (
    <button type="button" role="menuitemradio" aria-checked={!!checked} className="flex h-8 w-full items-center gap-2 px-3 text-left text-xs hover:bg-white/15" onClick={() => { onClick(); setMenu(false); }}>
      <span className="w-3">{checked ? "•" : ""}</span>
      {label}
    </button>
  );
  return (
    <div
      data-testid="show-toolbar"
      className={inline ? "relative z-20 flex items-center gap-1" : `absolute bottom-3 left-3 z-20 flex items-center gap-1 transition-opacity ${visible || menu ? "opacity-100" : "pointer-events-none opacity-0"}`}
      onClick={(e) => e.stopPropagation()}
    >
      {!inline && <button type="button" className={TB} aria-label={t("show.reading.previous")} title={t("show.reading.previous")} onClick={onPrev}>◀</button>}
      {!inline && <button type="button" className={TB} aria-label={t("show.reading.next")} title={t("show.reading.next")} onClick={onNext}>▶</button>}
      <div className="relative">
        <button type="button" className={TB} aria-label={t("show.tools.pointer")} title={t("show.tools.pointer")} aria-haspopup="menu" aria-expanded={menu} data-testid="pointer-options" onClick={() => setMenu((m) => !m)}>
          ✎
        </button>
        {menu && (
          <div role="menu" aria-label={t("show.tools.pointer")} className="absolute bottom-full left-0 mb-1 w-56 rounded bg-neutral-800 py-1 text-white shadow-lg">
            {item(t("show.tools.laser"), () => pick("laser"), tools.mode === "laser")}
            {item(t("show.tools.pen"), () => pick("pen", tools.penColor === DEFAULT_HIGHLIGHTER ? DEFAULT_PEN : tools.penColor), tools.mode === "pen")}
            {item(t("show.tools.highlighter"), () => pick("highlighter"), tools.mode === "highlighter")}
            {item(t("show.tools.eraser"), () => pick("eraser"), tools.mode === "eraser")}
            {item(t("show.tools.arrow"), () => pick("arrow"), tools.mode === "arrow")}
            <div className="flex gap-1 px-3 py-1" role="group" aria-label={t("show.tools.inkColor")}>
              {PEN_COLORS.map((c) => (
                <button key={c} type="button" aria-label={c} className={`h-8 w-8 rounded-full border ${tools.penColor === c ? "border-white" : "border-white/20"}`} style={{ background: c }} onClick={() => { setTools((s) => ({ ...s, penColor: c, mode: s.mode === "highlighter" ? "highlighter" : "pen" })); setMenu(false); }} />
              ))}
            </div>
            {item(t("show.tools.eraseAll"), () => setTools((s) => ({ ...s, ink: new Map() })))}
            {item(tools.inkVisible ? t("show.tools.hideInk") : t("show.tools.showInk"), () => setTools((s) => ({ ...s, inkVisible: !s.inkVisible })))}
          </div>
        )}
      </div>
      <button type="button" className={TB} aria-label={t("show.tools.seeAll")} title={t("show.tools.seeAll")} data-testid="see-all-button" onClick={() => setTools((s) => ({ ...s, seeAll: !s.seeAll, zoom: 1 }))}>▦</button>
      <button type="button" className={TB} aria-label={t("show.tools.zoomIn")} title={t("show.tools.zoomIn")} onClick={() => setTools((s) => ({ ...s, zoom: zoomStep(s.zoom, 1), focus: s.zoom === 1 ? { x: 0.5, y: 0.5 } : s.focus }))}>＋</button>
      {tools.zoom > 1 && <button type="button" className={TB} aria-label={t("show.tools.zoomOut")} title={t("show.tools.zoomOut")} onClick={() => setTools((s) => ({ ...s, zoom: zoomStep(s.zoom, -1) }))}>－</button>}
      {extra}
    </div>
  );
}

/** The CSS transform of the zoomed show area. */
export function zoomTransform(tools: ToolsState, width: number, height: number): string | undefined {
  if (tools.zoom <= 1) return undefined;
  const o = zoomOffset({ x: tools.focus.x * width, y: tools.focus.y * height }, tools.zoom, width, height);
  return `translate(${o.x}px, ${o.y}px) scale(${tools.zoom})`;
}

/** The slide's rectangle in a `width` × `height` show area. */
export function slideBox(deck: DeckContext, width: number, height: number): { x: number; y: number; width: number; height: number; scale: number } {
  const scale = fitScale(width, height, deck.slideSize);
  const px = slidePx(deck.slideSize);
  const w = px.width * scale;
  const h = px.height * scale;
  return { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h, scale };
}
