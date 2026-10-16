// Smart guides (PowerPoint-like): while a shape is dragged or resized its
// edges and centre lines snap to the slide's edges and centre lines and to
// the edges and centres of the other shapes, within a threshold of 4
// screen px; the matching lines are drawn as red dashed guides. Equal
// spacing (P8-28): a box dragged next to two shapes snaps to the gap
// between them (or into the middle of two), shown by gap marks. Pure
// geometry in slide px (no Konva), so it is unit-testable.

import type { Rect } from "../geometry";

/** Snap threshold in screen px (divide by the stage scale for slide px). */
export const SNAP_PX = 4;

/** Candidate lines: x positions of vertical lines, y positions of horizontal lines. */
export interface SnapTargets {
  xs: number[];
  ys: number[];
}

/** Guides to draw: vertical lines at `v` (x), horizontal lines at `h` (y), equal-gap marks. */
export interface Guides {
  v: number[];
  h: number[];
  spacing?: SpacingMark[];
}

/** Equal gaps found by `equalSpacing`: segments `[from, to]` along `axis`, drawn at `at` on the other axis. */
export interface SpacingMark {
  axis: "x" | "y";
  at: number;
  segments: [number, number][];
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
  a.v.length === b.v.length && a.h.length === b.h.length && a.v.every((v, i) => v === b.v[i]) && a.h.every((h, i) => h === b.h[i]) &&
  JSON.stringify(a.spacing ?? []) === JSON.stringify(b.spacing ?? []);

interface Span {
  start: number;
  end: number;
}

const spanOf = (r: Rect, axis: "x" | "y"): Span => (axis === "x" ? { start: r.x, end: r.x + r.width } : { start: r.y, end: r.y + r.height });
const overlaps = (a: Span, b: Span) => a.start < b.end && b.start < a.end;

/** Equal spacing along one axis: the best move of `box` (null = none) and its marks. */
function equalOnAxis(box: Rect, others: readonly Rect[], axis: "x" | "y", threshold: number): { d: number; mark: SpacingMark } | null {
  const cross = axis === "x" ? "y" : "x";
  const own = spanOf(box, axis);
  const size = own.end - own.start;
  const band = spanOf(box, cross);
  const row = others
    .filter((r) => overlaps(spanOf(r, cross), band))
    .map((r) => spanOf(r, axis))
    .sort((a, b) => a.start - b.start);
  const at = (band.start + band.end) / 2;
  let best: { d: number; segments: [number, number][] } | null = null;
  const consider = (start: number, segments: [number, number][]) => {
    const d = start - own.start;
    if (Math.abs(d) <= threshold && (best === null || Math.abs(d) < Math.abs(best.d))) best = { d, segments };
  };
  const centre = (own.start + own.end) / 2;
  const before = row.filter((r) => r.end <= centre);
  const after = row.filter((r) => r.start >= centre);
  const l = before.reduce<Span | null>((m, r) => (m === null || r.end > m.end ? r : m), null);
  const r = after.reduce<Span | null>((m, x) => (m === null || x.start < m.start ? x : m), null);
  // a chain: (l2, l, box) with gap(l2, l) = gap(l, box), and the mirror
  if (l) {
    const l2 = before.filter((x) => x !== l && x.end <= l.start).reduce<Span | null>((m, x) => (m === null || x.end > m.end ? x : m), null);
    if (l2) {
      const g = l.start - l2.end;
      consider(l.end + g, [[l2.end, l.start], [l.end, l.end + g]]);
    }
  }
  if (r) {
    const r2 = after.filter((x) => x !== r && x.start >= r.end).reduce<Span | null>((m, x) => (m === null || x.start < m.start ? x : m), null);
    if (r2) {
      const g = r2.start - r.end;
      consider(r.start - g - size, [[r.start - g, r.start], [r.end, r2.start]]);
    }
  }
  // in the middle of two
  if (l && r && r.start - l.end > size) {
    const start = (l.end + r.start - size) / 2;
    consider(start, [[l.end, start], [start + size, r.start]]);
  }
  const b = best as { d: number; segments: [number, number][] } | null;
  return b ? { d: b.d, mark: { axis, at, segments: b.segments.map(([a, c]) => [Math.round(a * 100) / 100, Math.round(c * 100) / 100]) } } : null;
}

/**
 * Equal spacing between three objects: moves `box` so its gap to the
 * neighbouring shape equals the gap between that shape and the next one
 * (or centres it between two), per axis, within `threshold`.
 */
export function equalSpacing(box: Rect, others: readonly Rect[], threshold: number): { dx: number; dy: number; marks: SpacingMark[] } {
  const x = equalOnAxis(box, others, "x", threshold);
  const y = equalOnAxis(box, others, "y", threshold);
  return { dx: x?.d ?? 0, dy: y?.d ?? 0, marks: [x?.mark, y?.mark].filter((m): m is SpacingMark => !!m) };
}
