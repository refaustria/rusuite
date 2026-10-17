// Picture Format round 2 (P9-W4): the dimmed mask of crop mode, Crop ▾ ›
// Aspect Ratio / Fill / Fit, Crop to Shape (any preset outline as a clip
// path), Picture Effects › Soft Edges / Bevel and their CSS approximations
// (a feathered mask; inset highlight and shade).

import type { Bevel } from "../generated/Bevel";
import type { Crop } from "../generated/Crop";
import type { PictureFormat } from "../generated/PictureFormat";
import { visibleFraction } from "./imageView";

/** EMU per CSS pixel / point. */
const EMU_PER_PX = 9525;
const EMU_PER_PT = 12700;

/** A rectangle in px. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The dimmed parts of crop mode: the whole image (`image`, px relative to
 * the crop window's top-left) minus the crop window (`w` × `h` at 0, 0),
 * as up to four rectangles (above, below, left, right).
 */
export function cropMaskRects(image: Rect, w: number, h: number): Rect[] {
  const out: Rect[] = [];
  const top = Math.max(0, -image.y);
  const bottom = Math.max(0, image.y + image.h - h);
  const left = Math.max(0, -image.x);
  const right = Math.max(0, image.x + image.w - w);
  if (top > 0) out.push({ x: image.x, y: image.y, w: image.w, h: top });
  if (bottom > 0) out.push({ x: image.x, y: h, w: image.w, h: bottom });
  const midTop = Math.max(image.y, 0);
  const midH = Math.min(image.y + image.h, h) - midTop;
  if (left > 0 && midH > 0) out.push({ x: image.x, y: midTop, w: left, h: midH });
  if (right > 0 && midH > 0) out.push({ x: w, y: midTop, w: right, h: midH });
  return out;
}

/** The whole image's rectangle (px, relative to the crop window) for a window of `w` × `h` showing `crop`. */
export function imageRect(w: number, h: number, crop: Crop | null | undefined): Rect {
  const vis = visibleFraction(crop);
  const iw = w / vis.w;
  const ih = h / vis.h;
  return { x: -((crop?.left ?? 0) / 100000) * iw, y: -((crop?.top ?? 0) / 100000) * ih, w: iw, h: ih };
}

/** Word's Aspect Ratio presets (Crop ▾ › Aspect Ratio): [width, height]. */
export const ASPECT_RATIOS: [number, number][] = [
  [1, 1],
  [2, 3],
  [3, 4],
  [3, 5],
  [4, 5],
  [3, 2],
  [4, 3],
  [5, 3],
  [5, 4],
  [16, 9],
  [16, 10],
  [9, 16],
  [10, 16],
];

/**
 * The crop showing the largest centred part of an image of `iw` × `ih`
 * with the proportions `rw` : `rh` (values in 1/1000 %, as `a:srcRect`).
 */
export function aspectCrop(iw: number, ih: number, rw: number, rh: number): Crop {
  const want = rw / rh;
  const have = iw / Math.max(1e-9, ih);
  if (Math.abs(want - have) < 1e-6) return { left: 0, top: 0, right: 0, bottom: 0 };
  if (have > want) {
    // Too wide: cut left and right.
    const cut = Math.round(((1 - want / have) * 100000) / 2);
    return { left: cut, top: 0, right: cut, bottom: 0 };
  }
  const cut = Math.round(((1 - have / want) * 100000) / 2);
  return { left: 0, top: cut, right: 0, bottom: cut };
}

/**
 * Fit (Crop ▾ › Fit): the whole image inside a `w` × `h` box, keeping its
 * proportions — the rest of the box is padding (a negative crop, as Word
 * writes it).
 */
export function fitCrop(w: number, h: number, iw: number, ih: number): Crop {
  const box = w / Math.max(1e-9, h);
  const img = iw / Math.max(1e-9, ih);
  if (Math.abs(box - img) < 1e-6) return { left: 0, top: 0, right: 0, bottom: 0 };
  if (img > box) {
    // Bars above and below: the image is as wide as the box.
    const pad = Math.round((((img / box) - 1) * 100000) / 2);
    return { left: 0, top: -pad, right: 0, bottom: -pad };
  }
  const pad = Math.round((((box / img) - 1) * 100000) / 2);
  return { left: -pad, top: 0, right: -pad, bottom: 0 };
}

/** The full image's size at the picture's current scale (px): its box divided by the visible fraction. */
export function fullImageSize(width: number, height: number, crop: Crop | null | undefined): { w: number; h: number } {
  const vis = visibleFraction(crop);
  return { w: width / EMU_PER_PX / vis.w, h: height / EMU_PER_PX / vis.h };
}

/** Picture Effects › Soft Edges sizes (pt), 0 = none. */
export const SOFT_EDGES = [0, 1, 2.5, 5, 10, 25, 50];

/** Picture Effects › Bevel presets (DrawingML names, Word's order). */
export const BEVELS = ["circle", "relaxedInset", "cross", "coolSlant", "angle", "softRound", "convex", "slope", "divot", "riblet", "hardEdge", "artDeco"];

/** Word's bevel of preset `p` (6 pt wide and high; Cool Slant, Angle and Hard Edge are deeper). */
export function bevelOf(p: string): Bevel {
  const deep = p === "coolSlant" || p === "angle" || p === "hardEdge";
  return { preset: p, width: 76200, height: deep ? 76200 : 76200 / 3 };
}

/** The format with soft edges of `pt` points (0: none). */
export function withSoftEdge(f: PictureFormat, pt: number): PictureFormat {
  const out = { ...f };
  if (pt > 0) out.softEdge = Math.round(pt * EMU_PER_PT);
  else delete out.softEdge;
  return out;
}

/** The format with bevel preset `p` (null: none). */
export function withBevel(f: PictureFormat, p: string | null): PictureFormat {
  const out = { ...f };
  if (p) out.bevel = bevelOf(p);
  else delete out.bevel;
  return out;
}

/** CSS of the soft edges: a mask fading out over the radius (px) at every side. */
export function softEdgeCss(f: PictureFormat | null | undefined, w: number, h: number): Record<string, string> {
  const r = f?.softEdge;
  if (!r) return {};
  const px = Math.max(0.5, Math.min(r / EMU_PER_PX, Math.min(w, h) / 2));
  const g = (dir: string) => `linear-gradient(${dir}, transparent, #000 ${px.toFixed(1)}px, #000 calc(100% - ${px.toFixed(1)}px), transparent)`;
  const mask = `${g("to right")}, ${g("to bottom")}`;
  return { "mask-image": mask, "-webkit-mask-image": mask, "mask-composite": "intersect", "-webkit-mask-composite": "source-in" };
}

/** CSS of the bevel overlay: a light inner edge top-left, a shade bottom-right (`box-shadow`, px from the bevel's width). */
export function bevelCss(b: Bevel | null | undefined): string {
  if (!b) return "";
  const w = Math.max(1, b.width / EMU_PER_PX);
  const d = Math.max(1, b.height / EMU_PER_PX);
  const soft = b.preset === "angle" || b.preset === "hardEdge" || b.preset === "coolSlant" ? 0 : w / 2;
  const s = (n: number) => `${n.toFixed(1)}px`;
  return `inset ${s(d)} ${s(d)} ${s(soft)} ${s(w / 4)} rgba(255, 255, 255, 0.5), inset ${s(-d)} ${s(-d)} ${s(soft)} ${s(w / 4)} rgba(0, 0, 0, 0.35)`;
}
