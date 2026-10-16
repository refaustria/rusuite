// Dev/test-only toy pivot tables for the fake backend (P8-33): enough of
// the core's contract (docs/pivot.md) for the UI's tests and `?fake=1` –
// compact form only, the first column field only, Sum / Count / Average /
// Max / Min, automatic subtotals on the item's row, grand totals, hidden
// and collapsed items, page fields, Σ Values on the columns. The real
// layout engine is `model_sheet::pivot` (Rust); nothing here ships.

import type { AxisField } from "../generated/AxisField";
import type { CalcCommand } from "../generated/CalcCommand";
import type { DataField } from "../generated/DataField";
import type { FieldKind } from "../generated/FieldKind";
import type { PivotCellView } from "../generated/PivotCellView";
import type { PivotInfo } from "../generated/PivotInfo";
import type { PivotItem } from "../generated/PivotItem";
import type { PivotItemInfo } from "../generated/PivotItemInfo";
import type { PivotSummary } from "../generated/PivotSummary";
import type { PivotTable } from "../generated/PivotTable";
import type { Rect } from "../generated/Rect";

type Raw = string | number;

interface Cache {
  id: number;
  sheet: number;
  range: Rect;
  names: string[];
  kinds: FieldKind[];
  /** Shared items per field (first-seen order) and the records as item indices. */
  items: Raw[][];
  records: number[][];
  stale: boolean;
}

interface Out {
  sheet: number;
  roles: Map<string, PivotCellView>;
  inputs: Map<string, string>;
  location: Rect;
  table: Rect;
}

export interface PivotHost {
  read(sheet: number, row: number, col: number): Raw | "";
  write(sheet: number, row: number, col: number, input: string): void;
  sheetName(sheet: number): string;
  /** Adds a sheet before `before` and returns its id. */
  addSheet(before: number): number;
}

const key = (r: number, c: number) => `${r},${c}`;
const CAPTION: Record<string, string> = { sum: "Sum", count: "Count", average: "Average", max: "Max", min: "Min", product: "Product", countNums: "Count", stdDev: "StdDev", stdDevP: "StdDevp", var: "Var", varP: "Varp" };
const label = (v: Raw) => (typeof v === "number" ? String(v) : v === "" ? "(blank)" : v);
const cmp = (a: Raw, b: Raw) => (typeof a === "number" && typeof b === "number" ? a - b : typeof a === "number" ? -1 : typeof b === "number" ? 1 : String(a).localeCompare(String(b), undefined, { sensitivity: "base" }));

export class FakePivots {
  tables = new Map<number, { sheet: number; t: PivotTable }>();
  caches: Cache[] = [];
  outs = new Map<number, Out>();
  private nextId = 1;
  private nextCache = 1;

  constructor(private readonly host: PivotHost) {}

  reset(): void {
    this.tables.clear();
    this.caches = [];
    this.outs.clear();
  }

  role(sheet: number, r: number, c: number): PivotCellView | undefined {
    for (const o of this.outs.values()) if (o.sheet === sheet) {
      const v = o.roles.get(key(r, c));
      if (v) return v;
    }
    return undefined;
  }

  /** The pivot cells of a region (blank ones too), as `[row, col]`. */
  cellsIn(sheet: number, rect: Rect): [number, number][] {
    const out: [number, number][] = [];
    for (const o of this.outs.values()) {
      if (o.sheet !== sheet) continue;
      for (const k of o.roles.keys()) {
        const [r, c] = k.split(",").map(Number) as [number, number];
        if (r >= rect.r0 && r <= rect.r1 && c >= rect.c0 && c <= rect.c1) out.push([r, c]);
      }
    }
    return out;
  }

