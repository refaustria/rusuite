// Conditional formatting on the client (pure): the core computes each
// cell's `CfResult` (snapshot `cf`); this module turns it into what the
// canvas and the print view draw – the differential format over the cell
// style, data bars (with a negative axis), colour-scale fills and the
// vector glyphs of the icon sets.

import type { CellStyle } from "../generated/CellStyle";
import type { CellView } from "../generated/CellView";
import type { CfResult } from "../generated/CfResult";
import type { DxfStyle } from "../generated/DxfStyle";
import type { IconSetKind } from "../generated/IconSetKind";
import { LAST_COL } from "./Selection";

/** Key of a cell in a sheet's `cf` map. */
export const cfKey = (row: number, col: number): number => row * (LAST_COL + 1) + col;

/** The cell style with a highlight rule's differential format applied over it. */
export function withDxf(style: CellStyle, dxf: DxfStyle | undefined): CellStyle {
  if (!dxf) return style;
  const out: CellStyle = { ...style };
  if (dxf.fontColor || dxf.bold !== undefined || dxf.italic !== undefined || dxf.underline !== undefined || dxf.strike !== undefined) {
    const font = { ...style.font };
    if (dxf.fontColor) font.color = dxf.fontColor;
    if (dxf.bold !== undefined) font.bold = dxf.bold;
    if (dxf.italic !== undefined) font.italic = dxf.italic;
    if (dxf.underline !== undefined) font.underline = dxf.underline ? "single" : "none";
    if (dxf.strike !== undefined) font.strike = dxf.strike;
    out.font = font;
  }
  if (dxf.fill) out.fill = { kind: "solid", color: dxf.fill };
  if (dxf.borders) {
    const b = { ...style.borders };
    for (const side of ["left", "right", "top", "bottom"] as const) {
      const v = dxf.borders[side];
      if (v) b[side] = v;
    }
    out.borders = b;
  }
  if (dxf.numberFormat) out.numberFormat = dxf.numberFormat;
  return out;
}

/** The cell style as conditional formatting shows it: the dxf, then a colour scale's fill (unless the dxf fills). */
export function cfStyle(style: CellStyle, cf: CfResult | undefined): CellStyle {
  if (!cf) return style;
  let out = withDxf(style, cf.dxf);
  if (cf.color && !cf.dxf?.fill) out = { ...out, fill: { kind: "solid", color: cf.color } };
  return out;
}

// --- data bars -------------------------------------------------------------

/** Excel's default fill of negative data bars. */
export const NEGATIVE_BAR = "#FF0000";

/** A cell's number for the bar axis: a plain numeric input, else the shown value without grouping. */
export function cellNumber(c: CellView | undefined): number | null {
  if (!c || c.kind !== "number") return null;
  const src = c.input !== "" && !c.input.startsWith("=") ? c.input : c.display;
  const n = Number(src.replace(/[\s,]/g, "").replace(/%$/, ""));
  if (!Number.isFinite(n)) return null;
  return src.trim().endsWith("%") ? n / 100 : n;
}

/**
 * Where the zero axis of each data bar rule sits (fraction of the cell
 * width), keyed by the bar colour: the core sends `bar = (v − min) / (max
 * − min)` per cell, so the axis is that line at `v = 0`, fitted from the
 * cells with the smallest and largest value. Only rules with negative
 * values get an axis.
 */
export function dataBarAxes(cf: ReadonlyMap<number, CfResult>, cellAt: (row: number, col: number) => CellView | undefined): Map<string, number> {
  const ext = new Map<string, { lo: [number, number]; hi: [number, number] }>();
  for (const [key, r] of cf) {
    if (r.bar === undefined || !r.barColor) continue;
    const v = cellNumber(cellAt(Math.floor(key / (LAST_COL + 1)), key % (LAST_COL + 1)));
    if (v === null) continue;
    const id = JSON.stringify(r.barColor);
    const e = ext.get(id);
    if (!e) ext.set(id, { lo: [v, r.bar], hi: [v, r.bar] });
    else {
      if (v < e.lo[0]) e.lo = [v, r.bar];
      if (v > e.hi[0]) e.hi = [v, r.bar];
    }
  }
  const out = new Map<string, number>();
  for (const [id, { lo, hi }] of ext) {
    if (lo[0] >= 0 || hi[0] === lo[0]) continue;
    const slope = (hi[1] - lo[1]) / (hi[0] - lo[0]);
    const axis = lo[1] - slope * lo[0];
    if (axis > 0 && axis < 1) out.set(id, axis);
  }
  return out;
}

