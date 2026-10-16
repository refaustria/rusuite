// Pivot table dialogs (P8-33): Create PivotTable (Insert › PivotTable),
// Value Field Settings, Field Settings, PivotTable Options, Move
// PivotTable, Change PivotTable Data Source, the delete question and the
// filter dropdown of the headers and page fields. "Recommended
// PivotTables" and the data model ("Add this data to the Data Model") are
// not offered.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Dialog } from "@rusuite/ui-shared";
import type { AggFunc } from "../generated/AggFunc";
import type { AxisField } from "../generated/AxisField";
import type { PivotInfo } from "../generated/PivotInfo";
import type { PivotItemInfo } from "../generated/PivotItemInfo";
import type { PivotLayout } from "../generated/PivotLayout";
import type { PivotSourceSpec } from "../generated/PivotSourceSpec";
import type { PivotTarget } from "../generated/PivotTarget";
import type { ShowAs } from "../generated/ShowAs";
import type { Subtotals } from "../generated/Subtotals";
import { PickBar, RangeField, type Picker } from "../charts/ChartDialogs";
import { parseRange, rangeFormula } from "../charts/refs";
import { useT } from "../i18n";
import { useCalc, type CalcDialog, type CalcStore } from "../state/store";
import type { DropTarget } from "./buttons";
import {
  AGG_FUNCS, captionOf, dataFieldOf, hiddenItemsOf, pageSelectionOf, SHOW_AS_KINDS, showAsNeeds, showAsOf, updateAxisField, visibleItems, withOptions,
} from "./model";

const BTN = "h-8 rounded border border-ui-border bg-ui-bg px-3 text-sm hover:bg-ui-hover disabled:opacity-40";
const FIELD = "h-8 rounded border border-ui-border bg-ui-bg px-2 text-sm text-ui-fg";
const ITEM = "flex min-h-8 w-full items-center gap-2 rounded px-2 text-left text-sm hover:bg-ui-hover disabled:opacity-40";

/** Number formats offered by Value Field Settings › Number Format (`""` = General). */
export const VALUE_FORMATS = ["", "0", "0.00", "#,##0", "#,##0.00", "0%", "0.00%", "#,##0.00 €", "yyyy-mm-dd"];

function useClose(store: CalcStore) {
  return () => {
    store.closeDialog();
    store.focusGrid();
  };
}

function Buttons({ onCancel, ok = true, okLabel }: { onCancel: () => void; ok?: boolean; okLabel?: string }) {
  const t = useT();
  return (
    <div className="flex justify-end gap-2">
      <button type="submit" className={BTN} disabled={!ok}>
        {okLabel ?? t("common.ok")}
      </button>
      <button type="button" className={BTN} onClick={onCancel}>
        {t("common.cancel")}
      </button>
    </div>
  );
}

/** The sheet id of a sheet name (`null`: the active sheet; unknown names: `undefined`). */
function sheetId(store: CalcStore, name: string | null): number | undefined {
  const st = store.getState();
  if (name === null) return st.activeSheet;
  return st.info?.sheets.find((s) => s.name.toLowerCase() === name.toLowerCase())?.id;
}

/** A source text: a range (`Sheet1!$A$1:$D$7`, a single cell = its region) or a defined name; `null` when invalid. */
export function parseSource(store: CalcStore, text: string): PivotSourceSpec | null {
  const r = parseRange(text);
  if (r) {
    const sheet = sheetId(store, r.sheet);
    return sheet === undefined ? null : { kind: "range", sheet, r0: r.r0, c0: r.c0, r1: r.r1, c1: r.c1 };
  }
  const name = text.trim().replace(/^=/, "");
  return /^[A-Za-z_\\][A-Za-z0-9_.\\]*$/.test(name) ? { kind: "name", name } : null;
}

/** A location text (`Sheet1!$F$3`) → its top-left cell; `null` when invalid. */
export function parseLocation(store: CalcStore, text: string): Extract<PivotTarget, { kind: "cell" }> | null {
  const r = parseRange(text);
  if (!r) return null;
  const sheet = sheetId(store, r.sheet);
  return sheet === undefined ? null : { kind: "cell", sheet, row: r.r0, col: r.c0 };
}

/** The current region of the active cell as the dialog's default source (`Sheet1!$A$1:$D$7`). */
export function defaultSource(store: CalcStore): string {
  const st = store.getState();
  const a = store.activeAnchor();
  const r = store.currentRegion(a.row, a.col);
  const name = st.info?.sheets.find((s) => s.id === st.activeSheet)?.name ?? null;
  const filled = store.cache(st.activeSheet).cells.get(a.row)?.get(a.col)?.input;
  if (!filled && r.r0 === r.r1 && r.c0 === r.c1) return "";
  return rangeFormula({ sheet: name, ...r });
}

