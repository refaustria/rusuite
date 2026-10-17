// P9-S3 through the real App: the rich Outline View, Slide Sorter polish,
// custom shows, Format Background, guides and print ranges.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ setTitle: vi.fn() }) }));
vi.mock("react-konva", () => import("../test/konvaMock"));

import App from "../App";
import { ShowApi } from "../api";
import { ShowStore } from "../state/store";
import { FakeBackend } from "../test/fakeBackend";
import { designFixture, fixture } from "../test/fixture";
import { writeSelection } from "../canvas/richEditor";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 1312 });
Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 752 });

const flush = () => act(() => new Promise((r) => setTimeout(r, 0)));
const tab = (name: string) => screen.getByRole("tab", { name });

async function mount(backend = new FakeBackend()) {
  const store = new ShowStore(new ShowApi(backend));
  render(<App backend={backend} store={store} />);
  await waitFor(() => expect(screen.getAllByTestId("thumbnail").length).toBeGreaterThan(0));
  await flush();
  return { backend, store };
}

async function outlineView() {
  fireEvent.click(tab("View"));
  fireEvent.click(screen.getByRole("button", { name: "Outline View" }));
  await waitFor(() => expect(screen.getAllByTestId("outline-text")).toHaveLength(3));
  return screen.getAllByTestId("outline-text");
}

/** Puts the caret at `at` (editor text offset) in an outline editor. */
function caret(el: HTMLElement, at: number, end = at) {
  el.focus();
  writeSelection(el, at, end);
}

describe("rich Outline View", () => {
  it("shows titles and body lines with their depth and the runs' formatting on request", async () => {
    const p = fixture();
    const body = p.slides[1]!.shapes[1]!;
    if (body.kind.kind === "auto") body.kind.value.text!.paragraphs[0]!.runs = [{ text: "First " }, { text: "point", props: { bold: true } }];
    await mount(new FakeBackend(p));
    const eds = await outlineView();
    expect(eds[1]!.querySelectorAll("[data-depth]")).toHaveLength(3);
    expect(eds[1]!.querySelector('[data-depth="1"] span:nth-child(2)')?.getAttribute("style") ?? "").not.toContain("700");
    fireEvent.contextMenu(eds[1]!);
    fireEvent.click(screen.getByRole("menuitem", { name: /Show Text Formatting/ }));
    await waitFor(() => expect(screen.getByTestId("outline-pane").dataset.formatting).toBe("true"));
    expect(screen.getAllByTestId("outline-text")[1]!.querySelector('[data-depth="1"] span:nth-child(2)')?.getAttribute("style")).toContain("700");
  });

  it("Tab on a title demotes it: the slide joins the previous one (one undo step)", async () => {
    const { backend, store } = await mount();
    const eds = await outlineView();
    caret(eds[2]!, 0);
    fireEvent.keyDown(eds[2]!, { key: "Tab" });
    await waitFor(() => expect(store.getState().pres?.slides).toHaveLength(2));
    // slide 3 (blank, no title) joined slide 2's body
    expect(backend.commands.at(-1)?.type).toBe("compound");
  });

  it("Shift+Tab on a body line promotes it to a new slide", async () => {
    const { backend, store } = await mount();
    const eds = await outlineView();
    // "Slide two\nFirst point\nSecond point": the caret in "Second point"
    caret(eds[1]!, 25);
    fireEvent.keyDown(eds[1]!, { key: "Tab", shiftKey: true });
    await waitFor(() => expect(store.getState().pres?.slides).toHaveLength(4));
    // the body keeps "First point" (the new slide's placeholders get the rest)
    const body = backend.commands.find((c) => c.type === "setTextBody" && c.shape === 6);
    expect(body?.type === "setTextBody" && body.body.paragraphs.map((x) => x.runs.map((r) => r.text).join(""))).toEqual(["First point"]);
    expect(backend.commands.some((c) => c.type === "addSlide")).toBe(true);
  });

  it("collapses a slide to its title and expands it again; Ctrl+B formats the selection", async () => {
    const { backend } = await mount();
    const eds = await outlineView();
    fireEvent.click(screen.getAllByTestId("outline-toggle")[1]!);
    await waitFor(() => expect(screen.getAllByTestId("outline-slide")[1]!.dataset.collapsed).toBe("true"));
    expect(screen.getAllByTestId("outline-text")[1]!.querySelectorAll("[data-depth]")).toHaveLength(1);
    fireEvent.click(screen.getAllByTestId("outline-toggle")[1]!);
    await waitFor(() => expect(screen.getAllByTestId("outline-text")[1]!.querySelectorAll("[data-depth]")).toHaveLength(3));
    const ed = screen.getAllByTestId("outline-text")[1]!;
    caret(ed, 0, 5); // "Slide"
    fireEvent.keyDown(ed, { key: "b", ctrlKey: true });
    fireEvent.blur(ed);
    await waitFor(() => expect(backend.commands.at(-1)).toMatchObject({ type: "setTextBody", shape: 5 }));
    const c = backend.commands.at(-1);
    expect(c?.type === "setTextBody" && c.body.paragraphs[0]!.runs[0]).toEqual({ text: "Slide", props: { bold: true } });
    void eds;
  });
});

