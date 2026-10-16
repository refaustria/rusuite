// P8-44 pre-release fixes: circular reference status (C-05), Backspace (C-21),
// column widening on entry (C-23), formats inherited by formulas (C-19).
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import App from "./App";
import { FakeBackend, FakeCalcCore } from "./dev/fakeBackend";
import type { Request } from "./generated/Request";
import de from "./locales/de.json";
import { t } from "./i18n";
import { widenedPx, type WidenInput } from "./state/autoWiden";

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("C-05 circular reference status", () => {
  it("reads like Excel's status bar, in English and German", () => {
    expect(t("calc.status.circular", { cell: "B8" })).toBe("Circular reference: B8");
    expect(de["calc.status.circular"].replace("{cell}", "B8")).toBe("Zirkelbezug: B8");
  });
});

async function setup() {
  const core = new FakeCalcCore();
  render(<App backend={new FakeBackend(core)} />);
  await screen.findByRole("tab", { name: "Sheet1" });
  await waitFor(() => expect(core.log.some((q) => q.type === "snapshot")).toBe(true));
  core.log.length = 0;
  const grid = screen.getByTestId("grid");
  grid.focus();
  return { core, grid };
}
const applied = (log: Request[]) => log.flatMap((q) => (q.type === "apply" ? [q.command] : []));

async function typeCell(grid: HTMLElement, text: string) {
  fireEvent.keyDown(grid, { key: text[0]! });
  const ed = screen.getByTestId("cell-editor") as HTMLTextAreaElement;
  fireEvent.change(ed, { target: { value: text } });
  fireEvent.keyDown(ed, { key: "Enter" });
}

describe("C-21 Backspace", () => {
  it("opens the editor on the active cell, empty", async () => {
    const { core, grid } = await setup();
    await typeCell(grid, "old");
    await waitFor(() => expect(applied(core.log)).toHaveLength(1));
    fireEvent.keyDown(grid, { key: "ArrowUp" });
    fireEvent.keyDown(grid, { key: "Backspace" });
    const ed = screen.getByTestId("cell-editor") as HTMLTextAreaElement;
    expect(ed.value).toBe("");
    expect(applied(core.log)).toHaveLength(1);
  });

  it("Enter after Backspace clears the cell; Esc keeps it", async () => {
    const { core, grid } = await setup();
    await typeCell(grid, "old");
    await waitFor(() => expect(applied(core.log)).toHaveLength(1));
    fireEvent.keyDown(grid, { key: "ArrowUp" });
    fireEvent.keyDown(grid, { key: "Backspace" });
    fireEvent.keyDown(screen.getByTestId("cell-editor"), { key: "Escape" });
    expect(screen.queryByTestId("cell-editor")).toBeNull();
    expect(applied(core.log)).toHaveLength(1);
    grid.focus();
    fireEvent.keyDown(grid, { key: "Backspace" });
    fireEvent.keyDown(screen.getByTestId("cell-editor"), { key: "Enter" });
    await waitFor(() => expect(applied(core.log)[1]).toEqual({ type: "clearRange", sheet: 0, r0: 0, c0: 0, r1: 0, c1: 0 }));
  });

  it("Delete still clears the selection without an editor", async () => {
    const { core, grid } = await setup();
    fireEvent.keyDown(grid, { key: "Delete" });
    expect(screen.queryByTestId("cell-editor")).toBeNull();
    await waitFor(() => expect(applied(core.log)).toEqual([{ type: "clearRange", sheet: 0, r0: 0, c0: 0, r1: 0, c1: 0 }]));
  });
});

describe("C-23 widening a default-width column for a typed number", () => {
  const base: WidenInput = { constant: true, kind: "number", textPx: 100, colPx: 64, explicitWidth: false, wrap: false, merged: false };
  it("widens to the text plus padding", () => {
    expect(widenedPx(base)).toBe(100 + 6 + 3);
  });
  it("never shrinks and leaves fitting numbers alone", () => {
    expect(widenedPx({ ...base, textPx: 40 })).toBeNull();
    expect(widenedPx({ ...base, textPx: 100, colPx: 200 })).toBeNull();
  });
  it("only numbers typed as constants", () => {
    expect(widenedPx({ ...base, kind: "text" })).toBeNull();
    expect(widenedPx({ ...base, constant: false })).toBeNull();
  });
  it("not for sized columns, wrapped or merged cells", () => {
    expect(widenedPx({ ...base, explicitWidth: true })).toBeNull();
    expect(widenedPx({ ...base, wrap: true })).toBeNull();
    expect(widenedPx({ ...base, merged: true })).toBeNull();
  });
  it("the store sends setColWidth after a long number", async () => {
    const { core, grid } = await setup();
    await typeCell(grid, "123456789012345678");
    await waitFor(() => expect(applied(core.log).map((c) => c.type)).toContain("setColWidth"));
    const w = applied(core.log).find((c) => c.type === "setColWidth");
    expect(w).toMatchObject({ type: "setColWidth", sheet: 0, col: 0 });
    // A short number does not touch the next column.
    core.log.length = 0;
    fireEvent.keyDown(grid, { key: "ArrowRight" });
    fireEvent.keyDown(grid, { key: "ArrowUp" });
    await typeCell(grid, "7");
    await waitFor(() => expect(applied(core.log)).toHaveLength(1));
    expect(applied(core.log).some((c) => c.type === "setColWidth")).toBe(false);
  });
});
