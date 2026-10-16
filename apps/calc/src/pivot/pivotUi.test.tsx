// Pivot tables through the real App with the fake backend (its toy pivots, dev/fakePivot.ts):
// Insert › PivotTable, the field pane, the grid's buttons, settings, filters, stale state, GETPIVOTDATA.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import App from "../App";
import { FakeBackend, FakeCalcCore } from "../dev/fakeBackend";
import type { CalcCommand } from "../generated/CalcCommand";
import type { Request } from "../generated/Request";
import { setLocale } from "@rusuite/ui-shared";
import type { CalcStore } from "../state/store";
import { dropIndex, dropLayout } from "./PivotPane";
import { fitCommands } from "./controller";
import { layoutOf } from "./model";

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  setLocale("en");
  localStorage.clear();
});

const applied = (log: Request[]): CalcCommand[] => log.flatMap((r) => (r.type === "apply" ? [r.command] : []));
const last = <T extends CalcCommand["type"]>(log: Request[], type: T) => applied(log).filter((c): c is Extract<CalcCommand, { type: T }> => c.type === type).pop();

async function setup() {
  const core = new FakeCalcCore();
  const backend = new FakeBackend(core);
  render(<App backend={backend} />);
  await screen.findByRole("tab", { name: "Sheet1" });
  await waitFor(() => expect(core.log.some((r) => r.type === "snapshot")).toBe(true));
  const store = (window as unknown as { __calc: { store: CalcStore } }).__calc.store;
  store.cfRefreshDelay = 0;
  const rows = [["Region", "Product", "Month", "Sales"], ["North", "Apple", "Jan", "10"], ["North", "Pear", "Jan", "20"], ["South", "Apple", "Feb", "30"], ["South", "Pear", "Feb", "40"]];
  for (const [r, row] of rows.entries()) for (const [c, v] of row.entries()) await act(() => store.apply({ type: "setInput", sheet: 0, row: r, col: c, input: v }));
  return { core, store };
}

/** Insert › PivotTable on a new sheet from A1's region; resolves with the pane. */
async function insertPivot(store: CalcStore) {
  act(() => store.select({ anchor: { row: 0, col: 0 }, focus: { row: 0, col: 0 } }));
  fireEvent.click(screen.getByRole("tab", { name: "Insert" }));
  fireEvent.click(screen.getByRole("button", { name: "PivotTable" }));
  const dlg = await screen.findByRole("dialog", { name: "Create PivotTable" });
  expect((within(dlg).getByTestId("pivot-source") as HTMLInputElement).value).toBe("Sheet1!$A$1:$D$5");
  fireEvent.click(within(dlg).getByRole("button", { name: "OK" }));
  const pane = await screen.findByTestId("pivot-pane");
  await within(pane).findByRole("checkbox", { name: "Region" });
  return pane;
}

const pivotCell = (store: CalcStore, row: number, col: number) => store.cache(store.getState().activeSheet).cells.get(row)?.get(col);

