// The Format pane sections of P9-C6: fill / border / effects of the chart
// area and the plot area, text options of every text element (font, size,
// bold, italic, colour, custom angle), error bars, data label extras (Value
// From Cells, leader lines, a single point's label), the data table, up/down
// bars and high-low lines. Every change is one undoable command.

import { ColorPicker, type Color } from "@rusuite/ui-shared";
import type { AreaFill } from "../generated/AreaFill";
import type { Chart } from "../generated/Chart";
import type { ErrorBars } from "../generated/ErrorBars";
import type { LineDash } from "../generated/LineDash";
import type { ShapeFormat } from "../generated/ShapeFormat";
import { useT } from "../i18n";
import { Check, Commit, FIELD, Row, Section } from "./FormatPane";
import { gradientFill, patchSeriesLabels, setErrorBars, setPointLabel, setTextFormat, textFormatOf, type TextTarget } from "./extras";
import { parseNumberField } from "./format";
import { dataRefText, parseDataRef } from "./refs";

type Edit = (fn: (c: Chart) => Chart) => void;
const EMU_PER_PT = 12_700;
const DASHES: LineDash[] = ["solid", "sysDot", "sysDash", "dash", "dashDot", "lgDash", "lgDashDot", "lgDashDotDot"];
const WHITE: Color = { kind: "rgb", value: "FFFFFF" };
const GREY: Color = { kind: "rgb", value: "D9D9D9" };
/** The chart font's name as the font field's hint (a font name, not UI text). */
const FONT_HINT = "Calibri"; // i18n-ignore

/** Fill (automatic / none / solid / gradient / picture), border and shadow of an area. */
export function AreaSection({ title, shape, set, rounded, testId }: {
  title: string; shape: ShapeFormat | undefined; set: (patch: Partial<ShapeFormat>) => void; rounded?: { on: boolean; set: (v: boolean) => void }; testId?: string;
}) {
  const t = useT();
  const fill = shape?.fill;
  const kind = fill?.type ?? "auto";
  const grad = fill?.type === "gradient" ? fill : null;
  const line = shape?.line;
  const choose = (k: string) => {
    if (k === "auto") set({ fill: undefined });
    else if (k === "none") set({ fill: { type: "none" } });
    else if (k === "solid") set({ fill: { type: "solid", color: fill?.type === "gradient" ? fill.stops[0]!.color : fill?.type === "solid" ? fill.color : WHITE } });
    else if (k === "gradient") set({ fill: gradientFill(fill?.type === "solid" ? fill.color : WHITE, GREY, 90) });
  };
  const picture = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result ?? "");
      const data = url.slice(url.indexOf(",") + 1);
      set({ fill: { type: "picture", media: { contentType: file.type || "image/png", data } } });
    };
    reader.readAsDataURL(file);
  };
  return (
    <Section title={title}>
      <div role="radiogroup" aria-label={t("calc.chart.fp.fill")} data-testid={testId} className="flex flex-col gap-1">
        {(["auto", "none", "solid", "gradient", "picture"] as const).map((k) => (
          <label key={k} className="flex items-center gap-2 text-sm">
            <input type="radio" name={`${title}-fill`} checked={kind === k} onChange={() => (k === "picture" ? undefined : choose(k))} disabled={k === "picture" && kind !== "picture"} />
            {k === "picture" ? (
              <span className="flex items-center gap-1">
                {t("calc.chart.fp.fillPicture")}
                <input type="file" accept="image/png,image/jpeg,image/gif" aria-label={t("calc.chart.fp.fillPicture")} className="w-28 text-xs" onChange={(e) => picture(e.target.files?.[0])} />
              </span>
            ) : (
              t(`calc.chart.fp.fill_${k}`)
            )}
          </label>
        ))}
      </div>
      {fill?.type === "solid" && (
        <Row label={t("calc.chart.fp.color")}>
          <ColorPicker label={t("calc.chart.fp.color")} kind="fill" value={fill.color} onSelect={(c) => set({ fill: c ? { type: "solid", color: c } : { type: "none" } })} />
        </Row>
      )}
      {grad && (
        <>
          <Row label={t("calc.chart.fp.gradientFrom")}>
            <ColorPicker label={t("calc.chart.fp.gradientFrom")} kind="fill" value={grad.stops[0]?.color} onSelect={(c) => c && set({ fill: gradientFill(c, grad.stops[grad.stops.length - 1]?.color ?? GREY, grad.angle ?? 0) })} />
          </Row>
          <Row label={t("calc.chart.fp.gradientTo")}>
            <ColorPicker label={t("calc.chart.fp.gradientTo")} kind="fill" value={grad.stops[grad.stops.length - 1]?.color} onSelect={(c) => c && set({ fill: gradientFill(grad.stops[0]?.color ?? WHITE, c, grad.angle ?? 0) })} />
          </Row>
          <Commit label={t("calc.chart.fp.angle")} testId="gradient-angle" value={String(grad.angle ?? 0)} onCommit={(v) => {
            const n = parseNumberField(v);
            if (typeof n === "number") set({ fill: { ...(grad as AreaFill & { type: "gradient" }), angle: ((Math.round(n) % 360) + 360) % 360 } });
          }} />
        </>
      )}
      <Row label={t("calc.chart.fp.border")}>
        <span className="flex items-center gap-2">
          <ColorPicker label={t("calc.chart.fp.border")} kind="text" value={line?.color} onSelect={(c) => set({ line: c === null ? { none: true } : { ...(line ?? {}), none: undefined, color: c } })} />
          <label className="flex items-center gap-1 text-xs">
            <input type="checkbox" checked={!!line?.none} onChange={(e) => set({ line: e.target.checked ? { none: true } : undefined })} />
            {t("calc.chart.fp.noLine")}
          </label>
        </span>
      </Row>
      <Commit label={t("calc.chart.fp.width")} value={line?.width ? String(Math.round((line.width / EMU_PER_PT) * 100) / 100) : ""} placeholder="0.75" onCommit={(v) => {
        const n = parseNumberField(v);
        if (n !== null) set({ line: { ...(line ?? {}), none: undefined, width: n === undefined ? undefined : Math.round(n * EMU_PER_PT) } });
      }} />
      <Row label={t("calc.chart.fp.dash")}>
        <select className={FIELD} aria-label={t("calc.chart.fp.dash")} value={line?.dash ?? "solid"} onChange={(e) => set({ line: { ...(line ?? {}), dash: e.target.value === "solid" ? undefined : (e.target.value as LineDash) } })}>
          {DASHES.map((d) => (
            <option key={d} value={d}>
              {t(`calc.chart.dash.${d}`)}
            </option>
          ))}
        </select>
      </Row>
      <Check label={t("calc.chart.fp.shadow")} checked={!!shape?.shadow} onChange={(v) => set({ shadow: v || undefined })} />
      {rounded && <Check label={t("calc.chart.fp.rounded")} checked={rounded.on} onChange={rounded.set} />}
    </Section>
  );
}

