// Chart commands in Calc's ribbon: Insert › Charts (Recommended Charts and
// the type galleries) and the contextual Chart Design and Format tabs shown
// while a chart is selected.

import type { ReactNode } from "react";
import { applyChartStyle } from "./extras";
import {
  ColorPicker, RIBBON_SELECT, RibbonButton, RibbonGallery, RibbonMenuButton, RibbonStack, elementKey, type Color, type RibbonGroup, type RibbonTab,
} from "@rusuite/ui-shared";
import type { Chart } from "../generated/Chart";
import type { ResolvedChart } from "../generated/ResolvedChart";
import type { TFunction as T } from "@rusuite/ui-shared";
import type { CalcStore } from "../state/store";
import { anchorRect, rectToAnchor } from "./anchor";
import { chartElements, elementFromKey, elementName } from "./elements";
import { AddElementMenu } from "./ElementMenu";
import {
  addElementIcon, changeTypeIcon, colorsIcon, columnIcon, comboIcon, formatPaneIcon, lineIcon, moveChartIcon, pieIcon, quickLayoutIcon, recommendedIcon,
  resetStyleIcon, scatterIcon, selectDataIcon, stylesIcon, switchIcon,
} from "./icons";
import { LivePreview, PresetIcon } from "./previews";
import {
  CHART_STYLES, COLOR_VARIANTS, INSERT_GALLERIES, QUICK_LAYOUTS, applyColors, applyQuickLayout, colorsOf, presetsOf, resolveSwatches,
} from "./presets";
import { setSeriesFill, setSeriesLine, resetSeriesFormat } from "./format";

const GALLERY_ICONS: Record<string, (size?: number) => ReactNode> = {
  columnBar: columnIcon,
  lineArea: lineIcon,
  pie: pieIcon,
  scatter: scatterIcon,
  combo: comboIcon,
};

/** Insert › Charts. */
export function chartsInsertGroup(store: CalcStore, t: T, off: boolean): RibbonGroup {
  return {
    label: t("calc.chart.charts"),
    items: (
      <>
        <RibbonButton
          label={t("calc.chart.recommended")}
          icon={recommendedIcon()}
          size="large"
          tooltip={t("calc.chart.recommendedTip")}
          disabled={off}
          onClick={() => store.openDialog({ kind: "recommendedCharts" })}
        />
        <RibbonStack>
          {INSERT_GALLERIES.slice(0, 2).map((g) => (
            <InsertGallery key={g.id} store={store} t={t} id={g.id} off={off} />
          ))}
        </RibbonStack>
        <RibbonStack>
          {INSERT_GALLERIES.slice(2, 4).map((g) => (
            <InsertGallery key={g.id} store={store} t={t} id={g.id} off={off} />
          ))}
        </RibbonStack>
        <RibbonStack>
          <InsertGallery store={store} t={t} id="combo" off={off} />
        </RibbonStack>
      </>
    ),
  };
}

function InsertGallery({ store, t, id, off }: { store: CalcStore; t: T; id: string; off: boolean }) {
  const g = INSERT_GALLERIES.find((x) => x.id === id)!;
  const presets = presetsOf(...g.groups);
  return (
    <RibbonMenuButton
      label={t(g.label)}
      icon={GALLERY_ICONS[g.id]!()}
      disabled={off}
      menu={(close) => (
        <div className="flex w-max flex-col gap-1" data-testid={`chart-gallery-${g.id}`}>
          {g.groups.map((group) => (
            <div key={group}>
              <div className="px-1 text-[11px] font-medium text-ui-muted">{t(`calc.chart.group.${group}`)}</div>
              <RibbonGallery
                label={t(`calc.chart.group.${group}`)}
                items={presetsOf(group).map((p) => ({ id: p.id, label: t(p.label), preview: <PresetIcon preset={p} width={64} height={48} /> }))}
                columns={Math.min(6, presetsOf(group).length)}
                hideLabels
                itemClassName="h-[54px] w-[70px] p-0.5"
                autoFocus={group === g.groups[0]}
                onSelect={(pid) => {
                  close();
                  void store.charts.insertPreset(pid);
                }}
              />
            </div>
          ))}
          {presets.length === 0 && <span />}
        </div>
      )}
    />
  );
}

