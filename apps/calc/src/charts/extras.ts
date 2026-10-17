// Calc's chart edits of P9-C6 (pure): Add Chart Element › Data Table, Error
// Bars, Lines and Up/Down Bars; the Format pane's chart area / plot area /
// text / error bar / label edits; Calc's Chart Styles with chart area fills
// and effects; the series formula of the formula bar (`=SERIES(…)`).

import type { AreaFill } from "../generated/AreaFill";
import type { Chart } from "../generated/Chart";
import type { Color } from "../../../../packages/ui-shared/src/generated/Color";
import type { DataLabels } from "../generated/DataLabels";
import type { DataRef } from "../generated/DataRef";
import type { ErrorBars } from "../generated/ErrorBars";
import type { PointLabel } from "../generated/PointLabel";
import type { Series } from "../generated/Series";
import type { ShapeFormat } from "../generated/ShapeFormat";
import type { TextFormat } from "../generated/TextFormat";
import type { TextSource } from "../generated/TextSource";
import { applyChartStyle as sharedChartStyle } from "../../../../packages/ui-shared/src/chart/ui/presets";

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const isLine = (c: Chart) => c.kind.type === "line" || (c.kind.type === "combo" && c.series.some((s) => s.kind?.type === "line"));
const pie = (c: Chart) => c.kind.type === "pie" || c.kind.type === "doughnut";

// --- Add Chart Element ---------------------------------------------------------------------------

export type ErrorBarChoice = "none" | "stdErr" | "percentage" | "stdDev";

/** Error Bars ▸ None / Standard Error / Percentage (5 %) / Standard Deviation (1): on `series`, else on every series. */
export function applyErrorBars(chart: Chart, choice: ErrorBarChoice, series?: number): Chart {
  const amount: ErrorBars["amount"] | null =
    choice === "stdErr" ? { type: "stdErr" } : choice === "percentage" ? { type: "percentage", value: 5 } : choice === "stdDev" ? { type: "stdDev", value: 1 } : null;
  const scatter = chart.kind.type === "scatter";
  return {
    ...chart,
    series: chart.series.map((s, i) => {
      if (series !== undefined && i !== series) return s;
      const out = { ...s };
      if (!amount) delete out.errorBars;
      else out.errorBars = scatter ? [{ direction: "x", amount }, { amount }] : [{ amount }];
      return out;
    }),
  };
}

/** The error bar choice of a chart (for the menu's check marks). */
export function errorBarChoice(chart: Chart): ErrorBarChoice {
  const e = chart.series.find((s) => s.errorBars?.length)?.errorBars?.find((x) => (x.direction ?? "y") === "y");
  if (!e) return "none";
  if (e.amount.type === "stdErr") return "stdErr";
  if (e.amount.type === "percentage") return "percentage";
  if (e.amount.type === "stdDev") return "stdDev";
  return "none";
}

/** Data Table ▸ None / With Legend Keys / No Legend Keys (not for pies, scatter or horizontal bars). */
export function applyDataTable(chart: Chart, mode: "none" | "keys" | "noKeys"): Chart {
  const out = { ...chart };
  if (mode === "none") delete out.dataTable;
  else out.dataTable = { ...(chart.dataTable ?? {}), keys: mode === "keys" || undefined };
  return clone(out);
}

/** Lines ▸ None / High-Low Lines; Up/Down Bars ▸ None / Up/Down Bars (line charts). */
export function applyLineExtras(chart: Chart, op: { highLow?: boolean; upDown?: boolean }): Chart {
  const out = { ...chart };
  if (op.highLow !== undefined) {
    if (op.highLow) out.highLowLines = chart.highLowLines ?? {};
    else delete out.highLowLines;
  }
  if (op.upDown !== undefined) {
    if (op.upDown) out.upDownBars = chart.upDownBars ?? { gapWidth: 150 };
    else delete out.upDownBars;
  }
  return out;
}

