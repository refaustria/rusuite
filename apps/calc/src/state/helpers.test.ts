// P6-3 pure helpers: clipboard blocks, paste/fill targets, find & replace, number formats.
import { describe, expect, it } from "vitest";
import type { CellView } from "../generated/CellView";
import type { FoundCell } from "../generated/FoundCell";
import { buildCode, DEFAULT_CHOICE, parseCode, previewValue, SAMPLE_VALUE, type FormatChoice } from "../numberFormat";
import { captureClip, fillDownEnd, fillTarget, pasteTarget, tsvClip } from "./clipboard";
import { findStep, replaceInInput } from "./find";

const cell = (row: number, col: number, input: string, style = 0): CellView => ({ row, col, input, display: input, kind: "text", style });

function cells(list: CellView[]): Map<number, Map<number, CellView>> {
  const m = new Map<number, Map<number, CellView>>();
  for (const c of list) {
    if (!m.has(c.row)) m.set(c.row, new Map());
    m.get(c.row)!.set(c.col, c);
  }
  return m;
}

describe("clipboard helpers", () => {
  it("captures inputs and effective style ids relative to the block, plus TSV", () => {
    const clip = captureClip(cells([cell(1, 1, "=A1", 2), cell(2, 2, "x"), cell(2, 1, "", 3), cell(5, 5, "out")]), 0, { r0: 1, c0: 1, r1: 2, c1: 2 }, true);
    expect(clip.cells).toEqual([
      { dr: 0, dc: 0, input: "=A1", style: 2 },
      { dr: 1, dc: 0, input: "", style: 3 },
      { dr: 1, dc: 1, input: "x", style: 0 },
    ]);
    expect(clip.tsv).toBe("=A1\t\n\tx");
    expect(clip.cut).toBe(true);
  });

  it("turns system TSV into a block of plain inputs", () => {
    expect(tsvClip("a\tb\r\nc\n")).toEqual({
      cells: [{ dr: 0, dc: 0, input: "a" }, { dr: 0, dc: 1, input: "b" }, { dr: 1, dc: 0, input: "c" }],
      rows: 2, cols: 2,
    });
  });

  it("repeats a block over a selection that is a multiple of it", () => {
    expect(pasteTarget({ r0: 4, c0: 1, r1: 4, c1: 1 }, 2, 3)).toEqual({ r0: 4, c0: 1, repeatRows: 1, repeatCols: 1 });
    expect(pasteTarget({ r0: 0, c0: 0, r1: 5, c1: 2 }, 2, 1)).toEqual({ r0: 0, c0: 0, repeatRows: 3, repeatCols: 3 });
    expect(pasteTarget({ r0: 0, c0: 0, r1: 4, c1: 0 }, 2, 1)).toEqual({ r0: 0, c0: 0, repeatRows: 1, repeatCols: 1 });
  });

  it("fill-handle drags pick the farther axis and exclude the source", () => {
    const src = { r0: 2, c0: 2, r1: 3, c1: 3 };
    expect(fillTarget(src, { row: 3, col: 3 })).toBeNull();
    expect(fillTarget(src, { row: 9, col: 4 })).toEqual({ r0: 4, c0: 2, r1: 9, c1: 3 });
    expect(fillTarget(src, { row: 0, col: 3 })).toEqual({ r0: 0, c0: 2, r1: 1, c1: 3 });
    expect(fillTarget(src, { row: 4, col: 8 })).toEqual({ r0: 2, c0: 4, r1: 3, c1: 8 });
    expect(fillTarget(src, { row: 2, col: 0 })).toEqual({ r0: 2, c0: 0, r1: 3, c1: 1 });
  });

  it("double-click fills down to the end of the neighbouring column's data", () => {
    const filled = new Set(["0,0", "1,0", "2,0", "3,0", "6,0", "1,3"]);
    const isFilled = (r: number, c: number) => filled.has(`${r},${c}`);
    expect(fillDownEnd({ r0: 0, c0: 1, r1: 0, c1: 1 }, isFilled, 100)).toBe(3);
    expect(fillDownEnd({ r0: 0, c0: 2, r1: 0, c1: 2 }, isFilled, 100)).toBe(1); // right neighbour
    expect(fillDownEnd({ r0: 0, c0: 5, r1: 0, c1: 5 }, isFilled, 100)).toBeNull();
  });
});

