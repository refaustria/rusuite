// Sum / Average / Count of the selection for the compact status chip (P10-M3), from the loaded cells (the grid's
// cache: what has been scrolled into view, which is the whole sheet for the ranges a phone selects).

import type { CellView } from "../generated/CellView";
import type { Range } from "../grid/Selection";

export interface SelectionStats {
  /** Non-empty cells. */
  count: number;
  /** Cells with a number. */
  numbers: number;
  sum: number;
}

/** A cell's number: its constant as typed, or (formulas) its displayed value; dates and times are left out. */
export function cellNumber(cell: CellView): number | null {
  if (cell.kind !== "number") return null;
  const src = (cell.input && !cell.input.startsWith("=") ? cell.input : cell.display).trim();
  // Dates and times: their serial number is not what the cell shows.
  if (/\d[/.:-]\d+[/.:-]\d|\d:\d/.test(src)) return null;
  const negative = /^\(.*\)$/.test(src) || /^-/.test(src.replace(/^[^\d-]+/, ""));
  const percent = src.endsWith("%");
  const digits = src.replace(/[^0-9.eE]/g, "");
  if (digits === "") return null;
  const n = Number(digits);
  if (!Number.isFinite(n)) return null;
  return (negative ? -n : n) / (percent ? 100 : 1);
}

/** The statistics of `areas` over `cells`; `null` for a single cell. */
export function selectionStats(cells: Map<number, Map<number, CellView>>, areas: Range[]): SelectionStats | null {
  if (areas.length === 1 && areas[0]!.r0 === areas[0]!.r1 && areas[0]!.c0 === areas[0]!.c1) return null;
  let count = 0, numbers = 0, sum = 0;
  const seen = new Set<string>();
  for (const a of areas) {
    for (const [r, row] of cells) {
      if (r < a.r0 || r > a.r1) continue;
      for (const [c, cell] of row) {
        if (c < a.c0 || c > a.c1 || cell.kind === "empty" || (cell.input === "" && cell.display === "")) continue;
        const key = `${r},${c}`;
        if (seen.has(key)) continue;
        seen.add(key);
        count++;
        const n = cellNumber(cell);
        if (n !== null) {
          numbers++;
          sum += n;
        }
      }
    }
  }
  return { count, numbers, sum };
}

export type StatKind = "sum" | "average" | "count";

/** The kinds the chip cycles through for `s` (no numbers: Count only). */
export function statKinds(s: SelectionStats): StatKind[] {
  return s.numbers > 0 ? ["sum", "average", "count"] : ["count"];
}

/** The value of `kind`, rounded to 10 significant digits (no float noise like 0.30000000000000004). */
export function statValue(s: SelectionStats, kind: StatKind): number {
  const v = kind === "sum" ? s.sum : kind === "average" ? (s.numbers > 0 ? s.sum / s.numbers : 0) : s.count;
  return Number(v.toPrecision(10));
}
