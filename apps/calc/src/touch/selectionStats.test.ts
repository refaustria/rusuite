import { describe, expect, it } from "vitest";
import type { CellView } from "../generated/CellView";
import { cellNumber, selectionStats, statKinds, statValue } from "./selectionStats";

const cell = (row: number, col: number, input: string, display = input, kind: CellView["kind"] = "number"): CellView => ({ row, col, input, display, kind, style: 0 });

describe("selection statistics (P10-M3)", () => {
  it("reads numbers from constants and displayed formula results, not from dates", () => {
    expect(cellNumber(cell(0, 0, "12.5"))).toBe(12.5);
    expect(cellNumber(cell(0, 0, "=A1*2", "1,234.50"))).toBe(1234.5);
    expect(cellNumber(cell(0, 0, "50%"))).toBe(0.5);
    expect(cellNumber(cell(0, 0, "=-A1", "(3.00)"))).toBe(-3);
    expect(cellNumber(cell(0, 0, "-4"))).toBe(-4);
    expect(cellNumber(cell(0, 0, "10/23/2026"))).toBeNull();
    expect(cellNumber(cell(0, 0, "abc", "abc", "text"))).toBeNull();
  });
  it("sums, averages and counts the areas once per cell", () => {
    const cells = new Map([
      [1, new Map([[1, cell(1, 1, "1")], [2, cell(1, 2, "x", "x", "text")]])],
      [2, new Map([[1, cell(2, 1, "2")]])],
      [3, new Map([[1, cell(3, 1, "4")]])],
    ]);
    const s = selectionStats(cells, [{ r0: 1, c0: 1, r1: 3, c1: 2 }, { r0: 1, c0: 1, r1: 1, c1: 1 }])!;
    expect(s).toEqual({ count: 4, numbers: 3, sum: 7 });
    expect(statValue(s, "average")).toBe(2.333333333);
    expect(statKinds(s)).toEqual(["sum", "average", "count"]);
    expect(selectionStats(cells, [{ r0: 1, c0: 1, r1: 1, c1: 1 }])).toBeNull();
    expect(statKinds({ count: 2, numbers: 0, sum: 0 })).toEqual(["count"]);
  });
});
