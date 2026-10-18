// Show's chart commands (P8-24): Insert › Chart and the contextual Chart
// Design and Format tabs of a selected chart, structured like Calc's
// (apps/calc/src/charts/ChartRibbon.tsx): Add Chart Element, Quick Layout,
// Change Colors, Chart Styles, Edit Data, Switch Row/Column, Change Chart
// Type; Format: Format pane, shape fill/outline of a series.

import type { ReactNode } from "react";
import { ColorPicker, RIBBON_SELECT, RibbonButton, RibbonGallery, RibbonMenuButton, RibbonStack, type Color, type RibbonMenuItem, type RibbonTab, type TFunction, addElementIcon, changeTypeIcon, colorsIcon, formatPaneIcon, quickLayoutIcon, recommendedIcon, resetStyleIcon, selectDataIcon, stylesIcon, switchIcon, LivePreview, CHART_STYLES, QUICK_LAYOUTS, applyChartStyle, applyColors, applyElement, applyQuickLayout, colorsOf, elementState, labelPositions, resolveSwatches, type ElementOp, resetSeriesFormat, setSeriesFill, setSeriesLine } from "@rusuite/ui-shared";
import type { ShowState, ShowStore } from "../state/store";
import { resolveShape } from "./data";
import { COLOR_VARIANTS } from "./presets";
import type { Chart } from "./types";

/** Insert › Chart (opens the Insert Chart dialog). */
export function insertChartButton(store: ShowStore, t: TFunction, disabled: boolean): ReactNode {
  return (
    <RibbonButton label={t("show.chart.insert")} icon={recommendedIcon()} size="large" tooltip={t("show.chart.insertTip")} disabled={disabled} onClick={() => store.openDialog({ kind: "insertChart" })} />
  );
}

/** A large button opening a gallery panel. */
function DropGallery(props: { label: string; icon: ReactNode; disabled?: boolean; columns: number; itemClassName: string; items: { id: string; label: string; preview: ReactNode }[]; selected?: string; hideLabels?: boolean; onSelect: (id: string) => void }) {
  return (
    <RibbonMenuButton
      label={props.label}
      icon={props.icon}
      size="large"
      disabled={props.disabled}
      menu={(close) => (
        <div className="w-max">
          <RibbonGallery
            label={props.label}
            items={props.items}
            selected={props.selected}
            columns={props.columns}
            itemClassName={props.itemClassName}
            hideLabels={props.hideLabels}
            autoFocus
            onSelect={(id) => {
              close();
              props.onSelect(id);
            }}
          />
        </div>
      )}
    />
  );
}

