// The chart model as the renderer reads it: a structural copy of the
// generated `core_model::chart` mirrors (apps/calc/src/generated/Chart.ts
// and friends), so Calc's and Show's generated types are accepted as they
// are and this package stays app-independent. docs/charts.md is the
// authoritative description of every field and default.

import type { Color } from "../generated/Color";

export type ChartValue = number | string | null;
export type Grouping = "standard" | "clustered" | "stacked" | "percentStacked";
export type BarDirection = "column" | "bar";
export type ScatterStyle = "marker" | "lineMarker" | "line" | "smoothMarker" | "smooth";
export type DisplayBlanks = "gap" | "zero" | "span";
export type AxisGroup = "primary" | "secondary";
export type LegendPosition = "top" | "bottom" | "left" | "right" | "topRight";
export type LabelPosition = "bestFit" | "bottom" | "center" | "insideBase" | "insideEnd" | "left" | "outsideEnd" | "right" | "top";
export type TickLabels = "nextTo" | "high" | "low" | "none";
export type LineDash = "solid" | "dot" | "dash" | "lgDash" | "dashDot" | "lgDashDot" | "lgDashDotDot" | "sysDash" | "sysDot" | "sysDashDot" | "sysDashDotDot";
export type MarkerSymbol = "none" | "auto" | "circle" | "dash" | "diamond" | "dot" | "plus" | "square" | "star" | "triangle" | "x";

export type ChartKind =
  | { type: "bar"; direction: BarDirection; grouping: Grouping }
  | { type: "line"; grouping: Grouping; markers: boolean }
  | { type: "area"; grouping: Grouping }
  | { type: "pie" }
  | { type: "doughnut" }
  | { type: "scatter"; style: ScatterStyle }
  | { type: "combo" }
  | { type: "unsupported"; kind: string; xml: string };

export type DataRef = { type: "ref"; formula: string; cache?: ChartValue[] } | { type: "literal"; values: ChartValue[] };
export type TextSource = { type: "literal"; text: string } | { type: "ref"; formula: string; cache?: string };
export type ChartFill = { type: "none" } | { type: "solid"; color: Color };
export interface LineFormat {
  none?: boolean;
  color?: Color;
  /** EMU (12 700 per point). */
  width?: number;
  dash?: LineDash;
}
export interface Marker {
  symbol: MarkerSymbol;
  /** Points. */
  size?: number;
  fill?: ChartFill;
  line?: LineFormat;
}
export interface DataPoint {
  idx: number;
  fill?: ChartFill;
  line?: LineFormat;
  marker?: Marker;
}
export interface DataLabels {
  showValue?: boolean;
  showPercent?: boolean;
  showCategory?: boolean;
  showSeries?: boolean;
  showLegendKey?: boolean;
  position?: LabelPosition;
  numberFormat?: string;
}
export type TrendlineKind =
  | { type: "linear" }
  | { type: "exponential" }
  | { type: "logarithmic" }
  | { type: "power" }
  | { type: "polynomial"; order: number }
  | { type: "movingAverage"; period: number };
export interface Trendline {
  kind: TrendlineKind;
  name?: string;
  displayEquation?: boolean;
  displayRSquared?: boolean;
  line?: LineFormat;
}
export interface Series {
  name?: TextSource;
  values: DataRef;
  categories?: DataRef;
  kind?: ChartKind;
  axis?: AxisGroup;
  fill?: ChartFill;
  line?: LineFormat;
  marker?: Marker;
  dataPoints?: DataPoint[];
  dataLabels?: DataLabels;
  trendline?: Trendline;
  smooth?: boolean;
}
export interface ChartTitle {
  text?: TextSource;
  overlay?: boolean;
}
export type Crosses = { type: "autoZero" } | { type: "min" } | { type: "max" } | { type: "at"; value: number };
export interface Axis {
  title?: ChartTitle;
  min?: number;
  max?: number;
  majorUnit?: number;
  minorUnit?: number;
  numberFormat?: string;
  logBase?: number;
  reverse?: boolean;
  crosses?: Crosses;
  majorGridlines?: boolean;
  minorGridlines?: boolean;
  tickLabels?: TickLabels;
  delete?: boolean;
}
export interface Axes {
  cat: Axis;
  val: Axis;
  secondVal?: Axis;
}
export interface Legend {
  position: LegendPosition;
  overlay?: boolean;
}
export interface Chart {
  title?: ChartTitle;
  kind: ChartKind;
  series: Series[];
  categories?: DataRef;
  axes: Axes;
  legend?: Legend;
  style?: number;
  varyColors?: boolean;
  plotVisibleOnly?: boolean;
  displayBlanksAs?: DisplayBlanks;
  dataLabels?: DataLabels;
  gapWidth?: number;
  overlap?: number;
  holeSize?: number;
  firstSliceAngle?: number;
}

export interface ResolvedSeries {
  name: string;
  categories: string[];
  xValues?: (number | null)[];
  values: (number | null)[];
  formatCode?: string;
  categoryFormatCode?: string;
}
export interface ResolvedChart {
  series: ResolvedSeries[];
  title?: string;
}
