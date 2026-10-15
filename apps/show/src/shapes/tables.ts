// Tables in slides: the built-in table styles (as the core draws Medium
// Style 2, for any accent), the cell grid with merged cells, keyboard
// navigation between cells, cell ranges, and the commands of the Table
// Design / Layout tabs (pure, unit-tested).

import type { Color } from "../../../../packages/ui-shared/src/generated/Color";
import type { ThemeColorSlot } from "../../../../packages/ui-shared/src/generated/ThemeColorSlot";
import type { Alignment } from "../generated/Alignment";
import type { Anchor } from "../generated/Anchor";
import type { Fill } from "../generated/Fill";
import type { Insets } from "../generated/Insets";
import type { Line } from "../generated/Line";
import type { NodeId } from "../generated/NodeId";
import type { ShowCommand } from "../generated/ShowCommand";
import type { Table } from "../generated/Table";
import type { TableCell } from "../generated/TableCell";
import type { TableLook } from "../generated/TableLook";

// ----- styles ---------------------------------------------------------------------

/** PowerPoint's "Medium Style 2 – Accent 1…6" (the first is the default of new tables). */
export const TABLE_STYLES: { id: string; accent: 1 | 2 | 3 | 4 | 5 | 6 }[] = [
  { id: "{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}", accent: 1 },
  { id: "{21E4AEA4-8DFA-4A89-87EB-49C32662AFE8}", accent: 2 },
  { id: "{F5AB1C69-6EDB-4FF4-983F-18BD219EF322}", accent: 3 },
  { id: "{00A15C55-8517-42AA-B614-E9B94910E393}", accent: 4 },
  { id: "{7DF18680-E054-41AD-8BC1-D1AEF772440D}", accent: 5 },
  { id: "{93296810-A885-4BE3-A3E7-6D5BEEA58F35}", accent: 6 },
];

/** A border as drawn: colour and width (EMU). */
export interface StyleLine {
  color: Color;
  width: number;
}

/** What the table style gives a cell. */
export interface StyleCell {
  fill: Color | null;
  borders: { left: StyleLine | null; right: StyleLine | null; top: StyleLine | null; bottom: StyleLine | null };
  bold: boolean;
  textColor: Color | null;
}

const theme = (slot: ThemeColorSlot, tint = 0): Color => ({ kind: "theme", value: { slot, tint } });

/** The accent (1–6) of a known style id, else `null` (unknown styles and no style draw nothing). */
export const styleAccent = (id: string | undefined | null): number | null => TABLE_STYLES.find((s) => s.id === id)?.accent ?? null;

/**
 * The formatting the table style gives cell `row`, `col` (mirror of
 * `Table::style_cell`): accent header/total rows and first/last columns
 * with bold light text, banded rows/columns at 40 % / 20 % tint, white
 * 1 pt grid (3 pt under the header and above the total row).
 */
export function styleCell(table: Table, row: number, col: number): StyleCell {
  const accentN = styleAccent(table.styleId);
  if (accentN === null) return { fill: null, borders: { left: null, right: null, top: null, bottom: null }, bold: false, textColor: null };
  const slot = `accent${accentN}` as ThemeColorSlot;
  const nr = table.rows.length;
  const nc = table.cols.length;
  const look = table.look;
  let fill = theme(slot, 0.8);
  if (look.bandCols) {
    const i = col - (look.firstCol ? 1 : 0);
    if (i >= 0 && i % 2 === 0) fill = theme(slot, 0.6);
  }
  if (look.bandRows) {
    const i = row - (look.firstRow ? 1 : 0);
    if (i >= 0 && i % 2 === 0) fill = theme(slot, 0.6);
  }
  const emphasis = (!!look.lastCol && col + 1 === nc) || (!!look.firstCol && col === 0) || (!!look.lastRow && row + 1 === nr) || (!!look.firstRow && row === 0);
  if (emphasis) fill = theme(slot, 0);
  const light = theme("light1");
  const thin = { color: light, width: 12700 };
  const thick = { color: light, width: 38100 };
  const borders = { left: thin, right: thin, top: thin, bottom: thin } as StyleCell["borders"];
  if (look.firstRow && row === 0) borders.bottom = thick;
  if (look.firstRow && row === 1) borders.top = thick;
  if (look.lastRow && row + 1 === nr) borders.top = thick;
  if (look.lastRow && nr >= 2 && row + 2 === nr) borders.bottom = thick;
  return { fill, borders, bold: emphasis, textColor: emphasis ? light : theme("dark1") };
}

