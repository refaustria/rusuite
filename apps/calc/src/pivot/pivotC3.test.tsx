// P9-C3: the round-2 pivot UI – the model helpers (filters, sorting, blank rows, group selection, dates)
// and the dialogs / ribbon entries through the real App with the fake backend: every OK sends its command.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import App from "../App";
import { FakeBackend, FakeCalcCore } from "../dev/fakeBackend";
import type { CalcCommand } from "../generated/CalcCommand";
import type { CellView } from "../generated/CellView";
import type { PivotTable } from "../generated/PivotTable";
import type { Request } from "../generated/Request";
import { setLocale } from "@rusuite/ui-shared";
import type { CalcStore } from "../state/store";
import {
  blankRowsPatch, captionOf, filterPatch, isFiltered, isoToSerial, selectedItems, serialToIso, SHOW_AS_KINDS, showAsNeeds, showAsOf, sortPatch, twoValues,
  VALUE_FUNCS,
} from "./model";
import { formulaName } from "./PivotDialogsC3";

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

const table = (t: Partial<PivotTable>): PivotTable => ({ id: 1, name: "PivotTable1", cacheId: 1, location: { r0: 0, c0: 0, r1: 5, c1: 2 }, ...t });

describe("model helpers", () => {
  it("filterPatch sets and clears a field's filter; isFiltered sees it", () => {
    const t = table({ rows: [{ field: 0 }, { field: 1 }] });
    const p = filterPatch(t, 1, { kind: "label", op: "contains", value: "st" })!;
    expect(p.rows).toEqual([{ field: 0 }, { field: 1, filter: { kind: "label", op: "contains", value: "st" } }]);
    expect(isFiltered({ ...t, rows: p.rows }, 1)).toBe(true);
    expect(filterPatch({ ...t, rows: p.rows }, 1, null)!.rows).toEqual([{ field: 0 }, { field: 1 }]);
  });

  it("sortPatch: labels, by a value field, manual", () => {
    const t = table({ cols: [{ field: 2 }] });
    expect(sortPatch(t, 2, "descending", null)!.cols).toEqual([{ field: 2, sort: { kind: "descending" } }]);
    expect(sortPatch(t, 2, "descending", 0)!.cols).toEqual([{ field: 2, sort: { kind: "byValue", data: 0, descending: true } }]);
    expect(sortPatch(t, 2, "ascending", 1)!.cols).toEqual([{ field: 2, sort: { kind: "byValue", data: 1, descending: false } }]);
    expect(sortPatch(t, 2, "manual", null)!.cols).toEqual([{ field: 2, sort: { kind: "manual", order: [] } }]);
  });

  it("blankRowsPatch marks the outer row fields only", () => {
    const t = table({ rows: [{ field: 0 }, { field: 1 }, { field: 2 }] });
    const on = blankRowsPatch(t, true)!;
    expect(on.rows).toEqual([{ field: 0, insertBlankRow: true }, { field: 1, insertBlankRow: true }, { field: 2 }]);
    expect(blankRowsPatch({ ...t, rows: on.rows }, false)!.rows).toEqual(t.rows);
    expect(blankRowsPatch(t, false)).toBeNull();
  });

  it("selectedItems takes the labels of one field", () => {
    const cell = (kind: string, field?: number, item?: number) => ({ row: 0, col: 0, input: "", display: "", style: 0, pivot: { id: 1, kind, level: 0, field, item } }) as unknown as CellView;
    expect(selectedItems([cell("rowLabel", 0, 2), cell("rowLabel", 0, 1), cell("value"), cell("rowLabel", 0, 2)])).toEqual({ field: 0, items: [2, 1] });
    expect(selectedItems([cell("rowLabel", 0, 2), cell("rowLabel", 1, 0)])).toBeNull();
    expect(selectedItems([cell("value")])).toBeNull();
  });

  it("dates for the Grouping and Date Filter dialogs", () => {
    expect(serialToIso(45306)).toBe("2024-01-15");
    expect(isoToSerial("2024-01-15")).toBe(45306);
    expect(isoToSerial("1/15/2024")).toBe(45306);
    expect(isoToSerial("2024-13-01")).toBeNull();
    expect(isoToSerial("soon")).toBeNull();
  });

  it("the new Show Values As modes and Distinct Count", () => {
    expect(SHOW_AS_KINDS).toHaveLength(15);
    expect(showAsNeeds("percentOf")).toEqual({ field: true, item: true });
    expect(showAsNeeds("rankAscending")).toEqual({ field: true, item: false });
    expect(showAsNeeds("index")).toEqual({ field: false, item: false });
    expect(showAsOf("percentDifferenceFrom", 2, "previous")).toEqual({ kind: "percentDifferenceFrom", baseField: 2, baseItem: { kind: "previous" } });
    expect(showAsOf("percentOf", 2, null)).toBeNull();
    expect(showAsOf("percentOfParentTotal", 1, null)).toEqual({ kind: "percentOfParentTotal", baseField: 1 });
    expect(VALUE_FUNCS).toContain("distinctCount");
    expect(captionOf({ field: 0, func: "distinctCount" }, "Region")).toBe("Distinct Count of Region");
    expect(twoValues("between") && twoValues("notBetween") && !twoValues("equal")).toBe(true);
    expect(formulaName("Sales")).toBe("Sales");
    expect(formulaName("Unit Price")).toBe("'Unit Price'");
  });
});

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

