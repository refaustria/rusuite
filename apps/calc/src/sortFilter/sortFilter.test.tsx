// P8-5 UI: sort commands, the Custom Sort dialog, the expand prompt and the
// AutoFilter dropdown, driven through the real App over the fake backend.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import App from "../App";
import { FakeBackend, FakeCalcCore } from "../dev/fakeBackend";
import type { CalcCommand } from "../generated/CalcCommand";
import type { Request } from "../generated/Request";

const sizes = { clientWidth: 800, clientHeight: 400 };
const saved: Record<string, PropertyDescriptor | undefined> = {};
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
  for (const [k, v] of Object.entries(sizes)) {
    saved[k] = Object.getOwnPropertyDescriptor(HTMLElement.prototype, k);
    Object.defineProperty(HTMLElement.prototype, k, { configurable: true, get: () => v });
  }
});
afterAll(() => {
  for (const [k, d] of Object.entries(saved)) if (d) Object.defineProperty(HTMLElement.prototype, k, d);
});
afterEach(cleanup);

const applied = (log: Request[]): CalcCommand[] => log.flatMap((r) => (r.type === "apply" ? [r.command] : []));
const at = (row: number, col: number) => ({ clientX: 46 + 64 * col + 10, clientY: 22 + 20 * row + 5 });
/** The dropdown button of header cell (0, col): right edge of the cell. */
const button = (col: number) => ({ clientX: 46 + 64 * col + 64 - 9, clientY: 22 + 11, button: 0 });
const address = () => (screen.getByTestId("cell-address") as HTMLInputElement).value;

/** Name / Qty table in A1:B4 (Qty: 3, 1, 2). */
const TABLE = [
  ["Name", "Qty"],
  ["pear", "3"],
  ["apple", "1"],
  ["fig", "2"],
];

async function setup(table = TABLE) {
  const core = new FakeCalcCore();
  render(<App backend={new FakeBackend(core)} />);
  await screen.findByRole("tab", { name: "Sheet1" });
  await waitFor(() => expect(core.log.some((r) => r.type === "snapshot")).toBe(true));
  const grid = screen.getByTestId("grid");
  grid.focus();
  for (const [r, row] of table.entries()) {
    for (const [c, text] of row.entries()) {
      fireEvent.mouseDown(grid, at(r, c));
      fireEvent.keyDown(grid, { key: text[0]! });
      const ed = screen.getByTestId("cell-editor") as HTMLTextAreaElement;
      fireEvent.change(ed, { target: { value: text } });
      fireEvent.keyDown(ed, { key: "Enter" });
      await waitFor(() => expect(screen.queryByTestId("cell-editor")).toBeNull());
    }
  }
  await waitFor(() => expect(core.log.filter((r) => r.type === "apply").length).toBe(table.flat().length));
  core.log.length = 0;
  return { core, grid };
}

const select = (grid: HTMLElement, r0: number, c0: number, r1 = r0, c1 = c0) => {
  fireEvent.mouseDown(grid, at(r0, c0));
  fireEvent.mouseUp(window);
  if (r1 !== r0 || c1 !== c0) {
    fireEvent.mouseDown(grid, { ...at(r1, c1), shiftKey: true });
    fireEvent.mouseUp(window);
  }
};

async function turnFilterOn(grid: HTMLElement, core: FakeCalcCore) {
  select(grid, 0, 0);
  fireEvent.keyDown(grid, { key: "L", code: "KeyL", ctrlKey: true, shiftKey: true });
  await waitFor(() => expect(applied(core.log)).toContainEqual({ type: "setAutoFilter", sheet: 0, range: { r0: 0, c0: 0, r1: 0, c1: 0 } }));
  core.log.length = 0;
}

async function openPanel(grid: HTMLElement, col: number) {
  fireEvent.pointerDown(grid, button(col));
  const panel = await screen.findByTestId("filter-panel");
  await waitFor(() => expect(within(panel).queryByText("Loading…")).toBeNull());
  return panel;
}

