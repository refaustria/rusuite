// Calc view-model store (ADR 0001: the frontend only holds a view of the
// Rust document). Hand-rolled on `useSyncExternalStore` instead of
// zustand: the state is one object plus a mutable sparse cache that is
// versioned rather than copied, which a tiny custom store expresses
// directly and without a new runtime dependency.

import { useSyncExternalStore } from "react";
import type { CellStylePatch } from "@rusuite/ui-shared";
import { CalcApiError, type CalcApi, type PatchEnvelope } from "../backend/calcApi";
import type { CalcCommand } from "../generated/CalcCommand";
import type { CalcPatch } from "../generated/CalcPatch";
import type { CellStyle } from "../generated/CellStyle";
import type { CellView } from "../generated/CellView";
import type { ColView } from "../generated/ColView";
import type { RegionSnapshot } from "../generated/RegionSnapshot";
import type { RowView } from "../generated/RowView";
import type { SheetFormat } from "../generated/SheetFormat";
import type { WorkbookInfo } from "../generated/WorkbookInfo";
import { AxisGeometry, colGeometry, DEFAULT_FORMAT, rowGeometry } from "../grid/geometry";
import { cellSelection, normalize, type NavContext, type Range, type Selection } from "../grid/Selection";
import { styleAt } from "../grid/style";

/** Snapshot blocks: 64 rows × 32 columns. */
export const BLOCK_ROWS = 64;
export const BLOCK_COLS = 32;
/** Backend limit for range commands (`model_sheet::MAX_PATCH_CELLS`). */
export const MAX_RANGE_CELLS = 1 << 22;

export interface SheetCache {
  cells: Map<number, Map<number, CellView>>;
  cols: Map<number, ColView>;
  rows: Map<number, RowView>;
  format: SheetFormat;
  /** Keys `"blockRow:blockCol"` of blocks already snapshotted. */
  loaded: Set<string>;
}

export interface EditState {
  text: string;
  /** The element that owns the focus while editing. */
  origin: "cell" | "bar";
  /** `enter`: started by typing (arrow keys commit and move); `edit`: F2 / double-click / formula bar. */
  mode: "enter" | "edit";
}

export interface Toast {
  id: number;
  message: string;
}

export interface CalcState {
  info: WorkbookInfo | null;
  /** `SheetInfo.id` of the visible sheet. */
  activeSheet: number;
  selection: Selection;
  edit: EditState | null;
  revision: number;
  canUndo: boolean;
  canRedo: boolean;
  dirty: boolean;
  /** Cycle warning of the last patch. */
  cycle: string | null;
  /** File name of the open document (`null` = new, unsaved). */
  name: string | null;
  /** Reader warnings of the last opened file. */
  warnings: string[];
  /** Bumped on every cache change (the canvas redraws on it). */
  version: number;
  toasts: Toast[];
}

export function emptyCache(): SheetCache {
  return { cells: new Map(), cols: new Map(), rows: new Map(), format: DEFAULT_FORMAT, loaded: new Set() };
}

function isBlankCell(c: CellView): boolean {
  return c.input === "" && c.display === "" && c.style === 0;
}

function putCell(cache: SheetCache, c: CellView): void {
  let row = cache.cells.get(c.row);
  if (isBlankCell(c)) {
    row?.delete(c.col);
    if (row && row.size === 0) cache.cells.delete(c.row);
    return;
  }
  if (!row) cache.cells.set(c.row, (row = new Map()));
  row.set(c.col, c);
}

function putCol(cache: SheetCache, c: ColView): void {
  if (c.width === null && !c.hidden && c.style === null) cache.cols.delete(c.col);
  else cache.cols.set(c.col, c);
}

function putRow(cache: SheetCache, r: RowView): void {
  if (r.height === null && !r.hidden && r.style === null) cache.rows.delete(r.row);
  else cache.rows.set(r.row, r);
}

/** Last row/col holding a cell with input (−1 when none). */
export function usedExtent(cache: SheetCache): { lastRow: number; lastCol: number } {
  let lastRow = -1;
  let lastCol = -1;
  for (const [r, row] of cache.cells) {
    for (const [c, cell] of row) {
      if (cell.input !== "") {
        if (r > lastRow) lastRow = r;
        if (c > lastCol) lastCol = c;
      }
    }
  }
  return { lastRow, lastCol };
}

