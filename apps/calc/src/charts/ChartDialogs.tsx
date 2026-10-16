// Chart dialogs: Insert › Recommended Charts, Change Chart Type…, Move
// Chart… and Select Data… (series list, Edit Series, axis labels, hidden
// and empty cells) with range fields that collapse the dialog to pick a
// range on the grid (Excel's RefEdit, using the grid selection).

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Dialog } from "@rusuite/ui-shared";
import type { Chart } from "../generated/Chart";
import type { ChartKind } from "../generated/ChartKind";
import type { DataRef } from "../generated/DataRef";
import type { DisplayBlanks } from "../generated/DisplayBlanks";
import type { ResolvedChart } from "../generated/ResolvedChart";
import type { Series } from "../generated/Series";
import { normalize } from "../grid/Selection";
import { useT } from "../i18n";
import { useCalc, visibleSheets, type CalcDialog, type CalcStore } from "../state/store";
import { emptyChart } from "./controller";
import { LivePreview, PresetIcon } from "./previews";
import { TYPE_GROUPS, applyPreset, canon, groupOf, presetById, presetOf, presetsOf, type ChartGroup, type ChartPreset } from "./presets";
import { chartDataRange, dataRefText, nameText, parseDataRef, parseName, parseRange, rangeFormula, switchRowCol } from "./refs";

const BTN = "h-7 rounded border border-ui-border bg-ui-bg px-3 text-sm hover:bg-ui-hover disabled:opacity-40";
const FIELD = "h-7 rounded border border-ui-border bg-ui-bg px-2 text-sm text-ui-fg";
const LIST = "flex flex-col overflow-auto rounded border border-ui-border bg-ui-bg";
const ROW = (on: boolean) => `px-2 py-0.5 text-left text-sm ${on ? "bg-ui-active" : "hover:bg-ui-hover"}`;

function OkCancel({ onCancel, okDisabled, extra }: { onCancel: () => void; okDisabled?: boolean; extra?: ReactNode }) {
  const t = useT();
  return (
    <div className="flex items-center justify-end gap-2">
      {extra}
      <button type="submit" className={BTN} disabled={okDisabled}>
        {t("common.ok")}
      </button>
      <button type="button" className={BTN} onClick={onCancel}>
        {t("common.cancel")}
      </button>
    </div>
  );
}

const closeDialog = (store: CalcStore) => {
  store.closeDialog();
  store.focusGrid();
};

/** Preview data of a chart on the active sheet (async, the last request wins). */
function usePreviewData(store: CalcStore, chart: Chart | null): ResolvedChart {
  const [data, setData] = useState<ResolvedChart>({ series: [] });
  const key = chart ? canon(chart) : "";
  useEffect(() => {
    let live = true;
    if (!chart) return;
    void store.charts.previewData(chart).then((d) => live && setData(d));
    return () => {
      live = false;
    };
  }, [store, key]);
  return data;
}

// --- Recommended Charts ------------------------------------------------------------------------------

/** The recommended chart types for a recommendation `base` (3–5, Excel's choice simplified). */
export function recommendations(base: Chart): ChartPreset[] {
  const n = base.series.length;
  const ids = n <= 1 ? ["colClustered", "barClustered", "pie", "lineMarkers", "area"] : ["colClustered", "lineMarkers", "barClustered", "colStacked", "comboColLine"];
  return ids.map((id) => presetById(id)!).filter(Boolean);
}

function OptionPreview({ store, chart, width, height, scale }: { store: CalcStore; chart: Chart; width: number; height: number; scale: number }) {
  const data = usePreviewData(store, chart);
  return <LivePreview chart={chart} data={data} width={width} height={height} scale={scale} />;
}

