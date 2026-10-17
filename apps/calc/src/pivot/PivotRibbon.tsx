// Pivot tables in Calc's ribbon (P8-33): Insert › Tables › PivotTable and
// the contextual PivotTable Analyze and Design tabs shown while a cell of a
// pivot table is selected (Excel 365); Insert Slicer (P9-C2). Group, Timeline,
// Fields, Items & Sets, PivotChart, Recommended PivotTables and Blank Rows
// are not offered (no model support yet).

import {
  RIBBON_SELECT, RibbonButton, RibbonGallery, RibbonMenuButton, RibbonStack, type RibbonGroup, type RibbonTab, type TFunction as T,
} from "@rusuite/ui-shared";
import type { PivotLayout } from "../generated/PivotLayout";
import type { PivotOptions } from "../generated/PivotOptions";
import type { PivotTable } from "../generated/PivotTable";
import type { CalcStore } from "../state/store";
import {
  buttonsIcon, clearIcon, collapseIcon, expandIcon, fieldListIcon, grandTotalsIcon, headersIcon, layoutIcon, moveIcon, optionsIcon, pivotIcon, refreshIcon,
  selectIcon, settingsIcon, sourceIcon, subtotalsIcon,
} from "./icons";
import { CLEAR_ALL_PATCH, clearFiltersPatch, pivotDataKey, withOptions } from "./model";
import { DEFAULT_PIVOT_STYLE, PIVOT_STYLES, pivotStyle, styleNumber } from "./styles";
import { insertSlicerButton } from "../slicers/SlicerRibbon";

/** Insert › Tables: PivotTable (Recommended PivotTables is not offered). */
export function pivotInsertGroup(store: CalcStore, t: T, off: boolean): RibbonGroup {
  return {
    label: t("calc.pivot.tables"),
    items: (
      <RibbonButton
        label={t("calc.pivot.pivotTable")}
        icon={pivotIcon()}
        size="large"
        tooltip={t("calc.pivot.insertTip")}
        disabled={off}
        onClick={() => store.openDialog({ kind: "pivotCreate" })}
      />
    ),
  };
}

/** The selected table and its field list (`null`: no pivot cell selected or not loaded yet). */
function current(store: CalcStore): { id: number; table: PivotTable; ro: boolean } | null {
  const p = store.pivots.active();
  if (!p) return null;
  const info = store.pivots.info(p.id);
  if (!info) return null;
  return { id: p.id, table: info.table, ro: !!info.readOnly };
}

/** The data field of the active value cell (Active Field on a value: Value Field Settings). */
function activeDataField(store: CalcStore, id: number, table: PivotTable): number | null {
  const cell = store.activeCell();
  const p = store.pivots.active();
  if (!p || !cell?.pivot || !(cell.pivot.kind === "value" || cell.pivot.kind === "subtotal" || cell.pivot.kind === "grandTotal")) return null;
  const sheet = store.getState().activeSheet;
  const cells = store.cache(sheet).cells;
  const key = pivotDataKey((r, c) => cells.get(r)?.get(c), p, cell.row, cell.col);
  if (!key) return null;
  const captions = store.pivots.info(id)?.captions ?? [];
  const at = key.caption ? captions.indexOf(key.caption) : 0;
  return (table.values ?? []).length ? Math.max(0, at) : null;
}

