// Layout of a table in slide px: column and row positions (rows grow
// with their text like PowerPoint), the merged cells' rectangles and
// their text laid out with the style's text colour and weight. Shared by
// the renderer (`SlideView`), the editing overlay and the cell editor.

import type { ThemePalette } from "@rusuite/ui-shared";
import type { RunProperties } from "../../../../packages/ui-shared/src/generated/RunProperties";
import type { PlaceholderDef } from "../generated/PlaceholderDef";
import type { Table } from "../generated/Table";
import type { Theme } from "../generated/Theme";
import { emuToPx, PX_PER_PT } from "../geometry";
import { css, effectiveParagraph, effectiveRun, fontFamily } from "../model";
import { anchors, offsets, styleCell } from "../shapes/tables";
import { layoutText, measureText, type RunStyle, type TextLayout } from "../text/layout";

/** Resolves run formatting to a concrete style. */
export function runStyleFor(def: PlaceholderDef | undefined, theme: Theme, palette: ThemePalette, base?: { color?: string; bold?: boolean }) {
  return (props: RunProperties | undefined): RunStyle => {
    const r = effectiveRun(def, props);
    const ul = r.underline;
    return {
      fontFamily: fontFamily(r.font, theme),
      sizePx: ((r.size ?? 1800) / 100) * PX_PER_PT,
      bold: r.bold ?? base?.bold ?? false,
      italic: !!r.italic,
      underline: !!ul && ul !== "none",
      strike: !!r.strike,
      color: css(r.color, palette) ?? base?.color ?? css({ kind: "theme", value: { slot: "dark1", tint: 0 } }, palette) ?? "#000000",
      highlight: css(r.highlight, palette),
      verticalAlign: r.verticalAlign === "superscript" || r.verticalAlign === "subscript" ? r.verticalAlign : undefined,
    };
  };
}

export interface CellBox {
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
  /** Slide px relative to the table's top-left corner. */
  x: number;
  y: number;
  w: number;
  h: number;
  text: TextLayout;
}

export interface TableLayout {
  /** Column borders `[0, …, width]` (px). */
  colX: number[];
  /** Row borders `[0, …, height]` (px), rows grown to fit their text. */
  rowY: number[];
  cells: CellBox[];
}

/** The style's run defaults of a cell as CSS (text colour) and weight. */
export function cellRunBase(table: Table, row: number, col: number, palette: ThemePalette): { color?: string; bold?: boolean } {
  const s = styleCell(table, row, col);
  return { color: css(s.textColor, palette), bold: s.bold };
}

/** Lays the table out (`theme`/`palette` resolve fonts and colours). */
export function tableLayout(table: Table, theme: Theme, palette: ThemePalette): TableLayout {
  const colX = offsets(table.cols.map((c) => emuToPx(c.width)));
  const heights = table.rows.map((r) => emuToPx(r.height));
  const list = anchors(table);
  const lay = (a: (typeof list)[number], h: number) => {
    const w = colX[a.col + a.colSpan]! - colX[a.col]!;
    const body = table.cells[a.row]![a.col]!.text;
    return layoutText(body, {
      width: w,
      height: h,
      measure: measureText,
      runStyle: runStyleFor(undefined, theme, palette, cellRunBase(table, a.row, a.col, palette)),
      paragraphProps: (p) => effectiveParagraph(undefined, p),
    });
  };
  // Rows grow to the text of their single-row cells.
  for (const a of list) {
    if (a.rowSpan !== 1) continue;
    const need = lay(a, heights[a.row]!).height;
    if (need > heights[a.row]!) heights[a.row] = need;
  }
  const rowY = offsets(heights);
  const cells = list.map((a) => {
    const x = colX[a.col]!;
    const y = rowY[a.row]!;
    const w = colX[a.col + a.colSpan]! - x;
    const h = rowY[a.row + a.rowSpan]! - y;
    return { ...a, x, y, w, h, text: lay(a, h) };
  });
  return { colX, rowY, cells };
}

/** The cell (anchor) at a point of the table (px relative to its top-left corner), clamped to the grid. */
export function cellAt(layout: TableLayout, x: number, y: number): [number, number] {
  const find = (edges: number[], v: number) => {
    for (let i = 1; i < edges.length; i++) if (v < edges[i]!) return i - 1;
    return edges.length - 2;
  };
  return [Math.max(0, find(layout.rowY, y)), Math.max(0, find(layout.colX, x))];
}
