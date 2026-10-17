// Handle geometry shared by Show's slide canvas and Write's drawings
// (P9-X1). Both apps get the adjust handles of a preset from their core
// (`shapePaths`, computed by `core_model::geometry` from ECMA-376's
// `a:ahXY` / `a:ahPolar`); this module holds the math around them so the
// two editors behave the same:
//
// - box space ↔ parent space of a rotated, flipped box (`mapLocal`,
//   `toLocal`), and vectors in a rotated frame (`rotateVec`, `unrotateVec`);
// - adjust handles: where one sits for the current values, which values a
//   drag to a point sets (inverting the sampled curve; polar handles turn
//   around the box centre), keyboard focus (Tab) and nudging (arrows);
// - the eight resize handles and the rotation handle of a frame that
//   rotates with its shape: positions, resizing from one of them with the
//   opposite one fixed, the resize cursor for the rotated direction, the
//   rotation for a pointer, and hit testing.
//
// Each app keeps its own rendering (Konva nodes in Show, DOM spans in
// Write). All lengths are in one unit per call (EMU or px).

/** A point. */
export interface Pt {
  x: number;
  y: number;
}

/** A box with rotation (degrees clockwise about its centre) and flips (Show's `Transform` fits). */
export interface BoxTransform {
  x: number;
  y: number;
  w: number;
  h: number;
  rotationDeg?: number;
  flipH?: boolean;
  flipV?: boolean;
}

/** One coordinate of an adjust handle driven by an adjust value (the cores' `HandleAxis`). */
export interface HandleAxis {
  adj: string;
  base: number;
  k: number;
  min: number;
  max: number;
  samples?: Array<[number, number]>;
}

/** An adjust handle in the shape's box (unflipped, unrotated; the cores' `AdjustHandle`). */
export interface AdjustHandle {
  x: number;
  y: number;
  polar?: boolean;
  xAxis?: HandleAxis;
  yAxis?: HandleAxis;
}

/** A handle plus the box it was computed for (polar handles turn around its centre). */
export interface HandleDef extends AdjustHandle {
  w: number;
  h: number;
}

const rad = (deg: number) => (deg * Math.PI) / 180;

// ----- frames ----------------------------------------------------------------------------------

/** A point of the box's own space (unflipped, unrotated `0..w` × `0..h`) in the parent's space. */
export function mapLocal(t: BoxTransform, x: number, y: number): Pt {
  const fx = t.flipH ? t.w - x : x;
  const fy = t.flipV ? t.h - y : y;
  const dx = fx - t.w / 2;
  const dy = fy - t.h / 2;
  const a = rad(t.rotationDeg ?? 0);
  const sin = Math.sin(a);
  const cos = Math.cos(a);
  return { x: t.x + t.w / 2 + dx * cos - dy * sin, y: t.y + t.h / 2 + dx * sin + dy * cos };
}

/** The inverse of [`mapLocal`]: a parent point in the box's own space. */
export function toLocal(t: BoxTransform, x: number, y: number): Pt {
  const a = rad(-(t.rotationDeg ?? 0));
  const dx = x - (t.x + t.w / 2);
  const dy = y - (t.y + t.h / 2);
  const lx = dx * Math.cos(a) - dy * Math.sin(a) + t.w / 2;
  const ly = dx * Math.sin(a) + dy * Math.cos(a) + t.h / 2;
  return { x: t.flipH ? t.w - lx : lx, y: t.flipV ? t.h - ly : ly };
}

/** `p` rotated by `deg` (clockwise on screen). */
export function rotateVec(p: Pt, deg: number): Pt {
  const a = rad(deg);
  return { x: p.x * Math.cos(a) - p.y * Math.sin(a), y: p.x * Math.sin(a) + p.y * Math.cos(a) };
}

/** A screen delta in the frame of a shape rotated by `deg` (clockwise). */
export function unrotateVec(dx: number, dy: number, deg: number): Pt {
  return rotateVec({ x: dx, y: dy }, -deg);
}

// ----- adjust handles --------------------------------------------------------------------------