  summaries(sheet: number): PivotSummary[] {
    return [...this.tables.entries()]
      .filter(([, v]) => v.sheet === sheet)
      .map(([id, { t }]) => {
        const o = this.outs.get(id)!;
        const cache = this.cache(t.cacheId);
        return {
          id, name: t.name, location: { ...o.location }, table: { ...o.table }, style: t.options?.style ?? "PivotStyleLight16",
          banded: !!t.options?.banded, rowHeaders: t.options?.rowHeadersBold !== false, colHeaders: t.options?.colHeadersBold !== false,
          ...(cache.stale ? { stale: true } : {}),
        };
      });
  }

  stale(): number[] {
    return [...this.tables.entries()].filter(([, v]) => this.cache(v.t.cacheId).stale).map(([id]) => id);
  }

  private cache(id: number): Cache {
    const c = this.caches.find((x) => x.id === id);
    if (!c) throw new Error("no cache");
    return c;
  }

  private readCache(sheet: number, range: Rect, id: number): Cache {
    const names: string[] = [];
    for (let c = range.c0; c <= range.c1; c++) names.push(String(this.host.read(sheet, range.r0, c) || `Column${c - range.c0 + 1}`));
    const items: Raw[][] = names.map(() => []);
    const records: number[][] = [];
    const numeric = names.map(() => true);
    for (let r = range.r0 + 1; r <= range.r1; r++) {
      const rec: number[] = [];
      for (let c = range.c0; c <= range.c1; c++) {
        const v = this.host.read(sheet, r, c);
        const f = c - range.c0;
        if (typeof v !== "number" && v !== "") numeric[f] = false;
        let i = items[f]!.findIndex((x) => (typeof x === "string" && typeof v === "string" ? x.toLowerCase() === v.toLowerCase() : x === v));
        if (i < 0) i = items[f]!.push(v) - 1;
        rec.push(i);
      }
      records.push(rec);
    }
    return { id, sheet, range: { ...range }, names, kinds: numeric.map((n) => (n ? "number" : "text")), items, records, stale: false };
  }

  /** Marks caches whose source contains a written cell stale; returns whether the stale list changed. */
  touched(sheet: number, cells: [number, number][]): boolean {
    let changed = false;
    for (const c of this.caches) {
      if (c.stale || c.sheet !== sheet) continue;
      if (cells.some(([r, k]) => r >= c.range.r0 && r <= c.range.r1 && k >= c.range.c0 && k <= c.range.c1)) {
        c.stale = true;
        changed = true;
      }
    }
    return changed;
  }

