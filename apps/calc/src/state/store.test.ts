import { describe, expect, it } from "vitest";
import type { Backend } from "@rusuite/ui-shared";
import { CalcApi } from "../backend/calcApi";
import { FakeBackend, FakeCalcCore } from "../dev/fakeBackend";
import type { CalcPatch } from "../generated/CalcPatch";
import type { CellView } from "../generated/CellView";
import type { Request } from "../generated/Request";
import { LAST_COL, LAST_ROW } from "../grid/Selection";
import { CalcStore, clipRange, emptyCache, MAX_RANGE_CELLS, parseTsv } from "./store";

const fileStubs = { openFile: async () => null, saveFile: async () => false, setTitle: async () => {}, print: async () => {} };

const cell = (row: number, col: number, input: string, style = 0): CellView => ({
  row, col, input, display: input, kind: input === "" ? "empty" : "text", style,
});

const patch = (p: Partial<CalcPatch>): CalcPatch => ({
  sheets: null, cells: [], cols: [], rows: [], styles: null, cycle: null, structural: [], ...p,
});

async function readyStore(core = new FakeCalcCore()) {
  const store = new CalcStore(new CalcApi(new FakeBackend(core)));
  await store.init();
  core.log.length = 0;
  return { store, core };
}

/** A backend whose snapshot replies resolve only when released. */
function gatedBackend() {
  const core = new FakeCalcCore();
  const gates: (() => void)[] = [];
  const sent: Request[] = [];
  const backend: Backend = {
    kind: "wasm",
    ping: async () => "",
    ...fileStubs,
    dispatch: async <T,>(req: unknown) => {
      const r = req as Request;
      sent.push(r);
      if (r.type === "snapshot") await new Promise<void>((res) => gates.push(res));
      return JSON.parse(JSON.stringify(core.handle(r))) as T;
    },
  };
  return { core, gates, sent, backend };
}

describe("store: patches", () => {
  it("merges cells, cols, rows, sheets and styles into the sparse cache", async () => {
    const { store } = await readyStore();
    store.applyPatch(patch({
      cells: [{ sheet: 0, cells: [cell(1, 2, "a"), cell(5, 0, "b", 1)] }],
      cols: [{ sheet: 0, cols: [{ col: 2, width: 20, hidden: false, style: null }] }],
      rows: [{ sheet: 0, rows: [{ row: 5, height: 30, hidden: false, style: null }] }],
      sheets: [{ id: 0, name: "Data" }],
      styles: [{}, { font: { bold: true } }],
      cycle: "Circular reference: Data!A1 → Data!A1",
    }));
    const c = store.cache(0);
    expect(c.cells.get(1)?.get(2)?.input).toBe("a");
    expect(c.cols.get(2)?.width).toBe(20);
    expect(c.rows.get(5)?.height).toBe(30);
    expect(store.getState().info?.sheets[0].name).toBe("Data");
    expect(store.styles()[1].font?.bold).toBe(true);
    expect(store.getState().cycle).toMatch(/Circular/);
    // A cleared, unstyled cell and a default column leave the cache.
    store.applyPatch(patch({
      cells: [{ sheet: 0, cells: [{ ...cell(1, 2, ""), kind: "empty" }] }],
      cols: [{ sheet: 0, cols: [{ col: 2, width: null, hidden: false, style: null }] }],
    }));
    expect(c.cells.has(1)).toBe(false);
    expect(c.cols.has(2)).toBe(false);
    expect(store.getState().cycle).toBeNull();
  });

  it("drops a sheet's cache on a structural patch and reloads its viewport", async () => {
    const { store, core } = await readyStore();
    await store.apply({ type: "setInput", sheet: 0, row: 3, col: 0, input: "x" });
    await store.ensureRegion(0, 0, 0, 10, 5);
    core.log.length = 0;
    await store.apply({ type: "insertRows", sheet: 0, at: 0, count: 2 });
    expect(store.cache(0).cells.size).toBe(0);
    expect(core.log.some((r) => r.type === "snapshot" && r.sheet === 0)).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(store.cache(0).cells.get(5)?.get(0)?.input).toBe("x");
  });

  it("discards envelopes older than the newest revision", async () => {
    const { store } = await readyStore();
    const rev = store.getState().revision;
    const applied = store.applyEnvelope({
      revision: rev - 1, canUndo: true, canRedo: false, dirty: true,
      patch: patch({ cells: [{ sheet: 0, cells: [cell(0, 0, "stale")] }] }),
    });
    expect(applied).toBe(false);
    expect(store.cache(0).cells.size).toBe(0);
  });

  it("surfaces backend errors as toasts", async () => {
    const { store } = await readyStore();
    await store.apply({ type: "renameSheet", sheet: 42, name: "x" });
    expect(store.getState().toasts[0].message).toMatch(/^unknown_sheet/);
  });
});

