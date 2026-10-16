// P8-16 through the real App: shape library, Shape Format, tables.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ setTitle: vi.fn() }) }));
vi.mock("react-konva", () => import("../test/konvaMock"));

import App from "../App";
import { ShowApi } from "../api";
import { tableMenu } from "../canvas/menus";
import { ShowStore } from "../state/store";
import { TABLE_STYLES } from "../shapes/tables";
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

function openShapes() {
  fireEvent.click(tab("Insert"));
  fireEvent.click(screen.getByRole("button", { name: "Shapes" }));
  return screen.getByRole("dialog", { name: "Shapes" });
}

async function insertTable(backend: FakeBackend) {
  fireEvent.click(tab("Insert"));
  fireEvent.click(screen.getByRole("button", { name: "Table" }));
  fireEvent.click(screen.getByRole("button", { name: "3 × 3 table" }));
  await flush();
  expect(last(backend)).toMatchObject({ type: "insertTable", slide: 1, rows: 3, cols: 3 });
}

describe("Insert › Shapes", () => {
  it("is grouped like PowerPoint; Enter inserts at once (centred) and the shape becomes recently used", async () => {
    const { backend } = await mount();
    const lib = openShapes();
    expect(within(lib).getAllByRole("heading").map((h) => h.textContent)).toEqual([
      "Lines", "Rectangles", "Basic shapes", "Block arrows", "Flowchart", "Stars and banners", "Callouts", "Action Buttons",
    ]);
    fireEvent.click(within(within(lib).getByRole("group", { name: "Stars and banners" })).getByRole("button", { name: "Star: 5 points" }));
    await flush();
    expect(last(backend)).toMatchObject({ type: "addShape", slide: 1, shape: { kind: { kind: "auto", value: { geometry: "star5" } }, transform: { w: 914400, h: 914400 } } });
    const again = openShapes();
    expect(within(within(again).getByRole("group", { name: "Recently used shapes" })).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual(["Star: 5 points"]);
  });

  it("a pointer click arms drawing on the slide; Esc cancels", async () => {
    const { backend, store } = await mount();
    const lib = openShapes();
    fireEvent.click(within(lib).getByRole("button", { name: "Arrow: right" }), { detail: 1 });
    expect(screen.getByTestId("editor-stage").getAttribute("data-draw-mode")).toBe("rightArrow");
    expect(backend.commands).toHaveLength(0);
    act(() => void store.shortcut({ kind: "deselect" }));
    expect(screen.getByTestId("editor-stage").getAttribute("data-draw-mode")).toBeNull();
  });

  it("a drawn box inserts the chosen shape there", async () => {
    const { backend, store } = await mount();
    await act(() => store.insertChoice("hexagon", { x: 100, y: 200, w: 300, h: 400 }));
    expect(last(backend)).toMatchObject({ type: "addShape", shape: { kind: { value: { geometry: "hexagon" } }, transform: { x: 100, y: 200, w: 300, h: 400 } } });
    expect(store.getState().selection).toEqual([100]);
  });
});

describe("Shape Format", () => {
  it("Change shape, rotate / flip", async () => {
    const { backend, store } = await mount();
    act(() => store.select([2]));
    fireEvent.click(tab("Shape Format"));
    fireEvent.click(screen.getByRole("button", { name: "Change shape" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Change shape" })).getByRole("button", { name: "Diamond" }));
    await flush();
    expect(last(backend)).toEqual({ type: "setGeometry", shapes: [2], geometry: "diamond" });
    fireEvent.click(screen.getByRole("button", { name: "Rotate" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Flip horizontal" }));
    await flush();
    expect(last(backend)).toMatchObject({ type: "setTransform", shapes: [[2, { flipH: true }]] });
  });

  it("Arrows and Connector type for a connector", async () => {
    const { backend, store } = await mount();
    await act(() => store.insertChoice("line"));
    expect(last(backend)).toMatchObject({ type: "addShape", shape: { kind: { kind: "connector", value: { kind: "straight" } } } });
    fireEvent.click(tab("Shape Format"));
    fireEvent.click(screen.getByRole("button", { name: "Arrows" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Arrow at the end" }));
    await flush();
    expect(last(backend)).toMatchObject({ type: "setConnector", shape: 100, patch: { tail: { kind: "triangle" }, head: { kind: "none" } } });
    fireEvent.click(screen.getByRole("button", { name: "Connector type" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Elbow connector" }));
    await flush();
    expect(last(backend)).toEqual({ type: "setConnector", shape: 100, patch: { kind: "elbow", bends: 2 } });
  });

  it("Shape styles apply theme fill and outline", async () => {
    const { backend, store } = await mount();
    act(() => store.select([2]));
    fireEvent.click(tab("Shape Format"));
    fireEvent.click(screen.getByRole("button", { name: "Shape styles" }));
    fireEvent.click(screen.getByRole("button", { name: "Colored outline – Accent 3" }));
    await flush();
    expect(last(backend)).toMatchObject({ type: "setShapeStyle", shapes: [2], fill: null, line: { fill: { value: { value: { slot: "accent3" } } } } });
  });
});

describe("tables", () => {
  it("Insert › Table selects the new table and shows Table Design and Layout", async () => {
    const { backend } = await mount();
    await insertTable(backend);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(expect.arrayContaining(["Table Design", "Layout"]));
    expect(screen.queryByRole("tab", { name: "Shape Format" })).toBeNull();
    expect(screen.getAllByTestId("table-cell")).toHaveLength(9);
  });

  it("Insert Table… asks for the size", async () => {
    const { backend } = await mount();
    fireEvent.click(tab("Insert"));
    fireEvent.click(screen.getByRole("button", { name: "Table" }));
    fireEvent.click(screen.getByRole("button", { name: "Insert table…" }));
    const dlg = screen.getByRole("dialog", { name: "Insert table" });
    fireEvent.change(within(dlg).getByLabelText("Number of columns"), { target: { value: "12" } });
    fireEvent.change(within(dlg).getByLabelText("Number of rows"), { target: { value: "9" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "OK" }));
    await flush();
    expect(last(backend)).toMatchObject({ type: "insertTable", rows: 9, cols: 12 });
  });

  it("table styles and style options", async () => {
    const { backend } = await mount();
    await insertTable(backend);
    fireEvent.click(tab("Table Design"));
    fireEvent.click(screen.getByRole("button", { name: "Medium Style 2 – Accent 5" }));
    await flush();
    expect(last(backend)).toMatchObject({ type: "setTableStyle", shape: 100, styleId: TABLE_STYLES[4]!.id });
    fireEvent.click(screen.getByRole("checkbox", { name: "Total row" }));
    await flush();
    expect(last(backend)).toMatchObject({ type: "setTableStyle", look: { firstRow: true, bandRows: true, lastRow: true } });
  });

  it("typing in a cell, Tab to the next: SetTableCellText, the editor moves", async () => {
    const { backend, store } = await mount();
    await insertTable(backend);
    act(() => store.startCellEdit(100, 0, 0));
    const ta = screen.getByTestId("text-overlay") as HTMLTextAreaElement;
    expect(screen.getByTestId("text-overlay-box").getAttribute("data-cell")).toBe("0,0");
    fireEvent.change(ta, { target: { value: "Q1" } });
    fireEvent.keyDown(ta, { key: "Tab" });
    await flush();
    expect(backend.commands.find((c) => c.type === "setTableCellText")).toMatchObject({ row: 0, col: 0, body: { paragraphs: [{ runs: [{ text: "Q1" }] }] } });
    expect(screen.getByTestId("text-overlay-box").getAttribute("data-cell")).toBe("0,1");
  });

  it("Merge and Split with a cell selection (also from the context menu)", async () => {
    const { backend, store } = await mount();
    await insertTable(backend);
    act(() => store.selectCells(100, { r0: 1, c0: 0, r1: 2, c1: 0 }));
    expect(tableMenu(store).find((i) => "id" in i && i.id === "merge")).toMatchObject({ disabled: false });
    fireEvent.click(tab("Layout"));
    fireEvent.click(screen.getByRole("button", { name: "Merge cells" }));
    await flush();
    expect(last(backend)).toEqual({ type: "mergeTableCells", shape: 100, row: 1, col: 0, rowSpan: 2, colSpan: 1 });
    expect(screen.getAllByTestId("table-cell")).toHaveLength(8);
    fireEvent.click(screen.getByRole("button", { name: "Split cells" }));
    await flush();
    expect(last(backend)).toEqual({ type: "splitTableCell", shape: 100, row: 1, col: 0 });
  });

  it("Layout: insert below, distribute, cell margins, vertical alignment", async () => {
    const { backend, store } = await mount();
    await insertTable(backend);
    act(() => store.selectCells(100, { r0: 0, c0: 0, r1: 0, c1: 0 }));
    fireEvent.click(tab("Layout"));
    fireEvent.click(screen.getByRole("button", { name: "Insert below" }));
    await flush();
    expect(last(backend)).toEqual({ type: "insertTableRow", shape: 100, index: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Center vertically" }));
    await flush();
    expect(last(backend)).toEqual({ type: "setTableCellProps", shape: 100, row: 0, col: 0, rowSpan: 1, colSpan: 1, patch: { anchor: "middle" } });
    fireEvent.click(screen.getByRole("button", { name: "Cell margins" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "None" }));
    await flush();
    expect(last(backend)).toMatchObject({ type: "setTableCellProps", patch: { margins: { left: 0, top: 0, right: 0, bottom: 0 } } });
  });

  it("pointer: a click on a cell edits it, a drag selects cells", async () => {
    const { backend, store } = await mount();
    await insertTable(backend);
    const overlay = screen.getByTestId("table-overlay");
    overlay.getBoundingClientRect = () => ({ left: 0, top: 0, right: 500, bottom: 100, width: 500, height: 100, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.pointerDown(overlay, { button: 0, pointerId: 1, clientX: 2, clientY: 2 });
    fireEvent.pointerUp(overlay, { button: 0, pointerId: 1, clientX: 2, clientY: 2 });
    expect(store.getState().editing).toMatchObject({ shape: 100, cell: { row: 0, col: 0 } });
    fireEvent.pointerDown(overlay, { button: 0, pointerId: 2, clientX: 2, clientY: 2 });
    fireEvent.pointerMove(overlay, { button: 0, pointerId: 2, clientX: 400, clientY: 2 });
    fireEvent.pointerUp(overlay, { button: 0, pointerId: 2, clientX: 400, clientY: 2 });
    expect(store.getState().editing).toBeNull();
    expect(store.getState().cellSel).toMatchObject({ shape: 100, range: { r0: 0, c0: 0, r1: 0 } });
    expect(store.getState().cellSel!.range.c1).toBeGreaterThan(0);
  });
});