/** Insert › PivotTable: Create PivotTable. */
export function CreatePivotDialog({ store }: { store: CalcStore }) {
  const t = useT();
  const close = useClose(store);
  const [source, setSource] = useState(() => defaultSource(store));
  const [where, setWhere] = useState<"new" | "existing">("new");
  const [location, setLocation] = useState("");
  const [picker, setPicker] = useState<Picker | null>(null);
  if (picker) return <PickBar store={store} picker={picker} onDone={() => setPicker(null)} />;
  const src = parseSource(store, source);
  const loc = where === "existing" ? parseLocation(store, location) : null;
  const ok = !!src && (where === "new" || !!loc);
  return (
    <Dialog open title={t("calc.pivot.createTitle")} onClose={close}>
      <form
        className="flex w-[26rem] flex-col gap-3 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (!src || (where === "existing" && !loc)) return;
          close();
          void store.pivots.create(src, where === "new" ? { kind: "newSheet" } : loc!);
        }}
      >
        <fieldset className="flex flex-col gap-1">
          <legend className="font-medium">{t("calc.pivot.chooseData")}</legend>
          <RangeField label={t("calc.pivot.tableRange")} testId="pivot-source" value={source} onChange={setSource} onPick={(p) => setPicker({ ...p, set: setSource })} />
          {source !== "" && !src && <span className="text-xs text-red-700">{t("calc.pivot.badSource")}</span>}
        </fieldset>
        <fieldset className="flex flex-col gap-1">
          <legend className="font-medium">{t("calc.pivot.chooseWhere")}</legend>
          <label className="flex h-8 items-center gap-2">
            <input type="radio" name="pivot-where" checked={where === "new"} onChange={() => setWhere("new")} />
            {t("calc.pivot.newSheet")}
          </label>
          <label className="flex h-8 items-center gap-2">
            <input type="radio" name="pivot-where" checked={where === "existing"} onChange={() => setWhere("existing")} />
            {t("calc.pivot.existingSheet")}
          </label>
          {where === "existing" && (
            <RangeField label={t("calc.pivot.location")} testId="pivot-location" value={location} onChange={setLocation} onPick={(p) => setPicker({ ...p, set: setLocation })} />
          )}
        </fieldset>
        <Buttons onCancel={close} ok={ok} />
      </form>
    </Dialog>
  );
}

/** The field list of a table for a dialog (loads it). */
function useInfo(store: CalcStore, id: number): PivotInfo | null {
  useCalc(store, (s) => s.version);
  return store.pivots.info(id);
}

/** The items of a field (for base items and the filter list). */
function useItems(store: CalcStore, id: number, field: number | null): PivotItemInfo[] | null {
  const [items, setItems] = useState<PivotItemInfo[] | null>(null);
  useEffect(() => {
    let live = true;
    setItems(null);
    if (field === null) return;
    store.pivots.items(id, field).then(
      (v) => live && setItems(v),
      (e: unknown) => store.pushError(e),
    );
    return () => {
      live = false;
    };
  }, [store, id, field]);
  return items;
}

