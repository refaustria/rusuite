// Adjust handles (PowerPoint's yellow diamonds) of the presets: where a
// handle sits for the current adjust values and which values a drag to a
// point gives. The handles come from the core's `shapePaths` (ECMA-376
// `a:ahXY` / `a:ahPolar` of each preset, P8-32): positions in the shape's
// own box (EMU, unflipped, unrotated), and per axis the adjust value it
// drives with samples of the coordinate over the value's range, so a drag
// inverts the real (possibly bent or pinned) curve. Polar handles turn
// around the box centre.

import type { AdjustHandle } from "../generated/AdjustHandle";
import type { HandleAxis } from "../generated/HandleAxis";
import type { Preset } from "../generated/Preset";
import type { Shape } from "../generated/Shape";
import { adjustDefaults } from "./presets";
import { pathCache, pathQueryOf } from "./paths";

/** A handle: the core's handle plus the box it lives in (polar handles turn around its centre). */
export interface HandleDef extends AdjustHandle {
  w: number;
  h: number;
}

/** The adjust handles of an auto shape (empty for other shapes and until its outline is cached). */
export function handlesOf(shape: Shape): HandleDef[] {
  if (shape.kind.kind !== "auto") return [];
  const q = pathQueryOf(shape);
  const p = q ? pathCache.get(q) : null;
  return (p?.handles ?? []).map((h) => ({ ...h, w: shape.transform.w, h: shape.transform.h }));
}

/** The adjust values in effect: the defaults overridden by the shape's own. */
export function effectiveAdjust(p: Preset, own: Record<string, number> | undefined): Record<string, number> {
  return { ...adjustDefaults(p), ...(own ?? {}) };
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
const angleAt = (h: HandleDef, p: { x: number; y: number }) => {
  const deg = (Math.atan2(p.y - h.h / 2, p.x - h.w / 2) * 180) / Math.PI;
  return Math.round((((deg % 360) + 360) % 360) * 60000);
};

/** Where a handle sits (box EMU) for `adjust` (effective values). */
export function handlePos(h: HandleDef, adjust: Record<string, number>): { x: number; y: number } {
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
export function dragHandle(h: HandleDef, p: { x: number; y: number }): Record<string, number> {
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

/**
 * The elbow connector's middle handle (two turns: `adj1` = where the
 * middle segment runs, as a fraction of the width): position in the box
 * and the value for a box point.
 */
export function elbowHandle(w: number, h: number, adjust: Record<string, number> | undefined): HandleDef {
  const v = adjust?.adj1 ?? 50000;
  return { x: (w * v) / 100000, y: h / 2, w, h, xAxis: { adj: "adj1", base: 0, k: w / 100000, min: -1000000, max: 1000000 } };
}
