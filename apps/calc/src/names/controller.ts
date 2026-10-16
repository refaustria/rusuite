// Defined names on the store (`store.names`, P8-23): the list from
// `WorkbookInfo.names` / `CalcPatch.names`, the Name Box (navigate or
// define), Go To, the name commands and the Name Manager's rows.

import type { NameDef } from "../generated/NameDef";
import type { NameEdges } from "../generated/NameEdges";
import type { NameInfo } from "../generated/NameInfo";
import type { NameRow } from "../generated/NameRow";
import { normalize } from "../grid/Selection";
import { t } from "../i18n";
import type { CalcStore } from "../state/store";
import { findName, formulaNames, goToTarget, nameBoxNames, nameProblem, refersToText, resolveName } from "./names";

export class NamesController {
  /** The Name Manager's rows (with values), loaded on demand. */
  rows: NameRow[] = [];

  constructor(private readonly store: CalcStore) {}

  /** Every defined name (hidden ones included). */
  list(): NameInfo[] {
    return this.store.getState().info?.names ?? [];
  }

  /** The names of the Name Box dropdown on the active sheet. */
  boxNames(): NameInfo[] {
    return nameBoxNames(this.list(), this.store.getState().activeSheet);
  }

  /** The names a formula on the active (or edited) sheet can use. */
  formulaNames(): NameInfo[] {
    const st = this.store.getState();
    return formulaNames(this.list(), st.edit?.sheet ?? st.activeSheet);
  }

  /** The name a formula on `sheet` reaches with `name` (`qualifier`: `Sheet1!name`). */
  resolve(name: string, qualifier: string | null, sheet: number): NameInfo | undefined {
    if (qualifier === null) return resolveName(this.list(), name, sheet);
    const s = this.store.getState().info?.sheets.find((x) => x.name.toLowerCase() === qualifier.toLowerCase());
    return s ? resolveName(this.list(), name, s.id) : undefined;
  }

  /** The name the Name Box shows for the current selection: a visible name of exactly that range. */
  selectionName(): string | null {
    const st = this.store.getState();
    const r = normalize(st.selection);
    const hit = (n: NameInfo) =>
      !n.hidden && n.range?.sheet === st.activeSheet && n.range.r0 === r.r0 && n.range.c0 === r.c0 && n.range.r1 === r.r1 && n.range.c1 === r.c1;
    const names = this.list();
    return (names.find((n) => n.sheet === st.activeSheet && hit(n)) ?? names.find((n) => n.sheet === undefined && hit(n)))?.name ?? null;
  }

  /** Selects what `text` names (a name or a reference); `false` when it names nothing. */
  goTo(text: string): boolean {
    const st = this.store.getState();
    const target = goToTarget(text, this.list(), st.info?.sheets ?? [], st.activeSheet);
    if (!target) return false;
    this.store.goToRange(target.sheet, target.range);
    return true;
  }

  /**
   * The Name Box's Enter: navigates to a name or reference; any other
   * valid name is defined (workbook scope) for the selection, as in Excel.
   */
  async boxEnter(text: string): Promise<boolean> {
    const name = text.trim();
    if (name === "") return false;
    if (this.goTo(name)) return true;
    const problem = nameProblem(name);
    if (problem) {
      this.store.pushError(new Error(t(problem)));
      return false;
    }
    const st = this.store.getState();
    const sheetName = st.info?.sheets.find((s) => s.id === st.activeSheet)?.name ?? "";
    return this.define({ name, refersTo: refersToText(sheetName, normalize(st.selection)) });
  }

  /** The Define Name dialog's default definition: the selection. */
  selectionRefersTo(): string {
    const st = this.store.getState();
    const sheetName = st.info?.sheets.find((s) => s.id === st.activeSheet)?.name ?? "";
    return refersToText(sheetName, normalize(st.selection));
  }

  async define(def: NameDef): Promise<boolean> {
    return this.store.applyChecked({ type: "defineName", def });
  }

  async update(name: string, sheet: number | undefined, def: NameDef): Promise<boolean> {
    return this.store.applyChecked({ type: "updateName", name, ...(sheet === undefined ? {} : { sheet }), def });
  }

  async remove(name: string, sheet: number | undefined): Promise<boolean> {
    return this.store.applyChecked({ type: "deleteName", name, ...(sheet === undefined ? {} : { sheet }) });
  }

  /** Create from Selection over the selection. */
  async createFromSelection(edges: NameEdges): Promise<boolean> {
    const st = this.store.getState();
    const r = normalize(st.selection);
    return this.store.applyChecked({ type: "createNamesFromSelection", sheet: st.activeSheet, ...r, edges });
  }

  /** Reloads the Name Manager's rows (values evaluated on the active sheet). */
  async loadRows(): Promise<NameRow[]> {
    try {
      this.rows = await this.store.api.names(this.store.getState().activeSheet);
    } catch (e) {
      this.store.pushError(e);
      this.rows = [];
    }
    this.store.notify();
    return this.rows;
  }

  /** `true` when a name of that spelling exists in the scope (`except`: the edited name). */
  exists(name: string, sheet: number | undefined, except?: { name: string; sheet: number | undefined }): boolean {
    const hit = findName(this.list(), name, sheet);
    if (!hit) return false;
    return !(except && except.sheet === sheet && except.name.toLowerCase() === hit.name.toLowerCase());
  }
}

/**
 * Excel's Create Names from Selection defaults: a label row on top when
 * the first row is text over other cells, a label column on the left
 * likewise.
 */
export function guessEdges(cells: (row: number, col: number) => { kind: string } | undefined, r: { r0: number; c0: number; r1: number; c1: number }): NameEdges {
  const textRow = (row: number) => {
    for (let c = r.c0 + (r.c1 > r.c0 ? 1 : 0); c <= r.c1; c++) if (cells(row, c)?.kind !== "text") return false;
    return true;
  };
  const textCol = (col: number) => {
    for (let row = r.r0 + (r.r1 > r.r0 ? 1 : 0); row <= r.r1; row++) if (cells(row, col)?.kind !== "text") return false;
    return true;
  };
  return {
    top: r.r1 > r.r0 && textRow(r.r0),
    left: r.c1 > r.c0 && textCol(r.c0),
    bottom: false,
    right: false,
  };
}
