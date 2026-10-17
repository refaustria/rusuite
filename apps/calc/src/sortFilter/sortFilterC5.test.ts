// P9-C5: the date tree of the filter dropdown, colour levels and custom
// lists in `sortRange`, and the store's sort / filter by the selected
// cell's value or colour.
import { describe, expect, it } from "vitest";
import { CalcApi } from "../backend/calcApi";
import { FakeBackend, FakeCalcCore } from "../dev/fakeBackend";
import type { FilterValue } from "../generated/FilterValue";
import type { Request } from "../generated/Request";
import { CalcStore } from "../state/store";
import { dateTree, dateTreeFilter, initialDateChecked } from "./filter";
import { BUILTIN_LISTS, duplicateColumns, parseCustomList, sortRangeCommand } from "./sort";

const v = (display: string, date?: [number, number, number]): FilterValue => ({ display, count: 1, ...(date ? { date } : {}) });
const VALUES = [v("2024-01-05", [2024, 1, 5]), v("2024-01-20", [2024, 1, 20]), v("2024-02-03", [2024, 2, 3]), v("2025-03-01", [2025, 3, 1]), v("n/a"), v("")];

describe("date tree", () => {
  it("groups dates by year, month and day; other values stay flat", () => {
    const { years, others } = dateTree(VALUES);
    expect(years.map((y) => y.key)).toEqual(["2024", "2025"]);
    expect(years[0]!.children.map((m) => m.key)).toEqual(["2024-1", "2024-2"]);
    expect(years[0]!.children[0]!.children.map((d) => d.day)).toEqual([5, 20]);
    expect(years[0]!.displays).toEqual(["2024-01-05", "2024-01-20", "2024-02-03"]);
    expect(others.map((o) => o.display)).toEqual(["n/a", ""]);
  });

  it("checked boxes become whole years, whole months or days", () => {
    const all = new Set(VALUES.map((x) => x.display));
    expect(dateTreeFilter(VALUES, all)).toBeNull();
    expect(dateTreeFilter(VALUES, new Set())).toBeUndefined();
    const some = new Set(["2024-01-05", "2024-01-20", "2025-03-01", ""]);
    expect(dateTreeFilter(VALUES, some)).toEqual({ kind: "dateGroups", groups: [{ year: 2024, month: 1 }, { year: 2025 }], values: [""] });
    expect(dateTreeFilter(VALUES, new Set(["2024-01-20"]))).toEqual({ kind: "dateGroups", groups: [{ year: 2024, month: 1, day: 20 }] });
    // Reopening ticks what the filter keeps.
    const f = { kind: "dateGroups" as const, groups: [{ year: 2024, month: 1 }], values: ["n/a"] };
    expect([...initialDateChecked(VALUES, f)].sort()).toEqual(["2024-01-05", "2024-01-20", "n/a"]);
  });
});

describe("sort levels", () => {
  it("colour, icon and custom-list levels; colour levels may repeat a column", () => {
    const range = { r0: 0, c0: 0, r1: 9, c1: 1 };
    const red = { kind: "rgb" as const, value: "FF0000" };
    const levels = [
      { col: 0, ascending: true, kind: "auto" as const, sortOn: { type: "cellColor" as const, color: red } },
      { col: 0, ascending: false, kind: "auto" as const, sortOn: { type: "icon" as const, set: "3Arrows" as const, icon: 2 } },
      { col: 0, ascending: true, kind: "numbers" as const, customList: BUILTIN_LISTS[2]! },
    ];
    expect(duplicateColumns(levels)).toEqual([]);
    expect(sortRangeCommand(0, range, levels, true, false, true)).toEqual({
      type: "sortRange", sheet: 0, ...range, hasHeader: true, caseSensitive: false, columns: true,
      keys: [
        { col: 0, ascending: true, sortOn: { type: "cellColor", color: red } },
        { col: 0, ascending: false, sortOn: { type: "icon", set: "3Arrows", icon: 2 } },
        { col: 0, ascending: true, kind: "numbers", customList: BUILTIN_LISTS[2] },
      ],
    });
    expect(duplicateColumns([...levels, { col: 0, ascending: true, kind: "auto" }])).toEqual([0]);
    expect(parseCustomList("High, Medium\nLow,,")).toEqual(["High", "Medium", "Low"]);
  });
});

describe("sort and filter by the selected cell", () => {
  async function readyStore() {
    const core = new FakeCalcCore();
    const store = new CalcStore(new CalcApi(new FakeBackend(core)));
    await store.init();
    for (const [r, x] of ["Fruit", "apple", "pear", "fig"].entries()) await store.apply({ type: "setInput", sheet: 0, row: r, col: 0, input: x });
    core.log.length = 0;
    return { store, core };
  }
  const applied = (log: Request[]) => log.flatMap((r) => (r.type === "apply" ? [r.command] : []));

  it("filters by the value, creating the AutoFilter over the region first", async () => {
    const { store, core } = await readyStore();
    store.select({ anchor: { row: 2, col: 0 }, focus: { row: 2, col: 0 } });
    await store.filterBySelected("value");
    expect(applied(core.log)).toEqual([
      {
        type: "compound",
        commands: [
          { type: "setAutoFilter", sheet: 0, range: { r0: 0, c0: 0, r1: 3, c1: 0 } },
          { type: "setFilterColumn", sheet: 0, col: 0, filter: { kind: "values", values: ["pear"] } },
        ],
      },
    ]);
    // Inside the AutoFilter: only the column filter.
    core.log.length = 0;
    await store.filterBySelected("color");
    expect(applied(core.log)).toEqual([{ type: "setFilterColumn", sheet: 0, col: 0, filter: { kind: "color" } }]);
    // No icon: nothing.
    core.log.length = 0;
    await store.filterBySelected("icon");
    expect(applied(core.log)).toEqual([]);
  });

  it("puts the selected cell's fill on top", async () => {
    const { store, core } = await readyStore();
    await store.apply({ type: "applyStyle", sheet: 0, r0: 2, c0: 0, r1: 2, c1: 0, patch: { fill: { kind: "solid", color: { kind: "rgb", value: "FFFF00" } } } });
    core.log.length = 0;
    store.select({ anchor: { row: 2, col: 0 }, focus: { row: 2, col: 0 } });
    expect(store.activeCellLook().fill).toEqual({ kind: "rgb", value: "FFFF00" });
    await store.sortBySelected("color");
    expect(applied(core.log)).toEqual([
      {
        // All text: Excel's header guess says no header.
        type: "sortRange", sheet: 0, r0: 0, c0: 0, r1: 3, c1: 0, hasHeader: false, caseSensitive: false,
        keys: [{ col: 0, ascending: true, sortOn: { type: "cellColor", color: { kind: "rgb", value: "FFFF00" } } }],
      },
    ]);
  });
});
