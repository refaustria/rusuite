// Picture adjustments as the UI draws them (docs/pptx-suite.md "Picture
// adjustments in the UI"): the crop's source rectangle, the per-pixel
// recolour → brightness/contrast pipeline for the canvas, and the CSS
// `filter` approximation (`PictureProps::css_filter`) for DOM previews.
// Plus the presets of the Picture Format tab (Corrections, Color, Shadow,
// Picture Styles).

import type { Color } from "../../../../packages/ui-shared/src/generated/Color";
import type { Crop } from "../generated/Crop";
import type { Line } from "../generated/Line";
import type { PicturePatch } from "../generated/PicturePatch";
import type { PictureProps } from "../generated/PictureProps";
import type { Preset } from "../generated/Preset";
import type { Recolor } from "../generated/Recolor";
import type { Shadow } from "../generated/Shadow";

export const NO_CROP: Crop = { left: 0, top: 0, right: 0, bottom: 0 };

/** `(slope, intercept)` of `out = slope · in + intercept` (`PictureProps::transfer`). */
export function transfer(p: Pick<PictureProps, "brightness" | "contrast">): [number, number] {
  const c = Math.max(-1, Math.min(0.99, p.contrast ?? 0));
  const slope = c > 0 ? 1 / (1 - c) : 1 + c;
  return [slope, 0.5 - 0.5 * slope + Math.max(-1, Math.min(1, p.brightness ?? 0))];
}

/** The source rectangle of a crop in an image of `w` × `h` px (may extend outside it for negative crops). */
export function cropSource(crop: Crop | undefined, w: number, h: number): { x: number; y: number; width: number; height: number } {
  const c = crop ?? NO_CROP;
  return { x: c.left * w, y: c.top * h, width: (1 - c.left - c.right) * w, height: (1 - c.top - c.bottom) * h };
}

const num = (v: number) => {
  const s = v.toFixed(3);
  return s.replace(/0+$/, "").replace(/\.$/, "");
};

/**
 * The CSS `filter` approximating `p` (empty when nothing is set), exactly
 * as the core's `css_filter`; `shadowRgb` resolves the shadow colour.
 */
export function cssFilter(p: PictureProps | undefined, shadowRgb: (c: Color) => string = () => "000000"): string {
  if (!p) return "";
  const out: string[] = [];
  const r = p.recolor?.kind ?? "none";
  if (r === "grayscale") out.push("grayscale(1)");
  else if (r === "sepia" || r === "duotone") out.push("sepia(1)");
  else if (r === "blackWhite") out.push("grayscale(1)", "contrast(100)");
  if (p.brightness) out.push(`brightness(${num(1 + p.brightness)})`);
  if (p.contrast) out.push(`contrast(${num(transfer(p)[0])})`);
  if (p.transparency) out.push(`opacity(${num(1 - Math.max(0, Math.min(1, p.transparency)))})`);
  if (p.shadow) {
    const s = p.shadow;
    const [dx, dy] = shadowOffset(s);
    const hex = shadowRgb(s.color);
    const n = parseInt(hex, 16);
    out.push(`drop-shadow(${num(dx / 9525)}px ${num(dy / 9525)}px ${num(s.blur / 9525 / 2)}px rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${num(s.alpha)}))`);
  }
  return out.join(" ");
}

/** Shadow offset in EMU (`Shadow::offset`). */
export function shadowOffset(s: Shadow): [number, number] {
  const a = (s.directionDeg * Math.PI) / 180;
  return [s.distance * Math.cos(a), s.distance * Math.sin(a)];
}

