// Table editing like Word: where the caret is (table, row, column, the
// selected cells) and the Rust-first commands of the Table tab and the
// context menu. Structure and formatting changes go to Rust directly
// (`InsertTableRow`, `SetCellProps`, …); the patch re-renders the table and
// the caret stays in its paragraph (by block id).

import type { Node as PMNode } from "@tiptap/pm/model";
import { TextSelection, type EditorState } from "@tiptap/pm/state";
import { CellSelection, TableMap } from "@tiptap/pm/tables";
import type { EditorView } from "@tiptap/pm/view";
import type { Color } from "../../../../packages/ui-shared/src/generated/Color";
import type { BorderSide } from "../generated/BorderSide";
import type { RowHeight } from "../generated/RowHeight";
import type { RowProperties } from "../generated/RowProperties";
import type { TableBorders } from "../generated/TableBorders";
import type { TableProperties } from "../generated/TableProperties";
import type { Alignment } from "../generated/Alignment";
import type { CellMargins } from "../generated/CellMargins";
import type { TableAlignment } from "../generated/TableAlignment";
import type { TableLayout } from "../generated/TableLayout";
import type { TableLook } from "../generated/TableLook";
import type { VAlign } from "../generated/VAlign";
import type { WriteCommand } from "../generated/WriteCommand";
import { findPos } from "../sync/SyncPlugin";

