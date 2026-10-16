// Chart anchors on the grid (pure): anchor ↔ sheet pixel rectangle, move
// and resize math with Excel's Alt-snap to cell edges, the 8 handles and
// the default place of a new chart.

import type { ChartAnchor } from "../generated/ChartAnchor";
import type { CellOffset } from "../generated/CellOffset";
import type { AxisGeometry } from "../grid/geometry";
import type { Range } from "../grid/Selection";

/** EMU per CSS pixel (914 400 per inch, 96 px per inch). */
export const EMU_PER_PX = 9525;
/** Excel's default chart size: 5 × 3 inches. */
export const DEFAULT_CHART_W = 480;
export const DEFAULT_CHART_H = 288;
/** Smallest chart size while resizing, px. */
export const MIN_CHART = 24;

export interface PxRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
export const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

const px = (emu: number) => emu / EMU_PER_PX;
const emu = (p: number) => Math.round(p * EMU_PER_PX);

/** Sheet px of a corner (cell edge plus offset). */
export function cornerPx(c: CellOffset, col: AxisGeometry, row: AxisGeometry): { x: number; y: number } {
  return { x: col.offset(c.col) + px(c.colOffset), y: row.offset(c.row) + px(c.rowOffset) };
}

/** The corner (cell + EMU offset) at sheet px x, y. */
export function cornerAt(x: number, y: number, col: AxisGeometry, row: AxisGeometry): CellOffset {
  const cx = Math.max(0, x);
  const cy = Math.max(0, y);
  const c = col.indexAt(cx);
  const r = row.indexAt(cy);
  return { col: c, row: r, colOffset: emu(Math.max(0, cx - col.offset(c))), rowOffset: emu(Math.max(0, cy - row.offset(r))) };
}

/** The sheet px rectangle of an anchor (hidden rows/columns have zero size). */
export function anchorRect(a: ChartAnchor, col: AxisGeometry, row: AxisGeometry): PxRect {
  if (a.type === "absolute") return { x: px(a.x), y: px(a.y), w: px(a.width), h: px(a.height) };
  const from = cornerPx(a.from, col, row);
  if (a.type === "oneCell") return { ...from, w: px(a.width), h: px(a.height) };
  const to = cornerPx(a.to, col, row);
  return { x: from.x, y: from.y, w: Math.max(0, to.x - from.x), h: Math.max(0, to.y - from.y) };
}

/** An anchor of the same kind as `like` for a sheet px rectangle. */
export function rectToAnchor(r: PxRect, like: ChartAnchor["type"], col: AxisGeometry, row: AxisGeometry): ChartAnchor {
  const x = Math.max(0, r.x);
  const y = Math.max(0, r.y);
  if (like === "absolute") return { type: "absolute", x: emu(x), y: emu(y), width: emu(r.w), height: emu(r.h) };
  const from = cornerAt(x, y, col, row);
  if (like === "oneCell") return { type: "oneCell", from, width: emu(r.w), height: emu(r.h) };
  return { type: "twoCell", from, to: cornerAt(x + r.w, y + r.h, col, row) };
}

/** Nearest cell edge to sheet offset `p`. */
export function nearestEdge(p: number, geo: AxisGeometry): number {
  const i = geo.indexAt(Math.max(0, p));
  const a = geo.offset(i);
  const b = geo.offset(i + 1);
  return p - a <= b - p ? a : b;
}

/** Moves by dx, dy (not past the sheet's top-left corner); `snap`: the top-left corner snaps to cell edges. */
export function moveRect(r: PxRect, dx: number, dy: number, snap?: { col: AxisGeometry; row: AxisGeometry }): PxRect {
  let x = Math.max(0, r.x + dx);
  let y = Math.max(0, r.y + dy);
  if (snap) {
    x = nearestEdge(x, snap.col);
    y = nearestEdge(y, snap.row);
  }
  return { x, y, w: r.w, h: r.h };
}

/** Resizes by dragging `handle` by dx, dy; the opposite edges stay; `snap` puts the dragged edges on cell edges. */
export function resizeRect(r: PxRect, handle: Handle, dx: number, dy: number, snap?: { col: AxisGeometry; row: AxisGeometry }): PxRect {
  let x0 = r.x;
  let y0 = r.y;
  let x1 = r.x + r.w;
  let y1 = r.y + r.h;
  if (handle.includes("w")) x0 = Math.max(0, Math.min(x1 - MIN_CHART, snap ? nearestEdge(x0 + dx, snap.col) : x0 + dx));
  if (handle.includes("e")) x1 = Math.max(x0 + MIN_CHART, snap ? nearestEdge(x1 + dx, snap.col) : x1 + dx);
  if (handle.includes("n")) y0 = Math.max(0, Math.min(y1 - MIN_CHART, snap ? nearestEdge(y0 + dy, snap.row) : y0 + dy));
  if (handle.includes("s")) y1 = Math.max(y0 + MIN_CHART, snap ? nearestEdge(y1 + dy, snap.row) : y1 + dy);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Handle centres of a rectangle. */
export function handlePoints(r: PxRect): { h: Handle; x: number; y: number }[] {
  const xs = { w: r.x, c: r.x + r.w / 2, e: r.x + r.w };
  const ys = { n: r.y, c: r.y + r.h / 2, s: r.y + r.h };
  return [
    { h: "nw", x: xs.w, y: ys.n }, { h: "n", x: xs.c, y: ys.n }, { h: "ne", x: xs.e, y: ys.n }, { h: "e", x: xs.e, y: ys.c },
    { h: "se", x: xs.e, y: ys.s }, { h: "s", x: xs.c, y: ys.s }, { h: "sw", x: xs.w, y: ys.s }, { h: "w", x: xs.w, y: ys.c },
  ];
}

/** The handle under sheet px x, y (hit squares up to 32 px, smaller on small charts). */
export function handleAt(r: PxRect, x: number, y: number): Handle | null {
  const slop = Math.max(4, Math.min(16, r.w / 6, r.h / 6));
  let best: Handle | null = null;
  let dist = Infinity;
  for (const p of handlePoints(r)) {
    const d = Math.max(Math.abs(p.x - x), Math.abs(p.y - y));
    if (d <= slop && d < dist) {
      best = p.h;
      dist = d;
    }
  }
  return best;
}

/** CSS cursor of a handle. */
export function handleCursor(h: Handle): string {
  return h === "n" || h === "s" ? "ns-resize" : h === "e" || h === "w" ? "ew-resize" : h === "nw" || h === "se" ? "nwse-resize" : "nesw-resize";
}

/** Where Insert › Chart puts a new chart: right of the selection (one column gap), top aligned, Excel's default size. */
export function insertRect(sel: Range, col: AxisGeometry, row: AxisGeometry): PxRect {
  const lastCol = Math.min(sel.c1, 16_380);
  return { x: col.offset(lastCol + 2), y: row.offset(Math.min(sel.r0, 1_048_000)), w: DEFAULT_CHART_W, h: DEFAULT_CHART_H };
}

/** Whether two sheet px rectangles overlap. */
export const rectsIntersect = (a: PxRect, b: PxRect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
