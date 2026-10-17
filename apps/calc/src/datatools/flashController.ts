// Flash Fill in the Calc UI (P9-C2): Data › Flash Fill / Ctrl+E fills the
// active cell's column from the examples typed into it (one undo step,
// "Flash Fill changed N cells"); after a second example is entered the
// suggestions show greyed in the empty cells below and Enter accepts them
// (Esc or anything else dismisses). It lives on the store (`store.flash`).

import type { CalcStore } from "../state/store";
import { t } from "../i18n";
import { flashFill, textInput, type FlashRow } from "./flashFill";

export interface FlashPreview {
  sheet: number;
  col: number;
  cells: { row: number; input: string }[];
}

export class FlashController {
  preview: FlashPreview | null = null;
  /** Bumped by every new request: an older, slower answer is dropped. */
  private seq = 0;

  constructor(private readonly store: CalcStore) {}

  /** The rows Flash Fill reads for column `col` around `row`: the current region's rows, its other columns as sources. */
  async rows(sheet: number, row: number, col: number): Promise<FlashRow[] | null> {
    const store = this.store;
    // The region around the cell, widened to the left neighbour when the column is still empty.
    let region = store.currentRegion(row, col);
    if (region.c0 === region.c1 && col > 0) region = store.currentRegion(row, col - 1);
    if (col < region.c0 - 1 || col > region.c1 + 1) return null;
    const c0 = Math.min(region.c0, col);
    const c1 = Math.max(region.c1, col);
    if (c0 === c1) return null;
    await store.ensureRegion(sheet, region.r0, c0, region.r1, c1);
    const cells = store.cache(sheet).cells;
    const out: FlashRow[] = [];
    for (let r = region.r0; r <= region.r1; r++) {
      const sources: string[] = [];
      const numbers: (number | null)[] = [];
      for (let c = c0; c <= c1; c++) {
        if (c === col) continue;
        const v = cells.get(r)?.get(c);
        sources.push(v?.display ?? "");
        const n = v?.kind === "number" ? Number(v.input) : NaN;
        numbers.push(Number.isFinite(n) && v?.input.trim() ? n : null);
      }
      out.push({ row: r, sources, numbers, target: cells.get(r)?.get(col)?.display ?? "" });
    }
    return out;
  }

  private suggest(sheet: number, row: number, col: number) {
    return this.rows(sheet, row, col).then((rows) =>
      rows ? flashFill(rows, (value, code) => this.store.api.formatPreview(value, code)) : null,
    );
  }

  /** Data › Flash Fill (Ctrl+E) on the active cell's column. */
  async run(): Promise<void> {
    const store = this.store;
    this.dismiss();
    const sheet = store.getState().activeSheet;
    const a = store.activeAnchor();
    const found = await this.suggest(sheet, a.row, a.col);
    if (!found || found.cells.length === 0) {
      store.pushError(new Error(t("calc.flash.noPattern")));
      return;
    }
    await this.fill(sheet, a.col, found.cells);
  }

  private async fill(sheet: number, col: number, cells: { row: number; input: string }[]): Promise<void> {
    const ok = await this.store.applyChecked({ type: "flashFill", sheet, col, cells: cells.map((c) => ({ row: c.row, input: textInput(c.input) })) });
    if (ok) this.store.pushInfo(t("calc.flash.changed", { n: cells.length }));
  }

  /** After an entry was committed in `(row, col)`: greyed suggestions once two examples agree. */
  async maybePreview(sheet: number, row: number, col: number): Promise<void> {
    const id = ++this.seq;
    const rows = await this.rows(sheet, row, col);
    if (!rows || id !== this.seq) return;
    const examples = rows.filter((r) => r.target !== "");
    // A second example, and something left to fill below the first one.
    if (examples.length < 2 || !rows.some((r) => r.target === "" && r.row > examples[0]!.row && r.sources.some((s) => s !== ""))) return;
    const found = await flashFill(rows, (value, code) => this.store.api.formatPreview(value, code));
    if (id !== this.seq || !found || found.cells.length === 0) return;
    this.preview = { sheet, col, cells: found.cells.filter((c) => c.row > examples[0]!.row) };
    if (this.preview.cells.length === 0) this.preview = null;
    this.store.notify();
  }

  /** Enter while the suggestions show: fills them. */
  async accept(): Promise<void> {
    const p = this.preview;
    if (!p) return;
    this.preview = null;
    this.store.notify();
    await this.fill(p.sheet, p.col, p.cells);
  }

  dismiss(): void {
    this.seq++;
    if (!this.preview) return;
    this.preview = null;
    this.store.notify();
  }
}