/** Value Field Settings: custom name, Summarize Values By, Show Values As (base field / item), Number Format. */
export function ValueFieldDialog({ store, id, index }: { store: CalcStore; id: number; index: number }) {
  const t = useT();
  const close = useClose(store);
  const info = useInfo(store, id);
  const d = info?.table.values?.[index];
  const fieldName = d ? (info!.fields[d.field]?.name ?? "") : "";
  const [name, setName] = useState<string | null>(null);
  const [func, setFunc] = useState<AggFunc | null>(null);
  const [tab, setTab] = useState<"summarize" | "showAs">("summarize");
  const [kind, setKind] = useState<ShowAs["kind"] | null>(null);
  const [baseField, setBaseField] = useState<number | null>(null);
  const [baseItem, setBaseItem] = useState<"previous" | "next" | number | null>(null);
  const [format, setFormat] = useState<string | null>(null);
  const axisFields = info ? [...(info.table.rows ?? []), ...(info.table.cols ?? [])].map((a) => a.field) : [];
  const show = d?.showAs ?? { kind: "normal" as const };
  const curKind = kind ?? show.kind;
  const curBase = baseField ?? ("baseField" in show ? show.baseField : (axisFields[0] ?? null));
  const curItem = baseItem ?? (show.kind === "differenceFrom" ? (show.baseItem.kind === "item" ? show.baseItem.item : show.baseItem.kind) : null);
  const items = useItems(store, id, showAsNeeds(curKind).item ? curBase : null);
  if (!info || !d) return null;
  const curFunc = func ?? d.func ?? "sum";
  const curName = name ?? captionOf(d, fieldName);
  const curFormat = format ?? d.numberFormat ?? "";
  const showAs = showAsOf(curKind, curBase, curItem);
  return (
    <Dialog open title={t("calc.pivot.vfsTitle")} onClose={close}>
      <form
        className="flex w-[26rem] flex-col gap-3 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (!showAs) return;
          const values = [...(info.table.values ?? [])];
          values[index] = dataFieldOf(d.field, fieldName, curName, curFunc, showAs, curFormat || null);
          close();
          void store.pivots.update(id, { values });
        }}
      >
        <p className="text-xs">
          {t("calc.pivot.sourceName")} <strong>{fieldName}</strong>
        </p>
        <label className="flex items-center gap-2">
          <span className="w-28">{t("calc.pivot.customName")}</span>
          <input
            className={`${FIELD} flex-1`}
            aria-label={t("calc.pivot.customName")}
            value={curName}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <div role="tablist" className="flex gap-1 border-b border-ui-border">
          {(["summarize", "showAs"] as const).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={`h-8 px-3 ${tab === k ? "border-b-2 border-[#217346] font-medium" : ""}`} onClick={() => setTab(k)}>
              {t(k === "summarize" ? "calc.pivot.summarizeBy" : "calc.pivot.showAs")}
            </button>
          ))}
        </div>
        {tab === "summarize" ? (
          <div role="listbox" aria-label={t("calc.pivot.summarizeBy")} className="flex max-h-48 flex-col overflow-auto rounded border border-ui-border bg-ui-bg py-1">
            {AGG_FUNCS.map((f) => (
              <button
                key={f}
                type="button"
                role="option"
                aria-selected={curFunc === f}
                className={`h-8 px-2 text-left ${curFunc === f ? "bg-ui-active" : "hover:bg-ui-hover"}`}
                onClick={() => {
                  setFunc(f);
                  // An untouched default caption follows the function (Excel).
                  if (curName === captionOf(d, fieldName) || curName === captionOf({ ...d, func: curFunc }, fieldName)) setName(captionOf({ field: d.field, func: f }, fieldName));
                }}
              >
                {t(`calc.pivot.func.${f}`)}
              </button>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <label className="flex flex-col gap-1">
              <span>{t("calc.pivot.showAs")}</span>
              <select className={FIELD} aria-label={t("calc.pivot.showAs")} value={curKind} onChange={(e) => setKind(e.target.value as ShowAs["kind"])}>
                {SHOW_AS_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`calc.pivot.showAs.${k}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span>{t("calc.pivot.baseField")}</span>
              <select className={FIELD} aria-label={t("calc.pivot.baseField")} disabled={!showAsNeeds(curKind).field} value={curBase ?? ""} onChange={(e) => setBaseField(Number(e.target.value))}>
                {info.fields.map((f) => (
                  <option key={f.index} value={f.index}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span>{t("calc.pivot.baseItem")}</span>
              <select
                className={FIELD}
                aria-label={t("calc.pivot.baseItem")}
                disabled={!showAsNeeds(curKind).item}
                value={curItem === null ? "" : String(curItem)}
                onChange={(e) => setBaseItem(e.target.value === "previous" || e.target.value === "next" ? e.target.value : Number(e.target.value))}
              >
                <option value="" disabled>
                  {"—"}
                </option>
                <option value="previous">{t("calc.pivot.previous")}</option>
                <option value="next">{t("calc.pivot.next")}</option>
                {(items ?? []).map((i) => (
                  <option key={i.index} value={i.index}>
                    {i.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        <label className="flex items-center gap-2">
          <span className="w-28">{t("calc.pivot.numberFormat")}</span>
          <select className={`${FIELD} flex-1`} aria-label={t("calc.pivot.numberFormat")} value={VALUE_FORMATS.includes(curFormat) ? curFormat : "custom"} onChange={(e) => setFormat(e.target.value === "custom" ? curFormat || "0" : e.target.value)}>
            {VALUE_FORMATS.map((f) => (
              <option key={f} value={f}>
                {f === "" ? t("calc.pivot.general") : f}
              </option>
            ))}
            <option value="custom">{t("calc.pivot.customFormat")}</option>
          </select>
        </label>
        {!VALUE_FORMATS.includes(curFormat) && (
          <input className={FIELD} aria-label={t("calc.pivot.formatCode")} value={curFormat} onChange={(e) => setFormat(e.target.value)} />
        )}
        <Buttons onCancel={close} ok={!!showAs} />
      </form>
    </Dialog>
  );
}

/** Field Settings: subtotals (Automatic / None / Custom), layout per field, repeat labels, items with no data. */
export function FieldSettingsDialog({ store, id, field }: { store: CalcStore; id: number; field: number }) {
  const t = useT();
  const close = useClose(store);
  const info = useInfo(store, id);
  const axis = info ? [...(info.table.rows ?? []), ...(info.table.cols ?? [])].find((a) => a.field === field) : undefined;
  const [sub, setSub] = useState<Subtotals["kind"] | null>(null);
  const [funcs, setFuncs] = useState<AggFunc[] | null>(null);
  const [layout, setLayout] = useState<PivotLayout | null>(null);
  const [repeat, setRepeat] = useState<boolean | null>(null);
  const [showAll, setShowAll] = useState<boolean | null>(null);
  if (!info) return null;
  const name = info.fields[field]?.name ?? "";
  const curSub = sub ?? axis?.subtotals?.kind ?? "automatic";
  const curFuncs = funcs ?? (axis?.subtotals?.kind === "custom" ? axis.subtotals.functions : []);
  const curLayout = layout ?? axis?.layout ?? "compact";
  const curRepeat = repeat ?? !!info.table.options?.repeatLabels;
  const curShowAll = showAll ?? !!axis?.showAllItems;
  const ok = !axis || curSub !== "custom" || curFuncs.length > 0;
  return (
    <Dialog open title={t("calc.pivot.fsTitle")} onClose={close}>
      <form
        className="flex w-[24rem] flex-col gap-3 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (!axis) return close();
          const subtotals: Subtotals = curSub === "custom" ? { kind: "custom", functions: AGG_FUNCS.filter((f) => curFuncs.includes(f)) } : { kind: curSub };
          const next = (a: AxisField): AxisField => {
            const out: AxisField = { ...a, layout: curLayout };
            if (subtotals.kind === "automatic") delete out.subtotals;
            else out.subtotals = subtotals;
            if (curShowAll) out.showAllItems = true;
            else delete out.showAllItems;
            if (curLayout === "compact") delete out.layout;
            return out;
          };
          const patch = updateAxisField(info.table, field, next) ?? {};
          if (curRepeat !== !!info.table.options?.repeatLabels) patch.options = withOptions(info.table, { repeatLabels: curRepeat });
          close();
          if (Object.keys(patch).length) void store.pivots.update(id, patch);
        }}
      >
        <p className="text-xs">
          {t("calc.pivot.sourceName")} <strong>{name}</strong>
        </p>
        {!axis ? (
          <p className="text-xs text-ui-muted">{t("calc.pivot.pageFieldNote")}</p>
        ) : (
          <>
            <fieldset className="flex flex-col gap-1">
              <legend className="font-medium">{t("calc.pivot.subtotals")}</legend>
              {(["automatic", "none", "custom"] as const).map((k) => (
                <label key={k} className="flex h-8 items-center gap-2">
                  <input type="radio" name="pivot-sub" checked={curSub === k} onChange={() => setSub(k)} />
                  {t(`calc.pivot.sub.${k}`)}
                </label>
              ))}
              {curSub === "custom" && (
                <div role="group" aria-label={t("calc.pivot.sub.custom")} className="ml-6 grid grid-cols-2 gap-x-2">
                  {AGG_FUNCS.map((f) => (
                    <label key={f} className="flex h-7 items-center gap-2 text-xs">
                      <input type="checkbox" checked={curFuncs.includes(f)} onChange={() => setFuncs(curFuncs.includes(f) ? curFuncs.filter((x) => x !== f) : [...curFuncs, f])} />
                      {t(`calc.pivot.func.${f}`)}
                    </label>
                  ))}
                </div>
              )}
            </fieldset>
            <fieldset className="flex flex-col gap-1">
              <legend className="font-medium">{t("calc.pivot.layout")}</legend>
              {(["compact", "outline", "tabular"] as const).map((k) => (
                <label key={k} className="flex h-8 items-center gap-2">
                  <input type="radio" name="pivot-layout" checked={curLayout === k} onChange={() => setLayout(k)} />
                  {t(`calc.pivot.fieldLayout.${k}`)}
                </label>
              ))}
              <label className="flex h-8 items-center gap-2">
                <input type="checkbox" checked={curRepeat} onChange={(e) => setRepeat(e.target.checked)} />
                {t("calc.pivot.repeatLabels")}
              </label>
              <label className="flex h-8 items-center gap-2">
                <input type="checkbox" checked={curShowAll} onChange={(e) => setShowAll(e.target.checked)} />
                {t("calc.pivot.showAllItems")}
              </label>
            </fieldset>
          </>
        )}
        <Buttons onCancel={close} ok={ok} />
      </form>
    </Dialog>
  );
}

/** PivotTable Options: name, empty / error cells, grand totals, repeat labels, field headers. */
export function PivotOptionsDialog({ store, id }: { store: CalcStore; id: number }) {
  const t = useT();
  const close = useClose(store);
  const info = useInfo(store, id);
  const o = info?.table.options ?? {};
  const [name, setName] = useState<string | null>(null);
  const [emptyOn, setEmptyOn] = useState<boolean | null>(null);
  const [empty, setEmpty] = useState<string | null>(null);
  const [errorOn, setErrorOn] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gtRows, setGtRows] = useState<boolean | null>(null);
  const [gtCols, setGtCols] = useState<boolean | null>(null);
  const [repeat, setRepeat] = useState<boolean | null>(null);
  const [headers, setHeaders] = useState<boolean | null>(null);
  if (!info) return null;
  const v = {
    name: name ?? info.table.name,
    emptyOn: emptyOn ?? true,
    empty: empty ?? o.emptyAs ?? "",
    errorOn: errorOn ?? o.errorAs !== undefined,
    error: error ?? o.errorAs ?? "",
    gtRows: gtRows ?? o.grandTotalRows !== false,
    gtCols: gtCols ?? o.grandTotalCols !== false,
    repeat: repeat ?? !!o.repeatLabels,
    headers: headers ?? o.showFieldHeaders !== false,
  };
  const check = (label: string, value: boolean, set: (b: boolean) => void, extra?: ReactNode) => (
    <label className="flex h-8 items-center gap-2">
      <input type="checkbox" checked={value} onChange={(e) => set(e.target.checked)} />
      <span className="w-48">{label}</span>
      {extra}
    </label>
  );
  return (
    <Dialog open title={t("calc.pivot.optionsTitle")} onClose={close}>
      <form
        className="flex w-[26rem] flex-col gap-2 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          const options = withOptions(info.table, {
            emptyAs: v.emptyOn ? v.empty : "",
            grandTotalRows: v.gtRows,
            grandTotalCols: v.gtCols,
            repeatLabels: v.repeat,
            showFieldHeaders: v.headers,
          });
          if (v.errorOn) options.errorAs = v.error;
          else delete options.errorAs;
          close();
          void store.pivots.update(id, { ...(v.name.trim() && v.name.trim() !== info.table.name ? { name: v.name.trim() } : {}), options });
        }}
      >
        <label className="flex items-center gap-2">
          <span className="w-28">{t("calc.pivot.name")}</span>
          <input className={`${FIELD} flex-1`} aria-label={t("calc.pivot.name")} value={v.name} onChange={(e) => setName(e.target.value)} />
        </label>
        <fieldset className="flex flex-col">
          <legend className="font-medium">{t("calc.pivot.format")}</legend>
          {check(t("calc.pivot.forErrors"), v.errorOn, setErrorOn, <input className={`${FIELD} w-24`} aria-label={t("calc.pivot.forErrors")} disabled={!v.errorOn} value={v.error} onChange={(e) => setError(e.target.value)} />)}
          {check(t("calc.pivot.forEmpty"), v.emptyOn, setEmptyOn, <input className={`${FIELD} w-24`} aria-label={t("calc.pivot.forEmpty")} disabled={!v.emptyOn} value={v.empty} onChange={(e) => setEmpty(e.target.value)} />)}
        </fieldset>
        <fieldset className="flex flex-col">
          <legend className="font-medium">{t("calc.pivot.totalsFilters")}</legend>
          {check(t("calc.pivot.gtForRows"), v.gtCols, setGtCols)}
          {check(t("calc.pivot.gtForCols"), v.gtRows, setGtRows)}
        </fieldset>
        <fieldset className="flex flex-col">
          <legend className="font-medium">{t("calc.pivot.display")}</legend>
          {check(t("calc.pivot.repeatLabels"), v.repeat, setRepeat)}
          {check(t("calc.pivot.fieldHeaders"), v.headers, setHeaders)}
        </fieldset>
        <Buttons onCancel={close} />
      </form>
    </Dialog>
  );
}

/** Move PivotTable: a new worksheet or a cell. */
export function MovePivotDialog({ store, id }: { store: CalcStore; id: number }) {
  const t = useT();
  const close = useClose(store);
  const [where, setWhere] = useState<"new" | "existing">("existing");
  const [location, setLocation] = useState(() => {
    const p = store.pivots.get(id);
    const name = store.getState().info?.sheets.find((s) => s.id === store.getState().activeSheet)?.name ?? null;
    return p ? rangeFormula({ sheet: name, r0: p.location.r0, c0: p.location.c0, r1: p.location.r0, c1: p.location.c0 }) : "";
  });
  const [picker, setPicker] = useState<Picker | null>(null);
  if (picker) return <PickBar store={store} picker={picker} onDone={() => setPicker(null)} />;
  const loc = parseLocation(store, location);
  return (
    <Dialog open title={t("calc.pivot.moveTitle")} onClose={close}>
      <form
        className="flex w-[24rem] flex-col gap-3 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (where === "existing" && !loc) return;
          close();
          void store.pivots.move(id, where === "new" ? { kind: "newSheet" } : loc!);
        }}
      >
        <label className="flex h-8 items-center gap-2">
          <input type="radio" name="pivot-move" checked={where === "new"} onChange={() => setWhere("new")} />
          {t("calc.pivot.newSheet")}
        </label>
        <label className="flex h-8 items-center gap-2">
          <input type="radio" name="pivot-move" checked={where === "existing"} onChange={() => setWhere("existing")} />
          {t("calc.pivot.existingSheet")}
        </label>
        {where === "existing" && <RangeField label={t("calc.pivot.location")} value={location} onChange={setLocation} onPick={(p) => setPicker({ ...p, set: setLocation })} />}
        <Buttons onCancel={close} ok={where === "new" || !!loc} />
      </form>
    </Dialog>
  );
}

/**
 * Change PivotTable Data Source. The core has no command for it: the
 * table is recreated at its place with the same fields (field indices are
 * source columns), then its name and options are restored.
 */
export function ChangeSourceDialog({ store, id }: { store: CalcStore; id: number }) {
  const t = useT();
  const close = useClose(store);
  const info = useInfo(store, id);
  const [text, setText] = useState<string | null>(null);
  const [picker, setPicker] = useState<Picker | null>(null);
  if (picker) return <PickBar store={store} picker={picker} onDone={() => setPicker(null)} />;
  if (!info) return null;
  const s = info.source;
  const initial = s.kind === "range" ? rangeFormula({ sheet: s.sheet, r0: s.r0, c0: s.c0, r1: s.r1, c1: s.c1 }) : s.name;
  const value = text ?? initial;
  const src = parseSource(store, value);
  return (
    <Dialog open title={t("calc.pivot.sourceTitle")} onClose={close}>
      <form
        className="flex w-[26rem] flex-col gap-3 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (!src) return;
          close();
          void changeSource(store, info, src);
        }}
      >
        <RangeField label={t("calc.pivot.tableRange")} value={value} onChange={setText} onPick={(p) => setPicker({ ...p, set: setText })} />
        <Buttons onCancel={close} ok={!!src} />
      </form>
    </Dialog>
  );
}

/** Change Data Source: one step; the fields follow by name (P8-35). */
async function changeSource(store: CalcStore, info: PivotInfo, source: PivotSourceSpec): Promise<void> {
  await store.applyChecked({ type: "changePivotSource", id: info.table.id, source });
}

/** Delete on a whole table: Excel asks first. */
export function DeletePivotDialog({ store, ids }: { store: CalcStore; ids: number[] }) {
  const t = useT();
  const close = useClose(store);
  return (
    <Dialog open title={t("calc.pivot.deleteTitle")} onClose={close}>
      <form
        className="flex w-80 flex-col gap-3 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          close();
          const r = store.selectionRange();
          void store.pivots.remove(ids, r);
        }}
      >
        <p>{t("calc.pivot.deleteConfirm", { count: ids.length })}</p>
        <Buttons onCancel={close} okLabel={t("cmd.delete")} />
      </form>
    </Dialog>
  );
}

/**
 * The filter dropdown of a pivot header (`Row Labels`, a field header) or
 * page cell: Select field (compact headers with several fields), Sort A to
 * Z / Z to A, Clear Filter From, search and the item check-list with
 * (Select All); a page field: (All) or one item, or several with Select
 * Multiple Items. OK → `updatePivot` hidden items / `setPageFilter`.
 */
export function PivotFilterPanel({ store, id, target, at }: { store: CalcStore; id: number; target: DropTarget; at: { x: number; y: number } }) {
  const t = useT();
  const close = useClose(store);
  const info = useInfo(store, id);
  const axisFields = info ? (target.kind === "axis" ? (target.axis === "rows" ? info.table.rows ?? [] : info.table.cols ?? []).map((a) => a.field) : [target.field]) : [];
  const [chosen, setChosen] = useState<number | null>(null);
  const field = chosen ?? axisFields[0] ?? null;
  const items = useItems(store, id, field);
  const [checked, setChecked] = useState<Set<number> | null>(null);
  const [search, setSearch] = useState("");
  const [multi, setMulti] = useState<boolean | null>(null);
  const [pos, setPos] = useState(at);
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => setChecked(null), [field]);
  useLayoutEffect(() => {
    const el = ref.current;
    const w = el?.offsetWidth ?? 0, h = el?.offsetHeight ?? 0;
    setPos({ x: Math.max(0, Math.min(at.x, window.innerWidth - w - 4)), y: Math.max(0, Math.min(at.y, window.innerHeight - h - 4)) });
  }, [at, items]);
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) closeRef.current();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, []);
  if (!info || field === null) return null;
  const page = target.kind === "page";
  const tbl = info.table;
  const pageField = page ? (tbl.filters ?? []).find((p) => p.field === field) : undefined;
  const isMulti = multi ?? (pageField?.selected?.kind === "items" && pageField.selected.items.length > 1);
  const cur = checked ?? new Set((items ?? []).filter((i) => i.checked).map((i) => i.index));
  const shown = items ? visibleItems(items, search) : [];
  const allShown = shown.length > 0 && shown.every((i) => cur.has(i.index));
  const someShown = shown.some((i) => cur.has(i.index));
  const name = info.fields[field]?.name ?? "";
  const axis = [...(tbl.rows ?? []), ...(tbl.cols ?? [])].find((a) => a.field === field);
  const run = (fn: () => unknown) => () => {
    close();
    void fn();
  };
  const sort = (descending: boolean) => run(() => {
    const p = updateAxisField(tbl, field, (a) => ({ ...a, sort: { kind: descending ? "descending" : "ascending" } }));
    return p && store.pivots.update(id, p);
  });
  // Page fields without Select Multiple Items: one item or (All).
  const single = page && !isMulti;
  const singleSel = pageField?.selected?.kind === "items" && pageField.selected.items.length === 1 ? pageField.selected.items[0]! : null;
  const [pick, setPick] = [checked && single ? ([...checked][0] ?? null) : singleSel, (i: number | null) => setChecked(new Set(i === null ? [] : [i]))];
  const okValue = (): (() => unknown) | null => {
    if (!items) return null;
    if (page) {
      if (single) return () => store.pivots.setPageFilter(id, field, pick === null ? null : [pick]);
      const sel = pageSelectionOf(items, cur);
      return sel === undefined ? null : () => store.pivots.setPageFilter(id, field, sel);
    }
    const hidden = hiddenItemsOf(items, cur, search);
    if (hidden === null) return null;
    return () => {
      const p = updateAxisField(tbl, field, (a) => {
        const out = { ...a };
        if (hidden.length) out.hiddenItems = hidden;
        else delete out.hiddenItems;
        return out;
      });
      return p && store.pivots.update(id, p);
    };
  };
  const ok = okValue();
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={t("calc.pivot.filterPanel", { field: name })}
      data-testid="pivot-filter-panel"
      className="fixed z-50 flex w-72 flex-col gap-1 rounded border border-ui-border bg-ui-panel p-1 text-sm text-ui-fg shadow-lg"
      style={{ left: pos.x, top: pos.y }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          close();
        }
      }}
    >
      {target.kind === "axis" && axisFields.length > 1 && (
        <label className="flex items-center gap-2 px-1">
          <span>{t("calc.pivot.selectField")}</span>
          <select className={`${FIELD} flex-1`} aria-label={t("calc.pivot.selectField")} value={field} onChange={(e) => setChosen(Number(e.target.value))}>
            {axisFields.map((f) => (
              <option key={f} value={f}>
                {info.fields[f]?.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {!page && (
        <>
          <button type="button" className={ITEM} onClick={sort(false)}>
            {t("calc.sortAsc")}
          </button>
          <button type="button" className={ITEM} onClick={sort(true)}>
            {t("calc.sortDesc")}
          </button>
          <div role="separator" className="my-0.5 border-t border-ui-border" />
          <button
            type="button"
            className={ITEM}
            disabled={!axis?.hiddenItems?.length}
            onClick={run(() => {
              const p = updateAxisField(tbl, field, (a) => (({ hiddenItems: _h, ...rest }) => rest)(a));
              return p && store.pivots.update(id, p);
            })}
          >
            {t("calc.filter.clearFrom", { col: name })}
          </button>
        </>
      )}
      <input type="search" className={`${FIELD} mx-1`} aria-label={t("calc.filter.search")} placeholder={t("calc.filter.search")} value={search} onChange={(e) => setSearch(e.target.value)} />
      <div role="group" aria-label={t("calc.filter.values")} className="mx-1 flex max-h-56 flex-col overflow-auto rounded border border-ui-border bg-ui-bg py-0.5">
        {items === null ? (
          <span className="px-2 py-1 text-ui-muted">{t("calc.filter.loading")}</span>
        ) : single ? (
          <>
            <label className="flex min-h-8 items-center gap-2 px-1">
              <input type="radio" name="pivot-page" checked={pick === null} onChange={() => setPick(null)} />
              {t("calc.pivot.all")}
            </label>
            {shown.map((i) => (
              <label key={i.index} className="flex min-h-8 items-center gap-2 px-1" data-testid="pivot-filter-item">
                <input type="radio" name="pivot-page" aria-label={i.label} checked={pick === i.index} onChange={() => setPick(i.index)} />
                <span className="flex-1 truncate">{i.label}</span>
              </label>
            ))}
          </>
        ) : (
          <>
            {shown.length > 0 && (
              <label className="flex min-h-8 items-center gap-2 px-1">
                <input
                  type="checkbox"
                  checked={allShown}
                  aria-checked={someShown && !allShown ? "mixed" : allShown}
                  ref={(el) => {
                    if (el) el.indeterminate = someShown && !allShown;
                  }}
                  onChange={() => {
                    const next = new Set(cur);
                    for (const i of shown) {
                      if (allShown) next.delete(i.index);
                      else next.add(i.index);
                    }
                    setChecked(next);
                  }}
                />
                {search.trim() ? t("calc.filter.selectAllResults") : t("calc.filter.selectAll")}
              </label>
            )}
            {shown.map((i) => (
              <label key={i.index} className={`flex min-h-8 items-center gap-2 px-1 ${i.hasData ? "" : "text-ui-muted"}`} data-testid="pivot-filter-item">
                <input
                  type="checkbox"
                  aria-label={i.label}
                  checked={cur.has(i.index)}
                  onChange={() => {
                    const next = new Set(cur);
                    if (next.has(i.index)) next.delete(i.index);
                    else next.add(i.index);
                    setChecked(next);
                  }}
                />
                <span className="flex-1 truncate">{i.label}</span>
              </label>
            ))}
          </>
        )}
      </div>
      {page && (
        <label className="flex min-h-8 items-center gap-2 px-2">
          <input type="checkbox" checked={isMulti} onChange={(e) => setMulti(e.target.checked)} />
          {t("calc.pivot.selectMultiple")}
        </label>
      )}
      <div className="flex justify-end gap-2 p-1">
        <button type="button" className={BTN} disabled={!ok} onClick={() => ok && run(ok)()}>
          {t("common.ok")}
        </button>
        <button type="button" className={BTN} onClick={close}>
          {t("common.cancel")}
        </button>
      </div>
    </div>
  );
}

/** The pivot dialogs of `CalcDialogs`. */
export function PivotDialog({ store, dialog }: { store: CalcStore; dialog: Extract<CalcDialog, { kind: `pivot${string}` }> }) {
  switch (dialog.kind) {
    case "pivotCreate":
      return <CreatePivotDialog store={store} />;
    case "pivotDelete":
      return <DeletePivotDialog store={store} ids={dialog.ids} />;
    case "pivotValueField":
      return <ValueFieldDialog store={store} id={dialog.id} index={dialog.index} />;
    case "pivotFieldSettings":
      return <FieldSettingsDialog store={store} id={dialog.id} field={dialog.field} />;
    case "pivotOptions":
      return <PivotOptionsDialog store={store} id={dialog.id} />;
    case "pivotMove":
      return <MovePivotDialog store={store} id={dialog.id} />;
    case "pivotSource":
      return <ChangeSourceDialog store={store} id={dialog.id} />;
    case "pivotFilter":
      return <PivotFilterPanel key={`${dialog.id}:${dialog.at.x}:${dialog.at.y}`} store={store} id={dialog.id} target={dialog.target} at={dialog.at} />;
  }
}
