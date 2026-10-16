import { describe, expect, it } from "vitest";
import { elementBounds, hitTestChart, selectionMarks } from "./hit";
import { layoutChart } from "./layout";
import type { Chart, ChartKind, ResolvedChart, Series } from "./model";
import { paletteColor, resolveColor, styleColumn } from "./palette";
import { labelStep, logScale, maxIntervals, minorTicks, niceUnit, scaleFraction, valueScale } from "./scale";
import type { ChartScene, SceneItem } from "./scene";
import { elementKey } from "./scene";
import { sceneToSvg } from "./svg";
import { fitTrend, movingAverage, trendEquation } from "./trend";
import { basicFormat, formatGeneral } from "./format";

const ref = (formula: string) => ({ type: "ref" as const, formula });
const series = (n: number, extra: Partial<Series> = {}): Series => ({ name: ref(`Sheet1!$${"BCD"[n]}$1`), values: ref(`Sheet1!$${"BCD"[n]}$2:$${"BCD"[n]}$5`), ...extra });

function chartOf(kind: ChartKind, count = 2, extra: Partial<Chart> = {}): Chart {
  return {
    kind,
    series: Array.from({ length: count }, (_, i) => series(i)),
    categories: ref("Sheet1!$A$2:$A$5"),
    axes: { cat: {}, val: { majorGridlines: true } },
    legend: { position: "bottom" },
    title: {},
    ...extra,
  };
}

const CATS = ["Q1", "Q2", "Q3", "Q4"];
const DATA: ResolvedChart = {
  title: "Sales",
  series: [
    { name: "North", categories: CATS, values: [10, 25, 15, 30] },
    { name: "South", categories: CATS, values: [20, 5, null, 12] },
  ],
};
const W = 480;
const H = 288;

const bars = (scene: ChartScene, series?: number) =>
  scene.items.filter((it): it is Extract<SceneItem, { t: "rect" }> => it.t === "rect" && it.el?.type === "series" && (series === undefined || it.el.series === series));
const texts = (scene: ChartScene) => scene.items.filter((it): it is Extract<SceneItem, { t: "text" }> => it.t === "text").map((t) => t.text);
const paths = (scene: ChartScene, type: string) => scene.items.filter((it): it is Extract<SceneItem, { t: "path" }> => it.t === "path" && it.el?.type === type);

describe("palette", () => {
  it("colourful style 2: accents with variations after six", () => {
    expect(resolveColor(paletteColor(2, 0, 2))).toBe("#4472C4");
    expect(resolveColor(paletteColor(2, 1, 2))).toBe("#ED7D31");
    expect(paletteColor(2, 6, 8)).toEqual({ kind: "theme", value: { slot: "accent1", tint: -0.4 } });
    expect(styleColumn(undefined)).toBe(1);
    expect(styleColumn(99)).toBe(1);
  });
  it("grayscale and monochrome rules spread their tints", () => {
    expect(paletteColor(1, 0, 1)).toEqual({ kind: "theme", value: { slot: "dark1", tint: 0.5 } });
    expect(paletteColor(1, 0, 3)).toEqual({ kind: "theme", value: { slot: "dark1", tint: 0.15 } });
    expect(paletteColor(1, 2, 3)).toEqual({ kind: "theme", value: { slot: "dark1", tint: 0.85 } });
    expect(paletteColor(3, 0, 1)).toEqual({ kind: "theme", value: { slot: "accent1", tint: 0 } });
    expect(paletteColor(4, 1, 3)).toEqual({ kind: "theme", value: { slot: "accent2", tint: -0.05 } });
    expect(resolveColor({ kind: "rgb", value: "ff0000" })).toBe("#FF0000");
    expect(resolveColor({ kind: "theme", value: { slot: "accent1", tint: 0 } }, { accent1: "112233" })).toBe("#112233");
  });
});

