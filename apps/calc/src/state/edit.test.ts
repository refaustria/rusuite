import { describe, expect, it } from "vitest";
import type { Backend } from "@rusuite/ui-shared";
import { CalcApi } from "../backend/calcApi";
import { FakeBackend, FakeCalcCore } from "../dev/fakeBackend";
import type { Request } from "../generated/Request";
import { FUNCTIONS } from "../formula/functions";
import { CalcStore } from "./store";

async function readyStore(core = new FakeCalcCore()) {
  const store = new CalcStore(new CalcApi(new FakeBackend(core)));
  await store.init();
  core.log.length = 0;
  return { store, core };
}

const applied = (log: Request[]) => log.flatMap((r) => (r.type === "apply" ? [r.command] : []));
const text = (store: CalcStore) => store.getState().edit?.text;

describe("edit session: pointing", () => {
  it("a click inserts a reference, a drag turns it into a range, a further click replaces it", async () => {
    const { store } = await readyStore();
    store.select({ anchor: { row: 4, col: 0 }, focus: { row: 4, col: 0 } });
    store.beginEdit("=SUM(");
    expect(store.canPoint()).toBe(true);
    expect(store.pointRange({ row: 0, col: 0 }, { row: 0, col: 0 })).toBe(true);
    expect(text(store)).toBe("=SUM(A1");
    store.pointRange({ row: 0, col: 0 }, { row: 2, col: 0 });
    expect(text(store)).toBe("=SUM(A1:A3");
    store.pointRange({ row: 1, col: 1 }, { row: 1, col: 1 });
    expect(text(store)).toBe("=SUM(B2");
    store.setEditText("=SUM(B2,");
    store.pointRange({ row: 0, col: 2 }, { row: 0, col: 2 });
    expect(text(store)).toBe("=SUM(B2,C1");
    expect(store.getState().edit?.selEnd).toBe(10);
  });

  it("does not point when the caret is after an operand", async () => {
    const { store } = await readyStore();
    store.beginEdit("=1+2");
    expect(store.canPoint()).toBe(false);
    expect(store.pointRange({ row: 0, col: 0 }, { row: 0, col: 0 })).toBe(false);
    expect(text(store)).toBe("=1+2");
  });

  it("arrow pointing moves a reference cursor from the edited cell; Shift extends it", async () => {
    const { store } = await readyStore();
    store.select({ anchor: { row: 2, col: 2 }, focus: { row: 2, col: 2 } });
    store.beginEdit("=");
    expect(store.pointMove(-1, 0, false)).toBe(true);
    expect(text(store)).toBe("=C2");
    store.pointMove(0, 1, false);
    expect(text(store)).toBe("=D2");
    store.pointMove(1, 0, true);
    store.pointMove(0, 1, true);
    expect(text(store)).toBe("=D2:E3");
    store.setEditText("=D2:E3*");
    store.pointMove(0, -1, false);
    expect(text(store)).toBe("=D2:E3*B3");
    expect(store.getState().selection.anchor).toEqual({ row: 2, col: 2 });
  });

  it("points at another sheet with a qualified reference and commits to the edited cell", async () => {
    const { store, core } = await readyStore(new FakeCalcCore(["Sheet1", "My Data"]));
    store.select({ anchor: { row: 0, col: 1 }, focus: { row: 0, col: 1 } });
    store.beginEdit("=");
    store.setActiveSheet(1);
    expect(store.getState().activeSheet).toBe(1);
    expect(store.getState().edit?.origin).toBe("bar");
    store.pointRange({ row: 1, col: 0 }, { row: 3, col: 1 });
    expect(text(store)).toBe("='My Data'!A2:B4");
    expect(await store.commitEdit(1, 0)).toBe(true);
    expect(store.getState().activeSheet).toBe(0);
    expect(store.getState().selection.anchor).toEqual({ row: 1, col: 1 });
    expect(applied(core.log)).toEqual([{ type: "setInput", sheet: 0, row: 0, col: 1, input: "='My Data'!A2:B4" }]);
  });

  it("Esc while pointing on another sheet returns to the edited cell's sheet", async () => {
    const { store } = await readyStore(new FakeCalcCore(["Sheet1", "Sheet2"]));
    store.beginEdit("=1+");
    store.setActiveSheet(1);
    store.cancelEdit();
    expect(store.getState().edit).toBeNull();
    expect(store.getState().activeSheet).toBe(0);
  });

  it("F4 cycles the anchoring of the reference at the caret", async () => {
    const { store } = await readyStore();
    store.beginEdit("=A1");
    expect(store.cycleRefAnchor()).toBe(true);
    expect(text(store)).toBe("=$A$1");
    store.cycleRefAnchor();
    expect(text(store)).toBe("=A$1");
  });
});

