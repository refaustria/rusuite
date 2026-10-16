// Charts through the real App with the fake backend: ribbon, dialogs, keys → commands.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import App from "../App";
import { FakeBackend, FakeCalcCore } from "../dev/fakeBackend";
import type { Request } from "../generated/Request";
import { setLocale } from "@rusuite/ui-shared";
import type { CalcStore } from "../state/store";

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  setLocale("en");
  localStorage.clear();
});

const applied = (log: Request[]) => log.flatMap((r) => (r.type === "apply" ? [r.command] : []));

async function setup() {
  const core = new FakeCalcCore();
  const backend = new FakeBackend(core);
  render(<App backend={backend} />);
  await screen.findByRole("tab", { name: "Sheet1" });
  await waitFor(() => expect(core.log.some((r) => r.type === "snapshot")).toBe(true));
  const grid = screen.getByTestId("grid");
  grid.focus();
  // The store is reachable through the dev tools hook (`window.__calc`).
  const store = (window as unknown as { __calc: { store: CalcStore } }).__calc.store;
  const rows = [["", "North", "South"], ["Q1", "10", "20"], ["Q2", "25", "5"], ["Q3", "15", "8"], ["Q4", "30", "12"]];
  for (const [r, row] of rows.entries()) for (const [c, v] of row.entries()) if (v) await act(() => store.apply({ type: "setInput", sheet: 0, row: r, col: c, input: v }));
  return { core, grid, store };
}

async function insertColumnChart(core: FakeCalcCore, store: CalcStore) {
  act(() => store.select({ anchor: { row: 0, col: 0 }, focus: { row: 4, col: 2 } }));
  fireEvent.click(screen.getByRole("tab", { name: "Insert" }));
  fireEvent.click(screen.getByRole("button", { name: "Column or Bar Chart" }));
  fireEvent.click(within(screen.getByTestId("chart-gallery-columnBar")).getByRole("button", { name: "Clustered Column" }));
  await waitFor(() => expect(store.charts.selected).not.toBeNull());
  await screen.findByRole("tab", { name: "Chart Design" });
  return core.sheets[0]!.charts[0]!;
}

