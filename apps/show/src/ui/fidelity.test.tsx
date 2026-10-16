// P8-32 through the real App: picture backgrounds in Format Background,
// the Slide Master tab (Rename, Insert Placeholder, Title / Footers, text
// level), Format Shape's lock aspect ratio, the new shape groups, custom
// placeholder prompts on slides, table style previews and media clips in
// the click sequence of the show.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ setTitle: vi.fn() }) }));
vi.mock("react-konva", () => import("../test/konvaMock"));

import App from "../App";
import { ShowApi } from "../api";
import { deckOf } from "../design/deck";
import { DESIGN_SHAPE_BASE } from "../design/master";
import { themePalette } from "../model";
import { ShowOverlay } from "../present/ShowOverlay";
import { tableStyleOf } from "../shapes/tables";
import { ShowStore } from "../state/store";
import { FakeBackend } from "../test/fakeBackend";
import { designFixture, fixture } from "../test/fixture";
import { TableStylePreview } from "./ShapeTabs";

afterEach(cleanup);

Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 1312 });
Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 752 });

const flush = () => act(() => new Promise((r) => setTimeout(r, 0)));
const last = <T,>(a: T[]): T => a[a.length - 1]!;

async function mount(backend = new FakeBackend(designFixture())) {
  const store = new ShowStore(new ShowApi(backend));
  render(<App backend={backend} store={store} />);
  await waitFor(() => expect(screen.getAllByTestId("thumbnail").length).toBeGreaterThan(0));
  await flush();
  return { backend, store };
}

const stage = () => screen.getByTestId("editor-stage");

function openMaster() {
  fireEvent.click(screen.getByRole("tab", { name: "View" }));
  fireEvent.click(screen.getByRole("button", { name: "Slide Master" }));
}

describe("Format Background › Picture or texture fill", () => {
  it("Insert… sends the picture; Tile and Transparency change it", async () => {
    const { backend } = await mount();
    fireEvent.click(screen.getByRole("tab", { name: "Design" }));
    fireEvent.click(screen.getByRole("button", { name: "Format Background" }));
    const pane = screen.getByRole("complementary", { name: "Format Background" });
    fireEvent.click(within(pane).getByLabelText("Picture or texture fill"));
    const box = within(pane).getByTestId("bg-picture");
    expect((within(box).getByTestId("bg-tile") as HTMLInputElement).disabled).toBe(true); // no picture yet
    const file = new File([new Uint8Array([137, 80, 78, 71])], "paper.png", { type: "image/png" });
    await act(async () => {
      fireEvent.change(within(box).getByTestId("bg-picture-file"), { target: { files: [file] } });
      await new Promise((r) => setTimeout(r, 0));
    });
    await flush();
    expect(last(backend.commands)).toMatchObject({ type: "setBackgroundPicture", target: { kind: "slides", value: [1] }, contentType: "image/png", tile: false, transparency: 0 });
    fireEvent.click(within(pane).getByTestId("bg-tile"));
    await flush();
    expect(last(backend.commands)).toMatchObject({ type: "setBackground", target: { kind: "slides", value: [1] }, fill: { kind: "picture", value: { tile: true } } });
    fireEvent.change(within(pane).getByTestId("bg-transparency"), { target: { value: "40" } });
    await flush();
    expect(last(backend.commands)).toMatchObject({ fill: { kind: "picture", value: { tile: true, transparency: 0.4 } } });
    // the slide reports a picture background
    expect(stage().querySelector('[data-konva="Rect"]')).toBeTruthy();
  });
});

