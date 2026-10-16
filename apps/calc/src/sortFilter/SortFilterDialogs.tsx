// Sort and AutoFilter UI (P8-5): Excel's "expand the selection?" prompt,
// the Custom Sort dialog, the AutoFilter dropdown panel and its Custom
// AutoFilter / Top 10 dialogs. CalcDialogs renders them from the store's
// dialog state; the commands go through the store.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Dialog } from "@rusuite/ui-shared";
import type { CellKind } from "../generated/CellKind";
import type { Filter } from "../generated/Filter";
import type { FilterOp } from "../generated/FilterOp";
import type { FilterValue } from "../generated/FilterValue";
import type { SortKind } from "../generated/SortKind";
import type { Range } from "../grid/Selection";
import { useT } from "../i18n";
import type { CalcStore } from "../state/store";
import {
  ALL_OPS, checklistFilter, columnFilter, customFilter, customInitial, dynamicFilter, filterMenuKind, initialChecked, NUMBER_PRESETS,
  selectAllState, setAll, TEXT_PRESETS, toggleValue, top10Filter, visibleValues, type CustomFilterState, type CustomPreset,
} from "./filter";
import { duplicateColumns, moveLevel, nextLevel, type SortLevel } from "./sort";

const BTN = "h-8 rounded border border-ui-border bg-ui-bg px-3 text-sm hover:bg-ui-hover disabled:opacity-40";
const FIELD = "h-8 rounded border border-ui-border bg-ui-bg px-2 text-sm text-ui-fg";
const ITEM = "flex min-h-8 w-full items-center gap-2 rounded px-2 text-left text-sm hover:bg-ui-hover disabled:opacity-40";
/** The dropdown lists at most this many values (Excel: 10,000). */
export const MAX_LISTED = 10_000;

function useClose(store: CalcStore) {
  return () => {
    store.closeDialog();
    store.focusGrid();
  };
}

