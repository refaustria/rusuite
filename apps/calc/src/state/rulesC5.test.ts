// P9-C5: rule management in the store – the Format Painter (formats,
// conditional formatting and validation in one undo step), own pastes
// carrying the rules, Clear Rules scopes.
import { describe, expect, it } from "vitest";
import { CalcApi } from "../backend/calcApi";
import { FakeBackend, FakeCalcCore } from "../dev/fakeBackend";
import type { Request } from "../generated/Request";
import { CalcStore, formatPainterCommand } from "./store";

async function readyStore() {
  const core = new FakeCalcCore();
  const store = new CalcStore(new CalcApi(new FakeBackend(core)));
  await store.init();
  core.log.length = 0;
  return { store, core };
}
const applied = (log: Request[]) => log.flatMap((r) => (r.type === "apply" ? [r.command] : []));
const cell = (row: number, col: number) => ({ anchor: { row, col }, focus: { row, col } });

describe("Format Painter", () => {
  it("builds one compound: formats with the conditional formats, then the validation", () => {
    const clip = { sheet: 0, range: { r0: 0, c0: 0, r1: 1, c1: 0 }, cells: [], cut: false, tsv: "" };
    const cmd = formatPainterCommand(0, clip, { r0: 4, c0: 2, repeatRows: 2, repeatCols: 1 });
    expect(cmd).toMatchObject({
      type: "compound",
      commands: [
        { type: "pasteRange", mode: "formatsOnly", annotations: true, r0: 4, c0: 2, repeatRows: 2, src: { sheet: 0, r0: 0, c0: 0, r1: 1, c1: 0 } },
        { type: "pasteRange", mode: "all", special: { parts: "validation" }, annotations: true },
      ],
    });
  });

  it("paints the next selection once; a sticky painter stays on until stopped", async () => {
    const { store, core } = await readyStore();
    store.select(cell(0, 0));
    store.startFormatPainter();
    expect(store.getState().painter).toEqual({ sticky: false });
    store.select({ anchor: { row: 2, col: 1 }, focus: { row: 3, col: 1 } });
    await store.selectionDone();
    const [cmd] = applied(core.log);
    expect(cmd).toMatchObject({ type: "compound", commands: [{ mode: "formatsOnly", r0: 2, c0: 1, repeatRows: 2 }, { special: { parts: "validation" } }] });
    expect(store.getState().painter).toBeNull();
    // Nothing more without the painter.
    await store.selectionDone();
    expect(applied(core.log)).toHaveLength(1);
    store.select(cell(0, 0));
    store.startFormatPainter(true);
    store.select(cell(5, 5));
    await store.selectionDone();
    store.select(cell(6, 6));
    await store.selectionDone();
    expect(applied(core.log)).toHaveLength(3);
    expect(store.getState().painter).toEqual({ sticky: true });
    store.stopFormatPainter();
    expect(store.getState().painter).toBeNull();
  });

  it("pastes of our own copy carry the rules (annotations: true) in every mode", async () => {
    const { store, core } = await readyStore();
    store.select(cell(0, 0));
    store.copy();
    store.select(cell(3, 3));
    await store.paste(undefined, "formatsOnly");
    expect(applied(core.log)[0]).toMatchObject({ type: "pasteRange", mode: "formatsOnly", annotations: true });
  });

  it("Clear Rules from This Table needs a table at the active cell", async () => {
    const { store, core } = await readyStore();
    expect(store.ruleScopeRange("table")).toBeNull();
    expect(store.ruleScopeRange("pivot")).toBeNull();
    await store.clearCf("table");
    expect(applied(core.log)).toHaveLength(0);
    await store.clearCf("selection");
    expect(applied(core.log)[0]).toMatchObject({ type: "clearCf", range: { r0: 0, c0: 0, r1: 0, c1: 0 } });
  });
});
