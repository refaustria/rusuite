// layoutChart: a chart model plus its resolved data → a ChartScene
// (docs/charts.md "Rendering rules"). Pure; the painters (canvas, SVG) and
// the hit-tester only read the scene, so Calc and Show draw a chart the
// same way.

import { basicFormat } from "./format";
import type {
  AreaFill, Axis, Chart, ChartKind, DataLabels, DataRef, LabelPosition, LegendPosition, LineDash, LineFormat, ManualLayout, Marker, MarkerSymbol, ResolvedChart, ResolvedSeries, Series,
  ShapeFormat, TextFormat, TextSource,
} from "./model";
import { fillColor, paletteColor, resolveColor, type ChartTheme } from "./palette";
import { labelStep, minorTicks, scaleFraction, valueScale, type ScaleOptions, type ValueScale } from "./scale";
import type { AxisId, Box, ChartElement, ChartScene, HitShape, PaintExtras, SceneAxis, SceneHit, SceneItem } from "./scene";
import { fitTrend, movingAverage, rSquaredLabel, trendEquation } from "./trend";

/** Texts the renderer shows (the host translates them). `{kind}`, `{name}`, `{period}` are placeholders. */
export interface ChartLabels {
  chartTitle: string;
  axisTitle: string;
  unsupported: string;
  trendLinear: string;
  trendExponential: string;
  trendLogarithmic: string;
  trendPower: string;
  trendPolynomial: string;
  trendMovingAverage: string;
}

export const DEFAULT_CHART_LABELS: ChartLabels = {
  chartTitle: "Chart Title",
  axisTitle: "Axis Title",
  unsupported: "This chart type ({kind}) cannot be displayed",
  trendLinear: "Linear ({name})",
  trendExponential: "Expon. ({name})",
  trendLogarithmic: "Log. ({name})",
  trendPower: "Power ({name})",
  trendPolynomial: "Poly. ({name})",
  trendMovingAverage: "{period} per. Mov. Avg. ({name})",
};

export interface ChartLayoutOptions {
  /** Workbook theme colours (default: Office). */
  theme?: ChartTheme;
  /** Number formatting (value, format code) → text; default: General and the plain codes. */
  format?: (value: number, code: string) => string;
  /** Text width in px for a font size in px (default: an estimate for Calibri). */
  measure?: (text: string, sizePx: number, bold: boolean) => number;
  labels?: Partial<ChartLabels>;
  /** Gallery icons: no texts, no title or legend, thin padding. */
  thumbnail?: boolean;
  /**
   * The chart area: fill and border colours (`null` = none; default: white
   * with the Office 2013 border). Show passes no fill and no border (charts
   * on slides are transparent).
   */
  area?: { fill: string | null; border: string | null };
  /** Colour of titles, labels and the legend (default `#595959`, Office's tx1 +35 %). */
  textColor?: string;
  /** Excel's automatic value axis bounds (5 % beyond the data, docs/charts.md); default: the P8-20 approximation. */
  excelScale?: boolean;
  /** Category labels turn −45° (then −90°) when they would overlap, like Excel's; default: thinned. */
  autoRotateLabels?: boolean;
}

// --- constants (docs/charts.md, 100 % zoom, CSS px) --------------------------------------------

