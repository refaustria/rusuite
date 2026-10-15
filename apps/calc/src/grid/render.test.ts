import { describe, expect, it } from "vitest";
import type { CellStyle } from "../generated/CellStyle";
import type { CellView } from "../generated/CellView";
import { colGeometry, DEFAULT_FORMAT, rowGeometry } from "./geometry";
import { computeRenderOps, type RenderOp, type SheetData } from "./render";

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
});
