// P9-C2 through the real App: Flash Fill (Ctrl+E, the greyed preview and
// Enter), Consolidate (dialog → command) and Auto Outline / Outline
// settings (ribbon → command).
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import App from "../App";
import { FakeBackend, FakeCalcCore } from "../dev/fakeBackend";
import type { CalcCommand } from "../generated/CalcCommand";
import type { Request } from "../generated/Request";
import { cellSelection } from "../grid/Selection";
import type { CalcStore } from "../state/store";
import { consolidateCommand, refRect } from "./ConsolidateDialog";

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
});
afterEach(() => cleanup());

const names: CalcCommand[] = ["Ada Lovelace", "Alan Turing", "Grace Hopper", "Linus Torvalds"].map((v, i) => ({ type: "setInput", sheet: 0, row: i, col: 0, input: v }));

async function setup(seed: CalcCommand[]) {
  const core = new FakeCalcCore();
  render(<App backend={new FakeBackend(core)} />);
  await screen.findByRole("tab", { name: "Sheet1" });
  await waitFor(() => expect(core.log.some((r) => r.type === "snapshot")).toBe(true));
  const store = (window as unknown as { __calc: { store: CalcStore } }).__calc.store;
  for (const c of seed) await act(() => store.apply(c));
  core.log.length = 0;
  const grid = screen.getByTestId("grid");
  grid.focus();
  return { core, store, grid };
}

const applied = (log: Request[]): CalcCommand[] => log.flatMap((r) => (r.type === "apply" ? [r.command] : []));

describe("Flash Fill in the App", () => {
  it("Ctrl+E fills first names from one example", async () => {
    const { core, store, grid } = await setup([...names, { type: "setInput", sheet: 0, row: 0, col: 1, input: "Ada" }]);
    act(() => store.select(cellSelection(1, 1)));
    fireEvent.keyDown(grid, { key: "e", ctrlKey: true });
    await waitFor(() =>
      expect(applied(core.log)).toEqual([{ type: "flashFill", sheet: 0, col: 1, cells: [{ row: 1, input: "Alan" }, { row: 2, input: "Grace" }, { row: 3, input: "Linus" }] }]),
    );
    expect(await screen.findByText("Flash Fill changed 3 cells")).toBeTruthy();
  });

  it("a second example shows greyed suggestions; Enter accepts them", async () => {
    const { core, store, grid } = await setup([...names, { type: "setInput", sheet: 0, row: 0, col: 1, input: "Lovelace" }]);
    act(() => store.select(cellSelection(1, 1)));
    act(() => store.beginEdit("Turing"));
    await act(() => store.commitEdit(1, 0));
    const shown = await screen.findAllByTestId("flash-suggestion");
    expect(shown.map((s) => s.textContent)).toEqual(["Hopper", "Torvalds"]);
    core.log.length = 0;
    fireEvent.keyDown(grid, { key: "Enter" });
    await waitFor(() => expect(applied(core.log)).toEqual([{ type: "flashFill", sheet: 0, col: 1, cells: [{ row: 2, input: "Hopper" }, { row: 3, input: "Torvalds" }] }]));
    await waitFor(() => expect(screen.queryAllByTestId("flash-suggestion")).toHaveLength(0));
  });

  it("Esc drops the suggestions; no pattern explains why", async () => {
    const { core, store, grid } = await setup([...names, { type: "setInput", sheet: 0, row: 0, col: 1, input: "Lovelace" }]);
    act(() => store.select(cellSelection(1, 1)));
    act(() => store.beginEdit("Turing"));
    await act(() => store.commitEdit(1, 0));
    await screen.findAllByTestId("flash-suggestion");
    fireEvent.keyDown(grid, { key: "Escape" });
    await waitFor(() => expect(screen.queryAllByTestId("flash-suggestion")).toHaveLength(0));
    act(() => store.select(cellSelection(10, 5)));
    core.log.length = 0;
    fireEvent.keyDown(grid, { key: "e", ctrlKey: true });
    expect(await screen.findByText(/Flash Fill did not find a pattern/)).toBeTruthy();
    expect(applied(core.log)).toEqual([]);
  });
});

