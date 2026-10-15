// Pure render list for the cell canvas, plus the (untested) canvas
// painters that execute it.

import type { BorderSide } from "../generated/BorderSide";
import type { BorderStyle } from "../generated/BorderStyle";
import type { CellStyle } from "../generated/CellStyle";
import type { CellView } from "../generated/CellView";
import type { CfResult } from "../generated/CfResult";
import type { IconSetKind } from "../generated/IconSetKind";
import type { ColView } from "../generated/ColView";
import type { Rect } from "../generated/Rect";
import type { RowView } from "../generated/RowView";
import type { AxisGeometry } from "./geometry";
import { colName } from "./address";
import { barSpan, cfKey, cfStyle, dataBarAxes, drawGlyph, iconGlyph, ICON_SIZE, NEGATIVE_BAR } from "./cf";
import { intersects, mergeAt } from "./merges";
import { axisSegments, type PaneLayout } from "./panes";
import { isWholeCols, isWholeRows, LAST_COL, type Range } from "./Selection";
import { approxMeasure, fitNumber, lineHeightPx, wrapLines, type Measure } from "./textLayout";
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
  /** Merged ranges (absent: none). */
  merges?: readonly Rect[];
  /** Conditional formatting results by `cfKey` (absent: none). */
  cf?: ReadonlyMap<number, CfResult>;
  /** Zero axes of the data bars by bar colour (see `dataBarAxes`; computed when absent). */
  barAxes?: ReadonlyMap<string, number>;
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
      /** Cell rect (alignment). */
      x: number;
      y: number;
      w: number;
      h: number;
      /** Horizontal clip span: the cell, or the empty neighbours text overflows into. */
      clipX: number;
      clipW: number;
      /** Wrapped lines (wrap text on); absent = one line. */
      lines?: string[];
      lineHeight?: number;
      align: TextAlign;
      valign: VAlignKind;
      font: string;
      color: string;
      underline: boolean;
      strike: boolean;
    }
  | { op: "line"; x1: number; y1: number; x2: number; y2: number; color: string; width: number; dash: number[] }
  /** A conditional-formatting data bar: the bar rect, its colour, and the zero axis (x) when the rule has negative values. */
  | { op: "bar"; row: number; col: number; x: number; y: number; w: number; h: number; color: string; negative: boolean; axisX?: number }
  /** A conditional-formatting icon (`index` into `ICON_SETS[set]`), `size` px square. */
  | { op: "icon"; row: number; col: number; x: number; y: number; size: number; set: IconSetKind; index: number };

export type TextOp = Extract<RenderOp, { op: "text" }>;

