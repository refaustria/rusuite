import { describe, expect, it } from "vitest";
import type { Chart } from "../generated/Chart";
import type { ChartAnchor } from "../generated/ChartAnchor";
import { AxisGeometry } from "../grid/geometry";
import { anchorRect, handleAt, insertRect, moveRect, nearestEdge, rectToAnchor, resizeRect } from "./anchor";
import { comboChart, recommendations, selectDataCommand, selectDataOps } from "./ChartDialogs";
import { chartElements, elementName } from "./elements";
import { parseNumberField, resetSeriesFormat, setAxis, setLabels, setSecondary, setSeriesFill } from "./format";
import { chartRefMarks } from "./paint";
import {
  applyChartStyle, applyColors, applyElement, applyPreset, applyQuickLayout, canon, colorsOf, elementState, labelPositions, presetById, presetOf, QUICK_LAYOUTS,
} from "./presets";
import { chartDataRange, dataRefText, nameText, parseDataRef, parseName, parseRange, rangeFormula, switchRowCol } from "./refs";
import "../i18n";

// 64 × 20 px cells; column B is 100 px wide, row 3 is hidden.
const col = new AxisGeometry(64, new Map([[1, 100]]), 16_384);
const row = new AxisGeometry(20, new Map([[2, 0]]));
const ref = (formula: string) => ({ type: "ref" as const, formula });

const base: Chart = {
  kind: { type: "bar", direction: "column", grouping: "clustered" },
  series: [
    { name: ref("Sheet1!$B$1"), values: ref("Sheet1!$B$2:$B$5") },
    { name: ref("Sheet1!$C$1"), values: ref("Sheet1!$C$2:$C$5") },
  ],
  categories: ref("Sheet1!$A$2:$A$5"),
  axes: { cat: {}, val: { majorGridlines: true } },
  title: { text: { type: "literal", text: "Chart Title" } },
  legend: { position: "bottom" },
  gapWidth: 219,
  overlap: -27,
};

describe("anchors", () => {
  it("twoCell, oneCell and absolute anchors map to sheet px (hidden rows are zero)", () => {
    const two: ChartAnchor = { type: "twoCell", from: { col: 1, row: 1, colOffset: 9525 * 10, rowOffset: 0 }, to: { col: 4, row: 5, colOffset: 0, rowOffset: 9525 * 5 } };
    expect(anchorRect(two, col, row)).toEqual({ x: 74, y: 20, w: 292 - 74, h: 3 * 20 + 5 });
    expect(anchorRect({ type: "oneCell", from: { col: 0, row: 0, colOffset: 0, rowOffset: 0 }, width: 9525 * 480, height: 9525 * 288 }, col, row)).toEqual({ x: 0, y: 0, w: 480, h: 288 });
    expect(anchorRect({ type: "absolute", x: 9525, y: 9525 * 2, width: 9525 * 3, height: 9525 * 4 }, col, row)).toEqual({ x: 1, y: 2, w: 3, h: 4 });
  });
  it("a rectangle maps back to an anchor of the same kind", () => {
    const r = { x: 74, y: 20, w: 290, h: 65 };
    const a = rectToAnchor(r, "twoCell", col, row);
    expect(a).toEqual({ type: "twoCell", from: { col: 1, row: 1, colOffset: 95250, rowOffset: 0 }, to: { col: 5, row: 5, colOffset: 9525 * 8, rowOffset: 9525 * 5 } });
    expect(anchorRect(a, col, row)).toEqual(r);
    expect(rectToAnchor(r, "oneCell", col, row)).toMatchObject({ type: "oneCell", width: 290 * 9525, height: 65 * 9525 });
    expect(rectToAnchor(r, "absolute", col, row)).toEqual({ type: "absolute", x: 74 * 9525, y: 20 * 9525, width: 290 * 9525, height: 65 * 9525 });
  });
  it("move and resize math; Alt snaps to cell edges; minimum size; not past A1", () => {
    const r = { x: 100, y: 100, w: 200, h: 100 };
    expect(moveRect(r, -500, 10)).toEqual({ x: 0, y: 110, w: 200, h: 100 });
    expect(moveRect(r, 5, 3, { col, row })).toEqual({ x: 64, y: 100, w: 200, h: 100 });
    expect(moveRect(r, 20, 12, { col, row })).toEqual({ x: 164 - 64 + 64, y: 120, w: 200, h: 100 });
    expect(resizeRect(r, "se", 30, 20)).toEqual({ x: 100, y: 100, w: 230, h: 120 });
    expect(resizeRect(r, "nw", 30, 20)).toEqual({ x: 130, y: 120, w: 170, h: 80 });
    expect(resizeRect(r, "e", -500, 0).w).toBe(24);
    expect(resizeRect(r, "n", 0, 500)).toEqual({ x: 100, y: 176, w: 200, h: 24 });
    expect(resizeRect(r, "e", 10, 0, { col, row }).x + resizeRect(r, "e", 10, 0, { col, row }).w).toBe(292);
    expect(nearestEdge(170, col)).toBe(164);
    expect(nearestEdge(220, col)).toBe(228);
  });
  it("handles are hit near corners and edge midpoints; a new chart goes right of the selection", () => {
    const r = { x: 100, y: 100, w: 300, h: 200 };
    expect(handleAt(r, 101, 99)).toBe("nw");
    expect(handleAt(r, 250, 300)).toBe("s");
    expect(handleAt(r, 405, 200)).toBe("e");
    expect(handleAt(r, 250, 200)).toBeNull();
    expect(insertRect({ r0: 0, c0: 0, r1: 4, c1: 2 }, col, row)).toEqual({ x: 64 + 100 + 64 + 64, y: 0, w: 480, h: 288 });
  });
});

