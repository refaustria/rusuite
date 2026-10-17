// Selection model and keyboard/mouse navigation (pure functions).

import { MAX_COLS, MAX_ROWS } from "./geometry";

export interface Cell {
  row: number;
  col: number;
}

/**
 * `anchor` is the active cell; `focus` the moving corner. `range`, when
 * set, is the selected range (a range grown to whole merged cells, which
 * the two corners cannot express); otherwise it spans anchor and focus.
 */
export interface Selection {
  anchor: Cell;
  focus: Cell;
  range?: Range;
}

export interface Range {
  r0: number;
  c0: number;
  r1: number;
  c1: number;
}

export const LAST_ROW = MAX_ROWS - 1;
export const LAST_COL = MAX_COLS - 1;

export function cellSelection(row: number, col: number): Selection {
  return { anchor: { row, col }, focus: { row, col } };
}

export function normalize(sel: Selection): Range {
  if (sel.range) return { ...sel.range };
  return {
    r0: Math.min(sel.anchor.row, sel.focus.row),
    c0: Math.min(sel.anchor.col, sel.focus.col),
    r1: Math.max(sel.anchor.row, sel.focus.row),
    c1: Math.max(sel.anchor.col, sel.focus.col),
  };
}

export function contains(r: Range, row: number, col: number): boolean {
  return row >= r.r0 && row <= r.r1 && col >= r.c0 && col <= r.c1;
}

export function isWholeRows(r: Range): boolean {
  return r.c0 === 0 && r.c1 === LAST_COL;
}

export function isWholeCols(r: Range): boolean {
  return r.r0 === 0 && r.r1 === LAST_ROW;
}

const clampRow = (r: number) => Math.max(0, Math.min(LAST_ROW, r));
const clampCol = (c: number) => Math.max(0, Math.min(LAST_COL, c));

/** Whole row(s) `r0..r1`, active cell in column 0 of `anchorRow`. */
export function rowSelection(anchorRow: number, focusRow: number = anchorRow): Selection {
  return { anchor: { row: anchorRow, col: 0 }, focus: { row: focusRow, col: LAST_COL } };
}

/** Whole column(s). */
export function colSelection(anchorCol: number, focusCol: number = anchorCol): Selection {
  return { anchor: { row: 0, col: anchorCol }, focus: { row: LAST_ROW, col: focusCol } };
}

/** Mouse: click selects a cell, shift-click / drag extends from the anchor. */
export function pointerSelect(sel: Selection, cell: Cell, extend: boolean): Selection {
  return extend ? { anchor: sel.anchor, focus: { ...cell } } : cellSelection(cell.row, cell.col);
}

/** The merged range covering a cell (`null`: not merged). */
export type MergeLookup = (row: number, col: number) => Range | null;

/**
 * One step from `from`: a merged cell is left from its far edge in the
 * direction of the move (so covered cells are skipped, as in Excel).
 */
export function step(from: Cell, dRow: number, dCol: number, mergeAt?: MergeLookup): Cell {
  const m = mergeAt?.(from.row, from.col) ?? null;
  const row = !m || dRow === 0 ? from.row : dRow > 0 ? m.r1 : m.r0;
  const col = !m || dCol === 0 ? from.col : dCol > 0 ? m.c1 : m.c0;
  return { row: clampRow(row + dRow), col: clampCol(col + dCol) };
}

/** Moves the active cell (collapsing) or, with `extend`, the focus corner; a merged target becomes its top-left cell. */
export function move(sel: Selection, dRow: number, dCol: number, extend: boolean, mergeAt?: MergeLookup): Selection {
  if (extend) return { anchor: sel.anchor, focus: step(sel.focus, dRow, dCol, mergeAt) };
  const to = step(sel.anchor, dRow, dCol, mergeAt);
  const m = mergeAt?.(to.row, to.col) ?? null;
  return m ? cellSelection(m.r0, m.c0) : cellSelection(to.row, to.col);
}

export function moveTo(sel: Selection, cell: Cell, extend: boolean): Selection {
  return extend ? { anchor: sel.anchor, focus: { ...cell } } : cellSelection(cell.row, cell.col);
}

