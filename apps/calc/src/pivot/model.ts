// Pivot tables in the Calc UI (P8-33): the pure parts – the field pane's
// layout (the four areas, drag and drop, checkboxes) and the `updatePivot`
// patch it sends, the value / field settings, the filter check-list, the
// GETPIVOTDATA formula built from a pointed value cell and the table's
// regions (Select ▾). The model and the commands are the core's
// (docs/pivot.md); nothing here computes a layout.

import type { AggFunc } from "../generated/AggFunc";
import type { AxisField } from "../generated/AxisField";
import type { CellView } from "../generated/CellView";
import type { DataField } from "../generated/DataField";
import type { FieldKind } from "../generated/FieldKind";
import type { PageField } from "../generated/PageField";
import type { PivotFieldInfo } from "../generated/PivotFieldInfo";
import type { PivotItemInfo } from "../generated/PivotItemInfo";
import type { PivotOptions } from "../generated/PivotOptions";
import type { PivotPatch } from "../generated/PivotPatch";
import type { PivotSummary } from "../generated/PivotSummary";
import type { PivotTable } from "../generated/PivotTable";
import type { ShowAs } from "../generated/ShowAs";
import type { Rect } from "../generated/Rect";
import { colName, sheetPrefix } from "../grid/address";

/** The eleven functions of Summarize Values By, in Excel's order. */
export const AGG_FUNCS: AggFunc[] = ["sum", "count", "average", "max", "min", "product", "countNums", "stdDev", "stdDevP", "var", "varP"];

/** The word of a default caption (`Sum` of `Sum of Sales`), as the core writes it. */
export const CAPTION_WORD: Record<AggFunc, string> = {
  sum: "Sum", count: "Count", average: "Average", max: "Max", min: "Min", product: "Product", countNums: "Count",
  stdDev: "StdDev", stdDevP: "StdDevp", var: "Var", varP: "Varp",
};

/** `Sum of Sales`: the caption of a data field (its own name when it has one). */
export function captionOf(d: DataField, fieldName: string): string {
  return d.name ? d.name : `${CAPTION_WORD[d.func ?? "sum"]} of ${fieldName}`;
}

/** Show Values As, in Excel's order (the entries this model supports). */
export const SHOW_AS_KINDS: ShowAs["kind"][] = ["normal", "percentOfTotal", "percentOfColumn", "percentOfRow", "percentOfParent", "differenceFrom", "runningTotal", "rank"];

/** Whether a Show Values As kind needs a base field (and, for Difference From, a base item). */
export function showAsNeeds(kind: ShowAs["kind"]): { field: boolean; item: boolean } {
  return { field: kind === "differenceFrom" || kind === "runningTotal" || kind === "rank", item: kind === "differenceFrom" };
}

/**
 * The `ShowAs` of the Value Field Settings dialog: `baseField` / `baseItem`
 * (`"previous"`, `"next"` or a shared item index) where the kind needs
 * them; `null` when one is missing.
 */
export function showAsOf(kind: ShowAs["kind"], baseField: number | null, baseItem: "previous" | "next" | number | null): ShowAs | null {
  const need = showAsNeeds(kind);
  if (need.field && baseField === null) return null;
  switch (kind) {
    case "differenceFrom": {
      if (baseItem === null) return null;
      const item = baseItem === "previous" ? { kind: "previous" as const } : baseItem === "next" ? { kind: "next" as const } : { kind: "item" as const, item: baseItem };
      return { kind, baseField: baseField!, baseItem: item };
    }
    case "runningTotal":
    case "rank":
      return { kind, baseField: baseField! };
    default:
      return { kind };
  }
}

/**
 * The data field the Value Field Settings dialog's OK writes: a custom
 * name only when it differs from the default caption (so a later change
 * of the function renames the field, as in Excel); defaults are omitted.
 */
export function dataFieldOf(field: number, fieldName: string, name: string, func: AggFunc, showAs: ShowAs, numberFormat: string | null): DataField {
  const d: DataField = { field };
  if (func !== "sum") d.func = func;
  const trimmed = name.trim();
  if (trimmed && trimmed !== captionOf({ field, func }, fieldName)) d.name = trimmed;
  if (showAs.kind !== "normal") d.showAs = showAs;
  if (numberFormat) d.numberFormat = numberFormat;
  return d;
}

