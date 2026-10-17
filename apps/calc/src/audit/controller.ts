// Formula Auditing on the store (P9-C4, `store.audit`): background error
// checking (the green triangles, the cell's error menu and the Error
// Checking dialog), Evaluate Formula's frames and the Watch Window.

import type { CalcPatch } from "../generated/CalcPatch";
import type { ErrorIssue } from "../generated/ErrorIssue";
import type { ErrorRule } from "../generated/ErrorRule";
import type { Evaluation } from "../generated/Evaluation";
import type { WatchCell } from "../generated/WatchCell";
import type { WatchItem } from "../generated/WatchItem";
import { cellSelection, normalize } from "../grid/Selection";
import { t } from "../i18n";
import type { CalcStore } from "../state/store";

export const ALL_RULES: readonly ErrorRule[] = ["errorValue", "inconsistentFormula", "numberAsText", "emptyCellRefs", "unlockedFormula"];
/** Excel's defaults: every rule but "formulas referring to empty cells". */
export const DEFAULT_RULES: readonly ErrorRule[] = ["errorValue", "inconsistentFormula", "numberAsText", "unlockedFormula"];

const STORAGE = "rusuite.calc.errorChecking";
/** Watch Window: at most this many watches are added at once (Excel asks above 32 000; we keep it small). */
export const MAX_WATCHES = 100;

export interface ErrorSettings {
  /** File › Options › Formulas › Enable background error checking. */
  background: boolean;
  rules: ErrorRule[];
}

function loadSettings(): ErrorSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE) ?? "null") as Partial<ErrorSettings> | null;
    if (raw && Array.isArray(raw.rules)) {
      return { background: raw.background !== false, rules: raw.rules.filter((r): r is ErrorRule => ALL_RULES.includes(r as ErrorRule)) };
    }
  } catch {
    // Storage unavailable: the defaults.
  }
  return { background: true, rules: [...DEFAULT_RULES] };
}

/** One Evaluate Formula frame: a cell, its evaluation and the step reached. */
export interface EvalFrame {
  sheet: number;
  row: number;
  col: number;
  evaluation: Evaluation;
  /** Index of the next step; `steps.length` = done (the result shows). */
  index: number;
}

export class AuditController {
  settings: ErrorSettings = loadSettings();
  private issues = new Map<number, ErrorIssue[]>();
  /** Ignored issues of this session (`sheet:row:col:rule`). */
  private ignored = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  watches: WatchCell[] = [];
  watchItems: WatchItem[] = [];
  watchOpen = false;
  /** Evaluate Formula's frames (Step In pushes, Step Out pops). */
  frames: EvalFrame[] = [];

  constructor(private readonly store: CalcStore) {}

  private key(sheet: number, i: ErrorIssue): string {
    return `${sheet}:${i.row}:${i.col}:${i.rule}`;
  }

  /** The issues shown on `sheet` (ignored ones left out). */
  issuesOn(sheet: number): ErrorIssue[] {
    return (this.issues.get(sheet) ?? []).filter((i) => !this.ignored.has(this.key(sheet, i)));
  }

  /** The green triangles of `sheet` (none with background checking off). */
  marks(sheet: number): ErrorIssue[] {
    return this.settings.background ? this.issuesOn(sheet) : [];
  }

  issueAt(sheet: number, row: number, col: number): ErrorIssue | null {
    return this.issuesOn(sheet).find((i) => i.row === row && i.col === col) ?? null;
  }

  /** The active cell's issue (the error menu shows on it). */
  activeIssue(): ErrorIssue | null {
    if (!this.settings.background) return null;
    const st = this.store.getState();
    const a = st.selection.anchor;
    return this.issueAt(st.activeSheet, a.row, a.col);
  }

