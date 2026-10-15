// AutoFilter (P8-5): the pure parts of the filter dropdown – the value
// check-list (search, Select All) → `Filter`, the custom / Top 10 /
// average filters, the dropdown buttons on the header row (layout and
// hit-testing) and the "n of m records found" count.

import type { AutoFilter } from "../generated/AutoFilter";
import type { CellKind } from "../generated/CellKind";
import type { Criterion } from "../generated/Criterion";
import type { DynamicFilter } from "../generated/DynamicFilter";
import type { Filter } from "../generated/Filter";
import type { FilterOp } from "../generated/FilterOp";
import type { FilterValue } from "../generated/FilterValue";
import type { RowView } from "../generated/RowView";
import type { SortState } from "../generated/SortState";
import type { AxisGeometry } from "../grid/geometry";

/** The core compares filter values case-insensitively (`fold`). */
const fold = (s: string) => s.toLowerCase();

/** The current filter of AutoFilter column `col` (absent: none). */
export function columnFilter(af: AutoFilter | undefined | null, col: number): Filter | undefined {
  return af?.columns?.find((c) => c.col === col)?.filter;
}

/** Whether any column of the AutoFilter has a filter. */
export function hasFilters(af: AutoFilter | undefined | null): boolean {
  return !!af?.columns?.length;
}

// --- value check-list --------------------------------------------------------

/**
 * The checked values when the dropdown opens: with a values filter the
 * values it lists, otherwise all (Excel ticks every value of an
 * unfiltered column). Keys are the displayed texts (`""` = blanks).
 */
export function initialChecked(values: readonly FilterValue[], filter: Filter | undefined): Set<string> {
  if (filter?.kind !== "values") return new Set(values.map((v) => v.display));
  const keep = new Set(filter.values.map(fold));
  return new Set(values.filter((v) => keep.has(fold(v.display))).map((v) => v.display));
}

/** Search box: case-insensitive "contains"; blanks never match a search. */
export function visibleValues(values: readonly FilterValue[], search: string): FilterValue[] {
  const q = fold(search.trim());
  if (q === "") return [...values];
  return values.filter((v) => v.display !== "" && fold(v.display).includes(q));
}

/** State of the (Select All) box over the shown values. */
export function selectAllState(shown: readonly FilterValue[], checked: ReadonlySet<string>): "all" | "none" | "some" {
  const n = shown.filter((v) => checked.has(v.display)).length;
  return n === 0 ? "none" : n === shown.length ? "all" : "some";
}

/** (Select All): checks (`on`) or unchecks every shown value, the others keep their state. */
export function setAll(shown: readonly FilterValue[], checked: ReadonlySet<string>, on: boolean): Set<string> {
  const out = new Set(checked);
  for (const v of shown) {
    if (on) out.add(v.display);
    else out.delete(v.display);
  }
  return out;
}

/** Ticks or unticks one value. */
export function toggleValue(checked: ReadonlySet<string>, display: string): Set<string> {
  const out = new Set(checked);
  if (out.has(display)) out.delete(display);
  else out.add(display);
  return out;
}

/**
 * The filter the check-list's OK applies: `null` (no filter) when every
 * value is kept, a `values` filter otherwise; `undefined` when nothing is
 * kept (OK is disabled, as in Excel). While searching, only the checked
 * search results are kept (Excel's behaviour).
 */
export function checklistFilter(values: readonly FilterValue[], checked: ReadonlySet<string>, search: string): Filter | null | undefined {
  const shown = new Set(visibleValues(values, search).map((v) => v.display));
  const kept = values.filter((v) => checked.has(v.display) && shown.has(v.display)).map((v) => v.display);
  if (kept.length === 0) return undefined;
  if (kept.length === values.length) return null;
  return { kind: "values", values: kept };
}

// --- Text / Number Filters ----------------------------------------------------

/** "Number Filters" when most cells of the column are numbers, else "Text Filters" (Excel). */
export function filterMenuKind(kinds: readonly CellKind[]): "number" | "text" {
  let numbers = 0, texts = 0;
  for (const k of kinds) {
    if (k === "number") numbers++;
    else if (k === "text") texts++;
  }
  return numbers > texts ? "number" : "text";
}