/** The default function of a new data field: Sum for numbers (and dates), Count otherwise (Excel). */
export function defaultFunc(kind: FieldKind | undefined): AggFunc {
  return kind === "number" || kind === "date" ? "sum" : "count";
}

// --- the field pane's layout -------------------------------------------------------------------

/** The four areas of the field pane. */
export type Area = "filters" | "cols" | "rows" | "values";
export const AREAS: Area[] = ["filters", "cols", "rows", "values"];

/** What the field pane shows and edits: the table's areas plus where `Σ Values` sits. */
export interface PaneLayout {
  filters: PageField[];
  rows: AxisField[];
  cols: AxisField[];
  values: DataField[];
  valuesIn: "rows" | "columns";
  /** Index of `Σ Values` in its axis (absent in the model = last). */
  valuesPosition: number | null;
}

/** One entry of an area list: a field, the `Σ Values` pseudo-field, or a data field (Values area). */
export type AreaItem = { kind: "field"; field: number } | { kind: "values" } | { kind: "data"; index: number; field: number };

export function layoutOf(t: PivotTable): PaneLayout {
  return {
    filters: [...(t.filters ?? [])],
    rows: [...(t.rows ?? [])],
    cols: [...(t.cols ?? [])],
    values: [...(t.values ?? [])],
    valuesIn: t.options?.valuesIn ?? "columns",
    valuesPosition: t.options?.valuesPosition ?? null,
  };
}

const axisOf = (l: PaneLayout, area: "rows" | "cols") => (area === "rows" ? l.rows : l.cols);
const sigmaArea = (l: PaneLayout): "rows" | "cols" => (l.valuesIn === "rows" ? "rows" : "cols");
const showsSigma = (l: PaneLayout) => l.values.length >= 2;

/** The entries of `area` as the pane lists them (`Σ Values` with two or more data fields). */
export function areaItems(l: PaneLayout, area: Area): AreaItem[] {
  if (area === "values") return l.values.map((d, index) => ({ kind: "data", index, field: d.field }));
  if (area === "filters") return l.filters.map((p) => ({ kind: "field", field: p.field }));
  const items: AreaItem[] = axisOf(l, area).map((a) => ({ kind: "field", field: a.field }));
  if (showsSigma(l) && sigmaArea(l) === area) {
    const at = l.valuesPosition === null ? items.length : Math.max(0, Math.min(items.length, l.valuesPosition));
    items.splice(at, 0, { kind: "values" });
  }
  return items;
}

/** Display entries of an axis area: its fields with `Σ` at its place. */
type AxisEntry = AxisField | "sigma";

function entries(l: PaneLayout, area: "rows" | "cols"): AxisEntry[] {
  return areaItems(l, area).map((it) => (it.kind === "values" ? "sigma" : axisOf(l, area).find((a) => a.field === (it as { field: number }).field)!));
}

function withEntries(l: PaneLayout, area: "rows" | "cols", list: AxisEntry[]): PaneLayout {
  const fields = list.filter((e): e is AxisField => e !== "sigma");
  const at = list.indexOf("sigma");
  const next = { ...l, [area]: fields };
  if (at >= 0) {
    next.valuesIn = area === "rows" ? "rows" : "columns";
    next.valuesPosition = at === fields.length ? null : at;
  }
  return next;
}

/** Removes `field` from the axis areas (rows, columns, filters); its axis settings are returned for reuse. */
function takeAxis(l: PaneLayout, field: number): { layout: PaneLayout; axis: AxisField | null; page: PageField | null } {
  const axis = l.rows.find((a) => a.field === field) ?? l.cols.find((a) => a.field === field) ?? null;
  const page = l.filters.find((p) => p.field === field) ?? null;
  return {
    layout: { ...l, rows: l.rows.filter((a) => a.field !== field), cols: l.cols.filter((a) => a.field !== field), filters: l.filters.filter((p) => p.field !== field) },
    axis,
    page,
  };
}

/** Keeps `Σ Values` where it was when its axis loses fields before it. */
function fixSigma(before: PaneLayout, after: PaneLayout): PaneLayout {
  if (before.valuesPosition === null || !showsSigma(before)) return after;
  const area = sigmaArea(before);
  const list = entries(before, area).filter((e) => e === "sigma" || axisOf(after, area).some((a) => a.field === e.field));
  const at = list.indexOf("sigma");
  return { ...after, valuesPosition: at < 0 || at >= list.length - 1 ? null : at };
}