/** Font, size, bold, italic, colour (and, for axes, the custom angle) of a text element. */
export function TextSection({ chart, target, edit, angle }: { chart: Chart; target: TextTarget; edit: Edit; angle?: boolean }) {
  const t = useT();
  const tf = textFormatOf(chart, target) ?? {};
  const set = (patch: Parameters<typeof setTextFormat>[2]) => edit((c) => setTextFormat(c, target, patch));
  return (
    <Section title={t("calc.chart.fp.textOptions")}>
      <Commit label={t("calc.chart.fp.font")} testId="text-font" value={tf.font ?? ""} placeholder={FONT_HINT} onCommit={(v) => set({ font: v.trim() || undefined })} />
      <Commit label={t("calc.chart.fp.fontSize")} testId="text-size" value={tf.size ? String(tf.size) : ""} placeholder={t("calc.chart.fp.auto")} onCommit={(v) => {
        const n = parseNumberField(v);
        if (n !== null) set({ size: n === undefined ? undefined : Math.max(1, Math.min(400, n)) });
      }} />
      <Check label={t("calc.chart.fp.bold")} checked={!!tf.bold} onChange={(v) => set({ bold: v ? true : undefined })} />
      <Check label={t("calc.chart.fp.italic")} checked={!!tf.italic} onChange={(v) => set({ italic: v ? true : undefined })} />
      <Row label={t("calc.chart.fp.textColor")}>
        <ColorPicker label={t("calc.chart.fp.textColor")} kind="text" value={tf.color} onSelect={(c) => set({ color: c ?? undefined })} />
      </Row>
      {angle && (
        <Commit label={t("calc.chart.fp.customAngle")} testId="text-angle" value={tf.rotation === undefined ? "" : String(tf.rotation)} placeholder={t("calc.chart.fp.auto")} onCommit={(v) => {
          const n = parseNumberField(v);
          if (n !== null) set({ rotation: n === undefined ? undefined : Math.max(-90, Math.min(90, Math.round(n))) });
        }} />
      )}
    </Section>
  );
}

const AMOUNTS = ["none", "fixed", "percentage", "stdDev", "stdErr", "custom"] as const;

