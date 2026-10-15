// P6-3 store actions against the fake backend: clipboard, fill, wrap row
// heights, find & replace, rows/columns.
import { describe, expect, it } from "vitest";
import { CalcApi } from "../backend/calcApi";
import { FakeBackend, FakeCalcCore } from "../dev/fakeBackend";
import type { CalcCommand } from "../generated/CalcCommand";
import type { Request } from "../generated/Request";
import { cellSelection } from "../grid/Selection";
import { CalcStore } from "./store";

async function ready(core = new FakeCalcCore()) {
  const store = new CalcStore(new CalcApi(new FakeBackend(core)));
  await store.init();
  core.log.length = 0;
  return { store, core };
}

const applied = (log: Request[]): CalcCommand[] => log.flatMap((r) => (r.type === "apply" ? [r.command] : []));

async function put(store: CalcStore, row: number, col: number, input: string) {
  await store.apply({ type: "setInput", sheet: 0, row, col, input });
}

const display = (store: CalcStore, row: number, col: number) => store.cache(0).cells.get(row)?.get(col)?.display ?? "";

describe("clipboard", () => {
  it("copy + paste sends the source block and shifts formulas; ants stay for another paste", async () => {
    const { store, core } = await ready();
    await put(store, 0, 0, "3");
    await put(store, 0, 1, "=A1*2");
    store.select(cellSelection(0, 1));
    expect(store.copy()).toBe("=A1*2");
    expect(store.getState().clipMark).toEqual({ sheet: 0, range: { r0: 0, c0: 1, r1: 0, c1: 1 }, cut: false });
    core.log.length = 0;
    store.select(cellSelection(2, 2));
    await store.paste("=A1*2");
    expect(applied(core.log)).toEqual([{
      type: "pasteRange", sheet: 0, r0: 2, c0: 2, src: { sheet: 0, r0: 0, c0: 1, r1: 0, c1: 1 },
      cells: [{ dr: 0, dc: 0, input: "=A1*2", style: 0 }], mode: "all", cut: false, repeatRows: 1, repeatCols: 1,
    }]);
    expect(store.cache(0).cells.get(2)?.get(2)?.input).toBe("=B3*2");
    expect(store.getState().clipMark).not.toBeNull();
  });

  it("paste repeats the block over a larger multiple selection and selects the result", async () => {
    const { store, core } = await ready();
    await put(store, 0, 0, "x");
    store.copy();
    store.select({ anchor: { row: 1, col: 0 }, focus: { row: 4, col: 1 } });
    await store.paste();
    const cmd = applied(core.log).slice(-1)[0]!;
    expect(cmd.type === "pasteRange" && [cmd.repeatRows, cmd.repeatCols]).toEqual([4, 2]);
    expect(store.getState().selection).toEqual({ anchor: { row: 1, col: 0 }, focus: { row: 4, col: 1 } });
    expect(display(store, 4, 1)).toBe("x");
  });

  it("cut + paste moves the cells once and ends copy mode", async () => {
    const { store, core } = await ready();
    await put(store, 0, 0, "moved");
    store.copy(true);
    store.select(cellSelection(3, 3));
    await store.paste();
    expect(applied(core.log).slice(-1)[0]).toMatchObject({ type: "pasteRange", cut: true, r0: 3, c0: 3 });
    expect(display(store, 3, 3)).toBe("moved");
    expect(display(store, 0, 0)).toBe("");
    expect(store.getState().clipMark).toBeNull();
    expect(store.hasClip()).toBe(false);
  });

  it("values-only paste, Esc and editing end copy mode", async () => {
    const { store, core } = await ready();
    await put(store, 0, 0, "1");
    store.copy();
    store.select(cellSelection(1, 0));
    await store.paste(undefined, "valuesOnly");
    expect(applied(core.log).slice(-1)[0]).toMatchObject({ type: "pasteRange", mode: "valuesOnly" });
    store.clearClip();
    expect(store.getState().clipMark).toBeNull();
    store.copy();
    store.beginEdit("2");
    expect(store.getState().clipMark).toBeNull();
    expect(store.hasClip()).toBe(false);
  });

  it("text from another program pastes as plain inputs (no styles, no shifting)", async () => {
    const { store, core } = await ready();
    await put(store, 0, 0, "1");
    store.copy();
    store.select(cellSelection(5, 0));
    await store.paste("=A1\tq");
    expect(applied(core.log).slice(-1)[0]).toMatchObject({
      type: "pasteRange", src: { sheet: 0, r0: 5, c0: 0, r1: 5, c1: 1 }, cells: [{ dr: 0, dc: 0, input: "=A1" }, { dr: 0, dc: 1, input: "q" }],
    });
  });
});