export const canHaveLineExtras = isLine;
export const canHaveDataTable = (c: Chart) => !pie(c) && c.kind.type !== "scatter" && !(c.kind.type === "bar" && c.kind.direction === "bar");

// --- Format pane edits ---------------------------------------------------------------------------

/** A shape format with `patch` merged (`undefined` fields removed; an empty format becomes absent). */
export function mergeShape(old: ShapeFormat | undefined, patch: Partial<ShapeFormat>): ShapeFormat | undefined {
  const next: ShapeFormat = { ...(old ?? {}), ...patch };
  for (const k of Object.keys(next) as (keyof ShapeFormat)[]) if (next[k] === undefined || next[k] === false) delete next[k];
  return Object.keys(next).length ? next : undefined;
}

export function setChartArea(chart: Chart, patch: Partial<ShapeFormat>): Chart {
  const out = { ...chart, chartArea: mergeShape(chart.chartArea, patch) };
  if (!out.chartArea) delete out.chartArea;
  return out;
}

export function setPlotArea(chart: Chart, patch: Partial<ShapeFormat>): Chart {
  const out = { ...chart, plotArea: mergeShape(chart.plotArea, patch) };
  if (!out.plotArea) delete out.plotArea;
  return out;
}

/** A two-stop linear gradient (the Format pane's gradient fill). */
export function gradientFill(from: Color, to: Color, angle: number): AreaFill {
  return { type: "gradient", stops: [{ pos: 0, color: from }, { pos: 1, color: to }], angle: ((Math.round(angle) % 360) + 360) % 360 };
}

export function mergeText(old: TextFormat | undefined, patch: Partial<TextFormat>): TextFormat | undefined {
  const next: TextFormat = { ...(old ?? {}), ...patch };
  for (const k of Object.keys(next) as (keyof TextFormat)[]) if (next[k] === undefined) delete next[k];
  return Object.keys(next).length ? next : undefined;
}

/** Where a text format lives for each text element of the Format pane. */
export type TextTarget = { el: "chart" } | { el: "title" } | { el: "legend" } | { el: "axis"; axis: "cat" | "val" | "secondVal" } | { el: "axisTitle"; axis: "cat" | "val" | "secondVal" } | { el: "labels"; series?: number } | { el: "dataTable" };

export function textFormatOf(chart: Chart, target: TextTarget): TextFormat | undefined {
  switch (target.el) {
    case "chart":
      return chart.textFormat;
    case "title":
      return chart.title?.textFormat;
    case "legend":
      return chart.legendTextFormat;
    case "axis":
      return chart.axes[target.axis]?.textFormat;
    case "axisTitle":
      return chart.axes[target.axis]?.title?.textFormat;
    case "labels":
      return (target.series !== undefined ? chart.series[target.series]?.dataLabels : undefined)?.textFormat ?? chart.dataLabels?.textFormat;
    case "dataTable":
      return chart.dataTable?.textFormat;
  }
}

export function setTextFormat(chart: Chart, target: TextTarget, patch: Partial<TextFormat>): Chart {
  const out = clone(chart);
  const merged = mergeText(textFormatOf(chart, target), patch);
  const put = <T extends { textFormat?: TextFormat }>(o: T): T => {
    const x = { ...o };
    if (merged) x.textFormat = merged;
    else delete x.textFormat;
    return x;
  };
  switch (target.el) {
    case "chart":
      return put(out);
    case "title":
      out.title = put(out.title ?? {});
      return out;
    case "legend":
      if (merged) out.legendTextFormat = merged;
      else delete out.legendTextFormat;
      return out;
    case "axis":
      out.axes = { ...out.axes, [target.axis]: put(out.axes[target.axis] ?? {}) };
      return out;
    case "axisTitle": {
      const a = out.axes[target.axis] ?? {};
      out.axes = { ...out.axes, [target.axis]: { ...a, title: put(a.title ?? {}) } };
      return out;
    }
    case "labels":
      if (target.series !== undefined && out.series[target.series]) {
        const s = out.series[target.series]!;
        s.dataLabels = put(s.dataLabels ?? clone(chart.dataLabels ?? {}));
      } else out.dataLabels = put(out.dataLabels ?? {});
      return out;
    case "dataTable":
      out.dataTable = put(out.dataTable ?? {});
      return out;
  }
}

