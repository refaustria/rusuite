// Slide-show tools (P8-28), pure parts: the pointer options (arrow, laser
// pointer, pen, highlighter, eraser) with PowerPoint's keys, session-only
// ink per slide (never saved), erasing strokes under the pointer, the
// zoom into the slide (+ / −, kept under the pointer) and the "See all
// slides" grid. The rendering is in `ShowTools.tsx`.

export type PointerMode = "arrow" | "laser" | "pen" | "highlighter" | "eraser";

export interface InkStroke {
  mode: "pen" | "highlighter";
  color: string;
  /** Points in slide px. */
  points: { x: number; y: number }[];
}

/** Ink of the show: strokes per slide id. */
export type Ink = ReadonlyMap<number, readonly InkStroke[]>;

export const PEN_COLORS = ["#e81123", "#0063b1", "#107c10", "#ffb900", "#000000", "#ffffff"] as const;
export const DEFAULT_PEN = PEN_COLORS[0];
export const DEFAULT_HIGHLIGHTER = PEN_COLORS[3];

export type ToolAction =
  | { type: "mode"; mode: PointerMode }
  | { type: "eraseAll" }
  | { type: "toggleInk" }
  | { type: "seeAll" }
  | { type: "zoom"; dir: 1 | -1 };

export interface KeyLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

/**
 * The tool action of a key in the show (`null` = a navigation key or
 * nothing): Ctrl+L laser, Ctrl+P pen, Ctrl+I highlighter, Ctrl+E eraser,
 * Ctrl+A arrow, Ctrl+M show / hide ink, E erase all ink of the slide,
 * G "See all slides", + / − zoom (− at 100 %: see all slides).
 */
export function toolKey(e: KeyLike, zoomed: boolean): ToolAction | null {
  if (e.altKey) return null;
  const mod = !!(e.ctrlKey || e.metaKey);
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (mod) {
    switch (k) {
      case "l": return { type: "mode", mode: "laser" };
      case "p": return { type: "mode", mode: "pen" };
      case "i": return { type: "mode", mode: "highlighter" };
      case "e": return { type: "mode", mode: "eraser" };
      case "a": return { type: "mode", mode: "arrow" };
      case "m": return { type: "toggleInk" };
      default: return null;
    }
  }
  switch (k) {
    case "e": return { type: "eraseAll" };
    case "g": return { type: "seeAll" };
    case "+":
    case "=": return { type: "zoom", dir: 1 };
    case "-": return zoomed ? { type: "zoom", dir: -1 } : { type: "seeAll" };
    default: return null;
  }
}

/** Zoom levels of the magnifier. */
export const ZOOM_LEVELS = [1, 1.5, 2, 3, 4] as const;

/** The next zoom level in `dir`. */
export function zoomStep(zoom: number, dir: 1 | -1): number {
  const i = ZOOM_LEVELS.findIndex((z) => Math.abs(z - zoom) < 1e-6);
  const at = i < 0 ? 0 : i;
  return ZOOM_LEVELS[Math.max(0, Math.min(ZOOM_LEVELS.length - 1, at + dir))]!;
}

/**
 * The translation of a slide zoomed by `zoom` about `p` (screen px inside
 * a `w` × `h` area) so `p` stays put, clamped so the slide covers the area.
 */
export function zoomOffset(p: { x: number; y: number }, zoom: number, w: number, h: number): { x: number; y: number } {
  const clamp = (v: number, size: number) => Math.min(0, Math.max(size - size * zoom, v)) || 0;
  return { x: clamp(p.x * (1 - zoom), w), y: clamp(p.y * (1 - zoom), h) };
}

const dist2 = (a: { x: number; y: number }, b: { x: number; y: number }) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

/** Distance² from `p` to segment `a`–`b`. */
function segDist2(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const l = dist2(a, b);
  if (l === 0) return dist2(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l));
  return dist2(p, { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
}

/** Strokes left after the eraser touched `p` (every stroke passing within `radius` goes). */
export function eraseAt(strokes: readonly InkStroke[], p: { x: number; y: number }, radius: number): InkStroke[] {
  const r2 = radius * radius;
  return strokes.filter((s) => {
    if (s.points.length === 1) return dist2(p, s.points[0]!) > r2;
    for (let i = 1; i < s.points.length; i++) if (segDist2(p, s.points[i - 1]!, s.points[i]!) <= r2) return false;
    return true;
  });
}

/** `ink` with `strokes` for slide `id` (empty lists removed). */
export function withStrokes(ink: Ink, id: number, strokes: readonly InkStroke[]): Ink {
  const next = new Map(ink);
  if (strokes.length) next.set(id, strokes);
  else next.delete(id);
  return next;
}

/** Columns of the "See all slides" grid for `n` slides in a `width` px wide screen (thumbnails ≥ 160 px). */
export function seeAllColumns(n: number, width: number): number {
  const max = Math.max(1, Math.floor(width / 200));
  return Math.max(1, Math.min(max, Math.ceil(Math.sqrt(n * 1.6))));
}

/** A point as an SVG polyline `points` string. */
export const svgPoints = (pts: readonly { x: number; y: number }[]): string => pts.map((p) => `${Math.round(p.x * 10) / 10},${Math.round(p.y * 10) / 10}`).join(" ");

// ----- Keep ink annotations (P9-S5) -----------------------------------------------------------

/** Outline widths of kept ink in slide px (as drawn by `InkLayer`). */
export const INK_WIDTH = { pen: 3, highlighter: 14 } as const;

/** One kept stroke as a freeform: its box and path in slide EMU (`emuPerPx`), the path in the box's own coordinates. */
export interface InkFreeform {
  highlighter: boolean;
  /** `RRGGBB`. */
  color: string;
  /** Outline width (EMU). */
  width: number;
  box: { x: number; y: number; w: number; h: number };
  /** Polyline points relative to `box` (EMU). */
  points: { x: number; y: number }[];
}

/**
 * The freeforms of a slide's ink when "Keep ink annotations" is chosen:
 * every stroke a polyline (points closer than half a pixel dropped, a dot
 * a tiny stroke) in its bounding box. Pen strokes
 * go on top of the slide, highlighter strokes below its shapes (the
 * model's outlines have no transparency, so they mark text from behind).
 */
export function inkFreeforms(strokes: readonly InkStroke[], emuPerPx: number): InkFreeform[] {
  return strokes.flatMap((s) => {
    const pts: { x: number; y: number }[] = [];
    for (const p of s.points) {
      const last = pts[pts.length - 1];
      if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= 0.5) pts.push(p);
    }
    if (pts.length === 0) return [];
    if (pts.length === 1) pts.push({ x: pts[0]!.x + 0.5, y: pts[0]!.y });
    const e = pts.map((p) => ({ x: Math.round(p.x * emuPerPx), y: Math.round(p.y * emuPerPx) }));
    const x0 = Math.min(...e.map((p) => p.x));
    const y0 = Math.min(...e.map((p) => p.y));
    const x1 = Math.max(...e.map((p) => p.x));
    const y1 = Math.max(...e.map((p) => p.y));
    const highlighter = s.mode === "highlighter";
    const width = Math.round(INK_WIDTH[s.mode] * emuPerPx);
    return [{
      highlighter,
      color: s.color.replace(/^#/, "").toUpperCase(),
      width,
      box: { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) },
      points: e.map((p) => ({ x: p.x - x0, y: p.y - y0 })),
    }];
  });
}