/** Clips a range for a range command when it exceeds the backend limit. */
export function clipRange(r: Range, cache: SheetCache): Range {
  if ((r.r1 - r.r0 + 1) * (r.c1 - r.c0 + 1) <= MAX_RANGE_CELLS) return r;
  const { lastRow, lastCol } = usedExtent(cache);
  const r1 = Math.max(r.r0, Math.min(r.r1, lastRow));
  let c1 = Math.max(r.c0, Math.min(r.c1, lastCol));
  // Still too large: keep whole rows/cols within the limit.
  while ((r1 - r.r0 + 1) * (c1 - r.c0 + 1) > MAX_RANGE_CELLS && c1 > r.c0) c1--;
  return { r0: r.r0, c0: r.c0, r1, c1 };
}

/** Parses TSV (Excel's clipboard format) into rows of cells. */
export function parseTsv(text: string): string[][] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines.map((l) => l.split("\t"));
}

export class CalcStore {
  private state: CalcState = {
    info: null,
    activeSheet: 0,
    selection: cellSelection(0, 0),
    edit: null,
    revision: 0,
    canUndo: false,
    canRedo: false,
    dirty: false,
    cycle: null,
    name: null,
    warnings: [],
    version: 0,
    toasts: [],
  };
  private listeners = new Set<() => void>();
  private caches = new Map<number, SheetCache>();
  private geo = new Map<number, { version: number; col: AxisGeometry; row: AxisGeometry }>();
  private extents = new Map<number, { version: number; extent: { lastRow: number; lastCol: number } }>();
  private inflight = new Map<string, Promise<void>>();
  private lastViewport = new Map<number, Range>();
  private toastSeq = 0;
  /** Moves the keyboard focus back to the grid (set by the grid component). */
  focusGrid: () => void = () => {};
  /** Internal clipboard (TSV), used when the system clipboard is unavailable. */
  clipboard = "";

  constructor(readonly api: CalcApi) {}

  // --- store plumbing ---------------------------------------------------

  getState = (): CalcState => this.state;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private set(partial: Partial<CalcState>): void {
    this.state = { ...this.state, ...partial };
    for (const fn of this.listeners) fn();
  }

  private bump(extra: Partial<CalcState> = {}): void {
    this.set({ ...extra, version: this.state.version + 1 });
  }

  cache(sheet: number): SheetCache {
    let c = this.caches.get(sheet);
    if (!c) this.caches.set(sheet, (c = emptyCache()));
    return c;
  }

  /** Geometry of a sheet, rebuilt only when the cache version changed. */
  geometry(sheet: number): { col: AxisGeometry; row: AxisGeometry } {
    const g = this.geo.get(sheet);
    if (g && g.version === this.state.version) return g;
    const cache = this.cache(sheet);
    const next = { version: this.state.version, col: colGeometry(cache.format, cache.cols), row: rowGeometry(cache.format, cache.rows) };
    this.geo.set(sheet, next);
    return next;
  }

  /** [`usedExtent`] of a sheet, memoized per cache version. */
  usedExtent(sheet: number): { lastRow: number; lastCol: number } {
    const m = this.extents.get(sheet);
    if (m && m.version === this.state.version) return m.extent;
    const extent = usedExtent(this.cache(sheet));
    this.extents.set(sheet, { version: this.state.version, extent });
    return extent;
  }

  styles(): CellStyle[] {
    return this.state.info?.styles ?? [{}];
  }

  activeCell(): CellView | undefined {
    const { anchor } = this.state.selection;
    return this.cache(this.state.activeSheet).cells.get(anchor.row)?.get(anchor.col);
  }

  /** Effective style of the active cell (cell → row → column → default). */
  activeStyle(): CellStyle {
    const { anchor } = this.state.selection;
    const cache = this.cache(this.state.activeSheet);
    const cell = cache.cells.get(anchor.row)?.get(anchor.col);
    const id = cell ? cell.style : (cache.rows.get(anchor.row)?.style ?? cache.cols.get(anchor.col)?.style ?? 0);
    return styleAt(this.styles(), id);
  }