describe("references", () => {
  it("parses and writes sheet ranges", () => {
    expect(parseRange("Sheet1!$B$2:$B$5")).toEqual({ sheet: "Sheet1", r0: 1, c0: 1, r1: 4, c1: 1 });
    expect(parseRange("='My ''Data'''!c3")).toEqual({ sheet: "My 'Data'", r0: 2, c0: 2, r1: 2, c1: 2 });
    expect(parseRange("A1:B")).toBeNull();
    expect(rangeFormula({ sheet: "My Data", r0: 0, c0: 0, r1: 3, c1: 1 })).toBe("'My Data'!$A$1:$B$4");
    expect(rangeFormula({ sheet: null, r0: 2, c0: 2, r1: 2, c1: 2 })).toBe("$C$3");
  });
  it("dialog texts of data refs and names round-trip", () => {
    expect(dataRefText(ref("Sheet1!$B$2:$B$5"))).toBe("=Sheet1!$B$2:$B$5");
    expect(dataRefText({ type: "literal", values: [1, "a", null] })).toBe('={1,"a",}');
    expect(parseDataRef("={1,2,3}")).toEqual({ type: "literal", values: [1, 2, 3] });
    expect(parseDataRef("4, 5")).toEqual({ type: "literal", values: [4, 5] });
    expect(parseDataRef("=Sheet1!A1:A3")).toEqual(ref("Sheet1!A1:A3"));
    expect(parseDataRef("  ")).toBeNull();
    expect(nameText({ type: "literal", text: "Sales" })).toBe("Sales");
    expect(parseName("=Sheet1!$B$1")).toEqual(ref("Sheet1!$B$1"));
    expect(parseName("Sales")).toEqual({ type: "literal", text: "Sales" });
    expect(chartDataRange(base)).toEqual({ sheet: "Sheet1", r0: 0, c0: 0, r1: 4, c1: 2 });
  });
  it("Switch Row/Column turns column series into row series and back", () => {
    const sw = switchRowCol(base)!;
    expect(sw.series).toHaveLength(4);
    expect(sw.series[0]).toEqual({ name: ref("Sheet1!$A$2"), values: ref("Sheet1!$B$2:$C$2") });
    expect(sw.series[3]!.values).toEqual(ref("Sheet1!$B$5:$C$5"));
    expect(sw.categories).toEqual(ref("Sheet1!$B$1:$C$1"));
    const back = switchRowCol({ series: sw.series, categories: sw.categories ?? undefined })!;
    expect(back.series).toEqual(base.series);
    expect(back.categories).toEqual(base.categories);
  });
  it("Switch Row/Column refuses scattered or literal data", () => {
    expect(switchRowCol({ series: [{ values: { type: "literal", values: [1] } }] })).toBeNull();
    expect(switchRowCol({ series: [{ values: ref("Sheet1!$B$2:$B$5") }, { values: ref("Sheet1!$D$2:$D$5") }] })).toBeNull();
    expect(switchRowCol({ series: [{ values: ref("Sheet1!$B$2:$B$5") }, { values: ref("Sheet2!$C$2:$C$5") }] })).toBeNull();
  });
  it("source range outlines of a selected chart: names red, categories purple, values blue", () => {
    const marks = chartRefMarks(base, "sheet1");
    expect(marks.map((m) => m.color)).toEqual(["#8a3fbf", "#d8352a", "#2a62d6", "#d8352a", "#2a62d6"]);
    expect(chartRefMarks(base, "Other")).toEqual([]);
  });
});

