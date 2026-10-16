// The renderer's output: a flat list of drawing primitives (in CSS px of
// the chart box, back to front) plus hit regions per chart element. Both
// painters (canvas, SVG) and the hit-tester read only this.

export type AxisId = "cat" | "val" | "secondVal";

/** A selectable part of a chart (Format tab / pane, click selection). */
export type ChartElement =
  | { type: "chartArea" }
  | { type: "plotArea" }
  | { type: "title" }
  | { type: "legend" }
  | { type: "axis"; axis: AxisId }
  | { type: "axisTitle"; axis: AxisId }
  | { type: "gridlines"; axis: AxisId; minor?: boolean }
  | { type: "series"; series: number; point?: number }
  | { type: "dataLabels"; series: number; point?: number }
  | { type: "trendline"; series: number };

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface ItemBase {
  el?: ChartElement;
  /** Clip to this box (lines and areas outside the plot area). */
  clip?: Box;
}

export interface StrokeStyle {
  stroke?: string;
  lineWidth?: number;
  /** Dash pattern in px. */
  dash?: number[];
}

export type SceneItem =
  | (ItemBase & StrokeStyle & { t: "rect"; x: number; y: number; w: number; h: number; fill?: string })
  | (ItemBase & StrokeStyle & { t: "path"; d: string; fill?: string; join?: "round" | "miter"; cap?: "round" | "butt" })
  | (ItemBase & {
      t: "text";
      x: number;
      y: number;
      text: string;
      /** Font size, px. */
      size: number;
      color: string;
      bold?: boolean;
      align: "left" | "center" | "right";
      baseline: "top" | "middle" | "bottom";
      /** Degrees (−90 = reading upwards). */
      rotate?: number;
    });

export type HitShape =
  | { kind: "rect"; x: number; y: number; w: number; h: number }
  | { kind: "polyline"; points: number[]; width: number }
  | { kind: "polygon"; points: number[] }
  /** Angles in radians, clockwise from 12 o'clock. */
  | { kind: "sector"; cx: number; cy: number; r0: number; r1: number; a0: number; a1: number }
  | { kind: "circle"; cx: number; cy: number; r: number };

export interface SceneHit {
  el: ChartElement;
  shape: HitShape;
}

/** The scale of a drawn value axis (for tests and the Format pane's automatic values). */
export interface SceneAxis {
  min: number;
  max: number;
  major: number;
  minor: number;
  ticks: number[];
  log?: number;
}

export interface ChartScene {
  width: number;
  height: number;
  items: SceneItem[];
  /** In drawing order (the hit-tester scans them back to front). */
  hits: SceneHit[];
  /** The plot area (inside the axes). */
  plot: Box;
  /** Value axes (scatter: `cat` is the X axis). */
  axes: Partial<Record<AxisId, SceneAxis>>;
  /** Text shown for the chart title, if any (inline editing). */
  titleText?: string;
}

/** Stable key of an element (selection comparisons). */
export function elementKey(el: ChartElement | null | undefined): string {
  if (!el) return "";
  switch (el.type) {
    case "axis":
    case "axisTitle":
      return `${el.type}:${el.axis}`;
    case "gridlines":
      return `gridlines:${el.axis}:${el.minor ? "minor" : "major"}`;
    case "series":
    case "dataLabels":
      return `${el.type}:${el.series}${el.point === undefined ? "" : `:${el.point}`}`;
    case "trendline":
      return `trendline:${el.series}`;
    default:
      return el.type;
  }
}

export const sameElement = (a: ChartElement | null | undefined, b: ChartElement | null | undefined) => elementKey(a) === elementKey(b);