describe("edit session: commit", () => {
  it("an incomplete formula keeps editing with an inline error; typing clears it; nothing is sent", async () => {
    const { store, core } = await readyStore();
    store.beginEdit("=A1+");
    expect(await store.commitEdit(1, 0)).toBe(false);
    const e = store.getState().edit;
    expect(e?.text).toBe("=A1+");
    expect(e?.error).toBe("Unexpected end of formula – fix or press Esc to discard");
    expect(store.getState().selection.anchor).toEqual({ row: 0, col: 0 });
    expect(core.log).toEqual([]);
    store.setEditText("=A1+1");
    expect(store.getState().edit?.error).toBeNull();
    expect(await store.commitEdit(1, 0)).toBe(true);
    expect(applied(core.log)).toHaveLength(1);
  });

  it("a formula with an unknown name commits (a value error, not a syntax error)", async () => {
    const { store, core } = await readyStore();
    store.beginEdit("=NOSUCH(1)+foo");
    expect(await store.commitEdit(1, 0)).toBe(true);
    expect(applied(core.log)).toHaveLength(1);
  });

  it("a formula the core rejects reopens the editor with the core's message", async () => {
    const core = new FakeCalcCore();
    const fake = new FakeBackend(core);
    const backend: Backend = {
      ...fake,
      kind: "wasm",
      ping: async () => "",
      openFile: async () => null,
      saveFile: async () => false,
      setTitle: async () => {},
      print: async () => {},
      dispatch: async <T,>(req: unknown) => {
        const r = req as Request;
        if (r.type === "apply") return { err: { code: "invalid_formula", message: "unexpected `)` at position 7" } } as T;
        return JSON.parse(JSON.stringify(core.handle(r))) as T;
      },
    };
    const store = new CalcStore(new CalcApi(backend));
    await store.init();
    store.beginEdit("=1+2");
    expect(await store.commitEdit(1, 0)).toBe(false);
    expect(store.getState().edit).toMatchObject({ text: "=1+2", error: "Unexpected `)` – fix or press Esc to discard" });
    expect(store.getState().selection.anchor).toEqual({ row: 0, col: 0 });
    expect(store.getState().toasts).toEqual([]);
  });

  it("switching sheets commits a plain edit and keeps a formula edit open", async () => {
    const { store, core } = await readyStore(new FakeCalcCore(["Sheet1", "Sheet2"]));
    store.beginEdit("abc");
    store.setActiveSheet(1);
    expect(store.getState().edit).toBeNull();
    expect(applied(core.log)).toEqual([{ type: "setInput", sheet: 0, row: 0, col: 0, input: "abc" }]);
    store.beginEdit("=SUM(");
    store.setActiveSheet(0);
    expect(store.getState().edit?.text).toBe("=SUM(");
    expect(store.getState().edit?.sheet).toBe(1);
  });
});

describe("edit session: functions", () => {
  it("lists matching functions, moves the highlight and accepts NAME(", async () => {
    const { store } = await readyStore();
    store.beginEdit("=su");
    const c = store.completion();
    expect(c?.items.map((f) => f.name)).toEqual(FUNCTIONS.map((x) => x.name).filter((n) => n.startsWith("SU")));
    store.moveCompletion(1);
    expect(store.completion()?.index).toBe(1);
    store.moveCompletion(-2);
    expect(store.completion()?.index).toBe((c?.items.length ?? 0) - 1);
    store.moveCompletion(2);
    expect(store.acceptCompletion()).toBe(true);
    expect(text(store)).toBe("=SUM(");
    expect(store.completion()).toBeNull();
    expect(store.signature()).toEqual({ name: "SUM", args: ["number1", "[number2]", "..."], active: 0 });
    store.setEditText("=SUM(1,");
    expect(store.signature()?.active).toBe(1);
  });

  it("Esc dismisses the list until the text changes", async () => {
    const { store } = await readyStore();
    store.beginEdit("=co");
    store.dismissCompletion();
    expect(store.completion()).toBeNull();
    store.setEditText("=cou");
    expect(store.completion()?.items.map((f) => f.name)).toEqual(FUNCTIONS.map((x) => x.name).filter((n) => n.startsWith("COU")));
  });

  it("fx starts a formula in an empty cell and lists all functions", async () => {
    const { store } = await readyStore();
    store.openFunctionList();
    expect(store.getState().edit).toMatchObject({ text: "=", origin: "bar" });
    expect(store.completion()?.items).toHaveLength(FUNCTIONS.length);
    store.acceptCompletion(0);
    expect(text(store)).toBe("=ABS(");
  });
});
