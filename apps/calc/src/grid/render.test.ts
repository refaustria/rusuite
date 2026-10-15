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
  return { cells: map, cols, rows, colGeo: colGeometry(DEFAULT_FORMAT, cols), rowGeo: rowGeometry(DEFAULT_FORMAT, rows), merges: extra.merges };
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


describe("computeRenderOps: merged cells (P8-3)", () => {
  const vp = { scrollX: 0, scrollY: 0, width: 300, height: 100 };
  const A1C2 = { r0: 0, c0: 0, r1: 1, c1: 2 };

  it("paints a merge as one cell: text over the whole range, inner gridlines masked", () => {
    const ops = computeRenderOps(vp, sheet([v(0, 0, "Title", "text", 2)], { merges: [A1C2] }), styles, m7);
    const [t] = texts(ops);
    expect(t).toMatchObject({ row: 0, col: 0, text: "Title", x: 0, y: 0, w: 192, h: 40, clipX: 0, clipW: 192, align: "center" });
    const gi = ops.findIndex((o) => o.op === "gridlines");
    const mask = ops.slice(gi + 1).find((o) => o.op === "fill");
    expect(mask).toEqual({ op: "fill", x: 0, y: 0, w: 191, h: 39, color: "#ffffff" });
  });

  it("covered cells draw nothing of their own and merged text never overflows", () => {
    const long = "a long heading that does not fit";
    const ops = computeRenderOps(vp, sheet([v(0, 0, long, "text"), v(0, 1, "stale", "text"), v(1, 2, "x", "number", 1)], { merges: [A1C2] }), styles, m7);
    expect(texts(ops).map((t) => [t.text, t.clipW])).toEqual([[long, 192]]);
    // The covered cell's own fill (style 1 at C2) is not painted either.
    expect(ops.filter((o) => o.op === "fill" && o.color === "#FFFF00")).toHaveLength(0);
  });

  it("uses the top-left cell's fill and outer borders only", () => {
    const boxed: CellStyle = { borders: { top: { style: "thin", color: { kind: "rgb", value: "000000" } }, bottom: { style: "thin", color: { kind: "rgb", value: "000000" } }, left: { style: "thin", color: { kind: "rgb", value: "000000" } }, right: { style: "thin", color: { kind: "rgb", value: "000000" } } } };
    const all = [...styles, boxed];
    const id = all.length - 1;
    const cells = [v(0, 0, "", "empty", 1)];
    for (let r = 0; r <= 1; r++) for (let c = 0; c <= 2; c++) if (r || c) cells.push(v(r, c, "", "empty", id));
    cells[0] = { ...cells[0]!, style: 1 };
    const ops = computeRenderOps(vp, sheet(cells, { merges: [A1C2] }), all, m7);
    expect(ops.find((o) => o.op === "fill" && o.color === "#FFFF00")).toMatchObject({ x: 0, y: 0, w: 191, h: 39 });
    const lines = ops.flatMap((o) => (o.op === "line" ? [[o.x1, o.y1, o.x2, o.y2]] : []));
    // Bottom edge of B2, C2; right edge of C1, C2 – no inner lines, none for A1 (style 1 has no borders).
    expect(lines).toEqual(expect.arrayContaining([[64, 40, 128, 40], [128, 40, 192, 40], [192, 0, 192, 20], [192, 20, 192, 40]]));
    expect(lines.some(([x1, y1, x2, y2]) => (x1 === 64 && x2 === 64) || (y1 === 20 && y2 === 20 && x1 < 192))).toBe(false);
  });

  it("a merge scrolled partly out of view keeps its top-left text, and neighbours do not overflow into it", () => {
    const merged = { r0: 0, c0: 1, r1: 0, c1: 3 };
    const ops = computeRenderOps({ ...vp, scrollX: 100 }, sheet([v(0, 1, "kept", "text"), v(0, 0, "overflowing text", "text")], { merges: [merged] }), styles, m7);
    const ts = texts(ops);
    expect(ts.find((t) => t.col === 1)).toMatchObject({ x: -36, w: 192 });
    expect(ts.find((t) => t.col === 0)?.clipW ?? 64).toBe(64);
  });
});
