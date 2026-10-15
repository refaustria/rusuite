// EMU ↔ px geometry. The editor works in "slide px" (96 dpi: 1 px =
// 9525 EMU, a 16:9 slide is 1280 × 720) and the Konva stage scales that
// to the viewport.

import type { Shape } from "./generated/Shape";
import type { SlideSize } from "./generated/SlideSize";
import type { Transform } from "./generated/Transform";

export const EMU_PER_PX = 9525;
export const EMU_PER_PT = 12700;
/** CSS px per typographic point. */
export const PX_PER_PT = 96 / 72;

export const emuToPx = (emu: number): number => emu / EMU_PER_PX;
export const pxToEmu = (px: number): number => Math.round(px * EMU_PER_PX);

/** The slide size in slide px. */
export function slidePx(size: SlideSize): { width: number; height: number } {
  return { width: emuToPx(size.width), height: emuToPx(size.height) };
}

/** Largest scale at which the slide fits into `w` × `h` CSS px (0 when there is no room). */
export function fitScale(w: number, h: number, size: SlideSize): number {
  const s = slidePx(size);
  if (w <= 0 || h <= 0 || s.width <= 0 || s.height <= 0) return 0;
  return Math.min(w / s.width, h / s.height);
}

/**
 * Konva attributes of a shape's outer node: positioned at the box centre
 * with the offset at the centre, so rotation is about the centre as in
 * DrawingML.
 */
export function boxAttrs(t: Transform) {
  const width = emuToPx(t.w);
  const height = emuToPx(t.h);
  return {
    x: emuToPx(t.x) + width / 2,
    y: emuToPx(t.y) + height / 2,
    offsetX: width / 2,
    offsetY: height / 2,
    rotation: t.rotationDeg ?? 0,
    width,
    height,
  };
}

/** The attributes the Transformer changes on a node. */
export interface NodeAttrs {
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
}

/** Normalizes degrees to `0 <= d < 360` (with a little rounding noise removed). */
export function normalizeDeg(d: number): number {
  const r = Math.round(((d % 360) + 360) % 360 * 1000) / 1000;
  return r >= 360 ? 0 : r;
}

/**
 * The model transform after a drag/resize/rotate gesture: `attrs` are the
 * node's attributes (see [`boxAttrs`]) in parent px, `old` the transform
 * before the gesture. Flips are kept (the Transformer never flips).
 */
export function transformFromNode(attrs: NodeAttrs, old: Transform): Transform {
  const w = Math.max(0, Math.round(old.w * Math.abs(attrs.scaleX)));
  const h = Math.max(0, Math.round(old.h * Math.abs(attrs.scaleY)));
  const cx = attrs.x * EMU_PER_PX;
  const cy = attrs.y * EMU_PER_PX;
  return { ...old, x: Math.round(cx - w / 2), y: Math.round(cy - h / 2), w, h, rotationDeg: normalizeDeg(attrs.rotation) };
}

/** Whether two transforms are the same. */
export function sameTransform(a: Transform, b: Transform): boolean {
  return (
    a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h &&
    (a.rotationDeg ?? 0) === (b.rotationDeg ?? 0) && !!a.flipH === !!b.flipH && !!a.flipV === !!b.flipV
  );
}

/** An axis-aligned rectangle in slide px. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The axis-aligned bounds (slide px) of a rotated transform. */
export function boundsPx(t: Transform): Rect {
  const w = emuToPx(t.w);
  const h = emuToPx(t.h);
  const cx = emuToPx(t.x) + w / 2;
  const cy = emuToPx(t.y) + h / 2;
  const a = ((t.rotationDeg ?? 0) * Math.PI) / 180;
  const bw = Math.abs(w * Math.cos(a)) + Math.abs(h * Math.sin(a));
  const bh = Math.abs(w * Math.sin(a)) + Math.abs(h * Math.cos(a));
  return { x: cx - bw / 2, y: cy - bh / 2, width: bw, height: bh };
}

/** A rectangle from two corner points. */
export function rectFromPoints(x0: number, y0: number, x1: number, y1: number): Rect {
  return { x: Math.min(x0, x1), y: Math.min(y0, y1), width: Math.abs(x1 - x0), height: Math.abs(y1 - y0) };
}

/** Ids of the top-level shapes lying completely inside `r` (marquee selection). */
export function shapesInRect(shapes: Shape[], r: Rect): number[] {
  const eps = 0.01;
  return shapes
    .filter((s) => {
      const b = boundsPx(s.transform);
      return b.x >= r.x - eps && b.y >= r.y - eps && b.x + b.width <= r.x + r.width + eps && b.y + b.height <= r.y + r.height + eps;
    })
    .map((s) => s.id);
}

/** A transform of `w` × `h` EMU centred on the slide. */
export function centredTransform(size: SlideSize, w: number, h: number): Transform {
  return { x: Math.round((size.width - w) / 2), y: Math.round((size.height - h) / 2), w, h, rotationDeg: 0 };
}
