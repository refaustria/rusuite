// Pure render list for the cell canvas, plus the (untested) canvas
// painters that execute it.

import type { BorderSide } from "../generated/BorderSide";
import type { BorderStyle } from "../generated/BorderStyle";
import type { CellStyle } from "../generated/CellStyle";
import type { CellView } from "../generated/CellView";
import type { ColView } from "../generated/ColView";
import type { RowView } from "../generated/RowView";
import type { AxisGeometry } from "./geometry";
import { colName } from "./address";
import { isWholeCols, isWholeRows, type Range } from "./Selection";
import {
  colorCss, fontCss, horizontalAlign, styleAt, verticalAlign, type TextAlign, type VAlignKind,
} from "./style";

/** Scroll position and size of the cell area (headers excluded), CSS px. */
export interface Viewport {
  scrollX: number;
  scrollY: number;
  width: number;
  height: number;
}

/** What the renderer reads from a sheet's cache. */
export interface SheetData {
  cells: Map<number, Map<number, CellView>>;
  cols: Map<number, ColView>;
  rows: Map<number, RowView>;
  colGeo: AxisGeometry;
  rowGeo: AxisGeometry;
}

export interface VisibleRange {
  r0: number;
  r1: number;
  c0: number;
  c1: number;
}

export type RenderOp =
  | { op: "fill"; x: number; y: number; w: number; h: number; color: string }
  | { op: "gridlines"; xs: number[]; ys: number[]; width: number; height: number }
  | {
      op: "text";
      row: number;
      col: number;
      text: string;
      /** Cell rect (clip). */
      x: number;
      y: number;
      w: number;
      h: number;
      align: TextAlign;
      valign: VAlignKind;
      font: string;
      color: string;
      underline: boolean;
      strike: boolean;
    }
  | { op: "line"; x1: number; y1: number; x2: number; y2: number; color: string; width: number; dash: number[] };

export const GRIDLINE_COLOR = "#e1e3e6";
export const TEXT_COLOR = "#000000";
export const CELL_PADDING = 3;

export function visibleRange(vp: Viewport, colGeo: AxisGeometry, rowGeo: AxisGeometry): VisibleRange {
  const [c0, c1] = colGeo.visibleRange(vp.scrollX, vp.width);
  const [r0, r1] = rowGeo.visibleRange(vp.scrollY, vp.height);
  return { r0, r1, c0, c1 };
}

function borderLine(side: BorderSide, x1: number, y1: number, x2: number, y2: number): RenderOp {
  const widths: Record<BorderStyle, number> = { thin: 1, medium: 2, thick: 3, dashed: 1, dotted: 1, double: 3, hair: 1 };
  const dashes: Partial<Record<BorderStyle, number[]>> = { dashed: [4, 2], dotted: [1, 2], hair: [1, 1] };
  return {
    op: "line", x1, y1, x2, y2,
    color: colorCss(side.color) ?? TEXT_COLOR,
    width: widths[side.style] ?? 1,
    dash: dashes[side.style] ?? [],
  };
}

/**
 * Draw ops for the visible part of a sheet, in paint order: fills,
 * gridlines, borders, texts. Coordinates are relative to the cell area.
 */
