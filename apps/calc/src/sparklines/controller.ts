// Calc's sparklines (P9-C6): the groups and data per sheet (`sheetSparklines`,
// refetched when a patch lists the sheet in `sparklineSheets`, debounced), the
// pure group operations of Insert › Sparklines and the Sparkline tab (insert,
// edit data, type, show points, style, colours, axis, group / ungroup, clear)
// and the command that stores them (`setSparklineGroups`, one undo step each).

import type { SparklineGroup } from "../generated/SparklineGroup";
import type { SparklineGroupView } from "../generated/SparklineGroupView";
import type { SparklineKind } from "../generated/SparklineKind";
import type { Sparkline } from "../generated/Sparkline";
import { colName, sheetPrefix } from "../grid/address";
import { normalize, type Range } from "../grid/Selection";
import { t } from "../i18n";
import type { CalcStore } from "../state/store";
import { parseRange, type SheetRange } from "../charts/refs";

/** A sparkline reference as Excel stores it: `Sheet1!B2:E2` (relative, sheet-qualified). */
export function sparkRef(sheet: string, r: { r0: number; c0: number; r1: number; c1: number }): string {
  const a = `${colName(r.c0)}${r.r0 + 1}`;
  const b = `${colName(r.c1)}${r.r1 + 1}`;
  return `${sheetPrefix(sheet)}${a === b ? a : `${a}:${b}`}`;
}

export type SparkError = "dataInvalid" | "locationInvalid" | "locationLine" | "mismatch";

/**
 * Insert › Sparklines (Excel's rules): the location is one cell, or a single row or column of cells; with several
 * location cells each gets a row (location in a column) or a column (location in a row) of the data range.
 * `host`: the sheet of references without a sheet name.
 */
export function planSparklines(dataText: string, locText: string, host: string): { sparklines: Sparkline[] } | { error: SparkError } {
  const data = parseRange(dataText);
  if (!data) return { error: "dataInvalid" };
  const loc = parseRange(locText);
  if (!loc || (loc.sheet !== null && loc.sheet.toLowerCase() !== host.toLowerCase())) return { error: "locationInvalid" };
  const dsheet = data.sheet ?? host;
  const rows = data.r1 - data.r0 + 1;
  const cols = data.c1 - data.c0 + 1;
  const lrows = loc.r1 - loc.r0 + 1;
  const lcols = loc.c1 - loc.c0 + 1;
  if (lrows > 1 && lcols > 1) return { error: "locationLine" };
  const cells: { row: number; col: number }[] = [];
  for (let r = loc.r0; r <= loc.r1; r++) for (let c = loc.c0; c <= loc.c1; c++) cells.push({ row: r, col: c });
  const n = cells.length;
  const out: Sparkline[] = [];
  if (n === 1) {
    if (rows > 1 && cols > 1) return { error: "mismatch" };
    out.push({ ...cells[0]!, data: sparkRef(dsheet, data) });
  } else if (lcols === 1) {
    // A column of locations: one data row each (or one column each when the counts match the columns).
    if (rows === n) cells.forEach((c, i) => out.push({ ...c, data: sparkRef(dsheet, { r0: data.r0 + i, c0: data.c0, r1: data.r0 + i, c1: data.c1 }) }));
    else if (cols === n) cells.forEach((c, i) => out.push({ ...c, data: sparkRef(dsheet, { r0: data.r0, c0: data.c0 + i, r1: data.r1, c1: data.c0 + i }) }));
    else return { error: "mismatch" };
  } else {
    if (cols === n) cells.forEach((c, i) => out.push({ ...c, data: sparkRef(dsheet, { r0: data.r0, c0: data.c0 + i, r1: data.r1, c1: data.c0 + i }) }));
    else if (rows === n) cells.forEach((c, i) => out.push({ ...c, data: sparkRef(dsheet, { r0: data.r0 + i, c0: data.c0, r1: data.r0 + i, c1: data.c1 }) }));
    else return { error: "mismatch" };
  }
  return { sparklines: out };
}

/** The bounding range of a group's locations and of its data (Edit Group Location & Data). */
export function groupRanges(g: SparklineGroup): { data: string; location: string } {
  const locs = g.sparklines;
  const r0 = Math.min(...locs.map((s) => s.row));
  const r1 = Math.max(...locs.map((s) => s.row));
  const c0 = Math.min(...locs.map((s) => s.col));
  const c1 = Math.max(...locs.map((s) => s.col));
  const loc = `${colName(c0)}${r0 + 1}${r0 === r1 && c0 === c1 ? "" : `:${colName(c1)}${r1 + 1}`}`;
  const ranges = locs.map((s) => parseRange(s.data)).filter((r): r is SheetRange => r !== null);
  if (!ranges.length) return { data: locs[0]?.data ?? "", location: loc };
  const d = { r0: Math.min(...ranges.map((r) => r.r0)), c0: Math.min(...ranges.map((r) => r.c0)), r1: Math.max(...ranges.map((r) => r.r1)), c1: Math.max(...ranges.map((r) => r.c1)) };
  const sheet = ranges[0]!.sheet;
  return { data: sheet ? sparkRef(sheet, d) : `${colName(d.c0)}${d.r0 + 1}:${colName(d.c1)}${d.r1 + 1}`, location: loc };
}