describe("sort", () => {
  it("Data › Sort A to Z sorts by the active cell (sortSheetByColumn)", async () => {
    const { core, grid } = await setup();
    select(grid, 2, 1);
    fireEvent.click(screen.getByRole("tab", { name: "Data" }));
    fireEvent.click(screen.getByRole("button", { name: "Sort A to Z" }));
    await waitFor(() => expect(applied(core.log)).toEqual([{ type: "sortSheetByColumn", sheet: 0, row: 2, col: 1, ascending: true }]));
  });

  it("the cell context menu sorts Z to A", async () => {
    const { core, grid } = await setup();
    fireEvent.contextMenu(grid, at(1, 0));
    fireEvent.click(within(screen.getByRole("menu", { name: "Cell" })).getByRole("menuitem", { name: "Sort Z to A" }));
    await waitFor(() => expect(applied(core.log)).toEqual([{ type: "sortSheetByColumn", sheet: 0, row: 1, col: 0, ascending: false }]));
  });

  it("sorting part of a table asks to expand; Continue sorts only the selection", async () => {
    const { core, grid } = await setup();
    select(grid, 1, 1, 3, 1);
    fireEvent.click(screen.getByRole("tab", { name: "Data" }));
    fireEvent.click(screen.getByRole("button", { name: "Sort Z to A" }));
    const dlg = screen.getByRole("dialog", { name: "Sort Warning" });
    fireEvent.click(within(dlg).getByLabelText("Continue with the current selection"));
    fireEvent.click(within(dlg).getByRole("button", { name: "Sort" }));
    await waitFor(() =>
      expect(applied(core.log)).toEqual([
        { type: "sortRange", sheet: 0, r0: 1, c0: 1, r1: 3, c1: 1, keys: [{ col: 1, ascending: false }], hasHeader: false, caseSensitive: false },
      ]),
    );
  });

  it("Expand the selection sorts the whole table with its header", async () => {
    const { core, grid } = await setup();
    select(grid, 0, 1, 3, 1);
    fireEvent.click(screen.getByRole("tab", { name: "Data" }));
    fireEvent.click(screen.getByRole("button", { name: "Sort A to Z" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Sort Warning" })).getByRole("button", { name: "Sort" }));
    await waitFor(() =>
      expect(applied(core.log)).toEqual([
        { type: "sortRange", sheet: 0, r0: 0, c0: 0, r1: 3, c1: 1, keys: [{ col: 1, ascending: true }], hasHeader: true, caseSensitive: false },
      ]),
    );
    // The fake sorted the rows: Qty 1, 2, 3.
    await waitFor(() => expect(core.sheets[0]!.cells.get(1)?.get(0)?.input).toBe("apple"));
  });

  it("Custom Sort: two levels, header names, case sensitive → sortRange", async () => {
    const { core, grid } = await setup();
    select(grid, 1, 0);
    fireEvent.click(screen.getByRole("tab", { name: "Data" }));
    fireEvent.click(screen.getByRole("button", { name: "Sort" }));
    const dlg = screen.getByRole("dialog", { name: "Sort" });
    expect((within(dlg).getByLabelText("My data has headers") as HTMLInputElement).checked).toBe(true);
    expect(within(dlg).getAllByRole("option").map((o) => o.textContent)).toContain("Qty");
    fireEvent.click(within(dlg).getByRole("button", { name: "Add Level" }));
    expect(within(dlg).getAllByTestId("sort-level")).toHaveLength(2);
    fireEvent.change(within(dlg).getByLabelText("Sort as 2"), { target: { value: "numbers" } });
    fireEvent.change(within(dlg).getByLabelText("Order 2"), { target: { value: "desc" } });
    expect(within(dlg).getByLabelText("Order 2").textContent).toContain("Largest to Smallest");
    fireEvent.click(within(dlg).getByRole("button", { name: "Move up" }));
    fireEvent.click(within(dlg).getByLabelText("Case sensitive"));
    fireEvent.click(within(dlg).getByRole("button", { name: "OK" }));
    await waitFor(() =>
      expect(applied(core.log)).toEqual([
        {
          type: "sortRange", sheet: 0, r0: 0, c0: 0, r1: 3, c1: 1,
          keys: [{ col: 1, ascending: false, kind: "numbers" }, { col: 0, ascending: true }], hasHeader: true, caseSensitive: true,
        },
      ]),
    );
  });

  it("Custom Sort refuses a column used twice", async () => {
    const { core, grid } = await setup();
    select(grid, 1, 0);
    fireEvent.click(screen.getByRole("tab", { name: "Data" }));
    fireEvent.click(screen.getByRole("button", { name: "Sort" }));
    const dlg = screen.getByRole("dialog", { name: "Sort" });
    fireEvent.click(within(dlg).getByRole("button", { name: "Copy Level" }));
    expect(within(dlg).getByRole("alert").textContent).toMatch(/more than once/);
    expect((within(dlg).getByRole("button", { name: "OK" }) as HTMLButtonElement).disabled).toBe(true);
    expect(applied(core.log)).toEqual([]);
  });

  it("sorting an empty cell with no data around shows Excel's message", async () => {
    const { core, grid } = await setup();
    select(grid, 10, 5);
    fireEvent.click(screen.getByRole("tab", { name: "Data" }));
    fireEvent.click(screen.getByRole("button", { name: "Sort A to Z" }));
    expect(await screen.findByText(/can't be applied to the selected range/)).toBeTruthy();
    expect(applied(core.log)).toEqual([]);
  });
});

describe("AutoFilter", () => {
  it("Ctrl+Shift+L turns the filter on; Data › Filter is pressed; the button opens the value list with counts", async () => {
    const { core, grid } = await setup();
    await turnFilterOn(grid, core);
    fireEvent.click(screen.getByRole("tab", { name: "Data" }));
    expect(screen.getByRole("button", { name: "Filter" }).getAttribute("aria-pressed")).toBe("true");
    const panel = await openPanel(grid, 1);
    expect(panel.getAttribute("aria-label")).toBe("Filter: Qty");
    expect(within(panel).getAllByTestId("filter-value").map((v) => v.textContent)).toEqual(["11", "21", "31"]);
    expect((within(panel).getByLabelText("(Select All)") as HTMLInputElement).checked).toBe(true);
    expect(within(panel).getByRole("button", { name: "Number Filters" })).toBeTruthy();
    expect(address()).toBe("A1");
  });

  it("unchecking a value and OK sends a values filter; rows hide and the status bar counts records", async () => {
    const { core, grid } = await setup();
    await turnFilterOn(grid, core);
    const panel = await openPanel(grid, 0);
    expect(within(panel).getByRole("button", { name: "Text Filters" })).toBeTruthy();
    fireEvent.click(within(panel).getByLabelText("pear"));
    expect(within(panel).getByLabelText("(Select All)").getAttribute("aria-checked")).toBe("mixed");
    fireEvent.click(within(panel).getByRole("button", { name: "OK" }));
    await waitFor(() =>
      expect(applied(core.log)).toEqual([{ type: "setFilterColumn", sheet: 0, col: 0, filter: { kind: "values", values: ["apple", "fig"] } }]),
    );
    await waitFor(() => expect(screen.getByTestId("filter-records").textContent).toBe("2 of 3 records found"));
    expect(screen.queryByTestId("filter-panel")).toBeNull();
  });

  it("search keeps only the matching values; Select All unchecked disables OK", async () => {
    const { core, grid } = await setup();
    await turnFilterOn(grid, core);
    let panel = await openPanel(grid, 0);
    fireEvent.click(within(panel).getByLabelText("(Select All)"));
    expect((within(panel).getByRole("button", { name: "OK" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(panel).getByRole("button", { name: "Cancel" }));
    panel = await openPanel(grid, 0);
    fireEvent.change(within(panel).getByRole("searchbox", { name: "Search" }), { target: { value: "AP" } });
    expect(within(panel).getAllByTestId("filter-value").map((v) => v.textContent)).toEqual(["apple1"]);
    expect(within(panel).getByLabelText("(Select All Search Results)")).toBeTruthy();
    fireEvent.click(within(panel).getByRole("button", { name: "OK" }));
    await waitFor(() => expect(applied(core.log)).toEqual([{ type: "setFilterColumn", sheet: 0, col: 0, filter: { kind: "values", values: ["apple"] } }]));
  });

  it("Number Filters › Greater Than… opens the custom dialog → custom filter", async () => {
    const { core, grid } = await setup();
    await turnFilterOn(grid, core);
    const panel = await openPanel(grid, 1);
    fireEvent.click(within(panel).getByRole("button", { name: "Number Filters" }));
    fireEvent.click(within(panel).getByRole("menuitem", { name: "Greater Than…" }));
    const dlg = screen.getByRole("dialog", { name: "Custom AutoFilter" });
    expect(within(dlg).getByText("Show rows where: Qty")).toBeTruthy();
    expect((within(dlg).getByLabelText("First condition") as HTMLSelectElement).value).toBe("gt");
    fireEvent.change(within(dlg).getByLabelText("Value 1"), { target: { value: "1" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "OK" }));
    await waitFor(() =>
      expect(applied(core.log)).toEqual([
        { type: "setFilterColumn", sheet: 0, col: 1, filter: { kind: "custom", criteria: [{ op: "gt", value: "1" }], and: true } },
      ]),
    );
    await waitFor(() => expect(screen.getByTestId("filter-records").textContent).toBe("2 of 3 records found"));
  });

  it("Between… sends two criteria; Above Average applies at once; Top 10… validates", async () => {
    const { core, grid } = await setup();
    await turnFilterOn(grid, core);
    let panel = await openPanel(grid, 1);
    fireEvent.click(within(panel).getByRole("button", { name: "Number Filters" }));
    fireEvent.click(within(panel).getByRole("menuitem", { name: "Between…" }));
    let dlg = screen.getByRole("dialog", { name: "Custom AutoFilter" });
    fireEvent.change(within(dlg).getByLabelText("Value 1"), { target: { value: "2" } });
    fireEvent.change(within(dlg).getByLabelText("Value 2"), { target: { value: "3" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "OK" }));
    panel = await openPanel(grid, 1);
    fireEvent.click(within(panel).getByRole("button", { name: "Number Filters" }));
    fireEvent.click(within(panel).getByRole("menuitem", { name: "Above Average" }));
    panel = await openPanel(grid, 1);
    fireEvent.click(within(panel).getByRole("button", { name: "Number Filters" }));
    fireEvent.click(within(panel).getByRole("menuitem", { name: "Top 10…" }));
    dlg = screen.getByRole("dialog", { name: "Top 10 AutoFilter" });
    fireEvent.change(within(dlg).getByLabelText("Count"), { target: { value: "600" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "OK" }));
    expect(await screen.findByText(/whole number from 1 to 500/)).toBeTruthy();
    fireEvent.change(within(dlg).getByLabelText("Count"), { target: { value: "2" } });
    fireEvent.change(within(dlg).getByLabelText("Top"), { target: { value: "bottom" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "OK" }));
    await waitFor(() =>
      expect(applied(core.log).map((c) => (c.type === "setFilterColumn" ? c.filter : null))).toEqual([
        { kind: "custom", criteria: [{ op: "ge", value: "2" }, { op: "le", value: "3" }], and: true },
        { kind: "dynamic", filter: "aboveAverage" },
        { kind: "top10", top: false, percent: false, value: 2 },
      ]),
    );
  });

  it("Clear Filter From restores the rows; Data › Clear and Reapply send their commands", async () => {
    const { core, grid } = await setup();
    await turnFilterOn(grid, core);
    let panel = await openPanel(grid, 0);
    expect((within(panel).getByRole("button", { name: "Clear Filter From “Name”" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(panel).getByLabelText("fig"));
    fireEvent.click(within(panel).getByRole("button", { name: "OK" }));
    await waitFor(() => expect(screen.getByTestId("filter-records").textContent).toBe("2 of 3 records found"));
    panel = await openPanel(grid, 0);
    expect(within(panel).getAllByTestId("filter-value").map((v) => (v.querySelector("input") as HTMLInputElement).checked)).toEqual([true, false, true]);
    fireEvent.click(within(panel).getByRole("button", { name: "Clear Filter From “Name”" }));
    await waitFor(() => expect(screen.queryByTestId("filter-records")).toBeNull());
    expect(core.sheets[0]!.rows.get(3)?.hidden).toBe(false);
    fireEvent.click(screen.getByRole("tab", { name: "Data" }));
    fireEvent.click(screen.getByRole("button", { name: "Reapply" }));
    await waitFor(() => expect(applied(core.log).at(-1)).toEqual({ type: "reapplyFilter", sheet: 0 }));
    expect((screen.getByRole("button", { name: "Clear" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("the dropdown's Sort A to Z sorts the filter range; Alt+↓ on a header cell opens the dropdown; Esc closes it", async () => {
    const { core, grid } = await setup();
    await turnFilterOn(grid, core);
    let panel = await openPanel(grid, 1);
    fireEvent.click(within(panel).getByRole("button", { name: "Sort Z to A" }));
    await waitFor(() => expect(applied(core.log)).toEqual([{ type: "sortSheetByColumn", sheet: 0, row: 0, col: 1, ascending: false }]));
    select(grid, 0, 1);
    fireEvent.keyDown(grid, { key: "ArrowDown", altKey: true });
    panel = await screen.findByTestId("filter-panel");
    expect(panel.getAttribute("aria-label")).toBe("Filter: Qty");
    fireEvent.keyDown(panel, { key: "Escape" });
    expect(screen.queryByTestId("filter-panel")).toBeNull();
    // Not on the header row: Alt+↓ does nothing.
    select(grid, 2, 1);
    fireEvent.keyDown(grid, { key: "ArrowDown", altKey: true });
    expect(screen.queryByTestId("filter-panel")).toBeNull();
    expect(address()).toBe("B3");
  });

  it("an outside press closes the dropdown; Filter again turns the AutoFilter off", async () => {
    const { core, grid } = await setup();
    await turnFilterOn(grid, core);
    await openPanel(grid, 0);
    await act(async () => {
      fireEvent.pointerDown(document.body);
    });
    expect(screen.queryByTestId("filter-panel")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Home" }));
    fireEvent.click(screen.getByRole("button", { name: "Sort & Filter" }));
    const filter = screen.getByRole("menuitemradio", { name: /Filter/ });
    expect(filter.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(filter);
    await waitFor(() => expect(applied(core.log)).toEqual([{ type: "setAutoFilter", sheet: 0, range: null }]));
  });
});
