// Pivot tables in the Calc UI (P8-33): the tables of each sheet (from the
// region snapshots), the field lists (`pivotInfo`), the stale list, the
// field pane's state (open, deferred layout), the grid's looks and buttons
// and every pivot command. It lives on the store (`store.pivots`) and
// redraws through the store's version.

import type { CalcCommand } from "../generated/CalcCommand";
import type { CellView } from "../generated/CellView";
import type { PivotInfo } from "../generated/PivotInfo";
import type { PivotItemInfo } from "../generated/PivotItemInfo";
import type { PivotPatch } from "../generated/PivotPatch";
import type { PivotSourceSpec } from "../generated/PivotSourceSpec";
import type { PivotSummary } from "../generated/PivotSummary";
import type { PivotTarget } from "../generated/PivotTarget";
import type { PivotFields } from "../generated/PivotFields";
import type { GroupSpec } from "../generated/GroupSpec";
import { emptyChart } from "../charts/controller";
import { DEFAULT_CHART_H, DEFAULT_CHART_W, rectToAnchor } from "../charts/anchor";
import type { Rect } from "../generated/Rect";
import type { AxisGeometry } from "../grid/geometry";
import { cellSelection, normalize } from "../grid/Selection";
import { fontCss, styleAt } from "../grid/style";
import { CELL_PADDING, INDENT_PX } from "../grid/render";
import { pxToChars } from "../state/store";
import { t } from "../i18n";
import type { CalcStore } from "../state/store";
import { buttonAt, dropTarget, pivotButtons, type DropTarget, type PivotButton } from "./buttons";
import {
  captionOf, coversPivot, getPivotDataFormula, isFiltered, layoutOf, patchOf, pivotDataKey, selectedItems, selectRegion, touchesPivot, type CellAt, type PaneLayout,
} from "./model";
import { BUTTON_ROOM, isEmptyTable, pivotLooks, type PivotLook } from "./styles";

/** Room for a dropdown button at a header's right edge, px. */
const DROP_ROOM = 18;

/**
 * `setColWidth`s that widen the columns whose pivot cells (from a patch)
 * do not fit: the text in bold (headers and totals are), the indent, the
 * −/+ button and a header's dropdown. Columns never shrink.
 */
export function fitCommands(store: CalcStore, cells: readonly CellView[]): CalcCommand[] {
  const sheet = store.getState().activeSheet;
  const styles = store.styles();
  const need = new Map<number, number>();
  for (const c of cells) {
    if (!c.pivot || c.display === "") continue;
    const style = styleAt(styles, c.style);
    if (style.alignment?.wrapText) continue;
    const bold = fontCss({ ...style, font: { ...(style.font ?? {}), bold: true } });
    let w = store.measure(c.display, bold) + 2 * CELL_PADDING + 3 + (style.alignment?.indent ?? 0) * INDENT_PX;
    if (c.pivot.collapsed !== undefined) w += BUTTON_ROOM;
    if (dropTarget(c)) w += DROP_ROOM;
    need.set(c.col, Math.max(need.get(c.col) ?? 0, w));
  }
  const geo = store.geometry(sheet);
  const out: CalcCommand[] = [];
  for (const [col, w] of [...need].sort((a, b) => a[0] - b[0])) {
    if (w > geo.col.size(col) + 0.5) out.push({ type: "setColWidth", sheet, col, width: pxToChars(Math.ceil(w)) });
  }
  return out;
}

export class PivotController {
  private lists = new Map<number, PivotSummary[]>();
  private infos = new Map<number, PivotInfo>();
  private fetching = new Map<number, Promise<void>>();
  /** Tables whose source changed since their last refresh. */
  stale = new Set<number>();
  /** Analyze › Field List: the PivotTable Fields pane is shown while a pivot cell is selected. */
  pane = true;
  /** The pane was opened for a table (Insert › PivotTable, Field List). */
  paneFor: number | null = null;
  /** Defer Layout Update: the pane edits `draft`, Update sends it. */
  defer = false;
  draft: { id: number; layout: PaneLayout } | null = null;
  /** A contextual tab requested for a table that is not shown yet (Insert › PivotTable). */
  pendingTab: string | null = null;
  /** Analyze › +/- Buttons. */
  buttons = true;
  /** Analyze › Options ▾ › Generate GetPivotData (on by default, as in Excel). */
  getPivotData = true;
  private lookMemo: { sheet: number; version: number; fn: (cell: CellView | undefined, row: number, col: number) => PivotLook | undefined } | null = null;

