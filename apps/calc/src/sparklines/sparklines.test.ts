// P9-C6: sparklines – Insert's range rules, group operations, the drawing
// of line / column / win-loss sparklines and the style gallery.

import { describe, expect, it } from "vitest";
import type { SparklineGroup } from "../generated/SparklineGroup";
import { clearSelected, editSelected, groupRanges, groupSelected, groupsIn, planSparklines, sparkRef, ungroupSelected, withGroup } from "./controller";
import { groupRange, sparklineOps, sparkOpsSvg, type SparkOp } from "./render";
import { sparklineStyle, styleOf } from "./styles";

const box = { x: 0, y: 0, w: 64, h: 20 };
const g = (extra: Partial<SparklineGroup> = {}): SparklineGroup => ({ sparklines: [{ row: 0, col: 5, data: "Sheet1!A1:D1" }], ...extra });
const kinds = (ops: SparkOp[]) => ops.map((o) => o.t);

describe("Insert › Sparklines", () => {
  it("a column of locations takes one data row each; a row of locations one column each", () => {
    const p = planSparklines("A2:D4", "F2:F4", "Sheet1");
    expect(p).toEqual({ sparklines: [2, 3, 4].map((r) => ({ row: r - 1, col: 5, data: `Sheet1!A${r}:D${r}` })) });
    const q = planSparklines("'My data'!B2:D5", "B7:D7", "Report");
    expect("sparklines" in q && q.sparklines.map((s) => s.data)).toEqual(["'My data'!B2:B5", "'My data'!C2:C5", "'My data'!D2:D5"]);
    expect(planSparklines("A1:A6", "B1", "S")).toEqual({ sparklines: [{ row: 0, col: 1, data: "S!A1:A6" }] });
  });

  it("refuses Excel's invalid cases", () => {
    expect(planSparklines("nonsense", "F1", "S")).toEqual({ error: "dataInvalid" });
    expect(planSparklines("A1:B2", "F1:G2", "S")).toEqual({ error: "locationLine" });
    expect(planSparklines("A1:B2", "F1", "S")).toEqual({ error: "mismatch" });
    expect(planSparklines("A1:D3", "F1:F2", "S")).toEqual({ error: "mismatch" });
    expect(planSparklines("A1:D1", "Other!F1", "S")).toEqual({ error: "locationInvalid" });
    expect(sparkRef("It's", { r0: 0, c0: 0, r1: 0, c1: 3 })).toBe("'It''s'!A1:D1");
  });
});

describe("group operations", () => {
  const two: SparklineGroup[] = [
    { sparklines: [{ row: 0, col: 5, data: "S!A1:D1" }, { row: 1, col: 5, data: "S!A2:D2" }], high: true },
    { kind: "column", sparklines: [{ row: 2, col: 5, data: "S!A3:D3" }] },
  ];
  const sel = (r0: number, r1: number) => ({ r0, c0: 5, r1, c1: 5 });
  it("group, ungroup, clear and edit act on the selected sparklines' groups", () => {
    expect(groupsIn(two, sel(1, 2))).toEqual([0, 1]);
    const merged = groupSelected(two, sel(0, 2), 1);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.kind).toBe("column");
    expect(merged[0]!.sparklines).toHaveLength(3);
    expect(groupSelected(two, sel(0, 0), 0)).toEqual(two);
    const split = ungroupSelected(two, sel(0, 0));
    expect(split.map((x) => x.sparklines.length)).toEqual([1, 1, 1]);
    expect(split[1]!.high).toBe(true);
    expect(clearSelected(two, sel(1, 1), false)[0]!.sparklines).toHaveLength(1);
    expect(clearSelected(two, sel(1, 1), true)).toHaveLength(1);
    expect(editSelected(two, sel(2, 2), (x) => ({ ...x, negative: true }))[1]!.negative).toBe(true);
    // A new group takes over its cells from the others.
    const w = withGroup(two, { sparklines: [{ row: 1, col: 5, data: "S!B2:C2" }] });
    expect(w.map((x) => x.sparklines.length)).toEqual([1, 1, 1]);
    expect(groupRanges(two[0]!)).toEqual({ data: "S!A1:D2", location: "F1:F2" });
  });
});

