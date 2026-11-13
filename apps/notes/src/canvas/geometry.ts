// Pure geometry of canvas pages (P11-N4): units, stroke quantisation and simplification, the stroke outline (a small
// perfect-freehand-like outline: smoothed centre line, pressure-dependent radius, round caps), hit tests for the
// eraser and the lasso, snapping. No DOM, no Loro.
//
// Units (docs/notes-format.md §4.1): canvas items are in points, ink in 1/10 pt. The surface is laid out in CSS px at
// 100 % zoom; 1 pt = 4/3 px (the editor's 11 pt text is the same size on flowing and canvas pages).

export const PX_PER_PT = 4 / 3;
/** CSS px per stored ink unit (1/10 pt). */
export const PX_PER_INK = PX_PER_PT / 10;

export const ptToPx = (pt: number): number => pt * PX_PER_PT;
export const pxToPt = (px: number): number => px / PX_PER_PT;

/** A point of a stroke in surface px with pressure 0–1. */
export interface InkPoint {
  x: number;
  y: number;
  p: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Snap grid of box positions (surface px at 100 %). */
export const GRID_PX = 8;

export function snap(v: number, on: boolean, grid = GRID_PX): number {
  return on ? Math.round(v / grid) * grid : v;
}

/** Pointer pressure → 0–1: devices without pressure report 0.5 while pressed (mouse) or 0; both use 0.5. */
export function normPressure(pressure: number | undefined, pointerType: string): number {
  if (pointerType === "mouse" || pressure === undefined || !(pressure > 0)) return 0.5;
  return Math.min(1, pressure);
}

// ---------------------------------------------------------------------------------------------- simplification

function segDist2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const qx = ax + t * dx - px;
  const qy = ay + t * dy - py;
  return qx * qx + qy * qy;
}

/** Ramer–Douglas–Peucker on x/y (pressure rides along); keeps both end points. Iterative (long strokes). */
export function simplify<T extends { x: number; y: number }>(points: readonly T[], epsilon: number): T[] {
  const n = points.length;
  if (n <= 2) return points.slice();
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const eps2 = epsilon * epsilon;
  const stack: Array<[number, number]> = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const pa = points[a]!;
    const pb = points[b]!;
    let max = -1;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const p = points[i]!;
      const d = segDist2(p.x, p.y, pa.x, pa.y, pb.x, pb.y);
      if (d > max) {
        max = d;
        idx = i;
      }
    }
    if (idx >= 0 && max > eps2) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}

/** RDP tolerance of committed strokes (surface px). */
export const SIMPLIFY_EPSILON_PX = 0.5;

/**
 * A finished stroke as stored: simplified (ε 0.5 px), then flat `[x, y, pressure, …]` with x/y in 1/10 pt and
 * pressure 0–255, integers (the stored resolution, 1/10 pt ≈ 0.13 px, is the quantisation step).
 */
export function encodeStroke(points: readonly InkPoint[]): number[] {
  const simple = simplify(points, SIMPLIFY_EPSILON_PX);
  const out: number[] = [];
  for (const p of simple) {
    const x = Math.round(p.x / PX_PER_INK);
    const y = Math.round(p.y / PX_PER_INK);
    const q = Math.max(0, Math.min(255, Math.round(p.p * 255)));
    const k = out.length;
    // Quantisation can merge neighbours: drop exact repeats.
    if (k >= 3 && out[k - 3] === x && out[k - 2] === y) continue;
    out.push(x, y, q);
  }
  return out;
}

/** Stored points → surface px. */
export function decodeStroke(flat: readonly number[]): InkPoint[] {
  const out: InkPoint[] = [];
  for (let i = 0; i + 1 < flat.length; i += 3) {
    out.push({ x: flat[i]! * PX_PER_INK, y: flat[i + 1]! * PX_PER_INK, p: (flat[i + 2] ?? 128) / 255 });
  }
  return out;
}

/** Moves stored points by (dx, dy) surface px. */
export function translateStroke(flat: readonly number[], dx: number, dy: number): number[] {
  const ox = Math.round(dx / PX_PER_INK);
  const oy = Math.round(dy / PX_PER_INK);
  return flat.map((v, i) => (i % 3 === 0 ? v + ox : i % 3 === 1 ? v + oy : v));
}

// ---------------------------------------------------------------------------------------------- outline

/** Radius at a point: pen strokes thin/thicken with pressure (0.5 = nominal), highlighters do not. */
export function radiusAt(widthPx: number, p: number, pressure: boolean): number {
  const half = widthPx / 2;
  return pressure ? Math.max(0.25, half * (0.4 + 1.2 * p)) : half;
}

const f1 = (v: number) => (Math.round(v * 10) / 10).toString();

/**
 * The filled outline of a stroke as SVG path data: centre line smoothed (3-point average, ends kept), radius from
 * pressure (smoothed too), offset curves joined by quadratic segments through their midpoints, round caps. A single
 * point is a dot.
 */