  /** Runs a pivot command: the sheets whose cells changed and their coordinates. */
  exec(cmd: CalcCommand, activeSheet: number): { sheet: number; coords: [number, number][]; activate?: number; inverse: CalcCommand } {
    const before = this.state();
    // The toy's undo: the whole pivot state as a string in a `restorePivots`.
    const inverse: CalcCommand = { type: "restorePivots", caches: [], sheets: [{ sheet: -1, pivots: [before as unknown as PivotTable] }] };
    switch (cmd.type) {
      case "createPivot": {
        if (cmd.source.kind !== "range") throw new Error("fake: names are not supported");
        const src = cmd.source;
        let range: Rect = { r0: src.r0, c0: src.c0, r1: src.r1, c1: src.c1 };
        if (range.r0 === range.r1 && range.c0 === range.c1) range = this.region(src.sheet, range.r0, range.c0);
        const cache = this.readCache(src.sheet, range, this.nextCache++);
        this.caches.push(cache);
        let sheet: number, row: number, col: number, activate: number | undefined;
        if (cmd.target.kind === "newSheet") {
          sheet = this.host.addSheet(src.sheet);
          [row, col, activate] = [2, 0, sheet];
        } else [sheet, row, col] = [cmd.target.sheet, cmd.target.row, cmd.target.col];
        const id = this.nextId++;
        const t: PivotTable = { id, name: `PivotTable${id}`, cacheId: cache.id, location: { r0: row, c0: col, r1: row, c1: col }, ...cmd.fields };
        this.tables.set(id, { sheet, t });
        return { sheet, coords: this.render(id), ...(activate !== undefined ? { activate } : {}), inverse };
      }
      case "updatePivot": {
        const e = this.get(cmd.id);
        const p = cmd.patch;
        const t: PivotTable = { ...e.t, ...(p.name !== undefined ? { name: p.name } : {}), ...(p.rows ? { rows: p.rows } : {}), ...(p.cols ? { cols: p.cols } : {}), ...(p.values ? { values: p.values } : {}), ...(p.filters ? { filters: p.filters } : {}), ...(p.options ? { options: p.options } : {}) };
        if (p.layout) t.rows = (t.rows ?? []).map((a) => ({ ...a, layout: p.layout }));
        e.t = t;
        return { sheet: e.sheet, coords: this.render(cmd.id), inverse };
      }
      case "refreshPivot": {
        const ids = cmd.id === null ? [...this.tables.keys()] : [cmd.id];
        let sheet = activeSheet;
        const coords: [number, number][] = [];
        for (const id of ids) {
          const e = this.get(id);
          const old = this.cache(e.t.cacheId);
          const fresh = this.readCache(old.sheet, old.range, old.id);
          Object.assign(old, fresh);
          sheet = e.sheet;
          coords.push(...this.render(id));
        }
        return { sheet, coords, inverse };
      }
      case "deletePivot": {
        const e = this.get(cmd.id);
        const coords = this.clear(cmd.id);
        this.tables.delete(cmd.id);
        this.outs.delete(cmd.id);
        return { sheet: e.sheet, coords, inverse };
      }
      case "movePivot": {
        const e = this.get(cmd.id);
        const coords = this.clear(cmd.id);
        if (cmd.target.kind === "cell") {
          e.sheet = cmd.target.sheet;
          e.t = { ...e.t, location: { r0: cmd.target.row, c0: cmd.target.col, r1: cmd.target.row, c1: cmd.target.col } };
        }
        return { sheet: e.sheet, coords: [...coords, ...this.render(cmd.id)], inverse };
      }
      case "expandCollapse": {
        const e = this.get(cmd.id);
        const upd = (a: AxisField): AxisField => {
          if (a.field !== cmd.field) return a;
          const all = cmd.item === null ? this.cache(e.t.cacheId).items[a.field]!.map((_, i) => i) : [cmd.item];
          const set = new Set(a.collapsedItems ?? []);
          for (const i of all) {
            if (cmd.collapsed) set.add(i);
            else set.delete(i);
          }
          return { ...a, collapsedItems: [...set].sort((x, y) => x - y) };
        };
        e.t = { ...e.t, rows: (e.t.rows ?? []).map(upd), cols: (e.t.cols ?? []).map(upd) };
        return { sheet: e.sheet, coords: this.render(cmd.id), inverse };
      }
      case "setPageFilter": {
        const e = this.get(cmd.id);
        e.t = { ...e.t, filters: (e.t.filters ?? []).map((p) => (p.field === cmd.field ? { field: p.field, ...(cmd.selected ? { selected: { kind: "items" as const, items: cmd.selected } } : {}) } : p)) };
        return { sheet: e.sheet, coords: this.render(cmd.id), inverse };
      }
      case "restorePivots": {
        const json = cmd.sheets[0]?.pivots[0] as unknown;
        const coords: [number, number][] = [];
        const sheets = new Set<number>();
        for (const id of this.tables.keys()) {
          sheets.add(this.tables.get(id)!.sheet);
          coords.push(...this.clear(id));
        }
        this.restore(json as string);
        for (const id of this.tables.keys()) {
          sheets.add(this.tables.get(id)!.sheet);
          coords.push(...this.render(id));
        }
        return { sheet: [...sheets][0] ?? activeSheet, coords, inverse };
      }
      default:
        throw new Error(`fake: not a pivot command: ${cmd.type}`);
    }
  }

  private state(): string {
    return JSON.stringify({ tables: [...this.tables.entries()], caches: this.caches, nextId: this.nextId, nextCache: this.nextCache });
  }

