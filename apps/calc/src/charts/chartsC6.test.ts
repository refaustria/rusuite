// P9-C6: Calc's chart edits – series formulas, Add Chart Element (error
// bars, data table, lines, up/down bars), Format pane patches (areas,
// texts, error bars, point labels), Calc's chart styles and manual layouts.

import { describe, expect, it } from "vitest";
import { layoutChart } from "@rusuite/ui-shared";
import type { Chart } from "../generated/Chart";
import {
  applyChartStyle, applyDataTable, applyErrorBars, applyLineExtras, applySeriesFormula, errorBarChoice, gradientFill, mergeShape, parseSeriesFormula,
  patchSeriesLabels, seriesFormula, setChartArea, setErrorBars, setPointLabel, setPlotArea, setTextFormat, textFormatOf,
} from "./extras";
import { ChartController } from "./controller";

const ref = (formula: string) => ({ type: "ref" as const, formula });
const base = (): Chart => ({
  kind: { type: "bar", direction: "column", grouping: "clustered" },
  series: [
    { name: ref("Sheet1!$B$1"), values: ref("Sheet1!$B$2:$B$5") },
    { name: ref("Sheet1!$C$1"), values: ref("Sheet1!$C$2:$C$5") },
  ],
  categories: ref("Sheet1!$A$2:$A$5"),
  axes: { cat: {}, val: { majorGridlines: true } },
});

describe("series formulas", () => {
  it("shows Excel's =SERIES(name, categories, values, order)", () => {
    expect(seriesFormula(base(), 1)).toBe("=SERIES(Sheet1!$C$1,Sheet1!$A$2:$A$5,Sheet1!$C$2:$C$5,2)");
    const lit: Chart = { ...base(), series: [{ name: { type: "literal", text: 'My "s"' }, values: { type: "literal", values: [1, null, 3] } }], categories: undefined };
    expect(seriesFormula(lit, 0)).toBe('=SERIES("My ""s""",,{1,,3},1)');
  });

  it("parses references, quoted names and literals; rejects other formulas", () => {
    expect(parseSeriesFormula("=SERIES('My data'!$B$1,'My data'!$A$2:$A$4,'My data'!$B$2:$B$4,1)")).toEqual({
      name: ref("'My data'!$B$1"), categories: ref("'My data'!$A$2:$A$4"), values: ref("'My data'!$B$2:$B$4"), order: 1,
    });
    expect(parseSeriesFormula('=series("A, b",,{1,2,"x"},3)')).toEqual({ name: { type: "literal", text: "A, b" }, categories: undefined, values: { type: "literal", values: [1, 2, "x"] }, order: 3 });
    expect(parseSeriesFormula("=SUM(A1)")).toBeNull();
    expect(parseSeriesFormula("=SERIES(A1)")).toBeNull();
  });

  it("an edit replaces the series' data, keeps shared categories shared and moves it by order", () => {
    const next = applySeriesFormula(base(), 0, "=SERIES(Sheet1!$D$1,Sheet1!$A$2:$A$5,Sheet1!$D$2:$D$5,2)")!;
    expect(next.series.map((s) => s.values)).toEqual([ref("Sheet1!$C$2:$C$5"), ref("Sheet1!$D$2:$D$5")]);
    expect(next.series[1]!.categories).toBeUndefined();
    expect(next.categories).toEqual(ref("Sheet1!$A$2:$A$5"));
    const own = applySeriesFormula(base(), 1, "=SERIES(,Sheet1!$E$2:$E$5,Sheet1!$C$2:$C$5,2)")!;
    expect(own.series[1]).toEqual({ values: ref("Sheet1!$C$2:$C$5"), categories: ref("Sheet1!$E$2:$E$5") });
    expect(applySeriesFormula(base(), 0, "nonsense")).toBeNull();
  });
});

describe("Add Chart Element (P9-C6)", () => {
  it("error bars on every series or the selected one; scatter gets X and Y", () => {
    const all = applyErrorBars(base(), "percentage");
    expect(all.series.every((s) => JSON.stringify(s.errorBars) === JSON.stringify([{ amount: { type: "percentage", value: 5 } }]))).toBe(true);
    expect(errorBarChoice(all)).toBe("percentage");
    const one = applyErrorBars(base(), "stdDev", 1);
    expect(one.series[0]!.errorBars).toBeUndefined();
    expect(errorBarChoice(applyErrorBars(one, "none"))).toBe("none");
    const sc = applyErrorBars({ ...base(), kind: { type: "scatter", style: "marker" } }, "stdErr");
    expect(sc.series[0]!.errorBars!.map((e) => e.direction ?? "y")).toEqual(["x", "y"]);
  });

  it("data table with / without keys; high-low lines and up/down bars", () => {
    expect(applyDataTable(base(), "keys").dataTable).toEqual({ keys: true });
    expect(applyDataTable(applyDataTable(base(), "keys"), "noKeys").dataTable).toEqual({});
    expect(applyDataTable(base(), "none").dataTable).toBeUndefined();
    const l = applyLineExtras({ ...base(), kind: { type: "line", grouping: "standard", markers: false } }, { highLow: true, upDown: true });
    expect([l.highLowLines, l.upDownBars]).toEqual([{}, { gapWidth: 150 }]);
    const off = applyLineExtras(l, { highLow: false, upDown: false });
    expect("highLowLines" in off || "upDownBars" in off).toBe(false);
  });
});

