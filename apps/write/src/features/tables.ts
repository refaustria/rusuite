// Table editing like Word: where the caret is (table, row, column, the
// selected cells) and the Rust-first commands of the Table tab and the
// context menu. Structure and formatting changes go to Rust directly
// (`InsertTableRow`, `SetCellProps`, …); the patch re-renders the table and
// the caret stays in its paragraph (by block id).

import type { Node as PMNode } from "@tiptap/pm/model";
import { TextSelection, type EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import type { Color } from "../../../../packages/ui-shared/src/generated/Color";
import type { BorderSide } from "../generated/BorderSide";
import type { RowHeight } from "../generated/RowHeight";
import type { RowProperties } from "../generated/RowProperties";
import type { TableBorders } from "../generated/TableBorders";
import type { TableProperties } from "../generated/TableProperties";
import type { WriteCommand } from "../generated/WriteCommand";
import { findPos } from "../sync/SyncPlugin";

/** Where the selection is in a table. */
export interface TableContext {
  table: number;
  /** PM position of the table node. */
  pos: number;
  node: PMNode;
  row: number;
  col: number;
  rows: number;
  cols: number;
  /** Ids of the selected cells (at least the caret's). */
  cells: number[];
  /** Row indices covered by the selection. */
  rowIndices: number[];
  /** Column indices covered by the selection. */
  colIndices: number[];
  props: TableProperties;
  rowProps: RowProperties;
}

/** The innermost table around the selection head, or null. */
export function tableContext(state: EditorState): TableContext | null {
  const { $from, from, to } = state.selection;
  let d = $from.depth;
  while (d > 0 && $from.node(d).type.name !== "table") d--;
  if (d <= 0) return null;
  const node = $from.node(d);
  const pos = $from.before(d);
  if (node.attrs.id == null) return null;
  const row = $from.index(d);
  const col = $from.depth > d ? $from.index(d + 1) : 0;
  const cells: number[] = [];
  const rowSet = new Set<number>();
  const colSet = new Set<number>();
  // Cells intersecting the selection (also a CellSelection: from/to span them).
  let r = 0;
  node.forEach((rowNode, rowOffset) => {
    let c = 0;
    rowNode.forEach((cell, cellOffset) => {
      const start = pos + 1 + rowOffset + 1 + cellOffset;
      const end = start + cell.nodeSize;
      if (end > from && start < Math.max(to, from + 1)) {
        if (cell.attrs.id != null) cells.push(cell.attrs.id as number);
        rowSet.add(r);
        colSet.add(c);
      }
      c++;
    });
    r++;
  });
  const first = node.firstChild;
  return {
    table: node.attrs.id as number,
    pos,
    node,
    row,
    col,
    rows: node.childCount,
    cols: first ? first.childCount : 0,
    cells,
    rowIndices: [...rowSet].sort((a, b) => a - b),
    colIndices: [...colSet].sort((a, b) => a - b),
    props: (node.attrs.props as TableProperties | null) ?? {},
    rowProps: (node.child(row).attrs.props as RowProperties | null) ?? {},
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
const NO_BORDER: BorderSide = { style: "none", width: 0, color: { kind: "auto" } };

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

/** Puts the caret at the start of cell (`row`, `col`) of table `id`. */
export function caretToCell(view: EditorView, id: number, row: number, col: number): boolean {
  const pos = findPos(view.state.doc, id);
  const table = pos >= 0 ? view.state.doc.nodeAt(pos) : null;
  if (!table || row >= table.childCount) return false;
  const rowNode = table.child(row);
  if (col >= rowNode.childCount) return false;
  let p = pos + 1;
  for (let r = 0; r < row; r++) p += table.child(r).nodeSize;
  p += 1;
  for (let c = 0; c < col; c++) p += rowNode.child(c).nodeSize;
  // Inside the cell's first textblock.
  const sel = TextSelection.near(view.state.doc.resolve(p + 1));
  view.dispatch(view.state.tr.setSelection(sel).scrollIntoView());
  return true;
}

/** Whether the selection head is in the last cell of its table. */
export function inLastCell(t: TableContext): boolean {
  return t.row === t.rows - 1 && t.col === t.cols - 1;
}