/** Excel's Sort Warning: sort the region around the selection, or only the selection. */
export function SortExpandDialog({ store }: { store: CalcStore }) {
  const t = useT();
  const close = useClose(store);
  const [expand, setExpand] = useState(true);
  return (
    <Dialog open title={t("calc.sort.warningTitle")} onClose={close}>
      <form
        className="flex w-96 flex-col gap-3 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          void store.continueSort(expand);
          if (store.getState().dialog === null) store.focusGrid();
        }}
      >
        <p>{t("calc.sort.warningText")}</p>
        <label className="flex items-center gap-2">
          <input type="radio" name="sort-expand" checked={expand} onChange={() => setExpand(true)} />
          {t("calc.sort.expand")}
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="sort-expand" checked={!expand} onChange={() => setExpand(false)} />
          {t("calc.sort.continue")}
        </label>
        <div className="flex justify-end gap-2">
          <button type="submit" className={BTN}>
            {t("calc.sort")}
          </button>
          <button type="button" className={BTN} onClick={close}>
            {t("common.cancel")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

const KINDS: SortKind[] = ["auto", "numbers", "text"];

/** Data › Sort: sort levels (column, kind, order), headers and case sensitivity → `sortRange`. */
export function CustomSortDialog({ store, range, hasHeader: guessed }: { store: CalcStore; range: Range; hasHeader: boolean }) {
  const t = useT();
  const close = useClose(store);
  const [levels, setLevels] = useState<SortLevel[]>(() => {
    const col = Math.max(range.c0, Math.min(range.c1, store.activeAnchor().col));
    return [{ col, ascending: true, kind: "auto" }];
  });
  const [current, setCurrent] = useState(0);
  const [hasHeader, setHasHeader] = useState(guessed);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const cols: number[] = [];
  for (let c = range.c0; c <= Math.min(range.c1, range.c0 + 999); c++) cols.push(c);
  const header = hasHeader ? range.r0 : null;
  const set = (i: number, p: Partial<SortLevel>) => setLevels((ls) => ls.map((l, k) => (k === i ? { ...l, ...p } : l)));
  const add = nextLevel(levels, range);
  const dup = new Set(duplicateColumns(levels));
  return (
    <Dialog open title={t("calc.sort")} onClose={close}>
      <form
        className="flex w-[34rem] max-w-full flex-col gap-3 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (dup.size > 0) return;
          close();
          void store.customSort(range, levels, hasHeader, caseSensitive);
        }}
      >
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            className={BTN}
            disabled={!add}
            onClick={() => {
              if (!add) return;
              setLevels((ls) => [...ls, add]);
              setCurrent(levels.length);
            }}
          >
            {t("calc.sort.addLevel")}
          </button>
          <button
            type="button"
            className={BTN}
            disabled={levels.length <= 1}
            onClick={() => {
              setLevels((ls) => ls.filter((_, k) => k !== current));
              setCurrent((c) => Math.max(0, Math.min(c, levels.length - 2)));
            }}
          >
            {t("calc.sort.deleteLevel")}
          </button>
          <button
            type="button"
            className={BTN}
            disabled={levels.length >= 64}
            onClick={() => {
              setLevels((ls) => [...ls.slice(0, current + 1), { ...ls[current]! }, ...ls.slice(current + 1)]);
              setCurrent(current + 1);
            }}
          >
            {t("calc.sort.copyLevel")}
          </button>
          <button
            type="button"
            className={BTN}
            aria-label={t("calc.sort.moveUp")}
            title={t("calc.sort.moveUp")}
            disabled={current === 0}
            onClick={() => {
              setLevels((ls) => moveLevel(ls, current, -1));
              setCurrent(current - 1);
            }}
          >
            ▲
          </button>
          <button
            type="button"
            className={BTN}
            aria-label={t("calc.sort.moveDown")}
            title={t("calc.sort.moveDown")}
            disabled={current >= levels.length - 1}
            onClick={() => {
              setLevels((ls) => moveLevel(ls, current, 1));
              setCurrent(current + 1);
            }}
          >
            ▼
          </button>
          <label className="ml-auto flex items-center gap-1">
            <input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} />
            {t("calc.sort.headers")}
          </label>
        </div>
        <div role="table" aria-label={t("calc.sort.levels")} className="flex max-h-64 flex-col gap-1 overflow-auto rounded border border-ui-border p-1">
          <div role="row" className="grid grid-cols-[5rem_1fr_7rem_10rem] gap-1 px-1 text-xs text-ui-muted">
            <span role="columnheader" />
            <span role="columnheader">{t("calc.sort.column")}</span>
            <span role="columnheader">{t("calc.sort.sortOn")}</span>
            <span role="columnheader">{t("calc.sort.order")}</span>
          </div>
          {levels.map((l, i) => {
            const numbers = l.kind === "numbers";
            return (
              <div
                key={i}
                role="row"
                aria-selected={i === current}
                data-testid="sort-level"
                className={`grid grid-cols-[5rem_1fr_7rem_10rem] items-center gap-1 rounded px-1 py-0.5 ${i === current ? "bg-ui-active" : ""}`}
                onPointerDown={() => setCurrent(i)}
                onFocus={() => setCurrent(i)}
              >
                <span role="cell">{i === 0 ? t("calc.sort.sortBy") : t("calc.sort.thenBy")}</span>
                <span role="cell">
                  <select
                    className={`${FIELD} w-full ${dup.has(l.col) ? "border-red-600" : ""}`}
                    aria-label={`${t("calc.sort.column")} ${i + 1}`}
                    value={String(l.col)}
                    onChange={(e) => set(i, { col: Number(e.target.value) })}
                  >
                    {cols.map((c) => (
                      <option key={c} value={String(c)}>
                        {store.columnLabel(c, header)}
                      </option>
                    ))}
                  </select>
                </span>
                <span role="cell">
                  <select
                    className={`${FIELD} w-full`}
                    aria-label={`${t("calc.sort.sortOn")} ${i + 1}`}
                    value={l.kind}
                    onChange={(e) => set(i, { kind: e.target.value as SortKind })}
                  >
                    {KINDS.map((k) => (
                      <option key={k} value={k}>
                        {t(`calc.sort.kind.${k}`)}
                      </option>
                    ))}
                  </select>
                </span>
                <span role="cell">
                  <select
                    className={`${FIELD} w-full`}
                    aria-label={`${t("calc.sort.order")} ${i + 1}`}
                    value={l.ascending ? "asc" : "desc"}
                    onChange={(e) => set(i, { ascending: e.target.value === "asc" })}
                  >
                    <option value="asc">{numbers ? t("calc.sort.smallest") : t("calc.sort.aToZ")}</option>
                    <option value="desc">{numbers ? t("calc.sort.largest") : t("calc.sort.zToA")}</option>
                  </select>
                </span>
              </div>
            );
          })}
        </div>
        {dup.size > 0 && (
          <p role="alert" className="text-xs text-red-700">
            {t("calc.sort.duplicate")}
          </p>
        )}
        <div className="flex items-center justify-between gap-2">
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={caseSensitive} onChange={(e) => setCaseSensitive(e.target.checked)} />
            {t("calc.sort.caseSensitive")}
          </label>
          <div className="flex gap-2">
            <button type="button" className={BTN} onClick={close}>
              {t("common.cancel")}
            </button>
            <button type="submit" className={BTN} disabled={dup.size > 0}>
              {t("common.ok")}
            </button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}

