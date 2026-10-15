// Dev/test-only in-memory stand-in for the calc core's `dispatch`
// (`?fake=1` in dev builds, and the Vitest suites). It follows the wire
// contract of `calc_core::dispatch` closely enough for the grid, but its
// formula support is a toy: numbers, strings, cell refs, ranges in
// functions, + - * / & and SUM/AVERAGE/MIN/MAX/COUNT. The real engine
// lives in Rust (ADR 0001); nothing here is used in production builds.

import type { Backend, OpenedFile } from "@rusuite/ui-shared";
import type { CalcCommand } from "../generated/CalcCommand";
import type { CalcPatch } from "../generated/CalcPatch";
import type { CellKind } from "../generated/CellKind";
import type { CellStyle } from "../generated/CellStyle";
import type { CellView } from "../generated/CellView";
import type { ColView } from "../generated/ColView";
import type { Request } from "../generated/Request";
import type { Response } from "../generated/Response";
import type { ResponseBody } from "../generated/ResponseBody";
import type { RowView } from "../generated/RowView";
import type { SheetInfo } from "../generated/SheetInfo";

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
  revision = 0;
  undoStack: CalcCommand[] = [];
  redoStack: CalcCommand[] = [];
  savedRevision = 0;
  /** File name of the open document (`null` = new). */
  name: string | null = null;
  /** Every request seen, for tests. */
  log: Request[] = [];

  /** `sheetNames`: the sheets of a new document (default one, "Sheet1"). */
  constructor(private readonly sheetNames: string[] = ["Sheet1"]) {
    this.reset();
  }

  reset(): void {
    this.name = null;
    this.sheets = this.sheetNames.map((name, id) => this.newSheet(id, name));
    this.styles = [{}];
    this.undoStack = [];
    this.redoStack = [];
    this.revision++;
    this.savedRevision = this.revision;
  }

  private newSheet(id: number, name: string): FakeSheet {
    return { id, name, cells: new Map(), cols: new Map(), rows: new Map(), formulas: new Set() };
  }

  private sheet(id: number): FakeSheet {
    const s = this.sheets.find((x) => x.id === id);
    if (!s) throw new Fail("unknown_sheet", `unknown sheet ${id}`);
    return s;
  }

  private sheetInfos(): SheetInfo[] {
    return this.sheets.map(({ id, name }) => ({ id, name }));
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
        return new Parser(input.slice(1), (rr, cc, sh) => this.value(sh ? this.sheetByName(sh) : s, rr, cc, depth + 1)).parse();
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
    return { row: r, col: c, input: this.cell(s, r, c)?.input ?? "", display, kind, style: this.effectiveStyle(s, r, c) };
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

  /** Applies a command; returns `[patch, inverse]`. */
  exec(cmd: CalcCommand): [CalcPatch, CalcCommand | null] {
    switch (cmd.type) {
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
      case "addSheet": {
        if (this.sheets.some((s) => s.name.toLowerCase() === cmd.name.toLowerCase())) throw new Fail("duplicate_sheet", `sheet ${cmd.name} exists`);
        this.sheets.push(this.newSheet(Math.max(...this.sheets.map((s) => s.id)) + 1, cmd.name));
        const patch = this.emptyPatch();
        patch.sheets = this.sheetInfos();
        return [patch, null];
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
        const patch = this.emptyPatch();
        patch.structural = [{ sheet: cmd.sheet, kind: cmd.type, at: cmd.at, count: cmd.count }];
        const inverse: CalcCommand = { ...cmd, type: (ins ? "delete" : "insert") + (rowsAxis ? "Rows" : "Cols") } as CalcCommand;
        return [patch, inverse];
      }
    }
  }

  private intern(style: CellStyle): number {
    const key = JSON.stringify(style);
    const i = this.styles.findIndex((s) => JSON.stringify(s) === key);
    if (i >= 0) return i;
    this.styles.push(style);
    return this.styles.length - 1;
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
    return { ok: { type: "info", info: { sheets: this.sheetInfos(), styles: [...this.styles], revision: this.revision } } };
  }

  handle(req: Request): Response {
    this.log.push(req);
    try {
      switch (req.type) {
        case "apply": {
          const [patch, inv] = this.exec(req.command);
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
          const [patch, inv] = this.exec(cmd);
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
          cells.sort((a, b) => a.row - b.row || a.col - b.col);
          return {
            ok: {
              type: "snapshot",
              snapshot: {
                ...req,
                cells,
                cols: [...s.cols.values()].filter((c) => c.col >= req.c0 && c.col <= req.c1),
                rows: [...s.rows.values()].filter((r) => r.row >= req.r0 && r.row <= req.r1),
                format: { defaultColWidth: 8.43, defaultRowHeight: 15 },
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
              info: "ok" in info && info.ok.type === "info" ? info.ok.info : { sheets: [], styles: [], revision: this.revision },
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

function mergePatch(into: CalcPatch, p: CalcPatch): void {
  if (p.sheets) into.sheets = p.sheets;
  if (p.styles) into.styles = p.styles;
  if (p.cycle) into.cycle = p.cycle;
  into.structural.push(...p.structural);
  for (const key of ["cells", "cols", "rows"] as const) {
    for (const g of p[key]) {
      const target = (into[key] as { sheet: number; [k: string]: unknown }[]).find((x) => x.sheet === g.sheet);
      if (target) (target[key] as unknown[]).push(...((g as unknown as Record<string, unknown[]>)[key]));
      else (into[key] as unknown[]).push(JSON.parse(JSON.stringify(g)));
    }
  }
}

/** Toy expression parser (see the module comment). */
class Parser {
  private i = 0;
  constructor(
    private readonly src: string,
    private readonly ref: (row: number, col: number, sheet?: string) => Value,
  ) {}

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
    throw new Fail("#NAME?", "unexpected token");
  }
}

/** A `Backend` over [`FakeCalcCore`]; file dialogs are scripted for tests. */
export class FakeBackend implements Backend<Request, ResponseBody> {
  readonly kind = "wasm" as const;
  /** What `openFile` returns next (`null` = cancelled). */
  nextOpen: OpenedFile | null = null;
  /** What `saveFile` returns (`false` = cancelled). */
  saveResult = true;
  saved: { name: string; bytesBase64: string }[] = [];
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

  async saveFile(name: string, bytesBase64: string): Promise<boolean> {
    if (this.saveResult) this.saved.push({ name, bytesBase64 });
    return this.saveResult;
  }

  async setTitle(title: string): Promise<void> {
    this.title = title;
  }
}