  navContext(pageRows: number): NavContext {
    const cache = this.cache(this.state.activeSheet);
    const { lastRow, lastCol } = this.usedExtent(this.state.activeSheet);
    return {
      isFilled: (r, c) => (cache.cells.get(r)?.get(c)?.input ?? "") !== "",
      usedLastRow: lastRow,
      usedLastCol: lastCol,
      pageRows,
    };
  }

  pushError(e: unknown): void {
    const message = e instanceof CalcApiError ? `${e.code}: ${e.message}` : e instanceof Error ? e.message : String(e);
    if (this.state.toasts.some((t) => t.message === message)) return;
    const id = ++this.toastSeq;
    this.set({ toasts: [...this.state.toasts, { id, message }] });
  }

  dismissToast(id: number): void {
    this.set({ toasts: this.state.toasts.filter((t) => t.id !== id) });
  }

  /** Runs `fn`, turning a failure into a toast. */
  private async guard(fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (e) {
      this.pushError(e);
    }
  }

  // --- backend → cache --------------------------------------------------

  private setInfo(info: WorkbookInfo): void {
    this.caches.clear();
    this.geo.clear();
    this.inflight.clear();
    const active = info.sheets.some((s) => s.id === this.state.activeSheet) ? this.state.activeSheet : (info.sheets[0]?.id ?? 0);
    this.bump({ info, activeSheet: active, revision: info.revision, edit: null });
  }

  /** Merges a patch into the cache; structural changes drop a sheet's cache and reload its viewport. */
  applyPatch(patch: CalcPatch): void {
    const info = this.state.info;
    const nextInfo: WorkbookInfo | null = info && {
      ...info,
      sheets: patch.sheets ?? info.sheets,
      styles: patch.styles ?? info.styles,
    };
    const reload = new Set<number>();
    for (const s of patch.structural) {
      this.caches.set(s.sheet, emptyCache());
      for (const key of [...this.inflight.keys()]) if (key.startsWith(`${s.sheet}:`)) this.inflight.delete(key);
      reload.add(s.sheet);
    }
    for (const g of patch.cells) {
      const cache = this.cache(g.sheet);
      for (const c of g.cells) putCell(cache, c);
    }
    for (const g of patch.cols) {
      const cache = this.cache(g.sheet);
      for (const c of g.cols) putCol(cache, c);
    }
    for (const g of patch.rows) {
      const cache = this.cache(g.sheet);
      for (const r of g.rows) putRow(cache, r);
    }
    let activeSheet = this.state.activeSheet;
    if (nextInfo && !nextInfo.sheets.some((s) => s.id === activeSheet)) activeSheet = nextInfo.sheets[0]?.id ?? 0;
    this.bump({ info: nextInfo, cycle: patch.cycle, activeSheet });
    for (const sheet of reload) {
      const vp = this.lastViewport.get(sheet);
      if (vp) void this.ensureRegion(sheet, vp.r0, vp.c0, vp.r1, vp.c1);
    }
  }

  /** Applies a command reply; replies older than the newest seen revision are discarded (ADR 0002 §5). */
  applyEnvelope(env: PatchEnvelope): boolean {
    if (env.revision < this.state.revision) return false;
    this.set({ revision: env.revision, canUndo: env.canUndo, canRedo: env.canRedo, dirty: env.dirty });
    this.applyPatch(env.patch);
    return true;
  }

  applySnapshot(snap: RegionSnapshot): void {
    const cache = this.cache(snap.sheet);
    cache.format = snap.format;
    // The snapshot is authoritative for its region: drop stale entries first.
    for (let r = snap.r0; r <= snap.r1; r++) {
      const row = cache.cells.get(r);
      if (!row) continue;
      for (const c of [...row.keys()]) if (c >= snap.c0 && c <= snap.c1) row.delete(c);
      if (row.size === 0) cache.cells.delete(r);
    }
    for (const c of snap.cells) putCell(cache, c);
    for (const c of snap.cols) putCol(cache, c);
    for (const r of snap.rows) putRow(cache, r);
    this.bump();
  }