describe("Slide Master tab", () => {
  it("Rename opens the dialog and renames the selected layout", async () => {
    const { backend, store } = await mount();
    openMaster();
    expect(store.getState().masterView).toEqual({ kind: "layout", value: "title" });
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    const dlg = screen.getByRole("dialog", { name: "Rename Layout" });
    const input = within(dlg).getByLabelText("Layout name");
    fireEvent.change(input, { target: { value: "Opening" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "Rename" }));
    await flush();
    expect(last(backend.commands)).toEqual({ type: "renameLayout", layout: "title", name: "Opening" });
    expect(within(screen.getByTestId("master-panel")).getByRole("button", { name: "Opening" })).toBeTruthy();
  });

  it("Insert Placeholder ▾ offers the kinds; the master's existing ones are disabled", async () => {
    const { backend, store } = await mount();
    openMaster();
    fireEvent.click(screen.getByRole("button", { name: "Insert Placeholder" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Picture" }));
    await flush();
    expect(last(backend.commands)).toMatchObject({ type: "addPlaceholder", target: { kind: "layout", value: "title" }, kind: "picture" });
    store.selectDesignTarget({ kind: "master" });
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Insert Placeholder" }));
    expect(screen.getByRole("menuitem", { name: "Title" }).getAttribute("aria-disabled") ?? String((screen.getByRole("menuitem", { name: "Title" }) as HTMLButtonElement).disabled)).toBe("true");
  });

  it("Title and Footers check boxes of a layout", async () => {
    const { backend } = await mount();
    openMaster();
    const footers = screen.getByRole("checkbox", { name: "Footers" }) as HTMLInputElement;
    expect(footers.checked).toBe(true);
    fireEvent.click(footers);
    await flush();
    expect(last(backend.commands)).toMatchObject({ type: "compound" });
    expect((screen.getByRole("checkbox", { name: "Footers" }) as HTMLInputElement).checked).toBe(false);
  });

  it("the Text level selector routes Home formatting of the master body to that level", async () => {
    const { backend, store } = await mount();
    openMaster();
    act(() => store.selectDesignTarget({ kind: "master" }));
    const sel = screen.getByTestId("master-level") as HTMLSelectElement;
    expect(sel.disabled).toBe(false);
    fireEvent.change(sel, { target: { value: "2" } });
    expect(store.getState().masterLevel).toBe(2);
    act(() => store.select([DESIGN_SHAPE_BASE + 1]));
    fireEvent.click(screen.getByRole("tab", { name: "Home" }));
    fireEvent.click(screen.getByRole("button", { name: "Italic" }));
    await flush();
    expect(last(backend.commands)).toEqual({ type: "setMasterTextStyle", which: "body", level: 2, run: { italic: true } });
  });

  it("a layout's custom prompt shows in the slides' empty placeholders", async () => {
    const p = designFixture();
    const tc = p.layouts.find((l) => l.kind === "titleContent")!;
    tc.placeholders = tc.placeholders.map((d) => (d.kind === "title" ? { ...d, prompt: "Name the topic" } : d));
    const slide = p.slides.find((s) => s.layout === "titleContent")!;
    slide.shapes = slide.shapes.map((s) => (s.placeholder === "title" && s.kind.kind === "auto" ? { ...s, kind: { kind: "auto", value: { ...s.kind.value, text: { ...s.kind.value.text!, paragraphs: [{ runs: [] }] } } } } : s));
    const { store } = await mount(new FakeBackend(p));
    act(() => store.selectSlide(slide.id));
    await flush();
    expect(within(stage()).getByText("Name the topic")).toBeTruthy();
  });
});

describe("Format Shape › Size", () => {
  it("Lock aspect ratio is saved with the shape (SetLockAspect)", async () => {
    const { backend, store } = await mount(new FakeBackend(fixture()));
    act(() => store.select([2]));
    act(() => store.openFormatPane("size"));
    await flush();
    const lock = screen.getByTestId("fmt-lock") as HTMLInputElement;
    expect(lock.checked).toBe(false);
    fireEvent.click(lock);
    await flush();
    expect(last(backend.commands)).toEqual({ type: "setLockAspect", shapes: [2], locked: true });
    expect((screen.getByTestId("fmt-lock") as HTMLInputElement).checked).toBe(true);
  });
});

describe("Insert › Shapes", () => {
  it("Equation shapes and the new basic shapes insert their presets", async () => {
    const { backend } = await mount(new FakeBackend(fixture()));
    fireEvent.click(screen.getByRole("tab", { name: "Insert" }));
    fireEvent.click(screen.getByRole("button", { name: "Shapes" }));
    const lib = screen.getByRole("dialog", { name: "Shapes" });
    const eq = within(lib).getByRole("group", { name: "Equation shapes" });
    expect(within(eq).getAllByRole("button")).toHaveLength(6);
    fireEvent.click(within(eq).getByRole("button", { name: "Not equal" }));
    await flush();
    expect(last(backend.commands)).toMatchObject({ type: "addShape", shape: { kind: { kind: "auto", value: { geometry: "mathNotEqual" } } } });
    fireEvent.click(screen.getByRole("button", { name: "Shapes" }));
    const flow = within(screen.getByRole("dialog", { name: "Shapes" })).getByRole("group", { name: "Flowchart" });
    expect(within(flow).getAllByRole("button")).toHaveLength(29);
  });
});

describe("table style previews", () => {
  it("draw the style's cells with the table's options", () => {
    const style = tableStyleOf("{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}")!;
    const { container } = render(<TableStylePreview style={style} look={{ firstRow: true, bandRows: true }} palette={themePalette(fixture().theme)} />);
    // 5 × 4 cells, each with its fill
    expect(container.querySelectorAll("rect").length).toBeGreaterThanOrEqual(20);
    expect(container.querySelectorAll("line").length).toBeGreaterThan(0);
  });
});

describe("media in the click sequence of the show", () => {
  it("a clip 'In Click Sequence' plays when its step comes", () => {
    const play = vi.fn(() => Promise.resolve());
    const pause = vi.fn();
    Object.defineProperty(HTMLMediaElement.prototype, "play", { configurable: true, value: play });
    Object.defineProperty(HTMLMediaElement.prototype, "pause", { configurable: true, value: pause });
    const p = fixture();
    const slide = {
      ...p.slides[0]!,
      animations: [],
      shapes: [
        {
          id: 50,
          name: "Video",
          transform: { x: 0, y: 0, w: 1000000, h: 600000, rotationDeg: 0 },
          kind: { kind: "media" as const, value: { kind: "video" as const, media: 1, start: "inClickSequence" as const } },
          fill: { kind: "none" as const },
          line: { fill: { kind: "none" as const }, width: 0, dash: "solid" as const },
        },
      ],
    };
    const media = new Map([[1, "data:video/webm;base64,GkXfow=="]]);
    const { rerender } = render(<ShowOverlay deck={deckOf(p)} slide={slide} step={0} media={media} width={960} height={540} onLink={vi.fn()} />);
    expect(screen.getByTestId("show-media-50")).toBeTruthy();
    expect(play).not.toHaveBeenCalled();
    rerender(<ShowOverlay deck={deckOf(p)} slide={slide} step={1} media={media} width={960} height={540} onLink={vi.fn()} />);
    expect(play).toHaveBeenCalledTimes(1);
    rerender(<ShowOverlay deck={deckOf(p)} slide={slide} step={0} media={media} width={960} height={540} onLink={vi.fn()} />);
    expect(pause).toHaveBeenCalled();
  });
});