  /** Checks the active sheet again (and the watches) after a short pause. */
  schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.refresh();
      if (this.watches.length) void this.refreshWatches();
    }, 120);
  }

  /** The first snapshot of a sheet: check it once. */
  ensure(sheet: number): void {
    if (!this.issues.has(sheet)) {
      this.issues.set(sheet, []);
      void this.refresh(sheet);
    }
  }

  onPatch(patch: CalcPatch): void {
    if (patch.cells.length || patch.structural.length || patch.sheets || patch.cfSheets?.length) this.schedule();
  }

  async refresh(sheet = this.store.getState().activeSheet): Promise<void> {
    const issues = await this.store.api.errorChecks(sheet, this.settings.rules).catch(() => null);
    if (!issues) return;
    this.issues.set(sheet, issues);
    this.store.notify();
  }

  setSettings(settings: ErrorSettings): void {
    this.settings = { background: settings.background, rules: ALL_RULES.filter((r) => settings.rules.includes(r)) };
    try {
      localStorage.setItem(STORAGE, JSON.stringify(this.settings));
    } catch {
      // Not persisted: kept for the session.
    }
    void this.refresh();
  }

  /** Ignore Error: hidden for this session. */
  ignore(issue: ErrorIssue, sheet = this.store.getState().activeSheet): void {
    this.ignored.add(this.key(sheet, issue));
    this.store.notify();
  }

  /** Formulas › Error Checking: checks the sheet now, goes to the first flagged cell from the active one and opens the dialog. */
  async openErrorChecking(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.refresh();
    this.step(1, true);
    this.store.openDialog({ kind: "errorChecking" });
  }

  /** Error Checking's Next / Previous: the issue after (before) the active cell, row by row, wrapping. */
  step(dir: 1 | -1, fromCurrent = false): ErrorIssue | null {
    const st = this.store.getState();
    const list = this.issuesOn(st.activeSheet);
    if (list.length === 0) return null;
    const a = st.selection.anchor;
    const pos = (i: ErrorIssue) => i.row * 20000 + i.col;
    const here = a.row * 20000 + a.col;
    const pick =
      dir === 1
        ? list.find((i) => (fromCurrent ? pos(i) >= here : pos(i) > here)) ?? list[0]
        : [...list].reverse().find((i) => (fromCurrent ? pos(i) <= here : pos(i) < here)) ?? list[list.length - 1];
    this.store.select(cellSelection(pick.row, pick.col));
    return pick;
  }

  /** The rule's title and description as Excel words them. */
  describe(issue: ErrorIssue): { title: string; text: string } {
    return { title: t(`calc.err.${issue.rule}.title`), text: t(`calc.err.${issue.rule}.text`) };
  }

  /** Convert to Number on the active cell (or every flagged cell of the selection). */
  convertToNumber(): Promise<boolean> {
    const st = this.store.getState();
    const r = normalize(st.selection);
    return this.store.applyChecked({ type: "convertToNumber", sheet: st.activeSheet, cells: [r] });
  }

  /** Inconsistent formula › Copy Formula from Above/Left. */
  copySuggestion(issue: ErrorIssue): Promise<boolean> {
    if (!issue.suggestion) return Promise.resolve(false);
    const sheet = this.store.getState().activeSheet;
    return this.store.applyChecked({ type: "setInput", sheet, row: issue.row, col: issue.col, input: issue.suggestion });
  }

  /** Unlocked formula › Lock Cell. */
  lockCell(issue: ErrorIssue): Promise<boolean> {
    const sheet = this.store.getState().activeSheet;
    return this.store.applyChecked({ type: "applyStyle", sheet, r0: issue.row, c0: issue.col, r1: issue.row, c1: issue.col, patch: { protection: { locked: true } } });
  }

  // --- Evaluate Formula -------------------------------------------------------

  /** Opens Evaluate Formula on the active cell. */
  async evaluate(): Promise<void> {
    const st = this.store.getState();
    const a = this.store.activeAnchor();
    const evaluation = await this.store.api.evaluateFormula(st.activeSheet, a.row, a.col).catch((e: unknown) => {
      this.store.pushError(e);
      return null;
    });
    if (!evaluation) return;
    this.frames = [{ sheet: st.activeSheet, row: a.row, col: a.col, evaluation, index: 0 }];
    this.store.openDialog({ kind: "evaluateFormula" });
  }

  /** Evaluate (or Restart once done). */
  evalNext(): void {
    const f = this.frames[this.frames.length - 1];
    if (!f) return;
    f.index = f.index >= f.evaluation.steps.length ? 0 : f.index + 1;
    this.store.notify();
  }

  async stepIn(): Promise<void> {
    const f = this.frames[this.frames.length - 1];
    const target = f?.evaluation.steps[f.index]?.stepIn;
    if (!target) return;
    const evaluation = await this.store.api.evaluateFormula(target.sheet, target.r0, target.c0).catch(() => null);
    if (!evaluation) return;
    this.frames.push({ sheet: target.sheet, row: target.r0, col: target.c0, evaluation, index: 0 });
    this.store.notify();
  }

  /** Step Out: back to the formula that referred to the cell, its reference evaluated. */
  stepOut(): void {
    if (this.frames.length < 2) return;
    this.frames.pop();
    const f = this.frames[this.frames.length - 1]!;
    f.index = Math.min(f.index + 1, f.evaluation.steps.length);
    this.store.notify();
  }

  // --- Watch Window -----------------------------------------------------------

  toggleWatchWindow(open = !this.watchOpen): void {
    this.watchOpen = open;
    if (open) void this.refreshWatches();
    this.store.notify();
  }

  /** Add Watch: the cells of the selection. */
  addWatches(): void {
    const st = this.store.getState();
    const r = normalize(st.selection);
    const known = new Set(this.watches.map((w) => `${w.sheet}:${w.row}:${w.col}`));
    for (let row = r.r0; row <= r.r1 && this.watches.length < MAX_WATCHES; row++) {
      for (let col = r.c0; col <= r.c1 && this.watches.length < MAX_WATCHES; col++) {
        const k = `${st.activeSheet}:${row}:${col}`;
        if (known.has(k)) continue;
        known.add(k);
        this.watches.push({ sheet: st.activeSheet, row, col });
      }
    }
    void this.refreshWatches();
  }

  removeWatch(index: number): void {
    this.watches.splice(index, 1);
    this.watchItems.splice(index, 1);
    this.store.notify();
  }

  async refreshWatches(): Promise<void> {
    if (this.watches.length === 0) {
      this.watchItems = [];
      this.store.notify();
      return;
    }
    const items = await this.store.api.watchCells(this.watches).catch(() => null);
    if (!items) return;
    this.watchItems = items;
    this.store.notify();
  }
}