export const GRIDLINE_COLOR = "#e1e3e6";
export const TEXT_COLOR = "#000000";
export const CELL_PADDING = 3;
/** How far (columns) text may overflow into empty neighbours. */
const MAX_OVERFLOW_COLS = 32;

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
 * gridlines, gridline masks (under overflowing text), borders, texts.
 * Coordinates are relative to the cell area. `measure` sizes text (the
 * grid passes the canvas; the default is an estimate).
 *
 * Text that does not fit overflows into empty neighbours (left-aligned
 * to the right, right-aligned to the left, centred both ways), numbers
 * never overflow (`####`), and wrapped cells break into lines.
 *
 * A merged range paints as one cell: its top-left cell's fill and text
 * over the whole range (masking the inner gridlines, never overflowing),
 * borders only on its outer edges (each edge cell's own side).
 */
export function computeRenderOps(
  vp: Viewport, sheet: SheetData, styles: readonly CellStyle[], measure: Measure = approxMeasure, bg = "#ffffff",
): RenderOp[] {
  const { colGeo, rowGeo } = sheet;
  const vis = visibleRange(vp, colGeo, rowGeo);
  const fills: RenderOp[] = [];
  const bars: RenderOp[] = [];
  const icons: RenderOp[] = [];
  const masks: RenderOp[] = [];
  const lines: RenderOp[] = [];
  const texts: TextOp[] = [];
  const xs: number[] = [];
  const ys: number[] = [];

  // Text attributes per style id, resolved once per frame.
  const textStyles = new Map<number, Pick<TextOp, "valign" | "font" | "color" | "underline" | "strike">>();
  const colX: number[] = [];
  for (let c = vis.c0; c <= vis.c1 + 1; c++) colX.push(colGeo.offset(c) - vp.scrollX);
  const xOf = (c: number) => (c >= vis.c0 && c <= vis.c1 + 1 ? colX[c - vis.c0] : colGeo.offset(c) - vp.scrollX);
  const styleIdAt = (rowCells: Map<number, CellView> | undefined, rowStyle: number | null, c: number) => {
    const cell = rowCells?.get(c);
    return cell ? cell.style : (rowStyle ?? sheet.cols.get(c)?.style ?? 0);
  };
  const cfMap = sheet.cf;
  const cfAt = cfMap && cfMap.size > 0 ? (r: number, c: number) => cfMap.get(cfKey(r, c)) : () => undefined;
  const hasFill = (id: number, r: number, c: number) => {
    if (styleAt(styles, id).fill?.kind === "solid") return true;
    const cf = cfAt(r, c);
    return !!cf && (!!cf.color || !!cf.dxf?.fill);
  };
  const resolveText = (style: CellStyle) => {
    const u = style.font?.underline;
    return {
      valign: verticalAlign(style),
      font: fontCss(style),
      color: colorCss(style.font?.color) ?? TEXT_COLOR,
      underline: !!u && u !== "none",
      strike: !!style.font?.strike,
    };
  };
  const textAttrs = (styleId: number, style: CellStyle, cf?: CfResult) => {
    // A highlight rule's format is per cell: not cached.
    if (cf?.dxf) return resolveText(cfStyle(style, cf));
    let t = textStyles.get(styleId);
    if (!t) {
      t = resolveText(style);
      textStyles.set(styleId, t);
    }
    return t;
  };
  let axes = sheet.barAxes;
  const axisOf = (cf: CfResult) => {
    axes ??= cfMap ? dataBarAxes(cfMap, (r, c) => sheet.cells.get(r)?.get(c)) : new Map();
    return cf.barColor ? axes.get(JSON.stringify(cf.barColor)) : undefined;
  };
  /** Data bar and icon of a cell (or merged range) at its rect. */
  const decorate = (r: number, c: number, cf: CfResult, x: number, y: number, w: number, h: number) => {
    if (cf.bar !== undefined && cf.barColor) {
      const axis = axisOf(cf);
      const span = barSpan(cf.bar, axis);
      const inner = Math.max(0, w - 4);
      const bx = x + 2 + span.from * inner;
      const bw = (span.to - span.from) * inner;
      const color = span.negative ? NEGATIVE_BAR : (colorCss(cf.barColor) ?? "#638EC6");
      if (bw > 0 && h > 4) {
        bars.push({ op: "bar", row: r, col: c, x: bx, y: y + 2, w: bw, h: h - 5, color, negative: span.negative, ...(axis !== undefined ? { axisX: x + 2 + axis * inner } : {}) });
      }
    }
    if (cf.icon !== undefined && cf.iconSet) {
      const size = Math.min(ICON_SIZE, h - 2);
      if (size > 4) icons.push({ op: "icon", row: r, col: c, x: x + 2, y: y + (h - size) / 2, size, set: cf.iconSet, index: cf.icon });
    }
  };
  // Text may come from up to MAX_OVERFLOW_COLS columns outside the view.
  const t0 = Math.max(0, vis.c0 - MAX_OVERFLOW_COLS);
  const t1 = Math.min(LAST_COL, vis.c1 + MAX_OVERFLOW_COLS);

  // Merged ranges: their cells are skipped below and painted as one.
  const merges = sheet.merges ?? [];
  const visMerges = merges.filter((m) => intersects(m, vis));
  const covered = new Set<number>();
  for (const m of visMerges) {
    for (let r = Math.max(m.r0, vis.r0); r <= Math.min(m.r1, vis.r1); r++) {
      for (let c = Math.max(m.c0, vis.c0); c <= Math.min(m.c1, vis.c1); c++) covered.add(r * (LAST_COL + 1) + c);
    }
  }
  const textSpan = { r0: vis.r0, r1: vis.r1, c0: t0, c1: t1 };
  const textMerges = merges.length === 0 ? [] : merges.filter((m) => intersects(m, textSpan));

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
      if (covered.size > 0 && covered.has(r * (LAST_COL + 1) + c)) continue;
      const cell = rowCells?.get(c);
      const styleId = styleIdAt(rowCells, rowStyle, c);
      const cf = cfAt(r, c);
      if (styleId === 0 && !cell && !cf) continue;
      const style = cfStyle(styleAt(styles, styleId), cf);
      if (cf) decorate(r, c, cf, x, y, w, h);
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
    }
    if (!rowCells) continue;
    const rowMerges = textMerges.filter((m) => m.r0 <= r && r <= m.r1);
    const merged = (c: number) => rowMerges.some((m) => c >= m.c0 && c <= m.c1);
    const isEmpty = (c: number) => (rowCells.get(c)?.display ?? "") === "" && !merged(c);
    for (const [c, cell] of rowCells) {
      if (c < t0 || c > t1 || cell.display === "") continue;
      if (rowMerges.length > 0 && merged(c)) continue;
      const cf = cfAt(r, c);
      if (cf?.hideValue) continue;
      // An icon sits at the left edge: the text starts after it.
      const shift = cf?.icon !== undefined && cf.iconSet ? ICON_SIZE + 2 : 0;
      const x = xOf(c) + shift;
      const w = colGeo.size(c) - shift;
      if (w <= 0) continue;
      const styleId = cell.style;
      const style = styleAt(styles, styleId);
      const t = textAttrs(styleId, style, cf);
      const align = horizontalAlign(style, cell.kind);
      const avail = w - 2 * CELL_PADDING;
      const base = { op: "text" as const, row: r, col: c, x, y, w, h, align, ...t };
      if (style.alignment?.wrapText) {
        if (c < vis.c0 || c > vis.c1) continue;
        const wrapped = wrapLines(cell.display, avail, t.font, measure);
        texts.push({ ...base, text: cell.display, clipX: x, clipW: w, lines: wrapped, lineHeight: lineHeightPx(t.font) });
        continue;
      }
      let text = cell.display.includes("\n") ? cell.display.replace(/\n/g, " ") : cell.display;
      if (cell.kind === "number") {
        if (c < vis.c0 || c > vis.c1) continue;
        const code = style.numberFormat;
        text = fitNumber(text, avail, t.font, measure, !code || code.trim().toLowerCase() === "general");
        texts.push({ ...base, text, clipX: x, clipW: w });
        continue;
      }
      // Overflow into empty neighbours (text, booleans and errors alike).
      let clipX = x;
      let clipW = w;
      const need = measure(text, t.font) - avail;
      if (need > 0) {
        const grow = (dir: 1 | -1, budget: number) => {
          let got = 0;
          for (let k = c + dir, n = 0; budget > got && n < MAX_OVERFLOW_COLS && k >= 0 && k <= LAST_COL && isEmpty(k); k += dir, n++) {
            const kw = colGeo.size(k);
            const edge = dir === 1 ? xOf(k) : xOf(k + 1);
            if (kw > 0 && !hasFill(styleIdAt(rowCells, rowStyle, k), r, k) && !hasFill(styleIdAt(rowCells, rowStyle, k - dir), r, k - dir)) {
              masks.push({ op: "fill", x: Math.round(edge) - 1, y, w: 1, h: h - 1, color: bg });
            }
            got += kw;
            if (dir === 1) clipW += kw;
            else {
              clipX -= kw;
              clipW += kw;
            }
          }
        };
        if (align === "left") grow(1, need);
        else if (align === "right") grow(-1, need);
        else {
          grow(-1, need / 2);
          grow(1, need / 2);
        }
      }
      if (clipX + clipW < 0 || clipX > vp.width) continue;
      texts.push({ ...base, text, clipX, clipW });
    }
  }
  for (const m of visMerges) {
    const x = xOf(m.c0);
    const w = xOf(m.c1 + 1) - x;
    const y = rowGeo.offset(m.r0) - vp.scrollY;
    const h = rowGeo.offset(m.r1 + 1) - vp.scrollY - y;
    if (w <= 0 || h <= 0) continue;
    const anchorRow = sheet.cells.get(m.r0);
    const styleId = styleIdAt(anchorRow, sheet.rows.get(m.r0)?.style ?? null, m.c0);
    const cf = cfAt(m.r0, m.c0);
    const style = cfStyle(styleAt(styles, styleId), cf);
    const fill = style.fill?.kind === "solid" ? colorCss(style.fill.color) : undefined;
    // Covers the inner gridlines; the outer right/bottom ones stay.
    masks.push({ op: "fill", x, y, w: w - 1, h: h - 1, color: fill ?? bg });
    const sideOf = (row: number, col: number) => styleAt(styles, styleIdAt(sheet.cells.get(row), sheet.rows.get(row)?.style ?? null, col)).borders;
    for (let c = Math.max(m.c0, vis.c0); c <= Math.min(m.c1, vis.c1); c++) {
      const cx = xOf(c), cw = xOf(c + 1) - cx;
      if (cw === 0) continue;
      const top = sideOf(m.r0, c)?.top;
      const bottom = sideOf(m.r1, c)?.bottom;
      if (top) lines.push(borderLine(top, cx, y, cx + cw, y));
      if (bottom) lines.push(borderLine(bottom, cx, y + h, cx + cw, y + h));
    }
    for (let r = Math.max(m.r0, vis.r0); r <= Math.min(m.r1, vis.r1); r++) {
      const ry = rowGeo.offset(r) - vp.scrollY, rh = rowGeo.size(r);
      if (rh === 0) continue;
      const left = sideOf(r, m.c0)?.left;
      const right = sideOf(r, m.c1)?.right;
      if (left) lines.push(borderLine(left, x, ry, x, ry + rh));
      if (right) lines.push(borderLine(right, x + w, ry, x + w, ry + rh));
    }
    if (cf) decorate(m.r0, m.c0, cf, x, y, w, h);
    const cell = anchorRow?.get(m.c0);
    if (!cell || cell.display === "" || cf?.hideValue) continue;
    const t = textAttrs(styleId, styleAt(styles, styleId), cf);
    const align = horizontalAlign(style, cell.kind);
    const avail = w - 2 * CELL_PADDING;
    const base = { op: "text" as const, row: m.r0, col: m.c0, x, y, w, h, align, ...t, clipX: x, clipW: w };
    if (style.alignment?.wrapText) {
      texts.push({ ...base, text: cell.display, lines: wrapLines(cell.display, avail, t.font, measure), lineHeight: lineHeightPx(t.font) });
    } else if (cell.kind === "number") {
      const code = style.numberFormat;
      texts.push({ ...base, text: fitNumber(cell.display, avail, t.font, measure, !code || code.trim().toLowerCase() === "general") });
    } else {
      texts.push({ ...base, text: cell.display.replace(/\n/g, " ") });
    }
  }
  texts.sort((a, b) => a.row - b.row || a.col - b.col);
  for (let c = vis.c0; c <= vis.c1; c++) {
    if (colGeo.size(c) > 0) xs.push(colX[c - vis.c0 + 1]);
  }
  return [...fills, ...bars, { op: "gridlines", xs, ys, width: vp.width, height: vp.height }, ...masks, ...lines, ...icons, ...texts];
}

