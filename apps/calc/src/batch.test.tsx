// P6-3 UI: context menus, Find & Replace panel, paste values, sheet tab menu.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import App from "./App";
import { FakeBackend, FakeCalcCore } from "./dev/fakeBackend";
import type { Request } from "./generated/Request";

const sizes = { clientWidth: 800, clientHeight: 400 };
const saved: Record<string, PropertyDescriptor | undefined> = {};
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
  // jsdom has no layout: give the grid a size so hit testing works.
  for (const [k, v] of Object.entries(sizes)) {
    saved[k] = Object.getOwnPropertyDescriptor(HTMLElement.prototype, k);
    Object.defineProperty(HTMLElement.prototype, k, { configurable: true, get: () => v });
  }
});
afterAll(() => {
  for (const [k, d] of Object.entries(saved)) if (d) Object.defineProperty(HTMLElement.prototype, k, d);
});
afterEach(cleanup);

async function setup() {
  const core = new FakeCalcCore();
  render(<App backend={new FakeBackend(core)} />);
  await screen.findByRole("tab", { name: "Sheet1" });
  await waitFor(() => expect(core.log.some((r) => r.type === "snapshot")).toBe(true));
  core.log.length = 0;
  const grid = screen.getByTestId("grid");
  grid.focus();
  return { core, grid };
}

const applied = (log: Request[]) => log.flatMap((r) => (r.type === "apply" ? [r.command] : []));
const address = () => (screen.getByTestId("cell-address") as HTMLInputElement).value;
/** Client point inside cell (row, col) with default sizes (46 px row header, 64×20 cells, 22 px column header). */
const at = (row: number, col: number) => ({ clientX: 46 + 64 * col + 10, clientY: 22 + 20 * row + 5 });

async function typeCell(grid: HTMLElement, text: string) {
  fireEvent.keyDown(grid, { key: text[0]! });
  const ed = screen.getByTestId("cell-editor") as HTMLTextAreaElement;
  fireEvent.change(ed, { target: { value: text } });
  fireEvent.keyDown(ed, { key: "Enter" });
}