export function strokeOutline(points: readonly InkPoint[], widthPx: number, pressure = true): string {
  const n = points.length;
  if (n === 0) return "";
  const r0 = radiusAt(widthPx, points[0]!.p, pressure);
  const dot = (x: number, y: number, r: number) => `M${f1(x - r)} ${f1(y)}a${f1(r)} ${f1(r)} 0 1 0 ${f1(2 * r)} 0a${f1(r)} ${f1(r)} 0 1 0 ${f1(-2 * r)} 0Z`;
  // Centre line and radii, smoothed.
  const pts: InkPoint[] = points.map((p, i) => {
    if (i === 0 || i === n - 1) return p;
    const a = points[i - 1]!;
    const b = points[i + 1]!;
    return { x: (a.x + 2 * p.x + b.x) / 4, y: (a.y + 2 * p.y + b.y) / 4, p: (a.p + 2 * p.p + b.p) / 4 };
  });
  // Drop points closer than 0.3 px (the tangent would be noise).
  const c: InkPoint[] = [pts[0]!];
  for (let i = 1; i < pts.length; i++) {
    const last = c[c.length - 1]!;
    if (Math.hypot(pts[i]!.x - last.x, pts[i]!.y - last.y) >= 0.3 || i === pts.length - 1) c.push(pts[i]!);
  }
  if (c.length < 2 || (c.length === 2 && Math.hypot(c[1]!.x - c[0]!.x, c[1]!.y - c[0]!.y) < 0.3)) return dot(c[0]!.x, c[0]!.y, r0);
  const left: Array<[number, number]> = [];
  const right: Array<[number, number]> = [];
  const radii = c.map((p) => radiusAt(widthPx, p.p, pressure));
  for (let i = 0; i < c.length; i++) {
    const a = c[Math.max(0, i - 1)]!;
    const b = c[Math.min(c.length - 1, i + 1)]!;
    let tx = b.x - a.x;
    let ty = b.y - a.y;
    const len = Math.hypot(tx, ty) || 1;
    tx /= len;
    ty /= len;
    const r = radii[i]!;
    const p = c[i]!;
    left.push([p.x - ty * r, p.y + tx * r]);
    right.push([p.x + ty * r, p.y - tx * r]);
  }
  const curve = (side: Array<[number, number]>): string => {
    // Quadratic segments through the midpoints of consecutive offset points (smooth joins).
    let d = "";
    for (let i = 1; i < side.length - 1; i++) {
      const [x, y] = side[i]!;
      const [nx, ny] = side[i + 1]!;
      d += `Q${f1(x)} ${f1(y)} ${f1((x + nx) / 2)} ${f1((y + ny) / 2)}`;
    }
    const [lx, ly] = side[side.length - 1]!;
    return `${d}L${f1(lx)} ${f1(ly)}`;
  };
  const rEnd = radii[radii.length - 1]!;
  const rStart = radii[0]!;
  const back = right.slice().reverse();
  const [l0x, l0y] = left[0]!;
  const [bx, by] = back[0]!;
  return `M${f1(l0x)} ${f1(l0y)}` + curve(left) + `A${f1(rEnd)} ${f1(rEnd)} 0 0 1 ${f1(bx)} ${f1(by)}` + curve(back) + `A${f1(rStart)} ${f1(rStart)} 0 0 1 ${f1(l0x)} ${f1(l0y)}Z`;
}

// ---------------------------------------------------------------------------------------------- hit tests

export function boundsOf(points: readonly { x: number; y: number }[], pad = 0): Rect {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of points) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  if (x0 === Infinity) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad };
}

export function unionRect(a: Rect | null, b: Rect): Rect {
  if (!a) return b;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
}

export function rectContainsRect(outer: Rect, inner: Rect): boolean {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
}

/** Whether a circle at (x, y) with radius `r` touches a stroke of width `widthPx` (its centre line within r + w/2). */
export function strokeHit(points: readonly InkPoint[], widthPx: number, x: number, y: number, r: number): boolean {
  const reach = r + widthPx / 2;
  const reach2 = reach * reach;
  if (points.length === 1) return (points[0]!.x - x) ** 2 + (points[0]!.y - y) ** 2 <= reach2;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    if (segDist2(x, y, a.x, a.y, b.x, b.y) <= reach2) return true;
  }
  return false;
}

/** Even–odd point in polygon. */
export function pointInPolygon(x: number, y: number, poly: readonly { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Lasso rule for strokes: at least 3/4 of the points inside (a stroke crossing the lasso's edge a little still counts). */
export function strokeInLasso(points: readonly InkPoint[], poly: readonly { x: number; y: number }[]): boolean {
  if (poly.length < 3 || points.length === 0) return false;
  let n = 0;
  for (const p of points) if (pointInPolygon(p.x, p.y, poly)) n++;
  return n / points.length >= 0.75;
}

/** Lasso rule for boxes: the box's centre inside. */
export function rectInLasso(r: Rect, poly: readonly { x: number; y: number }[]): boolean {
  return poly.length >= 3 && pointInPolygon(r.x + r.w / 2, r.y + r.h / 2, poly);
}

/** Zoom limits of canvas pages. */
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4;
export const clampZoom = (z: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(z * 100) / 100));

/** Reading order of boxes (switching to a flowing page): top to bottom, then left to right. */
export function readingOrder<T extends { x: number; y: number }>(items: readonly T[]): T[] {
  return items.slice().sort((a, b) => a.y - b.y || a.x - b.x);
}
