// P9-C7: cell rendering edge cases as a table (overflow, `####`, General in narrow cells, rotation, indent, Fill / Justify).
import { describe, expect, it } from "vitest";
import type { CellStyle } from "../generated/CellStyle";
import type { CellView } from "../generated/CellView";
import type { Rect } from "../generated/Rect";
import { colGeometry, DEFAULT_FORMAT, rowGeometry } from "./geometry";
import { computeRenderOps, repeatToFill, rotatedAnchor, type SheetData, type TextOp } from "./render";
import type { Measure } from "./textLayout";

const m7: Measure = (t) => t.length * 7;
const vp = { scrollX: 0, scrollY: 0, width: 320, height: 60 }; // columns A–E (64 px), rows 1–3

const STYLES: CellStyle[] = [
  {},
  { alignment: { horizontal: "right" } },
  { alignment: { horizontal: "center" } },
  { numberFormat: "m/d/yyyy" },
  { numberFormat: "0.00" },
  { alignment: { textRotation: 45 } },
  { alignment: { textRotation: 90 } },
  { alignment: { horizontal: "right", indent: 2 } },
  { alignment: { horizontal: "fill" } },
  { alignment: { horizontal: "justify" } },
  { fill: { kind: "solid", color: { kind: "rgb", value: "FFFF00" } } },
  { alignment: { horizontal: "left", indent: 1 } },
];

type Cell = [row: number, col: number, display: string, kind: CellView["kind"], style?: number];

function sheet(cells: Cell[], merges: Rect[] = []): SheetData {
  const map = new Map<number, Map<number, CellView>>();
  for (const [row, col, display, kind, style = 0] of cells) {
    if (!map.has(row)) map.set(row, new Map());
    map.get(row)!.set(col, { row, col, input: display, display, kind, style });
  }
  const cols = new Map();
  const rows = new Map();
  return { cells: map, cols, rows, colGeo: colGeometry(DEFAULT_FORMAT, cols), rowGeo: rowGeometry(DEFAULT_FORMAT, rows), merges };
}

const textAt = (cells: Cell[], row: number, col: number, merges: Rect[] = []): TextOp => {
  const ops = computeRenderOps(vp, sheet(cells, merges), STYLES, m7);
  const t = ops.find((o): o is TextOp => o.op === "text" && o.row === row && o.col === col);
  if (!t) throw new Error(`no text at ${row},${col}`);
  return t;
};

const long = "x".repeat(20); // 140 px + padding: needs three columns

describe("cell rendering edge cases (table)", () => {
  const cases: { name: string; cells: Cell[]; at: [number, number]; merges?: Rect[]; expect: Partial<TextOp> }[] = [
    { name: "left-aligned text overflows right into empty cells", cells: [[0, 0, long, "text"]], at: [0, 0], expect: { clipX: 0, clipW: 192 } },
    { name: "a non-empty neighbour stops the overflow", cells: [[0, 0, long, "text"], [0, 1, "b", "text"]], at: [0, 0], expect: { clipX: 0, clipW: 64 } },
    { name: "a merged neighbour stops the overflow", cells: [[0, 0, long, "text"]], at: [0, 0], merges: [{ r0: 0, c0: 1, r1: 1, c1: 2 }], expect: { clipX: 0, clipW: 64 } },
    { name: "right-aligned text overflows left", cells: [[0, 3, long, "text", 1]], at: [0, 3], expect: { clipX: 64, clipW: 192, align: "right" } },
    { name: "centred text overflows both ways", cells: [[0, 2, long, "text", 2]], at: [0, 2], expect: { clipX: 64, clipW: 192, align: "center" } },
    { name: "an empty filled cell is overflowed into", cells: [[0, 0, long, "text"], [0, 1, "", "empty", 10]], at: [0, 0], expect: { clipW: 192 } },
    { name: "errors overflow like text (centred: both ways)", cells: [[0, 2, "#VALUE!#VALUE!#VALUE!", "error"]], at: [0, 2], expect: { clipX: 64, clipW: 192 } },
    { name: "a date that does not fit shows ####", cells: [[0, 0, "12/31/2024 extra", "number", 3]], at: [0, 0], expect: { text: "########", clipW: 64 } },
    { name: "a fixed-decimals number that does not fit shows ####", cells: [[0, 0, "123456789.00", "number", 4]], at: [0, 0], expect: { text: "########" } },
    { name: "General keeps its precision until it must round", cells: [[0, 0, "3.14159265", "number"]], at: [0, 0], expect: { text: "3.141593" } },
    { name: "a small General number in a narrow cell goes scientific", cells: [[0, 0, "0.0000123456", "number"]], at: [0, 0], expect: { text: "1.23E-05" } },
    { name: "a large General number in a narrow cell goes scientific", cells: [[0, 0, "123456789012", "number"]], at: [0, 0], expect: { text: "1.23E+11" } },
    { name: "numbers never overflow", cells: [[0, 0, "123456789012", "number"]], at: [0, 0], expect: { clipX: 0, clipW: 64 } },
    { name: "45° text wider than its cell overflows right", cells: [[0, 0, long, "text", 5]], at: [0, 0], expect: { rotation: 45, clipX: 0, clipW: 128 } },
    { name: "vertical text never overflows", cells: [[0, 0, long, "text", 6]], at: [0, 0], expect: { rotation: 90, clipX: 0, clipW: 64 } },
    { name: "a right indent narrows the text box from the right", cells: [[0, 0, "ab", "text", 7]], at: [0, 0], expect: { x: 0, w: 64 - 18, align: "right" } },
    { name: "a left indent moves the text right", cells: [[0, 0, "ab", "text", 11]], at: [0, 0], expect: { x: 9, w: 64 - 9 } },
    { name: "Fill repeats the content across the cell", cells: [[0, 0, "ab", "text", 8]], at: [0, 0], expect: { text: "abababab", clipW: 64 } },
    { name: "Justify breaks into lines", cells: [[0, 0, "alpha beta gamma", "text", 9]], at: [0, 0], expect: { lines: ["alpha", "beta", "gamma"] } },
  ];
  for (const c of cases) {
    it(c.name, () => {
      expect(textAt(c.cells, c.at[0], c.at[1], c.merges)).toMatchObject(c.expect);
    });
  }

  it("rotated text that overflows starts at its alignment corner, fitting text turns around the centre", () => {
    const base = { x: 0, y: 0, w: 64, h: 20, align: "left" as const, rotation: 45 };
    expect(rotatedAnchor({ ...base, clipX: 0, clipW: 64 })).toEqual({ x: 32, y: 10, align: "center" });
    expect(rotatedAnchor({ ...base, clipX: 0, clipW: 128 })).toEqual({ x: 7, y: 13, align: "left" });
    expect(rotatedAnchor({ ...base, rotation: -45, clipX: 0, clipW: 128 })).toEqual({ x: 7, y: 7, align: "left" });
    expect(rotatedAnchor({ ...base, align: "right", clipX: -64, clipW: 128 })).toEqual({ x: 57, y: 7, align: "right" });
  });

  it("Fill shows the text at least once", () => {
    expect(repeatToFill("abcdefghijk", 30, "", m7)).toBe("abcdefghijk");
    expect(repeatToFill("-", 21, "", m7)).toBe("---");
  });
});
