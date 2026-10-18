// Shared chart renderer (docs/charts.md "Rendering rules"): layout to a
// scene, canvas and SVG painters, hit-testing, palette and scaling; and the
// chart UI helpers Calc and Show both use (`./ui`: presets, Quick Layout,
// colours, styles, Format pane edits, ribbon icons, gallery previews).

export type {
  Chart as ChartModel, ChartKind as ChartKindModel, Series as ChartSeriesModel, ResolvedChart as ChartData, ResolvedSeries as ChartSeriesData,
  Axis as ChartAxisModel, DataLabels as ChartDataLabelsModel, LegendPosition as ChartLegendPosition, LabelPosition as ChartLabelPosition,
} from "./model";
export * from "./scene";
export { layoutChart, approxTextWidth, DEFAULT_CHART_LABELS, polyPath, smoothPath, sectorPath, markerPath, dashPattern, errorRanges, type ChartLabels, type ChartLayoutOptions, type TextStyle } from "./layout";
export { drawChartScene, drawChartSelection, setChartImageListener, fontFamily, CHART_FONT } from "./draw";
export { sceneToSvg } from "./svg";
export { hitTestChart, hitShape, elementBounds, selectionMarks } from "./hit";
export { paletteColor, resolveColor, styleColumn, PALETTE_VARIATIONS, type ChartTheme } from "./palette";
export { valueScale, niceUnit, maxIntervals, scaleFraction, labelStep, type ValueScale } from "./scale";
export { fitTrend, movingAverage, trendEquation, type TrendFit } from "./trend";
export { basicFormat, formatGeneral } from "./format";
export { ChartPreview, type ChartPreviewProps } from "./ChartPreview";
export * from "./ui";