describe("find helpers", () => {
  const f = (sheet: number, row: number, col: number): FoundCell => ({ sheet, row, col, input: "", display: "" });
  const found = [f(0, 5, 1), f(0, 1, 3), f(1, 0, 0)];

  it("steps forward and backward in sheet order and wraps", () => {
    expect(findStep(found, [0, 1], { sheet: 0, row: 0, col: 0 }, false)).toEqual(f(0, 1, 3));
    expect(findStep(found, [0, 1], { sheet: 0, row: 1, col: 3 }, false)).toEqual(f(0, 5, 1));
    expect(findStep(found, [0, 1], { sheet: 1, row: 0, col: 0 }, false)).toEqual(f(0, 1, 3));
    expect(findStep(found, [1, 0], { sheet: 1, row: 0, col: 0 }, false)).toEqual(f(0, 1, 3));
    expect(findStep(found, [0, 1], { sheet: 0, row: 1, col: 3 }, true)).toEqual(f(1, 0, 0));
    expect(findStep([], [0], { sheet: 0, row: 0, col: 0 }, false)).toBeNull();
  });

  it("replaces every occurrence, case-insensitively unless asked, or the whole cell", () => {
    expect(replaceInInput("Apple apple", "apple", "pear", false, false)).toBe("pear pear");
    expect(replaceInInput("Apple apple", "apple", "pear", true, false)).toBe("Apple pear");
    expect(replaceInInput("a.b", ".", "$&", false, false)).toBe("a$&b");
    expect(replaceInInput("apple", "APPLE", "x", false, true)).toBe("x");
    expect(replaceInInput("apples", "apple", "x", false, true)).toBeNull();
    expect(replaceInInput("=1/4", "0.25", "x", false, false)).toBeNull();
  });
});

describe("number format dialog model", () => {
  const choice = (p: Partial<FormatChoice>): FormatChoice => ({ ...DEFAULT_CHOICE, ...p });

  it("builds the format code of each category", () => {
    expect(buildCode(choice({ category: "general" }))).toBe("General");
    expect(buildCode(choice({ category: "number", decimals: 2 }))).toBe("0.00");
    expect(buildCode(choice({ category: "number", decimals: 0, thousands: true }))).toBe("#,##0");
    expect(buildCode(choice({ category: "currency", symbol: "€", decimals: 2 }))).toBe('#,##0.00 "€"');
    expect(buildCode(choice({ category: "currency", symbol: "$", decimals: 0 }))).toBe("$#,##0");
    expect(buildCode(choice({ category: "currency", symbol: "£", decimals: 1 }))).toBe('"£"#,##0.0');
    expect(buildCode(choice({ category: "percentage", decimals: 1 }))).toBe("0.0%");
    expect(buildCode(choice({ category: "date", date: "dd.mm.yyyy" }))).toBe("dd.mm.yyyy");
    expect(buildCode(choice({ category: "time", time: "h:mm:ss" }))).toBe("h:mm:ss");
    expect(buildCode(choice({ category: "text" }))).toBe("@");
    expect(buildCode(choice({ category: "custom", custom: "0.000E+00" }))).toBe("0.000E+00");
  });

  it("parses codes back into the dialog state (round trip)", () => {
    for (const p of [
      { category: "number", decimals: 3, thousands: true }, { category: "currency", symbol: "£", decimals: 0 },
      { category: "currency", symbol: "€", decimals: 2 }, { category: "percentage", decimals: 0 }, { category: "text" },
      { category: "date", date: "mmmm d, yyyy" }, { category: "time", time: "mm:ss" },
      { category: "time", time: "h:mm AM/PM" }, { category: "time", time: "[h]:mm:ss" },
    ] as Partial<FormatChoice>[]) {
      const code = buildCode(choice(p));
      expect(buildCode(parseCode(code))).toBe(code);
      expect(parseCode(code).category).toBe(p.category);
    }
    expect(parseCode(null).category).toBe("general");
    expect(parseCode('[Red]0.0;"neg"')).toMatchObject({ category: "custom", custom: '[Red]0.0;"neg"' });
  });

  it("previews the active cell's number, a sample for empty cells, the text for text cells", () => {
    expect(previewValue({ input: "12.5", display: "12.50", kind: "number" })).toBe(12.5);
    expect(previewValue({ input: "=A1", display: "7", kind: "number" })).toBe(7);
    expect(previewValue({ input: "=NOW()", display: "2024-01-01", kind: "number" })).toBe(SAMPLE_VALUE);
    expect(previewValue(undefined)).toBe(SAMPLE_VALUE);
    expect(previewValue({ input: "abc", display: "abc", kind: "text" })).toBeNull();
  });
});