/** A checkbox whose third state ("some") shows as indeterminate. */
function TriCheckbox({ state, onChange, label }: { state: "all" | "none" | "some"; onChange: (on: boolean) => void; label: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === "some";
  }, [state]);
  return (
    <label className="flex min-h-8 items-center gap-2 px-1">
      <input ref={ref} type="checkbox" checked={state === "all"} aria-checked={state === "some" ? "mixed" : state === "all"} onChange={() => onChange(state !== "all")} />
      {label}
    </label>
  );
}

/** What a filter dropdown works on: the sheet's AutoFilter or a table's (P8-35). */
export function filterTarget(store: CalcStore, table?: number) {
  if (table === undefined) {
    return {
      af: store.autoFilter(),
      values: (col: number) => store.filterValues(col),
      set: (col: number, f: Filter | null) => store.setColumnFilter(col, f),
      sort: (col: number, asc: boolean) => store.sortFilterColumn(col, asc),
      kinds: (col: number) => store.filterColumnKinds(col),
    };
  }
  const af = store.tables.get(table)?.table.autoFilter ?? null;
  return {
    af,
    values: (col: number) => store.api.tableFilterValues(table, col).catch((e: unknown) => (store.pushError(e), [] as FilterValue[])),
    set: (col: number, f: Filter | null) => store.tables.setFilter(table, col, f),
    sort: (col: number, asc: boolean) => store.tables.sortColumn(table, col, asc),
    kinds: (col: number) => {
      const out: CellKind[] = [];
      if (!af) return out;
      for (const [r, row] of store.cache(store.getState().activeSheet).cells) {
        const c = r > af.r0 && r <= af.r1 ? row.get(col) : undefined;
        if (c) out.push(c.kind);
      }
      return out;
    },
  };
}

/**
 * The AutoFilter dropdown of column `col`: sort, clear, Text / Number
 * Filters, a search box and the value check-list (from `filterValues`)
 * with (Select All) and counts; OK → `setFilterColumn`.
 */