describe("value scale", () => {
  it("nice units are 1, 2, 5 × 10ⁿ", () => {
    expect(niceUnit(0.6)).toBe(1);
    expect(niceUnit(1.2)).toBe(2);
    expect(niceUnit(3)).toBe(5);
    expect(niceUnit(7)).toBe(10);
    expect(niceUnit(0.013)).toBe(0.02);
    expect(maxIntervals(200, true)).toBe(5);
    expect(maxIntervals(50, true)).toBe(2);
    expect(maxIntervals(700, false)).toBe(10);
  });
  it("starts at zero below 5/6 of the maximum, adds headroom when the maximum is on a bound", () => {
    const s = valueScale(5, 30, 200, true, { headroom: true });
    expect(s).toMatchObject({ min: 0, major: 10, max: 40 });
    expect(s.ticks).toEqual([0, 10, 20, 30, 40]);
    const t = valueScale(5, 28, 200, true, { headroom: true });
    expect(t.max).toBe(30);
    const close = valueScale(90, 100, 200, true);
    expect(close.min).toBe(90);
    expect(close.max).toBe(100);
  });
  it("negative ranges and fixed bounds", () => {
    const s = valueScale(-12, 20, 240, true);
    expect(s.min).toBe(-20);
    expect(s.max).toBe(20);
    const allNeg = valueScale(-30, -5, 200, true);
    expect(allNeg.max).toBe(0);
    const fixed = valueScale(0, 30, 200, true, { min: 5, max: 25, majorUnit: 5 });
    expect(fixed.ticks).toEqual([5, 10, 15, 20, 25]);
    expect(valueScale(null, null, 200, true)).toMatchObject({ min: 0, max: 1 });
    expect(valueScale(0.1, 0.3, 200, true).ticks.every((t) => String(t).length < 6)).toBe(true);
  });
  it("logarithmic axes use powers of the base; minor ticks between majors; label thinning", () => {
    const s = logScale(3, 4500, { logBase: 10 });
    expect(s.ticks).toEqual([1, 10, 100, 1000, 10000]);
    expect(scaleFraction(s, 100)).toBeCloseTo(0.5);
    const lin = valueScale(0, 10, 100, true, { majorUnit: 5, minorUnit: 1 });
    expect(minorTicks(lin)).toEqual([1, 2, 3, 4, 6, 7, 8, 9]);
    expect(labelStep(10, 50, 300)).toBe(2);
    expect(labelStep(4, 20, 400)).toBe(1);
  });
});

describe("trendlines", () => {
  it("fits linear, exponential, logarithmic, power and polynomial curves", () => {
    const xs = [1, 2, 3, 4];
    const lin = fitTrend({ type: "linear" }, xs, [3, 5, 7, 9])!;
    expect(lin.coef[0]).toBeCloseTo(2);
    expect(lin.coef[1]).toBeCloseTo(1);
    expect(lin.r2).toBeCloseTo(1);
    expect(trendEquation({ type: "linear" }, lin)).toBe("y = 2x + 1");
    const exp = fitTrend({ type: "exponential" }, xs, xs.map((x) => 2 * Math.exp(0.5 * x)))!;
    expect(exp.coef[0]).toBeCloseTo(2);
    expect(exp.coef[1]).toBeCloseTo(0.5);
    const log = fitTrend({ type: "logarithmic" }, xs, xs.map((x) => 3 * Math.log(x) + 1))!;
    expect(log.at(Math.E)).toBeCloseTo(4);
    const pow = fitTrend({ type: "power" }, xs, xs.map((x) => 2 * x ** 1.5))!;
    expect(pow.coef[1]).toBeCloseTo(1.5);
    const poly = fitTrend({ type: "polynomial", order: 2 }, [1, 2, 3, 4, 5], [1, 4, 9, 16, 25])!;
    expect(poly.at(6)).toBeCloseTo(36);
    expect(trendEquation({ type: "polynomial", order: 2 }, poly)).toMatch(/^y = 1x²/);
    expect(movingAverage([1, 2, 3, 4], [2, 4, 6, null], 2)).toEqual([[2, 3], [3, 5], [4, 6]]);
  });
});

