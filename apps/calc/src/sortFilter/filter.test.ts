import { describe, expect, it } from "vitest";
import type { AutoFilter } from "../generated/AutoFilter";
import type { FilterValue } from "../generated/FilterValue";
import type { RowView } from "../generated/RowView";
import { AxisGeometry } from "../grid/geometry";
import { FILTERED_ROW_COLOR, rowHeaderColor } from "../grid/render";
import {
  checklistFilter, columnFilter, customFilter, customInitial, dynamicFilter, filterButton, filterButtonAt, filterButtons, filteredRowSpan,
  filterMenuKind, hasFilters, initialChecked, recordsFound, selectAllState, setAll, toggleValue, top10Filter, visibleValues,
} from "./filter";

const values: FilterValue[] = [
  { display: "1", count: 2 },
  { display: "Apple", count: 1 },
  { display: "banana", count: 3 },
  { display: "", count: 1 },
];
const all = () => new Set(values.map((v) => v.display));

describe("value check-list", () => {
  it("starts with every value checked when the column has no values filter", () => {
    expect(initialChecked(values, undefined)).toEqual(all());
    expect(initialChecked(values, { kind: "dynamic", filter: "aboveAverage" })).toEqual(all());
  });
  it("starts with the filter's values checked (case-insensitive, blanks included)", () => {
    expect(initialChecked(values, { kind: "values", values: ["APPLE", ""] })).toEqual(new Set(["Apple", ""]));
  });
  it("search matches case-insensitively and hides blanks", () => {
    expect(visibleValues(values, "AN").map((v) => v.display)).toEqual(["banana"]);
    expect(visibleValues(values, "  ").length).toBe(4);
  });
  it("(Select All) reflects and sets the shown values", () => {
    expect(selectAllState(values, all())).toBe("all");
    expect(selectAllState(values, new Set())).toBe("none");
    expect(selectAllState(values, new Set(["1"]))).toBe("some");
    expect(setAll(values, new Set(["1"]), true)).toEqual(all());
    expect(setAll(visibleValues(values, "an"), all(), false)).toEqual(new Set(["1", "Apple", ""]));
    expect(toggleValue(new Set(["1"]), "1")).toEqual(new Set());
    expect(toggleValue(new Set(), "Apple")).toEqual(new Set(["Apple"]));
  });
});

describe("checklistFilter (panel state → Filter JSON)", () => {
  it("everything checked: no filter", () => {
    expect(checklistFilter(values, all(), "")).toBeNull();
  });
  it("nothing checked: OK disabled", () => {
    expect(checklistFilter(values, new Set(), "")).toBeUndefined();
  });
  it("some values: a values filter in list order, blanks as \"\"", () => {
    expect(checklistFilter(values, new Set(["", "1"]), "")).toEqual({ kind: "values", values: ["1", ""] });
  });
  it("while searching only the checked search results are kept", () => {
    expect(checklistFilter(values, all(), "app")).toEqual({ kind: "values", values: ["Apple"] });
    expect(checklistFilter(values, new Set(["1"]), "app")).toBeUndefined();
  });
});

describe("Text / Number Filters", () => {
  it("offers Number Filters when most cells are numbers", () => {
    expect(filterMenuKind(["number", "number", "text"])).toBe("number");
    expect(filterMenuKind(["number", "text", "empty"])).toBe("text");
    expect(filterMenuKind([])).toBe("text");
  });
  it("custom dialog presets: one criterion, or Between as ≥ and ≤", () => {
    expect(customInitial("gt", undefined)).toEqual({ op1: "gt", value1: "", op2: null, value2: "", and: true });
    expect(customInitial("between", undefined)).toEqual({ op1: "ge", value1: "", op2: "le", value2: "", and: true });
    expect(customInitial("custom", { kind: "values", values: ["a"] }).op1).toBe("eq");
  });
  it("custom dialog starts from the column's custom filter", () => {
    const f = { kind: "custom" as const, criteria: [{ op: "contains" as const, value: "x" }, { op: "endsWith" as const, value: "z" }], and: false };
    expect(customInitial("gt", f)).toEqual({ op1: "contains", value1: "x", op2: "endsWith", value2: "z", and: false });
  });
  it("greater than → one criterion", () => {
    expect(customFilter({ op1: "gt", value1: " 5 ", op2: null, value2: "ignored", and: false })).toEqual({
      kind: "custom", criteria: [{ op: "gt", value: "5" }], and: true,
    });
  });
  it("two criteria with Or", () => {
    expect(customFilter({ op1: "beginsWith", value1: "a", op2: "eq", value2: "b*", and: false })).toEqual({
      kind: "custom", criteria: [{ op: "beginsWith", value: "a" }, { op: "eq", value: "b*" }], and: false,
    });
  });
  it("Top 10 checks Excel's ranges", () => {
    expect(top10Filter(true, false, 10)).toEqual({ kind: "top10", top: true, percent: false, value: 10 });
    expect(top10Filter(false, true, 25)).toEqual({ kind: "top10", top: false, percent: true, value: 25 });
    expect(top10Filter(true, true, 101)).toBeNull();
    expect(top10Filter(true, false, 0)).toBeNull();
    expect(top10Filter(true, false, 2.5)).toBeNull();
  });
  it("Above / Below Average are dynamic filters", () => {
    expect(dynamicFilter("aboveAverage")).toEqual({ kind: "dynamic", filter: "aboveAverage" });
    expect(dynamicFilter("belowAverage")).toEqual({ kind: "dynamic", filter: "belowAverage" });
  });
});

