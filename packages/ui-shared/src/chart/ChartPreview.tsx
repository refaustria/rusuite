// A chart drawn as inline SVG (gallery tiles, dialog previews).

import { useMemo } from "react";
import { layoutChart, type ChartLayoutOptions } from "./layout";
import type { Chart, ResolvedChart } from "./model";
import { sceneToSvg } from "./svg";

export interface ChartPreviewProps {
  chart: Chart;
  data: ResolvedChart;
  width: number;
  height: number;
  options?: ChartLayoutOptions;
  className?: string;
}

export function ChartPreview({ chart, data, width, height, options, className }: ChartPreviewProps) {
  const html = useMemo(() => sceneToSvg(layoutChart(chart, data, width, height, options)), [chart, data, width, height, options]);
  return <span aria-hidden="true" className={`inline-block leading-[0] ${className ?? ""}`} style={{ width, height }} dangerouslySetInnerHTML={{ __html: html }} />;
}