  constructor(private readonly store: CalcStore) {}

  private notify(): void {
    this.store.notify();
  }

  /** New document: forget everything (`stale`: the opened file's stale tables). */
  reset(stale: readonly number[] = []): void {
    this.lists.clear();
    this.infos.clear();
    this.fetching.clear();
    this.stale = new Set(stale);
    this.draft = null;
    this.paneFor = null;
  }

  /** A region snapshot's table list (every table of the sheet). */
  fromSnapshot(sheet: number, pivots: readonly PivotSummary[]): void {
    this.lists.set(sheet, pivots.map((p) => ({ ...p })));
    for (const p of pivots) if (p.stale) this.stale.add(p.id);
  }

  /** A patch's `pivotSheets`: the field lists of those sheets' tables are fetched again. */
  invalidate(sheets: readonly number[]): void {
    const set = new Set(sheets);
    for (const [id, info] of [...this.infos]) if (set.has(info.sheet)) this.infos.delete(id);
    for (const s of sheets) for (const p of this.lists.get(s) ?? []) this.infos.delete(p.id);
    this.draft = null;
    const active = this.active();
    if (active) void this.ensureInfo(active.id);
  }

  setStale(ids: readonly number[]): void {
    this.stale = new Set(ids);
    this.notify();
  }

  dropSheet(sheet: number): void {
    this.lists.delete(sheet);
  }

  /** The tables of `sheet` known so far. */
  of(sheet: number): PivotSummary[] {
    return this.lists.get(sheet) ?? [];
  }

  get(id: number): PivotSummary | undefined {
    for (const list of this.lists.values()) {
      const p = list.find((x) => x.id === id);
      if (p) return p;
    }
    return undefined;
  }

  /** The table containing a cell of the active sheet (page fields included). */
  tableAt(row: number, col: number, sheet = this.store.getState().activeSheet): PivotSummary | null {
    const cell = this.store.cache(sheet).cells.get(row)?.get(col);
    if (cell?.pivot) {
      const p = this.of(sheet).find((x) => x.id === cell.pivot!.id);
      if (p) return p;
    }
    return this.of(sheet).find((p) => row >= p.location.r0 && row <= p.location.r1 && col >= p.location.c0 && col <= p.location.c1) ?? null;
  }

  /** The table of the active cell (the contextual tabs and the pane follow it). */
  active(): PivotSummary | null {
    const st = this.store.getState();
    if (!st.info) return null;
    const a = this.store.activeAnchor();
    return this.tableAt(a.row, a.col);
  }

  /** The field list of table `id` (`null` until loaded; starts loading). */
  info(id: number): PivotInfo | null {
    const i = this.infos.get(id);
    if (!i) void this.ensureInfo(id);
    return i ?? null;
  }

  ensureInfo(id: number): Promise<void> {
    if (this.infos.has(id)) return Promise.resolve();
    let p = this.fetching.get(id);
    if (!p) {
      p = this.store.api.pivotInfo(id).then(
        (info) => {
          this.fetching.delete(id);
          this.infos.set(id, info);
          this.notify();
        },
        (e: unknown) => {
          this.fetching.delete(id);
          this.store.pushError(e);
        },
      );
      this.fetching.set(id, p);
    }
    return p;
  }

  /** Whether the pane shows (Field List on and a table selected). */
  paneShown(): PivotSummary | null {
    if (!this.pane) return null;
    return this.active();
  }

  togglePane(): void {
    this.pane = !this.pane;
    this.notify();
  }

  toggleButtons(): void {
    this.buttons = !this.buttons;
    this.notify();
  }

  /** The pane's current layout: the deferred draft, or the table's. */
  layout(id: number): PaneLayout | null {
    if (this.defer && this.draft?.id === id) return this.draft.layout;
    const info = this.info(id);
    return info ? layoutOf(info.table) : null;
  }

  /** A pane edit: sent at once, or kept until Update while the layout update is deferred. */
  setLayout(id: number, layout: PaneLayout): Promise<void> {
    if (this.defer) {
      this.draft = { id, layout };
      this.notify();
      return Promise.resolve();
    }
    const info = this.infos.get(id);
    if (!info) return Promise.resolve();
    const patch = patchOf(info.table, layout);
    return patch ? this.update(id, patch) : Promise.resolve();
  }

