// Insert › Shapes › Lines › Freeform: Shape and Scribble (P9-S2): the
// drawing tool as a pure state machine and the custom geometry it makes.
//
// Freeform: Shape (PowerPoint): each click adds a corner joined to the
// previous one by a straight segment; dragging with the button down draws
// freehand (smoothed into curves); a click on the start point closes the
// shape, a double-click (or Enter / Esc) ends it open. Scribble: one drag
// draws a freehand line; releasing ends it (closed when it ends on its
// start). The result is a `Preset::Custom` geometry (`a:custGeom`) whose
// path has the shape's own box as its coordinate space.

import type { GeomPath } from "../generated/GeomPath";
import type { PathCmd } from "../generated/PathCmd";
import type { Transform } from "../generated/Transform";
import { dist, type Pt } from "./geom";

export type FreehandMode = "freeform" | "scribble";

/** A drawn point: a corner (click) or a point of a freehand stretch (drag). */
export interface DrawnPoint extends Pt {
  free: boolean;
}

export interface FreeformState {
  mode: FreehandMode;
  points: DrawnPoint[];
  /** The button is down (a drag adds freehand points). */
  down: boolean;
  /** The button went down at this point (a drag starts when it moves away). */
  downAt: Pt | null;
  /** The current drag has drawn freehand points. */
  dragged: boolean;
  /** The pointer (the rubber band of the next straight segment). */
  cursor: Pt | null;
  /** Finished: closed or open. */
  done: null | { closed: boolean };
}

/** Tolerances in EMU: `snap` closes on the start point, `step` spaces freehand points. */
export interface FreeformTol {
  snap: number;
  step: number;
}

/** A fresh tool (nothing drawn yet). */
export const startFreeform = (mode: FreehandMode): FreeformState => ({ mode, points: [], down: false, downAt: null, dragged: false, cursor: null, done: null });

const near = (a: Pt, b: Pt, tol: number) => dist(a, b) <= tol;

/** Button down at `p`. */
export function freeformDown(s: FreeformState, p: Pt): FreeformState {
  if (s.done) return s;
  const points = s.points.length === 0 ? [{ x: p.x, y: p.y, free: false }] : s.points;
  return { ...s, points, down: true, downAt: p, dragged: false, cursor: p };
}

/** The pointer moved to `p` (with the button down: freehand). */
export function freeformMove(s: FreeformState, p: Pt, tol: FreeformTol): FreeformState {
  if (s.done) return s;
  if (!s.down) return { ...s, cursor: p };
  const last = s.points[s.points.length - 1];
  if (!last || dist(last, p) < tol.step) return { ...s, cursor: p };
  // the first freehand point after a corner keeps the corner a corner
  return { ...s, points: [...s.points, { x: p.x, y: p.y, free: true }], dragged: true, cursor: p };
}

/** Button up at `p`. */
export function freeformUp(s: FreeformState, p: Pt, tol: FreeformTol): FreeformState {
  if (s.done || !s.down) return s;
  const first = s.points[0]!;
  const up = { ...s, down: false, downAt: null, cursor: p };
  if (s.mode === "scribble") {
    if (!s.dragged) return startFreeform(s.mode); // a click without drawing draws nothing
    const closed = s.points.length >= 3 && near(s.points[s.points.length - 1]!, first, tol.snap);
    return { ...up, done: { closed } };
  }
  if (s.dragged) return { ...up, dragged: false };
  // a click: on the start point closes the shape, elsewhere adds a corner
  if (s.points.length >= 3 && near(p, first, tol.snap)) return { ...up, done: { closed: true } };
  const last = s.points[s.points.length - 1]!;
  if (near(p, last, tol.step / 4)) return up;
  return { ...up, points: [...s.points, { x: p.x, y: p.y, free: false }] };
}

/** Double-click, Enter or Esc: the shape ends open (closed when it already ends on its start). */
export function freeformFinish(s: FreeformState, tol: FreeformTol): FreeformState {
  if (s.done) return s;
  // the double-click's clicks added the last corner (twice): keep it once
  const pts = s.points.filter((p, i) => i === 0 || !near(p, s.points[i - 1]!, tol.step / 4));
  if (pts.length < 2) return { ...startFreeform(s.mode), done: null };
  const closed = pts.length >= 3 && near(pts[pts.length - 1]!, pts[0]!, tol.snap);
  return { ...s, points: closed ? pts.slice(0, -1) : pts, down: false, done: { closed } };
}

/** Ramer–Douglas–Peucker: the points of a polyline that keep it within `tol`. */
export function simplify(points: Pt[], tol: number): Pt[] {
  if (points.length <= 2) return points.slice();
  const a = points[0]!;
  const b = points[points.length - 1]!;
  let worst = 0;
  let at = 0;
  const len = dist(a, b);
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i]!;
    const d = len === 0 ? dist(p, a) : Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / len;
    if (d > worst) {
      worst = d;
      at = i;
    }
  }
  if (worst <= tol) return [a, b];
  return [...simplify(points.slice(0, at + 1), tol).slice(0, -1), ...simplify(points.slice(at), tol)];
}

