import { describe, expect, it } from "vitest";
import type { CellStyle } from "../generated/CellStyle";
import type { CellView } from "../generated/CellView";
import { colGeometry, DEFAULT_FORMAT, rowGeometry } from "./geometry";
import { computeRenderOps, type RenderOp, type SheetData } from "./render";
import type { Measure } from "./textLayout";

const m7: Measure = (t) => t.length * 7;

const styles: CellStyle[] = [
  {},
  { font: { bold: true, size: 1400, color: { kind: "rgb", value: "FF0000" } }, fill: { kind: "solid", color: { kind: "rgb", value: "FFFF00" } } },
  { alignment: { horizontal: "center", vertical: "top" }, borders: { bottom: { style: "thin", color: { kind: "rgb", value: "000000" } } } },
  { fill: { kind: "solid", color: { kind: "theme", value: { slot: "accent1", tint: 0 } } } },
];

function sheet(cells: CellView[], extra: Partial<SheetData> = {}): SheetData {
  const map = new Map<number, Map<number, CellView>>();
  for (const c of cells) {
    if (!map.has(c.row)) map.set(c.row, new Map());
    map.get(c.row)!.set(c.col, c);
  }
  const cols = extra.cols ?? new Map();
  const rows = extra.rows ?? new Map();
  return { cells: map, cols, rows, colGeo: colGeometry(DEFAULT_FORMAT, cols), rowGeo: rowGeometry(DEFAULT_FORMAT, rows) };
}

const v = (row: number, col: number, display: string, kind: CellView["kind"], style = 0): CellView => ({
  row, col, input: display, display, kind, style,
});

const texts = (ops: RenderOp[]) => ops.flatMap((o) => (o.op === "text" ? [o] : []));

describe("computeRenderOps", () => {
  const vp = { scrollX: 0, scrollY: 0, width: 200, height: 70 }; // cols A–D, rows 1–4

  it("emits texts for visible cells with default alignment by kind", () => {
    const ops = computeRenderOps(vp, sheet([
      v(0, 0, "text", "text"), v(0, 1, "42", "number"), v(1, 0, "TRUE", "bool"), v(1, 1, "#DIV/0!", "error"),
      v(10, 0, "offscreen", "text"), v(0, 9, "offscreen", "text"),
    ]), styles);
    expect(texts(ops).map((t) => [t.text, t.align, t.x, t.y])).toEqual([
      ["text", "left", 0, 0], ["42", "right", 64, 0], ["TRUE", "center", 0, 20], ["#DIV/0!", "center", 64, 20],
    ]);
    const grid = ops.find((o) => o.op === "gridlines");
    expect(grid && grid.op === "gridlines" && grid.xs).toEqual([64, 128, 192, 256]);
  });

  it("resolves fonts, colors, fills, alignment and borders from the style table", () => {
    const ops = computeRenderOps(vp, sheet([v(0, 0, "big", "text", 1), v(1, 1, "7", "number", 2)]), styles);
    const [big, seven] = texts(ops);
    expect(big.font).toMatch(/^bold 18\.67px "Calibri"/);
    expect(big.color).toBe("#FF0000");
    expect(seven.align).toBe("center");
    expect(seven.valign).toBe("top");
    expect(ops.filter((o) => o.op === "fill")).toEqual([{ op: "fill", x: 0, y: 0, w: 64, h: 20, color: "#FFFF00" }]);
    expect(ops.filter((o) => o.op === "line")).toMatchObject([{ x1: 64, y1: 40, x2: 128, y2: 40, color: "#000000", width: 1 }]);
    // Paint order: fills, gridlines, borders, texts.
    expect(ops.map((o) => o.op)).toEqual(["fill", "gridlines", "line", "text", "text"]);
  });

  it("fills empty cells from row/column styles and honours scrolling and sizes", () => {
    const data = sheet([], {
      cols: new Map([[2, { col: 2, width: null, hidden: false, style: 3 }], [1, { col: 1, width: 20, hidden: false, style: null }]]),
    });
    const ops = computeRenderOps({ ...vp, scrollX: 10, height: 15 }, data, styles);
    expect(ops.filter((o) => o.op === "fill")).toEqual([{ op: "fill", x: 64 + 145 - 10, y: 0, w: 64, h: 20, color: "#4472C4" }]);
  });

  it("long text overflows into empty right neighbours, masking their gridlines, up to a filled cell", () => {
    const long = "x".repeat(20); // 140 px: spans A..C
    const ops = computeRenderOps(vp, sheet([v(0, 0, long, "text"), v(1, 0, long, "text"), v(1, 1, "b", "text")]), styles, m7);
    const [a1, a2] = texts(ops);
    expect([a1.clipX, a1.clipW]).toEqual([0, 192]);
    expect([a2.clipX, a2.clipW]).toEqual([0, 64]); // B2 is not empty
    const masks = ops.filter((o, i) => o.op === "fill" && i > ops.findIndex((x) => x.op === "gridlines"));
    expect(masks.map((o) => o.op === "fill" && [o.x, o.y, o.w])).toEqual([[63, 0, 1], [127, 0, 1]]);
  });

  it("right-aligned text overflows to the left; text left of the view still shows", () => {
    const right: CellStyle = { alignment: { horizontal: "right" } };
    const ops = computeRenderOps(vp, sheet([v(0, 2, "y".repeat(20), "text", 4)]), [...styles, right], m7);
    expect(texts(ops).map((t) => [t.clipX, t.clipW, t.align])).toEqual([[0, 192, "right"]]);
    const scrolled = computeRenderOps({ ...vp, scrollX: 64 }, sheet([v(0, 0, "z".repeat(20), "text")]), styles, m7);
    expect(texts(scrolled).map((t) => [t.col, t.x, t.clipW])).toEqual([[0, -64, 192]]);
  });

  it("numbers never overflow: they shrink, go scientific (General) or show ####", () => {
    const fixed: CellStyle = { numberFormat: "0" };
    const ops = computeRenderOps(
      vp,
      sheet([v(0, 0, "1234567890", "number"), v(0, 1, "0.333333333", "number"), v(0, 2, "1234567890", "number", styles.length)]),
      [...styles, fixed],
      m7,
    );
    expect(texts(ops).map((t) => [t.text, t.clipW])).toEqual([["1.23E+09", 64], ["0.333333", 64], ["########", 64]]);
  });

  it("wrap text breaks into lines; without wrap a line break shows as a space", () => {
    const wrap: CellStyle = { alignment: { wrapText: true } };
    const ops = computeRenderOps(vp, sheet([v(0, 0, "alpha beta\ngamma", "text", 4), v(1, 0, "a\nb", "text")]), [...styles, wrap], m7);
    const [w, plain] = texts(ops);
    expect(w.lines).toEqual(["alpha", "beta", "gamma"]);
    expect(w.lineHeight).toBe(20);
    expect(plain.lines).toBeUndefined();
    expect(plain.text).toBe("a b");
  });
});