describe("store: ensureRegion", () => {
  it("requests 64×32 blocks once and de-duplicates in-flight requests", async () => {
    const { gates, sent, backend } = gatedBackend();
    const store = new CalcStore(new CalcApi(backend));
    const a = store.ensureRegion(0, 0, 0, 70, 40); // 2 × 2 blocks
    const b = store.ensureRegion(0, 10, 10, 20, 20); // inside block 0:0, in flight
    const snaps = sent.filter((r) => r.type === "snapshot");
    expect(snaps).toHaveLength(4);
    expect(snaps[0]).toEqual({ type: "snapshot", sheet: 0, r0: 0, c0: 0, r1: 63, c1: 31 });
    expect(snaps[3]).toEqual({ type: "snapshot", sheet: 0, r0: 64, c0: 32, r1: 127, c1: 63 });
    await new Promise((r) => setTimeout(r, 0));
    gates.forEach((g) => g());
    await Promise.all([a, b]);
    await store.ensureRegion(0, 0, 0, 70, 40);
    expect(sent.filter((r) => r.type === "snapshot")).toHaveLength(4);
  });

  it("re-requests a block whose snapshot raced with an edit", async () => {
    const { core, gates, sent, backend } = gatedBackend();
    const store = new CalcStore(new CalcApi(backend));
    const region = store.ensureRegion(0, 0, 0, 0, 0);
    await new Promise((r) => setTimeout(r, 0));
    // The edit is applied while the snapshot is pending.
    core.handle({ type: "apply", command: { type: "setInput", sheet: 0, row: 0, col: 0, input: "new" } });
    store.applyEnvelope({ revision: 5, canUndo: true, canRedo: false, dirty: true, patch: patch({}) });
    gates.shift()!();
    await new Promise((r) => setTimeout(r, 0));
    expect(sent.filter((r) => r.type === "snapshot")).toHaveLength(2);
    gates.shift()!();
    await region;
    expect(store.cache(0).cells.get(0)?.get(0)?.input).toBe("new");
  });
});

describe("store: failing snapshots", () => {
  it("does not retry a failed block on every frame and shows one toast", async () => {
    let calls = 0;
    const backend: Backend = {
      kind: "wasm",
      ping: async () => "",
      ...fileStubs,
    ...fileStubs,
      dispatch: async <T,>() => {
        calls++;
        return { err: { code: "internal", message: "boom" } } as T;
      },
    };
    const store = new CalcStore(new CalcApi(backend));
    await store.ensureRegion(0, 0, 0, 10, 10);
    await store.ensureRegion(0, 0, 0, 10, 10);
    await store.ensureRegion(0, 70, 0, 80, 10); // another block, same error
    expect(calls).toBe(2);
    expect(store.getState().toasts.map((t) => t.message)).toEqual(["internal: boom"]);
  });
});

describe("store: edits", () => {
  it("commits an edit as setInput and moves; an empty edit clears", async () => {
    const { store, core } = await readyStore();
    store.beginEdit("=1+2");
    await store.commitEdit(1, 0);
    expect(core.log[0]).toEqual({ type: "apply", command: { type: "setInput", sheet: 0, row: 0, col: 0, input: "=1+2" } });
    expect(store.getState().selection.anchor).toEqual({ row: 1, col: 0 });
    expect(store.cache(0).cells.get(0)?.get(0)?.display).toBe("3");
    store.select({ anchor: { row: 0, col: 0 }, focus: { row: 0, col: 0 } });
    store.beginEdit(null);
    expect(store.getState().edit?.text).toBe("=1+2");
    store.setEditText("");
    await store.commitEdit(0, 1);
    expect(core.log[1]).toEqual({ type: "apply", command: { type: "clearRange", sheet: 0, r0: 0, c0: 0, r1: 0, c1: 0 } });
  });

  it("copies the selection as TSV and pastes it as one compound of setInputs", async () => {
    const { store, core } = await readyStore();
    await store.paste("1\t=A1*2\nx\t\n");
    const cmd = core.log[0];
    expect(cmd.type === "apply" && cmd.command.type).toBe("compound");
    expect(store.cache(0).cells.get(0)?.get(1)?.display).toBe("2");
    expect(store.getState().selection.focus).toEqual({ row: 1, col: 1 });
    expect(store.copy()).toBe("1\t=A1*2\nx\t");
  });

  it("toggles bold from the active cell's style", async () => {
    const { store, core } = await readyStore();
    await store.toggleFont("bold");
    await store.toggleFont("bold");
    const cmds = core.log.flatMap((r) => (r.type === "apply" && r.command.type === "applyStyle" ? [r.command.patch] : []));
    expect(cmds).toEqual([{ font: { bold: true } }, { font: { bold: false } }]);
  });

  it("clips whole-sheet ranges for commands to the used range", () => {
    const cache = emptyCache();
    cache.cells.set(9, new Map([[3, cell(9, 3, "x")]]));
    expect(clipRange({ r0: 0, c0: 0, r1: LAST_ROW, c1: LAST_COL }, cache)).toEqual({ r0: 0, c0: 0, r1: 9, c1: 3 });
    const col = { r0: 0, c0: 2, r1: LAST_ROW, c1: 2 };
    expect(clipRange(col, cache)).toBe(col); // 1M cells is within the limit
    expect((LAST_ROW + 1) * 4).toBeLessThanOrEqual(MAX_RANGE_CELLS);
  });

  it("parses TSV", () => {
    expect(parseTsv("a\tb\r\nc\n")).toEqual([["a", "b"], ["c"]]);
    expect(parseTsv("x")).toEqual([["x"]]);
  });
});