describe("Slide Sorter polish", () => {
  it("a transition goes to every selected slide; Ctrl+↓ moves the selection", async () => {
    const { backend, store } = await mount();
    fireEvent.click(tab("View"));
    fireEvent.click(screen.getByRole("button", { name: "Slide Sorter" }));
    const thumbs = screen.getAllByTestId("sorter-thumb");
    fireEvent.pointerDown(thumbs[0]!, { button: 0 });
    fireEvent.pointerUp(thumbs[0]!);
    fireEvent.pointerDown(thumbs[1]!, { button: 0, ctrlKey: true });
    fireEvent.pointerUp(thumbs[1]!, { ctrlKey: true });
    expect(store.getState().slideSel).toHaveLength(2);
    await act(() => store.setTransition({ kind: "fade" }));
    const c = backend.commands.at(-1);
    expect(c?.type === "setTransition" && c.slides).toEqual([1, 4]);
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "ArrowDown", ctrlKey: true });
    await waitFor(() => expect(store.getState().pres?.slides.map((s) => s.id)).toEqual([7, 1, 4]));
  });
});

describe("custom shows and Set Up Slide Show", () => {
  it("Custom Shows… › New defines a show from picked slides; Show starts it", async () => {
    const { backend } = await mount();
    fireEvent.click(tab("Slide Show"));
    fireEvent.click(screen.getByRole("button", { name: "Custom Slide Show" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Custom Shows…" }));
    fireEvent.click(screen.getByRole("button", { name: "New…" }));
    const define = screen.getByTestId("define-custom-show");
    fireEvent.change(screen.getByRole("textbox", { name: "Slide show name:" }), { target: { value: "Short" } });
    const boxes = define.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    fireEvent.click(boxes[2]!);
    fireEvent.click(boxes[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Add »" }));
    // presentation order: slide 1, then slide 3; move slide 3 up
    fireEvent.click(screen.getAllByRole("option").filter((o) => o.closest('[data-testid="custom-show-slides"]'))[1]!);
    fireEvent.click(screen.getByRole("button", { name: "Move up" }));
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    await waitFor(() => expect(backend.commands.at(-1)).toEqual({ type: "setCustomShows", shows: [{ id: 0, name: "Short", slideIds: [7, 1] }] }));
    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    await waitFor(() => expect(screen.getByTestId("presenter-counter").textContent).toBe("1 / 2"));
  });

  it("Set Up Show stores the show type, the custom show and the pen colour", async () => {
    const p = fixture();
    p.customShows = [{ id: 4, name: "Kiosk", slideIds: [4] }];
    const { backend } = await mount(new FakeBackend(p));
    fireEvent.click(tab("Slide Show"));
    fireEvent.click(screen.getByRole("button", { name: "Set Up Slide Show" }));
    fireEvent.click(screen.getByRole("radio", { name: "Browsed at a kiosk (full screen)" }));
    fireEvent.click(screen.getByRole("radio", { name: "Custom show:" }));
    fireEvent.change(screen.getByLabelText("Pen color:"), { target: { value: "#00b050" } });
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    await waitFor(() => expect(backend.commands.at(-1)?.type).toBe("setShowSettings"));
    const c = backend.commands.at(-1);
    expect(c?.type === "setShowSettings" && c.settings).toMatchObject({ showType: "kiosk", loop: true, customShow: 4, penColor: "00B050" });
  });
});

describe("Format Background pane and Effects", () => {
  async function pane(p = fixture()) {
    const r = await mount(new FakeBackend(p));
    fireEvent.click(tab("Design"));
    fireEvent.click(screen.getByRole("button", { name: "Format Background" }));
    return { ...r, pane: screen.getByTestId("bg-pane") };
  }
  const lastCmd = (b: FakeBackend) => b.commands.at(-1);

  it("gradient: presets, type, angle and stops go to the slide", async () => {
    const { backend } = await pane();
    fireEvent.click(screen.getByTestId("bg-kind-gradient"));
    await flush();
    fireEvent.click(screen.getByTestId("bg-preset-medium-accent2"));
    await flush();
    let c = lastCmd(backend);
    expect(c?.type === "setBackground" && c.fill?.kind === "gradient" && c.fill.value.stops).toHaveLength(3);
    fireEvent.change(screen.getByRole("combobox", { name: "Type" }), { target: { value: "circle" } });
    await flush();
    c = lastCmd(backend);
    expect(c?.type === "setBackground" && c.fill?.kind === "gradient" && c.fill.value.shape).toBe("circle");
    fireEvent.change(screen.getByRole("combobox", { name: "Type" }), { target: { value: "linear" } });
    await flush();
    const angle = screen.getByTestId("bg-angle");
    fireEvent.change(angle, { target: { value: "45" } });
    fireEvent.blur(angle);
    await flush();
    c = lastCmd(backend);
    expect(c?.type === "setBackground" && c.fill?.kind === "gradient" && c.fill.value.angleDeg).toBe(45);
    fireEvent.click(screen.getByRole("button", { name: "Add stop" }));
    await flush();
    c = lastCmd(backend);
    expect(c?.type === "setBackground" && c.fill?.kind === "gradient" && c.fill.value.stops).toHaveLength(4);
    const tr = screen.getByTestId("bg-stop-transparency");
    fireEvent.change(tr, { target: { value: "40" } });
    fireEvent.blur(tr);
    await flush();
    c = lastCmd(backend);
    expect(c?.type === "setBackground" && c.fill?.kind === "gradient" && c.fill.value.stops.some((s) => s.transparency === 0.4)).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Remove stop" }));
    await flush();
    c = lastCmd(backend);
    expect(c?.type === "setBackground" && c.fill?.kind === "gradient" && c.fill.value.stops).toHaveLength(3);
  });

  it("pattern fill: a pattern and its colours", async () => {
    const { backend } = await pane();
    fireEvent.click(screen.getByTestId("bg-kind-pattern"));
    await flush();
    expect(lastCmd(backend)).toMatchObject({ type: "setBackground", fill: { kind: "pattern", value: { preset: "pct5" } } });
    fireEvent.click(screen.getByRole("button", { name: "Small checker board" }));
    await flush();
    expect(lastCmd(backend)).toMatchObject({ type: "setBackground", target: { kind: "slides", value: [1] }, fill: { kind: "pattern", value: { preset: "smCheck" } } });
  });

  it("picture: stretch offsets and tile scale", async () => {
    const p = fixture();
    p.media = [{ id: 3, contentType: "image/png", data: "iVBORw0KGgo=" }];
    p.slides[0]!.background = { kind: "picture", value: { media: 3 } };
    const { backend } = await pane(p);
    const left = screen.getByRole("spinbutton", { name: "Offset left" });
    fireEvent.change(left, { target: { value: "10" } });
    fireEvent.blur(left);
    await flush();
    expect(lastCmd(backend)).toMatchObject({ type: "setBackground", fill: { kind: "picture", value: { media: 3, offsets: [0.1, 0, 0, 0] } } });
    fireEvent.click(screen.getByTestId("bg-tile"));
    await flush();
    const sx = screen.getByRole("spinbutton", { name: "Scale X" });
    fireEvent.change(sx, { target: { value: "50" } });
    fireEvent.blur(sx);
    await flush();
    expect(lastCmd(backend)).toMatchObject({ type: "setBackground", fill: { kind: "picture", value: { tile: true, tileScale: [0.5, 1] } } });
  });

  it("Design › Effects sets the theme's effect styles", async () => {
    const { backend } = await mount();
    fireEvent.click(tab("Design"));
    fireEvent.click(screen.getByRole("button", { name: "Effects" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Rusuite Soft Shadows" }));
    await flush();
    const c = lastCmd(backend);
    expect(c).toMatchObject({ type: "setThemeEffects", name: "Rusuite Soft Shadows" });
    expect(c?.type === "setThemeEffects" && c.effectStyles).toHaveLength(3);
  });
});

describe("guides in the Slide Master view and the thumbnail pane", () => {
  it("Add Vertical Guide in the master view goes to the layout (SetDesignGuides)", async () => {
    const { backend, store } = await mount(new FakeBackend(designFixture()));
    act(() => store.openMasterView());
    const mv = store.getState().masterView;
    await act(() => store.addGuide("vertical"));
    const c = backend.commands.at(-1);
    expect(c?.type).toBe("compound");
    const cmds = c?.type === "compound" ? c.commands : [];
    expect(cmds[0]).toMatchObject({ type: "setDesignGuides", target: mv, guides: [{ orient: "vertical", pos: 6096000 }] });
    expect(cmds[1]).toMatchObject({ type: "setViewProps", view: { showGuides: true } });
    expect(store.editableGuides()).toHaveLength(1);
    act(() => store.closeMasterView());
    // on the slide: the layout's guide is shown, not editable
    expect(store.editableGuides()).toHaveLength(0);
    await waitFor(() => expect(screen.getByTestId("editor-stage").dataset.designGuides).toBe("1"));
  });

  it("the thumbnail pane's edge resizes it (keyboard too)", async () => {
    const { store } = await mount();
    const sep = screen.getByTestId("sidebar-resize");
    fireEvent.keyDown(sep, { key: "ArrowRight" });
    expect(store.getState().sidebarWidth).toBe(208);
    act(() => store.setSidebarWidth(9999));
    expect(store.getState().sidebarWidth).toBe(480);
  });
});
