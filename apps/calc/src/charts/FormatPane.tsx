// The Format pane (right of the grid) for the selected chart element:
// fill and outline, markers, series options (gap width, overlap, hole size,
// first slice angle, smooth, secondary axis), axis options (bounds, units,
// number format, log scale, reverse, crossing, tick labels), data labels,
// legend, titles and trendlines. Every change is one undoable command.

import { useState, type ReactNode } from "react";
import { ColorPicker, type ChartElement, type Color } from "@rusuite/ui-shared";
import type { Axis } from "../generated/Axis";
import type { Chart } from "../generated/Chart";
import type { LabelPosition } from "../generated/LabelPosition";
import type { LegendPosition } from "../generated/LegendPosition";
import type { LineDash } from "../generated/LineDash";
import type { MarkerSymbol } from "../generated/MarkerSymbol";
import type { TrendlineKind } from "../generated/TrendlineKind";
import { useT } from "../i18n";
import { useCalc, type CalcStore } from "../state/store";
import { elementName } from "./elements";
import { parseNumberField, setAxis, setLabels, setSecondary, setSeriesFill, setSeriesLine, setSeriesMarker, setSeriesProp, setTrendline } from "./format";
import { labelPositions } from "./presets";
import { AreaSection, ChartExtrasSection, ErrorBarSection, LabelExtrasSection, TextSection } from "./FormatPaneC6";
import { setChartArea, setPlotArea } from "./extras";

export const FIELD = "h-7 w-full rounded border border-ui-border bg-ui-bg px-2 text-sm text-ui-fg";
const SECTION = "flex flex-col gap-2 border-b border-ui-border pb-3";
const EMU_PER_PT = 12_700;

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={SECTION} aria-label={title}>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-ui-muted">{title}</h3>
      {children}
    </section>
  );
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid grid-cols-[7.5rem_1fr] items-center gap-2 text-sm">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

