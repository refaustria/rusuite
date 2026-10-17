// Formulas › Calculation and the name tools (P9-C4): calculation options
// (Automatic / Automatic except for data tables / Manual, R1C1 reference
// style), Calculate Now (F9) / Calculate Sheet (Shift+F9), Apply Names,
// Paste Names (F3) and its Paste List.

import type { CalcOptions } from "../generated/CalcOptions";
import type { CalcState as CoreCalcState } from "../generated/CalcState";
import { normalize } from "../grid/Selection";
import type { CalcStore } from "../state/store";
import { fromR1C1, toR1C1 } from "./r1c1";

export const DEFAULT_CALC: CoreCalcState = { options: { mode: "automatic", fullCalcOnLoad: true, r1c1: false }, needsCalc: false };

export class CalcToolsController {
  constructor(private readonly store: CalcStore) {}

  /** The workbook's calculation state. */
  state(): CoreCalcState {
    return this.store.getState().info?.calc ?? DEFAULT_CALC;
  }

  options(): CalcOptions {
    return this.state().options;
  }

  /** Manual mode with cells awaiting recalculation ("Calculate" in the status bar). */
  needsCalc(): boolean {
    return this.state().needsCalc;
  }

  /** R1C1 reference style is on. */
  r1c1(): boolean {
    return this.options().r1c1;
  }

  setOptions(options: CalcOptions): Promise<boolean> {
    return this.store.applyChecked({ type: "setCalcOptions", options });
  }

  setMode(mode: CalcOptions["mode"]): Promise<boolean> {
    return this.setOptions({ ...this.options(), mode });
  }

  /** Calculate Now (F9). */
  calculateNow(): Promise<boolean> {
    return this.store.applyChecked({ type: "calculateNow" });
  }

  /** Calculate Sheet (Shift+F9). */
  calculateSheet(): Promise<boolean> {
    return this.store.applyChecked({ type: "calculateSheet", sheet: this.store.getState().activeSheet });
  }

  /** The edit text of a cell input in the current reference style. */
  displayInput(input: string, row: number, col: number): string {
    return this.r1c1() ? toR1C1(input, row, col) : input;
  }

  /** A typed entry as the A1 text the core stores (`null`: an R1C1 reference leaves the sheet). */
  storedInput(text: string, row: number, col: number): string | null {
    return this.r1c1() ? fromR1C1(text, row, col) : text;
  }

  /** Apply Names over the selection (a single cell: the whole sheet). */
  applyNames(names: string[], ignoreRelative: boolean): Promise<boolean> {
    const st = this.store.getState();
    const r = normalize(st.selection);
    return this.store.applyChecked({ type: "applyNames", sheet: st.activeSheet, ...r, names, ignoreRelative });
  }

  /** Paste Names › Paste List at the active cell. */
  pasteList(): Promise<boolean> {
    const st = this.store.getState();
    const a = this.store.activeAnchor();
    return this.store.applyChecked({ type: "pasteNameList", sheet: st.activeSheet, row: a.row, col: a.col });
  }

  /**
   * Paste Names › OK: inserts the name into the formula being edited, or
   * starts an entry `=Name` in the active cell.
   */
  pasteName(name: string): void {
    const edit = this.store.getState().edit;
    if (edit) this.store.insertIntoFormula(name);
    else {
      this.store.beginEdit(`=${name}`, "cell");
      this.store.focusEditor();
    }
  }

  /** The names Paste Names and Apply Names list: visible from the active sheet, not hidden, sorted. */
  pastableNames(): string[] {
    const st = this.store.getState();
    const names = (st.info?.names ?? []).filter((n) => !n.hidden && !n.builtin && (n.sheet === undefined || n.sheet === st.activeSheet));
    return [...new Set(names.map((n) => n.name))].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }
}