describe("chart types", () => {
  it("presets set Excel's defaults per kind", () => {
    const pie = applyPreset(base, presetById("pie")!);
    expect(pie).toMatchObject({ kind: { type: "pie" }, varyColors: true });
    expect(pie.gapWidth).toBeUndefined();
    expect(applyPreset(base, presetById("doughnut")!).holeSize).toBe(75);
    expect(applyPreset(base, presetById("colStacked")!)).toMatchObject({ gapWidth: 150, overlap: 100 });
    expect(applyPreset(pie, presetById("barClustered")!)).toMatchObject({ kind: { type: "bar", direction: "bar", grouping: "clustered" }, gapWidth: 219, overlap: -27 });
  });
  it("scatter without categories takes the first series as X values", () => {
    const noCats: Chart = { ...base, categories: undefined };
    delete noCats.categories;
    const sc = applyPreset(noCats, presetById("scatterLineMarkers")!);
    expect(sc.categories).toEqual(ref("Sheet1!$B$2:$B$5"));
    expect(sc.series).toHaveLength(1);
    expect(applyPreset(base, presetById("scatter")!).series).toHaveLength(2);
  });
  it("combo presets and the combo editor give series kinds and the secondary axis", () => {
    const combo = applyPreset(base, presetById("comboColLineSecondary")!);
    expect(combo.series.map((s) => s.kind?.type)).toEqual(["bar", "line"]);
    expect(combo.series[1]!.axis).toBe("secondary");
    expect(combo.axes.secondVal).toEqual({ crosses: { type: "max" } });
    expect(presetOf(combo)?.id).toBe("comboColLineSecondary");
    const plain = applyPreset(combo, presetById("line")!);
    expect(plain.axes.secondVal).toBeUndefined();
    expect(plain.series.every((s) => !s.kind && !s.axis)).toBe(true);
    const edited = comboChart(base, ["colStacked", "areaStacked"], [false, true]);
    expect(edited.series.map((s) => canon(s.kind))).toEqual([canon({ type: "bar", direction: "column", grouping: "stacked" }), canon({ type: "area", grouping: "stacked" })]);
    expect(edited.axes.secondVal).toBeDefined();
  });
  it("presetOf finds the sub-type of a chart; recommendations offer 3–5 types", () => {
    expect(presetOf(base)?.id).toBe("colClustered");
    expect(presetOf({ ...base, kind: { grouping: "standard", markers: true, type: "line" } })?.id).toBe("lineMarkers");
    expect(recommendations(base).map((p) => p.id)).toEqual(["colClustered", "lineMarkers", "barClustered", "colStacked", "comboColLine"]);
    expect(recommendations({ ...base, series: [base.series[0]!] }).map((p) => p.id)).toContain("pie");
  });
});

