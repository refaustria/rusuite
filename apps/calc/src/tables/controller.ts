// Excel tables in the Calc UI (P8-35): the tables of each sheet (from the
// sheet list: `SheetInfo.tables`), the grid's looks and filter buttons,
// the totals dropdown, the formula editor's helpers (table and column
// names, "this row" references) and every table command. It lives on the
// store (`store.tables`).

import type { CalcCommand } from "../generated/CalcCommand";
import type { Filter } from "../generated/Filter";
import type { Rect } from "../generated/Rect";
import type { Table } from "../generated/Table";
import type { TableLook } from "../generated/TableLook";
import type { TableStyles } from "../generated/TableStyles";
import type { StyleRename } from "../generated/StyleRename";
import type { TotalsCell } from "../generated/TotalsCell";
import type { AxisGeometry } from "../grid/geometry";
import { filterButtonAt, filterButtons, type FilterButton } from "../sortFilter/filter";
import { normalize } from "../grid/Selection";
import type { CalcStore } from "../state/store";
import { t } from "../i18n";
import type { PivotLook } from "../pivot/styles";
import { dataRows, lookAsStyle, tableLook } from "./styles";

/** A filter button of a table header. */
export interface TableFilterButton extends FilterButton {
  table: number;
}

/** Characters a column name needs brackets for after `@` (see `StructRef` Display in the core). */
export function needsBrackets(name: string): boolean {
  return name === "" || /^[0-9]/.test(name) || /[^\p{L}\p{N}_.\\?]/u.test(name);
}