export function computeRenderOps(vp: Viewport, sheet: SheetData, styles: readonly CellStyle[]): RenderOp[] {
  const { colGeo, rowGeo } = sheet;
  const vis = visibleRange(vp, colGeo, rowGeo);
  const fills: RenderOp[] = [];
  const lines: RenderOp[] = [];
  const texts: RenderOp[] = [];
  const xs: number[] = [];
  const ys: number[] = [];

  // Text attributes per style id, resolved once per frame.
  const textStyles = new Map<number, Pick<Extract<RenderOp, { op: "text" }>, "valign" | "font" | "color" | "underline" | "strike">>();
  const colX: number[] = [];
  for (let c = vis.c0; c <= vis.c1 + 1; c++) colX.push(colGeo.offset(c) - vp.scrollX);
  for (let r = vis.r0; r <= vis.r1; r++) {
    const y = rowGeo.offset(r) - vp.scrollY;
    const h = rowGeo.size(r);
    if (h === 0) continue;
    ys.push(y + h);
    const rowCells = sheet.cells.get(r);
    const rowStyle = sheet.rows.get(r)?.style ?? null;
    for (let c = vis.c0; c <= vis.c1; c++) {
      const x = colX[c - vis.c0];
      const w = colX[c - vis.c0 + 1] - x;
      if (w === 0) continue;
      const cell = rowCells?.get(c);
      const styleId = cell ? cell.style : (rowStyle ?? sheet.cols.get(c)?.style ?? 0);
      if (styleId === 0 && !cell) continue;
      const style = styleAt(styles, styleId);
      if (style.fill?.kind === "solid") {
        const color = colorCss(style.fill.color);
        if (color) fills.push({ op: "fill", x, y, w, h, color });
      }
      const b = style.borders;
      if (b) {
        if (b.top) lines.push(borderLine(b.top, x, y, x + w, y));
        if (b.bottom) lines.push(borderLine(b.bottom, x, y + h, x + w, y + h));
        if (b.left) lines.push(borderLine(b.left, x, y, x, y + h));
        if (b.right) lines.push(borderLine(b.right, x + w, y, x + w, y + h));
      }
      if (cell && cell.display !== "") {
        let t = textStyles.get(styleId);
        if (!t) {
          const u = style.font?.underline;
          t = {
            valign: verticalAlign(style),
            font: fontCss(style),
            color: colorCss(style.font?.color) ?? TEXT_COLOR,
            underline: !!u && u !== "none",
            strike: !!style.font?.strike,
          };
          textStyles.set(styleId, t);
        }
        texts.push({ op: "text", row: r, col: c, text: cell.display, x, y, w, h, align: horizontalAlign(style, cell.kind), ...t });
      }
    }
  }
  for (let c = vis.c0; c <= vis.c1; c++) {
    if (colGeo.size(c) > 0) xs.push(colX[c - vis.c0 + 1]);
  }
  return [...fills, { op: "gridlines", xs, ys, width: vp.width, height: vp.height }, ...lines, ...texts];
}

// --- canvas painters (not unit-tested; jsdom has no canvas) -------------

