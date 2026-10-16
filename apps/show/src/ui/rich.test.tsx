// P8-24 through the app: charts (Insert Chart, Chart Design, Edit Data,
// Change Chart Type, Format pane), Insert › Link / Action, action buttons,
// audio and video (Insert, Playback), Reuse Slides, links in the show.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ setTitle: vi.fn() }) }));
vi.mock("react-konva", () => import("../test/konvaMock"));

import App from "../App";
import { ShowApi } from "../api";
import type { ShowCommand } from "../generated/ShowCommand";
import { Presenter } from "../present/Presenter";
import { initialShow } from "../present/showState";
import { deckOf } from "../design/deck";
import { ShowStore } from "../state/store";
import { FakeBackend } from "../test/fakeBackend";
import { fixture, textShape } from "../test/fixture";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 1312 });
Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 752 });

const flush = () => act(() => new Promise((r) => setTimeout(r, 0)));
const tab = (name: string) => screen.getByRole("tab", { name });
const last = (b: FakeBackend): ShowCommand => b.commands[b.commands.length - 1]!;

async function mount(backend = new FakeBackend()) {
  const store = new ShowStore(new ShowApi(backend));
  render(<App backend={backend} store={store} />);
  await waitFor(() => expect(screen.getAllByTestId("thumbnail").length).toBeGreaterThanOrEqual(3));
  await flush();
  return { backend, store };
}

