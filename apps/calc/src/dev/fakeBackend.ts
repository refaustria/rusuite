// Dev/test-only in-memory stand-in for the calc core's `dispatch`
// (`?fake=1` in dev builds, and the Vitest suites). It follows the wire
// contract of `calc_core::dispatch` closely enough for the grid, but its
// formula support is a toy: numbers, strings, cell refs, ranges in
// functions, + - * / & and SUM/AVERAGE/MIN/MAX/COUNT. The real engine
// lives in Rust (ADR 0001); nothing here is used in production builds.

import type { Backend, Color, OpenedFile, SaveOptions, SaveResult } from "@rusuite/ui-shared";
import type { AutoFilter } from "../generated/AutoFilter";
import type { CalcCommand } from "../generated/CalcCommand";
import type { CalcPatch } from "../generated/CalcPatch";
import type { CalcState } from "../generated/CalcState";
import type { ErrorIssue } from "../generated/ErrorIssue";
import type { CellKind } from "../generated/CellKind";
import type { CellStyle } from "../generated/CellStyle";
import type { CellView } from "../generated/CellView";
import type { CellCf } from "../generated/CellCf";
import type { CfResult } from "../generated/CfResult";
import type { CfRule } from "../generated/CfRule";
import type { Chart } from "../generated/Chart";
import type { ChartObject } from "../generated/ChartObject";
import type { DataRef } from "../generated/DataRef";
import type { ResolvedChart } from "../generated/ResolvedChart";
import type { TextSource } from "../generated/TextSource";
import type { CompareOp } from "../generated/CompareOp";
import type { DataValidation } from "../generated/DataValidation";
import type { ValidationResult } from "../generated/ValidationResult";
import type { ColView } from "../generated/ColView";
import type { Filter } from "../generated/Filter";
import type { FilterValue } from "../generated/FilterValue";
import type { Rect } from "../generated/Rect";
import type { Request } from "../generated/Request";
import type { Response } from "../generated/Response";
import type { ResponseBody } from "../generated/ResponseBody";
import type { RowView } from "../generated/RowView";
import type { SheetInfo } from "../generated/SheetInfo";
import type { SheetView } from "../generated/SheetView";
import type { SheetProtection } from "../generated/SheetProtection";
import type { WorkbookProtection } from "../generated/WorkbookProtection";
import type { TableStyles } from "../generated/TableStyles";
import type { Slicer } from "../generated/Slicer";
import type { SlicerSource } from "../generated/SlicerSource";
import type { SlicerView } from "../generated/SlicerView";
import type { SortKey } from "../generated/SortKey";
import type { SortState } from "../generated/SortState";
import type { NameDef } from "../generated/NameDef";
import type { NameInfo } from "../generated/NameInfo";
import type { NameRow } from "../generated/NameRow";
import type { SheetRect } from "../generated/SheetRect";
import type { Hyperlink } from "../generated/Hyperlink";
import type { Note } from "../generated/Note";
import type { Person } from "../generated/Person";
import type { Thread } from "../generated/Thread";
import type { SheetAnnotations } from "../generated/SheetAnnotations";
import type { Table } from "../generated/Table";
import type { Picture } from "../generated/Picture";
import type { TextImportOptions } from "../generated/TextImportOptions";
import { parseRange, rangeFormula } from "../charts/refs";
import { findRefs } from "../formula/refs";
import { nameProblem } from "../names/names";
import { FakePivots } from "./fakePivot";
import { applyBorderEdits } from "../numfmt/formatCells";

interface FakeCell {
  input: string;
  style: number;
}

interface FakeSheet {
  id: number;
  name: string;
  cells: Map<number, Map<number, FakeCell>>;
  cols: Map<number, ColView>;
  rows: Map<number, RowView>;
  formulas: Set<string>;
  tabColor?: Color;
  hidden?: boolean;
  veryHidden?: boolean;
  view: SheetView;
  merges: Rect[];
  autoFilter?: AutoFilter;
  sortState?: SortState;
  /** Conditional formatting rules by priority (a toy evaluation: see `cfOf`). */
  cfRules: CfRule[];
  validations: DataValidation[];
  /** Charts back to front (a toy: data resolved from same-workbook A1 references). */
  charts: ChartObject[];
  /** Notes, threads and hyperlinks (P8-26). */
  notes: Note[];
  threads: Thread[];
  hyperlinks: Hyperlink[];
  /** Excel tables (P8-35; a toy: no structured references). */
  tables: Table[];
  rowBreaks: number[];
  colBreaks: number[];
  pictures: Picture[];
  /** Protect Sheet (P9-C1); the fake keeps the password as text. */
  protection?: SheetProtection;
  password?: string;
}

const DEFAULT_VIEW: SheetView = { frozenRows: 0, frozenCols: 0, zoom: 100, showGridlines: true, showHeadings: true };

function intersects(a: Rect, b: Rect): boolean {
  return a.r0 <= b.r1 && b.r0 <= a.r1 && a.c0 <= b.c1 && b.c0 <= a.c1;
}

type Value = number | string | boolean | { error: string };

class Fail extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

function mergeStyle(base: CellStyle, patch: CellStyle): CellStyle {
  const out: CellStyle = { ...base };
  if (patch.font) out.font = { ...base.font, ...patch.font };
  if (patch.alignment) out.alignment = { ...base.alignment, ...patch.alignment };
  if (patch.fill) out.fill = patch.fill.kind === "none" ? null : patch.fill;
  if (patch.borders) {
    const b = { ...base.borders };
    for (const [k, v] of Object.entries(patch.borders) as [keyof typeof b, (typeof b)["left"]][]) {
      if (v === null) delete b[k];
      else if (v) b[k] = v;
    }
    out.borders = b;
  }
  if (patch.numberFormat !== undefined) out.numberFormat = patch.numberFormat === "General" ? null : patch.numberFormat;
  if (patch.protection) out.protection = { ...base.protection, ...patch.protection };
  if (patch.underlineAccounting !== undefined && patch.underlineAccounting !== null) out.underlineAccounting = patch.underlineAccounting || undefined;
  return out;
}

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return "#NUM!";
  return String(Number(n.toPrecision(11)));
}

/** In-memory model with undo/redo by inverse commands, like `app_common::Host`. */
export class FakeCalcCore {
  sheets: FakeSheet[] = [];
  styles: CellStyle[] = [{}];
  /** Protect Workbook (P9-C1) and its password (as text: a fake). */
  private bookProtection: WorkbookProtection | undefined;
  private tableStyles: TableStyles = {};
  /** Formulas › Calculation Options (P9-C4; the fake always calculates at once). */
  private calc: CalcState = { options: { mode: "automatic", fullCalcOnLoad: true, r1c1: false }, needsCalc: false };
  /** Slicers (toy): table sources only; the selection per cache (`null` = all). */
  private slicerList: { sheet: number; slicer: Slicer; source: SlicerSource; selected: string[] | null }[] = [];
  private bookPassword = "";
  revision = 0;
  undoStack: CalcCommand[] = [];
  redoStack: CalcCommand[] = [];
  savedRevision = 0;
  /** File name of the open document (`null` = new). */
  name: string | null = null;
  /** Every request seen, for tests. */
  log: Request[] = [];
  /** Defined names in definition order (a toy: ranges and constants evaluate). */
  names: NameDef[] = [];
  /** Comment authors (`setUser`). */
  persons: Person[] = [];
  private commentSeq = 0;
  /** Deleted sheets by id (ids are never reused; undo brings them back whole). */
  private removed = new Map<number, FakeSheet>();
  private nextId = 0;
  /** Toy pivot tables (P8-33). */
  readonly pivots = new FakePivots({
    read: (sheet, r, c) => {
      const v = this.value(this.sheet(sheet), r, c);
      return typeof v === "number" || typeof v === "string" ? v : typeof v === "boolean" ? (v ? "TRUE" : "FALSE") : v.error;
    },
    write: (sheet, r, c, input) => this.setCell(this.sheet(sheet), r, c, input),
    sheetName: (sheet) => this.sheet(sheet).name,
    addSheet: (before) => {
      let n = this.sheets.length + 1;
      while (this.sheets.some((x) => x.name.toLowerCase() === `sheet${n}`)) n++;
      const sh = this.newSheet(this.nextId++, `Sheet${n}`);
      this.sheets.splice(Math.max(0, this.sheets.findIndex((x) => x.id === before)), 0, sh);
      return sh.id;
    },
  });

  /** `sheetNames`: the sheets of a new document (default one, "Sheet1"). */
  constructor(private readonly sheetNames: string[] = ["Sheet1"]) {
    this.reset();
  }

  reset(): void {
    this.name = null;
    this.sheets = this.sheetNames.map((name, id) => this.newSheet(id, name));
    this.removed.clear();
    this.nextId = this.sheets.length;
    this.styles = [{}];
    this.bookProtection = undefined;
    this.names = [];
    this.persons = [];
    this.pivots?.reset();
    this.undoStack = [];
    this.redoStack = [];
    this.revision++;
    this.savedRevision = this.revision;
  }

  private newSheet(id: number, name: string): FakeSheet {
    return {
      id, name, cells: new Map(), cols: new Map(), rows: new Map(), formulas: new Set(), view: { ...DEFAULT_VIEW }, merges: [], cfRules: [], validations: [], charts: [], notes: [], threads: [], hyperlinks: [],
      tables: [], rowBreaks: [], colBreaks: [], pictures: [],
    };
  }

  private sheet(id: number): FakeSheet {
    const s = this.sheets.find((x) => x.id === id);
    if (!s) throw new Fail("unknown_sheet", `unknown sheet ${id}`);
    return s;
  }

  private sheetInfos(): SheetInfo[] {
    return this.sheets.map(({ id, name, tabColor, hidden, veryHidden, view, autoFilter, sortState, tables, rowBreaks, colBreaks, rows, cols }) => {
      const info: SheetInfo = { id, name };
      if (tables.length) info.tables = JSON.parse(JSON.stringify(tables)) as Table[];
      if (rowBreaks.length) info.rowBreaks = [...rowBreaks];
      if (colBreaks.length) info.colBreaks = [...colBreaks];
      const maxLevel = (m: Map<number, { outlineLevel?: number }>) => Math.max(0, ...[...m.values()].map((x) => x.outlineLevel ?? 0));
      const ml: [number, number] = [maxLevel(rows), maxLevel(cols)];
      if (ml[0] || ml[1]) info.maxOutline = ml;
      if (autoFilter) info.autoFilter = JSON.parse(JSON.stringify(autoFilter)) as AutoFilter;
      if (sortState) info.sortState = JSON.parse(JSON.stringify(sortState)) as SortState;
      if (tabColor) info.tabColor = tabColor;
      if (hidden) info.hidden = true;
      if (veryHidden) info.veryHidden = true;
      const protection = this.sheets.find((x) => x.id === id)?.protection;
      if (protection) info.protection = { ...protection };
      if (JSON.stringify(view) !== JSON.stringify(DEFAULT_VIEW)) info.view = { ...view };
      const slicers = this.slicerList.filter((x) => x.sheet === id).map((x) => this.slicerView(x));
      if (slicers.length) info.slicers = slicers;
      return info;
    });
  }

