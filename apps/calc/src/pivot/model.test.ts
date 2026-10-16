import { describe, expect, it } from "vitest";
import type { CellView } from "../generated/CellView";
import type { PivotCellView } from "../generated/PivotCellView";
import type { PivotItemInfo } from "../generated/PivotItemInfo";
import type { PivotSummary } from "../generated/PivotSummary";
import type { PivotTable } from "../generated/PivotTable";
import {
  addField, areaItems, captionOf, checkboxArea, clearFiltersPatch, coversPivot, dataFieldOf, defaultFunc, fieldArea, firstBodyRow, firstDataCol,
  getPivotDataFormula, hiddenItemsOf, isFiltered, isUsed, layoutOf, moveItem, pageSelectionOf, patchOf, pivotDataKey, removeItem, searchFields,
  selectRegion, showAsNeeds, showAsOf, toggleField, touchesPivot, updateAxisField, visibleItems, type CellAt,
} from "./model";

const table = (p: Partial<PivotTable> = {}): PivotTable => ({ id: 1, name: "PivotTable1", cacheId: 1, location: { r0: 2, c0: 0, r1: 2, c1: 0 }, ...p });
const kinds = (f: number) => (f === 3 ? "number" as const : "text" as const);

describe("pivot pane layout", () => {
  it("reads the areas of a table (Σ Values on the columns, last, by default)", () => {
    const l = layoutOf(table({ rows: [{ field: 0 }], values: [{ field: 3 }, { field: 3, func: "count" }] }));
    expect(l.valuesIn).toBe("columns");
    expect(l.valuesPosition).toBeNull();
    expect(areaItems(l, "cols")).toEqual([{ kind: "values" }]);
    expect(areaItems(l, "values")).toEqual([{ kind: "data", index: 0, field: 3 }, { kind: "data", index: 1, field: 3 }]);
  });

  it("shows Σ Values only with two or more data fields, at its position", () => {
    const one = layoutOf(table({ rows: [{ field: 0 }], values: [{ field: 3 }] }));
    expect(areaItems(one, "cols")).toEqual([]);
    const two = layoutOf(table({ rows: [{ field: 0 }, { field: 1 }], values: [{ field: 3 }, { field: 2 }], options: { valuesIn: "rows", valuesPosition: 1 } }));
    expect(areaItems(two, "rows").map((i) => i.kind)).toEqual(["field", "values", "field"]);
  });

  it("adds a field to Rows from the list", () => {
    const l = addField(layoutOf(table()), 0, "rows", null, "text");
    expect(l.rows).toEqual([{ field: 0 }]);
  });

  it("moves a field from Columns to Rows keeping its settings (a field is on one axis only)", () => {
    const l = layoutOf(table({ cols: [{ field: 1, hiddenItems: [2] }] }));
    const next = addField(l, 1, "rows", 0, "text");
    expect(next.cols).toEqual([]);
    expect(next.rows).toEqual([{ field: 1, hiddenItems: [2] }]);
  });

  it("adds a data field: Sum for numbers, Count for text", () => {
    const l = layoutOf(table());
    expect(addField(l, 3, "values", null, "number").values).toEqual([{ field: 3 }]);
    expect(addField(l, 0, "values", null, "text").values).toEqual([{ field: 0, func: "count" }]);
  });

  it("adds a filter field and keeps a page selection when moving it back", () => {
    const l = addField(layoutOf(table({ rows: [{ field: 0 }] })), 0, "filters", null, "text");
    expect(l.rows).toEqual([]);
    expect(l.filters).toEqual([{ field: 0 }]);
  });

  it("removes a data field; Σ Values cannot be removed on its own", () => {
    const l = layoutOf(table({ values: [{ field: 3 }, { field: 2, func: "count" }] }));
    expect(removeItem(l, "values", 0).values).toEqual([{ field: 2, func: "count" }]);
    expect(removeItem(l, "cols", 0)).toBe(l);
  });

  it("moves a row field to the columns", () => {
    const l = layoutOf(table({ rows: [{ field: 0 }, { field: 1 }] }));
    const next = moveItem(l, { area: "rows", index: 1 }, { area: "cols", index: null }, kinds);
    expect(next.rows).toEqual([{ field: 0 }]);
    expect(next.cols).toEqual([{ field: 1 }]);
  });

  it("reorders within an area (Move Down / Move Up)", () => {
    const l = layoutOf(table({ rows: [{ field: 0 }, { field: 1 }, { field: 2 }] }));
    // Move Down: before the entry after the next one.
    expect(moveItem(l, { area: "rows", index: 0 }, { area: "rows", index: 2 }).rows.map((a) => a.field)).toEqual([1, 0, 2]);
    expect(moveItem(l, { area: "rows", index: 2 }, { area: "rows", index: 1 }).rows.map((a) => a.field)).toEqual([0, 2, 1]);
    expect(moveItem(l, { area: "rows", index: 0 }, { area: "rows", index: null }).rows.map((a) => a.field)).toEqual([1, 2, 0]);
  });

  it("moves a data field to Rows (the data field goes) and a row field to Values (Count of text)", () => {
    const l = layoutOf(table({ rows: [{ field: 0 }], values: [{ field: 3 }] }));
    const a = moveItem(l, { area: "values", index: 0 }, { area: "rows", index: null }, kinds);
    expect(a.values).toEqual([]);
    expect(a.rows.map((x) => x.field)).toEqual([0, 3]);
    const b = moveItem(l, { area: "rows", index: 0 }, { area: "values", index: null }, kinds);
    expect(b.rows).toEqual([]);
    expect(b.values).toEqual([{ field: 3 }, { field: 0, func: "count" }]);
  });

  it("moves Σ Values to the rows (values on rows) and refuses Filters", () => {
    const l = layoutOf(table({ rows: [{ field: 0 }], values: [{ field: 3 }, { field: 4 }] }));
    const next = moveItem(l, { area: "cols", index: 0 }, { area: "rows", index: 0 });
    expect(next.valuesIn).toBe("rows");
    expect(next.valuesPosition).toBe(0);
    expect(areaItems(next, "rows").map((i) => i.kind)).toEqual(["values", "field"]);
    expect(moveItem(l, { area: "cols", index: 0 }, { area: "filters", index: 0 })).toBe(l);
  });

  it("ticks and unticks fields (numbers to Values, the rest to Rows)", () => {
    let l = layoutOf(table());
    l = toggleField(l, 0, "text");
    l = toggleField(l, 3, "number");
    expect(l.rows).toEqual([{ field: 0 }]);
    expect(l.values).toEqual([{ field: 3 }]);
    expect(isUsed(l, 3)).toBe(true);
    l = toggleField(l, 3, "number");
    expect(l.values).toEqual([]);
    expect(checkboxArea("date")).toBe("rows");
    expect(checkboxArea("number")).toBe("values");
  });

  it("builds the updatePivot patch: only the changed areas; options in full", () => {
    const t = table({ rows: [{ field: 0 }], values: [{ field: 3 }, { field: 4 }], options: { style: "PivotStyleMedium2" } });
    expect(patchOf(t, layoutOf(t))).toBeNull();
    expect(patchOf(t, addField(layoutOf(t), 1, "rows", null))).toEqual({ rows: [{ field: 0 }, { field: 1 }] });
    const moved = moveItem(layoutOf(t), { area: "cols", index: 0 }, { area: "rows", index: null });
    expect(patchOf(t, moved)).toEqual({ options: { style: "PivotStyleMedium2", valuesIn: "rows" } });
  });
});

