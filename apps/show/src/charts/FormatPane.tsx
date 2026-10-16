// The chart Format pane of Show (P8-24, right of the stage): the options
// of Calc's pane (apps/calc/src/charts/FormatPane.tsx, which is tied to
// Calc's store and element selection) for the selected chart, by section
// instead of by selected element: chart (style, title, legend, empty
// cells), the series picked in the Format tab (fill, line, width, dash,
// markers, smooth, secondary axis, bar gap/overlap, pie angle, doughnut
// hole, trendline), the value and category axes (bounds, units, number
// format, log scale, reverse, gridlines, hide) and data labels. Every
// change is one `UpdateChart`.

import { useState, type ReactNode } from "react";
import { ColorPicker, type Color } from "@rusuite/ui-shared";
import { useT } from "../i18n";
import { useShow, type ShowStore } from "../state/store";
import { resolveShape } from "./data";
import { parseNumberField, setAxis, setLabels, setSecondary, setSeriesFill, setSeriesLine, setSeriesMarker, setSeriesProp, setTrendline } from "./format";
import { labelPositions } from "./presets";
import type { Axis, Chart, LabelPosition, LegendPosition, LineDash, MarkerSymbol } from "./types";

const FIELD = "h-7 w-full rounded border border-ui-border bg-ui-bg px-2 text-sm text-ui-fg";
const SECTION = "flex flex-col gap-2 border-b border-ui-border pb-3";
const EMU_PER_PT = 12_700;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={SECTION} aria-label={title}>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-ui-muted">{title}</h3>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid grid-cols-[7.5rem_1fr] items-center gap-2 text-sm">
      <span>{label}</span>
      {children}
    </label>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

/** A text field committed on Enter or blur. */
function Commit({ label, value, onCommit, placeholder }: { label: string; value: string; onCommit: (v: string) => void; placeholder?: string }) {
  const [text, setText] = useState(value);
  const [base, setBase] = useState(value);
  if (base !== value) {
    setBase(value);
    setText(value);
  }
  return (
    <Row label={label}>
      <input
        className={FIELD}
        aria-label={label}
        value={text}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text !== value && onCommit(text)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onCommit(text);
          }
        }}
      />
    </Row>
  );
}

const DASHES: LineDash[] = ["solid", "sysDot", "sysDash", "dash", "dashDot", "lgDash", "lgDashDot", "lgDashDotDot"];
const MARKERS: MarkerSymbol[] = ["auto", "none", "circle", "square", "diamond", "triangle", "x", "star", "plus", "dash", "dot"];
const LEGENDS: LegendPosition[] = ["right", "top", "left", "bottom", "topRight"];

/** A number field: blank = automatic. */
function NumberField({ label, value, onCommit }: { label: string; value: number | undefined; onCommit: (v: number | undefined) => void }) {
  const t = useT();
  return (
    <Commit
      label={label}
      value={value === undefined ? "" : String(value)}
      placeholder={t("show.chart.fp.auto")}
      onCommit={(text) => {
        const v = parseNumberField(text);
        if (v !== null) onCommit(v);
      }}
    />
  );
}

