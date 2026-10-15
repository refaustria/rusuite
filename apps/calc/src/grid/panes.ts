// Frozen panes (pure): the cell area splits into up to four quadrants.
// Frozen rows/columns (sheet offsets `0..frozen`) are drawn at fixed
// positions; the rest scrolls, its first visible sheet offset being
// `frozen + scroll`. One axis at a time: everything here is in CSS px of
// the cell area (headers excluded).

import type { Viewport } from "./render";

/** One stretch of an axis: canvas offset `at`, length `size`, sheet offset of its start `scroll`. */
export interface Segment {
  at: number;
  size: number;
  scroll: number;
}

/** The fixed part (`0..frozen` px, cut to `size`) and the scrolling part of an axis. */
export function axisSegments(frozen: number, scroll: number, size: number): Segment[] {
  if (frozen <= 0) return [{ at: 0, size, scroll }];
  const f = Math.min(frozen, size);
  const out: Segment[] = [{ at: 0, size: f, scroll: 0 }];
  if (size - f > 0) out.push({ at: f, size: size - f, scroll: frozen + scroll });
  return out;
}

/** Screen (canvas) offset → sheet offset. */
export function axisToSheet(frozen: number, scroll: number, pos: number): number {
  return frozen > 0 && pos < frozen ? pos : pos + scroll;
}

/**
 * Sheet offset → canvas offset; `null` when it lies in the scrolling part
 * but scrolled under the frozen part. A boundary at `frozen` itself is
 * the frozen part's edge.
 */
export function axisToScreen(frozen: number, scroll: number, sheet: number): number | null {
  if (sheet <= frozen) return sheet;
  const s = sheet - scroll;
  return s < frozen ? null : s;
}

/**
 * The scroll that brings `start..end` (sheet offsets) into view, `null`
 * when it is visible already (or frozen).
 */
export function axisScrollTo(frozen: number, scroll: number, size: number, start: number, end: number): number | null {
  if (frozen > 0 && end <= frozen) return null;
  if (start < frozen + scroll) return Math.max(0, start - frozen);
  if (end > scroll + size && end - start <= size - frozen) return Math.max(0, end - size);
  if (end > scroll + size) return Math.max(0, start - frozen);
  return null;
}

/** The split of the cell area. */
export interface PaneLayout {
  /** Frozen width / height, px (0 = nothing frozen). */
  frozenW: number;
  frozenH: number;
  /** Scroll offsets of the scrolling part. */
  scrollX: number;
  scrollY: number;
  /** Cell area size. */
  width: number;
  height: number;
}

/** A quadrant: drawn at `x`/`y` of the cell canvas, showing `vp` of the sheet. */
export interface Pane {
  x: number;
  y: number;
  vp: Viewport;
}

/** The quadrants, scrolling one first (frozen ones paint over it). */
export function panes(l: PaneLayout): Pane[] {
  const xs = axisSegments(l.frozenW, l.scrollX, l.width);
  const ys = axisSegments(l.frozenH, l.scrollY, l.height);
  const out: Pane[] = [];
  for (const y of ys) {
    for (const x of xs) {
      if (x.size <= 0 || y.size <= 0) continue;
      out.push({ x: x.at, y: y.at, vp: { scrollX: x.scroll, scrollY: y.scroll, width: x.size, height: y.size } });
    }
  }
  return out.reverse();
}

/** The scrolling quadrant (Page Up/Down, prefetching): the bottom-right one. */
export function mainPane(l: PaneLayout): Pane {
  return panes(l)[0] ?? { x: 0, y: 0, vp: { scrollX: l.scrollX, scrollY: l.scrollY, width: 0, height: 0 } };
}

/** Cell-area point → sheet offsets. */
export function toSheet(l: PaneLayout, x: number, y: number): { x: number; y: number } {
  return { x: axisToSheet(l.frozenW, l.scrollX, x), y: axisToSheet(l.frozenH, l.scrollY, y) };
}