describe("Consolidate and Auto Outline", () => {
  it("resolves references and builds the command", () => {
    const sheets = [{ id: 0, name: "Q1" }, { id: 3, name: "My Sheet" }];
    expect(refRect("Q1!$A$1:$B$3", sheets, 0)).toEqual({ sheet: 0, r0: 0, c0: 0, r1: 2, c1: 1 });
    expect(refRect("'My Sheet'!A2:C4", sheets, 0)).toEqual({ sheet: 3, r0: 1, c0: 0, r1: 3, c1: 2 });
    expect(refRect("B2", sheets, 3)).toEqual({ sheet: 3, r0: 1, c0: 1, r1: 1, c1: 1 });
    expect(refRect("Nope!A1", sheets, 0)).toBeNull();
    const st = { function: "average" as const, refs: ["Q1!$A$1:$B$3", "'My Sheet'!A1:B3"], topRow: true, leftCol: false, links: true };
    expect(consolidateCommand(st, sheets, 3, 5, 6)).toEqual({
      type: "consolidate", sheet: 3, row: 5, col: 6, function: "average",
      sources: [{ sheet: 0, r0: 0, c0: 0, r1: 2, c1: 1 }, { sheet: 3, r0: 0, c0: 0, r1: 2, c1: 1 }], topRow: true, leftCol: false, links: true,
    });
    expect(consolidateCommand({ ...st, refs: [] }, sheets, 0, 0, 0)).toBeNull();
  });

  it("the Consolidate dialog adds references and sends the command", async () => {
    const { core, store } = await setup([]);
    act(() => store.select(cellSelection(9, 3)));
    fireEvent.click(screen.getByRole("tab", { name: "Data" }));
    fireEvent.click(screen.getByRole("button", { name: "Consolidate" }));
    const dlg = await screen.findByRole("dialog", { name: "Consolidate" });
    fireEvent.change(within(dlg).getByLabelText("Function:"), { target: { value: "max" } });
    fireEvent.change(within(dlg).getByTestId("consolidate-ref"), { target: { value: "=Sheet1!$A$1:$B$4" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "Add" }));
    expect(within(dlg).getByRole("option", { name: "Sheet1!$A$1:$B$4" })).toBeTruthy();
    fireEvent.click(within(dlg).getByLabelText("Top row"));
    fireEvent.click(within(dlg).getByRole("button", { name: "OK" }));
    await waitFor(() =>
      expect(applied(core.log)).toEqual([
        { type: "consolidate", sheet: 0, row: 9, col: 3, function: "max", sources: [{ sheet: 0, r0: 0, c0: 0, r1: 3, c1: 1 }], topRow: true, leftCol: false, links: false },
      ]),
    );
    // The references stay for the next use.
    expect(store.consolidateState.refs).toEqual(["Sheet1!$A$1:$B$4"]);
  });

  it("Group › Auto Outline and the settings' Create send autoOutline", async () => {
    const { core, store } = await setup([]);
    act(() => store.select(cellSelection(2, 2)));
    fireEvent.click(screen.getByRole("tab", { name: "Data" }));
    fireEvent.click(screen.getByRole("button", { name: "Group" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Auto Outline" }));
    await waitFor(() => expect(applied(core.log)).toEqual([{ type: "autoOutline", sheet: 0, r0: 2, c0: 2, r1: 2, c1: 2 }]));
    core.log.length = 0;
    fireEvent.click(screen.getByRole("button", { name: "Outline Settings" }));
    const dlg = await screen.findByRole("dialog", { name: "Settings" });
    fireEvent.click(within(dlg).getByLabelText("Summary rows below detail"));
    fireEvent.click(within(dlg).getByRole("button", { name: "Create" }));
    await waitFor(() =>
      expect(applied(core.log)).toEqual([
        { type: "setOutlineProps", sheet: 0, props: { summaryBelow: false, summaryRight: true } },
        { type: "autoOutline", sheet: 0, r0: 2, c0: 2, r1: 2, c1: 2 },
      ]),
    );
  });
});