describe("Insert › PivotTable and the field pane", () => {
  it("creates an empty table on a new sheet, opens the pane and PivotTable Analyze", async () => {
    const { core, store } = await setup();
    await insertPivot(store);
    expect(last(core.log, "createPivot")).toEqual({ type: "createPivot", source: { kind: "range", sheet: 0, r0: 0, c0: 0, r1: 4, c1: 3 }, target: { kind: "newSheet" }, fields: {} });
    await waitFor(() => expect(screen.getByRole("tab", { name: "Sheet2" }).getAttribute("aria-selected")).toBe("true"));
    expect(store.getState().selection.anchor).toEqual({ row: 2, col: 0 });
    await waitFor(() => expect(screen.getByRole("tab", { name: "PivotTable Analyze" }).getAttribute("aria-selected")).toBe("true"));
    expect(screen.getByRole("tab", { name: "Design" })).toBeTruthy();
  });

  it("the dialog refuses a bad source and needs a location for an existing sheet", async () => {
    const { store } = await setup();
    act(() => store.openDialog({ kind: "pivotCreate" }));
    const dlg = await screen.findByRole("dialog", { name: "Create PivotTable" });
    fireEvent.change(within(dlg).getByTestId("pivot-source"), { target: { value: "Nope!A1:B2" } });
    expect(within(dlg).getByText("Enter a valid range or a defined name.")).toBeTruthy();
    fireEvent.change(within(dlg).getByTestId("pivot-source"), { target: { value: "Sheet1!$A$1:$D$5" } });
    fireEvent.click(within(dlg).getByRole("radio", { name: "Existing Worksheet" }));
    const ok = within(dlg).getByRole("button", { name: "OK" }) as HTMLButtonElement;
    expect(ok.disabled).toBe(true);
    fireEvent.change(within(dlg).getByTestId("pivot-location"), { target: { value: "Sheet1!$F$3" } });
    expect(ok.disabled).toBe(false);
  });

  it("ticking Region adds it to Rows, ticking Sales adds Sum of Sales; the grid gets the table", async () => {
    const { core, store } = await setup();
    const pane = await insertPivot(store);
    fireEvent.click(within(pane).getByRole("checkbox", { name: "Region" }));
    await waitFor(() => expect(last(core.log, "updatePivot")?.patch).toEqual({ rows: [{ field: 0 }] }));
    await waitFor(() => expect(within(pane).getByTestId("pivot-area-rows").textContent).toContain("Region"));
    fireEvent.click(within(pane).getByRole("checkbox", { name: "Sales" }));
    await waitFor(() => expect(last(core.log, "updatePivot")?.patch).toEqual({ values: [{ field: 3 }] }));
    await waitFor(() => expect(pivotCell(store, 3, 1)?.display).toBe("30"));
    expect(pivotCell(store, 2, 1)?.display).toBe("Sum of Sales");
    expect(pivotCell(store, 5, 0)?.pivot?.kind).toBe("grandTotal");
  });

  it("dragging a field from the list onto Columns sends the new layout (pointer events)", async () => {
    const { core, store } = await setup();
    const pane = await insertPivot(store);
    fireEvent.click(within(pane).getByRole("checkbox", { name: "Region" }));
    await waitFor(() => expect(within(pane).getByTestId("pivot-area-rows").textContent).toContain("Region"));
    const cols = within(pane).getByTestId("pivot-area-cols");
    const product = within(pane).getByTestId("pivot-field-list").querySelector('[data-pivot-field="1"]')!;
    document.elementFromPoint = vi.fn(() => cols);
    fireEvent.pointerDown(product, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(window, { clientX: 40, clientY: 60 });
    await screen.findByTestId("pivot-drag-ghost");
    fireEvent.pointerUp(window, { clientX: 40, clientY: 60 });
    await waitFor(() => expect(last(core.log, "updatePivot")?.patch).toEqual({ cols: [{ field: 1 }] }));
  });

  it("an area entry's menu moves it to Values (Count of a text field)", async () => {
    const { core, store } = await setup();
    const pane = await insertPivot(store);
    fireEvent.click(within(pane).getByRole("checkbox", { name: "Region" }));
    const menu = await within(pane).findByRole("button", { name: "Options for Region" });
    fireEvent.click(menu);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Move to Values" }));
    await waitFor(() => expect(last(core.log, "updatePivot")?.patch).toEqual({ rows: [], values: [{ field: 0, func: "count" }] }));
  });

  it("Defer Layout Update keeps the changes until Update", async () => {
    const { core, store } = await setup();
    const pane = await insertPivot(store);
    await act(() => store.pivots.ensureInfo(store.pivots.active()!.id));
    fireEvent.click(within(pane).getByRole("checkbox", { name: "Defer Layout Update" }));
    const n = applied(core.log).length;
    fireEvent.click(within(pane).getByRole("checkbox", { name: "Region" }));
    expect(within(pane).getByTestId("pivot-area-rows").textContent).toContain("Region");
    expect(applied(core.log).length).toBe(n);
    fireEvent.click(within(pane).getByRole("button", { name: "Update" }));
    await waitFor(() => expect(last(core.log, "updatePivot")?.patch).toEqual({ rows: [{ field: 0 }] }));
  });

  it("drop helpers: the insertion index and the layout after a drop outside the areas", () => {
    expect(dropIndex([{ top: 0, bottom: 32 }, { top: 32, bottom: 64 }], 10)).toBe(0);
    expect(dropIndex([{ top: 0, bottom: 32 }, { top: 32, bottom: 64 }], 50)).toBe(2);
    const l = layoutOf({ id: 1, name: "P", cacheId: 1, location: { r0: 0, c0: 0, r1: 0, c1: 0 }, rows: [{ field: 0 }], values: [{ field: 3 }] });
    const fields = [{ index: 0, name: "Region", kind: "text" as const, items: 2 }, { index: 3, name: "Sales", kind: "number" as const, items: 4 }];
    expect(dropLayout(l, { kind: "area", area: "rows", index: 0 }, null, fields).rows).toEqual([]);
    expect(dropLayout(l, { kind: "list", field: 3 }, null, fields)).toBe(l);
    expect(dropLayout(l, { kind: "list", field: 3 }, { area: "values", index: 0 }, fields).values).toEqual([{ field: 3 }, { field: 3 }]);
  });
});

/** A table with Region on the rows and Sum of Sales, ready on Sheet2. */
async function regionTable() {
  const ctx = await setup();
  await insertPivot(ctx.store);
  const id = ctx.store.pivots.active()!.id;
  await act(() => ctx.store.pivots.update(id, { rows: [{ field: 0 }, { field: 1 }], values: [{ field: 3 }] }));
  await waitFor(() => expect(pivotCell(ctx.store, 3, 0)?.display).toBe("North"));
  await act(() => ctx.store.pivots.ensureInfo(id));
  return { ...ctx, id };
}

describe("pivot cells in the grid", () => {
  it("double-clicking an item with inner items collapses it; a −/+ press toggles too", async () => {
    const { core, store, id } = await regionTable();
    act(() => store.select({ anchor: { row: 3, col: 0 }, focus: { row: 3, col: 0 } }));
    expect(store.pivots.toggleLabel(3, 0)).toBe(true);
    await waitFor(() => expect(last(core.log, "expandCollapse")).toEqual({ type: "expandCollapse", id, field: 0, item: 0, collapsed: true }));
    await waitFor(() => expect(pivotCell(store, 4, 0)?.display).toBe("South"));
    const geo = store.geometry(store.getState().activeSheet);
    const b = store.pivots.buttonsIn(store.getState().activeSheet, geo.col, geo.row, { r0: 3, c0: 0, r1: 3, c1: 0 }).find((x) => x.kind === "expand")!;
    expect(b.kind === "expand" && b.collapsed).toBe(true);
    await act(() => store.pivots.pressExpand(b as Extract<typeof b, { kind: "expand" }>));
    expect(last(core.log, "expandCollapse")?.collapsed).toBe(false);
    expect(store.pivots.toggleLabel(5, 1)).toBe(false);
  });

  it("typing into the table is refused with Excel's message; the editor stays closed", async () => {
    const { store } = await regionTable();
    act(() => store.select({ anchor: { row: 4, col: 1 }, focus: { row: 4, col: 1 } }));
    act(() => store.beginEdit("9"));
    expect(store.getState().edit).toBeNull();
    expect(store.getState().toasts.map((t) => t.message)).toContain("We can't change this part of a PivotTable.");
  });

  it("Delete on the whole table asks, then deletes it; on a part it is refused", async () => {
    const { core, store, id } = await regionTable();
    const loc = store.pivots.active()!.location;
    act(() => store.select({ anchor: { row: 4, col: 1 }, focus: { row: 5, col: 1 } }));
    await act(() => store.clearSelection());
    expect(store.getState().toasts.map((t) => t.message)).toContain("We can't change this part of a PivotTable.");
    act(() => store.select({ anchor: { row: loc.r0, col: loc.c0 }, focus: { row: loc.r1, col: loc.c1 } }));
    await act(() => store.clearSelection());
    const dlg = await screen.findByRole("dialog", { name: "Delete PivotTable" });
    fireEvent.click(within(dlg).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(applied(core.log).some((c) => c.type === "compound" && c.commands.some((x) => x.type === "deletePivot" && x.id === id))).toBe(true));
  });

  it("Ctrl+A inside a table selects the table; Select ▾ › Values the values", async () => {
    const { store } = await regionTable();
    act(() => store.select({ anchor: { row: 4, col: 0 }, focus: { row: 4, col: 0 } }));
    act(() => void store.pivots.selectWhole());
    const loc = store.pivots.active()!.location;
    expect(store.getState().selection).toEqual({ anchor: { row: loc.r0, col: loc.c0 }, focus: { row: loc.r1, col: loc.c1 } });
    act(() => store.pivots.select("values"));
    expect(store.getState().selection.anchor).toEqual({ row: 3, col: 1 });
  });

  it("Generate GetPivotData: pointing at a value while editing a formula inserts GETPIVOTDATA", async () => {
    const { store } = await regionTable();
    act(() => store.select({ anchor: { row: 0, col: 5 }, focus: { row: 0, col: 5 } }));
    act(() => store.beginEdit("="));
    const gpd = store.pivots.getPivotDataAt(5, 1, store.getState().activeSheet);
    expect(gpd).toBe('GETPIVOTDATA("Sum of Sales",$A$3,"Region","North","Product","Pear")');
    act(() => void store.insertAtPoint(gpd!));
    expect(store.getState().edit?.text).toBe('=GETPIVOTDATA("Sum of Sales",$A$3,"Region","North","Product","Pear")');
    store.pivots.getPivotData = false;
    expect(store.pivots.getPivotDataAt(5, 1, store.getState().activeSheet)).toBeNull();
  });

  it("autofit on update widens the columns the table's texts do not fit", async () => {
    const { store } = await regionTable();
    const cells = [...(store.cache(store.getState().activeSheet).cells.get(2)?.values() ?? [])];
    const fit = fitCommands(store, cells);
    // The default columns (64 px) are wide enough after the first autofit; a long header would grow column B.
    expect(fit).toEqual([]);
    const long = { ...cells[1]!, display: "Sum of a very long field name" };
    expect(fitCommands(store, [long])).toEqual([expect.objectContaining({ type: "setColWidth", col: 1 })]);
  });
});

describe("ribbon, settings and filters", () => {
  it("PivotTable Analyze › Refresh ▾ › Refresh All and Design › Grand Totals ▾ › Off", async () => {
    const { core, store, id } = await regionTable();
    act(() => store.select({ anchor: { row: 3, col: 0 }, focus: { row: 3, col: 0 } }));
    fireEvent.click(await screen.findByRole("tab", { name: "PivotTable Analyze" }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Refresh All/ }));
    await waitFor(() => expect(last(core.log, "refreshPivot")).toEqual({ type: "refreshPivot", id: null }));
    fireEvent.click(screen.getByRole("tab", { name: "Design" }));
    fireEvent.click(screen.getByRole("button", { name: "Grand Totals" }));
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "Off for Rows and Columns" }));
    await waitFor(() => expect(last(core.log, "updatePivot")?.patch.options).toMatchObject({ grandTotalRows: false, grandTotalCols: false }));
    expect(last(core.log, "updatePivot")?.id).toBe(id);
  });

  it("the styles gallery stores the chosen style id", async () => {
    const { core, store } = await regionTable();
    act(() => store.select({ anchor: { row: 3, col: 0 }, focus: { row: 3, col: 0 } }));
    fireEvent.click(await screen.findByRole("tab", { name: "Design" }));
    fireEvent.click(screen.getByRole("button", { name: "Styles" }));
    const gallery = await screen.findByTestId("pivot-style-gallery");
    fireEvent.click(within(gallery).getByRole("button", { name: "Medium 9" }));
    await waitFor(() => expect(last(core.log, "updatePivot")?.patch.options?.style).toBe("PivotStyleMedium9"));
  });

  it("Value Field Settings › Average → the data field's function", async () => {
    const { core, store, id } = await regionTable();
    act(() => store.openDialog({ kind: "pivotValueField", id, index: 0 }));
    const dlg = await screen.findByRole("dialog", { name: "Value Field Settings" });
    fireEvent.click(within(dlg).getByRole("option", { name: "Average" }));
    expect((within(dlg).getByLabelText("Custom Name:") as HTMLInputElement).value).toBe("Average of Sales");
    fireEvent.click(within(dlg).getByRole("button", { name: "OK" }));
    await waitFor(() => expect(last(core.log, "updatePivot")?.patch).toEqual({ values: [{ field: 3, func: "average" }] }));
  });

  it("Field Settings › Subtotals None and Tabular form", async () => {
    const { core, store, id } = await regionTable();
    act(() => store.openDialog({ kind: "pivotFieldSettings", id, field: 0 }));
    const dlg = await screen.findByRole("dialog", { name: "Field Settings" });
    fireEvent.click(within(dlg).getByRole("radio", { name: "None" }));
    fireEvent.click(within(dlg).getByRole("radio", { name: "Tabular form" }));
    fireEvent.click(within(dlg).getByRole("button", { name: "OK" }));
    await waitFor(() => expect(last(core.log, "updatePivot")?.patch).toEqual({ rows: [{ field: 0, subtotals: { kind: "none" }, layout: "tabular" }, { field: 1 }] }));
  });

  it("the Row Labels dropdown hides the unticked items of the chosen field", async () => {
    const { core, store, id } = await regionTable();
    act(() => store.openDialog({ kind: "pivotFilter", id, target: { kind: "axis", axis: "rows" }, at: { x: 10, y: 10 } }));
    const panel = await screen.findByTestId("pivot-filter-panel");
    expect((within(panel).getByLabelText("Select field:") as HTMLSelectElement).value).toBe("0");
    fireEvent.click(await within(panel).findByRole("checkbox", { name: "South" }));
    fireEvent.click(within(panel).getByRole("button", { name: "OK" }));
    await waitFor(() => expect(last(core.log, "updatePivot")?.patch).toEqual({ rows: [{ field: 0, hiddenItems: [1] }, { field: 1 }] }));
  });

  it("a page field's dropdown selects one item (setPageFilter)", async () => {
    const { core, store, id } = await regionTable();
    await act(() => store.pivots.update(id, { filters: [{ field: 2 }] }));
    await act(() => store.pivots.ensureInfo(id));
    act(() => store.openDialog({ kind: "pivotFilter", id, target: { kind: "page", field: 2 }, at: { x: 10, y: 10 } }));
    const panel = await screen.findByTestId("pivot-filter-panel");
    fireEvent.click(await within(panel).findByRole("radio", { name: "Feb" }));
    fireEvent.click(within(panel).getByRole("button", { name: "OK" }));
    await waitFor(() => expect(last(core.log, "setPageFilter")).toEqual({ type: "setPageFilter", id, field: 2, selected: [1] }));
  });

  it("a changed source makes the table stale: status hint, info bar, Refresh", async () => {
    const { core, store, id } = await regionTable();
    await act(() => store.apply({ type: "setInput", sheet: 0, row: 1, col: 3, input: "100" }));
    expect(store.pivots.stale.has(id)).toBe(true);
    expect((await screen.findByTestId("pivot-stale-status")).textContent).toBe("1 PivotTable needs a refresh");
    const bar = await screen.findByTestId("pivot-stale-bar");
    expect(bar.textContent).toContain("Data changed – Refresh");
    fireEvent.click(within(bar).getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(last(core.log, "refreshPivot")).toEqual({ type: "refreshPivot", id }));
    await waitFor(() => expect(screen.queryByTestId("pivot-stale-bar")).toBeNull());
    await waitFor(() => expect(pivotCell(store, 3, 1)?.display).toBe("120"));
  });

  it("the pane's toggle and leaving the table hide the pane and the contextual tabs", async () => {
    const { store } = await regionTable();
    expect(screen.getByTestId("pivot-pane")).toBeTruthy();
    act(() => store.select({ anchor: { row: 30, col: 10 }, focus: { row: 30, col: 10 } }));
    await waitFor(() => expect(screen.queryByTestId("pivot-pane")).toBeNull());
    expect(screen.queryByRole("tab", { name: "PivotTable Analyze" })).toBeNull();
    act(() => store.select({ anchor: { row: 3, col: 0 }, focus: { row: 3, col: 0 } }));
    await screen.findByTestId("pivot-pane");
    act(() => store.pivots.togglePane());
    await waitFor(() => expect(screen.queryByTestId("pivot-pane")).toBeNull());
  });

  it("cells naming a style the table lacks (pivot number formats, indents) fetch the style table again", async () => {
    const { core, store } = await setup();
    const n = core.log.filter((r) => r.type === "info").length;
    act(() => store.applyPatch({ sheets: null, cells: [{ sheet: 0, cells: [{ row: 9, col: 0, input: "1", display: "1", kind: "number", style: 99 }] }], cols: [], rows: [], styles: null, cycle: null, structural: [] }));
    await waitFor(() => expect(core.log.filter((r) => r.type === "info").length).toBe(n + 1));
  });

  it("Alt+F5 refreshes the selected table, Ctrl+Alt+F5 all of them", async () => {
    const { core, store, id } = await regionTable();
    act(() => store.select({ anchor: { row: 3, col: 0 }, focus: { row: 3, col: 0 } }));
    const grid = screen.getByTestId("grid");
    grid.focus();
    fireEvent.keyDown(grid, { key: "F5", altKey: true });
    await waitFor(() => expect(last(core.log, "refreshPivot")).toEqual({ type: "refreshPivot", id }));
    fireEvent.keyDown(grid, { key: "F5", altKey: true, ctrlKey: true });
    await waitFor(() => expect(last(core.log, "refreshPivot")).toEqual({ type: "refreshPivot", id: null }));
  });
});