/** A fresh axis field: the old settings of the field when it moves between axes. */
function axisField(field: number, from: AxisField | null): AxisField {
  return from ? { ...from, field } : { field };
}

/**
 * Puts `field` into `area` at display index `index` (`null` = the end):
 * rows / columns / filters take it out of the other axis areas first (a
 * field is on one axis only, as in Excel); the Values area adds a new data
 * field (`func`: Sum for numbers, else Count).
 */
export function addField(l: PaneLayout, field: number, area: Area, index: number | null, kind?: FieldKind): PaneLayout {
  if (area === "values") {
    const values = [...l.values];
    const d: DataField = defaultFunc(kind) === "sum" ? { field } : { field, func: "count" };
    values.splice(index ?? values.length, 0, d);
    return { ...l, values };
  }
  const { layout, axis, page } = takeAxis(l, field);
  const base = fixSigma(l, layout);
  if (area === "filters") {
    const filters = [...base.filters];
    filters.splice(index ?? filters.length, 0, page ?? { field });
    return { ...base, filters };
  }
  const list = entries(base, area);
  list.splice(index === null ? list.length : Math.min(index, list.length), 0, axisField(field, axis));
  return withEntries(base, area, list);
}

/** Removes the entry at display `index` of `area` (`Σ Values` cannot be removed on its own). */
export function removeItem(l: PaneLayout, area: Area, index: number): PaneLayout {
  const item = areaItems(l, area)[index];
  if (!item) return l;
  if (item.kind === "data") return { ...l, values: l.values.filter((_, i) => i !== item.index) };
  if (item.kind === "values") return l;
  return fixSigma(l, takeAxis(l, item.field).layout);
}

/**
 * Drag and drop between and within the areas (and the Move Up / Down /
 * to Beginning / End / to … menu entries). Moving a data field to an axis
 * area or an axis field to Values replaces it there (Excel moves it);
 * `Σ Values` goes to rows or columns only. Returns `l` itself when the
 * move is not possible.
 */
export function moveItem(l: PaneLayout, from: { area: Area; index: number }, to: { area: Area; index: number | null }, kinds: (field: number) => FieldKind | undefined = () => undefined): PaneLayout {
  const item = areaItems(l, from.area)[from.index];
  if (!item) return l;
  if (item.kind === "values") {
    if (to.area !== "rows" && to.area !== "cols") return l;
    // Σ leaves its axis and enters the target at the drop index.
    const fields = entries(l, from.area as "rows" | "cols").filter((e): e is AxisField => e !== "sigma");
    const cleared: PaneLayout = { ...l, [from.area]: fields };
    const target: AxisEntry[] = to.area === from.area ? [...fields] : entries({ ...cleared, values: [] }, to.area);
    let at = to.index === null ? target.length : to.index;
    if (to.area === from.area && to.index !== null && to.index > from.index) at--;
    target.splice(Math.max(0, Math.min(at, target.length)), 0, "sigma");
    return withEntries(cleared, to.area, target);
  }
  if (from.area === to.area) {
    if (from.area === "values" && item.kind === "data") {
      const values = [...l.values];
      const [d] = values.splice(item.index, 1);
      let at = to.index === null ? values.length : to.index;
      if (to.index !== null && to.index > from.index) at--;
      values.splice(Math.max(0, Math.min(at, values.length)), 0, d!);
      return { ...l, values };
    }
    if (from.area === "filters") {
      const filters = [...l.filters];
      const [p] = filters.splice(from.index, 1);
      let at = to.index === null ? filters.length : to.index;
      if (to.index !== null && to.index > from.index) at--;
      filters.splice(Math.max(0, Math.min(at, filters.length)), 0, p!);
      return { ...l, filters };
    }
    const area = from.area as "rows" | "cols";
    const list = entries(l, area);
    const [e] = list.splice(from.index, 1);
    let at = to.index === null ? list.length : to.index;
    if (to.index !== null && to.index > from.index) at--;
    list.splice(Math.max(0, Math.min(at, list.length)), 0, e!);
    return withEntries(l, area, list);
  }
  if (item.kind === "data") {
    const rest: PaneLayout = { ...l, values: l.values.filter((_, i) => i !== item.index) };
    return addField(rest, item.field, to.area, to.index, kinds(item.field));
  }
  // An axis field to another area.
  if (to.area === "values") {
    const rest = fixSigma(l, takeAxis(l, item.field).layout);
    return addField(rest, item.field, "values", to.index, kinds(item.field));
  }
  return addField(l, item.field, to.area, to.index, kinds(item.field));
}

