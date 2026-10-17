// P9-C6: chart area / plot area paint, text formats, rotated labels, error
// bars, data tables, up/down bars, high-low lines, point labels, manual
// layouts and Excel's axis bounds – and Show's presets rendering exactly as
// before (the snapshot was generated with the renderer of main before P9-C6).

import { describe, expect, it } from "vitest";
import { errorRanges, layoutChart } from "./layout";
import type { Chart, ChartKind, ResolvedChart } from "./model";
import { valueScale } from "./scale";
import type { ChartScene, SceneItem } from "./scene";
import { sceneToSvg } from "./svg";
import { CHART_PRESETS, applyPreset } from "./ui/presets";

const ref = (formula: string) => ({ type: "ref" as const, formula });
const CATS = ["Q1", "Q2", "Q3", "Q4"];
const DATA: ResolvedChart = {
  title: "Sales",
  series: [
    { name: "North", categories: CATS, values: [10, 25, 15, 30] },
    { name: "South", categories: CATS, values: [20, 5, 18, 12] },
  ],
};

function chartOf(kind: ChartKind, extra: Partial<Chart> = {}): Chart {
  return {
    kind,
    series: [
      { name: ref("S!$B$1"), values: ref("S!$B$2:$B$5") },
      { name: ref("S!$C$1"), values: ref("S!$C$2:$C$5") },
    ],
    categories: ref("S!$A$2:$A$5"),
    axes: { cat: {}, val: { majorGridlines: true } },
    legend: { position: "bottom" },
    title: {},
    ...extra,
  };
}
const COLUMN: ChartKind = { type: "bar", direction: "column", grouping: "clustered" };
const LINE: ChartKind = { type: "line", grouping: "standard", markers: false };
const texts = (s: ChartScene) => s.items.filter((i): i is Extract<SceneItem, { t: "text" }> => i.t === "text");
const byEl = (s: ChartScene, type: string) => s.items.filter((i) => i.el?.type === type);

/** A compact, stable view of a scene for snapshots. */
function summary(scene: ChartScene) {
  return scene.items.map((it) => {
    const { el, ...rest } = it as SceneItem & { el?: unknown };
    return { ...rest, el: el ? JSON.stringify(el) : undefined };
  });
}

describe("Show's presets render as before P9-C6", () => {
  // PowerPoint's sample (three series × four categories) with Show's options.
  const sample: ResolvedChart = {
    series: [
      { name: "Series 1", categories: ["Category 1", "Category 2", "Category 3", "Category 4"], values: [4.3, 2.5, 3.5, 4.5] },
      { name: "Series 2", categories: ["Category 1", "Category 2", "Category 3", "Category 4"], values: [2.4, 4.4, 1.8, 2.8] },
      { name: "Series 3", categories: ["Category 1", "Category 2", "Category 3", "Category 4"], values: [2, 2, 3, 5] },
    ],
  };
  const base: Chart = {
    kind: COLUMN,
    series: [0, 1, 2].map((i) => ({ name: ref(`Sheet1!$${"BCD"[i]}$1`), values: ref(`Sheet1!$${"BCD"[i]}$2:$${"BCD"[i]}$5`) })),
    categories: ref("Sheet1!$A$2:$A$5"),
    axes: { cat: {}, val: { majorGridlines: true } },
    legend: { position: "bottom" },
    title: { text: { type: "literal", text: "Chart Title" } },
  };
  const show = { area: { fill: null, border: null }, textColor: "#595959" };
  for (const p of CHART_PRESETS) {
    it(p.id, () => {
      expect(summary(layoutChart(applyPreset(base, p), sample, 480, 270, show))).toMatchSnapshot();
    });
  }
});

