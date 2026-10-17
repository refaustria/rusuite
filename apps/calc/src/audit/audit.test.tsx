// P9-C4 through the real App: background error checking (marks, the
// cell's error menu, the Error Checking dialog), Evaluate Formula, the
// Watch Window, and trace arrows that follow edits.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import App from "../App";
import { FakeBackend, FakeCalcCore } from "../dev/fakeBackend";
import type { CalcCommand } from "../generated/CalcCommand";
import type { Request } from "../generated/Request";
import type { CalcStore } from "../state/store";
import { cellSelection } from "../grid/Selection";
import { moveOrigin } from "./trace";

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
const text42: CalcCommand[] = [
  { type: "setInput", sheet: 0, row: 0, col: 0, input: "'42" },
  { type: "setInput", sheet: 0, row: 2, col: 1, input: "=1/0" },
];

describe("error checking", () => {
  it("flags numbers stored as text and fixes one from the cell's error menu", async () => {
    const { core, store } = await setup(text42);
    await waitFor(() => expect(store.audit.marks(0).map((i) => i.rule)).toEqual(["numberAsText", "errorValue"]));
    act(() => store.select(cellSelection(0, 0)));
    fireEvent.click(await screen.findByTestId("error-tag-button"));
    const menu = screen.getByTestId("error-menu");
    expect(menu.textContent).toContain("Number Stored as Text");
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Convert to Number" }));
    await waitFor(() =>
      expect(applied(core.log)).toEqual([{ type: "convertToNumber", sheet: 0, cells: [{ r0: 0, c0: 0, r1: 0, c1: 0 }] }]),
    );
    await waitFor(() => expect(store.audit.marks(0).map((i) => i.rule)).toEqual(["errorValue"]));
  });

  it("the Error Checking dialog walks the flagged cells; Ignore hides one", async () => {
    const { store } = await setup(text42);
    await waitFor(() => expect(store.audit.issuesOn(0).length).toBe(2));
    tab("Formulas");
    fireEvent.click(screen.getByRole("button", { name: "Error Checking" }));
    const dialog = await screen.findByTestId("error-checking");
    expect(within(dialog).getByTestId("error-cell").textContent).toBe("Error in cell Sheet1!A1");
    expect(within(dialog).getByTestId("error-title").textContent).toBe("Number Stored as Text");
    fireEvent.click(within(dialog).getByRole("button", { name: "Ignore Error" }));
    // Excel moves on to the next flagged cell.
    await waitFor(() => expect(within(dialog).getByTestId("error-cell").textContent).toBe("Error in cell Sheet1!B3"));
    expect(within(dialog).getByTestId("error-title").textContent).toBe("Error in Value");
    fireEvent.click(within(dialog).getByRole("button", { name: "Ignore Error" }));
    await waitFor(() => expect(within(dialog).getByTestId("error-done").textContent).toBe("The error check is complete for the entire sheet."));
    expect(store.audit.marks(0)).toEqual([]);
  });

  it("the rules and background checking are set in File › Options", async () => {
    const { core, store } = await setup(text42);
    act(() => store.openDialog({ kind: "formulaOptions" }));
    const dialog = await screen.findByTestId("formula-options");
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Numbers formatted as text or preceded by an apostrophe" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "OK" }));
    await waitFor(() => expect(store.audit.settings.rules).toEqual(["errorValue", "inconsistentFormula", "unlockedFormula"]));
    expect(JSON.parse(localStorage.getItem("rusuite.calc.errorChecking") ?? "{}").rules).not.toContain("numberAsText");
    await waitFor(() => expect(core.log.some((r) => r.type === "errorChecks" && !(r.rules ?? []).includes("numberAsText"))).toBe(true));
    // No settings change: no setCalcOptions command.
    expect(applied(core.log)).toEqual([]);
  });
});

describe("Evaluate Formula", () => {
  it("shows the next step underlined and evaluates to the result", async () => {
    const { store } = await setup([
      { type: "setInput", sheet: 0, row: 0, col: 0, input: "2" },
      { type: "setInput", sheet: 0, row: 0, col: 1, input: "=A1*3" },
    ]);
    act(() => store.select(cellSelection(0, 1)));
    tab("Formulas");
    fireEvent.click(screen.getByRole("button", { name: "Evaluate Formula" }));
    const dialog = await screen.findByTestId("evaluate-formula");
    expect(within(dialog).getByTestId("eval-ref").textContent).toBe("Sheet1!$B$1");
    expect(within(dialog).getByTestId("eval-next").textContent).toBe("A1*3");
    fireEvent.click(within(dialog).getByRole("button", { name: "Evaluate" }));
    await waitFor(() => expect(within(dialog).getByTestId("eval-text").textContent).toBe("6"));
    expect(within(dialog).getByRole("button", { name: "Restart" })).toBeTruthy();
  });
});

describe("Watch Window", () => {
  it("adds the selection and shows live values", async () => {
    const { core, store } = await setup([{ type: "setInput", sheet: 0, row: 0, col: 0, input: "5" }]);
    tab("Formulas");
    fireEvent.click(screen.getByRole("button", { name: "Watch Window" }));
    const pane = await screen.findByTestId("watch-window");
    act(() => store.select(cellSelection(0, 0)));
    fireEvent.click(within(pane).getByRole("button", { name: "Add Watch…" }));
    await waitFor(() => expect(within(pane).getAllByTestId("watch-value").map((v) => v.textContent)).toEqual(["5"]));
    await act(() => store.apply({ type: "setInput", sheet: 0, row: 0, col: 0, input: "7" }));
    await waitFor(() => expect(within(pane).getAllByTestId("watch-value").map((v) => v.textContent)).toEqual(["7"]));
    expect(core.log.filter((r) => r.type === "watchCells").length).toBeGreaterThanOrEqual(2);
  });
});

describe("trace arrows follow edits", () => {
  it("moves traced cells with inserts and deletes", () => {
    const o = { kind: "precedents" as const, sheet: 0, cell: { row: 4, col: 2 } };
    expect(moveOrigin(o, { sheet: 0, kind: "insertRows", at: 2, count: 3 })?.cell).toEqual({ row: 7, col: 2 });
    expect(moveOrigin(o, { sheet: 0, kind: "deleteCols", at: 0, count: 1 })?.cell).toEqual({ row: 4, col: 1 });
    expect(moveOrigin(o, { sheet: 0, kind: "deleteRows", at: 4, count: 1 })).toBeNull();
    expect(moveOrigin(o, { sheet: 1, kind: "insertRows", at: 0, count: 1 })).toBe(o);
  });

  it("fetches the arrows again after an edit", async () => {
    const { core, store } = await setup([
      { type: "setInput", sheet: 0, row: 0, col: 0, input: "1" },
      { type: "setInput", sheet: 0, row: 0, col: 1, input: "=A1" },
    ]);
    act(() => store.select(cellSelection(0, 1)));
    await act(() => store.trace.precedents());
    expect(store.trace.arrows.length).toBe(1);
    core.log.length = 0;
    await act(() => store.apply({ type: "setInput", sheet: 0, row: 0, col: 1, input: "=A1+C1" }));
    await waitFor(() => expect(core.log.some((r) => r.type === "precedents")).toBe(true));
    store.trace.clear();
    expect(store.trace.origins).toEqual([]);
  });
});