/** Error bars of series `i` (Y; X too for scatter charts). */
export function ErrorBarSection({ chart, i, edit }: { chart: Chart; i: number; edit: Edit }) {
  const t = useT();
  const s = chart.series[i];
  if (!s || chart.kind.type === "pie" || chart.kind.type === "doughnut") return null;
  const dirs: ("y" | "x")[] = chart.kind.type === "scatter" ? ["y", "x"] : ["y"];
  return (
    <>
      {dirs.map((dir) => {
        const e = s.errorBars?.find((x) => (x.direction ?? "y") === dir) ?? null;
        const put = (next: ErrorBars | null) => edit((c) => setErrorBars(c, i, dir, next));
        const kind = e?.amount.type ?? "none";
        const value = e && "value" in e.amount ? e.amount.value : undefined;
        const base: ErrorBars = e ?? { amount: { type: "fixed", value: 1 } };
        return (
          <Section key={dir} title={t(dir === "x" ? "calc.chart.fp.errorBarsX" : "calc.chart.fp.errorBars")}>
            <Row label={t("calc.chart.fp.errorAmount")}>
              <select
                className={FIELD}
                aria-label={t(dir === "x" ? "calc.chart.fp.errorBarsX" : "calc.chart.fp.errorBars")}
                data-testid={`error-kind-${dir}`}
                value={kind}
                onChange={(ev) => {
                  const k = ev.target.value as (typeof AMOUNTS)[number];
                  if (k === "none") return put(null);
                  const amount: ErrorBars["amount"] =
                    k === "fixed" ? { type: "fixed", value: 1 } : k === "percentage" ? { type: "percentage", value: 5 } : k === "stdDev" ? { type: "stdDev", value: 1 } : k === "stdErr" ? { type: "stdErr" } : { type: "custom" };
                  put({ ...base, amount });
                }}
              >
                {AMOUNTS.map((k) => (
                  <option key={k} value={k}>
                    {t(k === "none" ? "calc.chart.none" : `calc.chart.err.${k}`)}
                  </option>
                ))}
              </select>
            </Row>
            {e && value !== undefined && (
              <Commit label={t("calc.chart.fp.errorValue")} testId={`error-value-${dir}`} value={String(value)} onCommit={(v) => {
                const n = parseNumberField(v);
                if (typeof n === "number" && n >= 0) put({ ...e, amount: { ...(e.amount as { type: "fixed"; value: number }), value: n } });
              }} />
            )}
            {e?.amount.type === "custom" && (
              <>
                <Commit label={t("calc.chart.fp.errorPlus")} value={dataRefText(e.amount.plus)} onCommit={(v) => put({ ...e, amount: { type: "custom", plus: parseDataRef(v) ?? undefined, minus: e.amount.type === "custom" ? e.amount.minus : undefined } })} />
                <Commit label={t("calc.chart.fp.errorMinus")} value={dataRefText(e.amount.minus)} onCommit={(v) => put({ ...e, amount: { type: "custom", minus: parseDataRef(v) ?? undefined, plus: e.amount.type === "custom" ? e.amount.plus : undefined } })} />
              </>
            )}
            {e && (
              <>
                <Row label={t("calc.chart.fp.errorDirection")}>
                  <select className={FIELD} aria-label={t("calc.chart.fp.errorDirection")} value={e.barType ?? "both"} onChange={(ev) => put({ ...e, barType: ev.target.value === "both" ? undefined : (ev.target.value as "plus" | "minus") })}>
                    {(["both", "minus", "plus"] as const).map((k) => (
                      <option key={k} value={k}>
                        {t(`calc.chart.err.dir.${k}`)}
                      </option>
                    ))}
                  </select>
                </Row>
                <Check label={t("calc.chart.fp.errorCap")} checked={!e.noEndCap} onChange={(v) => put({ ...e, noEndCap: v ? undefined : true })} />
                <Row label={t("calc.chart.fp.lineColor")}>
                  <ColorPicker label={t("calc.chart.fp.lineColor")} kind="text" value={e.line?.color} onSelect={(c) => put({ ...e, line: c ? { ...(e.line ?? {}), color: c } : undefined })} />
                </Row>
              </>
            )}
          </Section>
        );
      })}
    </>
  );
}