function RecommendedChartsDialog({ store }: { store: CalcStore }) {
  const t = useT();
  const [base, setBase] = useState<Chart | null | undefined>(undefined);
  const [pick, setPick] = useState(0);
  useEffect(() => {
    let live = true;
    void store.charts.recommended().then((c) => live && setBase(c));
    return () => {
      live = false;
    };
  }, [store]);
  const options = useMemo(() => (base ? recommendations(base).map((p) => ({ preset: p, chart: applyPreset(base, p) })) : []), [base]);
  const chosen = options[pick];
  const close = () => closeDialog(store);
  return (
    <Dialog open title={t("calc.chart.insertChart")} onClose={close}>
      <form
        className="flex w-[44rem] max-w-[90vw] flex-col gap-3 text-sm"
        data-testid="recommended-charts"
        onSubmit={(e) => {
          e.preventDefault();
          store.closeDialog();
          void store.charts.insertChart(chosen?.chart ?? emptyChart());
        }}
      >
        <div className="text-xs font-medium">{t("calc.chart.recommended")}</div>
        {base === undefined && <div className="text-ui-muted">{t("calc.chart.loading")}</div>}
        {base === null && <div className="text-ui-muted" role="status">{t("calc.chart.noData")}</div>}
        {base && (
          <div className="flex gap-3">
            <div role="listbox" aria-label={t("calc.chart.recommended")} className={`${LIST} w-40 gap-1 p-1`}>
              {options.map((o, i) => (
                <button
                  key={o.preset.id}
                  type="button"
                  role="option"
                  aria-selected={i === pick}
                  aria-label={t(o.preset.label)}
                  title={t(o.preset.label)}
                  className={`rounded border p-0.5 ${i === pick ? "border-ui-focus bg-ui-active" : "border-transparent hover:bg-ui-hover"}`}
                  onClick={() => setPick(i)}
                  onDoubleClick={() => {
                    store.closeDialog();
                    void store.charts.insertChart(o.chart);
                  }}
                >
                  <OptionPreview store={store} chart={o.chart} width={140} height={80} scale={3} />
                </button>
              ))}
            </div>
            {chosen && (
              <div className="flex flex-1 flex-col gap-2">
                <div className="font-semibold">{t(chosen.preset.label)}</div>
                <OptionPreview store={store} chart={chosen.chart} width={440} height={264} scale={1} />
              </div>
            )}
          </div>
        )}
        <OkCancel onCancel={close} />
      </form>
    </Dialog>
  );
}

// --- Change Chart Type ---------------------------------------------------------------------------

const COMBO_KINDS: { id: string; label: string; kind: ChartKind }[] = [
  { id: "colClustered", label: "calc.chart.t.colClustered", kind: { type: "bar", direction: "column", grouping: "clustered" } },
  { id: "colStacked", label: "calc.chart.t.colStacked", kind: { type: "bar", direction: "column", grouping: "stacked" } },
  { id: "line", label: "calc.chart.t.line", kind: { type: "line", grouping: "standard", markers: false } },
  { id: "lineMarkers", label: "calc.chart.t.lineMarkers", kind: { type: "line", grouping: "standard", markers: true } },
  { id: "area", label: "calc.chart.t.area", kind: { type: "area", grouping: "standard" } },
  { id: "areaStacked", label: "calc.chart.t.areaStacked", kind: { type: "area", grouping: "stacked" } },
];

/** Combo editor: per series its kind and the secondary axis. */
export function comboChart(chart: Chart, kinds: string[], secondary: boolean[]): Chart {
  const series = chart.series.map((s, i) => {
    const k = COMBO_KINDS.find((c) => c.id === kinds[i])?.kind ?? COMBO_KINDS[0]!.kind;
    const out: Series = { ...s, kind: k };
    if (secondary[i]) out.axis = "secondary";
    else delete out.axis;
    return out;
  });
  const anySecondary = series.some((s) => s.axis === "secondary");
  const axes = { ...chart.axes };
  if (anySecondary && !axes.secondVal) axes.secondVal = { crosses: { type: "max" } };
  if (!anySecondary) delete axes.secondVal;
  const bars = series.some((s) => s.kind?.type === "bar");
  return { ...chart, kind: { type: "combo" }, series, axes, ...(bars ? { gapWidth: chart.gapWidth ?? 219, overlap: chart.overlap ?? -27 } : {}) };
}

