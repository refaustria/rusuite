// P8-12: the store's dynamic-array rules (spilled cells are refused by
// paste / fill / sort, Delete goes through the formula cell, typing
// blocks the spill) on cells injected as the core would send them.
import { describe, expect, it } from "vitest";
import { CalcApi } from "../backend/calcApi";
import { FakeBackend, FakeCalcCore } from "../dev/fakeBackend";
import type { CalcPatch } from "../generated/CalcPatch";
import type { CellView } from "../generated/CellView";
import type { Request } from "../generated/Request";
import { cellSelection } from "../grid/Selection";
import { CalcStore } from "./store";

const patch = (cells: CellView[]): CalcPatch => ({
  sheets: null, cells: [{ sheet: 0, cells }], cols: [], rows: [], styles: null, cycle: null, structural: [],
});

/** `=SEQUENCE(3)` in A1 spilling into A1:A3, and "x" in C1. */
const seqCells = (): CellView[] => [
  { row: 0, col: 0, input: "=SEQUENCE(3)", display: "1", kind: "number", style: 0, spill: { r0: 0, c0: 0, r1: 2, c1: 0 } },
  { row: 1, col: 0, input: "", display: "2", kind: "number", style: 0, spilled: [0, 0] },
  { row: 2, col: 0, input: "", display: "3", kind: "number", style: 0, spilled: [0, 0] },
  { row: 0, col: 2, input: "x", display: "x", kind: "text", style: 0 },
];

async function spillStore() {
  const core = new FakeCalcCore();
  const store = new CalcStore(new CalcApi(new FakeBackend(core)));
  await store.init();
  store.applyPatch(patch(seqCells()));
  core.log.length = 0;
  return { store, core };
}

const applied = (log: Request[]) => log.flatMap((r) => (r.type === "apply" ? [r.command] : []));
const toasts = (store: CalcStore) => store.getState().toasts.map((t) => t.message);
const ARRAY = "You can't change part of an array.";
const sel = (store: CalcStore, r0: number, c0: number, r1 = r0, c1 = c0) => store.select({ anchor: { row: r0, col: c0 }, focus: { row: r1, col: c1 } });