describe("value and field settings", () => {
  it("captions: Sum of Sales, Count of for CountNums, a custom name as it is", () => {
    expect(captionOf({ field: 3 }, "Sales")).toBe("Sum of Sales");
    expect(captionOf({ field: 3, func: "countNums" }, "Sales")).toBe("Count of Sales");
    expect(captionOf({ field: 3, func: "stdDevP" }, "Sales")).toBe("StdDevp of Sales");
    expect(captionOf({ field: 3, name: "Revenue" }, "Sales")).toBe("Revenue");
  });

  it("Value Field Settings → DataField: defaults omitted, a custom name kept", () => {
    expect(dataFieldOf(3, "Sales", "Sum of Sales", "sum", { kind: "normal" }, null)).toEqual({ field: 3 });
    expect(dataFieldOf(3, "Sales", "Average of Sales", "average", { kind: "normal" }, null)).toEqual({ field: 3, func: "average" });
    expect(dataFieldOf(3, "Sales", "Revenue", "sum", { kind: "percentOfTotal" }, "0.0%")).toEqual({ field: 3, name: "Revenue", showAs: { kind: "percentOfTotal" }, numberFormat: "0.0%" });
  });

  it("Show Values As needs a base field and, for Difference From, a base item", () => {
    expect(showAsNeeds("rank")).toEqual({ field: true, item: false });
    expect(showAsNeeds("differenceFrom")).toEqual({ field: true, item: true });
    expect(showAsOf("differenceFrom", 0, "previous")).toEqual({ kind: "differenceFrom", baseField: 0, baseItem: { kind: "previous" } });
    expect(showAsOf("differenceFrom", 0, 2)).toEqual({ kind: "differenceFrom", baseField: 0, baseItem: { kind: "item", item: 2 } });
    expect(showAsOf("differenceFrom", 0, null)).toBeNull();
    expect(showAsOf("runningTotal", null, null)).toBeNull();
    expect(showAsOf("percentOfRow", null, null)).toEqual({ kind: "percentOfRow" });
  });

  it("default functions follow the field kind", () => {
    expect(defaultFunc("number")).toBe("sum");
    expect(defaultFunc("date")).toBe("sum");
    expect(defaultFunc("mixed")).toBe("count");
  });

  it("updates an axis field wherever it is", () => {
    const t = table({ rows: [{ field: 0 }], cols: [{ field: 1 }] });
    expect(updateAxisField(t, 1, (a) => ({ ...a, subtotals: { kind: "none" } }))).toEqual({ cols: [{ field: 1, subtotals: { kind: "none" } }] });
    expect(updateAxisField(t, 3, (a) => a)).toBeNull();
    expect(fieldArea(t, 0)).toBe("rows");
    expect(fieldArea(t, 4)).toBeNull();
  });
});

