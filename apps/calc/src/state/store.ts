// Calc view-model store (ADR 0001: the frontend only holds a view of the
// Rust document). Hand-rolled on `useSyncExternalStore` instead of
// zustand: the state is one object plus a mutable sparse cache that is
// versioned rather than copied, which a tiny custom store expresses
// directly and without a new runtime dependency.

import { useSyncExternalStore } from "react";
import type { CellStylePatch, Color } from "@rusuite/ui-shared";
import { CalcApiError, type CalcApi, type PatchEnvelope } from "../backend/calcApi";
import type { CalcCommand } from "../generated/CalcCommand";
import type { FillMode } from "../generated/FillMode";
import type { FoundCell } from "../generated/FoundCell";
import type { PasteMode } from "../generated/PasteMode";
import type { Rect } from "../generated/Rect";
import type { CalcPatch } from "../generated/CalcPatch";
import type { CellStyle } from "../generated/CellStyle";
import type { CellView } from "../generated/CellView";
import type { ColView } from "../generated/ColView";
import type { RegionSnapshot } from "../generated/RegionSnapshot";
import type { RowView } from "../generated/RowView";
import type { SheetFormat } from "../generated/SheetFormat";
import type { SheetInfo } from "../generated/SheetInfo";
import type { SheetView } from "../generated/SheetView";
import type { SheetViewPatch } from "../generated/SheetViewPatch";
import type { WorkbookInfo } from "../generated/WorkbookInfo";
import { AxisGeometry, colGeometry, DEFAULT_FORMAT, rowGeometry, rowHeightPx } from "../grid/geometry";
import { CELL_PADDING } from "../grid/render";
import { approxMeasure, lineHeightPx, wrapLines, type Measure } from "../grid/textLayout";
import { sheetPrefix } from "../grid/address";
import { cellSelection, LAST_COL, LAST_ROW, move, normalize, type Cell, type NavContext, type Range, type Selection } from "../grid/Selection";
import { intersects, mergeAnchor, mergeLookup, mergeSnapshot, partialMerge, snapSelection } from "../grid/merges";
import { fontCss, styleAt } from "../grid/style";
import { captureClip, fillDownEnd, pasteTarget, tsvClip, type Clip } from "./clipboard";
import { findStep, replaceInInput, type FindOptions } from "./find";
import { activeArg, applyFunction, FUNCTIONS, functionInfo, matchFunctions, signatureArgs, type FunctionInfo } from "../formula/functions";
import { callAt, functionPrefix, pointSpan, replaceSpan } from "../formula/point";
import { colorRefs, cycleAnchor, rangeText, type ColoredRef } from "../formula/refs";
import { isFormula } from "../formula/tokenize";
import { checkFormula, formulaErrorMessage } from "../formula/validate";
import { t } from "../i18n";

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
  /** Merged ranges known so far (those of the loaded blocks, or the full list after a patch). */
  merges: Rect[];
  /** Keys `"blockRow:blockCol"` of blocks already snapshotted. */
  loaded: Set<string>;
}

/** Excel's defaults: nothing frozen, 100 %, gridlines and headings shown. */
export const DEFAULT_SHEET_VIEW: SheetView = { frozenRows: 0, frozenCols: 0, zoom: 100, showGridlines: true, showHeadings: true };

/** The view settings of `sheet` (defaults when absent or unknown). */
export function sheetViewOf(info: WorkbookInfo | null, sheet: number): SheetView {
  return info?.sheets.find((s) => s.id === sheet)?.view ?? DEFAULT_SHEET_VIEW;
}

/** The sheets that have a tab, in order. */
export function visibleSheets(sheets: readonly SheetInfo[]): SheetInfo[] {
  return sheets.filter((s) => !s.hidden);
}

/** The hidden sheets the user may unhide ("very hidden" ones are not offered, as in Excel). */
export function unhideableSheets(sheets: readonly SheetInfo[]): SheetInfo[] {
  return sheets.filter((s) => s.hidden && !s.veryHidden);
}

/** How the Merge menu merges the selection. */
export type MergeKind = "center" | "across" | "cells";

/** The reference being pointed at (mouse drag or keyboard) and its span in the edit text. */
export interface PointRef {
  anchor: Cell;
  focus: Cell;
  start: number;
  end: number;
}

export interface EditState {
  text: string;
  /** The element that owns the focus while editing. */
  origin: "cell" | "bar";
  /**
   * `enter`: started by typing (arrow keys commit and move, or point in a
   * formula); `edit`: F2 / double-click / formula bar (arrows move the caret).
   */
  mode: "enter" | "edit";
  /** Caret / text selection in `text` (mirrored from the focused editor). */
  selStart: number;
  selEnd: number;
  /** The edited cell: its sheet stays the target while pointing on other sheets. */
  sheet: number;
  cell: Cell;
  point: PointRef | null;
  /** Inline message after a rejected commit (unparsable formula). */
  error: string | null;
  /** Autocomplete: highlighted entry; `menuForced` (fx button) lists all; `menuDismissed` (Esc) hides it until the text changes. */
  menuIndex: number;
  menuForced: boolean;
  menuDismissed: boolean;
}

/** The function list shown under the editor. */
export interface Completion {
  items: FunctionInfo[];
  index: number;
  /** Text replaced by an accepted entry. */
  span: { start: number; end: number };
}

/** The signature tip of the call around the caret. */
export interface SignatureTip {
  name: string;
  args: string[];
  /** Index into `args` to emphasise (`-1`: none). */
  active: number;
}

export interface Toast {
  id: number;
  message: string;
}

/** The dialogs Calc opens from shortcuts, menus and (later) the ribbon. */
export type CalcDialog =
  | { kind: "numberFormat" }
  | { kind: "find"; replace: boolean }
  | { kind: "rowHeight" }
  | { kind: "colWidth" }
  /** Confirms deleting a sheet that has content. */
  | { kind: "deleteSheet"; sheet: number; name: string }
  | { kind: "tabColor"; sheet: number }
  | { kind: "renameSheet"; sheet: number }
  /** Lists the hidden sheets to show one again. */
  | { kind: "unhideSheet" }
  /** Warns that merging keeps only the upper-left value. */
  | { kind: "mergeConfirm"; merge: MergeKind };

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
  /** The copied/cut range shown with marching ants (`null`: none). */
  clipMark: { sheet: number; range: Range; cut: boolean } | null;
  dialog: CalcDialog | null;
}

