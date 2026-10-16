// A chart shape's data table (`model_show::ChartData`): what the renderer
// draws (a port of `ChartData::resolve`, synchronous so thumbnails, the
// presenter, the audience window and print need no core round trip), the
// Edit Data grid (rows × columns of text) and Switch Row/Column.

import type { ChartData } from "../generated/ChartData";
import type { ChartShape } from "../generated/ChartShape";
import type { Chart, ResolvedChart, ResolvedSeries } from "./types";

const num = (s: string): number | null => {
  const t = s.trim();
  if (t === "") return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
};

const kindOf = (chart: Chart, i: number) => (chart.kind.type === "combo" ? (chart.series[i]?.kind ?? chart.kind) : chart.kind);

/** The resolved data of a chart on its table (one series per chart series, by position). */
export function resolveChart(chart: Chart, data: ChartData): ResolvedChart {
  if (chart.kind.type === "unsupported") return { series: [] };
  const n = data.categories.length;
  const numbers = data.categories.map(num);
  const numeric = n > 0 && data.categories.every((c, i) => c.trim() === "" || numbers[i] !== null);
  const series: ResolvedSeries[] = chart.series.map((s, i) => {
    const d = data.series[i];
    const values = Array.from({ length: n }, (_, k) => d?.values[k] ?? null);
    const categories = n ? [...data.categories] : values.map((_, k) => String(k + 1));
    const name = s.name?.type === "literal" ? s.name.text : d?.name || `Series${i + 1}`;
    const out: ResolvedSeries = { name, categories, values };
    if (numeric) out.xValues = [...numbers];
    else if (kindOf(chart, i).type === "scatter") out.xValues = values.map((_, k) => k + 1);
    if (d?.formatCode) out.formatCode = d.formatCode;
    return out;
  });
  const t = chart.title;
  let title: string | undefined;
  if (t) {
    if (t.text?.type === "literal") title = t.text.text;
    else if (t.text?.type === "ref") title = t.text.cache;
    else if (series.length === 1) title = series[0]!.name;
  }
  return title === undefined ? { series } : { series, title };
}

/** The resolved data of a chart shape. */
export const resolveShape = (c: ChartShape): ResolvedChart => resolveChart(c.chart as Chart, c.data);

/** Series and categories swapped (Switch Row/Column). */
export function transposeData(d: ChartData): ChartData {
  return {
    categories: d.series.map((s) => s.name),
    series: d.categories.map((c, i) => ({ name: c, values: d.series.map((s) => s.values[i] ?? null) })),
  };
}

/** The table as PowerPoint's sheet: row 0 = "" + series names, then one row per category (label + values). */
export function dataToGrid(d: ChartData): string[][] {
  const fmt = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));
  return [["", ...d.series.map((s) => s.name)], ...d.categories.map((c, r) => [c, ...d.series.map((s) => fmt(s.values[r]))])];
}

/** The table of a grid (see `dataToGrid`); a series or category whose cells are all empty is dropped; text in value cells counts as blank. */
export function gridToData(grid: string[][]): ChartData {
  const cols = Math.max(0, ...grid.map((r) => r.length));
  const cell = (r: number, c: number) => grid[r]?.[c] ?? "";
  const rows = Array.from({ length: Math.max(0, grid.length - 1) }, (_, i) => i + 1).filter((r) =>
    Array.from({ length: cols }, (_, c) => cell(r, c)).some((v) => v.trim() !== ""),
  );
  const series = Array.from({ length: Math.max(0, cols - 1) }, (_, i) => i + 1)
    .filter((c) => cell(0, c).trim() !== "" || rows.some((r) => cell(r, c).trim() !== ""))
    .map((c, k) => ({ name: cell(0, c).trim() || `Series ${k + 1}`, values: rows.map((r) => num(cell(r, c))) }));
  return { categories: rows.map((r) => cell(r, 0)), series };
}

/** A grid with one more series column (named like PowerPoint: "Series n"). */
export function addSeriesColumn(grid: string[][]): string[][] {
  const n = (grid[0]?.length ?? 1);
  return grid.map((row, r) => [...row, r === 0 ? `Series ${n}` : ""]);
}

/** A grid with one more category row ("Category n"). */
export function addCategoryRow(grid: string[][]): string[][] {
  const cols = grid[0]?.length ?? 1;
  return [...grid, [`Category ${grid.length}`, ...Array.from({ length: cols - 1 }, () => "")]];
}

/** Removes column `c` (≥ 1) or row `r` (≥ 1). */
export function removeColumn(grid: string[][], c: number): string[][] {
  return c < 1 ? grid : grid.map((row) => row.filter((_, i) => i !== c));
}

export function removeRow(grid: string[][], r: number): string[][] {
  return r < 1 ? grid : grid.filter((_, i) => i !== r);
}

/** Whether two tables hold the same data. */
export const sameData = (a: ChartData, b: ChartData) => JSON.stringify(a) === JSON.stringify(b);
