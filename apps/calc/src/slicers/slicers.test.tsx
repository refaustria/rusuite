// P9-C2: slicers – Excel's click rules, the button layout, the styles and
// the UI through the real App (Insert Slicers, clicks, Multi-Select, Clear
// Filter, the Slicer tab, Delete).
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import App from "../App";
import { FakeBackend, FakeCalcCore } from "../dev/fakeBackend";
import type { CalcCommand } from "../generated/CalcCommand";
import type { Request } from "../generated/Request";
import type { SlicerItem } from "../generated/SlicerItem";
import type { SlicerView } from "../generated/SlicerView";
import type { CalcStore } from "../state/store";
import { cellSelection } from "../grid/Selection";
import { buttonLayout, buttonPx, isFiltered, nextSelection, slicerAnchor } from "./controller";
import { SLICER_STYLES, slicerColors, slicerStyleNumber } from "./styles";

const items = (sel: boolean[]): SlicerItem[] => ["East", "North", "West"].map((name, i) => ({ name, selected: sel[i]!, hasData: true }));

describe("slicer clicks", () => {
  it("a plain click selects that item alone", () => {
    expect(nextSelection(items([true, true, true]), "North", false)).toEqual(["North"]);
    expect(nextSelection(items([false, true, false]), "West", false)).toEqual(["West"]);
    expect(nextSelection(items([false, true, false]), "North", false)).toEqual(["North"]);
  });
  it("Multi-Select with nothing filtered deselects the clicked item", () => {
    expect(nextSelection(items([true, true, true]), "North", true)).toEqual(["East", "West"]);
  });
  it("Multi-Select toggles; selecting the last missing item removes the filter", () => {
    expect(nextSelection(items([false, true, false]), "East", true)).toEqual(["North", "East"]);
    expect(nextSelection(items([true, true, false]), "West", true)).toBeNull();
  });
  it("the last selected item cannot be deselected", () => {
    expect(nextSelection(items([false, true, false]), "North", true)).toEqual(["North"]);
  });
  it("knows when it filters", () => {
    expect(isFiltered({ items: items([true, true, true]) } as SlicerView)).toBe(false);
    expect(isFiltered({ items: items([true, false, true]) } as SlicerView)).toBe(true);
  });
});

describe("slicer layout and styles", () => {
  const view = (columns?: number, rowHeight?: number): SlicerView => ({
    slicer: { id: 1, name: "Region", cache: "Slicer_Region", caption: "Region", style: "SlicerStyleLight1", anchor: slicerAnchor(0, 0), ...(columns ? { columns } : {}), ...(rowHeight ? { rowHeight } : {}) },
    source: { kind: "table", table: 1, column: 1 }, sort: "ascending", items: items([true, true, true]),
  });
  it("lays buttons out in columns with Excel's 0.26 in default height", () => {
    expect(buttonPx(view())).toBe(25);
    expect(buttonLayout(view(2), { x: 0, y: 0, w: 192, h: 265 })).toEqual({ cols: 2, w: 86, h: 25 });
    expect(buttonPx(view(1, 381000))).toBe(40);
  });
  it("anchors new slicers at Excel's default size", () => {
    expect(slicerAnchor(3, 4)).toEqual({ type: "oneCell", from: { col: 4, row: 3, colOffset: 0, rowOffset: 0 }, width: 1828800, height: 2524125 });
  });
  it("has the 14 built-in styles with distinct selected colours", () => {
    expect(SLICER_STYLES).toHaveLength(14);
    expect(slicerStyleNumber("SlicerStyleOther2")).toEqual({ family: "other", n: 2 });
    expect(slicerStyleNumber("SlicerStyleOther3")).toBeNull();
    expect(new Set(SLICER_STYLES.map((s) => slicerColors(s).on)).size).toBeGreaterThan(10);
    expect(slicerColors("SlicerStyleDark1").onText).toBe("#FFFFFF");
  });
});

// --- through the App ---------------------------------------------------------

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
});
afterEach(() => cleanup());

const seed: CalcCommand[] = [["Region", "Qty"], ["East", "2"], ["West", "3"], ["North", "4"]].flatMap((r, i) =>
  r.map((v, j): CalcCommand => ({ type: "setInput", sheet: 0, row: i, col: j, input: v })),
);

async function setup() {
  const core = new FakeCalcCore();
  render(<App backend={new FakeBackend(core)} />);
  await screen.findByRole("tab", { name: "Sheet1" });
  await waitFor(() => expect(core.log.some((r) => r.type === "snapshot")).toBe(true));
  const store = (window as unknown as { __calc: { store: CalcStore } }).__calc.store;
  for (const c of seed) await act(() => store.apply(c));
  await act(() => store.apply({ type: "createTable", sheet: 0, r0: 0, c0: 0, r1: 3, c1: 1, hasHeaders: true }));
  act(() => store.select(cellSelection(1, 0)));
  core.log.length = 0;
  return { core, store };
}