const af: AutoFilter = { r0: 2, c0: 1, r1: 10, c1: 3, columns: [{ col: 2, filter: { kind: "values", values: ["a"] } }] };

describe("records found and row headers", () => {
  const rows = new Map<number, RowView>([
    [4, { row: 4, height: null, hidden: true, style: null, filtered: true }],
    [5, { row: 5, height: null, hidden: true, style: null }],
    [11, { row: 11, height: null, hidden: true, style: null, filtered: true }],
  ]);
  it("counts the data rows the filter hides (rows hidden by hand and outside the range do not count)", () => {
    expect(recordsFound(af, rows)).toEqual({ shown: 7, total: 8 });
  });
  it("is absent without a filter", () => {
    expect(recordsFound({ ...af, columns: [] }, rows)).toBeNull();
    expect(recordsFound(null, rows)).toBeNull();
    expect(hasFilters(af)).toBe(true);
    expect(columnFilter(af, 2)).toEqual({ kind: "values", values: ["a"] });
    expect(columnFilter(af, 1)).toBeUndefined();
  });
  it("filtered data rows get blue row numbers", () => {
    expect(filteredRowSpan(af)).toEqual({ r0: 3, r1: 10 });
    expect(filteredRowSpan({ ...af, columns: undefined })).toBeNull();
    expect(rowHeaderColor(5, false, filteredRowSpan(af), "#444")).toBe(FILTERED_ROW_COLOR);
    expect(rowHeaderColor(2, false, filteredRowSpan(af), "#444")).toBe("#444");
    expect(rowHeaderColor(5, true, filteredRowSpan(af), "#444")).toBe("#ffffff");
  });
});

describe("header dropdown buttons", () => {
  const cols = new AxisGeometry(64, new Map(), 100);
  const rows = new AxisGeometry(20, new Map(), 100);
  it("sit at the right edge of each header cell, bottom-aligned", () => {
    const b = filterButton(cols, rows, af, 1)!;
    expect(b).toEqual({ col: 1, x: 64 + 64 - 16 - 1, y: 40 + 20 - 16 - 1, size: 16, filtered: false, sort: null });
    expect(filterButton(cols, rows, af, 2)?.filtered).toBe(true);
    expect(filterButton(cols, rows, af, 4)).toBeNull();
  });
  it("only the visible AutoFilter columns get one; the sort direction shows on the sorted column", () => {
    const sortState = { r0: 3, c0: 1, r1: 10, c1: 3, keys: [{ col: 3, ascending: false }] };
    const bs = filterButtons(cols, rows, af, 0, 2, sortState);
    expect(bs.map((b) => b.col)).toEqual([1, 2]);
    expect(filterButtons(cols, rows, af, 0, 9, sortState).find((b) => b.col === 3)?.sort).toBe("desc");
  });
  it("hit-testing finds the column of the button under the point", () => {
    expect(filterButtonAt(cols, rows, af, 64 + 64 - 8, 40 + 11)).toBe(1);
    expect(filterButtonAt(cols, rows, af, 2 * 64 + 64 - 1, 40 + 18)).toBe(2);
    expect(filterButtonAt(cols, rows, af, 64 + 10, 40 + 11)).toBeNull(); // left part of the cell
    expect(filterButtonAt(cols, rows, af, 64 + 64 - 8, 60 + 11)).toBeNull(); // the row below
    expect(filterButtonAt(cols, rows, af, 4 * 64 + 56, 40 + 11)).toBeNull(); // outside the range
    expect(filterButtonAt(cols, rows, null, 64 + 56, 40 + 11)).toBeNull();
  });
  it("hidden header rows and narrow columns have no button", () => {
    const hidden = new AxisGeometry(20, new Map([[2, 0]]), 100);
    expect(filterButton(cols, hidden, af, 1)).toBeNull();
    const narrow = new AxisGeometry(64, new Map([[1, 6]]), 100);
    expect(filterButton(narrow, rows, af, 1)).toBeNull();
    const low = new AxisGeometry(20, new Map([[2, 12]]), 100);
    expect(filterButton(cols, low, af, 1)?.size).toBe(10);
  });
});