/** What the navigation needs to know about the sheet's content. */
export interface NavContext {
  isFilled(row: number, col: number): boolean;
  /** Last row/col with content (−1 when empty). */
  usedLastRow: number;
  usedLastCol: number;
  /** Rows visible in the viewport (Page Up/Down step). */
  pageRows: number;
  /** Merged cells of the sheet (absent: none). */
  mergeAt?: MergeLookup;
}

/**
 * Ctrl+Arrow: from a filled cell with a filled neighbour, jump to the
 * last filled cell of the run; otherwise to the next filled cell, or the
 * sheet edge when there is none.
 */
export function dataEdge(from: Cell, dRow: number, dCol: number, ctx: NavContext): Cell {
  const inside = (r: number, c: number) => r >= 0 && r <= LAST_ROW && c >= 0 && c <= LAST_COL;
  let { row: r, col: c } = from;
  if (!inside(r + dRow, c + dCol)) return { row: r, col: c };
  if (ctx.isFilled(r, c) && ctx.isFilled(r + dRow, c + dCol)) {
    while (inside(r + dRow, c + dCol) && ctx.isFilled(r + dRow, c + dCol)) {
      r += dRow;
      c += dCol;
    }
    return { row: r, col: c };
  }
  for (;;) {
    r += dRow;
    c += dCol;
    // Past the used range nothing can be filled: go straight to the edge.
    if ((dRow > 0 && r > ctx.usedLastRow) || (dCol > 0 && c > ctx.usedLastCol)) {
      return { row: dRow > 0 ? LAST_ROW : r, col: dCol > 0 ? LAST_COL : c };
    }
    if (!inside(r + dRow, c + dCol) || ctx.isFilled(r, c)) return { row: r, col: c };
  }
}

export interface KeyInput {
  key: string;
  shift: boolean;
  ctrl: boolean;
}

/** Applies a navigation key; `null` when the key is not a navigation key. */
export function navigate(sel: Selection, k: KeyInput, ctx: NavContext): Selection | null {
  const arrows: Record<string, [number, number]> = {
    ArrowUp: [-1, 0],
    ArrowDown: [1, 0],
    ArrowLeft: [0, -1],
    ArrowRight: [0, 1],
  };
  const d = arrows[k.key];
  if (d) {
    if (k.ctrl) {
      const from = k.shift ? sel.focus : sel.anchor;
      return moveTo(sel, dataEdge(from, d[0], d[1], ctx), k.shift);
    }
    return move(sel, d[0], d[1], k.shift, ctx.mergeAt);
  }
  switch (k.key) {
    case "Tab":
      return move(sel, 0, k.shift ? -1 : 1, false, ctx.mergeAt);
    case "Enter":
      return move(sel, k.shift ? -1 : 1, 0, false, ctx.mergeAt);
    // Ctrl+PageDown / PageUp switch sheets (the shortcut layer), not the selection.
    case "PageDown":
      return k.ctrl ? null : move(sel, Math.max(1, ctx.pageRows), 0, k.shift, ctx.mergeAt);
    case "PageUp":
      return k.ctrl ? null : move(sel, -Math.max(1, ctx.pageRows), 0, k.shift, ctx.mergeAt);
    case "Home": {
      const row = k.ctrl ? 0 : (k.shift ? sel.focus : sel.anchor).row;
      return moveTo(sel, { row, col: 0 }, k.shift);
    }
    case "End": {
      const row = k.ctrl ? Math.max(0, ctx.usedLastRow) : (k.shift ? sel.focus : sel.anchor).row;
      return moveTo(sel, { row, col: Math.max(0, ctx.usedLastCol) }, k.shift);
    }
    case "a":
    case "A":
      if (k.ctrl) {
        if (ctx.usedLastRow < 0) return { anchor: { row: 0, col: 0 }, focus: { row: LAST_ROW, col: LAST_COL } };
        return { anchor: { row: 0, col: 0 }, focus: { row: ctx.usedLastRow, col: ctx.usedLastCol } };
      }
      return null;
    default:
      return null;
  }
}
