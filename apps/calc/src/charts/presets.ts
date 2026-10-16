// Chart types, layouts, colours and styles (pure): the Insert › Charts
// galleries with Excel's sub-types, Change Chart Type, Quick Layout,
// Change Colors and the Chart Styles gallery, all as Chart → Chart edits.

import type { Axis } from "../generated/Axis";
import type { Chart } from "../generated/Chart";
import type { ChartKind } from "../generated/ChartKind";
import type { DataLabels } from "../generated/DataLabels";
import type { LabelPosition } from "../generated/LabelPosition";
import type { Series } from "../generated/Series";
import { paletteColor, resolveColor } from "@rusuite/ui-shared";
import type { Color } from "../../../../packages/ui-shared/src/generated/Color";

export type ChartGroup = "column" | "bar" | "line" | "area" | "pie" | "scatter" | "combo";

export interface ChartPreset {
  id: string;
  group: ChartGroup;
  /** i18n key of the sub-type name. */
  label: string;
  kind: ChartKind;
  /** Combo presets: per-series kinds (last entry repeats). */
  combo?: { kinds: ChartKind[]; secondaryLast?: boolean };
}

const col = (grouping: "clustered" | "stacked" | "percentStacked"): ChartKind => ({ type: "bar", direction: "column", grouping });
const bar = (grouping: "clustered" | "stacked" | "percentStacked"): ChartKind => ({ type: "bar", direction: "bar", grouping });
const line = (grouping: "standard" | "stacked" | "percentStacked", markers: boolean): ChartKind => ({ type: "line", grouping, markers });

export const CHART_PRESETS: ChartPreset[] = [
  { id: "colClustered", group: "column", label: "calc.chart.t.colClustered", kind: col("clustered") },
  { id: "colStacked", group: "column", label: "calc.chart.t.colStacked", kind: col("stacked") },
  { id: "colPercent", group: "column", label: "calc.chart.t.colPercent", kind: col("percentStacked") },
  { id: "barClustered", group: "bar", label: "calc.chart.t.barClustered", kind: bar("clustered") },
  { id: "barStacked", group: "bar", label: "calc.chart.t.barStacked", kind: bar("stacked") },
  { id: "barPercent", group: "bar", label: "calc.chart.t.barPercent", kind: bar("percentStacked") },
  { id: "line", group: "line", label: "calc.chart.t.line", kind: line("standard", false) },
  { id: "lineStacked", group: "line", label: "calc.chart.t.lineStacked", kind: line("stacked", false) },
  { id: "linePercent", group: "line", label: "calc.chart.t.linePercent", kind: line("percentStacked", false) },
  { id: "lineMarkers", group: "line", label: "calc.chart.t.lineMarkers", kind: line("standard", true) },
  { id: "lineStackedMarkers", group: "line", label: "calc.chart.t.lineStackedMarkers", kind: line("stacked", true) },
  { id: "linePercentMarkers", group: "line", label: "calc.chart.t.linePercentMarkers", kind: line("percentStacked", true) },
  { id: "area", group: "area", label: "calc.chart.t.area", kind: { type: "area", grouping: "standard" } },
  { id: "areaStacked", group: "area", label: "calc.chart.t.areaStacked", kind: { type: "area", grouping: "stacked" } },
  { id: "areaPercent", group: "area", label: "calc.chart.t.areaPercent", kind: { type: "area", grouping: "percentStacked" } },
  { id: "pie", group: "pie", label: "calc.chart.t.pie", kind: { type: "pie" } },
  { id: "doughnut", group: "pie", label: "calc.chart.t.doughnut", kind: { type: "doughnut" } },
  { id: "scatter", group: "scatter", label: "calc.chart.t.scatter", kind: { type: "scatter", style: "marker" } },
  { id: "scatterSmoothMarkers", group: "scatter", label: "calc.chart.t.scatterSmoothMarkers", kind: { type: "scatter", style: "smoothMarker" } },
  { id: "scatterSmooth", group: "scatter", label: "calc.chart.t.scatterSmooth", kind: { type: "scatter", style: "smooth" } },
  { id: "scatterLineMarkers", group: "scatter", label: "calc.chart.t.scatterLineMarkers", kind: { type: "scatter", style: "lineMarker" } },
  { id: "scatterLine", group: "scatter", label: "calc.chart.t.scatterLine", kind: { type: "scatter", style: "line" } },
  { id: "comboColLine", group: "combo", label: "calc.chart.t.comboColLine", kind: { type: "combo" }, combo: { kinds: [col("clustered"), line("standard", false)] } },
  {
    id: "comboColLineSecondary", group: "combo", label: "calc.chart.t.comboColLineSecondary", kind: { type: "combo" },
    combo: { kinds: [col("clustered"), line("standard", false)], secondaryLast: true },
  },
  { id: "comboAreaCol", group: "combo", label: "calc.chart.t.comboAreaCol", kind: { type: "combo" }, combo: { kinds: [{ type: "area", grouping: "stacked" }, col("clustered")] } },
];