describe("number formats", () => {
  it("formats General and the plain codes", () => {
    expect(formatGeneral(0.1 + 0.2)).toBe("0.3");
    expect(formatGeneral(1e12)).toBe("1.00E+12");
    expect(basicFormat(1234.5, "#,##0.00")).toBe("1,234.50");
    expect(basicFormat(0.25, "0%")).toBe("25%");
    expect(basicFormat(-3.14159, "0.0")).toBe("-3.1");
  });
});

/** The scene with items reduced to their kind and element (keeps snapshots readable). */
function summary(scene: ChartScene) {
  return {
    plot: scene.plot,
    axes: scene.axes,
    items: scene.items.map((it) => {
      const el = it.el ? elementKey(it.el) : undefined;
      if (it.t === "rect") return { t: "rect", el, x: it.x, y: it.y, w: it.w, h: it.h, fill: it.fill };
      if (it.t === "text") return { t: "text", el, text: it.text, x: it.x, y: it.y };
      return { t: "path", el, d: it.d.length > 120 ? `${it.d.slice(0, 120)}…` : it.d, fill: it.fill, stroke: it.stroke };
    }),
  };
}

describe("layoutChart snapshots per kind", () => {
  const kinds: [string, ChartKind, Partial<Chart>?][] = [
    ["clustered column", { type: "bar", direction: "column", grouping: "clustered" }, { gapWidth: 219, overlap: -27 }],
    ["stacked column", { type: "bar", direction: "column", grouping: "stacked" }],
    ["percent stacked column", { type: "bar", direction: "column", grouping: "percentStacked" }],
    ["clustered bar", { type: "bar", direction: "bar", grouping: "clustered" }, { legend: { position: "right" } }],
    ["stacked bar", { type: "bar", direction: "bar", grouping: "stacked" }],
    ["line with markers", { type: "line", grouping: "standard", markers: true }],
    ["stacked line", { type: "line", grouping: "stacked", markers: false }],
    ["area", { type: "area", grouping: "standard" }],
    ["stacked area", { type: "area", grouping: "stacked" }],
    ["pie", { type: "pie" }, { varyColors: true, legend: { position: "right" }, dataLabels: { showPercent: true } }],
    ["doughnut", { type: "doughnut" }, { varyColors: true, holeSize: 60 }],
    ["scatter", { type: "scatter", style: "lineMarker" }],
  ];
  for (const [name, kind, extra] of kinds) {
    it(name, () => {
      const scene = layoutChart(chartOf(kind, 2, extra), DATA, W, H);
      expect(summary(scene)).toMatchSnapshot();
    });
  }
  it("combo with a secondary axis", () => {
    const chart = chartOf({ type: "combo" }, 2);
    chart.series[1] = { ...chart.series[1]!, kind: { type: "line", grouping: "standard", markers: true }, axis: "secondary" };
    chart.axes.secondVal = { crosses: { type: "max" } };
    const scene = layoutChart(chart, { series: [DATA.series[0]!, { ...DATA.series[1]!, values: [0.2, 0.5, 0.4, 0.9] }] }, W, H);
    expect(summary(scene)).toMatchSnapshot();
    expect(scene.axes.secondVal).toMatchObject({ min: 0, max: 1 });
  });
  it("combo z-order is Excel's: areas behind columns, lines and then scatter in front (P8-45 S-10)", () => {
    // series 0 = stacked area, series 1 = clustered column, series 2 = line: drawn area, column, line
    const chart = chartOf({ type: "combo" }, 3);
    chart.series[0] = { ...chart.series[0]!, kind: { type: "area", grouping: "stacked" } };
    chart.series[1] = { ...chart.series[1]!, kind: { type: "bar", direction: "column", grouping: "clustered" } };
    chart.series[2] = { ...chart.series[2]!, kind: { type: "line", grouping: "standard", markers: false } };
    const data: ResolvedChart = { series: [DATA.series[0]!, { name: "Cols", categories: CATS, values: [5, 6, 7, 8] }, { name: "Line", categories: CATS, values: [3, 4, 5, 6] }] };
    const scene = layoutChart(chart, data, W, H);
    const at = (pred: (it: SceneItem) => boolean) => scene.items.findIndex(pred);
    const area = at((it) => it.t === "path" && it.el?.type === "series" && it.el.series === 0);
    const column = at((it) => it.t === "rect" && it.el?.type === "series" && it.el.series === 1);
    const line = at((it) => it.el?.type === "series" && it.el.series === 2);
    expect(area).toBeGreaterThanOrEqual(0);
    expect(area).toBeLessThan(column);
    expect(column).toBeLessThan(line);
    // a click on a column inside the area picks the column (it is in front)
    const bar = bars(scene, 1)[0]!;
    expect(hitTestChart(scene, bar.x + bar.w / 2, bar.y + bar.h - 2)).toMatchObject({ type: "series", series: 1 });
  });
  it("lines are drawn before scatter series in a combo", () => {
    const chart = chartOf({ type: "combo" }, 2);
    chart.series[0] = { ...chart.series[0]!, kind: { type: "scatter", style: "lineMarker" } };
    chart.series[1] = { ...chart.series[1]!, kind: { type: "line", grouping: "standard", markers: false } };
    const scene = layoutChart(chart, DATA, W, H);
    const first = (n: number) => scene.items.findIndex((it) => it.el?.type === "series" && it.el.series === n);
    expect(first(1)).toBeLessThan(first(0));
  });
  it("unsupported charts show the placeholder text only", () => {
    const scene = layoutChart(chartOf({ type: "unsupported", kind: "radarChart", xml: "<c:radarChart/>" }), { series: [] }, W, H, {
      labels: { unsupported: "Cannot show {kind}" },
    });
    expect(texts(scene)).toEqual(["Cannot show radarChart"]);
  });
});

