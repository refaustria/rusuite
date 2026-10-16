// P8-37: Calc's AI context (selected values as TSV, formulas, the active cell) and how results are applied
// (validated formulas, a 2-D range as one compound command).
import { describe, expect, it } from "vitest";
import { CalcApi } from "../backend/calcApi";
import { FakeBackend, FakeCalcCore } from "../dev/fakeBackend";
import { CalcStore } from "../state/store";
import { calcAiAdapter, invalidFormulas, parseAddress, writeCommands } from "./calcAi";

async function readyStore() {
  const core = new FakeCalcCore();
  const store = new CalcStore(new CalcApi(new FakeBackend(core)));
  await store.init();
  return { store, core };
}

describe("Calc AI", () => {
  it("addresses", () => {
    expect(parseAddress("b2")).toEqual({ r0: 1, c0: 1, r1: 1, c1: 1 });
    expect(parseAddress("$A$1:C3")).toEqual({ r0: 0, c0: 0, r1: 2, c1: 2 });
    expect(parseAddress("nope")).toBeNull();
  });

  it("a range result becomes setInput commands from the destination; invalid formulas are found", () => {
    expect(writeCommands(0, 1, 1, [["a", "=B1"], ["2"]])).toEqual([
      { type: "setInput", sheet: 0, row: 1, col: 1, input: "a" },
      { type: "setInput", sheet: 0, row: 1, col: 2, input: "=B1" },
      { type: "setInput", sheet: 0, row: 2, col: 1, input: "2" },
    ]);
    expect(invalidFormulas([["=SUM(A1", "=A1+1", "text"]], 0, 0)).toHaveLength(1);
    expect(invalidFormulas([["=SUM(A1", "x"]], 4, 2)[0]).toMatch(/^C5: /);
  });

  it("context: the selection's values and formulas, the active cell; the workbook only on request", async () => {
    const { store } = await readyStore();
    await store.apply({ type: "setInput", sheet: 0, row: 0, col: 0, input: "Qty" });
    await store.apply({ type: "setInput", sheet: 0, row: 1, col: 0, input: "2" });
    await store.apply({ type: "setInput", sheet: 0, row: 2, col: 0, input: "=A2*2" });
    store.select({ anchor: { row: 0, col: 0 }, focus: { row: 2, col: 0 } });
    const ai = calcAiAdapter(store);
    expect(ai.selectionLabel()).toBe("Sheet1!A1:A3");
    expect(ai.hasSelection()).toBe(true);
    const ctx = await ai.context(false);
    expect(ctx.selection.split("\n")[0]).toBe("Qty");
    expect(ctx.facts?.join("\n")).toContain("A3: =A2*2");
    expect(ctx.facts?.[0]).toBe("Active cell: Sheet1!A1");
    expect(ctx.document).toBeUndefined();
    expect((await ai.context(true)).document).toContain("Sheet Sheet1 (A1:A3)");
  });

  it("Explain is unavailable without a formula; Insert formula is disabled for an invalid one", async () => {
    const { store } = await readyStore();
    const ai = calcAiAdapter(store);
    const explain = ai.actions().find((a) => a.id === "explain")!;
    expect(explain.unavailable?.()).toBeTruthy();
    const formula = ai.actions().find((a) => a.id === "formula")!;
    const bad = formula.parse!({ formula: "=SUM(A1:A3", explanation: "" }) as { error: string | null };
    expect(bad.error).toBeTruthy();
    expect(formula.apply[0]!.disabled?.(bad)).toBeTruthy();
    const ok = formula.parse!({ formula: "SUM(A1:A3)", explanation: "" }) as { formula: string; error: string | null };
    expect(ok).toMatchObject({ formula: "=SUM(A1:A3)", error: null });
  });

  it("Transform applies one compound command at the destination", async () => {
    const { store, core } = await readyStore();
    store.select({ anchor: { row: 0, col: 0 }, focus: { row: 0, col: 0 } });
    const ai = calcAiAdapter(store);
    const transform = ai.actions().find((a) => a.id === "transform")!;
    const value = transform.parse!({ values: [["First", "Last"], ["Ann", "Lee"]], explanation: "" }) as { dest: { text: string } };
    value.dest.text = "C3";
    core.log.length = 0;
    const turn = { anchor: ai.anchor!() } as never;
    expect(await transform.apply[0]!.run(value, turn)).toBe("Written to C3:D4.");
    const applies = core.log.filter((r) => r.type === "apply");
    expect(applies).toHaveLength(1);
    expect(JSON.stringify(applies[0])).toContain('"type":"compound"');
    expect(store.getState().selection).toMatchObject({ anchor: { row: 2, col: 2 }, focus: { row: 3, col: 3 } });
  });
});
