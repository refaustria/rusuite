import { describe, expect, it } from "vitest";
import type { ChartData } from "../generated/ChartData";
import { addCategoryRow, addSeriesColumn, dataToGrid, gridToData, removeColumn, removeRow, resolveChart, sameData, transposeData } from "./data";
import type { Chart } from "./types";

const ref = (f: string) => ({ type: "ref" as const, formula: f });
const table: ChartData = {
  categories: ["North", "East", "South"],
  series: [
    { name: "2025", values: [1, null, 3] },
    { name: "2026", values: [4, 5, 6] },
  ],
};
const column: Chart = {
  kind: { type: "bar", direction: "column", grouping: "clustered" },
  series: [{ name: ref("Sheet1!$B$1"), values: ref("Sheet1!$B$2:$B$4") }, { name: ref("Sheet1!$C$1"), values: ref("Sheet1!$C$2:$C$4") }],
  axes: { cat: {}, val: {} },
};

describe("resolveChart (port of ChartData::resolve)", () => {
  it("one resolved series per chart series, by position, with the table's names and categories", () => {
    const r = resolveChart(column, table);
    expect(r.series.map((s) => s.name)).toEqual(["2025", "2026"]);
    expect(r.series[0]!.values).toEqual([1, null, 3]);
    expect(r.series[1]!.categories).toEqual(["North", "East", "South"]);
    expect(r.series[0]!.xValues).toBeUndefined();
    expect(r.title).toBeUndefined();
  });

  it("literal series names win; missing names are Series<n>; extra chart series are empty", () => {
    const c: Chart = { ...column, series: [{ ...column.series[0]!, name: { type: "literal", text: "Own" } }, column.series[1]!, { values: ref("X") }] };
    const r = resolveChart(c, { ...table, series: [table.series[0]!, { name: "", values: [1, 2, 3] }] });
    expect(r.series.map((s) => s.name)).toEqual(["Own", "Series2", "Series3"]);
    expect(r.series[2]!.values).toEqual([null, null, null]);
  });

  it("the automatic title is the only series' name; literal and cached titles show as they are", () => {
    const one: Chart = { ...column, series: [column.series[0]!], title: {} };
    expect(resolveChart(one, table).title).toBe("2025");
    expect(resolveChart({ ...column, title: {} }, table).title).toBeUndefined();
    expect(resolveChart({ ...column, title: { text: { type: "literal", text: "Sales" } } }, table).title).toBe("Sales");
    expect(resolveChart({ ...column, title: { text: { type: "ref", formula: "A1", cache: "Cached" } } }, table).title).toBe("Cached");
  });

  it("numeric categories become X values; scatter without them counts 1, 2, …", () => {
    const nums = resolveChart(column, { ...table, categories: ["0.5", "", "2"] });
    expect(nums.series[0]!.xValues).toEqual([0.5, null, 2]);
    const scatter = resolveChart({ ...column, kind: { type: "scatter", style: "marker" } }, table);
    expect(scatter.series[0]!.xValues).toEqual([1, 2, 3]);
  });

  it("unsupported charts resolve to nothing", () => {
    expect(resolveChart({ ...column, kind: { type: "unsupported", kind: "radarChart", xml: "<x/>" } }, table)).toEqual({ series: [] });
  });
});

describe("table edits", () => {
  it("Switch Row/Column swaps names and categories (twice = identity)", () => {
    const t = transposeData(table);
    expect(t.categories).toEqual(["2025", "2026"]);
    expect(t.series.map((s) => s.name)).toEqual(["North", "East", "South"]);
    expect(t.series[1]!.values).toEqual([null, 5]);
    expect(transposeData(t)).toEqual(table);
  });

  it("the grid round-trips the table", () => {
    const g = dataToGrid(table);
    expect(g[0]).toEqual(["", "2025", "2026"]);
    expect(g[2]).toEqual(["East", "", "5"]);
    expect(gridToData(g)).toEqual(table);
    expect(sameData(gridToData(g), table)).toBe(true);
  });

  it("empty rows and columns are dropped, text in value cells is blank, unnamed series get names", () => {
    const g = [["", "A", "", ""], ["x", "1", "", ""], ["", "", "", ""], ["y", "two", "", "7"]];
    const d = gridToData(g);
    expect(d.categories).toEqual(["x", "y"]);
    expect(d.series).toEqual([
      { name: "A", values: [1, null] },
      { name: "Series 2", values: [null, 7] },
    ]);
  });

  it("adds and removes series and categories like PowerPoint's sheet", () => {
    let g = dataToGrid(table);
    g = addSeriesColumn(g);
    expect(g[0]![3]).toBe("Series 3");
    g = addCategoryRow(g);
    expect(g[4]![0]).toBe("Category 4");
    g = removeColumn(g, 1);
    g = removeRow(g, 1);
    expect(g[0]).toEqual(["", "2026", "Series 3"]);
    expect(g[1]![0]).toBe("East");
    expect(removeColumn(g, 0)).toBe(g);
    expect(removeRow(g, 0)).toBe(g);
  });
});