  /**
   * Requests snapshots for the blocks of `r0..=r1 × c0..=c1` not cached
   * yet; concurrent calls share in-flight requests.
   */
  ensureRegion(sheet: number, r0: number, c0: number, r1: number, c1: number): Promise<void> {
    this.lastViewport.set(sheet, { r0, c0, r1, c1 });
    const cache = this.cache(sheet);
    const waits: Promise<void>[] = [];
    for (let br = Math.floor(r0 / BLOCK_ROWS); br <= Math.floor(r1 / BLOCK_ROWS); br++) {
      for (let bc = Math.floor(c0 / BLOCK_COLS); bc <= Math.floor(c1 / BLOCK_COLS); bc++) {
        const key = `${br}:${bc}`;
        if (cache.loaded.has(key)) continue;
        const flightKey = `${sheet}:${key}`;
        let p = this.inflight.get(flightKey);
        if (!p) {
          p = this.loadBlock(sheet, br, bc, flightKey);
          this.inflight.set(flightKey, p);
        }
        waits.push(p);
      }
    }
    return Promise.all(waits).then(() => undefined);
  }

  private async loadBlock(sheet: number, br: number, bc: number, flightKey: string): Promise<void> {
    const r0 = br * BLOCK_ROWS;
    const c0 = bc * BLOCK_COLS;
    const r1 = Math.min(r0 + BLOCK_ROWS - 1, 1_048_575);
    const c1 = Math.min(c0 + BLOCK_COLS - 1, 16_383);
    for (let attempt = 0; attempt < 3; attempt++) {
      const revision = this.state.revision;
      let snap: RegionSnapshot;
      try {
        snap = await this.api.snapshot(sheet, r0, c0, r1, c1);
      } catch (e) {
        if (this.inflight.get(flightKey) === undefined) return;
        this.inflight.delete(flightKey);
        // Do not retry on every frame: the block stays empty until the
        // sheet's cache is reset (structural patch, new document).
        this.cache(sheet).loaded.add(`${br}:${bc}`);
        // A sheet that no longer exists is not worth a toast.
        if (!(e instanceof CalcApiError && e.code === "unknown_sheet")) this.pushError(e);
        return;
      }
      // Superseded (cache dropped) or the document changed meanwhile: the
      // snapshot may be older than patches already merged – fetch again.
      if (!this.inflight.has(flightKey)) return;
      if (revision !== this.state.revision) continue;
      this.inflight.delete(flightKey);
      this.cache(sheet).loaded.add(`${br}:${bc}`);
      this.applySnapshot(snap);
      return;
    }
    this.inflight.delete(flightKey);
  }

  // --- actions ------------------------------------------------------------

  /** `NewDocument`, then `Info`, then the first viewport. */
  init(): Promise<void> {
    return this.guard(async () => {
      await this.api.newDocument();
      this.setInfo(await this.api.info());
      this.set({ name: null, warnings: [], dirty: false, canUndo: false, canRedo: false });
      await this.ensureRegion(this.state.activeSheet, 0, 0, BLOCK_ROWS - 1, BLOCK_COLS - 1);
    });
  }

  /** Replaces the document by an empty one (Ctrl+N). */
  newFile(): Promise<void> {
    return this.guard(async () => {
      this.cancelEdit();
      const info = await this.api.newDocument();
      this.lastViewport.clear();
      this.setInfo(info);
      this.set({ selection: cellSelection(0, 0), name: null, warnings: [], cycle: null, dirty: false, canUndo: false, canRedo: false });
      await this.ensureRegion(this.state.activeSheet, 0, 0, BLOCK_ROWS - 1, BLOCK_COLS - 1);
    });
  }

  /** Lets the user pick an `.xlsx` file and replaces the document by it. */
  openFile(): Promise<void> {
    return this.guard(async () => {
      this.cancelEdit();
      const file = await this.api.backend.openFile();
      if (!file) return;
      const opened = await this.api.openXlsx(file.bytesBase64, file.name);
      this.lastViewport.clear();
      this.setInfo(opened.info);
      const env = opened.envelope;
      this.set({
        selection: cellSelection(0, 0),
        name: file.name,
        warnings: opened.warnings,
        cycle: null,
        revision: env.revision,
        canUndo: env.canUndo,
        canRedo: env.canRedo,
        dirty: env.dirty,
      });
      await this.ensureRegion(this.state.activeSheet, 0, 0, BLOCK_ROWS - 1, BLOCK_COLS - 1);
    });
  }