/** The area a field list checkbox puts a field in: numbers to Values, the rest to Rows (Excel). */
export function checkboxArea(kind: FieldKind | undefined): Area {
  return kind === "number" ? "values" : "rows";
}

/** Whether a field is used anywhere (its checkbox is ticked). */
export function isUsed(l: PaneLayout, field: number): boolean {
  return l.rows.some((a) => a.field === field) || l.cols.some((a) => a.field === field) || l.filters.some((p) => p.field === field) || l.values.some((d) => d.field === field);
}

/** Ticking a field adds it to its default area; unticking removes it from every area. */
export function toggleField(l: PaneLayout, field: number, kind: FieldKind | undefined): PaneLayout {
  if (!isUsed(l, field)) return addField(l, field, checkboxArea(kind), null, kind);
  const { layout } = takeAxis(l, field);
  return fixSigma(l, { ...layout, values: layout.values.filter((d) => d.field !== field) });
}

/** The full options with `changes` (the core replaces the whole options object). */
export function withOptions(t: PivotTable, changes: Partial<PivotOptions>): PivotOptions {
  return { ...(t.options ?? {}), ...changes };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The `updatePivot` patch from the table to the pane's layout (`null`: nothing changed). */
export function patchOf(t: PivotTable, l: PaneLayout): PivotPatch | null {
  const before = layoutOf(t);
  const p: PivotPatch = {};
  if (!same(before.rows, l.rows)) p.rows = l.rows;
  if (!same(before.cols, l.cols)) p.cols = l.cols;
  if (!same(before.filters, l.filters)) p.filters = l.filters;
  if (!same(before.values, l.values)) p.values = l.values;
  if (before.valuesIn !== l.valuesIn || before.valuesPosition !== l.valuesPosition) {
    const opts: PivotOptions = { ...(t.options ?? {}), valuesIn: l.valuesIn };
    if (l.valuesPosition === null) delete opts.valuesPosition;
    else opts.valuesPosition = l.valuesPosition;
    p.options = opts;
  }
  return Object.keys(p).length === 0 ? null : p;
}

/** Replaces the axis field of `field` (rows or columns) by `next`. */
export function updateAxisField(t: PivotTable, field: number, next: (a: AxisField) => AxisField): PivotPatch | null {
  const rows = t.rows ?? [];
  const cols = t.cols ?? [];
  if (rows.some((a) => a.field === field)) return { rows: rows.map((a) => (a.field === field ? next(a) : a)) };
  if (cols.some((a) => a.field === field)) return { cols: cols.map((a) => (a.field === field ? next(a) : a)) };
  return null;
}

/** The axis (rows / columns) or filter a field is on. */
export function fieldArea(t: PivotTable, field: number): "rows" | "cols" | "filters" | null {
  if ((t.rows ?? []).some((a) => a.field === field)) return "rows";
  if ((t.cols ?? []).some((a) => a.field === field)) return "cols";
  if ((t.filters ?? []).some((p) => p.field === field)) return "filters";
  return null;
}

// --- filters ------------------------------------------------------------------------------------

/** Search box of the item check-list: case-insensitive "contains". */
export function visibleItems(items: readonly PivotItemInfo[], search: string): PivotItemInfo[] {
  const q = search.trim().toLowerCase();
  return q === "" ? [...items] : items.filter((i) => i.label.toLowerCase().includes(q));
}

/**
 * The hidden items an axis field's check-list OK writes (unticked items;
 * while searching, the items outside the results are hidden too, as in
 * Excel); `null` when nothing would be shown (OK is disabled).
 */
export function hiddenItemsOf(items: readonly PivotItemInfo[], checked: ReadonlySet<number>, search: string): number[] | null {
  const shown = new Set(visibleItems(items, search).map((i) => i.index));
  const keep = items.filter((i) => checked.has(i.index) && shown.has(i.index));
  if (keep.length === 0) return null;
  return items.filter((i) => !keep.includes(i)).map((i) => i.index).sort((a, b) => a - b);
}

/** A page field's selection from its check-list: `null` = (All). */
export function pageSelectionOf(items: readonly PivotItemInfo[], checked: ReadonlySet<number>): number[] | null | undefined {
  const keep = items.filter((i) => checked.has(i.index)).map((i) => i.index);
  if (keep.length === 0) return undefined;
  return keep.length === items.length ? null : keep;
}

/** Whether a field has a filter (hidden items, or a page selection other than All). */
export function isFiltered(t: PivotTable, field: number): boolean {
  const a = [...(t.rows ?? []), ...(t.cols ?? [])].find((x) => x.field === field);
  if (a) return (a.hiddenItems?.length ?? 0) > 0;
  const p = (t.filters ?? []).find((x) => x.field === field);
  return !!p?.selected && p.selected.kind === "items";
}

/** Clear Filters: every hidden item shown again, every page field back to (All). */
export function clearFiltersPatch(t: PivotTable): PivotPatch | null {
  const strip = (a: AxisField): AxisField => {
    const { hiddenItems: _h, ...rest } = a;
    return rest;
  };
  const rows = (t.rows ?? []).map(strip);
  const cols = (t.cols ?? []).map(strip);
  const filters = (t.filters ?? []).map((p) => ({ field: p.field }));
  const p: PivotPatch = {};
  if (!same(rows, t.rows ?? [])) p.rows = rows;
  if (!same(cols, t.cols ?? [])) p.cols = cols;
  if (!same(filters, t.filters ?? [])) p.filters = filters;
  return Object.keys(p).length ? p : null;
}

/** Clear All: an empty table (the placeholder block). */
export const CLEAR_ALL_PATCH: PivotPatch = { rows: [], cols: [], values: [], filters: [] };

// --- GETPIVOTDATA --------------------------------------------------------------------------------

export type CellAt = (row: number, col: number) => CellView | undefined;

/** A field/item pair of GETPIVOTDATA: the field's name and the item as written (text or number). */
export interface PivotPair {
  field: number;
  item: string | number;
}

const LABEL_KINDS = new Set(["rowLabel", "colLabel", "subtotal"]);

/**
 * The row and column items of the value cell at `(row, col)` of table
 * `s`: the labels left of it (row axis) and above it (column axis); an
 * outer item that is not repeated on the cell's line is taken from the
 * nearest line before it with a label at that depth. A grand total line
 * contributes nothing; a data caption on an axis (`Σ Values`) names the
 * data field (`caption`). `null` when the cell is no value of the table.
 */
export function pivotDataKey(at: CellAt, s: PivotSummary, row: number, col: number): { pairs: PivotPair[]; caption: string | null } | null {
  const cell = at(row, col);
  const p = cell?.pivot;
  if (!p || p.id !== s.id || !(p.kind === "value" || p.kind === "subtotal" || p.kind === "grandTotal")) return null;
  const t = s.table;
  let caption: string | null = null;
  const pairs: PivotPair[] = [];
  const labelOf = (v: CellView): string | number => (v.kind === "number" && v.input !== "" && Number.isFinite(Number(v.input)) ? Number(v.input) : v.display);
  /** Walks one axis: `line(i)` is the label cells of line `i` (row or column), lines from the cell's back to the first. */
  const walk = (lines: (i: number) => CellView[], from: number, first: number) => {
    const own = lines(from);
    if (own.some((v) => v.pivot?.kind === "grandTotal")) return;
    const found = new Map<number, CellView>();
    let deepest = -1;
    for (const v of own) {
      const lp = v.pivot!;
      if (lp.field === undefined) {
        if (v.display) caption = v.display;
        continue;
      }
      found.set(lp.level, v);
      deepest = Math.max(deepest, lp.level);
    }
    for (let level = deepest - 1; level >= 0; level--) {
      if (found.has(level)) continue;
      for (let i = from - 1; i >= first; i--) {
        const hit = lines(i).find((v) => v.pivot!.level === level && v.pivot!.field !== undefined);
        if (hit) {
          found.set(level, hit);
          break;
        }
      }
    }
    for (const [, v] of [...found.entries()].sort((a, b) => a[0] - b[0])) pairs.push({ field: v.pivot!.field!, item: labelOf(v) });
  };
  const body = firstBodyRow(at, s);
  const dataCol = firstDataCol(at, s);
  // A subtotal or grand total label is no value.
  if (row < body || col < dataCol) return null;
  const labelRole = (v: CellView | undefined): v is CellView =>
    !!v?.pivot && v.pivot.id === s.id && (LABEL_KINDS.has(v.pivot.kind) || v.pivot.kind === "grandTotal") && v.display !== "";
  // The labels of a body row: the cells of the label columns; of a column: the cells of the header rows.
  const rowLabels = (r: number): CellView[] => {
    const out: CellView[] = [];
    for (let c = t.c0; c < Math.min(dataCol, col); c++) {
      const v = at(r, c);
      if (labelRole(v) && v.pivot!.kind !== "colLabel") out.push(v);
    }
    return out;
  };
  const colLabels = (c: number): CellView[] => {
    const out: CellView[] = [];
    for (let r = t.r0; r < Math.min(body, row); r++) {
      const v = at(r, c);
      if (labelRole(v) && v.pivot!.kind !== "rowLabel") out.push(v);
    }
    return out;
  };
  walk(rowLabels, row, body);
  walk(colLabels, col, dataCol);
  return { pairs, caption };
}

/** `"text"` with doubled quotes. */
const quote = (s: string) => `"${s.replace(/"/g, '""')}"`;

/**
 * `GETPIVOTDATA("Sum of Sales",$A$3,"Region","North")`: the data caption,
 * the table's top-left cell (with its sheet when the formula is on another
 * sheet) and the field/item pairs.
 */
export function getPivotDataFormula(caption: string, table: { r0: number; c0: number }, pairs: readonly { name: string; item: string | number }[], sheet: string | null): string {
  const ref = `${sheet ? sheetPrefix(sheet) : ""}$${colName(table.c0)}$${table.r0 + 1}`;
  const args = [quote(caption), ref, ...pairs.flatMap((p) => [quote(p.name), typeof p.item === "number" ? String(p.item) : quote(p.item)])];
  return `GETPIVOTDATA(${args.join(",")})`;
}

// --- regions of a table --------------------------------------------------------------------------

/** The first row of the body (below the header rows): the first with a row label or a value. */
export function firstBodyRow(at: CellAt, s: PivotSummary): number {
  const t = s.table;
  for (let r = t.r0; r <= t.r1; r++) {
    for (let c = t.c0; c <= t.c1; c++) {
      const k = at(r, c)?.pivot?.kind;
      if (k === "rowLabel" || k === "value") return r;
    }
  }
  return Math.min(t.r1, t.r0 + 1);
}

/** The first column of the values (right of the row labels). */
export function firstDataCol(at: CellAt, s: PivotSummary): number {
  const t = s.table;
  let best = t.c1 + 1;
  for (let r = t.r0; r <= t.r1; r++) {
    for (let c = t.c0; c < best; c++) {
      const k = at(r, c)?.pivot?.kind;
      if (k === "value" || k === "colLabel") {
        best = c;
        break;
      }
    }
  }
  if (best > t.c1) {
    // No values: everything is labels.
    return t.c1 + 1;
  }
  return best;
}

/** Select ▾: the labels (row labels of the body), the values, or the entire table (page fields included). */
export function selectRegion(at: CellAt, s: PivotSummary, what: "labels" | "values" | "entire"): Rect {
  if (what === "entire") return { ...s.location };
  const t = s.table;
  const r0 = firstBodyRow(at, s);
  const dc = firstDataCol(at, s);
  if (what === "labels") return { r0, c0: t.c0, r1: t.r1, c1: Math.max(t.c0, dc - 1) };
  return { r0, c0: Math.min(dc, t.c1), r1: t.r1, c1: t.c1 };
}

/** Whether a range covers a whole table (page fields included): Delete removes it then. */
export function coversPivot(r: Rect, s: PivotSummary): boolean {
  const l = s.location;
  return r.r0 <= l.r0 && r.c0 <= l.c0 && r.r1 >= l.r1 && r.c1 >= l.c1;
}

/** Whether a range touches a table. */
export function touchesPivot(r: Rect, s: PivotSummary): boolean {
  const l = s.location;
  return r.r0 <= l.r1 && r.r1 >= l.r0 && r.c0 <= l.c1 && r.c1 >= l.c0;
}

/** The fields shown in the pane's list, filtered by the search box. */
export function searchFields(fields: readonly PivotFieldInfo[], search: string): PivotFieldInfo[] {
  const q = search.trim().toLowerCase();
  return q === "" ? [...fields] : fields.filter((f) => f.name.toLowerCase().includes(q));
}