describe("context menus", () => {
  it("right-clicking a cell selects it and offers the cell menu; Insert rows inserts", async () => {
    const { core, grid } = await setup();
    fireEvent.contextMenu(grid, at(2, 1));
    expect(address()).toBe("B3");
    const menu = screen.getByRole("menu", { name: "Cell" });
    expect(within(menu).getAllByRole("menuitem").map((b) => b.textContent?.replace(/Ctrl.*|Del$/, ""))).toEqual([
      "Cut", "Copy", "Paste", "Paste values", "Insert rows", "Insert columns", "Delete rows", "Delete columns",
      "Clear contents", "Sort A to Z", "Sort Z to A", "Custom Sort…", "Merge & Center", "Merge Cells", "Unmerge Cells", "Format cells…", "Row height…", "Column width…",
    ]);
    expect((within(menu).getByRole("menuitem", { name: "Unmerge Cells" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Insert rows" }));
    await waitFor(() => expect(applied(core.log)).toEqual([{ type: "insertRows", sheet: 0, at: 2, count: 1 }]));
    expect(screen.queryByRole("menu", { name: "Cell" })).toBeNull();
  });

  it("the column header menu hides the column; Column width… sets it for the selection", async () => {
    const { core, grid } = await setup();
    fireEvent.contextMenu(grid, { clientX: 46 + 64 * 2 + 30, clientY: 10 });
    expect(address()).toBe("C1:C1048576");
    fireEvent.click(within(screen.getByRole("menu", { name: "Column" })).getByRole("menuitem", { name: "Hide" }));
    await waitFor(() => expect(applied(core.log)).toEqual([{ type: "setColHidden", sheet: 0, col: 2, hidden: true }]));
    fireEvent.contextMenu(grid, { clientX: 46 + 64 * 1 + 30, clientY: 10 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Column width…" }));
    const dlg = screen.getByRole("dialog", { name: "Column width" });
    fireEvent.change(within(dlg).getByRole("textbox"), { target: { value: "12" } });
    fireEvent.submit(dlg.querySelector("form")!);
    await waitFor(() => expect(applied(core.log).slice(-1)[0]).toEqual({ type: "setColWidth", sheet: 0, col: 1, width: 12 }));
  });

  it("the row header menu offers row height; the sheet tab menu renames", async () => {
    const { grid } = await setup();
    fireEvent.contextMenu(grid, { clientX: 20, clientY: 22 + 20 * 4 + 5 });
    expect(address()).toBe("A5:XFD5");
    expect(within(screen.getByRole("menu", { name: "Row" })).getByRole("menuitem", { name: "Row height…" })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("menu", { name: "Row" }), { key: "Escape" });
    fireEvent.contextMenu(screen.getByRole("tab", { name: "Sheet1" }), { clientX: 30, clientY: 380 });
    fireEvent.click(within(screen.getByRole("menu", { name: "Sheet" })).getByRole("menuitem", { name: "Rename" }));
    expect((screen.getByLabelText("Sheet name") as HTMLInputElement).value).toBe("Sheet1");
  });
});

describe("find & replace and paste values", () => {
  it("Ctrl+F finds the next match and moves the selection", async () => {
    const { core, grid } = await setup();
    fireEvent.keyDown(grid, { key: "ArrowDown" });
    fireEvent.keyDown(grid, { key: "ArrowDown" });
    await typeCell(grid, "needle");
    await waitFor(() => expect(applied(core.log)).toHaveLength(1));
    fireEvent.keyDown(grid, { key: "ArrowRight" });
    fireEvent.keyDown(grid, { key: "f", ctrlKey: true });
    const panel = screen.getByRole("dialog", { name: "Find" });
    fireEvent.change(within(panel).getByLabelText("Find what"), { target: { value: "NEED" } });
    fireEvent.submit(panel.querySelector("form")!);
    await waitFor(() => expect(address()).toBe("A3"));
    fireEvent.change(within(panel).getByLabelText("Find what"), { target: { value: "hay" } });
    fireEvent.submit(panel.querySelector("form")!);
    await screen.findByText("No match found.");
    fireEvent.keyDown(panel, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Find" })).toBeNull();
  });

  it("Ctrl+H replaces all matches in one step", async () => {
    const { core, grid } = await setup();
    await typeCell(grid, "red car");
    await typeCell(grid, "red");
    await waitFor(() => expect(applied(core.log)).toHaveLength(2));
    fireEvent.keyDown(grid, { key: "h", ctrlKey: true });
    const panel = screen.getByRole("dialog", { name: "Find and replace" });
    fireEvent.change(within(panel).getByLabelText("Find what"), { target: { value: "red" } });
    fireEvent.change(within(panel).getByLabelText("Replace with"), { target: { value: "blue" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Replace all" }));
    await screen.findByText("Replaced 2 cells.");
    expect(applied(core.log).slice(-1)[0]).toEqual({
      type: "compound",
      commands: [
        { type: "setInput", sheet: 0, row: 0, col: 0, input: "blue car" },
        { type: "setInput", sheet: 0, row: 1, col: 0, input: "blue" },
      ],
    });
  });

  it("Ctrl+C then Ctrl+Shift+V pastes values only", async () => {
    const { core, grid } = await setup();
    await typeCell(grid, "=1+1");
    await waitFor(() => expect(applied(core.log)).toHaveLength(1));
    fireEvent.keyDown(grid, { key: "ArrowUp" });
    fireEvent.copy(grid, { clipboardData: { setData: () => {} } });
    fireEvent.keyDown(grid, { key: "ArrowRight" });
    fireEvent.keyDown(grid, { key: "V", ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(applied(core.log).slice(-1)[0]).toMatchObject({ type: "pasteRange", mode: "valuesOnly", r0: 0, c0: 1 }));
  });

  it("Ctrl+X then Ctrl+V moves; after Esc the cut is cancelled", async () => {
    const { core, grid } = await setup();
    await typeCell(grid, "a");
    await waitFor(() => expect(applied(core.log)).toHaveLength(1));
    fireEvent.keyDown(grid, { key: "ArrowUp" });
    let tsv = "";
    fireEvent.cut(grid, { clipboardData: { setData: (_: string, t: string) => (tsv = t) } });
    expect(tsv).toBe("a");
    fireEvent.keyDown(grid, { key: "Escape" });
    fireEvent.paste(grid, { clipboardData: { getData: () => "" } });
    fireEvent.cut(grid, { clipboardData: { setData: () => {} } });
    fireEvent.keyDown(grid, { key: "ArrowRight" });
    fireEvent.paste(grid, { clipboardData: { getData: () => tsv } });
    await waitFor(() => expect(applied(core.log).slice(1)).toEqual([expect.objectContaining({ type: "pasteRange", cut: true, c0: 1 })]));
  });
});
