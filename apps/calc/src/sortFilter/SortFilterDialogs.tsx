// Sort and AutoFilter UI (P8-5): Excel's "expand the selection?" prompt,
// the Custom Sort dialog, the AutoFilter dropdown panel and its Custom
// AutoFilter / Top 10 dialogs. CalcDialogs renders them from the store's
// dialog state; the commands go through the store.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Dialog, type Color } from "@rusuite/ui-shared";
import { colorCss } from "../grid/style";
import type { CellKind } from "../generated/CellKind";
import type { Filter } from "../generated/Filter";
import type { FilterOp } from "../generated/FilterOp";
import type { FilterValue } from "../generated/FilterValue";
import type { IconSetKind } from "../generated/IconSetKind";
import type { LineColors } from "../generated/LineColors";
import type { SortKind } from "../generated/SortKind";
import type { SortOn } from "../generated/SortOn";
import type { Range } from "../grid/Selection";
import { useT } from "../i18n";
import type { CalcStore } from "../state/store";
import {
  ALL_OPS, checklistFilter, columnFilter, customFilter, customInitial, dateTree, dateTreeFilter, dynamicFilter, filterMenuKind, initialDateChecked,
  NUMBER_PRESETS, selectAllState, setAll, TEXT_PRESETS, toggleValue, top10Filter, visibleValues, type CustomFilterState, type CustomPreset, type DateNode,
} from "./filter";
import { BUILTIN_LISTS, duplicateColumns, moveLevel, nextLevel, parseCustomList, type SortLevel } from "./sort";

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
/** The Sort On choices: value kinds, then Excel's Cell Color / Font Color / Conditional Formatting Icon. */
type SortOnChoice = SortKind | "cellColor" | "fontColor" | "icon";
const SORT_ON: SortOnChoice[] = [...KINDS, "cellColor", "fontColor", "icon"];

const sortOnChoice = (l: SortLevel): SortOnChoice => (l.sortOn && l.sortOn.type !== "values" ? l.sortOn.type : l.kind);
const colorKey = (c: Color | null | undefined) => JSON.stringify(c ?? null);

/** A colour as an option label: its hex code, or Excel's "No Cell Color" / "Automatic". */
function colorLabel(t: ReturnType<typeof useT>, c: Color | null | undefined, font: boolean): string {
  if (!c) return font ? t("calc.sort.automatic") : t("calc.sort.noCellColor");
  return colorCss(c) ?? t("calc.sort.automatic");
}

