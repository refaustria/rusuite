import { describe, expect, it } from "vitest";
import type { CellStyle } from "../generated/CellStyle";
import type { CellView } from "../generated/CellView";
import type { CfResult } from "../generated/CfResult";
import type { DataBarDraw } from "../generated/DataBarDraw";
import type { IconSetKind } from "../generated/IconSetKind";
import { barFillCss, barGrowsLeft, barRect, cfKey, cfStyle, ICON_SETS, ICON_SIZE, iconCount, withDxf } from "./cf";
import { colGeometry, DEFAULT_FORMAT, rowGeometry } from "./geometry";
import { computeRenderOps, type RenderOp, type SheetData } from "./render";
import type { Measure } from "./textLayout";

const m7: Measure = (t) => t.length * 7;
const red = { kind: "rgb" as const, value: "FF0000" };
const blue = { kind: "rgb" as const, value: "638EC6" };
const styles: CellStyle[] = [{}, { fill: { kind: "solid", color: { kind: "rgb", value: "FFFF00" } }, font: { bold: true } }];

function sheet(cells: CellView[], cf: [number, number, CfResult][], merges?: SheetData["merges"]): SheetData {
  const map = new Map<number, Map<number, CellView>>();
  for (const c of cells) {
    if (!map.has(c.row)) map.set(c.row, new Map());
    map.get(c.row)!.set(c.col, c);
  }
  const cols = new Map();
  const rows = new Map();
  return {
    cells: map, cols, rows, colGeo: colGeometry(DEFAULT_FORMAT, cols), rowGeo: rowGeometry(DEFAULT_FORMAT, rows), merges,
    cf: new Map(cf.map(([r, c, res]) => [cfKey(r, c), res])),
  };
}
const num = (row: number, col: number, n: number, style = 0): CellView => ({ row, col, input: String(n), display: String(n), kind: "number", style });
const vp = { scrollX: 0, scrollY: 0, width: 300, height: 100 };
const ops = (s: SheetData) => computeRenderOps(vp, s, styles, m7);
const of = <K extends RenderOp["op"]>(list: RenderOp[], k: K) => list.filter((o): o is Extract<RenderOp, { op: K }> => o.op === k);

describe("differential formats", () => {
  it("withDxf lays the rule's format over the cell style", () => {
    const out = withDxf(styles[1]!, {
      fontColor: red, italic: true, underline: true, strike: true, fill: blue, numberFormat: "0.00",
      borders: { top: { style: "thin", color: red } },
    });
    expect(out.font).toEqual({ bold: true, color: red, italic: true, underline: "single", strike: true });
    expect(out.fill).toEqual({ kind: "solid", color: blue });
    expect(out.borders?.top).toEqual({ style: "thin", color: red });
    expect(out.numberFormat).toBe("0.00");
    expect(withDxf(styles[1]!, undefined)).toBe(styles[1]);
  });

  it("a colour scale fills the cell unless the highlight format has a fill", () => {
    expect(cfStyle({}, { color: red }).fill).toEqual({ kind: "solid", color: red });
    expect(cfStyle({}, { color: red, dxf: { fill: blue } }).fill).toEqual({ kind: "solid", color: blue });
    expect(cfStyle(styles[1]!, undefined)).toBe(styles[1]);
  });

  it("the canvas uses the dxf fill and font colour of a matching cell", () => {
    const list = ops(sheet([num(0, 0, 7, 1)], [[0, 0, { dxf: { fill: { kind: "rgb", value: "FFC7CE" }, fontColor: { kind: "rgb", value: "9C0006" } } }]]));
    expect(of(list, "fill")).toEqual([{ op: "fill", x: 0, y: 0, w: 64, h: 20, color: "#FFC7CE" }]);
    const [text] = of(list, "text");
    expect(text!.color).toBe("#9C0006");
    expect(text!.font).toMatch(/^bold /);
  });

  it("colour-scale fills reach blank cells without a cell view", () => {
    const list = ops(sheet([], [[1, 2, { color: red }]]));
    expect(of(list, "fill")).toEqual([{ op: "fill", x: 128, y: 20, w: 64, h: 20, color: "#FF0000" }]);
  });

  it("a merged range takes its top-left cell's conditional fill", () => {
    const list = ops(sheet([num(0, 0, 1)], [[0, 0, { dxf: { fill: red } }]], [{ r0: 0, c0: 0, r1: 1, c1: 1 }]));
    expect(list).toContainEqual({ op: "fill", x: 0, y: 0, w: 127, h: 39, color: "#FF0000" });
  });
});