describe("layoutChart geometry", () => {
  it("clustered bars follow Excel's gap and overlap formula", () => {
    const scene = layoutChart(chartOf({ type: "bar", direction: "column", grouping: "clustered" }, 2, { gapWidth: 100, overlap: 0 }), DATA, W, H);
    const north = bars(scene, 0);
    const south = bars(scene, 1);
    expect(north).toHaveLength(4);
    expect(south).toHaveLength(3); // the blank point has no bar
    const band = scene.plot.w / 4;
    const w = band / (2 + 1);
    expect(north[0]!.w).toBeCloseTo(w, 1);
    expect(north[0]!.x).toBeCloseTo(scene.plot.x + w / 2, 1);
    expect(south[0]!.x).toBeCloseTo(scene.plot.x + w / 2 + w, 1);
    // Heights are proportional to the values (common baseline).
    expect(north[3]!.h / north[0]!.h).toBeCloseTo(3, 1);
    expect(north[0]!.y + north[0]!.h).toBeCloseTo(scene.plot.y + scene.plot.h, 1);
  });
  it("stacked bars sit on each other; percent stacked fill the axis", () => {
    const st = layoutChart(chartOf({ type: "bar", direction: "column", grouping: "stacked" }), DATA, W, H);
    const [n0] = bars(st, 0);
    const [s0] = bars(st, 1);
    expect(s0!.y + s0!.h).toBeCloseTo(n0!.y, 1);
    const pct = layoutChart(chartOf({ type: "bar", direction: "column", grouping: "percentStacked" }), DATA, W, H);
    expect(pct.axes.val).toMatchObject({ min: 0, max: 1 });
    const a = bars(pct, 0)[0]!;
    const b = bars(pct, 1)[0]!;
    expect(a.h + b.h).toBeCloseTo(pct.plot.h, 0);
    expect(texts(pct)).toContain("100%");
  });
  it("horizontal bars put the first category at the bottom; reverse flips it", () => {
    const scene = layoutChart(chartOf({ type: "bar", direction: "bar", grouping: "clustered" }), DATA, W, H);
    const north = bars(scene, 0);
    expect(north[0]!.y).toBeGreaterThan(north[3]!.y);
    expect(north[0]!.x).toBeCloseTo(scene.plot.x, 1);
    const rev = layoutChart(chartOf({ type: "bar", direction: "bar", grouping: "clustered" }, 2, { axes: { cat: { reverse: true }, val: {} } }), DATA, W, H);
    const r = bars(rev, 0);
    expect(r[0]!.y).toBeLessThan(r[3]!.y);
  });
  it("blanks: gap splits a line, span joins it, zero plots 0", () => {
    const line = (displayBlanksAs?: Chart["displayBlanksAs"]) =>
      paths(layoutChart(chartOf({ type: "line", grouping: "standard", markers: false }, 2, { displayBlanksAs }), DATA, W, H), "series")
        .filter((p) => p.el?.type === "series" && p.el.series === 1 && p.stroke)[0]!.d;
    expect(line().match(/M/g)).toHaveLength(2);
    expect(line("span").match(/M/g)).toHaveLength(1);
    expect(line("span").match(/L/g)).toHaveLength(2);
    expect(line("zero").match(/L/g)).toHaveLength(3);
  });
  it("smooth lines are Béziers; markers follow the kind and the series override", () => {
    const chart = chartOf({ type: "line", grouping: "standard", markers: true });
    chart.series[0] = { ...chart.series[0]!, smooth: true, marker: { symbol: "none" } };
    const scene = layoutChart(chart, DATA, W, H);
    const s0 = paths(scene, "series").filter((p) => p.el?.type === "series" && p.el.series === 0);
    expect(s0).toHaveLength(1);
    expect(s0[0]!.d).toContain("C");
    const s1markers = scene.items.filter((it) => it.el?.type === "series" && it.el.series === 1 && it.el.point !== undefined);
    expect(s1markers).toHaveLength(3);
  });
  it("pie slices start at 12 o'clock clockwise and skip non-positive values", () => {
    const data: ResolvedChart = { series: [{ name: "S", categories: ["a", "b", "c", "d"], values: [1, 1, 0, 2] }] };
    const scene = layoutChart(chartOf({ type: "pie" }, 1, { varyColors: true, legend: undefined, title: undefined }), data, 300, 300);
    const sectors = scene.hits.filter((h) => h.shape.kind === "sector");
    expect(sectors).toHaveLength(3);
    const first = sectors[0]!.shape as Extract<ChartScene["hits"][number]["shape"], { kind: "sector" }>;
    expect(first.a0).toBeCloseTo(0);
    expect(first.a1).toBeCloseTo(Math.PI / 2);
    expect(first.r1).toBeCloseTo(0.75 * 284 / 2, 0);
    const fills = scene.items.filter((it) => it.t === "path" && it.el?.type === "series").map((it) => (it as { fill?: string }).fill);
    expect(new Set(fills).size).toBe(3);
  });
  it("doughnut rings: first series innermost, hole per holeSize", () => {
    const scene = layoutChart(chartOf({ type: "doughnut" }, 2, { holeSize: 50, legend: undefined, title: undefined }), DATA, 300, 300);
    const ring = (s: number) => scene.hits.find((h) => h.el.type === "series" && h.el.series === s && h.shape.kind === "sector")!.shape as { r0: number; r1: number };
    expect(ring(0).r1).toBeCloseTo(ring(1).r0);
    expect(ring(0).r0 / ring(1).r1).toBeCloseTo(0.5);
  });
  it("scatter uses the x values; trendline and its legend entry", () => {
    const chart = chartOf({ type: "scatter", style: "marker" }, 1);
    chart.series[0] = { ...chart.series[0]!, trendline: { kind: { type: "linear" }, displayEquation: true, displayRSquared: true } };
    const data: ResolvedChart = { series: [{ name: "Y", categories: ["1", "2", "4"], xValues: [1, 2, 4], values: [2, 4, 8] }] };
    const scene = layoutChart(chart, data, W, H);
    expect(scene.axes.cat!.max).toBeGreaterThanOrEqual(4);
    expect(paths(scene, "series").filter((p) => p.stroke && p.el?.type === "series" && p.el.point === undefined)).toHaveLength(0);
    expect(paths(scene, "trendline")).toHaveLength(1);
    expect(texts(scene)).toContain("Linear (Y)");
    expect(texts(scene)).toContain("y = 2x");
    expect(texts(scene)).toContain("R² = 1");
  });
  it("data labels: values formatted with the series' format, positions per kind", () => {
    const data: ResolvedChart = { series: [{ ...DATA.series[0]!, formatCode: "0.0" }] };
    const scene = layoutChart(chartOf({ type: "bar", direction: "column", grouping: "clustered" }, 1, { dataLabels: { showValue: true } }), data, W, H);
    expect(texts(scene)).toEqual(expect.arrayContaining(["10.0", "25.0", "15.0", "30.0"]));
    const label = scene.items.find((it) => it.t === "text" && it.text === "30.0" && it.el?.type === "dataLabels") as Extract<SceneItem, { t: "text" }>;
    const bar = bars(scene, 0)[3]!;
    expect(label.y).toBeLessThan(bar.y);
    const custom = layoutChart(chartOf({ type: "bar", direction: "column", grouping: "clustered" }, 1, { dataLabels: { showValue: true, showCategory: true } }), DATA, W, H, {
      format: (v) => `<${v}>`,
    });
    expect(texts(custom)).toContain("Q1, <10>");
  });
  it("titles: automatic single-series title, axis titles, legend order of right-side bar legends", () => {
    const one = layoutChart(chartOf({ type: "bar", direction: "column", grouping: "clustered" }, 1, { axes: { cat: { title: {} }, val: { title: { text: { type: "literal", text: "Units" } } } } }), { series: [DATA.series[0]!] }, W, H);
    expect(one.titleText).toBe("North");
    expect(texts(one)).toEqual(expect.arrayContaining(["Axis Title", "Units"]));
    const right = layoutChart(chartOf({ type: "bar", direction: "bar", grouping: "clustered" }, 2, { legend: { position: "right" } }), DATA, W, H);
    const legend = texts(right).filter((t) => t === "North" || t === "South");
    expect(legend).toEqual(["South", "North"]);
  });
  it("tick labels use the axis format, else the first value cell's format", () => {
    const data: ResolvedChart = { series: [{ ...DATA.series[0]!, formatCode: "0.00" }] };
    const scene = layoutChart(chartOf({ type: "line", grouping: "standard", markers: false }, 1), data, W, H);
    expect(texts(scene)).toContain("10.00");
    const own = layoutChart(chartOf({ type: "line", grouping: "standard", markers: false }, 1, { axes: { cat: {}, val: { numberFormat: "0%" } } }), data, W, H);
    expect(texts(own)).toContain("1000%");
    const hidden = layoutChart(chartOf({ type: "line", grouping: "standard", markers: false }, 1, { axes: { cat: { delete: true }, val: { tickLabels: "none" } } }), data, W, H);
    expect(texts(hidden)).not.toContain("Q1");
    expect(texts(hidden)).not.toContain("10.00");
  });
  it("thumbnails have no text", () => {
    const scene = layoutChart(chartOf({ type: "bar", direction: "column", grouping: "clustered" }), DATA, 48, 36, { thumbnail: true });
    expect(texts(scene)).toEqual([]);
    expect(bars(scene).length).toBe(7);
  });
});

