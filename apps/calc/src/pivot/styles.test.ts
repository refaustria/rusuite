import { describe, expect, it } from "vitest";
import { applyTint, OFFICE_THEME } from "@rusuite/ui-shared";
import type { CellView } from "../generated/CellView";
import type { PivotCellView } from "../generated/PivotCellView";
import type { PivotSummary } from "../generated/PivotSummary";
import { colGeometry, DEFAULT_FORMAT, rowGeometry } from "../grid/geometry";
import { computeRenderOps, withLook, type TextOp } from "../grid/render";
import { buttonAt, dropTarget, pivotButtons, type ButtonOptions } from "./buttons";
import { BUTTON_ROOM, isEmptyTable, PIVOT_STYLES, pivotLooks, pivotStyle, PLACEHOLDER_LINE, styleNumber } from "./styles";

type Spec = [number, number, string, PivotCellView["kind"], Partial<PivotCellView>?];

function cellsOf(specs: Spec[], style = 0): Map<number, Map<number, CellView>> {
  const m = new Map<number, Map<number, CellView>>();
  for (const [row, col, display, kind, extra] of specs) {
    let r = m.get(row);
    if (!r) m.set(row, (r = new Map()));
    r.set(col, { row, col, input: display, display, kind: /^\d+$/.test(display) ? "number" : display ? "text" : "empty", style, pivot: { id: 1, kind, level: 0, ...extra } });
  }
  return m;
}

const S = (p: Partial<PivotSummary> = {}): PivotSummary => ({
  id: 1, name: "PivotTable1", location: { r0: 2, c0: 0, r1: 7, c1: 1 }, table: { r0: 2, c0: 0, r1: 7, c1: 1 }, style: "PivotStyleLight16", banded: false, rowHeaders: true, colHeaders: true, ...p,
});

// A3 Row Labels | Sum of Sales; North (+Apple, Pear) 35; South 30; Grand Total 65.
const SPEC: Spec[] = [
  [2, 0, "Row Labels", "header"], [2, 1, "Sum of Sales", "header"],
  [3, 0, "North", "rowLabel", { field: 0, item: 0, collapsed: false }], [3, 1, "35", "subtotal"],
  [4, 0, "Apple", "rowLabel", { field: 1, item: 0, level: 1 }], [4, 1, "15", "value", { level: 1 }],
  [5, 0, "Pear", "rowLabel", { field: 1, item: 1, level: 1 }], [5, 1, "20", "value", { level: 1 }],
  [6, 0, "South", "rowLabel", { field: 0, item: 1, collapsed: true }], [6, 1, "30", "subtotal"],
  [7, 0, "Grand Total", "grandTotal"], [7, 1, "65", "grandTotal"],
];

function looks(spec = SPEC, s = S(), buttons = true) {
  const cells = cellsOf(spec);
  const at = (r: number, c: number) => cells.get(r)?.get(c);
  const fn = pivotLooks([s], at, buttons);
  return { cells, at, look: (r: number, c: number) => fn(at(r, c), r, c), fn };
}

describe("pivot styles", () => {
  it("lists Excel's 84 built-in styles; Light16 is the light accent 1 band", () => {
    expect(PIVOT_STYLES).toHaveLength(84);
    expect(PIVOT_STYLES[15]).toBe("PivotStyleLight16");
    expect(styleNumber("PivotStyleDark3")).toEqual({ family: "dark", n: 3 });
    const d = pivotStyle("PivotStyleLight16");
    expect(d.headerFill).toBe(`#${applyTint(OFFICE_THEME.accent1, 0.8)}`);
    expect(d.line).toBe(`#${applyTint(OFFICE_THEME.accent1, 0.4)}`);
    expect(pivotStyle("nonsense").id).toBe("PivotStyleLight16");
  });

  it("dark styles have dark bodies with white text; Light 8–14 a solid header", () => {
    expect(pivotStyle("PivotStyleDark2").bodyColor).toBe("#FFFFFF");
    expect(pivotStyle("PivotStyleLight9")).toMatchObject({ headerFill: `#${OFFICE_THEME.accent1.toUpperCase()}`, headerColor: "#FFFFFF" });
  });
});