describe("chart area and plot area", () => {
  it("defaults stay white with the Office border; a gradient, shadow and rounded corners are painted", () => {
    const plain = layoutChart(chartOf(COLUMN), DATA, 480, 288);
    const area = plain.items[0] as Extract<SceneItem, { t: "rect" }>;
    expect(area).toMatchObject({ t: "rect", fill: "#FFFFFF", stroke: "#D9D9D9" });
    expect(area.gradient).toBeUndefined();
    const fancy = layoutChart(
      chartOf(COLUMN, {
        chartArea: { fill: { type: "gradient", angle: 90, stops: [{ pos: 0, color: { kind: "rgb", value: "FFFFFF" } }, { pos: 1, color: { kind: "rgb", value: "DDEBF7" } }] }, line: { none: true }, shadow: true },
        roundedCorners: true,
      }),
      DATA, 480, 288,
    );
    const r = fancy.items[0] as Extract<SceneItem, { t: "rect" }>;
    expect(r.gradient?.stops.map((s) => s.color)).toEqual(["#FFFFFF", "#DDEBF7"]);
    // 90° runs top to bottom.
    expect(r.gradient!.x0).toBeCloseTo(r.gradient!.x1);
    expect(r.gradient!.y1).toBeGreaterThan(r.gradient!.y0);
    expect(r.shadow && r.radius).toBeTruthy();
    expect(r.stroke).toBeUndefined();
    const svg = sceneToSvg(fancy, undefined, "t-");
    expect(svg).toContain('<linearGradient id="t-g0"');
    expect(svg).toContain("feDropShadow");
    expect(svg).toContain('rx="8"');
  });

  it("the plot area fill sits under the gridlines; a picture fill is an image", () => {
    const s = layoutChart(chartOf(COLUMN, { plotArea: { fill: { type: "solid", color: { kind: "rgb", value: "F2F2F2" } } } }), DATA, 480, 288);
    const plotIdx = s.items.findIndex((i) => i.t === "rect" && i.el?.type === "plotArea");
    const gridIdx = s.items.findIndex((i) => i.el?.type === "gridlines");
    expect(plotIdx).toBeGreaterThan(0);
    expect(plotIdx).toBeLessThan(gridIdx);
    expect(s.items[plotIdx]).toMatchObject({ x: s.plot.x, y: s.plot.y, w: s.plot.w, fill: "#F2F2F2" });
    const p = layoutChart(chartOf(COLUMN, { chartArea: { fill: { type: "picture", media: { contentType: "image/png", data: "AAAA" } } } }), DATA, 200, 100);
    expect((p.items[0] as Extract<SceneItem, { t: "rect" }>).image).toBe("data:image/png;base64,AAAA");
    expect(sceneToSvg(p)).toContain('href="data:image/png;base64,AAAA"');
  });
});

describe("text formats and rotation", () => {
  it("title, legend, axis labels and data labels take their fonts; the chart's size scales the defaults", () => {
    const red = { kind: "rgb" as const, value: "C00000" };
    const s = layoutChart(
      chartOf(COLUMN, {
        title: { textFormat: { size: 20, bold: true, color: red, font: "Arial" } },
        legendTextFormat: { italic: true },
        axes: { cat: { textFormat: { size: 12 } }, val: { majorGridlines: true } },
        dataLabels: { showValue: true, textFormat: { color: red } },
      }),
      DATA, 480, 288,
    );
    const title = texts(s).find((x) => x.el?.type === "title")!;
    expect(title).toMatchObject({ size: 26.67, bold: true, color: "#C00000", font: "Arial" });
    expect(texts(s).filter((x) => x.el?.type === "legend").every((x) => x.italic)).toBe(true);
    expect(texts(s).filter((x) => x.el?.type === "axis" && (x.el as { axis: string }).axis === "cat")[0]!.size).toBe(16);
    expect(texts(s).filter((x) => x.el?.type === "dataLabels").every((x) => x.color === "#C00000")).toBe(true);
    const scaled = layoutChart(chartOf(COLUMN, { textFormat: { size: 18 } }), DATA, 480, 288);
    expect(texts(scaled).find((x) => x.el?.type === "legend")!.size).toBe(24);
  });

  it("an axis angle rotates the category labels; Calc's option turns overlapping labels −45°", () => {
    const long = { ...DATA, series: DATA.series.map((s) => ({ ...s, categories: ["First quarter of the year", "Second quarter of it", "Third quarter of it", "Fourth quarter of it"] })) };
    const cat = (s: ChartScene) => texts(s).filter((x) => x.el?.type === "axis" && (x.el as { axis: string }).axis === "cat");
    const fixed = layoutChart(chartOf(COLUMN, { axes: { cat: { textFormat: { rotation: -45 } }, val: {} } }), DATA, 480, 288);
    expect(cat(fixed).every((x) => x.rotate === -45 && x.align === "right")).toBe(true);
    // Default: thinned, never rotated (Show and every host without the option).
    expect(cat(layoutChart(chartOf(COLUMN), long, 260, 200)).some((x) => x.rotate)).toBe(false);
    const auto = layoutChart(chartOf(COLUMN), long, 260, 200, { autoRotateLabels: true });
    expect(cat(auto).length).toBe(4);
    expect(cat(auto).every((x) => x.rotate === -45)).toBe(true);
    // Rotated labels take height from the plot area.
    expect(auto.plot.h).toBeLessThan(layoutChart(chartOf(COLUMN), long, 260, 200).plot.h);
  });
});

