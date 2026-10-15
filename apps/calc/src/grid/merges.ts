// Merged cells on the client (pure): lookups, growing a range to whole
// merges, snapping selections to them, and the "partial overlap" check
// that makes paste and fill refuse to split a merge (as Excel does).

import type { Rect } from "../generated/Rect";
import { normalize, type Cell, type MergeLookup, type Range, type Selection } from "./Selection";

export const intersects = (a: Range, b: Range): boolean => a.r0 <= b.r1 && b.r0 <= a.r1 && a.c0 <= b.c1 && b.c0 <= a.c1;

/** `outer` contains `inner` completely. */
export const covers = (outer: Range, inner: Range): boolean =>
  outer.r0 <= inner.r0 && inner.r1 <= outer.r1 && outer.c0 <= inner.c0 && inner.c1 <= outer.c1;

export const sameRange = (a: Range, b: Range): boolean => a.r0 === b.r0 && a.c0 === b.c0 && a.r1 === b.r1 && a.c1 === b.c1;

const union = (a: Range, b: Range): Range => ({
  r0: Math.min(a.r0, b.r0), c0: Math.min(a.c0, b.c0), r1: Math.max(a.r1, b.r1), c1: Math.max(a.c1, b.c1),
});

/** The merge covering `row`/`col` (`null`: none). */
export function mergeAt(merges: readonly Rect[], row: number, col: number): Rect | null {
  for (const m of merges) if (row >= m.r0 && row <= m.r1 && col >= m.c0 && col <= m.c1) return m;
  return null;
}

/** A [`MergeLookup`] over a merge list (`undefined` when there are none). */
export function mergeLookup(merges: readonly Rect[]): MergeLookup | undefined {
  return merges.length === 0 ? undefined : (row, col) => mergeAt(merges, row, col);
}

/** Whether `cell` is covered by a merge without being its top-left cell. */
export function isCovered(merges: readonly Rect[], row: number, col: number): boolean {
  const m = mergeAt(merges, row, col);
  return m !== null && (m.r0 !== row || m.c0 !== col);
}

/** The top-left cell of the merge covering `cell`, else `cell` (where edits go). */
export function mergeAnchor(merges: readonly Rect[], cell: Cell): Cell {
  const m = mergeAt(merges, cell.row, cell.col);
  return m ? { row: m.r0, col: m.c0 } : { row: cell.row, col: cell.col };
}

/** The smallest range containing `r` and every merge it touches. */
export function expandToMerges(r: Range, merges: readonly Rect[]): Range {
  let out: Range = { r0: r.r0, c0: r.c0, r1: r.r1, c1: r.c1 };
  for (let changed = merges.length > 0; changed; ) {
    changed = false;
    for (const m of merges) {
      if (intersects(out, m) && !covers(out, m)) {
        out = union(out, m);
        changed = true;
      }
    }
  }
  return out;
}

/** A merge that `r` cuts through (intersects without containing it), `null` when none. */
export function partialMerge(r: Range, merges: readonly Rect[]): Rect | null {
  for (const m of merges) if (intersects(r, m) && !covers(r, m)) return m;
  return null;
}

/**
 * Snaps a selection to the merged cells: the active cell moves to the
 * top-left of its merge and the range grows to whole merges. When the
 * active cell is a corner of the grown range the focus becomes the
 * opposite corner; otherwise the range is kept explicitly.
 */
export function snapSelection(sel: Selection, merges: readonly Rect[]): Selection {
  if (merges.length === 0) return sel.range ? { anchor: sel.anchor, focus: sel.focus } : sel;
  const am = mergeAt(merges, sel.anchor.row, sel.anchor.col);
  const anchor = am ? { row: am.r0, col: am.c0 } : { ...sel.anchor };
  let r = normalize({ anchor: sel.anchor, focus: sel.focus });
  if (am) r = union(r, am);
  r = expandToMerges(r, merges);
  const row = anchor.row === r.r0 ? r.r1 : anchor.row === r.r1 ? r.r0 : null;
  const col = anchor.col === r.c0 ? r.c1 : anchor.col === r.c1 ? r.c0 : null;
  if (row !== null && col !== null) return { anchor, focus: { row, col } };
  return { anchor, focus: { ...sel.focus }, range: r };
}

/** The selection is exactly one merged cell (or a single cell): it acts as one cell. */
export function isSingleCell(r: Range, merges: readonly Rect[]): boolean {
  if (r.r0 === r.r1 && r.c0 === r.c1) return true;
  const m = mergeAt(merges, r.r0, r.c0);
  return m !== null && sameRange(m, r);
}

/** Applies a region snapshot's merges: the snapshot is authoritative for merges touching its region. */
export function mergeSnapshot(current: readonly Rect[], region: Range, fresh: readonly Rect[]): Rect[] {
  const key = (m: Rect) => `${m.r0}:${m.c0}:${m.r1}:${m.c1}`;
  const out = new Map<string, Rect>();
  for (const m of current) if (!intersects(m, region)) out.set(key(m), m);
  for (const m of fresh) out.set(key(m), { ...m });
  return [...out.values()].sort((a, b) => a.r0 - b.r0 || a.c0 - b.c0);
}
