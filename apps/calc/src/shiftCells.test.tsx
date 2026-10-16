// P8-44 (C-13): Insert / Delete Cells with a shift – the dialog choices, the
// commands they send, Ctrl++ / Ctrl+- and the ribbon entries.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import App from "./App";
import { CalcApi, CalcApiError } from "./backend/calcApi";
import { FakeBackend, FakeCalcCore } from "./dev/fakeBackend";
import type { Request } from "./generated/Request";
import { cellsChoices, cellsCommand, defaultCellsChoice } from "./state/shiftCells";
import { CalcStore } from "./state/store";

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const r = (r0: number, c0: number, r1: number, c1: number) => ({ r0, c0, r1, c1 });

describe("Insert / Delete Cells choices", () => {
  it("lists Excel's four options per dialog", () => {
    expect(cellsChoices("insert")).toEqual(["right", "down", "rows", "cols"]);
    expect(cellsChoices("delete")).toEqual(["left", "up", "rows", "cols"]);
  });

  it("preselects a vertical shift unless the selection is taller than wide", () => {
    expect(defaultCellsChoice("insert", r(0, 0, 0, 0))).toBe("down");
    expect(defaultCellsChoice("insert", r(0, 0, 0, 3))).toBe("down");
    expect(defaultCellsChoice("insert", r(0, 0, 4, 1))).toBe("right");
    expect(defaultCellsChoice("delete", r(2, 2, 2, 2))).toBe("up");
    expect(defaultCellsChoice("delete", r(2, 2, 9, 2))).toBe("left");
  });

  it("maps the shift choices to InsertCells / DeleteCells on the selection", () => {
    expect(cellsCommand("insert", "right", 1, r(1, 2, 3, 4))).toEqual({ type: "insertCells", sheet: 1, r0: 1, c0: 2, r1: 3, c1: 4, shift: "right" });
    expect(cellsCommand("insert", "down", 0, r(1, 2, 3, 4))).toEqual({ type: "insertCells", sheet: 0, r0: 1, c0: 2, r1: 3, c1: 4, shift: "down" });
    expect(cellsCommand("delete", "left", 0, r(1, 2, 3, 4))).toEqual({ type: "deleteCells", sheet: 0, r0: 1, c0: 2, r1: 3, c1: 4, shift: "left" });
    expect(cellsCommand("delete", "up", 0, r(1, 2, 3, 4))).toEqual({ type: "deleteCells", sheet: 0, r0: 1, c0: 2, r1: 3, c1: 4, shift: "up" });
  });

  it("maps entire row / column to the row and column commands", () => {
    expect(cellsCommand("insert", "rows", 0, r(1, 2, 3, 4))).toEqual({ type: "insertRows", sheet: 0, at: 1, count: 3 });
    expect(cellsCommand("insert", "cols", 0, r(1, 2, 3, 4))).toEqual({ type: "insertCols", sheet: 0, at: 2, count: 3 });
    expect(cellsCommand("delete", "rows", 0, r(5, 0, 5, 0))).toEqual({ type: "deleteRows", sheet: 0, at: 5, count: 1 });
    expect(cellsCommand("delete", "cols", 0, r(5, 7, 5, 8))).toEqual({ type: "deleteCols", sheet: 0, at: 7, count: 2 });
  });
});

async function setup() {
  const core = new FakeCalcCore();
  const backend = new FakeBackend(core);
  render(<App backend={backend} />);
  await screen.findByRole("tab", { name: "Sheet1" });
  await waitFor(() => expect(core.log.some((q) => q.type === "snapshot")).toBe(true));
  core.log.length = 0;
  const grid = screen.getByTestId("grid");
  grid.focus();
  return { core, grid };
}

const applied = (log: Request[]) => log.flatMap((q) => (q.type === "apply" ? [q.command] : []));
const ctrl = (key: string, extra: KeyboardEventInit = {}) => ({ key, ctrlKey: true, ...extra });

describe("Insert / Delete Cells dialogs", () => {
  it("Ctrl++ on a cell offers Shift cells right and sends InsertCells", async () => {
    const { core, grid } = await setup();
    fireEvent.keyDown(grid, ctrl("+", { shiftKey: true }));
    const dlg = screen.getByRole("dialog", { name: "Insert" });
    expect((within(dlg).getByLabelText("Shift cells down") as HTMLInputElement).checked).toBe(true);
    fireEvent.click(within(dlg).getByLabelText("Shift cells right"));
    fireEvent.submit(dlg.querySelector("form")!);
    await waitFor(() => expect(applied(core.log)).toEqual([{ type: "insertCells", sheet: 0, r0: 0, c0: 0, r1: 0, c1: 0, shift: "right" }]));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Ctrl+- on a cell sends DeleteCells shifting up by default", async () => {
    const { core, grid } = await setup();
    fireEvent.keyDown(grid, { key: "ArrowDown" });
    fireEvent.keyDown(grid, ctrl("-"));
    const dlg = screen.getByRole("dialog", { name: "Delete" });
    fireEvent.submit(dlg.querySelector("form")!);
    await waitFor(() => expect(applied(core.log)).toEqual([{ type: "deleteCells", sheet: 0, r0: 1, c0: 0, r1: 1, c1: 0, shift: "up" }]));
  });

  it("Cancel sends nothing", async () => {
    const { core, grid } = await setup();
    fireEvent.keyDown(grid, ctrl("-"));
    const dlg = screen.getByRole("dialog", { name: "Delete" });
    fireEvent.click(within(dlg).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(applied(core.log)).toEqual([]);
  });

  it("the fake core moves the shifted cells", async () => {
    const core = new FakeCalcCore();
    const store = new CalcStore(new CalcApi(new FakeBackend(core)));
    await store.init();
    await store.apply({ type: "setInput", sheet: 0, row: 0, col: 0, input: "a" });
    await store.apply({ type: "setInput", sheet: 0, row: 1, col: 0, input: "b" });
    await store.shiftCells("insert", "right");
    const res = core.handle({ type: "snapshot", sheet: 0, r0: 0, c0: 0, r1: 3, c1: 3 }) as { ok?: { snapshot?: { cells: { row: number; col: number; input: string }[] } } };
    const cells = (res.ok?.snapshot?.cells ?? []).map((c) => [c.row, c.col, c.input]);
    expect(cells).toContainEqual([0, 1, "a"]);
    expect(cells).toContainEqual([1, 0, "b"]);
  });

  it("refusals show Excel's messages", async () => {
    const store = new CalcStore(new CalcApi(new FakeBackend(new FakeCalcCore())));
    store.pushError(new CalcApiError("shift_merged", "x"));
    store.pushError(new CalcApiError("shift_table", "y"));
    const messages = store.getState().toasts.map((x) => x.message);
    expect(messages).toEqual([
      "We can't do that to a merged cell.",
      "This operation is not allowed. The operation is attempting to shift cells in a table or filtered range on your worksheet.",
    ]);
  });
});
