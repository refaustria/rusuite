// The used range of a sheet as a plain table model (rendered as HTML).

import type { CSSProperties } from "react";
import type { BorderSide } from "../generated/BorderSide";
import type { BorderStyle } from "../generated/BorderStyle";
import type { CellStyle } from "../generated/CellStyle";
import { colWidthPx, rowHeightPx } from "../grid/geometry";
import type { SheetCache } from "../state/store";
import { colorCss, fontFamily, fontPx, horizontalAlign, styleAt, verticalAlign } from "../grid/style";

export interface PrintCell {
  col: number;
  text: string;
  style: CSSProperties;
  /** Top-left cell of a merged range: how many printed rows/columns it spans. */
  span?: { rows: number; cols: number };
  /** Covered by a merged range (printed by its top-left cell). */
  covered?: boolean;
}

export interface PrintRow {
  row: number;
  /** CSS px. */
  height: number;
  cells: PrintCell[];
}

export interface PrintTable {
  /** Visible columns: index and width in CSS px. */
  cols: { col: number; width: number }[];
  rows: PrintRow[];
  width: number;
  height: number;
}

const BORDER_CSS: Record<BorderStyle, string> = {
  thin: "1px solid", medium: "2px solid", thick: "3px solid", dashed: "1px dashed", dotted: "1px dotted", double: "3px double", hair: "1px dotted",
};

const border = (b: BorderSide | null | undefined): string | undefined =>
  b ? `${BORDER_CSS[b.style] ?? "1px solid"} ${colorCss(b.color) ?? "#000"}` : undefined;

/** Inline CSS of one cell. */
export function cellCss(style: CellStyle, kind: Parameters<typeof horizontalAlign>[1]): CSSProperties {
  const css: CSSProperties = {
    fontFamily: fontFamily(style),
    fontSize: `${fontPx(style).toFixed(2)}px`,
    color: colorCss(style.font?.color) ?? "#000000",
    textAlign: horizontalAlign(style, kind),
    verticalAlign: verticalAlign(style),
  };
  if (style.font?.bold) css.fontWeight = "bold";
  if (style.font?.italic) css.fontStyle = "italic";
  const deco = [style.font?.underline && style.font.underline !== "none" ? "underline" : "", style.font?.strike ? "line-through" : ""].filter(Boolean).join(" ");
  if (deco) css.textDecoration = deco;
  if (style.fill?.kind === "solid") css.backgroundColor = colorCss(style.fill.color);
  const b = style.borders;
  if (b) {
    css.borderTop = border(b.top);
    css.borderBottom = border(b.bottom);
    css.borderLeft = border(b.left);
    css.borderRight = border(b.right);
  }
  return css;
}

/**
 * Builds the table for rows/cols `firstRow..=lastRow × firstCol..=lastCol`
 * of a sheet cache (a selection; default from A1); hidden rows and columns
 * are left out. Cell style resolution is as on the canvas (cell → row →
 * column → default).
 */
export function buildPrintTable(cache: SheetCache, styles: readonly CellStyle[], lastRow: number, lastCol: number, firstRow = 0, firstCol = 0): PrintTable {
  const cols: PrintTable["cols"] = [];
  for (let c = firstCol; c <= lastCol; c++) {
    const v = cache.cols.get(c);
    if (v?.hidden) continue;
    cols.push({ col: c, width: v?.width != null ? colWidthPx(v.width) : colWidthPx(cache.format.defaultColWidth) });
  }
  const rows: PrintRow[] = [];
  for (let r = firstRow; r <= lastRow; r++) {
    const v = cache.rows.get(r);
    if (v?.hidden) continue;
    const height = v?.height != null ? rowHeightPx(v.height) : rowHeightPx(cache.format.defaultRowHeight);
    const rowCells = cache.cells.get(r);
    const cells: PrintCell[] = cols.map(({ col }) => {
      const cell = rowCells?.get(col);
      const id = cell ? cell.style : (v?.style ?? cache.cols.get(col)?.style ?? 0);
      return { col, text: cell?.display ?? "", style: cellCss(styleAt(styles, id), cell?.kind ?? "empty") };
    });
    rows.push({ row: r, height, cells });
  }
  // Merged ranges: the first printed cell of each spans the printed part of it; the rest are covered.
  const colAt = new Map(cols.map((c, i) => [c.col, i]));
  const rowAt = new Map(rows.map((r, i) => [r.row, i]));
  for (const m of cache.merges) {
    const r0 = Math.max(m.r0, firstRow), r1 = Math.min(m.r1, lastRow);
    const c0 = Math.max(m.c0, firstCol), c1 = Math.min(m.c1, lastCol);
    if (r0 > r1 || c0 > c1) continue;
    const ris: number[] = [];
    const cis: number[] = [];
    for (let r = r0; r <= r1; r++) if (rowAt.has(r)) ris.push(rowAt.get(r)!);
    for (let c = c0; c <= c1; c++) if (colAt.has(c)) cis.push(colAt.get(c)!);
    if (ris.length === 0 || cis.length === 0 || ris.length * cis.length === 1) continue;
    for (const ri of ris) for (const ci of cis) rows[ri]!.cells[ci]!.covered = true;
    const lead = rows[ris[0]!]!.cells[cis[0]!]!;
    const anchor = cache.cells.get(m.r0)?.get(m.c0);
    const styleOf = (r: number, c: number) => styleAt(styles, cache.cells.get(r)?.get(c)?.style ?? cache.rows.get(r)?.style ?? cache.cols.get(c)?.style ?? 0);
    const css = cellCss(styleOf(m.r0, m.c0), anchor?.kind ?? "empty");
    css.borderRight = cellCss(styleOf(m.r0, m.c1), "empty").borderRight;
    css.borderBottom = cellCss(styleOf(m.r1, m.c0), "empty").borderBottom;
    Object.assign(lead, { text: anchor?.display ?? "", style: css, span: { rows: ris.length, cols: cis.length }, covered: false });
  }
  return {
    cols,
    rows,
    width: cols.reduce((s, c) => s + c.width, 0),
    height: rows.reduce((s, r) => s + r.height, 0),
  };
}
