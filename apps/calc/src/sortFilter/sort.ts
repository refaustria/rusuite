// Sort (P8-5): the pure parts of Excel's sort commands – the range a
// selection sorts (current region, "expand the selection?"), the header
// guess and the Custom Sort dialog's levels → `sortRange`.

import type { CalcCommand } from "../generated/CalcCommand";
import type { CellView } from "../generated/CellView";
import type { SortKey } from "../generated/SortKey";
import type { SortKind } from "../generated/SortKind";
import type { SortOn } from "../generated/SortOn";
import type { Range } from "../grid/Selection";

/** Whether a cell has content (cached cells). */
export type IsFilled = (row: number, col: number) => boolean;

/**
 * Excel's CurrentRegion (Ctrl+*) around `(row, col)`: grows while a
 * filled cell touches the rectangle, diagonals included – the same walk
 * as `model_sheet::Workbook::current_region`, over the cached cells.
 * `used` bounds the walk (the last used row/column, −1 when empty).
 */
export function currentRegion(isFilled: IsFilled, row: number, col: number, used: { lastRow: number; lastCol: number }): Range {
  let r0 = row, c0 = col, r1 = row, c1 = col;
  if (used.lastRow < 0 || used.lastCol < 0) return { r0, c0, r1, c1 };
  const any = (from: number, to: number, f: (i: number) => boolean) => {
    for (let i = from; i <= to; i++) if (f(i)) return true;
    return false;
  };
  for (;;) {
    const loC = Math.max(0, c0 - 1), hiC = Math.min(c1 + 1, used.lastCol);
    const loR = Math.max(0, r0 - 1), hiR = Math.min(r1 + 1, used.lastRow);
    let grown = false;
    if (r0 > 0 && any(loC, hiC, (c) => isFilled(r0 - 1, c))) {
      r0--;
      grown = true;
    }
    if (r1 < used.lastRow && any(loC, hiC, (c) => isFilled(r1 + 1, c))) {
      r1++;
      grown = true;
    }
    if (c0 > 0 && any(loR, hiR, (r) => isFilled(r, c0 - 1))) {
      c0--;
      grown = true;
    }
    if (c1 < used.lastCol && any(loR, hiR, (r) => isFilled(r, c1 + 1))) {
      c1++;
      grown = true;
    }
    if (!grown) return { r0, c0, r1, c1 };
  }
}

const isSingle = (r: Range) => r.r0 === r.r1 && r.c0 === r.c1;

/**
 * What a sort from the selection `sel` works on. A single cell sorts its
 * current region; a selection that covers fewer columns than the data
 * around it asks Excel's "expand the selection?" (`expandTo`: the
 * region and the selection together); otherwise the selection as is.
 */
export function sortScope(sel: Range, region: Range): { range: Range; expandTo: Range | null } {
  if (isSingle(sel)) return { range: region, expandTo: null };
  const narrower = sel.r0 < sel.r1 && (region.c0 < sel.c0 || region.c1 > sel.c1);
  if (!narrower) return { range: sel, expandTo: null };
  const expandTo = {
    r0: Math.min(sel.r0, region.r0), c0: Math.min(sel.c0, region.c0), r1: Math.max(sel.r1, region.r1), c1: Math.max(sel.c1, region.c1),
  };
  return { range: sel, expandTo };
}

/**
 * Excel's header guess (the Sort dialog's "My data has headers"): the
 * first row holds only text (and blanks, at least one text) and some
 * cell of the second row is not text, or the key column's first two
 * cells are formatted differently – as the core's `looks_like_header`.
 */
export function guessHeader(range: Range, cellAt: (row: number, col: number) => CellView | undefined, key = range.c0): boolean {
  if (range.r1 <= range.r0) return false;
  const kind = (r: number, c: number) => cellAt(r, c)?.kind ?? "empty";
  let text = false;
  for (let c = range.c0; c <= range.c1; c++) {
    const k = kind(range.r0, c);
    if (k === "text") text = true;
    else if (k !== "empty") return false;
  }
  if (!text) return false;
  for (let c = range.c0; c <= range.c1; c++) if (kind(range.r0 + 1, c) !== "text") return true;
  return (cellAt(range.r0, key)?.style ?? 0) !== (cellAt(range.r0 + 1, key)?.style ?? 0);
}

/** One row of the Custom Sort dialog. */
export interface SortLevel {
  /** Absolute column index (the row of a left-to-right sort). */
  col: number;
  /** Ascending, or (colour and icon levels) On Top. */
  ascending: boolean;
  kind: SortKind;
  /** Sort On: Cell Color / Font Color / Conditional Formatting Icon (absent: the values). */
  sortOn?: SortOn;
  /** Order › Custom List… (`Mon, Tue, …`). */
  customList?: string[];
}

/** Excel's built-in custom lists, as in `model_sheet::BUILTIN_CUSTOM_LISTS`. */
export const BUILTIN_LISTS: string[][] = [
  ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
  ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
];

/** A list typed into the Custom Lists box: entries separated by commas or line breaks (empty ones dropped). */
export function parseCustomList(text: string): string[] {
  return text.split(/[,\n]/).map((x) => x.trim()).filter((x) => x !== "");
}

/** Excel allows 64 sort levels. */
export const MAX_SORT_LEVELS = 64;

/** A new level: the first column of `range` not sorted by yet (`null` when all are, or at the limit). */
export function nextLevel(levels: readonly SortLevel[], range: Range): SortLevel | null {
  if (levels.length >= MAX_SORT_LEVELS) return null;
  const used = new Set(levels.map((l) => l.col));
  for (let c = range.c0; c <= range.c1; c++) if (!used.has(c)) return { col: c, ascending: true, kind: "auto" };
  return null;
}

/** Moves level `i` by `delta` (−1 up, 1 down); out-of-range moves change nothing. */
export function moveLevel(levels: readonly SortLevel[], i: number, delta: -1 | 1): SortLevel[] {
  const j = i + delta;
  if (i < 0 || i >= levels.length || j < 0 || j >= levels.length) return [...levels];
  const out = [...levels];
  [out[i], out[j]] = [out[j]!, out[i]!];
  return out;
}

/** Columns sorted by values more than once (Excel refuses: "… is being sorted by values more than once"); colour and icon levels may repeat a column. */
export function duplicateColumns(levels: readonly SortLevel[]): number[] {
  const seen = new Set<number>();
  const dup = new Set<number>();
  for (const l of levels) {
    if (l.sortOn && l.sortOn.type !== "values") continue;
    (seen.has(l.col) ? dup : seen).add(l.col);
  }
  return [...dup];
}

/** The `sortRange` command of the Custom Sort dialog (`columns`: Options › Sort left to right). */
export function sortRangeCommand(
  sheet: number, range: Range, levels: readonly SortLevel[], hasHeader: boolean, caseSensitive: boolean, columns = false,
): CalcCommand {
  const keys: SortKey[] = levels.map((l) => {
    const k: SortKey = { col: l.col, ascending: l.ascending };
    const byValue = !l.sortOn || l.sortOn.type === "values";
    if (l.kind !== "auto" && byValue) k.kind = l.kind;
    if (!byValue) k.sortOn = l.sortOn;
    if (byValue && l.customList && l.customList.length > 0) k.customList = [...l.customList];
    return k;
  });
  return { type: "sortRange", sheet, ...range, keys, hasHeader, caseSensitive, ...(columns ? { columns: true } : {}) };
}
