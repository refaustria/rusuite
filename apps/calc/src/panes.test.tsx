// P8-3 UI: freeze panes, merged cells (ribbon, context menu, selection,
// editing, paste/fill refusal), hidden sheets and the per-sheet view.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import App from "./App";
import { FakeBackend, FakeCalcCore } from "./dev/fakeBackend";
import type { CalcCommand } from "./generated/CalcCommand";
import type { Request } from "./generated/Request";
import type { CalcStore } from "./state/store";

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

async function setup(sheets?: string[]) {
  const core = new FakeCalcCore(sheets);
  render(<App backend={new FakeBackend(core)} />);
  await screen.findByRole("tab", { name: "Sheet1" });
  await waitFor(() => expect(core.log.some((r) => r.type === "snapshot")).toBe(true));
  await waitFor(() => expect((screen.getByRole("button", { name: "Bold" }) as HTMLButtonElement).disabled).toBe(false));
  core.log.length = 0;
  const grid = screen.getByTestId("grid");
  grid.focus();
  const store = (window as unknown as { __calc: { store: CalcStore } }).__calc.store;
  return { core, grid, store };
}

const applied = (log: Request[]) => log.flatMap((r) => (r.type === "apply" ? [r.command] : []));
const address = () => (screen.getByTestId("cell-address") as HTMLInputElement).value;
const toasts = () => screen.queryAllByRole("alert").map((a) => a.textContent ?? "").join(" ");
/** Client point inside cell (row, col) with default sizes (46 px row header, 64×20 cells, 22 px column header). */
const at = (row: number, col: number) => ({ clientX: 46 + 64 * col + 10, clientY: 22 + 20 * row + 5 });
const tab = (name: string) => screen.getByRole("tab", { name });
const sheetTabs = () => within(screen.getByRole("tablist", { name: "Sheets" })).getAllByRole("tab").map((t) => t.textContent);
const activeTab = () => within(screen.getByRole("tablist", { name: "Sheets" })).getByRole("tab", { selected: true }).textContent;

function click(grid: HTMLElement, row: number, col: number, shiftKey = false) {
  fireEvent.mouseDown(grid, { ...at(row, col), button: 0, shiftKey });
  fireEvent.mouseUp(window);
}

async function typeCell(grid: HTMLElement, text: string) {
  fireEvent.keyDown(grid, { key: text[0]! });
  const ed = screen.getByTestId("cell-editor") as HTMLTextAreaElement;
  fireEvent.change(ed, { target: { value: text } });
  fireEvent.keyDown(ed, { key: "Enter" });
}

async function run(store: CalcStore, core: FakeCalcCore, command: CalcCommand) {
  await store.apply(command);
  core.log.length = 0;
}

function ribbonMenu(ribbonTab: string, button: string, item: string | RegExp) {
  fireEvent.click(tab(ribbonTab));
  fireEvent.click(screen.getByRole("button", { name: button }));
  return within(screen.getByRole("menu", { name: button })).getByRole("menuitem", { name: item });
}

describe("freeze panes", () => {
  it("View › Freeze Panes freezes above and left of the active cell; the entry then unfreezes", async () => {
    const { core, grid } = await setup();
    click(grid, 2, 2);
    fireEvent.click(ribbonMenu("View", "Freeze Panes", "Freeze Panes"));
    await waitFor(() => expect(applied(core.log)).toEqual([{ type: "setFreeze", sheet: 0, rows: 2, cols: 2 }]));
    await waitFor(() => expect(screen.getByTestId("grid-cells").dataset.frozen).toBe("2,2"));
    fireEvent.click(ribbonMenu("View", "Freeze Panes", "Unfreeze Panes"));
    await waitFor(() => expect(screen.getByTestId("grid-cells").dataset.frozen).toBe("0,0"));
    expect(applied(core.log)[1]).toEqual({ type: "setFreeze", sheet: 0, rows: 0, cols: 0 });
  });

  it("Freeze Top Row and Freeze First Column; undo restores the previous panes", async () => {
    const { core, grid } = await setup();
    click(grid, 5, 5);
    fireEvent.click(ribbonMenu("View", "Freeze Panes", "Freeze Top Row"));
    await waitFor(() => expect(screen.getByTestId("grid-cells").dataset.frozen).toBe("1,0"));
    fireEvent.click(ribbonMenu("View", "Freeze Panes", "Freeze First Column"));
    await waitFor(() => expect(screen.getByTestId("grid-cells").dataset.frozen).toBe("0,1"));
    expect(applied(core.log)).toEqual([
      { type: "setFreeze", sheet: 0, rows: 1, cols: 0 },
      { type: "setFreeze", sheet: 0, rows: 0, cols: 1 },
    ]);
    grid.focus();
    fireEvent.keyDown(grid, { key: "z", ctrlKey: true });
    await waitFor(() => expect(screen.getByTestId("grid-cells").dataset.frozen).toBe("1,0"));
  });

  it("selection and editing work in the frozen part: a click on row 1 selects it", async () => {
    const { store, core, grid } = await setup();
    await run(store, core, { type: "setFreeze", sheet: 0, rows: 1, cols: 1 });
    click(grid, 0, 3);
    expect(address()).toBe("D1");
    await typeCell(grid, "head");
    await waitFor(() => expect(applied(core.log)).toEqual([{ type: "setInput", sheet: 0, row: 0, col: 3, input: "head" }]));
  });
});