  /** Defer Layout Update on / off (turning it off sends a pending draft, as Excel's Update). */
  setDefer(on: boolean): Promise<void> {
    this.defer = on;
    const draft = this.draft;
    if (!on && draft) {
      this.draft = null;
      return this.setLayout(draft.id, draft.layout);
    }
    this.notify();
    return Promise.resolve();
  }

  /** Update (deferred layout): sends the draft. */
  flush(): Promise<void> {
    const draft = this.draft;
    if (!draft) return Promise.resolve();
    this.draft = null;
    const info = this.infos.get(draft.id);
    const patch = info && patchOf(info.table, draft.layout);
    this.notify();
    return patch ? this.update(draft.id, patch) : Promise.resolve();
  }

  // --- commands ---------------------------------------------------------------------------------

  /**
   * Insert › PivotTable: creates an empty table at `target` (a new sheet:
   * the core inserts it and names it in `activateSheet`), selects its first
   * cell, opens the field pane and shows PivotTable Analyze.
   */
  async create(source: PivotSourceSpec, target: PivotTarget, fields: PivotFields = {}, chart = false): Promise<boolean> {
    const store = this.store;
    let env;
    try {
      env = await store.api.apply({ type: "createPivot", source, target, fields });
    } catch (e) {
      store.pushError(e);
      return false;
    }
    store.applyEnvelope(env);
    const sheet = env.patch.activateSheet ?? (target.kind === "cell" ? target.sheet : store.getState().activeSheet);
    const [row, col] = target.kind === "cell" ? [target.row, target.col] : [2, 0];
    store.goToRange(sheet, { r0: row, c0: col, r1: row, c1: col });
    try {
      const at = await store.api.pivotAt(sheet, row, col);
      if (at) {
        this.paneFor = at.id;
        void this.ensureInfo(at.id);
        if (chart) await this.insertChart(at.id, sheet);
      }
    } catch (e) {
      store.pushError(e);
    }
    this.pane = true;
    this.pendingTab = "pivotAnalyze";
    store.requestRibbonTab("pivotAnalyze");
    this.notify();
    return true;
  }

  /** Autofit column widths on update (Excel's default): the columns of the written pivot cells grow to fit. */
  autofit = true;

  /** Applies a pivot command, then widens the columns its cells do not fit in (one more undo step, as Excel's autofit). */
  private async run(command: CalcCommand): Promise<void> {
    const store = this.store;
    let env;
    try {
      env = await store.api.apply(command);
    } catch (e) {
      store.pushError(e);
      return;
    }
    if (!store.applyEnvelope(env) || !this.autofit) return;
    const fit = fitCommands(store, env.patch.cells.find((g) => g.sheet === store.getState().activeSheet)?.cells ?? []);
    if (fit.length) await store.apply(fit.length === 1 ? fit[0]! : { type: "compound", commands: fit });
  }

  update(id: number, patch: PivotPatch): Promise<void> {
    return this.run({ type: "updatePivot", id, patch });
  }

  refresh(id: number | null): Promise<void> {
    return this.run({ type: "refreshPivot", id });
  }

  /** Refreshes the stale tables of the active sheet (the info bar's Refresh). */
  refreshStale(sheet = this.store.getState().activeSheet): Promise<void> {
    const ids = this.of(sheet).filter((p) => this.stale.has(p.id)).map((p) => p.id);
    if (ids.length === 0) return Promise.resolve();
    if (ids.length === 1) return this.refresh(ids[0]!);
    return this.run({ type: "compound", commands: ids.map((id) => ({ type: "refreshPivot", id })) });
  }

  remove(ids: readonly number[], alsoClear?: Rect): Promise<void> {
    const sheet = this.store.getState().activeSheet;
    const commands: CalcCommand[] = ids.map((id) => ({ type: "deletePivot", id }));
    if (alsoClear) commands.push({ type: "clearRange", sheet, ...alsoClear });
    return this.store.apply(commands.length === 1 ? commands[0]! : { type: "compound", commands });
  }

  move(id: number, target: PivotTarget): Promise<void> {
    return this.run({ type: "movePivot", id, target }).then(() => {
      if (target.kind === "cell") this.store.goToRange(target.sheet, { r0: target.row, c0: target.col, r1: target.row, c1: target.col });
    });
  }

  expandCollapse(id: number, field: number, item: number | null, collapsed: boolean): Promise<void> {
    return this.run({ type: "expandCollapse", id, field, item, collapsed });
  }