/** A large button opening a gallery panel (sized to its content). */
function DropGallery(props: {
  label: string;
  icon: ReactNode;
  disabled?: boolean;
  columns: number;
  itemClassName: string;
  items: { id: string; label: string; preview: ReactNode }[];
  selected?: string;
  hideLabels?: boolean;
  onSelect: (id: string) => void;
}) {
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

/** The selected chart and its data (`null`: no chart selected). */
function selection(store: CalcStore): { chart: Chart; data: ResolvedChart } | null {
  const sel = store.charts.selected;
  const obj = store.charts.selectedChart();
  if (!sel || !obj) return null;
  return { chart: obj.chart, data: store.charts.dataOf(sel.sheet, obj) ?? { series: [] } };
}

/** Chart Design (contextual). */
export function chartDesignTab(store: CalcStore, t: T): RibbonTab | null {
  const cur = selection(store);
  if (!cur) return null;
  const { chart, data } = cur;
  const ro = chart.kind.type === "unsupported";
  const edit = (fn: (c: Chart) => Chart) => () => {
    void store.charts.edit(fn);
    store.focusGrid();
  };
  const points = data.series[0]?.values.length ?? 0;
  return {
    id: "chartDesign",
    label: t("calc.chart.tab.design"),
    groups: [
      {
        label: t("calc.chart.layouts"),
        items: (
          <>
            <RibbonMenuButton label={t("calc.chart.addElement")} icon={addElementIcon()} size="large" disabled={ro} menu={(close) => <AddElementMenu store={store} chart={chart} close={close} />} />
            <DropGallery
              label={t("calc.chart.quickLayout")}
              icon={quickLayoutIcon()}
              disabled={ro}
              columns={4}
              itemClassName="h-[68px] w-[100px] p-0.5"
              items={QUICK_LAYOUTS.map((l) => ({
                id: l.id,
                label: t("calc.chart.layoutN", { n: l.id }),
                preview: <LivePreview chart={applyQuickLayout(chart, l.id)} data={data} width={96} height={52} scale={3} />,
              }))}
              onSelect={(id) => edit((c) => applyQuickLayout(c, id))()}
            />
          </>
        ),
      },
      {
        label: t("calc.chart.styles"),
        items: (
          <>
            <DropGallery
              label={t("calc.chart.changeColors")}
              icon={colorsIcon()}
              disabled={ro}
              columns={1}
              selected={colorsOf(chart) ?? undefined}
              itemClassName="h-7 w-80 px-1"
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
              hideLabels
              onSelect={(id) => edit((c) => applyColors(c, id, points))()}
            />
            <DropGallery
              label={t("calc.chart.chartStyles")}
              icon={stylesIcon()}
              disabled={ro}
              columns={4}
              itemClassName="h-[68px] w-[100px] p-0.5"
              items={CHART_STYLES.map((n) => ({
                id: String(n),
                label: t("calc.chart.styleN", { n }),
                preview: <LivePreview chart={applyChartStyle(chart, n)} data={data} width={96} height={52} scale={3} />,
              }))}
              onSelect={(id) => edit((c) => applyChartStyle(c, Number(id)))()}
            />
          </>
        ),
      },
      {
        label: t("calc.chart.data"),
        items: (
          <>
            <RibbonButton label={t("calc.chart.switchRowCol")} icon={switchIcon()} size="large" disabled={ro} onClick={() => void store.charts.switchRowCol()} />
            <RibbonButton label={t("calc.chart.selectData")} icon={selectDataIcon()} size="large" disabled={ro} onClick={() => store.openDialog({ kind: "selectData" })} />
          </>
        ),
      },
      {
        label: t("calc.chart.type"),
        items: <RibbonButton label={t("calc.chart.changeType")} icon={changeTypeIcon()} size="large" disabled={ro} onClick={() => store.openDialog({ kind: "changeChartType" })} />,
      },
      {
        label: t("calc.chart.location"),
        items: <RibbonButton label={t("calc.chart.move")} icon={moveChartIcon()} size="large" onClick={() => store.openDialog({ kind: "moveChart" })} />,
      },
    ],
  };
}

const CM_PER_PX = 2.54 / 96;

/** Format (contextual): current selection, shape fill/outline of the selected series or point, size. */
export function chartFormatTab(store: CalcStore, t: T): RibbonTab | null {
  const cur = selection(store);
  const sel = store.charts.selected;
  const obj = store.charts.selectedChart();
  if (!cur || !sel || !obj) return null;
  const { chart, data } = cur;
  const ro = chart.kind.type === "unsupported";
  const el = sel.element;
  const seriesEl = el && (el.type === "series" || el.type === "dataLabels" || el.type === "trendline") ? el : null;
  const geo = store.geometry(sel.sheet);
  const rect = anchorRect(obj.anchor, geo.col, geo.row);
  const setSize = (dim: "w" | "h", cm: number) => {
    if (!(cm > 0)) return;
    const next = { ...rect, [dim]: Math.max(0.5, cm) / CM_PER_PX };
    void store.apply({ type: "setChartAnchor", sheet: sel.sheet, id: sel.id, anchor: rectToAnchor(next, obj.anchor.type, geo.col, geo.row) });
  };
  const point = el?.type === "series" ? el.point : undefined;
  return {
    id: "chartFormat",
    label: t("calc.chart.tab.format"),
    groups: [
      {
        label: t("calc.chart.currentSelection"),
        items: (
          <RibbonStack>
            <select
              aria-label={t("calc.chart.elements")}
              className={`${RIBBON_SELECT} w-44`}
              value={el ? elementKey(el) : "chartArea"}
              onChange={(e) => store.charts.select(sel.sheet, sel.id, elementFromKey(chart, e.target.value))}
            >
              {chartElements(chart).map((x) => (
                <option key={elementKey(x)} value={elementKey(x)}>
                  {elementName(x, chart, data)}
                </option>
              ))}
            </select>
            <RibbonButton
              label={t("calc.chart.formatSelection")}
              icon={formatPaneIcon()}
              showLabel
              disabled={ro}
              onClick={() => {
                store.charts.pane = true;
                store.notify();
              }}
            />
            <RibbonButton
              label={t("calc.chart.resetStyle")}
              icon={resetStyleIcon()}
              showLabel
              disabled={ro || !seriesEl}
              onClick={() => seriesEl && void store.charts.edit((c) => resetSeriesFormat(c, seriesEl.series))}
            />
          </RibbonStack>
        ),
      },
      {
        label: t("calc.chart.shapeStyles"),
        items: (
          <RibbonStack>
            <ColorPicker
              label={t("calc.chart.shapeFill")}
              kind="fill"
              disabled={ro || !seriesEl}
              onSelect={(c: Color | null) => seriesEl && void store.charts.edit((ch) => setSeriesFill(ch, seriesEl.series, point, c))}
            />
            <ColorPicker
              label={t("calc.chart.shapeOutline")}
              kind="text"
              disabled={ro || !seriesEl}
              onSelect={(c: Color | null) => seriesEl && void store.charts.edit((ch) => setSeriesLine(ch, seriesEl.series, c === null ? { none: true } : { color: c }))}
            />
          </RibbonStack>
        ),
      },
      {
        label: t("calc.chart.size"),
        items: (
          <RibbonStack>
            {(["h", "w"] as const).map((dim) => (
              <label key={dim} className="flex items-center gap-1 text-xs">
                <span className="w-12">{t(dim === "h" ? "calc.chart.height" : "calc.chart.width")}</span>
                <input
                  key={`${dim}${rect[dim]}`}
                  aria-label={t(dim === "h" ? "calc.chart.height" : "calc.chart.width")}
                  type="number"
                  step={0.1}
                  min={0.5}
                  className={`${RIBBON_SELECT} w-16`}
                  defaultValue={(rect[dim] * CM_PER_PX).toFixed(2)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") setSize(dim, Number((e.target as HTMLInputElement).value));
                  }}
                  onBlur={(e) => {
                    const v = Number(e.target.value);
                    if (Math.abs(v - rect[dim] * CM_PER_PX) > 0.005) setSize(dim, v);
                  }}
                />
                <span className="text-ui-muted">cm</span>
              </label>
            ))}
          </RibbonStack>
        ),
      },
    ],
  };
}

