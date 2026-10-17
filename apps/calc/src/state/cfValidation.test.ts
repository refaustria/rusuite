// P8-13: conditional formatting results and data validation in the store,
// over the fake backend: the snapshot cache, the re-fetch on `cfSheets`,
// and the commit flows of Stop / Warning / Information alerts.
import { describe, expect, it } from "vitest";
import { waitFor } from "@testing-library/react";
import { CalcApi } from "../backend/calcApi";
import { FakeBackend, FakeCalcCore } from "../dev/fakeBackend";
import type { DataValidation } from "../generated/DataValidation";
import type { RegionSnapshot } from "../generated/RegionSnapshot";
import type { Request } from "../generated/Request";
import { cfKey } from "../grid/cf";
import { quickRule } from "../condFormat/presets";
import { applyCfSnapshot, CalcStore, emptyCache } from "./store";

async function readyStore() {
  const core = new FakeCalcCore();
  const store = new CalcStore(new CalcApi(new FakeBackend(core)));
  store.cfRefreshDelay = 5;
  await store.init();
  core.log.length = 0;
  return { store, core };
}
const applied = (log: Request[]) => log.flatMap((r) => (r.type === "apply" ? [r.command] : []));
const B2 = { r0: 1, c0: 1, r1: 1, c1: 1 };
const whole = (errorStyle: DataValidation["errorStyle"]): DataValidation => ({
  ranges: [B2], kind: { type: "whole", op: "between", f1: "1", f2: "9" }, allowBlank: true, showDropdown: false, showInput: true,
  showError: true, errorStyle, errorTitle: "Qty", errorMessage: "1 to 9 only",
});

async function typeInto(store: CalcStore, row: number, col: number, text: string) {
  store.select({ anchor: { row, col }, focus: { row, col } });
  store.beginEdit(text);
  return store.commitEdit(1, 0);
}

describe("conditional formatting in the cache", () => {
  it("a snapshot replaces the results and validations of its region only", () => {
    const cache = emptyCache();
    cache.cf.set(cfKey(0, 0), { color: { kind: "auto" } });
    cache.cf.set(cfKey(100, 0), { icon: 1, iconSet: "3Arrows" });
    const old: DataValidation = { ...whole("stop"), ranges: [{ r0: 0, c0: 0, r1: 0, c1: 0 }] };
    const far: DataValidation = { ...whole("stop"), ranges: [{ r0: 200, c0: 0, r1: 200, c1: 0 }] };
    cache.validations = [old, far];
    const snap: RegionSnapshot = {
      sheet: 0, r0: 0, c0: 0, r1: 63, c1: 31, cells: [], cols: [], rows: [], format: { defaultColWidth: 8.43, defaultRowHeight: 15 },
      cf: [{ row: 2, col: 1, cf: { bar: { from: 0, to: 0.5, color: { kind: "auto" }, gradient: true } } }], validations: [whole("warning")],
    };
    applyCfSnapshot(cache, snap);
    expect([...cache.cf.keys()]).toEqual([cfKey(100, 0), cfKey(2, 1)]);
    expect(cache.validations).toEqual([far, whole("warning")]);
  });

  it("a patch with cfSheets re-fetches the active sheet's viewport (debounced) and the cache gets the results", async () => {
    const { store, core } = await readyStore();
    await typeInto(store, 0, 0, "7");
    await typeInto(store, 1, 0, "2");
    core.log.length = 0;
    await store.addCfRule(quickRule("greaterThan", ["5"], { bold: true }, [{ r0: 0, c0: 0, r1: 1, c1: 0 }]));
    expect(applied(core.log)[0]).toMatchObject({ type: "addCfRule", rule: { id: 0, priority: 1, kind: { type: "cellIs", op: "greaterThan", formulas: ["5"] } } });
    expect(core.log.some((r) => r.type === "snapshot")).toBe(false);
    await waitFor(() => expect(store.cache(0).cf.get(cfKey(0, 0))).toEqual({ dxf: { bold: true } }));
    expect(store.cache(0).cf.has(cfKey(1, 0))).toBe(false);
    // Typing re-evaluates: A2 = 9 now matches.
    await typeInto(store, 1, 0, "9");
    await waitFor(() => expect(store.cache(0).cf.get(cfKey(1, 0))).toEqual({ dxf: { bold: true } }));
  });

  it("other sheets only go stale; they reload when shown", async () => {
    const { store, core } = await readyStore();
    await store.addSheet();
    const second = store.getState().activeSheet;
    store.setActiveSheet(0);
    await store.ensureRegion(second, 0, 0, 10, 10);
    expect(store.cache(second).loaded.size).toBeGreaterThan(0);
    core.log.length = 0;
    await store.apply({ type: "addCfRule", sheet: second, rule: quickRule("lessThan", ["0"], {}, [B2]) });
    expect(store.cache(second).loaded.size).toBe(0);
  });

  it("clear rules from the selection / sheet and manager commands go through the store", async () => {
    const { store, core } = await readyStore();
    store.select({ anchor: { row: 1, col: 1 }, focus: { row: 2, col: 2 } });
    await store.clearCf("selection");
    await store.clearCf("sheet");
    await store.applyCfCommands([{ type: "removeCfRule", sheet: 0, id: 1 }]);
    expect(applied(core.log).slice(0, 2)).toEqual([
      { type: "clearCf", sheet: 0, range: { r0: 1, c0: 1, r1: 2, c1: 2 } },
      { type: "clearCf", sheet: 0, range: null },
    ]);
    // The unknown rule is refused by the core: a toast, nothing applied.
    expect(store.getState().toasts.length).toBe(1);
  });
});