export function ChartFormatPane({ store }: { store: ShowStore }) {
  const t = useT();
  const open = useShow(store, (s) => s.chartPane);
  const pres = useShow(store, (s) => s.pres);
  const selection = useShow(store, (s) => s.selection);
  const seriesChoice = useShow(store, (s) => s.chartSeries);
  void pres;
  void selection;
  const sel = store.selectedChart();
  if (!open || !sel) return null;
  const chart = sel.chart.chart as Chart;
  if (chart.kind.type === "unsupported") return null;
  const data = resolveShape(sel.chart);
  const edit = (fn: (c: Chart) => Chart) => void store.updateChart(fn);
  const i = Math.min(seriesChoice, Math.max(0, chart.series.length - 1));
  const s = chart.series[i];
  const kind = chart.kind.type === "combo" ? (s?.kind ?? chart.kind) : chart.kind;
  const pie = kind.type === "pie" || kind.type === "doughnut";
  const lines = kind.type === "line" || kind.type === "scatter";
  const axis = (id: "val" | "cat", label: string) => {
    const a: Axis = chart.axes[id];
    const set = (patch: Partial<Axis>) => edit((c) => setAxis(c, id, patch));
    return (
      <Section title={label}>
        {id === "val" && (
          <>
            <NumberField label={t("show.chart.fp.min")} value={a.min} onCommit={(v) => set({ min: v })} />
            <NumberField label={t("show.chart.fp.max")} value={a.max} onCommit={(v) => set({ max: v })} />
            <NumberField label={t("show.chart.fp.major")} value={a.majorUnit} onCommit={(v) => set({ majorUnit: v })} />
            <NumberField label={t("show.chart.fp.minor")} value={a.minorUnit} onCommit={(v) => set({ minorUnit: v })} />
            <Commit label={t("show.chart.fp.numberFormat")} value={a.numberFormat ?? ""} placeholder={t("show.chart.fp.linked")} onCommit={(v) => set({ numberFormat: v.trim() || undefined })} />
            <Check label={t("show.chart.fp.log")} checked={a.logBase !== undefined} onChange={(v) => set({ logBase: v ? 10 : undefined })} />
          </>
        )}
        <Check label={t(id === "val" ? "show.chart.fp.reverseValues" : "show.chart.fp.reverseCategories")} checked={!!a.reverse} onChange={(v) => set({ reverse: v || undefined })} />
        <Check label={t("show.chart.ae.majorGridlines")} checked={!!a.majorGridlines} onChange={(v) => set({ majorGridlines: v || undefined })} />
        <Check label={t("show.chart.fp.hideAxis")} checked={!!a.delete} onChange={(v) => set({ delete: v || undefined })} />
      </Section>
    );
  };
  const labels = chart.dataLabels ?? {};
  const setL = (patch: Parameters<typeof setLabels>[2]) => edit((c) => setLabels(c, undefined, patch));
  return (
    <aside className="flex w-72 shrink-0 flex-col gap-3 overflow-y-auto border-l border-ui-border bg-ui-panel p-3" aria-label={t("show.chart.formatPane")} data-testid="chart-format-pane">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">{t("show.chart.formatChart")}</h2>
        <button type="button" className="rounded px-1 hover:bg-ui-hover" aria-label={t("common.close")} onClick={() => store.toggleChartPane(false)}>
          ×
        </button>
      </div>
      <Section title={t("show.chart.fp.chartOptions")}>
        <Commit
          label={t("show.chart.ae.chartTitle")}
          value={chart.title?.text?.type === "literal" ? chart.title.text.text : (data.title ?? "")}
          onCommit={(v) => edit((c) => ({ ...c, title: v.trim() ? { ...(c.title ?? {}), text: { type: "literal", text: v } } : c.title ? { ...c.title, text: undefined } : undefined }))}
        />
        <Row label={t("show.chart.fp.legendPosition")}>
          <select
            className={FIELD}
            aria-label={t("show.chart.fp.legendPosition")}
            value={chart.legend?.position ?? "none"}
            onChange={(e) => {
              const v = e.target.value as LegendPosition | "none";
              edit((c) => (v === "none" ? { ...c, legend: undefined } : { ...c, legend: { ...(c.legend ?? {}), position: v } }));
            }}
          >
            <option value="none">{t("show.chart.none")}</option>
            {LEGENDS.map((p) => (
              <option key={p} value={p}>
                {t(`show.chart.pos.${p}`)}
              </option>
            ))}
          </select>
        </Row>
        <Row label={t("show.chart.fp.style")}>
          <input
            type="number"
            min={1}
            max={48}
            className={FIELD}
            aria-label={t("show.chart.fp.style")}
            value={chart.style ?? 2}
            onChange={(e) => {
              const v = Math.round(e.target.valueAsNumber);
              if (v >= 1 && v <= 48) edit((c) => ({ ...c, style: v }));
            }}
          />
        </Row>
        <Row label={t("show.chart.showEmptyAs")}>
          <select className={FIELD} aria-label={t("show.chart.showEmptyAs")} value={chart.displayBlanksAs ?? "gap"} onChange={(e) => edit((c) => ({ ...c, displayBlanksAs: e.target.value as Chart["displayBlanksAs"] }))}>
            <option value="gap">{t("show.chart.blanks.gap")}</option>
            <option value="zero">{t("show.chart.blanks.zero")}</option>
            <option value="span">{t("show.chart.blanks.span")}</option>
          </select>
        </Row>
      </Section>
      {s && (
        <Section title={t("show.chart.seriesX", { name: data.series[i]?.name ?? "" })}>
          <Row label={t("show.chart.fp.fill")}>
            <ColorPicker label={t("show.chart.fp.fill")} kind="fill" onSelect={(c: Color | null) => edit((ch) => setSeriesFill(ch, i, undefined, c))} />
          </Row>
          <Row label={t("show.chart.fp.lineColor")}>
            <ColorPicker label={t("show.chart.fp.lineColor")} kind="text" onSelect={(c: Color | null) => edit((ch) => setSeriesLine(ch, i, c === null ? { none: true } : { color: c, none: undefined }))} />
          </Row>
          <NumberField label={t("show.chart.fp.width")} value={s.line?.width === undefined ? undefined : s.line.width / EMU_PER_PT} onCommit={(v) => edit((c) => setSeriesLine(c, i, { width: v === undefined ? undefined : Math.round(v * EMU_PER_PT) }))} />
          <Row label={t("show.chart.fp.dash")}>
            <select className={FIELD} aria-label={t("show.chart.fp.dash")} value={s.line?.dash ?? "solid"} onChange={(e) => edit((c) => setSeriesLine(c, i, { dash: e.target.value as LineDash }))}>
              {DASHES.map((d) => (
                <option key={d} value={d}>
                  {t(`show.chart.dash.${d}`)}
                </option>
              ))}
            </select>
          </Row>
          {lines && (
            <>
              <Row label={t("show.chart.fp.marker")}>
                <select className={FIELD} aria-label={t("show.chart.fp.marker")} value={s.marker?.symbol ?? "auto"} onChange={(e) => edit((c) => setSeriesMarker(c, i, { symbol: e.target.value as MarkerSymbol }))}>
                  {MARKERS.map((m) => (
                    <option key={m} value={m}>
                      {t(`show.chart.marker.${m}`)}
                    </option>
                  ))}
                </select>
              </Row>
              <Check label={t("show.chart.fp.smooth")} checked={!!s.smooth} onChange={(v) => edit((c) => setSeriesProp(c, i, "smooth", v || undefined))} />
            </>
          )}
          {chart.kind.type === "combo" && <Check label={t("show.chart.fp.secondary")} checked={s.axis === "secondary"} onChange={(v) => edit((c) => setSecondary(c, i, v))} />}
          {kind.type === "bar" && (
            <>
              <NumberField label={t("show.chart.fp.gapWidth")} value={chart.gapWidth} onCommit={(v) => edit((c) => ({ ...c, gapWidth: v === undefined ? undefined : Math.max(0, Math.min(500, Math.round(v))) }))} />
              <NumberField label={t("show.chart.fp.overlap")} value={chart.overlap} onCommit={(v) => edit((c) => ({ ...c, overlap: v === undefined ? undefined : Math.max(-100, Math.min(100, Math.round(v))) }))} />
            </>
          )}
          {pie && <NumberField label={t("show.chart.fp.firstSlice")} value={chart.firstSliceAngle} onCommit={(v) => edit((c) => ({ ...c, firstSliceAngle: v === undefined ? undefined : ((Math.round(v) % 360) + 360) % 360 }))} />}
          {kind.type === "doughnut" && <NumberField label={t("show.chart.fp.holeSize")} value={chart.holeSize} onCommit={(v) => edit((c) => ({ ...c, holeSize: v === undefined ? undefined : Math.max(10, Math.min(90, Math.round(v))) }))} />}
          {pie && <Check label={t("show.chart.fp.varyColors")} checked={!!chart.varyColors} onChange={(v) => edit((c) => ({ ...c, varyColors: v || undefined }))} />}
          {!pie && (
            <Check label={t("show.chart.ae.trendline")} checked={!!s.trendline} onChange={(v) => edit((c) => setTrendline(c, i, v ? { kind: { type: "linear" } } : null))} />
          )}
        </Section>
      )}
      {!pie && axis("val", t("show.chart.fp.valueAxis"))}
      {!pie && axis("cat", t("show.chart.fp.categoryAxis"))}
      <Section title={t("show.chart.ae.dataLabels")}>
        <Check label={t("show.chart.fp.value")} checked={!!labels.showValue} onChange={(v) => setL({ showValue: v || undefined })} />
        {pie && <Check label={t("show.chart.fp.percentage")} checked={!!labels.showPercent} onChange={(v) => setL({ showPercent: v || undefined })} />}
        <Check label={t("show.chart.fp.categoryName")} checked={!!labels.showCategory} onChange={(v) => setL({ showCategory: v || undefined })} />
        <Check label={t("show.chart.fp.seriesName")} checked={!!labels.showSeries} onChange={(v) => setL({ showSeries: v || undefined })} />
        <Row label={t("show.chart.fp.labelPosition")}>
          <select className={FIELD} aria-label={t("show.chart.fp.labelPosition")} value={labels.position ?? labelPositions(chart.kind)[0]} onChange={(e) => setL({ position: e.target.value as LabelPosition })}>
            {labelPositions(chart.kind).map((p) => (
              <option key={p} value={p}>
                {t(`show.chart.pos.${p}`)}
              </option>
            ))}
          </select>
        </Row>
      </Section>
    </aside>
  );
}