describe("merged cells", () => {
  it("Merge & Center merges and centres the selection; typing then edits the top-left cell", async () => {
    const { core, grid } = await setup();
    click(grid, 0, 0);
    click(grid, 0, 2, true);
    fireEvent.click(tab("Home"));
    fireEvent.click(screen.getByRole("button", { name: "Merge & Center" }));
    await waitFor(() =>
      expect(applied(core.log)).toEqual([
        {
          type: "compound",
          commands: [
            { type: "mergeCells", sheet: 0, r0: 0, c0: 0, r1: 0, c1: 2 },
            { type: "applyStyle", sheet: 0, r0: 0, c0: 0, r1: 0, c1: 2, patch: { alignment: { horizontal: "center" } } },
          ],
        },
      ]),
    );
    await waitFor(() => expect(address()).toBe("A1"));
    core.log.length = 0;
    // Clicking the covered C1 selects the merge; typing edits A1.
    click(grid, 0, 2);
    expect(address()).toBe("A1");
    await typeCell(grid, "Title");
    await waitFor(() => expect(applied(core.log)[0]).toEqual({ type: "setInput", sheet: 0, row: 0, col: 0, input: "Title" }));
    // Enter moved below the merge.
    expect(address()).toBe("A2");
  });

  it("double-clicking a covered cell edits the top-left one; arrows skip covered cells; Delete clears the merge", async () => {
    const { store, core, grid } = await setup();
    await run(store, core, { type: "setInput", sheet: 0, row: 1, col: 1, input: "anchor" });
    await run(store, core, { type: "mergeCells", sheet: 0, r0: 1, c0: 1, r1: 2, c1: 3 });
    fireEvent.doubleClick(grid, at(2, 3));
    expect((screen.getByTestId("cell-editor") as HTMLTextAreaElement).value).toBe("anchor");
    fireEvent.keyDown(screen.getByTestId("cell-editor"), { key: "Escape" });
    grid.focus();
    expect(address()).toBe("B2");
    fireEvent.keyDown(grid, { key: "ArrowRight" });
    expect(address()).toBe("E2");
    fireEvent.keyDown(grid, { key: "ArrowLeft" });
    expect(address()).toBe("B2");
    fireEvent.keyDown(grid, { key: "ArrowDown" });
    expect(address()).toBe("B4");
    fireEvent.keyDown(grid, { key: "ArrowUp" });
    expect(address()).toBe("B2");
    fireEvent.keyDown(grid, { key: "Delete" });
    await waitFor(() => expect(applied(core.log)).toEqual([{ type: "clearRange", sheet: 0, r0: 1, c0: 1, r1: 2, c1: 3 }]));
  });

  it("a range selection grows to whole merges", async () => {
    const { store, core, grid } = await setup();
    await run(store, core, { type: "mergeCells", sheet: 0, r0: 1, c0: 1, r1: 3, c1: 1 });
    click(grid, 0, 0);
    click(grid, 2, 1, true);
    expect(address()).toBe("A1:B4");
  });

  it("merging cells with several values asks first; Cancel keeps them", async () => {
    const { store, core, grid } = await setup();
    await run(store, core, { type: "setInput", sheet: 0, row: 0, col: 0, input: "a" });
    await run(store, core, { type: "setInput", sheet: 0, row: 0, col: 1, input: "b" });
    click(grid, 0, 0);
    click(grid, 0, 1, true);
    core.log.length = 0;
    fireEvent.click(ribbonMenu("Home", "Merge options", "Merge Cells"));
    const dlg = screen.getByRole("dialog", { name: "Merge Cells" });
    expect(dlg.textContent).toContain("only keeps the upper-left value");
    fireEvent.click(within(dlg).getByRole("button", { name: "Cancel" }));
    expect(applied(core.log)).toEqual([]);
    fireEvent.click(ribbonMenu("Home", "Merge options", "Merge Cells"));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Merge Cells" })).getByRole("button", { name: "OK" }));
    await waitFor(() => expect(applied(core.log)).toEqual([{ type: "mergeCells", sheet: 0, r0: 0, c0: 0, r1: 0, c1: 1 }]));
  });

  it("Merge Across merges each selected row; the Merge & Center button unmerges a merged selection", async () => {
    const { core, grid } = await setup();
    click(grid, 0, 0);
    click(grid, 1, 2, true);
    fireEvent.click(ribbonMenu("Home", "Merge options", "Merge Across"));
    await waitFor(() =>
      expect(applied(core.log)).toEqual([
        {
          type: "compound",
          commands: [
            { type: "mergeCells", sheet: 0, r0: 0, c0: 0, r1: 0, c1: 2 },
            { type: "mergeCells", sheet: 0, r0: 1, c0: 0, r1: 1, c1: 2 },
          ],
        },
      ]),
    );
    core.log.length = 0;
    fireEvent.click(screen.getByRole("button", { name: "Merge & Center" }));
    await waitFor(() => expect(applied(core.log)).toEqual([{ type: "unmergeCells", sheet: 0, r0: 0, c0: 0, r1: 1, c1: 2 }]));
  });

  it("the cell context menu merges and unmerges", async () => {
    const { core, grid } = await setup();
    click(grid, 3, 0);
    click(grid, 3, 1, true);
    fireEvent.contextMenu(grid, at(3, 0));
    fireEvent.click(within(screen.getByRole("menu", { name: "Cell" })).getByRole("menuitem", { name: "Merge Cells" }));
    await waitFor(() => expect(applied(core.log)).toEqual([{ type: "mergeCells", sheet: 0, r0: 3, c0: 0, r1: 3, c1: 1 }]));
    fireEvent.contextMenu(grid, at(3, 1));
    const unmerge = within(screen.getByRole("menu", { name: "Cell" })).getByRole("menuitem", { name: "Unmerge Cells" });
    expect((unmerge as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(unmerge);
    await waitFor(() => expect(applied(core.log)[1]).toEqual({ type: "unmergeCells", sheet: 0, r0: 3, c0: 0, r1: 3, c1: 1 }));
  });

  it("paste and fill refuse to change part of a merged cell", async () => {
    const { store, core, grid } = await setup();
    await run(store, core, { type: "mergeCells", sheet: 0, r0: 0, c0: 1, r1: 0, c1: 2 });
    const inputs = [[2, 0], [2, 1], [3, 0], [3, 1]].map(([row, col]): CalcCommand => ({ type: "setInput", sheet: 0, row, col, input: `${row}${col}` }));
    await run(store, core, { type: "compound", commands: inputs });
    // A 2×2 block pasted at A1 would cover B1 but not C1 of the merge B1:C1.
    click(grid, 2, 0);
    click(grid, 3, 1, true);
    store.copy();
    click(grid, 0, 0);
    core.log.length = 0;
    await store.paste();
    expect(applied(core.log)).toEqual([]);
    expect(toasts()).toContain("Cannot change part of a merged cell.");
    // At A6 it is fine.
    click(grid, 5, 0);
    await store.paste();
    expect(applied(core.log).map((c) => c.type)).toEqual(["pasteRange"]);
    core.log.length = 0;
    // Fill handle from A1 into B1 (half the merge): refused; down A1 → A2: done.
    click(grid, 0, 0);
    await store.fill({ r0: 0, c0: 1, r1: 0, c1: 1 });
    expect(applied(core.log)).toEqual([]);
    await store.fill({ r0: 1, c0: 0, r1: 1, c1: 0 });
    expect(applied(core.log).map((c) => c.type)).toEqual(["fillRange"]);
    core.log.length = 0;
    // Ctrl+R over A1:C1 (the merge included whole) is allowed; over A2:B2 next to nothing merged, too.
    click(grid, 0, 0);
    click(grid, 0, 1, true);
    expect(address()).toBe("A1:C1");
  });

  it("zoom and frozen panes come from the sheet's view and follow the active sheet", async () => {
    const { store, core } = await setup(["Sheet1", "Sheet2"]);
    await run(store, core, { type: "setSheetView", sheet: 1, patch: { zoom: 85, frozenRows: 2 } });
    expect(screen.getByTestId("zoom").textContent).toBe("100 %");
    fireEvent.click(tab("Sheet2"));
    await waitFor(() => expect(screen.getByTestId("zoom").textContent).toBe("85 %"));
    expect(screen.getByTestId("grid-root").style.zoom).toBe("0.85");
    expect(screen.getByTestId("grid-cells").dataset.frozen).toBe("2,0");
    fireEvent.click(tab("View"));
    expect((screen.getByRole("combobox", { name: "Zoom" }) as HTMLSelectElement).value).toBe("0.85");
  });
});

describe("hidden sheets", () => {
  it("the tab menu hides a sheet: its tab goes and the neighbour becomes active", async () => {
    const { core } = await setup(["Sheet1", "Sheet2", "Sheet3"]);
    fireEvent.click(tab("Sheet2"));
    fireEvent.contextMenu(tab("Sheet2"), { clientX: 30, clientY: 380 });
    fireEvent.click(within(screen.getByRole("menu", { name: "Sheet" })).getByRole("menuitem", { name: "Hide" }));
    await waitFor(() => expect(sheetTabs()).toEqual(["Sheet1", "Sheet3"]));
    expect(applied(core.log)).toEqual([{ type: "setSheetHidden", sheet: 1, hidden: true }]);
    expect(activeTab()).toBe("Sheet3");
  });

  it("Unhide… lists the hidden sheets and shows the chosen one", async () => {
    const { store, core } = await setup(["Sheet1", "Sheet2", "Sheet3"]);
    await run(store, core, { type: "setSheetHidden", sheet: 1, hidden: true });
    await run(store, core, { type: "setSheetHidden", sheet: 2, hidden: true });
    expect(sheetTabs()).toEqual(["Sheet1"]);
    fireEvent.contextMenu(tab("Sheet1"), { clientX: 30, clientY: 380 });
    const menu = within(screen.getByRole("menu", { name: "Sheet" }));
    expect((menu.getByRole("menuitem", { name: "Hide" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(menu.getByRole("menuitem", { name: "Unhide…" }));
    const dlg = within(screen.getByRole("dialog", { name: "Unhide" }));
    expect(dlg.getAllByRole("option").map((o) => o.textContent)).toEqual(["Sheet2", "Sheet3"]);
    fireEvent.click(dlg.getByRole("option", { name: "Sheet3" }));
    fireEvent.click(dlg.getByRole("button", { name: "OK" }));
    await waitFor(() => expect(sheetTabs()).toEqual(["Sheet1", "Sheet3"]));
    expect(applied(core.log)).toEqual([{ type: "setSheetHidden", sheet: 2, hidden: false }]);
    expect(activeTab()).toBe("Sheet3");
  });

  it("Home › Format › Hide Sheet / Unhide Sheet…; undo brings the sheet back as the active one", async () => {
    const { core, grid } = await setup(["Sheet1", "Sheet2"]);
    expect((ribbonMenu("Home", "Format", "Unhide Sheet…") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(screen.getByRole("menu", { name: "Format" }), { key: "Escape" });
    fireEvent.click(ribbonMenu("Home", "Format", "Hide Sheet"));
    await waitFor(() => expect(sheetTabs()).toEqual(["Sheet2"]));
    expect(activeTab()).toBe("Sheet2");
    expect(applied(core.log)).toEqual([{ type: "setSheetHidden", sheet: 0, hidden: true }]);
    grid.focus();
    fireEvent.keyDown(grid, { key: "z", ctrlKey: true });
    await waitFor(() => expect(sheetTabs()).toEqual(["Sheet1", "Sheet2"]));
    expect(activeTab()).toBe("Sheet1");
  });

  it("the last visible sheet can be neither hidden nor deleted", async () => {
    const { store, core } = await setup(["Sheet1", "Sheet2"]);
    await run(store, core, { type: "setSheetHidden", sheet: 1, hidden: true });
    await store.hideSheet(0);
    await store.deleteSheet(0);
    expect(applied(core.log)).toEqual([]);
    expect(toasts()).toContain("at least one visible sheet");
  });
});