/** The fill a cell is drawn with (its own, else the style's; `null` = none). */
export function effectiveFill(table: Table, row: number, col: number): Color | null {
  const own = table.cells[row]?.[col]?.fill;
  if (own) return own.kind === "solid" ? own.value : null;
  return styleCell(table, row, col).fill;
}

/** The borders a cell is drawn with (its own where set, else the style's; `null` = none). */
export function effectiveBorders(table: Table, row: number, col: number): StyleCell["borders"] {
  const style = styleCell(table, row, col).borders;
  const own = table.cells[row]?.[col]?.borders ?? {};
  const pick = (l: Line | undefined, s: StyleLine | null): StyleLine | null => {
    if (!l) return s;
    return l.fill.kind === "solid" ? { color: l.fill.value, width: l.width } : null;
  };
  return { left: pick(own.left, style.left), right: pick(own.right, style.right), top: pick(own.top, style.top), bottom: pick(own.bottom, style.bottom) };
}

// ----- grid -------------------------------------------------------------------------

/** Running offsets: `[0, s0, s0+s1, …]`. */
export function offsets(sizes: readonly number[]): number[] {
  const out = [0];
  for (const s of sizes) out.push(out[out.length - 1]! + s);
  return out;
}

/** The anchor (top-left cell) of the merged region containing `row`, `col` (mirror of `Table::anchor_of`). */
export function anchorOf(table: Table, row: number, col: number): [number, number] {
  const cell = table.cells[row]?.[col];
  if (!cell?.covered) return [row, col];
  for (let r = row; r >= 0; r--) {
    for (let c = col; c >= 0; c--) {
      const a = table.cells[r]?.[c];
      if (a && !a.covered && r + (a.rowSpan ?? 1) > row && c + (a.colSpan ?? 1) > col) return [r, c];
    }
  }
  return [row, col];
}

const spanOf = (cell: TableCell | undefined): [number, number] => [cell?.rowSpan ?? 1, cell?.colSpan ?? 1];

/** Anchor cells in reading order with their spans. */
export function anchors(table: Table): { row: number; col: number; rowSpan: number; colSpan: number }[] {
  const out: { row: number; col: number; rowSpan: number; colSpan: number }[] = [];
  table.cells.forEach((cells, row) =>
    cells.forEach((cell, col) => {
      if (cell.covered) return;
      const [rowSpan, colSpan] = spanOf(cell);
      out.push({ row, col, rowSpan, colSpan });
    }),
  );
  return out;
}

/** A rectangle of cells (inclusive, `r0 <= r1`, `c0 <= c1`). */
export interface CellRange {
  r0: number;
  c0: number;
  r1: number;
  c1: number;
}

/** The range spanned by two cells (any order). */
export const rangeOf = (a: [number, number], b: [number, number]): CellRange => ({
  r0: Math.min(a[0], b[0]),
  c0: Math.min(a[1], b[1]),
  r1: Math.max(a[0], b[0]),
  c1: Math.max(a[1], b[1]),
});

