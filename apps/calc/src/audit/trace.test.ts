// Trace arrows (pure): geometry and the arrows from the core's lists.
import { describe, expect, it } from "vitest";
import { colGeometry, DEFAULT_FORMAT, rowGeometry } from "../grid/geometry";
import { arrowGeometry, dependentArrows, mergeArrows, precedentArrows } from "./trace";

const col = colGeometry(DEFAULT_FORMAT, new Map());
const row = rowGeometry(DEFAULT_FORMAT, new Map());

describe("trace arrows", () => {
  it("draws from the precedent's centre to the formula cell's centre, the head at the end", () => {
    const g = arrowGeometry(col, row, { sheet: 0, from: { r0: 0, c0: 0, r1: 0, c1: 0 }, to: { row: 0, col: 2 }, external: false, kind: "precedents" });
    expect([g.x1, g.y1, g.x2, g.y2]).toEqual([32, 10, 160, 10]);
    expect(g.box).toBeNull();
    // The head points along the line: both back corners lie left of the tip.
    expect(g.head[0]).toBeLessThan(160);
    expect(g.head[2]).toBeLessThan(160);
    expect(g.head[1]).not.toBe(g.head[3]);
  });

  it("boxes precedent ranges and starts external arrows from a sheet icon", () => {
    const g = arrowGeometry(col, row, { sheet: 0, from: { r0: 1, c0: 0, r1: 4, c1: 1 }, to: { row: 6, col: 3 }, external: false, kind: "precedents" });
    expect(g.box).toEqual({ x: 0, y: 20, w: 128, h: 80 });
    expect([g.x1, g.y1]).toEqual([32, 30]);
    const ext = arrowGeometry(col, row, { sheet: 0, from: { r0: 0, c0: 0, r1: 0, c1: 0 }, to: { row: 5, col: 4 }, external: true, kind: "precedents" });
    expect([ext.x1, ext.y1]).toEqual([256 - 40, 100 - 24]);
    expect(ext.box).toBeNull();
  });

  it("turns the core's lists into arrows", () => {
    const p = precedentArrows(0, { row: 5, col: 2 }, [
      { sheet: 0, r0: 0, c0: 0, r1: 3, c1: 0 },
      { sheet: 1, r0: 0, c0: 0, r1: 0, c1: 0 },
      { sheet: 0, r0: 5, c0: 2, r1: 5, c1: 2 },
    ]);
    expect(p.map((a) => [a.external, a.from.r1])).toEqual([[false, 3], [true, 0]]);
    const d = dependentArrows(0, { row: 1, col: 1 }, [{ sheet: 0, r0: 4, c0: 4, r1: 4, c1: 4 }, { sheet: 2, r0: 0, c0: 0, r1: 0, c1: 0 }]);
    expect(d).toEqual([
      { sheet: 0, from: { r0: 1, c0: 1, r1: 1, c1: 1 }, to: { row: 4, col: 4 }, external: false, kind: "dependents" },
      { sheet: 2, from: { r0: 0, c0: 0, r1: 0, c1: 0 }, to: { row: 0, col: 0 }, external: true, kind: "dependents" },
    ]);
    expect(mergeArrows(p, p)).toHaveLength(2);
    expect(mergeArrows(p, d)).toHaveLength(4);
  });
});
