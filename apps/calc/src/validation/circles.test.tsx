// P9-C5: Circle Invalid Data – the ellipse geometry, the store's circles
// (shown on request, dropped when a cell is corrected, cleared), and the
// Data Validation ▾ menu.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import App from "../App";
import { CalcApi } from "../backend/calcApi";
import { FakeBackend, FakeCalcCore } from "../dev/fakeBackend";
import type { DataValidation } from "../generated/DataValidation";
import { CalcStore } from "../state/store";
import { circleBox, paintValidationCircles } from "./circles";

const whole: DataValidation = {
  ranges: [{ r0: 0, c0: 0, r1: 9, c1: 0 }], kind: { type: "whole", op: "between", f1: "1", f2: "9" },
  allowBlank: true, showDropdown: false, showInput: true, showError: true, errorStyle: "stop",
};

async function readyStore() {
  const core = new FakeCalcCore();
  const store = new CalcStore(new CalcApi(new FakeBackend(core)));
  await store.init();
  return { store, core };
}

describe("validation circles", () => {
  it("an ellipse a little larger than the cell", () => {
    expect(circleBox({ x: 64, y: 20, w: 64, h: 20 })).toEqual({ cx: 96, cy: 30, rx: 36, ry: 13 });
    const calls: string[] = [];
    const ctx = {
      save: () => calls.push("save"), restore: () => calls.push("restore"), beginPath: () => {}, stroke: () => calls.push("stroke"),
      ellipse: (...a: number[]) => calls.push(`ellipse ${a.slice(0, 4).join(",")}`), strokeStyle: "", lineWidth: 0,
    } as unknown as CanvasRenderingContext2D;
    paintValidationCircles(ctx, [{ r0: 0, c0: 1, r1: 0, c1: 1 }, { r0: 99, c0: 0, r1: 99, c1: 0 }], (r, c) => (r < 50 ? { x: 64 * c, y: 20 * r, w: 64, h: 20 } : null));
    expect(calls).toEqual(["save", "ellipse 96,10,36,13", "stroke", "restore"]);
  });

  it("Circle Invalid Data circles failing cells; a correction removes its circle; Clear removes all", async () => {
    const { store, core } = await readyStore();
    await store.apply({ type: "setValidation", sheet: 0, validation: whole });
    for (const [r, v] of [[0, "5"], [1, "50"], [2, "x"]] as const) await store.apply({ type: "setInput", sheet: 0, row: r, col: 0, input: v });
    await store.circleInvalidData();
    expect(store.getState().circles).toEqual({ sheet: 0, cells: [{ r0: 1, c0: 0, r1: 1, c1: 0 }, { r0: 2, c0: 0, r1: 2, c1: 0 }] });
    await store.apply({ type: "setInput", sheet: 0, row: 1, col: 0, input: "7" });
    await waitFor(() => expect(store.getState().circles?.cells).toEqual([{ r0: 2, c0: 0, r1: 2, c1: 0 }]));
    // A new invalid entry is not circled until the next Circle Invalid Data.
    await store.apply({ type: "setInput", sheet: 0, row: 3, col: 0, input: "99" });
    await new Promise((r) => setTimeout(r, 20));
    expect(store.getState().circles?.cells).toHaveLength(1);
    expect(core.log.filter((r) => r.type === "invalidCells").length).toBeGreaterThan(1);
    store.clearValidationCircles();
    expect(store.getState().circles).toBeNull();
  });
});

describe("Data › Data Validation ▾", () => {
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

  it("the menu circles invalid data and clears the circles (the grid shows them)", async () => {
    const core = new FakeCalcCore();
    render(<App backend={new FakeBackend(core)} />);
    await screen.findByRole("tab", { name: "Sheet1" });
    await act(async () => {
      core.handle({ type: "apply", command: { type: "setValidation", sheet: 0, validation: whole } });
      core.handle({ type: "apply", command: { type: "setInput", sheet: 0, row: 4, col: 0, input: "0" } });
    });
    fireEvent.click(screen.getByRole("tab", { name: "Data" }));
    fireEvent.click(screen.getByRole("button", { name: "Data Validation options" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Circle Invalid Data" }));
    await waitFor(() => expect(screen.getByTestId("grid-cells").getAttribute("data-circles")).toBe("4,0"));
    fireEvent.click(screen.getByRole("button", { name: "Data Validation options" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Clear Validation Circles" }));
    await waitFor(() => expect(screen.getByTestId("grid-cells").getAttribute("data-circles")).toBe(""));
  });
});