/** Shortest data bar (fraction of the cell): Excel keeps the lowest value visible. */
export const MIN_BAR = 0.1;

/**
 * The bar of one cell: `[x0, x1]` as fractions of the cell width, and
 * whether it is negative. Without an axis the bar runs from 10 % (lowest
 * value) to the full width, as Excel draws it.
 */
export function barSpan(bar: number, axis: number | undefined): { from: number; to: number; negative: boolean } {
  const b = Math.max(0, Math.min(1, bar));
  if (axis === undefined) return { from: 0, to: MIN_BAR + (1 - MIN_BAR) * b, negative: false };
  return b < axis ? { from: b, to: axis, negative: true } : { from: axis, to: b, negative: false };
}

// --- icon sets ---------------------------------------------------------------

/** One filled (optionally stroked) path of a 16 × 16 glyph. */
export interface GlyphPart {
  d: string;
  fill: string;
  stroke?: string;
}
export type Glyph = GlyphPart[];

const RED = "#E0393E";
const YELLOW = "#F5B800";
const GREEN = "#2E9E48";
const GRAY = "#7F7F7F";
const BLACK = "#3A3A3A";
const PINK = "#F1959B";
const BLUE = "#2F6EB5";
const OFF = "#C9C9C9";

const P = {
  up: "M8 1 L14.5 8 H10.5 V15 H5.5 V8 H1.5 Z",
  down: "M8 15 L14.5 8 H10.5 V1 H5.5 V8 H1.5 Z",
  right: "M15 8 L8.5 1.5 V5.5 H1 V10.5 H8.5 V14.5 Z",
  upRight: "M14.5 1.5 V11 L11.3 7.8 L4.5 14.6 L1.4 11.5 L8.2 4.7 L5 1.5 Z",
  downRight: "M14.5 14.5 H5 L8.2 11.3 L1.4 4.5 L4.5 1.4 L11.3 8.2 L14.5 5 Z",
  circle: "M8 1.5 A6.5 6.5 0 1 1 7.99 1.5 Z",
  triangle: "M8 1.5 L15 14.5 H1 Z",
  diamond: "M8 1 L15 8 L8 15 L1 8 Z",
  pole: "M3 1 H4.6 V15 H3 Z",
  flag: "M4.6 1.5 L14.5 5.2 L4.6 9 Z",
  check: "M1.5 8.5 L4.2 5.8 L6.8 8.4 L12.6 2.6 L15.3 5.3 L6.8 13.8 Z",
  cross: "M3.2 1 L8 5.8 L12.8 1 L15 3.2 L10.2 8 L15 12.8 L12.8 15 L8 10.2 L3.2 15 L1 12.8 L5.8 8 L1 3.2 Z",
  exclaim: "M6.4 1 H9.6 L9 10.2 H7 Z M6.5 11.8 H9.5 V15 H6.5 Z",
  checkSmall: "M4 8.4 L5.6 6.8 L7 8.2 L10.5 4.7 L12.1 6.3 L7 11.4 Z",
  crossSmall: "M5.2 4 L8 6.8 L10.8 4 L12 5.2 L9.2 8 L12 10.8 L10.8 12 L8 9.2 L5.2 12 L4 10.8 L6.8 8 L4 5.2 Z",
  exclaimSmall: "M7 3.2 H9 L8.7 9 H7.3 Z M7 10.4 H9 V12.6 H7 Z",
};

const solid = (d: string, fill: string, stroke?: string): GlyphPart => (stroke ? { d, fill, stroke } : { d, fill });
const circled = (fill: string, symbol: string): Glyph => [solid(P.circle, fill), solid(symbol, "#FFFFFF")];
const flag = (fill: string): Glyph => [solid(P.pole, "#595959"), solid(P.flag, fill)];
/** Signal bars: `on` of `n` filled. */
const bars = (on: number, n: number): Glyph =>
  Array.from({ length: n }, (_, i) => {
    const w = 12 / n;
    const h = 3 + (11 * (i + 1)) / n;
    const x = 2 + i * w;
    return solid(`M${x.toFixed(2)} ${(15 - h).toFixed(2)} H${(x + w - 1).toFixed(2)} V15 H${x.toFixed(2)} Z`, i < on ? BLUE : OFF);
  });