describe("Chart Design edits", () => {
  it("Add Chart Element toggles axes, titles, labels, gridlines, legend and trendlines", () => {
    let c = applyElement(base, { el: "axis", axis: "val", on: false });
    expect(c.axes.val.delete).toBe(true);
    c = applyElement(c, { el: "axisTitle", axis: "cat", on: true });
    expect(c.axes.cat.title).toEqual({});
    c = applyElement(c, { el: "chartTitle", mode: "overlay" });
    expect(c.title).toMatchObject({ overlay: true });
    c = applyElement(c, { el: "dataLabels", position: "insideEnd" });
    expect(c.dataLabels).toEqual({ showValue: true, position: "insideEnd" });
    c = applyElement(c, { el: "gridlines", axis: "val", minor: true, on: true });
    c = applyElement(c, { el: "legend", position: "none" });
    c = applyElement(c, { el: "trendline", kind: "movingAverage", series: 1 });
    expect(c.series[1]!.trendline).toEqual({ kind: { type: "movingAverage", period: 2 } });
    expect(elementState(c)).toMatchObject({ axes: { cat: true, val: false }, title: "overlay", labels: "insideEnd", legend: "none", trendline: true, grid: { valMinor: true } });
    expect(applyElement(c, { el: "dataLabels", position: "none" }).dataLabels).toBeUndefined();
  });
  it("quick layouts (≥ 6) and chart styles (≥ 8) only change what the model carries", () => {
    expect(QUICK_LAYOUTS.length).toBeGreaterThanOrEqual(6);
    const l2 = applyQuickLayout(base, "2");
    expect(l2).toMatchObject({ legend: { position: "top" }, dataLabels: { position: "outsideEnd" } });
    expect(l2.axes.val.delete).toBe(true);
    expect(applyQuickLayout(base, "4").title).toBeUndefined();
    const s2 = applyChartStyle(base, 2);
    expect(s2).toMatchObject({ gapWidth: 50, overlap: 0, dataLabels: { position: "insideEnd" } });
    expect(applyChartStyle(base, 6).gapWidth).toBe(300);
    const pieStyled = applyChartStyle(applyPreset(base, presetById("pie")!), 8);
    expect(pieStyled.gapWidth).toBeUndefined();
    expect(labelPositions(pieStyled.kind)).toContain(pieStyled.dataLabels!.position);
  });
  it("Change Colors: style rules, explicit accents, per point for vary-coloured pies", () => {
    expect(applyColors(base, "mono3").style).toBe(5);
    expect(colorsOf(applyColors(base, "gray"))).toBe("gray");
    const c2 = applyColors(base, "colorful2");
    expect(c2.series.map((s) => s.fill)).toEqual([
      { type: "solid", color: { kind: "theme", value: { slot: "accent2", tint: 0 } } },
      { type: "solid", color: { kind: "theme", value: { slot: "accent4", tint: 0 } } },
    ]);
    expect(colorsOf(c2)).toBeNull();
    expect(colorsOf(applyColors(c2, "colorful1"))).toBe("colorful1");
    const pie = applyColors(applyPreset(base, presetById("pie")!), "colorful4", 3);
    expect(pie.series[0]!.dataPoints?.map((p) => p.idx)).toEqual([0, 1, 2]);
  });
});

describe("Format edits", () => {
  it("fills of series and points, reset, secondary axis, axis options, labels", () => {
    const red = { kind: "rgb" as const, value: "FF0000" };
    let c = setSeriesFill(base, 0, undefined, red);
    expect(c.series[0]!.fill).toEqual({ type: "solid", color: red });
    c = setSeriesFill(c, 0, 2, null);
    expect(c.series[0]!.dataPoints).toEqual([{ idx: 2, fill: { type: "none" } }]);
    expect(resetSeriesFormat(c, 0).series[0]).toEqual(base.series[0]);
    const sec = setSecondary(base, 1, true);
    expect(sec.kind).toEqual({ type: "combo" });
    expect(sec.series[1]).toMatchObject({ axis: "secondary", kind: base.kind });
    expect(setSecondary(sec, 1, false).axes.secondVal).toBeUndefined();
    expect(setAxis(base, "val", { min: 5, max: undefined }).axes.val).toEqual({ majorGridlines: true, min: 5 });
    expect(setLabels(base, 1, { showValue: true }).series[1]!.dataLabels).toEqual({ showValue: true });
    expect(parseNumberField(" ")).toBeUndefined();
    expect(parseNumberField("2,5")).toBe(2.5);
    expect(parseNumberField("x")).toBeNull();
  });
  it("element lists and names follow the orientation", () => {
    const keys = chartElements(base).map((e) => elementName(e, base));
    expect(keys).toContain("Horizontal (Category) Axis");
    expect(keys).toContain("Vertical (Value) Axis Major Gridlines");
    const bar = applyPreset(base, presetById("barClustered")!);
    expect(elementName({ type: "axis", axis: "cat" }, bar)).toBe("Vertical (Category) Axis");
    expect(elementName({ type: "series", series: 0, point: 1 }, base, { series: [{ name: "North", categories: [], values: [] }] })).toBe('Series "North" Point 2');
    expect(chartElements(applyPreset(base, presetById("pie")!)).some((e) => e.type === "axis")).toBe(false);
  });
});