const lum = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;
const rgbOf = (hex: string) => {
  const n = parseInt(hex, 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const;
};

/** Whether the pixel pipeline changes anything (recolour, brightness or contrast). */
export function needsPixels(p: PictureProps | undefined): boolean {
  return !!p && ((p.recolor?.kind ?? "none") !== "none" || !!p.brightness || !!p.contrast);
}

/**
 * Applies recolour, then brightness/contrast to RGBA pixel data in place
 * (canvas `ImageData.data`): grayscale = luminance, sepia = duotone
 * black → D9C3A5, duotone `dark + L·(light − dark)`, black and white =
 * luminance < threshold → black, then `out = slope·in + intercept` per
 * channel (0…1).
 */
export function processPixels(data: Uint8ClampedArray | number[], p: PictureProps): void {
  const rc: Recolor = p.recolor ?? { kind: "none" };
  const [slope, icpt] = transfer(p);
  const linear = slope !== 1 || icpt !== 0;
  let dark: readonly number[] = [0, 0, 0];
  let light: readonly number[] = [255, 255, 255];
  if (rc.kind === "sepia") light = rgbOf("D9C3A5");
  if (rc.kind === "duotone") {
    dark = rgbOf(rc.value.dark);
    light = rgbOf(rc.value.light);
  }
  const threshold = rc.kind === "blackWhite" ? rc.value.threshold * 255 : 0;
  for (let i = 0; i + 3 < data.length; i += 4) {
    let r = data[i]!, g = data[i + 1]!, b = data[i + 2]!;
    if (rc.kind !== "none") {
      const l = lum(r, g, b);
      if (rc.kind === "grayscale") r = g = b = l;
      else if (rc.kind === "blackWhite") r = g = b = l < threshold ? 0 : 255;
      else {
        const t = l / 255;
        r = dark[0]! + t * (light[0]! - dark[0]!);
        g = dark[1]! + t * (light[1]! - dark[1]!);
        b = dark[2]! + t * (light[2]! - dark[2]!);
      }
    }
    if (linear) {
      r = (slope * (r / 255) + icpt) * 255;
      g = (slope * (g / 255) + icpt) * 255;
      b = (slope * (b / 255) + icpt) * 255;
    }
    data[i] = Math.max(0, Math.min(255, Math.round(r)));
    data[i + 1] = Math.max(0, Math.min(255, Math.round(g)));
    data[i + 2] = Math.max(0, Math.min(255, Math.round(b)));
  }
}

const processed = new Map<string, HTMLCanvasElement | null>();
/** Longest side of the processed bitmap (keeps big photos cheap). */
const MAX_SIDE = 1600;

/**
 * A canvas with the cropped (and, when needed, recoloured / corrected)
 * image, cached per image + crop + adjustments; `null` when no canvas is
 * available (tests) – then the plain image is drawn with Konva's crop.
 */
export function processedImage(img: HTMLImageElement, key: string, p: PictureProps | undefined): HTMLCanvasElement | null {
  const k = `${key.length}:${key.slice(-64)}|${JSON.stringify(p?.crop ?? null)}|${JSON.stringify(p?.recolor ?? null)}|${p?.brightness ?? 0}|${p?.contrast ?? 0}`;
  if (processed.has(k)) return processed.get(k)!;
  let out: HTMLCanvasElement | null = null;
  try {
    const w = img.naturalWidth, h = img.naturalHeight;
    const src = cropSource(p?.crop, w, h);
    const scale = Math.min(1, MAX_SIDE / Math.max(src.width, src.height, 1));
    const cw = Math.max(1, Math.round(src.width * scale)), ch = Math.max(1, Math.round(src.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext("2d");
    if (ctx && w > 0 && h > 0) {
      // the part of the image inside the source rectangle (negative crops pad with transparency)
      const sx = Math.max(0, src.x), sy = Math.max(0, src.y);
      const ex = Math.min(w, src.x + src.width), ey = Math.min(h, src.y + src.height);
      if (ex > sx && ey > sy) ctx.drawImage(img, sx, sy, ex - sx, ey - sy, (sx - src.x) * scale, (sy - src.y) * scale, (ex - sx) * scale, (ey - sy) * scale);
      if (needsPixels(p)) {
        const d = ctx.getImageData(0, 0, cw, ch);
        processPixels(d.data, p!);
        ctx.putImageData(d, 0, 0);
      }
      out = canvas;
    }
  } catch {
    out = null;
  }
  if (processed.size > 200) processed.delete(processed.keys().next().value!);
  processed.set(k, out);
  return out;
}

// ----- presets of the Picture Format tab -----------------------------------------------

/** Corrections › Brightness/Contrast grid: rows contrast −40…+40 %, columns brightness −40…+40 %. */
export const CORRECTION_STEPS = [-0.4, -0.2, 0, 0.2, 0.4];

/** Color › Recolor presets (with the theme's accents for duotone). */
export function recolorPresets(accents: string[]): { id: string; recolor: Recolor; labelKey: string; accent?: number }[] {
  return [
    { id: "none", recolor: { kind: "none" }, labelKey: "show.pic.noRecolor" },
    { id: "grayscale", recolor: { kind: "grayscale" }, labelKey: "show.pic.grayscale" },
    { id: "sepia", recolor: { kind: "sepia" }, labelKey: "show.pic.sepia" },
    { id: "bw25", recolor: { kind: "blackWhite", value: { threshold: 0.25 } }, labelKey: "show.pic.bw25" },
    { id: "bw50", recolor: { kind: "blackWhite", value: { threshold: 0.5 } }, labelKey: "show.pic.bw50" },
    { id: "bw75", recolor: { kind: "blackWhite", value: { threshold: 0.75 } }, labelKey: "show.pic.bw75" },
    ...accents.map((a, i) => ({
      id: `duo${i + 1}`,
      recolor: { kind: "duotone", value: { dark: darken(a), light: "FFFFFF" } } as Recolor,
      labelKey: "show.pic.duotone",
      accent: i + 1,
    })),
  ];
}

/** The accent at 25 % lightness – the dark end of an accent duotone. */
function darken(hex: string): string {
  const [r, g, b] = rgbOf(hex);
  return [r, g, b].map((v) => Math.round(v * 0.35).toString(16).padStart(2, "0")).join("").toUpperCase();
}

/** Color › Transparency presets. */
export const TRANSPARENCY_STEPS = [0, 0.15, 0.3, 0.5, 0.65, 0.8];

const black: Color = { kind: "rgb", value: "000000" };

/** Picture Effects › Shadow presets (outer shadows; `null` = no shadow). */
export const SHADOW_PRESETS: { id: string; labelKey: string; shadow: Shadow | null }[] = [
  { id: "none", labelKey: "show.pic.noShadow", shadow: null },
  { id: "br", labelKey: "show.pic.shadowBR", shadow: { color: black, alpha: 0.4, blur: 50800, distance: 38100, directionDeg: 45 } },
  { id: "b", labelKey: "show.pic.shadowB", shadow: { color: black, alpha: 0.4, blur: 50800, distance: 38100, directionDeg: 90 } },
  { id: "bl", labelKey: "show.pic.shadowBL", shadow: { color: black, alpha: 0.4, blur: 50800, distance: 38100, directionDeg: 135 } },
  { id: "r", labelKey: "show.pic.shadowR", shadow: { color: black, alpha: 0.4, blur: 50800, distance: 38100, directionDeg: 0 } },
  { id: "c", labelKey: "show.pic.shadowC", shadow: { color: black, alpha: 0.4, blur: 127000, distance: 0, directionDeg: 0 } },
  { id: "far", labelKey: "show.pic.shadowFar", shadow: { color: black, alpha: 0.35, blur: 152400, distance: 114300, directionDeg: 45 } },
];

const solidLine = (hex: string, widthPt: number): Line => ({ fill: { kind: "solid", value: { kind: "rgb", value: hex } }, width: Math.round(widthPt * 12700), dash: "solid" });
const noLine: Line = { fill: { kind: "none" }, width: 12700, dash: "solid" };

/** A Picture Styles gallery item: outline shape + border + shadow. */
export interface PictureStyle {
  id: string;
  labelKey: string;
  geometry: Preset | null;
  line: Line;
  shadow: Shadow | null;
}

/** Picture Styles (own combinations of shape, border and shadow). */
export const PICTURE_STYLES: PictureStyle[] = [
  { id: "plain", labelKey: "show.pic.style.plain", geometry: null, line: noLine, shadow: null },
  { id: "frame", labelKey: "show.pic.style.frame", geometry: null, line: solidLine("FFFFFF", 6), shadow: SHADOW_PRESETS[1]!.shadow },
  { id: "thinBlack", labelKey: "show.pic.style.thinBlack", geometry: null, line: solidLine("000000", 1.5), shadow: null },
  { id: "rounded", labelKey: "show.pic.style.rounded", geometry: "roundRect" as Preset, line: noLine, shadow: SHADOW_PRESETS[2]!.shadow },
  { id: "roundedFrame", labelKey: "show.pic.style.roundedFrame", geometry: "roundRect" as Preset, line: solidLine("FFFFFF", 4.5), shadow: SHADOW_PRESETS[1]!.shadow },
  { id: "oval", labelKey: "show.pic.style.oval", geometry: "ellipse" as Preset, line: noLine, shadow: null },
  { id: "ovalFrame", labelKey: "show.pic.style.ovalFrame", geometry: "ellipse" as Preset, line: solidLine("FFFFFF", 4.5), shadow: SHADOW_PRESETS[5]!.shadow },
  { id: "soft", labelKey: "show.pic.style.soft", geometry: null, line: noLine, shadow: SHADOW_PRESETS[6]!.shadow },
  { id: "snip", labelKey: "show.pic.style.snip", geometry: "snip1Rect" as Preset, line: solidLine("404040", 2.25), shadow: null },
  { id: "hexagon", labelKey: "show.pic.style.hexagon", geometry: "hexagon" as Preset, line: noLine, shadow: SHADOW_PRESETS[1]!.shadow },
];

/** The patch of a picture style (the border goes through `SetShapeStyle`). */
export function stylePatch(s: PictureStyle): PicturePatch {
  return { geometry: s.geometry, shadow: s.shadow };
}

/**
 * Cropping a picture by moving its crop handles: the new crop and box for
 * a handle drag (`dx`, `dy` EMU in the picture's unrotated frame) of
 * `edges` (`l`, `r`, `t`, `b`), PowerPoint-like: the image stays put,
 * the dragged edge moves. The visible part never drops below 1 % and the
 * crop may go negative (padding) when dragging outwards.
 */
export function dragCrop(
  crop: Crop | undefined,
  box: { x: number; y: number; w: number; h: number },
  edges: string,
  dx: number,
  dy: number,
): { crop: Crop; box: { x: number; y: number; w: number; h: number } } {
  const c = { ...NO_CROP, ...(crop ?? {}) };
  // full (uncropped) image size in EMU
  const fw = box.w / Math.max(0.01, 1 - c.left - c.right);
  const fh = box.h / Math.max(0.01, 1 - c.top - c.bottom);
  const out = { ...c };
  const b = { ...box };
  const min = 0.01;
  if (edges.includes("l")) {
    out.left = Math.min(c.left + dx / fw, 1 - c.right - min);
    b.x = box.x + (out.left - c.left) * fw;
  }
  if (edges.includes("r")) out.right = Math.min(c.right - dx / fw, 1 - out.left - min);
  if (edges.includes("t")) {
    out.top = Math.min(c.top + dy / fh, 1 - c.bottom - min);
    b.y = box.y + (out.top - c.top) * fh;
  }
  if (edges.includes("b")) out.bottom = Math.min(c.bottom - dy / fh, 1 - out.top - min);
  b.w = (1 - out.left - out.right) * fw;
  b.h = (1 - out.top - out.bottom) * fh;
  const r = (v: number) => Math.round(v * 100000) / 100000;
  return {
    crop: { left: r(out.left), top: r(out.top), right: r(out.right), bottom: r(out.bottom) },
    box: { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) },
  };
}

/** The whole image's box (crop undone) of a cropped picture's box – the dark area shown while cropping. */
export function fullImageBox(crop: Crop | undefined, box: { x: number; y: number; w: number; h: number }) {
  const c = crop ?? NO_CROP;
  const fw = box.w / Math.max(0.01, 1 - c.left - c.right);
  const fh = box.h / Math.max(0.01, 1 - c.top - c.bottom);
  return { x: box.x - c.left * fw, y: box.y - c.top * fh, w: fw, h: fh };
}