/** A pie of `q` quarters in an outlined circle. */
const quarters = (q: number): Glyph => {
  const ring = solid(P.circle, "#FFFFFF", BLACK);
  if (q === 0) return [ring];
  if (q === 4) return [solid(P.circle, BLACK)];
  const arc = ["", "M8 8 V1.5 A6.5 6.5 0 0 1 14.5 8 Z", "M8 8 V1.5 A6.5 6.5 0 0 1 8 14.5 Z", "M8 8 V1.5 A6.5 6.5 0 1 1 1.5 8 Z"][q]!;
  return [ring, solid(arc, BLACK)];
};
const arrow = (d: string, fill: string): Glyph => [solid(d, fill)];
const dot = (fill: string, rim = false): Glyph => [solid(P.circle, fill, rim ? BLACK : undefined)];

/** The icons of each set, lowest values first (Excel's order reversed: its galleries list the best first). */
export const ICON_SETS: Record<IconSetKind, Glyph[]> = {
  "3Arrows": [arrow(P.down, RED), arrow(P.right, YELLOW), arrow(P.up, GREEN)],
  "3ArrowsGray": [arrow(P.down, GRAY), arrow(P.right, GRAY), arrow(P.up, GRAY)],
  "3Flags": [flag(RED), flag(YELLOW), flag(GREEN)],
  "3TrafficLights1": [dot(RED), dot(YELLOW), dot(GREEN)],
  "3TrafficLights2": [dot(RED, true), dot(YELLOW, true), dot(GREEN, true)],
  "3Signs": [[solid(P.diamond, RED)], [solid(P.triangle, YELLOW)], dot(GREEN)],
  "3Symbols": [circled(RED, P.crossSmall), circled(YELLOW, P.exclaimSmall), circled(GREEN, P.checkSmall)],
  "3Symbols2": [[solid(P.cross, RED)], [solid(P.exclaim, YELLOW)], [solid(P.check, GREEN)]],
  "4Arrows": [arrow(P.down, RED), arrow(P.downRight, YELLOW), arrow(P.upRight, YELLOW), arrow(P.up, GREEN)],
  "4ArrowsGray": [arrow(P.down, GRAY), arrow(P.downRight, GRAY), arrow(P.upRight, GRAY), arrow(P.up, GRAY)],
  "4RedToBlack": [dot(BLACK), dot(GRAY), dot(PINK), dot(RED)],
  "4Rating": [bars(1, 4), bars(2, 4), bars(3, 4), bars(4, 4)],
  "4TrafficLights": [dot(BLACK, true), dot(RED, true), dot(YELLOW, true), dot(GREEN, true)],
  "5Arrows": [arrow(P.down, RED), arrow(P.downRight, YELLOW), arrow(P.right, YELLOW), arrow(P.upRight, YELLOW), arrow(P.up, GREEN)],
  "5ArrowsGray": [arrow(P.down, GRAY), arrow(P.downRight, GRAY), arrow(P.right, GRAY), arrow(P.upRight, GRAY), arrow(P.up, GRAY)],
  "5Rating": [bars(0, 4), bars(1, 4), bars(2, 4), bars(3, 4), bars(4, 4)],
  "5Quarters": [quarters(0), quarters(1), quarters(2), quarters(3), quarters(4)],
};

/** Number of icons of a set. */
export const iconCount = (set: IconSetKind): number => ICON_SETS[set].length;

/** The glyph of icon `index` of `set` (`undefined` when out of range). */
export function iconGlyph(set: IconSetKind, index: number): Glyph | undefined {
  return ICON_SETS[set][index];
}

/** Icon size on the canvas, CSS px (Excel: 16 px at 100 %). */
export const ICON_SIZE = 16;

/** Paints a glyph scaled into `size` × `size` px at (`x`, `y`). Not unit-tested (no Path2D in jsdom). */
export function drawGlyph(ctx: CanvasRenderingContext2D, glyph: Glyph, x: number, y: number, size: number): void {
  if (typeof Path2D === "undefined") return;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 16, size / 16);
  for (const part of glyph) {
    const p = new Path2D(part.d);
    ctx.fillStyle = part.fill;
    ctx.fill(p, "evenodd");
    if (part.stroke) {
      ctx.strokeStyle = part.stroke;
      ctx.lineWidth = 1;
      ctx.stroke(p);
    }
  }
  ctx.restore();
}