function ChangeChartTypeDialog({ store }: { store: CalcStore }) {
  const t = useT();
  const obj = store.charts.selectedChart();
  const chart = obj?.chart ?? emptyChart();
  const current = presetOf(chart);
  const [group, setGroup] = useState<ChartGroup>(groupOf(chart));
  const [presetId, setPresetId] = useState<string>(current?.id ?? presetsOf(groupOf(chart))[0]!.id);
  const [kinds, setKinds] = useState<string[]>(() =>
    chart.series.map((s, i) => {
      const k = chart.kind.type === "combo" ? s.kind : undefined;
      return COMBO_KINDS.find((c) => canon(c.kind) === canon(k ?? null))?.id ?? (i === chart.series.length - 1 && chart.series.length > 1 ? "line" : "colClustered");
    }),
  );
  const [secondary, setSecondary] = useState<boolean[]>(() => chart.series.map((s) => s.axis === "secondary"));
  const data = obj ? store.charts.dataOf(store.charts.selected!.sheet, obj) : undefined;
  const next = useMemo(() => {
    if (group === "combo") return comboChart(chart, kinds, secondary);
    const p = presetById(presetId);
    return p ? applyPreset(chart, p) : chart;
  }, [chart, group, presetId, kinds, secondary]);
  const preview = usePreviewData(store, next);
  const close = () => closeDialog(store);
  const choose = (g: ChartGroup) => {
    setGroup(g);
    if (g !== "combo") setPresetId(presetsOf(g)[0]!.id);
  };
  return (
    <Dialog open title={t("calc.chart.changeType")} onClose={close}>
      <form
        className="flex w-[48rem] max-w-[92vw] flex-col gap-3 text-sm"
        data-testid="change-chart-type"
        onSubmit={(e) => {
          e.preventDefault();
          store.closeDialog();
          void store.charts.update(next);
          store.focusGrid();
        }}
      >
        <div className="flex gap-3">
          <div role="listbox" aria-label={t("calc.chart.allCharts")} className={`${LIST} w-36 py-1`}>
            {TYPE_GROUPS.map((g) => (
              <button key={g.id} type="button" role="option" aria-selected={group === g.id} className={ROW(group === g.id)} onClick={() => choose(g.id)}>
                {t(g.label)}
              </button>
            ))}
          </div>
          <div className="flex flex-1 flex-col gap-2">
            {group !== "combo" ? (
              <div role="radiogroup" aria-label={t(TYPE_GROUPS.find((g) => g.id === group)!.label)} className="flex flex-wrap gap-1">
                {presetsOf(group).map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    role="radio"
                    aria-checked={presetId === p.id}
                    aria-label={t(p.label)}
                    title={t(p.label)}
                    className={`rounded border p-0.5 ${presetId === p.id ? "border-ui-focus bg-ui-active" : "border-ui-border hover:bg-ui-hover"}`}
                    onClick={() => setPresetId(p.id)}
                  >
                    <PresetIcon preset={p} />
                  </button>
                ))}
              </div>
            ) : (
              <table className="text-sm" aria-label={t("calc.chart.comboSeries")}>
                <thead>
                  <tr className="text-left text-xs text-ui-muted">
                    <th className="pr-2 font-medium">{t("calc.chart.seriesName")}</th>
                    <th className="pr-2 font-medium">{t("calc.chart.chartType")}</th>
                    <th className="font-medium">{t("calc.chart.secondaryAxis")}</th>
                  </tr>
                </thead>
                <tbody>
                  {chart.series.map((_, i) => (
                    <tr key={i}>
                      <td className="pr-2">{data?.series[i]?.name ?? `${t("calc.chart.series")} ${i + 1}`}</td>
                      <td className="pr-2">
                        <select
                          aria-label={`${t("calc.chart.chartType")} ${i + 1}`}
                          className={FIELD}
                          value={kinds[i]}
                          onChange={(e) => setKinds((k) => k.map((x, j) => (j === i ? e.target.value : x)))}
                        >
                          {COMBO_KINDS.map((c) => (
                            <option key={c.id} value={c.id}>
                              {t(c.label)}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`${t("calc.chart.secondaryAxis")} ${i + 1}`}
                          checked={secondary[i] ?? false}
                          onChange={(e) => setSecondary((s) => s.map((x, j) => (j === i ? e.target.checked : x)))}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="font-semibold">{group === "combo" ? t("calc.chart.group.combo") : t(presetById(presetId)?.label ?? "")}</div>
            <LivePreview chart={next} data={preview} width={460} height={250} scale={1} />
          </div>
        </div>
        <OkCancel onCancel={close} />
      </form>
    </Dialog>
  );
}

// --- Move Chart ----------------------------------------------------------------------------------

function MoveChartDialog({ store }: { store: CalcStore }) {
  const t = useT();
  const sheets = visibleSheets(store.getState().info?.sheets ?? []);
  const sel = store.charts.selected;
  const others = sheets.filter((s) => s.id !== sel?.sheet);
  const [mode, setMode] = useState<"new" | "object">("object");
  const defaultName = (() => {
    for (let i = 1; ; i++) {
      const n = `${t("calc.chart.chart")}${i}`;
      if (!sheets.some((s) => s.name.toLowerCase() === n.toLowerCase())) return n;
    }
  })();
  const [name, setName] = useState(defaultName);
  const [target, setTarget] = useState<number>(others[0]?.id ?? sel?.sheet ?? 0);
  const close = () => closeDialog(store);
  return (
    <Dialog open title={t("calc.chart.move")} onClose={close}>
      <form
        className="flex w-96 flex-col gap-3 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          store.closeDialog();
          void store.charts.moveTo(mode === "new" ? { newSheet: name.trim() || defaultName } : { sheet: target });
        }}
      >
        <div className="text-xs text-ui-muted">{t("calc.chart.moveWhere")}</div>
        <label className="flex items-center gap-2">
          <input type="radio" name="move" checked={mode === "new"} onChange={() => setMode("new")} />
          <span className="w-24">{t("calc.chart.newSheet")}</span>
          <input className={`${FIELD} flex-1`} aria-label={t("calc.chart.newSheetName")} value={name} disabled={mode !== "new"} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="move" checked={mode === "object"} disabled={others.length === 0} onChange={() => setMode("object")} />
          <span className="w-24">{t("calc.chart.objectIn")}</span>
          <select className={`${FIELD} flex-1`} aria-label={t("calc.chart.objectIn")} value={target} disabled={mode !== "object" || others.length === 0} onChange={(e) => setTarget(Number(e.target.value))}>
            {others.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <OkCancel onCancel={close} okDisabled={mode === "object" && others.length === 0} />
      </form>
    </Dialog>
  );
}

// --- Select Data ---------------------------------------------------------------------------------

/** The grid selection as a reference text `=Sheet1!$A$1:$B$4` (range pickers). */
export function selectionRefText(store: CalcStore): string {
  const st = store.getState();
  const r = normalize(st.selection);
  const name = st.info?.sheets.find((s) => s.id === st.activeSheet)?.name ?? null;
  return `=${rangeFormula({ sheet: name, r0: r.r0, c0: r.c0, r1: r.r1, c1: r.c1 })}`;
}

interface Picker {
  label: string;
  value: string;
  set: (text: string) => void;
}

/** A reference field with a collapse button: the dialog shrinks to a bar and the grid selection fills the field. */
function RangeField({ label, value, onChange, onPick, testId }: { label: string; value: string; onChange: (v: string) => void; onPick: (p: Picker) => void; testId?: string }) {
  const t = useT();
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-xs">{label}</span>
      <span className="flex gap-1">
        <input className={`${FIELD} flex-1 font-mono text-xs`} aria-label={label} data-testid={testId} value={value} onChange={(e) => onChange(e.target.value)} />
        <button type="button" className={`${BTN} px-2`} aria-label={`${t("calc.chart.pickRange")}: ${label}`} title={t("calc.chart.pickRange")} onClick={() => onPick({ label, value, set: onChange })}>
          ⇱
        </button>
      </span>
    </label>
  );
}

/** The collapsed dialog while picking a range: the field, follows the grid selection. */
function PickBar({ store, picker, onDone }: { store: CalcStore; picker: Picker; onDone: () => void }) {
  const t = useT();
  const [text, setText] = useState(picker.value);
  const selection = useCalc(store, (s) => s.selection);
  const sheet = useCalc(store, (s) => s.activeSheet);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const v = selectionRefText(store);
    setText(v);
    picker.set(v);
  }, [store, selection, sheet, picker]);
  return (
    <div role="dialog" aria-label={picker.label} data-testid="range-pick-bar" className="fixed left-1/2 top-28 z-50 flex w-[28rem] -translate-x-1/2 items-center gap-2 rounded border border-ui-border bg-ui-panel p-2 text-sm shadow-xl">
      <span className="text-xs">{picker.label}</span>
      <input
        className={`${FIELD} flex-1 font-mono text-xs`}
        aria-label={picker.label}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          picker.set(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === "Escape") {
            e.preventDefault();
            onDone();
          }
        }}
      />
      <button type="button" className={`${BTN} px-2`} aria-label={t("calc.chart.expandDialog")} title={t("calc.chart.expandDialog")} onClick={onDone}>
        ⇲
      </button>
    </div>
  );
}