describe("Select Data edits → commands", () => {
  const draft = { series: base.series, categories: base.categories ?? null, displayBlanksAs: "gap" as const, plotVisibleOnly: true };
  it("add / edit / remove / move series and edit the axis labels", () => {
    let d = selectDataOps.add(draft, "=Sheet1!$D$1", "=Sheet1!$D$2:$D$5");
    expect(d.series[2]).toEqual({ name: ref("Sheet1!$D$1"), values: ref("Sheet1!$D$2:$D$5") });
    d = selectDataOps.edit(d, 2, "Extra", "={1,2}");
    expect(d.series[2]).toEqual({ name: { type: "literal", text: "Extra" }, values: { type: "literal", values: [1, 2] } });
    d = selectDataOps.move(d, 2, -1);
    expect(d.series.map((s) => nameText(s.name))).toEqual(["=Sheet1!$B$1", "Extra", "=Sheet1!$C$1"]);
    expect(selectDataOps.move(d, 0, -1)).toBe(d);
    d = selectDataOps.remove(d, 0);
    expect(d.series).toHaveLength(2);
    expect(selectDataOps.categories(d, "").categories).toBeNull();
  });
  it("OK sends setChartSeries, or updateChart when the hidden/empty cell options change", () => {
    const d = selectDataOps.remove(draft, 1);
    expect(selectDataCommand(0, 3, base, d)).toEqual({ type: "setChartSeries", sheet: 0, id: 3, series: [base.series[0]], categories: base.categories });
    const u = selectDataCommand(0, 3, base, { ...d, displayBlanksAs: "zero", plotVisibleOnly: false });
    expect(u).toMatchObject({ type: "updateChart", sheet: 0, id: 3, chart: { displayBlanksAs: "zero", plotVisibleOnly: false, series: [base.series[0]] } });
  });
});

describe("printing charts", () => {
  it("pages carry the charts that intersect them, placed from the page's first cell", async () => {
    const { calcPrintDocument } = await import("../print/calcPrintDoc");
    const { DEFAULT_CALC_PRINT } = await import("../print/layout");
    const cols = Array.from({ length: 30 }, (_, i) => ({ col: i, width: 64 }));
    const rows = Array.from({ length: 10 }, (_, i) => ({ row: i, height: 20, cells: cols.map((c) => ({ col: c.col, text: "", style: {} })) }));
    const table = { cols, rows, width: 30 * 64, height: 200 };
    const doc = calcPrintDocument([{ sheetName: "S", table, charts: [{ x: 128, y: 20, w: 100, h: 50, svg: "<svg id=a></svg>" }, { x: 1500, y: 0, w: 100, h: 50, svg: "<svg id=b></svg>" }] }], DEFAULT_CALC_PRINT);
    expect(doc.pages.length).toBeGreaterThan(1);
    expect(doc.pages[0]).toContain('<div class="rs-calc-chart" style="position:absolute;left:128px;top:20px;width:100px;height:50px"><svg id=a>');
    expect(doc.pages[0]).not.toContain("id=b");
    expect(doc.pages.slice(1).some((p) => p.includes("id=b"))).toBe(true);
  });
});