/** A rectangle of grid cells: rows `top..bottom`, columns `left..right` (exclusive ends). */
export interface GridRect {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

/** Where the selection is in a table (grid coordinates: merged cells span several). */
export interface TableContext {
  table: number;
  /** PM position of the table node. */
  pos: number;
  node: PMNode;
  map: TableMap;
  /** Row and grid column of the caret's cell (its top-left). */
  row: number;
  col: number;
  /** Rows and grid columns of the table. */
  rows: number;
  cols: number;
  /** The caret's cell. */
  cell: GridRect;
  /** The selected cells' rectangle, grown to whole merged cells. */
  rect: GridRect;
  /** Ids of the selected cells (at least the caret's). */
  cells: number[];
  /** Row indices covered by the selection. */
  rowIndices: number[];
  /** Grid column indices covered by the selection. */
  colIndices: number[];
  props: TableProperties;
  rowProps: RowProperties;
}

const range = (a: number, b: number) => Array.from({ length: Math.max(0, b - a) }, (_, i) => a + i);

/** Offsets of every cell overlapping `rect` (also those starting outside it). */
function cellsOverlapping(map: TableMap, rect: GridRect): number[] {
  const out = new Set<number>();
  for (let r = rect.top; r < rect.bottom; r++) for (let c = rect.left; c < rect.right; c++) out.add(map.map[r * map.width + c]!);
  return [...out];
}

/** `rect` grown until no merged cell crosses its edge. */
export function closeRect(map: TableMap, rect: GridRect): GridRect {
  const r = { ...rect };
  for (;;) {
    let grown = false;
    for (const off of cellsOverlapping(map, r)) {
      const c = map.findCell(off);
      if (c.top < r.top || c.left < r.left || c.bottom > r.bottom || c.right > r.right) {
        r.top = Math.min(r.top, c.top);
        r.left = Math.min(r.left, c.left);
        r.bottom = Math.max(r.bottom, c.bottom);
        r.right = Math.max(r.right, c.right);
        grown = true;
      }
    }
    if (!grown) return r;
  }
}

/** The innermost table around the selection head, or null. */
export function tableContext(state: EditorState): TableContext | null {
  const sel = state.selection;
  const { $from, from, to } = sel;
  let d = $from.depth;
  while (d > 0 && $from.node(d).type.name !== "table") d--;
  if (d <= 0) return null;
  const node = $from.node(d);
  const pos = $from.before(d);
  if (node.attrs.id == null) return null;
  const map = TableMap.get(node);
  const start = pos + 1;
  // The caret's cell: the cell node right below the table.
  const cellOffset = $from.depth > d + 1 ? $from.before(d + 2) - start : map.map[0] ?? 0;
  const cell = map.findCell(cellOffset);
  let rect: GridRect;
  if (sel instanceof CellSelection && sel.$anchorCell.depth > 0 && sel.$anchorCell.before(sel.$anchorCell.depth - 1) === pos) {
    rect = map.rectBetween(sel.$anchorCell.pos - start, sel.$headCell.pos - start);
  } else {
    rect = { ...cell };
    // Cells intersecting a text selection.
    const seen = new Set<number>();
    for (const off of map.map) {
      if (seen.has(off)) continue;
      seen.add(off);
      const n = node.nodeAt(off);
      const a = start + off;
      const b = a + (n?.nodeSize ?? 0);
      if (b > from && a < Math.max(to, from + 1)) {
        const c = map.findCell(off);
        rect = { top: Math.min(rect.top, c.top), left: Math.min(rect.left, c.left), bottom: Math.max(rect.bottom, c.bottom), right: Math.max(rect.right, c.right) };
      }
    }
  }
  rect = closeRect(map, rect);
  const cells = map.cellsInRect(rect).map((off) => node.nodeAt(off)?.attrs.id as number | null).filter((id): id is number => id != null);
  const row = cell.top;
  return {
    table: node.attrs.id as number,
    pos,
    node,
    map,
    row,
    col: cell.left,
    rows: map.height,
    cols: map.width,
    cell,
    rect,
    cells,
    rowIndices: range(rect.top, rect.bottom),
    colIndices: range(rect.left, rect.right),
    props: (node.attrs.props as TableProperties | null) ?? {},
    rowProps: (node.child(Math.min(row, node.childCount - 1)).attrs.props as RowProperties | null) ?? {},
  };
}

const one = (cmds: WriteCommand[]): WriteCommand => (cmds.length === 1 ? cmds[0]! : { type: "compound", commands: cmds });

export const insertRow = (t: TableContext, below: boolean): WriteCommand => ({
  type: "insertTableRow",
  table: t.table,
  at: below ? t.rowIndices[t.rowIndices.length - 1]! + 1 : t.rowIndices[0]!,
});

export const insertCol = (t: TableContext, right: boolean): WriteCommand => ({
  type: "insertTableCol",
  table: t.table,
  at: right ? t.colIndices[t.colIndices.length - 1]! + 1 : t.colIndices[0]!,
});

/** Deletes the selected rows; all rows → the table (as Word does). */
export function deleteRows(t: TableContext): WriteCommand {
  if (t.rowIndices.length >= t.rows) return deleteTable(t);
  return one([...t.rowIndices].reverse().map((at) => ({ type: "deleteTableRow", table: t.table, at })));
}

/** Deletes the selected columns; all columns → the table. */
export function deleteCols(t: TableContext): WriteCommand {
  if (t.colIndices.length >= t.cols) return deleteTable(t);
  return one([...t.colIndices].reverse().map((at) => ({ type: "deleteTableCol", table: t.table, at })));
}

export const deleteTable = (t: TableContext): WriteCommand => ({ type: "deleteBlocks", ids: [t.table] });

/** Cell shading of the selected cells; `null` = no color. */
export const shadeCells = (t: TableContext, color: Color | null): WriteCommand => ({
  type: "setCellProps",
  cells: t.cells,
  patch: { shading: color ?? { kind: "auto" } },
});

export type BorderPreset = "all" | "outside" | "none";

/** Word's single ½ pt line. */
export const SINGLE_BORDER: BorderSide = { style: "single", width: 10, color: { kind: "auto" } };
export const NO_BORDER: BorderSide = { style: "none", width: 0, color: { kind: "auto" } };

export function bordersOf(preset: BorderPreset): TableBorders {
  const outer = preset === "none" ? NO_BORDER : SINGLE_BORDER;
  const inner = preset === "all" ? SINGLE_BORDER : NO_BORDER;
  return { top: outer, left: outer, bottom: outer, right: outer, insideH: inner, insideV: inner };
}

export const setBorders = (t: TableContext, preset: BorderPreset): WriteCommand => ({
  type: "setTableProps",
  table: t.table,
  patch: { borders: bordersOf(preset) },
});

/** Toggles "repeat as header row" on the first row. */
export function toggleHeaderRow(t: TableContext): WriteCommand {
  const first = (t.node.firstChild?.attrs.props as RowProperties | null) ?? {};
  return { type: "setRowProps", table: t.table, rows: [0], header: !first.header };
}

/** Row height of the selected rows (`null` = automatic). */
export const setRowHeight = (t: TableContext, height: RowHeight | null): WriteCommand => ({
  type: "setRowProps",
  table: t.table,
  rows: t.rowIndices,
  height: height ?? { value: 0, rule: "atLeast" },
});

export const setColWidths = (t: TableContext, widths: number[]): WriteCommand => ({
  type: "setTableProps",
  table: t.table,
  patch: { colWidths: widths.map((w) => Math.max(1, Math.round(w))) },
});

/** Current column widths in twips (the table's grid, else equal parts of `total`). */
export function colWidthsOf(t: TableContext, total: number): number[] {
  const w = t.props.colWidths ?? [];
  if (w.length === t.cols) return [...w];
  return Array(t.cols).fill(Math.floor(total / Math.max(1, t.cols)));
}

/**
 * New widths after dragging the border right of column `col` by `dx`
 * twips: the neighbour gives or takes the difference (the table keeps its
 * width, as in Word); the last border resizes the last column only.
 * Columns stay at least `min` wide.
 */
export function dragBorder(widths: number[], col: number, dx: number, min = 360): number[] {
  const out = [...widths];
  if (col < 0 || col >= out.length) return out;
  if (col === out.length - 1) {
    out[col] = Math.max(min, out[col]! + dx);
    return out;
  }
  const sum = out[col]! + out[col + 1]!;
  const left = Math.min(Math.max(min, out[col]! + dx), sum - min);
  out[col] = left;
  out[col + 1] = sum - left;
  return out;
}

/** Puts the caret at the start of the cell covering (`row`, grid column `col`) of table `id`. */
export function caretToCell(view: EditorView, id: number, row: number, col: number): boolean {
  const pos = findPos(view.state.doc, id);
  const table = pos >= 0 ? view.state.doc.nodeAt(pos) : null;
  if (!table || table.type.name !== "table") return false;
  const map = TableMap.get(table);
  if (row >= map.height || col >= map.width) return false;
  const off = map.map[row * map.width + col]!;
  // Inside the cell's first textblock.
  const sel = TextSelection.near(view.state.doc.resolve(pos + 1 + off + 1));
  view.dispatch(view.state.tr.setSelection(sel).scrollIntoView());
  return true;
}

/** Whether the selection head is in the last cell (document order) of its table. */
export function inLastCell(t: TableContext): boolean {
  let last = 0;
  for (const off of t.map.map) last = Math.max(last, off);
  return t.map.findCell(last).top === t.cell.top && t.map.findCell(last).left === t.cell.left;
}

// ----- P8-17: merged cells, table styles, layout ----------------------------------

/** Merge Cells: the selected rectangle (more than one cell), or null. */
export function mergeCellsCommand(t: TableContext): WriteCommand | null {
  const { rect } = t;
  if (t.cells.length < 2) return null;
  return { type: "mergeCells", table: t.table, top: rect.top, left: rect.left, bottom: rect.bottom - 1, right: rect.right - 1 };
}

/** Split Cells…: the caret's cell (or merged region) into `rows × cols`. */
export function splitCellCommand(t: TableContext, rows: number, cols: number): WriteCommand | null {
  if (rows < 1 || cols < 1 || (rows === 1 && cols === 1)) return null;
  return { type: "splitCell", table: t.table, row: t.cell.top, col: t.cell.left, rows, cols };
}

/** Rows a split into `rows` parts is valid for (Word: a divisor of the merged rows, or any count for one row). */
export function splitRowsValid(t: TableContext, rows: number): boolean {
  const n = t.cell.bottom - t.cell.top;
  return rows >= 1 && (n === 1 || n % rows === 0);
}

/** Word's look for a table that gets a style and has none yet: header row, first column, banded rows. */
export const WORD_DEFAULT_LOOK: TableLook = { firstRow: true, lastRow: false, firstCol: true, lastCol: false, bandedRows: true, bandedCols: false };
const NO_LOOK: TableLook = { firstRow: false, lastRow: false, firstCol: false, lastCol: false, bandedRows: false, bandedCols: false };

/** The table's look (none set = no conditional formats, as the core resolves it). */
export const lookOf = (t: TableContext): TableLook => ({ ...NO_LOOK, ...(t.props.look ?? {}) });

/** Applies a table style (`""` removes it); a table without a look gets Word's default look with it. */
export const setTableStyle = (t: TableContext, style: string): WriteCommand => ({
  type: "setTableProps",
  table: t.table,
  patch: style && !t.props.look ? { style, look: WORD_DEFAULT_LOOK } : { style },
});

/** Table Style Options: one look flag toggled (the others kept). */
export function toggleLook(t: TableContext, key: keyof TableLook): WriteCommand {
  const look = lookOf(t);
  return { type: "setTableProps", table: t.table, patch: { look: { ...look, [key]: !look[key] } } };
}

/** Borders ▾ of the Table Design tab, for the selected cells. */
export type CellBorderPreset = "bottom" | "top" | "left" | "right" | "none" | "all" | "outside" | "inside" | "insideH" | "insideV";

/**
 * `SetCellProps` commands giving the selected cells the borders of
 * `preset` (`side`: the line, Word's ½ pt single by default): outer edges
 * are the cells on the selection's edge, inner edges the lines between.
 */
export function cellBordersCommand(t: TableContext, preset: CellBorderPreset, side: BorderSide = SINGLE_BORDER): WriteCommand | null {
  const groups = new Map<string, { patch: TableBorders; cells: number[] }>();
  const { rect, map, node } = t;
  for (const off of map.cellsInRect(rect)) {
    const id = node.nodeAt(off)?.attrs.id as number | null;
    if (id == null) continue;
    const c = map.findCell(off);
    const edge = { top: c.top === rect.top, bottom: c.bottom === rect.bottom, left: c.left === rect.left, right: c.right === rect.right };
    const b: TableBorders = {};
    const set = (k: "top" | "bottom" | "left" | "right", on: boolean) => {
      if (on) b[k] = side;
    };
    switch (preset) {
      case "bottom":
      case "top":
      case "left":
      case "right":
        set(preset, edge[preset]);
        break;
      case "none":
        b.top = b.bottom = b.left = b.right = NO_BORDER;
        break;
      case "all":
        b.top = b.bottom = b.left = b.right = side;
        break;
      case "outside":
        (["top", "bottom", "left", "right"] as const).forEach((k) => set(k, edge[k]));
        break;
      case "inside":
        (["top", "bottom", "left", "right"] as const).forEach((k) => set(k, !edge[k]));
        break;
      case "insideH":
        set("top", !edge.top);
        set("bottom", !edge.bottom);
        break;
      case "insideV":
        set("left", !edge.left);
        set("right", !edge.right);
        break;
    }
    if (!Object.keys(b).length) continue;
    const key = JSON.stringify(b);
    const g = groups.get(key) ?? { patch: b, cells: [] };
    g.cells.push(id);
    groups.set(key, g);
  }
  const cmds: WriteCommand[] = [...groups.values()].map((g) => ({ type: "setCellProps", cells: g.cells, patch: { borders: g.patch } }));
  return cmds.length ? one(cmds) : null;
}

/** Cell margins (Table Layout › Cell Margins…): the table's default padding, twips. */
export const setCellMargins = (t: TableContext, margins: CellMargins): WriteCommand => ({ type: "setTableProps", table: t.table, patch: { cellMargins: margins } });

/** Alignment 9-grid: vertical alignment of the selected cells plus the paragraph alignment of their text. */
export function cellAlignmentCommands(t: TableContext, v: VAlign, h: Alignment, doc: PMNode): WriteCommand[] {
  const paras: number[] = [];
  const { map, node, rect } = t;
  for (const off of map.cellsInRect(rect)) {
    node.nodeAt(off)?.descendants((n) => {
      if (n.isTextblock && n.attrs.id != null) paras.push(n.attrs.id as number);
      return !n.isTextblock;
    });
  }
  void doc;
  const cmds: WriteCommand[] = [{ type: "setCellProps", cells: t.cells, patch: { verticalAlign: v } }];
  if (paras.length) cmds.push({ type: "setParagraphProps", blocks: paras, patch: { alignment: h } });
  return cmds;
}

/** Column widths after setting the selected grid columns to `twips` each. */
export function setSelectedColWidth(t: TableContext, widths: number[], twips: number): number[] {
  const out = [...widths];
  for (const c of t.colIndices) if (c < out.length) out[c] = Math.max(1, Math.round(twips));
  return out;
}

/** Distribute Columns: the selected columns share their total width equally. */
export function distributeCols(t: TableContext, widths: number[]): number[] {
  const cols = t.colIndices.length > 1 ? t.colIndices : range(0, widths.length);
  const total = cols.reduce((s, c) => s + (widths[c] ?? 0), 0);
  const out = [...widths];
  const each = Math.floor(total / cols.length);
  cols.forEach((c, i) => (out[c] = i === cols.length - 1 ? total - each * (cols.length - 1) : each));
  return out;
}

/** Distribute Rows: the selected rows (all when one is selected) get the average of their heights (twips, "at least"). */
export function distributeRows(t: TableContext, heights: number[]): WriteCommand {
  const rows = t.rowIndices.length > 1 ? t.rowIndices : range(0, t.rows);
  const avg = Math.round(rows.reduce((s, r) => s + (heights[r] ?? 0), 0) / Math.max(1, rows.length));
  return { type: "setRowProps", table: t.table, rows, height: { value: Math.max(1, avg), rule: "atLeast" } };
}

/** Table Properties…: placement, layout and the selected rows' page-break / header options. */
export interface TablePropsValues {
  alignment: TableAlignment;
  indent: number;
  layout: TableLayout;
  cantSplit: boolean;
  header: boolean;
}

export function tablePropsValues(t: TableContext): TablePropsValues {
  return {
    alignment: t.props.alignment ?? "left",
    indent: t.props.indent ?? 0,
    layout: t.props.layout ?? "autofit",
    cantSplit: !!t.rowProps.cantSplit,
    header: !!t.rowProps.header,
  };
}

/** Commands for the changed values of the Table Properties dialog. */
export function tablePropsCommands(t: TableContext, before: TablePropsValues, v: TablePropsValues): WriteCommand[] {
  const patch: TableProperties = {};
  if (v.alignment !== before.alignment) patch.alignment = v.alignment;
  if (v.indent !== before.indent) patch.indent = v.indent;
  if (v.layout !== before.layout) patch.layout = v.layout;
  const cmds: WriteCommand[] = [];
  if (Object.keys(patch).length) cmds.push({ type: "setTableProps", table: t.table, patch });
  if (v.cantSplit !== before.cantSplit || v.header !== before.header) {
    const c: WriteCommand = { type: "setRowProps", table: t.table, rows: t.rowIndices };
    if (v.cantSplit !== before.cantSplit) c.cantSplit = v.cantSplit;
    if (v.header !== before.header) c.header = v.header;
    cmds.push(c);
  }
  return cmds;
}

export type TableSelectKind = "cell" | "row" | "column" | "table";

/** Table Layout › Select: a cell selection of the caret's cell, row(s), column(s) or the whole table. */
export function selectInTable(view: EditorView, kind: TableSelectKind): boolean {
  const t = tableContext(view.state);
  if (!t) return false;
  const { map, rect } = t;
  const start = t.pos + 1;
  const r =
    kind === "cell" ? t.cell
    : kind === "row" ? { top: rect.top, bottom: rect.bottom, left: 0, right: map.width }
    : kind === "column" ? { top: 0, bottom: map.height, left: rect.left, right: rect.right }
    : { top: 0, left: 0, bottom: map.height, right: map.width };
  const offs = map.cellsInRect(r);
  if (!offs.length) return false;
  const first = offs[0]!;
  const last = offs[offs.length - 1]!;
  view.dispatch(view.state.tr.setSelection(CellSelection.create(view.state.doc, start + first, start + last)));
  return true;
}