const applied = (log: Request[]): CalcCommand[] => log.flatMap((r) => (r.type === "apply" ? [r.command] : []));

describe("slicers in the App", () => {
  it("Insert Slicers → click → Multi-Select → Clear Filter → Delete", async () => {
    const { core, store } = await setup();
    fireEvent.click(screen.getByRole("tab", { name: "Insert" }));
    fireEvent.click(screen.getByRole("button", { name: "Slicer" }));
    const dlg = await screen.findByRole("dialog", { name: "Insert Slicers" });
    fireEvent.click(within(dlg).getByLabelText("Region"));
    fireEvent.click(within(dlg).getByRole("button", { name: "OK" }));
    const slicer = await screen.findByRole("group", { name: "Slicer Region" });
    const ins = applied(core.log)[0]!;
    expect(ins).toMatchObject({ type: "insertSlicers", sheet: 0, sources: [{ kind: "table", table: 1, column: 1 }], anchor: { type: "oneCell", from: { row: 0, col: 3 } } });
    // The new slicer is selected: the Slicer tab.
    expect(await screen.findByRole("tab", { name: "Slicer" })).toBeTruthy();
    core.log.length = 0;
    fireEvent.click(within(slicer).getByRole("button", { name: "West" }));
    await waitFor(() => expect(applied(core.log)).toEqual([{ type: "setSlicerSelection", cache: "Slicer_Region", selected: ["West"] }]));
    await waitFor(() => expect(within(screen.getByRole("group", { name: "Slicer Region" })).getByRole("button", { name: "East" }).getAttribute("aria-pressed")).toBe("false"));
    core.log.length = 0;
    fireEvent.click(within(screen.getByRole("group", { name: "Slicer Region" })).getByRole("button", { name: "Multi-Select" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Slicer Region" })).getByRole("button", { name: "East" }));
    await waitFor(() => expect(JSON.stringify(applied(core.log))).toBe(JSON.stringify([{ type: "setSlicerSelection", cache: "Slicer_Region", selected: ["West", "East"] }])));
    core.log.length = 0;
    // The last missing item: no filter.
    fireEvent.click(within(screen.getByRole("group", { name: "Slicer Region" })).getByRole("button", { name: "North" }));
    await waitFor(() => expect(applied(core.log)).toEqual([{ type: "setSlicerSelection", cache: "Slicer_Region" }]));
    await waitFor(() => expect((within(screen.getByRole("group", { name: "Slicer Region" })).getByRole("button", { name: "Clear Filter" }) as HTMLButtonElement).disabled).toBe(true));
    fireEvent.click(within(screen.getByRole("group", { name: "Slicer Region" })).getByRole("button", { name: "Multi-Select" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Slicer Region" })).getByRole("button", { name: "West" }));
    await waitFor(() => expect((within(screen.getByRole("group", { name: "Slicer Region" })).getByRole("button", { name: "Clear Filter" }) as HTMLButtonElement).disabled).toBe(false));
    core.log.length = 0;
    fireEvent.click(within(screen.getByRole("group", { name: "Slicer Region" })).getByRole("button", { name: "Clear Filter" }));
    await waitFor(() => expect(applied(core.log)).toEqual([{ type: "setSlicerSelection", cache: "Slicer_Region" }]));
    // The Slicer tab sets the columns; Delete removes the slicer.
    fireEvent.click(screen.getByRole("tab", { name: "Slicer" }));
    const cols = screen.getByTestId("slicer-columns");
    fireEvent.change(cols, { target: { value: "2" } });
    fireEvent.blur(cols);
    await waitFor(() => expect(applied(core.log).at(-1)).toEqual({ type: "updateSlicer", id: 1, patch: { columns: 2 } }));
    fireEvent.keyDown(screen.getByRole("group", { name: "Slicer Region" }), { key: "Delete" });
    await waitFor(() => expect(applied(core.log).at(-1)).toEqual({ type: "deleteSlicer", id: 1 }));
    await waitFor(() => expect(screen.queryByRole("group", { name: "Slicer Region" })).toBeNull());
    expect(store.slicers.selected).toBeNull();
  });

  it("Insert Slicer outside a table or pivot table explains why", async () => {
    const { store } = await setup();
    act(() => store.select(cellSelection(10, 10)));
    fireEvent.click(screen.getByRole("tab", { name: "Insert" }));
    fireEvent.click(screen.getByRole("button", { name: "Slicer" }));
    expect(await screen.findByText("Select a cell in a table or PivotTable to insert a slicer.")).toBeTruthy();
  });
});