  setPageFilter(id: number, field: number, selected: number[] | null): Promise<void> {
    return this.run({ type: "setPageFilter", id, field, selected });
  }

  items(id: number, field: number): Promise<PivotItemInfo[]> {
    return this.store.api.pivotItems(id, field);
  }

  // --- P9-C3: grouping, calculations, filter pages, PivotCharts -------------------------------

  group(id: number, field: number, group: GroupSpec): Promise<void> {
    return this.run({ type: "groupPivotField", id, field, group });
  }

  ungroup(id: number, field: number, items?: number[]): Promise<void> {
    return this.run(items ? { type: "ungroupPivotField", id, field, items } : { type: "ungroupPivotField", id, field });
  }

  /** The label cells of one field in the selection (Group Selection / Ungroup). */
  selectedLabels(): { id: number; field: number; items: number[] } | null {
    const p = this.active();
    if (!p) return null;
    const st = this.store.getState();
    const r = normalize(st.selection);
    const rows = this.store.cache(st.activeSheet).cells;
    const cells = [];
    for (let row = r.r0; row <= Math.min(r.r1, p.location.r1); row++) {
      for (let col = r.c0; col <= Math.min(r.c1, p.location.c1); col++) cells.push(rows.get(row)?.get(col));
    }
    const sel = selectedItems(cells);
    return sel && { id: p.id, ...sel };
  }

  /**
   * Analyze › Group Selection: labels of a date or number field open the
   * Grouping dialog (Excel); labels of other fields become one group.
   */
  groupSelection(): void {
    const sel = this.selectedLabels();
    if (!sel) {
      this.store.pushError(new Error(t("calc.pivot.cantGroup")));
      return;
    }
    const f = this.info(sel.id)?.fields[sel.field];
    const ranged = f && (f.kind === "date" || f.kind === "number" || (f.group && f.group.kind !== "items"));
    if (ranged) this.store.openDialog({ kind: "pivotGroup", id: sel.id, field: sel.field });
    else void this.group(sel.id, sel.field, { kind: "items", items: sel.items });
  }

  /** Analyze › Ungroup: the selected groups of a manual group field, else the field's grouping. */
  ungroupSelection(): void {
    const sel = this.selectedLabels();
    const active = sel ? null : this.activeField();
    const id = sel?.id ?? active?.id;
    const field = sel?.field ?? active?.field;
    if (id === undefined || field === undefined) return;
    const g = this.info(id)?.fields[field]?.group;
    if (!g) {
      this.store.pushError(new Error(t("calc.pivot.notGrouped")));
      return;
    }
    // Group items with several members (`Group1`) are dissolved; otherwise the field's grouping goes.
    const groups = g.kind === "items" && sel ? sel.items.filter((i) => g.map.filter((x) => x === i).length > 1) : [];
    void this.ungroup(id, field, groups.length ? groups : undefined);
  }

  /**
   * Insert › PivotChart / Analyze › PivotChart: a clustered column chart
   * of table `id` right of it (Excel's default size), selected.
   */
  async insertChart(id: number, sheet = this.store.getState().activeSheet): Promise<void> {
    const p = this.of(sheet).find((x) => x.id === id);
    const store = this.store;
    const geo = store.geometry(sheet);
    const loc = p?.location ?? { r0: 0, c0: 0, r1: 0, c1: 0 };
    const rect = { x: geo.col.offset(loc.c1 + 2), y: geo.row.offset(loc.r0), w: DEFAULT_CHART_W, h: DEFAULT_CHART_H };
    const anchor = rectToAnchor(rect, "twoCell", geo.col, geo.row);
    const chart = { ...emptyChart(), legend: { position: "right" as const } };
    const revision = store.getState().revision;
    await store.apply({ type: "insertPivotChart", sheet, pivot: id, anchor, chart });
    if (store.getState().revision === revision) return;
    const list = await store.charts.refreshList(sheet);
    const added = list.filter((c) => c.pivot === id).pop();
    if (added && store.getState().activeSheet === sheet) store.charts.select(sheet, added.id, null);
    store.requestRibbonTab("chartDesign");
  }

  // --- the grid ---------------------------------------------------------------------------------

  private cellAt(sheet: number): CellAt {
    const cells = this.store.cache(sheet).cells;
    return (r, c) => cells.get(r)?.get(c);
  }