const items: PivotItemInfo[] = [
  { index: 2, label: "East", value: { t: "text", v: "East" }, checked: true, hasData: true },
  { index: 0, label: "North", value: { t: "text", v: "North" }, checked: true, hasData: true },
  { index: 1, label: "West", value: { t: "text", v: "West" }, checked: false, hasData: true },
];

describe("filter check-list", () => {
  it("hidden items: the unticked ones; none ticked disables OK", () => {
    expect(hiddenItemsOf(items, new Set([2, 0]), "")).toEqual([1]);
    expect(hiddenItemsOf(items, new Set([2, 0, 1]), "")).toEqual([]);
    expect(hiddenItemsOf(items, new Set(), "")).toBeNull();
  });

  it("while searching, only the ticked results stay (Excel)", () => {
    expect(visibleItems(items, "no").map((i) => i.label)).toEqual(["North"]);
    expect(hiddenItemsOf(items, new Set([2, 0, 1]), "no")).toEqual([1, 2]);
  });

  it("page selections: all ticked = (All), some = the items, none = not allowed", () => {
    expect(pageSelectionOf(items, new Set([0, 1, 2]))).toBeNull();
    expect(pageSelectionOf(items, new Set([1]))).toEqual([1]);
    expect(pageSelectionOf(items, new Set())).toBeUndefined();
  });

  it("knows filtered fields and clears every filter", () => {
    const t = table({ rows: [{ field: 0, hiddenItems: [1] }], filters: [{ field: 2, selected: { kind: "items", items: [0] } }] });
    expect(isFiltered(t, 0)).toBe(true);
    expect(isFiltered(t, 2)).toBe(true);
    expect(isFiltered(t, 1)).toBe(false);
    expect(clearFiltersPatch(t)).toEqual({ rows: [{ field: 0 }], filters: [{ field: 2 }] });
    expect(clearFiltersPatch(table({ rows: [{ field: 0 }] }))).toBeNull();
  });

  it("searches the field list", () => {
    const fields = [{ index: 0, name: "Region", kind: "text" as const, items: 3 }, { index: 3, name: "Sales", kind: "number" as const, items: 5 }];
    expect(searchFields(fields, "sal").map((f) => f.name)).toEqual(["Sales"]);
    expect(searchFields(fields, " ")).toHaveLength(2);
  });
});