/** The adjust values in effect: the preset's defaults overridden by the shape's own. */
export function effectiveAdjust(defaults: Record<string, number>, own: Record<string, number> | null | undefined): Record<string, number> {
  return { ...defaults, ...(own ?? {}) };
}

/** The handles of an outline with the box they belong to. */
export function handleDefs(handles: readonly AdjustHandle[] | null | undefined, w: number, h: number): HandleDef[] {
  return (handles ?? []).map((d) => ({ ...d, w, h }));
}

/** The coordinate an axis gives for value `v` (between samples linear; outside them `base + k·v`). */
export function axisCoord(a: HandleAxis, v: number): number {
  const s = a.samples ?? [];
  if (s.length >= 2 && v >= s[0]![0] && v <= s[s.length - 1]![0]) {
    for (let i = 0; i + 1 < s.length; i++) {
      const [v0, c0] = s[i]!;
      const [v1, c1] = s[i + 1]!;
      if (v >= v0 && v <= v1) return v1 === v0 ? c0 : c0 + ((v - v0) / (v1 - v0)) * (c1 - c0);
    }
  }
  return a.base + a.k * v;
}

const clamp = (v: number, a: HandleAxis) => Math.min(a.max, Math.max(a.min, v));

/** The value of an axis whose coordinate is `c` (inverting the samples; clamped to the range). */
export function axisValue(a: HandleAxis, c: number): number {
  const s = a.samples ?? [];
  if (s.length < 2) {
    const v = a.k === 0 ? 0 : (c - a.base) / a.k;
    return Math.round(clamp(v, a));
  }
  for (let i = 0; i + 1 < s.length; i++) {
    const [v0, c0] = s[i]!;
    const [v1, c1] = s[i + 1]!;
    if (c >= Math.min(c0, c1) && c <= Math.max(c0, c1)) {
      const v = c1 === c0 ? v0 : v0 + ((c - c0) / (c1 - c0)) * (v1 - v0);
      return Math.round(clamp(v, a));
    }
  }
  // outside the sampled curve: extrapolate past its ends, else the nearest sample
  const lin = a.k === 0 ? NaN : (c - a.base) / a.k;
  if (Number.isFinite(lin) && (lin < s[0]![0] || lin > s[s.length - 1]![0])) return Math.round(clamp(lin, a));
  let best = s[0]!;
  for (const p of s) if (Math.abs(p[1] - c) < Math.abs(best[1] - c)) best = p;
  return Math.round(clamp(best[0], a));
}

/** Angle (60000ths of a degree, clockwise from the right, 0 … 21600000) of `p` around the box centre. */
const angleAt = (h: HandleDef, p: Pt) => {
  const deg = (Math.atan2(p.y - h.h / 2, p.x - h.w / 2) * 180) / Math.PI;
  return Math.round((((deg % 360) + 360) % 360) * 60000);
};

/** Where a handle sits (box space) for `adjust` (effective values). */
export function handlePos(h: HandleDef, adjust: Record<string, number>): Pt {
  const val = (a: HandleAxis | undefined) => (a ? adjust[a.adj] : undefined);
  if (h.polar) {
    const cx = h.w / 2;
    const cy = h.h / 2;
    const rv = val(h.xAxis);
    const r = h.xAxis && rv !== undefined ? axisCoord(h.xAxis, rv) : Math.hypot(h.x - cx, h.y - cy);
    const av = val(h.yAxis);
    const ang = av !== undefined ? (av / 60000) * (Math.PI / 180) : Math.atan2(h.y - cy, h.x - cx);
    return { x: cx + r * Math.cos(ang), y: cy + r * Math.sin(ang) };
  }
  const xv = val(h.xAxis);
  const yv = val(h.yAxis);
  return {
    x: h.xAxis && xv !== undefined ? axisCoord(h.xAxis, xv) : h.x,
    y: h.yAxis && yv !== undefined ? axisCoord(h.yAxis, yv) : h.y,
  };
}