const PT = 4 / 3;
export const TITLE_PX = 14 * PT;
export const AXIS_TITLE_PX = 10 * PT;
export const LABEL_PX = 9 * PT;
const LINE = 1.2;
export const TEXT_COLOR = "#595959";
export const GRID_COLOR = "#D9D9D9";
export const AXIS_COLOR = "#BFBFBF";
export const BORDER_COLOR = "#D9D9D9";
const PAD = 8;
const TICK = 4;
const LINE_PX = 2.25 * PT;
const MARKER_PT = 5;
const EMU_PER_PX = 9525;

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Default text measurement: an average Calibri advance per character. */
export function approxTextWidth(text: string, size: number, bold = false): number {
  let w = 0;
  for (const ch of text) {
    if (ch === " ") w += 0.226;
    else if (/[0-9]/.test(ch)) w += 0.507;
    else if (/[A-Z]/.test(ch)) w += 0.58;
    else if (/[.,:;'!|il]/.test(ch)) w += 0.25;
    else w += 0.48;
  }
  return w * size * (bold ? 1.05 : 1);
}

const DASHES: Record<LineDash, number[]> = {
  solid: [],
  dot: [1, 3],
  dash: [4, 3],
  lgDash: [8, 3],
  dashDot: [4, 3, 1, 3],
  lgDashDot: [8, 3, 1, 3],
  lgDashDotDot: [8, 3, 1, 3, 1, 3],
  sysDash: [3, 1],
  sysDot: [1, 1],
  sysDashDot: [3, 1, 1, 1],
  sysDashDotDot: [3, 1, 1, 1, 1, 1],
};
export const dashPattern = (dash: LineDash | undefined, width: number): number[] | undefined =>
  dash && dash !== "solid" ? DASHES[dash].map((d) => r2(d * width)) : undefined;

// --- builder -------------------------------------------------------------------------------------

class Builder {
  items: SceneItem[] = [];
  hits: SceneHit[] = [];
  textColor = TEXT_COLOR;
  push(item: SceneItem): void {
    this.items.push(item);
  }
  hit(el: ChartElement, shape: HitShape): void {
    this.hits.push({ el, shape });
  }
  rect(x: number, y: number, w: number, h: number, style: { fill?: string; stroke?: string; lineWidth?: number; dash?: number[] } & PaintExtras, el?: ChartElement): void {
    const item: SceneItem = { t: "rect", x: r2(x), y: r2(y), w: r2(w), h: r2(h) };
    if (style.fill) item.fill = style.fill;
    if (style.gradient) item.gradient = style.gradient;
    if (style.image) item.image = style.image;
    if (style.tile) item.tile = true;
    if (style.shadow) item.shadow = true;
    if (style.radius) item.radius = style.radius;
    if (style.stroke) {
      item.stroke = style.stroke;
      item.lineWidth = style.lineWidth ?? 1;
      if (style.dash?.length) item.dash = style.dash;
    }
    if (el) item.el = el;
    this.items.push(item);
  }
  path(d: string, style: { fill?: string; stroke?: string; lineWidth?: number; dash?: number[]; join?: "round" | "miter"; cap?: "round" | "butt"; clip?: Box }, el?: ChartElement): void {
    if (!d) return;
    const item: SceneItem = { t: "path", d };
    if (style.fill) item.fill = style.fill;
    if (style.stroke) {
      item.stroke = style.stroke;
      item.lineWidth = r2(style.lineWidth ?? 1);
      if (style.dash?.length) item.dash = style.dash;
      if (style.join) item.join = style.join;
      if (style.cap) item.cap = style.cap;
    }
    if (style.clip) item.clip = { x: r2(style.clip.x), y: r2(style.clip.y), w: r2(style.clip.w), h: r2(style.clip.h) };
    if (el) item.el = el;
    this.items.push(item);
  }
  text(
    text: string, x: number, y: number,
    o: { size: number; bold?: boolean; italic?: boolean; font?: string; align?: "left" | "center" | "right"; baseline?: "top" | "middle" | "bottom"; rotate?: number; color?: string },
    el?: ChartElement,
  ): void {
    if (!text) return;
    const item: SceneItem = {
      t: "text", x: r2(x), y: r2(y), text, size: r2(o.size), color: o.color ?? this.textColor, align: o.align ?? "left", baseline: o.baseline ?? "top",
    };
    if (o.bold) item.bold = true;
    if (o.italic) item.italic = true;
    if (o.font) item.font = o.font;
    if (o.rotate) item.rotate = o.rotate;
    if (el) item.el = el;
    this.items.push(item);
  }
}

const pt = (x: number, y: number) => `${r2(x)} ${r2(y)}`;
/** `M x y L x y …` (optionally closed). */
export function polyPath(points: [number, number][], close = false): string {
  if (points.length === 0) return "";
  return points.map(([x, y], i) => `${i ? "L" : "M"}${pt(x, y)}`).join(" ") + (close ? " Z" : "");
}

/** Catmull–Rom (tension 0.5) through the points as cubic Béziers. */
export function smoothPath(points: [number, number][]): string {
  if (points.length < 3) return polyPath(points);
  let d = `M${pt(...points[0]!)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[Math.min(points.length - 1, i + 2)]!;
    const c1: [number, number] = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2: [number, number] = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${pt(...c1)} ${pt(...c2)} ${pt(...p2)}`;
  }
  return d;
}

const polar = (cx: number, cy: number, r: number, a: number): [number, number] => [cx + r * Math.sin(a), cy - r * Math.cos(a)];

/** A pie slice / doughnut ring segment (angles clockwise from 12 o'clock, radians). */
export function sectorPath(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): string {
  const full = a1 - a0 >= Math.PI * 2 - 1e-9;
  if (full) {
    const mid = a0 + Math.PI;
    const outer = `M${pt(...polar(cx, cy, r1, a0))} A${r2(r1)} ${r2(r1)} 0 1 1 ${pt(...polar(cx, cy, r1, mid))} A${r2(r1)} ${r2(r1)} 0 1 1 ${pt(...polar(cx, cy, r1, a0))} Z`;
    if (r0 <= 0) return outer;
    return `${outer} M${pt(...polar(cx, cy, r0, a0))} A${r2(r0)} ${r2(r0)} 0 1 0 ${pt(...polar(cx, cy, r0, mid))} A${r2(r0)} ${r2(r0)} 0 1 0 ${pt(...polar(cx, cy, r0, a0))} Z`;
  }
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const o0 = polar(cx, cy, r1, a0);
  const o1 = polar(cx, cy, r1, a1);
  if (r0 <= 0) return `M${pt(cx, cy)} L${pt(...o0)} A${r2(r1)} ${r2(r1)} 0 ${large} 1 ${pt(...o1)} Z`;
  const i1 = polar(cx, cy, r0, a1);
  const i0 = polar(cx, cy, r0, a0);
  return `M${pt(...o0)} A${r2(r1)} ${r2(r1)} 0 ${large} 1 ${pt(...o1)} L${pt(...i1)} A${r2(r0)} ${r2(r0)} 0 ${large} 0 ${pt(...i0)} Z`;
}

/** Marker outline path of `symbol` centred at x, y, `size` px across. */
export function markerPath(symbol: MarkerSymbol, x: number, y: number, size: number): string {
  const h = size / 2;
  switch (symbol) {
    case "none":
      return "";
    case "square":
      return polyPath([[x - h, y - h], [x + h, y - h], [x + h, y + h], [x - h, y + h]], true);
    case "diamond":
      return polyPath([[x, y - h], [x + h, y], [x, y + h], [x - h, y]], true);
    case "triangle":
      return polyPath([[x, y - h], [x + h, y + h], [x - h, y + h]], true);
    case "x":
      return `${polyPath([[x - h, y - h], [x + h, y + h]])} ${polyPath([[x + h, y - h], [x - h, y + h]])}`;
    case "plus":
      return `${polyPath([[x - h, y], [x + h, y]])} ${polyPath([[x, y - h], [x, y + h]])}`;
    case "star":
      return `${polyPath([[x - h, y - h], [x + h, y + h]])} ${polyPath([[x + h, y - h], [x - h, y + h]])} ${polyPath([[x, y - h], [x, y + h]])}`;
    case "dash":
      return polyPath([[x - h, y - size / 8], [x + h, y - size / 8], [x + h, y + size / 8], [x - h, y + size / 8]], true);
    case "dot":
      return sectorPath(x, y, 0, size / 4, 0, Math.PI * 2);
    default:
      return sectorPath(x, y, 0, h, 0, Math.PI * 2);
  }
}
const openMarker = (s: MarkerSymbol) => s === "x" || s === "plus" || s === "star";

// --- series model --------------------------------------------------------------------------------

type KindFamily = "bar" | "line" | "area" | "scatter" | "pie" | "doughnut";

interface MarkerStyle {
  symbol: MarkerSymbol;
  size: number;
  fill: string | null;
  stroke: string | null;
}

interface SeriesInfo {
  index: number;
  spec: Series;
  data: ResolvedSeries;
  kind: ChartKind;
  family: KindFamily;
  grouping: string;
  secondary: boolean;
  color: string;
  fill: string | null;
  stroke: string | null;
  lineWidth: number;
  dash?: number[];
  marker: MarkerStyle | null;
  smooth: boolean;
  labels?: DataLabels;
}

const DEFAULT_COMBO_KIND: ChartKind = { type: "bar", direction: "column", grouping: "clustered" };

const familyOf = (k: ChartKind): KindFamily => (k.type === "combo" || k.type === "unsupported" ? "bar" : k.type);
const groupingOf = (k: ChartKind): string => (k.type === "bar" || k.type === "line" || k.type === "area" ? k.grouping : "standard");
const stacked = (g: string) => g === "stacked" || g === "percentStacked";

function textOf(src: TextSource | undefined): string | undefined {
  if (!src) return undefined;
  return src.type === "literal" ? src.text : (src.cache ?? undefined);
}

function scatterLines(style: string): { line: boolean; markers: boolean; smooth: boolean } {
  return {
    line: style !== "marker",
    markers: style === "marker" || style === "lineMarker" || style === "smoothMarker",
    smooth: style === "smooth" || style === "smoothMarker",
  };
}

function markerStyle(m: Marker | undefined, color: string, theme: ChartTheme, show: boolean): MarkerStyle | null {
  if (m?.symbol === "none") return null;
  if (!m && !show) return null;
  const symbol: MarkerSymbol = !m || m.symbol === "auto" ? "circle" : m.symbol;
  const size = (m?.size ?? MARKER_PT) * PT;
  const f = fillColor(m?.fill, theme);
  const line = m?.line;
  const stroke = line?.none ? null : line?.color ? resolveColor(line.color, theme) : color;
  return { symbol, size, fill: f === undefined ? color : f, stroke };
}

function seriesInfos(chart: Chart, data: ResolvedChart, theme: ChartTheme): SeriesInfo[] {
  const n = chart.series.length;
  return chart.series.map((spec, index) => {
    const kind = chart.kind.type === "combo" ? (spec.kind ?? DEFAULT_COMBO_KIND) : chart.kind;
    const family = familyOf(kind);
    const color = resolveColor(paletteColor(chart.style, index, n), theme);
    const f = fillColor(spec.fill, theme);
    const lineColor = spec.line?.color ? resolveColor(spec.line.color, theme) : undefined;
    const isLine = family === "line" || family === "scatter";
    const sl = kind.type === "scatter" ? scatterLines(kind.style) : null;
    const lineWidth = spec.line?.width ? spec.line.width / EMU_PER_PX : isLine ? LINE_PX : 1;
    let stroke: string | null;
    if (isLine) stroke = spec.line?.none || (sl && !sl.line && !spec.line) ? null : (lineColor ?? (f || color));
    else stroke = spec.line?.none ? null : (lineColor ?? (family === "pie" || family === "doughnut" ? "#FFFFFF" : null));
    const showMarkers = kind.type === "line" ? kind.markers : sl ? sl.markers : false;
    const marker = isLine ? markerStyle(spec.marker, lineColor ?? (f || color), theme, showMarkers) : null;
    const resolved = data.series[index] ?? { name: `Series${index + 1}`, categories: [], values: [] };
    return {
      index, spec, data: resolved, kind, family, grouping: groupingOf(kind), secondary: spec.axis === "secondary",
      color, fill: f === undefined ? color : f, stroke, lineWidth, dash: dashPattern(spec.line?.dash, lineWidth), marker,
      smooth: spec.smooth ?? (sl ? sl.smooth : false),
      labels: spec.dataLabels ?? chart.dataLabels,
    };
  });
}

const labelsShown = (d: DataLabels | undefined) => !!d && !!(d.showValue || d.showPercent || d.showCategory || d.showSeries || d.showRange);

// --- the layout ----------------------------------------------------------------------------------

interface Ctx {
  chart: Chart;
  data: ResolvedChart;
  b: Builder;
  theme: ChartTheme;
  fmt: (v: number, code: string) => string;
  measure: (text: string, size: number, bold: boolean) => number;
  labels: ChartLabels;
  thumb: boolean;
  series: SeriesInfo[];
  axes: Partial<Record<AxisId, SceneAxis>>;
  /** The chart box (manual layouts are fractions of it). */
  W: number;
  H: number;
  excelScale: boolean;
  autoRotate: boolean;
}

/** A text's size (px), weight, slant, colour and font. */
export interface TextStyle {
  size: number;
  bold?: boolean;
  italic?: boolean;
  color?: string;
  font?: string;
}

/**
 * The style of a chart text: the element's default size (`sizePx`) and weight, then the chart's
 * `textFormat` (its size scales every default by size / 9 pt), then the element's own formats in order.
 */
function textStyle(ctx: Ctx, sizePx: number, bold: boolean, ...formats: (TextFormat | undefined)[]): TextStyle {
  const st: TextStyle = { size: sizePx };
  if (bold) st.bold = true;
  const base = ctx.chart.textFormat;
  if (base?.size) st.size = (base.size * PT * sizePx) / LABEL_PX;
  for (const f of [base, ...formats]) {
    if (!f) continue;
    if (f !== base && f.size) st.size = f.size * PT;
    if (f.bold !== undefined) st.bold = f.bold || undefined;
    if (f.italic !== undefined) st.italic = f.italic || undefined;
    if (f.color) st.color = resolveColor(f.color, ctx.theme);
    if (f.font) st.font = f.font;
  }
  return st;
}

/** Stroke of a modelled line (`none` = no line; absent fields = the defaults). */
function strokeOf(ctx: Ctx, l: LineFormat | undefined, color: string | null, width = 1): { stroke?: string; lineWidth?: number; dash?: number[] } {
  if (l?.none) return {};
  const stroke = l?.color ? resolveColor(l.color, ctx.theme) : color;
  if (!stroke) return {};
  const lineWidth = l?.width ? l.width / EMU_PER_PX : width;
  const dash = dashPattern(l?.dash, lineWidth);
  return { stroke, lineWidth, ...(dash ? { dash } : {}) };
}

/** The paint of an area fill over `box` (`null`: no fill; `undefined`: the default). */
function areaPaint(ctx: Ctx, f: AreaFill | undefined, box: Box): ({ fill?: string } & PaintExtras) | null | undefined {
  if (!f) return undefined;
  switch (f.type) {
    case "none":
      return null;
    case "solid":
      return { fill: resolveColor(f.color, ctx.theme) };
    case "gradient": {
      const stops = f.stops.map((st) => ({ pos: st.pos, color: resolveColor(st.color, ctx.theme) }));
      if (!stops.length) return null;
      const cx = box.x + box.w / 2;
      const cy = box.y + box.h / 2;
      if (f.radial) return { fill: stops[0]!.color, gradient: { x0: r2(cx), y0: r2(cy), x1: r2(cx), y1: r2(cy), radial: true, r: r2(Math.hypot(box.w, box.h) / 2), stops } };
      const a = (((f.angle ?? 0) % 360) * Math.PI) / 180;
      const half = (Math.abs(box.w * Math.cos(a)) + Math.abs(box.h * Math.sin(a))) / 2;
      const dx = Math.cos(a) * half;
      const dy = Math.sin(a) * half;
      return { fill: stops[0]!.color, gradient: { x0: r2(cx - dx), y0: r2(cy - dy), x1: r2(cx + dx), y1: r2(cy + dy), stops } };
    }
    case "picture":
      return f.media.data ? { image: `data:${f.media.contentType || "image/png"};base64,${f.media.data}`, ...(f.tile ? { tile: true } : {}) } : null;
  }
}

/** A manual layout as a box in px (`w`/`h` absent: `fallback`'s size). */
function layoutBox(ctx: Ctx, l: ManualLayout, fallback: { w: number; h: number }): Box {
  return { x: l.x * ctx.W, y: l.y * ctx.H, w: l.w !== undefined ? l.w * ctx.W : fallback.w, h: l.h !== undefined ? l.h * ctx.H : fallback.h };
}

/** The plot area's own fill and border (`c:plotArea/c:spPr`), drawn behind the gridlines. */
function drawPlotArea(ctx: Ctx, plot: Box, shape: ShapeFormat | undefined): void {
  if (!shape) return;
  const paint = areaPaint(ctx, shape.fill, plot);
  const stroke = shape.line ? strokeOf(ctx, shape.line, BORDER_COLOR) : {};
  if (!paint && !stroke.stroke && !shape.shadow) return;
  ctx.b.rect(plot.x, plot.y, plot.w, plot.h, { ...(paint ?? {}), ...stroke, ...(shape.shadow ? { shadow: true } : {}) }, { type: "plotArea" });
}

const fill = (s: string, vars: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));

/** Lays out `chart` with its resolved data in a `width × height` px box. */
export function layoutChart(chart: Chart, data: ResolvedChart, width: number, height: number, options: ChartLayoutOptions = {}): ChartScene {
  const b = new Builder();
  const theme = options.theme ?? {};
  const labels = { ...DEFAULT_CHART_LABELS, ...options.labels };
  const ctx: Ctx = {
    chart, data, b, theme, labels,
    fmt: options.format ?? basicFormat,
    measure: options.measure ?? approxTextWidth,
    thumb: !!options.thumbnail,
    series: [],
    axes: {},
    W: Math.max(1, width),
    H: Math.max(1, height),
    excelScale: !!options.excelScale,
    autoRotate: !!options.autoRotateLabels,
  };
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  if (options.textColor) b.textColor = options.textColor;
  const area = options.area ?? { fill: "#FFFFFF", border: ctx.thumb ? null : BORDER_COLOR };
  const own = chart.chartArea;
  const areaBox: Box = { x: 0.5, y: 0.5, w: w - 1, h: h - 1 };
  const paint = areaPaint(ctx, own?.fill, areaBox);
  const areaFill = paint === undefined ? (area.fill ? { fill: area.fill } : {}) : (paint ?? {});
  const areaStroke = own?.line ? strokeOf(ctx, own.line, area.border ?? BORDER_COLOR) : area.border ? { stroke: area.border, lineWidth: 1 } : {};
  const extras: PaintExtras = {};
  if (own?.shadow) extras.shadow = true;
  if (chart.roundedCorners && !ctx.thumb) extras.radius = 8;
  b.rect(areaBox.x, areaBox.y, areaBox.w, areaBox.h, { ...areaFill, ...(areaStroke.stroke ? areaStroke : {}), ...extras }, { type: "chartArea" });
  b.hit({ type: "chartArea" }, { kind: "rect", x: 0, y: 0, w, h });
  const scene = (plot: Box, titleText?: string): ChartScene => ({
    width: w, height: h, items: b.items, hits: b.hits, plot: { x: r2(plot.x), y: r2(plot.y), w: r2(plot.w), h: r2(plot.h) }, axes: ctx.axes,
    ...(titleText ? { titleText } : {}),
  });
  if (chart.kind.type === "unsupported") {
    b.text(fill(labels.unsupported, { kind: chart.kind.kind }), w / 2, h / 2, { size: LABEL_PX, align: "center", baseline: "middle" });
    return scene({ x: 0, y: 0, w, h });
  }
  ctx.series = seriesInfos(chart, data, theme);
  const pad = ctx.thumb ? 3 : PAD;
  let box: Box = { x: pad, y: pad, w: w - 2 * pad, h: h - 2 * pad };

  // Title.
  let titleText: string | undefined;
  if (chart.title && !ctx.thumb) {
    titleText = data.title ?? textOf(chart.title.text) ?? (chart.series.length === 1 ? ctx.series[0]?.data.name : undefined);
    if (titleText) {
      const st = textStyle(ctx, TITLE_PX, false, chart.title.textFormat);
      const th = st.size * LINE;
      const tw = ctx.measure(titleText, st.size, !!st.bold);
      const manual = chart.title.layout;
      if (manual) {
        const at = layoutBox(ctx, manual, { w: tw, h: th });
        b.text(titleText, at.x + 4, at.y + 2, { ...st, align: "left", baseline: "top" }, { type: "title" });
        b.hit({ type: "title" }, { kind: "rect", x: at.x, y: at.y, w: tw + 8, h: th + 4 });
      } else {
        b.text(titleText, w / 2, box.y, { ...st, align: "center", baseline: "top" }, { type: "title" });
        b.hit({ type: "title" }, { kind: "rect", x: w / 2 - tw / 2 - 4, y: box.y - 2, w: tw + 8, h: th + 4 });
        if (!chart.title.overlay) box = { ...box, y: box.y + th + 6, h: box.h - th - 6 };
      }
    }
  }

  // Legend.
  if (chart.legend && !ctx.thumb) box = layoutLegend(ctx, box, chart.legend.position, !!chart.legend.overlay);

  let plot: Box;
  const k = chart.kind.type;
  if (k === "pie" || k === "doughnut") plot = layoutPie(ctx, box, k === "doughnut");
  else if (k === "scatter" || (k === "combo" && ctx.series.length > 0 && ctx.series.every((s) => s.family === "scatter"))) plot = layoutScatter(ctx, box);
  else plot = layoutCategory(ctx, box);
  return scene(plot, titleText);
}

