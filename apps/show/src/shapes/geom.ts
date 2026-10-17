// Box geometry in EMU shared by connectors, adjust handles and tables:
// the mirror of `Transform::map_local` / `line_ends` / `from_line_ends`
// of crates/model-show/src/connector.rs.

// The box mapping itself (`mapLocal` / `toLocal`) is the one Write's
// drawings use too (ui-shared `geometry/handles.ts`, P9-X1).

import { mapLocal, type Pt } from "@rusuite/ui-shared";
import type { Transform } from "../generated/Transform";

export { mapLocal, toLocal, type Pt } from "@rusuite/ui-shared";

/** Start and end of a line or connector drawn in the box (top-left → bottom-right before flips and rotation). */
export function lineEnds(t: Transform): [Pt, Pt] {
  return [mapLocal(t, 0, 0), mapLocal(t, t.w, t.h)];
}

/** The box of a straight line from `start` to `end` (flips for the directions, no rotation). */
export function fromLineEnds(start: Pt, end: Pt): Transform {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  return {
    x: Math.round(Math.min(start.x, end.x)),
    y: Math.round(Math.min(start.y, end.y)),
    w: Math.round(Math.abs(dx)),
    h: Math.round(Math.abs(dy)),
    rotationDeg: 0,
    flipH: dx < 0,
    flipV: dy < 0,
  };
}

/** Distance of two points. */
export const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * The box drawn by dragging from `a` to `b`; with `square` (Shift) the
 * shorter side grows to the longer one, away from `a` like PowerPoint.
 */
export function dragBox(a: Pt, b: Pt, square: boolean): { x: number; y: number; w: number; h: number } {
  let w = Math.abs(b.x - a.x);
  let h = Math.abs(b.y - a.y);
  if (square) w = h = Math.max(w, h);
  return { x: Math.round(b.x < a.x ? a.x - w : a.x), y: Math.round(b.y < a.y ? a.y - h : a.y), w: Math.round(w), h: Math.round(h) };
}

/** For a line drawn with Shift: the end snapped to the nearest multiple of 45° around `a`. */
export function snap45(a: Pt, b: Pt): Pt {
  const len = dist(a, b);
  const ang = Math.round(Math.atan2(b.y - a.y, b.x - a.x) / (Math.PI / 4)) * (Math.PI / 4);
  return { x: a.x + Math.round(len * Math.cos(ang)), y: a.y + Math.round(len * Math.sin(ang)) };
}