/** Entries of the Text / Number Filters submenu that open the custom dialog. */
export type CustomPreset = FilterOp | "between" | "custom";

export const TEXT_PRESETS: CustomPreset[] = ["eq", "ne", "beginsWith", "endsWith", "contains", "notContains", "custom"];
export const NUMBER_PRESETS: CustomPreset[] = ["eq", "ne", "gt", "ge", "lt", "le", "between", "custom"];
/** Operators of the custom dialog's lists, in Excel's order. */
export const ALL_OPS: FilterOp[] = ["eq", "ne", "gt", "ge", "lt", "le", "beginsWith", "endsWith", "contains", "notContains"];

/** The Custom AutoFilter dialog: two criteria joined by And / Or; `op2` `null` = second row unused. */
export interface CustomFilterState {
  op1: FilterOp;
  value1: string;
  op2: FilterOp | null;
  value2: string;
  and: boolean;
}

/** The dialog's start: the column's custom filter when it has one, else the chosen preset. */
export function customInitial(preset: CustomPreset, current: Filter | undefined): CustomFilterState {
  if (current?.kind === "custom" && current.criteria.length > 0) {
    const [a, b] = current.criteria;
    return { op1: a!.op, value1: a!.value, op2: b?.op ?? null, value2: b?.value ?? "", and: current.and };
  }
  if (preset === "between") return { op1: "ge", value1: "", op2: "le", value2: "", and: true };
  return { op1: preset === "custom" ? "eq" : preset, value1: "", op2: null, value2: "", and: true };
}

/** The dialog's `custom` filter (one or two criteria). */
export function customFilter(s: CustomFilterState): Filter {
  const criteria: Criterion[] = [{ op: s.op1, value: s.value1.trim() }];
  if (s.op2 !== null) criteria.push({ op: s.op2, value: s.value2.trim() });
  return { kind: "custom", criteria, and: criteria.length === 1 ? true : s.and };
}

/** Top 10…: `null` when the count is out of Excel's range (1–500 items, 1–100 percent). */
export function top10Filter(top: boolean, percent: boolean, value: number): Filter | null {
  if (!Number.isInteger(value) || value < 1 || value > (percent ? 100 : 500)) return null;
  return { kind: "top10", top, percent, value };
}

/** Above / Below Average (applied at once, as in Excel). */
export function dynamicFilter(filter: DynamicFilter): Filter {
  return { kind: "dynamic", filter };
}

// --- status bar and row headers -------------------------------------------------

/**
 * Excel's "n of m records found" while a filter is set: `m` data rows of
 * the AutoFilter range, `n` of them not hidden by the filter (rows the
 * cache knows: the core sends every row a filter hides or shows).
 */
export function recordsFound(af: AutoFilter | undefined | null, rows: ReadonlyMap<number, RowView>): { shown: number; total: number } | null {
  if (!af || !hasFilters(af)) return null;
  const total = af.r1 - af.r0;
  let hidden = 0;
  for (const [r, v] of rows) if (r > af.r0 && r <= af.r1 && v.filtered && v.hidden) hidden++;
  return { shown: total - hidden, total };
}

/** The data rows whose row numbers turn blue (a filter is set), else `null`. */
export function filteredRowSpan(af: AutoFilter | undefined | null): { r0: number; r1: number } | null {
  return af && hasFilters(af) ? { r0: af.r0 + 1, r1: af.r1 } : null;
}

// --- dropdown buttons -----------------------------------------------------------

/** Side of a dropdown button, px (smaller in low rows / narrow columns). */
export const FILTER_BUTTON = 16;
/** Extra hit margin around a button, px. */
export const FILTER_BUTTON_SLOP = 2;

export interface FilterButton {
  col: number;
  /** Sheet coordinates (not scrolled). */
  x: number;
  y: number;
  size: number;
  /** The column has a filter: a funnel. */
  filtered: boolean;
  /** The last sort's direction on this column, if it sorted this range. */
  sort: "asc" | "desc" | null;
}