/** The range grown until it contains every merged region it touches. */
export function expandRange(table: Table, range: CellRange): CellRange {
  let r = { ...range };
  for (let guard = 0; guard < 100; guard++) {
    let changed = false;
    for (let row = r.r0; row <= r.r1; row++) {
      for (let col = r.c0; col <= r.c1; col++) {
        const [ar, ac] = anchorOf(table, row, col);
        const [rs, cs] = spanOf(table.cells[ar]?.[ac]);
        const next = { r0: Math.min(r.r0, ar), c0: Math.min(r.c0, ac), r1: Math.max(r.r1, ar + rs - 1), c1: Math.max(r.c1, ac + cs - 1) };
        if (next.r0 !== r.r0 || next.c0 !== r.c0 || next.r1 !== r.r1 || next.c1 !== r.c1) {
          r = next;
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  return r;
}

/** Anchor cells inside a range. */
export function cellsIn(table: Table, range: CellRange): [number, number][] {
  return anchors(table)
    .filter((a) => a.row >= range.r0 && a.row <= range.r1 && a.col >= range.c0 && a.col <= range.c1)
    .map((a) => [a.row, a.col]);
}

/** Whether the range is exactly one cell (or one merged region). */
export function singleCell(table: Table, range: CellRange): boolean {
  const e = expandRange(table, range);
  return cellsIn(table, e).length === 1;
}

// ----- keyboard navigation ---------------------------------------------------------------

export type CellMove = "next" | "prev" | "up" | "down" | "left" | "right";

/**
 * The cell a key moves to from the anchor `row`, `col` (Tab = next in
 * reading order, Shift+Tab = previous, arrows at the text's edges);
 * `"insertRow"` for Tab in the last cell (PowerPoint adds a row), `null`
 * when there is no cell that way.
 */
export function moveCell(table: Table, row: number, col: number, move: CellMove): [number, number] | "insertRow" | null {
  const list = anchors(table);
  const i = list.findIndex((a) => a.row === row && a.col === col);
  if (i < 0) return null;
  const me = list[i]!;
  switch (move) {
    case "next":
      return i + 1 < list.length ? [list[i + 1]!.row, list[i + 1]!.col] : "insertRow";
    case "prev":
      return i > 0 ? [list[i - 1]!.row, list[i - 1]!.col] : null;
    case "up":
      return row > 0 ? anchorOf(table, row - 1, col) : null;
    case "down":
      return row + me.rowSpan < table.rows.length ? anchorOf(table, row + me.rowSpan, col) : null;
    case "left":
      return col > 0 ? anchorOf(table, row, col - 1) : i > 0 ? [list[i - 1]!.row, list[i - 1]!.col] : null;
    case "right":
      return col + me.colSpan < table.cols.length ? anchorOf(table, row, col + me.colSpan) : i + 1 < list.length ? [list[i + 1]!.row, list[i + 1]!.col] : null;
  }
}

/**
 * The move of a key in the cell editor, or `null` to let the textarea
 * handle it: Tab / Shift+Tab always, ↑ on the first line, ↓ on the last,
 * ← at the start, → at the end (caret collapsed).
 */
export function keyMove(key: string, shift: boolean, text: string, start: number, end: number): CellMove | null {
  if (key === "Tab") return shift ? "prev" : "next";
  if (start !== end || shift) return null;
  if (key === "ArrowUp" && !text.slice(0, start).includes("\n")) return "up";
  if (key === "ArrowDown" && !text.slice(end).includes("\n")) return "down";
  if (key === "ArrowLeft" && start === 0) return "left";
  if (key === "ArrowRight" && end === text.length) return "right";
  return null;
}

// ----- commands --------------------------------------------------------------------------

const compoundOf = (cmds: ShowCommand[]): ShowCommand | null => (cmds.length === 0 ? null : cmds.length === 1 ? cmds[0]! : { type: "compound", commands: cmds });

/** `InsertTable` of a `rows` × `cols` table (centred by the core). */
export const insertTableCommand = (slide: NodeId, rows: number, cols: number, newId: number): ShowCommand => ({ type: "insertTable", slide, rows, cols, newId });

/** Merge Cells for the range (grown over merged regions); `null` when it is one cell. */
export function mergeCommand(shape: NodeId, table: Table, range: CellRange): ShowCommand | null {
  const r = expandRange(table, range);
  if (cellsIn(table, r).length < 2) return null;
  return { type: "mergeTableCells", shape, row: r.r0, col: r.c0, rowSpan: r.r1 - r.r0 + 1, colSpan: r.c1 - r.c0 + 1 };
}

/** Split Cell: undoes the merge of the region containing `row`, `col`; `null` for a single cell. */
export function splitCommand(shape: NodeId, table: Table, row: number, col: number): ShowCommand | null {
  const [ar, ac] = anchorOf(table, row, col);
  const [rs, cs] = spanOf(table.cells[ar]?.[ac]);
  return rs * cs > 1 ? { type: "splitTableCell", shape, row: ar, col: ac } : null;
}

/** Insert Above/Below: as many rows as the range spans. */
export function insertRowsCommand(shape: NodeId, table: Table, range: CellRange, below: boolean): ShowCommand | null {
  const r = expandRange(table, range);
  const n = r.r1 - r.r0 + 1;
  const index = below ? r.r1 + 1 : r.r0;
  return compoundOf(Array.from({ length: n }, () => ({ type: "insertTableRow", shape, index }) as ShowCommand));
}

/** Insert Left/Right: as many columns as the range spans. */
export function insertColsCommand(shape: NodeId, table: Table, range: CellRange, right: boolean): ShowCommand | null {
  const r = expandRange(table, range);
  const n = r.c1 - r.c0 + 1;
  const index = right ? r.c1 + 1 : r.c0;
  return compoundOf(Array.from({ length: n }, () => ({ type: "insertTableCol", shape, index }) as ShowCommand));
}

/** Delete Rows (bottom up); deleting every row deletes the table. */
export function deleteRowsCommand(shape: NodeId, table: Table, range: CellRange): ShowCommand | null {
  const r = expandRange(table, range);
  if (r.r0 === 0 && r.r1 >= table.rows.length - 1) return { type: "deleteShapes", ids: [shape] };
  const cmds: ShowCommand[] = [];
  for (let i = r.r1; i >= r.r0; i--) cmds.push({ type: "deleteTableRow", shape, index: i });
  return compoundOf(cmds);
}

/** Delete Columns (right to left); deleting every column deletes the table. */
export function deleteColsCommand(shape: NodeId, table: Table, range: CellRange): ShowCommand | null {
  const r = expandRange(table, range);
  if (r.c0 === 0 && r.c1 >= table.cols.length - 1) return { type: "deleteShapes", ids: [shape] };
  const cmds: ShowCommand[] = [];
  for (let i = r.c1; i >= r.c0; i--) cmds.push({ type: "deleteTableCol", shape, index: i });
  return compoundOf(cmds);
}

const propsCommand = (shape: NodeId, r: CellRange, patch: Extract<ShowCommand, { type: "setTableCellProps" }>["patch"]): ShowCommand => ({
  type: "setTableCellProps",
  shape,
  row: r.r0,
  col: r.c0,
  rowSpan: r.r1 - r.r0 + 1,
  colSpan: r.c1 - r.c0 + 1,
  patch,
});

/** Shading of the range (`null` = as the style). */
export const shadingCommand = (shape: NodeId, range: CellRange, fill: Fill | null): ShowCommand => propsCommand(shape, range, { fill });

/** Vertical text alignment of the range. */
export const anchorCommand = (shape: NodeId, range: CellRange, anchor: Anchor): ShowCommand => propsCommand(shape, range, { anchor });

/** Cell margins of the range. */
export const marginsCommand = (shape: NodeId, range: CellRange, margins: Insets): ShowCommand => propsCommand(shape, range, { margins });

export type BorderKind = "all" | "outside" | "inside" | "none" | "top" | "bottom" | "left" | "right" | "insideH" | "insideV";

/** "No border" is an explicit line without colour (PowerPoint writes `a:noFill`). */
export const NO_LINE: Line = { fill: { kind: "none" }, width: 12700, dash: "solid" };

/** The Borders menu for the range with `line` (`none` uses [`NO_LINE`]). */
export function bordersCommand(shape: NodeId, range: CellRange, kind: BorderKind, line: Line): ShowCommand | null {
  const r = range;
  const sub = (r0: number, c0: number, r1: number, c1: number, patch: Parameters<typeof propsCommand>[2]): ShowCommand[] =>
    r0 <= r1 && c0 <= c1 ? [propsCommand(shape, { r0, c0, r1, c1 }, patch)] : [];
  const top = () => sub(r.r0, r.c0, r.r0, r.c1, { top: line });
  const bottom = () => sub(r.r1, r.c0, r.r1, r.c1, { bottom: line });
  const left = () => sub(r.r0, r.c0, r.r1, r.c0, { left: line });
  const right = () => sub(r.r0, r.c1, r.r1, r.c1, { right: line });
  const insideH = () => [...sub(r.r0, r.c0, r.r1 - 1, r.c1, { bottom: line }), ...sub(r.r0 + 1, r.c0, r.r1, r.c1, { top: line })];
  const insideV = () => [...sub(r.r0, r.c0, r.r1, r.c1 - 1, { right: line }), ...sub(r.r0, r.c0 + 1, r.r1, r.c1, { left: line })];
  switch (kind) {
    case "all":
      return propsCommand(shape, r, { left: line, right: line, top: line, bottom: line });
    case "none":
      return propsCommand(shape, r, { left: NO_LINE, right: NO_LINE, top: NO_LINE, bottom: NO_LINE });
    case "outside":
      return compoundOf([...top(), ...bottom(), ...left(), ...right()]);
    case "inside":
      return compoundOf([...insideH(), ...insideV()]);
    case "top":
      return compoundOf(top());
    case "bottom":
      return compoundOf(bottom());
    case "left":
      return compoundOf(left());
    case "right":
      return compoundOf(right());
    case "insideH":
      return compoundOf(insideH());
    case "insideV":
      return compoundOf(insideV());
  }
}

/** Distribute Rows / Columns: equal sizes for the range's rows/columns (the whole table for a single row/column). */
export function distributeCommand(shape: NodeId, table: Table, range: CellRange | null, axis: "rows" | "cols"): ShowCommand | null {
  const sizes = axis === "rows" ? table.rows.map((r) => r.height) : table.cols.map((c) => c.width);
  let a = axis === "rows" ? (range?.r0 ?? 0) : (range?.c0 ?? 0);
  let b = axis === "rows" ? (range?.r1 ?? sizes.length - 1) : (range?.c1 ?? sizes.length - 1);
  if (a === b) {
    a = 0;
    b = sizes.length - 1;
  }
  const total = sizes.slice(a, b + 1).reduce((s, v) => s + v, 0);
  const n = b - a + 1;
  const next = [...sizes];
  let used = 0;
  for (let i = a; i <= b; i++) {
    next[i] = i === b ? total - used : Math.round(total / n);
    used += next[i]!;
  }
  if (next.every((v, i) => v === sizes[i])) return null;
  return axis === "rows" ? { type: "setTableGrid", shape, rowHeights: next } : { type: "setTableGrid", shape, colWidths: next };
}

/** Smallest column width / row height when resizing by dragging a border (0.1 inch). */
export const MIN_TRACK = 91440;

/** Dragging the border right of column `i` by `delta` EMU: column `i` and `i + 1` share the change (the table keeps its width; the last border grows the table). */
export function resizeColCommand(shape: NodeId, table: Table, i: number, delta: number): ShowCommand | null {
  const w = table.cols.map((c) => c.width);
  if (i < 0 || i >= w.length) return null;
  if (i + 1 < w.length) {
    const d = Math.max(MIN_TRACK - w[i]!, Math.min(w[i + 1]! - MIN_TRACK, Math.round(delta)));
    w[i]! += d;
    w[i + 1]! -= d;
  } else w[i] = Math.max(MIN_TRACK, w[i]! + Math.round(delta));
  return w.every((v, k) => v === table.cols[k]!.width) ? null : { type: "setTableGrid", shape, colWidths: w };
}

/** Dragging the border under row `i` by `delta` EMU: row `i` gets taller or shorter (the table grows or shrinks). */
export function resizeRowCommand(shape: NodeId, table: Table, i: number, delta: number): ShowCommand | null {
  const h = table.rows.map((r) => r.height);
  if (i < 0 || i >= h.length) return null;
  h[i] = Math.max(MIN_TRACK, h[i]! + Math.round(delta));
  return h[i] === table.rows[i]!.height ? null : { type: "setTableGrid", shape, rowHeights: h };
}

/** Horizontal alignment of every paragraph of the range's cells (`SetTableCellText` per cell). */
export function alignCommand(shape: NodeId, table: Table, range: CellRange, alignment: Alignment): ShowCommand | null {
  const cmds: ShowCommand[] = cellsIn(table, expandRange(table, range)).map(([row, col]) => {
    const body = table.cells[row]![col]!.text;
    return {
      type: "setTableCellText",
      shape,
      row,
      col,
      body: { ...body, paragraphs: body.paragraphs.map((p) => ({ ...p, props: { ...(p.props ?? {}), alignment } })) },
    };
  });
  return compoundOf(cmds);
}

/** A table style from the gallery (look options kept). */
export const styleCommand = (shape: NodeId, table: Table, styleId: string | null): ShowCommand => ({ type: "setTableStyle", shape, styleId, look: table.look });

/** One of the Table Style Options check boxes. */
export const lookCommand = (shape: NodeId, table: Table, key: keyof TableLook, on: boolean): ShowCommand => ({
  type: "setTableStyle",
  shape,
  styleId: table.styleId ?? null,
  look: { ...table.look, [key]: on },
});