/** Add Chart Element ▾ as one menu with a section per element (PowerPoint's flyouts flattened). */
export function addElementItems(chart: Chart, t: TFunction, apply: (op: ElementOp) => void): RibbonMenuItem[] {
  const st = elementState(chart);
  const axes = chart.kind.type !== "pie" && chart.kind.type !== "doughnut";
  const item = (id: string, label: string, checked: boolean, op: ElementOp): RibbonMenuItem => ({ id, label, checked, onSelect: () => apply(op) });
  const out: RibbonMenuItem[] = [];
  if (axes) {
    out.push(
      { separator: true, label: t("show.chart.ae.axes") },
      item("axis-cat", t("show.chart.ae.primaryHorizontal"), st.axes.cat, { el: "axis", axis: "cat", on: !st.axes.cat }),
      item("axis-val", t("show.chart.ae.primaryVertical"), st.axes.val, { el: "axis", axis: "val", on: !st.axes.val }),
      { separator: true, label: t("show.chart.ae.axisTitles") },
      item("at-cat", t("show.chart.ae.primaryHorizontal"), st.axisTitles.cat, { el: "axisTitle", axis: "cat", on: !st.axisTitles.cat }),
      item("at-val", t("show.chart.ae.primaryVertical"), st.axisTitles.val, { el: "axisTitle", axis: "val", on: !st.axisTitles.val }),
    );
  }
  out.push(
    { separator: true, label: t("show.chart.ae.chartTitle") },
    item("title-none", t("show.chart.none"), st.title === "none", { el: "chartTitle", mode: "none" }),
    item("title-above", t("show.chart.ae.aboveChart"), st.title === "above", { el: "chartTitle", mode: "above" }),
    item("title-overlay", t("show.chart.ae.overlay"), st.title === "overlay", { el: "chartTitle", mode: "overlay" }),
    { separator: true, label: t("show.chart.ae.dataLabels") },
    item("labels-none", t("show.chart.none"), st.labels === "none", { el: "dataLabels", position: "none" }),
    ...labelPositions(chart.kind).map((p) => item(`labels-${p}`, t(`show.chart.pos.${p}`), st.labels === p, { el: "dataLabels", position: p })),
  );
  if (axes) {
    out.push(
      { separator: true, label: t("show.chart.ae.gridlines") },
      item("grid-val", t("show.chart.ae.majorHorizontal"), st.grid.valMajor, { el: "gridlines", axis: "val", minor: false, on: !st.grid.valMajor }),
      item("grid-cat", t("show.chart.ae.majorVertical"), st.grid.catMajor, { el: "gridlines", axis: "cat", minor: false, on: !st.grid.catMajor }),
      item("grid-val-minor", t("show.chart.ae.minorHorizontal"), st.grid.valMinor, { el: "gridlines", axis: "val", minor: true, on: !st.grid.valMinor }),
    );
  }
  out.push(
    { separator: true, label: t("show.chart.ae.legend") },
    ...(["none", "right", "top", "left", "bottom"] as const).map((p) =>
      item(`legend-${p}`, p === "none" ? t("show.chart.none") : t(`show.chart.pos.${p}`), st.legend === p, { el: "legend", position: p }),
    ),
  );
  if (axes && chart.kind.type !== "combo") {
    out.push(
      { separator: true, label: t("show.chart.ae.trendline") },
      item("trend-none", t("show.chart.none"), !st.trendline, { el: "trendline", kind: "none" }),
      item("trend-linear", t("show.chart.trend.linear"), false, { el: "trendline", kind: "linear" }),
      item("trend-exp", t("show.chart.trend.exponential"), false, { el: "trendline", kind: "exponential" }),
      item("trend-avg", t("show.chart.trend.movingAverage"), false, { el: "trendline", kind: "movingAverage" }),
    );
  }
  return out;
}

