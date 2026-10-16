// Gallery tiles drawn with the shared renderer: chart type icons (sample
// data, no text), live previews of layouts / styles / colours on the
// selected chart's own data.

import { ChartPreview } from "../ChartPreview";
import type { ChartLayoutOptions } from "../layout";
import type { Chart, ResolvedChart } from "../model";
import { applyPreset, type ChartPreset } from "./presets";

const ref = (formula: string) => ({ type: "ref" as const, formula });

/** Three series over four categories (gallery icons). */
export const SAMPLE_CHART: Chart = {
  kind: { type: "bar", direction: "column", grouping: "clustered" },
  series: [{ values: ref("A") }, { values: ref("B") }, { values: ref("C") }],
  axes: { cat: {}, val: {} },
};
export const SAMPLE_DATA: ResolvedChart = {
  series: [
    { name: "A", categories: ["1", "2", "3", "4"], values: [4, 2.5, 3.5, 4.5], xValues: [1, 2, 3, 4] },
    { name: "B", categories: ["1", "2", "3", "4"], values: [2.4, 4.4, 1.8, 2.8], xValues: [1, 2, 3, 4] },
    { name: "C", categories: ["1", "2", "3", "4"], values: [2, 2, 3, 5], xValues: [1, 2, 3, 4] },
  ],
};
const PIE_DATA: ResolvedChart = { series: [{ name: "A", categories: ["1", "2", "3", "4"], values: [5, 3, 2, 2] }, SAMPLE_DATA.series[1]!] };
const SCATTER_DATA: ResolvedChart = {
  series: [
    { name: "B", categories: [], xValues: [1, 2, 3, 4, 5], values: [1.2, 2.6, 2.1, 3.9, 4.4] },
    { name: "C", categories: [], xValues: [1, 2, 3, 4, 5], values: [3.6, 3.1, 4.2, 4.0, 4.8] },
  ],
};
const THUMB: ChartLayoutOptions = { thumbnail: true };

/** The icon of a chart sub-type (Insert galleries, Change Chart Type). */
export function PresetIcon({ preset, width = 56, height = 42 }: { preset: ChartPreset; width?: number; height?: number }) {
  const chart = applyPreset(SAMPLE_CHART, preset);
  if (preset.group === "scatter") chart.series = chart.series.slice(0, 2);
  if (preset.group === "pie") {
    chart.series = chart.series.slice(0, 1);
    if (preset.kind.type === "doughnut") chart.holeSize = 50;
  }
  const data = preset.group === "pie" ? PIE_DATA : preset.group === "scatter" ? SCATTER_DATA : SAMPLE_DATA;
  return <ChartPreview chart={chart} data={data} width={width} height={height} options={THUMB} />;
}

/** A live preview of a chart variant, scaled down from a readable size. */
export function LivePreview({ chart, data, width, height, scale = 2, options }: { chart: Chart; data: ResolvedChart; width: number; height: number; scale?: number; options?: ChartLayoutOptions }) {
  return (
    <span className="inline-block overflow-hidden" style={{ width, height }}>
      <span className="inline-block origin-top-left" style={{ transform: `scale(${1 / scale})` }}>
        <ChartPreview chart={chart} data={data} width={width * scale} height={height * scale} options={options} />
      </span>
    </span>
  );
}