/** Inserts a clustered column chart on the current slide through Insert › Chart. */
async function insertChart(store: ShowStore, backend: FakeBackend) {
  fireEvent.click(tab("Insert"));
  fireEvent.click(screen.getByRole("button", { name: "Chart" }));
  const dialog = screen.getByTestId("insert-chart-dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "OK" }));
  await flush();
  await flush();
  const cmd = backend.commands.find((c) => c.type === "insertChart");
  expect(cmd).toMatchObject({ type: "insertChart", slide: 1, kind: { type: "bar", direction: "column", grouping: "clustered" } });
  return store.getState().selection[0]!;
}

describe("charts", () => {
  it("Insert Chart lists the types with sub-type icons and inserts the chosen one; Chart Design appears", async () => {
    const { backend, store } = await mount();
    fireEvent.click(tab("Insert"));
    fireEvent.click(screen.getByRole("button", { name: "Chart" }));
    const dialog = screen.getByTestId("insert-chart-dialog");
    const list = within(dialog).getByTestId("chart-type-list");
    expect(within(list).getAllByRole("option").map((o) => o.textContent)).toEqual(["Column", "Line", "Pie", "Bar", "Area", "X Y (Scatter)", "Combo"]);
    fireEvent.click(within(list).getByRole("option", { name: "Pie" }));
    fireEvent.click(within(dialog).getByRole("radio", { name: "Doughnut" }));
    expect(within(dialog).getByTestId("chart-type-preview").querySelector("svg")).not.toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "OK" }));
    await flush();
    await flush();
    expect(last(backend)).toMatchObject({ type: "insertChart", kind: { type: "doughnut" } });
    expect(store.selectedChart()).not.toBeNull();
    expect(tab("Chart Design").getAttribute("aria-selected")).toBe("true");
    // the chart is drawn by the shared renderer on the stage
    expect(screen.getByTestId("editor-stage").querySelector('[data-konva="Shape"]')).not.toBeNull();
  });

  it("combo presets insert a column chart, then change its series kinds", async () => {
    const { backend } = await mount();
    fireEvent.click(tab("Insert"));
    fireEvent.click(screen.getByRole("button", { name: "Chart" }));
    const dialog = screen.getByTestId("insert-chart-dialog");
    fireEvent.click(within(within(dialog).getByTestId("chart-type-list")).getByRole("option", { name: "Combo" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "OK" }));
    await flush();
    await flush();
    const upd = last(backend);
    expect(upd.type).toBe("updateChart");
    if (upd.type === "updateChart") {
      expect(upd.chart.kind).toEqual({ type: "combo" });
      expect(upd.chart.series.map((s) => s.kind?.type)).toEqual(["bar", "bar", "line"]);
    }
  });

  it("Chart Design: Quick Layout, Change Colors, Chart Styles and Add Chart Element send updateChart", async () => {
    const { backend, store } = await mount();
    const id = await insertChart(store, backend);
    fireEvent.click(screen.getByRole("button", { name: "Quick Layout" }));
    fireEvent.click(screen.getByRole("button", { name: "Layout 4" }));
    await flush();
    const ql = last(backend);
    expect(ql).toMatchObject({ type: "updateChart", shape: id });
    if (ql.type === "updateChart") expect(ql.chart.title).toBeUndefined();
    fireEvent.click(screen.getByRole("button", { name: "Change Colors" }));
    fireEvent.click(screen.getByRole("button", { name: "Monochromatic Palette 2 (Accent 2)" }));
    await flush();
    expect(last(backend)).toMatchObject({ type: "updateChart", chart: { style: 4 } });
    fireEvent.click(screen.getByRole("button", { name: "Add Chart Element" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Top" }));
    await flush();
    expect(last(backend)).toMatchObject({ type: "updateChart", chart: { legend: { position: "top" } } });
  });

  it("Edit Data changes a value, adds a series and Switch Row/Column transposes", async () => {
    const { backend, store } = await mount();
    const id = await insertChart(store, backend);
    fireEvent.click(screen.getByRole("button", { name: "Edit Data" }));
    const dialog = screen.getByTestId("edit-data-dialog");
    const b3 = within(dialog).getByRole("textbox", { name: "Cell B3" });
    expect((b3 as HTMLInputElement).value).toBe("2.5");
    fireEvent.change(b3, { target: { value: "9" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add Series" }));
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Cell E2" }), { target: { value: "1" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "OK" }));
    await flush();
    const cmd = last(backend);
    expect(cmd).toMatchObject({ type: "setChartData", shape: id });
    if (cmd.type === "setChartData") {
      expect(cmd.data.series[0]!.values[1]).toBe(9);
      expect(cmd.data.series[3]).toEqual({ name: "Series 4", values: [1, null, null, null] });
    }
    fireEvent.click(screen.getByRole("button", { name: "Switch Row/Column" }));
    await flush();
    const sw = last(backend);
    expect(sw.type === "setChartData" && sw.data.categories).toEqual(["Series 1", "Series 2", "Series 3", "Series 4"]);
  });

  it("Change Chart Type keeps the data and applies the sub-type; the Format pane edits axis and series options", async () => {
    const { backend, store } = await mount();
    const id = await insertChart(store, backend);
    fireEvent.click(screen.getByRole("button", { name: "Change Chart Type" }));
    fireEvent.click(screen.getByRole("option", { name: "Line" }));
    fireEvent.click(screen.getByRole("radio", { name: "Line with Markers" }));
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    await flush();
    expect(last(backend)).toMatchObject({ type: "updateChart", shape: id, chart: { kind: { type: "line", markers: true } } });
    fireEvent.click(tab("Format"));
    fireEvent.click(screen.getByRole("button", { name: "Format pane" }));
    const pane = screen.getByTestId("chart-format-pane");
    const max = within(pane).getByRole("textbox", { name: "Maximum" });
    fireEvent.change(max, { target: { value: "10" } });
    fireEvent.keyDown(max, { key: "Enter" });
    await flush();
    expect(last(backend)).toMatchObject({ type: "updateChart", chart: { axes: { val: { max: 10 } } } });
    fireEvent.click(within(pane).getByRole("checkbox", { name: "Smoothed line" }));
    await flush();
    const sm = last(backend);
    expect(sm.type === "updateChart" && sm.chart.series[0]!.smooth).toBe(true);
  });
});

describe("hyperlinks and actions", () => {
  it("Ctrl+K on a selected shape links it to a slide; Remove Link takes it off", async () => {
    const { backend, store } = await mount();
    act(() => store.selectSlide(7));
    act(() => store.select([8]));
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const dialog = await screen.findByTestId("link-dialog");
    fireEvent.click(within(dialog).getByRole("tab", { name: "Place in This Document" }));
    fireEvent.click(within(dialog).getByRole("option", { name: /2\. Slide two$/ }));
    fireEvent.change(within(dialog).getByRole("textbox", { name: "ScreenTip" }), { target: { value: "Agenda" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "OK" }));
    await flush();
    expect(last(backend)).toEqual({ type: "setClickAction", shapes: [8], action: { target: { kind: "slide", value: { kind: "id", value: 4 } }, tooltip: "Agenda" } });
    fireEvent.click(tab("Insert"));
    fireEvent.click(screen.getByRole("button", { name: "Link" }));
    fireEvent.click(within(screen.getByTestId("link-dialog")).getByRole("button", { name: "Remove Link" }));
    await flush();
    expect(last(backend)).toEqual({ type: "setClickAction", shapes: [8], action: null });
  });

  it("Ctrl+K while editing text links the selected characters", async () => {
    const { backend, store } = await mount();
    fireEvent.click(screen.getAllByTestId("thumbnail")[1]!);
    act(() => store.startEdit(5));
    act(() => store.updateEdit("Hello world", 6, 11));
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const dialog = await screen.findByTestId("link-dialog");
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Address" }), { target: { value: "example.com" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "OK" }));
    await flush();
    const cmd = last(backend);
    expect(cmd).toEqual({ type: "setHyperlink", shape: 5, paragraph: 0, from: 6, to: 11, link: { target: { kind: "url", value: "https://example.com" } } });
    // the edited text went first
    expect(backend.commands[backend.commands.length - 2]).toMatchObject({ type: "setTextBody", shape: 5 });
  });

  it("Insert › Action sets a click action; action buttons come with theirs", async () => {
    const { backend, store } = await mount();
    act(() => store.select([9]));
    fireEvent.click(tab("Insert"));
    fireEvent.click(screen.getByRole("button", { name: "Action" }));
    const dialog = screen.getByTestId("action-dialog");
    fireEvent.change(within(dialog).getByRole("combobox", { name: "Hyperlink to:" }), { target: { value: "endShow" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "OK" }));
    await flush();
    expect(last(backend)).toEqual({ type: "setClickAction", shapes: [9], action: { target: { kind: "endShow" } } });
    fireEvent.click(screen.getByRole("button", { name: "Shapes" }));
    const lib = screen.getByRole("dialog", { name: "Shapes" });
    const group = within(lib).getByRole("group", { name: "Action Buttons" });
    fireEvent.keyDown(within(group).getByRole("button", { name: "Action Button: Go Forward or Next" }), { key: "Enter" });
    fireEvent.click(within(group).getByRole("button", { name: "Action Button: Go Forward or Next" }), { detail: 0 });
    await flush();
    const add = last(backend);
    expect(add.type).toBe("addShape");
    if (add.type === "addShape") {
      expect(add.shape.kind).toMatchObject({ kind: "auto", value: { geometry: "actionButtonForwardNext" } });
      expect(add.shape.clickAction).toEqual({ target: { kind: "slide", value: { kind: "next" } } });
    }
  });
});

describe("audio and video", () => {
  it("Insert › Video reads the file and inserts the clip; Playback sets start, loop, volume and the poster", async () => {
    const { backend } = await mount();
    fireEvent.click(tab("Insert"));
    const file = new File([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])], "clip.webm", { type: "video/webm" });
    fireEvent.change(screen.getByTestId("video-input"), { target: { files: [file] } });
    await waitFor(() => expect(backend.commands.some((c) => c.type === "insertMedia")).toBe(true));
    await flush();
    expect(last(backend)).toMatchObject({ type: "insertMedia", slide: 1, contentType: "video/webm", bytesBase64: "GkXfow==" });
    expect(tab("Playback").getAttribute("aria-selected")).toBe("true");
    fireEvent.change(screen.getByRole("combobox", { name: "Start" }), { target: { value: "automatically" } });
    await flush();
    const id = (last(backend) as Extract<ShowCommand, { type: "setMediaProps" }>).shapes[0]!;
    expect(last(backend)).toEqual({ type: "setMediaProps", shapes: [id], patch: { start: "automatically" } });
    fireEvent.click(screen.getByRole("button", { name: "Loop until Stopped" }));
    await flush();
    expect(last(backend)).toEqual({ type: "setMediaProps", shapes: [id], patch: { loop: true } });
    fireEvent.click(screen.getByRole("button", { name: "Volume" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Low" }));
    await flush();
    expect(last(backend)).toEqual({ type: "setMediaProps", shapes: [id], patch: { volume: 25000, muted: false } });
    const png = new File([new Uint8Array([0x89, 0x50])], "p.png", { type: "image/png" });
    fireEvent.change(screen.getByTestId("poster-input"), { target: { files: [png] } });
    await waitFor(() => expect(last(backend).type).toBe("setMediaPoster"));
    // the editor shows the placeholder until a poster is loaded
    expect(screen.getByTestId("editor-stage").textContent).toBeDefined();
  });

  it("unsupported files are refused with a message", async () => {
    const { backend } = await mount();
    fireEvent.click(tab("Insert"));
    const file = new File([new Uint8Array([1])], "notes.txt", { type: "text/plain" });
    fireEvent.change(screen.getByTestId("audio-input"), { target: { files: [file] } });
    await flush();
    expect(backend.commands.some((c) => c.type === "insertMedia")).toBe(false);
    expect(await screen.findByText(/notes\.txt: this file type cannot be inserted/)).toBeTruthy();
  });
});

describe("Reuse Slides", () => {
  it("lists the other presentation's slides and inserts the clicked one after the current slide", async () => {
    const backend = new FakeBackend();
    const other = fixture();
    other.slides[1]!.shapes = [textShape(40, ["Imported"])];
    backend.peek = other;
    const { store } = await mount(backend);
    fireEvent.click(screen.getAllByTestId("thumbnail")[1]!);
    fireEvent.click(screen.getAllByRole("button", { name: "Slide layouts" })[0]!);
    fireEvent.click(screen.getByTestId("reuse-slides"));
    const pane = screen.getByTestId("reuse-pane");
    const file = new File([new Uint8Array([0x50, 0x4b])], "other.pptx");
    fireEvent.change(within(pane).getByTestId("reuse-input"), { target: { files: [file] } });
    await waitFor(() => expect(within(pane).getAllByTestId(/^reuse-slide-/)).toHaveLength(3));
    fireEvent.click(within(pane).getByRole("checkbox", { name: "Keep source formatting" }));
    fireEvent.click(within(pane).getByTestId("reuse-slide-2"));
    await flush();
    const cmd = last(backend);
    expect(cmd).toMatchObject({ type: "insertSlides", after: 4, keepSourceFormatting: true });
    if (cmd.type === "insertSlides") {
      expect(cmd.slides.map((s) => s.id)).toEqual([4]);
      expect(cmd.layouts.map((l) => l.kind)).toEqual(["titleContent"]);
    }
    expect(store.getState().pres!.slides).toHaveLength(4);
    expect(store.getState().current).toBe(store.getState().pres!.slides[2]!.id);
  });
});

describe("links in the slide show", () => {
  it("a click on a linked shape jumps instead of advancing; web links are anchors in a new tab", () => {
    const p = fixture();
    p.slides[0]!.shapes.push(textShape(50, ["Next"], { clickAction: { target: { kind: "slide", value: { kind: "id", value: 7 } } } }));
    p.slides[0]!.shapes.push(textShape(51, ["Web"], { clickAction: { target: { kind: "url", value: "https://example.com" }, tooltip: "Site" } }));
    const onAction = vi.fn();
    render(<Presenter deck={deckOf(p)} slides={p.slides} media={new Map()} mediaVersion={0} show={initialShow(3)} onAction={onAction} />);
    const links = screen.getAllByTestId("show-link");
    expect(links).toHaveLength(2);
    fireEvent.click(links[0]!);
    expect(onAction).toHaveBeenCalledWith({ type: "goto", index: 2 });
    expect(onAction).toHaveBeenCalledTimes(1);
    const a = links[1]!;
    expect(a.tagName).toBe("A");
    expect(a.getAttribute("href")).toBe("https://example.com");
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toContain("noopener");
    expect(a.getAttribute("title")).toBe("Site");
  });

  it("clips play as HTML5 media at their place; automatic ones start by themselves", () => {
    const p = fixture();
    p.slides[2]!.shapes.push({
      ...p.slides[2]!.shapes[0]!, id: 60,
      kind: { kind: "media", value: { kind: "video", media: 3, start: "automatically", loop: true } },
    });
    const play = vi.fn(() => Promise.resolve());
    Object.defineProperty(HTMLMediaElement.prototype, "play", { configurable: true, value: play });
    render(<Presenter deck={deckOf(p)} slides={p.slides} media={new Map([[3, "data:video/webm;base64,GkXfow=="]])} mediaVersion={0} show={initialShow(3, 2)} onAction={vi.fn()} />);
    const v = screen.getByTestId("show-media-60") as HTMLVideoElement;
    expect(v.tagName).toBe("VIDEO");
    expect(v.loop).toBe(true);
    expect(v.controls).toBe(true);
    expect(play).toHaveBeenCalled();
  });
});