/** A column name escaped for a bracket (`'` before `[ ] # '`). */
export function escapeColumn(name: string): string {
  return name.replace(/['[\]#]/g, "'$&");
}

/** `[@Qty]` / `[@[Unit Price]]` (inside the table) or `Table1[@Qty]`. */
export function thisRowRef(column: string, table: string | null): string {
  const inner = needsBrackets(column) ? `[${escapeColumn(column)}]` : escapeColumn(column);
  return `${table ?? ""}[@${inner}]`;
}

/** `Table1[Qty]` / `Table1[[Qty]:[Price]]` / `Table1` for a range of a table's data columns. */
export function columnsRef(t: Table, c0: number, c1: number): string {
  const name = (c: number) => escapeColumn(t.columns[c - t.c0]?.name ?? "");
  if (c0 === t.c0 && c1 === t.c1) return `${t.name}`;
  return c0 === c1 ? `${t.name}[${name(c0)}]` : `${t.name}[[${name(c0)}]:[${name(c1)}]]`;
}

export class TableController {
  private lookMemo: { sheet: number; version: number; fn: (row: number, col: number) => PivotLook | undefined } | null = null;

  constructor(private readonly store: CalcStore) {}

  /** The tables of `sheet`. */
  of(sheet = this.store.getState().activeSheet): Table[] {
    return this.store.getState().info?.sheets.find((s) => s.id === sheet)?.tables ?? [];
  }

  /** Every table with its sheet. */
  all(): { sheet: number; table: Table }[] {
    return (this.store.getState().info?.sheets ?? []).flatMap((s) => (s.tables ?? []).map((table) => ({ sheet: s.id, table })));
  }

  get(id: number): { sheet: number; table: Table } | null {
    return this.all().find((x) => x.table.id === id) ?? null;
  }

  byName(name: string): { sheet: number; table: Table } | null {
    const n = name.toLowerCase();
    return this.all().find((x) => x.table.name.toLowerCase() === n) ?? null;
  }

  /** The table holding a cell. */
  at(row: number, col: number, sheet = this.store.getState().activeSheet): Table | null {
    return this.of(sheet).find((t) => row >= t.r0 && row <= t.r1 && col >= t.c0 && col <= t.c1) ?? null;
  }

  /** The table of the active cell (the Table Design tab). */
  active(): Table | null {
    const a = this.store.activeAnchor();
    return this.at(a.row, a.col);
  }

  /** The look function of a sheet's tables for the grid (memoized per store version). */
  looks(sheet: number): ((row: number, col: number) => PivotLook | undefined) | undefined {
    const tables = this.of(sheet);
    if (tables.length === 0) return undefined;
    const version = this.store.getState().version;
    if (this.lookMemo && this.lookMemo.sheet === sheet && this.lookMemo.version === version) return this.lookMemo.fn;
    const styles = this.store.getState().info?.tableStyles;
    const fn = (row: number, col: number) => {
      for (const t of tables) {
        const l = tableLook(t, row, col, styles);
        if (l) return l;
      }
      return undefined;
    };
    this.lookMemo = { sheet, version, fn };
    return fn;
  }

  /** The header filter buttons of the visible tables. */
  filterButtons(sheet: number, colGeo: AxisGeometry, rowGeo: AxisGeometry, vis: Rect): TableFilterButton[] {
    const out: TableFilterButton[] = [];
    for (const t of this.of(sheet)) {
      if (!t.autoFilter || !t.headerRow || t.r0 < vis.r0 || t.r0 > vis.r1) continue;
      for (const b of filterButtons(colGeo, rowGeo, t.autoFilter, vis.c0, vis.c1)) out.push({ ...b, table: t.id });
    }
    return out;
  }

  /** The table filter button at a sheet point. */
  filterButtonAt(sheet: number, colGeo: AxisGeometry, rowGeo: AxisGeometry, x: number, y: number): { table: number; col: number } | null {
    for (const t of this.of(sheet)) {
      if (!t.autoFilter || !t.headerRow) continue;
      const col = filterButtonAt(colGeo, rowGeo, t.autoFilter, x, y);
      if (col !== null) return { table: t.id, col };
    }
    return null;
  }

  /** The totals cell at `(row, col)`: its table and column. */
  totalsCellAt(row: number, col: number): { table: Table; col: number } | null {
    const t = this.at(row, col);
    return t && t.totalsRow && row === t.r1 ? { table: t, col } : null;
  }

  /** The table names, for the formula autocomplete. */
  names(): string[] {
    return this.all().map((x) => x.table.name);
  }

  /** The column names of table `name` (any case). */
  columns(name: string): string[] {
    return this.byName(name)?.table.columns.map((c) => c.name) ?? [];
  }

  /**
   * Point mode: a click on `cell` while editing `edited` (same sheet)
   * inserts a structured reference when both lie on the same data row of
   * a table: `[@Col]` inside the table, `Table1[@Col]` outside it.
   */
  pointRef(sheet: number, edited: { row: number; col: number }, cell: { row: number; col: number }): string | null {
    const t = this.at(cell.row, cell.col, sheet);
    if (!t || edited.row !== cell.row) return null;
    const [d0, d1] = dataRows(t);
    if (cell.row < d0 || cell.row > d1) return null;
    const column = t.columns[cell.col - t.c0]?.name;
    if (column === undefined) return null;
    const inside = edited.col >= t.c0 && edited.col <= t.c1;
    return thisRowRef(column, inside ? null : t.name);
  }

  /** Excel's message when Insert › Table meets a table. */
  overlapMessage(): string {
    return t("calc.table.overlap");
  }

  /**
   * "My table has headers" guess (Excel): the first row holds only text
   * and the row below has something that is not text, or there is no row
   * below with text only.
   */
  guessHeaders(r: Rect): boolean {
    const cells = this.store.cache(this.store.getState().activeSheet).cells;
    const kind = (row: number, col: number) => cells.get(row)?.get(col)?.kind ?? "empty";
    let text = 0;
    for (let c = r.c0; c <= r.c1; c++) {
      const k = kind(r.r0, c);
      if (k !== "text" && k !== "empty") return false;
      if (k === "text") text++;
    }
    if (text === 0) return false;
    if (r.r1 === r.r0) return true;
    for (let c = r.c0; c <= r.c1; c++) if (kind(r.r0 + 1, c) !== "text") return true;
    return false;
  }

  // --- commands -------------------------------------------------------

  private apply(command: CalcCommand): Promise<void> {
    return this.store.apply(command);
  }

  /** Insert › Table: on `range` (default: the selection; a single cell takes its region). */
  create(hasHeaders: boolean, range?: Rect, style?: string): Promise<void> {
    const r = range ?? normalize(this.store.getState().selection);
    return this.apply({ type: "createTable", sheet: this.store.getState().activeSheet, ...r, hasHeaders, ...(style ? { style } : {}) });
  }

  rename(id: number, name: string): Promise<void> {
    return this.apply({ type: "renameTable", id, name });
  }

  /** New / Modify / Duplicate / Delete Table Style and Set As Default (P9-C2). */
  setStyles(styles: TableStyles, renamed: StyleRename[] = []): Promise<void> {
    return this.apply({ type: "setTableStyles", styles, ...(renamed.length ? { renamed } : {}) });
  }

  setStyle(id: number, style: string): Promise<void> {
    return this.apply({ type: "setTableStyle", id, style });
  }

  setLook(id: number, patch: Partial<TableLook>): Promise<void> {
    const t = this.get(id)?.table;
    if (!t) return Promise.resolve();
    return this.apply({ type: "setTableStyle", id, look: { ...t.look, ...patch } });
  }

  setOption(id: number, option: "headerRow" | "totalsRow" | "filterButton", on: boolean): Promise<void> {
    return this.apply({ type: "setTableOptions", id, [option]: on });
  }

  setTotals(id: number, col: number, totals: TotalsCell | null): Promise<void> {
    return this.apply({ type: "setTotalsFunction", id, col, totals });
  }

  resize(id: number, r: Rect): Promise<void> {
    return this.apply({ type: "resizeTable", id, ...r });
  }

  /** Convert to Range: the look stays as cell formats. */
  convertToRange(id: number): Promise<void> {
    const t = this.get(id)?.table;
    if (!t) return Promise.resolve();
    const formats = [];
    for (let r = t.r0; r <= t.r1; r++) {
      for (let c = t.c0; c <= t.c1; c++) {
        const look = tableLook(t, r, c, this.store.getState().info?.tableStyles);
        const patch = look ? lookAsStyle(look) : {};
        if (Object.keys(patch).length) formats.push({ r0: r, c0: c, r1: r, c1: c, patch });
      }
    }
    return this.apply({ type: "convertToRange", id, formats });
  }

  setFilter(id: number, col: number, filter: Filter | null): Promise<void> {
    return this.apply({ type: "setTableFilter", id, col, filter });
  }

  /** Sort A→Z / Z→A from a table header's dropdown: the data rows by column `col`. */
  sortColumn(id: number, col: number, ascending: boolean): Promise<void> {
    const x = this.get(id);
    if (!x) return Promise.resolve();
    const t = x.table;
    const [d0, d1] = dataRows(t);
    return this.apply({
      type: "sortRange", sheet: x.sheet, r0: d0, c0: t.c0, r1: d1, c1: t.c1,
      keys: [{ col, ascending, kind: "auto" }], hasHeader: false, caseSensitive: false,
    });
  }

  /** Insert / delete table rows or columns at the selection (the table's own rows / columns). */
  editRowsCols(kind: "insertRows" | "deleteRows" | "insertCols" | "deleteCols"): Promise<void> {
    const t = this.active();
    if (!t) return Promise.resolve();
    const sel = normalize(this.store.getState().selection);
    const rows = kind.endsWith("Rows");
    const at = rows ? Math.max(sel.r0, dataRows(t)[0]) : Math.max(sel.c0, t.c0);
    const end = rows ? Math.min(sel.r1, dataRows(t)[1]) : Math.min(sel.c1, t.c1);
    const count = Math.max(1, end - at + 1);
    const type = (kind === "insertRows" ? "insertTableRows" : kind === "deleteRows" ? "deleteTableRows" : kind === "insertCols" ? "insertTableCols" : "deleteTableCols") as
      "insertTableRows" | "deleteTableRows" | "insertTableCols" | "deleteTableCols";
    return this.apply({ type, id: t.id, at, count });
  }
}