export const presetById = (id: string) => CHART_PRESETS.find((p) => p.id === id);
export const presetsOf = (...groups: ChartGroup[]) => CHART_PRESETS.filter((p) => groups.includes(p.group));

/** The Insert › Charts dropdowns and the groups they list. */
export const INSERT_GALLERIES: { id: string; label: string; groups: ChartGroup[] }[] = [
  { id: "columnBar", label: "calc.chart.g.columnBar", groups: ["column", "bar"] },
  { id: "lineArea", label: "calc.chart.g.lineArea", groups: ["line", "area"] },
  { id: "pie", label: "calc.chart.g.pie", groups: ["pie"] },
  { id: "scatter", label: "calc.chart.g.scatter", groups: ["scatter"] },
  { id: "combo", label: "calc.chart.g.combo", groups: ["combo"] },
];

/** Change Chart Type: the type list on the left. */
export const TYPE_GROUPS: { id: ChartGroup; label: string }[] = [
  { id: "column", label: "calc.chart.group.column" },
  { id: "line", label: "calc.chart.group.line" },
  { id: "pie", label: "calc.chart.group.pie" },
  { id: "bar", label: "calc.chart.group.bar" },
  { id: "area", label: "calc.chart.group.area" },
  { id: "scatter", label: "calc.chart.group.scatter" },
  { id: "combo", label: "calc.chart.group.combo" },
];

/** The preset a chart matches (`null`: none, e.g. unsupported or a hand-made combo). */
export function presetOf(chart: Chart): ChartPreset | null {
  const k = chart.kind;
  if (k.type === "combo") {
    const n = chart.series.length;
    return (
      CHART_PRESETS.find((p) => {
        const c = p.combo;
        if (!c || n === 0) return false;
        return chart.series.every((s, i) => {
          const last = n > 1 && i === n - 1;
          const want = last ? c.kinds[c.kinds.length - 1]! : c.kinds[0]!;
          return canon(s.kind ?? null) === canon(want) && (s.axis === "secondary") === (!!c.secondaryLast && last);
        });
      }) ?? null
    );
  }
  return CHART_PRESETS.find((p) => !p.combo && canon(p.kind) === canon(k)) ?? null;
}

/** JSON with sorted keys (structural comparison). */
export function canon(v: unknown): string {
  return JSON.stringify(v, (_, x: unknown) =>
    x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) : x,
  );
}

/** The group of a chart's kind (Change Chart Type opens on it). */
export function groupOf(chart: Chart): ChartGroup {
  const k = chart.kind;
  if (k.type === "bar") return k.direction === "bar" ? "bar" : "column";
  if (k.type === "doughnut") return "pie";
  if (k.type === "unsupported") return "column";
  return k.type;
}

const isPie = (k: ChartKind) => k.type === "pie" || k.type === "doughnut";
const isBars = (k: ChartKind) => k.type === "bar";
const stackedBars = (k: ChartKind) => k.type === "bar" && k.grouping !== "clustered";

const VALUE_AXIS: Axis = { majorGridlines: true };

/**
 * A chart of `preset`'s type built from `base` (a recommended chart, or the
 * chart being changed): kind, per-kind defaults (Office 2013+), combo
 * series kinds, scatter X values.
 */