describe("fill handle", () => {
  it("fills a dragged range from the selection as one fillRange and selects both", async () => {
    const { store, core } = await ready();
    await put(store, 0, 0, "1");
    await put(store, 1, 0, "2");
    store.select({ anchor: { row: 0, col: 0 }, focus: { row: 1, col: 0 } });
    await store.fill({ r0: 2, c0: 0, r1: 9, c1: 0 });
    expect(applied(core.log).slice(-1)[0]).toEqual({
      type: "fillRange", sheet: 0, src: { r0: 0, c0: 0, r1: 1, c1: 0 }, dst: { r0: 2, c0: 0, r1: 9, c1: 0 }, mode: "auto",
    });
    expect(display(store, 9, 0)).toBe("10");
    expect(store.getState().selection).toEqual({ anchor: { row: 0, col: 0 }, focus: { row: 9, col: 0 } });
  });

  it("double-click on the handle fills down along the left column's data", async () => {
    const { store, core } = await ready();
    for (let r = 0; r < 5; r++) await put(store, r, 0, String(r));
    await put(store, 0, 1, "=A1*2");
    store.select(cellSelection(0, 1));
    await store.fillToData();
    expect(applied(core.log).slice(-1)[0]).toMatchObject({ type: "fillRange", dst: { r0: 1, c0: 1, r1: 4, c1: 1 } });
    expect(display(store, 4, 1)).toBe("8");
  });
});

describe("wrap text", () => {
  it("Alt+Enter text turns wrap on and grows the row in the same undo step", async () => {
    const { store, core } = await ready();
    store.beginEdit("a\nb");
    await store.commitEdit(1, 0);
    expect(applied(core.log)).toEqual([{
      type: "compound",
      commands: [
        { type: "setInput", sheet: 0, row: 0, col: 0, input: "a\nb" },
        { type: "applyStyle", sheet: 0, r0: 0, c0: 0, r1: 0, c1: 0, patch: { alignment: { wrapText: true } } },
        { type: "setRowHeight", sheet: 0, row: 0, height: 30 },
      ],
    }]);
    // Back to one line: the auto-grown row returns to the default height.
    store.select(cellSelection(0, 0));
    store.beginEdit("short");
    await store.commitEdit(1, 0);
    expect(applied(core.log).slice(-1)[0]).toMatchObject({ type: "compound", commands: [{ type: "setInput" }, { type: "setRowHeight", height: null }] });
  });

  it("wrap on a long text grows the row; rows with an explicit height are left alone", async () => {
    const { store, core } = await ready();
    await put(store, 0, 0, "word ".repeat(12).trim());
    await put(store, 1, 0, "word ".repeat(12).trim());
    await store.apply({ type: "setRowHeight", sheet: 0, row: 1, height: 18 });
    store.select({ anchor: { row: 0, col: 0 }, focus: { row: 1, col: 0 } });
    await store.toggleWrap();
    const cmd = applied(core.log).slice(-1)[0]!;
    expect(cmd.type).toBe("compound");
    const heights = cmd.type === "compound" ? cmd.commands.filter((c) => c.type === "setRowHeight") : [];
    expect(heights).toHaveLength(1);
    expect(heights[0]).toMatchObject({ row: 0 });
    expect((heights[0] as { height: number }).height).toBeGreaterThan(15);
  });
});