describe("Format pane patches (P9-C6)", () => {
  const blue = { kind: "rgb" as const, value: "4472C4" };
  it("chart and plot area fills, borders and shadows; empty formats disappear", () => {
    const g = setChartArea(base(), { fill: gradientFill(blue, { kind: "rgb", value: "FFFFFF" }, 450), shadow: true });
    expect(g.chartArea).toEqual({ fill: { type: "gradient", stops: [{ pos: 0, color: blue }, { pos: 1, color: { kind: "rgb", value: "FFFFFF" } }], angle: 90 }, shadow: true });
    const cleared = setChartArea(setChartArea(g, { fill: undefined }), { shadow: false });
    expect(cleared.chartArea).toBeUndefined();
    expect(setPlotArea(base(), { line: { none: true } }).plotArea).toEqual({ line: { none: true } });
    expect(mergeShape(undefined, {})).toBeUndefined();
  });

  it("text formats land on their element", () => {
    let c = setTextFormat(base(), { el: "title" }, { size: 18, bold: true });
    c = setTextFormat(c, { el: "axis", axis: "cat" }, { rotation: -45 });
    c = setTextFormat(c, { el: "legend" }, { italic: true });
    c = setTextFormat(c, { el: "labels", series: 1 }, { color: blue });
    c = setTextFormat(c, { el: "chart" }, { font: "Arial" });
    expect(c.title?.textFormat).toEqual({ size: 18, bold: true });
    expect(c.axes.cat.textFormat).toEqual({ rotation: -45 });
    expect(c.legendTextFormat).toEqual({ italic: true });
    expect(c.series[1]!.dataLabels?.textFormat).toEqual({ color: blue });
    expect(textFormatOf(c, { el: "chart" })).toEqual({ font: "Arial" });
    expect(setTextFormat(c, { el: "legend" }, { italic: undefined }).legendTextFormat).toBeUndefined();
  });

  it("error bars per direction, label extras and a point's own label", () => {
    let c = setErrorBars(base(), 0, "y", { amount: { type: "fixed", value: 2 } });
    c = setErrorBars(c, 0, "y", { amount: { type: "custom", plus: ref("Sheet1!$D$2:$D$5") } });
    expect(c.series[0]!.errorBars).toEqual([{ amount: { type: "custom", plus: ref("Sheet1!$D$2:$D$5") } }]);
    expect(setErrorBars(c, 0, "y", null).series[0]!.errorBars).toBeUndefined();
    c = patchSeriesLabels(base(), 0, { showValue: true, range: ref("Sheet1!$D$2:$D$5"), showRange: true, leaderLines: true });
    c = setPointLabel(c, 0, 2, { delete: true });
    c = setPointLabel(c, 0, 1, { showCategory: true });
    expect(c.series[0]!.dataLabels!.points).toEqual([{ idx: 1, showCategory: true }, { idx: 2, delete: true }]);
    expect(setPointLabel(setPointLabel(c, 0, 1, null), 0, 2, null).series[0]!.dataLabels!.points).toBeUndefined();
  });

  it("Calc's chart styles add Excel's area looks and drop them again", () => {
    const dark = applyChartStyle(base(), 8);
    expect(dark.chartArea?.fill).toEqual({ type: "solid", color: { kind: "theme", value: { slot: "dark1", tint: 0 } } });
    expect(dark.roundedCorners && dark.textFormat?.color).toEqual({ kind: "rgb", value: "FFFFFF" });
    const plain = applyChartStyle(dark, 1);
    expect([plain.chartArea, plain.plotArea, plain.roundedCorners, plain.textFormat]).toEqual([undefined, undefined, undefined, undefined]);
    expect(applyChartStyle(base(), 4).chartArea).toEqual({ shadow: true });
    expect(applyChartStyle(base(), 3).plotArea?.fill?.type).toBe("solid");
  });
});

describe("manual layouts", () => {
  it("dragging the title, legend or plot area stores fractions of the chart", () => {
    const chart: Chart = { ...base(), title: { text: { type: "literal", text: "T" } }, legend: { position: "right" } };
    const data = { series: [{ name: "a", categories: ["1", "2", "3", "4"], values: [1, 2, 3, 4] }, { name: "b", categories: ["1", "2", "3", "4"], values: [4, 3, 2, 1] }] };
    const scene = layoutChart(chart, data, 400, 200);
    const ctl = new ChartController({ notify: () => {} } as never);
    const moved = ctl.movedLayout(chart, scene, { type: "title" }, 40, 20)!;
    const hit = scene.hits.find((h) => h.el.type === "title")!.shape as { x: number; y: number };
    expect(moved.title?.layout).toEqual({ x: Math.round(((hit.x + 40) / 400) * 10_000) / 10_000, y: Math.round(((hit.y + 20) / 200) * 10_000) / 10_000 });
    const plot = ctl.movedLayout(chart, scene, { type: "plotArea" }, -10, 0)!;
    expect(plot.plotLayout!.w).toBeCloseTo(scene.plot.w / 400, 3);
    expect(plot.plotLayout!.x).toBeCloseTo((scene.plot.x - 10) / 400, 3);
    const legend = ctl.movedLayout(chart, scene, { type: "legend" }, 0, 10)!;
    expect(legend.legendLayout!.h).toBeGreaterThan(0);
    // The renderer puts the moved title where it was dropped.
    const again = layoutChart(moved, data, 400, 200);
    const h2 = again.hits.find((h) => h.el.type === "title")!.shape as { x: number; y: number };
    expect(h2.x).toBeCloseTo(hit.x + 40, 0);
    expect(ctl.movedLayout(chart, scene, { type: "chartArea" }, 1, 1)).toBeNull();
  });
});