/** PivotTable Analyze (contextual). */
export function pivotAnalyzeTab(store: CalcStore, t: T): RibbonTab | null {
  const cur = current(store);
  if (!cur) return null;
  const { id, table, ro } = cur;
  const pivots = store.pivots;
  const opts = table.options ?? {};
  const set = (changes: Partial<PivotOptions>) => () => {
    void pivots.update(id, { options: withOptions(table, changes) });
    store.focusGrid();
  };
  const field = pivots.activeField();
  const dataField = activeDataField(store, id, table);
  const fieldName = field?.name ?? (dataField !== null ? (store.pivots.info(id)?.captions[dataField] ?? "") : "");
  return {
    id: "pivotAnalyze",
    label: t("calc.pivot.tab.analyze"),
    groups: [
      {
        label: t("calc.pivot.pivotTable"),
        items: (
          <RibbonStack>
            <label className="flex items-center gap-1 text-xs">
              <span>{t("calc.pivot.name")}</span>
              <input
                key={`${id}:${table.name}`}
                aria-label={t("calc.pivot.name")}
                className={`${RIBBON_SELECT} w-32`}
                defaultValue={table.name}
                disabled={ro}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                }}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== table.name) void pivots.update(id, { name: v });
                }}
              />
            </label>
            <RibbonMenuButton
              label={t("calc.pivot.options")}
              icon={optionsIcon(16)}
              showLabel
              menu={[
                { id: "options", label: t("calc.pivot.optionsDots"), disabled: ro, onSelect: () => store.openDialog({ kind: "pivotOptions", id }) },
                { separator: true },
                {
                  id: "gpd",
                  label: t("calc.pivot.generateGpd"),
                  checked: pivots.getPivotData,
                  onSelect: () => {
                    pivots.getPivotData = !pivots.getPivotData;
                    store.notify();
                  },
                },
              ]}
            />
          </RibbonStack>
        ),
      },
      {
        label: t("calc.pivot.activeField"),
        items: (
          <>
            <RibbonStack>
              <input aria-label={t("calc.pivot.activeField")} className={`${RIBBON_SELECT} w-32`} readOnly value={fieldName} />
              <RibbonButton
                label={t("calc.pivot.fieldSettings")}
                icon={settingsIcon()}
                showLabel
                disabled={ro || (!field && dataField === null)}
                onClick={() => {
                  if (field) store.openDialog({ kind: "pivotFieldSettings", id, field: field.field });
                  else if (dataField !== null) store.openDialog({ kind: "pivotValueField", id, index: dataField });
                }}
              />
            </RibbonStack>
            <RibbonStack>
              <RibbonButton label={t("calc.pivot.expandField")} icon={expandIcon()} showLabel disabled={ro || !field} onClick={() => void pivots.expandField(false)} />
              <RibbonButton label={t("calc.pivot.collapseField")} icon={collapseIcon()} showLabel disabled={ro || !field} onClick={() => void pivots.expandField(true)} />
            </RibbonStack>
          </>
        ),
      },
      {
        label: t("calc.slicer.filter"),
        items: insertSlicerButton(store, t),
      },
      {
        label: t("calc.pivot.data"),
        items: (
          <>
            <RibbonMenuButton
              label={t("calc.pivot.refresh")}
              icon={refreshIcon()}
              size="large"
              menu={[
                { id: "refresh", label: t("calc.pivot.refresh"), shortcut: "Alt+F5", onSelect: () => void pivots.refresh(id) },
                { id: "refreshAll", label: t("calc.pivot.refreshAll"), shortcut: "Mod+Alt+F5", onSelect: () => void pivots.refresh(null) },
              ]}
            />
            <RibbonButton label={t("calc.pivot.changeSource")} icon={sourceIcon()} size="large" disabled={ro} onClick={() => store.openDialog({ kind: "pivotSource", id })} />
          </>
        ),
      },
      {
        label: t("calc.pivot.actions"),
        items: (
          <>
            <RibbonMenuButton
              label={t("calc.pivot.clear")}
              icon={clearIcon()}
              size="large"
              disabled={ro}
              menu={[
                { id: "all", label: t("calc.pivot.clearAll"), onSelect: () => void pivots.update(id, CLEAR_ALL_PATCH) },
                {
                  id: "filters",
                  label: t("calc.pivot.clearFilters"),
                  disabled: clearFiltersPatch(table) === null,
                  onSelect: () => {
                    const p = clearFiltersPatch(table);
                    if (p) void pivots.update(id, p);
                  },
                },
              ]}
            />
            <RibbonMenuButton
              label={t("calc.pivot.select")}
              icon={selectIcon()}
              size="large"
              menu={[
                { id: "labels", label: t("calc.pivot.selectLabels"), onSelect: () => pivots.select("labels") },
                { id: "values", label: t("calc.pivot.selectValues"), onSelect: () => pivots.select("values") },
                { id: "entire", label: t("calc.pivot.selectEntire"), onSelect: () => pivots.select("entire") },
              ]}
            />
            <RibbonButton label={t("calc.pivot.move")} icon={moveIcon()} size="large" onClick={() => store.openDialog({ kind: "pivotMove", id })} />
          </>
        ),
      },
      {
        label: t("group.show"),
        items: (
          <>
            <RibbonButton label={t("calc.pivot.fieldList")} icon={fieldListIcon()} size="large" pressed={pivots.pane} onClick={() => pivots.togglePane()} />
            <RibbonStack>
              <RibbonButton label={t("calc.pivot.buttons")} icon={buttonsIcon(16)} showLabel pressed={pivots.buttons} onClick={() => pivots.toggleButtons()} />
              <RibbonButton
                label={t("calc.pivot.fieldHeaders")}
                icon={headersIcon(16)}
                showLabel
                pressed={opts.showFieldHeaders !== false}
                disabled={ro}
                onClick={set({ showFieldHeaders: opts.showFieldHeaders === false })}
              />
            </RibbonStack>
          </>
        ),
      },
    ],
  };
}