  private restore(json: string): void {
    const s = JSON.parse(json) as { tables: [number, { sheet: number; t: PivotTable }][]; caches: Cache[]; nextId: number; nextCache: number };
    this.tables = new Map(s.tables);
    this.caches = s.caches;
    this.nextId = s.nextId;
    this.nextCache = s.nextCache;
    this.outs.clear();
  }

  private get(id: number) {
    const e = this.tables.get(id);
    if (!e) throw new Error(`unknown pivot ${id}`);
    return e;
  }

  /** The current region of a cell (the data block around it). */
  private region(sheet: number, row: number, col: number): Rect {
    const filled = (r: number, c: number) => r >= 0 && c >= 0 && this.host.read(sheet, r, c) !== "";
    let r = { r0: row, c0: col, r1: row, c1: col };
    for (let grew = true; grew; ) {
      grew = false;
      const next = { ...r };
      for (let c = r.c0 - 1; c <= r.c1 + 1; c++) {
        if (filled(r.r0 - 1, c)) next.r0 = r.r0 - 1;
        if (filled(r.r1 + 1, c)) next.r1 = r.r1 + 1;
      }
      for (let k = r.r0 - 1; k <= r.r1 + 1; k++) {
        if (filled(k, r.c0 - 1)) next.c0 = r.c0 - 1;
        if (filled(k, r.c1 + 1)) next.c1 = r.c1 + 1;
      }
      if (JSON.stringify(next) !== JSON.stringify(r)) {
        r = next;
        grew = true;
      }
    }
    return r;
  }

  private clear(id: number): [number, number][] {
    const o = this.outs.get(id);
    if (!o) return [];
    const coords: [number, number][] = [];
    for (const k of o.roles.keys()) {
      const [r, c] = k.split(",").map(Number) as [number, number];
      this.host.write(o.sheet, r, c, "");
      coords.push([r, c]);
    }
    o.roles.clear();
    return coords;
  }

  /** Recomputes and writes table `id`; returns every cell it touched (old and new). */
  private render(id: number): [number, number][] {
    const { sheet, t } = this.get(id);
    const old = this.clear(id);
    const out = this.compute(t, this.cache(t.cacheId), sheet);
    this.outs.set(id, out);
    for (const [k, input] of out.inputs) {
      const [r, c] = k.split(",").map(Number) as [number, number];
      this.host.write(sheet, r, c, input);
    }
    const coords = [...old, ...[...out.roles.keys()].map((k) => k.split(",").map(Number) as [number, number])];
    return coords;
  }

  caption(d: DataField, cache: Cache): string {
    return d.name ? d.name : `${CAPTION[d.func ?? "sum"]} of ${cache.names[d.field]}`;
  }