/** A table on a new sheet with Region › Product on rows and Sum of Sales. */
async function regionTable() {
  const ctx = await setup();
  act(() => ctx.store.select({ anchor: { row: 0, col: 0 }, focus: { row: 0, col: 0 } }));
  fireEvent.click(screen.getByRole("tab", { name: "Insert" }));
  fireEvent.click(screen.getByRole("button", { name: "PivotTable" }));
  const dlg = await screen.findByRole("dialog", { name: "Create PivotTable" });
  fireEvent.click(within(dlg).getByRole("button", { name: "OK" }));
  await screen.findByTestId("pivot-pane");
  const id = ctx.store.pivots.active()!.id;
  await act(() => ctx.store.pivots.update(id, { rows: [{ field: 0 }, { field: 1 }], values: [{ field: 3 }] }));
  await waitFor(() => expect(ctx.store.cache(ctx.store.getState().activeSheet).cells.get(3)?.get(0)?.display).toBe("North"));
  await act(() => ctx.store.pivots.ensureInfo(id));
  return { ...ctx, id };
}

describe("dialogs send their commands", () => {
  it("Grouping of a number field: By 10 → groupPivotField", async () => {
    const { core, store, id } = await regionTable();
    act(() => store.openDialog({ kind: "pivotGroup", id, field: 3 }));
    const dlg = await screen.findByTestId("pivot-group-dialog");
    fireEvent.change(within(dlg).getByLabelText("By"), { target: { value: "15" } });
    fireEvent.click(within(dlg).getByLabelText("Automatic start"));
    fireEvent.change(within(dlg).getByLabelText("Starting at:"), { target: { value: "0" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "OK" }));
    await waitFor(() => expect(last(core.log, "groupPivotField")).toEqual({ type: "groupPivotField", id, field: 3, group: { kind: "number", interval: 15, start: 0 } }));
  });

  it("Analyze › Group Selection on two labels groups their items", async () => {
    const { core, store, id } = await regionTable();
    act(() => store.select({ anchor: { row: 4, col: 0 }, focus: { row: 5, col: 0 } }));
    fireEvent.click(screen.getByRole("tab", { name: "PivotTable Analyze" }));
    fireEvent.click(await screen.findByRole("button", { name: "Group Selection" }));
    await waitFor(() => expect(last(core.log, "groupPivotField")?.group).toEqual({ kind: "items", items: [0, 1] }));
    expect(last(core.log, "groupPivotField")?.id).toBe(id);
  });

  it("Label Filter Begins With → the field's filter", async () => {
    const { core, store, id } = await regionTable();
    act(() => store.openDialog({ kind: "pivotFilter", id, target: { kind: "axis", axis: "rows" }, at: { x: 10, y: 10 } }));
    const panel = await screen.findByTestId("pivot-filter-panel");
    fireEvent.click(within(within(panel).getByTestId("pivot-label-filters")).getByRole("button", { name: /Label Filters/ }));
    fireEvent.click(await within(panel).findByRole("menuitem", { name: "Begins With…" }));
    const dlg = await screen.findByTestId("pivot-filter-rule");
    expect(screen.getByRole("dialog", { name: "Label Filter (Region)" })).toBeTruthy();
    fireEvent.change(within(dlg).getByLabelText("Value"), { target: { value: "N" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "OK" }));
    await waitFor(() =>
      expect(last(core.log, "updatePivot")?.patch).toEqual({ rows: [{ field: 0, filter: { kind: "label", op: "beginsWith", value: "N" } }, { field: 1 }] }),
    );
  });

  it("Value Filters › Top 10… keeps the bottom 3 items by percent", async () => {
    const { core, store, id } = await regionTable();
    act(() => store.openDialog({ kind: "pivotFilterRule", id, field: 1, rule: "top", op: "items" }));
    const dlg = await screen.findByTestId("pivot-filter-rule");
    fireEvent.change(within(dlg).getByLabelText("Top or bottom"), { target: { value: "bottom" } });
    fireEvent.change(within(dlg).getByLabelText("Count"), { target: { value: "3" } });
    fireEvent.change(within(dlg).getByLabelText("Show by"), { target: { value: "percent" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "OK" }));
    await waitFor(() =>
      expect(last(core.log, "updatePivot")?.patch).toEqual({ rows: [{ field: 0 }, { field: 1, filter: { kind: "top", data: 0, bottom: true, count: 3, by: "percent" } }] }),
    );
  });

  it("Value Filter Between needs both values", async () => {
    const { core, store, id } = await regionTable();
    act(() => store.openDialog({ kind: "pivotFilterRule", id, field: 0, rule: "value", op: "between" }));
    const dlg = await screen.findByTestId("pivot-filter-rule");
    const ok = within(dlg).getByRole("button", { name: "OK" }) as HTMLButtonElement;
    fireEvent.change(within(dlg).getByLabelText("Value"), { target: { value: "10" } });
    expect(ok.disabled).toBe(true);
    fireEvent.change(within(dlg).getByLabelText("Second value"), { target: { value: "50" } });
    fireEvent.click(ok);
    await waitFor(() => expect(last(core.log, "updatePivot")?.patch.rows?.[0]).toEqual({ field: 0, filter: { kind: "value", op: "between", data: 0, value: 10, value2: 50 } }));
  });

  it("More Sort Options: descending by Sum of Sales", async () => {
    const { core, store, id } = await regionTable();
    act(() => store.openDialog({ kind: "pivotSort", id, field: 0 }));
    const dlg = await screen.findByTestId("pivot-sort-dialog");
    fireEvent.click(within(dlg).getAllByRole("radio")[2]!);
    fireEvent.change(within(dlg).getByLabelText("Sort descending by"), { target: { value: "0" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "OK" }));
    await waitFor(() => expect(last(core.log, "updatePivot")?.patch.rows?.[0]).toEqual({ field: 0, sort: { kind: "byValue", data: 0, descending: true } }));
  });

  it("Calculated Field: name and formula → setCalculatedField", async () => {
    const { core, id } = await regionTable();
    fireEvent.click(screen.getByRole("tab", { name: "PivotTable Analyze" }));
    fireEvent.click(await screen.findByRole("button", { name: "Fields, Items, & Sets" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Calculated Field…" }));
    const dlg = await screen.findByTestId("pivot-calc-field");
    fireEvent.change(within(dlg).getByLabelText("Name:"), { target: { value: "Bonus" } });
    fireEvent.change(within(dlg).getByLabelText("Formula:"), { target: { value: "=" } });
    fireEvent.click(within(dlg).getByRole("option", { name: "Sales" }));
    fireEvent.click(within(dlg).getByRole("button", { name: "Insert" }));
    expect((within(dlg).getByLabelText("Formula:") as HTMLInputElement).value).toBe("=Sales");
    fireEvent.change(within(dlg).getByLabelText("Formula:"), { target: { value: "=Sales*0.1" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "OK" }));
    await waitFor(() => expect(last(core.log, "setCalculatedField")).toEqual({ type: "setCalculatedField", id, name: "Bonus", formula: "Sales*0.1" }));
  });

  it("Calculated Item of the active field → setCalculatedItem", async () => {
    const { core, store, id } = await regionTable();
    act(() => store.openDialog({ kind: "pivotCalcItem", id, field: 0 }));
    const dlg = await screen.findByTestId("pivot-calc-item");
    expect(screen.getByRole("dialog", { name: 'Insert Calculated Item in "Region"' })).toBeTruthy();
    fireEvent.change(within(dlg).getByLabelText("Name:"), { target: { value: "Both" } });
    fireEvent.change(within(dlg).getByLabelText("Formula:"), { target: { value: "=North+South" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "Add" }));
    await waitFor(() => expect(last(core.log, "setCalculatedItem")).toEqual({ type: "setCalculatedItem", id, field: 0, name: "Both", formula: "North+South" }));
  });

  it("Show Report Filter Pages of the page field", async () => {
    const { core, store, id } = await regionTable();
    await act(() => store.pivots.update(id, { filters: [{ field: 2 }] }));
    await act(() => store.pivots.ensureInfo(id));
    act(() => store.openDialog({ kind: "pivotFilterPages", id }));
    const dlg = await screen.findByRole("dialog", { name: "Show Report Filter Pages" });
    expect(within(dlg).getByRole("option", { name: "Month" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(within(dlg).getByRole("button", { name: "OK" }));
    await waitFor(() => expect(last(core.log, "showReportFilterPages")).toEqual({ type: "showReportFilterPages", id, field: 2 }));
  });

  it("Recommended PivotTables: pick the second one → createPivot with its fields", async () => {
    const { core, store } = await setup();
    act(() => store.select({ anchor: { row: 1, col: 1 }, focus: { row: 1, col: 1 } }));
    fireEvent.click(screen.getByRole("tab", { name: "Insert" }));
    fireEvent.click(screen.getByRole("button", { name: "Recommended PivotTables" }));
    const dlg = await screen.findByTestId("pivot-recommended");
    await within(dlg).findByRole("option", { name: "Sum of Sales by Product" });
    expect(within(dlg).getByTestId("pivot-recommended-preview").textContent).toContain("North");
    fireEvent.click(within(dlg).getByRole("option", { name: "Sum of Sales by Product" }));
    expect(within(dlg).getByTestId("pivot-recommended-preview").textContent).toContain("Apple");
    fireEvent.click(within(dlg).getByRole("button", { name: "OK" }));
    await waitFor(() =>
      expect(last(core.log, "createPivot")).toEqual({
        type: "createPivot",
        source: { kind: "range", sheet: 0, r0: 0, c0: 0, r1: 4, c1: 3 },
        target: { kind: "newSheet" },
        fields: { rows: [{ field: 1 }], values: [{ field: 3 }] },
      }),
    );
    expect(core.log.some((r) => r.type === "recommendPivots")).toBe(true);
  });

  it("Insert › PivotChart on a table inserts a PivotChart right of it", async () => {
    const { core, id } = await regionTable();
    fireEvent.click(screen.getByRole("tab", { name: "Insert" }));
    fireEvent.click(screen.getByRole("button", { name: "PivotChart" }));
    await waitFor(() => expect(last(core.log, "insertPivotChart")?.pivot).toBe(id));
    const cmd = last(core.log, "insertPivotChart")!;
    expect(cmd.chart.kind).toEqual({ type: "bar", direction: "column", grouping: "clustered" });
    expect(cmd.chart.legend).toEqual({ position: "right" });
    expect(cmd.anchor.type).toBe("twoCell");
  });

  it("Design › Blank Rows and the Value Field Settings' Distinct Count", async () => {
    const { core, store, id } = await regionTable();
    fireEvent.click(screen.getByRole("tab", { name: "Design" }));
    fireEvent.click(await screen.findByRole("button", { name: "Blank Rows" }));
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "Insert Blank Line after Each Item" }));
    await waitFor(() => expect(last(core.log, "updatePivot")?.patch).toEqual({ rows: [{ field: 0, insertBlankRow: true }, { field: 1 }] }));
    act(() => store.openDialog({ kind: "pivotValueField", id, index: 0 }));
    const dlg = await screen.findByRole("dialog", { name: "Value Field Settings" });
    fireEvent.click(within(dlg).getByRole("option", { name: "Distinct Count" }));
    expect((within(dlg).getByLabelText("Custom Name:") as HTMLInputElement).value).toBe("Distinct Count of Sales");
    fireEvent.click(within(dlg).getByRole("button", { name: "OK" }));
    await waitFor(() => expect(last(core.log, "updatePivot")?.patch.values).toEqual([{ field: 3, func: "distinctCount" }]));
  });
});