// --- canvas painters (not unit-tested; jsdom has no canvas) -------------

export function prepareCanvas(canvas: HTMLCanvasElement, width: number, height: number, zoom = 1): CanvasRenderingContext2D | null {
  // Zoomed grids (CSS `zoom`) get a denser backing store, so text stays sharp.
  const dpr = (window.devicePixelRatio || 1) * zoom;
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

/** Paints `ops`; with `bg`, the whole canvas is cleared to it first (`null`: draw over what is there). */
export function drawOps(ctx: CanvasRenderingContext2D, ops: RenderOp[], bg: string | null): void {
  if (bg !== null) {
    const { width, height } = ctx.canvas;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }
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
      case "bar": {
        // Excel's gradient fill: the colour fading to white, with a border in the colour.
        const g = ctx.createLinearGradient(o.negative ? o.x + o.w : o.x, 0, o.negative ? o.x : o.x + o.w, 0);
        g.addColorStop(0, o.color);
        g.addColorStop(1, "#ffffff");
        ctx.fillStyle = g;
        ctx.fillRect(o.x, o.y, o.w, o.h);
        ctx.strokeStyle = o.color;
        ctx.lineWidth = 1;
        ctx.strokeRect(Math.round(o.x) + 0.5, Math.round(o.y) + 0.5, Math.max(0, Math.round(o.w) - 1), Math.max(0, Math.round(o.h) - 1));
        if (o.axisX !== undefined) {
          ctx.beginPath();
          ctx.strokeStyle = "#000000";
          ctx.setLineDash([1, 1]);
          ctx.moveTo(Math.round(o.axisX) + 0.5, o.y - 1);
          ctx.lineTo(Math.round(o.axisX) + 0.5, o.y + o.h + 1);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        break;
      }
      case "icon": {
        const glyph = iconGlyph(o.set, o.index);
        if (glyph) drawGlyph(ctx, glyph, o.x, o.y, o.size);
        break;
      }
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
        const tx = o.align === "left" ? o.x + CELL_PADDING : o.align === "right" ? o.x + o.w - CELL_PADDING - 1 : o.x + o.w / 2;
        if (o.lines) {
          // Wrapped: lines stacked from the vertical alignment, clipped to the cell.
          const lh = o.lineHeight ?? 20;
          const total = lh * o.lines.length;
          const top = o.valign === "top" ? o.y + 1 : o.valign === "middle" ? o.y + (o.h - total) / 2 : o.y + o.h - total - 1;
          ctx.save();
          ctx.beginPath();
          ctx.rect(o.x, o.y, o.w - 1, o.h - 1);
          ctx.clip();
          ctx.textBaseline = "middle";
          o.lines.forEach((line, i) => {
            const ly = top + lh * i + lh / 2;
            ctx.fillText(line, tx, ly);
            if (o.underline || o.strike) decorate(ctx, o, line, tx, ly, "middle");
          });
          ctx.restore();
          break;
        }
        ctx.textBaseline = o.valign === "top" ? "top" : o.valign === "middle" ? "middle" : "bottom";
        const ty = o.valign === "top" ? o.y + 2 : o.valign === "middle" ? o.y + o.h / 2 : o.y + o.h - 3;
        const m = ctx.measureText(o.text);
        // Clip only when the text does not fit its span: clipping is costly.
        const clip = m.width > o.clipW - 2 * CELL_PADDING || o.h < 16;
        if (clip) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(o.clipX, o.y, o.clipW - 1, o.h - 1);
          ctx.clip();
        }
        ctx.fillText(o.text, tx, ty);
        if (o.underline || o.strike) decorate(ctx, o, o.text, tx, ty, o.valign);
        if (clip) ctx.restore();
        break;
      }
    }
  }
}

