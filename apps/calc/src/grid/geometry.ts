// Row/column geometry: default size plus sparse overrides, with offsets
// from prefix sums of the overrides' deltas and index lookup by binary
// search. Memory is O(overrides), never O(rows).

import type { ColView } from "../generated/ColView";
import type { RowView } from "../generated/RowView";
import type { SheetFormat } from "../generated/SheetFormat";

/** Excel limits (row/column counts). */
export const MAX_ROWS = 1_048_576;
export const MAX_COLS = 16_384;

/** Excel character units → px (Calibri 11 max digit width 7 px + 5 px padding). */
export function colWidthPx(chars: number): number {
  return Math.round(chars * 7 + 5);
}

/** Points → CSS px. */
export function rowHeightPx(pt: number): number {
  return Math.round((pt * 96) / 72);
}

export const DEFAULT_FORMAT: SheetFormat = { defaultColWidth: 8.43, defaultRowHeight: 15 };

export class AxisGeometry {
  /** Sorted indices with a non-default size. */
  private idx: number[] = [];
  /** `prefix[k]` = sum of (size − default) over `idx[0..k)`. */
  private prefix: number[] = [0];
  private readonly sizes: Map<number, number>;

  constructor(
    readonly defaultSize: number,
    sizes: Map<number, number> = new Map(),
    readonly count: number = MAX_ROWS,
  ) {
    const entries = [...sizes.entries()].filter(([, s]) => s !== defaultSize).sort((a, b) => a[0] - b[0]);
    this.sizes = new Map(entries);
    for (const [i, s] of entries) {
      this.idx.push(i);
      this.prefix.push(this.prefix[this.prefix.length - 1] + (s - defaultSize));
    }
  }

  size(i: number): number {
    return this.sizes.get(i) ?? this.defaultSize;
  }

  /** Number of overrides with index < i. */
  private below(i: number): number {
    let lo = 0;
    let hi = this.idx.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.idx[mid] < i) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** Start offset of index `i` (= total size of `0..i`). */
  offset(i: number): number {
    return i * this.defaultSize + this.prefix[this.below(i)];
  }

  /** The index whose span contains `pos` (clamped to `0..count-1`); hidden (0-size) indices are skipped. */
  indexAt(pos: number): number {
    if (pos <= 0) return this.firstVisibleFrom(0);
    let lo = 0;
    let hi = this.count - 1;
    // Largest i with offset(i) <= pos.
    while (lo < hi) {
      const mid = Math.floor((lo + hi + 1) / 2);
      if (this.offset(mid) <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  private firstVisibleFrom(i: number): number {
    while (i < this.count - 1 && this.size(i) === 0) i++;
    return i;
  }

  /** Indices intersecting `[start, start + length)`. */
  visibleRange(start: number, length: number): [number, number] {
    const first = this.indexAt(start);
    const last = Math.max(first, this.indexAt(start + Math.max(0, length - 1)));
    return [first, last];
  }
}

/** Builds the column geometry of a sheet from its cached column views. */
export function colGeometry(format: SheetFormat, cols: Map<number, ColView>): AxisGeometry {
  const sizes = new Map<number, number>();
  for (const c of cols.values()) {
    if (c.hidden) sizes.set(c.col, 0);
    else if (c.width !== null) sizes.set(c.col, colWidthPx(c.width));
  }
  return new AxisGeometry(colWidthPx(format.defaultColWidth), sizes, MAX_COLS);
}

/** Builds the row geometry of a sheet from its cached row views. */
export function rowGeometry(format: SheetFormat, rows: Map<number, RowView>): AxisGeometry {
  const sizes = new Map<number, number>();
  for (const r of rows.values()) {
    if (r.hidden) sizes.set(r.row, 0);
    else if (r.height !== null) sizes.set(r.row, rowHeightPx(r.height));
  }
  return new AxisGeometry(rowHeightPx(format.defaultRowHeight), sizes, MAX_ROWS);
}