describe("error bars", () => {
  it("fixed, percentage, standard deviation (around the mean), standard error and custom amounts", () => {
    const v = [10, 20, 30];
    expect(errorRanges({ amount: { type: "fixed", value: 2 } }, v, undefined)[1]).toEqual({ lo: 18, hi: 22 });
    expect(errorRanges({ amount: { type: "percentage", value: 10 }, barType: "plus" }, v, undefined)[2]).toEqual({ lo: 30, hi: 33 });
    const sd = errorRanges({ amount: { type: "stdDev", value: 1 } }, v, undefined)[0]!;
    expect(sd.at).toBe(20);
    expect(sd.hi - 20).toBeCloseTo(10);
    const se = errorRanges({ amount: { type: "stdErr" }, barType: "minus" }, v, undefined)[1]!;
    expect(20 - se.lo).toBeCloseTo(10 / Math.sqrt(3));
    expect(se.hi).toBe(20);
    const custom = errorRanges({ amount: { type: "custom" } }, v, { plus: [1, 2, 3], minus: [0.5] });
    expect(custom[2]).toEqual({ lo: 29.5, hi: 33 });
    expect(errorRanges({ amount: { type: "fixed", value: 1 } }, [null, 5], undefined)[0]).toBeNull();
  });

  it("are drawn over bars and on scatter in both directions", () => {
    const s = layoutChart(chartOf(COLUMN, { series: chartOf(COLUMN).series.map((x) => ({ ...x, errorBars: [{ amount: { type: "fixed", value: 3 } }] })) }), DATA, 480, 288);
    const bars = byEl(s, "errorBars");
    expect(bars).toHaveLength(8);
    expect((bars[0] as Extract<SceneItem, { t: "path" }>).stroke).toBe("#595959");
    const noCap = layoutChart(chartOf(COLUMN, { series: [{ ...chartOf(COLUMN).series[0]!, errorBars: [{ amount: { type: "fixed", value: 3 }, noEndCap: true }] }] }), DATA, 480, 288);
    expect((byEl(noCap, "errorBars")[0] as Extract<SceneItem, { t: "path" }>).d.split("M")).toHaveLength(2);
    const scatter = layoutChart(
      chartOf({ type: "scatter", style: "marker" }, { series: [{ ...chartOf(COLUMN).series[0]!, errorBars: [{ direction: "x", amount: { type: "fixed", value: 0.2 } }, { amount: { type: "fixed", value: 1 } }] }] }),
      { series: [{ name: "A", categories: [], xValues: [1, 2, 3, 4], values: [10, 25, 15, 30] }] }, 480, 288,
    );
    expect(byEl(scatter, "errorBars")).toHaveLength(8);
  });
});