/** Replaces the Y (or X) error bars of series `i` (`null` = none in that direction). */
export function setErrorBars(chart: Chart, i: number, direction: "x" | "y", bars: ErrorBars | null): Chart {
  return {
    ...chart,
    series: chart.series.map((s, k) => {
      if (k !== i) return s;
      const rest = (s.errorBars ?? []).filter((e) => (e.direction ?? "y") !== direction);
      const list = bars ? [...rest, { ...bars, ...(direction === "x" ? { direction: "x" as const } : {}) }] : rest;
      const out = { ...s };
      if (list.length) out.errorBars = list;
      else delete out.errorBars;
      return out;
    }),
  };
}

/** The data labels of series `i` (its own, else the chart's) with `patch`. */
export function patchSeriesLabels(chart: Chart, i: number, patch: Partial<DataLabels>): Chart {
  return {
    ...chart,
    series: chart.series.map((s, k) => {
      if (k !== i) return s;
      const d: DataLabels = { ...(s.dataLabels ?? chart.dataLabels ?? {}), ...patch };
      for (const key of Object.keys(d) as (keyof DataLabels)[]) if (d[key] === undefined || d[key] === false) delete d[key];
      return { ...s, dataLabels: d };
    }),
  };
}

/** The label of point `idx` of series `i` (`null` = back to the series' labels); `{ delete: true }` hides it. */
export function setPointLabel(chart: Chart, i: number, idx: number, label: Omit<PointLabel, "idx"> | null): Chart {
  return {
    ...chart,
    series: chart.series.map((s, k) => {
      if (k !== i) return s;
      const d: DataLabels = { ...(s.dataLabels ?? chart.dataLabels ?? {}) };
      const points = (d.points ?? []).filter((p) => p.idx !== idx);
      if (label) points.push({ idx, ...label });
      points.sort((a, b) => a.idx - b.idx);
      if (points.length) d.points = points;
      else delete d.points;
      return { ...s, dataLabels: d };
    }),
  };
}

// --- Chart Styles (Calc): the shared styles plus Excel's area fills and effects -------------------

const WHITE: Color = { kind: "rgb", value: "FFFFFF" };
const tx = (tint: number): Color => ({ kind: "theme", value: { slot: "dark1", tint } });
const bg = (tint: number): Color => ({ kind: "theme", value: { slot: "light1", tint } });

/**
 * Chart Styles 1–8 with what Excel's styles add beyond labels, gridlines and widths: style 3 a grey plot area,
 * 4 a shadow, 5 a light grey plot area with a border, 6 a white-to-grey gradient, 7 a dark chart area with white
 * text, 8 a black one with rounded corners.
 */
export function applyChartStyle(chart: Chart, n: number): Chart {
  const out: Chart = { ...sharedChartStyle(chart, n) };
  delete out.chartArea;
  delete out.plotArea;
  delete out.roundedCorners;
  if (out.textFormat) {
    const { color: _c, ...rest } = out.textFormat;
    if (Object.keys(rest).length) out.textFormat = rest;
    else delete out.textFormat;
  }
  const text = (color: Color) => (out.textFormat = { ...(out.textFormat ?? {}), color });
  switch (n) {
    case 3:
      out.plotArea = { fill: { type: "solid", color: bg(-0.05) } };
      break;
    case 4:
      out.chartArea = { shadow: true };
      break;
    case 5:
      out.plotArea = { fill: { type: "solid", color: bg(-0.15) }, line: { color: tx(0.75) } };
      break;
    case 6:
      out.chartArea = { fill: gradientFill(WHITE, bg(-0.15), 90), line: { none: true } };
      break;
    case 7:
      out.chartArea = { fill: { type: "solid", color: tx(0.25) }, line: { none: true } };
      text(WHITE);
      break;
    case 8:
      out.chartArea = { fill: { type: "solid", color: tx(0) }, line: { none: true } };
      out.roundedCorners = true;
      text(WHITE);
      break;
  }
  return out;
}