export function applyPreset(base: Chart, preset: ChartPreset): Chart {
  const out: Chart = { ...base, kind: preset.kind, series: base.series.map((s) => ({ ...s })) };
  delete out.gapWidth;
  delete out.overlap;
  delete out.holeSize;
  delete out.firstSliceAngle;
  delete out.varyColors;
  for (const s of out.series) {
    delete s.kind;
    if (!preset.combo) delete s.axis;
  }
  const k = preset.kind;
  if (isBars(k)) {
    if (stackedBars(k)) {
      out.gapWidth = 150;
      out.overlap = 100;
    } else {
      out.gapWidth = 219;
      out.overlap = -27;
    }
  }
  if (isPie(k)) {
    out.varyColors = true;
    if (k.type === "doughnut") out.holeSize = 75;
    if (!out.legend) out.legend = { position: "bottom" };
    if (!out.title) out.title = {};
  }
  if (!isPie(k) && !out.axes.val.majorGridlines && isPie(base.kind)) out.axes = { ...out.axes, val: { ...out.axes.val, ...VALUE_AXIS } };
  if (k.type === "scatter" && base.kind.type !== "scatter" && !base.categories && out.series.length >= 2 && out.series.every((s) => !s.categories)) {
    // No category labels: the first column is the X values (Excel).
    out.categories = out.series[0]!.values;
    out.series = out.series.slice(1);
  }
  if (preset.combo) {
    const kinds = preset.combo.kinds;
    const n = out.series.length;
    out.series = out.series.map((s, i) => {
      const kind = n > 1 && i === n - 1 ? kinds[kinds.length - 1]! : kinds[0]!;
      const secondary = preset.combo!.secondaryLast && n > 1 && i === n - 1;
      const next: Series = { ...s, kind };
      if (secondary) next.axis = "secondary";
      else delete next.axis;
      return next;
    });
    if (out.series.some((s) => s.kind?.type === "bar")) {
      out.gapWidth = 219;
      out.overlap = -27;
    }
    if (preset.combo.secondaryLast && n > 1) out.axes = { ...out.axes, secondVal: out.axes.secondVal ?? { crosses: { type: "max" } } };
    else if (!out.series.some((s) => s.axis === "secondary")) {
      const { secondVal: _, ...rest } = out.axes;
      out.axes = rest as Chart["axes"];
    }
  } else if (out.axes.secondVal) {
    const { secondVal: _, ...rest } = out.axes;
    out.axes = rest as Chart["axes"];
  }
  if (out.dataLabels?.position) out.dataLabels = { ...out.dataLabels, position: fitLabelPosition(k, out.dataLabels.position) };
  return out;
}

/** A label position that the kind supports (Excel offers different ones per type). */
export function fitLabelPosition(k: ChartKind, p: LabelPosition): LabelPosition {
  const allowed = labelPositions(k);
  return allowed.includes(p) ? p : allowed[0]!;
}

/** Data label positions per kind (first = default). */
export function labelPositions(k: ChartKind): LabelPosition[] {
  switch (k.type) {
    case "bar":
      return k.grouping === "clustered" ? ["outsideEnd", "center", "insideEnd", "insideBase"] : ["center", "insideEnd", "insideBase"];
    case "pie":
      return ["bestFit", "center", "insideEnd", "outsideEnd"];
    case "doughnut":
    case "area":
      return ["center"];
    case "line":
    case "scatter":
      return ["right", "center", "left", "top", "bottom"];
    default:
      return ["outsideEnd", "center", "insideEnd", "insideBase", "right", "top"];
  }
}

// --- Add Chart Element ---------------------------------------------------------------------------

export type ElementOp =
  | { el: "axis"; axis: "cat" | "val"; on: boolean }
  | { el: "axisTitle"; axis: "cat" | "val"; on: boolean }
  | { el: "chartTitle"; mode: "none" | "above" | "overlay" }
  | { el: "dataLabels"; position: LabelPosition | "none" }
  | { el: "gridlines"; axis: "cat" | "val"; minor: boolean; on: boolean }
  | { el: "legend"; position: "none" | "right" | "top" | "left" | "bottom" }
  | { el: "trendline"; kind: "none" | "linear" | "exponential" | "movingAverage"; series?: number };