// --- legend --------------------------------------------------------------------------------------

interface LegendEntry {
  text: string;
  box: boolean;
  fill?: string | null;
  stroke?: string | null;
  lineWidth?: number;
  dash?: number[];
  marker?: MarkerStyle | null;
  el: ChartElement;
}

function pointColors(ctx: Ctx, s: SeriesInfo, count: number): string[] {
  const vary = ctx.chart.varyColors ?? false;
  return Array.from({ length: count }, (_, i) => {
    const dp = s.spec.dataPoints?.find((p) => p.idx === i);
    const f = fillColor(dp?.fill, ctx.theme);
    if (f !== undefined) return f ?? "none";
    if (vary) return resolveColor(paletteColor(ctx.chart.style, i, count), ctx.theme);
    return s.fill ?? "none";
  });
}

function trendName(ctx: Ctx, s: SeriesInfo): string {
  const t = s.spec.trendline!;
  if (t.name) return t.name;
  const L = ctx.labels;
  const pattern = {
    linear: L.trendLinear, exponential: L.trendExponential, logarithmic: L.trendLogarithmic, power: L.trendPower, polynomial: L.trendPolynomial, movingAverage: L.trendMovingAverage,
  }[t.kind.type];
  return fill(pattern, { name: s.data.name, period: t.kind.type === "movingAverage" ? t.kind.period : "" });
}

function legendEntries(ctx: Ctx, position: LegendPosition): LegendEntry[] {
  const { chart, series } = ctx;
  const pieLike = chart.kind.type === "pie" || chart.kind.type === "doughnut";
  const first = series[0];
  if (pieLike && first && (chart.varyColors ?? false)) {
    const n = first.data.values.length;
    const colors = pointColors(ctx, first, n);
    return first.data.categories.slice(0, n).map((text, i) => ({ text, box: true, fill: colors[i], el: { type: "series", series: 0, point: i } }));
  }
  const list = pieLike ? series.slice(0, chart.kind.type === "pie" ? 1 : series.length) : series;
  let out: LegendEntry[] = list.map((s) => {
    const line = s.family === "line" || s.family === "scatter";
    return line
      ? { text: s.data.name, box: false, stroke: s.stroke, lineWidth: Math.min(s.lineWidth, 3), dash: s.dash, marker: s.marker, el: { type: "series", series: s.index } }
      : { text: s.data.name, box: true, fill: s.fill, stroke: s.family === "pie" || s.family === "doughnut" ? null : s.stroke, el: { type: "series", series: s.index } };
  });
  const horizontalBars = chart.kind.type === "bar" && chart.kind.direction === "bar";
  if (horizontalBars && position === "right") out = out.reverse();
  for (const s of series) {
    if (!s.spec.trendline || pieLike) continue;
    out.push({ text: trendName(ctx, s), box: false, stroke: s.color, lineWidth: 2, dash: [2, 2], el: { type: "trendline", series: s.index } });
  }
  return out;
}

const KEY = 7;
const LINE_KEY = 18;

function layoutLegend(ctx: Ctx, box: Box, position: LegendPosition, overlay: boolean): Box {
  const entries = legendEntries(ctx, position);
  if (entries.length === 0) return box;
  const b = ctx.b;
  const st = textStyle(ctx, LABEL_PX, false, ctx.chart.legendTextFormat);
  const rowH = st.size * LINE;
  const keyW = (e: LegendEntry) => (e.box ? KEY : LINE_KEY);
  const entryW = entries.map((e) => keyW(e) + 4 + ctx.measure(e.text, st.size, !!st.bold));
  const vertical = position === "left" || position === "right" || position === "topRight";
  type Placed = { e: LegendEntry; x: number; y: number; w: number };
  const placed: Placed[] = [];
  let lw: number;
  let lh: number;
  if (vertical) {
    lw = Math.min(Math.max(...entryW) + 8, box.w * 0.45);
    lh = Math.min(entries.length * rowH + 4, box.h);
    entries.forEach((e, i) => placed.push({ e, x: 4, y: 2 + i * rowH, w: entryW[i]! }));
  } else {
    const gap = 12;
    const rows: { items: number[]; w: number }[] = [{ items: [], w: 0 }];
    entries.forEach((_, i) => {
      const row = rows[rows.length - 1]!;
      const add = (row.items.length ? gap : 0) + entryW[i]!;
      if (row.items.length && row.w + add > box.w - 8) rows.push({ items: [i], w: entryW[i]! });
      else {
        row.items.push(i);
        row.w += add;
      }
    });
    lw = Math.min(box.w, Math.max(...rows.map((r) => r.w)) + 8);
    lh = rows.length * rowH + 4;
    rows.forEach((row, ri) => {
      let x = (lw - row.w) / 2;
      for (const i of row.items) {
        placed.push({ e: entries[i]!, x, y: 2 + ri * rowH, w: entryW[i]! });
        x += entryW[i]! + gap;
      }
    });
  }
  let lx: number;
  let ly: number;
  let rest = box;
  const manual = ctx.chart.legendLayout;
  if (manual) {
    // Placed by hand: takes no space from the plot area.
    const at = layoutBox(ctx, manual, { w: lw, h: lh });
    [lx, ly] = [at.x, at.y];
    lw = Math.max(lw, at.w);
    lh = Math.max(lh, at.h);
  } else switch (position) {
    case "top":
      [lx, ly] = [box.x + (box.w - lw) / 2, box.y];
      if (!overlay) rest = { ...box, y: box.y + lh + 4, h: box.h - lh - 4 };
      break;
    case "bottom":
      [lx, ly] = [box.x + (box.w - lw) / 2, box.y + box.h - lh];
      if (!overlay) rest = { ...box, h: box.h - lh - 4 };
      break;
    case "left":
      [lx, ly] = [box.x, box.y + (box.h - lh) / 2];
      if (!overlay) rest = { ...box, x: box.x + lw + 4, w: box.w - lw - 4 };
      break;
    case "topRight":
      [lx, ly] = [box.x + box.w - lw, box.y];
      if (!overlay) rest = { ...box, w: box.w - lw - 4 };
      break;
    default:
      [lx, ly] = [box.x + box.w - lw, box.y + (box.h - lh) / 2];
      if (!overlay) rest = { ...box, w: box.w - lw - 4 };
  }
  b.hit({ type: "legend" }, { kind: "rect", x: lx, y: ly, w: lw, h: lh });
  for (const p of placed) {
    const x = lx + p.x;
    const cy = ly + p.y + rowH / 2;
    if (p.e.box) {
      b.rect(x, cy - KEY / 2, KEY, KEY, { fill: p.e.fill ?? undefined, stroke: p.e.stroke ?? undefined }, { type: "legend" });
    } else {
      if (p.e.stroke) b.path(polyPath([[x, cy], [x + LINE_KEY, cy]]), { stroke: p.e.stroke, lineWidth: p.e.lineWidth, dash: p.e.dash, cap: "round" }, { type: "legend" });
      const m = p.e.marker;
      if (m) drawMarker(b, m, x + LINE_KEY / 2, cy, { type: "legend" }, Math.min(m.size, 7));
    }
    b.text(p.e.text, x + (p.e.box ? KEY : LINE_KEY) + 4, cy, { ...st, baseline: "middle" }, { type: "legend" });
  }
  return rest;
}

function drawMarker(b: Builder, m: MarkerStyle, x: number, y: number, el: ChartElement, size = m.size): void {
  const d = markerPath(m.symbol, x, y, size);
  if (openMarker(m.symbol)) b.path(d, { stroke: m.stroke ?? m.fill ?? undefined, lineWidth: 1 }, el);
  else b.path(d, { fill: m.fill ?? undefined, stroke: m.stroke ?? undefined, lineWidth: 1 }, el);
}

// --- value helpers -------------------------------------------------------------------------------

/** The value of point `i` per `displayBlanksAs` (`null`: nothing plotted). */
function valueAt(ctx: Ctx, s: SeriesInfo, i: number): number | null {
  const v = s.data.values[i];
  if (v === null || v === undefined || !Number.isFinite(v)) return ctx.chart.displayBlanksAs === "zero" ? 0 : null;
  return v;
}

interface StackInfo {
  /** Per series index: per category the [base, top] of its segment (stacked groups) or [0, v]. */
  seg: Map<number, ([number, number] | null)[]>;
  min: number | null;
  max: number | null;
  percent: boolean;
}

const groupKey = (s: SeriesInfo) => `${s.family}:${s.family === "bar" && s.kind.type === "bar" ? s.kind.direction : ""}:${s.grouping}`;

/** Segments and data range of the series of one value axis (stacking per kind group). */
function stackSeries(ctx: Ctx, list: SeriesInfo[], n: number): StackInfo {
  const seg = new Map<number, ([number, number] | null)[]>();
  let min: number | null = null;
  let max: number | null = null;
  let percent = false;
  const see = (v: number) => {
    min = min === null ? v : Math.min(min, v);
    max = max === null ? v : Math.max(max, v);
  };
  const groups = new Map<string, SeriesInfo[]>();
  for (const s of list) {
    const k = groupKey(s);
    groups.set(k, [...(groups.get(k) ?? []), s]);
  }
  for (const g of groups.values()) {
    const grouping = g[0]!.grouping;
    if (!stacked(grouping)) {
      for (const s of g) {
        const row: ([number, number] | null)[] = [];
        for (let i = 0; i < n; i++) {
          const v = valueAt(ctx, s, i);
          row.push(v === null ? null : [0, v]);
          if (v !== null) see(v);
        }
        seg.set(s.index, row);
      }
      continue;
    }
    const pct = grouping === "percentStacked";
    if (pct) percent = true;
    const rows = g.map(() => [] as ([number, number] | null)[]);
    for (let i = 0; i < n; i++) {
      const total = pct ? g.reduce((sum, s) => sum + Math.abs(valueAt(ctx, s, i) ?? 0), 0) : 1;
      let pos = 0;
      let neg = 0;
      let any = false;
      g.forEach((s, j) => {
        let v = valueAt(ctx, s, i);
        if (v === null) {
          // Lines and areas stack over blanks as zero; bars leave a gap.
          rows[j]!.push(s.family === "bar" ? null : [pos, pos]);
          return;
        }
        any = true;
        if (pct) v = total === 0 ? 0 : v / total;
        if (s.family === "bar" && v < 0) {
          rows[j]!.push([neg, neg + v]);
          neg += v;
        } else {
          rows[j]!.push([pos, pos + v]);
          pos += v;
          if (s.family !== "bar") see(pos);
        }
      });
      if (any && g[0]!.family === "bar") {
        see(pos);
        see(neg);
      }
    }
    g.forEach((s, j) => seg.set(s.index, rows[j]!));
  }
  return { seg, min, max, percent };
}

