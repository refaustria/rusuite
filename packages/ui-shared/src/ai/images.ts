// Pictures for the assistant (P9-A1): a picture of the document, a slide or a chart becomes an image content block
// of the next turn. Anthropic's recommendation: at most 1568 px on the long side (larger images are scaled down by
// the API anyway and cost more tokens); at most 5 MB per image. Everything happens on this device (an offscreen
// canvas); nothing is fetched – the sources are the documents' own media (object / data URLs) and canvases.

import type { ChartScene } from "../chart";
import { drawChartScene } from "../chart";
import type { ResolvedChart } from "../chart/model";
import { AiError, type AiImage } from "./types";

/** The long side a picture is scaled down to (px). */
export const IMAGE_MAX_SIDE = 1568;
/** The largest image sent (bytes of the encoded file; the API's per-image limit is 5 MB). */
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
/** Media types the providers accept as image blocks. */
export const IMAGE_TYPES: readonly AiImage["mediaType"][] = ["image/png", "image/jpeg", "image/gif", "image/webp"];

const isImageType = (t: string): t is AiImage["mediaType"] => (IMAGE_TYPES as readonly string[]).includes(t);

/** `w × h` scaled to fit `max` on the long side (never up); `scaled`: whether it changed. */
export function fitWithin(w: number, h: number, max = IMAGE_MAX_SIDE): { width: number; height: number; scaled: boolean } {
  const long = Math.max(w, h);
  if (long <= max || long <= 0) return { width: Math.max(1, Math.round(w)), height: Math.max(1, Math.round(h)), scaled: false };
  const k = max / long;
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)), scaled: true };
}

/** Decoded bytes of a base64 string. */
export function base64Size(b64: string): number {
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
}

/** `data:<type>;base64,<data>` → its parts (`null` for other URLs). */
export function parseDataUrl(url: string): { mediaType: string; data: string } | null {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(url);
  return m ? { mediaType: m[1]!.toLowerCase(), data: m[2]!.replace(/\s+/g, "") } : null;
}

/** A decoded picture: its natural size and a way to draw it. */
export interface Raster {
  width: number;
  height: number;
  draw(ctx: CanvasRenderingContext2D, width: number, height: number): void;
}

/** How pictures are decoded and encoded (the browser's by default; tests pass their own). */
export interface ImageCodec {
  load(url: string): Promise<Raster>;
  /** `raster` drawn at `width × height`, encoded as a data URL of `type` (JPEG on white, at `quality`). */
  encode(raster: Raster, width: number, height: number, type: "image/png" | "image/jpeg", quality?: number): string;
}

export const browserCodec: ImageCodec = {
  load: (url) =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = "async";
      img.onload = () =>
        resolve({ width: img.naturalWidth || img.width, height: img.naturalHeight || img.height, draw: (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h) });
      img.onerror = () => reject(new AiError("imageUnsupported", "This picture cannot be read (its format is not supported here)"));
      img.src = url;
    }),
  encode: (raster, width, height, type, quality) => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new AiError("imageUnsupported", "No canvas to prepare the picture");
    if (type === "image/jpeg") {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
    }
    raster.draw(ctx, width, height);
    return canvas.toDataURL(type, quality);
  },
};

/** Encodings tried in turn until one fits `IMAGE_MAX_BYTES`. */
const ENCODINGS: { type: "image/png" | "image/jpeg"; quality?: number }[] = [{ type: "image/png" }, { type: "image/jpeg", quality: 0.85 }, { type: "image/jpeg", quality: 0.7 }];

/** A raster as an image block: scaled to `IMAGE_MAX_SIDE`, PNG (JPEG when the PNG is over 5 MB). */
export function encodeRaster(raster: Raster, label: string, codec: ImageCodec = browserCodec, maxSide = IMAGE_MAX_SIDE): AiImage {
  const fit = fitWithin(raster.width, raster.height, maxSide);
  for (const e of ENCODINGS) {
    const parsed = parseDataUrl(codec.encode(raster, fit.width, fit.height, e.type, e.quality));
    if (!parsed || !isImageType(parsed.mediaType)) throw new AiError("imageUnsupported", "The picture could not be prepared");
    if (base64Size(parsed.data) <= IMAGE_MAX_BYTES) return { mediaType: parsed.mediaType, data: parsed.data, width: fit.width, height: fit.height, label };
  }
  throw new AiError("imageTooLarge", "The picture is larger than 5 MB even after scaling it down");
}

/**
 * A picture at `url` (object or data URL of the document's own media) as an image block. A data URL of a type the
 * providers accept that is small enough already is sent as it is; anything else is redrawn at most 1568 px on the
 * long side.
 */
export async function imageFromUrl(url: string, label: string, codec: ImageCodec = browserCodec): Promise<AiImage> {
  const raster = await codec.load(url);
  if (!raster.width || !raster.height) throw new AiError("imageUnsupported", "This picture has no size");
  const data = parseDataUrl(url);
  const fit = fitWithin(raster.width, raster.height);
  if (data && isImageType(data.mediaType) && !fit.scaled && base64Size(data.data) <= IMAGE_MAX_BYTES) {
    return { mediaType: data.mediaType, data: data.data, width: raster.width, height: raster.height, label };
  }
  return encodeRaster(raster, label, codec);
}

/** A chart scene drawn at `scale` on white (charts may have a transparent area) as an image block. */
export function chartImage(scene: ChartScene, width: number, height: number, label: string, codec: ImageCodec = browserCodec, scale = 2): AiImage {
  const raster: Raster = {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    draw: (ctx, w, h) => {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
      ctx.scale(w / width, h / height);
      drawChartScene(ctx, scene);
    },
  };
  return encodeRaster(raster, label, codec);
}

const cell = (v: string) => v.replace(/[\t\r\n]+/g, " ").trim();

/**
 * A chart's data as a tab-separated table (categories down, one column per series; scatter charts list x and y)
 * – sent with the chart's picture so that the model reads exact values instead of estimating them from pixels.
 */
export function chartDataTable(data: ResolvedChart, maxRows = 500): string {
  const series = data.series;
  if (!series.length) return "(no data)";
  const lines: string[] = [];
  if (data.title) lines.push(`Title: ${cell(data.title)}`);
  const scatter = series.some((s) => s.xValues?.length);
  const num = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? "" : String(v));
  if (scatter) {
    lines.push(["Series", "x", "y"].join("\t"));
    for (const s of series) {
      const n = Math.min(maxRows, Math.max(s.values.length, s.xValues?.length ?? 0));
      for (let i = 0; i < n; i++) lines.push([cell(s.name), num(s.xValues?.[i]), num(s.values[i])].join("\t"));
    }
    return lines.join("\n");
  }
  const categories = series.reduce<string[]>((a, s) => (s.categories.length > a.length ? s.categories : a), []);
  const rows = Math.min(maxRows, Math.max(categories.length, ...series.map((s) => s.values.length)));
  lines.push(["Category", ...series.map((s, i) => cell(s.name) || `Series ${i + 1}`)].join("\t"));
  for (let i = 0; i < rows; i++) lines.push([cell(categories[i] ?? String(i + 1)), ...series.map((s) => num(s.values[i]))].join("\t"));
  return lines.join("\n");
}
