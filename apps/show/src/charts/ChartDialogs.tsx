// Chart dialogs of Show (P8-24): Insert Chart and Change Chart Type
// (PowerPoint's type list, sub-type icons drawn by the shared renderer, a
// live preview) and Edit Data (the embedded table as an editable grid:
// series in columns, categories in rows, add / remove either).

import { useMemo, useState } from "react";
import { Dialog, ChartPreview } from "@rusuite/ui-shared";
import type { ChartData } from "../generated/ChartData";
import { useT } from "../i18n";
import { useShow, type ShowStore } from "../state/store";
import { themePalette } from "../model";
import { addCategoryRow, addSeriesColumn, dataToGrid, gridToData, removeColumn, removeRow, resolveChart, sameData, transposeData } from "./data";
import { PresetIcon } from "./previews";
import { TYPE_GROUPS, applyPreset, groupOf, presetOf, presetsOf, type ChartGroup, type ChartPreset } from "./presets";
import { chartOptions } from "./render";
import type { Chart } from "./types";

const BUTTON = "h-7 rounded border border-ui-border bg-ui-bg px-3 hover:bg-ui-hover disabled:opacity-40";

/** Sample data of the Insert Chart previews (PowerPoint's 3 × 4). */
export const SAMPLE_TABLE: ChartData = {
  categories: ["Category 1", "Category 2", "Category 3", "Category 4"],
  series: [
    { name: "Series 1", values: [4.3, 2.5, 3.5, 4.5] },
    { name: "Series 2", values: [2.4, 4.4, 1.8, 2.8] },
    { name: "Series 3", values: [2, 2, 3, 5] },
  ],
};

const ref = (f: string) => ({ type: "ref" as const, formula: f });

/** A chart of `preset` on the sample table (what Insert Chart shows and inserts). */
export function sampleChart(preset: ChartPreset): { chart: Chart; data: ChartData } {
  const pie = preset.group === "pie";
  const base: Chart = {
    kind: { type: "bar", direction: "column", grouping: "clustered" },
    title: { text: { type: "literal", text: "Chart Title" } },
    legend: { position: "bottom" },
    series: (pie ? SAMPLE_TABLE.series.slice(0, 1) : SAMPLE_TABLE.series).map((_, i) => ({ name: ref(`N${i}`), values: ref(`V${i}`) })),
    categories: ref("C"),
    axes: { cat: {}, val: { majorGridlines: true } },
  };
  const data = pie ? { ...SAMPLE_TABLE, series: SAMPLE_TABLE.series.slice(0, 1) } : SAMPLE_TABLE;
  return { chart: applyPreset(base, preset), data };
}