export function emptyCache(): SheetCache {
  return { cells: new Map(), cols: new Map(), rows: new Map(), format: DEFAULT_FORMAT, merges: [], loaded: new Set() };
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

export { parseTsv } from "./clipboard";

const sameText = (a: string, b: string) => a.replace(/\r\n?/g, "\n").replace(/\n$/, "") === b.replace(/\r\n?/g, "\n").replace(/\n$/, "");

/** Effective style id of a cell from the cache (cell → row → column → default). */
function styleIdIn(cache: SheetCache, row: number, col: number): number {
  const cell = cache.cells.get(row)?.get(col);
  return cell ? cell.style : (cache.rows.get(row)?.style ?? cache.cols.get(col)?.style ?? 0);
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
    clipMark: null,
    dialog: null,
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
  /** Internal clipboard (TSV of the last copy), used when the system clipboard is unavailable. */
  clipboard = "";
  /** The last copied/cut block (inputs, style ids, source range). */
  private clip: Clip | null = null;
  /** Rows whose height was set by wrap auto-fit (they shrink back on their own). */
  private autoRows = new Set<string>();
  /** Text measurement (the grid installs the canvas; the default estimates). */
  measure: Measure = approxMeasure;

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

  /** Merged ranges of `sheet` (default: the active one) known to the cache. */
  merges(sheet = this.state.activeSheet): Rect[] {
    return this.cache(sheet).merges;
  }

  /** The active cell; on a merged range its top-left cell, which holds the content. */
  activeAnchor(): Cell {
    return mergeAnchor(this.merges(), this.state.selection.anchor);
  }

  activeCell(): CellView | undefined {
    const anchor = this.activeAnchor();
    return this.cache(this.state.activeSheet).cells.get(anchor.row)?.get(anchor.col);
  }

  /** Effective style of the active cell (cell → row → column → default). */
  activeStyle(): CellStyle {
    const anchor = this.activeAnchor();
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
      mergeAt: mergeLookup(cache.merges),
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
    this.clip = null;
    this.autoRows.clear();
    this.state = { ...this.state, clipMark: null };
    this.caches.clear();
    this.geo.clear();
    this.inflight.clear();
    const shown = visibleSheets(info.sheets);
    const active = shown.some((s) => s.id === this.state.activeSheet) ? this.state.activeSheet : (shown[0]?.id ?? info.sheets[0]?.id ?? 0);
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
    for (const g of patch.merges ?? []) this.cache(g.sheet).merges = g.merges.map((m) => ({ ...m }));
    let activeSheet = this.state.activeSheet;
    let edit = this.state.edit;
    let clipMark = this.state.clipMark;
    if (patch.sheets && info) {
      // Deleted sheets: drop their cache (an undo restores them from scratch).
      const live = new Set(patch.sheets.map((s) => s.id));
      for (const { id } of info.sheets) {
        if (live.has(id)) continue;
        this.caches.delete(id);
        this.geo.delete(id);
        this.extents.delete(id);
        this.lastViewport.delete(id);
        for (const key of [...this.inflight.keys()]) if (key.startsWith(`${id}:`)) this.inflight.delete(key);
      }
      if (!live.has(activeSheet)) {
        // The neighbour that took the deleted sheet's place.
        const at = info.sheets.findIndex((s) => s.id === activeSheet);
        activeSheet = patch.sheets[Math.min(Math.max(at, 0), patch.sheets.length - 1)]?.id ?? 0;
      }
      if (edit && !live.has(edit.sheet)) edit = null;
      if (clipMark && !live.has(clipMark.sheet)) {
        clipMark = null;
        this.clip = null;
      }
    }
    if (patch.activateSheet !== undefined && nextInfo) {
      // After hiding: leave the sheet if it was the active one; after unhiding: show it.
      const target = patch.activateSheet;
      const current = nextInfo.sheets.find((s) => s.id === activeSheet);
      const wasHidden = !!info?.sheets.find((s) => s.id === target)?.hidden;
      if (nextInfo.sheets.some((s) => s.id === target && !s.hidden) && (!current || current.hidden || wasHidden)) activeSheet = target;
    }
    if (nextInfo && !nextInfo.sheets.some((s) => s.id === activeSheet)) activeSheet = (visibleSheets(nextInfo.sheets)[0] ?? nextInfo.sheets[0])?.id ?? 0;
    const switched = activeSheet !== this.state.activeSheet;
    this.bump({ info: nextInfo, cycle: patch.cycle, activeSheet, edit, clipMark, ...(switched ? { selection: cellSelection(0, 0) } : {}) });
    if (switched) {
      const vp = this.lastViewport.get(activeSheet) ?? { r0: 0, c0: 0, r1: BLOCK_ROWS - 1, c1: BLOCK_COLS - 1 };
      void this.ensureRegion(activeSheet, vp.r0, vp.c0, vp.r1, vp.c1);
    }
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
    if (snap.merges?.length || cache.merges.length) cache.merges = mergeSnapshot(cache.merges, snap, snap.merges ?? []);
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
      if (file) await this.openBytesUnguarded(file);
    });
  }

  /** Replaces the document by an `.xlsx` file's contents (recent files); `false` on failure. */
  async openBytes(file: { name: string; bytesBase64: string }): Promise<boolean> {
    let ok = false;
    await this.guard(async () => {
      this.cancelEdit();
      await this.openBytesUnguarded(file);
      ok = true;
    });
    return ok;
  }

  /** Replaces the document by an autosaved snapshot (crash recovery); it stays dirty. `false` on failure. */
  async restoreRecovery(json: string, name: string | null): Promise<boolean> {
    let ok = false;
    await this.guard(async () => {
      this.cancelEdit();
      const info = await this.api.restoreRecovery(json, name);
      const st = await this.api.documentState();
      this.lastViewport.clear();
      this.setInfo(info);
      this.set({
        selection: cellSelection(0, 0),
        name,
        warnings: [],
        cycle: null,
        revision: st.revision,
        canUndo: false,
        canRedo: false,
        dirty: st.dirty,
      });
      await this.ensureRegion(this.state.activeSheet, 0, 0, BLOCK_ROWS - 1, BLOCK_COLS - 1);
      ok = true;
    });
    return ok;
  }

  private async openBytesUnguarded(file: { name: string; bytesBase64: string }): Promise<void> {
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
  }

  /**
   * Writes the document as `.xlsx` through the shell (desktop: the
   * document's file, or the save dialog; web: a download); only a
   * completed write marks the document saved. `asName` (Save As)
   * overrides the suggested file name; `saveAs` (default: with `asName`)
   * makes the desktop ask even when the document has a file. The name
   * becomes the file actually written.
   */
  saveFile(asName?: string, saveAs = asName !== undefined): Promise<void> {
    return this.guard(async () => {
      await this.commitEdit(0, 0);
      const saved = await this.api.saveXlsx();
      const suggested = asName ?? this.state.name ?? saved.suggestedName;
      const result = await this.api.backend.saveFile(suggested, saved.bytesBase64, { saveAs });
      if (!result) return;
      const name = typeof result === "object" ? result.name : asName;
      const st = await this.api.markSaved(name);
      this.set({ dirty: st.dirty, name: name ?? st.name ?? saved.suggestedName });
    });
  }

  /** Window/tab title: file name, dirty marker, app name. */
  title(): string {
    return `${this.state.name ?? t("doc.untitled")}${this.state.dirty ? " •" : ""} – Rusuite Calc`;
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

  /**
   * Switches sheets. While a formula is being edited the edit stays open
   * (pointing at cells of the other sheet inserts `Sheet2!A1`) and moves
   * to the formula bar; other edits are committed first, and a rejected
   * commit keeps the sheet.
   */
  setActiveSheet(sheet: number): void {
    if (sheet === this.state.activeSheet) return;
    const e = this.state.edit;
    if (e && isFormula(e.text)) {
      const back = sheet === e.sheet;
      this.showSheet(sheet, back ? cellSelection(e.cell.row, e.cell.col) : cellSelection(0, 0), {
        ...e, origin: back ? e.origin : "bar", mode: back ? e.mode : "edit", point: null,
      });
      return;
    }
    void this.commitEdit(0, 0);
    if (this.state.edit) return;
    this.showSheet(sheet, cellSelection(0, 0), null);
  }

  private showSheet(sheet: number, selection: Selection, edit: EditState | null): void {
    const changed = sheet !== this.state.activeSheet;
    this.set({ activeSheet: sheet, selection, edit });
    if (!changed) return;
    const vp = this.lastViewport.get(sheet) ?? { r0: 0, c0: 0, r1: BLOCK_ROWS - 1, c1: BLOCK_COLS - 1 };
    void this.ensureRegion(sheet, vp.r0, vp.c0, vp.r1, vp.c1);
  }

  /** Selects `selection`, grown to whole merged cells (the active cell becomes a merge's top-left). */
  select(selection: Selection): void {
    this.set({ selection: snapSelection(selection, this.merges()) });
  }

  /** Starts editing the active cell; `text` replaces its input (typing) or is its input (F2). */
  beginEdit(text: string | null, origin: EditState["origin"] = "cell"): void {
    const mode = text === null || origin === "bar" ? "edit" : "enter";
    const value = text ?? this.activeCell()?.input ?? "";
    // A merged range is edited in its top-left cell.
    const anchor = this.activeAnchor();
    // Editing ends copy mode (the marching ants), as in Excel.
    this.clip = null;
    this.set({
      clipMark: null,
      edit: {
        text: value, origin, mode, selStart: value.length, selEnd: value.length,
        sheet: this.state.activeSheet, cell: { ...anchor },
        point: null, error: null, menuIndex: 0, menuForced: false, menuDismissed: false,
      },
    });
  }

  private patchEdit(partial: Partial<EditState>): void {
    if (this.state.edit) this.set({ edit: { ...this.state.edit, ...partial } });
  }

  setEditOrigin(origin: EditState["origin"]): void {
    if (this.state.edit && this.state.edit.origin !== origin) this.patchEdit({ origin, mode: "edit" });
  }

  /** F2 inside the editor: toggles between enter (pointing) and edit (caret) mode. */
  toggleEditMode(): void {
    const e = this.state.edit;
    if (e) this.patchEdit({ mode: e.mode === "enter" ? "edit" : "enter", point: null });
  }

  /** Typing: new text and caret (default: end of the text). */
  setEditText(text: string, caret: number = text.length): void {
    const e = this.state.edit;
    if (!e) return;
    this.patchEdit({
      text, selStart: caret, selEnd: caret, point: null, error: null, menuIndex: 0, menuForced: false, menuDismissed: false,
    });
  }

  /** Caret / selection moved inside the focused editor. */
  setEditCaret(start: number, end: number = start): void {
    const e = this.state.edit;
    if (e && (e.selStart !== start || e.selEnd !== end)) this.patchEdit({ selStart: start, selEnd: end });
  }

  /** Cancels the edit (Esc); returns to the edited cell's sheet. */
  cancelEdit(): void {
    const e = this.state.edit;
    if (!e) return;
    if (e.sheet !== this.state.activeSheet) this.showSheet(e.sheet, cellSelection(e.cell.row, e.cell.col), null);
    else this.set({ edit: null });
  }

  /** Point mode is possible at the caret (formula, caret after an operator or on a reference). */
  canPoint(): boolean {
    const e = this.state.edit;
    return !!e && (this.pointTarget(e) !== null);
  }

  private pointTarget(e: EditState): { start: number; end: number } | null {
    if (e.point && e.point.end === e.selEnd && e.selStart === e.selEnd) return { start: e.point.start, end: e.point.end };
    return e.selStart === e.selEnd ? pointSpan(e.text, e.selEnd) : null;
  }

  /**
   * Inserts (or replaces the pointed) reference for `anchor..focus` on the
   * active sheet. `false` when the caret is not at a point-mode position.
   */
  pointRange(anchor: Cell, focus: Cell): boolean {
    const e = this.state.edit;
    if (!e) return false;
    const span = this.pointTarget(e);
    if (!span) return false;
    const r = normalize({ anchor, focus });
    const name = this.state.info?.sheets.find((s) => s.id === this.state.activeSheet)?.name;
    const prefix = this.state.activeSheet !== e.sheet && name ? sheetPrefix(name) : "";
    const { text, caret } = replaceSpan(e.text, span, prefix + rangeText(r));
    this.patchEdit({
      text, selStart: caret, selEnd: caret, error: null, menuForced: false, menuDismissed: false,
      point: { anchor: { ...anchor }, focus: { ...focus }, start: span.start, end: caret },
    });
    return true;
  }

  /**
   * Keyboard pointing (arrows in enter mode): moves the reference cursor
   * from the pointed reference, or from the edited cell, and inserts it;
   * `extend` (Shift) grows a range. `false` when pointing is not possible.
   */
  pointMove(dRow: number, dCol: number, extend: boolean): boolean {
    const e = this.state.edit;
    if (!e || !this.pointTarget(e)) return false;
    const from = e.point && e.point.end === e.selEnd
      ? e.point
      : (() => {
          const c = this.state.activeSheet === e.sheet ? e.cell : this.state.selection.anchor;
          return { anchor: c, focus: c };
        })();
    const clamp = (c: Cell): Cell => ({
      row: Math.max(0, Math.min(LAST_ROW, c.row + dRow)), col: Math.max(0, Math.min(LAST_COL, c.col + dCol)),
    });
    const focus = clamp(from.focus);
    return this.pointRange(extend ? from.anchor : focus, focus);
  }

  /** F4: cycles the `$` anchoring of the reference at the caret. */
  cycleRefAnchor(): boolean {
    const e = this.state.edit;
    if (!e) return false;
    const r = cycleAnchor(e.text, e.selEnd);
    if (!r) return false;
    this.patchEdit({ text: r.text, selStart: r.caret, selEnd: r.caret, point: null, error: null });
    return true;
  }

  /** Coloured references of the edit text (formula only). */
  editRefs(): ColoredRef[] {
    const e = this.state.edit;
    if (!e || !isFormula(e.text)) return [];
    if (this.refsMemo?.text !== e.text) this.refsMemo = { text: e.text, refs: colorRefs(e.text) };
    return this.refsMemo.refs;
  }
  private refsMemo: { text: string; refs: ColoredRef[] } | null = null;

  /** Sheet id a reference of the edit text points to (`null`: unknown sheet). */
  refSheet(ref: ColoredRef): number | null {
    const e = this.state.edit;
    if (ref.sheet === null) return e?.sheet ?? this.state.activeSheet;
    const s = this.state.info?.sheets.find((x) => x.name.toLowerCase() === ref.sheet!.toLowerCase());
    return s ? s.id : null;
  }

  /** The function autocomplete list for the caret, or `null` when closed. */
  completion(): Completion | null {
    const e = this.state.edit;
    if (!e || e.menuDismissed || !isFormula(e.text) || e.selStart !== e.selEnd) return null;
    const typed = functionPrefix(e.text, e.selEnd);
    let items: FunctionInfo[];
    let span: Completion["span"];
    if (typed) {
      items = matchFunctions(typed.prefix);
      span = { start: typed.start, end: typed.end };
    } else if (e.menuForced) {
      items = FUNCTIONS;
      span = { start: e.selEnd, end: e.selEnd };
    } else return null;
    if (items.length === 0) return null;
    return { items, index: Math.min(e.menuIndex, items.length - 1), span };
  }

  /** Moves the highlighted autocomplete entry. */
  moveCompletion(delta: number): void {
    const c = this.completion();
    if (c) this.patchEdit({ menuIndex: (c.index + delta + c.items.length) % c.items.length });
  }

  /** Accepts the highlighted (or given) entry: the name becomes `NAME(`. */
  acceptCompletion(index?: number): boolean {
    const c = this.completion();
    const e = this.state.edit;
    if (!c || !e) return false;
    const f = c.items[index ?? c.index];
    const r = applyFunction(e.text, c.span, f.name);
    this.setEditText(r.text, r.caret);
    return true;
  }

  dismissCompletion(): void {
    this.patchEdit({ menuDismissed: true, menuForced: false });
  }

  /** The formula bar's fx button: starts a formula if needed and lists all functions. */
  openFunctionList(): void {
    if (!this.state.edit) {
      const input = this.activeCell()?.input ?? "";
      this.beginEdit(input === "" ? "=" : input, "bar");
    }
    const e = this.state.edit!;
    if (e.text === "") this.setEditText("=");
    this.patchEdit({ menuForced: true, menuDismissed: false, menuIndex: 0 });
  }

  /** The signature tip for the call around the caret. */
  signature(): SignatureTip | null {
    const e = this.state.edit;
    if (!e || !isFormula(e.text)) return null;
    const call = callAt(e.text, e.selEnd);
    const info = call && functionInfo(call.name);
    if (!call || !info) return null;
    const args = signatureArgs(info.signature);
    return { name: info.name, args, active: activeArg(args, call.arg) };
  }

  /** Focus callbacks of the editors (cell editor, formula bar). */
  editorFocus: Partial<Record<EditState["origin"], () => void>> = {};

  /** Focuses the editor that owns the edit session. */
  focusEditor(): void {
    const o = this.state.edit?.origin;
    if (o) this.editorFocus[o]?.();
  }

  /**
   * Commits the edit (if any) and moves the active cell by `(dRow, dCol)`.
   * An unparsable formula is not sent: the editor stays open with an
   * inline error (resolves `false`); so does a formula the core rejects.
   */
  commitEdit(dRow: number, dCol: number): Promise<boolean> {
    const edit = this.state.edit;
    if (!edit) return Promise.resolve(true);
    const bad = checkFormula(edit.text);
    if (bad) {
      this.patchEdit({ error: formulaErrorMessage(bad.message), point: null, menuForced: false });
      return Promise.resolve(false);
    }
    const { row, col } = edit.cell;
    const sheet = edit.sheet;
    const before = this.cache(sheet).cells.get(row)?.get(col)?.input ?? "";
    // Moving on skips the cells a merge covers.
    const next = move(cellSelection(row, col), dRow, dCol, false, mergeLookup(this.merges(sheet)));
    if (sheet !== this.state.activeSheet) this.showSheet(sheet, next, null);
    else this.set({ edit: null, selection: next });
    if (edit.text === before) return Promise.resolve(true);
    const write: CalcCommand =
      edit.text === ""
        ? { type: "clearRange", sheet, r0: row, c0: col, r1: row, c1: col }
        : { type: "setInput", sheet, row, col, input: edit.text };
    const extra: CalcCommand[] = [];
    const cache = this.cache(sheet);
    let wrap = !!styleAt(this.styles(), styleIdIn(cache, row, col)).alignment?.wrapText;
    if (edit.text.includes("\n") && !wrap) {
      // A line break turns wrap text on (Excel).
      wrap = true;
      extra.push({ type: "applyStyle", sheet, r0: row, c0: col, r1: row, c1: col, patch: { alignment: { wrapText: true } } });
    }
    const text = isFormula(edit.text) ? null : edit.text;
    extra.push(...this.rowFitCommands(sheet, [row], (c) => (c === col ? { text: text ?? undefined, wrap } : undefined), [col]));
    const command: CalcCommand = extra.length === 0 ? write : { type: "compound", commands: [write, ...extra] };
    return this.api.apply(command).then(
      (env) => {
        this.applyEnvelope(env);
        return true;
      },
      (e: unknown) => {
        if (e instanceof CalcApiError && e.code === "invalid_formula" && this.state.edit === null) {
          // The core is the authority: reopen the editor with its message.
          const restored = { ...edit, error: formulaErrorMessage(e.message), point: null };
          if (this.state.activeSheet !== sheet) this.showSheet(sheet, cellSelection(row, col), restored);
          else this.set({ selection: cellSelection(row, col), edit: restored });
          this.focusEditor();
        } else this.pushError(e);
        return false;
      },
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
    const sheet = this.state.activeSheet;
    const command: CalcCommand = { type: "applyStyle", sheet, ...r, patch };
    const wrap = patch.alignment?.wrapText;
    if (wrap === undefined || wrap === null || r.r1 - r.r0 > 500) return this.apply(command);
    // Wrap text on/off: rows without an explicit height follow (Excel).
    const rows: number[] = [];
    for (let row = r.r0; row <= r.r1; row++) rows.push(row);
    const fit = this.rowFitCommands(sheet, rows, (c) => (c >= r.c0 && c <= r.c1 ? { wrap } : undefined));
    return this.apply(fit.length === 0 ? command : { type: "compound", commands: [command, ...fit] });
  }

  /** Toggles wrap text on the selection (from the active cell's state). */
  toggleWrap(): Promise<void> {
    return this.applyStyle({ alignment: { wrapText: !this.activeStyle().alignment?.wrapText } });
  }

  /**
   * `setRowHeight` commands that fit `rows` to their wrapped text, for
   * rows without an explicit height (or auto-fitted before): a row grows
   * to its tallest wrapped cell and returns to the default when nothing
   * needs more. `override(col)` replaces a cell's text / wrap flag (the
   * edit being committed, a style being applied). Measures cached cells only.
   */
  private rowFitCommands(
    sheet: number, rows: number[], override: (col: number) => { text?: string; wrap?: boolean } | undefined, extraCols: number[] = [],
  ): CalcCommand[] {
    const cache = this.cache(sheet);
    const geo = this.geometry(sheet);
    const styles = this.styles();
    const def = rowHeightPx(cache.format.defaultRowHeight);
    const out: CalcCommand[] = [];
    for (const row of rows) {
      const view = cache.rows.get(row);
      const key = `${sheet}:${row}`;
      if (view?.hidden || (view && view.height !== null && !this.autoRows.has(key))) continue;
      const cols = new Set(cache.cells.get(row)?.keys() ?? []);
      for (const c of extraCols) cols.add(c);
      let need = 0;
      for (const col of cols) {
        const o = override(col);
        const cell = cache.cells.get(row)?.get(col);
        const style = styleAt(styles, styleIdIn(cache, row, col));
        const text = o?.text ?? cell?.display ?? "";
        const wrap = o?.wrap ?? !!style.alignment?.wrapText;
        if (!wrap || text === "") continue;
        const font = fontCss(style);
        const lines = wrapLines(text, geo.col.size(col) - 2 * CELL_PADDING, font, this.measure).length;
        need = Math.max(need, lines * lineHeightPx(font));
      }
      if (need <= def) {
        if (view && view.height !== null) {
          this.autoRows.delete(key);
          out.push({ type: "setRowHeight", sheet, row, height: null });
        }
        continue;
      }
      const height = Math.round(((need * 72) / 96) * 100) / 100;
      if (view?.height === height) continue;
      this.autoRows.add(key);
      out.push({ type: "setRowHeight", sheet, row, height });
    }
    return out;
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

  // --- clipboard ------------------------------------------------------------

  /**
   * Copies (or, `cut`, cuts) the selection into the internal clipboard
   * and marks it with marching ants; returns its TSV for the system
   * clipboard. Whole rows/columns are clipped to the used range. A cut
   * changes nothing until the paste.
   */
  copy(cut = false): string {
    const sheet = this.state.activeSheet;
    const cache = this.cache(sheet);
    const r = normalize(this.state.selection);
    const { lastRow, lastCol } = this.usedExtent(sheet);
    const range = { r0: r.r0, c0: r.c0, r1: Math.min(r.r1, Math.max(r.r0, lastRow)), c1: Math.min(r.c1, Math.max(r.c0, lastCol)) };
    this.clip = captureClip(cache.cells, sheet, range, cut);
    this.clipboard = this.clip.tsv;
    this.set({ clipMark: { sheet, range, cut } });
    return this.clip.tsv;
  }

  /** Esc: ends copy mode (and cancels a pending cut). */
  clearClip(): void {
    this.clip = null;
    this.clipboard = "";
    if (this.state.clipMark) this.set({ clipMark: null });
  }

  /** Whether a paste from the internal clipboard is possible. */
  hasClip(): boolean {
    return this.clip !== null;
  }

  /**
   * Pastes at the selection's top-left, as one `pasteRange` (one undo
   * step). Our own copy (no `text`, or `text` equal to its TSV) pastes
   * inputs and formats with references shifted, repeated over a
   * selection that is a multiple of the block; a cut moves the cells and
   * ends copy mode. Other `text` is TSV from another program: plain
   * inputs, destination formats kept.
   */
  paste(text?: string, mode: PasteMode = "all"): Promise<void> {
    const sheet = this.state.activeSheet;
    const sel = normalize(this.state.selection);
    const clip = this.clip;
    let command: CalcCommand;
    let rows: number;
    let cols: number;
    let at: { r0: number; c0: number; repeatRows: number; repeatCols: number };
    if (clip && (text === undefined || sameText(text, clip.tsv))) {
      rows = clip.range.r1 - clip.range.r0 + 1;
      cols = clip.range.c1 - clip.range.c0 + 1;
      at = clip.cut ? { r0: sel.r0, c0: sel.c0, repeatRows: 1, repeatCols: 1 } : pasteTarget(sel, rows, cols);
      command = {
        type: "pasteRange", sheet, r0: at.r0, c0: at.c0, src: { sheet: clip.sheet, ...clip.range },
        cells: clip.cells, mode: clip.cut ? "all" : mode, cut: clip.cut, repeatRows: at.repeatRows, repeatCols: at.repeatCols,
      };
    } else {
      if (!text) return Promise.resolve();
      const block = tsvClip(text);
      ({ rows, cols } = block);
      at = pasteTarget(sel, rows, cols);
      if (at.r0 + rows * at.repeatRows - 1 > LAST_ROW || at.c0 + cols * at.repeatCols - 1 > LAST_COL) {
        this.pushError(new Error(t("calc.pasteTooBig")));
        return Promise.resolve();
      }
      command = {
        type: "pasteRange", sheet, r0: at.r0, c0: at.c0,
        src: { sheet, r0: at.r0, c0: at.c0, r1: at.r0 + rows - 1, c1: at.c0 + cols - 1 },
        cells: block.cells, mode: "all", cut: false, repeatRows: at.repeatRows, repeatCols: at.repeatCols,
      };
    }
    const r1 = Math.min(LAST_ROW, at.r0 + rows * at.repeatRows - 1);
    const c1 = Math.min(LAST_COL, at.c0 + cols * at.repeatCols - 1);
    // Excel refuses to paste over part of a merged cell.
    if (this.refuseMergeSplit({ r0: at.r0, c0: at.c0, r1, c1 })) return Promise.resolve();
    if (clip?.cut && command.type === "pasteRange" && command.cut) {
      this.clip = null;
      this.set({ clipMark: null });
    }
    this.select({ anchor: { row: at.r0, col: at.c0 }, focus: { row: r1, col: c1 } });
    return this.apply(command);
  }

  /** Toasts and returns `true` when `r` would cut through a merged cell of the active sheet. */
  private refuseMergeSplit(r: Range): boolean {
    if (!partialMerge(r, this.merges())) return false;
    this.pushError(new Error(t("calc.mergeSplit")));
    return true;
  }

  // --- fill handle ----------------------------------------------------------

  /** Fill-handle drag: fills `dst` from the selection (`alternate`: Ctrl held) and selects both. */
  fill(dst: Rect, mode: FillMode = "auto"): Promise<void> {
    const src = normalize(this.state.selection);
    const sheet = this.state.activeSheet;
    const r = { r0: Math.min(src.r0, dst.r0), c0: Math.min(src.c0, dst.c0), r1: Math.max(src.r1, dst.r1), c1: Math.max(src.c1, dst.c1) };
    if (this.refuseMergeSplit(r)) return Promise.resolve();
    this.select(normalizeAround(this.state.selection.anchor, r));
    return this.apply({ type: "fillRange", sheet, src, dst, mode });
  }

  /**
   * Ctrl+D / Ctrl+R: copies the selection's first row down (`"down"`) or its first column right (`"right"`) over the
   * rest of it; a single row (column) is filled from the row above (column to the left), as in Excel. The selection
   * stays.
   */
  fillCopy(direction: "down" | "right"): Promise<void> {
    const sheet = this.state.activeSheet;
    const r = clipRange(normalize(this.state.selection), this.cache(sheet));
    let src: Rect;
    let dst: Rect;
    if (direction === "down") {
      if (r.r0 === r.r1 && r.r0 === 0) return Promise.resolve();
      src = r.r0 === r.r1 ? { ...r, r0: r.r0 - 1, r1: r.r0 - 1 } : { ...r, r1: r.r0 };
      dst = r.r0 === r.r1 ? r : { ...r, r0: r.r0 + 1 };
    } else {
      if (r.c0 === r.c1 && r.c0 === 0) return Promise.resolve();
      src = r.c0 === r.c1 ? { ...r, c0: r.c0 - 1, c1: r.c0 - 1 } : { ...r, c1: r.c0 };
      dst = r.c0 === r.c1 ? r : { ...r, c0: r.c0 + 1 };
    }
    if (this.refuseMergeSplit({ r0: Math.min(src.r0, dst.r0), c0: Math.min(src.c0, dst.c0), r1: dst.r1, c1: dst.c1 })) return Promise.resolve();
    return this.apply({ type: "fillRange", sheet, src, dst, mode: "copy" });
  }

  /** Double-click on the fill handle: fills down to the end of the neighbouring column's data. */
  fillToData(mode: FillMode = "auto"): Promise<void> {
    const src = normalize(this.state.selection);
    const cache = this.cache(this.state.activeSheet);
    const isFilled = (r: number, c: number) => (cache.cells.get(r)?.get(c)?.input ?? "") !== "";
    const end = fillDownEnd(src, isFilled, this.usedExtent(this.state.activeSheet).lastRow);
    if (end === null || end <= src.r1) return Promise.resolve();
    return this.fill({ r0: src.r1 + 1, c0: src.c0, r1: end, c1: src.c1 }, mode);
  }

  // --- dialogs, find & replace ---------------------------------------------

  openDialog(dialog: CalcDialog): void {
    if (this.state.edit) void this.commitEdit(0, 0);
    if (this.state.edit) return;
    this.set({ dialog });
  }

  closeDialog(): void {
    if (this.state.dialog) this.set({ dialog: null });
  }

  /** The core's number formatting of `value` with `code` (Format Cells preview). */
  formatPreview(value: number, code: string): Promise<string> {
    return this.api.formatPreview(value, code);
  }

  private findCells(o: FindOptions): Promise<FoundCell[]> {
    return this.api.findCells(o.allSheets ? null : this.state.activeSheet, o.query, o.matchCase, o.wholeCell);
  }

  private goTo(c: FoundCell): void {
    if (c.sheet !== this.state.activeSheet) this.setActiveSheet(c.sheet);
    if (this.state.activeSheet === c.sheet) this.select(cellSelection(c.row, c.col));
  }

  /** Find next / previous from the active cell (wrapping); selects the match. `null`: nothing found. */
  async findNext(o: FindOptions, backwards = false): Promise<FoundCell | null> {
    let found: FoundCell[] = [];
    await this.guard(async () => {
      found = await this.findCells(o);
    });
    const order = (this.state.info?.sheets ?? []).map((s) => s.id);
    const { anchor } = this.state.selection;
    const next = findStep(found, order, { sheet: this.state.activeSheet, row: anchor.row, col: anchor.col }, backwards);
    if (next) this.goTo(next);
    return next;
  }

  /** Replace: replaces in the active cell when it matches, then finds the next match. */
  async replaceNext(o: FindOptions, replacement: string): Promise<FoundCell | null> {
    let found: FoundCell[] = [];
    await this.guard(async () => {
      found = await this.findCells(o);
    });
    const { anchor } = this.state.selection;
    const here = found.find((c) => c.sheet === this.state.activeSheet && c.row === anchor.row && c.col === anchor.col);
    const next = here && replaceInInput(here.input, o.query, replacement, o.matchCase, o.wholeCell);
    if (here && next !== null && next !== undefined) {
      await this.apply({ type: "setInput", sheet: here.sheet, row: here.row, col: here.col, input: next });
    }
    return this.findNext(o);
  }

  /** Replace all: every matching input rewritten in one `compound`; resolves to the count. */
  async replaceAll(o: FindOptions, replacement: string): Promise<number> {
    let commands: CalcCommand[] = [];
    await this.guard(async () => {
      const found = await this.findCells(o);
      commands = found.flatMap((c) => {
        const input = replaceInInput(c.input, o.query, replacement, o.matchCase, o.wholeCell);
        return input === null || input === c.input ? [] : [{ type: "setInput" as const, sheet: c.sheet, row: c.row, col: c.col, input }];
      });
    });
    if (commands.length > 0) await this.apply(commands.length === 1 ? commands[0]! : { type: "compound", commands });
    return commands.length;
  }

  // --- rows and columns -------------------------------------------------------

  /** Selected columns (`c0..c1`) or rows of the selection. */
  private span(axis: "rows" | "cols"): number[] {
    const r = normalize(this.state.selection);
    const [a, b] = axis === "rows" ? [r.r0, r.r1] : [r.c0, r.c1];
    const out: number[] = [];
    for (let i = a; i <= Math.min(b, a + 999); i++) out.push(i);
    return out;
  }

  private applyAll(commands: CalcCommand[]): Promise<void> {
    if (commands.length === 0) return Promise.resolve();
    return this.apply(commands.length === 1 ? commands[0]! : { type: "compound", commands });
  }

  /** Hides (or shows) the selected rows/columns. Unhide shows the hidden ones inside the selection. */
  setHidden(axis: "rows" | "cols", hidden: boolean): Promise<void> {
    const sheet = this.state.activeSheet;
    const cache = this.cache(sheet);
    const idx = this.span(axis).filter((i) => hidden || (axis === "rows" ? cache.rows.get(i)?.hidden : cache.cols.get(i)?.hidden));
    return this.applyAll(
      idx.map((i): CalcCommand => (axis === "rows" ? { type: "setRowHidden", sheet, row: i, hidden } : { type: "setColHidden", sheet, col: i, hidden })),
    );
  }

  /** Row height (points) / column width (characters) of the selected rows/columns; `null` = default. */
  setSize(axis: "rows" | "cols", size: number | null): Promise<void> {
    const sheet = this.state.activeSheet;
    return this.applyAll(
      this.span(axis).map((i): CalcCommand => {
        if (axis === "rows") {
          this.autoRows.delete(`${sheet}:${i}`);
          return { type: "setRowHeight", sheet, row: i, height: size };
        }
        return { type: "setColWidth", sheet, col: i, width: size };
      }),
    );
  }

  /** Current height (pt) of the active row / width (chars) of the active column. */
  currentSize(axis: "rows" | "cols"): number {
    const cache = this.cache(this.state.activeSheet);
    const { anchor } = this.state.selection;
    return axis === "rows"
      ? (cache.rows.get(anchor.row)?.height ?? cache.format.defaultRowHeight)
      : (cache.cols.get(anchor.col)?.width ?? cache.format.defaultColWidth);
  }

  /**
   * Column autofit: the widest displayed text of each column among the
   * cached cells (loaded blocks only), or the default width when the
   * column is empty. One undo step.
   */
  autofitCols(cols: number[]): Promise<void> {
    const sheet = this.state.activeSheet;
    const cache = this.cache(sheet);
    const widest = new Map<number, number>(cols.map((c) => [c, 0]));
    for (const row of cache.cells.values()) {
      for (const [c, cell] of row) {
        if (!widest.has(c) || cell.display === "") continue;
        const style = styleAt(this.styles(), cell.style);
        if (style.alignment?.wrapText) continue;
        const w = this.measure(cell.display.replace(/\n/g, " "), fontCss(style));
        if (w > widest.get(c)!) widest.set(c, w);
      }
    }
    return this.applyAll(
      [...widest].map(([col, w]): CalcCommand => ({
        type: "setColWidth", sheet, col, width: w === 0 ? null : pxToChars(Math.ceil(w + 2 * CELL_PADDING + 3)),
      })),
    );
  }

  /** Autofit every column that has cached content. */
  autofitAllCols(): Promise<void> {
    const cols = new Set<number>();
    for (const row of this.cache(this.state.activeSheet).cells.values()) for (const [c, cell] of row) if (cell.display !== "") cols.add(c);
    return this.autofitCols([...cols].sort((a, b) => a - b));
  }

  /** Row autofit (double-click on a row boundary): tallest font, wrapped text included. */
  autofitRow(row: number): Promise<void> {
    const sheet = this.state.activeSheet;
    this.autoRows.add(`${sheet}:${row}`);
    const fit = this.rowFitCommands(sheet, [row], () => undefined);
    if (fit.length > 0) return this.applyAll(fit);
    const cache = this.cache(sheet);
    let tallest = 0;
    for (const cell of cache.cells.get(row)?.values() ?? []) {
      if (cell.display) tallest = Math.max(tallest, lineHeightPx(fontCss(styleAt(this.styles(), cell.style))));
    }
    const def = rowHeightPx(cache.format.defaultRowHeight);
    return this.setRowHeight(row, tallest === 0 || tallest <= def ? null : tallest);
  }

  setColWidth(col: number, widthPx: number | null): Promise<void> {
    const width = widthPx === null ? null : pxToChars(widthPx);
    return this.apply({ type: "setColWidth", sheet: this.state.activeSheet, col, width });
  }

  setRowHeight(row: number, heightPx: number | null): Promise<void> {
    const height = heightPx === null ? null : Math.max(0, Math.round(((heightPx * 72) / 96) * 100) / 100);
    return this.apply({ type: "setRowHeight", sheet: this.state.activeSheet, row, height });
  }

  /** Adds a new empty sheet `SheetN` at position `index` (default: last) and shows it. */
  addSheet(index?: number): Promise<void> {
    const names = new Set((this.state.info?.sheets ?? []).map((s) => s.name.toLowerCase()));
    let n = (this.state.info?.sheets.length ?? 0) + 1;
    while (names.has(`sheet${n}`)) n++;
    const command: CalcCommand = index === undefined ? { type: "addSheet", name: `Sheet${n}` } : { type: "addSheet", name: `Sheet${n}`, index };
    return this.applyAndShowNew(command);
  }

  /** Excel's Insert sheet (Shift+F11): a new sheet before `sheet` (default: the active one). */
  insertSheet(sheet = this.state.activeSheet): Promise<void> {
    const at = this.sheetPosition(sheet);
    return this.addSheet(at < 0 ? undefined : at);
  }

  /** Position of `sheet` in the tab order (-1: unknown). */
  sheetPosition(sheet: number): number {
    return (this.state.info?.sheets ?? []).findIndex((s) => s.id === sheet);
  }

  private applyAndShowNew(command: CalcCommand): Promise<void> {
    const before = new Set((this.state.info?.sheets ?? []).map((s) => s.id));
    return this.apply(command).then(() => {
      const added = this.state.info?.sheets.find((s) => !before.has(s.id));
      if (added) this.setActiveSheet(added.id);
    });
  }

  /**
   * Deletes `sheet`. A sheet with content (or own cell formats) asks first
   * (the `deleteSheet` dialog calls back with `confirmed`); the last sheet
   * cannot be deleted.
   */
  deleteSheet(sheet: number, confirmed = false): Promise<void> {
    const sheets = this.state.info?.sheets ?? [];
    const info = sheets.find((s) => s.id === sheet);
    if (!info) return Promise.resolve();
    if (sheets.length <= 1) {
      this.pushError(new Error(t("calc.lastSheet")));
      return Promise.resolve();
    }
    if (!info.hidden && visibleSheets(sheets).length <= 1) {
      this.pushError(new Error(t("calc.lastVisibleSheet")));
      return Promise.resolve();
    }
    return this.guard(async () => {
      if (!confirmed && (await this.api.usedRange(sheet)) !== null) {
        this.openDialog({ kind: "deleteSheet", sheet, name: info.name });
        return;
      }
      if (this.state.edit) await this.commitEdit(0, 0);
      this.applyEnvelope(await this.api.apply({ type: "deleteSheet", sheet }));
    });
  }

  /** Copies `sheet` to `Name (2)` (the first free number) right after it and shows the copy. */
  duplicateSheet(sheet: number): Promise<void> {
    const sheets = this.state.info?.sheets ?? [];
    const name = sheets.find((s) => s.id === sheet)?.name;
    if (name === undefined) return Promise.resolve();
    const names = new Set(sheets.map((s) => s.name.toLowerCase()));
    const base = name.replace(/ \(\d+\)$/, "");
    let n = 2;
    while (names.has(`${base} (${n})`.toLowerCase())) n++;
    return this.applyAndShowNew({ type: "duplicateSheet", sheet, name: `${base} (${n})` });
  }

  /** Moves `sheet` to tab position `index`. */
  moveSheet(sheet: number, index: number): Promise<void> {
    const count = this.state.info?.sheets.length ?? 0;
    const target = Math.max(0, Math.min(index, count - 1));
    if (target === this.sheetPosition(sheet) || count === 0) return Promise.resolve();
    return this.apply({ type: "moveSheet", sheet, index: target });
  }

  /** Moves `sheet` one tab left (-1) or right (1): past the neighbouring visible tab (hidden sheets keep their places). */
  moveSheetBy(sheet: number, delta: -1 | 1): Promise<void> {
    const sheets = this.state.info?.sheets ?? [];
    const at = this.sheetPosition(sheet);
    if (at < 0) return Promise.resolve();
    let to = at + delta;
    while (to >= 0 && to < sheets.length && sheets[to]!.hidden) to += delta;
    return to < 0 || to >= sheets.length ? Promise.resolve() : this.moveSheet(sheet, to);
  }

  /** Tab colour of `sheet`; `null` = default. */
  setTabColor(sheet: number, color: Color | null): Promise<void> {
    return this.apply({ type: "setSheetTabColor", sheet, color });
  }

  /** Hides `sheet` (its tab goes; the neighbour is shown); the last visible sheet cannot be hidden. */
  hideSheet(sheet = this.state.activeSheet): Promise<void> {
    const sheets = this.state.info?.sheets ?? [];
    const info = sheets.find((s) => s.id === sheet);
    if (!info || info.hidden) return Promise.resolve();
    if (visibleSheets(sheets).length <= 1) {
      this.pushError(new Error(t("calc.lastVisibleSheet")));
      return Promise.resolve();
    }
    return this.guard(async () => {
      if (this.state.edit) await this.commitEdit(0, 0);
      if (this.state.edit) return;
      this.applyEnvelope(await this.api.apply({ type: "setSheetHidden", sheet, hidden: true }));
    });
  }

  /** Shows the hidden `sheet` again and switches to it. */
  unhideSheet(sheet: number): Promise<void> {
    return this.apply({ type: "setSheetHidden", sheet, hidden: false });
  }

  // --- sheet view: frozen panes, zoom, gridlines, headings -------------------

  /** The view settings of `sheet` (default: the active one). */
  sheetView(sheet = this.state.activeSheet): SheetView {
    return sheetViewOf(this.state.info, sheet);
  }

  /** Changes view settings of the active sheet (saved with the file). */
  setSheetView(patch: SheetViewPatch): Promise<void> {
    const view = this.sheetView();
    const changed = (Object.keys(patch) as (keyof SheetViewPatch)[]).some((k) => patch[k] !== undefined && patch[k] !== view[k]);
    return changed ? this.apply({ type: "setSheetView", sheet: this.state.activeSheet, patch }) : Promise.resolve();
  }

  /**
   * View › Freeze Panes: at the active cell (rows above, columns left of
   * it), the top row, the first column, or none (unfreeze).
   */
  freezePanes(kind: "selection" | "topRow" | "firstCol" | "none"): Promise<void> {
    const { row, col } = this.activeAnchor();
    const [rows, cols] = kind === "selection" ? [row, col] : kind === "topRow" ? [1, 0] : kind === "firstCol" ? [0, 1] : [0, 0];
    const view = this.sheetView();
    if (view.frozenRows === rows && view.frozenCols === cols) return Promise.resolve();
    return this.apply({ type: "setFreeze", sheet: this.state.activeSheet, rows, cols });
  }

  // --- merged cells ------------------------------------------------------------

  /**
   * Home › Merge: Merge & Center (merge, then centre), Merge Across (one
   * merge per selected row) or Merge Cells. When more than one cell of a
   * future merge has content, the `mergeConfirm` dialog asks first
   * (only the upper-left value is kept) and calls back with `confirmed`.
   */
  mergeSelection(kind: MergeKind, confirmed = false): Promise<void> {
    const sheet = this.state.activeSheet;
    const r = this.selectionRange();
    const groups: Range[] = [];
    if (kind === "across") {
      if (r.c0 === r.c1) return Promise.resolve();
      for (let row = r.r0; row <= Math.min(r.r1, r.r0 + 9999); row++) groups.push({ r0: row, c0: r.c0, r1: row, c1: r.c1 });
    } else {
      if (r.r0 === r.r1 && r.c0 === r.c1) return Promise.resolve();
      groups.push(r);
    }
    if (!confirmed && groups.some((g) => this.filledCount(g) > 1)) {
      this.openDialog({ kind: "mergeConfirm", merge: kind });
      return Promise.resolve();
    }
    const commands: CalcCommand[] = groups.map((g) => ({ type: "mergeCells", sheet, ...g }));
    if (kind === "center") commands.push({ type: "applyStyle", sheet, ...r, patch: { alignment: { horizontal: "center" } } });
    return this.applyAll(commands).then(() => this.select(this.state.selection));
  }

  /** Home › Unmerge Cells: removes every merge touching the selection. */
  unmergeSelection(): Promise<void> {
    const r = this.selectionRange();
    if (!this.merges().some((m) => intersects(m, r))) return Promise.resolve();
    return this.apply({ type: "unmergeCells", sheet: this.state.activeSheet, ...r });
  }

  /** The Merge & Center button: unmerges a selection with merged cells, else merges and centres it (Excel's toggle). */
  toggleMergeCenter(): Promise<void> {
    const r = this.selectionRange();
    return this.merges().some((m) => intersects(m, r)) ? this.unmergeSelection() : this.mergeSelection("center");
  }

  /** Whether the selection touches a merged cell. */
  selectionHasMerge(): boolean {
    const r = normalize(this.state.selection);
    return this.merges().some((m) => intersects(m, r));
  }

  /** Cells with content in `r` (cached cells only). */
  private filledCount(r: Range): number {
    let n = 0;
    for (const [row, cells] of this.cache(this.state.activeSheet).cells) {
      if (row < r.r0 || row > r.r1) continue;
      for (const [col, cell] of cells) if (col >= r.c0 && col <= r.c1 && cell.input !== "") n++;
    }
    return n;
  }

  renameSheet(sheet: number, name: string): Promise<void> {
    const current = this.state.info?.sheets.find((s) => s.id === sheet)?.name;
    if (!name.trim() || name === current) return Promise.resolve();
    return this.apply({ type: "renameSheet", sheet, name: name.trim() });
  }
}

/** Column width px → Excel character units. */
export function pxToChars(px: number): number {
  return Math.max(0, Math.round(((px - 5) / 7) * 100) / 100);
}

/** A selection covering `r` with `anchor` kept as the active cell. */
function normalizeAround(anchor: Cell, r: Range): Selection {
  const focus = { row: anchor.row === r.r0 ? r.r1 : r.r0, col: anchor.col === r.c0 ? r.c1 : r.c0 };
  return { anchor: { ...anchor }, focus };
}

/** Subscribes a component to a slice of the store. */
export function useCalc<T>(store: CalcStore, select: (s: CalcState) => T): T {
  return useSyncExternalStore(store.subscribe, () => select(store.getState()));
}