interface Draft {
  series: Series[];
  categories: DataRef | null;
  displayBlanksAs: DisplayBlanks;
  plotVisibleOnly: boolean;
}

/** Select Data edits (pure, tested): add / edit / remove / move a series. */
export const selectDataOps = {
  add(d: Draft, name: string, values: string): Draft {
    const v = parseDataRef(values) ?? { type: "literal" as const, values: [1] };
    const n = parseName(name);
    return { ...d, series: [...d.series, { ...(n ? { name: n } : {}), values: v }] };
  },
  edit(d: Draft, i: number, name: string, values: string): Draft {
    const v = parseDataRef(values);
    const n = parseName(name);
    return {
      ...d,
      series: d.series.map((s, k) => {
        if (k !== i) return s;
        const out: Series = { ...s, values: v ?? s.values };
        if (n) out.name = n;
        else delete out.name;
        return out;
      }),
    };
  },
  remove(d: Draft, i: number): Draft {
    return { ...d, series: d.series.filter((_, k) => k !== i) };
  },
  move(d: Draft, i: number, delta: -1 | 1): Draft {
    const j = i + delta;
    if (j < 0 || j >= d.series.length) return d;
    const series = [...d.series];
    [series[i], series[j]] = [series[j]!, series[i]!];
    return { ...d, series };
  },
  categories(d: Draft, text: string): Draft {
    return { ...d, categories: parseDataRef(text) };
  },
};