/** Applies one Add Chart Element choice. */
export function applyElement(chart: Chart, op: ElementOp): Chart {
  const out: Chart = { ...chart, axes: { ...chart.axes, cat: { ...chart.axes.cat }, val: { ...chart.axes.val } } };
  switch (op.el) {
    case "axis":
      if (op.on) delete out.axes[op.axis].delete;
      else out.axes[op.axis].delete = true;
      return out;
    case "axisTitle":
      if (op.on) out.axes[op.axis].title = out.axes[op.axis].title ?? {};
      else delete out.axes[op.axis].title;
      return out;
    case "chartTitle":
      if (op.mode === "none") delete out.title;
      else out.title = { ...(chart.title ?? {}), ...(op.mode === "overlay" ? { overlay: true } : {}) };
      if (op.mode === "above" && out.title) delete out.title.overlay;
      return out;
    case "dataLabels":
      out.series = chart.series.map((s) => {
        const { dataLabels: _, ...rest } = s;
        return rest;
      });
      if (op.position === "none") delete out.dataLabels;
      else {
        const pie = isPie(chart.kind);
        const base: DataLabels = chart.dataLabels ?? (pie ? { showValue: true } : { showValue: true });
        out.dataLabels = { ...base, position: op.position };
        if (!base.showValue && !base.showPercent && !base.showCategory && !base.showSeries) out.dataLabels.showValue = true;
      }
      return out;
    case "gridlines": {
      const key = op.minor ? "minorGridlines" : "majorGridlines";
      if (op.on) out.axes[op.axis][key] = true;
      else delete out.axes[op.axis][key];
      return out;
    }
    case "legend":
      if (op.position === "none") delete out.legend;
      else out.legend = { ...(chart.legend ?? {}), position: op.position };
      return out;
    case "trendline": {
      const targets = op.series !== undefined ? [op.series] : chart.series.map((_, i) => i).slice(0, 1);
      out.series = chart.series.map((s, i) => {
        if (!targets.includes(i)) return s;
        if (op.kind === "none") {
          const { trendline: _, ...rest } = s;
          return rest;
        }
        return { ...s, trendline: { kind: op.kind === "movingAverage" ? { type: "movingAverage", period: 2 } : { type: op.kind } } };
      });
      return out;
    }
  }
}

/** Whether a toggle-like element is currently on (menus show the check). */
export function elementState(chart: Chart): {
  axes: Record<"cat" | "val", boolean>;
  axisTitles: Record<"cat" | "val", boolean>;
  title: "none" | "above" | "overlay";
  labels: LabelPosition | "none";
  grid: Record<"catMajor" | "valMajor" | "catMinor" | "valMinor", boolean>;
  legend: "none" | "right" | "top" | "left" | "bottom" | "topRight";
  trendline: boolean;
} {
  const a = chart.axes;
  const dl = chart.dataLabels;
  return {
    axes: { cat: !a.cat.delete, val: !a.val.delete },
    axisTitles: { cat: !!a.cat.title, val: !!a.val.title },
    title: !chart.title ? "none" : chart.title.overlay ? "overlay" : "above",
    labels: dl && (dl.showValue || dl.showPercent || dl.showCategory || dl.showSeries) ? (dl.position ?? labelPositions(chart.kind)[0]!) : "none",
    grid: { catMajor: !!a.cat.majorGridlines, valMajor: !!a.val.majorGridlines, catMinor: !!a.cat.minorGridlines, valMinor: !!a.val.minorGridlines },
    legend: chart.legend?.position ?? "none",
    trendline: chart.series.some((s) => s.trendline),
  };
}

// --- Quick Layout ----------------------------------------------------------------------------------