/**
 * The path commands of drawn points (slide EMU): corners joined by lines,
 * freehand stretches simplified (`tol`) and smoothed into cubic Béziers
 * (Catmull–Rom through the kept points).
 */
export function freeformCommands(points: DrawnPoint[], closed: boolean, tol: number): PathCmd[] {
  if (points.length === 0) return [];
  const out: PathCmd[] = [{ kind: "moveTo", x: points[0]!.x, y: points[0]!.y }];
  let i = 1;
  while (i < points.length) {
    if (!points[i]!.free) {
      out.push({ kind: "lineTo", x: points[i]!.x, y: points[i]!.y });
      i++;
      continue;
    }
    // a freehand stretch from the previous point through the free ones
    let j = i;
    while (j < points.length && points[j]!.free) j++;
    const run = simplify(points.slice(i - 1, j), tol);
    for (let k = 1; k < run.length; k++) {
      const p0 = run[k - 2] ?? run[k - 1]!;
      const p1 = run[k - 1]!;
      const p2 = run[k]!;
      const p3 = run[k + 1] ?? p2;
      out.push({ kind: "cubicTo", x1: p1.x + (p2.x - p0.x) / 6, y1: p1.y + (p2.y - p0.y) / 6, x2: p2.x - (p3.x - p1.x) / 6, y2: p2.y - (p3.y - p1.y) / 6, x: p2.x, y: p2.y });
    }
    i = j;
  }
  if (closed) out.push({ kind: "close" });
  return out;
}

/** Every coordinate of a command list (end and control points). */
function coords(cmds: PathCmd[]): Pt[] {
  const out: Pt[] = [];
  for (const c of cmds) {
    if (c.kind === "moveTo" || c.kind === "lineTo") out.push({ x: c.x, y: c.y });
    else if (c.kind === "quadTo") out.push({ x: c.x1, y: c.y1 }, { x: c.x, y: c.y });
    else if (c.kind === "cubicTo") out.push({ x: c.x1, y: c.y1 }, { x: c.x2, y: c.y2 }, { x: c.x, y: c.y });
  }
  return out;
}

/** Commands moved by `-dx`, `-dy` (into a box whose corner is at `dx`, `dy`), rounded to whole EMU. */
export function shiftCommands(cmds: PathCmd[], dx: number, dy: number): PathCmd[] {
  const r = Math.round;
  return cmds.map((c): PathCmd => {
    switch (c.kind) {
      case "moveTo":
      case "lineTo":
        return { ...c, x: r(c.x - dx), y: r(c.y - dy) };
      case "quadTo":
        return { ...c, x1: r(c.x1 - dx), y1: r(c.y1 - dy), x: r(c.x - dx), y: r(c.y - dy) };
      case "cubicTo":
        return { ...c, x1: r(c.x1 - dx), y1: r(c.y1 - dy), x2: r(c.x2 - dx), y2: r(c.y2 - dy), x: r(c.x - dx), y: r(c.y - dy) };
      default:
        return c;
    }
  });
}

/** The bounding box of commands (control points included; at least 1 EMU each way). */
export function commandsBox(cmds: PathCmd[]): { x: number; y: number; w: number; h: number } {
  const pts = coords(cmds);
  if (!pts.length) return { x: 0, y: 0, w: 1, h: 1 };
  const x0 = Math.min(...pts.map((p) => p.x));
  const y0 = Math.min(...pts.map((p) => p.y));
  const x1 = Math.max(...pts.map((p) => p.x));
  const y1 = Math.max(...pts.map((p) => p.y));
  return { x: Math.floor(x0), y: Math.floor(y0), w: Math.max(1, Math.ceil(x1 - Math.floor(x0))), h: Math.max(1, Math.ceil(y1 - Math.floor(y0))) };
}

/**
 * The box and custom geometry of a finished drawing (slide EMU): the path
 * in the box's own coordinates (`a:path w h` = the box), filled when
 * closed.
 */
export function freeformGeometry(s: FreeformState, tol: number): { transform: Transform; path: GeomPath } | null {
  if (!s.done || s.points.length < 2) return null;
  const cmds = freeformCommands(s.points, s.done.closed, tol);
  const box = commandsBox(cmds);
  return {
    transform: { x: box.x, y: box.y, w: box.w, h: box.h, rotationDeg: 0 },
    path: { w: box.w, h: box.h, fill: s.done.closed, stroke: true, commands: shiftCommands(cmds, box.x, box.y) },
  };
}

/** The polyline shown while drawing (slide EMU): the points so far and, between clicks, the rubber band to the pointer. */
export function freeformPreview(s: FreeformState): Pt[] {
  const pts: Pt[] = s.points.map((p) => ({ x: p.x, y: p.y }));
  if (s.mode === "freeform" && !s.down && s.cursor && pts.length) pts.push(s.cursor);
  return pts;
}
