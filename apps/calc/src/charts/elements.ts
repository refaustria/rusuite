// The selectable elements of a chart (Format › Current Selection) and
// their names, oriented like Excel ("Horizontal (Category) Axis").

import { elementKey, type ChartElement } from "@rusuite/ui-shared";
import type { Chart } from "../generated/Chart";
import type { ResolvedChart } from "../generated/ResolvedChart";
import { t } from "../i18n";

const pieLike = (c: Chart) => c.kind.type === "pie" || c.kind.type === "doughnut";
const scatter = (c: Chart) => c.kind.type === "scatter";
/** Horizontal bar charts: categories vertical, values horizontal. */
export const horizontalBars = (c: Chart) =>
  (c.kind.type === "bar" && c.kind.direction === "bar") || (c.kind.type === "combo" && c.series.some((s) => s.kind?.type === "bar" && s.kind.direction === "bar"));

/** The element's display name. */
export function elementName(el: ChartElement | null, chart: Chart, data?: ResolvedChart): string {
  if (!el) return t("calc.chart.el.chartArea");
  const hb = horizontalBars(chart);
  const axisName = (a: "cat" | "val" | "secondVal") => {
    if (a === "secondVal") return t(hb ? "calc.chart.el.secondHorizontalValue" : "calc.chart.el.secondVerticalValue");
    if (scatter(chart)) return t(a === "cat" ? "calc.chart.el.horizontalValue" : "calc.chart.el.verticalValue");
    if (a === "cat") return t(hb ? "calc.chart.el.verticalCategory" : "calc.chart.el.horizontalCategory");
    return t(hb ? "calc.chart.el.horizontalValue" : "calc.chart.el.verticalValue");
  };
  const seriesName = (i: number) => data?.series[i]?.name ?? `${t("calc.chart.series")} ${i + 1}`;
  switch (el.type) {
    case "chartArea":
      return t("calc.chart.el.chartArea");
    case "plotArea":
      return t("calc.chart.el.plotArea");
    case "title":
      return t("calc.chart.el.title");
    case "legend":
      return t("calc.chart.el.legend");
    case "axis":
      return axisName(el.axis);
    case "axisTitle":
      return `${axisName(el.axis)} ${t("calc.chart.el.titleSuffix")}`;
    case "gridlines":
      return `${axisName(el.axis)} ${t(el.minor ? "calc.chart.el.minorGridlines" : "calc.chart.el.majorGridlines")}`;
    case "series":
      return el.point === undefined ? `${t("calc.chart.series")} "${seriesName(el.series)}"` : `${t("calc.chart.series")} "${seriesName(el.series)}" ${t("calc.chart.el.point")} ${el.point + 1}`;
    case "dataLabels":
      return `${t("calc.chart.series")} "${seriesName(el.series)}" ${t("calc.chart.el.dataLabels")}`;
    case "trendline":
      return `${t("calc.chart.series")} "${seriesName(el.series)}" ${t("calc.chart.el.trendline")}`;
    case "errorBars":
      return `${t("calc.chart.series")} "${seriesName(el.series)}" ${t("calc.chart.el.errorBars")}`;
    case "dataTable":
      return t("calc.chart.el.dataTable");
    case "upDownBars":
      return t("calc.chart.el.upDownBars");
    case "highLowLines":
      return t("calc.chart.el.highLowLines");
  }
}

/** Every element present in the chart, in Excel's list order. */
export function chartElements(chart: Chart): ChartElement[] {
  const out: ChartElement[] = [{ type: "chartArea" }];
  const axes = !pieLike(chart);
  if (axes) {
    if (!chart.axes.cat.delete) out.push({ type: "axis", axis: "cat" });
    if (chart.axes.cat.title) out.push({ type: "axisTitle", axis: "cat" });
    if (chart.axes.cat.majorGridlines) out.push({ type: "gridlines", axis: "cat" });
  }
  if (chart.legend) out.push({ type: "legend" });
  out.push({ type: "plotArea" });
  if (chart.title) out.push({ type: "title" });
  if (axes) {
    if (!chart.axes.val.delete) out.push({ type: "axis", axis: "val" });
    if (chart.axes.val.title) out.push({ type: "axisTitle", axis: "val" });
    if (chart.axes.val.majorGridlines) out.push({ type: "gridlines", axis: "val" });
    if (chart.axes.val.minorGridlines) out.push({ type: "gridlines", axis: "val", minor: true });
    if (chart.axes.secondVal && chart.series.some((s) => s.axis === "secondary")) out.push({ type: "axis", axis: "secondVal" });
  }
  chart.series.forEach((s, i) => {
    out.push({ type: "series", series: i });
    if (s.dataLabels || chart.dataLabels) out.push({ type: "dataLabels", series: i });
    if (s.trendline) out.push({ type: "trendline", series: i });
    if (s.errorBars?.length) out.push({ type: "errorBars", series: i });
  });
  if (chart.dataTable) out.push({ type: "dataTable" });
  if (chart.upDownBars) out.push({ type: "upDownBars" });
  if (chart.highLowLines) out.push({ type: "highLowLines" });
  return out;
}

export const elementFromKey = (chart: Chart, key: string): ChartElement | null => chartElements(chart).find((e) => elementKey(e) === key) ?? null;