/** The adjust values a drag of handle `h` to the box point `p` sets (only the handle's own names). */
export function dragHandle(h: HandleDef, p: Pt): Record<string, number> {
  const out: Record<string, number> = {};
  if (h.polar) {
    if (h.yAxis) {
      let a = angleAt(h, p);
      // a range past 360° (or below 0) takes the equivalent angle inside it
      if (a < h.yAxis.min && a + 21600000 <= h.yAxis.max) a += 21600000;
      if (a > h.yAxis.max && a - 21600000 >= h.yAxis.min) a -= 21600000;
      out[h.yAxis.adj] = Math.round(clamp(a, h.yAxis));
    }
    if (h.xAxis) out[h.xAxis.adj] = axisValue(h.xAxis, Math.hypot(p.x - h.w / 2, p.y - h.h / 2));
    return out;
  }
  if (h.xAxis) out[h.xAxis.adj] = axisValue(h.xAxis, p.x);
  if (h.yAxis) out[h.yAxis.adj] = axisValue(h.yAxis, p.y);
  return out;
}

/** Where handle `h` of the box `t` (same unit as the handle) sits in the parent's space: it turns and flips with the shape. */
export function handleOnScreen(h: HandleDef, adjust: Record<string, number>, t: BoxTransform): Pt {
  const p = handlePos(h, adjust);
  return mapLocal(t, p.x, p.y);
}

/** The values a drag of handle `h` to the parent point `p` sets, for a rotated / flipped box `t`. */
export function dragHandleOnScreen(h: HandleDef, t: BoxTransform, p: Pt): Record<string, number> {
  return dragHandle(h, toLocal(t, p.x, p.y));
}

/**
 * Arrow keys on a focused adjust handle: the values after moving the
 * handle by (`dx`, `dy`) in the parent's space (screen directions, whatever
 * the shape's rotation and flips), as if it had been dragged there.
 */
export function nudgeAdjust(h: HandleDef, adjust: Record<string, number>, t: BoxTransform, dx: number, dy: number): Record<string, number> {
  const at = handleOnScreen(h, adjust, t);
  return dragHandleOnScreen(h, t, { x: at.x + dx, y: at.y + dy });
}

/**
 * Tab / Shift+Tab over `n` adjust handles: the next focus after `cur`
 * (`null` = the shape itself; after the last handle the shape again).
 */
export function stepHandleFocus(cur: number | null, n: number, delta: 1 | -1): number | null {
  if (n <= 0) return null;
  const next = cur === null ? (delta > 0 ? 0 : n - 1) : cur + delta;
  return next < 0 || next >= n ? null : next;
}

/** The keyboard step of a focused handle for an arrow key (px; Shift: 10), or null for other keys. */
export function handleNudgeKey(key: string, shift: boolean): Pt | null {
  const s = shift ? 10 : 1;
  switch (key) {
    case "ArrowLeft":
      return { x: -s, y: 0 };
    case "ArrowRight":
      return { x: s, y: 0 };
    case "ArrowUp":
      return { x: 0, y: -s };
    case "ArrowDown":
      return { x: 0, y: s };
    default:
      return null;
  }
}

/**
 * The elbow connector's middle handle (two turns: `adj1` = where the
 * middle segment runs, as a fraction of the width).
 */
export function elbowHandle(w: number, h: number, adjust: Record<string, number> | null | undefined): HandleDef {
  const v = adjust?.adj1 ?? 50000;
  return { x: (w * v) / 100000, y: h / 2, w, h, xAxis: { adj: "adj1", base: 0, k: w / 100000, min: -1000000, max: 1000000 } };
}

// ----- resize and rotation handles -------------------------------------------------------------

/** The eight resize handles, clockwise from the top-left corner. */
export const RESIZE_HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
export type ResizeHandle = (typeof RESIZE_HANDLES)[number];

const SIGN: Record<ResizeHandle, [number, number]> = {
  nw: [-1, -1], n: [0, -1], ne: [1, -1], e: [1, 0], se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0],
};

/**
 * Where the resize handles of the frame `t` sit in the parent's space. The
 * frame rotates with the shape but is not flipped (handles are named by
 * where they appear: "nw" is the visual top-left before rotation).
 */