/** A style's preview: a 5 × 5 table in the style's colours. */
export function StylePreview({ id, width = 61, height = 46 }: { id: string; width?: number; height?: number }) {
  const d = pivotStyle(id);
  const rows = 5;
  const rh = height / rows;
  const out = [];
  for (let r = 0; r < rows; r++) {
    const header = r === 0;
    const total = r === rows - 1;
    const fill = header ? d.headerFill : total ? (d.totalFill ?? d.bodyFill) : r % 2 === 0 ? d.band : (d.subtotalFill && r === 1 ? d.subtotalFill : d.bodyFill);
    out.push(<rect key={`f${r}`} x={0} y={r * rh} width={width} height={rh} fill={fill ?? "#ffffff"} />);
    const text = header ? d.headerColor : d.bodyColor;
    out.push(<rect key={`t${r}`} x={4} y={r * rh + rh / 2 - 1} width={width * 0.3} height={2} fill={text} opacity={header || total ? 1 : 0.6} />);
    out.push(<rect key={`v${r}`} x={width * 0.62} y={r * rh + rh / 2 - 1} width={width * 0.3} height={2} fill={text} opacity={header || total ? 1 : 0.6} />);
  }
  return (
    <svg aria-hidden="true" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      {out}
      <line x1={0} y1={rh} x2={width} y2={rh} stroke={d.line} />
      <line x1={0} y1={height - rh} x2={width} y2={height - rh} stroke={d.line} />
      <rect x={0.5} y={0.5} width={width - 1} height={height - 1} fill="none" stroke="#c8c8c8" />
    </svg>
  );
}

const styleLabel = (t: T, id: string) => {
  const s = styleNumber(id);
  return t(`calc.pivot.style.${s.family}`, { n: s.n });
};