/** Data label extras of series `i`: Value From Cells, leader lines, the selected point's own label. */
export function LabelExtrasSection({ chart, i, point, edit }: { chart: Chart; i: number; point?: number; edit: Edit }) {
  const t = useT();
  const d = chart.series[i]?.dataLabels ?? chart.dataLabels ?? {};
  const own = point !== undefined ? d.points?.find((p) => p.idx === point) : undefined;
  return (
    <Section title={t("calc.chart.fp.labelExtras")}>
      <Commit label={t("calc.chart.fp.valueFromCells")} testId="label-range" value={dataRefText(d.range)} placeholder="=D2:D5" onCommit={(v) => { // i18n-ignore
        const r = parseDataRef(v);
        edit((c) => patchSeriesLabels(c, i, { range: r ?? undefined, showRange: r ? true : undefined }));
      }} />
      {d.range && <Check label={t("calc.chart.fp.showRange")} checked={!!d.showRange} onChange={(v) => edit((c) => patchSeriesLabels(c, i, { showRange: v || undefined }))} />}
      <Check label={t("calc.chart.fp.leaderLines")} checked={!!d.leaderLines} onChange={(v) => edit((c) => patchSeriesLabels(c, i, { leaderLines: v || undefined }))} />
      {point !== undefined && (
        <>
          <Check
            label={t("calc.chart.fp.pointLabel")}
            checked={own ? !own.delete : !!(d.showValue || d.showCategory || d.showSeries || d.showPercent || d.showRange)}
            onChange={(v) => edit((c) => setPointLabel(c, i, point, v ? { showValue: true } : { delete: true }))}
          />
          {own && (
            <button type="button" className="h-7 rounded border border-ui-border px-3 text-sm hover:bg-ui-hover" onClick={() => edit((c) => setPointLabel(c, i, point, null))}>
              {t("calc.chart.fp.pointLabelReset")}
            </button>
          )}
        </>
      )}
    </Section>
  );
}

/** Data table, up/down bars and high-low lines (chart area pane). */
export function ChartExtrasSection({ chart, edit }: { chart: Chart; edit: Edit }) {
  const t = useT();
  const pie = chart.kind.type === "pie" || chart.kind.type === "doughnut";
  const line = chart.kind.type === "line" || (chart.kind.type === "combo" && chart.series.some((s) => s.kind?.type === "line"));
  const tbl = chart.dataTable;
  const setTable = (patch: Partial<NonNullable<Chart["dataTable"]>> | null) =>
    edit((c) => {
      const out = { ...c };
      if (patch === null) delete out.dataTable;
      else out.dataTable = JSON.parse(JSON.stringify({ ...(c.dataTable ?? {}), ...patch })) as NonNullable<Chart["dataTable"]>;
      return out;
    });
  if (pie && !line) return null;
  return (
    <Section title={t("calc.chart.fp.elements")}>
      {!pie && chart.kind.type !== "scatter" && (
        <>
          <Check label={t("calc.chart.ae.dataTable")} checked={!!tbl} onChange={(v) => setTable(v ? {} : null)} />
          {tbl && (
            <div className="ml-5 flex flex-col gap-1">
              <Check label={t("calc.chart.fp.tableKeys")} checked={!!tbl.keys} onChange={(v) => setTable({ keys: v || undefined })} />
              <Check label={t("calc.chart.fp.tableHorizontal")} checked={tbl.horizontal ?? true} onChange={(v) => setTable({ horizontal: v ? undefined : false })} />
              <Check label={t("calc.chart.fp.tableVertical")} checked={tbl.vertical ?? true} onChange={(v) => setTable({ vertical: v ? undefined : false })} />
              <Check label={t("calc.chart.fp.tableOutline")} checked={tbl.outline ?? true} onChange={(v) => setTable({ outline: v ? undefined : false })} />
            </div>
          )}
        </>
      )}
      {line && (
        <>
          <Check label={t("calc.chart.ae.highLow")} checked={!!chart.highLowLines} onChange={(v) => edit((c) => (v ? { ...c, highLowLines: c.highLowLines ?? {} } : (({ highLowLines: _h, ...rest }) => rest)(c) as Chart))} />
          <Check label={t("calc.chart.ae.upDownBars")} checked={!!chart.upDownBars} onChange={(v) => edit((c) => (v ? { ...c, upDownBars: c.upDownBars ?? { gapWidth: 150 } } : (({ upDownBars: _u, ...rest }) => rest)(c) as Chart))} />
          {chart.upDownBars && (
            <Commit label={t("calc.chart.fp.gapWidth")} value={String(chart.upDownBars.gapWidth ?? 150)} onCommit={(v) => {
              const n = parseNumberField(v);
              if (typeof n === "number") edit((c) => ({ ...c, upDownBars: { ...(c.upDownBars ?? {}), gapWidth: Math.max(0, Math.min(500, Math.round(n))) } }));
            }} />
          )}
        </>
      )}
    </Section>
  );
}