  /** The look function of `sheet`'s tables (memoized per cache version); `undefined` without tables. */
  looks(sheet: number): ((cell: CellView | undefined, row: number, col: number) => PivotLook | undefined) | undefined {
    const list = this.of(sheet);
    if (list.length === 0) return undefined;
    const version = this.store.getState().version;
    const m = this.lookMemo;
    if (m && m.sheet === sheet && m.version === version) return m.fn;
    const fn = pivotLooks(list, this.cellAt(sheet), this.buttons);
    this.lookMemo = { sheet, version, fn };
    return fn;
  }

  /** The −/+ and dropdown buttons of the pivot cells of `sheet` in rows `r0..=r1` × cols `c0..=c1`. */
  buttonsIn(sheet: number, colGeo: AxisGeometry, rowGeo: AxisGeometry, rect: Rect): PivotButton[] {
    const list = this.of(sheet);
    if (list.length === 0) return [];
    const cells = this.store.cache(sheet).cells;
    const picked: CellView[] = [];
    for (const p of list) {
      const l = p.location;
      for (let r = Math.max(l.r0, rect.r0); r <= Math.min(l.r1, rect.r1); r++) {
        const row = cells.get(r);
        if (!row) continue;
        for (let c = Math.max(l.c0, rect.c0); c <= Math.min(l.c1, rect.c1); c++) {
          const v = row.get(c);
          if (v?.pivot) picked.push(v);
        }
      }
    }
    const styles = this.store.styles();
    return pivotButtons(picked, colGeo, rowGeo, {
      expand: this.buttons,
      headers: true,
      indentOf: (cell) => styleAt(styles, cell.style).alignment?.indent ?? 0,
      filtered: (id, target) => this.dropFiltered(id, target),
      inTable: (id, row, col) => {
        const p = list.find((x) => x.id === id);
        return !!p && row >= p.table.r0 && row <= p.table.r1 && col >= p.table.c0 && col <= p.table.c1;
      },
    });
  }

  /** The button under a sheet point (`null`: none). */
  buttonAt(sheet: number, colGeo: AxisGeometry, rowGeo: AxisGeometry, x: number, y: number): PivotButton | null {
    if (this.of(sheet).length === 0) return null;
    const c = colGeo.indexAt(x), r = rowGeo.indexAt(y);
    return buttonAt(this.buttonsIn(sheet, colGeo, rowGeo, { r0: r, c0: Math.max(0, c - 1), r1: r, c1: c + 1 }), x, y);
  }

  private dropFiltered(id: number, target: DropTarget): boolean {
    const info = this.infos.get(id);
    if (!info) return false;
    const tbl = info.table;
    if (target.kind === "axis") return (target.axis === "rows" ? tbl.rows ?? [] : tbl.cols ?? []).some((a) => (a.hiddenItems?.length ?? 0) > 0);
    return isFiltered(tbl, target.field);
  }

  /** A press on a −/+ button: toggles the item. */
  pressExpand(b: Extract<PivotButton, { kind: "expand" }>): Promise<void> {
    return this.expandCollapse(b.id, b.field, b.item, !b.collapsed);
  }

  /** Double-click on a label with inner items toggles it (`false`: not such a label). */
  toggleLabel(row: number, col: number): boolean {
    const sheet = this.store.getState().activeSheet;
    const p = this.store.cache(sheet).cells.get(row)?.get(col)?.pivot;
    if (!p || p.collapsed === undefined || p.field === undefined || p.item === undefined) return false;
    void this.expandCollapse(p.id, p.field, p.item, !p.collapsed);
    return true;
  }

  /**
   * Show Details: a double-click on a value, subtotal or grand total cell
   * puts the records behind it on a new sheet (Excel). `true` when the
   * cell is such a cell.
   */
  showDetailsAt(row: number, col: number): boolean {
    const sheet = this.store.getState().activeSheet;
    const p = this.store.cache(sheet).cells.get(row)?.get(col)?.pivot;
    if (!p || !["value", "subtotal", "grandTotal"].includes(p.kind) || p.field !== undefined) return false;
    void this.runAndShow({ type: "showPivotDetails", id: p.id, row, col });
    return true;
  }

  /** Show Report Filter Pages of page field `field`: the new sheets, the first one shown. */
  filterPages(id: number, field: number): Promise<void> {
    return this.runAndShow({ type: "showReportFilterPages", id, field });
  }