function scaleOptions(axis: Axis | undefined, headroom: boolean, excel = false): ScaleOptions {
  const o: ScaleOptions = { min: axis?.min, max: axis?.max, majorUnit: axis?.majorUnit, minorUnit: axis?.minorUnit, logBase: axis?.logBase, headroom };
  if (excel) o.excel = true;
  return o;
}

function percentScale(s: ValueScale, info: StackInfo, axis: Axis | undefined, len: number, vertical: boolean): ValueScale {
  if (!info.percent || axis?.min !== undefined || axis?.max !== undefined) return s;
  const lo = (info.min ?? 0) < 0 ? -1 : 0;
  const hi = (info.max ?? 0) > 0 || lo === 0 ? 1 : 0;
  return valueScale(lo, hi, len, vertical, { majorUnit: axis?.majorUnit, minorUnit: axis?.minorUnit, min: lo, max: hi });
}

const sceneAxis = (s: ValueScale): SceneAxis => ({ min: s.min, max: s.max, major: s.major, minor: s.minor, ticks: s.ticks, ...(s.log ? { log: s.log } : {}) });

/** Value where the other axis crosses (`crosses` of the crossing axis). */
function crossValue(s: ValueScale, crosses: Axis["crosses"]): number {
  const c = crosses ?? { type: "autoZero" };
  if (c.type === "min") return s.min;
  if (c.type === "max") return s.max;
  if (c.type === "at") return Math.min(s.max, Math.max(s.min, c.value));
  if (s.log) return s.min;
  return s.min > 0 ? s.min : s.max < 0 ? s.max : 0;
}

function axisTitleText(ctx: Ctx, axis: Axis | undefined): string | null {
  if (!axis?.title || ctx.thumb) return null;
  return textOf(axis.title.text) ?? ctx.labels.axisTitle;
}

function tickCode(_ctx: Ctx, axis: Axis | undefined, list: SeriesInfo[], percent: boolean): string {
  return axis?.numberFormat ?? (percent ? "0%" : (list.find((s) => s.data.formatCode)?.data.formatCode ?? "General"));
}

// --- category charts (bar, column, line, area, combo) -----------------------------------------------

interface ValueAxisPlan {
  id: AxisId;
  spec: Axis | undefined;
  list: SeriesInfo[];
  stack: StackInfo;
  code: string;
}

