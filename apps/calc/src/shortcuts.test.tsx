// Calc keyboard shortcuts, driven through the real App (fake keyboard events).
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import App from "./App";
import { FakeBackend, FakeCalcCore } from "./dev/fakeBackend";
import type { Request } from "./generated/Request";

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function setup() {
  const core = new FakeCalcCore();
  const backend = new FakeBackend(core);
  render(<App backend={backend} />);
  await screen.findByRole("tab", { name: "Sheet1" });
  await waitFor(() => expect(core.log.some((r) => r.type === "snapshot")).toBe(true));
  core.log.length = 0;
  const grid = screen.getByTestId("grid");
  grid.focus();
  return { core, backend, grid };
}

const applied = (log: Request[]) => log.flatMap((r) => (r.type === "apply" ? [r.command] : []));
const address = () => screen.getByTestId("cell-address").textContent;
const ctrl = (key: string, extra: KeyboardEventInit = {}) => ({ key, ctrlKey: true, ...extra });

async function typeCell(grid: HTMLElement, text: string) {
  fireEvent.keyDown(grid, { key: text[0]! });
  const ed = screen.getByTestId("cell-editor") as HTMLTextAreaElement;
  fireEvent.change(ed, { target: { value: text } });
  fireEvent.keyDown(ed, { key: "Enter" });
}