  private compute(t: PivotTable, cache: Cache, sheet: number): Out {
    const roles = new Map<string, PivotCellView>();
    const inputs = new Map<string, string>();
    const put = (r: number, c: number, v: Raw | "", role: Omit<PivotCellView, "id">) => {
      roles.set(key(r, c), { id: t.id, ...role });
      if (v !== "") inputs.set(key(r, c), String(v));
    };
    const ar = t.location.r0, ac = t.location.c0;
    const filters = t.filters ?? [];
    filters.forEach((p, i) => {
      put(ar + i, ac, cache.names[p.field]!, { kind: "header", level: 0, field: p.field });
      const sel = p.selected?.kind === "items" ? p.selected.items : null;
      put(ar + i, ac + 1, sel === null ? "(All)" : sel.length === 1 ? label(cache.items[p.field]![sel[0]!]!) : "(Multiple Items)", { kind: "page", level: 0, field: p.field });
    });
    const tr = ar + (filters.length ? filters.length + 1 : 0);
    const tc = ac;
    const rows = t.rows ?? [];
    const cols = (t.cols ?? []).slice(0, 1);
    const values = t.values ?? [];
    if (!rows.length && !cols.length && !values.length && !filters.length) {
      for (let r = 0; r < 18; r++) for (let c = 0; c < 3; c++) put(tr + r, tc + c, "", { kind: "blank", level: 0 });
      return { sheet, roles, inputs, location: { r0: ar, c0: ac, r1: tr + 17, c1: tc + 2 }, table: { r0: tr, c0: tc, r1: tr + 17, c1: tc + 2 } };
    }
    const hidden = new Map<number, Set<number>>();
    for (const a of [...rows, ...cols]) hidden.set(a.field, new Set(a.hiddenItems ?? []));
    const records = cache.records.filter((rec) => {
      for (const [f, h] of hidden) if (h.has(rec[f]!)) return false;
      for (const p of filters) if (p.selected?.kind === "items" && !p.selected.items.includes(rec[p.field]!)) return false;
      return true;
    });
    const itemsOf = (field: number, recs: number[][]) => [...new Set(recs.map((r) => r[field]!))].sort((a, b) => cmp(cache.items[field]![a]!, cache.items[field]![b]!));
    const agg = (recs: number[][], d: DataField): Raw | "" => {
      const nums = recs.map((r) => cache.items[d.field]![r[d.field]!]).filter((v): v is number => typeof v === "number");
      switch (d.func ?? "sum") {
        case "count":
          return recs.filter((r) => cache.items[d.field]![r[d.field]!] !== "").length;
        case "average":
          return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : "#DIV/0!";
        case "max":
          return nums.length ? Math.max(...nums) : 0;
        case "min":
          return nums.length ? Math.min(...nums) : 0;
        default:
          return nums.reduce((a, b) => a + b, 0);
      }
    };
    // Column lines: [col item | null (grand total)] × data fields.
    const colItems = cols.length ? itemsOf(cols[0]!.field, records) : [];
    const lines: { item: number | null; d: number }[] = [];
    if (cols.length) {
      for (const it of colItems) values.forEach((_, d) => lines.push({ item: it, d }));
      if (t.options?.grandTotalRows !== false) values.forEach((_, d) => lines.push({ item: null, d }));
    } else values.forEach((_, d) => lines.push({ item: null, d }));
    const labelCols = rows.length || cols.length ? 1 : 0;
    const dataCol = tc + labelCols;
    let r = tr;
    const single = values.length === 1 ? this.caption(values[0]!, cache) : null;
    if (cols.length) {
      if (single) put(r, tc, single, { kind: "header", level: 0 });
      put(r, dataCol, "Column Labels", { kind: "header", level: 0 });
      r++;
      put(r, tc, rows.length ? "Row Labels" : "", { kind: rows.length ? "header" : "blank", level: 0 });
      lines.forEach((l, j) => {
        const text = l.item === null ? (values.length > 1 ? `Total ${this.caption(values[l.d]!, cache)}` : "Grand Total") : values.length > 1 ? `${label(cache.items[cols[0]!.field]![l.item]!)} – ${this.caption(values[l.d]!, cache)}` : label(cache.items[cols[0]!.field]![l.item]!);
        put(r, dataCol + j, text, l.item === null ? { kind: "grandTotal", level: 0 } : { kind: "colLabel", level: 0, field: cols[0]!.field, item: l.item });
      });
    } else {
      if (rows.length) put(r, tc, "Row Labels", { kind: "header", level: 0 });
      lines.forEach((l, j) => put(r, dataCol + j, this.caption(values[l.d]!, cache), { kind: "header", level: 0 }));
    }
    r++;
    const valueCells = (row: number, recs: number[][], kind: "value" | "subtotal" | "grandTotal", level: number) => {
      lines.forEach((l, j) => {
        const sub = l.item === null ? recs : recs.filter((x) => x[cols[0]!.field] === l.item);
        const v = sub.length ? agg(sub, values[l.d]!) : "";
        put(row, dataCol + j, v, v === "" ? { kind: "blank", level } : { kind, level });
      });
    };
    const walk = (level: number, recs: number[][]) => {
      const a = rows[level]!;
      for (const it of itemsOf(a.field, recs)) {
        const sub = recs.filter((x) => x[a.field] === it);
        const inner = level < rows.length - 1;
        const collapsed = inner && (a.collapsedItems ?? []).includes(it);
        put(r, tc, label(cache.items[a.field]![it]!), { kind: "rowLabel", level, field: a.field, item: it, ...(inner ? { collapsed } : {}) });
        valueCells(r, sub, inner ? "subtotal" : "value", level);
        r++;
        if (inner && !collapsed) walk(level + 1, sub);
      }
    };
    if (rows.length) walk(0, records);
    else if (values.length) {
      valueCells(r, records, cols.length ? "value" : "value", 0);
      r++;
    }
    if (rows.length && t.options?.grandTotalCols !== false && values.length) {
      put(r, tc, "Grand Total", { kind: "grandTotal", level: 0 });
      valueCells(r, records, "grandTotal", 0);
      r++;
    }
    const width = Math.max(1, labelCols + lines.length);
    const table = { r0: tr, c0: tc, r1: Math.max(tr, r - 1), c1: tc + width - 1 };
    for (let rr = table.r0; rr <= table.r1; rr++) for (let cc = table.c0; cc <= table.c1; cc++) if (!roles.has(key(rr, cc))) put(rr, cc, "", { kind: "blank", level: 0 });
    return { sheet, roles, inputs, location: { r0: ar, c0: ac, r1: table.r1, c1: Math.max(table.c1, filters.length ? ac + 1 : ac) }, table };
  }