  private slicerView(x: { sheet: number; slicer: Slicer; source: SlicerSource; selected: string[] | null }): SlicerView {
    const names = new Set<string>();
    if (x.source.kind === "table") {
      const src = x.source;
      for (const sh of this.sheets) {
        const t = sh.tables.find((tt) => tt.id === src.table);
        if (!t) continue;
        const col = t.c0 + t.columns.findIndex((c) => c.id === src.column);
        for (let r = t.r0 + (t.headerRow ? 1 : 0); r <= t.r1 - (t.totalsRow ? 1 : 0); r++) names.add(this.view(sh, r, col).display);
      }
    }
    const items = [...names].sort((a, b) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b))).map((name) => ({ name, selected: !x.selected || x.selected.includes(name), hasData: true }));
    return { slicer: { ...x.slicer }, source: x.source, sort: "ascending", items };
  }

  private sheetsPatch(): CalcPatch {
    const patch = this.emptyPatch();
    patch.sheets = this.sheetInfos();
    return patch;
  }

  private mergesPatch(s: FakeSheet): CalcPatch {
    const patch = this.emptyPatch();
    patch.merges = [{ sheet: s.id, merges: s.merges.map((m) => ({ ...m })) }];
    return patch;
  }

  private cell(s: FakeSheet, r: number, c: number): FakeCell | undefined {
    return s.cells.get(r)?.get(c);
  }

  private setCell(s: FakeSheet, r: number, c: number, input: string, style?: number): void {
    const prev = this.cell(s, r, c);
    const st = style ?? prev?.style ?? 0;
    const key = `${r},${c}`;
    if (input.startsWith("=")) s.formulas.add(key);
    else s.formulas.delete(key);
    if (input === "" && st === 0) {
      s.cells.get(r)?.delete(c);
      return;
    }
    let row = s.cells.get(r);
    if (!row) s.cells.set(r, (row = new Map()));
    row.set(c, { input, style: st });
  }

  private effectiveStyle(s: FakeSheet, r: number, c: number): number {
    return this.cell(s, r, c)?.style || s.rows.get(r)?.style || s.cols.get(c)?.style || 0;
  }

  // --- evaluation ---------------------------------------------------------

  private value(s: FakeSheet, r: number, c: number, depth = 0): Value {
    const input = this.cell(s, r, c)?.input ?? "";
    if (input === "") return "";
    if (input.startsWith("=")) {
      if (depth > 64) return { error: "#REF!" };
      try {
        return new Parser(
          input.slice(1),
          (rr, cc, sh) => this.value(sh ? this.sheetByName(sh) : s, rr, cc, depth + 1),
          (name) => this.nameTarget(name, s),
        ).parse();
      } catch (e) {
        return { error: e instanceof Fail ? e.code : "#NAME?" };
      }
    }
    const n = Number(input);
    if (input.trim() !== "" && Number.isFinite(n)) return n;
    if (/^(true|false)$/i.test(input)) return input.toUpperCase() === "TRUE";
    return input;
  }

  private sheetByName(name: string): FakeSheet {
    const s = this.sheets.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (!s) throw new Fail("#REF!", "bad sheet");
    return s;
  }

  view(s: FakeSheet, r: number, c: number): CellView {
    const v = this.value(s, r, c);
    let display: string;
    let kind: CellKind;
    if (v === "") [display, kind] = ["", "empty"];
    else if (typeof v === "number") [display, kind] = [formatNumber(v), "number"];
    else if (typeof v === "boolean") [display, kind] = [v ? "TRUE" : "FALSE", "bool"];
    else if (typeof v === "object") [display, kind] = [v.error, "error"];
    else [display, kind] = [v, "text"];
    const view: CellView = { row: r, col: c, input: this.cell(s, r, c)?.input ?? "", display, kind, style: this.effectiveStyle(s, r, c) };
    if (s.notes.some((n) => n.row === r && n.col === c)) view.note = true;
    const th = s.threads.find((x) => x.row === r && x.col === c);
    if (th) view.comment = th.resolved ? "resolved" : "open";
    if (s.hyperlinks.some((h) => r >= h.r0 && r <= h.r1 && c >= h.c0 && c <= h.c1) || /^=HYPERLINK\(/i.test(view.input)) view.link = true;
    const pivot = this.pivots.role(s.id, r, c);
    if (pivot) view.pivot = { ...pivot };
    return view;
  }

  // --- commands -----------------------------------------------------------

  private emptyPatch(): CalcPatch {
    return { sheets: null, cells: [], cols: [], rows: [], styles: null, cycle: null, structural: [] };
  }

  /** Patch for edited cells plus every formula cell (no dependency graph here). */
  private cellsPatch(s: FakeSheet, coords: [number, number][]): CalcPatch {
    const patch = this.emptyPatch();
    const seen = new Set<string>();
    const add = (sh: FakeSheet, r: number, c: number) => {
      const key = `${sh.id}:${r},${c}`;
      if (seen.has(key)) return;
      seen.add(key);
      let g = patch.cells.find((x) => x.sheet === sh.id);
      if (!g) patch.cells.push((g = { sheet: sh.id, cells: [] }));
      g.cells.push(this.view(sh, r, c));
    };
    for (const [r, c] of coords) add(s, r, c);
    for (const sh of this.sheets) {
      for (const key of sh.formulas) {
        const [r, c] = key.split(",").map(Number);
        add(sh, r, c);
      }
    }
    return patch;
  }

  private checkRange(r0: number, c0: number, r1: number, c1: number): void {
    if (r0 > r1 || c0 > c1 || r1 > 1_048_575 || c1 > 16_383) throw new Fail("invalid_range", "invalid range");
    if ((r1 - r0 + 1) * (c1 - c0 + 1) > 1 << 22) throw new Fail("range_too_large", "range too large");
  }

  /** The core's protection check (P9-C1), for the commands the UI tests use. */
  private checkProtection(cmd: CalcCommand): void {
    const refuse = () => {
      throw new Fail("sheet_protected", "The cell or chart you're trying to change is on a protected sheet. To make a change, unprotect the sheet. You might be requested to enter a password.");
    };
    const locked = (s: FakeSheet, r: number, c: number) => this.styles[this.cell(s, r, c)?.style ?? 0]?.protection?.locked !== false;
    switch (cmd.type) {
      case "compound":
        cmd.commands.forEach((c) => this.checkProtection(c));
        return;
      case "addSheet": case "deleteSheet": case "renameSheet": case "duplicateSheet": case "moveSheet": case "setSheetHidden": case "setSheetTabColor":
        if (this.bookProtection?.lockStructure) throw new Fail("workbook_protected", "The workbook is protected and cannot be changed.");
        return;
      case "setInput": {
        const s = this.sheet(cmd.sheet);
        if (s.protection && locked(s, cmd.row, cmd.col)) refuse();
        return;
      }
      case "clearRange": {
        const s = this.sheet(cmd.sheet);
        if (!s.protection) return;
        for (let r = cmd.r0; r <= cmd.r1; r++) for (let c = cmd.c0; c <= cmd.c1; c++) if (locked(s, r, c)) refuse();
        return;
      }
      case "applyStyle": case "setBorders":
        if (this.sheet(cmd.sheet).protection?.formatCells) refuse();
        return;
      default:
        return;
    }
  }

  /** Applies a command; returns `[patch, inverse]`. */
  exec(cmd: CalcCommand): [CalcPatch, CalcCommand | null] {
    switch (cmd.type) {
      case "protectSheet": {
        const s = this.sheet(cmd.sheet);
        const prev = s.protection ? { protection: s.protection, password: s.password } : null;
        s.protection = { ...cmd.options, sheet: true };
        s.password = cmd.password ?? "";
        if (s.password) s.protection.password = { hashed: { algorithmName: "SHA-512", hashValue: "fake", saltValue: "fake", spinCount: 100000 } };
        else delete s.protection.password;
        void prev;
        return [this.sheetsPatch(), { type: "unprotectSheet", sheet: cmd.sheet, password: cmd.password }];
      }
      case "unprotectSheet": {
        const s = this.sheet(cmd.sheet);
        if (s.protection && (s.password ?? "") !== (cmd.password ?? "")) {
          throw new Fail("wrong_password", "The password you supplied is not correct. Verify that the CAPS LOCK key is off and be sure to use the correct capitalization.");
        }
        const old = s.protection;
        const pw = s.password;
        s.protection = undefined;
        s.password = undefined;
        return [this.sheetsPatch(), old ? { type: "protectSheet", sheet: cmd.sheet, options: old, password: pw } : null];
      }
      case "insertSlicers": {
        const old = structuredClone(this.slicerList);
        cmd.sources.forEach((source, k) => {
          const id = Math.max(0, ...this.slicerList.map((x) => x.slicer.id)) + 1;
          const t = source.kind === "table" ? this.sheets.flatMap((s) => s.tables).find((tt) => tt.id === source.table) : undefined;
          const base = (source.kind === "table" ? t?.columns.find((c) => c.id === source.column)?.name : undefined) ?? "Field";
          let name = base;
          for (let n = 1; this.slicerList.some((x) => x.slicer.name === name); n++) name = `${base} ${n}`;
          let cache = `Slicer_${base.replace(/\W/g, "_")}`;
          for (let n = 1; this.slicerList.some((x) => x.slicer.cache === cache); n++) cache = `Slicer_${base.replace(/\W/g, "_")}${n}`;
          const anchor = cmd.anchor.type === "oneCell" ? { ...cmd.anchor, from: { ...cmd.anchor.from, row: cmd.anchor.from.row + 2 * k, col: cmd.anchor.from.col + k } } : cmd.anchor;
          this.slicerList.push({ sheet: cmd.sheet, slicer: { id, name, cache, caption: base, style: "SlicerStyleLight1", anchor }, source, selected: null });
        });
        return [this.sheetsPatch(), { type: "restoreSlicers", caches: [], sheets: [], ...({ fake: old } as object) } as CalcCommand];
      }
      case "setSlicerSelection": {
        const xs = this.slicerList.filter((x) => x.slicer.cache === cmd.cache);
        const old = xs[0]?.selected ?? null;
        for (const x of xs) x.selected = cmd.selected ?? null;
        return [this.sheetsPatch(), { type: "setSlicerSelection", cache: cmd.cache, ...(old ? { selected: old } : {}) }];
      }
      case "updateSlicer": {
        const x = this.slicerList.find((y) => y.slicer.id === cmd.id);
        if (!x) throw new Fail("invalid_slicer", "unknown slicer");
        const old = { ...x.slicer };
        const p = cmd.patch;
        x.slicer = {
          ...x.slicer,
          ...(p.name !== undefined ? { name: p.name } : {}), ...(p.caption !== undefined ? { caption: p.caption } : {}),
          ...(p.columns !== undefined ? { columns: p.columns } : {}), ...(p.style !== undefined ? { style: p.style } : {}),
          ...(p.anchor !== undefined ? { anchor: p.anchor } : {}), ...(p.showCaption !== undefined ? { showCaption: p.showCaption } : {}),
          ...(p.rowHeight !== undefined ? { rowHeight: p.rowHeight } : {}),
        };
        return [this.sheetsPatch(), { type: "updateSlicer", id: cmd.id, patch: { name: old.name, caption: old.caption, columns: old.columns ?? 1, style: old.style, anchor: old.anchor } }];
      }
      case "deleteSlicer": {
        this.slicerList = this.slicerList.filter((x) => x.slicer.id !== cmd.id);
        return [this.sheetsPatch(), null];
      }
      case "setSlicerConnections":
      case "restoreSlicers": {
        const fake = (cmd as { fake?: { sheet: number; slicer: Slicer; source: SlicerSource; selected: string[] | null }[] }).fake;
        if (fake) this.slicerList = fake;
        return [this.sheetsPatch(), null];
      }
      case "setTableStyles": {
        const old = this.tableStyles;
        this.tableStyles = structuredClone(cmd.styles);
        const exists = (n: string) => /^TableStyle(Light|Medium|Dark)\d+$/.test(n) || (this.tableStyles.custom ?? []).some((c) => c.name.toLowerCase() === n.toLowerCase());
        for (const sh of this.sheets) {
          for (const t of sh.tables) {
            const r = (cmd.renamed ?? []).find((x) => x.from.toLowerCase() === t.style.toLowerCase());
            if (r) t.style = r.to;
            if (t.style && !exists(t.style)) t.style = this.tableStyles.defaultStyle ?? "TableStyleMedium2";
          }
        }
        const patch = this.sheetsPatch();
        patch.tableStyles = structuredClone(this.tableStyles);
        return [patch, { type: "setTableStyles", styles: old }];
      }
      case "protectWorkbook": {
        this.bookProtection = { lockStructure: cmd.structure, lockWindows: !!cmd.windows };
        this.bookPassword = cmd.password ?? "";
        const patch = this.emptyPatch();
        patch.workbookProtection = { ...this.bookProtection };
        return [patch, { type: "unprotectWorkbook", password: cmd.password }];
      }
      case "unprotectWorkbook": {
        if (this.bookProtection && this.bookPassword !== (cmd.password ?? "")) {
          throw new Fail("wrong_password", "The password you supplied is not correct. Verify that the CAPS LOCK key is off and be sure to use the correct capitalization.");
        }
        const old = this.bookProtection;
        this.bookProtection = undefined;
        const patch = this.emptyPatch();
        patch.workbookProtection = { lockStructure: false, lockWindows: false };
        return [patch, old ? { type: "protectWorkbook", structure: old.lockStructure, windows: old.lockWindows, password: this.bookPassword } : null];
      }
      case "setInput": {
        const s = this.sheet(cmd.sheet);
        if (cmd.input.startsWith("=") && /[(]/.test(cmd.input) && (cmd.input.match(/\(/g)?.length ?? 0) !== (cmd.input.match(/\)/g)?.length ?? 0)) {
          throw new Fail("invalid_formula", `cannot parse ${cmd.input}`);
        }
        const prev = this.cell(s, cmd.row, cmd.col)?.input ?? "";
        this.setCell(s, cmd.row, cmd.col, cmd.input);
        const inverse: CalcCommand =
          prev === ""
            ? { type: "clearRange", sheet: cmd.sheet, r0: cmd.row, c0: cmd.col, r1: cmd.row, c1: cmd.col }
            : { type: "setInput", sheet: cmd.sheet, row: cmd.row, col: cmd.col, input: prev };
        return [this.cellsPatch(s, [[cmd.row, cmd.col]]), inverse];
      }
      case "clearRange": {
        const s = this.sheet(cmd.sheet);
        this.checkRange(cmd.r0, cmd.c0, cmd.r1, cmd.c1);
        const cleared: [number, number, string, number][] = [];
        for (const [r, row] of s.cells) {
          if (r < cmd.r0 || r > cmd.r1) continue;
          for (const [c, cell] of row) {
            if (c >= cmd.c0 && c <= cmd.c1 && cell.input !== "") cleared.push([r, c, cell.input, cell.style]);
          }
        }
        for (const [r, c] of cleared) this.setCell(s, r, c, "");
        return [this.cellsPatch(s, cleared.map(([r, c]) => [r, c])), { type: "restoreCells", sheet: cmd.sheet, cells: cleared }];
      }
      case "restoreCells": {
        const s = this.sheet(cmd.sheet);
        const prev: [number, number, string, number][] = cmd.cells.map(([r, c]) => {
          const x = this.cell(s, r, c);
          return [r, c, x?.input ?? "", x?.style ?? 0];
        });
        for (const [r, c, input, style] of cmd.cells) this.setCell(s, r, c, input, style);
        return [this.cellsPatch(s, cmd.cells.map(([r, c]) => [r, c])), { type: "restoreCells", sheet: cmd.sheet, cells: prev }];
      }
      case "applyStyle": {
        const s = this.sheet(cmd.sheet);
        this.checkRange(cmd.r0, cmd.c0, cmd.r1, cmd.c1);
        const before = this.styles.length;
        const changed: [number, number, number][] = [];
        const coords: [number, number][] = [];
        const visit = (r: number, c: number) => {
          const old = this.cell(s, r, c)?.style ?? 0;
          const next = this.intern(mergeStyle(this.styles[this.effectiveStyle(s, r, c)], cmd.patch));
          changed.push([r, c, old]);
          this.setCell(s, r, c, this.cell(s, r, c)?.input ?? "", next);
          coords.push([r, c]);
        };
        if ((cmd.r1 - cmd.r0 + 1) * (cmd.c1 - cmd.c0 + 1) <= 100_000) {
          for (let r = cmd.r0; r <= cmd.r1; r++) for (let c = cmd.c0; c <= cmd.c1; c++) visit(r, c);
        } else {
          // Large ranges: only existing cells (the fake has no row/col styles for ranges).
          for (const [r, row] of s.cells) for (const c of row.keys()) if (r >= cmd.r0 && r <= cmd.r1 && c >= cmd.c0 && c <= cmd.c1) visit(r, c);
        }
        const patch = this.cellsPatch(s, coords);
        if (this.styles.length > before) patch.styles = [...this.styles];
        return [patch, { type: "restoreStyles", sheet: cmd.sheet, cells: changed }];
      }
      case "setBorders": {
        const s = this.sheet(cmd.sheet);
        this.checkRange(cmd.r0, cmd.c0, cmd.r1, cmd.c1);
        const before = this.styles.length;
        const changed: [number, number, number][] = [];
        const coords: [number, number][] = [];
        for (let r = cmd.r0; r <= cmd.r1; r++) {
          for (let c = cmd.c0; c <= cmd.c1; c++) {
            const old = this.cell(s, r, c)?.style ?? 0;
            const cur = this.styles[this.effectiveStyle(s, r, c)];
            const borders = applyBorderEdits(cur.borders ?? {}, r, c, cmd, cmd.edits);
            const next = this.intern({ ...cur, borders: Object.keys(borders).length ? borders : undefined });
            changed.push([r, c, old]);
            this.setCell(s, r, c, this.cell(s, r, c)?.input ?? "", next);
            coords.push([r, c]);
          }
        }
        const patch = this.cellsPatch(s, coords);
        if (this.styles.length > before) patch.styles = [...this.styles];
        return [patch, { type: "restoreStyles", sheet: cmd.sheet, cells: changed }];
      }
      case "restoreStyles": {
        const s = this.sheet(cmd.sheet);
        const prev: [number, number, number][] = cmd.cells.map(([r, c]) => [r, c, this.cell(s, r, c)?.style ?? 0]);
        for (const [r, c, st] of cmd.cells) this.setCell(s, r, c, this.cell(s, r, c)?.input ?? "", st);
        return [this.cellsPatch(s, cmd.cells.map(([r, c]) => [r, c])), { type: "restoreStyles", sheet: cmd.sheet, cells: prev }];
      }
      case "setColWidth":
      case "setColHidden": {
        const s = this.sheet(cmd.sheet);
        const prev = s.cols.get(cmd.col) ?? { col: cmd.col, width: null, hidden: false, style: null };
        const next = cmd.type === "setColWidth" ? { ...prev, width: cmd.width } : { ...prev, hidden: cmd.hidden };
        return this.exec({ type: "restoreCols", sheet: cmd.sheet, cols: [next] });
      }
      case "restoreCols": {
        const s = this.sheet(cmd.sheet);
        const prev = cmd.cols.map((c) => s.cols.get(c.col) ?? { col: c.col, width: null, hidden: false, style: null });
        for (const c of cmd.cols) s.cols.set(c.col, c);
        const patch = this.emptyPatch();
        patch.cols = [{ sheet: cmd.sheet, cols: cmd.cols }];
        return [patch, { type: "restoreCols", sheet: cmd.sheet, cols: prev }];
      }
      case "setRowHeight":
      case "setRowHidden": {
        const s = this.sheet(cmd.sheet);
        const prev = s.rows.get(cmd.row) ?? { row: cmd.row, height: null, hidden: false, style: null };
        const next = cmd.type === "setRowHeight" ? { ...prev, height: cmd.height } : { ...prev, hidden: cmd.hidden };
        return this.exec({ type: "restoreRows", sheet: cmd.sheet, rows: [next] });
      }
      case "restoreRows": {
        const s = this.sheet(cmd.sheet);
        const prev = cmd.rows.map((r) => s.rows.get(r.row) ?? { row: r.row, height: null, hidden: false, style: null });
        for (const r of cmd.rows) s.rows.set(r.row, r);
        const patch = this.emptyPatch();
        patch.rows = [{ sheet: cmd.sheet, rows: cmd.rows }];
        return [patch, { type: "restoreRows", sheet: cmd.sheet, rows: prev }];
      }
      case "addSheet":
      case "duplicateSheet": {
        if (this.sheets.some((s) => s.name.toLowerCase() === cmd.name.toLowerCase())) throw new Fail("duplicate_sheet", `sheet ${cmd.name} exists`);
        let sheet = this.newSheet(this.nextId++, cmd.name);
        const at = cmd.type === "addSheet" ? (cmd.index ?? this.sheets.length) : (cmd.index ?? this.sheets.indexOf(this.sheet(cmd.sheet)) + 1);
        if (cmd.type === "duplicateSheet") {
          const src = this.sheet(cmd.sheet);
          sheet = {
            ...sheet,
            cells: new Map([...src.cells].map(([r, row]) => [r, new Map([...row].map(([c, x]) => [c, { ...x }]))])),
            cols: new Map(src.cols),
            rows: new Map(src.rows),
            formulas: new Set(src.formulas),
            tabColor: src.tabColor,
            view: { ...src.view },
            merges: src.merges.map((m) => ({ ...m })),
          };
        }
        if (at > this.sheets.length) throw new Fail("invalid_sheet_index", `bad index ${at}`);
        this.sheets.splice(at, 0, sheet);
        const patch = this.emptyPatch();
        patch.sheets = this.sheetInfos();
        return [patch, { type: "deleteSheet", sheet: sheet.id }];
      }
      case "deleteSheet": {
        const s = this.sheet(cmd.sheet);
        if (this.sheets.length === 1) throw new Fail("last_sheet", "a workbook needs at least one sheet");
        if (!s.hidden && !this.sheets.some((x) => x !== s && !x.hidden)) throw new Fail("last_visible_sheet", "a workbook needs at least one visible sheet");
        const index = this.sheets.indexOf(s);
        this.sheets.splice(index, 1);
        this.removed.set(s.id, s);
        const patch = this.emptyPatch();
        patch.sheets = this.sheetInfos();
        const format = { defaultColWidth: 8.43, defaultRowHeight: 15 };
        return [patch, { type: "restoreSheet", sheet: s.id, name: s.name, index, tabColor: s.tabColor ?? null, format }];
      }
      case "restoreSheet": {
        const s = this.removed.get(cmd.sheet) ?? this.newSheet(cmd.sheet, cmd.name);
        this.removed.delete(cmd.sheet);
        this.sheets.splice(cmd.index, 0, { ...s, name: cmd.name, tabColor: cmd.tabColor ?? undefined });
        const patch = this.emptyPatch();
        patch.sheets = this.sheetInfos();
        return [patch, { type: "deleteSheet", sheet: cmd.sheet }];
      }
      case "moveSheet": {
        const s = this.sheet(cmd.sheet);
        const old = this.sheets.indexOf(s);
        if (cmd.index >= this.sheets.length) throw new Fail("invalid_sheet_index", `bad index ${cmd.index}`);
        this.sheets.splice(old, 1);
        this.sheets.splice(cmd.index, 0, s);
        const patch = this.emptyPatch();
        patch.sheets = this.sheetInfos();
        return [patch, { type: "moveSheet", sheet: cmd.sheet, index: old }];
      }
      case "setSheetTabColor": {
        const s = this.sheet(cmd.sheet);
        const old = s.tabColor ?? null;
        s.tabColor = cmd.color ?? undefined;
        const patch = this.emptyPatch();
        patch.sheets = this.sheetInfos();
        return [patch, { type: "setSheetTabColor", sheet: cmd.sheet, color: old }];
      }
      case "renameSheet": {
        const s = this.sheet(cmd.sheet);
        if (this.sheets.some((x) => x !== s && x.name.toLowerCase() === cmd.name.toLowerCase())) throw new Fail("duplicate_sheet", `sheet ${cmd.name} exists`);
        const old = s.name;
        s.name = cmd.name;
        const patch = this.emptyPatch();
        patch.sheets = this.sheetInfos();
        return [patch, { type: "renameSheet", sheet: cmd.sheet, name: old }];
      }
      case "setFreeze": {
        const s = this.sheet(cmd.sheet);
        const old = s.view;
        s.view = { ...old, frozenRows: cmd.rows, frozenCols: cmd.cols };
        return [this.sheetsPatch(), { type: "setFreeze", sheet: cmd.sheet, rows: old.frozenRows, cols: old.frozenCols }];
      }
      case "setSheetView": {
        const s = this.sheet(cmd.sheet);
        const old = s.view;
        const z = cmd.patch.zoom;
        if (z !== undefined && (z < 10 || z > 400)) throw new Fail("invalid_view", `invalid sheet view: zoom ${z}`);
        const defined = Object.fromEntries(Object.entries(cmd.patch).filter(([, v]) => v !== undefined));
        s.view = { ...old, ...defined };
        return [this.sheetsPatch(), { type: "setSheetView", sheet: cmd.sheet, patch: { ...old } }];
      }
      case "setSheetHidden": {
        const s = this.sheet(cmd.sheet);
        const [oldHidden, oldVery] = [!!s.hidden, !!s.veryHidden];
        if (cmd.hidden && !oldHidden && !this.sheets.some((x) => x !== s && !x.hidden)) {
          throw new Fail("last_visible_sheet", "a workbook needs at least one visible sheet");
        }
        s.hidden = cmd.hidden || undefined;
        s.veryHidden = (cmd.hidden && !!cmd.veryHidden) || undefined;
        const patch = this.sheetsPatch();
        if (cmd.hidden) {
          const i = this.sheets.indexOf(s);
          const next = this.sheets.slice(i).find((x) => !x.hidden) ?? [...this.sheets.slice(0, i)].reverse().find((x) => !x.hidden);
          if (next) patch.activateSheet = next.id;
        } else {
          patch.activateSheet = s.id;
        }
        const inverse: CalcCommand = { type: "setSheetHidden", sheet: cmd.sheet, hidden: oldHidden };
        if (oldVery) inverse.veryHidden = true;
        return [patch, inverse];
      }
      case "mergeCells": {
        const s = this.sheet(cmd.sheet);
        this.checkRange(cmd.r0, cmd.c0, cmd.r1, cmd.c1);
        const rect: Rect = { r0: cmd.r0, c0: cmd.c0, r1: cmd.r1, c1: cmd.c1 };
        if (rect.r0 === rect.r1 && rect.c0 === rect.c1) throw new Fail("invalid_merge", "invalid merge range");
        const covers = (m: Rect) => rect.r0 <= m.r0 && m.r1 <= rect.r1 && rect.c0 <= m.c0 && m.c1 <= rect.c1;
        if (s.merges.some((m) => intersects(m, rect) && !covers(m))) {
          throw new Fail("merge_overlap", "merge range overlaps an existing merged range");
        }
        const old = s.merges.map((m) => ({ ...m }));
        const cleared: [number, number, string, number][] = [];
        for (const [r, row] of s.cells) {
          if (r < rect.r0 || r > rect.r1) continue;
          for (const [c, cell] of row) {
            if (c >= rect.c0 && c <= rect.c1 && cell.input !== "" && !(r === rect.r0 && c === rect.c0)) cleared.push([r, c, cell.input, cell.style]);
          }
        }
        for (const [r, c] of cleared) this.setCell(s, r, c, "");
        s.merges = [...s.merges.filter((m) => !covers(m)), rect].sort((a, b) => a.r0 - b.r0 || a.c0 - b.c0);
        const patch = this.cellsPatch(s, cleared.map(([r, c]) => [r, c]));
        mergePatch(patch, this.mergesPatch(s));
        const restore: CalcCommand = { type: "restoreMerges", sheet: cmd.sheet, merges: old };
        const inverse: CalcCommand = cleared.length
          ? { type: "compound", commands: [restore, { type: "restoreCells", sheet: cmd.sheet, cells: cleared }] }
          : restore;
        return [patch, inverse];
      }
      case "unmergeCells": {
        const s = this.sheet(cmd.sheet);
        this.checkRange(cmd.r0, cmd.c0, cmd.r1, cmd.c1);
        const old = s.merges.map((m) => ({ ...m }));
        s.merges = s.merges.filter((m) => !intersects(m, cmd));
        return [this.mergesPatch(s), { type: "restoreMerges", sheet: cmd.sheet, merges: old }];
      }
      case "restoreMerges": {
        const s = this.sheet(cmd.sheet);
        const old = s.merges.map((m) => ({ ...m }));
        s.merges = cmd.merges.map((m) => ({ ...m }));
        return [this.mergesPatch(s), { type: "restoreMerges", sheet: cmd.sheet, merges: old }];
      }
      case "compound": {
        const patch = this.emptyPatch();
        const inverses: (CalcCommand | null)[] = [];
        for (const c of cmd.commands) {
          const [p, inv] = this.exec(c);
          mergePatch(patch, p);
          inverses.push(inv);
        }
        const inv = inverses.every((x) => x !== null) ? ({ type: "compound", commands: (inverses as CalcCommand[]).reverse() } as CalcCommand) : null;
        return [patch, inv];
      }
      case "pasteRange": {
        // Expanded into restoreCells (formulas shifted with a toy regex).
        const s = this.sheet(cmd.sheet);
        const h = cmd.src.r1 - cmd.src.r0 + 1;
        const w = cmd.src.c1 - cmd.src.c0 + 1;
        const writes = new Map<string, [number, number, string, number]>();
        const put = (sh: number, r: number, c: number, input: string, style: number) => writes.set(`${sh}:${r},${c}`, [r, c, input, style]);
        if (cmd.cut) {
          const from = this.sheet(cmd.src.sheet);
          for (let r = cmd.src.r0; r <= cmd.src.r1; r++) for (let c = cmd.src.c0; c <= cmd.src.c1; c++) if (this.cell(from, r, c)) put(from.id, r, c, "", 0);
        }
        for (let ti = 0; ti < cmd.repeatRows; ti++) {
          for (let tj = 0; tj < cmd.repeatCols; tj++) {
            for (let dr = 0; dr < h; dr++) {
              for (let dc = 0; dc < w; dc++) {
                const r = cmd.r0 + ti * h + dr;
                const c = cmd.c0 + tj * w + dc;
                const clip = cmd.cells.find((x) => x.dr === dr && x.dc === dc);
                const old = this.cell(s, r, c);
                if (!clip && !old) continue;
                const input = clip ? (cmd.cut ? clip.input : shiftRefs(clip.input, r - cmd.src.r0 - dr, c - cmd.src.c0 - dc)) : "";
                const style = clip?.style ?? (clip ? (old?.style ?? 0) : 0);
                if (cmd.mode === "formatsOnly") put(s.id, r, c, old?.input ?? "", style);
                else if (cmd.mode === "valuesOnly") put(s.id, r, c, input, old?.style ?? 0);
                else put(s.id, r, c, input, style);
              }
            }
          }
        }
        const bySheet = new Map<number, [number, number, string, number][]>();
        for (const [key, v] of writes) {
          const sh = Number(key.split(":")[0]);
          if (!bySheet.has(sh)) bySheet.set(sh, []);
          bySheet.get(sh)!.push(v);
        }
        const cmds: CalcCommand[] = [...bySheet].map(([sheet, cells]) => ({ type: "restoreCells", sheet, cells }));
        const result = this.exec({ type: "compound", commands: cmds });
        if (cmd.annotations && cmd.mode === "all") {
          const from = this.sheet(cmd.src.sheet);
          const inSrc = (x: { row: number; col: number }) => x.row >= cmd.src.r0 && x.row <= cmd.src.r1 && x.col >= cmd.src.c0 && x.col <= cmd.src.c1;
          const inDst = (x: { row: number; col: number }) => x.row >= cmd.r0 && x.row < cmd.r0 + h * cmd.repeatRows && x.col >= cmd.c0 && x.col < cmd.c0 + w * cmd.repeatCols;
          const notes = from.notes.filter(inSrc);
          const threads = cmd.cut ? from.threads.filter(inSrc) : [];
          if (cmd.cut) {
            from.notes = from.notes.filter((n) => !inSrc(n));
            from.threads = from.threads.filter((x) => !inSrc(x));
          }
          s.notes = s.notes.filter((n) => !inDst(n));
          if (cmd.cut) s.threads = s.threads.filter((x) => !inDst(x));
          for (let ti = 0; ti < cmd.repeatRows; ti++) {
            for (let tj = 0; tj < cmd.repeatCols; tj++) {
              const move = <T extends { row: number; col: number }>(x: T): T => ({ ...x, row: x.row - cmd.src.r0 + cmd.r0 + ti * h, col: x.col - cmd.src.c0 + cmd.c0 + tj * w });
              s.notes.push(...notes.map(move));
              s.threads.push(...threads.map(move));
            }
          }
        }
        return result;
      }
      case "fillRange": {
        // Copy with shifted formulas; all-number lines continue linearly.
        const s = this.sheet(cmd.sheet);
        const vertical = cmd.src.c0 === cmd.dst.c0 && cmd.src.c1 === cmd.dst.c1;
        const n = vertical ? cmd.src.r1 - cmd.src.r0 + 1 : cmd.src.c1 - cmd.src.c0 + 1;
        const origin = vertical ? cmd.src.r0 : cmd.src.c0;
        const cells: [number, number, string, number][] = [];
        const [l0, l1] = vertical ? [cmd.src.c0, cmd.src.c1] : [cmd.src.r0, cmd.src.r1];
        const [p0, p1] = vertical ? [cmd.dst.r0, cmd.dst.r1] : [cmd.dst.c0, cmd.dst.c1];
        for (let line = l0; line <= l1; line++) {
          const at = (pos: number): [number, number] => (vertical ? [pos, line] : [line, pos]);
          const src = Array.from({ length: n }, (_, p) => this.cell(s, ...at(origin + p)));
          const nums = src.map((x) => (x && x.input !== "" && Number.isFinite(Number(x.input)) ? Number(x.input) : NaN));
          const linear = n > 1 && nums.every((x) => !Number.isNaN(x)) && cmd.mode !== "copy" && cmd.mode !== "alternate";
          const step = linear ? (nums[n - 1] - nums[0]) / (n - 1) : 0;
          for (let pos = p0; pos <= p1; pos++) {
            const k = pos - origin;
            const p = ((k % n) + n) % n;
            const from = src[p];
            const input = linear ? String(nums[0] + step * k) : shiftRefs(from?.input ?? "", vertical ? k - p : 0, vertical ? 0 : k - p);
            cells.push([...at(pos), input, from?.style ?? 0]);
          }
        }
        return this.exec({ type: "restoreCells", sheet: cmd.sheet, cells });
      }
      case "insertRows":
      case "deleteRows":
      case "insertCols":
      case "deleteCols": {
        const s = this.sheet(cmd.sheet);
        const rowsAxis = cmd.type.endsWith("Rows");
        const ins = cmd.type.startsWith("insert");
        const moved = new Map<number, Map<number, FakeCell>>();
        for (const [r, row] of s.cells) {
          for (const [c, cell] of row) {
            let [nr, nc] = [r, c];
            const i = rowsAxis ? r : c;
            if (ins && i >= cmd.at) rowsAxis ? (nr += cmd.count) : (nc += cmd.count);
            if (!ins && i >= cmd.at) {
              if (i < cmd.at + cmd.count) continue;
              rowsAxis ? (nr -= cmd.count) : (nc -= cmd.count);
            }
            if (!moved.has(nr)) moved.set(nr, new Map());
            moved.get(nr)!.set(nc, cell);
          }
        }
        s.cells = moved;
        s.formulas = new Set([...moved].flatMap(([r, row]) => [...row].filter(([, x]) => x.input.startsWith("=")).map(([c]) => `${r},${c}`)));
        const shift = (i: number) => (ins ? (i >= cmd.at ? i + cmd.count : i) : i >= cmd.at + cmd.count ? i - cmd.count : i >= cmd.at ? null : i);
        const follow = <T extends { row: number; col: number }>(xs: T[]) =>
          xs.flatMap((x) => {
            const j = shift(rowsAxis ? x.row : x.col);
            return j === null ? [] : [{ ...x, ...(rowsAxis ? { row: j } : { col: j }) }];
          });
        s.notes = follow(s.notes);
        s.threads = follow(s.threads);
        s.hyperlinks = s.hyperlinks.flatMap((h) => {
          const a = shift(rowsAxis ? h.r0 : h.c0);
          const b = shift(rowsAxis ? h.r1 : h.c1);
          if (a === null || b === null) return [];
          return [{ ...h, ...(rowsAxis ? { r0: a, r1: b } : { c0: a, c1: b }) }];
        });
        const patch = this.emptyPatch();
        patch.structural = [{ sheet: cmd.sheet, kind: cmd.type, at: cmd.at, count: cmd.count }];
        const inverse: CalcCommand = { ...cmd, type: (ins ? "delete" : "insert") + (rowsAxis ? "Rows" : "Cols") } as CalcCommand;
        return [patch, inverse];
      }
      case "insertCells":
      case "deleteCells": {
        // A toy: the cells of the band move (references are not adjusted).
        const s = this.sheet(cmd.sheet);
        const ins = cmd.type === "insertCells";
        const sideways = cmd.shift === "right" || cmd.shift === "left";
        const count = sideways ? cmd.c1 - cmd.c0 + 1 : cmd.r1 - cmd.r0 + 1;
        const at = sideways ? cmd.c0 : cmd.r0;
        const moved = new Map<number, Map<number, FakeCell>>();
        for (const [r, row] of s.cells) {
          for (const [c, cell] of row) {
            const inBand = sideways ? r >= cmd.r0 && r <= cmd.r1 : c >= cmd.c0 && c <= cmd.c1;
            let [nr, nc] = [r, c];
            const i = sideways ? c : r;
            if (inBand && i >= at) {
              if (!ins && i < at + count) continue;
              const d = ins ? count : -count;
              if (sideways) nc += d;
              else nr += d;
            }
            if (!moved.has(nr)) moved.set(nr, new Map());
            moved.get(nr)!.set(nc, cell);
          }
        }
        s.cells = moved;
        s.formulas = new Set([...moved].flatMap(([r, row]) => [...row].filter(([, x]) => x.input.startsWith("=")).map(([c]) => `${r},${c}`)));
        const patch = this.emptyPatch();
        patch.structural = [{ sheet: cmd.sheet, kind: "shiftCells", at, count }];
        const rect = { sheet: cmd.sheet, r0: cmd.r0, c0: cmd.c0, r1: cmd.r1, c1: cmd.c1 };
        const inverse: CalcCommand = ins
          ? { type: "deleteCells", ...rect, shift: sideways ? "left" : "up" }
          : { type: "insertCells", ...rect, shift: sideways ? "right" : "down" };
        return [patch, inverse];
      }
      case "sortRange":
      case "sortSheetByColumn":
      case "setAutoFilter":
      case "setFilterColumn":
      case "clearFilters":
      case "reapplyFilter":
      case "restoreFilterState":
        return this.sortFilter(cmd);
      case "addCfRule":
      case "updateCfRule":
      case "removeCfRule":
      case "reorderCfRule":
      case "clearCf":
      case "setValidation":
      case "removeValidation":
      case "restoreCfRules":
      case "restoreValidations":
        return this.rules(cmd);
      case "addChart":
      case "updateChart":
      case "setChartAnchor":
      case "setChartSeries":
      case "removeChart":
      case "restoreCharts":
        return this.chartCmd(cmd);
      case "defineName":
      case "updateName":
      case "deleteName":
      case "createNamesFromSelection":
      case "restoreNames":
        return this.nameCmd(cmd);
      case "setNote":
      case "deleteNote":
      case "showHideNote":
      case "convertNotesToComments":
      case "addComment":
      case "replyComment":
      case "editComment":
      case "deleteReply":
      case "deleteThread":
      case "resolveThread":
      case "setUser":
      case "setHyperlink":
      case "removeHyperlink":
      case "restoreAnnotations":
      case "restorePersons":
        return this.annotCmd(cmd);
      case "groupPivotField":
      case "ungroupPivotField":
      case "setCalculatedField":
      case "setCalculatedItem":
      case "showReportFilterPages":
      case "insertPivotChart":
        // P9-C3: the toy pivots do not model these; the commands are logged (UI tests) and change nothing.
        return [this.emptyPatch(), { type: "compound", commands: [] }];
      case "createPivot":
      case "updatePivot":
      case "refreshPivot":
      case "deletePivot":
      case "movePivot":
      case "expandCollapse":
      case "setPageFilter":
      case "restorePivots": {
        // A toy (dev/fakePivot.ts); the real tables are the Rust core's (P8-30).
        let res: ReturnType<FakePivots["exec"]>;
        try {
          res = this.pivots.exec(cmd, this.sheets[0]?.id ?? 0);
        } catch (e) {
          throw new Fail("invalid_pivot", String(e instanceof Error ? e.message : e));
        }
        const patch = this.cellsPatch(this.sheet(res.sheet), res.coords);
        patch.pivotSheets = [res.sheet];
        patch.stalePivots = this.pivots.stale();
        if (res.activate !== undefined) {
          patch.sheets = this.sheetInfos();
          patch.activateSheet = res.activate;
        }
        return [patch, res.inverse];
      }
      case "createTable":
      case "renameTable":
      case "renameTableColumn":
      case "setTableStyle":
      case "setTableOptions":
      case "setTotalsFunction":
      case "resizeTable":
      case "convertToRange":
      case "setTableFilter":
      case "restoreTables":
        return this.tableCmd(cmd);
      case "groupOutline":
      case "setOutlineCollapsed":
      case "showOutlineLevel":
      case "clearOutline":
      case "setOutlineProps":
        return this.outlineCmd(cmd);
      case "removeDuplicates":
      case "textToColumns":
      case "setPageBreaks":
      case "addPicture":
      case "setPictureAnchor":
      case "removePicture":
      case "restorePictures":
        return this.dataCmd(cmd);
      case "flashFill":
        return this.exec({ type: "restoreCells", sheet: cmd.sheet, cells: cmd.cells.map((c) => [c.row, cmd.col, c.input, this.cell(this.sheet(cmd.sheet), c.row, cmd.col)?.style ?? 0] as [number, number, string, number]) });
      case "autoOutline":
      case "consolidate":
      case "insertTableRows":
      case "deleteTableRows":
      case "insertTableCols":
      case "deleteTableCols":
      case "subtotal":
      case "removeSubtotals":
      case "changePivotSource":
      case "showPivotDetails":
      case "restoreSheetProtection":
      case "restoreWorkbookProtection":
      case "applyNames":
      case "pasteNameList":
        throw new Fail("unsupported", `${cmd.type} is not in the fake backend`);
      case "convertToNumber": {
        const s = this.sheet(cmd.sheet);
        const inverse: CalcCommand[] = [];
        const changed: [number, number][] = [];
        for (const r of cmd.cells) {
          for (let row = r.r0; row <= r.r1; row++) {
            for (let col = r.c0; col <= r.c1; col++) {
              const input = this.cell(s, row, col)?.input ?? "";
              const m = /^'\s*(-?[0-9]+(\.[0-9]+)?)\s*$/.exec(input);
              if (!m) continue;
              this.setCell(s, row, col, m[1]!);
              inverse.push({ type: "setInput", sheet: cmd.sheet, row, col, input });
              changed.push([row, col]);
            }
          }
        }
        return [this.cellsPatch(s, changed), { type: "compound", commands: inverse }];
      }
      case "setCalcOptions": {
        const old = this.calc.options;
        this.calc = { options: { ...cmd.options }, needsCalc: false };
        const patch = this.emptyPatch();
        patch.calc = structuredClone(this.calc);
        return [patch, { type: "setCalcOptions", options: old }];
      }
      case "calculateNow":
      case "calculateSheet": {
        this.calc = { ...this.calc, needsCalc: false };
        const patch = this.emptyPatch();
        patch.calc = structuredClone(this.calc);
        return [patch, null];
      }
      default: {
        const unknown: never = cmd;
        throw new Fail("bad_request", `unsupported command ${(unknown as { type: string }).type}`);
      }
    }
  }

  // --- tables, outlines, data tools (P8-35; toys) ---------------------------

  private tablesPatch(): CalcPatch {
    return this.sheetsPatch();
  }

  private findTable(id: number): [FakeSheet, Table] {
    for (const sh of this.sheets) {
      const t = sh.tables.find((x) => x.id === id);
      if (t) return [sh, t];
    }
    throw new Fail("unknown_table", `unknown table ${id}`);
  }

  private tableCmd(cmd: Extract<CalcCommand, { type: "createTable" | "renameTable" | "renameTableColumn" | "setTableStyle" | "setTableOptions" | "setTotalsFunction" | "resizeTable" | "convertToRange" | "setTableFilter" | "restoreTables" }>): [CalcPatch, CalcCommand | null] {
    const snapshot = (sh: FakeSheet): CalcCommand => ({ type: "restoreTables", sheet: sh.id, tables: JSON.parse(JSON.stringify(sh.tables)) as Table[] });
    if (cmd.type === "restoreTables") {
      const sh = this.sheet(cmd.sheet);
      const inv = snapshot(sh);
      sh.tables = JSON.parse(JSON.stringify(cmd.tables)) as Table[];
      return [this.tablesPatch(), inv];
    }
    if (cmd.type === "createTable") {
      const sh = this.sheet(cmd.sheet);
      let { r0, c0, r1, c1 } = cmd;
      if (r0 === r1 && c0 === c1) {
        // The current region: grow while the next row / column has content.
        while (this.cell(sh, r1 + 1, c0)) r1++;
        while (this.cell(sh, r0, c1 + 1)) c1++;
      }
      if (sh.tables.some((t) => intersects(t, { r0, c0, r1, c1 }))) throw new Fail("invalid_table", "tables cannot overlap");
      const inv = snapshot(sh);
      const names: string[] = [];
      const writes: [number, number, string, number][] = [];
      for (let c = c0; c <= c1; c++) {
        let n = cmd.hasHeaders ? (this.cell(sh, r0, c)?.input ?? "") : "";
        if (n === "") n = `Column${c - c0 + 1}`;
        let u = n;
        for (let k = 2; names.some((x) => x.toLowerCase() === u.toLowerCase()); k++) u = `${n}${k}`;
        names.push(u);
        if (!cmd.hasHeaders || this.cell(sh, r0, c)?.input !== u) writes.push([r0, c, u, this.cell(sh, r0, c)?.style ?? 0]);
      }
      if (r1 === r0) r1++;
      const id = Math.max(0, ...this.sheets.flatMap((x) => x.tables.map((t) => t.id))) + 1;
      let k = 1;
      while (this.sheets.some((x) => x.tables.some((t) => t.name.toLowerCase() === `table${k}`))) k++;
      const t: Table = {
        id, name: `Table${k}`, r0, c0, r1, c1, headerRow: true, columns: names.map((name, i) => ({ id: i + 1, name })),
        style: cmd.style ?? this.tableStyles.defaultStyle ?? "TableStyleMedium2", look: { firstColumn: false, lastColumn: false, bandedRows: true, bandedColumns: false },
        autoFilter: { r0, c0, r1, c1 },
      };
      sh.tables.push(t);
      const [p, cellsInv] = this.exec({ type: "restoreCells", sheet: sh.id, cells: writes });
      mergePatch(p, this.tablesPatch());
      return [p, { type: "compound", commands: [cellsInv!, inv] }];
    }
    const id = cmd.id;
    const [sh, t] = this.findTable(id);
    const inv = snapshot(sh);
    let cells: [number, number, string, number][] = [];
    switch (cmd.type) {
      case "renameTable":
        if (!/^[A-Za-z_\\][A-Za-z0-9_.]*$/.test(cmd.name)) throw new Fail("invalid_table", "invalid name");
        t.name = cmd.name;
        break;
      case "renameTableColumn":
        t.columns[cmd.index]!.name = cmd.name;
        break;
      case "setTableStyle":
        if (cmd.style !== undefined) t.style = cmd.style;
        if (cmd.look) t.look = { ...cmd.look };
        break;
      case "setTableOptions":
        if (cmd.totalsRow !== undefined && cmd.totalsRow !== !!t.totalsRow) {
          if (cmd.totalsRow) {
            t.r1++;
            t.totalsRow = true;
            if (t.columns.every((c) => !c.totals)) {
              t.columns[0]!.totals = { kind: "label", text: "Total" };
              t.columns[t.columns.length - 1]!.totals = { kind: "function", function: "sum" };
            }
            cells = t.columns.map((c, i) => [t.r1, t.c0 + i, c.totals?.kind === "label" ? c.totals.text : c.totals?.kind === "function" ? `=SUBTOTAL(109,[${c.name}])` : "", 0]);
          } else {
            cells = t.columns.map((_, i) => [t.r1, t.c0 + i, "", 0]);
            t.r1--;
            t.totalsRow = false;
          }
        }
        if (cmd.headerRow !== undefined) t.headerRow = cmd.headerRow;
        if (cmd.filterButton !== undefined) t.autoFilter = cmd.filterButton ? { r0: t.r0, c0: t.c0, r1: t.r1 - (t.totalsRow ? 1 : 0), c1: t.c1 } : undefined;
        break;
      case "setTotalsFunction": {
        const col = t.columns[cmd.col - t.c0];
        if (!col) throw new Fail("invalid_range", "not a table column");
        col.totals = cmd.totals ?? undefined;
        const codes: Record<string, number> = { average: 101, countNums: 102, count: 103, max: 104, min: 105, stdDev: 107, sum: 109, var: 110 };
        const tc = cmd.totals;
        const input = !tc ? "" : tc.kind === "label" ? tc.text : tc.kind === "custom" ? `=${tc.formula}` : `=SUBTOTAL(${codes[tc.function]},[${col.name}])`;
        if (t.totalsRow) cells = [[t.r1, cmd.col, input, 0]];
        break;
      }
      case "resizeTable":
        Object.assign(t, { r0: cmd.r0, c0: cmd.c0, r1: cmd.r1, c1: cmd.c1 });
        while (t.columns.length < t.c1 - t.c0 + 1) t.columns.push({ id: t.columns.length + 1, name: `Column${t.columns.length + 1}` });
        t.columns.length = t.c1 - t.c0 + 1;
        break;
      case "convertToRange":
        sh.tables = sh.tables.filter((x) => x.id !== id);
        break;
      case "setTableFilter":
        if (t.autoFilter) {
          t.autoFilter.columns = (t.autoFilter.columns ?? []).filter((c) => c.col !== cmd.col);
          if (cmd.filter) t.autoFilter.columns.push({ col: cmd.col, filter: cmd.filter });
        }
        break;
    }
    const [p, cellsInv] = this.exec({ type: "restoreCells", sheet: sh.id, cells });
    mergePatch(p, this.tablesPatch());
    return [p, { type: "compound", commands: [cellsInv!, inv] }];
  }

  private outlineCmd(cmd: Extract<CalcCommand, { type: "groupOutline" | "setOutlineCollapsed" | "showOutlineLevel" | "clearOutline" | "setOutlineProps" }>): [CalcPatch, CalcCommand | null] {
    const sh = this.sheet(cmd.sheet);
    if (cmd.type === "setOutlineProps") return [this.sheetsPatch(), { type: "setOutlineProps", sheet: cmd.sheet, props: { summaryBelow: true, summaryRight: true } }];
    const axis = cmd.type === "clearOutline" ? (cmd.axis ?? "rows") : cmd.axis;
    const map = axis === "rows" ? sh.rows : sh.cols;
    type Line = { outlineLevel?: number; hidden: boolean; collapsed?: boolean };
    const get = (i: number): Line => (map.get(i) as Line | undefined) ?? { hidden: false };
    const changes = new Map<number, Line>();
    const set = (i: number, l: Line) => changes.set(i, l);
    if (cmd.type === "groupOutline") {
      for (let i = cmd.i0; i <= cmd.i1; i++) {
        const l = get(i);
        set(i, { ...l, outlineLevel: Math.max(0, Math.min(7, (l.outlineLevel ?? 0) + (cmd.ungroup ? -1 : 1))) });
      }
    } else if (cmd.type === "setOutlineCollapsed") {
      const level = get(cmd.index).outlineLevel ?? 0;
      for (let i = cmd.index - 1; i >= 0 && (get(i).outlineLevel ?? 0) > level; i--) set(i, { ...get(i), hidden: cmd.collapsed });
      set(cmd.index, { ...get(cmd.index), collapsed: cmd.collapsed });
    } else if (cmd.type === "showOutlineLevel") {
      for (const [i, l] of map) if ((l as Line).outlineLevel) set(i, { ...(l as Line), hidden: ((l as Line).outlineLevel ?? 0) >= cmd.level });
    } else {
      for (const [i, l] of map) if ((l as Line).outlineLevel || (l as Line).collapsed) set(i, { ...(l as Line), outlineLevel: 0, collapsed: false });
    }
    if (axis === "rows") {
      const rows: RowView[] = [...changes].map(([row, l]) => ({ row, height: null, style: null, ...(sh.rows.get(row) ?? {}), ...l }) as RowView);
      return this.exec({ type: "restoreRows", sheet: cmd.sheet, rows }).map((x, k) => (k === 0 ? (mergePatch(x as CalcPatch, this.sheetsPatch()), x) : x)) as [CalcPatch, CalcCommand | null];
    }
    const cols: ColView[] = [...changes].map(([col, l]) => ({ col, width: null, style: null, ...(sh.cols.get(col) ?? {}), ...l }) as ColView);
    return this.exec({ type: "restoreCols", sheet: cmd.sheet, cols });
  }

  private dataCmd(cmd: Extract<CalcCommand, { type: "removeDuplicates" | "textToColumns" | "setPageBreaks" | "addPicture" | "setPictureAnchor" | "removePicture" | "restorePictures" }>): [CalcPatch, CalcCommand | null] {
    const sh = this.sheet(cmd.sheet);
    const pics = (): CalcCommand => ({ type: "restorePictures", sheet: sh.id, pictures: JSON.parse(JSON.stringify(sh.pictures)) as Picture[] });
    const picPatch = () => ({ ...this.emptyPatch(), pictureSheets: [sh.id] });
    switch (cmd.type) {
      case "removeDuplicates": {
        const first = cmd.r0 + (cmd.hasHeader ? 1 : 0);
        const cols = cmd.columns.length ? cmd.columns : Array.from({ length: cmd.c1 - cmd.c0 + 1 }, (_, i) => cmd.c0 + i);
        const seen = new Set<string>();
        const kept: number[] = [];
        let total = 0;
        for (let r = first; r <= cmd.r1; r++) {
          if (cols.every((c) => !this.cell(sh, r, c)?.input)) continue;
          total++;
          const key = cols.map((c) => String(this.value(sh, r, c)).toLowerCase()).join("\u0000");
          if (!seen.has(key)) {
            seen.add(key);
            kept.push(r);
          }
        }
        const cells: [number, number, string, number][] = [];
        kept.forEach((from, k) => {
          for (let c = cmd.c0; c <= cmd.c1; c++) cells.push([first + k, c, this.cell(sh, from, c)?.input ?? "", this.cell(sh, from, c)?.style ?? 0]);
        });
        for (let r = first + kept.length; r < first + total; r++) for (let c = cmd.c0; c <= cmd.c1; c++) cells.push([r, c, "", 0]);
        const [p, inv] = this.exec({ type: "restoreCells", sheet: sh.id, cells });
        p.duplicates = { removed: total - kept.length, remaining: kept.length };
        return [p, inv];
      }
      case "textToColumns": {
        const seps = splitChars(cmd.options);
        const cells: [number, number, string, number][] = [];
        const [dr, dc] = cmd.dest ?? [cmd.r0, cmd.c0];
        for (let r = cmd.r0; r <= cmd.r1; r++) {
          const text = this.cell(sh, r, cmd.c0)?.input ?? "";
          if (text === "") continue;
          const parts = cmd.options.split.kind === "delimited" ? text.split(new RegExp(`[${seps.replace(/[\\\]^-]/g, "\\$&")}]`)) : [text];
          parts.forEach((v, i) => cells.push([dr + r - cmd.r0, dc + i, v, 0]));
        }
        return this.exec({ type: "restoreCells", sheet: sh.id, cells });
      }
      case "setPageBreaks": {
        const list = cmd.axis === "rows" ? "rowBreaks" : "colBreaks";
        const old = [...sh[list]];
        sh[list] = [...new Set(cmd.breaks.filter((b) => b > 0))].sort((a, b) => a - b);
        return [this.sheetsPatch(), { type: "setPageBreaks", sheet: sh.id, axis: cmd.axis, breaks: old }];
      }
      case "addPicture": {
        const inv = pics();
        const id = Math.max(0, ...sh.pictures.map((p) => p.id)) + 1;
        sh.pictures.push({ ...JSON.parse(JSON.stringify(cmd.picture)), id, name: cmd.picture.name || `Picture ${id}` });
        return [picPatch(), inv];
      }
      case "setPictureAnchor": {
        const inv = pics();
        const p = sh.pictures.find((x) => x.id === cmd.id);
        if (!p) throw new Fail("invalid_range", "no picture");
        p.anchor = JSON.parse(JSON.stringify(cmd.anchor));
        return [picPatch(), inv];
      }
      case "removePicture": {
        const inv = pics();
        sh.pictures = sh.pictures.filter((x) => x.id !== cmd.id);
        return [picPatch(), inv];
      }
      case "restorePictures": {
        const inv = pics();
        sh.pictures = JSON.parse(JSON.stringify(cmd.pictures)) as Picture[];
        return [picPatch(), inv];
      }
    }
  }

  // --- defined names (a toy: ranges and constants) ---------------------------

  /** What a name used on sheet `s` refers to: a range or a constant (`undefined`: unknown). */
  private nameTarget(name: string, s: FakeSheet): { sheet: string; r0: number; c0: number; r1: number; c1: number } | Value | undefined {
    const n = name.toLowerCase();
    const def = this.names.find((x) => x.sheet === s.id && x.name.toLowerCase() === n) ?? this.names.find((x) => x.sheet === undefined && x.name.toLowerCase() === n);
    if (!def) return undefined;
    const r = parseRange(def.refersTo);
    if (r) return { ...r, sheet: r.sheet ?? s.name };
    const num = Number(def.refersTo);
    if (def.refersTo.trim() !== "" && Number.isFinite(num)) return num;
    return def.refersTo.replace(/^"(.*)"$/, "$1");
  }

  private nameInfos(): NameInfo[] {
    return this.names.map((n) => {
      const info: NameInfo = { ...n };
      const r = parseRange(n.refersTo);
      const sheet = r && (r.sheet === null ? this.sheets[0] : this.sheets.find((x) => x.name.toLowerCase() === r.sheet!.toLowerCase()));
      if (r && sheet) info.range = { sheet: sheet.id, r0: r.r0, c0: r.c0, r1: r.r1, c1: r.c1 };
      return info;
    });
  }

  private namesPatch(): CalcPatch {
    // Every formula may use a name: the patch re-sends them (no dependency graph here).
    const patch = this.cellsPatch(this.sheets[0]!, []);
    patch.names = this.nameInfos();
    return patch;
  }

  private nameCmd(cmd: Extract<CalcCommand, { type: "defineName" | "updateName" | "deleteName" | "createNamesFromSelection" | "restoreNames" }>): [CalcPatch, CalcCommand] {
    const before = JSON.parse(JSON.stringify(this.names)) as NameDef[];
    const key = (name: string, sheet: number | undefined) => `${sheet ?? ""}|${name.toLowerCase()}`;
    const check = (def: NameDef, except?: string) => {
      const problem = nameProblem(def.name);
      if (problem) throw new Fail("invalid_name", `${def.name} is not a valid name`);
      if (def.sheet !== undefined) this.sheet(def.sheet);
      if (this.names.some((n) => key(n.name, n.sheet) === key(def.name, def.sheet) && key(n.name, n.sheet) !== except)) {
        throw new Fail("duplicate_name", `a name ${def.name} already exists`);
      }
    };
    const clean = (def: NameDef): NameDef => ({ ...def, refersTo: def.refersTo.replace(/^=/, "") });
    switch (cmd.type) {
      case "defineName":
        check(cmd.def);
        this.names.push(clean(cmd.def));
        break;
      case "updateName": {
        const at = this.names.findIndex((n) => key(n.name, n.sheet) === key(cmd.name, cmd.sheet));
        if (at < 0) throw new Fail("unknown_name", `unknown name ${cmd.name}`);
        check(cmd.def, key(cmd.name, cmd.sheet));
        this.names[at] = clean(cmd.def);
        break;
      }
      case "deleteName": {
        const at = this.names.findIndex((n) => key(n.name, n.sheet) === key(cmd.name, cmd.sheet));
        if (at < 0) throw new Fail("unknown_name", `unknown name ${cmd.name}`);
        this.names.splice(at, 1);
        break;
      }
      case "createNamesFromSelection": {
        const s = this.sheet(cmd.sheet);
        const made: NameDef[] = [];
        const text = (r: number, c: number) => {
          const v = this.view(s, r, c);
          return v.kind === "text" ? v.display.trim().replace(/[^\p{L}\p{N}_.]/gu, "_").replace(/^(?=\d)/, "_") : "";
        };
        const r0 = cmd.r0 + (cmd.edges.top ? 1 : 0);
        const c0 = cmd.c0 + (cmd.edges.left ? 1 : 0);
        if (cmd.edges.top) {
          for (let c = c0; c <= cmd.c1; c++) {
            const name = text(cmd.r0, c);
            if (name) made.push({ name, refersTo: rangeFormula({ sheet: s.name, r0, c0: c, r1: cmd.r1, c1: c }) });
          }
        }
        if (cmd.edges.left) {
          for (let r = r0; r <= cmd.r1; r++) {
            const name = text(r, cmd.c0);
            if (name) made.push({ name, refersTo: rangeFormula({ sheet: s.name, r0: r, c0, r1: r, c1: cmd.c1 }) });
          }
        }
        if (made.length === 0) throw new Fail("no_names", "no names to create");
        for (const d of made) {
          const at = this.names.findIndex((n) => key(n.name, n.sheet) === key(d.name, undefined));
          if (at >= 0) this.names[at] = d;
          else this.names.push(d);
        }
        break;
      }
      case "restoreNames":
        this.names = JSON.parse(JSON.stringify(cmd.names)) as NameDef[];
        break;
    }
    return [this.namesPatch(), { type: "restoreNames", names: before }];
  }

  private nameRows(sheet: number): NameRow[] {
    return this.nameInfos().map((n) => {
      let value = n.refersTo;
      if (n.range) {
        const s = this.sheet(n.range.sheet);
        const vals: string[] = [];
        for (let r = n.range.r0; r <= Math.min(n.range.r1, n.range.r0 + 11); r++) {
          for (let c = n.range.c0; c <= Math.min(n.range.c1, n.range.c0 + 11); c++) vals.push(this.view(s, r, c).display);
        }
        value = vals.length === 1 ? vals[0]! : `{${vals.join(";")}}`;
      }
      void sheet;
      return { ...n, value };
    });
  }

  /** Trace Precedents (a toy: the references written in the formula). */
  private precedents(sheet: number, row: number, col: number): SheetRect[] {
    const s = this.sheet(sheet);
    const input = this.cell(s, row, col)?.input ?? "";
    if (!input.startsWith("=")) return [];
    const out: SheetRect[] = findRefs(input).map((r) => {
      const target = r.sheet ? this.sheetByName(r.sheet) : s;
      return { sheet: target.id, ...r.range };
    });
    return out;
  }

  /** Trace Dependents (a toy: formulas whose written references cover the cell). */
  private dependents(sheet: number, row: number, col: number): SheetRect[] {
    const out: SheetRect[] = [];
    for (const sh of this.sheets) {
      for (const key of sh.formulas) {
        const [r, c] = key.split(",").map(Number) as [number, number];
        const hit = this.precedents(sh.id, r, c).some((p) => p.sheet === sheet && row >= p.r0 && row <= p.r1 && col >= p.c0 && col <= p.c1);
        if (hit) out.push({ sheet: sh.id, r0: r, c0: c, r1: r, c1: c });
      }
    }
    return out.sort((a, b) => a.sheet - b.sheet || a.r0 - b.r0 || a.c0 - b.c0);
  }

  // --- conditional formatting and data validation (a toy: rule lists kept, few kinds evaluated) ---

  private rules(cmd: Extract<CalcCommand, { type: "addCfRule" | "updateCfRule" | "removeCfRule" | "reorderCfRule" | "clearCf" | "setValidation" | "removeValidation" | "restoreCfRules" | "restoreValidations" }>): [CalcPatch, CalcCommand] {
    const s = this.sheet(cmd.sheet);
    const copy = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
    const inverse: CalcCommand =
      cmd.type === "setValidation" || cmd.type === "removeValidation" || cmd.type === "restoreValidations"
        ? { type: "restoreValidations", sheet: s.id, validations: copy(s.validations) }
        : { type: "restoreCfRules", sheet: s.id, rules: copy(s.cfRules) };
    const renumber = () => s.cfRules.forEach((r, i) => (r.priority = i + 1));
    const at = (p: number) => Math.min(Math.max(p, 1) - 1, s.cfRules.length);
    const index = (id: number) => {
      const i = s.cfRules.findIndex((r) => r.id === id);
      if (i < 0) throw new Fail("invalid_rule", `unknown rule ${id}`);
      return i;
    };
    const cut = (ranges: Rect[], r: Rect) => ranges.filter((x) => !(x.r0 >= r.r0 && x.r1 <= r.r1 && x.c0 >= r.c0 && x.c1 <= r.c1));
    switch (cmd.type) {
      case "addCfRule": {
        const rule = copy(cmd.rule);
        if (rule.id === 0) rule.id = Math.max(0, ...s.cfRules.map((r) => r.id)) + 1;
        s.cfRules.splice(at(rule.priority), 0, rule);
        break;
      }
      case "updateCfRule": {
        const i = index(cmd.rule.id);
        s.cfRules.splice(i, 1);
        s.cfRules.splice(cmd.rule.priority === 0 ? i : at(cmd.rule.priority), 0, copy(cmd.rule));
        break;
      }
      case "removeCfRule":
        s.cfRules.splice(index(cmd.id), 1);
        break;
      case "reorderCfRule": {
        const [rule] = s.cfRules.splice(index(cmd.id), 1);
        s.cfRules.splice(at(cmd.priority), 0, rule!);
        break;
      }
      case "clearCf":
        // Toy: only ranges inside the cleared range go (no splitting).
        s.cfRules = cmd.range === null ? [] : s.cfRules.filter((r) => (r.ranges = cut(r.ranges, cmd.range!)).length > 0);
        break;
      case "restoreCfRules":
        s.cfRules = copy(cmd.rules);
        break;
      case "setValidation":
        s.validations = s.validations.filter((v) => (v.ranges = v.ranges.filter((x) => !cmd.validation.ranges.some((r) => intersects(r, x)))).length > 0);
        s.validations.push(copy(cmd.validation));
        break;
      case "removeValidation":
        s.validations = s.validations.filter((v) => (v.ranges = v.ranges.filter((x) => !intersects(x, cmd.range))).length > 0);
        break;
      case "restoreValidations":
        s.validations = copy(cmd.validations);
        break;
    }
    renumber();
    const patch = this.emptyPatch();
    patch.cfSheets = [s.id];
    return [patch, inverse];
  }

  /** The toy evaluation: `cellIs` with numbers, `containsText`, data bars and 2/3-colour scales over min…max, icon sets by percent. */
  private cfOf(s: FakeSheet, r: number, c: number): CfResult | null {
    const out: CfResult = {};
    const v = this.value(s, r, c);
    const inRule = (rule: CfRule) => rule.ranges.some((x) => r >= x.r0 && r <= x.r1 && c >= x.c0 && c <= x.c1);
    const numbers = (rule: CfRule) => {
      const ns: number[] = [];
      for (const x of rule.ranges) for (let rr = x.r0; rr <= Math.min(x.r1, x.r0 + 999); rr++) for (let cc = x.c0; cc <= Math.min(x.c1, x.c0 + 99); cc++) {
        const n = this.value(s, rr, cc);
        if (typeof n === "number") ns.push(n);
      }
      return ns;
    };
    const cmp = (op: CompareOp, a: number, b: number, b2: number) =>
      ({ greaterThan: a > b, lessThan: a < b, greaterThanOrEqual: a >= b, lessThanOrEqual: a <= b, equal: a === b, notEqual: a !== b, between: a >= Math.min(b, b2) && a <= Math.max(b, b2), notBetween: a < Math.min(b, b2) || a > Math.max(b, b2) })[op];
    for (const rule of s.cfRules) {
      if (!inRule(rule)) continue;
      const k = rule.kind;
      let hit = false;
      if (k.type === "cellIs" && typeof v === "number") hit = cmp(k.op, v, Number(k.formulas[0]), Number(k.formulas[1] ?? k.formulas[0]));
      else if (k.type === "containsText") hit = typeof v === "string" && v.toLowerCase().includes(k.text.toLowerCase());
      else if ((k.type === "dataBar" || k.type === "colorScale" || k.type === "iconSet") && typeof v === "number") {
        const ns = numbers(rule);
        const lo = Math.min(...ns), hi = Math.max(...ns);
        const f = hi === lo ? 1 : (v - lo) / (hi - lo);
        if (k.type === "dataBar" && out.bar === undefined) Object.assign(out, { bar: f, barColor: k.color, ...(k.showValue ? {} : { hideValue: true }) });
        if (k.type === "colorScale" && !out.color) out.color = f < 0.5 ? k.points[0]!.color : k.points[k.points.length - 1]!.color;
        if (k.type === "iconSet" && out.icon === undefined) {
          const n = k.thresholds.length;
          Object.assign(out, { icon: Math.min(n - 1, Math.floor(f * n)), iconSet: k.set, ...(k.showValue ? {} : { hideValue: true }) });
        }
      }
      if (hit && rule.dxf) out.dxf = { ...rule.dxf, ...out.dxf };
      if (hit && rule.stopIfTrue) break;
    }
    return Object.keys(out).length > 0 ? out : null;
  }

  /** `validateInput` of the toy: lists of literals, whole / decimal numbers and text length are checked. */
  validate(sheet: number, row: number, col: number, input: string): ValidationResult {
    const s = this.sheet(sheet);
    const i = s.validations.findIndex((v) => v.ranges.some((x) => row >= x.r0 && row <= x.r1 && col >= x.c0 && col <= x.c1));
    if (i < 0) return { ok: true };
    const dv = s.validations[i]!;
    const pass = { ok: true, rule: i };
    if (!dv.showError) return pass;
    let ok = true;
    const k = dv.kind;
    if (input === "") ok = dv.allowBlank;
    else if (k.type === "list") ok = k.source.type !== "literal" || k.source.values.some((x) => x.toLowerCase() === input.toLowerCase());
    else if (k.type === "whole" || k.type === "decimal" || k.type === "textLength") {
      const n = k.type === "textLength" ? input.length : Number(input);
      const whole = k.type !== "whole" || Number.isInteger(n);
      const ops: Record<CompareOp, (a: number, b: number, b2: number) => boolean> = {
        greaterThan: (a, b) => a > b, lessThan: (a, b) => a < b, greaterThanOrEqual: (a, b) => a >= b, lessThanOrEqual: (a, b) => a <= b,
        equal: (a, b) => a === b, notEqual: (a, b) => a !== b, between: (a, b, b2) => a >= b && a <= b2, notBetween: (a, b, b2) => a < b || a > b2,
      };
      ok = Number.isFinite(n) && whole && ops[k.op](n, Number(k.f1), Number(k.f2 ?? k.f1));
    }
    if (ok) return pass;
    const res: ValidationResult = { ok: false, rule: i, errorStyle: dv.errorStyle, message: dv.errorMessage ?? "This value doesn't match the data validation restrictions defined for this cell." };
    if (dv.errorTitle) res.title = dv.errorTitle;
    return res;
  }

  /** `listValues` of the toy: literal lists, and same-sheet `$A$1:$A$3` ranges. */
  listValues(sheet: number, row: number, col: number): string[] {
    const s = this.sheet(sheet);
    const dv = s.validations.find((v) => v.ranges.some((x) => row >= x.r0 && row <= x.r1 && col >= x.c0 && col <= x.c1));
    if (!dv || dv.kind.type !== "list") return [];
    if (dv.kind.source.type === "literal") return [...dv.kind.source.values];
    const m = /^\$?([A-Z])\$?(\d+):\$?([A-Z])\$?(\d+)$/.exec(dv.kind.source.formula);
    if (!m) return [];
    const out: string[] = [];
    for (let r = Number(m[2]) - 1; r <= Number(m[4]) - 1; r++) out.push(this.view(s, r, m[1]!.charCodeAt(0) - 65).display);
    return out;
  }

  // --- sort and AutoFilter (a toy: values, custom, top 10 and average filters; auto-kind sorts) ---

  private filled(s: FakeSheet, r: number, c: number): boolean {
    return (this.cell(s, r, c)?.input ?? "") !== "";
  }

  /** `current_region`, as in the core. */
  private region(s: FakeSheet, row: number, col: number): Rect {
    let lastRow = -1, lastCol = -1;
    for (const [r, cells] of s.cells) for (const [c, x] of cells) if (x.input !== "") [lastRow, lastCol] = [Math.max(lastRow, r), Math.max(lastCol, c)];
    let r0 = row, c0 = col, r1 = row, c1 = col;
    if (lastRow < 0) return { r0, c0, r1, c1 };
    const any = (a: number, b: number, f: (i: number) => boolean) => Array.from({ length: Math.max(0, b - a + 1) }, (_, k) => a + k).some(f);
    for (let grown = true; grown; ) {
      grown = false;
      const [lc, hc, lr, hr] = [Math.max(0, c0 - 1), Math.min(c1 + 1, lastCol), Math.max(0, r0 - 1), Math.min(r1 + 1, lastRow)];
      if (r0 > 0 && any(lc, hc, (c) => this.filled(s, r0 - 1, c))) [r0, grown] = [r0 - 1, true];
      if (r1 < lastRow && any(lc, hc, (c) => this.filled(s, r1 + 1, c))) [r1, grown] = [r1 + 1, true];
      if (c0 > 0 && any(lr, hr, (r) => this.filled(s, r, c0 - 1))) [c0, grown] = [c0 - 1, true];
      if (c1 < lastCol && any(lr, hr, (r) => this.filled(s, r, c1 + 1))) [c1, grown] = [c1 + 1, true];
    }
    return { r0, c0, r1, c1 };
  }

  private passes(s: FakeSheet, row: number, col: number, f: Filter, data: CellView[]): boolean {
    const v = this.view(s, row, col);
    const fold = (x: string) => x.toLowerCase();
    const num = (x: CellView) => (x.kind === "number" ? Number(x.display) : NaN);
    switch (f.kind) {
      case "values":
        return f.values.some((x) => fold(x) === fold(v.display));
      case "custom": {
        const one = (op: string, value: string) => {
          const n = Number(value);
          const both = value.trim() !== "" && Number.isFinite(n) && v.kind === "number";
          const [a, b] = both ? [num(v), n] : [fold(v.display), fold(value)];
          const glob = (p: string) => new RegExp(`^${p.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`, "i");
          switch (op) {
            case "eq": return both ? a === b : glob(value).test(v.display);
            case "ne": return both ? a !== b : !glob(value).test(v.display);
            case "gt": return a > b;
            case "ge": return a >= b;
            case "lt": return a < b;
            case "le": return a <= b;
            case "beginsWith": return fold(v.display).startsWith(fold(value));
            case "endsWith": return fold(v.display).endsWith(fold(value));
            case "contains": return fold(v.display).includes(fold(value));
            default: return !fold(v.display).includes(fold(value));
          }
        };
        const hits = f.criteria.map((c) => one(c.op, c.value));
        return f.and ? hits.every(Boolean) : hits.some(Boolean);
      }
      case "top10": {
        const nums = data.map(num).filter((n) => !Number.isNaN(n)).sort((a, b) => (f.top ? b - a : a - b));
        const n = f.percent ? Math.max(1, Math.floor((nums.length * f.value) / 100)) : f.value;
        const edge = nums[Math.min(n, nums.length) - 1];
        const x = num(v);
        return edge !== undefined && !Number.isNaN(x) && (f.top ? x >= edge : x <= edge);
      }
      case "dynamic": {
        const nums = data.map(num).filter((n) => !Number.isNaN(n));
        const avg = nums.reduce((a, b) => a + b, 0) / Math.max(1, nums.length);
        const x = num(v);
        if (Number.isNaN(x)) return false;
        return f.filter === "aboveAverage" ? x > avg : f.filter === "belowAverage" ? x < avg : true;
      }
      case "dateGroups":
        return (f.values ?? []).some((x) => fold(x) === fold(v.display));
      case "color": {
        // The toy: the cell's own solid fill or font colour.
        const st = this.styles[v.style] ?? {};
        const have = f.font ? (st.font?.color ?? null) : st.fill?.kind === "solid" ? st.fill.color : null;
        return JSON.stringify(have) === JSON.stringify(f.color ?? null);
      }
      case "icon":
        return false;
    }
  }

  private rowPasses(s: FakeSheet, af: AutoFilter, row: number, skip: number | null): boolean {
    return (af.columns ?? []).every((fc) => {
      if (fc.col === skip) return true;
      const data: CellView[] = [];
      for (let r = af.r0 + 1; r <= af.r1; r++) data.push(this.view(s, r, fc.col));
      return this.passes(s, row, fc.col, fc.filter, data);
    });
  }

  /** Hides failing rows as `filtered`, shows passing filtered rows; returns the changed rows' previous views. */
  private applyFilters(s: FakeSheet, af: AutoFilter | undefined, showAll = false): RowView[] {
    const prev: RowView[] = [];
    if (!af) return prev;
    for (let r = af.r0 + 1; r <= af.r1; r++) {
      const old = s.rows.get(r) ?? { row: r, height: null, hidden: false, style: null };
      const pass = showAll || this.rowPasses(s, af, r, null);
      if (!pass && !old.hidden) {
        prev.push({ ...old });
        s.rows.set(r, { ...old, hidden: true, filtered: true });
      } else if (pass && old.filtered) {
        prev.push({ ...old });
        const next: RowView = { ...old, hidden: false };
        delete next.filtered;
        s.rows.set(r, next);
      }
    }
    return prev;
  }

  private sortFilter(cmd: Extract<CalcCommand, { type: "sortRange" | "sortSheetByColumn" | "setAutoFilter" | "setFilterColumn" | "clearFilters" | "reapplyFilter" | "restoreFilterState" }>): [CalcPatch, CalcCommand] {
    const s = this.sheet(cmd.sheet);
    const state: CalcCommand = {
      type: "restoreFilterState", sheet: s.id,
      autoFilter: s.autoFilter ? JSON.parse(JSON.stringify(s.autoFilter)) : null, sortState: s.sortState ? JSON.parse(JSON.stringify(s.sortState)) : null,
    };
    const finish = (prevRows: RowView[], patch: CalcPatch = this.emptyPatch()): [CalcPatch, CalcCommand] => {
      patch.sheets = this.sheetInfos();
      if (prevRows.length > 0) patch.rows = [{ sheet: s.id, rows: prevRows.map((r) => s.rows.get(r.row) ?? { row: r.row, height: null, hidden: false, style: null }) }];
      const inverse: CalcCommand[] = prevRows.length > 0 ? [{ type: "restoreRows", sheet: s.id, rows: prevRows }, state] : [state];
      return [patch, { type: "compound", commands: inverse }];
    };
    switch (cmd.type) {
      case "restoreFilterState":
        s.autoFilter = cmd.autoFilter ?? undefined;
        s.sortState = cmd.sortState ?? undefined;
        return finish([]);
      case "setAutoFilter": {
        const shown = this.applyFilters(s, s.autoFilter, true);
        if (cmd.range === null) s.autoFilter = undefined;
        else {
          const r = cmd.range.r0 === cmd.range.r1 && cmd.range.c0 === cmd.range.c1 ? this.region(s, cmd.range.r0, cmd.range.c0) : cmd.range;
          s.autoFilter = { ...r };
        }
        return finish(shown);
      }
      case "setFilterColumn": {
        const af = s.autoFilter;
        if (!af) throw new Fail("no_auto_filter", "no AutoFilter");
        if (cmd.col < af.c0 || cmd.col > af.c1) throw new Fail("invalid_range", "column outside the AutoFilter");
        const cols = (af.columns ?? []).filter((c) => c.col !== cmd.col);
        if (cmd.filter) cols.push({ col: cmd.col, filter: cmd.filter });
        cols.sort((a, b) => a.col - b.col);
        s.autoFilter = { ...af, columns: cols };
        if (cols.length === 0) delete s.autoFilter.columns;
        return finish(this.applyFilters(s, s.autoFilter));
      }
      case "clearFilters":
        if (s.autoFilter) {
          s.autoFilter = { ...s.autoFilter };
          delete s.autoFilter.columns;
        }
        return finish(this.applyFilters(s, s.autoFilter));
      case "reapplyFilter":
        return finish(this.applyFilters(s, s.autoFilter));
      case "sortRange":
      case "sortSheetByColumn": {
        let range: Rect, keys: SortKey[], hasHeader: boolean, caseSensitive = false;
        if (cmd.type === "sortRange") {
          this.checkRange(cmd.r0, cmd.c0, cmd.r1, cmd.c1);
          [range, keys, hasHeader, caseSensitive] = [{ r0: cmd.r0, c0: cmd.c0, r1: cmd.r1, c1: cmd.c1 }, cmd.keys, cmd.hasHeader, cmd.caseSensitive];
        } else {
          const af = s.autoFilter;
          const inAf = af && cmd.row >= af.r0 && cmd.row <= af.r1 && cmd.col >= af.c0 && cmd.col <= af.c1;
          range = inAf ? { r0: af.r0, c0: af.c0, r1: af.r1, c1: af.c1 } : this.region(s, cmd.row, cmd.col);
          keys = [{ col: cmd.col, ascending: cmd.ascending }];
          const first = this.view(s, range.r0, cmd.col), second = this.view(s, range.r0 + 1, cmd.col);
          hasHeader = !!inAf || (range.r1 > range.r0 && first.kind === "text" && second.kind !== "text");
        }
        const r0 = range.r0 + (hasHeader ? 1 : 0);
        const before = new Map<string, FakeCell>();
        const rows: number[] = [];
        for (let r = r0; r <= range.r1; r++) {
          if (s.rows.get(r)?.filtered) continue; // filtered rows stay put
          rows.push(r);
          for (let c = range.c0; c <= range.c1; c++) {
            const x = this.cell(s, r, c);
            if (x) before.set(`${r},${c}`, { ...x });
          }
        }
        const fold = (t: string) => (caseSensitive ? t : t.toLowerCase());
        const order = [...rows].sort((a, b) => {
          for (const k of keys) {
            const [x, y] = [this.view(s, a, k.col), this.view(s, b, k.col)];
            const rank = (v: CellView) => (v.kind === "empty" ? 2 : v.kind === "number" ? 0 : 1);
            if (rank(x) === 2 || rank(y) === 2) {
              if (rank(x) !== rank(y)) return rank(x) - rank(y); // blanks last either way
              continue;
            }
            let d = rank(x) - rank(y);
            if (d === 0) d = x.kind === "number" ? Number(x.display) - Number(y.display) : fold(x.display) < fold(y.display) ? -1 : fold(x.display) > fold(y.display) ? 1 : 0;
            if (d !== 0) return k.ascending ? d : -d;
          }
          return a - b;
        });
        const restore: [number, number, string, number][] = [];
        const coords: [number, number][] = [];
        order.forEach((from, i) => {
          const to = rows[i]!;
          for (let c = range.c0; c <= range.c1; c++) {
            const old = this.cell(s, to, c);
            const src = before.get(`${from},${c}`);
            restore.push([to, c, old?.input ?? "", old?.style ?? 0]);
            this.setCell(s, to, c, src?.input ?? "", src?.style ?? 0);
            coords.push([to, c]);
          }
        });
        s.sortState = { r0, c0: range.c0, r1: range.r1, c1: range.c1, keys, ...(caseSensitive ? { caseSensitive } : {}) };
        const [patch, inverse] = finish([], this.cellsPatch(s, coords));
        if (inverse.type === "compound") inverse.commands.unshift({ type: "restoreCells", sheet: s.id, cells: restore });
        return [patch, inverse];
      }
    }
  }

  /** The `filterValues` request: distinct displays of the data rows the other columns' filters keep, blanks last. */
  filterValues(sheet: number, col: number): FilterValue[] {
    const s = this.sheet(sheet);
    const af = s.autoFilter;
    if (!af) throw new Fail("no_auto_filter", "no AutoFilter");
    if (col < af.c0 || col > af.c1) throw new Fail("invalid_range", "column outside the AutoFilter");
    const out = new Map<string, FilterValue & { num: number | null }>();
    for (let r = af.r0 + 1; r <= af.r1; r++) {
      if (!this.rowPasses(s, af, r, col)) continue;
      const v = this.view(s, r, col);
      const key = v.display.toLowerCase();
      const e = out.get(key);
      if (e) e.count++;
      else out.set(key, { display: v.display, count: 1, num: v.kind === "number" ? Number(v.display) : null });
    }
    const rank = (e: { display: string; num: number | null }) => (e.display === "" ? 2 : e.num !== null ? 0 : 1);
    return [...out.values()]
      .sort((a, b) => rank(a) - rank(b) || (a.num !== null && b.num !== null ? a.num - b.num : a.display.toLowerCase().localeCompare(b.display.toLowerCase())))
      .map(({ display, count }) => ({ display, count }));
  }

  private intern(style: CellStyle): number {
    const key = JSON.stringify(style);
    const i = this.styles.findIndex((s) => JSON.stringify(s) === key);
    if (i >= 0) return i;
    this.styles.push(style);
    return this.styles.length - 1;
  }

  /** Like the core: any change of a workbook with rules names those sheets in `cfSheets` (charts: `chartSheets`). */
  // --- annotations (P8-26, a toy of calc_core's annotations) ---------------------------------

  private annotState(): string {
    return JSON.stringify({ s: this.sheets.map((x) => [x.id, x.notes, x.threads, x.hyperlinks]), p: this.persons });
  }

  /** Runs a command; like the core, undo of changed annotations restores their old state. */
  private withAnnotations(run: () => [CalcPatch, CalcCommand | null]): [CalcPatch, CalcCommand | null] {
    const before = JSON.parse(this.annotState()) as { s: [number, Note[], Thread[], Hyperlink[]][]; p: Person[] };
    const [patch, inv] = run();
    const restore: CalcCommand[] = [];
    const changed: SheetAnnotations[] = [];
    for (const [id, notes, threads, hyperlinks] of before.s) {
      const s = this.sheets.find((x) => x.id === id);
      if (!s || JSON.stringify([notes, threads, hyperlinks]) === JSON.stringify([s.notes, s.threads, s.hyperlinks])) continue;
      restore.push({ type: "restoreAnnotations", sheet: id, notes, threads, hyperlinks });
      changed.push({ sheet: id, notes: JSON.parse(JSON.stringify(s.notes)) as Note[], threads: JSON.parse(JSON.stringify(s.threads)) as Thread[], hyperlinks: JSON.parse(JSON.stringify(s.hyperlinks)) as Hyperlink[] });
      const cells = new Set<string>();
      for (const x of [...notes, ...threads, ...s.notes, ...s.threads]) cells.add(`${x.row},${x.col}`);
      for (const h of [...hyperlinks, ...s.hyperlinks]) cells.add(`${h.r0},${h.c0}`);
      const views = [...cells].map((k) => k.split(",").map(Number) as [number, number]).map(([r, c]) => this.view(s, r, c));
      if (!patch.structural.some((x) => x.sheet === id)) {
        const g = patch.cells.find((x) => x.sheet === id);
        if (g) g.cells.push(...views.filter((v) => !g.cells.some((c) => c.row === v.row && c.col === v.col)));
        else patch.cells.push({ sheet: id, cells: views });
      }
    }
    if (JSON.stringify(before.p) !== JSON.stringify(this.persons)) {
      restore.push({ type: "restorePersons", persons: before.p });
      patch.persons = this.persons.map((p) => ({ ...p }));
    }
    if (changed.length) patch.annotations = changed;
    if (!restore.length) return [patch, inv];
    const keep = inv && !(inv.type === "compound" && inv.commands.length === 0) ? [inv] : [];
    return [patch, { type: "compound", commands: [...keep, ...restore] }];
  }

  private annotCmd(cmd: Extract<CalcCommand, { type: "setNote" | "deleteNote" | "showHideNote" | "convertNotesToComments" | "addComment" | "replyComment" | "editComment" | "deleteReply" | "deleteThread" | "resolveThread" | "setUser" | "setHyperlink" | "removeHyperlink" | "restoreAnnotations" | "restorePersons" }>): [CalcPatch, CalcCommand] {
    const none: CalcCommand = { type: "compound", commands: [] };
    const at = <T extends { row: number; col: number }>(xs: T[], row: number, col: number) => xs.find((x) => x.row === row && x.col === col);
    const inRange = (c: { r0: number; c0: number; r1: number; c1: number }) => (x: { row: number; col: number }) => x.row >= c.r0 && x.row <= c.r1 && x.col >= c.c0 && x.col <= c.c1;
    const id = () => `{FAKE-${String(++this.commentSeq).padStart(4, "0")}}`;
    const thread = (s: FakeSheet, row: number, col: number) => {
      const t = at(s.threads, row, col);
      if (!t) throw new Fail("invalid_annotation", "the cell has no comment");
      return t;
    };
    switch (cmd.type) {
      case "setNote": {
        const s = this.sheet(cmd.sheet);
        const old = at(s.notes, cmd.row, cmd.col);
        const note: Note = { row: cmd.row, col: cmd.col, text: cmd.text };
        const author = cmd.author ?? old?.author;
        if (author) note.author = author;
        if (cmd.visible ?? old?.visible) note.visible = true;
        const bounds = cmd.bounds ?? old?.bounds;
        if (bounds) note.bounds = bounds;
        s.notes = [...s.notes.filter((n) => n !== old), note].sort((a, b) => a.row - b.row || a.col - b.col);
        break;
      }
      case "deleteNote": {
        const s = this.sheet(cmd.sheet);
        s.notes = s.notes.filter((n) => !inRange(cmd)(n));
        break;
      }
      case "showHideNote": {
        const s = this.sheet(cmd.sheet);
        const n = at(s.notes, cmd.row, cmd.col);
        if (!n) throw new Fail("invalid_annotation", "the cell has no note");
        const v = cmd.visible ?? !n.visible;
        if (v) n.visible = true;
        else delete n.visible;
        break;
      }
      case "convertNotesToComments": {
        const s = this.sheet(cmd.sheet);
        const kept: Note[] = [];
        for (const n of s.notes) {
          if (at(s.threads, n.row, n.col)) {
            kept.push(n);
            continue;
          }
          const text = n.text.map((r) => r.text).join("").replace(new RegExp(`^${n.author ?? "\u0000"}:\n?`), "");
          s.threads.push({ id: id(), row: n.row, col: n.col, author: n.author ? { name: n.author } : cmd.author, date: cmd.date, text });
        }
        s.notes = kept;
        break;
      }
      case "addComment": {
        const s = this.sheet(cmd.sheet);
        if (at(s.threads, cmd.row, cmd.col)) throw new Fail("invalid_annotation", "the cell already has a comment");
        s.threads.push({ id: id(), row: cmd.row, col: cmd.col, author: cmd.author, date: cmd.date, text: cmd.text });
        s.threads.sort((a, b) => a.row - b.row || a.col - b.col);
        break;
      }
      case "replyComment": {
        const t = thread(this.sheet(cmd.sheet), cmd.row, cmd.col);
        t.replies = [...(t.replies ?? []), { id: id(), author: cmd.author, date: cmd.date, text: cmd.text }];
        break;
      }
      case "editComment": {
        const t = thread(this.sheet(cmd.sheet), cmd.row, cmd.col);
        if (t.id === cmd.id) t.text = cmd.text;
        else {
          const r = t.replies?.find((x) => x.id === cmd.id);
          if (!r) throw new Fail("invalid_annotation", "unknown comment id");
          r.text = cmd.text;
        }
        break;
      }
      case "deleteReply": {
        const t = thread(this.sheet(cmd.sheet), cmd.row, cmd.col);
        t.replies = (t.replies ?? []).filter((r) => r.id !== cmd.id);
        if (!t.replies.length) delete t.replies;
        break;
      }
      case "deleteThread": {
        const s = this.sheet(cmd.sheet);
        s.threads = s.threads.filter((t) => !inRange(cmd)(t));
        break;
      }
      case "resolveThread": {
        const t = thread(this.sheet(cmd.sheet), cmd.row, cmd.col);
        if (cmd.resolved) t.resolved = true;
        else delete t.resolved;
        break;
      }
      case "setUser": {
        const p = this.persons.find((x) => x.name === cmd.name);
        if (p) p.initials = cmd.initials;
        else if (cmd.name.trim()) this.persons.push({ name: cmd.name, initials: cmd.initials });
        break;
      }
      case "setHyperlink": {
        const s = this.sheet(cmd.sheet);
        s.hyperlinks = s.hyperlinks.filter((h) => !intersects(h, cmd));
        const link: Hyperlink = { r0: cmd.r0, c0: cmd.c0, r1: cmd.r1, c1: cmd.c1, target: cmd.target };
        if (cmd.text) link.display = cmd.text;
        if (cmd.tooltip) link.tooltip = cmd.tooltip;
        s.hyperlinks.push(link);
        const patch = this.emptyPatch();
        const invs: CalcCommand[] = [];
        if (cmd.text && (this.cell(s, cmd.r0, cmd.c0)?.input ?? "") !== cmd.text) {
          const [p, inv] = this.exec({ type: "setInput", sheet: cmd.sheet, row: cmd.r0, col: cmd.c0, input: cmd.text });
          mergePatch(patch, p);
          if (inv) invs.push(inv);
        }
        const [p, inv] = this.exec({ type: "applyStyle", sheet: cmd.sheet, r0: cmd.r0, c0: cmd.c0, r1: cmd.r1, c1: cmd.c1, patch: { font: { underline: "single", color: { kind: "theme", value: { slot: "hyperlink", tint: 0 } } } } });
        mergePatch(patch, p);
        if (inv) invs.push(inv);
        return [patch, { type: "compound", commands: invs.reverse() }];
      }
      case "removeHyperlink": {
        const s = this.sheet(cmd.sheet);
        s.hyperlinks = s.hyperlinks.filter((h) => !intersects(h, cmd));
        break;
      }
      case "restoreAnnotations": {
        const s = this.sheets.find((x) => x.id === cmd.sheet);
        if (!s) break;
        s.notes = JSON.parse(JSON.stringify(cmd.notes)) as Note[];
        s.threads = JSON.parse(JSON.stringify(cmd.threads)) as Thread[];
        s.hyperlinks = JSON.parse(JSON.stringify(cmd.hyperlinks)) as Hyperlink[];
        break;
      }
      case "restorePersons":
        this.persons = cmd.persons.map((p) => ({ ...p }));
        break;
    }
    return [this.emptyPatch(), none];
  }

  private markCf(patch: CalcPatch): void {
    const ids = this.sheets.filter((x) => x.cfRules.length > 0 || x.validations.length > 0).map((x) => x.id);
    const all = new Set([...(patch.cfSheets ?? []), ...ids]);
    if (all.size > 0) patch.cfSheets = [...all];
    const charts = new Set([...(patch.chartSheets ?? []), ...this.sheets.filter((x) => x.charts.length > 0).map((x) => x.id)]);
    if (charts.size > 0) patch.chartSheets = [...charts];
  }

  // --- charts (a toy: A1 references of this workbook, Excel's recommendation simplified) ---

  private chartCmd(cmd: Extract<CalcCommand, { type: "addChart" | "updateChart" | "setChartAnchor" | "setChartSeries" | "removeChart" | "restoreCharts" }>): [CalcPatch, CalcCommand] {
    const s = this.sheet(cmd.sheet);
    const copy = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
    const inverse: CalcCommand = { type: "restoreCharts", sheet: s.id, charts: copy(s.charts) };
    const find = (id: number) => {
      const c = s.charts.find((x) => x.id === id);
      if (!c) throw new Fail("unknown_chart", `unknown chart ${id}`);
      return c;
    };
    switch (cmd.type) {
      case "addChart": {
        if (cmd.chart.kind.type === "unsupported") throw new Fail("invalid_chart", "unsupported chart type");
        const id = cmd.id || Math.max(0, ...s.charts.map((c) => c.id)) + 1;
        s.charts.push({ id, name: cmd.name ?? `Chart ${id}`, anchor: copy(cmd.anchor), chart: copy(cmd.chart) });
        break;
      }
      case "updateChart":
        find(cmd.id).chart = copy(cmd.chart);
        break;
      case "setChartAnchor":
        find(cmd.id).anchor = copy(cmd.anchor);
        break;
      case "setChartSeries": {
        const c = find(cmd.id);
        c.chart = { ...c.chart, series: copy(cmd.series) };
        if (cmd.categories) c.chart.categories = copy(cmd.categories);
        else delete c.chart.categories;
        break;
      }
      case "removeChart":
        find(cmd.id);
        s.charts = s.charts.filter((c) => c.id !== cmd.id);
        break;
      case "restoreCharts":
        s.charts = copy(cmd.charts);
        break;
    }
    const patch = this.emptyPatch();
    patch.chartSheets = [s.id];
    return [patch, inverse];
  }

  /** Cells of an A1 reference `Sheet!$A$1:$B$2` row-major (`null`: unresolvable). */
  private refCells(formula: string): { sheet: FakeSheet; cells: [number, number][] } | null {
    const m = /^(?:'?((?:[^'!]|'')+)'?!)?\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/.exec(formula.trim());
    if (!m) return null;
    const col = (l: string) => [...l].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
    let sheet: FakeSheet;
    try {
      sheet = m[1] ? this.sheetByName(m[1].replace(/''/g, "'")) : this.sheets[0]!;
    } catch {
      return null;
    }
    const r0 = Number(m[3]) - 1;
    const c0 = col(m[2]!);
    const r1 = m[5] ? Number(m[5]) - 1 : r0;
    const c1 = m[4] ? col(m[4]) : c0;
    const cells: [number, number][] = [];
    for (let r = Math.min(r0, r1); r <= Math.max(r0, r1); r++) for (let c = Math.min(c0, c1); c <= Math.max(c0, c1); c++) cells.push([r, c]);
    return { sheet, cells };
  }

  private refValues(ref: DataRef | undefined): (number | null)[] {
    if (!ref) return [];
    if (ref.type === "literal") return ref.values.map((v) => (typeof v === "number" ? v : v === null ? null : 0));
    const cells = this.refCells(ref.formula);
    if (!cells) return (ref.cache ?? []).map((v) => (typeof v === "number" ? v : null));
    return cells.cells.map(([r, c]) => {
      const v = this.value(cells.sheet, r, c);
      return typeof v === "number" ? v : v === "" || typeof v === "object" ? null : 0;
    });
  }

  private refTexts(ref: DataRef | TextSource | undefined): string[] {
    if (!ref) return [];
    if (ref.type === "literal") return "text" in ref ? [ref.text] : ref.values.map((v) => (v === null ? "" : String(v)));
    const cells = this.refCells(ref.formula);
    if (!cells) return [];
    return cells.cells.map(([r, c]) => this.view(cells.sheet, r, c).display);
  }

  resolveChart(chart: Chart): ResolvedChart {
    const series = chart.series.map((s, i) => {
      const values = this.refValues(s.values);
      const catRef = s.categories ?? chart.categories;
      const cats = this.refTexts(catRef);
      const categories = values.map((_, k) => cats[k] ?? String(k + 1));
      const name = s.name ? this.refTexts(s.name).join(" ") : `Series${i + 1}`;
      const xNums = catRef ? this.refValues(catRef) : [];
      const numeric = catRef && xNums.length > 0 && xNums.every((v) => v !== null);
      return { name, categories, values, ...(numeric ? { xValues: xNums } : chart.kind.type === "scatter" ? { xValues: values.map((_, k) => k + 1) } : {}) };
    });
    const title = chart.title ? (chart.title.text ? this.refTexts(chart.title.text).join(" ") : series.length === 1 ? series[0]!.name : undefined) : undefined;
    return { series, ...(title ? { title } : {}) };
  }

  /** Excel's recommended chart, simplified: header row and first text column, series down the columns. */
  recommendChart(sheetId: number, r0: number, c0: number, r1: number, c1: number): Chart | null {
    const s = this.sheet(sheetId);
    if (r0 === r1 && c0 === c1) {
      // A single cell: the filled block around it (toy current region: to the right and down).
      while (this.cell(s, r1 + 1, c0)?.input) r1++;
      while (this.cell(s, r0, c1 + 1)?.input) c1++;
    }
    const isNum = (r: number, c: number) => typeof this.value(s, r, c) === "number";
    const header = !isNum(r0, c0) && [...Array(c1 - c0 + 1).keys()].every((k) => !isNum(r0, c0 + k) || k === 0) && r1 > r0;
    const firstCol = c1 > c0 && [...Array(r1 - r0 + 1).keys()].slice(header ? 1 : 0).every((k) => !isNum(r0 + k, c0));
    const dr0 = header ? r0 + 1 : r0;
    const dc0 = firstCol ? c0 + 1 : c0;
    let any = false;
    for (let r = dr0; r <= r1; r++) for (let c = dc0; c <= c1; c++) any ||= isNum(r, c);
    if (!any) return null;
    const name = s.name;
    const a1 = (r: number, c: number) => `$${shiftRefs("=A1", 0, c).slice(1).replace(/\d+$/, "")}$${r + 1}`;
    const ref = (ra: number, ca: number, rb: number, cb: number) => ({ type: "ref" as const, formula: `${name}!${a1(ra, ca)}${ra === rb && ca === cb ? "" : `:${a1(rb, cb)}`}` });
    const series = [];
    for (let c = dc0; c <= c1; c++) series.push({ ...(header ? { name: { type: "ref" as const, formula: `${name}!${a1(r0, c)}` } } : {}), values: ref(dr0, c, r1, c) });
    const chart: Chart = {
      kind: { type: "bar", direction: "column", grouping: "clustered" },
      series,
      axes: { cat: {}, val: { majorGridlines: true } },
      title: series.length === 1 ? {} : { text: { type: "literal", text: "Chart Title" } },
      gapWidth: 219,
      overlap: -27,
      ...(firstCol ? { categories: ref(dr0, c0, r1, c0) } : {}),
      ...(series.length > 1 ? { legend: { position: "bottom" as const } } : {}),
    };
    return chart;
  }

  envelope(patch: CalcPatch) {
    return {
      revision: this.revision,
      patch,
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      dirty: this.revision !== this.savedRevision,
    };
  }

  private stateResponse(): Response {
    return { ok: { type: "documentState", dirty: this.revision !== this.savedRevision, revision: this.revision, name: this.name } };
  }

  private infoResponse(): Response {
    const info = {
      sheets: this.sheetInfos(), styles: [...this.styles], revision: this.revision, ...(this.names.length ? { names: this.nameInfos() } : {}),
      activeSheet: this.sheets.find((x) => !x.hidden)?.id ?? 0,
      calc: structuredClone(this.calc),
      ...(this.bookProtection ? { workbookProtection: { ...this.bookProtection } } : {}),
      ...(this.tableStyles.custom?.length || this.tableStyles.defaultStyle ? { tableStyles: structuredClone(this.tableStyles) } : {}),
      ...(this.persons.length ? { persons: this.persons.map((p) => ({ ...p })) } : {}),
    };
    return { ok: { type: "info", info } };
  }

  handle(req: Request): Response {
    this.log.push(req);
    try {
      switch (req.type) {
        case "apply": {
          this.checkProtection(req.command);
          const [patch, inv] = this.withAnnotations(() => this.exec(req.command));
          this.markCf(patch);
          if (!patch.pivotSheets && this.pivots.tables.size > 0) {
            // Edited source cells make their caches stale (as the core does).
            let changed = false;
            for (const g of patch.cells) if (this.pivots.touched(g.sheet, g.cells.map((c) => [c.row, c.col]))) changed = true;
            if (changed) patch.stalePivots = this.pivots.stale();
          }
          this.revision++;
          if (inv) this.undoStack.push(inv);
          this.redoStack = [];
          return { ok: { type: "patch", envelope: this.envelope(patch) } };
        }
        case "undo":
        case "redo": {
          const from = req.type === "undo" ? this.undoStack : this.redoStack;
          const to = req.type === "undo" ? this.redoStack : this.undoStack;
          const cmd = from.pop();
          if (!cmd) return { ok: { type: "patch", envelope: this.envelope(this.emptyPatch()) } };
          const [patch, inv] = this.withAnnotations(() => this.exec(cmd));
          this.markCf(patch);
          if (inv) to.push(inv);
          this.revision++;
          return { ok: { type: "patch", envelope: this.envelope(patch) } };
        }
        case "snapshot": {
          const s = this.sheet(req.sheet);
          this.checkRange(req.r0, req.c0, req.r1, req.c1);
          const cells: CellView[] = [];
          for (let r = req.r0; r <= req.r1; r++) {
            const row = s.cells.get(r);
            if (!row) continue;
            for (const c of row.keys()) if (c >= req.c0 && c <= req.c1) cells.push(this.view(s, r, c));
          }
          for (const x of [...s.notes, ...s.threads]) {
            if (x.row < req.r0 || x.row > req.r1 || x.col < req.c0 || x.col > req.c1 || cells.some((c) => c.row === x.row && c.col === x.col)) continue;
            cells.push(this.view(s, x.row, x.col));
          }
          for (const [r, c] of this.pivots.cellsIn(s.id, req)) if (!cells.some((x) => x.row === r && x.col === c)) cells.push(this.view(s, r, c));
          cells.sort((a, b) => a.row - b.row || a.col - b.col);
          const merges = s.merges.filter((m) => intersects(m, req)).map((m) => ({ ...m }));
          const pivots = this.pivots.summaries(s.id);
          const cf: CellCf[] = [];
          if (s.cfRules.length > 0) {
            for (let r = req.r0; r <= Math.min(req.r1, req.r0 + 199); r++) {
              for (let c = req.c0; c <= Math.min(req.c1, req.c0 + 49); c++) {
                const res = this.cfOf(s, r, c);
                if (res) cf.push({ row: r, col: c, cf: res });
              }
            }
          }
          const validations = s.validations.filter((v) => v.ranges.some((x) => intersects(x, req)));
          return {
            ok: {
              type: "snapshot",
              snapshot: {
                ...req,
                cells,
                cols: [...s.cols.values()].filter((c) => c.col >= req.c0 && c.col <= req.c1),
                rows: [...s.rows.values()].filter((r) => r.row >= req.r0 && r.row <= req.r1),
                format: { defaultColWidth: 8.43, defaultRowHeight: 15 },
                ...(merges.length ? { merges } : {}),
                ...(cf.length ? { cf } : {}),
                ...(validations.length ? { validations: JSON.parse(JSON.stringify(validations)) as DataValidation[] } : {}),
                ...(s.charts.length ? { charts: JSON.parse(JSON.stringify(s.charts)) as ChartObject[] } : {}),
                ...(pivots.length ? { pivots } : {}),
              },
            },
          };
        }
        case "info":
          return this.infoResponse();
        case "newDocument":
          this.reset();
          return this.infoResponse();
        case "openXlsx": {
          // The fake cannot read xlsx: it opens an empty workbook named like the file.
          this.reset();
          this.name = req.name;
          const info = this.infoResponse();
          return {
            ok: {
              type: "opened",
              info: "ok" in info && info.ok.type === "info" ? info.ok.info : { sheets: [], styles: [], revision: this.revision, activeSheet: 0, calc: structuredClone(this.calc) },
              warnings: ["fake backend: file content ignored"],
              envelope: this.envelope(this.emptyPatch()),
            },
          };
        }
        case "saveXlsx":
          return { ok: { type: "saved", bytesBase64: "UEsDBA==", suggestedName: this.name ?? "Untitled.xlsx" } };
        case "markSaved":
          this.savedRevision = this.revision;
          return this.stateResponse();
        case "documentState":
          return this.stateResponse();
        case "recoverySnapshot": {
          const cells = this.sheets.flatMap((sh) =>
            [...sh.cells].flatMap(([r, row]) => [...row].map(([c, cell]) => [sh.id, r, c, cell.input])),
          );
          return {
            ok: {
              type: "recoverySnapshot",
              json: JSON.stringify({ cells }),
              revision: this.revision,
              dirty: this.revision !== this.savedRevision,
              name: this.name,
            },
          };
        }
        case "restoreRecovery": {
          let cells: unknown;
          try {
            cells = (JSON.parse(req.json) as { cells?: unknown }).cells;
          } catch {
            cells = undefined;
          }
          if (!Array.isArray(cells)) throw new Fail("invalid_snapshot", "not a fake recovery snapshot");
          this.reset();
          for (const [sheet, row, col, input] of cells as [number, number, number, string][]) {
            this.exec({ type: "setInput", sheet, row, col, input });
          }
          this.name = req.name ?? null;
          this.savedRevision = -1;
          return this.infoResponse();
        }
        case "findCells": {
          const q = req.matchCase ? req.query : req.query.toLowerCase();
          const hit = (t: string) => {
            const x = req.matchCase ? t : t.toLowerCase();
            return q !== "" && (req.wholeCell ? x === q : x.includes(q));
          };
          const sheets = req.sheet === null ? this.sheets : [this.sheet(req.sheet)];
          const cells = sheets.flatMap((sh) =>
            [...sh.cells.keys()].sort((a, b) => a - b).flatMap((r) =>
              [...sh.cells.get(r)!.keys()].sort((a, b) => a - b).flatMap((c) => {
                const v = this.view(sh, r, c);
                return v.input !== "" && (hit(v.input) || hit(v.display)) ? [{ sheet: sh.id, row: r, col: c, input: v.input, display: v.display }] : [];
              }),
            ),
          );
          return { ok: { type: "found", cells } };
        }
        case "usedRange": {
          const s = this.sheet(req.sheet);
          let last: [number, number] | null = null;
          for (const [r, row] of s.cells) {
            for (const [c, cell] of row) {
              if (cell.input === "" && cell.style === 0) continue;
              last = last ? [Math.max(last[0], r), Math.max(last[1], c)] : [r, c];
            }
          }
          return { ok: { type: "usedRange", last } };
        }
        case "formatPreview": {
          const dec = /^[#,]*0(?:\.(0+))?%?$/.exec(req.code.replace(/[^#0.,%]/g, ""));
          let text = formatNumber(req.value);
          if (dec && req.code !== "General") {
            const pct = req.code.includes("%");
            text = (pct ? req.value * 100 : req.value).toFixed(dec[1]?.length ?? 0) + (pct ? "%" : "");
          }
          return { ok: { type: "formatted", text } };
        }
        case "filterValues":
          return { ok: { type: "filterValues", values: this.filterValues(req.sheet, req.col) } };
        case "validateInput":
          return { ok: { type: "validation", result: this.validate(req.sheet, req.row, req.col, req.input) } };
        case "listValues":
          return { ok: { type: "listValues", values: this.listValues(req.sheet, req.row, req.col) } };
        case "lineColors": {
          // The toy: solid fills and font colours of the cells' own styles (no conditional formatting).
          const s = this.sheet(req.sheet);
          const fills: (Color | null)[] = [], fonts: (Color | null)[] = [];
          const same = (a: Color | null, b: Color | null) => JSON.stringify(a) === JSON.stringify(b);
          const cells = req.columns
            ? Array.from({ length: req.c1 - req.c0 + 1 }, (_, i) => [req.line, req.c0 + i] as const)
            : Array.from({ length: req.r1 - req.r0 + 1 }, (_, i) => [req.r0 + i, req.line] as const);
          for (const [r, c] of cells) {
            const st = this.styles[this.cell(s, r, c)?.style ?? 0] ?? {};
            const fill = st.fill?.kind === "solid" ? st.fill.color : null;
            const font = st.font?.color ?? null;
            if (!fills.some((f) => same(f, fill))) fills.push(fill);
            if (!fonts.some((f) => same(f, font))) fonts.push(font);
          }
          return { ok: { type: "lineColors", colors: { fills, fonts, icons: [] } } };
        }
        case "invalidCells": {
          // Circle Invalid Data: every non-empty validated cell whose input fails the toy check.
          const s = this.sheet(req.sheet);
          const cells: Rect[] = [];
          for (const [r, row] of [...s.cells].sort((a, b) => a[0] - b[0])) {
            for (const [c, x] of [...row].sort((a, b) => a[0] - b[0])) {
              if (x.input !== "" && !this.validate(req.sheet, r, c, x.input).ok) cells.push({ r0: r, c0: c, r1: r, c1: c });
            }
          }
          return { ok: { type: "invalidCells", cells: cells.slice(0, 255) } };
        }
        case "sheetRules": {
          const s = this.sheet(req.sheet);
          return { ok: { type: "sheetRules", rules: JSON.parse(JSON.stringify(s.cfRules)), validations: JSON.parse(JSON.stringify(s.validations)) } };
        }
        case "sheetCharts":
          return { ok: { type: "charts", charts: JSON.parse(JSON.stringify(this.sheet(req.sheet).charts)) as ChartObject[] } };
        case "chartData": {
          const c = this.sheet(req.sheet).charts.find((x) => x.id === req.id);
          if (!c) throw new Fail("unknown_chart", `unknown chart ${req.id}`);
          return { ok: { type: "chartData", data: this.resolveChart(c.chart) } };
        }
        case "previewChartData":
          this.sheet(req.sheet);
          return { ok: { type: "chartData", data: this.resolveChart(req.chart) } };
        case "recommendedChart":
          return { ok: { type: "recommendedChart", chart: this.recommendChart(req.sheet, req.r0, req.c0, req.r1, req.c1) } };
        case "names":
          return { ok: { type: "names", names: this.nameRows(req.sheet) } };
        case "nameAt": {
          const hit = this.nameInfos().find((n) => n.range && n.range.sheet === req.sheet && n.range.r0 === req.rect.r0 && n.range.c0 === req.rect.c0 && n.range.r1 === req.rect.r1 && n.range.c1 === req.rect.c1);
          return { ok: { type: "nameAt", name: hit?.name ?? null } };
        }
        case "cellAnnotations": {
          const s = this.sheet(req.sheet);
          const inside = (x: { row: number; col: number }) => x.row >= req.r0 && x.row <= req.r1 && x.col >= req.c0 && x.col <= req.c1;
          const formulaLinks = [];
          for (const [r, row] of s.cells) {
            for (const [c, cell] of row) {
              const m = /^=HYPERLINK\("([^"]*)"/i.exec(cell.input);
              if (!m || !inside({ row: r, col: c })) continue;
              const url = m[1]!;
              formulaLinks.push({ row: r, col: c, target: url.startsWith("#") ? { kind: "location" as const, location: url.slice(1) } : { kind: "url" as const, url } });
            }
          }
          const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
          return {
            ok: {
              type: "annotations",
              annotations: {
                sheet: req.sheet,
                notes: copy(s.notes.filter(inside)),
                threads: copy(s.threads.filter(inside)),
                hyperlinks: copy(s.hyperlinks.filter((x) => intersects(x, req))),
                formulaLinks,
              },
            },
          };
        }
        case "allComments": {
          const list = req.sheet === null ? this.sheets.filter((s) => s.threads.length) : [this.sheet(req.sheet)];
          return { ok: { type: "comments", sheets: list.map((s) => ({ sheet: s.id, threads: JSON.parse(JSON.stringify(s.threads)) as Thread[] })) } };
        }
        case "pivotAt":
          return { ok: { type: "pivotAt", pivot: this.pivots.at(req.sheet, req.row, req.col) } };
        case "pivotInfo":
          try {
            return { ok: { type: "pivotInfo", info: this.pivots.info(req.id) } };
          } catch {
            throw new Fail("unknown_pivot", `unknown pivot ${req.id}`);
          }
        case "pivotItems":
          return { ok: { type: "pivotItems", items: this.pivots.items(req.id, req.field) } };
        case "recommendPivots":
          // A fixed toy candidate (the ranking is the Rust core's, P9-C3).
          return {
            ok: {
              type: "pivotRecommendations",
              items: [
                { title: "Sum of Sales by Region", fields: { rows: [{ field: 0 }], values: [{ field: 3 }] }, preview: [["Row Labels", "Sum of Sales"], ["North", "30"], ["South", "70"], ["Grand Total", "100"]] },
                { title: "Sum of Sales by Product", fields: { rows: [{ field: 1 }], values: [{ field: 3 }] }, preview: [["Row Labels", "Sum of Sales"], ["Apple", "40"], ["Pear", "60"], ["Grand Total", "100"]] },
              ],
            },
          };
        case "errorChecks": {
          // A toy: numbers stored as text (an apostrophe) and error results (P9-C4).
          const s = this.sheet(req.sheet);
          const rules = req.rules ?? ["errorValue", "inconsistentFormula", "numberAsText", "unlockedFormula"];
          const issues: ErrorIssue[] = [];
          for (const [r, row] of [...s.cells].sort((a, b) => a[0] - b[0])) {
            for (const [c, cell] of [...row].sort((a, b) => a[0] - b[0])) {
              if (rules.includes("numberAsText") && /^'\s*-?[0-9]+(\.[0-9]+)?\s*$/.test(cell.input)) issues.push({ row: r, col: c, rule: "numberAsText" });
              else if (rules.includes("errorValue") && cell.input.startsWith("=") && this.view(s, r, c).kind === "error") issues.push({ row: r, col: c, rule: "errorValue" });
            }
          }
          return { ok: { type: "errorChecks", issues } };
        }
        case "evaluateFormula": {
          const s = this.sheet(req.sheet);
          const v = this.view(s, req.row, req.col);
          const formula = v.input.startsWith("=") ? v.input : "";
          const steps = formula ? [{ text: formula, start: 1, end: formula.length, value: v.display }] : [];
          return { ok: { type: "evaluation", evaluation: { formula, steps, result: v.display } } };
        }
        case "watchCells":
          return {
            ok: {
              type: "watch",
              items: req.cells.map((w) => {
                const s = this.sheets.find((x) => x.id === w.sheet);
                if (!s) return { ...w, value: "#REF!" };
                const v = this.view(s, w.row, w.col);
                return { ...w, sheetName: s.name, value: v.display, ...(v.input.startsWith("=") ? { formula: v.input } : {}) };
              }),
            },
          };
        case "precedents":
          return { ok: { type: "trace", refs: this.precedents(req.sheet, req.row, req.col) } };
        case "dependents":
          return { ok: { type: "trace", refs: this.dependents(req.sheet, req.row, req.col) } };
        case "loadSnapshotJson":
        case "saveSnapshotJson":
          throw new Fail("internal", "not supported by the fake backend");
        default:
          throw new Fail("bad_request", `unknown request ${JSON.stringify(req)}`);
      }
    } catch (e) {
      if (e instanceof Fail) return { err: { code: e.code, message: e.message } };
      return { err: { code: "internal", message: String(e) } };
    }
  }
}