describe("pivot looks per cell role", () => {
  it("the header band: fill, bold, a line under the last header row", () => {
    const { look } = looks();
    expect(look(2, 0)).toMatchObject({ fill: pivotStyle("PivotStyleLight16").headerFill, bold: true, bottom: pivotStyle("PivotStyleLight16").line });
    expect(look(2, 1)?.bold).toBe(true);
  });

  it("subtotal lines are bold, inner items are not; labels with inner items get room for the button", () => {
    const { look } = looks();
    expect(look(3, 0)).toMatchObject({ bold: true, shift: BUTTON_ROOM });
    expect(look(3, 1)?.bold).toBe(true);
    expect(look(4, 0)?.bold).toBeFalsy();
    expect(look(4, 1)?.bold).toBeFalsy();
    expect(looks(SPEC, S(), false).look(3, 0)?.shift).toBeUndefined();
  });

  it("the grand total row: bold with a line over it and under the table", () => {
    const { look } = looks();
    const line = pivotStyle("PivotStyleLight16").line;
    expect(look(7, 1)).toMatchObject({ bold: true, top: line, bottom: line });
  });

  it("banded rows alternate the band fill under the header", () => {
    const { look } = looks(SPEC, S({ banded: true }));
    const band = pivotStyle("PivotStyleLight16").band;
    expect(look(3, 1)?.fill).toBeUndefined();
    expect(look(4, 1)?.fill).toBe(band);
    expect(look(5, 1)?.fill).toBeUndefined();
  });

  it("page field cells above the table get no look; non-pivot cells neither", () => {
    const spec: Spec[] = [[0, 0, "Region", "header", { field: 0 }], [0, 1, "(All)", "page", { field: 0 }], ...SPEC];
    const { fn, at } = looks(spec, S({ location: { r0: 0, c0: 0, r1: 7, c1: 1 } }));
    expect(fn(at(0, 1), 0, 1)).toBeUndefined();
    expect(fn(undefined, 10, 10)).toBeUndefined();
  });

  it("an empty table (no fields yet) is Excel's placeholder box", () => {
    const blank: Spec[] = [];
    for (let r = 2; r <= 19; r++) for (let c = 0; c <= 2; c++) blank.push([r, c, "", "blank"]);
    const s = S({ table: { r0: 2, c0: 0, r1: 19, c1: 2 }, location: { r0: 2, c0: 0, r1: 19, c1: 2 } });
    const { look, at } = looks(blank, s);
    expect(isEmptyTable(at, s)).toBe(true);
    expect(look(2, 0)).toEqual({ top: PLACEHOLDER_LINE, left: PLACEHOLDER_LINE });
    expect(look(19, 2)).toEqual({ bottom: PLACEHOLDER_LINE, right: PLACEHOLDER_LINE });
    expect(look(10, 1)).toEqual({});
  });
});

