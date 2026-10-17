// P9-C4 through the real App: the Calculation group (options, Calculate
// Now / Sheet, F9 / Shift+F9), the "Calculate" status, File › Options ›
// Formulas with the R1C1 reference style, Apply Names and Paste Names (F3).
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import App from "../App";
import { FakeBackend, FakeCalcCore } from "../dev/fakeBackend";
import type { CalcCommand } from "../generated/CalcCommand";
import type { Request } from "../generated/Request";
import type { CalcStore } from "../state/store";

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

async function setup(seed: CalcCommand[] = []) {
  const core = new FakeCalcCore();
  const backend = new FakeBackend(core);
  render(<App backend={backend} />);
  await screen.findByRole("tab", { name: "Sheet1" });
  await waitFor(() => expect(core.log.some((r) => r.type === "snapshot")).toBe(true));
  await waitFor(() => expect((screen.getByRole("button", { name: "Bold" }) as HTMLButtonElement).disabled).toBe(false));
  const store = (window as unknown as { __calc: { store: CalcStore } }).__calc.store;
  for (const c of seed) await act(() => store.apply(c));
  core.log.length = 0;
  const grid = screen.getByTestId("grid");
  grid.focus();
  return { core, grid, store };
}

const applied = (log: Request[]): CalcCommand[] => log.flatMap((r) => (r.type === "apply" ? [r.command] : []));
const tab = (name: string) => fireEvent.click(screen.getByRole("tab", { name }));
const bar = () => screen.getByLabelText("Formula bar") as HTMLInputElement;

describe("Formulas › Calculation", () => {
  it("switches to manual calculation from the options menu", async () => {
    const { core } = await setup();
    tab("Formulas");
    fireEvent.click(screen.getByRole("button", { name: "Calculation Options" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Manual" }));
    await waitFor(() =>
      expect(applied(core.log)).toEqual([{ type: "setCalcOptions", options: { mode: "manual", fullCalcOnLoad: true, r1c1: false } }]),
    );
    fireEvent.click(screen.getByRole("button", { name: "Calculation Options" }));
    expect(screen.getByRole("menuitemradio", { name: "Manual" }).getAttribute("aria-checked")).toBe("true");
  });

  it("Calculate Now / Sheet from the ribbon and with F9 / Shift+F9", async () => {
    const { core, grid } = await setup();
    tab("Formulas");
    fireEvent.click(screen.getByRole("button", { name: /^Calculate Now/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Calculate Sheet/ }));
    fireEvent.keyDown(grid, { key: "F9" });
    fireEvent.keyDown(grid, { key: "F9", shiftKey: true });
    await waitFor(() =>
      expect(applied(core.log)).toEqual([
        { type: "calculateNow" },
        { type: "calculateSheet", sheet: 0 },
        { type: "calculateNow" },
        { type: "calculateSheet", sheet: 0 },
      ]),
    );
  });

  it("shows Calculate in the status bar while cells await recalculation", async () => {
    const { core, store } = await setup();
    expect(screen.queryByTestId("calc-pending")).toBeNull();
    act(() => store.applyPatch({ ...emptyPatch(), calc: { options: { mode: "manual", fullCalcOnLoad: true, r1c1: false }, needsCalc: true } }));
    const pending = await screen.findByTestId("calc-pending");
    expect(pending.textContent).toBe("Calculate");
    fireEvent.click(pending);
    await waitFor(() => expect(applied(core.log)).toEqual([{ type: "calculateNow" }]));
    await waitFor(() => expect(screen.queryByTestId("calc-pending")).toBeNull());
  });
});

function emptyPatch() {
  return { sheets: null, cells: [], cols: [], rows: [], styles: null, cycle: null, structural: [] };
}

describe("R1C1 reference style", () => {
  it("is set in File › Options and shows and reads formulas in R1C1 style", async () => {
    const { core, grid, store } = await setup([
      { type: "setInput", sheet: 0, row: 0, col: 0, input: "5" },
      { type: "setInput", sheet: 0, row: 1, col: 1, input: "=A1*2" },
    ]);
    act(() => store.openDialog({ kind: "formulaOptions" }));
    const dialog = await screen.findByTestId("formula-options");
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "R1C1 reference style" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "OK" }));
    await waitFor(() =>
      expect(applied(core.log)).toEqual([{ type: "setCalcOptions", options: { mode: "automatic", fullCalcOnLoad: true, r1c1: true } }]),
    );
    core.log.length = 0;
    act(() => store.select({ anchor: { row: 1, col: 1 }, focus: { row: 1, col: 1 } } as never));
    await waitFor(() => expect(bar().value).toBe("=R[-1]C[-1]*2"));
    expect((screen.getByTestId("cell-address") as HTMLInputElement).value).toBe("R2C2");
    // An R1C1 entry is stored as A1.
    act(() => store.select({ anchor: { row: 2, col: 1 }, focus: { row: 2, col: 1 } } as never));
    fireEvent.focus(bar());
    fireEvent.change(bar(), { target: { value: "=R[-1]C+R1C1" } });
    fireEvent.keyDown(bar(), { key: "Enter" });
    await waitFor(() => expect(applied(core.log)).toEqual([{ type: "setInput", sheet: 0, row: 2, col: 1, input: "=B2+$A$1" }]));
    void grid;
  });
});

describe("Apply Names and Paste Names", () => {
  const named: CalcCommand[] = [
    { type: "defineName", def: { name: "Rate", refersTo: "Sheet1!$B$1" } },
    { type: "defineName", def: { name: "Data", refersTo: "Sheet1!$A$1:$A$3" } },
  ];

  it("Apply Names sends the chosen names", async () => {
    const { core } = await setup(named);
    tab("Formulas");
    fireEvent.click(screen.getByRole("button", { name: "Define Name options" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Apply Names…" }));
    const dialog = await screen.findByTestId("apply-names");
    fireEvent.click(within(dialog).getByRole("option", { name: "Rate" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "OK" }));
    await waitFor(() =>
      expect(applied(core.log)).toEqual([{ type: "applyNames", sheet: 0, r0: 0, c0: 0, r1: 0, c1: 0, names: ["Rate"], ignoreRelative: true }]),
    );
  });

  it("F3 pastes a name into the formula being edited, or Paste List writes the list", async () => {
    const { core, grid } = await setup(named);
    fireEvent.focus(bar());
    fireEvent.change(bar(), { target: { value: "=SUM()", selectionEnd: 5 } });
    fireEvent.keyDown(bar(), { key: "F3" });
    const dialog = await screen.findByTestId("paste-names");
    expect(within(dialog).getAllByRole("option").map((o) => o.textContent)).toEqual(["Data", "Rate"]);
    fireEvent.doubleClick(within(dialog).getByRole("option", { name: "Data" }));
    await waitFor(() => expect(bar().value).toBe("=SUM(Data)"));
    fireEvent.keyDown(bar(), { key: "Escape" });
    grid.focus();
    fireEvent.keyDown(grid, { key: "F3" });
    const again = await screen.findByTestId("paste-names");
    fireEvent.click(within(again).getByRole("button", { name: "Paste List" }));
    await waitFor(() => expect(applied(core.log)).toEqual([{ type: "pasteNameList", sheet: 0, row: 0, col: 0 }]));
  });
});
