// Chart Design › Add Chart Element ▾: Excel's menu with flyouts (Axes,
// Axis Titles, Chart Title, Data Labels, Gridlines, Legend, Trendline);
// a flyout opens on click, Enter, → or hover; ← / Esc closes it.

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { Chart } from "../generated/Chart";
import { useT } from "../i18n";
import type { CalcStore } from "../state/store";
import { horizontalBars } from "./elements";
import { applyElement, elementState, labelPositions, type ElementOp } from "./presets";

type Sub = "axes" | "axisTitles" | "title" | "labels" | "grid" | "legend" | "trend";

const ITEM = "flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm text-ui-fg hover:bg-ui-hover focus-visible:bg-ui-hover focus-visible:outline-none aria-expanded:bg-ui-active disabled:opacity-40";

function moveFocus(e: KeyboardEvent, root: HTMLElement | null): void {
  const all = Array.from(root?.querySelectorAll<HTMLElement>(":scope [data-ce-item]:not([disabled])") ?? []).filter((b) => b.closest("[data-ce-level]") === root);
  const i = all.indexOf(document.activeElement as HTMLElement);
  const d = ({ ArrowDown: 1, ArrowUp: -1 } as Record<string, number>)[e.key];
  let n: number | undefined;
  if (d !== undefined) n = (i + d + all.length) % all.length;
  else if (e.key === "Home") n = 0;
  else if (e.key === "End") n = all.length - 1;
  if (n === undefined || all.length === 0) return;
  e.preventDefault();
  e.stopPropagation();
  all[n]!.focus();
}

function Flyout({ label, children, onClose }: { label: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.querySelector<HTMLElement>("[data-ce-item]:not([disabled])")?.focus(), []);
  return (
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      data-ce-level=""
      className="absolute left-full top-0 z-50 ml-0.5 min-w-52 rounded border border-ui-border bg-ui-panel p-1 shadow-lg"
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft" || e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onClose();
          return;
        }
        moveFocus(e, ref.current);
      }}
    >
      {children}
    </div>
  );
}