const inRange = (s: Sparkline, r: Range) => s.row >= r.r0 && s.row <= r.r1 && s.col >= r.c0 && s.col <= r.c1;

/** The indices of the groups with a sparkline in the selection. */
export function groupsIn(groups: readonly SparklineGroup[], sel: Range): number[] {
  return groups.map((g, i) => (g.sparklines.some((s) => inRange(s, sel)) ? i : -1)).filter((i) => i >= 0);
}

/** Group: the selected sparklines' groups become one group with the formatting of `lead`'s. */
export function groupSelected(groups: readonly SparklineGroup[], sel: Range, lead: number): SparklineGroup[] {
  const hit = new Set(groupsIn(groups, sel));
  if (hit.size < 2) return [...groups];
  const base = groups[lead] ?? groups[[...hit][0]!]!;
  const merged: SparklineGroup = { ...base, sparklines: [...hit].flatMap((i) => groups[i]!.sparklines) };
  const out: SparklineGroup[] = [];
  groups.forEach((g, i) => {
    if (i === [...hit][0]) out.push(merged);
    else if (!hit.has(i)) out.push(g);
  });
  return out;
}

/** Ungroup: every selected group splits into one group per sparkline (same formatting). */
export function ungroupSelected(groups: readonly SparklineGroup[], sel: Range): SparklineGroup[] {
  const hit = new Set(groupsIn(groups, sel));
  return groups.flatMap((g, i) => (hit.has(i) ? g.sparklines.map((s) => ({ ...g, sparklines: [s] })) : [g]));
}

/** Clear Selected Sparklines / Clear Selected Sparkline Groups. */
export function clearSelected(groups: readonly SparklineGroup[], sel: Range, whole: boolean): SparklineGroup[] {
  const hit = new Set(groupsIn(groups, sel));
  return groups
    .map((g, i) => (!hit.has(i) ? g : whole ? null : { ...g, sparklines: g.sparklines.filter((s) => !inRange(s, sel)) }))
    .filter((g): g is SparklineGroup => g !== null && g.sparklines.length > 0);
}

/** Applies `fn` to the groups with a sparkline in the selection (the Sparkline tab's formatting). */
export function editSelected(groups: readonly SparklineGroup[], sel: Range, fn: (g: SparklineGroup) => SparklineGroup): SparklineGroup[] {
  const hit = new Set(groupsIn(groups, sel));
  return groups.map((g, i) => (hit.has(i) ? fn(g) : g));
}

/** Removes the sparklines at `cells` from the other groups (a cell holds one sparkline) and appends `g`. */
export function withGroup(groups: readonly SparklineGroup[], g: SparklineGroup, replace?: number): SparklineGroup[] {
  const taken = new Set(g.sparklines.map((s) => `${s.row}:${s.col}`));
  const out = groups
    .filter((_, i) => i !== replace)
    .map((x) => ({ ...x, sparklines: x.sparklines.filter((s) => !taken.has(`${s.row}:${s.col}`)) }))
    .filter((x) => x.sparklines.length > 0);
  if (replace !== undefined && replace >= 0 && replace <= out.length) out.splice(replace, 0, g);
  else out.push(g);
  return out;
}

export class SparklineController {
  private lists = new Map<number, SparklineGroupView[]>();
  private fetching = new Map<number, Promise<SparklineGroupView[]>>();
  private pending = new Set<number>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  refreshDelay = 40;

  constructor(private readonly store: CalcStore) {}

  reset(): void {
    this.lists.clear();
    this.fetching.clear();
  }

  dropSheet(sheet: number): void {
    this.lists.delete(sheet);
  }

  /** The groups of `sheet` with their data (from the region snapshots and `sheetSparklines`). */
  views(sheet: number): SparklineGroupView[] {
    return this.lists.get(sheet) ?? [];
  }

  /** A region snapshot's `sparklines` (every group of the sheet). */
  fromSnapshot(sheet: number, views: SparklineGroupView[]): void {
    const before = this.lists.get(sheet);
    if (before && JSON.stringify(before) === JSON.stringify(views)) return;
    this.lists.set(sheet, views);
  }

  groups(sheet: number): SparklineGroup[] {
    return this.views(sheet).map((v) => v.group);
  }