describe("hit-testing", () => {
  const scene = layoutChart(chartOf({ type: "bar", direction: "column", grouping: "clustered" }), DATA, W, H);
  it("finds bars, the title, the legend, axes, the plot and chart area", () => {
    const bar = bars(scene, 0)[1]!;
    expect(hitTestChart(scene, bar.x + bar.w / 2, bar.y + bar.h / 2)).toEqual({ type: "series", series: 0, point: 1 });
    expect(hitTestChart(scene, W / 2, 14)).toEqual({ type: "title" });
    const legendText = scene.items.find((it) => it.t === "text" && it.text === "South") as Extract<SceneItem, { t: "text" }>;
    expect(hitTestChart(scene, legendText.x + 5, legendText.y)).toEqual({ type: "legend" });
    expect(hitTestChart(scene, scene.plot.x - 10, scene.plot.y + scene.plot.h / 2)).toEqual({ type: "axis", axis: "val" });
    expect(hitTestChart(scene, scene.plot.x + scene.plot.w / 2, scene.plot.y + scene.plot.h + 8)).toEqual({ type: "axis", axis: "cat" });
    expect(hitTestChart(scene, 3, 3)).toEqual({ type: "chartArea" });
    expect(hitTestChart(scene, W + 5, 3)).toBeNull();
  });
  it("gridlines, lines and pie sectors", () => {
    const g = scene.axes.val!.ticks[2]!;
    const frac = (g - scene.axes.val!.min) / (scene.axes.val!.max - scene.axes.val!.min);
    const y = scene.plot.y + scene.plot.h - frac * scene.plot.h;
    expect(hitTestChart(scene, scene.plot.x + scene.plot.w - 2, y)).toEqual({ type: "gridlines", axis: "val" });
    const line = layoutChart(chartOf({ type: "line", grouping: "standard", markers: false }, 1), DATA, W, H);
    const d = paths(line, "series")[0]!.d;
    const [, x0, y0, x1, y1] = /M(\S+) (\S+) L(\S+) (\S+)/.exec(d)!.map(Number);
    expect(hitTestChart(line, (x0! + x1!) / 2, (y0! + y1!) / 2)).toEqual({ type: "series", series: 0 });
    const pie = layoutChart(chartOf({ type: "pie" }, 1, { legend: undefined, title: undefined }), DATA, 300, 300);
    expect(hitTestChart(pie, 150 + 20, 150 - 60)).toEqual({ type: "series", series: 0, point: 0 });
    expect(hitTestChart(pie, 150 - 20, 150 - 60)).toEqual({ type: "series", series: 0, point: 3 });
  });
  it("selection marks: handles at a series' bars, a frame around the legend", () => {
    const m = selectionMarks(scene, { type: "series", series: 1 });
    expect(m.handles).toHaveLength(3 * 4);
    expect(m.frames).toHaveLength(0);
    const l = selectionMarks(scene, { type: "legend" });
    expect(l.frames).toHaveLength(1);
    expect(elementBounds(scene, { type: "title" })!.w).toBeGreaterThan(20);
  });
});