export function FilterPanel({ store, col, at, table }: { store: CalcStore; col: number; at: { x: number; y: number }; table?: number }) {
  const t = useT();
  const close = useClose(store);
  const target = filterTarget(store, table);
  const af = target.af;
  const current = columnFilter(af, col);
  const [values, setValues] = useState<FilterValue[] | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [submenu, setSubmenu] = useState(false);
  const [pos, setPos] = useState(at);
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    let live = true;
    void filterTarget(store, table).values(col).then((v) => {
      if (!live) return;
      setValues(v);
      setChecked(initialChecked(v, columnFilter(filterTarget(store, table).af, col)));
    });
    return () => {
      live = false;
    };
  }, [store, col, table]);

  useLayoutEffect(() => {
    const el = ref.current;
    const w = el?.offsetWidth ?? 0, h = el?.offsetHeight ?? 0;
    setPos({ x: Math.max(0, Math.min(at.x, window.innerWidth - w - 4)), y: Math.max(0, Math.min(at.y, window.innerHeight - h - 4)) });
  }, [at, values, submenu]);

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("button")?.focus();
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) closeRef.current();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, []);

  if (!af) return null;
  const name = store.columnLabel(col, af.r0);
  const kind = filterMenuKind(target.kinds(col));
  const presets = kind === "number" ? NUMBER_PRESETS : TEXT_PRESETS;
  const shown = values ? visibleValues(values, search) : [];
  const listed = shown.slice(0, MAX_LISTED);
  const result = values ? checklistFilter(values, checked, search) : undefined;
  const run = (fn: () => unknown) => () => {
    close();
    void fn();
  };
  const openCustom = (preset: CustomPreset) => store.openDialog({ kind: "customFilter", col, preset, ...(table !== undefined ? { table } : {}) });
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={t("calc.filter.panel", { col: name })}
      data-testid="filter-panel"
      className="fixed z-50 flex w-72 flex-col gap-1 rounded border border-ui-border bg-ui-panel p-1 text-sm text-ui-fg shadow-lg"
      style={{ left: pos.x, top: pos.y }}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          close();
        }
      }}
    >
      <button type="button" className={ITEM} onClick={run(() => target.sort(col, true))}>
        {t("calc.sortAsc")}
      </button>
      <button type="button" className={ITEM} onClick={run(() => target.sort(col, false))}>
        {t("calc.sortDesc")}
      </button>
      <div role="separator" className="my-0.5 border-t border-ui-border" />
      <button type="button" className={ITEM} disabled={!current} onClick={run(() => target.set(col, null))}>
        {t("calc.filter.clearFrom", { col: name })}
      </button>
      <button type="button" className={`${ITEM} justify-between`} aria-expanded={submenu} onClick={() => setSubmenu((s) => !s)}>
        <span>{kind === "number" ? t("calc.filter.numberFilters") : t("calc.filter.textFilters")}</span>
        <span aria-hidden="true">{submenu ? "▾" : "▸"}</span>
      </button>
      {submenu && (
        <div role="menu" aria-label={kind === "number" ? t("calc.filter.numberFilters") : t("calc.filter.textFilters")} className="ml-3 flex flex-col border-l border-ui-border pl-1">
          {presets.map((p) => (
            <button key={p} type="button" role="menuitem" className={ITEM} onClick={() => openCustom(p)}>
              {t(`calc.filter.preset.${p}`)}
            </button>
          ))}
          {kind === "number" && (
            <>
              <button type="button" role="menuitem" className={ITEM} onClick={() => store.openDialog({ kind: "top10", col, ...(table !== undefined ? { table } : {}) })}>
                {t("calc.filter.top10")}
              </button>
              <button type="button" role="menuitem" className={ITEM} onClick={run(() => target.set(col, dynamicFilter("aboveAverage")))}>
                {t("calc.filter.aboveAverage")}
              </button>
              <button type="button" role="menuitem" className={ITEM} onClick={run(() => target.set(col, dynamicFilter("belowAverage")))}>
                {t("calc.filter.belowAverage")}
              </button>
            </>
          )}
        </div>
      )}
      <input
        type="search"
        className={`${FIELD} mx-1`}
        aria-label={t("calc.filter.search")}
        placeholder={t("calc.filter.search")}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <div role="group" aria-label={t("calc.filter.values")} className="mx-1 flex max-h-56 flex-col overflow-auto rounded border border-ui-border bg-ui-bg py-0.5">
        {values === null ? (
          <span className="px-2 py-1 text-ui-muted">{t("calc.filter.loading")}</span>
        ) : (
          <>
            {shown.length > 0 && (
              <TriCheckbox
                state={selectAllState(shown, checked)}
                label={search.trim() ? t("calc.filter.selectAllResults") : t("calc.filter.selectAll")}
                onChange={(on) => setChecked(setAll(shown, checked, on))}
              />
            )}
            {listed.map((v) => (
              <label key={v.display} className="flex min-h-8 items-center gap-2 px-1" data-testid="filter-value">
                <input
                  type="checkbox"
                  aria-label={v.display === "" ? t("calc.filter.blanks") : v.display}
                  checked={checked.has(v.display)}
                  onChange={() => setChecked(toggleValue(checked, v.display))}
                />
                <span className="flex-1 truncate">{v.display === "" ? t("calc.filter.blanks") : v.display}</span>
                <span className="text-xs text-ui-muted">{v.count}</span>
              </label>
            ))}
            {shown.length > listed.length && <span className="px-2 py-1 text-xs text-ui-muted">{t("calc.filter.notAll")}</span>}
          </>
        )}
      </div>
      <div className="flex justify-end gap-2 p-1">
        <button
          type="button"
          className={BTN}
          disabled={result === undefined}
          onClick={() => {
            if (result === undefined) return;
            close();
            if (result !== null || current) void target.set(col, result);
          }}
        >
          {t("common.ok")}
        </button>
        <button type="button" className={BTN} onClick={close}>
          {t("common.cancel")}
        </button>
      </div>
    </div>
  );
}

