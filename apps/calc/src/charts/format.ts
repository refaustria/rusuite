// Chart formatting edits (pure): series and point fills, outlines,
// markers, axis options, data labels and trendlines – what the Format tab
// and the Format pane change.

import type { Color } from "../../../../packages/ui-shared/src/generated/Color";
import type { Axis } from "../generated/Axis";
import type { Chart } from "../generated/Chart";
import type { DataLabels } from "../generated/DataLabels";
import type { LineFormat } from "../generated/LineFormat";
import type { Marker } from "../generated/Marker";
import type { Series } from "../generated/Series";
import type { Trendline } from "../generated/Trendline";

type AxisId = "cat" | "val" | "secondVal";

/** Drops `undefined` fields (absent = default in the model). */
function clean<T extends object>(o: T): T {
  const out = { ...o };
  for (const k of Object.keys(out) as (keyof T)[]) if (out[k] === undefined) delete out[k];
  return out;
}

function mapSeries(chart: Chart, i: number, fn: (s: Series) => Series): Chart {
  return { ...chart, series: chart.series.map((s, k) => (k === i ? clean(fn(s)) : s)) };
}

const isLineKind = (chart: Chart, s: Series) => {
  const k = chart.kind.type === "combo" ? s.kind?.type : chart.kind.type;
  return k === "line" || k === "scatter";
};

/** Fill of series `i` (or one point): `null` = no fill. Lines take it as the line and marker colour. */
export function setSeriesFill(chart: Chart, i: number, point: number | undefined, color: Color | null): Chart {
  return mapSeries(chart, i, (s) => {
    const fill = color === null ? { type: "none" as const } : { type: "solid" as const, color };
    if (point !== undefined) {
      const others = (s.dataPoints ?? []).filter((p) => p.idx !== point);
      const cur = s.dataPoints?.find((p) => p.idx === point) ?? { idx: point };
      return { ...s, dataPoints: [...others, { ...cur, fill }].sort((a, b) => a.idx - b.idx) };
    }
    if (isLineKind(chart, s)) {
      const marker: Marker = { ...(s.marker ?? { symbol: "auto" }), fill };
      return { ...s, line: color === null ? { ...(s.line ?? {}), none: true } : clean({ ...(s.line ?? {}), color, none: undefined }), marker };
    }
    return { ...s, fill };
  });
}

/** Outline (bars, slices) or line (lines, scatter) of series `i`. */
export function setSeriesLine(chart: Chart, i: number, patch: Partial<LineFormat>): Chart {
  return mapSeries(chart, i, (s) => {
    const line = clean({ ...(s.line ?? {}), ...patch, ...(patch.color ? { none: undefined } : {}) });
    return Object.keys(line).length ? { ...s, line } : (({ line: _, ...rest }) => rest)(s);
  });
}

export function setSeriesMarker(chart: Chart, i: number, patch: Partial<Marker>): Chart {
  return mapSeries(chart, i, (s) => ({ ...s, marker: clean({ ...(s.marker ?? { symbol: "auto" as const }), ...patch }) }));
}

export function setSeriesProp<K extends keyof Series>(chart: Chart, i: number, key: K, value: Series[K] | undefined): Chart {
  return mapSeries(chart, i, (s) => ({ ...s, [key]: value }));
}

/** Format › Reset to Match Style: drops the series' own fill, line, marker and point formats. */
export function resetSeriesFormat(chart: Chart, i: number): Chart {
  return mapSeries(chart, i, (s) => {
    const { fill: _f, line: _l, marker, dataPoints: _d, ...rest } = s;
    return marker?.symbol === "none" ? { ...rest, marker: { symbol: "none" } } : rest;
  });
}

/** Moves series `i` to the secondary axis (or back); a secondary axis appears when needed. */
export function setSecondary(chart: Chart, i: number, secondary: boolean): Chart {
  const kind = chart.kind;
  let out = mapSeries(chart, i, (s) => ({ ...s, axis: secondary ? "secondary" : undefined }));
  if (secondary && kind.type !== "combo") {
    // A series on its own axis makes a combo chart (Excel), every series keeps the kind.
    out = { ...out, kind: { type: "combo" }, series: out.series.map((s) => ({ ...s, kind: s.kind ?? kind })) };
  }
  const any = out.series.some((s) => s.axis === "secondary");
  if (any && !out.axes.secondVal) out = { ...out, axes: { ...out.axes, secondVal: { crosses: { type: "max" } } } };
  if (!any && out.axes.secondVal) {
    const { secondVal: _, ...rest } = out.axes;
    out = { ...out, axes: rest as Chart["axes"] };
  }
  return out;
}

/** Changes axis options (`undefined` values reset to automatic). */
export function setAxis(chart: Chart, axis: AxisId, patch: Partial<Axis>): Chart {
  const cur = chart.axes[axis] ?? {};
  return { ...chart, axes: { ...chart.axes, [axis]: clean({ ...cur, ...patch }) } };
}

/** Data labels of the whole chart (`series` absent) or one series. */
export function setLabels(chart: Chart, series: number | undefined, patch: Partial<DataLabels> | null): Chart {
  if (series === undefined) {
    if (patch === null) {
      const { dataLabels: _, ...rest } = chart;
      return { ...rest, series: chart.series.map(({ dataLabels: _d, ...s }) => s) };
    }
    return { ...chart, dataLabels: clean({ ...(chart.dataLabels ?? {}), ...patch }) };
  }
  return mapSeries(chart, series, (s) => (patch === null ? { ...s, dataLabels: undefined } : { ...s, dataLabels: clean({ ...(s.dataLabels ?? chart.dataLabels ?? {}), ...patch }) }));
}

export function setTrendline(chart: Chart, series: number, t: Trendline | null): Chart {
  return mapSeries(chart, series, (s) => ({ ...s, trendline: t ?? undefined }));
}

/** Parses a number field: blank = automatic (`undefined`), invalid = `null`. */
export function parseNumberField(text: string): number | undefined | null {
  const v = text.trim().replace(",", ".");
  if (v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