/** The type list, sub-type icons and preview shared by Insert Chart and Change Chart Type. */
function ChartTypePicker({ store, group, preset, onGroup, onPreset, preview }: {
  store: ShowStore; group: ChartGroup; preset: ChartPreset; onGroup: (g: ChartGroup) => void; onPreset: (p: ChartPreset) => void; preview: { chart: Chart; data: ChartData };
}) {
  const t = useT();
  const theme = useShow(store, (s) => s.pres?.theme);
  const palette = useMemo(() => themePalette(theme), [theme]);
  const options = useMemo(() => ({ ...chartOptions(palette), area: { fill: "#FFFFFF", border: "#D9D9D9" } }), [palette]);
  const resolved = useMemo(() => resolveChart(preview.chart, preview.data), [preview]);
  return (
    <div className="flex gap-3">
      <ul role="listbox" aria-label={t("show.chart.allCharts")} className="flex w-36 flex-col gap-0.5" data-testid="chart-type-list">
        {TYPE_GROUPS.map((g) => (
          <li key={g.id}>
            <button
              type="button"
              role="option"
              aria-selected={g.id === group}
              className={`w-full rounded px-2 py-1 text-left ${g.id === group ? "bg-ui-hover font-medium" : "hover:bg-ui-hover"}`}
              onClick={() => onGroup(g.id)}
            >
              {t(g.label)}
            </button>
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-2">
        <div className="flex gap-1" role="radiogroup" aria-label={t("show.chart.chartType")}>
          {presetsOf(group).map((p) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={p.id === preset.id}
              aria-label={t(p.label)}
              title={t(p.label)}
              data-preset={p.id}
              className={`rounded border p-0.5 ${p.id === preset.id ? "border-orange-600" : "border-transparent hover:border-ui-border"}`}
              onClick={() => onPreset(p)}
            >
              <PresetIcon preset={p} width={64} height={48} />
            </button>
          ))}
        </div>
        <div className="text-xs font-medium">{t(preset.label)}</div>
        <div className="rounded border border-ui-border" data-testid="chart-type-preview">
          <ChartPreview chart={preview.chart} data={resolved} width={360} height={220} options={options} />
        </div>
      </div>
    </div>
  );
}

/** Insert › Chart. */
export function InsertChartDialog({ store }: { store: ShowStore }) {
  const t = useT();
  const [group, setGroup] = useState<ChartGroup>("column");
  const [preset, setPreset] = useState<ChartPreset>(presetsOf("column")[0]!);
  const preview = useMemo(() => sampleChart(preset), [preset]);
  const close = () => store.closeDialog();
  return (
    <Dialog open title={t("show.chart.insertTitle")} onClose={close}>
      <form
        className="flex flex-col gap-3 text-sm"
        data-testid="insert-chart-dialog"
        onSubmit={(e) => {
          e.preventDefault();
          close();
          void store.insertChart(preset.id);
        }}
      >
        <ChartTypePicker
          store={store}
          group={group}
          preset={preset}
          preview={preview}
          onGroup={(g) => {
            setGroup(g);
            setPreset(presetsOf(g)[0]!);
          }}
          onPreset={setPreset}
        />
        <div className="flex justify-end gap-2">
          <button type="button" className={BUTTON} onClick={close}>
            {t("common.cancel")}
          </button>
          <button type="submit" className={BUTTON}>
            {t("common.ok")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** Chart Design › Change Chart Type. */
export function ChartTypeDialog({ store }: { store: ShowStore }) {
  const t = useT();
  useShow(store, (s) => s.pres);
  const sel = store.selectedChart();
  const chart = sel?.chart.chart as Chart | undefined;
  const [group, setGroup] = useState<ChartGroup>(() => (chart ? groupOf(chart) : "column"));
  const [preset, setPreset] = useState<ChartPreset>(() => (chart && presetOf(chart)) || presetsOf(chart ? groupOf(chart) : "column")[0]!);
  const close = () => store.closeDialog();
  if (!sel || !chart) return null;
  const preview = { chart: applyPreset(chart, preset), data: sel.chart.data };
  return (
    <Dialog open title={t("show.chart.changeType")} onClose={close}>
      <form
        className="flex flex-col gap-3 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          close();
          void store.updateChart((c) => applyPreset(c, preset));
        }}
      >
        <ChartTypePicker
          store={store}
          group={group}
          preset={preset}
          preview={preview}
          onGroup={(g) => {
            setGroup(g);
            setPreset(presetsOf(g)[0]!);
          }}
          onPreset={setPreset}
        />
        <div className="flex justify-end gap-2">
          <button type="button" className={BUTTON} onClick={close}>
            {t("common.cancel")}
          </button>
          <button type="submit" className={BUTTON}>
            {t("common.ok")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** Chart Design › Edit Data: the table as a grid (row 1: series names, column A: categories). */
export function EditDataDialog({ store }: { store: ShowStore }) {
  const t = useT();
  const sel = store.selectedChart();
  const [grid, setGrid] = useState<string[][]>(() => (sel ? dataToGrid(sel.chart.data) : [[""]]));
  const close = () => store.closeDialog();
  if (!sel) return null;
  const set = (r: number, c: number, v: string) => setGrid((g) => g.map((row, ri) => (ri === r ? row.map((x, ci) => (ci === c ? v : x)) : row)));
  const cols = grid[0]?.length ?? 1;
  const letters = (c: number) => String.fromCharCode(65 + (c % 26)).repeat(Math.floor(c / 26) + 1);
  const next = gridToData(grid);
  return (
    <Dialog open title={t("show.chart.editDataTitle")} onClose={close}>
      <form
        className="flex flex-col gap-2 text-sm"
        data-testid="edit-data-dialog"
        onSubmit={(e) => {
          e.preventDefault();
          close();
          if (!sameData(next, sel.chart.data)) void store.setChartData(next);
        }}
      >
        <div className="max-h-[50vh] max-w-[80vw] overflow-auto">
          <table className="border-collapse text-xs" data-testid="edit-data-grid">
            <thead>
              <tr>
                <th className="w-8" />
                {Array.from({ length: cols }, (_, c) => (
                  <th key={c} className="border border-ui-border bg-ui-panel px-1 font-normal text-ui-muted">
                    <span className="flex items-center justify-between gap-1">
                      {letters(c)}
                      {c > 0 && (
                        <button type="button" className="text-ui-muted hover:text-red-600" aria-label={t("show.chart.removeSeries", { n: c })} title={t("show.chart.removeSeries", { n: c })} onClick={() => setGrid((g) => removeColumn(g, c))}>
                          ×
                        </button>
                      )}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.map((row, r) => (
                <tr key={r}>
                  <th className="border border-ui-border bg-ui-panel px-1 font-normal text-ui-muted">
                    <span className="flex items-center justify-between gap-1">
                      {r + 1}
                      {r > 0 && (
                        <button type="button" className="text-ui-muted hover:text-red-600" aria-label={t("show.chart.removeCategory", { n: r })} title={t("show.chart.removeCategory", { n: r })} onClick={() => setGrid((g) => removeRow(g, r))}>
                          ×
                        </button>
                      )}
                    </span>
                  </th>
                  {row.map((v, c) => (
                    <td key={c} className="border border-ui-border p-0">
                      <input
                        aria-label={t("show.chart.cell", { ref: `${letters(c)}${r + 1}` })}
                        data-cell={`${letters(c)}${r + 1}`}
                        className={`h-6 w-24 bg-ui-bg px-1 ${r > 0 && c > 0 ? "text-right" : ""}`}
                        value={v}
                        disabled={r === 0 && c === 0}
                        onChange={(e) => set(r, c, e.currentTarget.value)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className={BUTTON} onClick={() => setGrid(addSeriesColumn)}>
            {t("show.chart.addSeries")}
          </button>
          <button type="button" className={BUTTON} onClick={() => setGrid(addCategoryRow)}>
            {t("show.chart.addCategory")}
          </button>
          <button type="button" className={BUTTON} onClick={() => setGrid((g) => dataToGrid(transposeData(gridToData(g))))}>
            {t("show.chart.switchRowCol")}
          </button>
          <span className="ml-auto text-xs text-ui-muted">{t("show.chart.editDataHint")}</span>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className={BUTTON} onClick={close}>
            {t("common.cancel")}
          </button>
          <button type="submit" className={BUTTON} disabled={next.series.length === 0}>
            {t("common.ok")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