describe("Calc charts UI", () => {
  it("Insert › Clustered Column adds the recommended chart right of the selection and selects it", async () => {
    const { core, store } = await setup();
    core.log.length = 0;
    const obj = await insertColumnChart(core, store);
    const add = applied(core.log).find((c) => c.type === "addChart")!;
    expect(add).toMatchObject({ type: "addChart", sheet: 0, chart: { kind: { type: "bar", direction: "column", grouping: "clustered" }, gapWidth: 219, overlap: -27 } });
    expect(add.type === "addChart" && add.anchor).toMatchObject({ type: "twoCell", from: { col: 4, row: 0 } });
    expect(obj.chart.series).toHaveLength(2);
    expect(screen.getByRole("tab", { name: "Chart Design" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "Format" })).toBeTruthy();
    // The data is fetched for drawing.
    await waitFor(() => expect(store.charts.frames(0)[0]!.scene).not.toBeNull());
  });

  it("Delete removes the selected chart; Esc deselects; the tabs disappear", async () => {
    const { core, store, grid } = await setup();
    await insertColumnChart(core, store);
    fireEvent.keyDown(grid, { key: "Escape" });
    expect(store.charts.selected).toBeNull();
    await waitFor(() => expect(screen.queryByRole("tab", { name: "Chart Design" })).toBeNull());
    act(() => store.charts.select(0, 1));
    core.log.length = 0;
    fireEvent.keyDown(grid, { key: "Delete" });
    await waitFor(() => expect(applied(core.log)).toEqual([{ type: "removeChart", sheet: 0, id: 1 }]));
    expect(core.sheets[0]!.charts).toHaveLength(0);
  });

  it("Change Chart Type… → Pie sends updateChart with a pie", async () => {
    const { core, store } = await setup();
    await insertColumnChart(core, store);
    core.log.length = 0;
    fireEvent.click(screen.getByRole("button", { name: "Change Chart Type" }));
    const dialog = await screen.findByTestId("change-chart-type");
    fireEvent.click(within(dialog).getByRole("option", { name: "Pie" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "OK" }));
    await waitFor(() => expect(applied(core.log)[0]).toMatchObject({ type: "updateChart", id: 1, chart: { kind: { type: "pie" }, varyColors: true } }));
  });

  it("Select Data: remove a series, OK → setChartSeries; Switch Row/Column → four series", async () => {
    const { core, store } = await setup();
    await insertColumnChart(core, store);
    core.log.length = 0;
    fireEvent.click(screen.getByRole("button", { name: "Select Data" }));
    const dialog = await screen.findByTestId("select-data");
    await waitFor(() => expect(within(dialog).getAllByRole("option").map((o) => o.textContent)).toEqual(["North", "South"]));
    fireEvent.click(within(dialog).getAllByRole("option")[1]!);
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "OK" }));
    await waitFor(() => expect(applied(core.log)[0]).toMatchObject({ type: "setChartSeries", id: 1, series: [{ values: { formula: "Sheet1!$B$2:$B$5" } }] }));
    await waitFor(() => expect(store.charts.get(0, 1)?.chart.series).toHaveLength(1));
    core.log.length = 0;
    act(() => store.charts.select(0, 1));
    await act(() => store.charts.switchRowCol());
    await waitFor(() => expect(applied(core.log)[0]).toMatchObject({ type: "setChartSeries", categories: { formula: "Sheet1!$B$1" } }));
  });

  it("Add Chart Element › Legend › Right and Quick Layout send updateChart", async () => {
    const { core, store } = await setup();
    await insertColumnChart(core, store);
    core.log.length = 0;
    fireEvent.click(screen.getByRole("button", { name: "Add Chart Element" }));
    fireEvent.click(within(screen.getByTestId("chart-element-menu")).getByRole("menuitem", { name: "Legend" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Right" }));
    await waitFor(() => expect(applied(core.log)[0]).toMatchObject({ type: "updateChart", chart: { legend: { position: "right" } } }));
    core.log.length = 0;
    fireEvent.click(screen.getByRole("button", { name: "Quick Layout" }));
    fireEvent.click(screen.getByRole("button", { name: "Layout 4" }));
    await waitFor(() => expect(applied(core.log)[0]).toMatchObject({ type: "updateChart", chart: { legend: { position: "bottom" } } }));
    expect(applied(core.log)[0]!.type === "updateChart" && "title" in (applied(core.log)[0] as { chart: object }).chart).toBe(false);
  });

  it("Move Chart… to a new sheet adds the sheet and moves the chart in one compound", async () => {
    const { core, store } = await setup();
    await insertColumnChart(core, store);
    core.log.length = 0;
    fireEvent.click(screen.getByRole("button", { name: "Move Chart" }));
    fireEvent.click(screen.getByRole("radio", { name: /New sheet/ }));
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    await waitFor(() => expect(core.sheets).toHaveLength(2));
    await waitFor(() => expect(core.sheets.find((s) => s.name === "Chart1")?.charts).toHaveLength(1));
    expect(core.sheets.find((s) => s.name === "Sheet1")!.charts).toHaveLength(0);
    expect(applied(core.log).map((c) => c.type)).toEqual(["addSheet", "compound"]);
  });

  it("copy and paste duplicate a chart; the Format pane edits the gap width", async () => {
    const { core, store, grid } = await setup();
    await insertColumnChart(core, store);
    const data = new Map<string, string>();
    const clip = { setData: (k: string, v: string) => data.set(k, v), getData: (k: string) => data.get(k) ?? "" };
    fireEvent.copy(grid, { clipboardData: clip });
    expect(data.get("text/plain")).toBe("Chart 1");
    act(() => store.select({ anchor: { row: 10, col: 0 }, focus: { row: 10, col: 0 } }));
    fireEvent.paste(grid, { clipboardData: clip });
    await waitFor(() => expect(core.sheets[0]!.charts).toHaveLength(2));
    act(() => {
      store.charts.select(0, 2, { type: "series", series: 0 });
      store.charts.pane = true;
      store.notify();
    });
    const pane = await screen.findByTestId("chart-format-pane");
    core.log.length = 0;
    const gap = within(pane).getByTestId("gap-width");
    fireEvent.change(gap, { target: { value: "80" } });
    fireEvent.keyDown(gap, { key: "Enter" });
    await waitFor(() => expect(applied(core.log)[0]).toMatchObject({ type: "updateChart", id: 2, chart: { gapWidth: 80 } }));
  });
});
