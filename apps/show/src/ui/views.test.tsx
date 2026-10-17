// P8-28 through the real App: views, Selection pane, Format Shape pane,
// Slide Show tab, Grid and Guides, contextual tab groups.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ setTitle: vi.fn() }) }));
vi.mock("react-konva", () => import("../test/konvaMock"));

import App from "../App";
import { ShowApi } from "../api";
import { ShowStore } from "../state/store";
import { FakeBackend } from "../test/fakeBackend";
import { writeSelection } from "../canvas/richEditor";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 1312 });
Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 752 });

const flush = () => act(() => new Promise((r) => setTimeout(r, 0)));
const tab = (name: string) => screen.getByRole("tab", { name });

async function mount() {
  const backend = new FakeBackend();
  const store = new ShowStore(new ShowApi(backend));
  render(<App backend={backend} store={store} />);
  await waitFor(() => expect(screen.getAllByTestId("thumbnail")).toHaveLength(3));
  await flush();
  return { backend, store };
}

describe("presentation views", () => {
  it("Slide Sorter: thumbnails, Ctrl+click, Delete, double-click back to Normal", async () => {
    const { backend, store } = await mount();
    fireEvent.click(tab("View"));
    fireEvent.click(screen.getByRole("button", { name: "Slide Sorter" }));
    const thumbs = screen.getAllByTestId("sorter-thumb");
    expect(thumbs).toHaveLength(3);
    expect(screen.queryByTestId("slide-list")).toBeNull();
    fireEvent.pointerDown(thumbs[1]!, { button: 0, ctrlKey: true });
    fireEvent.pointerUp(thumbs[1]!, { ctrlKey: true });
    expect(store.getState().slideSel).toEqual([1, 4]);
    fireEvent.keyDown(screen.getByRole("listbox", { name: "Slide Sorter" }), { key: "Delete" });
    await flush();
    expect(backend.commands.at(-1)).toEqual({ type: "deleteSlides", ids: [1, 4] });
    fireEvent.doubleClick(screen.getAllByTestId("sorter-thumb")[0]!);
    expect(store.getState().view).toBe("normal");
    expect(screen.getAllByTestId("thumbnail")).toHaveLength(1);
  });

  it("Outline View: the outline pane edits the placeholders", async () => {
    const { backend } = await mount();
    fireEvent.click(tab("View"));
    fireEvent.click(screen.getByRole("button", { name: "Outline View" }));
    const fields = screen.getAllByTestId("outline-text");
    expect(fields).toHaveLength(3);
    expect(Array.from(fields[1]!.querySelectorAll("[data-depth]")).map((d) => `${d.getAttribute("data-depth")}:${d.textContent}`)).toEqual(["0:Slide two", "1:First point", "1:Second point"]);
    // " two" → " 2" (typing arrives as beforeinput)
    fields[1]!.focus();
    writeSelection(fields[1]!, 5, 9);
    fields[1]!.dispatchEvent(new InputEvent("beforeinput", { inputType: "insertText", data: " 2", bubbles: true, cancelable: true }));
    fireEvent.blur(fields[1]!);
    await flush();
    expect(backend.commands.at(-1)).toMatchObject({ type: "setTextBody", shape: 5 });
  });

  it("Notes Page and Reading View", async () => {
    const { backend, store } = await mount();
    fireEvent.click(tab("View"));
    fireEvent.click(screen.getByRole("button", { name: "Notes Page" }));
    const notes = screen.getByTestId("notes-page-text");
    fireEvent.change(notes, { target: { value: "Say hello" } });
    fireEvent.blur(notes);
    await flush();
    expect(backend.commands.at(-1)).toEqual({ type: "setNotes", slide: 1, notes: "Say hello" });
    fireEvent.click(screen.getByRole("button", { name: "Reading View" }));
    expect(screen.getByTestId("reading-view")).toBeTruthy();
    expect(screen.getByTestId("reading-counter").textContent).toBe("Slide 1 of 3");
    fireEvent.click(within(screen.getByTestId("reading-bar")).getByRole("button", { name: "Next" }));
    expect(store.getState().current).toBe(4);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(store.getState().view).toBe("normal");
  });
});