export function prepareCanvas(canvas: HTMLCanvasElement, width: number, height: number): CanvasRenderingContext2D | null {
  const dpr = window.devicePixelRatio || 1;
  const pw = Math.max(1, Math.floor(width * dpr));
  const ph = Math.max(1, Math.floor(height * dpr));
  if (canvas.width !== pw || canvas.height !== ph) {
    canvas.width = pw;
    canvas.height = ph;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

export function drawOps(ctx: CanvasRenderingContext2D, ops: RenderOp[], bg: string): void {
  const { width, height } = ctx.canvas;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
  for (const o of ops) {
    switch (o.op) {
      case "fill":
        ctx.fillStyle = o.color;
        ctx.fillRect(o.x, o.y, o.w, o.h);
        break;
      case "gridlines":
        ctx.beginPath();
        ctx.strokeStyle = GRIDLINE_COLOR;
        ctx.lineWidth = 1;
        for (const x of o.xs) {
          ctx.moveTo(Math.round(x) - 0.5, 0);
          ctx.lineTo(Math.round(x) - 0.5, o.height);
        }
        for (const y of o.ys) {
          ctx.moveTo(0, Math.round(y) - 0.5);
          ctx.lineTo(o.width, Math.round(y) - 0.5);
        }
        ctx.stroke();
        break;
      case "line":
        ctx.beginPath();
        ctx.strokeStyle = o.color;
        ctx.lineWidth = o.width;
        ctx.setLineDash(o.dash);
        ctx.moveTo(Math.round(o.x1) - 0.5, Math.round(o.y1) - 0.5);
        ctx.lineTo(Math.round(o.x2) - 0.5, Math.round(o.y2) - 0.5);
        ctx.stroke();
        ctx.setLineDash([]);
        break;
      case "text": {
        if (ctx.font !== o.font) ctx.font = o.font;
        if (ctx.fillStyle !== o.color) ctx.fillStyle = o.color;
        ctx.textAlign = o.align;
        ctx.textBaseline = o.valign === "top" ? "top" : o.valign === "middle" ? "middle" : "bottom";
        const tx = o.align === "left" ? o.x + CELL_PADDING : o.align === "right" ? o.x + o.w - CELL_PADDING - 1 : o.x + o.w / 2;
        const ty = o.valign === "top" ? o.y + 2 : o.valign === "middle" ? o.y + o.h / 2 : o.y + o.h - 3;
        const m = ctx.measureText(o.text);
        // Clip (wrap off) only when the text does not fit: clipping is costly.
        const clip = m.width > o.w - 2 * CELL_PADDING || o.h < 16;
        if (clip) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(o.x, o.y, o.w - 1, o.h - 1);
          ctx.clip();
        }
        ctx.fillText(o.text, tx, ty);
        if (o.underline || o.strike) {
          const x0 = o.align === "left" ? tx : o.align === "right" ? tx - m.width : tx - m.width / 2;
          const asc = m.actualBoundingBoxAscent || 8;
          const base = o.valign === "top" ? ty + asc : o.valign === "middle" ? ty + asc / 2 : ty;
          ctx.fillRect(x0, o.underline ? base + 1 : base - asc / 2.5, Math.min(m.width, o.w), 1);
        }
        if (clip) ctx.restore();
        break;
      }
    }
  }
}

export const HEADER_W = 46;
export const HEADER_H = 22;

/** Selection overlay in the cell area: range tint, border, active cell. */
export function drawSelection(
  ctx: CanvasRenderingContext2D, vp: Viewport, sheet: SheetData, range: Range, active: { row: number; col: number },
): void {
  const { colGeo, rowGeo } = sheet;
  const x0 = colGeo.offset(range.c0) - vp.scrollX;
  const x1 = colGeo.offset(range.c1 + 1) - vp.scrollX;
  const y0 = rowGeo.offset(range.r0) - vp.scrollY;
  const y1 = rowGeo.offset(range.r1 + 1) - vp.scrollY;
  const cx = Math.max(-4, x0), cy = Math.max(-4, y0);
  const cw = Math.min(vp.width + 4, x1) - cx, ch = Math.min(vp.height + 4, y1) - cy;
  if (cw <= 0 || ch <= 0) return;
  const ax = colGeo.offset(active.col) - vp.scrollX;
  const ay = rowGeo.offset(active.row) - vp.scrollY;
  const aw = colGeo.size(active.col), ah = rowGeo.size(active.row);
  if (range.r0 !== range.r1 || range.c0 !== range.c1) {
    ctx.fillStyle = "rgba(33, 115, 70, 0.12)";
    ctx.beginPath();
    ctx.rect(cx, cy, cw, ch);
    ctx.rect(ax, ay, aw, ah);
    ctx.fill("evenodd");
  }
  ctx.strokeStyle = "#217346";
  ctx.lineWidth = 2;
  ctx.strokeRect(cx, cy, cw - 1, ch - 1);
}

/** Column and row headers plus the corner box. */
export function drawHeaders(
  ctx: CanvasRenderingContext2D, vp: Viewport, sheet: SheetData, range: Range, colors: { bg: string; fg: string; line: string; active: string },
): void {
  const { colGeo, rowGeo } = sheet;
  const vis = visibleRange(vp, colGeo, rowGeo);
  const fullW = HEADER_W + vp.width, fullH = HEADER_H + vp.height;
  ctx.clearRect(0, 0, fullW, fullH);
  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, fullW, HEADER_H);
  ctx.fillRect(0, 0, HEADER_W, fullH);
  ctx.font = `12px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.strokeStyle = colors.line;
  ctx.lineWidth = 1;
  const rowsSel = isWholeRows(range), colsSel = isWholeCols(range);
  ctx.beginPath();
  for (let c = vis.c0; c <= vis.c1; c++) {
    const w = colGeo.size(c);
    if (w === 0) continue;
    const x = HEADER_W + colGeo.offset(c) - vp.scrollX;
    if (c >= range.c0 && c <= range.c1) {
      ctx.fillStyle = colsSel ? "#217346" : colors.active;
      ctx.fillRect(x, 0, w, HEADER_H);
    }
    ctx.fillStyle = colsSel && c >= range.c0 && c <= range.c1 ? "#ffffff" : colors.fg;
    ctx.fillText(colName(c), x + w / 2, HEADER_H / 2 + 1);
    ctx.moveTo(Math.round(x + w) - 0.5, 0);
    ctx.lineTo(Math.round(x + w) - 0.5, HEADER_H);
  }
  for (let r = vis.r0; r <= vis.r1; r++) {
    const h = rowGeo.size(r);
    if (h === 0) continue;
    const y = HEADER_H + rowGeo.offset(r) - vp.scrollY;
    if (r >= range.r0 && r <= range.r1) {
      ctx.fillStyle = rowsSel ? "#217346" : colors.active;
      ctx.fillRect(0, y, HEADER_W, h);
    }
    ctx.fillStyle = rowsSel && r >= range.r0 && r <= range.r1 ? "#ffffff" : colors.fg;
    ctx.fillText(String(r + 1), HEADER_W / 2, y + h / 2 + 1);
    ctx.moveTo(0, Math.round(y + h) - 0.5);
    ctx.lineTo(HEADER_W, Math.round(y + h) - 0.5);
  }
  ctx.moveTo(0, HEADER_H - 0.5);
  ctx.lineTo(fullW, HEADER_H - 0.5);
  ctx.moveTo(HEADER_W - 0.5, 0);
  ctx.lineTo(HEADER_W - 0.5, fullH);
  ctx.stroke();
  // Corner box (clears what scrolled under it).
  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, HEADER_W - 1, HEADER_H - 1);
}