  /**
   * Writes the document as `.xlsx` through the shell's save dialog /
   * download; only a completed write marks the document saved. `asName`
   * (Save As) overrides the suggested file name.
   */
  saveFile(asName?: string): Promise<void> {
    return this.guard(async () => {
      await this.commitEdit(0, 0);
      const saved = await this.api.saveXlsx();
      if (!(await this.api.backend.saveFile(asName ?? saved.suggestedName, saved.bytesBase64))) return;
      const st = await this.api.markSaved(asName);
      this.set({ dirty: st.dirty, name: asName ?? st.name ?? saved.suggestedName });
    });
  }

  /** Window/tab title: file name, dirty marker, app name. */
  title(): string {
    return `${this.state.name ?? "Untitled"}${this.state.dirty ? " •" : ""} – Rusuite Calc`;
  }

  apply(command: CalcCommand): Promise<void> {
    return this.guard(async () => {
      this.applyEnvelope(await this.api.apply(command));
    });
  }

  undo(): Promise<void> {
    return this.guard(async () => {
      this.applyEnvelope(await this.api.undo());
    });
  }

  redo(): Promise<void> {
    return this.guard(async () => {
      this.applyEnvelope(await this.api.redo());
    });
  }

  setActiveSheet(sheet: number): void {
    if (sheet === this.state.activeSheet) return;
    this.commitEdit(0, 0);
    this.set({ activeSheet: sheet, selection: cellSelection(0, 0) });
    const vp = this.lastViewport.get(sheet) ?? { r0: 0, c0: 0, r1: BLOCK_ROWS - 1, c1: BLOCK_COLS - 1 };
    void this.ensureRegion(sheet, vp.r0, vp.c0, vp.r1, vp.c1);
  }

  select(selection: Selection): void {
    this.set({ selection });
  }

  /** Starts editing the active cell; `text` replaces its input (typing) or is its input (F2). */
  beginEdit(text: string | null, origin: EditState["origin"] = "cell"): void {
    const mode = text === null || origin === "bar" ? "edit" : "enter";
    this.set({ edit: { text: text ?? this.activeCell()?.input ?? "", origin, mode } });
  }

  setEditOrigin(origin: EditState["origin"]): void {
    if (this.state.edit && this.state.edit.origin !== origin) this.set({ edit: { ...this.state.edit, origin, mode: "edit" } });
  }

  setEditText(text: string): void {
    if (this.state.edit) this.set({ edit: { ...this.state.edit, text } });
  }

  cancelEdit(): void {
    if (this.state.edit) this.set({ edit: null });
  }

  /** Commits the edit (if any) and moves the active cell by `(dRow, dCol)`. */
  commitEdit(dRow: number, dCol: number): Promise<void> {
    const edit = this.state.edit;
    if (!edit) return Promise.resolve();
    const { row, col } = this.state.selection.anchor;
    const sheet = this.state.activeSheet;
    const before = this.activeCell()?.input ?? "";
    const next = cellSelection(Math.max(0, row + dRow), Math.max(0, col + dCol));
    this.set({ edit: null, selection: next });
    if (edit.text === before) return Promise.resolve();
    return this.apply(
      edit.text === ""
        ? { type: "clearRange", sheet, r0: row, c0: col, r1: row, c1: col }
        : { type: "setInput", sheet, row, col, input: edit.text },
    );
  }

  selectionRange(): Range {
    return clipRange(normalize(this.state.selection), this.cache(this.state.activeSheet));
  }

  /** Inserts or deletes the rows/columns spanned by the selection. */
  structure(kind: "insert" | "delete", axis: "rows" | "cols"): Promise<void> {
    const r = this.selectionRange();
    const sheet = this.state.activeSheet;
    const [at, count] = axis === "rows" ? [r.r0, r.r1 - r.r0 + 1] : [r.c0, r.c1 - r.c0 + 1];
    const type = `${kind}${axis === "rows" ? "Rows" : "Cols"}` as "insertRows" | "deleteRows" | "insertCols" | "deleteCols";
    return this.apply({ type, sheet, at, count });
  }

  clearSelection(): Promise<void> {
    const r = this.selectionRange();
    return this.apply({ type: "clearRange", sheet: this.state.activeSheet, ...r });
  }

