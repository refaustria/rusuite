// P8-3: merged cells – lookups, selection snapping, keyboard navigation, the split check.
import { describe, expect, it } from "vitest";
import type { Rect } from "../generated/Rect";
import { expandToMerges, isCovered, isSingleCell, mergeAnchor, mergeAt, mergeLookup, mergeSnapshot, partialMerge, snapSelection } from "./merges";
import { cellSelection, navigate, normalize, step, type NavContext } from "./Selection";

const A1C1: Rect = { r0: 0, c0: 0, r1: 0, c1: 2 };
const B3D5: Rect = { r0: 2, c0: 1, r1: 4, c1: 3 };
const merges = [A1C1, B3D5];

const ctx = (extra: Partial<NavContext> = {}): NavContext => ({
  isFilled: () => false, usedLastRow: -1, usedLastCol: -1, pageRows: 10, mergeAt: mergeLookup(merges), ...extra,
});
const key = (k: string, shift = false) => ({ key: k, shift, ctrl: false });

describe("merge lookups", () => {
  it("finds the merge of a cell, its anchor and whether it is covered", () => {
    expect(mergeAt(merges, 0, 1)).toBe(A1C1);
    expect(mergeAt(merges, 1, 1)).toBeNull();
    expect(mergeAnchor(merges, { row: 4, col: 3 })).toEqual({ row: 2, col: 1 });
    expect(mergeAnchor(merges, { row: 9, col: 9 })).toEqual({ row: 9, col: 9 });
    expect(isCovered(merges, 0, 0)).toBe(false);
    expect(isCovered(merges, 0, 2)).toBe(true);
    expect(mergeLookup([])).toBeUndefined();
  });

  it("grows a range to whole merges, transitively", () => {
    expect(expandToMerges({ r0: 0, c0: 2, r1: 2, c1: 2 }, merges)).toEqual({ r0: 0, c0: 0, r1: 4, c1: 3 });
    const chain: Rect[] = [{ r0: 0, c0: 0, r1: 1, c1: 0 }, { r0: 1, c0: 1, r1: 3, c1: 1 }];
    expect(expandToMerges({ r0: 0, c0: 0, r1: 0, c1: 1 }, chain)).toEqual({ r0: 0, c0: 0, r1: 3, c1: 1 });
  });

  it("detects ranges that cut through a merge", () => {
    expect(partialMerge({ r0: 0, c0: 0, r1: 0, c1: 1 }, merges)).toBe(A1C1);
    expect(partialMerge({ r0: 0, c0: 0, r1: 0, c1: 2 }, merges)).toBeNull();
    expect(partialMerge({ r0: 5, c0: 0, r1: 9, c1: 9 }, merges)).toBeNull();
    expect(isSingleCell({ r0: 0, c0: 0, r1: 0, c1: 2 }, merges)).toBe(true);
    expect(isSingleCell({ r0: 0, c0: 0, r1: 0, c1: 1 }, merges)).toBe(false);
  });

  it("applies snapshot merges for their region and keeps the others", () => {
    const next = mergeSnapshot(merges, { r0: 0, c0: 0, r1: 1, c1: 31 }, [{ r0: 1, c0: 5, r1: 1, c1: 6 }]);
    expect(next).toEqual([{ r0: 1, c0: 5, r1: 1, c1: 6 }, B3D5]);
  });
});

describe("selection snapping", () => {
  it("clicking a covered cell selects the whole merge with its top-left as the active cell", () => {
    const s = snapSelection(cellSelection(0, 1), merges);
    expect(s.anchor).toEqual({ row: 0, col: 0 });
    expect(normalize(s)).toEqual({ r0: 0, c0: 0, r1: 0, c1: 2 });
    expect(s.range).toBeUndefined();
  });

  it("a range touching a merge grows to include it", () => {
    const s = snapSelection({ anchor: { row: 1, col: 0 }, focus: { row: 3, col: 1 } }, merges);
    expect(normalize(s)).toEqual({ r0: 1, c0: 0, r1: 4, c1: 3 });
    expect(s.anchor).toEqual({ row: 1, col: 0 });
    expect(s.focus).toEqual({ row: 4, col: 3 });
  });

  it("keeps the range explicitly when the active cell is no corner of it", () => {
    const s = snapSelection({ anchor: { row: 1, col: 4 }, focus: { row: 3, col: 4 } }, [{ r0: 0, c0: 3, r1: 2, c1: 4 }]);
    expect(s.anchor).toEqual({ row: 0, col: 3 });
    const wide = snapSelection({ anchor: { row: 5, col: 0 }, focus: { row: 6, col: 2 } }, [{ r0: 4, c0: 1, r1: 5, c1: 1 }]);
    expect(wide.anchor).toEqual({ row: 5, col: 0 });
    expect(wide.range).toEqual({ r0: 4, c0: 0, r1: 6, c1: 2 });
    expect(normalize(wide)).toEqual({ r0: 4, c0: 0, r1: 6, c1: 2 });
  });

  it("without merges a selection is unchanged", () => {
    const s = { anchor: { row: 3, col: 3 }, focus: { row: 1, col: 1 } };
    expect(snapSelection(s, [])).toBe(s);
  });
});

describe("keyboard navigation over merges", () => {
  it("arrows skip the cells a merge covers", () => {
    expect(navigate(cellSelection(0, 0), key("ArrowRight"), ctx())?.anchor).toEqual({ row: 0, col: 3 });
    expect(navigate(cellSelection(0, 3), key("ArrowLeft"), ctx())?.anchor).toEqual({ row: 0, col: 0 });
    // Into a merge from below: its top-left.
    expect(navigate(cellSelection(5, 3), key("ArrowUp"), ctx())?.anchor).toEqual({ row: 2, col: 1 });
    // Out of it downwards: below its last row.
    expect(navigate(cellSelection(2, 1), key("ArrowDown"), ctx())?.anchor).toEqual({ row: 5, col: 1 });
    expect(navigate(cellSelection(2, 1), key("Tab"), ctx())?.anchor).toEqual({ row: 2, col: 4 });
  });

  it("Shift+Arrow extends from the far edge of a merged focus", () => {
    const sel = { anchor: { row: 0, col: 0 }, focus: { row: 0, col: 2 } };
    expect(navigate(sel, key("ArrowRight", true), ctx())?.focus).toEqual({ row: 0, col: 3 });
    expect(step({ row: 3, col: 2 }, 1, 0, mergeLookup(merges))).toEqual({ row: 5, col: 2 });
    expect(step({ row: 3, col: 2 }, 1, 0)).toEqual({ row: 4, col: 2 });
  });
});
