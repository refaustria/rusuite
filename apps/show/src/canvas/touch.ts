// Touch editing on the slide (P10-M5), the pure parts: two-finger metrics, the pinch / twist transform of the
// selected shapes (scale and rotate about the selection's centre, which follows the fingers' midpoint), the
// rotation snap (0 / 90 / 180 / 270 ± 3°), the canvas zoom range and the "Select" toggle of the compact Home tab
// (tapping shapes then adds them to / removes them from the selection, like Shift-click).

import { useSyncExternalStore } from "react";
import type { NodeAttrs } from "../geometry";

export interface Pt {
  x: number;
  y: number;
}

/** Touch hit areas of the transformer's anchors (resize handles and the rotate handle), in screen px. */
export const TOUCH_ANCHOR_HIT = 44;
/** Shapes whose box is smaller than this on screen show only the corner handles on touch (the side ones would cover it). */
export const TOUCH_SMALL_BOX = 2 * TOUCH_ANCHOR_HIT;
/** The rotation snaps to multiples of 90° within this many degrees. */
export const TWIST_SNAP_DEG = 3;
/** The canvas zoom of a pinch on the empty slide, relative to the fitted size. */
export const TOUCH_ZOOM_MIN = 0.5;
export const TOUCH_ZOOM_MAX = 3;
/** A touch that moved further than this (px) is not a tap. */
export const TAP_SLOP = 10;

/**
 * The touch hit rectangle of a transformer anchor, relative to the anchor's centre (screen px, the transformer's
 * axes): 22 px outwards and along the edge, but inwards at most a quarter of the box (`boxW` × `boxH`), so the
 * middle of a small shape stays free for dragging it. The rotate handle gets the full 44 × 44.
 */
export function touchAnchorHit(name: string, boxW: number, boxH: number): { x: number; y: number; width: number; height: number } {
  const half = TOUCH_ANCHOR_HIT / 2;
  const axis = (side: -1 | 0 | 1, dim: number): [number, number] => {
    const inner = Math.min(half, Math.max(0, dim / 4));
    if (side === -1) return [-half, inner];
    if (side === 1) return [-inner, half];
    return [-inner, inner];
  };
  if (name === "rotater") return { x: -half, y: -half, width: TOUCH_ANCHOR_HIT, height: TOUCH_ANCHOR_HIT };
  const sx: -1 | 0 | 1 = name.endsWith("left") ? -1 : name.endsWith("right") ? 1 : 0;
  const sy: -1 | 0 | 1 = name.startsWith("top") ? -1 : name.startsWith("bottom") ? 1 : 0;
  // the middle handles lie on an edge: outwards from it, along it within the quarter
  const [x0, x1] = axis(sx, boxW);
  const [y0, y1] = axis(sy, boxH);
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** Distance, angle (degrees) and midpoint of two touch points. */
export function pinchMetrics(a: Pt, b: Pt): { dist: number; angle: number; mid: Pt } {
  return {
    dist: Math.hypot(b.x - a.x, b.y - a.y),
    angle: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI,
    mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
  };
}

/** The smallest signed difference `b - a` of two angles (degrees, −180 … 180). */
export function angleDelta(a: number, b: number): number {
  let d = (b - a) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

/** `deg` snapped to the nearest multiple of 90° when within `tol` of it. */
export function snapRotation(deg: number, tol = TWIST_SNAP_DEG): number {
  const k = Math.round(deg / 90) * 90;
  return Math.abs(deg - k) <= tol ? k : deg;
}

/** The canvas zoom clamped to 50–300 %. */
export function clampTouchZoom(z: number): number {
  return Math.min(TOUCH_ZOOM_MAX, Math.max(TOUCH_ZOOM_MIN, z));
}

/**
 * The node attributes after a pinch / twist: every node scaled by `scale` and turned by `turn` degrees about
 * `centre` (slide px), which itself moves by `shift`. The rotation of the first node snaps (the others turn by the
 * same amount); the scale never goes under `minScale` of the start.
 */
export function pinchNodes(start: readonly NodeAttrs[], centre: Pt, shift: Pt, scale: number, turn: number, minScale = 0.05): NodeAttrs[] {
  const s = Math.max(minScale, scale);
  const first = start[0];
  const snapped = first ? snapRotation(first.rotation + turn) - first.rotation : turn;
  const rad = (snapped * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return start.map((n) => {
    const dx = (n.x - centre.x) * s;
    const dy = (n.y - centre.y) * s;
    return {
      x: centre.x + shift.x + dx * cos - dy * sin,
      y: centre.y + shift.y + dx * sin + dy * cos,
      rotation: n.rotation + snapped,
      scaleX: n.scaleX * s,
      scaleY: n.scaleY * s,
    };
  });
}

/** Whether the device has a touch screen (the touch hit areas apply; desktop mice keep the small handles). */
export function touchDevice(): boolean {
  if (typeof navigator !== "undefined" && (navigator.maxTouchPoints ?? 0) > 0) return true;
  return typeof window !== "undefined" && "ontouchstart" in window;
}

// ----- the compact Home tab's "Select" toggle (multi-select by tapping)

let selectOn = false;
const listeners = new Set<() => void>();

export function touchSelectOn(): boolean {
  return selectOn;
}

export function setTouchSelect(on: boolean): void {
  if (on === selectOn) return;
  selectOn = on;
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useTouchSelect(): boolean {
  return useSyncExternalStore(subscribe, touchSelectOn, () => false);
}
