// Charts on slides drawn by the shared renderer (docs/charts.md): the
// layout options for Show (the presentation's theme colours, text in the
// theme's tx1 +35 % like PowerPoint, a transparent chart area) and a scene
// cache per chart object and size, shared by the editor, thumbnails,
// presenter, audience window and print.

import { layoutChart, resolveColor, type ChartLabels, type ChartLayoutOptions, type ChartScene, type ChartTheme, type ThemePalette } from "@rusuite/ui-shared";
import type { ChartShape } from "../generated/ChartShape";
import { t } from "../i18n";
import { resolveShape } from "./data";
import type { Chart } from "./types";

/** The renderer's texts in the UI language. */
export function chartLabels(): ChartLabels {
  return {
    chartTitle: t("show.chart.lbl.chartTitle"),
    axisTitle: t("show.chart.lbl.axisTitle"),
    unsupported: t("show.chart.lbl.unsupported"),
    trendLinear: t("show.chart.lbl.trendLinear"),
    trendExponential: t("show.chart.lbl.trendExponential"),
    trendLogarithmic: t("show.chart.lbl.trendLogarithmic"),
    trendPower: t("show.chart.lbl.trendPower"),
    trendPolynomial: t("show.chart.lbl.trendPolynomial"),
    trendMovingAverage: t("show.chart.lbl.trendMovingAverage"),
  };
}

/** Layout options for a chart on a slide of a presentation with `palette` (slot → RRGGBB). */
export function chartOptions(palette: ThemePalette, extra: ChartLayoutOptions = {}): ChartLayoutOptions {
  const theme = palette as ChartTheme;
  return {
    theme,
    textColor: resolveColor({ kind: "theme", value: { slot: "dark1", tint: 0.35 } }, theme, "#595959"),
    area: { fill: null, border: null },
    labels: chartLabels(),
    ...extra,
  };
}

const cache = new WeakMap<ChartShape, { key: string; palette: ThemePalette; scene: ChartScene }>();

/** The scene of a chart shape at `w` × `h` slide px (memoized per chart object, size and theme). */
export function chartScene(c: ChartShape, w: number, h: number, palette: ThemePalette): ChartScene {
  const key = `${Math.round(w * 10)}x${Math.round(h * 10)}`;
  const hit = cache.get(c);
  if (hit && hit.key === key && hit.palette === palette) return hit.scene;
  const scene = layoutChart(c.chart as Chart, resolveShape(c), w, h, chartOptions(palette));
  cache.set(c, { key, palette, scene });
  return scene;
}