/** Chart Design (contextual, one chart selected). */
export function chartDesignTab(store: ShowStore, state: ShowState, t: TFunction): RibbonTab | null {
  void state;
  const sel = store.selectedChart();
  if (!sel) return null;
  const chart = sel.chart.chart as Chart;
  const data = resolveShape(sel.chart);
  const ro = chart.kind.type === "unsupported";
  const edit = (fn: (c: Chart) => Chart) => void store.updateChart(fn);
  const points = data.series[0]?.values.length ?? 0;
  return {
    id: "chartDesign",
    label: t("show.chart.tab.design"),
    groups: [
      {
        label: t("show.chart.layouts"),
        items: (
          <>
            <RibbonMenuButton label={t("show.chart.addElement")} icon={addElementIcon()} size="large" disabled={ro} menu={addElementItems(chart, t, (op) => edit((c) => applyElement(c, op)))} />
            <DropGallery
              label={t("show.chart.quickLayout")}
              icon={quickLayoutIcon()}
              disabled={ro}
              columns={4}
              itemClassName="h-[68px] w-[100px] p-0.5"
              items={QUICK_LAYOUTS.map((l) => ({ id: l.id, label: t("show.chart.layoutN", { n: l.id }), preview: <LivePreview chart={applyQuickLayout(chart, l.id)} data={data} width={96} height={52} scale={3} /> }))}
              onSelect={(id) => edit((c) => applyQuickLayout(c, id))}
            />
          </>
        ),
      },
      {
        label: t("show.chart.styles"),
        items: (
          <>
            <DropGallery
              label={t("show.chart.changeColors")}
              icon={colorsIcon()}
              disabled={ro}
              columns={1}
              selected={colorsOf(chart) ?? undefined}
              itemClassName="h-7 w-80 px-1"
              hideLabels
              items={COLOR_VARIANTS.map((v) => ({
                id: v.id,
                label: t(v.label),
                preview: (
                  <span className="flex w-full items-center gap-2">
                    <span className="flex gap-0.5">
                      {resolveSwatches(v.id).map((c, i) => (
                        <span key={i} className="inline-block h-3.5 w-3.5" style={{ background: c }} />
                      ))}
                    </span>
                    <span className="truncate text-[11px]">{t(v.label)}</span>
                  </span>
                ),
              }))}
              onSelect={(id) => edit((c) => applyColors(c, id, points))}
            />
            <DropGallery
              label={t("show.chart.chartStyles")}
              icon={stylesIcon()}
              disabled={ro}
              columns={4}
              itemClassName="h-[68px] w-[100px] p-0.5"
              items={CHART_STYLES.map((n) => ({ id: String(n), label: t("show.chart.styleN", { n }), preview: <LivePreview chart={applyChartStyle(chart, n)} data={data} width={96} height={52} scale={3} /> }))}
              onSelect={(id) => edit((c) => applyChartStyle(c, Number(id)))}
            />
          </>
        ),
      },
      {
        label: t("show.chart.data"),
        items: (
          <>
            <RibbonButton label={t("show.chart.switchRowCol")} icon={switchIcon()} size="large" disabled={ro} onClick={() => void store.switchRowCol()} />
            <RibbonButton label={t("show.chart.editData")} icon={selectDataIcon()} size="large" disabled={ro} onClick={() => store.openDialog({ kind: "editData" })} />
          </>
        ),
      },
      {
        label: t("show.chart.type"),
        items: <RibbonButton label={t("show.chart.changeType")} icon={changeTypeIcon()} size="large" disabled={ro} onClick={() => store.openDialog({ kind: "chartType" })} />,
      },
    ],
  };
}

/** Format (contextual, one chart selected): the Format pane, fill and outline of a series. */
export function chartFormatTab(store: ShowStore, state: ShowState, t: TFunction): RibbonTab | null {
  const sel = store.selectedChart();
  if (!sel) return null;
  const chart = sel.chart.chart as Chart;
  const data = resolveShape(sel.chart);
  const ro = chart.kind.type === "unsupported";
  const n = chart.series.length;
  const series = Math.min(state.chartSeries, Math.max(0, n - 1));
  return {
    id: "chartFormat",
    label: t("show.chart.tab.format"),
    groups: [
      {
        label: t("show.chart.currentSelection"),
        items: (
          <RibbonStack>
            <select
              aria-label={t("show.chart.series")}
              className={`${RIBBON_SELECT} w-44`}
              value={String(series)}
              disabled={ro || n === 0}
              onChange={(e) => store.selectChartSeries(Number(e.target.value))}
            >
              {data.series.map((s, i) => (
                <option key={i} value={String(i)}>
                  {t("show.chart.seriesX", { name: s.name })}
                </option>
              ))}
            </select>
            <RibbonButton label={t("show.chart.formatPane")} icon={formatPaneIcon()} showLabel pressed={state.chartPane} disabled={ro} onClick={() => store.toggleChartPane()} />
            <RibbonButton label={t("show.chart.resetStyle")} icon={resetStyleIcon()} showLabel disabled={ro || n === 0} onClick={() => void store.updateChart((c) => resetSeriesFormat(c, series))} />
          </RibbonStack>
        ),
      },
      {
        label: t("show.chart.shapeStyles"),
        items: (
          <RibbonStack>
            <ColorPicker label={t("show.chart.shapeFill")} kind="fill" disabled={ro || n === 0} onSelect={(c: Color | null) => void store.updateChart((ch) => setSeriesFill(ch, series, undefined, c))} />
            <ColorPicker
              label={t("show.chart.shapeOutline")}
              kind="text"
              disabled={ro || n === 0}
              onSelect={(c: Color | null) => void store.updateChart((ch) => setSeriesLine(ch, series, c === null ? { none: true } : { color: c }))}
            />
          </RibbonStack>
        ),
      },
    ],
  };
}