/** Toy reference shifter for the fake's paste/fill (A1 refs outside strings; `$` parts stay). */
export function shiftRefs(input: string, dRow: number, dCol: number): string {
  if (!input.startsWith("=") || (dRow === 0 && dCol === 0)) return input;
  const colNum = (s: string) => [...s].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  const colStr = (n: number) => {
    let s = "";
    for (n += 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    return s;
  };
  return input
    .split(/("[^"]*")/)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part.replace(/(\$?)([A-Z]{1,3})(\$?)(\d+)/g, (_m, ca: string, col: string, ra: string, row: string) => {
            const c = ca ? colNum(col) : colNum(col) + dCol;
            const r = ra ? Number(row) : Number(row) + dRow;
            return c < 0 || r < 1 ? "#REF!" : `${ca}${colStr(c)}${ra}${r}`;
          }),
    )
    .join("");
}

function mergePatch(into: CalcPatch, p: CalcPatch): void {
  if (p.sheets) into.sheets = p.sheets;
  if (p.styles) into.styles = p.styles;
  if (p.cycle) into.cycle = p.cycle;
  if (p.activateSheet !== undefined) into.activateSheet = p.activateSheet;
  if (p.cfSheets) into.cfSheets = [...new Set([...(into.cfSheets ?? []), ...p.cfSheets])];
  for (const g of p.merges ?? []) {
    into.merges = (into.merges ?? []).filter((x) => x.sheet !== g.sheet);
    into.merges.push({ sheet: g.sheet, merges: g.merges.map((m) => ({ ...m })) });
  }
  into.structural.push(...p.structural);
  for (const key of ["cells", "cols", "rows"] as const) {
    for (const g of p[key]) {
      const target = (into[key] as { sheet: number; [k: string]: unknown }[]).find((x) => x.sheet === g.sheet);
      if (target) (target[key] as unknown[]).push(...((g as unknown as Record<string, unknown[]>)[key]));
      else (into[key] as unknown[]).push(JSON.parse(JSON.stringify(g)));
    }
  }
}

