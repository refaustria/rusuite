import { describe, expect, it } from "vitest";
import { AxisGeometry, colGeometry, colWidthPx, DEFAULT_FORMAT, rowGeometry, rowHeightPx } from "./geometry";

describe("geometry", () => {
  it("converts Excel units to px (defaults 64 × 20)", () => {
    expect(colWidthPx(8.43)).toBe(64);
    expect(rowHeightPx(15)).toBe(20);
    expect(colWidthPx(20)).toBe(145);
  });

  it("computes offsets from prefix sums of overrides", () => {
    const g = new AxisGeometry(10, new Map([[2, 30], [5, 0], [7, 10]]), 100);
    expect(g.offset(0)).toBe(0);
    expect(g.offset(2)).toBe(20);
    expect(g.offset(3)).toBe(50);
    expect(g.offset(5)).toBe(70);
    expect(g.offset(6)).toBe(70); // index 5 hidden
    expect(g.offset(10)).toBe(110);
    expect(g.size(2)).toBe(30);
    expect(g.size(7)).toBe(10);
  });

  it("finds the index at a position by binary search, skipping hidden ones", () => {
    const g = new AxisGeometry(10, new Map([[2, 30], [5, 0]]), 100);
    expect(g.indexAt(0)).toBe(0);
    expect(g.indexAt(19)).toBe(1);
    expect(g.indexAt(20)).toBe(2);
    expect(g.indexAt(49)).toBe(2);
    expect(g.indexAt(50)).toBe(3);
    expect(g.indexAt(70)).toBe(6); // not the hidden 5
    expect(g.indexAt(1e9)).toBe(99);
    expect(g.visibleRange(15, 40)).toEqual([1, 3]);
  });

  it("scales to a million rows without per-row storage", () => {
    const g = rowGeometry(DEFAULT_FORMAT, new Map([[500_000, { row: 500_000, height: 30, hidden: false, style: null }]]));
    expect(g.offset(1_000_000)).toBe(1_000_000 * 20 + 20);
    expect(g.indexAt(500_000 * 20 + 39)).toBe(500_000);
    expect(g.indexAt(500_000 * 20 + 40)).toBe(500_001);
  });

  it("builds column geometry from column views", () => {
    const g = colGeometry({ defaultColWidth: 10, defaultRowHeight: 15 }, new Map([
      [1, { col: 1, width: 20, hidden: false, style: null }],
      [2, { col: 2, width: null, hidden: true, style: null }],
      [3, { col: 3, width: null, hidden: false, style: 4 }],
    ]));
    expect(g.size(0)).toBe(75);
    expect(g.size(1)).toBe(145);
    expect(g.size(2)).toBe(0);
    expect(g.size(3)).toBe(75);
  });
});