describe("data validation on commit", () => {
  async function withValidation(style: DataValidation["errorStyle"]) {
    const ctx = await readyStore();
    await ctx.store.setValidation(whole(style));
    await waitFor(() => expect(ctx.store.validationAt(1, 1)).toBeDefined());
    ctx.core.log.length = 0;
    return ctx;
  }

  it("a value committed right after Data Validation OK is checked against the new rule; busy until it settled (P9-Q1)", async () => {
    const { store, core } = await readyStore();
    const busy: boolean[] = [];
    store.watchBusy((b) => busy.push(b));
    // The dialog closes at once; the rule's patch and the region re-fetch are still on their way.
    const ok = store.setValidation(whole("stop"));
    expect(store.busy()).toBe(true);
    expect(store.validationAt(1, 1)).toBeUndefined();
    expect(await typeInto(store, 1, 1, "42")).toBe(false);
    expect(store.getState().validationAlert).toMatchObject({ style: "stop", message: "1 to 9 only" });
    expect(applied(core.log).map((c) => c.type)).toEqual(["setValidation"]);
    await ok;
    await waitFor(() => expect(busy.at(-1)).toBe(false));
    expect(busy).toContain(true);
    expect(store.busy()).toBe(false);
  });

  it("a valid value is checked and committed", async () => {
    const { store, core } = await withValidation("stop");
    expect(await typeInto(store, 1, 1, "5")).toBe(true);
    expect(core.log.map((r) => r.type)).toEqual(["validateInput", "apply", ...core.log.slice(2).map((r) => r.type)]);
    expect(applied(core.log)[0]).toMatchObject({ type: "setInput", row: 1, col: 1, input: "5" });
    expect(store.getState().edit).toBeNull();
    expect(store.getState().selection.anchor).toEqual({ row: 2, col: 1 });
  });

  it("Stop: the alert shows, the edit stays open; Retry selects the text, Cancel discards it", async () => {
    const { store, core } = await withValidation("stop");
    expect(await typeInto(store, 1, 1, "42")).toBe(false);
    expect(store.getState().validationAlert).toEqual({ style: "stop", title: "Qty", message: "1 to 9 only", dRow: 1, dCol: 0 });
    expect(store.getState().edit?.text).toBe("42");
    // While the alert is up, another Enter does nothing.
    expect(await store.commitEdit(1, 0)).toBe(false);
    await store.answerValidation("retry");
    expect(store.getState().validationAlert).toBeNull();
    expect(store.getState().edit).toMatchObject({ text: "42", selStart: 0, selEnd: 2 });
    expect(await store.commitEdit(1, 0)).toBe(false);
    await store.answerValidation("cancel");
    expect(store.getState().edit).toBeNull();
    expect(applied(core.log)).toEqual([]);
  });

  it("Stop never accepts the value", async () => {
    const { store, core } = await withValidation("stop");
    await typeInto(store, 1, 1, "0");
    await store.answerValidation("accept");
    expect(store.getState().edit?.text).toBe("0");
    expect(applied(core.log)).toEqual([]);
  });

  it("Warning: Yes keeps the invalid value; No goes back to editing", async () => {
    const { store, core } = await withValidation("warning");
    await typeInto(store, 1, 1, "42");
    await store.answerValidation("retry");
    expect(store.getState().edit?.text).toBe("42");
    await store.commitEdit(1, 0);
    expect(store.getState().validationAlert?.style).toBe("warning");
    expect(await store.answerValidation("accept")).toBe(true);
    expect(applied(core.log)[0]).toMatchObject({ type: "setInput", input: "42" });
    expect(store.getState().edit).toBeNull();
  });

  it("Information: OK accepts, Cancel discards", async () => {
    const { store, core } = await withValidation("information");
    await typeInto(store, 1, 1, "x");
    await store.answerValidation("cancel");
    expect(store.getState().edit).toBeNull();
    expect(applied(core.log)).toEqual([]);
    await typeInto(store, 1, 1, "x");
    await store.answerValidation("accept");
    expect(applied(core.log)[0]).toMatchObject({ type: "setInput", input: "x" });
  });

  it("cells without validation commit without asking the core", async () => {
    const { store, core } = await withValidation("stop");
    await typeInto(store, 5, 5, "42");
    expect(core.log.some((r) => r.type === "validateInput")).toBe(false);
  });

  it("list values come from the core; a picked value becomes the cell's input", async () => {
    const { store, core } = await readyStore();
    await store.setValidation({ ...whole("stop"), kind: { type: "list", source: { type: "literal", values: ["pear", "fig"] } }, showDropdown: true });
    await waitFor(() => expect(store.validationAt(1, 1)).toBeDefined());
    store.select({ anchor: { row: 1, col: 1 }, focus: { row: 1, col: 1 } });
    expect(await store.listValues()).toEqual(["pear", "fig"]);
    core.log.length = 0;
    await store.pickListValue("fig");
    expect(applied(core.log)).toEqual([{ type: "setInput", sheet: 0, row: 1, col: 1, input: "fig" }]);
    await store.removeValidation();
    expect(applied(core.log)[1]).toEqual({ type: "removeValidation", sheet: 0, range: B2 });
  });
});