describe("Calc shortcuts", () => {
  it("Ctrl+Arrow jumps to the edge of the data, Ctrl+Shift+Arrow extends to it", async () => {
    const { core, grid } = await setup();
    await typeCell(grid, "1");
    await waitFor(() => expect(applied(core.log)).toHaveLength(1));
    fireEvent.keyDown(grid, { key: "ArrowUp" });
    fireEvent.keyDown(grid, ctrl("ArrowDown"));
    expect(address()).toBe("A1048576");
    fireEvent.keyDown(grid, ctrl("ArrowUp"));
    expect(address()).toBe("A1");
    fireEvent.keyDown(grid, ctrl("ArrowDown", { shiftKey: true }));
    expect(address()).toBe("A1:A1048576");
  });

  it("F2 edits the active cell; Delete clears the selection", async () => {
    const { core, grid } = await setup();
    fireEvent.keyDown(grid, { key: "F2" });
    expect(screen.getByTestId("cell-editor")).toBeTruthy();
    fireEvent.keyDown(screen.getByTestId("cell-editor"), { key: "Escape" });
    fireEvent.keyDown(grid, { key: "Delete" });
    await waitFor(() => expect(applied(core.log)).toEqual([{ type: "clearRange", sheet: 0, r0: 0, c0: 0, r1: 0, c1: 0 }]));
  });

  it("Ctrl+Space selects the column, Shift+Space the row", async () => {
    const { grid } = await setup();
    fireEvent.keyDown(grid, { key: "ArrowRight" });
    fireEvent.keyDown(grid, ctrl(" "));
    expect(address()).toBe("B1:B1048576");
    fireEvent.keyDown(grid, { key: "ArrowDown" });
    fireEvent.keyDown(grid, { key: " ", shiftKey: true });
    expect(address()).toBe("A2:XFD2");
    expect(screen.queryByTestId("cell-editor")).toBeNull();
  });

  it("Ctrl+Plus on a cell asks row or column; on a whole row it inserts directly", async () => {
    const { core, grid } = await setup();
    fireEvent.keyDown(grid, ctrl("+", { shiftKey: true }));
    const dlg = screen.getByRole("dialog", { name: "Insert" });
    fireEvent.click(screen.getByLabelText("Entire column"));
    fireEvent.submit(dlg.querySelector("form")!);
    await waitFor(() => expect(applied(core.log)).toEqual([{ type: "insertCols", sheet: 0, at: 0, count: 1 }]));
    expect(screen.queryByRole("dialog")).toBeNull();
    core.log.length = 0;
    grid.focus();
    fireEvent.keyDown(grid, { key: " ", shiftKey: true });
    fireEvent.keyDown(grid, ctrl("=", { code: "Equal" }));
    await waitFor(() => expect(applied(core.log)).toEqual([{ type: "insertRows", sheet: 0, at: 0, count: 1 }]));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Ctrl+Minus deletes the selected columns", async () => {
    const { core, grid } = await setup();
    fireEvent.keyDown(grid, ctrl(" "));
    fireEvent.keyDown(grid, ctrl("-"));
    await waitFor(() => expect(applied(core.log)).toEqual([{ type: "deleteCols", sheet: 0, at: 0, count: 1 }]));
  });

  it("Alt+Enter inserts a line break in the cell editor", async () => {
    const { core, grid } = await setup();
    fireEvent.keyDown(grid, { key: "a" });
    const ed = screen.getByTestId("cell-editor") as HTMLTextAreaElement;
    fireEvent.change(ed, { target: { value: "ab" } });
    ed.setSelectionRange(1, 1);
    fireEvent.keyDown(ed, { key: "Enter", altKey: true });
    expect((screen.getByTestId("cell-editor") as HTMLTextAreaElement).value).toBe("a\nb");
    expect(applied(core.log)).toEqual([]);
  });

  it("Ctrl+1 moves the focus into the formatting toolbar", async () => {
    const { grid } = await setup();
    fireEvent.keyDown(grid, ctrl("1"));
    expect(screen.getByRole("toolbar", { name: "Formatting" }).contains(document.activeElement)).toBe(true);
  });

  it("Ctrl+U underlines; Ctrl+I italicises", async () => {
    const { core, grid } = await setup();
    fireEvent.keyDown(grid, ctrl("u"));
    fireEvent.keyDown(grid, ctrl("i"));
    await waitFor(() => expect(applied(core.log).map((c) => c.type === "applyStyle" && c.patch)).toEqual([
      { font: { underline: "single" } },
      { font: { italic: true } },
    ]));
  });

  it("does not run grid shortcuts while typing in the cell editor", async () => {
    const { core, grid } = await setup();
    fireEvent.keyDown(grid, { key: "a" });
    const ed = screen.getByTestId("cell-editor");
    fireEvent.keyDown(ed, { key: "Delete" });
    fireEvent.keyDown(ed, ctrl("b"));
    expect(applied(core.log)).toEqual([]);
  });

  it("Ctrl+O and Ctrl+S work from inside the formula bar", async () => {
    const { core, backend } = await setup();
    const open = vi.spyOn(backend, "openFile");
    fireEvent.keyDown(screen.getByLabelText("Formula bar"), ctrl("o"));
    await waitFor(() => expect(open).toHaveBeenCalled());
    fireEvent.keyDown(screen.getByLabelText("Formula bar"), ctrl("s"));
    await waitFor(() => expect(core.log.some((r) => r.type === "saveXlsx")).toBe(true));
  });

  it("Ctrl+Shift+S asks for a name and saves under it", async () => {
    const { core, backend, grid } = await setup();
    fireEvent.keyDown(grid, ctrl("S", { shiftKey: true }));
    const input = screen.getByLabelText("File name") as HTMLInputElement;
    expect(input.value).toBe("Workbook.xlsx");
    fireEvent.change(input, { target: { value: "budget" } });
    fireEvent.submit(input.form!);
    await waitFor(() => expect(backend.saved.map((s) => s.name)).toEqual(["budget.xlsx"]));
    expect(core.log.find((r) => r.type === "markSaved")).toEqual({ type: "markSaved", name: "budget.xlsx" });
    await waitFor(() => expect(screen.getByTestId("status-bar").textContent).toMatch(/Saved/));
  });

  it("Ctrl+N starts a new workbook, asking first when there are unsaved changes", async () => {
    const { core, grid } = await setup();
    await typeCell(grid, "5");
    await waitFor(() => expect(screen.getByTestId("status-bar").textContent).toMatch(/Modified/));
    core.log.length = 0;
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    fireEvent.keyDown(grid, ctrl("n"));
    expect(core.log.some((r) => r.type === "newDocument")).toBe(false);
    fireEvent.keyDown(grid, ctrl("n"));
    await waitFor(() => expect(core.log.some((r) => r.type === "newDocument")).toBe(true));
    expect(confirm).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.getByTestId("status-bar").textContent).toMatch(/Saved/));
  });

  it("Ctrl+/ lists the shortcuts", async () => {
    const { grid } = await setup();
    fireEvent.keyDown(grid, ctrl("/"));
    const help = screen.getByRole("dialog", { name: "Keyboard shortcuts" });
    expect(help.textContent).toContain("Select column");
    expect(help.textContent).toContain("Ctrl+Shift+S");
    fireEvent.keyDown(help, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Ctrl+P opens the Export PDF dialog", async () => {
    const { grid } = await setup();
    const e = new KeyboardEvent("keydown", { key: "p", ctrlKey: true, bubbles: true, cancelable: true });
    grid.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(await screen.findByRole("dialog", { name: "Export PDF" })).toBeTruthy();
  });
});