/** The dropdown button of AutoFilter column `col`, at the right edge of its header cell (`null`: hidden). */
export function filterButton(
  colGeo: AxisGeometry, rowGeo: AxisGeometry, af: AutoFilter, col: number, sortState?: SortState | null,
): FilterButton | null {
  if (col < af.c0 || col > af.c1) return null;
  const w = colGeo.size(col);
  const h = rowGeo.size(af.r0);
  const size = Math.min(FILTER_BUTTON, w - 2, h - 2);
  if (size < 6) return null;
  const key = sortState && sortState.c0 === af.c0 && sortState.c1 === af.c1 && sortState.r1 === af.r1 ? sortState.keys[0] : undefined;
  return {
    col,
    x: colGeo.offset(col) + w - size - 1,
    y: rowGeo.offset(af.r0) + h - size - 1,
    size,
    filtered: !!columnFilter(af, col),
    sort: key && key.col === col ? (key.ascending ? "asc" : "desc") : null,
  };
}

/** The buttons of the AutoFilter columns `c0..=c1` (the visible ones). */
export function filterButtons(
  colGeo: AxisGeometry, rowGeo: AxisGeometry, af: AutoFilter, c0: number, c1: number, sortState?: SortState | null,
): FilterButton[] {
  const out: FilterButton[] = [];
  for (let c = Math.max(c0, af.c0); c <= Math.min(c1, af.c1); c++) {
    const b = filterButton(colGeo, rowGeo, af, c, sortState);
    if (b) out.push(b);
  }
  return out;
}

/** The AutoFilter column whose button contains the sheet point `(x, y)`, else `null`. */
export function filterButtonAt(colGeo: AxisGeometry, rowGeo: AxisGeometry, af: AutoFilter | undefined | null, x: number, y: number): number | null {
  if (!af) return null;
  const col = colGeo.indexAt(x);
  for (const c of [col, col + 1, col - 1]) {
    const b = filterButton(colGeo, rowGeo, af, c);
    const s = FILTER_BUTTON_SLOP;
    if (b && x >= b.x - s && x <= b.x + b.size + s && y >= b.y - s && y <= b.y + b.size + s) return c;
  }
  return null;
}

/** Paints the buttons (scrolled by `scrollX/Y`): a box with ▾, a funnel when filtered, an arrow when sorted. */
export function drawFilterButtons(ctx: CanvasRenderingContext2D, buttons: readonly FilterButton[], scrollX: number, scrollY: number): void {
  for (const b of buttons) {
    const x = Math.round(b.x - scrollX) + 0.5, y = Math.round(b.y - scrollY) + 0.5, s = b.size;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(x, y, s, s);
    ctx.strokeStyle = "#a6a6a6";
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, s - 1, s - 1);
    ctx.fillStyle = "#444444";
    const cx = x + s / 2, cy = y + s / 2;
    const mark = b.filtered || b.sort !== null;
    // ▾ (to the right when a funnel / arrow sits beside it).
    const tx = mark ? x + s - 5 : cx, ty = mark ? y + s - 5 : cy - 1;
    ctx.beginPath();
    ctx.moveTo(tx - 3, ty);
    ctx.lineTo(tx + 3, ty);
    ctx.lineTo(tx, ty + 3);
    ctx.closePath();
    ctx.fill();
    if (b.filtered) {
      // Funnel.
      ctx.fillStyle = "#217346";
      ctx.beginPath();
      ctx.moveTo(x + 2, y + 3);
      ctx.lineTo(x + 10, y + 3);
      ctx.lineTo(x + 7, y + 7);
      ctx.lineTo(x + 7, y + s - 3);
      ctx.lineTo(x + 5, y + s - 4);
      ctx.lineTo(x + 5, y + 7);
      ctx.closePath();
      ctx.fill();
    } else if (b.sort) {
      // Arrow up (ascending) or down.
      const ax = x + 5, top = y + 3, bottom = y + s - 3;
      ctx.strokeStyle = "#444444";
      ctx.beginPath();
      ctx.moveTo(ax, top);
      ctx.lineTo(ax, bottom);
      if (b.sort === "asc") {
        ctx.moveTo(ax - 2.5, top + 3);
        ctx.lineTo(ax, top);
        ctx.lineTo(ax + 2.5, top + 3);
      } else {
        ctx.moveTo(ax - 2.5, bottom - 3);
        ctx.lineTo(ax, bottom);
        ctx.lineTo(ax + 2.5, bottom - 3);
      }
      ctx.stroke();
    }
  }
}