  /** Applies a command that adds sheets and shows the one its patch names (Excel goes to the new sheet). */
  private async runAndShow(command: CalcCommand): Promise<void> {
    const store = this.store;
    let env;
    try {
      env = await store.api.apply(command);
    } catch (e) {
      store.pushError(e);
      return;
    }
    if (!store.applyEnvelope(env)) return;
    const sheet = env.patch.activateSheet;
    if (sheet !== undefined) store.goToRange(sheet, { r0: 0, c0: 0, r1: 0, c1: 0 });
  }

  /** The active cell's field (Active Field group): a label's, a field header's or a page cell's. */
  activeField(): { id: number; field: number; name: string } | null {
    const p = this.active();
    const cell = this.store.activeCell();
    const f = cell?.pivot?.field;
    if (!p || f === undefined) return null;
    const info = this.info(p.id);
    const name = info?.fields[f]?.name;
    return name === undefined ? null : { id: p.id, field: f, name };
  }

  /** Expand / Collapse Field: every item of the active field. */
  expandField(collapsed: boolean): Promise<void> {
    const f = this.activeField();
    return f ? this.expandCollapse(f.id, f.field, null, collapsed) : Promise.resolve();
  }

  /** Select ▾ of PivotTable Analyze. */
  select(what: "labels" | "values" | "entire"): void {
    const p = this.active();
    if (!p) return;
    const r = selectRegion(this.cellAt(this.store.getState().activeSheet), p, what);
    this.store.select({ anchor: { row: r.r0, col: r.c0 }, focus: { row: r.r1, col: r.c1 } });
  }

  /** Ctrl+A / Ctrl+Shift+* inside a table: selects the whole table (`false` outside). */
  selectWhole(): boolean {
    const p = this.active();
    if (!p) return false;
    const r = p.location;
    this.store.select(r.r0 === r.r1 && r.c0 === r.c1 ? cellSelection(r.r0, r.c0) : { anchor: { row: r.r0, col: r.c0 }, focus: { row: r.r1, col: r.c1 } });
    return true;
  }

  /**
   * Delete on a selection: a selection covering whole tables (and only
   * whole tables) asks to delete them; part of a table is refused with
   * Excel's message. `null`: no table involved.
   */
  deleteScope(): { ids: number[] } | "partial" | null {
    const r = normalize(this.store.getState().selection);
    const list = this.of(this.store.getState().activeSheet).filter((p) => touchesPivot(r, p));
    if (list.length === 0) return null;
    if (list.every((p) => coversPivot(r, p))) return { ids: list.map((p) => p.id) };
    return "partial";
  }

  /** Editing a cell of a table is refused with Excel's message (`true` when refused). */
  refuseEdit(): boolean {
    const a = this.store.activeAnchor();
    if (!this.tableAt(a.row, a.col)) return false;
    this.store.pushError(new Error(t("calc.pivot.cantChange")));
    return true;
  }

  /**
   * Generate GetPivotData: the formula for pointing at the value cell
   * `(row, col)` of the active sheet while a formula is edited (`null`:
   * not a value of a table, the option is off or the field list is not
   * loaded yet).
   */
  getPivotDataAt(row: number, col: number, editSheet: number): string | null {
    if (!this.getPivotData) return null;
    const st = this.store.getState();
    const sheet = st.activeSheet;
    const p = this.tableAt(row, col, sheet);
    if (!p) return null;
    const info = this.info(p.id);
    if (!info) return null;
    const key = pivotDataKey(this.cellAt(sheet), p, row, col);
    if (!key) return null;
    const values = info.table.values ?? [];
    const caption = key.caption ?? (values[0] ? captionOf(values[0], info.fields[values[0].field]?.name ?? "") : null);
    if (!caption) return null;
    const name = sheet !== editSheet ? (st.info?.sheets.find((s) => s.id === sheet)?.name ?? null) : null;
    const pairs = key.pairs.map((x) => ({ name: info.fields[x.field]?.name ?? "", item: x.item }));
    return getPivotDataFormula(caption, p.table, pairs, name);
  }

  /** The empty tables of `sheet` (no fields yet): their box and name, for the placeholder text. */
  placeholders(sheet: number): { rect: Rect; name: string }[] {
    const at = this.cellAt(sheet);
    return this.of(sheet).filter((p) => isEmptyTable(at, p)).map((p) => ({ rect: p.table, name: p.name }));
  }

  /** The tables of the active sheet that are stale (the info bar). */
  staleHere(): PivotSummary[] {
    return this.of(this.store.getState().activeSheet).filter((p) => this.stale.has(p.id));
  }
}
