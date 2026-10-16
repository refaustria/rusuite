// P8-22 through the app: Design tab, layouts, master view, Header & Footer, sections, Picture Format, rendering.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ setTitle: vi.fn() }) }));
vi.mock("react-konva", () => import("../test/konvaMock"));

import App from "../App";
import { ShowApi } from "../api";
import { DESIGN_SHAPE_BASE } from "../design/master";
import { ShowStore } from "../state/store";
import { FakeBackend } from "../test/fakeBackend";
import { FAKE_THEMES, designFixture } from "../test/fixture";
import { variantColors } from "../design/variants";
import { FONT_PAIRS } from "../design/variants";

afterEach(cleanup);

Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 1312 });
Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 752 });

const flush = () => act(() => new Promise((r) => setTimeout(r, 0)));
const last = <T,>(a: T[]): T => a[a.length - 1]!;

async function mount(backend = new FakeBackend(designFixture())) {
  const store = new ShowStore(new ShowApi(backend));
  render(<App backend={backend} store={store} />);
  await waitFor(() => expect(screen.getAllByTestId("thumbnail")).toHaveLength(4));
  await waitFor(() => expect(store.getState().themes?.length).toBe(2));
  await flush();
  return { backend, store };
}

const stage = () => screen.getByTestId("editor-stage");
/** The fill of the stage's text fragment `text`. */
const textFill = (text: string) =>
  [...stage().querySelectorAll('[data-konva="Text"]')].find((e) => e.textContent?.startsWith(text))?.getAttribute("data-fill");

