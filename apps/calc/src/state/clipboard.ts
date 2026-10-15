// Clipboard and fill-handle helpers (pure): the internal clipboard
// block, TSV conversion, where a paste lands and what a fill-handle drag
// covers.

import type { CellView } from "../generated/CellView";
import type { ClipCell } from "../generated/ClipCell";
import type { Rect } from "../generated/Rect";
import type { Cell, Range } from "../grid/Selection";

/** The internal clipboard: the copied block as inputs + style ids, and its source. */
export interface Clip {
  sheet: number;
  range: Range;
  cells: ClipCell[];
  /** Ctrl+X: the paste moves the cells. */
  cut: boolean;
  /** The TSV written to the system clipboard (recognises our own copy on paste). */
  tsv: string;
}

/**
 * Captures `range` from a sheet's cached cells: non-empty or styled
 * cells become clip cells (input + effective style id), and the TSV of
 * the inputs is built alongside.
 */
export function captureClip(
  cells: Map<number, Map<number, CellView>>, sheet: number, range: Range, cut: boolean,
): Clip {
  const clip: ClipCell[] = [];
  const lines: string[] = [];
  for (let row = range.r0; row <= range.r1; row++) {
    const rowCells = cells.get(row);
    const fields: string[] = [];
    for (let col = range.c0; col <= range.c1; col++) {
      const c = rowCells?.get(col);
      fields.push(c?.input ?? "");
      if (c && (c.input !== "" || c.style !== 0)) clip.push({ dr: row - range.r0, dc: col - range.c0, input: c.input, style: c.style });
    }
    lines.push(fields.join("\t"));
  }
  return { sheet, range: { ...range }, cells: clip, cut, tsv: lines.join("\n") };
}

/** Parses TSV (Excel's clipboard format) into rows of cells. */
export function parseTsv(text: string): string[][] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines.map((l) => l.split("\t"));
}

/** Plain text from another program as a clip block: inputs only (destination formats kept). */
export function tsvClip(text: string): { cells: ClipCell[]; rows: number; cols: number } {
  const rows = parseTsv(text);
  const cols = Math.max(1, ...rows.map((r) => r.length));
  const cells: ClipCell[] = [];
  rows.forEach((fields, dr) => fields.forEach((input, dc) => cells.push({ dr, dc, input })));
  return { cells, rows: rows.length, cols };
}

/**
 * Where a block of `rows × cols` lands for the selection `sel`: at its
 * top-left, repeated to fill it when the selection is a multiple of the
 * block in both directions (Excel); otherwise once.
 */
export function pasteTarget(sel: Range, rows: number, cols: number): { r0: number; c0: number; repeatRows: number; repeatCols: number } {
  const h = sel.r1 - sel.r0 + 1;
  const w = sel.c1 - sel.c0 + 1;
  const tiles = h % rows === 0 && w % cols === 0 && h * w > rows * cols;
  return { r0: sel.r0, c0: sel.c0, repeatRows: tiles ? h / rows : 1, repeatCols: tiles ? w / cols : 1 };
}

/**
 * The cells a fill-handle drag from `src` to the pointer cell covers
 * (excluding `src`), or `null` while the pointer is inside `src`. The
 * axis is the one along which the pointer is farther outside, as in
 * Excel.
 */
export function fillTarget(src: Range, to: Cell): Rect | null {
  const down = to.row - src.r1;
  const up = src.r0 - to.row;
  const right = to.col - src.c1;
  const left = src.c0 - to.col;
  const vertical = Math.max(down, up);
  const horizontal = Math.max(right, left);
  if (vertical <= 0 && horizontal <= 0) return null;
  if (vertical >= horizontal) {
    return down > 0 ? { r0: src.r1 + 1, c0: src.c0, r1: to.row, c1: src.c1 } : { r0: to.row, c0: src.c0, r1: src.r0 - 1, c1: src.c1 };
  }
  return right > 0 ? { r0: src.r0, c0: src.c1 + 1, r1: src.r1, c1: to.col } : { r0: src.r0, c0: to.col, r1: src.r1, c1: src.c0 - 1 };
}

/**
 * Double-click on the fill handle: the last row to fill down to — the
 * end of the data in the column left of `src` (or, without data there,
 * right of it), as Excel does. `null` when there is nothing to follow.
 */
export function fillDownEnd(src: Range, isFilled: (row: number, col: number) => boolean, lastRow: number): number | null {
  for (const col of [src.c0 - 1, src.c1 + 1]) {
    if (col < 0 || !isFilled(src.r1 + 1, col)) continue;
    let row = src.r1 + 1;
    while (row + 1 <= lastRow && isFilled(row + 1, col)) row++;
    return row;
  }
  return null;
}