describe("find and replace", () => {
  async function doc() {
    const r = await ready(new FakeCalcCore(["Sheet1", "Sheet2"]));
    await put(r.store, 3, 1, "apple");
    await put(r.store, 0, 2, "Apple pie");
    await r.store.apply({ type: "setInput", sheet: 1, row: 0, col: 0, input: "APPLE" });
    return r;
  }
  const opts = { query: "apple", matchCase: false, wholeCell: false, allSheets: false };

  it("find next walks the matches row by row and wraps; workbook scope switches sheets", async () => {
    const { store } = await doc();
    expect(await store.findNext(opts)).toMatchObject({ row: 0, col: 2 });
    expect(await store.findNext(opts)).toMatchObject({ row: 3, col: 1 });
    expect(await store.findNext(opts)).toMatchObject({ row: 0, col: 2 });
    expect(await store.findNext(opts, true)).toMatchObject({ row: 3, col: 1 });
    expect(await store.findNext({ ...opts, allSheets: true })).toMatchObject({ sheet: 1 });
    expect(store.getState().activeSheet).toBe(1);
    expect(await store.findNext({ ...opts, query: "nothing" })).toBeNull();
  });

  it("replace all rewrites matching inputs in one compound", async () => {
    const { store, core } = await doc();
    core.log.length = 0;
    expect(await store.replaceAll({ ...opts, allSheets: true }, "pear")).toBe(3);
    expect(applied(core.log)).toEqual([{
      type: "compound",
      commands: [
        { type: "setInput", sheet: 0, row: 0, col: 2, input: "pear pie" },
        { type: "setInput", sheet: 0, row: 3, col: 1, input: "pear" },
        { type: "setInput", sheet: 1, row: 0, col: 0, input: "pear" },
      ],
    }]);
  });

  it("replace changes the active match and moves on", async () => {
    const { store } = await doc();
    store.select(cellSelection(3, 1));
    expect(await store.replaceNext({ ...opts, wholeCell: true }, "kiwi")).toBeNull();
    expect(display(store, 3, 1)).toBe("kiwi");
  });
});

describe("rows and columns", () => {
  it("hide/unhide, sizes and autofit go out as one step each", async () => {
    const { store, core } = await ready();
    store.measure = (t) => t.length * 7;
    await put(store, 0, 0, "x".repeat(20));
    await put(store, 0, 2, "yy");
    store.select({ anchor: { row: 0, col: 1 }, focus: { row: 0, col: 2 } });
    await store.setHidden("cols", true);
    expect(applied(core.log).slice(-1)[0]).toEqual({
      type: "compound",
      commands: [{ type: "setColHidden", sheet: 0, col: 1, hidden: true }, { type: "setColHidden", sheet: 0, col: 2, hidden: true }],
    });
    await store.setHidden("cols", false);
    expect(applied(core.log).slice(-1)[0]).toMatchObject({ type: "compound", commands: [{ col: 1, hidden: false }, { col: 2, hidden: false }] });
    await store.setSize("rows", 30);
    expect(applied(core.log).slice(-1)[0]).toEqual({ type: "setRowHeight", sheet: 0, row: 0, height: 30 });
    await store.autofitAllCols();
    expect(applied(core.log).slice(-1)[0]).toEqual({
      type: "compound",
      commands: [{ type: "setColWidth", sheet: 0, col: 0, width: 20.57 }, { type: "setColWidth", sheet: 0, col: 2, width: 2.57 }],
    });
  });

  it("dialogs open through the store and an open edit is committed first", async () => {
    const { store, core } = await ready();
    store.beginEdit("5");
    store.openDialog({ kind: "numberFormat" });
    expect(store.getState().dialog).toEqual({ kind: "numberFormat" });
    expect(applied(core.log)).toEqual([{ type: "setInput", sheet: 0, row: 0, col: 0, input: "5" }]);
    store.closeDialog();
    expect(store.getState().dialog).toBeNull();
  });
});