function layoutCategory(ctx: Ctx, box: Box): Box {
  const { chart, b, series } = ctx;
  const n = Math.max(0, ...series.map((s) => s.data.values.length));
  const cats = Array.from({ length: n }, (_, i) => series.find((s) => s.data.categories[i] !== undefined)?.data.categories[i] ?? String(i + 1));
  const firstBar = series.find((s) => s.family === "bar");
  const horizontal =
    (chart.kind.type === "bar" && chart.kind.direction === "bar") || (chart.kind.type === "combo" && firstBar?.kind.type === "bar" && firstBar.kind.direction === "bar");
  const hasBars = series.some((s) => s.family === "bar");
  const edges = !hasBars && series.some((s) => s.family === "area");
  const headroom = true;
  const primary = series.filter((s) => !s.secondary);
  const secondary = series.filter((s) => s.secondary);
  const plans: ValueAxisPlan[] = [];
  const primaryStack = stackSeries(ctx, primary.length || !secondary.length ? primary : [], n);
  plans.push({ id: "val", spec: chart.axes.val, list: primary, stack: primaryStack, code: tickCode(ctx, chart.axes.val, primary, primaryStack.percent) });
  if (secondary.length) {
    const st = stackSeries(ctx, secondary, n);
    plans.push({ id: "secondVal", spec: chart.axes.secondVal, list: secondary, stack: st, code: tickCode(ctx, chart.axes.secondVal, secondary, st.percent) });
  }
  const catAxis = chart.axes.cat;
  const valLen = (p: Box) => (horizontal ? p.w : p.h);
  const scaleOf = (plan: ValueAxisPlan, p: Box) => {
    const s = valueScale(plan.stack.min, plan.stack.max, valLen(p), !horizontal, scaleOptions(plan.spec, headroom, ctx.excelScale));
    return percentScale(s, plan.stack, plan.spec, valLen(p), !horizontal);
  };
  const shows = (a: Axis | undefined) => !ctx.thumb && !a?.delete && a?.tickLabels !== "none";
  const catStyle = textStyle(ctx, LABEL_PX, false, catAxis.textFormat);
  const labelH = catStyle.size * LINE;
  const titleH = AXIS_TITLE_PX * LINE + 4;
  const catWidths = cats.map((c) => ctx.measure(c, catStyle.size, !!catStyle.bold));
  const maxCatW = Math.max(0, ...catWidths);
  // Category label rotation: the axis' own, else (Calc) −45° then −90° when the labels would overlap.
  const catRotation = (p: Box): number => {
    const own = catAxis.textFormat?.rotation;
    if (own !== undefined) return own;
    if (!ctx.autoRotate || horizontal || n === 0) return 0;
    const band = p.w / n;
    if (maxCatW + 4 <= band) return 0;
    return labelH * Math.SQRT2 <= band ? -45 : -90;
  };
  const rotatedHeight = (rot: number) => {
    const a = (Math.abs(rot) * Math.PI) / 180;
    return maxCatW * Math.sin(a) + labelH * Math.cos(a);
  };
  // Data table (columns, lines, areas): the categories head its columns; one row per series.
  const table = chart.dataTable && !horizontal && !ctx.thumb ? chart.dataTable : null;
  const tableStyle = textStyle(ctx, LABEL_PX, false, table?.textFormat);
  const tableRowH = tableStyle.size * LINE + 4;
  const tableKeyW = table?.keys ? KEY + 6 : 0;
  const tableNameW = table ? Math.max(0, ...series.map((s) => ctx.measure(s.data.name, tableStyle.size, !!tableStyle.bold))) + tableKeyW + 10 : 0;
  const tableH = table ? tableRowH * (series.length + 1) : 0;
  // Which side the category labels and each value axis take.
  const valSide = (plan: ValueAxisPlan, crossAtMax: boolean): "low" | "high" => {
    const tl = plan.spec?.tickLabels;
    if (tl === "low") return "low";
    if (tl === "high") return "high";
    if (plan.id === "secondVal") return plan.spec?.crosses?.type === "min" ? "low" : "high";
    return crossAtMax !== !!catAxis.reverse ? "high" : "low";
  };
  const reserve = (p: Box) => {
    const res = { left: 0, right: 0, top: 0, bottom: 0 };
    const side = (low: boolean, vertAxis: boolean) => (vertAxis ? (low ? "left" : "right") : low ? "bottom" : "top");
    for (const plan of plans) {
      const sc = scaleOf(plan, p);
      const at = valSide(plan, plan.spec?.crosses?.type === "max");
      const where = side(at === "low", !horizontal) as keyof typeof res;
      if (shows(plan.spec)) {
        const vst = textStyle(ctx, LABEL_PX, false, plan.spec?.textFormat);
        const size = horizontal ? vst.size * LINE + 4 : Math.max(...sc.ticks.map((t) => ctx.measure(ctx.fmt(t, plan.code), vst.size, !!vst.bold))) + 8;
        res[where] += size;
      }
      if (axisTitleText(ctx, plan.spec) && !plan.spec?.delete) res[where] += titleH;
    }
    // Category axis: next to its crossing with the primary value axis.
    const sc = scaleOf(plans[0]!, p);
    const cv = crossValue(sc, catAxis.crosses);
    const frac = scaleFraction(sc, cv);
    const tl = catAxis.tickLabels;
    const low = tl === "low" || (tl !== "high" && frac <= 1e-9) ? true : tl === "high" || frac >= 1 - 1e-9 ? false : null;
    const flip = !!plans[0]!.spec?.reverse;
    const catWhere = low === null ? null : (side(flip ? !low : low, horizontal) as keyof typeof res);
    if (table) {
      res.bottom += tableH;
      res.left = Math.max(res.left, tableNameW);
    } else if (shows(catAxis) && catWhere) {
      const rot = catRotation(p);
      res[catWhere] += horizontal ? maxCatW + 10 : (rot ? rotatedHeight(rot) : labelH) + TICK + 2;
    }
    if (axisTitleText(ctx, catAxis) && !catAxis.delete) res[catWhere ?? (horizontal ? "left" : "bottom")] += titleH;
    return res;
  };
  const inset = ctx.thumb ? 2 : horizontal ? 4 : 6;
  const plotFrom = (res: { left: number; right: number; top: number; bottom: number }): Box => {
    const x = box.x + res.left + (ctx.thumb ? 1 : 2);
    const y = box.y + res.top + inset;
    return { x, y, w: Math.max(4, box.w - res.left - res.right - (ctx.thumb ? 2 : 10)), h: Math.max(4, box.h - res.top - res.bottom - inset - (ctx.thumb ? 1 : 2)) };
  };
  let plot = plotFrom(reserve({ ...box }));
  const res = reserve(plot);
  plot = plotFrom(res);
  // A plot area placed by hand (the inner box).
  if (chart.plotLayout) plot = layoutBox(ctx, chart.plotLayout, plot);
  const scales = plans.map((p) => scaleOf(p, plot));
  plans.forEach((p, i) => (ctx.axes[p.id] = sceneAxis(scales[i]!)));
  b.hit({ type: "plotArea" }, { kind: "rect", ...plot });
  drawPlotArea(ctx, plot, chart.plotArea);

  // Coordinate helpers.
  const catLen = horizontal ? plot.h : plot.w;
  const catAt = (t: number) => {
    const f = n > 0 ? t / n : 0;
    const rev = !!catAxis.reverse;
    if (horizontal) return rev ? plot.y + f * plot.h : plot.y + plot.h - f * plot.h;
    return rev ? plot.x + plot.w - f * plot.w : plot.x + f * plot.w;
  };
  const pointT = (i: number) => (edges ? (n > 1 ? (i * n) / (n - 1) : n / 2) : i + 0.5);
  const valAt = (sc: ValueScale, spec: Axis | undefined, v: number, clamp = false) => {
    let f = scaleFraction(sc, v);
    if (clamp) f = Math.min(1, Math.max(0, f));
    if (spec?.reverse) f = 1 - f;
    return horizontal ? plot.x + f * plot.w : plot.y + plot.h - f * plot.h;
  };
  const xy = (catPx: number, valPx: number): [number, number] => (horizontal ? [valPx, catPx] : [catPx, valPx]);
  const scaleFor = (s: SeriesInfo) => (s.secondary && scales[1] ? { sc: scales[1], spec: plans[1]!.spec, stack: plans[1]!.stack } : { sc: scales[0]!, spec: plans[0]!.spec, stack: plans[0]!.stack });
  const catCross = crossValue(scales[0]!, catAxis.crosses);

  // Gridlines.
  drawValueGridlines(ctx, plans[0]!, scales[0]!, plot, horizontal, (v) => valAt(scales[0]!, plans[0]!.spec, v));
  if (catAxis.majorGridlines && n > 0) {
    const lines: string[] = [];
    for (let t = 0; t <= n; t++) {
      if (edges && t === n) break;
      const c = edges ? catAt(pointT(t)) : catAt(t);
      lines.push(polyPath([xy(c, horizontal ? plot.x : plot.y), xy(c, horizontal ? plot.x + plot.w : plot.y + plot.h)]));
      b.hit({ type: "gridlines", axis: "cat" }, { kind: "polyline", points: [...xy(c, horizontal ? plot.x : plot.y), ...xy(c, horizontal ? plot.x + plot.w : plot.y + plot.h)], width: 5 });
    }
    b.path(lines.join(" "), { stroke: GRID_COLOR, lineWidth: 1 }, { type: "gridlines", axis: "cat" });
  }

  // Series in Excel / PowerPoint z-order: areas at the back, then bars, then lines, then scatter on top (P8-45 S-10).
  const areas = series.filter((s) => s.family === "area");
  const areaOrder = areas.some((s) => !stacked(s.grouping)) ? [...areas].reverse() : areas;
  for (const s of areaOrder) {
    const { sc, spec, stack } = scaleFor(s);
    const segs = stack.seg.get(s.index) ?? [];
    const top: [number, number][] = [];
    const bottom: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      const sg = segs[i] ?? [0, 0];
      const c = catAt(pointT(i));
      const isStacked = stacked(s.grouping);
      top.push(xy(c, valAt(sc, spec, sg[1])));
      bottom.push(xy(c, valAt(sc, spec, isStacked ? sg[0] : catCross)));
    }
    if (top.length === 0) continue;
    const poly = [...top, ...bottom.reverse()];
    const el: ChartElement = { type: "series", series: s.index };
    b.path(polyPath(poly, true), { fill: s.fill ?? undefined, stroke: s.stroke ?? undefined, lineWidth: s.lineWidth, clip: plot }, el);
    b.hit(el, { kind: "polygon", points: poly.flat() });
  }
  const band = n > 0 ? catLen / n : catLen;
  const gap = (chart.gapWidth ?? 150) / 100;
  const barSeries = series.filter((s) => s.family === "bar");
  for (const group of [false, true]) {
    const list = barSeries.filter((s) => s.secondary === group);
    if (!list.length) continue;
    const stackedBars = stacked(list[0]!.grouping);
    const ov = (chart.overlap ?? (stackedBars ? 100 : 0)) / 100;
    const cnt = stackedBars ? 1 : list.length;
    const bw = band / (cnt - (cnt - 1) * ov + gap);
    list.forEach((s, j) => {
      const { sc, spec, stack } = scaleFor(s);
      const segs = stack.seg.get(s.index) ?? [];
      const colors = pointColors(ctx, s, n);
      for (let i = 0; i < n; i++) {
        const sg = segs[i];
        if (!sg) continue;
        const slot = stackedBars ? 0 : j;
        const start = i * band + (gap / 2) * bw + slot * bw * (1 - ov);
        const c0 = catAt((start / catLen) * n);
        const c1 = catAt(((start + bw) / catLen) * n);
        const base = stackedBars ? sg[0] : catCross;
        const v0 = valAt(sc, spec, base, true);
        const v1 = valAt(sc, spec, sg[1], true);
        const [x0, y0] = xy(Math.min(c0, c1), Math.min(v0, v1));
        const [x1, y1] = xy(Math.max(c0, c1), Math.max(v0, v1));
        const el: ChartElement = { type: "series", series: s.index, point: i };
        const dp = s.spec.dataPoints?.find((p) => p.idx === i);
        const stroke = dp?.line?.none ? null : dp?.line?.color ? resolveColor(dp.line.color, ctx.theme) : s.stroke;
        const fillC = colors[i] === "none" ? undefined : colors[i];
        b.rect(x0, y0, x1 - x0, y1 - y0, { fill: fillC, stroke: stroke ?? undefined, lineWidth: s.lineWidth, dash: s.dash }, el);
        b.hit(el, { kind: "rect", x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
      }
    });
  }
  // High-low lines and up/down bars of line charts, behind the lines.
  drawLineExtras(ctx, series, n, band, (i) => catAt(pointT(i)), (s, v) => {
    const { sc, spec } = scaleFor(s);
    return valAt(sc, spec, v);
  }, xy);
  const lines = [...series.filter((s) => s.family === "line"), ...series.filter((s) => s.family === "scatter")];
  for (const s of lines) {
    const { sc, spec, stack } = scaleFor(s);
    const segs = stack.seg.get(s.index) ?? [];
    const pts: ([number, number] | null)[] = [];
    for (let i = 0; i < n; i++) {
      const raw = valueAt(ctx, s, i);
      const sg = segs[i];
      if (raw === null || !sg) pts.push(null);
      else pts.push(xy(catAt(pointT(i)), valAt(sc, spec, stacked(s.grouping) ? sg[1] : raw)));
    }
    drawLineSeries(ctx, s, pts, plot);
  }

  // Error bars on top of the series (Y only on category charts).
  for (const s of series) {
    if (!s.spec.errorBars?.length) continue;
    const { sc, spec, stack } = scaleFor(s);
    const segs = stack.seg.get(s.index) ?? [];
    const centre = (i: number) => {
      if (s.family !== "bar" || stacked(s.grouping)) return catAt(pointT(i));
      const list = barSeries.filter((o) => o.secondary === s.secondary);
      const j = list.indexOf(s);
      const ov = (chart.overlap ?? 0) / 100;
      const bw = band / (list.length - (list.length - 1) * ov + gap);
      const start = i * band + (gap / 2) * bw + j * bw * (1 - ov);
      return catAt(((start + bw / 2) / catLen) * n);
    };
    const values = Array.from({ length: n }, (_, i) => valueAt(ctx, s, i));
    s.spec.errorBars.forEach((e, k) => {
      if ((e.direction ?? "y") !== "y") return;
      const ranges = errorRanges(e, values, s.data.errorBars?.[k]);
      ranges.forEach((r, i) => {
        const sg = segs[i];
        const v = values[i];
        if (!r || v === null || v === undefined || !sg) return;
        const at = stacked(s.grouping) ? sg[1] : r.at ?? v;
        const offset = at - (r.at ?? v);
        drawErrorBar(ctx, s, e, xy, centre(i), valAt(sc, spec, r.lo + offset), valAt(sc, spec, r.hi + offset), plot);
      });
    });
  }

  // Axes: category axis line + ticks + labels, value axes.
  const crossPx = valAt(scales[0]!, plans[0]!.spec, catCross);
  if (!catAxis.delete && !ctx.thumb) {
    const a0 = xy(catAt(0), crossPx);
    const a1 = xy(catAt(n || 1), crossPx);
    const ticks: string[] = [];
    const tickDir = (() => {
      const frac = scaleFraction(scales[0]!, catCross);
      const atHigh = frac >= 1 - 1e-9 && catAxis.tickLabels !== "low";
      const rev = !!plans[0]!.spec?.reverse;
      return (atHigh !== rev ? -1 : 1) * (horizontal ? -1 : 1);
    })();
    for (let t = 0; t <= n; t++) {
      const c = edges ? catAt(pointT(Math.min(t, n - 1))) : catAt(t);
      if (edges && t === n) break;
      ticks.push(polyPath([xy(c, crossPx), xy(c, crossPx + tickDir * TICK)]));
    }
    const catStroke = catAxis.line ? strokeOf(ctx, catAxis.line, AXIS_COLOR) : { stroke: AXIS_COLOR, lineWidth: 1 };
    if (catStroke.stroke) b.path(`${polyPath([a0, a1])} ${ticks.join(" ")}`, catStroke, { type: "axis", axis: "cat" });
    if (table) {
      drawDataTable(ctx, table, tableStyle, plot, cats, n, tableRowH, tableNameW, tableKeyW, (t) => catAt(t));
    } else if (shows(catAxis)) {
      const low = catAxis.tickLabels === "low";
      const high = catAxis.tickLabels === "high";
      const labelPos = low ? valAt(scales[0]!, plans[0]!.spec, plans[0]!.spec?.reverse ? scales[0]!.max : scales[0]!.min) : high ? valAt(scales[0]!, plans[0]!.spec, plans[0]!.spec?.reverse ? scales[0]!.min : scales[0]!.max) : crossPx;
      const dir = low ? (horizontal ? -1 : 1) : high ? (horizontal ? 1 : -1) : tickDir;
      const maxW = maxCatW;
      const rot = catRotation(plot);
      const step = horizontal ? labelStep(n, labelH, catLen, 0) : rot ? labelStep(n, labelH, catLen, 0) : labelStep(n, maxW, catLen);
      let hitBox: Box | null = null;
      const el: ChartElement = { type: "axis", axis: "cat" };
      for (let i = 0; i < n; i += step) {
        const c = catAt(pointT(i));
        if (horizontal) {
          const x = labelPos + dir * (TICK + 2);
          b.text(cats[i]!, x, c, { ...catStyle, align: dir < 0 ? "right" : "left", baseline: "middle", ...(rot ? { rotate: rot } : {}) }, el);
        } else if (rot) {
          // Rotated labels end at their tick (Excel): negative angles read upwards.
          const y = labelPos + dir * (TICK + 2);
          const align = (rot < 0) === dir > 0 ? "right" : "left";
          b.text(cats[i]!, c, y, { ...catStyle, align, baseline: "middle", rotate: rot }, el);
        } else {
          const y = labelPos + dir * (TICK + 2);
          b.text(cats[i]!, c, y, { ...catStyle, align: "center", baseline: dir > 0 ? "top" : "bottom" }, el);
        }
      }
      const labelExtent = rot && !horizontal ? rotatedHeight(rot) : labelH;
      if (horizontal) {
        const x = dir < 0 ? labelPos - TICK - 2 - maxW : labelPos;
        hitBox = { x, y: plot.y, w: maxW + TICK + 2, h: plot.h };
      } else {
        const y = dir > 0 ? labelPos : labelPos - TICK - 2 - labelExtent;
        hitBox = { x: plot.x, y, w: plot.w, h: labelExtent + TICK + 2 };
      }
      b.hit(el, { kind: "rect", ...hitBox });
    } else {
      const [x0, y0] = a0;
      const [x1, y1] = a1;
      b.hit({ type: "axis", axis: "cat" }, { kind: "polyline", points: [x0, y0, x1, y1], width: 6 });
    }
  }
  const catTitle = axisTitleText(ctx, catAxis);
  if (catTitle && !catAxis.delete) {
    if (horizontal) placeAxisTitle(ctx, "cat", catTitle, box.x + AXIS_TITLE_PX * 0.6, plot.y + plot.h / 2, -90);
    else placeAxisTitle(ctx, "cat", catTitle, plot.x + plot.w / 2, box.y + box.h - AXIS_TITLE_PX * 0.6, 0);
  }
  plans.forEach((plan, i) => {
    const sc = scales[i]!;
    const valueCross = plan.id === "val" ? plan.spec?.crosses?.type === "max" : plan.spec?.crosses?.type !== "min";
    const atHigh = valueCross !== !!catAxis.reverse;
    const side = valSide(plan, plan.spec?.crosses?.type === "max");
    drawValueAxis(ctx, plan, sc, plot, horizontal, atHigh, side, box, (v) => valAt(sc, plan.spec, v));
  });

  // Data labels and trendlines on top.
  for (const s of series) {
    const { sc, spec, stack } = scaleFor(s);
    const segs = stack.seg.get(s.index) ?? [];
    if (anyLabels(s.labels)) {
      const totals = Array.from({ length: n }, (_, i) => series.filter((o) => o.family === s.family).reduce((sum, o) => sum + Math.abs(valueAt(ctx, o, i) ?? 0), 0));
      for (let i = 0; i < n; i++) {
        const raw = valueAt(ctx, s, i);
        const sg = segs[i];
        const pl = pointLabels(s, i);
        if (raw === null || !sg || !pl) continue;
        const text = labelText(ctx, s, pl, i, raw, totals[i] ? Math.abs(raw) / totals[i]! : 0, cats[i]!);
        const top = valAt(sc, spec, stacked(s.grouping) ? sg[1] : raw, true);
        const base = valAt(sc, spec, stacked(s.grouping) ? sg[0] : catCross, true);
        let c = catAt(pointT(i));
        if (s.family === "bar" && !stacked(s.grouping)) {
          const list = barSeries.filter((o) => o.secondary === s.secondary);
          const j = list.indexOf(s);
          const ov = (chart.overlap ?? 0) / 100;
          const bw = band / (list.length - (list.length - 1) * ov + gap);
          const start = i * band + (gap / 2) * bw + j * bw * (1 - ov);
          c = catAt(((start + bw / 2) / catLen) * n);
        }
        placeValueLabel(ctx, s, pl, text, i, c, top, base, horizontal, raw < 0 !== !!spec?.reverse);
      }
    }
    if (s.spec.trendline && n > 1) {
      const xs = Array.from({ length: n }, (_, i) => i + 1);
      const toPx = (x: number, y: number) => xy(catAt(pointT(x - 1)), valAt(sc, spec, y));
      drawTrendline(ctx, s, xs, s.data.values.slice(0, n), 1, n, toPx, plot);
    }
  }
  return plot;
}

function drawValueGridlines(ctx: Ctx, plan: ValueAxisPlan, sc: ValueScale, plot: Box, horizontal: boolean, at: (v: number) => number): void {
  const b = ctx.b;
  const line = (v: number): [number, number, number, number] => {
    const p = at(v);
    return horizontal ? [p, plot.y, p, plot.y + plot.h] : [plot.x, p, plot.x + plot.w, p];
  };
  const draw = (values: number[], minor: boolean) => {
    if (!values.length) return;
    const el: ChartElement = { type: "gridlines", axis: plan.id, ...(minor ? { minor: true } : {}) };
    const d = values.map((v) => {
      const [x0, y0, x1, y1] = line(v);
      b.hit(el, { kind: "polyline", points: [x0, y0, x1, y1], width: 5 });
      return polyPath([[x0, y0], [x1, y1]]);
    });
    b.path(d.join(" "), { stroke: minor ? "#F2F2F2" : GRID_COLOR, lineWidth: 1 }, el);
  };
  if (plan.spec?.minorGridlines) draw(minorTicks(sc), true);
  if (plan.spec?.majorGridlines) draw(sc.ticks, false);
}

function placeAxisTitle(ctx: Ctx, axis: AxisId, text: string, x: number, y: number, rotate: number): void {
  const b = ctx.b;
  const t = ctx.chart.axes[axis]?.title;
  const st = textStyle(ctx, AXIS_TITLE_PX, true, t?.textFormat);
  const rot = t?.textFormat?.rotation ?? rotate;
  if (t?.layout) {
    const at = layoutBox(ctx, t.layout, { w: 0, h: 0 });
    [x, y] = [at.x, at.y];
  }
  b.text(text, x, y, { ...st, align: "center", baseline: "middle", rotate: rot }, { type: "axisTitle", axis });
  rotate = rot;
  const w = ctx.measure(text, st.size, !!st.bold) + 6;
  const h = st.size * LINE + 2;
  b.hit({ type: "axisTitle", axis }, rotate ? { kind: "rect", x: x - h / 2, y: y - w / 2, w: h, h: w } : { kind: "rect", x: x - w / 2, y: y - h / 2, w, h });
}

/** A value axis: line (only without gridlines), tick labels on `side`, title. */
function drawValueAxis(
  ctx: Ctx, plan: ValueAxisPlan, sc: ValueScale, plot: Box, horizontal: boolean, atHigh: boolean, side: "low" | "high", box: Box, at: (v: number) => number,
): void {
  const spec = plan.spec;
  const b = ctx.b;
  if (spec?.delete || ctx.thumb) return;
  const el: ChartElement = { type: "axis", axis: plan.id };
  const linePos = horizontal ? (atHigh ? plot.y : plot.y + plot.h) : atHigh ? plot.x + plot.w : plot.x;
  const ends: [number, number][] = horizontal ? [[plot.x, linePos], [plot.x + plot.w, linePos]] : [[linePos, plot.y], [linePos, plot.y + plot.h]];
  if (spec?.line) {
    const st = strokeOf(ctx, spec.line, AXIS_COLOR);
    if (st.stroke) b.path(polyPath(ends), st, el);
  } else if (!spec?.majorGridlines) b.path(polyPath(ends), { stroke: AXIS_COLOR, lineWidth: 1 }, el);
  const labelEdge = horizontal ? (side === "high" ? plot.y : plot.y + plot.h) : side === "high" ? plot.x + plot.w : plot.x;
  const st = textStyle(ctx, LABEL_PX, false, spec?.textFormat);
  const labelH = st.size * LINE;
  let maxW = 0;
  if (spec?.tickLabels !== "none") {
    for (const t of sc.ticks) {
      const text = ctx.fmt(t, plan.code);
      maxW = Math.max(maxW, ctx.measure(text, st.size, !!st.bold));
      const p = at(t);
      if (horizontal) b.text(text, p, labelEdge + (side === "high" ? -4 : 4), { ...st, align: "center", baseline: side === "high" ? "bottom" : "top" }, el);
      else b.text(text, labelEdge + (side === "high" ? 6 : -6), p, { ...st, align: side === "high" ? "left" : "right", baseline: "middle" }, el);
    }
    const hb: Box = horizontal
      ? { x: plot.x, y: side === "high" ? labelEdge - labelH - 4 : labelEdge, w: plot.w, h: labelH + 4 }
      : { x: side === "high" ? labelEdge : labelEdge - maxW - 8, y: plot.y - labelH / 2, w: maxW + 8, h: plot.h + labelH };
    b.hit(el, { kind: "rect", ...hb });
  } else {
    b.hit(el, { kind: "polyline", points: ends.flat(), width: 6 });
  }
  const title = axisTitleText(ctx, spec);
  if (title) {
    if (horizontal) {
      const y = side === "high" ? box.y + AXIS_TITLE_PX * 0.6 : box.y + box.h - AXIS_TITLE_PX * 0.6;
      placeAxisTitle(ctx, plan.id, title, plot.x + plot.w / 2, y, 0);
    } else {
      const x = side === "high" ? box.x + box.w - AXIS_TITLE_PX * 0.6 : box.x + AXIS_TITLE_PX * 0.6;
      placeAxisTitle(ctx, plan.id, title, x, plot.y + plot.h / 2, -90);
    }
  }
}

function drawLineSeries(ctx: Ctx, s: SeriesInfo, pts: ([number, number] | null)[], plot: Box): void {
  const b = ctx.b;
  const el: ChartElement = { type: "series", series: s.index };
  const span = ctx.chart.displayBlanksAs === "span";
  const runs: [number, number][][] = [];
  let run: [number, number][] = [];
  for (const p of pts) {
    if (p) run.push(p);
    else if (!span && run.length) {
      runs.push(run);
      run = [];
    }
  }
  if (run.length) runs.push(run);
  if (s.stroke) {
    const d = runs.map((r) => (s.smooth ? smoothPath(r) : polyPath(r))).join(" ");
    b.path(d, { stroke: s.stroke, lineWidth: s.lineWidth, dash: s.dash, join: "round", cap: "round", clip: plot }, el);
  }
  for (const r of runs) b.hit(el, { kind: "polyline", points: r.flat(), width: Math.max(6, s.lineWidth + 4) });
  pts.forEach((p, i) => {
    if (!p) return;
    const dp = s.spec.dataPoints?.find((q) => q.idx === i);
    const m = dp?.marker ? markerStyle(dp.marker, s.marker?.fill ?? s.color, ctx.theme, true) : s.marker;
    if (!m || p[0] < plot.x - 1 || p[0] > plot.x + plot.w + 1 || p[1] < plot.y - 1 || p[1] > plot.y + plot.h + 1) return;
    const pel: ChartElement = { type: "series", series: s.index, point: i };
    drawMarker(b, m, p[0], p[1], pel);
    b.hit(pel, { kind: "circle", cx: p[0], cy: p[1], r: Math.max(4, m.size / 2 + 1) });
  });
}

/** Whether a series shows labels on any point. */
const anyLabels = (d: DataLabels | undefined) => labelsShown(d) || !!d?.points?.some((p) => !p.delete);

/** The labels of point `i`: the series' (or chart's) labels with the point's own label over them (`null`: none). */
function pointLabels(s: SeriesInfo, i: number): DataLabels | null {
  const base = s.labels;
  const p = base?.points?.find((x) => x.idx === i);
  if (p?.delete) return null;
  if (p) {
    const d: DataLabels = {
      showValue: p.showValue, showPercent: p.showPercent, showCategory: p.showCategory, showSeries: p.showSeries, showRange: p.showRange,
      position: p.position ?? base?.position, numberFormat: p.numberFormat ?? base?.numberFormat, textFormat: p.textFormat ?? base?.textFormat,
    };
    if (p.layout) (d as DataLabels & { layout?: ManualLayout }).layout = p.layout;
    if (base?.leaderLines) d.leaderLines = true;
    return labelsShown(d) ? d : null;
  }
  return labelsShown(base) ? base! : null;
}

function labelText(ctx: Ctx, s: SeriesInfo, d: DataLabels, i: number, value: number, percent: number, category: string): string {
  const parts: string[] = [];
  if (d.showRange) {
    const t = s.data.labelTexts?.[i];
    if (t) parts.push(t);
  }
  if (d.showSeries) parts.push(s.data.name);
  if (d.showCategory) parts.push(category);
  if (d.showValue) parts.push(ctx.fmt(value, d.numberFormat ?? s.data.formatCode ?? "General"));
  if (d.showPercent) parts.push(ctx.fmt(percent, "0%"));
  return parts.join(", ");
}

/** A data label of a bar/line/area point: `top`/`base` are the value-axis px of the point and its bar base. */
function placeValueLabel(
  ctx: Ctx, s: SeriesInfo, d: DataLabels, text: string, i: number, c: number, top: number, base: number, horizontal: boolean, negative: boolean,
): void {
  if (!text) return;
  const b = ctx.b;
  const el: ChartElement = { type: "dataLabels", series: s.index, point: i };
  const fallback: LabelPosition = s.family === "bar" ? (stacked(s.grouping) ? "center" : "outsideEnd") : s.family === "area" ? "center" : "right";
  const pos = d.position ?? fallback;
  const st = textStyle(ctx, LABEL_PX, false, d.textFormat);
  const w = ctx.measure(text, st.size, !!st.bold);
  const h = st.size * LINE;
  const manual = (d as DataLabels & { layout?: ManualLayout }).layout;
  if (manual) {
    // Moved by hand: centred on the layout point, with a leader line from the data point.
    const at = layoutBox(ctx, manual, { w, h });
    const [px0, py0] = horizontal ? [top, c] : [c, top];
    if (d.leaderLines) b.path(polyPath([[px0, py0], [at.x, at.y]]), { stroke: "#A6A6A6", lineWidth: 1 }, el);
    b.text(text, at.x, at.y, { ...st, align: "center", baseline: "middle" }, el);
    b.hit(el, { kind: "rect", x: at.x - w / 2 - 2, y: at.y - h / 2, w: w + 4, h });
    return;
  }
  // Direction from the base toward the value, in px along the value axis.
  const dir = horizontal ? (negative ? -1 : 1) : negative ? 1 : -1;
  let along = top;
  const across = c;
  let dx = 0;
  let dy = 0;
  if (s.family === "bar" || s.family === "area") {
    const off = horizontal ? w / 2 + 4 : h / 2 + 3;
    if (pos === "outsideEnd") along = top + dir * off;
    else if (pos === "insideEnd") along = top - dir * off;
    else if (pos === "insideBase") along = base + dir * off;
    else along = (top + base) / 2;
  } else {
    if (pos === "right") dx = w / 2 + 6;
    else if (pos === "left") dx = -(w / 2 + 6);
    else if (pos === "top") dy = -(h / 2 + 4);
    else if (pos === "bottom") dy = h / 2 + 4;
  }
  let [x, y] = horizontal ? [along, across] : [across, along];
  x += dx;
  y += dy;
  b.text(text, x, y, { ...st, align: "center", baseline: "middle" }, el);
  b.hit(el, { kind: "rect", x: x - w / 2 - 2, y: y - h / 2, w: w + 4, h });
}

function drawTrendline(
  ctx: Ctx, s: SeriesInfo, xs: number[], ys: (number | null)[], xMin: number, xMax: number, toPx: (x: number, y: number) => [number, number], plot: Box,
): void {
  const t = s.spec.trendline!;
  const b = ctx.b;
  const el: ChartElement = { type: "trendline", series: s.index };
  const lineWidth = t.line?.width ? t.line.width / EMU_PER_PX : 1.5 * PT;
  const color = t.line?.color ? resolveColor(t.line.color, ctx.theme) : s.color;
  const dash = dashPattern(t.line?.dash ?? "sysDot", lineWidth);
  let pts: [number, number][] = [];
  let label: string[] = [];
  if (t.kind.type === "movingAverage") {
    pts = movingAverage(xs, ys, t.kind.period).map(([x, y]) => toPx(x, y));
  } else {
    const ok = xs.map((x, i) => [x, ys[i]] as const).filter((p): p is readonly [number, number] => p[1] !== null && p[1] !== undefined);
    const fit = fitTrend(t.kind, ok.map((p) => p[0]), ok.map((p) => p[1]));
    if (!fit) return;
    const steps = 48;
    for (let k = 0; k <= steps; k++) {
      const x = xMin + ((xMax - xMin) * k) / steps;
      const y = fit.at(x);
      if (Number.isFinite(y)) pts.push(toPx(x, y));
    }
    if (t.displayEquation) label.push(trendEquation(t.kind, fit));
    if (t.displayRSquared) label.push(rSquaredLabel(fit.r2));
  }
  if (pts.length < 2) return;
  b.path(polyPath(pts), { stroke: color, lineWidth, dash, clip: plot }, el);
  b.hit(el, { kind: "polyline", points: pts.flat(), width: 6 });
  if (label.length && !ctx.thumb) {
    const [ex, ey] = pts[pts.length - 1]!;
    label = label.filter(Boolean);
    label.forEach((text, k) => {
      const w = ctx.measure(text, LABEL_PX, false);
      const x = Math.min(plot.x + plot.w - w / 2, Math.max(plot.x + w / 2, ex - w / 2));
      const y = Math.max(plot.y + LABEL_PX, ey - 10 - (label.length - 1 - k) * LABEL_PX * LINE);
      b.text(text, x, y, { size: LABEL_PX, align: "center", baseline: "bottom" }, el);
    });
  }
}

// --- error bars, up/down bars, high-low lines, data tables (P9-C6) ---------------------------------

/** The error range of every point: `lo..hi` in data units around `at` (absent: the point's value). */
export function errorRanges(
  e: NonNullable<Series["errorBars"]>[number], values: (number | null | undefined)[], custom: { plus?: (number | null)[]; minus?: (number | null)[] } | undefined,
): ({ lo: number; hi: number; at?: number } | null)[] {
  const ok = values.filter((v): v is number => v !== null && v !== undefined && Number.isFinite(v));
  const n = ok.length;
  const mean = n ? ok.reduce((a, v) => a + v, 0) / n : 0;
  // Excel: sample standard deviation; standard error sqrt(Σ(y − ȳ)² / (n (n − 1))).
  const ss = ok.reduce((a, v) => a + (v - mean) ** 2, 0);
  const sd = n > 1 ? Math.sqrt(ss / (n - 1)) : 0;
  const se = n > 1 ? Math.sqrt(ss / (n * (n - 1))) : 0;
  const literal = (d: DataRef | undefined) => (d?.type === "literal" ? d.values.map((v) => (typeof v === "number" ? v : null)) : d?.type === "ref" ? d.cache?.map((v) => (typeof v === "number" ? v : null)) : undefined);
  const plusList = custom?.plus ?? (e.amount.type === "custom" ? literal(e.amount.plus) : undefined);
  const minusList = custom?.minus ?? (e.amount.type === "custom" ? literal(e.amount.minus) : undefined);
  const type = e.barType ?? "both";
  return values.map((v, i) => {
    if (v === null || v === undefined || !Number.isFinite(v)) return null;
    let plus = 0;
    let minus = 0;
    let at: number | undefined;
    switch (e.amount.type) {
      case "fixed":
        plus = minus = Math.abs(e.amount.value);
        break;
      case "percentage":
        plus = minus = (Math.abs(v) * Math.abs(e.amount.value)) / 100;
        break;
      case "stdDev":
        plus = minus = Math.abs(e.amount.value) * sd;
        at = mean;
        break;
      case "stdErr":
        plus = minus = se;
        break;
      case "custom": {
        // A single value applies to every point (Excel's `={1}`).
        const pick = (l: (number | null)[] | undefined) => (l ? (l.length === 1 ? l[0] : l[i]) : null) ?? 0;
        plus = Math.abs(pick(plusList));
        minus = Math.abs(pick(minusList));
        break;
      }
    }
    const c = at ?? v;
    return { lo: type === "plus" ? c : c - minus, hi: type === "minus" ? c : c + plus, ...(at !== undefined ? { at } : {}) };
  });
}

const ERROR_COLOR = "#595959";

/** One error bar from value px `v0` to `v1` at category px `c` (`xy` maps (category, value) to x, y). */
function drawErrorBar(
  ctx: Ctx, s: SeriesInfo, e: NonNullable<Series["errorBars"]>[number], xy: (c: number, v: number) => [number, number], c: number, v0: number, v1: number, plot: Box,
): void {
  const st = strokeOf(ctx, e.line, ERROR_COLOR);
  if (!st.stroke) return;
  const el: ChartElement = { type: "errorBars", series: s.index };
  const cap = 3.5;
  const parts = [polyPath([xy(c, v0), xy(c, v1)])];
  if (!e.noEndCap) {
    const type = e.barType ?? "both";
    if (type !== "plus") parts.push(polyPath([xy(c - cap, v0), xy(c + cap, v0)]));
    if (type !== "minus") parts.push(polyPath([xy(c - cap, v1), xy(c + cap, v1)]));
  }
  ctx.b.path(parts.join(" "), { ...st, clip: plot }, el);
  ctx.b.hit(el, { kind: "polyline", points: [...xy(c, v0), ...xy(c, v1)], width: 6 });
}

/** Line charts: high-low lines (lowest to highest value per category) and up/down bars (first → last series). */
function drawLineExtras(
  ctx: Ctx, series: SeriesInfo[], n: number, band: number, catPx: (i: number) => number, valPx: (s: SeriesInfo, v: number) => number,
  xy: (c: number, v: number) => [number, number],
): void {
  const { chart, b } = ctx;
  const lines = series.filter((s) => s.family === "line" && !s.secondary);
  if (!lines.length || (!chart.highLowLines && !chart.upDownBars)) return;
  if (chart.highLowLines) {
    const st = strokeOf(ctx, chart.highLowLines, "#404040");
    const el: ChartElement = { type: "highLowLines" };
    const parts: string[] = [];
    for (let i = 0; i < n; i++) {
      const vs = lines.map((s) => valueAt(ctx, s, i)).filter((v): v is number => v !== null);
      if (vs.length < 2) continue;
      const c = catPx(i);
      const p0 = xy(c, valPx(lines[0]!, Math.min(...vs)));
      const p1 = xy(c, valPx(lines[0]!, Math.max(...vs)));
      parts.push(polyPath([p0, p1]));
      b.hit(el, { kind: "polyline", points: [...p0, ...p1], width: 6 });
    }
    if (st.stroke && parts.length) b.path(parts.join(" "), st, el);
  }
  const ud = chart.upDownBars;
  if (ud && lines.length >= 2) {
    const first = lines[0]!;
    const last = lines[lines.length - 1]!;
    const bw = band / (1 + (ud.gapWidth ?? 150) / 100);
    const el: ChartElement = { type: "upDownBars" };
    for (let i = 0; i < n; i++) {
      const a = valueAt(ctx, first, i);
      const z = valueAt(ctx, last, i);
      if (a === null || z === null || a === z) continue;
      const up = z > a;
      const shape = up ? ud.up : ud.down;
      const paint = areaPaint(ctx, shape?.fill, { x: 0, y: 0, w: 0, h: 0 });
      const fill = paint === undefined ? (up ? "#FFFFFF" : "#595959") : (paint?.fill ?? undefined);
      const stroke = strokeOf(ctx, shape?.line, "#595959");
      const c = catPx(i);
      const [x0, y0] = xy(c - bw / 2, valPx(first, a));
      const [x1, y1] = xy(c + bw / 2, valPx(first, z));
      const box = { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
      b.rect(box.x, box.y, box.w, box.h, { ...(fill ? { fill } : {}), ...stroke }, el);
      b.hit(el, { kind: "rect", ...box });
    }
  }
}

/** The data table under the plot area: categories as column heads, one row per series (legend key, name, values). */
function drawDataTable(
  ctx: Ctx, t: NonNullable<Chart["dataTable"]>, st: TextStyle, plot: Box, cats: string[], n: number, rowH: number, nameW: number, keyW: number, catAt: (t: number) => number,
): void {
  const { b, series } = ctx;
  const el: ChartElement = { type: "dataTable" };
  const top = plot.y + plot.h;
  const left = plot.x - nameW;
  const right = plot.x + plot.w;
  const rows = series.length + 1;
  const bottom = top + rows * rowH;
  const lines: string[] = [];
  const edges = Array.from({ length: n + 1 }, (_, k) => catAt(k)).sort((a, z) => a - z);
  if (t.horizontal ?? true) for (let r = 1; r < rows; r++) lines.push(polyPath([[left, top + r * rowH], [right, top + r * rowH]]));
  if (t.vertical ?? true) for (const x of edges.slice(1, -1)) lines.push(polyPath([[x, top], [x, bottom]]));
  if (t.outline ?? true) {
    lines.push(polyPath([[plot.x, top], [right, top], [right, bottom], [left, bottom], [left, top + rowH], [plot.x, top + rowH], [plot.x, top]], false));
    lines.push(polyPath([[plot.x, top + rowH], [plot.x, bottom]]));
  }
  if (lines.length) b.path(lines.join(" "), { stroke: AXIS_COLOR, lineWidth: 1 }, el);
  for (let i = 0; i < n; i++) {
    const cx = (catAt(i) + catAt(i + 1)) / 2;
    b.text(cats[i] ?? "", cx, top + rowH / 2, { ...st, align: "center", baseline: "middle" }, el);
  }
  series.forEach((s, r) => {
    const y = top + (r + 1.5) * rowH;
    let x = left + 4;
    if (t.keys) {
      const line = s.family === "line" || s.family === "scatter";
      if (line && s.stroke) b.path(polyPath([[x, y], [x + KEY, y]]), { stroke: s.stroke, lineWidth: 2 }, el);
      else b.rect(x, y - KEY / 2, KEY, KEY, { fill: s.fill ?? undefined }, el);
      x += keyW;
    }
    b.text(s.data.name, x, y, { ...st, align: "left", baseline: "middle" }, el);
    for (let i = 0; i < n; i++) {
      const v = s.data.values[i];
      if (v === null || v === undefined) continue;
      const cx = (catAt(i) + catAt(i + 1)) / 2;
      b.text(ctx.fmt(v, s.data.formatCode ?? "General"), cx, y, { ...st, align: "center", baseline: "middle" }, el);
    }
  });
  b.hit(el, { kind: "rect", x: left, y: top, w: right - left, h: bottom - top });
}

// --- scatter -------------------------------------------------------------------------------------

function layoutScatter(ctx: Ctx, box: Box): Box {
  const { chart, b, series } = ctx;
  const xAxis = chart.axes.cat;
  const yAxis = chart.axes.val;
  const pairs = series.map((s) => {
    const xv = s.data.xValues ?? s.data.values.map((_, i) => i + 1);
    return s.data.values.map((y, i) => {
      const x = xv[i];
      const yy = y === null || y === undefined ? (chart.displayBlanksAs === "zero" ? 0 : null) : y;
      return x === null || x === undefined || yy === null ? null : ([x, yy] as [number, number]);
    });
  });
  const all = pairs.flat().filter((p): p is [number, number] => p !== null);
  const ext = (k: 0 | 1, list = all): [number | null, number | null] => (list.length ? [Math.min(...list.map((p) => p[k])), Math.max(...list.map((p) => p[k]))] : [null, null]);
  const [x0, x1] = ext(0);
  const primaryPts = pairs.filter((_, i) => !series[i]!.secondary).flat().filter((p): p is [number, number] => p !== null);
  const [y0, y1] = ext(1, primaryPts.length ? primaryPts : all);
  const yCode = tickCode(ctx, yAxis, series, false);
  const xCode = xAxis.numberFormat ?? series.find((s) => s.data.categoryFormatCode)?.data.categoryFormatCode ?? "General";
  const shows = (a: Axis | undefined) => !ctx.thumb && !a?.delete && a?.tickLabels !== "none";
  const labelH = LABEL_PX * LINE;
  const titleH = AXIS_TITLE_PX * LINE + 4;
  const scales = (p: Box) => ({
    xs: valueScale(x0, x1, p.w, false, scaleOptions(xAxis, false, ctx.excelScale)),
    ys: valueScale(y0, y1, p.h, true, scaleOptions(yAxis, false, ctx.excelScale)),
  });
  const reserve = (p: Box) => {
    const { ys } = scales(p);
    let left = 0;
    let bottom = 0;
    if (shows(yAxis)) left += Math.max(...ys.ticks.map((t) => ctx.measure(ctx.fmt(t, yCode), LABEL_PX, false))) + 8;
    if (axisTitleText(ctx, yAxis)) left += titleH;
    if (shows(xAxis)) bottom += labelH + 4;
    if (axisTitleText(ctx, xAxis)) bottom += titleH;
    return { left, bottom };
  };
  const inset = ctx.thumb ? 2 : 6;
  const plotFrom = (r: { left: number; bottom: number }): Box => ({
    x: box.x + r.left + 2, y: box.y + inset, w: Math.max(4, box.w - r.left - (ctx.thumb ? 4 : 12)), h: Math.max(4, box.h - r.bottom - inset - 2),
  });
  let plot = plotFrom(reserve(box));
  plot = plotFrom(reserve(plot));
  if (chart.plotLayout) plot = layoutBox(ctx, chart.plotLayout, plot);
  const { xs, ys } = scales(plot);
  ctx.axes.cat = sceneAxis(xs);
  ctx.axes.val = sceneAxis(ys);
  b.hit({ type: "plotArea" }, { kind: "rect", ...plot });
  drawPlotArea(ctx, plot, chart.plotArea);
  const px = (x: number) => {
    let f = scaleFraction(xs, x);
    if (xAxis.reverse) f = 1 - f;
    return plot.x + f * plot.w;
  };
  const py = (y: number) => {
    let f = scaleFraction(ys, y);
    if (yAxis.reverse) f = 1 - f;
    return plot.y + plot.h - f * plot.h;
  };
  const planY: ValueAxisPlan = { id: "val", spec: yAxis, list: series, stack: { seg: new Map(), min: y0, max: y1, percent: false }, code: yCode };
  const planX: ValueAxisPlan = { id: "cat", spec: xAxis, list: series, stack: { seg: new Map(), min: x0, max: x1, percent: false }, code: xCode };
  drawValueGridlines(ctx, planX, xs, plot, true, px);
  drawValueGridlines(ctx, planY, ys, plot, false, py);
  series.forEach((s, i) => {
    const pts = pairs[i]!.map((p) => (p ? ([px(p[0]), py(p[1])] as [number, number]) : null));
    drawLineSeries(ctx, s, pts, plot);
  });
  // Error bars: Y bars along the value axis, X bars along the X axis.
  series.forEach((s, si) => {
    s.spec.errorBars?.forEach((e, k) => {
      const xDir = e.direction === "x";
      const vals = pairs[si]!.map((p) => (p ? p[xDir ? 0 : 1] : null));
      errorRanges(e, vals, s.data.errorBars?.[k]).forEach((r, i) => {
        const p = pairs[si]![i];
        if (!r || !p) return;
        const off = p[xDir ? 0 : 1] - (r.at ?? p[xDir ? 0 : 1]);
        if (xDir) drawErrorBar(ctx, s, e, (c, v) => [v, c], py(p[1]), px(r.lo + off), px(r.hi + off), plot);
        else drawErrorBar(ctx, s, e, (c, v) => [c, v], px(p[0]), py(r.lo + off), py(r.hi + off), plot);
      });
    });
  });
  // Axes: X crosses Y at `cat.crosses`, Y crosses X at `val.crosses`.
  const yAt = py(crossValue(ys, xAxis.crosses));
  const xAt = px(crossValue(xs, yAxis.crosses));
  if (!ctx.thumb) {
    const xAtHigh = Math.abs(yAt - plot.y) < 0.5;
    const yAtHigh = Math.abs(xAt - (plot.x + plot.w)) < 0.5;
    if (!xAxis.delete) {
      b.path(polyPath([[plot.x, yAt], [plot.x + plot.w, yAt]]), { stroke: AXIS_COLOR, lineWidth: 1 }, { type: "axis", axis: "cat" });
      if (shows(xAxis)) {
        for (const t of xs.ticks) b.text(ctx.fmt(t, xCode), px(t), plot.y + plot.h + 4, { size: LABEL_PX, align: "center", baseline: "top" }, { type: "axis", axis: "cat" });
        b.hit({ type: "axis", axis: "cat" }, { kind: "rect", x: plot.x, y: plot.y + plot.h, w: plot.w, h: labelH + 4 });
      }
    }
    if (!yAxis.delete) {
      if (!yAxis.majorGridlines) b.path(polyPath([[xAt, plot.y], [xAt, plot.y + plot.h]]), { stroke: AXIS_COLOR, lineWidth: 1 }, { type: "axis", axis: "val" });
      if (shows(yAxis)) {
        let maxW = 0;
        for (const t of ys.ticks) {
          const text = ctx.fmt(t, yCode);
          maxW = Math.max(maxW, ctx.measure(text, LABEL_PX, false));
          b.text(text, plot.x - 6, py(t), { size: LABEL_PX, align: "right", baseline: "middle" }, { type: "axis", axis: "val" });
        }
        b.hit({ type: "axis", axis: "val" }, { kind: "rect", x: plot.x - maxW - 8, y: plot.y - labelH / 2, w: maxW + 8, h: plot.h + labelH });
      }
    }
    void xAtHigh;
    void yAtHigh;
    const xt = axisTitleText(ctx, xAxis);
    if (xt && !xAxis.delete) placeAxisTitle(ctx, "cat", xt, plot.x + plot.w / 2, box.y + box.h - AXIS_TITLE_PX * 0.6, 0);
    const yt = axisTitleText(ctx, yAxis);
    if (yt && !yAxis.delete) placeAxisTitle(ctx, "val", yt, box.x + AXIS_TITLE_PX * 0.6, plot.y + plot.h / 2, -90);
  }
  series.forEach((s, si) => {
    if (anyLabels(s.labels)) {
      pairs[si]!.forEach((p, i) => {
        const pl = pointLabels(s, i);
        if (!p || !pl) return;
        const text = labelText(ctx, s, pl, i, p[1], 0, ctx.fmt(p[0], xCode));
        placeValueLabel(ctx, s, pl, text, i, py(p[1]), px(p[0]), px(p[0]), true, false);
      });
    }
    if (s.spec.trendline) {
      const ok = pairs[si]!.filter((p): p is [number, number] => p !== null);
      if (ok.length > 1) {
        const sorted = [...ok].sort((a, c) => a[0] - c[0]);
        drawTrendline(ctx, s, sorted.map((p) => p[0]), sorted.map((p) => p[1]), sorted[0]![0], sorted[sorted.length - 1]![0], (x, y) => [px(x), py(y)], plot);
      }
    }
  });
  return plot;
}

// --- pie and doughnut ----------------------------------------------------------------------------

function layoutPie(ctx: Ctx, box: Box, doughnut: boolean): Box {
  const { chart, b, series } = ctx;
  const list = doughnut ? series : series.slice(0, 1);
  const d = 0.75 * Math.min(box.w, box.h) * (ctx.thumb ? 1.25 : 1);
  const R = d / 2;
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const plot: Box = { x: cx - R, y: cy - R, w: d, h: d };
  b.hit({ type: "plotArea" }, { kind: "rect", ...box });
  const hole = doughnut ? (Math.min(90, Math.max(10, chart.holeSize ?? 50)) / 100) * R : 0;
  const ringW = list.length ? (R - hole) / list.length : 0;
  const start = (((chart.firstSliceAngle ?? 0) % 360) * Math.PI) / 180;
  list.forEach((s, ri) => {
    const vals = s.data.values.map((v) => (v !== null && v !== undefined && v > 0 ? v : 0));
    const total = vals.reduce((a, v) => a + v, 0);
    if (total <= 0) return;
    const colors = pointColors(ctx, s, vals.length);
    const r0 = doughnut ? hole + ri * ringW : 0;
    const r1 = doughnut ? hole + (ri + 1) * ringW : R;
    let a = start;
    vals.forEach((v, i) => {
      if (v <= 0) return;
      const a1 = a + (v / total) * Math.PI * 2;
      const el: ChartElement = { type: "series", series: s.index, point: i };
      const dp = s.spec.dataPoints?.find((p) => p.idx === i);
      const stroke = dp?.line?.none ? null : dp?.line?.color ? resolveColor(dp.line.color, ctx.theme) : s.stroke;
      b.path(sectorPath(cx, cy, r0, r1, a, a1), { fill: colors[i] === "none" ? undefined : colors[i], stroke: stroke ?? undefined, lineWidth: 1, join: "round" }, el);
      b.hit(el, { kind: "sector", cx, cy, r0, r1, a0: a, a1 });
      const pl = anyLabels(s.labels) && !ctx.thumb ? pointLabels(s, i) : null;
      if (pl) {
        const text = labelText(ctx, s, pl, i, s.data.values[i]!, v / total, s.data.categories[i] ?? String(i + 1));
        const mid = (a + a1) / 2;
        const st = textStyle(ctx, LABEL_PX, false, pl.textFormat);
        const tw = ctx.measure(text, st.size, !!st.bold);
        const th = st.size * LINE;
        const pos = pl.position ?? "bestFit";
        let rr: number;
        if (pos === "outsideEnd") rr = r1 + Math.max(tw, th) / 2 + 6;
        else if (pos === "insideEnd") rr = r1 - Math.max(tw, th) / 2 - 4;
        else if (pos === "center" || doughnut) rr = (r0 + r1) / 2;
        else {
          // bestFit: inside when the label fits in the slice, else outside.
          const chord = 2 * ((r0 + r1) / 2) * Math.sin(Math.min(Math.PI / 2, (a1 - a) / 2));
          rr = chord >= tw && r1 - r0 >= th ? (r0 + r1) * 0.6 : r1 + Math.max(tw, th) / 2 + 6;
        }
        let [lx, ly] = polar(cx, cy, rr, mid);
        const lel: ChartElement = { type: "dataLabels", series: s.index, point: i };
        const manual = (pl as DataLabels & { layout?: ManualLayout }).layout;
        if (manual) {
          const at = layoutBox(ctx, manual, { w: tw, h: th });
          const [ex, ey] = polar(cx, cy, r1, mid);
          if (pl.leaderLines) b.path(polyPath([[ex, ey], [at.x, at.y]]), { stroke: "#A6A6A6", lineWidth: 1 }, lel);
          [lx, ly] = [at.x, at.y];
        }
        b.text(text, lx, ly, { ...st, align: "center", baseline: "middle" }, lel);
        b.hit(lel, { kind: "rect", x: lx - tw / 2 - 2, y: ly - th / 2, w: tw + 4, h: th });
      }
      a = a1;
    });
  });
  return plot;
}