describe("data bars", () => {
  const bar = (from: number, to: number, extra: Partial<DataBarDraw> = {}): DataBarDraw => ({ from, to, color: blue, gradient: true, ...extra });

  it("draws the core's bar span inside the cell, under the gridlines", () => {
    const list = ops(sheet([num(0, 0, 5)], [[0, 0, { bar: bar(0, 0.5, { border: blue }) }]]));
    const [b] = of(list, "bar");
    expect(b).toEqual({ op: "bar", row: 0, col: 0, x: 2, y: 2, w: 30, h: 15, color: "#638EC6", negative: false, fade: "right", border: "#638EC6" });
    expect(list.findIndex((o) => o.op === "bar")).toBeLessThan(list.findIndex((o) => o.op === "gridlines"));
  });

  it("negative bars grow left of the axis in their own colour; the axis has its colour", () => {
    const neg = { kind: "rgb" as const, value: "0000FF" };
    const s = sheet([num(0, 0, -5), num(1, 0, 5)], [
      [0, 0, { bar: bar(0, 0.5, { negative: true, axis: 0.5, color: neg, axisColor: red }) }],
      [1, 0, { bar: bar(0.5, 1, { axis: 0.5, gradient: false }) }],
    ]);
    const [n, p] = of(ops(s), "bar");
    expect(n).toMatchObject({ row: 0, x: 2, w: 30, color: "#0000FF", negative: true, fade: "left", axisX: 32, axisColor: "#FF0000" });
    expect(p).toMatchObject({ row: 1, x: 32, w: 30, color: "#638EC6", negative: false, axisX: 32, axisColor: "#000000" });
    expect(p).not.toHaveProperty("fade");
  });

  it("barRect clamps the span; barGrowsLeft follows the axis or the right-to-left edge", () => {
    expect(barRect(bar(-0.5, 1.5), 0, 64)).toEqual({ x: 2, w: 60 });
    expect(barRect(bar(0.25, 0.25, { axis: 0.25 }), 10, 44)).toEqual({ x: 22, w: 0, axisX: 22 });
    expect(barGrowsLeft(bar(0.1, 0.5, { axis: 0.5 }))).toBe(true);
    expect(barGrowsLeft(bar(0.5, 0.9, { axis: 0.5 }))).toBe(false);
    expect(barGrowsLeft(bar(0.4, 1))).toBe(true);
    expect(barGrowsLeft(bar(0, 0.6))).toBe(false);
    expect(barFillCss(bar(0, 1, { gradient: false }))).toBe("#638EC6");
    expect(barFillCss(bar(0.4, 1))).toBe("linear-gradient(to left, #638EC6, #ffffff)");
  });

  it("Show Bar Only (hideValue) draws the bar but no text", () => {
    const list = ops(sheet([num(0, 0, 5)], [[0, 0, { bar: bar(0, 1), hideValue: true }]]));
    expect(of(list, "bar")).toHaveLength(1);
    expect(of(list, "text")).toHaveLength(0);
  });

  it("a rule's number format replaces the displayed text", () => {
    const list = ops(sheet([num(0, 0, 5)], [[0, 0, { dxf: { numberFormat: "0.00" }, display: "5.00" }]]));
    expect(of(list, "text")[0]).toMatchObject({ text: "5.00" });
  });
});

describe("icon sets", () => {
  it("draws the icon at the cell's left edge and moves the text after it", () => {
    const s = sheet([{ row: 0, col: 1, input: "ok", display: "ok", kind: "text", style: 0 }], [[0, 1, { icon: 2, iconSet: "3Arrows" }]]);
    const list = ops(s);
    expect(of(list, "icon")).toEqual([{ op: "icon", row: 0, col: 1, x: 66, y: 2, size: ICON_SIZE, set: "3Arrows", index: 2 }]);
    expect(of(list, "text")[0]).toMatchObject({ x: 64 + ICON_SIZE + 2, w: 64 - ICON_SIZE - 2 });
    // Icons paint after the borders, before the texts.
    expect(list.findIndex((o) => o.op === "icon")).toBeLessThan(list.findIndex((o) => o.op === "text"));
  });

  it("Show Icon Only hides the value", () => {
    const list = ops(sheet([num(0, 0, 3)], [[0, 0, { icon: 0, iconSet: "3TrafficLights1", hideValue: true }]]));
    expect(of(list, "icon")).toHaveLength(1);
    expect(of(list, "text")).toHaveLength(0);
  });

  it("every set has as many glyphs as its name says, each made of SVG path parts", () => {
    for (const [set, glyphs] of Object.entries(ICON_SETS) as [IconSetKind, (typeof ICON_SETS)[IconSetKind]][]) {
      expect(glyphs).toHaveLength(Number(set[0]));
      expect(iconCount(set)).toBe(glyphs.length);
      for (const g of glyphs) {
        expect(g.length).toBeGreaterThan(0);
        for (const part of g) {
          expect(part.d).toMatch(/^M[\d.\s]/);
          expect(part.fill).toMatch(/^#[0-9A-F]{6}$/i);
        }
      }
    }
  });

  it("rating icons fill more bars towards the highest value", () => {
    const filled = (set: IconSetKind) => ICON_SETS[set].map((g) => g.filter((p) => p.fill !== "#C9C9C9").length);
    expect(filled("4Rating")).toEqual([1, 2, 3, 4]);
    expect(filled("5Rating")).toEqual([0, 1, 2, 3, 4]);
  });
});