/** The commands of Select Data's OK: `setChartSeries`, or `updateChart` when the hidden/empty cell options changed too. */
export function selectDataCommand(sheet: number, id: number, chart: Chart, d: Draft) {
  const blanks = chart.displayBlanksAs ?? "gap";
  const visible = chart.plotVisibleOnly ?? true;
  if (blanks === d.displayBlanksAs && visible === d.plotVisibleOnly) {
    return { type: "setChartSeries" as const, sheet, id, series: d.series, categories: d.categories };
  }
  const next: Chart = { ...chart, series: d.series, displayBlanksAs: d.displayBlanksAs, plotVisibleOnly: d.plotVisibleOnly };
  if (d.categories) next.categories = d.categories;
  else delete next.categories;
  return { type: "updateChart" as const, sheet, id, chart: next };
}

function SelectDataDialog({ store }: { store: CalcStore }) {
  const t = useT();
  const obj = store.charts.selectedChart();
  const sel = store.charts.selected;
  const chart = obj?.chart ?? emptyChart();
  const [draft, setDraft] = useState<Draft>({
    series: chart.series,
    categories: chart.categories ?? null,
    displayBlanksAs: chart.displayBlanksAs ?? "gap",
    plotVisibleOnly: chart.plotVisibleOnly ?? true,
  });
  const range = chartDataRange(chart);
  const [rangeText, setRangeText] = useState(range ? `=${rangeFormula(range)}` : "");
  const [current, setCurrent] = useState(0);
  const [sub, setSub] = useState<null | { kind: "series"; index: number | null; name: string; values: string } | { kind: "categories"; text: string } | { kind: "hidden" }>(null);
  const [picker, setPicker] = useState<Picker | null>(null);
  const previewChart = useMemo(() => ({ ...chart, series: draft.series, ...(draft.categories ? { categories: draft.categories } : { categories: undefined }) }), [chart, draft]);
  const preview = usePreviewData(store, previewChart);
  const close = () => closeDialog(store);
  const sheets = store.getState().info?.sheets ?? [];

  /** Chart data range: Excel re-derives the series from a new range. */
  const applyRange = async (text: string) => {
    const r = parseRange(text);
    if (!r) return;
    const sheet = r.sheet === null ? store.getState().activeSheet : sheets.find((s) => s.name.toLowerCase() === r.sheet!.toLowerCase())?.id;
    if (sheet === undefined) return;
    let rec: Chart | null = null;
    try {
      rec = await store.api.recommendedChart(sheet, r.r0, r.c0, r.r1, r.c1);
    } catch {
      rec = null;
    }
    if (!rec) return;
    setDraft((d) => ({ ...d, series: rec!.series.map((s, i) => ({ ...s, ...(chart.series[i]?.kind ? { kind: chart.series[i]!.kind } : {}) })), categories: rec!.categories ?? null }));
  };
  const switchData = () => {
    const next = switchRowCol({ series: draft.series, categories: draft.categories ?? undefined });
    if (next) setDraft((d) => ({ ...d, ...next }));
    else store.pushError(new Error(t("calc.chart.cannotSwitch")));
  };

  if (picker) {
    return (
      <PickBar
        store={store}
        picker={picker}
        onDone={() => {
          setPicker(null);
          if (picker.label === t("calc.chart.dataRange")) void applyRange(rangeText);
        }}
      />
    );
  }

  const seriesDialog = sub?.kind === "series" && (
    <Dialog open title={t("calc.chart.editSeries")} onClose={() => setSub(null)}>
      <form
        className="flex w-96 flex-col gap-3 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          setDraft((d) => (sub.index === null ? selectDataOps.add(d, sub.name, sub.values) : selectDataOps.edit(d, sub.index, sub.name, sub.values)));
          if (sub.index === null) setCurrent(draft.series.length);
          setSub(null);
        }}
      >
        <RangeField label={t("calc.chart.seriesName")} testId="series-name" value={sub.name} onChange={(v) => setSub({ ...sub, name: v })} onPick={(p) => setPicker({ ...p, set: (v) => setSub((s) => (s?.kind === "series" ? { ...s, name: v } : s)) })} />
        <RangeField label={t("calc.chart.seriesValues")} testId="series-values" value={sub.values} onChange={(v) => setSub({ ...sub, values: v })} onPick={(p) => setPicker({ ...p, set: (v) => setSub((s) => (s?.kind === "series" ? { ...s, values: v } : s)) })} />
        <OkCancel onCancel={() => setSub(null)} okDisabled={!parseDataRef(sub.values)} />
      </form>
    </Dialog>
  );
  const categoriesDialog = sub?.kind === "categories" && (
    <Dialog open title={t("calc.chart.axisLabels")} onClose={() => setSub(null)}>
      <form
        className="flex w-96 flex-col gap-3 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          setDraft((d) => selectDataOps.categories(d, sub.text));
          setSub(null);
        }}
      >
        <RangeField label={t("calc.chart.axisLabelRange")} testId="axis-labels" value={sub.text} onChange={(v) => setSub({ ...sub, text: v })} onPick={(p) => setPicker({ ...p, set: (v) => setSub((s) => (s?.kind === "categories" ? { ...s, text: v } : s)) })} />
        <OkCancel onCancel={() => setSub(null)} />
      </form>
    </Dialog>
  );
  const hiddenDialog = sub?.kind === "hidden" && (
    <Dialog open title={t("calc.chart.hiddenEmpty")} onClose={() => setSub(null)}>
      <div className="flex w-80 flex-col gap-2 text-sm">
        <div className="text-xs font-medium">{t("calc.chart.showEmptyAs")}</div>
        {(["gap", "zero", "span"] as const).map((b) => (
          <label key={b} className="flex items-center gap-2">
            <input type="radio" name="blanks" checked={draft.displayBlanksAs === b} onChange={() => setDraft((d) => ({ ...d, displayBlanksAs: b }))} />
            {t(`calc.chart.blanks.${b}`)}
          </label>
        ))}
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={!draft.plotVisibleOnly} onChange={(e) => setDraft((d) => ({ ...d, plotVisibleOnly: !e.target.checked }))} />
          {t("calc.chart.showHidden")}
        </label>
        <div className="flex justify-end">
          <button type="button" className={BTN} onClick={() => setSub(null)}>
            {t("common.ok")}
          </button>
        </div>
      </div>
    </Dialog>
  );

  const names = draft.series.map((s, i) => preview.series[i]?.name ?? (nameText(s.name) || `${t("calc.chart.series")}${i + 1}`));
  const cats = preview.series[0]?.categories ?? [];
  return (
    <>
      <Dialog open={!sub} title={t("calc.chart.selectDataSource")} onClose={close}>
        <form
          className="flex w-[40rem] max-w-[92vw] flex-col gap-3 text-sm"
          data-testid="select-data"
          onSubmit={(e) => {
            e.preventDefault();
            if (!sel) return close();
            store.closeDialog();
            void store.apply(selectDataCommand(sel.sheet, sel.id, chart, draft));
            store.focusGrid();
          }}
        >
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <RangeField
                label={t("calc.chart.dataRange")}
                testId="chart-data-range"
                value={rangeText}
                onChange={setRangeText}
                onPick={(p) => setPicker({ ...p, set: setRangeText })}
              />
            </div>
            <button type="button" className={BTN} onClick={() => void applyRange(rangeText)}>
              {t("calc.chart.apply")}
            </button>
          </div>
          <div className="flex justify-center">
            <button type="button" className={BTN} onClick={switchData}>
              {t("calc.chart.switchRowCol")}
            </button>
          </div>
          <div className="flex gap-3">
            <div className="flex flex-1 flex-col gap-1">
              <div className="text-xs font-medium">{t("calc.chart.legendEntries")}</div>
              <div className="flex gap-1">
                <button type="button" className={BTN} onClick={() => setSub({ kind: "series", index: null, name: "", values: "={1}" })}>
                  {t("calc.chart.add")}
                </button>
                <button
                  type="button"
                  className={BTN}
                  disabled={!draft.series[current]}
                  onClick={() => draft.series[current] && setSub({ kind: "series", index: current, name: nameText(draft.series[current]!.name), values: dataRefText(draft.series[current]!.values) })}
                >
                  {t("calc.chart.edit")}
                </button>
                <button
                  type="button"
                  className={BTN}
                  disabled={!draft.series[current]}
                  onClick={() => {
                    setDraft((d) => selectDataOps.remove(d, current));
                    setCurrent((c) => Math.max(0, c - 1));
                  }}
                >
                  {t("calc.chart.remove")}
                </button>
                <button type="button" className={`${BTN} px-2`} aria-label={t("calc.chart.moveUp")} disabled={current === 0} onClick={() => {
                  setDraft((d) => selectDataOps.move(d, current, -1));
                  setCurrent((c) => c - 1);
                }}>
                  ▲
                </button>
                <button type="button" className={`${BTN} px-2`} aria-label={t("calc.chart.moveDown")} disabled={current >= draft.series.length - 1} onClick={() => {
                  setDraft((d) => selectDataOps.move(d, current, 1));
                  setCurrent((c) => c + 1);
                }}>
                  ▼
                </button>
              </div>
              <div role="listbox" aria-label={t("calc.chart.legendEntries")} className={`${LIST} h-40`} data-testid="series-list">
                {names.map((n, i) => (
                  <button key={i} type="button" role="option" aria-selected={i === current} className={ROW(i === current)} onClick={() => setCurrent(i)}>
                    {n}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-1 flex-col gap-1">
              <div className="text-xs font-medium">{t("calc.chart.categoryLabels")}</div>
              <div className="flex gap-1">
                <button type="button" className={BTN} onClick={() => setSub({ kind: "categories", text: dataRefText(draft.categories) })}>
                  {t("calc.chart.edit")}
                </button>
              </div>
              <div role="list" aria-label={t("calc.chart.categoryLabels")} className={`${LIST} h-40`}>
                {cats.map((c, i) => (
                  <div key={i} role="listitem" className="px-2 py-0.5">
                    {c}
                  </div>
                ))}
              </div>
            </div>
          </div>
          <OkCancel
            onCancel={close}
            extra={
              <button type="button" className={`${BTN} mr-auto`} onClick={() => setSub({ kind: "hidden" })}>
                {t("calc.chart.hiddenEmptyDots")}
              </button>
            }
          />
        </form>
      </Dialog>
      {seriesDialog}
      {categoriesDialog}
      {hiddenDialog}
    </>
  );
}

/** The chart dialogs of `CalcDialogs`. */
export function ChartDialog({ store, dialog }: { store: CalcStore; dialog: Extract<CalcDialog, { kind: "recommendedCharts" | "changeChartType" | "moveChart" | "selectData" }> }) {
  switch (dialog.kind) {
    case "recommendedCharts":
      return <RecommendedChartsDialog store={store} />;
    case "changeChartType":
      return store.charts.selectedChart() ? <ChangeChartTypeDialog store={store} /> : null;
    case "moveChart":
      return store.charts.selectedChart() ? <MoveChartDialog store={store} /> : null;
    case "selectData":
      return store.charts.selectedChart() ? <SelectDataDialog store={store} /> : null;
  }
}