export function AddElementMenu({ store, chart, close }: { store: CalcStore; chart: Chart; close: () => void }) {
  const t = useT();
  const [sub, setSub] = useState<Sub | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const subButtons = useRef<Partial<Record<Sub, HTMLButtonElement | null>>>({});
  useEffect(() => root.current?.querySelector<HTMLElement>("[data-ce-item]")?.focus(), []);
  const st = elementState(chart);
  const pie = chart.kind.type === "pie" || chart.kind.type === "doughnut";
  const hb = horizontalBars(chart);
  // "Horizontal" follows the drawing: the value axis of horizontal bar charts.
  const hAxis = hb ? "val" : "cat";
  const vAxis = hb ? "cat" : "val";
  const selSeries = store.charts.selected?.element;
  const trendSeries = selSeries && (selSeries.type === "series" || selSeries.type === "trendline") ? selSeries.series : undefined;

  const run = (op: ElementOp) => () => {
    close();
    void store.charts.edit((c) => applyElement(c, op));
    store.focusGrid();
  };
  const closeSub = () => {
    const s = sub;
    setSub(null);
    if (s) subButtons.current[s]?.focus();
  };
  const subItem = (id: Sub, label: string, body: () => ReactNode, disabled = false) => (
    <div className="relative" onMouseEnter={() => !disabled && setSub(id)}>
      <button
        ref={(b) => {
          subButtons.current[id] = b;
        }}
        type="button"
        role="menuitem"
        data-ce-item=""
        aria-haspopup="menu"
        aria-expanded={sub === id}
        disabled={disabled}
        className={ITEM}
        onClick={() => setSub(id)}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" || e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            setSub(id);
          }
        }}
      >
        <span className="flex-1">{label}</span>
        <span aria-hidden="true">›</span>
      </button>
      {sub === id && (
        <Flyout label={label} onClose={closeSub}>
          {body()}
        </Flyout>
      )}
    </div>
  );
  const item = (label: string, op: ElementOp, checked: boolean) => (
    <button key={label} type="button" role="menuitemradio" aria-checked={checked} data-ce-item="" className={`${ITEM} aria-checked:font-semibold`} onClick={run(op)}>
      <span className="w-3 text-xs">{checked ? "✓" : ""}</span>
      {label}
    </button>
  );
  const LABEL_KEYS: Record<string, string> = {
    center: "calc.chart.pos.center", insideEnd: "calc.chart.pos.insideEnd", insideBase: "calc.chart.pos.insideBase", outsideEnd: "calc.chart.pos.outsideEnd",
    bestFit: "calc.chart.pos.bestFit", left: "calc.chart.pos.left", right: "calc.chart.pos.right", top: "calc.chart.pos.top", bottom: "calc.chart.pos.bottom",
  };
  return (
    <div ref={root} role="menu" aria-label={t("calc.chart.addElement")} data-ce-level="" data-testid="chart-element-menu" className="flex min-w-52 flex-col py-0.5" onKeyDown={(e) => moveFocus(e, root.current)}>
      {subItem("axes", t("calc.chart.ae.axes"), () => (
        <>
          {item(t("calc.chart.ae.primaryHorizontal"), { el: "axis", axis: hAxis, on: !st.axes[hAxis] }, st.axes[hAxis])}
          {item(t("calc.chart.ae.primaryVertical"), { el: "axis", axis: vAxis, on: !st.axes[vAxis] }, st.axes[vAxis])}
        </>
      ), pie)}
      {subItem("axisTitles", t("calc.chart.ae.axisTitles"), () => (
        <>
          {item(t("calc.chart.ae.primaryHorizontal"), { el: "axisTitle", axis: hAxis, on: !st.axisTitles[hAxis] }, st.axisTitles[hAxis])}
          {item(t("calc.chart.ae.primaryVertical"), { el: "axisTitle", axis: vAxis, on: !st.axisTitles[vAxis] }, st.axisTitles[vAxis])}
        </>
      ), pie)}
      {subItem("title", t("calc.chart.ae.chartTitle"), () => (
        <>
          {item(t("calc.chart.none"), { el: "chartTitle", mode: "none" }, st.title === "none")}
          {item(t("calc.chart.ae.aboveChart"), { el: "chartTitle", mode: "above" }, st.title === "above")}
          {item(t("calc.chart.ae.overlay"), { el: "chartTitle", mode: "overlay" }, st.title === "overlay")}
        </>
      ))}
      {subItem("labels", t("calc.chart.ae.dataLabels"), () => (
        <>
          {item(t("calc.chart.none"), { el: "dataLabels", position: "none" }, st.labels === "none")}
          {labelPositions(chart.kind).map((p) => item(t(LABEL_KEYS[p] ?? p), { el: "dataLabels", position: p }, st.labels === p))}
        </>
      ))}
      {subItem("grid", t("calc.chart.ae.gridlines"), () => (
        <>
          {item(t("calc.chart.ae.majorHorizontal"), { el: "gridlines", axis: vAxis, minor: false, on: !st.grid[`${vAxis}Major`] }, st.grid[`${vAxis}Major`])}
          {item(t("calc.chart.ae.majorVertical"), { el: "gridlines", axis: hAxis, minor: false, on: !st.grid[`${hAxis}Major`] }, st.grid[`${hAxis}Major`])}
          {item(t("calc.chart.ae.minorHorizontal"), { el: "gridlines", axis: vAxis, minor: true, on: !st.grid[`${vAxis}Minor`] }, st.grid[`${vAxis}Minor`])}
          {item(t("calc.chart.ae.minorVertical"), { el: "gridlines", axis: hAxis, minor: true, on: !st.grid[`${hAxis}Minor`] }, st.grid[`${hAxis}Minor`])}
        </>
      ), pie)}
      {subItem("legend", t("calc.chart.ae.legend"), () => (
        <>
          {item(t("calc.chart.none"), { el: "legend", position: "none" }, st.legend === "none")}
          {(["right", "top", "left", "bottom"] as const).map((p) => item(t(`calc.chart.pos.${p}`), { el: "legend", position: p }, st.legend === p))}
        </>
      ))}
      {subItem("trend", t("calc.chart.ae.trendline"), () => (
        <>
          {item(t("calc.chart.none"), { el: "trendline", kind: "none", series: trendSeries }, false)}
          {item(t("calc.chart.trend.linear"), { el: "trendline", kind: "linear", series: trendSeries }, false)}
          {item(t("calc.chart.trend.exponential"), { el: "trendline", kind: "exponential", series: trendSeries }, false)}
          {item(t("calc.chart.trend.movingAverage"), { el: "trendline", kind: "movingAverage", series: trendSeries }, false)}
        </>
      ), pie || chart.series.length === 0)}
    </div>
  );
}