describe("drawing", () => {
  it("a line with high and low points in their colours; markers on every point", () => {
    const grp = g({ high: true, low: true, colors: { ...sparklineStyle(1), high: { kind: "rgb", value: "00B050" }, low: { kind: "rgb", value: "FF0000" } } });
    const ops = sparklineOps(grp, { values: [3, 8, 1, 5] }, box);
    expect(kinds(ops)).toEqual(["line", "dot", "dot"]);
    const dots = ops.filter((o): o is Extract<SparkOp, { t: "dot" }> => o.t === "dot");
    expect(dots.map((d) => d.color)).toEqual(["#00B050", "#FF0000"]);
    // The high point is at the top of the inner box, the low one at the bottom.
    expect(dots[0]!.y).toBeLessThan(dots[1]!.y);
    expect(kinds(sparklineOps(g({ markers: true }), { values: [3, 8, 1] }, box)).filter((k) => k === "dot")).toHaveLength(3);
  });

  it("empty cells: gaps split the line, span connects it, zero plots 0", () => {
    const v = { values: [1, null, 3, 4] };
    expect(kinds(sparklineOps(g(), v, box))).toEqual(["line"]);
    const gap = sparklineOps(g(), v, box) as Extract<SparkOp, { t: "line" }>[];
    expect(gap[0]!.points).toHaveLength(2);
    expect((sparklineOps(g({ emptyCells: "span" }), v, box)[0] as Extract<SparkOp, { t: "line" }>).points).toHaveLength(3);
    expect((sparklineOps(g({ emptyCells: "zero" }), v, box)[0] as Extract<SparkOp, { t: "line" }>).points).toHaveLength(4);
  });

  it("columns grow from zero when the data crosses it; negative and highlighted columns are coloured", () => {
    const neg = { kind: "rgb" as const, value: "C00000" };
    const ops = sparklineOps(g({ kind: "column", negative: true, showAxis: true, colors: { ...sparklineStyle(1), negative: neg } }), { values: [4, -2, 3] }, box);
    const rects = ops.filter((o): o is Extract<SparkOp, { t: "rect" }> => o.t === "rect");
    expect(rects).toHaveLength(3);
    expect(rects[1]!.color).toBe("#C00000");
    const axis = ops.find((o) => o.t === "line") as Extract<SparkOp, { t: "line" }>;
    expect(rects[0]!.y + rects[0]!.h).toBeCloseTo(axis.points[0]![1]);
    expect(rects[1]!.y).toBeCloseTo(axis.points[0]![1]);
  });

  it("win/loss bars are equal halves; right-to-left reverses; custom bounds clamp", () => {
    const ops = sparklineOps(g({ kind: "winLoss" }), { values: [5, -1, 0, 2] }, box) as Extract<SparkOp, { t: "rect" }>[];
    expect(ops).toHaveLength(3);
    expect(new Set(ops.map((o) => o.h)).size).toBe(1);
    const ltr = sparklineOps(g({ high: true }), { values: [9, 1, 1] }, box).find((o) => o.t === "dot")!;
    const rtl = sparklineOps(g({ high: true, rightToLeft: true }), { values: [9, 1, 1] }, box).find((o) => o.t === "dot")!;
    expect((rtl as { x: number }).x).toBeGreaterThan((ltr as { x: number }).x);
    const clamp = sparklineOps(g({ kind: "column", minAxis: { type: "custom", value: 0 }, maxAxis: { type: "custom", value: 10 } }), { values: [5, 20] }, box) as Extract<SparkOp, { t: "rect" }>[];
    expect(clamp[1]!.y).toBeCloseTo(3);
    expect(groupRange([{ values: [1, 5] }, { values: [-2, null] }], g())).toEqual({ min: -2, max: 5 });
  });

  it("a date axis spaces the points by date; the SVG carries the ops", () => {
    const ops = sparklineOps(g(), { values: [1, 2, 3], dates: [0, 1, 10] }, box)[0] as Extract<SparkOp, { t: "line" }>;
    const [a, b, c] = ops.points.map((p) => p[0]);
    expect(b! - a!).toBeLessThan((c! - b!) / 5);
    expect(sparkOpsSvg(sparklineOps(g({ kind: "column" }), { values: [1, 2] }, box), 64, 20)).toContain("<rect");
    expect(sparklineOps(g(), { values: [null, null] }, box)).toEqual([]);
  });

  it("the 36 styles: rows of shades per accent, matching the Rust table", () => {
    expect(sparklineStyle(1).series).toEqual({ kind: "theme", value: { slot: "accent1", tint: -0.5 } });
    expect(sparklineStyle(8).series).toEqual({ kind: "theme", value: { slot: "accent2", tint: -0.25 } });
    expect(sparklineStyle(29).low).toEqual({ kind: "rgb", value: "000000" });
    expect(sparklineStyle(36).series).toEqual({ kind: "theme", value: { slot: "dark1", tint: 0.35 } });
    expect(styleOf(sparklineStyle(17))).toBe(17);
    expect(styleOf(undefined)).toBe(1);
  });
});