// --- the series formula (formula bar) -------------------------------------------------------------

const refText = (r: DataRef | undefined) => (!r ? "" : r.type === "ref" ? r.formula : `{${r.values.map((v) => (typeof v === "string" ? `"${v.replace(/"/g, '""')}"` : v === null ? "" : String(v))).join(",")}}`);
const nameText = (n: TextSource | undefined) => (!n ? "" : n.type === "ref" ? n.formula : `"${n.text.replace(/"/g, '""')}"`);

/** Excel's `=SERIES(name, categories, values, order)` of series `i` (1-based order). */
export function seriesFormula(chart: Chart, i: number): string {
  const s = chart.series[i];
  if (!s) return "";
  const cats = s.categories ?? chart.categories;
  return `=SERIES(${nameText(s.name)},${refText(cats)},${refText(s.values)},${i + 1})`;
}

/** Splits the arguments of `SERIES(…)` at top-level commas (quotes, braces and parentheses respected). */
function splitArgs(body: string): string[] {
  const out: string[] = [];
  let cur = "";
  let depth = 0;
  let quote: string | null = null;
  for (const ch of body) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(" || ch === "{") depth++;
    else if (ch === ")" || ch === "}") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

const literalValues = (t: string) =>
  t
    .slice(1, -1)
    .split(",")
    .map((x) => {
      const v = x.trim();
      if (v === "") return null;
      if (/^".*"$/.test(v)) return v.slice(1, -1).replace(/""/g, '"');
      const n = Number(v);
      return Number.isFinite(n) ? n : v;
    });

function parseRef(t: string): DataRef | undefined {
  if (!t) return undefined;
  if (t.startsWith("{") && t.endsWith("}")) return { type: "literal", values: literalValues(t) };
  return { type: "ref", formula: t };
}

/**
 * Parses an edited series formula: `=SERIES(name, cats, vals, order)` (name a reference or a quoted text; cats and
 * vals references or `{…}` literals). `null` when it is not a series formula.
 */
export function parseSeriesFormula(text: string): { name?: TextSource; categories?: DataRef; values: DataRef; order: number } | null {
  const m = /^\s*=?\s*SERIES\s*\((.*)\)\s*$/i.exec(text);
  if (!m) return null;
  const args = splitArgs(m[1]!);
  if (args.length < 3 || args.length > 5) return null;
  const [n, c, v, o] = args;
  const values = parseRef(v!);
  if (!values) return null;
  let name: TextSource | undefined;
  if (n) name = /^".*"$/.test(n) ? { type: "literal", text: n.slice(1, -1).replace(/""/g, '"') } : { type: "ref", formula: n };
  const order = o ? Math.round(Number(o)) : NaN;
  return { name, categories: parseRef(c ?? ""), values, order: Number.isFinite(order) && order >= 1 ? order : 0 };
}

/** Applies an edited series formula to series `i` (a new order moves the series); `null` when invalid. */
export function applySeriesFormula(chart: Chart, i: number, text: string): { series: Series[]; categories: DataRef | null } | null {
  const p = parseSeriesFormula(text);
  const s = chart.series[i];
  if (!p || !s) return null;
  const next: Series = { ...s, values: p.values };
  if (p.name) next.name = p.name;
  else delete next.name;
  let categories = chart.categories ?? null;
  // Shared categories stay shared when the formula keeps them; otherwise the series gets its own.
  const shared = chart.categories && JSON.stringify(p.categories) === JSON.stringify(chart.categories);
  if (shared) delete next.categories;
  else if (p.categories) next.categories = p.categories;
  else delete next.categories;
  const list = chart.series.filter((_, k) => k !== i);
  const at = p.order ? Math.min(list.length, p.order - 1) : i;
  list.splice(at, 0, next);
  if (!chart.categories) categories = null;
  return { series: list, categories };
}