  refresh(sheet: number): Promise<SparklineGroupView[]> {
    let p = this.fetching.get(sheet);
    if (!p) {
      p = this.store.api
        .sheetSparklines(sheet)
        .then((list) => {
          const before = this.lists.get(sheet);
          this.lists.set(sheet, list);
          if (!before || JSON.stringify(before) !== JSON.stringify(list)) this.store.notify();
          return list;
        })
        .catch(() => {
          // Keep what we had (or nothing): a failed request must not be retried on every frame.
          const keep = this.lists.get(sheet) ?? [];
          this.lists.set(sheet, keep);
          return keep;
        })
        .finally(() => this.fetching.delete(sheet));
      this.fetching.set(sheet, p);
    }
    return p;
  }

  async ensure(sheet: number): Promise<SparklineGroupView[]> {
    return this.lists.get(sheet) ?? this.refresh(sheet);
  }

  /** Patch with `sparklineSheets` (debounced refetch of the known sheets and the active one). */
  invalidate(sheets: readonly number[]): void {
    for (const s of sheets) this.pending.add(s);
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      const list = [...this.pending];
      this.pending.clear();
      const active = this.store.getState().activeSheet;
      for (const s of list) if (s === active || this.lists.has(s)) void this.refresh(s);
    }, this.refreshDelay);
  }

  /** The sparkline at a cell: group index, sparkline index, the group and the data. */
  at(sheet: number, row: number, col: number): { gi: number; si: number; view: SparklineGroupView } | null {
    const views = this.views(sheet);
    for (let gi = 0; gi < views.length; gi++) {
      const si = views[gi]!.group.sparklines.findIndex((s) => s.row === row && s.col === col);
      if (si >= 0) return { gi, si, view: views[gi]! };
    }
    return null;
  }

  /** The sparkline of the active cell (the Sparkline tab shows while one is selected). */
  active(): { gi: number; si: number; view: SparklineGroupView } | null {
    const st = this.store.getState();
    const a = st.selection.anchor;
    return this.at(st.activeSheet, a.row, a.col);
  }

  /** Whether the selection contains a sparkline. */
  selected(): boolean {
    const st = this.store.getState();
    return groupsIn(this.groups(st.activeSheet), normalize(st.selection)).length > 0;
  }

  /** Stores the groups of `sheet` (one undo step). */
  set(sheet: number, groups: SparklineGroup[]): Promise<void> {
    return this.store.apply({ type: "setSparklineGroups", sheet, groups });
  }

  /** Edits the active sheet's groups with `fn` of the list and the selection. */
  edit(fn: (groups: SparklineGroup[], sel: Range, lead: number) => SparklineGroup[]): Promise<void> {
    const st = this.store.getState();
    const groups = this.groups(st.activeSheet);
    const lead = this.active()?.gi ?? groupsIn(groups, normalize(st.selection))[0] ?? -1;
    const next = fn(groups, normalize(st.selection), lead);
    if (JSON.stringify(next) === JSON.stringify(groups)) return Promise.resolve();
    return this.set(st.activeSheet, next);
  }

  /** Formatting of the selected groups. */
  format(patch: Partial<SparklineGroup> | ((g: SparklineGroup) => SparklineGroup)): Promise<void> {
    return this.edit((groups, sel) => editSelected(groups, sel, typeof patch === "function" ? patch : (g) => ({ ...g, ...patch })));
  }

  /** Insert › Sparklines OK: a new group (`replace`: the group the Edit Data dialog edits). Returns an error message or null. */
  async insert(kind: SparklineKind, dataText: string, locText: string, replace?: number): Promise<string | null> {
    const st = this.store.getState();
    const sheet = st.activeSheet;
    const host = st.info?.sheets.find((s) => s.id === sheet)?.name ?? "Sheet1";
    const plan = planSparklines(dataText, locText, host);
    if ("error" in plan) return t(`calc.spark.err.${plan.error}`);
    const groups = this.groups(sheet);
    const old = replace !== undefined ? groups[replace] : undefined;
    const group: SparklineGroup = old ? { ...old, sparklines: plan.sparklines } : { kind, sparklines: plan.sparklines };
    if (kind !== "line" || old) group.kind = old ? old.kind : kind;
    await this.set(sheet, withGroup(groups, group, replace));
    return null;
  }

  /** Edit Single Sparkline's Data: the data of the active cell's sparkline. */
  async editSingle(dataText: string): Promise<string | null> {
    const a = this.active();
    if (!a) return null;
    const st = this.store.getState();
    const host = st.info?.sheets.find((s) => s.id === st.activeSheet)?.name ?? "Sheet1";
    const r = parseRange(dataText);
    if (!r || (r.r0 !== r.r1 && r.c0 !== r.c1)) return t("calc.spark.err.dataInvalid");
    const groups = this.groups(st.activeSheet).map((g, gi) =>
      gi !== a.gi ? g : { ...g, sparklines: g.sparklines.map((s, si) => (si === a.si ? { ...s, data: sparkRef(r.sheet ?? host, r) } : s)) },
    );
    await this.set(st.activeSheet, groups);
    return null;
  }
}