describe("data table, up/down bars, high-low lines", () => {
  it("a data table lists series and values under the plot instead of the category labels", () => {
    const s = layoutChart(chartOf(COLUMN, { dataTable: { keys: true } }), DATA, 480, 288);
    const t = texts(s).filter((x) => x.el?.type === "dataTable").map((x) => x.text);
    expect(t).toEqual(expect.arrayContaining(["Q1", "Q4", "North", "South", "10", "30", "12"]));
    expect(texts(s).filter((x) => x.el?.type === "axis" && (x.el as { axis: string }).axis === "cat")).toHaveLength(0);
    expect(byEl(s, "dataTable").some((x) => x.t === "rect")).toBe(true);
  });

  it("line charts: up bars white, down bars dark, high-low lines per category", () => {
    const s = layoutChart(chartOf(LINE, { upDownBars: {}, highLowLines: {} }), DATA, 480, 288);
    const ud = byEl(s, "upDownBars") as Extract<SceneItem, { t: "rect" }>[];
    expect(ud.map((r) => r.fill)).toEqual(["#FFFFFF", "#595959", "#FFFFFF", "#595959"]);
    expect(byEl(s, "highLowLines")).toHaveLength(1);
    // Behind the lines.
    const lineIdx = s.items.findIndex((i) => i.el?.type === "series");
    expect(s.items.findIndex((i) => i.el?.type === "upDownBars")).toBeLessThan(lineIdx);
  });
});

describe("point labels and manual layouts", () => {
  it("a point's own label overrides or hides the series' labels; Value From Cells texts come first", () => {
    const series = chartOf(COLUMN).series.map((x, i) =>
      i === 0 ? { ...x, dataLabels: { showValue: true, showRange: true, points: [{ idx: 1, delete: true }, { idx: 2, showCategory: true }] } } : x,
    );
    const data = { ...DATA, series: [{ ...DATA.series[0]!, labelTexts: ["a", "b", "c", "d"] }, DATA.series[1]!] };
    const s = layoutChart(chartOf(COLUMN, { series }), data, 480, 288);
    const labels = texts(s).filter((x) => x.el?.type === "dataLabels").map((x) => x.text);
    expect(labels).toEqual(["a, 10", "Q3", "d, 30"]);
  });

  it("plot area, title and legend placed by hand", () => {
    const s = layoutChart(
      chartOf(COLUMN, { plotLayout: { x: 0.1, y: 0.2, w: 0.5, h: 0.5 }, title: { layout: { x: 0.5, y: 0.05 } }, legendLayout: { x: 0.8, y: 0.1, w: 0.15, h: 0.3 } }),
      DATA, 400, 200,
    );
    expect(s.plot).toEqual({ x: 40, y: 40, w: 200, h: 100 });
    const title = texts(s).find((x) => x.el?.type === "title")!;
    expect([title.x, title.y, title.align]).toEqual([204, 12, "left"]);
    const legend = s.hits.find((h) => h.el.type === "legend")!.shape as { x: number; y: number };
    expect([legend.x, legend.y]).toEqual([320, 20]);
  });
});

describe("Excel's automatic axis bounds", () => {
  const ex = (lo: number, hi: number, len = 220) => {
    const s = valueScale(lo, hi, len, true, { excel: true });
    return [s.min, s.max, s.major];
  };
  it("pads 5 % beyond the data, rounded out to the unit of the unpadded range", () => {
    expect(ex(1, 10)).toEqual([0, 12, 2]);
    expect(ex(0, 100)).toEqual([0, 120, 20]);
    expect(ex(3, 97)).toEqual([0, 120, 20]);
    // No zero bound (the minimum is above 5/6 of the maximum); the padded range needs a coarser unit.
    expect(ex(100, 110)).toEqual([95, 115, 5]);
    expect(ex(-10, -1)).toEqual([-12, 0, 2]);
    expect(ex(-5, 5)).toEqual([-6, 6, 2]);
    // Fixed bounds win.
    expect(valueScale(1, 10, 220, true, { excel: true, max: 50 }).max).toBe(50);
    // The P8-20 rule is unchanged without the option.
    expect(valueScale(3, 97, 220, true, { headroom: true }).max).toBe(100);
  });
});