  applyStyle(patch: CellStylePatch): Promise<void> {
    const r = this.selectionRange();
    return this.apply({ type: "applyStyle", sheet: this.state.activeSheet, ...r, patch });
  }

  /** Ctrl+B / I / U: toggles based on the active cell's style. */
  toggleFont(prop: "bold" | "italic" | "underline"): Promise<void> {
    const font = this.activeStyle().font ?? {};
    if (prop === "underline") {
      const on = !!font.underline && font.underline !== "none";
      return this.applyStyle({ font: { underline: on ? "none" : "single" } });
    }
    return this.applyStyle({ font: { [prop]: !font[prop] } });
  }

  /** The selected inputs as TSV (also kept as the internal clipboard). */
  copy(): string {
    const cache = this.cache(this.state.activeSheet);
    const r = normalize(this.state.selection);
    const { lastRow, lastCol } = usedExtent(cache);
    const r1 = Math.min(r.r1, Math.max(r.r0, lastRow));
    const c1 = Math.min(r.c1, Math.max(r.c0, lastCol));
    const lines: string[] = [];
    for (let row = r.r0; row <= r1; row++) {
      const cells: string[] = [];
      for (let col = r.c0; col <= c1; col++) cells.push(cache.cells.get(row)?.get(col)?.input ?? "");
      lines.push(cells.join("\t"));
    }
    this.clipboard = lines.join("\n");
    return this.clipboard;
  }

  /**
   * Writes TSV at the active cell: one `setInput` per cell (`clearRange`
   * for empty ones) sent as one `compound`, so a paste is one undo step.
   * Formulas are pasted verbatim (no reference adjustment yet).
   */
  paste(text: string = this.clipboard): Promise<void> {
    const rows = parseTsv(text);
    const sheet = this.state.activeSheet;
    const { row: top, col: left } = this.state.selection.anchor;
    const commands: CalcCommand[] = [];
    rows.forEach((cells, i) =>
      cells.forEach((input, j) => {
        const row = top + i;
        const col = left + j;
        commands.push(
          input === "" ? { type: "clearRange", sheet, r0: row, c0: col, r1: row, c1: col } : { type: "setInput", sheet, row, col, input },
        );
      }),
    );
    if (commands.length === 0) return Promise.resolve();
    const width = Math.max(...rows.map((r) => r.length));
    this.set({ selection: { anchor: { row: top, col: left }, focus: { row: top + rows.length - 1, col: left + width - 1 } } });
    return this.apply(commands.length === 1 ? commands[0] : { type: "compound", commands });
  }

  setColWidth(col: number, widthPx: number | null): Promise<void> {
    const width = widthPx === null ? null : Math.max(0, Math.round(((widthPx - 5) / 7) * 100) / 100);
    return this.apply({ type: "setColWidth", sheet: this.state.activeSheet, col, width });
  }

  setRowHeight(row: number, heightPx: number | null): Promise<void> {
    const height = heightPx === null ? null : Math.max(0, Math.round(((heightPx * 72) / 96) * 100) / 100);
    return this.apply({ type: "setRowHeight", sheet: this.state.activeSheet, row, height });
  }

  addSheet(): Promise<void> {
    const names = new Set((this.state.info?.sheets ?? []).map((s) => s.name.toLowerCase()));
    let n = (this.state.info?.sheets.length ?? 0) + 1;
    while (names.has(`sheet${n}`)) n++;
    const before = new Set((this.state.info?.sheets ?? []).map((s) => s.id));
    return this.apply({ type: "addSheet", name: `Sheet${n}` }).then(() => {
      const added = this.state.info?.sheets.find((s) => !before.has(s.id));
      if (added) this.setActiveSheet(added.id);
    });
  }

  renameSheet(sheet: number, name: string): Promise<void> {
    const current = this.state.info?.sheets.find((s) => s.id === sheet)?.name;
    if (!name.trim() || name === current) return Promise.resolve();
    return this.apply({ type: "renameSheet", sheet, name: name.trim() });
  }
}

/** Subscribes a component to a slice of the store. */
export function useCalc<T>(store: CalcStore, select: (s: CalcState) => T): T {
  return useSyncExternalStore(store.subscribe, () => select(store.getState()));
}
