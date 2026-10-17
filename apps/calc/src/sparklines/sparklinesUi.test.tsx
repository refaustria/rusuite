// P9-C6 through the real App with the fake backend: Insert › Sparklines, the
// Sparkline tab, the series formula in the formula bar, chart sheets, and the
// new Format pane sections.
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
  render(<App backend={new FakeBackend(core)} />);
  await screen.findByRole("tab", { name: "Sheet1" });
  await waitFor(() => expect(core.log.some((r) => r.type === "snapshot")).toBe(true));
  const store = (window as unknown as { __calc: { store: CalcStore } }).__calc.store;
  const rows = [["", "North", "South"], ["Q1", "10", "20"], ["Q2", "25", "5"], ["Q3", "15", "8"], ["Q4", "30", "12"]];
  for (const [r, row] of rows.entries()) for (const [c, v] of row.entries()) if (v) await act(() => store.apply({ type: "setInput", sheet: 0, row: r, col: c, input: v }));
  return { core, store };
}

describe("Calc sparklines and charts round 2 UI", () => {
  it("Insert › Sparklines › Line creates a group; the Sparkline tab toggles points and styles", async () => {
    const { core, store } = await setup();
    act(() => store.select({ anchor: { row: 1, col: 1 }, focus: { row: 4, col: 2 } }));
    fireEvent.click(screen.getByRole("tab", { name: "Insert" }));
    fireEvent.click(screen.getByRole("button", { name: "Line" }));
    const dlg = await screen.findByTestId("sparkline-dialog");
    expect((within(dlg).getByTestId("spark-data") as HTMLInputElement).value).toBe("B2:C5");
    fireEvent.change(within(dlg).getByTestId("spark-location"), { target: { value: "B7:C7" } });
    core.log.length = 0;
    fireEvent.click(within(dlg).getByRole("button", { name: "OK" }));
    await waitFor(() => expect(applied(core.log)).toEqual([
      { type: "setSparklineGroups", sheet: 0, groups: [{ kind: "line", sparklines: [{ row: 6, col: 1, data: "Sheet1!B2:B5" }, { row: 6, col: 2, data: "Sheet1!C2:C5" }] }] },
    ]));
    // The Sparkline tab shows on a sparkline cell.
    act(() => store.select({ anchor: { row: 6, col: 1 }, focus: { row: 6, col: 1 } }));
    await waitFor(() => expect(store.sparklines.views(0)).toHaveLength(1));
    const tab = await screen.findByRole("tab", { name: "Sparkline" });
    fireEvent.click(tab);
    core.log.length = 0;
    fireEvent.click(await screen.findByTestId("spark-high"));
    await waitFor(() => expect(applied(core.log)[0]).toMatchObject({ type: "setSparklineGroups", groups: [{ high: true }] }));
    // A mismatching location is refused in the dialog.
    fireEvent.click(screen.getByRole("tab", { name: "Insert" }));
    fireEvent.click(screen.getByRole("button", { name: "Column" }));
    const d2 = await screen.findByTestId("sparkline-dialog");
    fireEvent.change(within(d2).getByTestId("spark-data"), { target: { value: "B2:C5" } });
    fireEvent.change(within(d2).getByTestId("spark-location"), { target: { value: "E1:F2" } });
    fireEvent.click(within(d2).getByRole("button", { name: "OK" }));
    expect(await within(d2).findByRole("alert")).toBeTruthy();
  });

  it("a selected series shows =SERIES(…) in the formula bar; an edit sends setChartSeries", async () => {
    const { core, store } = await setup();
    act(() => store.select({ anchor: { row: 0, col: 0 }, focus: { row: 4, col: 2 } }));
    fireEvent.click(screen.getByRole("tab", { name: "Insert" }));
    fireEvent.click(screen.getByRole("button", { name: "Column or Bar Chart" }));
    fireEvent.click(within(screen.getByTestId("chart-gallery-columnBar")).getByRole("button", { name: "Clustered Column" }));
    await waitFor(() => expect(store.charts.selected).not.toBeNull());
    act(() => store.charts.select(0, 1, { type: "series", series: 1 }));
    const field = (await screen.findByTestId("series-formula")) as HTMLInputElement;
    expect(field.value).toBe("=SERIES(Sheet1!$C$1,Sheet1!$A$2:$A$5,Sheet1!$C$2:$C$5,2)");
    core.log.length = 0;
    fireEvent.change(field, { target: { value: "=SERIES(Sheet1!$C$1,Sheet1!$A$2:$A$5,Sheet1!$C$2:$C$4,1)" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(applied(core.log)[0]).toMatchObject({ type: "setChartSeries", series: [{ values: { formula: "Sheet1!$C$2:$C$4" } }, { values: { formula: "Sheet1!$B$2:$B$5" } }] }));
  });

  it("Move Chart › New sheet makes a chart sheet: the tab opens with its chart selected", async () => {
    const { core, store } = await setup();
    act(() => store.select({ anchor: { row: 0, col: 0 }, focus: { row: 4, col: 2 } }));
    fireEvent.click(screen.getByRole("tab", { name: "Insert" }));
    fireEvent.click(screen.getByRole("button", { name: "Column or Bar Chart" }));
    fireEvent.click(within(screen.getByTestId("chart-gallery-columnBar")).getByRole("button", { name: "Clustered Column" }));
    await waitFor(() => expect(store.charts.selected).not.toBeNull());
    await screen.findByRole("tab", { name: "Chart Design" });
    core.log.length = 0;
    fireEvent.click(await screen.findByRole("button", { name: "Move Chart" }));
    fireEvent.click(screen.getByRole("radio", { name: /New sheet/ }));
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    await waitFor(() => expect(core.sheets.find((s) => s.name === "Chart1")?.chartSheet).toBe(true));
    const compound = applied(core.log).find((c) => c.type === "compound");
    expect(compound?.type === "compound" && compound.commands.map((c) => c.type)).toEqual(["setChartSheet", "addChart", "removeChart"]);
    const add = compound?.type === "compound" ? compound.commands[1] : null;
    expect(add?.type === "addChart" && add.anchor.type).toBe("absolute");
    await waitFor(() => expect(store.isChartSheet(store.getState().activeSheet)).toBe(true));
    await waitFor(() => expect(store.charts.selected?.sheet).toBe(store.getState().activeSheet));
    // The chart fills the grid area, and the view hides headings and gridlines.
    expect(store.sheetView().showHeadings).toBe(false);
    expect(store.charts.frames(store.getState().activeSheet)[0]!.rect).toMatchObject({ x: 0, y: 0 });
  });

  it("the Format pane's chart area gradient and text sections send updateChart", async () => {
    const { core, store } = await setup();
    act(() => store.select({ anchor: { row: 0, col: 0 }, focus: { row: 4, col: 2 } }));
    fireEvent.click(screen.getByRole("tab", { name: "Insert" }));
    fireEvent.click(screen.getByRole("button", { name: "Column or Bar Chart" }));
    fireEvent.click(within(screen.getByTestId("chart-gallery-columnBar")).getByRole("button", { name: "Clustered Column" }));
    await waitFor(() => expect(store.charts.selected).not.toBeNull());
    act(() => {
      store.charts.select(0, 1, null);
      store.charts.pane = true;
      store.notify();
    });
    const pane = await screen.findByTestId("chart-format-pane");
    core.log.length = 0;
    fireEvent.click(within(within(pane).getByTestId("chart-fill")).getByRole("radio", { name: "Gradient fill" }));
    await waitFor(() => expect(applied(core.log)[0]).toMatchObject({ type: "updateChart", chart: { chartArea: { fill: { type: "gradient", angle: 90 } } } }));
    act(() => {
      store.charts.select(0, 1, { type: "axis", axis: "cat" });
      store.notify();
    });
    const angle = await within(await screen.findByTestId("chart-format-pane")).findByTestId("text-angle");
    core.log.length = 0;
    fireEvent.change(angle, { target: { value: "-45" } });
    fireEvent.keyDown(angle, { key: "Enter" });
    await waitFor(() => expect(applied(core.log)[0]).toMatchObject({ type: "updateChart", chart: { axes: { cat: { textFormat: { rotation: -45 } } } } }));
  });
});