/** Order › Custom List…: Excel's Custom Lists dialog (built-in lists, this session's lists, NEW LIST). */
export function CustomListsDialog({ store, initial, onOk, onCancel }: { store: CalcStore; initial?: string[]; onOk: (list: string[]) => void; onCancel: () => void }) {
  const t = useT();
  const lists = [...BUILTIN_LISTS, ...store.customLists];
  const start = initial ? lists.findIndex((l) => l.join(",") === initial.join(",")) : 0;
  const [index, setIndex] = useState(start); // -1: NEW LIST
  const [text, setText] = useState("");
  const chosen = index >= 0 ? lists[index] : parseCustomList(text);
  return (
    <Dialog open title={t("calc.sort.customLists")} onClose={onCancel}>
      <form
        className="flex w-[30rem] max-w-full flex-col gap-3 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (!chosen || chosen.length === 0) return;
          if (index < 0) store.customLists.push(chosen);
          onOk(chosen);
        }}
      >
        <div className="flex gap-3">
          <div role="listbox" aria-label={t("calc.sort.customLists")} className="flex h-48 w-56 flex-col overflow-auto rounded border border-ui-border bg-ui-bg py-0.5">
            <div role="option" tabIndex={0} aria-selected={index < 0} className="cursor-default truncate px-2 leading-6 aria-selected:bg-ui-active" onClick={() => setIndex(-1)}>
              {t("calc.sort.newList")}
            </div>
            {lists.map((l, i) => (
              <div key={i} role="option" tabIndex={0} aria-selected={i === index} className="cursor-default truncate px-2 leading-6 aria-selected:bg-ui-active" onClick={() => setIndex(i)}>
                {l.join(", ")}
              </div>
            ))}
          </div>
          <label className="flex flex-1 flex-col gap-1">
            {t("calc.sort.listEntries")}
            <textarea
              className={`${FIELD} h-40 py-1`}
              aria-label={t("calc.sort.listEntries")}
              readOnly={index >= 0}
              value={index >= 0 ? (lists[index] ?? []).join("\n") : text}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
        </div>
        <div className="flex justify-end gap-2">
          <button type="submit" className={BTN} disabled={!chosen || chosen.length === 0}>
            {t("common.ok")}
          </button>
          <button type="button" className={BTN} onClick={onCancel}>
            {t("common.cancel")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** Data › Sort: sort levels (column, sort on, order), headers, Options (case, orientation) → `sortRange`. */
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
  const [columns, setColumns] = useState(false);
  const [options, setOptions] = useState(false);
  const [listFor, setListFor] = useState<number | null>(null);
  const [colors, setColors] = useState<Map<number, LineColors>>(new Map());
  // Left to right: the keys are rows.
  const lines: number[] = [];
  const [l0, l1] = columns ? [range.r0, range.r1] : [range.c0, range.c1];
  for (let c = l0; c <= Math.min(l1, l0 + 999); c++) lines.push(c);
  const header = hasHeader && !columns ? range.r0 : null;
  const set = (i: number, p: Partial<SortLevel>) => setLevels((ls) => ls.map((l, k) => (k === i ? { ...l, ...p } : l)));
  const add = columns ? (levels.length < 64 ? { col: l0, ascending: true, kind: "auto" as SortKind } : null) : nextLevel(levels, range);
  const dup = new Set(duplicateColumns(levels));
  const lineColors = (line: number) => {
    if (colors.has(line)) return;
    const data = hasHeader && !columns ? { ...range, r0: Math.min(range.r1, range.r0 + 1) } : range;
    void store.lineColors(data, line, columns).then((c) => setColors((m) => new Map(m).set(line, c)));
  };
  useEffect(() => {
    for (const l of levels) if (l.sortOn && l.sortOn.type !== "values") lineColors(l.col);
  });
  const lineLabel = (c: number) => (columns ? t("calc.sort.rowN", { row: c + 1 }) : store.columnLabel(c, header));
  /** A colour / icon level's choice from the line's colours. */
  const firstChoice = (line: number, choice: "cellColor" | "fontColor" | "icon"): SortOn => {
    const c = colors.get(line);
    if (choice === "icon") {
      const [set, icon] = c?.icons[0] ?? ["3TrafficLights1", 0];
      return { type: "icon", set, icon };
    }
    const color = (choice === "cellColor" ? c?.fills : c?.fonts)?.find((x) => x) ?? null;
    return { type: choice, ...(color ? { color } : {}) };
  };
  return (
    <>
      <Dialog open={listFor === null} title={t("calc.sort")} onClose={close}>
        <form
          className="flex w-[40rem] max-w-full flex-col gap-3 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            if (dup.size > 0) return;
            close();
            void store.customSort(range, levels, hasHeader, caseSensitive, columns);
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
            <button type="button" className={BTN} aria-expanded={options} onClick={() => setOptions((o) => !o)}>
              {t("calc.sort.options")}
            </button>
            <label className="ml-auto flex items-center gap-1">
              <input type="checkbox" checked={hasHeader && !columns} disabled={columns} onChange={(e) => setHasHeader(e.target.checked)} />
              {t("calc.sort.headers")}
            </label>
          </div>
          {options && (
            <fieldset className="flex flex-wrap items-center gap-4 rounded border border-ui-border p-2" aria-label={t("calc.sort.optionsTitle")}>
              <label className="flex items-center gap-1">
                <input type="checkbox" checked={caseSensitive} onChange={(e) => setCaseSensitive(e.target.checked)} />
                {t("calc.sort.caseSensitive")}
              </label>
              <span role="radiogroup" aria-label={t("calc.sort.orientation")} className="flex items-center gap-3">
                <span>{t("calc.sort.orientation")}</span>
                {([false, true] as const).map((lr) => (
                  <label key={String(lr)} className="flex items-center gap-1">
                    <input
                      type="radio"
                      name="sort-orientation"
                      checked={columns === lr}
                      onChange={() => {
                        setColumns(lr);
                        const first = lr ? range.r0 : Math.max(range.c0, Math.min(range.c1, store.activeAnchor().col));
                        setLevels([{ col: first, ascending: true, kind: "auto" }]);
                        setCurrent(0);
                      }}
                    />
                    {t(lr ? "calc.sort.leftToRight" : "calc.sort.topToBottom")}
                  </label>
                ))}
              </span>
            </fieldset>
          )}
          <div role="table" aria-label={t("calc.sort.levels")} className="flex max-h-64 flex-col gap-1 overflow-auto rounded border border-ui-border p-1">
            <div role="row" className="grid grid-cols-[6.5rem_1fr_9.5rem_14rem] gap-1 px-1 text-xs text-ui-muted">
              <span role="columnheader" />
              <span role="columnheader">{columns ? t("calc.sort.row") : t("calc.sort.column")}</span>
              <span role="columnheader">{t("calc.sort.sortOn")}</span>
              <span role="columnheader">{t("calc.sort.order")}</span>
            </div>
            {levels.map((l, i) => {
              const numbers = l.kind === "numbers";
              const choice = sortOnChoice(l);
              const lc = colors.get(l.col);
              const on = l.sortOn;
              return (
                <div
                  key={i}
                  role="row"
                  aria-selected={i === current}
                  data-testid="sort-level"
                  className={`grid grid-cols-[6.5rem_1fr_9.5rem_14rem] items-center gap-1 rounded px-1 py-0.5 ${i === current ? "bg-ui-active" : ""}`}
                  onPointerDown={() => setCurrent(i)}
                  onFocus={() => setCurrent(i)}
                >
                  <span role="cell">{i === 0 ? t("calc.sort.sortBy") : t("calc.sort.thenBy")}</span>
                  <span role="cell">
                    <select
                      className={`${FIELD} w-full ${dup.has(l.col) ? "border-red-600" : ""}`}
                      aria-label={`${columns ? t("calc.sort.row") : t("calc.sort.column")} ${i + 1}`}
                      value={String(l.col)}
                      onChange={(e) => set(i, { col: Number(e.target.value), ...(on && on.type !== "values" ? { sortOn: undefined, kind: "auto" } : {}) })}
                    >
                      {lines.map((c) => (
                        <option key={c} value={String(c)}>
                          {lineLabel(c)}
                        </option>
                      ))}
                    </select>
                  </span>
                  <span role="cell">
                    <select
                      className={`${FIELD} w-full`}
                      aria-label={`${t("calc.sort.sortOn")} ${i + 1}`}
                      value={choice}
                      onChange={(e) => {
                        const v = e.target.value as SortOnChoice;
                        if (v === "cellColor" || v === "fontColor" || v === "icon") {
                          lineColors(l.col);
                          set(i, { kind: "auto", sortOn: firstChoice(l.col, v), customList: undefined });
                        } else set(i, { kind: v, sortOn: undefined });
                      }}
                    >
                      {SORT_ON.map((k) => (
                        <option key={k} value={k}>
                          {t(`calc.sort.kind.${k}`)}
                        </option>
                      ))}
                    </select>
                  </span>
                  <span role="cell" className="flex gap-1">
                    {on && on.type !== "values" ? (
                      <>
                        <select
                          className={`${FIELD} min-w-0 flex-1`}
                          aria-label={`${t("calc.sort.colorOrIcon")} ${i + 1}`}
                          value={on.type === "icon" ? `${on.set}:${on.icon}` : colorKey(on.color)}
                          onChange={(e) => {
                            if (on.type === "icon") {
                              const [set_, icon] = e.target.value.split(":");
                              set(i, { sortOn: { type: "icon", set: set_ as IconSetKind, icon: Number(icon) } });
                            } else {
                              const color = JSON.parse(e.target.value) as Color | null;
                              set(i, { sortOn: { type: on.type, ...(color ? { color } : {}) } });
                            }
                          }}
                        >
                          {on.type === "icon"
                            ? (lc?.icons.length ? lc.icons : [[on.set, on.icon] as [IconSetKind, number]]).map(([set_, icon]) => (
                                <option key={`${set_}:${icon}`} value={`${set_}:${icon}`}>
                                  {t("calc.sort.iconN", { n: icon + 1, set: t(`calc.cf.icons.${set_}`) })}
                                </option>
                              ))
                            : (((on.type === "cellColor" ? lc?.fills : lc?.fonts) ?? [on.color ?? null]) as (Color | null)[]).map((c) => (
                                <option key={colorKey(c)} value={colorKey(c)} style={c ? { color: colorCss(c) } : undefined}>
                                  {colorLabel(t, c, on.type === "fontColor")}
                                </option>
                              ))}
                        </select>
                        <select
                          className={`${FIELD} w-24`}
                          aria-label={`${t("calc.sort.order")} ${i + 1}`}
                          value={l.ascending ? "top" : "bottom"}
                          onChange={(e) => set(i, { ascending: e.target.value === "top" })}
                        >
                          <option value="top">{t("calc.sort.onTop")}</option>
                          <option value="bottom">{t("calc.sort.onBottom")}</option>
                        </select>
                      </>
                    ) : (
                      <select
                        className={`${FIELD} w-full`}
                        aria-label={`${t("calc.sort.order")} ${i + 1}`}
                        value={l.customList ? (l.ascending ? "list" : "listDesc") : l.ascending ? "asc" : "desc"}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v === "custom") setListFor(i);
                          else if (v === "list" || v === "listDesc") set(i, { ascending: v === "list" });
                          else set(i, { ascending: v === "asc", customList: undefined });
                        }}
                      >
                        <option value="asc">{numbers ? t("calc.sort.smallest") : t("calc.sort.aToZ")}</option>
                        <option value="desc">{numbers ? t("calc.sort.largest") : t("calc.sort.zToA")}</option>
                        {l.customList && <option value="list">{l.customList.join(", ")}</option>}
                        {l.customList && <option value="listDesc">{[...l.customList].reverse().join(", ")}</option>}
                        <option value="custom">{t("calc.sort.customList")}</option>
                      </select>
                    )}
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
          <div className="flex items-center justify-end gap-2">
            <button type="button" className={BTN} onClick={close}>
              {t("common.cancel")}
            </button>
            <button type="submit" className={BTN} disabled={dup.size > 0}>
              {t("common.ok")}
            </button>
          </div>
        </form>
      </Dialog>
      {listFor !== null && (
        <CustomListsDialog
          store={store}
          initial={levels[listFor]?.customList}
          onCancel={() => setListFor(null)}
          onOk={(list) => {
            set(listFor, { customList: list, ascending: true, kind: "auto" });
            setListFor(null);
          }}
        />
      )}
    </>
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
  const [colorMenu, setColorMenu] = useState<"sort" | "filter" | null>(null);
  const [lc, setLc] = useState<LineColors | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [pos, setPos] = useState(at);
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    let live = true;
    void filterTarget(store, table).values(col).then((v) => {
      if (!live) return;
      setValues(v);
      setChecked(initialDateChecked(v, columnFilter(filterTarget(store, table).af, col)));
    });
    // Sort by Color / Filter by Color (the sheet's AutoFilter): the column's colours and icons.
    const sheetAf = table === undefined ? store.autoFilter() : null;
    if (sheetAf && sheetAf.r1 > sheetAf.r0) {
      void store.lineColors({ r0: sheetAf.r0 + 1, c0: sheetAf.c0, r1: sheetAf.r1, c1: sheetAf.c1 }, col).then((c) => live && setLc(c));
    }
    return () => {
      live = false;
    };
  }, [store, col, table]);

  useLayoutEffect(() => {
    const el = ref.current;
    const w = el?.offsetWidth ?? 0, h = el?.offsetHeight ?? 0;
    setPos({ x: Math.max(0, Math.min(at.x, window.innerWidth - w - 4)), y: Math.max(0, Math.min(at.y, window.innerHeight - h - 4)) });
  }, [at, values, submenu, colorMenu]);

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
  const tree = values && search.trim() === "" ? dateTree(values) : null;
  const dated = !!tree && tree.years.length > 0;
  const result = values ? (dated ? dateTreeFilter(values, checked) : checklistFilter(values, checked, search)) : undefined;
  const hasColors = !!lc && (lc.fills.length > 1 || lc.fonts.length > 1 || lc.icons.length > 0);
  const colorItems = (pick: (on: SortOn) => void) => {
    if (!lc) return null;
    const group = (label: string, entries: { key: string; text: string; on: SortOn; css?: string }[]) =>
      entries.length === 0 ? null : (
        <div role="group" aria-label={label} className="flex flex-col">
          <span className="px-2 pt-1 text-[11px] font-medium text-ui-muted">{label}</span>
          {entries.map((e) => (
            <button key={e.key} type="button" role="menuitem" className={ITEM} onClick={() => pick(e.on)}>
              <span aria-hidden="true" className="inline-block h-3.5 w-6 border border-ui-border" style={{ background: e.css ?? "transparent" }} />
              {e.text}
            </button>
          ))}
        </div>
      );
    return (
      <>
        {lc.fills.length > 1 &&
          group(
            t("calc.filter.byCellColor"),
            lc.fills.map((c) => ({ key: `f${colorKey(c)}`, text: colorLabel(t, c, false), on: { type: "cellColor", ...(c ? { color: c } : {}) }, css: c ? colorCss(c) : undefined })),
          )}
        {lc.fonts.length > 1 &&
          group(
            t("calc.filter.byFontColor"),
            lc.fonts.map((c) => ({ key: `t${colorKey(c)}`, text: colorLabel(t, c, true), on: { type: "fontColor", ...(c ? { color: c } : {}) }, css: c ? colorCss(c) : "#000000" })),
          )}
        {lc.icons.length > 0 &&
          group(
            t("calc.filter.byIcon"),
            lc.icons.map(([set, icon]) => ({ key: `i${set}${icon}`, text: t("calc.sort.iconN", { n: icon + 1, set: t(`calc.cf.icons.${set}`) }), on: { type: "icon", set, icon } })),
          )}
      </>
    );
  };
  const asFilter = (on: SortOn): Filter =>
    on.type === "icon" ? { kind: "icon", set: on.set, icon: on.icon } : { kind: "color", ...(on.type !== "values" && on.color ? { color: on.color } : {}), ...(on.type === "fontColor" ? { font: true } : {}) };
  const toggleOpen = (key: string) => setOpen((o) => {
    const n = new Set(o);
    if (n.has(key)) n.delete(key);
    else n.add(key);
    return n;
  });
  const nodeState = (n: DateNode) => selectAllState(n.displays.map((d) => ({ display: d, count: 1 })), checked);
  const setNode = (n: DateNode, on: boolean) => setChecked(setAll(n.displays.map((d) => ({ display: d, count: 1 })), checked, on));
  const renderNode = (n: DateNode, depth: number): React.ReactNode => {
    const label = n.day !== undefined ? String(n.day) : n.month !== undefined ? t(`calc.filter.month.${n.month}`) : String(n.year);
    return (
      <div key={n.key} className="flex flex-col" style={{ paddingLeft: depth * 14 }} data-testid="date-node">
        <div className="flex items-center">
          {n.children.length > 0 ? (
            <button type="button" className="h-6 w-5 text-xs" aria-expanded={open.has(n.key)} aria-label={t("calc.filter.expand", { item: label })} onClick={() => toggleOpen(n.key)}>
              {open.has(n.key) ? "−" : "+"}
            </button>
          ) : (
            <span className="w-5" />
          )}
          <TriCheckbox state={nodeState(n)} label={label} onChange={(on) => setNode(n, on)} />
        </div>
        {open.has(n.key) && n.children.map((c) => renderNode(c, depth + 1))}
      </div>
    );
  };
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
      {hasColors && (
        <>
          <button type="button" className={`${ITEM} justify-between`} aria-expanded={colorMenu === "sort"} onClick={() => setColorMenu((m) => (m === "sort" ? null : "sort"))}>
            <span>{t("calc.filter.sortByColor")}</span>
            <span aria-hidden="true">{colorMenu === "sort" ? "▾" : "▸"}</span>
          </button>
          {colorMenu === "sort" && (
            <div role="menu" aria-label={t("calc.filter.sortByColor")} className="ml-3 flex flex-col border-l border-ui-border pl-1">
              {colorItems((on) => run(() => store.sortFilterColumnBy(col, on))())}
            </div>
          )}
        </>
      )}
      {hasColors && (
        <>
          <button type="button" className={`${ITEM} justify-between`} aria-expanded={colorMenu === "filter"} onClick={() => setColorMenu((m) => (m === "filter" ? null : "filter"))}>
            <span>{t("calc.filter.filterByColor")}</span>
            <span aria-hidden="true">{colorMenu === "filter" ? "▾" : "▸"}</span>
          </button>
          {colorMenu === "filter" && (
            <div role="menu" aria-label={t("calc.filter.filterByColor")} className="ml-3 flex flex-col border-l border-ui-border pl-1">
              {colorItems((on) => run(() => target.set(col, asFilter(on)))())}
            </div>
          )}
        </>
      )}
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
            {dated && tree.years.map((y) => renderNode(y, 0))}
            {(dated ? tree.others : listed).map((v) => (
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