/** Excel-like quick layouts (title, legend, labels, axis titles, gridlines). */
export const QUICK_LAYOUTS: { id: string; ops: ElementOp[] }[] = [
  { id: "1", ops: [{ el: "chartTitle", mode: "above" }, { el: "legend", position: "right" }, { el: "dataLabels", position: "none" }, { el: "gridlines", axis: "val", minor: false, on: true }] },
  {
    id: "2",
    ops: [{ el: "chartTitle", mode: "above" }, { el: "legend", position: "top" }, { el: "dataLabels", position: "outsideEnd" }, { el: "gridlines", axis: "val", minor: false, on: false }, { el: "axis", axis: "val", on: false }],
  },
  { id: "3", ops: [{ el: "chartTitle", mode: "above" }, { el: "legend", position: "bottom" }, { el: "dataLabels", position: "none" }, { el: "gridlines", axis: "val", minor: false, on: true }] },
  { id: "4", ops: [{ el: "chartTitle", mode: "none" }, { el: "legend", position: "bottom" }, { el: "dataLabels", position: "outsideEnd" }, { el: "gridlines", axis: "val", minor: false, on: false }] },
  {
    id: "5",
    ops: [{ el: "chartTitle", mode: "above" }, { el: "legend", position: "none" }, { el: "axisTitle", axis: "val", on: true }, { el: "gridlines", axis: "val", minor: false, on: true }],
  },
  {
    id: "6",
    ops: [{ el: "chartTitle", mode: "above" }, { el: "legend", position: "none" }, { el: "axisTitle", axis: "val", on: true }, { el: "dataLabels", position: "outsideEnd" }],
  },
  {
    id: "7",
    ops: [
      { el: "chartTitle", mode: "none" }, { el: "legend", position: "right" }, { el: "axisTitle", axis: "val", on: true }, { el: "axisTitle", axis: "cat", on: true },
      { el: "gridlines", axis: "val", minor: true, on: true },
    ],
  },
  {
    id: "8",
    ops: [{ el: "chartTitle", mode: "above" }, { el: "legend", position: "none" }, { el: "axisTitle", axis: "val", on: true }, { el: "axisTitle", axis: "cat", on: true }],
  },
];

export function applyQuickLayout(chart: Chart, id: string): Chart {
  const layout = QUICK_LAYOUTS.find((l) => l.id === id);
  if (!layout) return chart;
  let out = chart;
  for (const op of layout.ops) {
    if (op.el === "dataLabels" && op.position !== "none") out = applyElement(out, { el: "dataLabels", position: fitLabelPosition(chart.kind, op.position) });
    else out = applyElement(out, op);
  }
  if (out.dataLabels?.position === undefined || isPie(chart.kind)) return out;
  return out;
}

// --- Change Colors ---------------------------------------------------------------------------------

export interface ColorVariant {
  id: string;
  label: string;
  /** Chart `style` carrying the colour rule. */
  style: number;
  /** Explicit accent order (colourful 2–4: series fills). */
  accents?: number[];
}

export const COLOR_VARIANTS: ColorVariant[] = [
  { id: "colorful1", label: "calc.chart.colors.colorful1", style: 2 },
  { id: "colorful2", label: "calc.chart.colors.colorful2", style: 2, accents: [2, 4, 6, 1, 3, 5] },
  { id: "colorful3", label: "calc.chart.colors.colorful3", style: 2, accents: [3, 5, 1, 2, 4, 6] },
  { id: "colorful4", label: "calc.chart.colors.colorful4", style: 2, accents: [6, 5, 4, 3, 2, 1] },
  ...[1, 2, 3, 4, 5, 6].map((a) => ({ id: `mono${a}`, label: `calc.chart.colors.mono${a}`, style: a + 2 })),
  { id: "gray", label: "calc.chart.colors.gray", style: 1 },
];

/** Six swatches of a colour variant (the Change Colors list). */
export function resolveSwatches(variantId: string): string[] {
  const v = COLOR_VARIANTS.find((c) => c.id === variantId);
  if (!v) return [];
  if (v.accents) return v.accents.map((a) => resolveColor(accentColor(a)));
  return Array.from({ length: 6 }, (_, i) => resolveColor(paletteColor(v.style, i, 6)));
}

const accentColor = (a: number): Color => ({ kind: "theme", value: { slot: `accent${a}` as "accent1", tint: 0 } });