export function resizeHandlePoints(t: BoxTransform): Record<ResizeHandle, Pt> {
  const frame = { ...t, flipH: false, flipV: false };
  const out = {} as Record<ResizeHandle, Pt>;
  for (const k of RESIZE_HANDLES) {
    const [sx, sy] = SIGN[k];
    out[k] = mapLocal(frame, ((sx + 1) / 2) * t.w, ((sy + 1) / 2) * t.h);
  }
  return out;
}

/** Where the rotation handle sits: `offset` above the frame's top centre, turning with the frame. */
export function rotateHandlePoint(t: BoxTransform, offset: number): Pt {
  return mapLocal({ ...t, flipH: false, flipV: false }, t.w / 2, -offset);
}

const CURSORS = ["ew-resize", "nwse-resize", "ns-resize", "nesw-resize"] as const;

/** The resize cursor of `handle` on a frame rotated by `deg`: the arrow points along the rotated direction. */
export function resizeCursor(handle: ResizeHandle, deg: number): (typeof CURSORS)[number] {
  const [sx, sy] = SIGN[handle];
  const base = (Math.atan2(sy, sx) * 180) / Math.PI;
  const a = ((((base + deg) % 180) + 180) % 180);
  return CURSORS[Math.round(a / 45) % 4]!;
}

/** The rotation (deg) of a pointer at `(x, y)` around `(cx, cy)`, 0 = straight up; snapped to 15° with `snap` (Shift). */
export function rotationAt(cx: number, cy: number, x: number, y: number, snap = false): number {
  let deg = (Math.atan2(x - cx, cy - y) * 180) / Math.PI;
  deg = ((deg % 360) + 360) % 360;
  if (snap) deg = (Math.round(deg / 15) * 15) % 360;
  return Math.round(deg * 10) / 10;
}

/**
 * Resizing a `w` × `h` frame rotated by `deg` from `handle` by the screen
 * delta (`dx`, `dy`): the new size and how far the unrotated frame's
 * top-left corner moves so that the opposite handle stays where it is.
 * `keepRatio` keeps the proportions (corner handles).
 */
export function rotatedResize(
  handle: ResizeHandle,
  w: number,
  h: number,
  dx: number,
  dy: number,
  deg: number,
  keepRatio: boolean,
  min = 8,
): { w: number; h: number; dx: number; dy: number } {
  const [sx, sy] = SIGN[handle];
  const d = unrotateVec(dx, dy, deg);
  let nw = sx ? Math.max(min, w + sx * d.x) : w;
  let nh = sy ? Math.max(min, h + sy * d.y) : h;
  if (keepRatio && sx && sy) {
    const f = Math.abs(nw / w - 1) >= Math.abs(nh / h - 1) ? nw / w : nh / h;
    nw = Math.max(min, w * f);
    nh = Math.max(min, h * f);
  }
  // The opposite point (local, from the centre) is fixed on screen.
  const anchor = { x: (-sx * w) / 2, y: (-sy * h) / 2 };
  const c0 = { x: w / 2, y: h / 2 };
  const fixed = add(c0, rotateVec(anchor, deg));
  const c1 = sub(fixed, rotateVec({ x: (-sx * nw) / 2, y: (-sy * nh) / 2 }, deg));
  const tl = { x: c1.x - nw / 2, y: c1.y - nh / 2 };
  return { w: Math.round(nw), h: Math.round(nh), dx: round2(tl.x), dy: round2(tl.y) };
}

const add = (a: Pt, b: Pt) => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Pt, b: Pt) => ({ x: a.x - b.x, y: a.y - b.y });
const round2 = (v: number) => Math.round(v * 100) / 100;

/** The index of the point in `points` nearest to `p` within `radius`, or -1 (hit testing of handles). */
export function handleAt(points: readonly Pt[], p: Pt, radius: number): number {
  let best = -1;
  let bestD = radius;
  points.forEach((q, i) => {
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d <= bestD) {
      best = i;
      bestD = d;
    }
  });
  return best;
}