/** The delimiter characters of a delimited text split. */
function splitChars(o: TextImportOptions): string {
  const sp = o.split;
  if (sp.kind !== "delimited") return "";
  return (sp.tab ? "\t" : "") + (sp.semicolon ? ";" : "") + (sp.comma ? "," : "") + (sp.space ? " " : "") + (sp.other ?? "");
}

/** Toy expression parser (see the module comment). */
class Parser {
  private i = 0;
  constructor(
    private readonly src: string,
    private readonly ref: (row: number, col: number, sheet?: string) => Value,
    private readonly name: (name: string) => { sheet: string; r0: number; c0: number; r1: number; c1: number } | Value | undefined = () => undefined,
  ) {}

  /** A defined name at the cursor: its range or constant (`null`: not a name here). */
  private nameAt(): { sheet: string; r0: number; c0: number; r1: number; c1: number } | Value | null {
    const m = /^[A-Za-z_\\][A-Za-z0-9_.\\?]*/.exec(this.src.slice(this.i));
    if (!m || /^[(!]/.test(this.src.slice(this.i + m[0].length)) || /^\$?[A-Za-z]{1,3}\$?[0-9]+$/.test(m[0]) || /^(TRUE|FALSE)$/i.test(m[0])) return null;
    const hit = this.name(m[0]);
    if (hit === undefined) throw new Fail("#NAME?", "unknown name");
    this.i += m[0].length;
    return hit;
  }

  private rangeValues(t: { sheet: string; r0: number; c0: number; r1: number; c1: number }): Value[] {
    const out: Value[] = [];
    for (let r = t.r0; r <= t.r1; r++) for (let c = t.c0; c <= t.c1; c++) out.push(this.ref(r, c, t.sheet));
    return out;
  }

  parse(): Value {
    const v = this.concat();
    this.ws();
    if (this.i < this.src.length) throw new Fail("#NAME?", "trailing input");
    return v;
  }

  private ws(): void {
    while (this.src[this.i] === " ") this.i++;
  }

  private peek(): string {
    this.ws();
    return this.src[this.i] ?? "";
  }

  private num(v: Value): number {
    if (typeof v === "object") throw new Fail(v.error, "error");
    if (typeof v === "number") return v;
    if (typeof v === "boolean") return v ? 1 : 0;
    if (v === "") return 0;
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Fail("#VALUE!", "not a number");
    return n;
  }

  private concat(): Value {
    let v = this.additive();
    while (this.peek() === "&") {
      this.i++;
      const r = this.additive();
      if (typeof v === "object") return v;
      if (typeof r === "object") return r;
      v = `${typeof v === "number" ? formatNumber(v) : String(v)}${typeof r === "number" ? formatNumber(r) : String(r)}`;
    }
    return v;
  }

  private additive(): Value {
    let v = this.term();
    for (let op = this.peek(); op === "+" || op === "-"; op = this.peek()) {
      this.i++;
      const r = this.term();
      v = op === "+" ? this.num(v) + this.num(r) : this.num(v) - this.num(r);
    }
    return v;
  }

  private term(): Value {
    let v = this.unary();
    for (let op = this.peek(); op === "*" || op === "/"; op = this.peek()) {
      this.i++;
      const r = this.num(this.unary());
      if (op === "/" && r === 0) throw new Fail("#DIV/0!", "div0");
      v = op === "*" ? this.num(v) * r : this.num(v) / r;
    }
    return v;
  }

  private unary(): Value {
    if (this.peek() === "-") {
      this.i++;
      return -this.num(this.unary());
    }
    if (this.peek() === "+") {
      this.i++;
      return this.unary();
    }
    return this.primary();
  }

  private refAt(): { sheet?: string; r: number; c: number } | null {
    const m = /^(?:([A-Za-z_][A-Za-z0-9_]*)!)?\$?([A-Za-z]{1,3})\$?([0-9]+)/.exec(this.src.slice(this.i));
    if (!m || /^[A-Za-z0-9_(]/.test(this.src.slice(this.i + m[0].length))) return null;
    this.i += m[0].length;
    const letters = m[2].toUpperCase();
    let c = 0;
    for (const ch of letters) c = c * 26 + (ch.charCodeAt(0) - 64);
    return { sheet: m[1], r: Number(m[3]) - 1, c: c - 1 };
  }

  /** A function argument: a range expands to its values. */
  private arg(): Value[] {
    const save = this.i;
    this.ws();
    const a = this.refAt();
    if (a && this.src[this.i] === ":") {
      this.i++;
      const b = this.refAt();
      if (!b) throw new Fail("#NAME?", "bad range");
      const out: Value[] = [];
      for (let r = Math.min(a.r, b.r); r <= Math.max(a.r, b.r); r++) {
        for (let c = Math.min(a.c, b.c); c <= Math.max(a.c, b.c); c++) out.push(this.ref(r, c, a.sheet));
      }
      // Like Excel, text in ranges is ignored by the aggregate functions.
      return out.filter((v) => typeof v !== "string");
    }
    this.i = save;
    this.ws();
    const named = this.nameAt();
    if (named !== null && typeof named === "object" && "r0" in named && /^[,)]/.test(this.peek())) {
      return this.rangeValues(named).filter((v) => typeof v !== "string");
    }
    this.i = save;
    return [this.concat()];
  }

  private primary(): Value {
    const ch = this.peek();
    if (ch === "(") {
      this.i++;
      const v = this.concat();
      if (this.peek() !== ")") throw new Fail("#NAME?", "missing )");
      this.i++;
      return v;
    }
    if (ch === '"') {
      const end = this.src.indexOf('"', this.i + 1);
      if (end < 0) throw new Fail("#NAME?", "unterminated string");
      const s = this.src.slice(this.i + 1, end);
      this.i = end + 1;
      return s;
    }
    const num = /^[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?/.exec(this.src.slice(this.i));
    if (num) {
      this.i += num[0].length;
      return Number(num[0]);
    }
    const fn = /^([A-Za-z]+)\(/.exec(this.src.slice(this.i));
    if (fn) {
      this.i += fn[0].length;
      const args: Value[] = [];
      if (this.peek() !== ")") {
        for (;;) {
          args.push(...this.arg());
          if (this.peek() === ",") this.i++;
          else break;
        }
      }
      if (this.peek() !== ")") throw new Fail("#NAME?", "missing )");
      this.i++;
      for (const a of args) if (typeof a === "object") return a;
      const nums = args.filter((a) => a !== "").map((a) => this.num(a));
      switch (fn[1].toUpperCase()) {
        case "SUM":
          return nums.reduce((a, b) => a + b, 0);
        case "AVERAGE":
          if (nums.length === 0) throw new Fail("#DIV/0!", "div0");
          return nums.reduce((a, b) => a + b, 0) / nums.length;
        case "MIN":
          return nums.length ? Math.min(...nums) : 0;
        case "MAX":
          return nums.length ? Math.max(...nums) : 0;
        case "COUNT":
          return nums.length;
        default:
          throw new Fail("#NAME?", "unknown function");
      }
    }
    if (/^TRUE\b/i.test(this.src.slice(this.i))) {
      this.i += 4;
      return true;
    }
    if (/^FALSE\b/i.test(this.src.slice(this.i))) {
      this.i += 5;
      return false;
    }
    const r = this.refAt();
    if (r) return this.ref(r.r, r.c, r.sheet);
    const named = this.nameAt();
    if (named !== null) return typeof named === "object" && "r0" in named ? (this.rangeValues(named)[0] ?? "") : named;
    throw new Fail("#NAME?", "unexpected token");
  }
}

/** A `Backend` over [`FakeCalcCore`]; file dialogs are scripted for tests. */
export class FakeBackend implements Backend<Request, ResponseBody> {
  /** `"tauri"` makes the app behave as on the desktop. */
  kind: "tauri" | "wasm" = "wasm";
  /** What `openFile` returns next (`null` = cancelled). */
  nextOpen: OpenedFile | null = null;
  /** What `saveFile` returns (`false` = cancelled; a `SavedFile` = the desktop's chosen file). */
  saveResult: SaveResult = true;
  saved: { name: string; bytesBase64: string }[] = [];
  /** The options of every `saveFile` call. */
  saveOptions: SaveOptions[] = [];
  title = "";

  constructor(readonly core: FakeCalcCore = new FakeCalcCore()) {}

  async ping(): Promise<string> {
    return "Rusuite Calc (fake backend)";
  }

  async dispatch<T = ResponseBody>(request: Request): Promise<{ ok: T } | { err: { code: string; message: string } }> {
    // Round-trip through JSON like the real transports.
    const req = JSON.parse(JSON.stringify(request)) as Request;
    return JSON.parse(JSON.stringify(this.core.handle(req)));
  }

  async openFile(): Promise<OpenedFile | null> {
    return this.nextOpen;
  }

  async saveFile(name: string, bytesBase64: string, options: SaveOptions = {}): Promise<SaveResult> {
    this.saveOptions.push(options);
    if (this.saveResult) this.saved.push({ name, bytesBase64 });
    return this.saveResult;
  }

  async setTitle(title: string): Promise<void> {
    this.title = title;
  }

  /** Number of `print()` calls. */
  printed = 0;

  async print(): Promise<void> {
    this.printed++;
  }
}