/** PivotTable Design (contextual). */
export function pivotDesignTab(store: CalcStore, t: T): RibbonTab | null {
  const cur = current(store);
  if (!cur) return null;
  const { id, table, ro } = cur;
  const pivots = store.pivots;
  const opts = table.options ?? {};
  const set = (changes: Partial<PivotOptions>) => () => {
    void pivots.update(id, { options: withOptions(table, changes) });
    store.focusGrid();
  };
  const rows = table.rows ?? [];
  const cols = table.cols ?? [];
  const subtotalsNone = [...rows, ...cols].length > 0 && [...rows, ...cols].every((a) => a.subtotals?.kind === "none");
  const setSubtotals = (mode: "none" | "top" | "bottom") => () => {
    const map = (a: (typeof rows)[number]) =>
      mode === "none" ? { ...a, subtotals: { kind: "none" as const } } : { ...(({ subtotals: _s, ...rest }) => rest)(a), subtotalBottom: mode === "bottom" };
    void pivots.update(id, { rows: rows.map(map), cols: cols.map(map) });
  };
  const subtotalsBottom = !subtotalsNone && rows.length > 0 && rows.every((a) => a.subtotalBottom);
  const gtRows = opts.grandTotalRows !== false;
  const gtCols = opts.grandTotalCols !== false;
  const layout: PivotLayout = rows[0]?.layout ?? "compact";
  const setLayout = (l: PivotLayout) => () => void pivots.update(id, { layout: l });
  const style = opts.style ?? DEFAULT_PIVOT_STYLE;
  return {
    id: "pivotDesign",
    label: t("calc.pivot.tab.design"),
    groups: [
      {
        label: t("calc.pivot.layout"),
        items: (
          <>
            <RibbonMenuButton
              label={t("calc.pivot.subtotals")}
              icon={subtotalsIcon()}
              size="large"
              disabled={ro}
              menu={[
                { id: "none", label: t("calc.pivot.subtotalsNone"), checked: subtotalsNone, onSelect: setSubtotals("none") },
                { id: "bottom", label: t("calc.pivot.subtotalsBottom"), checked: subtotalsBottom, onSelect: setSubtotals("bottom") },
                { id: "top", label: t("calc.pivot.subtotalsTop"), checked: !subtotalsNone && !subtotalsBottom, onSelect: setSubtotals("top") },
              ]}
            />
            <RibbonMenuButton
              label={t("calc.pivot.grandTotals")}
              icon={grandTotalsIcon()}
              size="large"
              disabled={ro}
              menu={[
                { id: "off", label: t("calc.pivot.gtOff"), checked: !gtRows && !gtCols, onSelect: set({ grandTotalRows: false, grandTotalCols: false }) },
                { id: "on", label: t("calc.pivot.gtOn"), checked: gtRows && gtCols, onSelect: set({ grandTotalRows: true, grandTotalCols: true }) },
                { id: "rows", label: t("calc.pivot.gtRows"), checked: gtRows && !gtCols, onSelect: set({ grandTotalRows: true, grandTotalCols: false }) },
                { id: "cols", label: t("calc.pivot.gtCols"), checked: !gtRows && gtCols, onSelect: set({ grandTotalRows: false, grandTotalCols: true }) },
              ]}
            />
            <RibbonMenuButton
              label={t("calc.pivot.reportLayout")}
              icon={layoutIcon()}
              size="large"
              disabled={ro}
              menu={[
                { id: "compact", label: t("calc.pivot.layoutCompact"), checked: layout === "compact", onSelect: setLayout("compact") },
                { id: "outline", label: t("calc.pivot.layoutOutline"), checked: layout === "outline", onSelect: setLayout("outline") },
                { id: "tabular", label: t("calc.pivot.layoutTabular"), checked: layout === "tabular", onSelect: setLayout("tabular") },
                { separator: true },
                { id: "repeat", label: t("calc.pivot.repeatAll"), checked: !!opts.repeatLabels, onSelect: set({ repeatLabels: true }) },
                { id: "norepeat", label: t("calc.pivot.repeatNone"), checked: !opts.repeatLabels, onSelect: set({ repeatLabels: false }) },
              ]}
            />
          </>
        ),
      },
      {
        label: t("calc.pivot.styleOptions"),
        items: (
          <>
            <RibbonStack>
              <Check label={t("calc.pivot.rowHeaders")} checked={opts.rowHeadersBold !== false} disabled={ro} onChange={set({ rowHeadersBold: opts.rowHeadersBold === false })} />
              <Check label={t("calc.pivot.colHeaders")} checked={opts.colHeadersBold !== false} disabled={ro} onChange={set({ colHeadersBold: opts.colHeadersBold === false })} />
            </RibbonStack>
            <RibbonStack>
              <Check label={t("calc.pivot.bandedRows")} checked={!!opts.banded} disabled={ro} onChange={set({ banded: !opts.banded })} />
              <Check label={t("calc.pivot.bandedCols")} checked={!!opts.bandedCols} disabled={ro} onChange={set({ bandedCols: !opts.bandedCols })} />
            </RibbonStack>
          </>
        ),
      },
      {
        label: t("calc.pivot.styles"),
        items: (
          <RibbonMenuButton
            label={t("calc.pivot.stylesGallery")}
            icon={<StylePreview id={style} width={32} height={24} />}
            size="large"
            disabled={ro}
            menu={(close) => (
              <div className="flex max-h-[70vh] w-max flex-col gap-1 overflow-auto" data-testid="pivot-style-gallery">
                {(["light", "medium", "dark"] as const).map((family) => {
                  const ids = PIVOT_STYLES.filter((s) => styleNumber(s).family === family);
                  return (
                    <div key={family}>
                      <div className="px-1 text-[11px] font-medium text-ui-muted">{t(`calc.pivot.styleGroup.${family}`)}</div>
                      <RibbonGallery
                        label={t(`calc.pivot.styleGroup.${family}`)}
                        items={ids.map((s) => ({ id: s, label: styleLabel(t, s), preview: <StylePreview id={s} /> }))}
                        selected={style}
                        columns={7}
                        hideLabels
                        itemClassName="h-[52px] w-[67px] p-0.5"
                        autoFocus={family === "light"}
                        onSelect={(s) => {
                          close();
                          set({ style: s })();
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          />
        ),
      },
    ],
  };
}

function Check({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: () => void }) {
  return (
    <label className={`flex h-6 items-center gap-1.5 px-1 text-xs ${disabled ? "opacity-50" : ""}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={onChange} />
      {label}
    </label>
  );
}