// --- a laid out table for the cell-based helpers ---------------------------------------------

/** Cells `[row, col, display, kind, pivot]` → a lookup. */
function grid(cells: [number, number, string, PivotCellView["kind"], Partial<PivotCellView>?][]): CellAt {
  const m = new Map<string, CellView>();
  for (const [row, col, display, kind, extra] of cells) {
    const num = display !== "" && /^-?[\d.]+$/.test(display);
    m.set(`${row},${col}`, { row, col, input: display, display, kind: num ? "number" : display ? "text" : "empty", style: 0, pivot: { id: 1, kind, level: 0, ...extra } });
  }
  return (r, c) => m.get(`${r},${c}`);
}

const summary = (r0: number, c0: number, r1: number, c1: number, loc?: [number, number]): PivotSummary => ({
  id: 1, name: "PivotTable1", location: { r0: loc?.[0] ?? r0, c0: loc?.[1] ?? c0, r1, c1 }, table: { r0, c0, r1, c1 }, style: "PivotStyleLight16", banded: false, rowHeaders: true, colHeaders: true,
});

// Compact: A3 Row Labels | Sum of Sales; North (+Apple, Pear); South (+Apple); Grand Total.
const nested = grid([
  [2, 0, "Row Labels", "header"], [2, 1, "Sum of Sales", "header"],
  [3, 0, "North", "rowLabel", { field: 0, item: 0, collapsed: false }], [3, 1, "35", "subtotal"],
  [4, 0, "Apple", "rowLabel", { field: 1, item: 0, level: 1 }], [4, 1, "15", "value", { level: 1 }],
  [5, 0, "Pear", "rowLabel", { field: 1, item: 1, level: 1 }], [5, 1, "20", "value", { level: 1 }],
  [6, 0, "South", "rowLabel", { field: 0, item: 1, collapsed: false }], [6, 1, "30", "subtotal"],
  [7, 0, "Apple", "rowLabel", { field: 1, item: 0, level: 1 }], [7, 1, "30", "value", { level: 1 }],
  [8, 0, "Grand Total", "grandTotal"], [8, 1, "65", "grandTotal"],
]);
const nestedS = summary(2, 0, 8, 1);

// Crosstab: A3 Sum of Sales | B3 Column Labels; A4 Row Labels | Apple | Pear | Grand Total; North …
const cross = grid([
  [2, 0, "Sum of Sales", "header"], [2, 1, "Column Labels", "header"], [2, 2, "", "blank"], [2, 3, "", "blank"],
  [3, 0, "Row Labels", "header"], [3, 1, "Apple", "colLabel", { field: 1, item: 0 }], [3, 2, "Pear", "colLabel", { field: 1, item: 1 }], [3, 3, "Grand Total", "grandTotal"],
  [4, 0, "North", "rowLabel", { field: 0, item: 0 }], [4, 1, "15", "value"], [4, 2, "20", "value"], [4, 3, "35", "grandTotal"],
  [5, 0, "2024", "rowLabel", { field: 0, item: 1 }], [5, 1, "30", "value"], [5, 2, "", "blank"], [5, 3, "30", "grandTotal"],
  [6, 0, "Grand Total", "grandTotal"], [6, 1, "45", "grandTotal"], [6, 2, "20", "grandTotal"], [6, 3, "65", "grandTotal"],
]);
const crossS = summary(2, 0, 6, 3);