/** Applies a colour variant: the style's colour rule, or explicit accents per series (per point for vary-coloured pies). */
export function applyColors(chart: Chart, variantId: string, points = 0): Chart {
  const v = COLOR_VARIANTS.find((c) => c.id === variantId);
  if (!v) return chart;
  const vary = isPie(chart.kind) && (chart.varyColors ?? false);
  const strip = (s: Series): Series => {
    const { fill: _f, dataPoints: _d, ...rest } = s;
    const out: Series = { ...rest };
    if (s.line) {
      const { color: _c, ...line } = s.line;
      if (Object.keys(line).length) out.line = line;
      else delete out.line;
    }
    if (s.marker) {
      const { fill: _m, line: _l, ...marker } = s.marker;
      out.marker = marker;
    }
    return out;
  };
  const series = chart.series.map((s, i) => {
    const out = strip(s);
    if (!v.accents) return out;
    if (vary) {
      out.dataPoints = Array.from({ length: points }, (_, idx) => ({ idx, fill: { type: "solid" as const, color: accentColor(v.accents![idx % v.accents!.length]!) } }));
      return out;
    }
    const color = accentColor(v.accents[i % v.accents.length]!);
    const kind = chart.kind.type === "combo" ? (s.kind ?? chart.kind) : chart.kind;
    if (kind.type === "line" || kind.type === "scatter") {
      out.line = { ...(out.line ?? {}), color };
      if (s.marker?.symbol !== "none") out.marker = { ...(out.marker ?? { symbol: "auto" }), fill: { type: "solid", color }, line: { color } };
    } else out.fill = { type: "solid", color };
    return out;
  });
  return { ...chart, style: v.style, series };
}

/** The variant matching a chart (for the gallery's selection). */
export function colorsOf(chart: Chart): string | null {
  const style = chart.style ?? 2;
  const custom = chart.series.some((s) => s.fill || s.line?.color || s.dataPoints?.length);
  if (!custom) return COLOR_VARIANTS.find((v) => !v.accents && v.style === style)?.id ?? null;
  return null;
}

// --- Chart Styles ----------------------------------------------------------------------------------

/** Eight chart styles: labels, gridlines, bar widths, markers – what the model can carry. */
export const CHART_STYLES = [1, 2, 3, 4, 5, 6, 7, 8];

export function applyChartStyle(chart: Chart, n: number): Chart {
  const k = chart.kind;
  let out: Chart = { ...chart, axes: { ...chart.axes, cat: { ...chart.axes.cat }, val: { ...chart.axes.val } } };
  const bars = k.type === "bar" || (k.type === "combo" && chart.series.some((s) => s.kind?.type === "bar"));
  const stackedK = k.type === "bar" && k.grouping !== "clustered";
  const set = (o: Partial<Chart>) => (out = { ...out, ...o });
  const grid = (val: boolean, cat = false, minor = false) => {
    out.axes.val.majorGridlines = val || undefined;
    out.axes.cat.majorGridlines = cat || undefined;
    out.axes.val.minorGridlines = minor || undefined;
    for (const a of [out.axes.val, out.axes.cat]) for (const key of ["majorGridlines", "minorGridlines"] as const) if (!a[key]) delete a[key];
  };
  const labels = (position: LabelPosition | null) => {
    out = applyElement(out, { el: "dataLabels", position: position === null ? "none" : fitLabelPosition(k, position) });
  };
  const barWidth = (gap: number, overlap: number) => {
    if (!bars) return;
    set({ gapWidth: gap, overlap: stackedK ? 100 : overlap });
  };
  const markers = (on: boolean) => {
    if (k.type === "line") set({ kind: { ...k, markers: on } });
  };
  delete out.axes.val.delete;
  switch (n) {
    case 1:
      grid(true);
      labels(null);
      barWidth(219, -27);
      markers(k.type === "line" ? k.markers : false);
      break;
    case 2:
      grid(false);
      labels("insideEnd");
      barWidth(50, 0);
      out.axes.val.delete = true;
      markers(true);
      break;
    case 3:
      grid(true, false, true);
      labels(null);
      barWidth(100, 0);
      markers(false);
      break;
    case 4:
      grid(false);
      labels("outsideEnd");
      barWidth(150, 0);
      markers(true);
      break;
    case 5:
      grid(true, true);
      labels(null);
      barWidth(80, -10);
      markers(true);
      break;
    case 6:
      grid(true);
      labels(null);
      barWidth(300, 0);
      markers(false);
      break;
    case 7:
      grid(true, false, true);
      labels(null);
      barWidth(60, 20);
      markers(true);
      out.legend = out.legend ? { ...out.legend, position: "top" } : out.legend;
      break;
    case 8:
      grid(false);
      labels("center");
      barWidth(30, 0);
      markers(false);
      out.legend = out.legend ? { ...out.legend, position: "right" } : out.legend;
      break;
  }
  if (isPie(k)) {
    delete out.gapWidth;
    delete out.overlap;
  }
  return out;
}