  info(id: number): PivotInfo {
    const { sheet, t } = this.get(id);
    const cache = this.cache(t.cacheId);
    return {
      sheet,
      table: JSON.parse(JSON.stringify({ ...t, location: this.outs.get(id)?.location ?? t.location })) as PivotTable,
      source: { kind: "range", sheet: this.host.sheetName(cache.sheet), ...cache.range },
      fields: cache.names.map((name, index) => {
        const area = (t.rows ?? []).some((a) => a.field === index) ? "rows" as const : (t.cols ?? []).some((a) => a.field === index) ? "columns" as const : (t.filters ?? []).some((p) => p.field === index) ? "filters" as const : undefined;
        return { index, name, kind: cache.kinds[index]!, items: cache.items[index]!.length, ...(area ? { area } : {}), value: (t.values ?? []).some((d) => d.field === index) };
      }),
      captions: (t.values ?? []).map((d) => this.caption(d, cache)),
      ...(cache.stale ? { stale: true } : {}),
    };
  }

  at(sheet: number, row: number, col: number): { id: number; name: string; cell?: PivotCellView } | null {
    for (const [id, o] of this.outs) {
      if (o.sheet !== sheet) continue;
      const l = o.location;
      if (row < l.r0 || row > l.r1 || col < l.c0 || col > l.c1) continue;
      const cell = o.roles.get(key(row, col));
      return { id, name: this.get(id).t.name, ...(cell ? { cell } : {}) };
    }
    return null;
  }

  items(id: number, field: number): PivotItemInfo[] {
    const { t } = this.get(id);
    const cache = this.cache(t.cacheId);
    const axis = [...(t.rows ?? []), ...(t.cols ?? [])].find((a) => a.field === field);
    const page = (t.filters ?? []).find((p) => p.field === field);
    const present = new Set(cache.records.map((r) => r[field]!));
    return cache.items[field]!
      .map((v, index) => ({ v, index }))
      .sort((a, b) => cmp(a.v, b.v))
      .map(({ v, index }) => {
        const value: PivotItem = typeof v === "number" ? { t: "number", v } : v === "" ? { t: "blank" } : { t: "text", v };
        const checked = axis ? !(axis.hiddenItems ?? []).includes(index) : page?.selected?.kind === "items" ? page.selected.items.includes(index) : true;
        return { index, label: label(v), value, checked, ...(axis && (axis.collapsedItems ?? []).includes(index) ? { collapsed: true } : {}), hasData: present.has(index) };
      });
  }
}