describe("GETPIVOTDATA from a pointed cell", () => {
  it("an inner item takes its outer item from the line above (compact form)", () => {
    expect(pivotDataKey(nested, nestedS, 5, 1)).toEqual({ pairs: [{ field: 0, item: "North" }, { field: 1, item: "Pear" }], caption: null });
    expect(pivotDataKey(nested, nestedS, 7, 1)!.pairs).toEqual([{ field: 0, item: "South" }, { field: 1, item: "Apple" }]);
  });

  it("a subtotal names the outer item only; the grand total nothing", () => {
    expect(pivotDataKey(nested, nestedS, 3, 1)!.pairs).toEqual([{ field: 0, item: "North" }]);
    expect(pivotDataKey(nested, nestedS, 8, 1)!.pairs).toEqual([]);
  });

  it("a crosstab value names its row and column items; numbers stay numbers", () => {
    expect(pivotDataKey(cross, crossS, 4, 2)!.pairs).toEqual([{ field: 0, item: "North" }, { field: 1, item: "Pear" }]);
    expect(pivotDataKey(cross, crossS, 5, 1)!.pairs).toEqual([{ field: 0, item: 2024 }, { field: 1, item: "Apple" }]);
    // The Grand Total column: the row item only.
    expect(pivotDataKey(cross, crossS, 4, 3)!.pairs).toEqual([{ field: 0, item: "North" }]);
  });

  it("labels, headers and cells outside are no values", () => {
    expect(pivotDataKey(cross, crossS, 4, 0)).toBeNull();
    expect(pivotDataKey(cross, crossS, 3, 1)).toBeNull();
    expect(pivotDataKey(cross, crossS, 9, 9)).toBeNull();
  });

  it("a data caption on the column axis (Σ Values) names the data field", () => {
    const two = grid([
      [2, 0, "Row Labels", "header"], [2, 1, "Sum of Sales", "colLabel"], [2, 2, "Count of Sales", "colLabel"],
      [3, 0, "North", "rowLabel", { field: 0, item: 0 }], [3, 1, "35", "value"], [3, 2, "2", "value"],
    ]);
    expect(pivotDataKey(two, summary(2, 0, 3, 2), 3, 2)).toEqual({ pairs: [{ field: 0, item: "North" }], caption: "Count of Sales" });
  });

  it("writes Excel's formula: quoted captions and items, an absolute anchor, other sheets prefixed", () => {
    expect(getPivotDataFormula("Sum of Sales", { r0: 2, c0: 0 }, [{ name: "Region", item: "North" }], null)).toBe('GETPIVOTDATA("Sum of Sales",$A$3,"Region","North")');
    expect(getPivotDataFormula('Sum of "X"', { r0: 4, c0: 2 }, [{ name: "Year", item: 2024 }], "My Sheet")).toBe("GETPIVOTDATA(\"Sum of \"\"X\"\"\",'My Sheet'!$C$5,\"Year\",2024)");
  });
});

describe("table regions", () => {
  it("finds the first body row and the first value column", () => {
    expect(firstBodyRow(cross, crossS)).toBe(4);
    expect(firstDataCol(cross, crossS)).toBe(1);
    expect(firstBodyRow(nested, nestedS)).toBe(3);
  });

  it("Select ▾: labels, values, the entire table with its page fields", () => {
    expect(selectRegion(cross, crossS, "labels")).toEqual({ r0: 4, c0: 0, r1: 6, c1: 0 });
    expect(selectRegion(cross, crossS, "values")).toEqual({ r0: 4, c0: 1, r1: 6, c1: 3 });
    expect(selectRegion(cross, summary(2, 0, 6, 3, [0, 0]), "entire")).toEqual({ r0: 0, c0: 0, r1: 6, c1: 3 });
  });

  it("Delete covers a table only when the whole location is selected", () => {
    const s = summary(2, 0, 6, 3, [0, 0]);
    expect(coversPivot({ r0: 0, c0: 0, r1: 6, c1: 3 }, s)).toBe(true);
    expect(coversPivot({ r0: 2, c0: 0, r1: 6, c1: 3 }, s)).toBe(false);
    expect(touchesPivot({ r0: 6, c0: 3, r1: 9, c1: 9 }, s)).toBe(true);
    expect(touchesPivot({ r0: 7, c0: 0, r1: 9, c1: 9 }, s)).toBe(false);
  });
});
