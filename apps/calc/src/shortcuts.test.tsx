// Calc keyboard shortcuts, driven through the real App (fake keyboard events).
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import App from "./App";
import { MemoryDocStorage } from "@rusuite/ui-shared";
import { FakeBackend, FakeCalcCore } from "./dev/fakeBackend";
import type { Request } from "./generated/Request";

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function setup(configure: (backend: FakeBackend) => void = () => {}) {
  const core = new FakeCalcCore();
  const backend = new FakeBackend(core);
  configure(backend);
  render(<App backend={backend} />);
  await screen.findByRole("tab", { name: "Sheet1" });
  await waitFor(() => expect(core.log.some((r) => r.type === "snapshot")).toBe(true));
  core.log.length = 0;
  const grid = screen.getByTestId("grid");
  grid.focus();
  return { core, backend, grid };
}

const applied = (log: Request[]) => log.flatMap((r) => (r.type === "apply" ? [r.command] : []));
const address = () => (screen.getByTestId("cell-address") as HTMLInputElement).value;
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

  it("Ctrl+D / Ctrl+R fill down / right from the selection's first row / column", async () => {
    const { core, grid } = await setup();
    fireEvent.keyDown(grid, { key: "ArrowDown" });
    expect(address()).toBe("A2");
    fireEvent.keyDown(grid, ctrl("d"));
    fireEvent.keyDown(grid, ctrl("r"));
    await waitFor(() =>
      expect(applied(core.log)).toEqual([
        { type: "fillRange", sheet: 0, src: { r0: 0, c0: 0, r1: 0, c1: 0 }, dst: { r0: 1, c0: 0, r1: 1, c1: 0 }, mode: "copy" },
      ]),
    );
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

  it("Ctrl+1 opens Format cells; Number with 2 decimals applies 0.00 with a live preview", async () => {
    const { core, grid } = await setup();
    await typeCell(grid, "1234.5");
    await waitFor(() => expect(applied(core.log)).toHaveLength(1));
    fireEvent.keyDown(grid, { key: "ArrowUp" });
    fireEvent.keyDown(grid, ctrl("1"));
    const dlg = screen.getByRole("dialog", { name: "Format cells" });
    fireEvent.click(within(dlg).getByRole("option", { name: "Number" }));
    await waitFor(() => expect(screen.getByTestId("format-preview").textContent).toBe("1234.50"));
    expect(core.log.some((r) => r.type === "formatPreview" && r.value === 1234.5 && r.code === "0.00")).toBe(true);
    fireEvent.submit(dlg.querySelector("form")!);
    await waitFor(() => expect(applied(core.log).slice(-1)[0]).toEqual({
      type: "applyStyle", sheet: 0, r0: 0, c0: 0, r1: 0, c1: 0, patch: { numberFormat: "0.00" },
    }));
    expect(screen.queryByRole("dialog")).toBeNull();
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

  it("desktop: Ctrl+Shift+S goes straight to the save dialog; the chosen file names the workbook and Ctrl+S saves there", async () => {
    const { core, backend, grid } = await setup((b) => {
      b.kind = "tauri";
      b.saveResult = { name: "chosen.xlsx", path: "/docs/chosen.xlsx" };
    });
    fireEvent.keyDown(grid, ctrl("S", { shiftKey: true }));
    await waitFor(() => expect(backend.saveOptions).toEqual([{ saveAs: true }]));
    expect(screen.queryByLabelText("File name")).toBeNull();
    await waitFor(() => expect(core.log.find((r) => r.type === "markSaved")).toEqual({ type: "markSaved", name: "chosen.xlsx" }));
    await waitFor(() => expect(backend.title).toMatch(/^chosen\.xlsx – Rusuite Calc/));
    await typeCell(grid, "5");
    await waitFor(() => expect(backend.title).toMatch(/^chosen\.xlsx •/));
    fireEvent.keyDown(grid, ctrl("s"));
    await waitFor(() => expect(backend.saveOptions).toEqual([{ saveAs: true }, { saveAs: false }]));
    expect(backend.saved.map((s) => s.name)).toEqual(["Untitled.xlsx", "chosen.xlsx"]);
    await waitFor(() => expect(backend.title).toMatch(/^chosen\.xlsx – /));
  });

  it("Ctrl+N starts a new workbook; with unsaved changes it asks Save / Don't save / Cancel", async () => {
    const { core, grid } = await setup();
    await typeCell(grid, "5");
    await waitFor(() => expect(screen.getByTestId("status-bar").textContent).toMatch(/Modified/));
    core.log.length = 0;
    fireEvent.keyDown(grid, ctrl("n"));
    const ask = await screen.findByRole("dialog", { name: "Save changes to Untitled?" });
    fireEvent.click(within(ask).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(core.log.some((r) => r.type === "newDocument")).toBe(false);
    expect(screen.getByTestId("status-bar").textContent).toMatch(/Modified/);
    fireEvent.keyDown(grid, ctrl("n"));
    fireEvent.click(await screen.findByRole("button", { name: "Don't save" }));
    await waitFor(() => expect(core.log.some((r) => r.type === "newDocument")).toBe(true));
    await waitFor(() => expect(screen.getByTestId("status-bar").textContent).toMatch(/Saved/));
  });

  it("Ctrl+O on an untitled modified workbook: Save asks the name, saves, then opens", async () => {
    const { core, backend, grid } = await setup();
    await typeCell(grid, "5");
    await waitFor(() => expect(screen.getByTestId("status-bar").textContent).toMatch(/Modified/));
    const openFile = vi.spyOn(backend, "openFile");
    fireEvent.keyDown(grid, ctrl("o"));
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));
    const input = (await screen.findByLabelText("File name")) as HTMLInputElement;
    expect(input.value).toBe("Workbook.xlsx");
    fireEvent.change(input, { target: { value: "q1" } });
    fireEvent.submit(input.form!);
    await waitFor(() => expect(openFile).toHaveBeenCalled());
    expect(backend.saved.map((s) => s.name)).toEqual(["q1.xlsx"]);
    expect(core.log.find((r) => r.type === "markSaved")).toEqual({ type: "markSaved", name: "q1.xlsx" });
  });

  it("Ctrl+O: a cancelled save dialog keeps the workbook and does not open", async () => {
    const { backend, grid } = await setup();
    await typeCell(grid, "5");
    await waitFor(() => expect(screen.getByTestId("status-bar").textContent).toMatch(/Modified/));
    backend.saveResult = false;
    const openFile = vi.spyOn(backend, "openFile");
    fireEvent.keyDown(grid, ctrl("o"));
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));
    const input = (await screen.findByLabelText("File name")) as HTMLInputElement;
    fireEvent.submit(input.form!);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await new Promise((r) => setTimeout(r, 20));
    expect(openFile).not.toHaveBeenCalled();
    expect(screen.getByTestId("status-bar").textContent).toMatch(/Modified/);
  });

  it("Restore in the recovery banner asks first when the open workbook is modified", async () => {
    const storage = new MemoryDocStorage();
    await storage.putRecovery({ id: "old", name: "lost.xlsx", savedAt: Date.now(), revision: 1, json: "{}" });
    const core = new FakeCalcCore();
    const backend = Object.assign(new FakeBackend(core), { storage });
    render(<App backend={backend} />);
    await screen.findByRole("tab", { name: "Sheet1" });
    const grid = screen.getByTestId("grid");
    grid.focus();
    await typeCell(grid, "5");
    await waitFor(() => expect(screen.getByTestId("status-bar").textContent).toMatch(/Modified/));
    core.log.length = 0;
    fireEvent.click(await screen.findByRole("button", { name: "Restore lost.xlsx" }));
    const ask = await screen.findByRole("dialog", { name: "Save changes to Untitled?" });
    fireEvent.click(within(ask).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(core.log.some((r) => r.type === "restoreRecovery")).toBe(false);
    expect(storage.recovery.has("old")).toBe(true);
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

  it("Ctrl+P opens File › Print", async () => {
    const { grid } = await setup();
    const e = new KeyboardEvent("keydown", { key: "p", ctrlKey: true, bubbles: true, cancelable: true });
    grid.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(await screen.findByTestId("print-panel")).toBeTruthy();
  });
});
