// P8-12 UI: the formula bar on spilled cells and the #SPILL! indicator.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import App from "./App";
import { FakeBackend, FakeCalcCore } from "./dev/fakeBackend";
import type { CellView } from "./generated/CellView";
import { cellSelection } from "./grid/Selection";
import type { CalcStore } from "./state/store";

const sizes = { clientWidth: 800, clientHeight: 400 };
const saved: Record<string, PropertyDescriptor | undefined> = {};
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
  for (const [k, v] of Object.entries(sizes)) {
    saved[k] = Object.getOwnPropertyDescriptor(HTMLElement.prototype, k);
    Object.defineProperty(HTMLElement.prototype, k, { configurable: true, get: () => v });
  }
});
afterAll(() => {
  for (const [k, d] of Object.entries(saved)) if (d) Object.defineProperty(HTMLElement.prototype, k, d);
});
afterEach(cleanup);

async function setup(cells: CellView[]) {
  const core = new FakeCalcCore();
  render(<App backend={new FakeBackend(core)} />);
  await screen.findByRole("tab", { name: "Sheet1" });
  await waitFor(() => expect(core.log.some((r) => r.type === "snapshot")).toBe(true));
  const store = (window as unknown as { __calc: { store: CalcStore } }).__calc.store;
  act(() => store.applyPatch({ sheets: null, cells: [{ sheet: 0, cells }], cols: [], rows: [], styles: null, cycle: null, structural: [] }));
  return { core, store };
}

const bar = () => screen.getByLabelText("Formula bar") as HTMLInputElement;

describe("spill UI", () => {
  it("a spilled cell shows the array formula greyed and read-only in the formula bar", async () => {
    const { store } = await setup([
      { row: 0, col: 0, input: "=SEQUENCE(2)", display: "1", kind: "number", style: 0, spill: { r0: 0, c0: 0, r1: 1, c1: 0 } },
      { row: 1, col: 0, input: "", display: "2", kind: "number", style: 0, spilled: [0, 0] },
    ]);
    act(() => store.select(cellSelection(1, 0)));
    expect(bar().value).toBe("=SEQUENCE(2)");
    expect(bar().readOnly).toBe(true);
    expect(bar().className).toContain("text-ui-muted");
    expect(bar().title).toBe("Spilled from A1: edit the formula there");
    fireEvent.focus(bar());
    expect(store.getState().edit).toBeNull();
    act(() => store.select(cellSelection(0, 0)));
    expect(bar().readOnly).toBe(false);
    expect(screen.queryByTestId("spill-indicator")).toBeNull();
  });

  it("a #SPILL! formula cell gets an indicator: tooltip, and Select obstructing cells", async () => {
    await setup([
      { row: 0, col: 0, input: "=SEQUENCE(3)", display: "#SPILL!", kind: "error", style: 0, spill: { r0: 0, c0: 0, r1: 2, c1: 0 } },
      { row: 2, col: 0, input: "x", display: "x", kind: "text", style: 0 },
    ]);
    expect(screen.getByTestId("spill-indicator")).toBeTruthy();
    const button = screen.getByRole("button", { name: "Spill error" });
    expect(button.title).toBe("Spill range isn't blank");
    fireEvent.click(button);
    expect(screen.getByTestId("spill-menu").textContent).toContain("Spill range isn't blank");
    fireEvent.click(screen.getByRole("menuitem", { name: "Select obstructing cells" }));
    expect(screen.getByTestId("cell-address").textContent).toBe("A3");
    expect(screen.queryByTestId("spill-indicator")).toBeNull();
  });
});