describe("sceneToSvg", () => {
  it("emits shapes, escaped text and clip paths", () => {
    const chart = chartOf({ type: "line", grouping: "standard", markers: true });
    const scene = layoutChart(chart, { ...DATA, title: "A < B" }, W, H);
    const svg = sceneToSvg(scene, undefined, "t-");
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("A &lt; B");
    expect(svg).toContain('clip-path="url(#t-0)"');
    expect(svg).toContain('<clipPath id="t-0">');
    expect((svg.match(/<path/g) ?? []).length).toBeGreaterThan(5);
  });
});

describe("layout options for hosts", () => {
  it("area fill / border and the text colour can be set (Show: transparent, theme text)", () => {
    const chart = chartOf({ type: "bar", direction: "column", grouping: "clustered" });
    const plain = layoutChart(chart, DATA, W, H);
    const area = plain.items[0]!;
    expect(area.t === "rect" && area.fill).toBe("#FFFFFF");
    const show = layoutChart(chart, DATA, W, H, { area: { fill: null, border: null }, textColor: "#F2F2F2" });
    const a = show.items[0]!;
    expect(a.t === "rect" && a.fill === undefined && a.stroke === undefined).toBe(true);
    const texts = show.items.filter((it) => it.t === "text");
    expect(texts.length).toBeGreaterThan(0);
    expect(texts.every((it) => it.t === "text" && it.color === "#F2F2F2")).toBe(true);
  });
});
