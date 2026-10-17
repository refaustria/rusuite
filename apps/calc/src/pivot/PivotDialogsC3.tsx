// Pivot table dialogs of round 2 (P9-C3): Grouping (dates by levels,
// numbers by an interval), Calculated Field, Calculated Item, the label /
// date / value / Top 10 filters, More Sort Options, Show Report Filter
// Pages and Recommended PivotTables. Each OK sends one command.

import { useEffect, useState } from "react";
import { Dialog } from "@rusuite/ui-shared";
import type { DateGroupBy } from "../generated/DateGroupBy";
import type { DateOp } from "../generated/DateOp";
import type { LabelOp } from "../generated/LabelOp";
import type { PivotFilter } from "../generated/PivotFilter";
import type { PivotInfo } from "../generated/PivotInfo";
import type { PivotItemInfo } from "../generated/PivotItemInfo";
import type { PivotRecommendation } from "../generated/PivotRecommendation";
import type { TopBy } from "../generated/TopBy";
import type { ValueOp } from "../generated/ValueOp";
import { useT } from "../i18n";
import { useCalc, type CalcStore } from "../state/store";
import { DATE_LEVELS, DATE_OPS, filterPatch, isoToSerial, LABEL_OPS, serialToIso, sortPatch, twoValues, VALUE_OPS } from "./model";
import { defaultSource, parseSource } from "./PivotDialogs";

const BTN = "h-8 rounded border border-ui-border bg-ui-bg px-3 text-sm hover:bg-ui-hover disabled:opacity-40";
const FIELD = "h-8 rounded border border-ui-border bg-ui-bg px-2 text-sm text-ui-fg";

function useClose(store: CalcStore) {
  return () => {
    store.closeDialog();
    store.focusGrid();
  };
}

function useInfo(store: CalcStore, id: number): PivotInfo | null {
  useCalc(store, (s) => s.version);
  return store.pivots.info(id);
}