describe("spill ranges in the store", () => {
  it("a spilled cell shows its array formula in the formula bar; the outline covers the spill", async () => {
    const { store } = await spillStore();
    sel(store, 2, 0);
    expect(store.ghostFormula()).toEqual({ input: "=SEQUENCE(3)", anchor: { row: 0, col: 0 } });
    expect(store.activeSpill()).toEqual({ anchor: { row: 0, col: 0 }, range: { r0: 0, c0: 0, r1: 2, c1: 0 }, blocked: false });
    sel(store, 0, 0);
    expect(store.ghostFormula()).toBeNull();
    expect(store.activeSpill()?.range).toEqual({ r0: 0, c0: 0, r1: 2, c1: 0 });
    sel(store, 4, 4);
    expect(store.activeSpill()).toBeNull();
  });

  it("typing into a spilled cell is allowed (it blocks the spill); F2 starts empty", async () => {
    const { store, core } = await spillStore();
    sel(store, 1, 0);
    store.beginEdit(null);
    expect(store.getState().edit?.text).toBe("");
    store.beginEdit("5");
    await store.commitEdit(1, 0);
    expect(applied(core.log)[0]).toMatchObject({ type: "setInput", row: 1, col: 0, input: "5" });
    expect(toasts(store)).toEqual([]);
  });

  it("paste over spilled cells is refused with Excel's message", async () => {
    const { store, core } = await spillStore();
    sel(store, 1, 0);
    await store.paste("a\nb");
    expect(applied(core.log)).toEqual([]);
    expect(toasts(store)).toEqual([ARRAY]);
  });

  it("paste over the formula cell and its whole spill is allowed", async () => {
    const { store, core } = await spillStore();
    sel(store, 0, 0);
    await store.paste("a\nb\nc");
    expect(applied(core.log)[0]).toMatchObject({ type: "pasteRange", r0: 0, c0: 0 });
    expect(toasts(store)).toEqual([]);
  });

  it("the fill handle and Ctrl+D refuse to fill over spilled cells", async () => {
    const { store, core } = await spillStore();
    store.applyPatch(patch([{ row: 0, col: 1, input: "7", display: "7", kind: "number", style: 0 }]));
    sel(store, 0, 1);
    await store.fill({ r0: 0, c0: 0, r1: 0, c1: 0 });
    sel(store, 0, 3);
    await store.fill({ r0: 1, c0: 3, r1: 3, c1: 3 });
    sel(store, 0, 0, 2, 0);
    await store.fillCopy("down");
    const cmds = applied(core.log);
    // Over the formula cell: fine (it replaces the spill); into the spill (Ctrl+D below A1): refused.
    expect(cmds.map((c) => c.type)).toEqual(["fillRange", "fillRange"]);
    expect(toasts(store)).toEqual([ARRAY]);
  });

  it("sorting a range or region with spilled cells is refused", async () => {
    const { store, core } = await spillStore();
    sel(store, 0, 0, 2, 0);
    await store.sortSelection(true);
    sel(store, 1, 0);
    await store.sortSelection(false);
    expect(applied(core.log)).toEqual([]);
    expect(toasts(store)).toEqual([ARRAY]);
  });

  it("Delete on the formula cell clears it (the whole spill goes); on spilled cells only, nothing happens", async () => {
    const { store, core } = await spillStore();
    sel(store, 1, 0, 2, 0);
    await store.clearSelection();
    expect(applied(core.log)).toEqual([]);
    sel(store, 0, 0);
    await store.clearSelection();
    expect(applied(core.log)).toEqual([{ type: "clearRange", sheet: 0, r0: 0, c0: 0, r1: 0, c1: 0 }]);
  });

  it("copying spilled cells copies their values; with the formula cell they paste blank (it spills again)", async () => {
    const { store, core } = await spillStore();
    sel(store, 1, 0, 2, 0);
    expect(store.copy()).toBe("2\n3");
    sel(store, 0, 5);
    await store.paste();
    expect(applied(core.log)[0]).toMatchObject({ type: "pasteRange", cells: [{ dr: 0, dc: 0, input: "2" }, { dr: 1, dc: 0, input: "3" }] });
    core.log.length = 0;
    sel(store, 0, 0, 2, 0);
    store.copy();
    sel(store, 0, 6);
    await store.paste(undefined, "all");
    await store.paste(undefined, "valuesOnly");
    const [all, values] = applied(core.log);
    expect(all).toMatchObject({ type: "pasteRange", cells: [{ dr: 0, dc: 0, input: "=SEQUENCE(3)" }] });
    expect(values).toMatchObject({ cells: [{ input: "=SEQUENCE(3)" }, { input: "2" }, { input: "3" }] });
  });

  it("cutting spilled cells away from their formula is refused at paste", async () => {
    const { store, core } = await spillStore();
    sel(store, 1, 0);
    store.copy(true);
    sel(store, 5, 5);
    await store.paste();
    expect(applied(core.log)).toEqual([]);
    expect(toasts(store)).toEqual([ARRAY]);
  });

  it("A1# in an edited formula outlines the whole spill range", async () => {
    const { store } = await spillStore();
    sel(store, 5, 5);
    store.beginEdit("=SUM(A1#)+A1");
    expect(store.editRefs().map((r) => r.range)).toEqual([{ r0: 0, c0: 0, r1: 2, c1: 0 }, { r0: 0, c0: 0, r1: 0, c1: 0 }]);
  });

  it("spilled cells count as data: the used range, Ctrl+↓ and the current region", async () => {
    const { store } = await spillStore();
    expect(store.usedExtent(0).lastRow).toBe(2);
    expect(store.navContext(10).isFilled(2, 0)).toBe(true);
    expect(store.currentRegion(1, 0)).toEqual({ r0: 0, c0: 0, r1: 2, c1: 0 });
  });

  it("a blocked spill: the outline turns red and 'Select obstructing cells' selects the blocking cells", async () => {
    const { store } = await spillStore();
    store.applyPatch(patch([
      { row: 0, col: 0, input: "=SEQUENCE(3)", display: "#SPILL!", kind: "error", style: 0, spill: { r0: 0, c0: 0, r1: 2, c1: 0 } },
      { row: 1, col: 0, input: "x", display: "x", kind: "text", style: 0 },
      { row: 2, col: 0, input: "", display: "", kind: "empty", style: 0 },
    ]));
    store.select(cellSelection(0, 0));
    expect(store.activeSpill()?.blocked).toBe(true);
    expect(store.selectObstructing()).toBe(true);
    expect(store.getState().selection).toEqual(cellSelection(1, 0));
    expect(store.activeSpill()?.blocked).toBe(true);
  });
});
