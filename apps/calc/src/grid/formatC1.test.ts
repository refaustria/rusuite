// P9-C1: pattern fills, accounting underlines and rotated text on the
// canvas and in print; Home › Borders presets; rotated row heights.
import { describe, expect, it } from "vitest";
import type { CellStyle } from "../generated/CellStyle";
import type { CellView } from "../generated/CellView";
import { colGeometry, DEFAULT_FORMAT, rowGeometry } from "./geometry";
import { computeRenderOps, underlineKindOf, underlineRects, type SheetData } from "./render";
import { patternBackground, patternBit, patternCoverage, patternSvg, PATTERN_TYPES } from "./patterns";
import { cellCss, buildPrintTable } from "../print/printTable";
import { presetEdits } from "../ui/bordersMenu";
import { rotatedHeight } from "../state/store";
import type { Measure } from "./textLayout";

const m7: Measure = (t) => t.length * 7;
const red = { kind: "rgb", value: "FF0000" } as const;

function sheet(cells: CellView[]): SheetData {
  const map = new Map<number, Map<number, CellView>>();
  for (const c of cells) {
    if (!map.has(c.row)) map.set(c.row, new Map());
    map.get(c.row)!.set(c.col, c);
  }
  const cols = new Map();
  const rows = new Map();
  return { cells: map, cols, rows, colGeo: colGeometry(DEFAULT_FORMAT, cols), rowGeo: rowGeometry(DEFAULT_FORMAT, rows) };
}
const v = (row: number, col: number, display: string, style: number): CellView => ({ row, col, input: display, display, kind: "text", style });
const vp = { scrollX: 0, scrollY: 0, width: 200, height: 70 };

describe("pattern fills", () => {
  it("has Excel's 17 pattern styles with sensible coverage", () => {
    expect(PATTERN_TYPES).toHaveLength(17);
    expect(patternCoverage("darkGray")).toBe(0.75);
    expect(patternCoverage("mediumGray")).toBe(0.5);
    expect(patternCoverage("lightGray")).toBe(0.25);
    expect(patternCoverage("gray125")).toBe(0.125);
    expect(patternCoverage("gray0625")).toBe(0.0625);
    expect([0, 1, 2, 3].map((x) => patternBit("lightVertical", x, 2))).toEqual([true, false, false, false]);
    expect([0, 1, 2, 3].map((y) => patternBit("lightHorizontal", 1, y))).toEqual([true, false, false, false]);
    for (const p of PATTERN_TYPES) expect(patternCoverage(p)).toBeGreaterThan(0);
  });

  it("renders as a pattern op and prints as an SVG background", () => {
    const styles: CellStyle[] = [{}, { fill: { kind: "pattern", color: { pattern: "darkGrid", fg: red } } }];
    const ops = computeRenderOps(vp, sheet([v(0, 0, "x", 1)]), styles, m7);
    expect(ops.find((o) => o.op === "pattern")).toEqual({ op: "pattern", x: 0, y: 0, w: 64, h: 20, pattern: "darkGrid", fg: "#FF0000", bg: "#ffffff" });
    const css = cellCss(styles[1]!, "text");
    expect(css.backgroundColor).toBe("#ffffff");
    expect(String(css.backgroundImage)).toMatch(/^url\("data:image\/svg\+xml,/);
    expect(decodeURIComponent(String(css.backgroundImage))).toContain('fill="#FF0000"');
    expect(patternBackground({ pattern: "lightUp" }).backgroundColor).toBe("#ffffff");
    expect(patternSvg("gray0625", "#000", "#fff").match(/<rect x=/g)).toHaveLength(1);
  });
});

describe("accounting underlines", () => {
  it("run across the cell, lower; double ones have two lines", () => {
    const styles: CellStyle[] = [{}, { font: { underline: "single" }, underlineAccounting: true }, { font: { underline: "double" }, underlineAccounting: true }, { font: { underline: "double" } }];
    expect(styles.map(underlineKindOf)).toEqual(["single", "singleAccounting", "doubleAccounting", "double"]);
    const ops = computeRenderOps(vp, sheet([v(0, 0, "ab", 1), v(1, 0, "ab", 2), v(2, 0, "ab", 0)]), styles, m7).flatMap((o) => (o.op === "text" ? [o] : []));
    expect(ops.map((o) => o.underlineKind)).toEqual(["singleAccounting", "doubleAccounting", undefined]);
    const single = underlineRects(ops[0]!, 3, 14, 15);
    expect(single).toEqual([{ x: 2, y: 18, w: 59 }]);
    expect(underlineRects(ops[1]!, 3, 14, 15)).toHaveLength(2);
    expect(underlineRects({ x: 0, w: 64, clipW: 64 }, 3, 14, 15)).toEqual([{ x: 3, y: 16, w: 14 }]);
    expect(cellCss(styles[2]!, "text")).toMatchObject({ textDecoration: "underline", textDecorationStyle: "double", textUnderlineOffset: "0.3em" });
  });
});

describe("rotation and diagonal borders in print", () => {
  it("prints rotated text and both diagonals", () => {
    const styles: CellStyle[] = [{}, { alignment: { textRotation: 45 }, borders: { diagonalUp: { style: "thin", color: red }, diagonalDown: { style: "thin", color: red } } }];
    const css = cellCss(styles[1]!, "text");
    const images = String(css.backgroundImage);
    expect(images).toContain("to top left");
    expect(images).toContain("to top right");
    const cache = { cells: new Map([[0, new Map([[0, v(0, 0, "turned", 1)]])]]), cols: new Map(), rows: new Map(), format: DEFAULT_FORMAT, merges: [] } as unknown as Parameters<typeof buildPrintTable>[0];
    const t = buildPrintTable(cache, styles, 0, 0);
    expect(t.rows[0]!.cells[0]!.rotation).toBe(45);
  });

  it("grows rows for rotated text", () => {
    expect(rotatedHeight(100, 20, 90)).toBe(106);
    expect(rotatedHeight(100, 20, 0)).toBe(26);
    expect(rotatedHeight(100, 20, -45)).toBe(Math.ceil(100 * Math.SQRT1_2 + 20 * Math.SQRT1_2 + 6));
  });
});

describe("Borders presets", () => {
  it("map to setBorders edits like Excel", () => {
    expect(presetEdits("none")).toMatchObject({ top: { kind: "none" }, insideHorizontal: { kind: "none" }, diagonalDown: { kind: "none" } });
    expect(Object.keys(presetEdits("all")).sort()).toEqual(["bottom", "insideHorizontal", "insideVertical", "left", "right", "top"]);
    expect(Object.keys(presetEdits("outside")).sort()).toEqual(["bottom", "left", "right", "top"]);
    expect(presetEdits("thickOutside").top).toEqual({ kind: "line", side: { style: "medium", color: { kind: "auto" } } });
    expect(presetEdits("bottomDouble")).toEqual({ bottom: { kind: "line", side: { style: "double", color: { kind: "auto" } } } });
  });
});
