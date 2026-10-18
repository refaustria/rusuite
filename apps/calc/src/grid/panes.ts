// Frozen and split panes (pure): the cell area splits into up to four
// quadrants. One axis at a time; everything is in CSS px of the cell
// area (headers excluded).
//
// Frozen: the lines `origin..origin + frozen` (sheet px; `origin` is the
// frozen area's first line, Excel's `sheetView/@topLeftCell`, so a sheet
// frozen while scrolled keeps its position) are drawn at a fixed place;
// the rest scrolls, its first visible sheet offset being
// `origin + frozen + scroll`. Lines above `origin` cannot be reached.
//
// Split (View › Split): the first pane (`0..split` on the screen) shows
// the sheet from `scroll0` and scrolls on its own; the second one shows it
// from `scroll` (the grid's scroll bars).

import type { Viewport } from "./render";

/** One stretch of an axis: canvas offset `at`, length `size`, sheet offset of its start `scroll`. */
export interface Segment {
  at: number;
  size: number;
  scroll: number;
}

/** The extras of an axis beyond its frozen size and scroll. */
export interface AxisExtras {
  /** Sheet offset of the frozen area's first line (0: the sheet's first). */
  origin?: number;
  /** Split mode: the splitter's screen offset (0 = none; ignored when frozen). */
  split?: number;
  /** Split mode: the first pane's sheet offset. */
  scroll0?: number;
}

/** The fixed or first part and the scrolling part of an axis. */
export function axisSegments(frozen: number, scroll: number, size: number, x: AxisExtras = {}): Segment[] {
  const origin = x.origin ?? 0;
  if (frozen > 0) {
    const f = Math.min(frozen, size);
    const out: Segment[] = [{ at: 0, size: f, scroll: origin }];
    if (size - f > 0) out.push({ at: f, size: size - f, scroll: origin + frozen + scroll });
    return out;
  }
  const split = x.split ?? 0;
  if (split > 0 && split < size) {
    return [
      { at: 0, size: split, scroll: x.scroll0 ?? 0 },
      { at: split, size: size - split, scroll },
    ];
  }
  return [{ at: 0, size, scroll: origin + scroll }];
}

/** Screen (canvas) offset → sheet offset. */
export function axisToSheet(frozen: number, scroll: number, pos: number, x: AxisExtras = {}): number {
  const origin = x.origin ?? 0;
  if (frozen > 0) return pos < frozen ? origin + pos : origin + pos + scroll;
  const split = x.split ?? 0;
  if (split > 0) return pos < split ? (x.scroll0 ?? 0) + pos : scroll + (pos - split);
  return origin + pos + scroll;
}

/**
 * Sheet offset → canvas offset; `null` when it lies in the scrolling part
 * but scrolled under the frozen part (or above the frozen area). A
 * boundary at the frozen area's end is the frozen part's edge. Split:
 * the second (scrolling) pane wins when both show the offset.
 */
export function axisToScreen(frozen: number, scroll: number, sheet: number, x: AxisExtras = {}): number | null {
  const origin = x.origin ?? 0;
  const split = frozen > 0 ? 0 : (x.split ?? 0);
  if (split > 0) {
    const second = sheet - scroll + split;
    if (second >= split) return second;
    const first = sheet - (x.scroll0 ?? 0);
    return first >= 0 && first <= split ? first : null;
  }
  if (sheet < origin) return null;
  if (sheet <= origin + frozen && frozen > 0) return sheet - origin;
  const s = sheet - origin - scroll;
  return s < frozen ? null : s;
}

/**
 * The scroll that brings `start..end` (sheet offsets) into view, `null`
 * when it is visible already (or frozen, or above the frozen area).
 */
export function axisScrollTo(frozen: number, scroll: number, size: number, start: number, end: number, x: AxisExtras = {}): number | null {
  const origin = x.origin ?? 0;
  const split = frozen > 0 ? 0 : (x.split ?? 0);
  if (split > 0) {
    // Shown in the first pane: stay; otherwise the second pane scrolls (its top's sheet offset = scroll).
    const s0 = x.scroll0 ?? 0;
    if (start >= s0 && end <= s0 + split) return null;
    const room = size - split;
    if (start < scroll) return Math.max(0, start);
    if (end > scroll + room) return Math.max(0, end - start <= room ? end - room : start);
    return null;
  }
  if (start < origin) return null;
  const s = start - origin;
  const e = end - origin;
  if (frozen > 0 && e <= frozen) return null;
  if (s < frozen + scroll) return Math.max(0, s - frozen);
  if (e > scroll + size && e - s <= size - frozen) return Math.max(0, e - size);
  if (e > scroll + size) return Math.max(0, s - frozen);
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
  /** Sheet offsets of the frozen area's first column / row (`topLeftCell`; absent = 0). */
  originX?: number;
  originY?: number;
  /** View › Split: the splitters' screen offsets (absent / 0 = none). */
  splitX?: number;
  splitY?: number;
  /** View › Split: the sheet offsets of the left / top panes. */
  scrollX0?: number;
  scrollY0?: number;
}

/** The axis extras of a layout. */
export function extrasX(l: PaneLayout): AxisExtras {
  return { origin: l.originX ?? 0, split: l.splitX ?? 0, scroll0: l.scrollX0 ?? 0 };
}

export function extrasY(l: PaneLayout): AxisExtras {
  return { origin: l.originY ?? 0, split: l.splitY ?? 0, scroll0: l.scrollY0 ?? 0 };
}

/** A quadrant: drawn at `x`/`y` of the cell canvas, showing `vp` of the sheet. */
export interface Pane {
  x: number;
  y: number;
  vp: Viewport;
}

/** The quadrants, scrolling one first (frozen / first ones paint over it). */
export function panes(l: PaneLayout): Pane[] {
  const xs = axisSegments(l.frozenW, l.scrollX, l.width, extrasX(l));
  const ys = axisSegments(l.frozenH, l.scrollY, l.height, extrasY(l));
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
  return { x: axisToSheet(l.frozenW, l.scrollX, x, extrasX(l)), y: axisToSheet(l.frozenH, l.scrollY, y, extrasY(l)) };
}

/** Twips (1/20 pt) per CSS px at 96 dpi. */
export const TWIPS_PER_PX = 15;

/** Whether the layout is split (splitters shown, nothing frozen). */
export function isSplit(l: PaneLayout): boolean {
  return l.frozenW <= 0 && l.frozenH <= 0 && ((l.splitX ?? 0) > 0 || (l.splitY ?? 0) > 0);
}

/** The pane of a cell-area point in split mode per axis (`0` = left / top, `1` = right / bottom). */
export function splitPaneAt(l: PaneLayout, x: number, y: number): { col: 0 | 1; row: 0 | 1 } {
  const split = isSplit(l);
  const sx = split ? (l.splitX ?? 0) : 0;
  const sy = split ? (l.splitY ?? 0) : 0;
  return { col: sx > 0 && x < sx ? 0 : 1, row: sy > 0 && y < sy ? 0 : 1 };
}

/** A splitter under a cell-area point (within `slop` px), for dragging. */
export function splitterAt(l: PaneLayout, x: number, y: number, slop = 3): "x" | "y" | "both" | null {
  if (!isSplit(l)) return null;
  const sx = l.splitX ?? 0;
  const sy = l.splitY ?? 0;
  const onX = sx > 0 && Math.abs(x - sx) <= slop;
  const onY = sy > 0 && Math.abs(y - sy) <= slop;
  return onX && onY ? "both" : onX ? "x" : onY ? "y" : null;
}