/** A text/number field committed on Enter or blur. */
export function Commit({ label, value, onCommit, placeholder, testId }: { label: string; value: string; onCommit: (v: string) => void; placeholder?: string; testId?: string }) {
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
        data-testid={testId}
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

export function ChartFormatPane({ store }: { store: CalcStore }) {
  const t = useT();
  useCalc(store, (s) => s.version);
  const charts = store.charts;
  const sel = charts.selected;
  const obj = charts.selectedChart();
  if (!charts.pane || !sel || !obj) return null;
  const chart = obj.chart;
  const data = charts.dataOf(sel.sheet, obj);
  const el: ChartElement = sel.element ?? { type: "chartArea" };
  const edit = (fn: (c: Chart) => Chart) => void charts.edit(fn);
  const close = () => {
    charts.pane = false;
    store.notify();
    store.focusGrid();
  };
  const kind = chart.kind;
  const pieLike = kind.type === "pie" || kind.type === "doughnut";
  const ro = kind.type === "unsupported";

  const seriesPane = (i: number, point?: number) => {
    const s = chart.series[i];
    if (!s) return null;
    const sk = kind.type === "combo" ? (s.kind ?? { type: "bar" as const }) : kind;
    const line = sk.type === "line" || sk.type === "scatter";
    const bars = sk.type === "bar";
    return (
      <>
        <Section title={t("calc.chart.fp.fillLine")}>
          <Row label={line ? t("calc.chart.fp.lineColor") : t("calc.chart.fp.fill")}>
            <ColorPicker label={line ? t("calc.chart.fp.lineColor") : t("calc.chart.fp.fill")} kind="fill" onSelect={(c: Color | null) => edit((ch) => setSeriesFill(ch, i, point, c))} />
          </Row>
          {!line && (
            <Row label={t("calc.chart.fp.border")}>
              <ColorPicker label={t("calc.chart.fp.border")} kind="text" onSelect={(c: Color | null) => edit((ch) => setSeriesLine(ch, i, c === null ? { none: true } : { color: c }))} />
            </Row>
          )}
          <Commit
            label={t("calc.chart.fp.width")}
            value={s.line?.width ? String(Math.round((s.line.width / EMU_PER_PT) * 100) / 100) : ""}
            placeholder={line ? "2.25" : "0"}
            onCommit={(v) => {
              const n = parseNumberField(v);
              if (n !== null) edit((ch) => setSeriesLine(ch, i, { width: n === undefined ? undefined : Math.round(n * EMU_PER_PT) }));
            }}
          />
          <Row label={t("calc.chart.fp.dash")}>
            <select className={FIELD} aria-label={t("calc.chart.fp.dash")} value={s.line?.dash ?? "solid"} onChange={(e) => edit((ch) => setSeriesLine(ch, i, { dash: e.target.value === "solid" ? undefined : (e.target.value as LineDash) }))}>
              {DASHES.map((d) => (
                <option key={d} value={d}>
                  {t(`calc.chart.dash.${d}`)}
                </option>
              ))}
            </select>
          </Row>
          {line && (
            <>
              <Row label={t("calc.chart.fp.marker")}>
                <select
                  className={FIELD}
                  aria-label={t("calc.chart.fp.marker")}
                  value={s.marker?.symbol ?? "auto"}
                  onChange={(e) => edit((ch) => setSeriesMarker(ch, i, { symbol: e.target.value as MarkerSymbol }))}
                >
                  {MARKERS.map((m) => (
                    <option key={m} value={m}>
                      {t(`calc.chart.marker.${m}`)}
                    </option>
                  ))}
                </select>
              </Row>
              <Commit
                label={t("calc.chart.fp.markerSize")}
                value={s.marker?.size ? String(s.marker.size) : ""}
                placeholder="5"
                onCommit={(v) => {
                  const n = parseNumberField(v);
                  if (n !== null) edit((ch) => setSeriesMarker(ch, i, { size: n === undefined ? undefined : Math.max(2, Math.min(72, Math.round(n))) }));
                }}
              />
              <Check label={t("calc.chart.fp.smooth")} checked={!!s.smooth} onChange={(v) => edit((ch) => setSeriesProp(ch, i, "smooth", v || undefined))} />
            </>
          )}
        </Section>
        <Section title={t("calc.chart.fp.seriesOptions")}>
          {!pieLike && kind.type !== "scatter" && (
            <Check label={t("calc.chart.fp.secondary")} checked={s.axis === "secondary"} onChange={(v) => edit((ch) => setSecondary(ch, i, v))} />
          )}
          {bars && (
            <>
              <Commit label={t("calc.chart.fp.gapWidth")} testId="gap-width" value={String(chart.gapWidth ?? 150)} onCommit={(v) => {
                const n = parseNumberField(v);
                if (n !== null) edit((ch) => ({ ...ch, gapWidth: n === undefined ? undefined : Math.max(0, Math.min(500, n)) }));
              }} />
              <Commit label={t("calc.chart.fp.overlap")} value={String(chart.overlap ?? 0)} onCommit={(v) => {
                const n = parseNumberField(v);
                if (n !== null) edit((ch) => ({ ...ch, overlap: n === undefined ? undefined : Math.max(-100, Math.min(100, n)) }));
              }} />
            </>
          )}
          {kind.type === "doughnut" && (
            <Commit label={t("calc.chart.fp.holeSize")} value={String(chart.holeSize ?? 50)} onCommit={(v) => {
              const n = parseNumberField(v);
              if (n !== null) edit((ch) => ({ ...ch, holeSize: n === undefined ? undefined : Math.max(10, Math.min(90, n)) }));
            }} />
          )}
          {pieLike && (
            <>
              <Commit label={t("calc.chart.fp.firstSlice")} value={String(chart.firstSliceAngle ?? 0)} onCommit={(v) => {
                const n = parseNumberField(v);
                if (n !== null) edit((ch) => ({ ...ch, firstSliceAngle: n === undefined ? undefined : ((Math.round(n) % 360) + 360) % 360 }));
              }} />
              <Check label={t("calc.chart.fp.varyColors")} checked={chart.varyColors ?? false} onChange={(v) => edit((ch) => ({ ...ch, varyColors: v }))} />
            </>
          )}
        </Section>
      </>
    );
  };

  const axisPane = (axis: "cat" | "val" | "secondVal") => {
    const a: Axis = chart.axes[axis] ?? {};
    const valueLike = axis !== "cat" || kind.type === "scatter";
    const num = (key: "min" | "max" | "majorUnit" | "minorUnit", label: string) => (
      <Commit
        label={label}
        testId={`axis-${key}`}
        value={a[key] === undefined ? "" : String(a[key])}
        placeholder={t("calc.chart.fp.auto")}
        onCommit={(v) => {
          const n = parseNumberField(v);
          if (n !== null) edit((ch) => setAxis(ch, axis, { [key]: n }));
        }}
      />
    );
    // Where the other axis crosses this one is stored on the other axis (OOXML `crosses`).
    const other = axis === "cat" ? "val" : "cat";
    const crosses = chart.axes[other]?.crosses ?? { type: "autoZero" as const };
    const crossChoice = crosses.type === "at" ? "at" : crosses.type === "max" ? "max" : "auto";
    return (
      <Section title={t("calc.chart.fp.axisOptions")}>
        {valueLike && (
          <>
            {num("min", t("calc.chart.fp.min"))}
            {num("max", t("calc.chart.fp.max"))}
            {num("majorUnit", t("calc.chart.fp.major"))}
            {num("minorUnit", t("calc.chart.fp.minor"))}
            <Check
              label={t("calc.chart.fp.log")}
              checked={!!a.logBase}
              onChange={(v) => edit((ch) => setAxis(ch, axis, { logBase: v ? 10 : undefined }))}
            />
            {a.logBase && (
              <Commit label={t("calc.chart.fp.logBase")} value={String(a.logBase)} onCommit={(v) => {
                const n = parseNumberField(v);
                if (n && n >= 2) edit((ch) => setAxis(ch, axis, { logBase: n }));
              }} />
            )}
          </>
        )}
        {axis !== "secondVal" && (
          <Row label={axis === "cat" && kind.type !== "scatter" ? t("calc.chart.fp.valueCrosses") : t("calc.chart.fp.otherCrosses")}>
            <span className="flex gap-1">
              <select
                className={FIELD}
                aria-label={t("calc.chart.fp.otherCrosses")}
                value={crossChoice}
                onChange={(e) => {
                  const v = e.target.value;
                  edit((ch) => setAxis(ch, other, { crosses: v === "max" ? { type: "max" } : v === "at" ? { type: "at", value: 0 } : undefined }));
                }}
              >
                <option value="auto">{t("calc.chart.fp.automatic")}</option>
                {(axis !== "cat" || kind.type === "scatter") && <option value="at">{t("calc.chart.fp.atValue")}</option>}
                <option value="max">{axis === "cat" && kind.type !== "scatter" ? t("calc.chart.fp.atMaxCategory") : t("calc.chart.fp.atMax")}</option>
              </select>
            </span>
          </Row>
        )}
        {crossChoice === "at" && axis !== "secondVal" && (
          <Commit label={t("calc.chart.fp.crossValue")} value={String(crosses.type === "at" ? crosses.value : 0)} onCommit={(v) => {
            const n = parseNumberField(v);
            if (typeof n === "number") edit((ch) => setAxis(ch, other, { crosses: { type: "at", value: n } }));
          }} />
        )}
        <Check
          label={axis === "cat" && kind.type !== "scatter" ? t("calc.chart.fp.reverseCategories") : t("calc.chart.fp.reverseValues")}
          checked={!!a.reverse}
          onChange={(v) => edit((ch) => setAxis(ch, axis, { reverse: v || undefined }))}
        />
        <Row label={t("calc.chart.fp.tickLabels")}>
          <select className={FIELD} aria-label={t("calc.chart.fp.tickLabels")} value={a.tickLabels ?? "nextTo"} onChange={(e) => edit((ch) => setAxis(ch, axis, { tickLabels: e.target.value === "nextTo" ? undefined : (e.target.value as Axis["tickLabels"]) }))}>
            {(["nextTo", "high", "low", "none"] as const).map((x) => (
              <option key={x} value={x}>
                {t(`calc.chart.ticks.${x}`)}
              </option>
            ))}
          </select>
        </Row>
        <Commit label={t("calc.chart.fp.numberFormat")} testId="axis-format" value={a.numberFormat ?? ""} placeholder={t("calc.chart.fp.linked")} onCommit={(v) => edit((ch) => setAxis(ch, axis, { numberFormat: v.trim() || undefined }))} />
        <Check label={t("calc.chart.fp.hideAxis")} checked={!!a.delete} onChange={(v) => edit((ch) => setAxis(ch, axis, { delete: v || undefined }))} />
      </Section>
    );
  };

  const labelsPane = (series?: number) => {
    const d = (series !== undefined ? chart.series[series]?.dataLabels : undefined) ?? chart.dataLabels ?? {};
    const flag = (key: "showSeries" | "showCategory" | "showValue" | "showPercent" | "showLegendKey", label: string) => (
      <Check label={label} checked={!!d[key]} onChange={(v) => edit((ch) => setLabels(ch, series, { [key]: v || undefined }))} />
    );
    return (
      <Section title={t("calc.chart.fp.labelOptions")}>
        {flag("showSeries", t("calc.chart.fp.seriesName"))}
        {flag("showCategory", t("calc.chart.fp.categoryName"))}
        {flag("showValue", t("calc.chart.fp.value"))}
        {pieLike && flag("showPercent", t("calc.chart.fp.percentage"))}
        <Row label={t("calc.chart.fp.labelPosition")}>
          <select className={FIELD} aria-label={t("calc.chart.fp.labelPosition")} value={d.position ?? labelPositions(kind)[0]} onChange={(e) => edit((ch) => setLabels(ch, series, { position: e.target.value as LabelPosition }))}>
            {labelPositions(kind).map((p) => (
              <option key={p} value={p}>
                {t(`calc.chart.pos.${p}`)}
              </option>
            ))}
          </select>
        </Row>
        <Commit label={t("calc.chart.fp.numberFormat")} value={d.numberFormat ?? ""} placeholder={t("calc.chart.fp.linked")} onCommit={(v) => edit((ch) => setLabels(ch, series, { numberFormat: v.trim() || undefined }))} />
      </Section>
    );
  };

  const trendPane = (i: number) => {
    const tl = chart.series[i]?.trendline;
    if (!tl) return null;
    const kindId = tl.kind.type;
    const setKind = (k: TrendlineKind) => edit((ch) => setTrendline(ch, i, { ...tl, kind: k }));
    return (
      <Section title={t("calc.chart.fp.trendOptions")}>
        <Row label={t("calc.chart.fp.trendType")}>
          <select
            className={FIELD}
            aria-label={t("calc.chart.fp.trendType")}
            value={kindId}
            onChange={(e) => {
              const v = e.target.value;
              setKind(v === "polynomial" ? { type: "polynomial", order: 2 } : v === "movingAverage" ? { type: "movingAverage", period: 2 } : ({ type: v } as TrendlineKind));
            }}
          >
            {(["linear", "exponential", "logarithmic", "power", "polynomial", "movingAverage"] as const).map((k) => (
              <option key={k} value={k}>
                {t(`calc.chart.trend.${k}`)}
              </option>
            ))}
          </select>
        </Row>
        {tl.kind.type === "polynomial" && (
          <Commit label={t("calc.chart.fp.order")} value={String(tl.kind.order)} onCommit={(v) => {
            const n = parseNumberField(v);
            if (n) setKind({ type: "polynomial", order: Math.max(2, Math.min(6, Math.round(n))) });
          }} />
        )}
        {tl.kind.type === "movingAverage" && (
          <Commit label={t("calc.chart.fp.period")} value={String(tl.kind.period)} onCommit={(v) => {
            const n = parseNumberField(v);
            if (n) setKind({ type: "movingAverage", period: Math.max(2, Math.round(n)) });
          }} />
        )}
        <Commit label={t("calc.chart.fp.trendName")} value={tl.name ?? ""} placeholder={t("calc.chart.fp.automatic")} onCommit={(v) => edit((ch) => setTrendline(ch, i, { ...tl, name: v.trim() || undefined }))} />
        {tl.kind.type !== "movingAverage" && (
          <>
            <Check label={t("calc.chart.fp.equation")} checked={!!tl.displayEquation} onChange={(v) => edit((ch) => setTrendline(ch, i, { ...tl, displayEquation: v || undefined }))} />
            <Check label={t("calc.chart.fp.rSquared")} checked={!!tl.displayRSquared} onChange={(v) => edit((ch) => setTrendline(ch, i, { ...tl, displayRSquared: v || undefined }))} />
          </>
        )}
        <button type="button" className="h-7 rounded border border-ui-border px-3 text-sm hover:bg-ui-hover" onClick={() => edit((ch) => setTrendline(ch, i, null))}>
          {t("calc.chart.fp.removeTrend")}
        </button>
      </Section>
    );
  };

  const titleText = (src: Chart["title"]) => (src?.text?.type === "literal" ? src.text.text : "");
  let body: ReactNode;
  switch (el.type) {
    case "series":
      body = (
        <>
          {seriesPane(el.series, el.point)}
          {el.point === undefined && <ErrorBarSection chart={chart} i={el.series} edit={edit} />}
        </>
      );
      break;
    case "dataLabels":
      body = (
        <>
          {labelsPane(el.series)}
          <LabelExtrasSection chart={chart} i={el.series} point={el.point} edit={edit} />
          <TextSection chart={chart} target={{ el: "labels", series: el.series }} edit={edit} />
        </>
      );
      break;
    case "trendline":
      body = trendPane(el.series);
      break;
    case "errorBars":
      body = <ErrorBarSection chart={chart} i={el.series} edit={edit} />;
      break;
    case "dataTable":
    case "upDownBars":
    case "highLowLines":
      body = (
        <>
          <ChartExtrasSection chart={chart} edit={edit} />
          {el.type === "dataTable" && <TextSection chart={chart} target={{ el: "dataTable" }} edit={edit} />}
        </>
      );
      break;
    case "plotArea":
      body = <AreaSection title={t("calc.chart.fp.plotArea")} testId="plot-fill" shape={chart.plotArea} set={(patch) => edit((c) => setPlotArea(c, patch))} />;
      break;
    case "axis":
      body = (
        <>
          {axisPane(el.axis)}
          <TextSection chart={chart} target={{ el: "axis", axis: el.axis }} edit={edit} angle />
        </>
      );
      break;
    case "gridlines":
      body = (
        <Section title={t("calc.chart.fp.gridlines")}>
          <Check label={t("calc.chart.ae.majorGridlines")} checked={!!chart.axes[el.axis]?.majorGridlines} onChange={(v) => edit((ch) => setAxis(ch, el.axis, { majorGridlines: v || undefined }))} />
          <Check label={t("calc.chart.ae.minorGridlines")} checked={!!chart.axes[el.axis]?.minorGridlines} onChange={(v) => edit((ch) => setAxis(ch, el.axis, { minorGridlines: v || undefined }))} />
        </Section>
      );
      break;
    case "legend":
      body = (
        <Section title={t("calc.chart.fp.legendOptions")}>
          <div role="radiogroup" aria-label={t("calc.chart.fp.legendPosition")} className="flex flex-col gap-1">
            {(["top", "bottom", "left", "right", "topRight"] as LegendPosition[]).map((p) => (
              <label key={p} className="flex items-center gap-2 text-sm">
                <input type="radio" name="legendPos" checked={chart.legend?.position === p} onChange={() => edit((ch) => ({ ...ch, legend: { ...(ch.legend ?? {}), position: p } }))} />
                {t(`calc.chart.pos.${p}`)}
              </label>
            ))}
          </div>
          <Check label={t("calc.chart.fp.overlayLegend")} checked={!!chart.legend?.overlay} onChange={(v) => edit((ch) => (ch.legend ? { ...ch, legend: { ...ch.legend, overlay: v || undefined } } : ch))} />
        </Section>
      );
      body = (
        <>
          {body}
          <TextSection chart={chart} target={{ el: "legend" }} edit={edit} />
        </>
      );
      break;
    case "title":
      body = (
        <Section title={t("calc.chart.fp.titleOptions")}>
          <Commit label={t("calc.chart.fp.text")} value={titleText(chart.title)} placeholder={t("calc.chart.fp.automatic")} testId="chart-title-text" onCommit={(v) => edit((ch) => ({ ...ch, title: { ...(ch.title ?? {}), text: v.trim() ? { type: "literal", text: v } : undefined } }))} />
          <Check label={t("calc.chart.fp.overlayTitle")} checked={!!chart.title?.overlay} onChange={(v) => edit((ch) => ({ ...ch, title: { ...(ch.title ?? {}), overlay: v || undefined } }))} />
        </Section>
      );
      body = (
        <>
          {body}
          <TextSection chart={chart} target={{ el: "title" }} edit={edit} />
        </>
      );
      break;
    case "axisTitle": {
      const a = chart.axes[el.axis];
      body = (
        <Section title={t("calc.chart.fp.titleOptions")}>
          <Commit label={t("calc.chart.fp.text")} value={titleText(a?.title)} placeholder={t("calc.chart.axisTitle")} onCommit={(v) => edit((ch) => setAxis(ch, el.axis, { title: { ...(a?.title ?? {}), text: v.trim() ? { type: "literal", text: v } : undefined } }))} />
        </Section>
      );
      body = (
        <>
          {body}
          <TextSection chart={chart} target={{ el: "axisTitle", axis: el.axis }} edit={edit} angle />
        </>
      );
      break;
    }
    default:
      body = (
        <Section title={t("calc.chart.fp.chartOptions")}>
          <Row label={t("calc.chart.fp.style")}>
            <input
              className={FIELD}
              type="number"
              min={1}
              max={48}
              aria-label={t("calc.chart.fp.style")}
              value={chart.style ?? 2}
              onChange={(e) => {
                const n = Math.round(Number(e.target.value));
                if (n >= 1 && n <= 48) edit((ch) => ({ ...ch, style: n }));
              }}
            />
          </Row>
          <Row label={t("calc.chart.showEmptyAs")}>
            <select className={FIELD} aria-label={t("calc.chart.showEmptyAs")} value={chart.displayBlanksAs ?? "gap"} onChange={(e) => edit((ch) => ({ ...ch, displayBlanksAs: e.target.value as Chart["displayBlanksAs"] }))}>
              {(["gap", "zero", "span"] as const).map((b) => (
                <option key={b} value={b}>
                  {t(`calc.chart.blanks.${b}`)}
                </option>
              ))}
            </select>
          </Row>
          <Check label={t("calc.chart.showHidden")} checked={!(chart.plotVisibleOnly ?? true)} onChange={(v) => edit((ch) => ({ ...ch, plotVisibleOnly: !v }))} />
          {pieLike && <Check label={t("calc.chart.fp.varyColors")} checked={chart.varyColors ?? false} onChange={(v) => edit((ch) => ({ ...ch, varyColors: v }))} />}
        </Section>
      );
      body = (
        <>
          {body}
          <AreaSection
            title={t("calc.chart.fp.chartArea")}
            testId="chart-fill"
            shape={chart.chartArea}
            set={(patch) => edit((c) => setChartArea(c, patch))}
            rounded={{ on: !!chart.roundedCorners, set: (v) => edit((c) => ({ ...c, roundedCorners: v || undefined })) }}
          />
          <TextSection chart={chart} target={{ el: "chart" }} edit={edit} />
          <ChartExtrasSection chart={chart} edit={edit} />
        </>
      );
  }

  return (
    <aside
      className="flex w-72 shrink-0 flex-col overflow-y-auto border-l border-ui-border bg-ui-panel p-3 text-ui-fg"
      aria-label={t("calc.chart.formatPane")}
      data-testid="chart-format-pane"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          close();
        }
      }}
    >
      <div className="mb-2 flex items-center gap-2">
        <h2 className="flex-1 text-sm font-semibold">{t("calc.chart.formatX", { name: elementName(sel.element, chart, data) })}</h2>
        <button type="button" className="h-6 w-6 rounded hover:bg-ui-hover" aria-label={t("common.close")} onClick={close}>
          ×
        </button>
      </div>
      {ro ? <p className="text-sm text-ui-muted">{t("calc.chart.readOnly")}</p> : <div className="flex flex-col gap-3">{body}</div>}
    </aside>
  );
}