function useItems(store: CalcStore, id: number, field: number): PivotItemInfo[] | null {
  const [items, setItems] = useState<PivotItemInfo[] | null>(null);
  useEffect(() => {
    let live = true;
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

function OkCancel({ onCancel, ok = true }: { onCancel: () => void; ok?: boolean }) {
  const t = useT();
  return (
    <div className="flex justify-end gap-2">
      <button type="submit" className={BTN} disabled={!ok}>
        {t("common.ok")}
      </button>
      <button type="button" className={BTN} onClick={onCancel}>
        {t("common.cancel")}
      </button>
    </div>
  );
}

/** A field name as a formula names it (quoted when it is not a plain identifier). */
export function formulaName(name: string): string {
  return /^[A-Za-z_][A-Za-z0-9_.]*$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`;
}

// --- Grouping ---------------------------------------------------------------------------------------

/** The numbers among a field's items (raw values: the field is not grouped yet). */
function bounds(items: readonly PivotItemInfo[] | null): { lo: number; hi: number } | null {
  if (!items) return null;
  const nums = items.flatMap((i) => (i.value.t === "number" && i.hasData ? [i.value.v] : []));
  if (nums.length === 0) return null;
  return { lo: Math.min(...nums), hi: Math.max(...nums) };
}

/** Grouping: Auto / Starting at / Ending at, By (levels or an interval), Number of days. */
export function GroupDialog({ store, id, field }: { store: CalcStore; id: number; field: number }) {
  const t = useT();
  const close = useClose(store);
  const info = useInfo(store, id);
  const f = info?.fields[field];
  const g = f?.group;
  const items = useItems(store, id, field);
  const isDate = f?.kind === "date" || g?.kind === "date";
  const [autoStart, setAutoStart] = useState(true);
  const [autoEnd, setAutoEnd] = useState(true);
  const [start, setStart] = useState<string | null>(null);
  const [end, setEnd] = useState<string | null>(null);
  const [by, setBy] = useState<string | null>(null);
  const [levels, setLevels] = useState<DateGroupBy[] | null>(null);
  const [days, setDays] = useState<string>("1");
  if (!info || !f) return null;
  const b = g && g.kind !== "items" ? { lo: g.start, hi: g.end } : bounds(items);
  const show = (n: number | undefined) => (n === undefined ? "" : isDate ? serialToIso(Math.floor(n)) : String(n));
  const curStart = start ?? show(b?.lo);
  const curEnd = end ?? show(b?.hi);
  const curLevels = levels ?? (g?.kind === "date" ? [g.by] : ["months"]);
  const curBy = by ?? (g?.kind === "number" ? String(g.interval) : "10");
  const parse = (s: string) => (isDate ? isoToSerial(s) : s.trim() === "" ? null : Number(s));
  const s0 = autoStart ? null : parse(curStart);
  const e0 = autoEnd ? null : parse(curEnd);
  const interval = Number(curBy);
  const onlyDays = curLevels.length === 1 && curLevels[0] === "days";
  const ok =
    (autoStart || (s0 !== null && Number.isFinite(s0))) &&
    (autoEnd || (e0 !== null && Number.isFinite(e0))) &&
    (isDate ? curLevels.length > 0 && (!onlyDays || Number(days) >= 1) : interval > 0);
  return (
    <Dialog open title={t("calc.pivot.groupTitle")} onClose={close}>
      <form
        className="flex w-[22rem] flex-col gap-3 text-sm"
        data-testid="pivot-group-dialog"
        onSubmit={(e) => {
          e.preventDefault();
          if (!ok) return;
          close();
          const range = { ...(s0 !== null ? { start: s0 } : {}), ...(e0 !== null ? { end: e0 } : {}) };
          void store.pivots.group(
            id,
            field,
            isDate
              ? { kind: "date", by: curLevels, ...range, ...(onlyDays && Number(days) > 1 ? { days: Number(days) } : {}) }
              : { kind: "number", interval, ...range },
          );
        }}
      >
        <fieldset className="flex flex-col gap-1">
          <legend className="font-medium">{t("calc.pivot.auto")}</legend>
          {(
            [
              ["start", autoStart, setAutoStart, curStart, setStart],
              ["end", autoEnd, setAutoEnd, curEnd, setEnd],
            ] as const
          ).map(([k, auto, setAuto, value, setValue]) => (
            <div key={k} className="flex h-8 items-center gap-2">
              <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} aria-label={t(`calc.pivot.auto.${k}`)} />
              <span className="w-24">{t(`calc.pivot.${k}At`)}</span>
              <input className={`${FIELD} flex-1`} aria-label={t(`calc.pivot.${k}At`)} disabled={auto} value={value} onChange={(e) => setValue(e.target.value)} />
            </div>
          ))}
        </fieldset>
        {isDate ? (
          <>
            <div className="flex flex-col gap-1">
              <span>{t("calc.pivot.groupBy")}</span>
              <div role="listbox" aria-multiselectable="true" aria-label={t("calc.pivot.groupBy")} className="flex flex-col rounded border border-ui-border bg-ui-bg py-1">
                {DATE_LEVELS.map((l) => (
                  <button
                    key={l}
                    type="button"
                    role="option"
                    aria-selected={curLevels.includes(l)}
                    className={`h-7 px-2 text-left ${curLevels.includes(l) ? "bg-ui-active" : "hover:bg-ui-hover"}`}
                    onClick={() => setLevels(curLevels.includes(l) ? curLevels.filter((x) => x !== l) : [...curLevels, l])}
                  >
                    {t(`calc.pivot.level.${l}`)}
                  </button>
                ))}
              </div>
            </div>
            <label className="flex items-center gap-2">
              <span className="w-32">{t("calc.pivot.days")}</span>
              <input className={`${FIELD} w-20`} type="number" min={1} aria-label={t("calc.pivot.days")} disabled={!onlyDays} value={days} onChange={(e) => setDays(e.target.value)} />
            </label>
          </>
        ) : (
          <label className="flex items-center gap-2">
            <span className="w-24">{t("calc.pivot.groupBy")}</span>
            <input className={`${FIELD} flex-1`} aria-label={t("calc.pivot.groupBy")} value={curBy} onChange={(e) => setBy(e.target.value)} />
          </label>
        )}
        <OkCancel onCancel={close} ok={ok} />
      </form>
    </Dialog>
  );
}

// --- Calculated fields and items ------------------------------------------------------------------

/**
 * Calculated Field / Item: Name (an existing one is modified or deleted),
 * Formula, the list to insert names from; Add / Modify, Delete, OK, Close.
 */
function CalcDialog({
  title, names, existing, onSave, onDelete, onClose, testId,
}: {
  title: string;
  /** What the formula can name (fields or items). */
  names: string[];
  /** The existing calculated fields / items: name, formula, key. */
  existing: { name: string; formula: string; key: number }[];
  onSave: (key: number | null, name: string, formula: string) => Promise<void>;
  onDelete: (key: number) => Promise<void>;
  onClose: () => void;
  testId: string;
}) {
  const t = useT();
  const [name, setName] = useState(existing.length ? "" : `${t("calc.pivot.calcDefaultName")}1`);
  const [formula, setFormula] = useState("= 0");
  const [pick, setPick] = useState<string | null>(null);
  const hit = existing.find((e) => e.name.toLowerCase() === name.trim().toLowerCase());
  const valid = name.trim() !== "" && formula.replace(/^=/, "").trim() !== "";
  const save = async () => {
    if (!valid) return;
    await onSave(hit?.key ?? null, name.trim(), formula.trim().replace(/^=\s*/, ""));
  };
  return (
    <Dialog open title={title} onClose={onClose}>
      <form
        className="flex w-[28rem] flex-col gap-3 text-sm"
        data-testid={testId}
        onSubmit={(e) => {
          e.preventDefault();
          void save().then(onClose);
        }}
      >
        <label className="flex items-center gap-2">
          <span className="w-20">{t("calc.pivot.calcName")}</span>
          <input
            className={`${FIELD} flex-1`}
            aria-label={t("calc.pivot.calcName")}
            list={`${testId}-names`}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              const ex = existing.find((x) => x.name.toLowerCase() === e.target.value.trim().toLowerCase());
              if (ex) setFormula(`=${ex.formula}`);
            }}
          />
          <datalist id={`${testId}-names`}>
            {existing.map((e) => (
              <option key={e.key} value={e.name} />
            ))}
          </datalist>
        </label>
        <label className="flex items-center gap-2">
          <span className="w-20">{t("calc.pivot.calcFormula")}</span>
          <input className={`${FIELD} flex-1`} aria-label={t("calc.pivot.calcFormula")} value={formula} onChange={(e) => setFormula(e.target.value)} />
        </label>
        <div className="flex gap-2">
          <div role="listbox" aria-label={t("calc.pivot.calcNames")} className="flex h-36 flex-1 flex-col overflow-auto rounded border border-ui-border bg-ui-bg py-1">
            {names.map((n) => (
              <button
                key={n}
                type="button"
                role="option"
                aria-selected={pick === n}
                className={`h-7 px-2 text-left ${pick === n ? "bg-ui-active" : "hover:bg-ui-hover"}`}
                onClick={() => setPick(n)}
                onDoubleClick={() => setFormula(`${formula.replace(/^= 0$/, "=")}${formulaName(n)}`)}
              >
                {n}
              </button>
            ))}
          </div>
          <div className="flex flex-col gap-2">
            <button type="button" className={BTN} disabled={pick === null} onClick={() => pick !== null && setFormula(`${formula.replace(/^= 0$/, "=")}${formulaName(pick)}`)}>
              {t("calc.pivot.calcInsert")}
            </button>
            <button type="button" className={BTN} disabled={!valid} onClick={() => void save()}>
              {t(hit ? "calc.pivot.calcModify" : "calc.pivot.calcAdd")}
            </button>
            <button
              type="button"
              className={BTN}
              disabled={!hit}
              onClick={() => {
                if (!hit) return;
                void onDelete(hit.key);
                setName("");
                setFormula("= 0");
              }}
            >
              {t("cmd.delete")}
            </button>
          </div>
        </div>
        <OkCancel onCancel={onClose} ok={valid} />
      </form>
    </Dialog>
  );
}

/** Fields, Items & Sets › Calculated Field. */
export function CalcFieldDialog({ store, id }: { store: CalcStore; id: number }) {
  const t = useT();
  const close = useClose(store);
  const info = useInfo(store, id);
  if (!info) return null;
  const run = (cmd: Parameters<CalcStore["applyChecked"]>[0]) => store.applyChecked(cmd).then(() => undefined);
  return (
    <CalcDialog
      title={t("calc.pivot.calcFieldTitle")}
      testId="pivot-calc-field"
      names={info.fields.filter((f) => !f.group || f.group.base === f.index).map((f) => f.name)}
      existing={info.fields.flatMap((f) => (f.formula !== undefined ? [{ name: f.name, formula: f.formula, key: f.index }] : []))}
      onSave={(key, name, formula) => run(key === null ? { type: "setCalculatedField", id, name, formula } : { type: "setCalculatedField", id, field: key, name, formula })}
      onDelete={(key) => run({ type: "setCalculatedField", id, field: key, name: "" })}
      onClose={close}
    />
  );
}

/** Fields, Items & Sets › Calculated Item of the active field. */
export function CalcItemDialog({ store, id, field }: { store: CalcStore; id: number; field: number }) {
  const t = useT();
  const close = useClose(store);
  const info = useInfo(store, id);
  const items = useItems(store, id, field);
  if (!info || !items) return null;
  const run = (cmd: Parameters<CalcStore["applyChecked"]>[0]) => store.applyChecked(cmd).then(() => undefined);
  const name = info.fields[field]?.name ?? "";
  return (
    <CalcDialog
      title={t("calc.pivot.calcItemTitle", { field: name })}
      testId="pivot-calc-item"
      names={items.filter((i) => !i.calculated).map((i) => i.label)}
      existing={(info.calculatedItems ?? []).filter((c) => c.field === field).map((c) => ({ name: c.name, formula: c.formula, key: c.item }))}
      onSave={(key, n, formula) => run(key === null ? { type: "setCalculatedItem", id, field, name: n, formula } : { type: "setCalculatedItem", id, field, item: key, name: n, formula })}
      onDelete={(key) => run({ type: "setCalculatedItem", id, field, item: key, name: "" })}
      onClose={close}
    />
  );
}

// --- filters ----------------------------------------------------------------------------------------

/** The dialog's values of the field's current filter when it is of kind `rule`. */
function initialValues(cur: PivotFilter | undefined, rule: "label" | "date" | "value" | "top"): [string, string] {
  if (!cur || cur.kind !== rule) return [rule === "top" ? "10" : "", ""];
  switch (cur.kind) {
    case "label":
      return [cur.value, cur.value2 ?? ""];
    case "date":
      return [serialToIso(cur.value), cur.value2 ? serialToIso(cur.value2) : ""];
    case "value":
      return [String(cur.value), cur.value2 !== undefined ? String(cur.value2) : ""];
    case "top":
      return [String(cur.count), ""];
  }
}

/** Label / Date / Value Filter and Top 10 Filter of a row or column field. */
export function FilterRuleDialog({ store, id, field, rule, op: initial }: { store: CalcStore; id: number; field: number; rule: "label" | "date" | "value" | "top"; op: string }) {
  const t = useT();
  const close = useClose(store);
  const info = useInfo(store, id);
  const [op, setOp] = useState(initial);
  const [v1, setV1] = useState<string | null>(null);
  const [v2, setV2] = useState<string | null>(null);
  const [data, setData] = useState(0);
  const [bottom, setBottom] = useState(false);
  const [by, setBy] = useState<TopBy>("items");
  if (!info) return null;
  const tbl = info.table;
  const axis = [...(tbl.rows ?? []), ...(tbl.cols ?? [])].find((a) => a.field === field);
  const cur = axis?.filter;
  const name = info.fields[field]?.name ?? "";
  const captions = info.captions;
  const [init1, init2] = initialValues(cur, rule);
  const val1 = v1 ?? init1;
  const val2 = v2 ?? init2;
  const two = twoValues(op);
  const num = (s: string) => (s.trim() === "" ? NaN : Number(s));
  const build = (): PivotFilter | null => {
    switch (rule) {
      case "label":
        return val1 === "" ? null : { kind: "label", op: op as LabelOp, value: val1, ...(two ? { value2: val2 } : {}) };
      case "date": {
        const a = isoToSerial(val1);
        const b = two ? isoToSerial(val2) : 0;
        return a === null || b === null ? null : { kind: "date", op: op as DateOp, value: a, value2: b };
      }
      case "value": {
        const a = num(val1);
        const b = two ? num(val2) : 0;
        return Number.isFinite(a) && Number.isFinite(b) ? { kind: "value", op: op as ValueOp, data, value: a, value2: b } : null;
      }
      case "top": {
        const n = num(val1);
        return n > 0 ? { kind: "top", data, bottom, count: n, by } : null;
      }
    }
  };
  const filter = build();
  const title = t(`calc.pivot.ruleTitle.${rule}`, { field: name });
  const ops = rule === "label" ? LABEL_OPS : rule === "date" ? DATE_OPS : VALUE_OPS;
  const opPrefix = rule === "label" ? "labelOp" : rule === "date" ? "dateOp" : "valueOp";
  const dataSelect = (
    <select className={FIELD} aria-label={t("calc.pivot.byField")} value={data} onChange={(e) => setData(Number(e.target.value))}>
      {captions.map((c, i) => (
        <option key={c} value={i}>
          {c}
        </option>
      ))}
    </select>
  );
  return (
    <Dialog open title={title} onClose={close}>
      <form
        className="flex w-[30rem] flex-col gap-3 text-sm"
        data-testid="pivot-filter-rule"
        onSubmit={(e) => {
          e.preventDefault();
          if (!filter) return;
          close();
          const p = filterPatch(tbl, field, filter);
          if (p) void store.pivots.update(id, p);
        }}
      >
        <p>{t(rule === "top" ? "calc.pivot.ruleShowTop" : rule === "value" ? "calc.pivot.ruleShowValue" : "calc.pivot.ruleShowLabel")}</p>
        {rule === "top" ? (
          <div className="flex items-center gap-2">
            <select className={FIELD} aria-label={t("calc.pivot.topOrBottom")} value={bottom ? "bottom" : "top"} onChange={(e) => setBottom(e.target.value === "bottom")}>
              <option value="top">{t("calc.pivot.top")}</option>
              <option value="bottom">{t("calc.pivot.bottom")}</option>
            </select>
            <input className={`${FIELD} w-16`} aria-label={t("calc.pivot.topCount")} value={val1} onChange={(e) => setV1(e.target.value)} />
            <select className={FIELD} aria-label={t("calc.pivot.topBy")} value={by} onChange={(e) => setBy(e.target.value as TopBy)}>
              {(["items", "percent", "sum"] as const).map((k) => (
                <option key={k} value={k}>
                  {t(`calc.pivot.topBy.${k}`)}
                </option>
              ))}
            </select>
            <span>{t("calc.pivot.by")}</span>
            {dataSelect}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {rule === "value" && dataSelect}
            <select className={FIELD} aria-label={t("calc.pivot.ruleOp")} value={op} onChange={(e) => setOp(e.target.value)}>
              {ops.map((o) => (
                <option key={o} value={o}>
                  {t(`calc.pivot.${opPrefix}.${o}`)}
                </option>
              ))}
            </select>
            <input className={`${FIELD} w-32`} aria-label={t("calc.pivot.ruleValue")} placeholder={rule === "date" ? "yyyy-mm-dd" : ""} value={val1} onChange={(e) => setV1(e.target.value)} />
            {two && (
              <>
                <span>{t("calc.pivot.and")}</span>
                <input className={`${FIELD} w-32`} aria-label={t("calc.pivot.ruleValue2")} placeholder={rule === "date" ? "yyyy-mm-dd" : ""} value={val2} onChange={(e) => setV2(e.target.value)} />
              </>
            )}
          </div>
        )}
        {rule === "label" && <p className="text-xs text-ui-muted">{t("calc.pivot.wildcards")}</p>}
        <OkCancel onCancel={close} ok={!!filter} />
      </form>
    </Dialog>
  );
}

/** More Sort Options: Manual, Ascending / Descending by the labels or by a value field. */
export function SortDialog({ store, id, field }: { store: CalcStore; id: number; field: number }) {
  const t = useT();
  const close = useClose(store);
  const info = useInfo(store, id);
  const axis = info ? [...(info.table.rows ?? []), ...(info.table.cols ?? [])].find((a) => a.field === field) : undefined;
  const sort = axis?.sort ?? { kind: "ascending" as const };
  const [mode, setMode] = useState<"manual" | "ascending" | "descending" | null>(null);
  const [by, setBy] = useState<number | null | undefined>(undefined);
  if (!info) return null;
  const name = info.fields[field]?.name ?? "";
  const curMode = mode ?? (sort.kind === "byValue" ? (sort.descending ? "descending" : "ascending") : sort.kind);
  const curBy = by === undefined ? (sort.kind === "byValue" ? sort.data : null) : by;
  const byField = (m: "ascending" | "descending") => (
    <select
      className={`${FIELD} ml-6`}
      aria-label={t(m === "ascending" ? "calc.pivot.sortAscField" : "calc.pivot.sortDescField")}
      disabled={curMode !== m}
      value={curBy === null ? "label" : String(curBy)}
      onChange={(e) => setBy(e.target.value === "label" ? null : Number(e.target.value))}
    >
      <option value="label">{name}</option>
      {info.captions.map((c, i) => (
        <option key={c} value={i}>
          {c}
        </option>
      ))}
    </select>
  );
  return (
    <Dialog open title={t("calc.pivot.sortTitle", { field: name })} onClose={close}>
      <form
        className="flex w-[22rem] flex-col gap-2 text-sm"
        data-testid="pivot-sort-dialog"
        onSubmit={(e) => {
          e.preventDefault();
          close();
          const p = sortPatch(info.table, field, curMode, curMode === "manual" ? null : curBy);
          if (p) void store.pivots.update(id, p);
        }}
      >
        <label className="flex h-8 items-center gap-2">
          <input type="radio" name="pivot-sort" checked={curMode === "manual"} onChange={() => setMode("manual")} />
          {t("calc.pivot.sortManual")}
        </label>
        <label className="flex h-8 items-center gap-2">
          <input type="radio" name="pivot-sort" checked={curMode === "ascending"} onChange={() => setMode("ascending")} />
          {t("calc.pivot.sortAscBy")}
        </label>
        {byField("ascending")}
        <label className="flex h-8 items-center gap-2">
          <input type="radio" name="pivot-sort" checked={curMode === "descending"} onChange={() => setMode("descending")} />
          {t("calc.pivot.sortDescBy")}
        </label>
        {byField("descending")}
        <OkCancel onCancel={close} />
      </form>
    </Dialog>
  );
}

// --- tools ------------------------------------------------------------------------------------------

/** Show Report Filter Pages: one sheet per item of the chosen report filter field. */
export function FilterPagesDialog({ store, id }: { store: CalcStore; id: number }) {
  const t = useT();
  const close = useClose(store);
  const info = useInfo(store, id);
  const pages = info?.table.filters ?? [];
  const [field, setField] = useState<number | null>(null);
  if (!info) return null;
  const cur = field ?? pages[0]?.field ?? null;
  return (
    <Dialog open title={t("calc.pivot.filterPagesTitle")} onClose={close}>
      <form
        className="flex w-72 flex-col gap-3 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (cur === null) return;
          close();
          void store.pivots.filterPages(id, cur);
        }}
      >
        <span>{t("calc.pivot.filterPagesShow")}</span>
        <div role="listbox" aria-label={t("calc.pivot.filterPagesShow")} className="flex flex-col rounded border border-ui-border bg-ui-bg py-1">
          {pages.map((p) => (
            <button
              key={p.field}
              type="button"
              role="option"
              aria-selected={cur === p.field}
              className={`h-7 px-2 text-left ${cur === p.field ? "bg-ui-active" : "hover:bg-ui-hover"}`}
              onClick={() => setField(p.field)}
            >
              {info.fields[p.field]?.name}
            </button>
          ))}
        </div>
        <OkCancel onCancel={close} ok={cur !== null} />
      </form>
    </Dialog>
  );
}

/**
 * Insert › Recommended PivotTables: the core's candidates for the current
 * region (best first) with a preview; OK creates the chosen one on a new
 * sheet.
 */
export function RecommendedDialog({ store }: { store: CalcStore }) {
  const t = useT();
  const close = useClose(store);
  const [list, setList] = useState<PivotRecommendation[] | null>(null);
  const [pick, setPick] = useState(0);
  const [text] = useState(() => defaultSource(store));
  const source = parseSource(store, text);
  useEffect(() => {
    let live = true;
    if (!source) {
      setList([]);
      return;
    }
    store.api.recommendPivots(source).then(
      (v) => live && setList(v),
      (e: unknown) => {
        store.pushError(e);
        if (live) setList([]);
      },
    );
    return () => {
      live = false;
    };
    // The source is fixed while the dialog is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, text]);
  const chosen = list?.[pick];
  return (
    <Dialog open title={t("calc.pivot.recommendedTitle")} onClose={close}>
      <form
        className="flex w-[40rem] flex-col gap-3 text-sm"
        data-testid="pivot-recommended"
        onSubmit={(e) => {
          e.preventDefault();
          if (!chosen || !source) return;
          close();
          void store.pivots.create(source, { kind: "newSheet" }, chosen.fields);
        }}
      >
        {list === null ? (
          <p>{t("calc.filter.loading")}</p>
        ) : list.length === 0 ? (
          <p>{t("calc.pivot.recommendedNone")}</p>
        ) : (
          <div className="flex h-80 gap-3">
            <div role="listbox" aria-label={t("calc.pivot.recommendedTitle")} className="flex w-56 flex-col gap-1 overflow-auto">
              {list.map((r, i) => (
                <button
                  key={r.title}
                  type="button"
                  role="option"
                  aria-selected={pick === i}
                  className={`rounded border px-2 py-1 text-left ${pick === i ? "border-[#217346] bg-ui-active" : "border-ui-border hover:bg-ui-hover"}`}
                  onClick={() => setPick(i)}
                  onDoubleClick={() => {
                    if (!source) return;
                    close();
                    void store.pivots.create(source, { kind: "newSheet" }, r.fields);
                  }}
                >
                  {r.title}
                </button>
              ))}
            </div>
            {chosen && (
              <div className="flex-1 overflow-auto rounded border border-ui-border bg-ui-bg p-2" data-testid="pivot-recommended-preview">
                <div className="mb-1 font-medium">{chosen.title}</div>
                <table className="text-xs">
                  <tbody>
                    {chosen.preview.map((row, r) => (
                      <tr key={r} className={r === 0 ? "font-semibold" : ""}>
                        {row.map((c, k) => (
                          <td key={k} className={`px-1 ${k > 0 ? "text-right" : ""}`}>
                            {c}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
        <OkCancel onCancel={close} ok={!!chosen} />
      </form>
    </Dialog>
  );
}