/** Underline / strike-through of one line of text. */
function decorate(
  ctx: CanvasRenderingContext2D, o: TextOp, text: string, tx: number, ty: number, valign: VAlignKind,
): void {
  const m = ctx.measureText(text);
  const x0 = o.align === "left" ? tx : o.align === "right" ? tx - m.width : tx - m.width / 2;
  const asc = m.actualBoundingBoxAscent || 8;
  const base = valign === "top" ? ty + asc : valign === "middle" ? ty + asc / 2 : ty;
  ctx.fillRect(x0, o.underline ? base + 1 : base - asc / 2.5, Math.min(m.width, o.clipW), 1);
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
  // The active cell (a whole merged range when it is merged).
  const am = mergeAt(sheet.merges ?? [], active.row, active.col) ?? { r0: active.row, c0: active.col, r1: active.row, c1: active.col };
  const ax = colGeo.offset(am.c0) - vp.scrollX;
  const ay = rowGeo.offset(am.r0) - vp.scrollY;
  const aw = colGeo.offset(am.c1 + 1) - colGeo.offset(am.c0), ah = rowGeo.offset(am.r1 + 1) - rowGeo.offset(am.r0);
  if (range.r0 !== am.r0 || range.r1 !== am.r1 || range.c0 !== am.c0 || range.c1 !== am.c1) {
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

/** A range outlined while a formula is edited (Excel's coloured reference boxes). */
export interface RefHighlight {
  range: Range;
  color: string;
  /** The reference being pointed at is drawn dashed. */
  dashed: boolean;
}

/** Clipped pixel rect of a range in the cell canvas, `null` when off screen. */
export function rangeRect(vp: Viewport, sheet: SheetData, range: Range): { x: number; y: number; w: number; h: number } | null {
  const { colGeo, rowGeo } = sheet;
  const x0 = colGeo.offset(range.c0) - vp.scrollX;
  const x1 = colGeo.offset(range.c1 + 1) - vp.scrollX;
  const y0 = rowGeo.offset(range.r0) - vp.scrollY;
  const y1 = rowGeo.offset(range.r1 + 1) - vp.scrollY;
  const x = Math.max(-4, x0), y = Math.max(-4, y0);
  const w = Math.min(vp.width + 4, x1) - x, h = Math.min(vp.height + 4, y1) - y;
  return w <= 0 || h <= 0 ? null : { x, y, w, h };
}

export function drawRefHighlights(ctx: CanvasRenderingContext2D, vp: Viewport, sheet: SheetData, marks: RefHighlight[]): void {
  for (const m of marks) {
    const r = rangeRect(vp, sheet, m.range);
    if (!r) continue;
    ctx.fillStyle = `${m.color}1a`;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = m.color;
    ctx.lineWidth = 2;
    ctx.setLineDash(m.dashed ? [5, 3] : []);
    ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
    ctx.setLineDash([]);
    if (!m.dashed) {
      ctx.fillStyle = m.color;
      for (const [cx, cy] of [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]]) ctx.fillRect(cx - 2.5, cy - 2.5, 5, 5);
    }
  }
}

/** Colour of the frozen-panes divider lines. */
export const FREEZE_LINE = "#8a8a8a";

/**
 * Column and row headers plus the corner box; with frozen panes the
 * frozen headers stay put and the rest scroll (one clipped stretch each).
 */
/** Row numbers of filtered data rows (Excel paints them blue). */
export const FILTERED_ROW_COLOR = "#1a5fb4";

/** Text colour of row number `r`: white when its whole row is selected, blue in a filtered range. */
export function rowHeaderColor(r: number, selected: boolean, blueRows: { r0: number; r1: number } | null | undefined, fg: string): string {
  if (selected) return "#ffffff";
  return blueRows && r >= blueRows.r0 && r <= blueRows.r1 ? FILTERED_ROW_COLOR : fg;
}

export function drawHeaders(
  ctx: CanvasRenderingContext2D, l: PaneLayout, sheet: SheetData, range: Range, colors: { bg: string; fg: string; line: string; active: string },
  blueRows: { r0: number; r1: number } | null = null,
): void {
  const { colGeo, rowGeo } = sheet;
  const fullW = HEADER_W + l.width, fullH = HEADER_H + l.height;
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
  for (const seg of axisSegments(l.frozenW, l.scrollX, l.width)) {
    if (seg.size <= 0) continue;
    ctx.save();
    ctx.beginPath();
    ctx.rect(HEADER_W + seg.at, 0, seg.size, HEADER_H);
    ctx.clip();
    ctx.beginPath();
    const [c0, c1] = colGeo.visibleRange(seg.scroll, seg.size);
    for (let c = c0; c <= c1; c++) {
      const w = colGeo.size(c);
      if (w === 0) continue;
      const x = HEADER_W + seg.at + colGeo.offset(c) - seg.scroll;
      if (c >= range.c0 && c <= range.c1) {
        ctx.fillStyle = colsSel ? "#217346" : colors.active;
        ctx.fillRect(x, 0, w, HEADER_H);
      }
      ctx.fillStyle = colsSel && c >= range.c0 && c <= range.c1 ? "#ffffff" : colors.fg;
      ctx.fillText(colName(c), x + w / 2, HEADER_H / 2 + 1);
      ctx.moveTo(Math.round(x + w) - 0.5, 0);
      ctx.lineTo(Math.round(x + w) - 0.5, HEADER_H);
    }
    ctx.stroke();
    ctx.restore();
  }
  for (const seg of axisSegments(l.frozenH, l.scrollY, l.height)) {
    if (seg.size <= 0) continue;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, HEADER_H + seg.at, HEADER_W, seg.size);
    ctx.clip();
    ctx.beginPath();
    const [r0, r1] = rowGeo.visibleRange(seg.scroll, seg.size);
    for (let r = r0; r <= r1; r++) {
      const h = rowGeo.size(r);
      if (h === 0) continue;
      const y = HEADER_H + seg.at + rowGeo.offset(r) - seg.scroll;
      if (r >= range.r0 && r <= range.r1) {
        ctx.fillStyle = rowsSel ? "#217346" : colors.active;
        ctx.fillRect(0, y, HEADER_W, h);
      }
      ctx.fillStyle = rowHeaderColor(r, rowsSel && r >= range.r0 && r <= range.r1, blueRows, colors.fg);
      ctx.fillText(String(r + 1), HEADER_W / 2, y + h / 2 + 1);
      ctx.moveTo(0, Math.round(y + h) - 0.5);
      ctx.lineTo(HEADER_W, Math.round(y + h) - 0.5);
    }
    ctx.stroke();
    ctx.restore();
  }
  ctx.beginPath();
  ctx.moveTo(0, HEADER_H - 0.5);
  ctx.lineTo(fullW, HEADER_H - 0.5);
  ctx.moveTo(HEADER_W - 0.5, 0);
  ctx.lineTo(HEADER_W - 0.5, fullH);
  ctx.stroke();
  // Corner box (clears what scrolled under it).
  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, HEADER_W - 1, HEADER_H - 1);
}

/** The frozen-panes divider lines in the cell canvas. */
export function drawFreezeLines(ctx: CanvasRenderingContext2D, l: PaneLayout): void {
  if (l.frozenW <= 0 && l.frozenH <= 0) return;
  ctx.save();
  ctx.strokeStyle = FREEZE_LINE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (l.frozenW > 0 && l.frozenW < l.width) {
    ctx.moveTo(Math.round(l.frozenW) - 0.5, 0);
    ctx.lineTo(Math.round(l.frozenW) - 0.5, l.height);
  }
  if (l.frozenH > 0 && l.frozenH < l.height) {
    ctx.moveTo(0, Math.round(l.frozenH) - 0.5);
    ctx.lineTo(l.width, Math.round(l.frozenH) - 0.5);
  }
  ctx.stroke();
  ctx.restore();
}
