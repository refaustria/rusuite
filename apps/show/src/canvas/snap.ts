// Smart guides (PowerPoint-like): while a shape is dragged or resized its
// edges and centre lines snap to the slide's edges and centre lines and to
// the edges and centres of the other shapes, within a threshold of 6
// screen px; the matching lines are drawn as guides. Pure geometry in
// slide px (no Konva), so it is unit-testable.

import type { Rect } from "../geometry";

/** Snap threshold in screen px (divide by the stage scale for slide px). */
export const SNAP_PX = 6;

/** Candidate lines: x positions of vertical lines, y positions of horizontal lines. */
export interface SnapTargets {
  xs: number[];
  ys: number[];
}

/** Guides to draw: vertical lines at `v` (x), horizontal lines at `h` (y). */
export interface Guides {
  v: number[];
  h: number[];
}

export const NO_GUIDES: Guides = { v: [], h: [] };

const lines = (start: number, size: number) => [start, start + size / 2, start + size];

/** Slide edges and centre lines plus the edges and centres of `others` (slide px). */
export function snapTargets(slide: { width: number; height: number }, others: Rect[]): SnapTargets {
  const xs = [...lines(0, slide.width)];
  const ys = [...lines(0, slide.height)];
  for (const r of others) {
    xs.push(...lines(r.x, r.width));
    ys.push(...lines(r.y, r.height));
  }
  return { xs, ys };
}

/** The smallest move of one of `own` onto one of `targets` within `threshold` (0 if none). */
function bestDelta(own: number[], targets: number[], threshold: number): number | null {
  let best: number | null = null;
  for (const o of own) {
    for (const t of targets) {
      const d = t - o;
      if (Math.abs(d) <= threshold && (best === null || Math.abs(d) < Math.abs(best))) best = d;
    }
  }
  return best;
}

const EPS = 0.01;
/** Target lines that coincide with one of `own` (deduplicated, sorted). */
const hits = (own: number[], targets: number[]) =>
  [...new Set(targets.filter((t) => own.some((o) => Math.abs(o - t) < EPS)).map((t) => Math.round(t * 100) / 100))].sort((a, b) => a - b);

/**
 * Snaps a moved box: its left/centre/right edges to `t.xs` and
 * top/middle/bottom to `t.ys`. Returns the correction to add and the
 * guides of the snapped position.
 */
export function snapBox(box: Rect, t: SnapTargets, threshold: number): { dx: number; dy: number; guides: Guides } {
  const dx = bestDelta(lines(box.x, box.width), t.xs, threshold) ?? 0;
  const dy = bestDelta(lines(box.y, box.height), t.ys, threshold) ?? 0;
  return {
    dx,
    dy,
    guides: { v: hits(lines(box.x + dx, box.width), t.xs), h: hits(lines(box.y + dy, box.height), t.ys) },
  };
}

/** Snaps a dragged resize handle: `x` only when `axes.x`, `y` only when `axes.y`. */
export function snapPoint(
  p: { x: number; y: number },
  t: SnapTargets,
  threshold: number,
  axes: { x: boolean; y: boolean },
): { x: number; y: number; guides: Guides } {
  const dx = axes.x ? (bestDelta([p.x], t.xs, threshold) ?? 0) : 0;
  const dy = axes.y ? (bestDelta([p.y], t.ys, threshold) ?? 0) : 0;
  const x = p.x + dx;
  const y = p.y + dy;
  return { x, y, guides: { v: axes.x ? hits([x], t.xs) : [], h: axes.y ? hits([y], t.ys) : [] } };
}

/** Which axes a Transformer anchor moves (`top-left`, `middle-right`, …). */
export function anchorAxes(anchor: string | null | undefined): { x: boolean; y: boolean } {
  const a = anchor ?? "";
  return { x: /left|right/.test(a), y: /top|bottom/.test(a) };
}

/** Whether two guide sets are equal (to skip re-renders while dragging). */
export const sameGuides = (a: Guides, b: Guides): boolean =>
  a.v.length === b.v.length && a.h.length === b.h.length && a.v.every((v, i) => v === b.v[i]) && a.h.every((h, i) => h === b.h[i]);
