// P9-S2 through the real App: table editing round 2 (Draw Borders pen,
// all Borders options, Text Direction, Cell Text Layout dialog, Format
// Shape pane for cells, 32 px resize grips).
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ setTitle: vi.fn() }) }));
vi.mock("react-konva", () => import("../test/konvaMock"));

import App from "../App";
import { ShowApi } from "../api";
import { ShowStore } from "../state/store";
import { FakeBackend } from "../test/fakeBackend";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 1312 });
Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 752 });

async function mount() {
  const backend = new FakeBackend();
  const store = new ShowStore(new ShowApi(backend));
  render(<App backend={backend} store={store} />);
  await waitFor(() => expect(screen.getAllByTestId("thumbnail")).toHaveLength(3));
  await flush();
  return { backend, store };
}

const flush = () => act(() => new Promise((r) => setTimeout(r, 0)));
const tab = (name: string) => screen.getByRole("tab", { name });
const last = (b: FakeBackend) => b.commands[b.commands.length - 1];

async function insertTable(backend: FakeBackend) {
  fireEvent.click(tab("Insert"));
  fireEvent.click(screen.getByRole("button", { name: "Table" }));
  fireEvent.click(screen.getByRole("button", { name: "3 × 3 table" }));
  await flush();
  expect(last(backend)).toMatchObject({ type: "insertTable", rows: 3, cols: 3 });
}

describe("table editing (P9-S2)", () => {
  it("Draw Borders: pen style and weight, then Borders › Diagonal down border draws with the pen", async () => {
    const { backend, store } = await mount();
    await insertTable(backend);
    act(() => store.selectCells(100, { r0: 1, c0: 1, r1: 1, c1: 2 }));
    fireEvent.click(tab("Table Design"));
    fireEvent.click(screen.getByRole("button", { name: "Pen Style" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Dashed line" }));
    fireEvent.click(screen.getByRole("button", { name: "Pen Weight" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "2.25 pt" }));
    expect(store.getState().pen).toMatchObject({ dash: "dash", width: 28575 });
    fireEvent.click(screen.getByRole("button", { name: "Borders" }));
    const items = screen.getAllByRole("menuitem").map((m) => m.textContent);
    expect(items).toHaveLength(12);
    expect(items[0]).toBe("No border");
    fireEvent.click(screen.getByRole("menuitem", { name: "Diagonal down border" }));
    await flush();
    expect(last(backend)).toEqual({
      type: "setTableCellProps",
      shape: 100,
      row: 1,
      col: 1,
      rowSpan: 1,
      colSpan: 2,
      patch: { diagDown: { fill: { kind: "solid", value: { kind: "rgb", value: "000000" } }, width: 28575, dash: "dash" } },
    });
  });

  it("Layout › Text Direction and Cell Margins › Custom Margins… (Cell Text Layout)", async () => {
    const { backend, store } = await mount();
    await insertTable(backend);
    act(() => store.selectCells(100, { r0: 0, c0: 0, r1: 0, c1: 0 }));
    fireEvent.click(tab("Layout"));
    fireEvent.click(screen.getByRole("button", { name: "Text Direction" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Rotate all text 270°" }));
    await flush();
    expect(last(backend)).toEqual({ type: "setTableCellProps", shape: 100, row: 0, col: 0, rowSpan: 1, colSpan: 1, patch: { vert: "rotate270" } });
    fireEvent.click(screen.getByRole("button", { name: "Cell margins" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Custom Margins…" }));
    const dlg = screen.getByRole("dialog", { name: "Cell Text Layout" });
    fireEvent.change(within(dlg).getByLabelText("Vertical alignment"), { target: { value: "bottom" } });
    fireEvent.change(within(dlg).getByLabelText(/^Left/), { target: { value: "0.5" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "OK" }));
    await flush();
    const cmd = last(backend) as { type: string; patch: { anchor: string; vert: string; margins: { left: number; right: number } } };
    expect(cmd.type).toBe("setTableCellProps");
    expect(cmd.patch.anchor).toBe("bottom");
    expect(cmd.patch.vert).toBe("rotate270");
    // 0.5 cm or in by locale; the other margins keep PowerPoint's defaults
    expect([180000, 457200]).toContain(cmd.patch.margins.left);
    expect(cmd.patch.margins.right).toBe(91440);
  });

  it("Format Shape › Table Cells: fill and a border side with style and weight", async () => {
    const { backend, store } = await mount();
    await insertTable(backend);
    act(() => store.selectCells(100, { r0: 0, c0: 0, r1: 1, c1: 1 }));
    act(() => store.openFormatPane("cell"));
    const pane = screen.getByTestId("format-cell-fill");
    fireEvent.click(within(pane).getByRole("radio", { name: "No fill" }));
    await flush();
    expect(last(backend)).toMatchObject({ type: "setTableCellProps", rowSpan: 2, colSpan: 2, patch: { fill: { kind: "none" } } });
    fireEvent.change(within(pane).getByTestId("fmt-border-side"), { target: { value: "outside" } });
    fireEvent.change(within(pane).getByTestId("fmt-border-dash"), { target: { value: "dot" } });
    await flush();
    const c = last(backend) as unknown as { type: string; commands: { patch: Record<string, { dash: string }> }[] };
    expect(c.type).toBe("compound");
    expect(c.commands).toHaveLength(4);
    expect(c.commands[0]!.patch.top!.dash).toBe("dot");
    // Text Options for cells: the margins of the range
    act(() => store.openFormatPane("text"));
    expect(screen.getByTestId("format-cell-text")).toBeTruthy();
    fireEvent.change(screen.getByTestId("fmt-cell-direction"), { target: { value: "stacked" } });
    await flush();
    expect(last(backend)).toMatchObject({ patch: { vert: "stacked" } });
  });

  it("resize grips are 32 px touch targets; a tap on one edits the cell under it", async () => {
    const { backend, store } = await mount();
    await insertTable(backend);
    const grip = screen.getByTestId("table-grip-cols-0");
    expect(parseFloat(grip.style.width)).toBe(32);
    const overlay = screen.getByTestId("table-overlay");
    overlay.getBoundingClientRect = () => ({ left: 0, top: 0, right: 500, bottom: 100, width: 500, height: 100, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.pointerDown(grip, { button: 0, pointerId: 3, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(grip, { button: 0, pointerId: 3, clientX: 10, clientY: 10 });
    expect(store.getState().editing).toMatchObject({ shape: 100, cell: { row: 0, col: 0 } });
  });
});
