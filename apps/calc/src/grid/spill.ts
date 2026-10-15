// Dynamic arrays on the client (pure): which spill range a cell belongs
// to, its outline in the grid, and the "part of an array" checks that make
// paste, fill and sort refuse to change spilled cells (Excel 365). The
// core owns the spill itself (`CellView.spill` on the formula cell,
// `CellView.spilled` on the cells it spills into).

import type { CellView } from "../generated/CellView";
import type { Rect } from "../generated/Rect";
import { rangeRect, type RenderOp, type SheetData, type Viewport } from "./render";
import type { Cell, Range } from "./Selection";

type Cells = Map<number, Map<number, CellView>>;

/** Outline colour of a spill range, and of one that is blocked (`#SPILL!`, dashed). */
export const SPILL_COLOR = "#2a62d6";
export const SPILL_BLOCKED_COLOR = "#d8352a";

/** The spill range the grid outlines around the selected cell. */
export interface SpillOutline {
  /** The array formula's cell. */
  anchor: Cell;
  /** The spill range (anchor included), or where it would spill when blocked. */
  range: Rect;
  /** The anchor shows `#SPILL!`: the range is not blank. */
  blocked: boolean;
}

export const isSpillError = (c: CellView | undefined): boolean => c?.kind === "error" && c.display === "#SPILL!";

const inRect = (r: Range, row: number, col: number) => row >= r.r0 && row <= r.r1 && col >= r.c0 && col <= r.c1;

/** A cell with content: an input or a spilled value (Ctrl+arrows, regions and the used range count both). */
export const isFilledCell = (c: CellView | undefined): boolean => !!c && (c.input !== "" || !!c.spilled);

/**
 * The spill range `row`/`col` belongs to: as the formula cell, as a
 * spilled cell, or (for a blocked spill) as a cell of the range it would
 * spill into. `anchors` are the sheet's cells with a `spill` (the
 * store's index). `null` when none.
 */
export function spillAt(cells: Cells, anchors: Iterable<CellView>, row: number, col: number): SpillOutline | null {
  const c = cells.get(row)?.get(col);
  const a = c?.spill ? c : c?.spilled ? cells.get(c.spilled[0])?.get(c.spilled[1]) : undefined;
  if (a?.spill) return { anchor: { row: a.row, col: a.col }, range: { ...a.spill }, blocked: isSpillError(a) };
  for (const b of anchors) {
    if (b.spill && isSpillError(b) && inRect(b.spill, row, col)) {
      return { anchor: { row: b.row, col: b.col }, range: { ...b.spill }, blocked: true };
    }
  }
  return null;
}

/** Draw ops of a spill outline: a thin blue box, dashed red when blocked (clipped to the viewport). */
export function spillOutlineOps(vp: Viewport, sheet: SheetData, o: SpillOutline): RenderOp[] {
  const r = rangeRect(vp, sheet, o.range);
  if (!r) return [];
  const color = o.blocked ? SPILL_BLOCKED_COLOR : SPILL_COLOR;
  const dash = o.blocked ? [4, 3] : [];
  const x0 = r.x + 1, y0 = r.y + 1, x1 = r.x + r.w, y1 = r.y + r.h;
  const line = (x1_: number, y1_: number, x2: number, y2: number): RenderOp => ({ op: "line", x1: x1_, y1: y1_, x2, y2, color, width: 1, dash });
  return [line(x0, y0, x1, y0), line(x1, y0, x1, y1), line(x0, y1, x1, y1), line(x0, y0, x0, y1)];
}

/** The cached cells inside `r` (sparse: whole rows/columns are cheap). */
function* cellsIn(cells: Cells, r: Range): Generator<CellView> {
  for (const [row, rowCells] of cells) {
    if (row < r.r0 || row > r.r1) continue;
    for (const [col, c] of rowCells) if (col >= r.c0 && col <= r.c1) yield c;
  }
}

/**
 * Writing over `r` would change part of an array: it covers a spilled cell
 * whose formula cell lies outside `r` (Excel: "You can't change part of
 * an array"). Covering the formula cell itself is fine: it replaces the
 * whole spill.
 */
export function changesPartOfArray(cells: Cells, r: Range): boolean {
  for (const c of cellsIn(cells, r)) if (c.spilled && !inRect(r, c.spilled[0], c.spilled[1])) return true;
  return false;
}

/** `r` holds spilled cells (a sort would scramble an array: refused). */
export function hasSpilledCells(cells: Cells, r: Range): boolean {
  for (const c of cellsIn(cells, r)) if (c.spilled) return true;
  return false;
}

/** `r` holds content, but only spilled cells (Delete there changes nothing). */
export function onlySpilledCells(cells: Cells, r: Range): boolean {
  let spilled = false;
  for (const c of cellsIn(cells, r)) {
    if (c.spilled) spilled = true;
    else if (c.input !== "") return false;
  }
  return spilled;
}

/**
 * "Select obstructing cells": the cells with content in a blocked spill
 * range (the formula cell excluded), as their bounding range with the
 * first of them (row-major) active; `null` when there are none.
 */
export function obstructingCells(cells: Cells, o: SpillOutline): { range: Range; first: Cell } | null {
  let range: Range | null = null;
  let first: Cell | null = null;
  for (const c of cellsIn(cells, o.range)) {
    if (c.input === "" || c.spilled || (c.row === o.anchor.row && c.col === o.anchor.col)) continue;
    if (!first || c.row < first.row || (c.row === first.row && c.col < first.col)) first = { row: c.row, col: c.col };
    range = range
      ? { r0: Math.min(range.r0, c.row), c0: Math.min(range.c0, c.col), r1: Math.max(range.r1, c.row), c1: Math.max(range.c1, c.col) }
      : { r0: c.row, c0: c.col, r1: c.row, c1: c.col };
  }
  return range && first ? { range, first } : null;
}