/** Custom AutoFilter: two criteria (operator + value) joined by And / Or. */
export function CustomFilterDialog({ store, col, preset, table }: { store: CalcStore; col: number; preset: CustomPreset; table?: number }) {
  const t = useT();
  const close = useClose(store);
  const target = filterTarget(store, table);
  const af = target.af;
  const [s, setS] = useState<CustomFilterState>(() => customInitial(preset, columnFilter(af, col)));
  const [values, setValues] = useState<FilterValue[]>([]);
  useEffect(() => {
    let live = true;
    void filterTarget(store, table).values(col).then((v) => live && setValues(v));
    return () => {
      live = false;
    };
  }, [store, col, table]);
  const set = (p: Partial<CustomFilterState>) => setS((x) => ({ ...x, ...p }));
  const listId = `calc-filter-values-${col}`;
  const opSelect = (value: FilterOp | null, onChange: (op: FilterOp | null) => void, label: string, optional: boolean) => (
    <select className={`${FIELD} w-56`} aria-label={label} value={value ?? ""} onChange={(e) => onChange(e.target.value === "" ? null : (e.target.value as FilterOp))}>
      {optional && <option value="">{t("calc.filter.none")}</option>}
      {ALL_OPS.map((op) => (
        <option key={op} value={op}>
          {t(`calc.filter.op.${op}`)}
        </option>
      ))}
    </select>
  );
  const name = af ? store.columnLabel(col, af.r0) : "";
  const options = useMemo(() => values.filter((v) => v.display !== ""), [values]);
  return (
    <Dialog open title={t("calc.filter.customTitle")} onClose={close}>
      <form
        className="flex w-[30rem] max-w-full flex-col gap-2 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          close();
          void target.set(col, customFilter(s));
        }}
      >
        <p>{t("calc.filter.showRows", { col: name })}</p>
        <div className="flex gap-2">
          {opSelect(s.op1, (op) => op && set({ op1: op }), t("calc.filter.first"), false)}
          <input className={`${FIELD} flex-1`} aria-label={`${t("calc.filter.value")} 1`} list={listId} value={s.value1} onChange={(e) => set({ value1: e.target.value })} />
        </div>
        <div className="flex gap-4 pl-2">
          <label className="flex items-center gap-1">
            <input type="radio" name="filter-join" checked={s.and} onChange={() => set({ and: true })} />
            {t("calc.filter.and")}
          </label>
          <label className="flex items-center gap-1">
            <input type="radio" name="filter-join" checked={!s.and} onChange={() => set({ and: false })} />
            {t("calc.filter.or")}
          </label>
        </div>
        <div className="flex gap-2">
          {opSelect(s.op2, (op) => set({ op2: op }), t("calc.filter.second"), true)}
          <input
            className={`${FIELD} flex-1`}
            aria-label={`${t("calc.filter.value")} 2`}
            list={listId}
            disabled={s.op2 === null}
            value={s.value2}
            onChange={(e) => set({ value2: e.target.value })}
          />
        </div>
        <datalist id={listId}>
          {options.slice(0, 1000).map((v) => (
            <option key={v.display} value={v.display} />
          ))}
        </datalist>
        <p className="text-xs text-ui-muted">{t("calc.filter.wildcards")}</p>
        <div className="flex justify-end gap-2">
          <button type="button" className={BTN} onClick={close}>
            {t("common.cancel")}
          </button>
          <button type="submit" className={BTN}>
            {t("common.ok")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** Top 10 AutoFilter: top / bottom, a count, items / percent. */
export function Top10Dialog({ store, col, table }: { store: CalcStore; col: number; table?: number }) {
  const t = useT();
  const close = useClose(store);
  const [top, setTop] = useState(true);
  const [count, setCount] = useState("10");
  const [percent, setPercent] = useState(false);
  return (
    <Dialog open title={t("calc.filter.top10Title")} onClose={close}>
      <form
        className="flex w-80 flex-col gap-3 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          const f = top10Filter(top, percent, Number(count));
          if (!f) {
            store.pushError(new Error(t("calc.filter.top10Range")));
            return;
          }
          close();
          void filterTarget(store, table).set(col, f);
        }}
      >
        <div className="flex gap-2">
          <select className={FIELD} aria-label={t("calc.filter.top")} value={top ? "top" : "bottom"} onChange={(e) => setTop(e.target.value === "top")}>
            <option value="top">{t("calc.filter.top")}</option>
            <option value="bottom">{t("calc.filter.bottom")}</option>
          </select>
          <input
            type="number"
            className={`${FIELD} w-20`}
            aria-label={t("calc.filter.count")}
            value={count}
            onChange={(e) => setCount(e.target.value)}
          />
          <select className={FIELD} aria-label={t("calc.filter.items")} value={percent ? "percent" : "items"} onChange={(e) => setPercent(e.target.value === "percent")}>
            <option value="items">{t("calc.filter.items")}</option>
            <option value="percent">{t("calc.filter.percent")}</option>
          </select>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className={BTN} onClick={close}>
            {t("common.cancel")}
          </button>
          <button type="submit" className={BTN}>
            {t("common.ok")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