describe("render ops of pivot cells", () => {
  it("draws the header fill, bold header text, lines and the label shifted after its button", () => {
    const cells = cellsOf(SPEC);
    const at = (r: number, c: number) => cells.get(r)?.get(c);
    const ops = computeRenderOps(
      { scrollX: 0, scrollY: 0, width: 400, height: 300 },
      { cells, cols: new Map(), rows: new Map(), colGeo: colGeometry(DEFAULT_FORMAT, new Map()), rowGeo: rowGeometry(DEFAULT_FORMAT, new Map()), pivotLook: pivotLooks([S()], at) },
      [{}],
    );
    const header = pivotStyle("PivotStyleLight16").headerFill!;
    expect(ops.filter((o) => o.op === "fill" && o.color.toUpperCase() === header.toUpperCase())).toHaveLength(2);
    const texts = ops.filter((o): o is TextOp => o.op === "text");
    expect(texts.find((o) => o.text === "Row Labels")!.font).toContain("bold");
    expect(texts.find((o) => o.text === "Apple")!.font).not.toContain("bold");
    expect(texts.find((o) => o.text === "North")!.x).toBe(BUTTON_ROOM);
    expect(ops.some((o) => o.op === "line" && o.color === pivotStyle("PivotStyleLight16").line)).toBe(true);
  });

  it("a cell's own fill wins over the style", () => {
    const own = withLook({ fill: { kind: "solid", color: { kind: "rgb", value: "FF0000" } } }, { fill: "#DDEBF7", bold: true });
    expect(own.fill).toEqual({ kind: "solid", color: { kind: "rgb", value: "FF0000" } });
    expect(own.font?.bold).toBe(true);
    expect(withLook({}, undefined)).toEqual({});
  });
});

describe("pivot buttons", () => {
  const geo = { col: colGeometry(DEFAULT_FORMAT, new Map()), row: rowGeometry(DEFAULT_FORMAT, new Map()) };
  const opts = (o: Partial<ButtonOptions> = {}): ButtonOptions => ({ expand: true, headers: true, indentOf: () => 0, filtered: () => false, inTable: () => true, ...o });
  const flat = (m: Map<number, Map<number, CellView>>) => [...m.values()].flatMap((r) => [...r.values()]);

  it("−/+ buttons sit before labels with inner items, after the indent", () => {
    const list = pivotButtons(flat(cellsOf(SPEC)), geo.col, geo.row, opts({ indentOf: (c) => (c.row === 6 ? 2 : 0) }));
    const expand = list.filter((b) => b.kind === "expand");
    expect(expand.map((b) => [b.row, b.kind === "expand" && b.collapsed])).toEqual([[3, false], [6, true]]);
    expect(expand[0]!.x).toBe(2);
    expect(expand[1]!.x).toBe(2 + 18);
    expect(pivotButtons(flat(cellsOf(SPEC)), geo.col, geo.row, opts({ expand: false })).some((b) => b.kind === "expand")).toBe(false);
  });

  it("dropdowns: Row / Column Labels headers, field headers in the table and page cells", () => {
    const [cells] = [cellsOf([[0, 0, "Region", "header", { field: 0 }], [0, 1, "(All)", "page", { field: 0 }], [2, 0, "Row Labels", "header"], [2, 1, "Sum of Sales", "header"], [2, 2, "Product", "header", { field: 1 }]])];
    const c = (r: number, k: number) => cells.get(r)!.get(k)!;
    expect(dropTarget(c(2, 0))).toEqual({ kind: "axis", axis: "rows" });
    expect(dropTarget(c(2, 1))).toBeNull();
    expect(dropTarget(c(2, 2))).toEqual({ kind: "field", field: 1 });
    expect(dropTarget(c(0, 1))).toEqual({ kind: "page", field: 0 });
    // The page field's name (above the table) has none; Field Headers off removes the header ones.
    const list = pivotButtons(flat(cells), geo.col, geo.row, opts({ inTable: (_id, row) => row >= 2 }));
    expect(list.filter((b) => b.kind === "drop").map((b) => [b.row, b.col])).toEqual([[0, 1], [2, 0], [2, 2]]);
    expect(pivotButtons(flat(cells), geo.col, geo.row, opts({ headers: false })).map((b) => [b.row, b.col])).toEqual([[0, 1]]);
  });

  it("hit-tests a button with a small slop", () => {
    const list = pivotButtons(flat(cellsOf(SPEC)), geo.col, geo.row, opts());
    const b = list.find((x) => x.kind === "expand")!;
    expect(buttonAt(list, b.x + 1, b.y + 1)).toBe(b);
    expect(buttonAt(list, b.x - 2, b.y)).toBe(b);
    expect(buttonAt(list, b.x + 30, b.y)).toBeNull();
  });
});