describe("Design tab", () => {
  it("Themes: applying Harbor re-colours the title (theme colours resolve on the canvas)", async () => {
    const { backend } = await mount();
    expect(textFill("Welcome")).toBe("#000000");
    fireEvent.click(screen.getByRole("tab", { name: "Design" }));
    const themes = screen.getAllByRole("group", { name: "Themes" }).at(-1)!;
    expect(within(themes).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual(["Office", "Harbor"]);
    fireEvent.click(within(themes).getByRole("button", { name: "Harbor" }));
    await flush();
    expect(last(backend.commands)).toEqual({ type: "applyTheme", theme: { kind: "builtin", value: "harbor" } });
    expect(textFill("Welcome")).toBe("#1B2A3A");
    expect(within(themes).getByRole("button", { name: "Harbor" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("Variants, Colors ▾ and Fonts ▾ replace the theme's colours and fonts", async () => {
    const { backend } = await mount();
    fireEvent.click(screen.getByRole("tab", { name: "Design" }));
    fireEvent.click(within(screen.getAllByRole("group", { name: "Variants" }).at(-1)!).getByRole("button", { name: "Variant 3" }));
    await flush();
    expect(last(backend.commands)).toEqual({ type: "setThemeColors", colors: variantColors(FAKE_THEMES[0]!.theme.colors, 2) });
    fireEvent.click(screen.getByRole("button", { name: "Colors" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Harbor" }));
    await flush();
    expect(last(backend.commands)).toEqual({ type: "setThemeColors", colors: FAKE_THEMES[1]!.theme.colors });
    fireEvent.click(screen.getByRole("button", { name: "Fonts" }));
    const pair = FONT_PAIRS[3]!;
    fireEvent.click(screen.getByRole("menuitemradio", { name: `${pair.name}: ${pair.majorLatin} / ${pair.minorLatin}` }));
    await flush();
    expect(last(backend.commands)).toEqual({ type: "setThemeFonts", fonts: pair });
  });

  it("Background Styles set the master's background style; Slide Size › Standard / Custom", async () => {
    const { backend } = await mount();
    fireEvent.click(screen.getByRole("tab", { name: "Design" }));
    fireEvent.click(screen.getByRole("button", { name: "Background Styles" }));
    fireEvent.click(screen.getByRole("button", { name: "Style 11" }));
    await flush();
    expect(last(backend.commands)).toEqual({
      type: "setBackground", target: { kind: "master" }, fill: { kind: "style", value: { index: 1003, color: { kind: "theme", value: { slot: "dark2", tint: 0 } } } },
    });
    fireEvent.click(screen.getByRole("button", { name: "Slide Size" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Standard (4:3)" }));
    await flush();
    expect(last(backend.commands)).toEqual({ type: "setSlideSize", size: { width: 9144000, height: 6858000 } });
    fireEvent.click(screen.getByRole("button", { name: "Slide Size" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Custom Slide Size…" }));
    const dlg = screen.getByRole("dialog", { name: "Slide Size" });
    fireEvent.change(within(dlg).getByLabelText("Width"), { target: { value: "20" } });
    fireEvent.change(within(dlg).getByLabelText("Height"), { target: { value: "15" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "OK" }));
    await flush();
    expect(last(backend.commands)).toEqual({ type: "setSlideSize", size: { width: 7200000, height: 5400000 } });
  });

  it("Format Background: solid on the slide, gradient on the master, hide background graphics", async () => {
    const { backend } = await mount();
    fireEvent.click(screen.getByRole("tab", { name: "Design" }));
    fireEvent.click(screen.getByRole("button", { name: "Format Background" }));
    const pane = screen.getByRole("complementary", { name: "Format Background" });
    expect(within(pane).getByTestId("bg-target").textContent).toBe("Current slide");
    fireEvent.click(within(pane).getByLabelText("Gradient fill"));
    await flush();
    expect(last(backend.commands)).toEqual({ type: "setBackground", target: { kind: "master" }, fill: { kind: "style", value: { index: 1003, color: { kind: "theme", value: { slot: "accent1", tint: 0 } } } } });
    fireEvent.click(within(pane).getByLabelText("Hide background graphics"));
    await flush();
    expect(last(backend.commands)).toEqual({ type: "setBackground", target: { kind: "slides", value: [1] }, fill: null, hideMasterShapes: true });
    // the slide no longer draws the master's accent bar
    expect(within(stage()).queryAllByText("", { selector: '[data-shape-id="900"]' })).toHaveLength(0);
  });
});

describe("layouts", () => {
  it("New Slide ▾ shows every layout as a thumbnail; Layout ▾ re-applies one; Reset", async () => {
    const { backend } = await mount();
    const slides = within(screen.getByRole("toolbar", { name: "Formatting" })).getByRole("group", { name: "Slides" });
    fireEvent.click(within(slides).getByRole("button", { name: "Slide layouts" }));
    const gallery = screen.getByRole("group", { name: "Slide layouts" });
    expect(within(gallery).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual(["Title slide", "Title and content", "Blank", "Two content"]);
    expect(within(gallery).getAllByTestId("layout-thumb")).toHaveLength(4);
    fireEvent.click(within(gallery).getByRole("button", { name: "Two content" }));
    await flush();
    expect(last(backend.commands)).toEqual({ type: "addSlide", after: 1, layout: "twoContent" });
    fireEvent.click(within(slides).getByRole("button", { name: "Layout" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Layout" })).getByRole("button", { name: "Title and content" }));
    await flush();
    expect(last(backend.commands)).toMatchObject({ type: "setSlideLayout", layout: "titleContent" });
    fireEvent.click(within(slides).getByRole("button", { name: "Reset" }));
    await flush();
    expect(last(backend.commands)).toMatchObject({ type: "resetSlide" });
  });
});

describe("Slide Master view", () => {
  it("opens from View, lists the master and its layouts, edits placeholders through design commands", async () => {
    const { backend, store } = await mount();
    fireEvent.click(screen.getByRole("tab", { name: "View" }));
    fireEvent.click(screen.getByRole("button", { name: "Slide Master" }));
    const panel = screen.getByTestId("master-panel");
    expect(within(panel).getAllByTestId("master-thumb").map((b) => b.getAttribute("aria-label"))).toEqual(["Slide master", "Title slide", "Title and content", "Blank", "Two content"]);
    expect(stage().getAttribute("data-master-view")).toBe("title"); // the current slide's layout
    fireEvent.click(within(panel).getByRole("button", { name: "Slide master" }));
    expect(stage().getAttribute("data-master-view")).toBe("master");
    expect(within(stage()).getByText("Click to edit Master title style")).toBeTruthy();
    expect(within(stage()).getByText("Fifth level")).toBeTruthy();
    // moving the title placeholder
    const t = { x: 100, y: 200, w: 3000000, h: 900000, rotationDeg: 0 };
    await act(() => store.setTransforms([[DESIGN_SHAPE_BASE, t]]));
    expect(last(backend.commands)).toEqual({ type: "setMasterPlaceholderProps", target: { kind: "master" }, placeholder: "title", patch: { transform: t } });
    expect(store.getState().pres!.master!.placeholders[0]!.transform).toEqual(t);
    // level-1 formatting from the Home tab
    act(() => store.select([DESIGN_SHAPE_BASE]));
    fireEvent.click(screen.getByRole("tab", { name: "Home" }));
    fireEvent.click(screen.getByRole("button", { name: "Bold" }));
    await flush();
    expect(last(backend.commands)).toEqual({ type: "setMasterPlaceholderProps", target: { kind: "master" }, placeholder: "title", patch: { run: { bold: true } } });
  });

  it("Insert / Duplicate / Delete Layout; used layouts cannot be deleted; Close Master View", async () => {
    const { backend } = await mount();
    fireEvent.click(screen.getByRole("tab", { name: "View" }));
    fireEvent.click(screen.getByRole("button", { name: "Slide Master" }));
    expect(screen.getByRole("button", { name: "Delete Layout" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Insert Layout" }));
    await flush();
    expect(last(backend.commands)).toEqual({ type: "addLayout", name: "Custom Layout" });
    expect(stage().getAttribute("data-master-view")).toBe("custom:Custom Layout");
    fireEvent.click(screen.getByRole("button", { name: "Duplicate Layout" }));
    await flush();
    expect(last(backend.commands)).toEqual({ type: "duplicateLayout", layout: "custom:Custom Layout" });
    fireEvent.click(screen.getByRole("button", { name: "Delete Layout" }));
    await flush();
    expect(last(backend.commands)).toEqual({ type: "deleteLayout", layout: "custom:1_custom:Custom Layout" });
    expect(stage().getAttribute("data-master-view")).toBe("master");
    fireEvent.click(screen.getByRole("button", { name: "Close Master View" }));
    expect(stage().getAttribute("data-master-view")).toBeNull();
    expect(screen.getAllByTestId("thumbnail")).toHaveLength(4);
  });

  it("the master's decorative shapes and background are drawn under every slide", async () => {
    await mount();
    expect(stage().querySelector('[data-shape-id="900"]')).toBeTruthy();
    expect(stage().querySelector('[data-fill="#FFFFFF"]')).toBeTruthy();
  });
});

describe("Header & Footer and fields", () => {
  it("Apply to All sends SetHeaderFooter; the slides show the live slide number", async () => {
    const { backend } = await mount();
    fireEvent.click(screen.getByRole("tab", { name: "Insert" }));
    fireEvent.click(screen.getByRole("button", { name: "Header & Footer…" }));
    const dlg = screen.getByRole("dialog", { name: "Header and Footer" });
    fireEvent.click(within(dlg).getByLabelText("Slide number"));
    fireEvent.click(within(dlg).getByLabelText("Footer"));
    fireEvent.change(within(dlg).getByLabelText("Footer text"), { target: { value: "Rusuite" } });
    fireEvent.click(within(dlg).getByLabelText("Don't show on title slide"));
    fireEvent.click(within(dlg).getByRole("button", { name: "Apply to all" }));
    await flush();
    expect(last(backend.commands)).toEqual({ type: "setHeaderFooter", date: { kind: "off" }, footer: "Rusuite", slideNumber: true, applyTo: { kind: "all" }, notOnTitle: true });
    fireEvent.click(screen.getAllByTestId("thumbnail")[1]!);
    expect(within(stage()).getByText("2")).toBeTruthy();
    expect(within(stage()).getByText("Rusuite")).toBeTruthy();
  });

  it("Insert › Slide Number while editing inserts a field run at the caret", async () => {
    const { backend, store } = await mount();
    fireEvent.click(screen.getAllByTestId("thumbnail")[1]!);
    act(() => store.startEdit(5));
    act(() => store.updateEdit("Slide two", 6, 6));
    fireEvent.click(screen.getByRole("tab", { name: "Insert" }));
    fireEvent.click(screen.getByRole("button", { name: "Slide Number" }));
    await flush();
    const c = last(backend.commands);
    expect(c.type === "setTextBody" && c.body.paragraphs[0]!.runs).toEqual([{ text: "Slide " }, { text: "2", field: { kind: "slideNumber" } }, { text: "two" }]);
    expect(store.getState().editing?.text).toBe("Slide 2two");
  });
});

describe("sections in the slide panel", () => {
  it("collapsible headers, rename / move / remove from the context menu, Add Section", async () => {
    const { backend } = await mount();
    const headers = () => screen.getAllByTestId("section-header");
    expect(headers().map((h) => h.textContent)).toEqual(["▾Intro", "▾Body"]);
    fireEvent.click(headers()[0]!);
    expect(screen.getAllByTestId("thumbnail")).toHaveLength(2);
    expect(headers()[0]!.textContent).toBe("▸Intro(2)");
    fireEvent.contextMenu(headers()[1]!);
    fireEvent.click(screen.getByRole("menuitem", { name: "Expand All" }));
    expect(screen.getAllByTestId("thumbnail")).toHaveLength(4);
    fireEvent.contextMenu(headers()[1]!);
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename Section…" }));
    const dlg = screen.getByRole("dialog", { name: "Rename Section" });
    fireEvent.change(within(dlg).getByLabelText("Section name"), { target: { value: "Main part" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "Rename" }));
    await flush();
    expect(last(backend.commands)).toEqual({ type: "renameSection", index: 1, name: "Main part" });
    fireEvent.contextMenu(headers()[1]!);
    fireEvent.click(screen.getByRole("menuitem", { name: "Move Section Up" }));
    await flush();
    expect(last(backend.commands)).toEqual({ type: "moveSection", index: 1, toIndex: 0 });
    expect(headers().map((h) => h.textContent)).toEqual(["▾Main part", "▾Intro"]);
    fireEvent.contextMenu(headers()[0]!);
    fireEvent.click(screen.getByRole("menuitem", { name: "Remove Section" }));
    await flush();
    expect(last(backend.commands)).toEqual({ type: "removeSection", index: 0, keepSlides: true });
    // Add Section at the current slide asks for the name
    fireEvent.click(within(screen.getByRole("toolbar", { name: "Formatting" })).getByRole("button", { name: "Add Section" }));
    await flush();
    expect(backend.commands.at(-1)).toMatchObject({ type: "addSection", name: "Untitled Section" });
    expect(screen.getByRole("dialog", { name: "Rename Section" })).toBeTruthy();
  });

  it("dropping a slide on a section header moves it into that section (one undo step)", async () => {
    const { backend } = await mount();
    const thumbs = screen.getAllByTestId("thumbnail");
    const data = new Map<string, string>();
    const dataTransfer = { setData: (k: string, v: string) => data.set(k, v), getData: (k: string) => data.get(k) ?? "", effectAllowed: "", dropEffect: "" };
    fireEvent.dragStart(thumbs[0]!, { dataTransfer });
    fireEvent.drop(screen.getAllByTestId("section-header")[1]!, { dataTransfer });
    await flush();
    expect(last(backend.commands)).toEqual({
      type: "compound",
      commands: [
        { type: "moveSlide", id: 1, toIndex: 1 },
        { type: "restoreSections", sections: [{ name: "Intro", slideIds: [4] }, { name: "Body", slideIds: [1, 7, 20] }] },
      ],
    });
  });
});

describe("Picture Format", () => {
  async function withPicture() {
    const r = await mount();
    fireEvent.click(screen.getAllByTestId("thumbnail")[3]!);
    act(() => r.store.select([21]));
    fireEvent.click(screen.getByRole("tab", { name: "Picture Format" }));
    return r;
  }

  it("Corrections, Color, Shadow, Picture Styles, Reset", async () => {
    const { backend } = await withPicture();
    fireEvent.click(screen.getByRole("button", { name: "Corrections" }));
    fireEvent.click(screen.getByRole("button", { name: "Brightness: +20 % Contrast: −40 %" }));
    await flush();
    expect(last(backend.commands)).toEqual({ type: "setPictureProps", shapes: [21], patch: { brightness: 0.2, contrast: -0.4 } });
    fireEvent.click(screen.getByRole("button", { name: "Color" }));
    fireEvent.click(screen.getByRole("button", { name: "Grayscale" }));
    await flush();
    expect(last(backend.commands)).toEqual({ type: "setPictureProps", shapes: [21], patch: { recolor: { kind: "grayscale" } } });
    fireEvent.click(screen.getByRole("button", { name: "Color" }));
    fireEvent.click(screen.getByRole("button", { name: "Transparency: 50%" }));
    await flush();
    expect(last(backend.commands)).toEqual({ type: "setPictureProps", shapes: [21], patch: { transparency: 0.5 } });
    fireEvent.click(screen.getByRole("button", { name: "Shadow" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Offset: Bottom" }));
    await flush();
    expect(last(backend.commands)).toMatchObject({ type: "setPictureProps", patch: { shadow: { directionDeg: 90 } } });
    fireEvent.click(within(screen.getAllByRole("group", { name: "Picture Styles" }).at(-1)!).getByRole("button", { name: "Oval, White Frame" }));
    await flush();
    const c = last(backend.commands);
    expect(c.type === "compound" && c.commands.map((x) => x.type)).toEqual(["setPictureProps", "setShapeStyle"]);
    fireEvent.click(screen.getByRole("button", { name: "Reset Picture" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Reset Picture & Size" }));
    await flush();
    expect(last(backend.commands)).toEqual({ type: "resetPicture", shapes: [21], size: true });
  });

  it("Crop: handles drag the edge, Enter sends CropPicture, Esc cancels", async () => {
    const { backend, store } = await withPicture();
    fireEvent.click(screen.getByRole("button", { name: "Crop" }));
    const handle = screen.getByTestId("crop-handle-r");
    const overlay = screen.getByTestId("crop-overlay");
    fireEvent.pointerDown(handle, { clientX: 500, clientY: 300, pointerId: 1 });
    fireEvent.pointerMove(overlay, { clientX: 400, clientY: 300, pointerId: 1 });
    fireEvent.pointerUp(overlay, { pointerId: 1 });
    const crop = store.getState().crop!;
    expect(crop.crop.right).toBeGreaterThan(0.1);
    expect(crop.box.w).toBeLessThan(3657600);
    fireEvent.keyDown(window, { key: "Enter" });
    await flush();
    expect(last(backend.commands)).toMatchObject({ type: "cropPicture", shape: 21, crop: { left: 0, top: 0, bottom: 0 } });
    expect(screen.queryByTestId("crop-overlay")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Crop" }));
    const n = backend.commands.length;
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("crop-overlay")).toBeNull();
    expect(backend.commands).toHaveLength(n);
  });
});
