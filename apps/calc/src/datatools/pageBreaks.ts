// Manual page breaks and Page Break Preview (P8-35): Page Layout › Breaks
// edits the sheet's breaks (a page starts before each listed row /
// column); the preview shows the printed area's pages (automatic breaks
// dashed, manual ones solid) and lets the user drag a break line.

import type { AxisGeometry } from "../grid/geometry";
import { DEFAULT_CALC_PRINT, paginate, printableArea, type CalcPrintOptions } from "../print/layout";

/** `breaks` with a break before `i` (sorted, unique). */
export function withBreak(breaks: readonly number[], i: number): number[] {
  return [...new Set([...breaks, i])].filter((b) => b > 0).sort((a, b) => a - b);
}

export function withoutBreak(breaks: readonly number[], i: number): number[] {
  return breaks.filter((b) => b !== i);
}

/** Whether the active cell has a manual break above its row / left of its column. */
export function manualBreakAt(rowBreaks: readonly number[], colBreaks: readonly number[], row: number, col: number): { row: boolean; col: boolean } {
  return { row: rowBreaks.includes(row), col: colBreaks.includes(col) };
}

/** A page break line of the preview. */
export interface BreakLine {
  axis: "rows" | "cols";
  /** The first line (row / column) of the next page. */
  index: number;
  manual: boolean;
}

/**
 * The page breaks of a sheet's used area `0..=lastRow × 0..=lastCol` with
 * the manual breaks, paginated like File › Print with the current print
 * settings (paper, orientation, margins, scaling; default: A4 portrait,
 * normal margins, 100 %), so that Page Break Preview and the print preview
 * agree.
 */
export function previewBreaks(
  colGeo: AxisGeometry, rowGeo: AxisGeometry, lastRow: number, lastCol: number, rowBreaks: readonly number[], colBreaks: readonly number[],
  options: CalcPrintOptions = DEFAULT_CALC_PRINT,
): BreakLine[] {
  const sizes = (geo: AxisGeometry, last: number) => Array.from({ length: last + 1 }, (_, i) => geo.size(i));
  const p = paginate(sizes(colGeo, lastCol), sizes(rowGeo, lastRow), options, printableArea(options), { rows: rowBreaks, cols: colBreaks });
  const starts = (key: "rows" | "cols") => [...new Set(p.pages.map((pg) => pg[key][0]))].filter((i) => i > 0).sort((a, b) => a - b);
  const out: BreakLine[] = [];
  for (const start of starts("rows")) out.push({ axis: "rows", index: start, manual: rowBreaks.includes(start) });
  for (const start of starts("cols")) out.push({ axis: "cols", index: start, manual: colBreaks.includes(start) });
  return out;
}

/** The pages (`[r0, r1)` × `[c0, c1)`) in print order (down, then over). */
export function previewPages(lines: readonly BreakLine[], lastRow: number, lastCol: number): { rows: [number, number]; cols: [number, number] }[] {
  const cut = (axis: "rows" | "cols", last: number) => {
    const at = [0, ...lines.filter((l) => l.axis === axis).map((l) => l.index), last + 1];
    return at.slice(1).map((e, i) => [at[i]!, e] as [number, number]);
  };
  const out = [];
  for (const cols of cut("cols", lastCol)) for (const rows of cut("rows", lastRow)) out.push({ rows, cols });
  return out;
}

/** Paints the preview over a viewport: grey outside the print area, the break lines and "Page n" watermarks. */
export function drawBreakPreview(
  ctx: CanvasRenderingContext2D, colGeo: AxisGeometry, rowGeo: AxisGeometry, lines: readonly BreakLine[], lastRow: number, lastCol: number,
  vp: { scrollX: number; scrollY: number; width: number; height: number }, pageLabel: (n: number) => string,
): void {
  const right = colGeo.offset(lastCol + 1) - vp.scrollX;
  const bottom = rowGeo.offset(lastRow + 1) - vp.scrollY;
  ctx.save();
  ctx.fillStyle = "rgba(128,128,128,0.35)";
  if (right < vp.width) ctx.fillRect(Math.max(0, right), 0, vp.width - Math.max(0, right), vp.height);
  if (bottom < vp.height) ctx.fillRect(0, Math.max(0, bottom), Math.max(0, Math.min(right, vp.width)), vp.height - Math.max(0, bottom));
  // Watermarks.
  ctx.fillStyle = "rgba(160,160,160,0.45)";
  ctx.font = "bold 48px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  previewPages(lines, lastRow, lastCol).forEach((p, i) => {
    const x0 = colGeo.offset(p.cols[0]) - vp.scrollX, x1 = colGeo.offset(p.cols[1]) - vp.scrollX;
    const y0 = rowGeo.offset(p.rows[0]) - vp.scrollY, y1 = rowGeo.offset(p.rows[1]) - vp.scrollY;
    if (x1 < 0 || y1 < 0 || x0 > vp.width || y0 > vp.height) return;
    ctx.fillText(pageLabel(i + 1), (x0 + x1) / 2, (y0 + y1) / 2);
  });
  ctx.strokeStyle = "#1f4fd1";
  for (const l of lines) {
    ctx.lineWidth = l.manual ? 2.5 : 1.5;
    ctx.setLineDash(l.manual ? [] : [6, 4]);
    ctx.beginPath();
    if (l.axis === "rows") {
      const y = Math.round(rowGeo.offset(l.index) - vp.scrollY) + 0.5;
      ctx.moveTo(0, y);
      ctx.lineTo(Math.min(right, vp.width), y);
    } else {
      const x = Math.round(colGeo.offset(l.index) - vp.scrollX) + 0.5;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, Math.min(bottom, vp.height));
    }
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.lineWidth = 2.5;
  ctx.strokeRect(-vp.scrollX + 1, -vp.scrollY + 1, Math.max(0, right + vp.scrollX - 2), Math.max(0, bottom + vp.scrollY - 2));
  ctx.restore();
}

/** The break line at a sheet point (within 4 px). */
export function breakLineAt(colGeo: AxisGeometry, rowGeo: AxisGeometry, lines: readonly BreakLine[], x: number, y: number): BreakLine | null {
  for (const l of lines) {
    const at = l.axis === "rows" ? rowGeo.offset(l.index) : colGeo.offset(l.index);
    if (Math.abs((l.axis === "rows" ? y : x) - at) <= 4) return l;
  }
  return null;
}
