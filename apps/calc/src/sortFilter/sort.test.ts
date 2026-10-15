import { describe, expect, it } from "vitest";
import type { CellView } from "../generated/CellView";
import { currentRegion, duplicateColumns, guessHeader, MAX_SORT_LEVELS, moveLevel, nextLevel, sortRangeCommand, sortScope, type SortLevel } from "./sort";

/** A sheet from rows of strings ("" = empty); numbers are cells of kind number. */
function sheet(rows: (string | number)[][], styles: Record<string, number> = {}) {
  const cells = new Map<string, CellView>();
  rows.forEach((r, row) =>
    r.forEach((v, col) => {
      if (v === "") return;
      const kind = typeof v === "number" ? "number" : "text";
      cells.set(`${row},${col}`, { row, col, input: String(v), display: String(v), kind, style: styles[`${row},${col}`] ?? 0 });
    }),
  );
  const lastRow = rows.length - 1;
  const lastCol = Math.max(...rows.map((r) => r.length)) - 1;
  return {
    filled: (r: number, c: number) => cells.has(`${r},${c}`),
    cellAt: (r: number, c: number) => cells.get(`${r},${c}`),
    used: { lastRow, lastCol },
  };
}

describe("currentRegion", () => {
  const s = sheet([
    ["Name", "Qty", "", ""],
    ["b", 2, "", ""],
    ["a", 1, "", "x"],
    ["", "", "", ""],
    ["z", "", "", ""],
  ]);
  it("grows over adjacent data, diagonals included", () => {
    expect(currentRegion(s.filled, 1, 0, s.used)).toEqual({ r0: 0, c0: 0, r1: 2, c1: 1 });
  });
  it("stops at empty rows and columns", () => {
    expect(currentRegion(s.filled, 4, 0, s.used)).toEqual({ r0: 4, c0: 0, r1: 4, c1: 0 });
    expect(currentRegion(s.filled, 2, 3, s.used)).toEqual({ r0: 2, c0: 3, r1: 2, c1: 3 });
  });
  it("is the cell itself on an empty sheet", () => {
    expect(currentRegion(() => false, 5, 5, { lastRow: -1, lastCol: -1 })).toEqual({ r0: 5, c0: 5, r1: 5, c1: 5 });
  });
  it("starting from an empty cell next to data takes the data", () => {
    expect(currentRegion(s.filled, 3, 2, s.used)).toEqual({ r0: 0, c0: 0, r1: 4, c1: 3 });
  });
});

describe("sortScope (expand-selection prompt)", () => {
  const region = { r0: 0, c0: 0, r1: 5, c1: 2 };
  it("a single cell sorts its region without asking", () => {
    expect(sortScope({ r0: 2, c0: 1, r1: 2, c1: 1 }, region)).toEqual({ range: region, expandTo: null });
  });
  it("one column of a wider table asks to expand to the whole table", () => {
    const sel = { r0: 1, c0: 1, r1: 5, c1: 1 };
    expect(sortScope(sel, region)).toEqual({ range: sel, expandTo: { r0: 0, c0: 0, r1: 5, c1: 2 } });
  });
  it("a selection over all the table's columns sorts as is", () => {
    const sel = { r0: 1, c0: 0, r1: 3, c1: 2 };
    expect(sortScope(sel, region)).toEqual({ range: sel, expandTo: null });
  });
  it("a single-row selection does not ask", () => {
    const sel = { r0: 1, c0: 0, r1: 1, c1: 1 };
    expect(sortScope(sel, region).expandTo).toBeNull();
  });
});

describe("guessHeader", () => {
  it("text over numbers is a header", () => {
    const s = sheet([["Name", "Qty"], ["b", 2], ["a", 1]]);
    expect(guessHeader({ r0: 0, c0: 0, r1: 2, c1: 1 }, s.cellAt)).toBe(true);
  });
  it("all-text rows with the same format are not", () => {
    const s = sheet([["x", "y"], ["b", "c"], ["a", "d"]]);
    expect(guessHeader({ r0: 0, c0: 0, r1: 2, c1: 1 }, s.cellAt)).toBe(false);
  });
  it("all-text rows with a differently formatted first row are", () => {
    const s = sheet([["x", "y"], ["b", "c"]], { "0,0": 3 });
    expect(guessHeader({ r0: 0, c0: 0, r1: 1, c1: 1 }, s.cellAt, 0)).toBe(true);
  });
  it("a number in the first row, or a single row, is not", () => {
    const s = sheet([[1, "y"], [2, 3]]);
    expect(guessHeader({ r0: 0, c0: 0, r1: 1, c1: 1 }, s.cellAt)).toBe(false);
    expect(guessHeader({ r0: 0, c0: 0, r1: 0, c1: 1 }, s.cellAt)).toBe(false);
  });
});

describe("sort levels", () => {
  const range = { r0: 0, c0: 2, r1: 9, c1: 4 };
  it("a new level takes the first column not used yet", () => {
    expect(nextLevel([], range)).toEqual({ col: 2, ascending: true, kind: "auto" });
    expect(nextLevel([{ col: 2, ascending: true, kind: "auto" }, { col: 3, ascending: false, kind: "text" }], range)?.col).toBe(4);
    const all: SortLevel[] = [2, 3, 4].map((col) => ({ col, ascending: true, kind: "auto" }));
    expect(nextLevel(all, range)).toBeNull();
    const many: SortLevel[] = Array.from({ length: MAX_SORT_LEVELS }, () => ({ col: 0, ascending: true, kind: "auto" }));
    expect(nextLevel(many, { r0: 0, c0: 0, r1: 1, c1: 100 })).toBeNull();
  });
  it("moves levels up and down within bounds", () => {
    const ls: SortLevel[] = [2, 3, 4].map((col) => ({ col, ascending: true, kind: "auto" }));
    expect(moveLevel(ls, 1, -1).map((l) => l.col)).toEqual([3, 2, 4]);
    expect(moveLevel(ls, 1, 1).map((l) => l.col)).toEqual([2, 4, 3]);
    expect(moveLevel(ls, 0, -1).map((l) => l.col)).toEqual([2, 3, 4]);
  });
  it("finds columns sorted by twice", () => {
    expect(duplicateColumns([{ col: 1, ascending: true, kind: "auto" }, { col: 1, ascending: false, kind: "auto" }, { col: 2, ascending: true, kind: "auto" }])).toEqual([1]);
    expect(duplicateColumns([{ col: 1, ascending: true, kind: "auto" }])).toEqual([]);
  });
});

describe("sortRangeCommand (Custom Sort dialog → command)", () => {
  it("builds sortRange with keys, header and case flags; auto kinds are omitted", () => {
    const cmd = sortRangeCommand(
      0,
      { r0: 0, c0: 0, r1: 9, c1: 2 },
      [{ col: 1, ascending: false, kind: "numbers" }, { col: 0, ascending: true, kind: "auto" }],
      true,
      true,
    );
    expect(cmd).toEqual({
      type: "sortRange", sheet: 0, r0: 0, c0: 0, r1: 9, c1: 2,
      keys: [{ col: 1, ascending: false, kind: "numbers" }, { col: 0, ascending: true }],
      hasHeader: true, caseSensitive: true,
    });
  });
});