describe("Selection pane, Format Shape pane, contextual tabs", () => {
  it("Home › Select › Selection Pane: rows top to bottom, the eye hides", async () => {
    const { backend, store } = await mount();
    store.selectSlide(7);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Selection Pane/ }));
    const rows = screen.getAllByTestId("selection-row");
    expect(rows.map((r) => r.getAttribute("data-shape-id"))).toEqual(["9", "8"]);
    fireEvent.click(within(rows[1]!).getByTestId("selection-eye"));
    await flush();
    expect(backend.commands.at(-1)).toEqual({ type: "setShapesHidden", shapes: [8], hidden: true });
    fireEvent.click(screen.getAllByTestId("selection-row")[0]!);
    expect(store.getState().selection).toEqual([9]);
    // a selected shape shows Shape Format under "Drawing Tools"
    const ctx = screen.getByTestId("ribbon-context");
    expect(ctx.getAttribute("data-context")).toBe("Drawing Tools");
    expect(within(ctx).getByRole("tab", { name: "Shape Format" })).toBeTruthy();
  });

  it("Format Shape › Text Options: autofit and margins", async () => {
    const { backend, store } = await mount();
    store.selectSlide(4);
    store.select([6]);
    store.openFormatPane("text");
    await flush();
    const pane = screen.getByTestId("format-pane");
    fireEvent.click(within(pane).getByRole("radio", { name: "Shrink text on overflow" }));
    await flush();
    expect(backend.commands.at(-1)).toMatchObject({ type: "setBodyProps", shapes: [6], props: { autofit: "shrink" } });
    fireEvent.change(within(pane).getByTestId("fmt-direction"), { target: { value: "rotate90" } });
    await flush();
    expect(backend.commands.at(-1)).toMatchObject({ type: "setBodyProps", props: { vert: "rotate90" } });
    fireEvent.click(within(pane).getByRole("tab", { name: "Size & Properties" }));
    const width = within(pane).getByTestId("fmt-width");
    fireEvent.change(width, { target: { value: "6.5" } });
    fireEvent.blur(width);
    await flush();
    expect(backend.commands.at(-1)).toMatchObject({ type: "setTransform" });
  });

  it("Slide Show tab: Set Up Slide Show, Hide Slide; View: Grid and Guides", async () => {
    const { backend } = await mount();
    fireEvent.click(tab("Slide Show"));
    fireEvent.click(screen.getByRole("button", { name: "Set Up Slide Show" }));
    const dlg = screen.getByTestId("setup-show-dialog");
    fireEvent.click(within(dlg).getByRole("checkbox", { name: "Loop continuously until 'Esc'" }));
    fireEvent.click(within(dlg).getByRole("radio", { name: "Manually" }));
    fireEvent.click(within(dlg).getByRole("button", { name: "OK" }));
    await flush();
    expect(backend.commands.at(-1)).toEqual({ type: "setShowSettings", settings: { loop: true, withoutNarration: false, withoutAnimation: false, useTimings: false } });
    fireEvent.click(screen.getByRole("button", { name: "Hide slide" }));
    await flush();
    expect(backend.commands.at(-1)).toEqual({ type: "setSlidesHidden", slides: [1], hidden: true });
    fireEvent.click(tab("View"));
    fireEvent.click(screen.getByRole("button", { name: "Grid and Guides…" }));
    const grid = screen.getByTestId("grid-guides-dialog");
    fireEvent.click(within(grid).getByRole("checkbox", { name: "Snap objects to grid" }));
    fireEvent.click(within(grid).getByRole("checkbox", { name: "Display grid on screen" }));
    fireEvent.click(within(grid).getByRole("button", { name: "OK" }));
    await flush();
    expect(backend.commands.at(-1)).toMatchObject({ type: "setViewProps", view: { snapToGrid: true, showGrid: true } });
    expect(screen.getByTestId("editor-stage").getAttribute("data-grid")).toBe("true");
    fireEvent.click(screen.getByRole("checkbox", { name: "Ruler" }));
    await flush();
    expect(screen.getByTestId("ruler-h")).toBeTruthy();
  });
});
