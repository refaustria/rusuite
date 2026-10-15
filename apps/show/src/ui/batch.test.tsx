// P6-5 UI: slide sorter menu and drag, notes pane, dialogs, ribbon additions, presenter skipping hidden slides.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ setTitle: vi.fn() }) }));
vi.mock("react-konva", () => import("../test/konvaMock"));

import App from "../App";
import { ShowApi } from "../api";
import { shapeMenu, slideMenu, thumbnailMenu } from "../canvas/menus";
import { ShowStore } from "../state/store";
import { FakeBackend } from "../test/fakeBackend";
import { fixture } from "../test/fixture";

afterEach(cleanup);

Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 1312 });
Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 752 });

const flush = () => act(() => new Promise((r) => setTimeout(r, 0)));

const last = <T,>(a: T[]): T => a[a.length - 1]!;

async function mount(backend = new FakeBackend()) {
  const store = new ShowStore(new ShowApi(backend));
  render(<App backend={backend} store={store} />);
  await waitFor(() => expect(screen.getAllByTestId("thumbnail")).toHaveLength(3));
  await flush();
  return { backend, store };
}

const ids = (items: ReturnType<typeof shapeMenu>) => items.flatMap((i) => ("id" in i ? [i.id] : []));

describe("context menus (data)", () => {
  it("shape menu: clipboard, order, group, text, format; picture entries only for pictures", async () => {
    const backend = new FakeBackend();
    const store = new ShowStore(new ShowApi(backend));
    await store.init();
    store.selectSlide(7);
    store.select([8]);
    const items = shapeMenu(store);
    expect(ids(items)).toEqual([
      "cut", "copy", "paste", "duplicate", "delete", "editText", "bringToFront", "bringForward", "sendBackward", "sendToBack",
      "group", "ungroup", "alt", "format",
    ]);
    const get = (id: string) => items.find((i) => "id" in i && i.id === id) as { disabled?: boolean; onSelect: () => void };
    expect(get("paste").disabled).toBe(true);
    expect(get("group").disabled).toBe(true);
    get("format").onSelect();
    expect(store.getState().dialog).toEqual({ kind: "format" });
    get("copy").onSelect();
    expect(shapeMenu(store).find((i) => "id" in i && i.id === "paste")).toMatchObject({ disabled: false });
  });

  it("picture menu offers Change picture and Reset size", async () => {
    const pres = fixture();
    pres.media.push({ id: 1, contentType: "image/png", data: "AAAA" });
    pres.slides[2]!.shapes.push({
      id: 20, name: "Picture 20", transform: { x: 0, y: 0, w: 100, h: 100 }, kind: { kind: "picture", value: { media: 1 } },
      fill: { kind: "none" }, line: { fill: { kind: "none" }, width: 12700, dash: "solid" },
    });
    const store = new ShowStore(new ShowApi(new FakeBackend(pres)));
    await store.init();
    store.selectSlide(7);
    store.select([20]);
    const items = shapeMenu(store);
    expect(ids(items)).toContain("replacePicture");
    expect(ids(items)).toContain("resetSize");
    expect(items.find((i) => "id" in i && i.id === "editText")).toMatchObject({ disabled: true });
    (items.find((i) => "id" in i && i.id === "replacePicture") as { onSelect: () => void }).onSelect();
    expect(store.getState().dialog).toEqual({ kind: "replacePicture", shape: 20 });
  });

  it("slide and thumbnail menus: layouts with a check mark, hide/show", async () => {
    const store = new ShowStore(new ShowApi(new FakeBackend()));
    await store.init();
    const labels = slideMenu(store).flatMap((i) => ("label" in i ? [i.label] : []));
    expect(labels).toContain("Layout: Title slide ✓");
    expect(labels).toContain("Hide slide");
    const t = thumbnailMenu(store, 4);
    expect(t.flatMap((i) => ("label" in i ? [i.label] : []))).toContain("Layout: Title and content ✓");
  });
});

describe("P6-5 UI through the app", () => {
  it("thumbnail context menu hides a slide: dimmed, struck through, status bar says hidden", async () => {
    const { backend } = await mount();
    const thumb = screen.getAllByTestId("thumbnail")[1]!;
    fireEvent.contextMenu(thumb, { clientX: 20, clientY: 40 });
    const menu = screen.getByRole("menu", { name: "Slide actions" });
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Hide slide" }));
    await flush();
    expect(last(backend.commands)).toEqual({ type: "setSlidesHidden", slides: [4], hidden: true });
    expect(screen.getAllByTestId("thumbnail")[1]!.getAttribute("data-hidden")).toBe("true");
    expect(screen.getByTestId("slide-count").textContent).toBe("Slide 2 of 3 (hidden)");
  });

  it("drag and drop in the slide sorter shows the insertion line and moves the slide", async () => {
    const { backend } = await mount();
    const thumbs = screen.getAllByTestId("thumbnail");
    const data = new Map<string, string>();
    const dataTransfer = { setData: (k: string, v: string) => data.set(k, v), getData: (k: string) => data.get(k) ?? "", effectAllowed: "", dropEffect: "" };
    fireEvent.dragStart(thumbs[0]!, { dataTransfer });
    fireEvent.dragOver(thumbs[2]!, { dataTransfer });
    expect(screen.getAllByTestId("drop-indicator")).toHaveLength(1);
    fireEvent.drop(thumbs[2]!, { dataTransfer });
    await flush();
    expect(last(backend.commands)).toEqual({ type: "moveSlide", id: 1, toIndex: 1 });
    expect(screen.queryByTestId("drop-indicator")).toBeNull();
  });

  it("Ctrl+C / Ctrl+V in the slide sorter copy and paste the slide", async () => {
    const { backend } = await mount();
    const list = screen.getByTestId("slide-list");
    fireEvent.keyDown(list, { key: "c", ctrlKey: true });
    fireEvent.keyDown(list, { key: "v", ctrlKey: true });
    await flush();
    expect(backend.commands.map((c) => c.type)).toEqual(["duplicateSlide"]);
    expect(screen.getAllByTestId("thumbnail")).toHaveLength(4);
  });

  it("the notes pane (View › Notes) commits the notes on blur", async () => {
    const { backend } = await mount();
    expect(screen.queryByTestId("notes-pane")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "View" }));
    fireEvent.click(within(screen.getByRole("toolbar", { name: "View" })).getByRole("button", { name: "Notes" }));
    const ta = screen.getByRole("textbox", { name: "Speaker notes" });
    fireEvent.change(ta, { target: { value: "Remember the demo" } });
    fireEvent.blur(ta);
    await flush();
    expect(last(backend.commands)).toEqual({ type: "setNotes", slide: 1, notes: "Remember the demo" });
    // switching slides shows that slide's (empty) notes
    fireEvent.click(screen.getAllByTestId("thumbnail")[1]!);
    expect((screen.getByRole("textbox", { name: "Speaker notes" }) as HTMLTextAreaElement).value).toBe("");
  });

  it("Format shape dialog from the Shape Format tab: no fill → SetShapeStyle", async () => {
    const { backend, store } = await mount();
    fireEvent.click(screen.getAllByTestId("thumbnail")[2]!);
    act(() => store.select([8]));
    fireEvent.click(screen.getByRole("tab", { name: "Shape Format" }));
    fireEvent.click(screen.getByRole("button", { name: "Format shape…" }));
    const dlg = screen.getByRole("dialog", { name: "Format shape" });
    fireEvent.click(within(dlg).getByRole("checkbox", { name: "No fill" }));
    fireEvent.change(within(dlg).getByRole("spinbutton", { name: "Rotation (°)" }), { target: { value: "30" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "OK" }));
    await flush();
    expect(screen.queryByRole("dialog", { name: "Format shape" })).toBeNull();
    const cmd = last(backend.commands)!;
    expect(cmd.type).toBe("compound");
    if (cmd.type !== "compound") return;
    expect(cmd.commands[0]).toEqual({ type: "setShapeStyle", shapes: [8], fill: null });
    expect(cmd.commands[1]).toMatchObject({ type: "setTransform", shapes: [[8, { rotationDeg: 30 }]] });
  });

  it("Alt text dialog sends SetAltText", async () => {
    const { backend, store } = await mount();
    fireEvent.click(screen.getAllByTestId("thumbnail")[2]!);
    act(() => store.select([9]));
    fireEvent.click(screen.getByRole("tab", { name: "Shape Format" }));
    fireEvent.click(screen.getByRole("button", { name: "Alt text…" }));
    const dlg = screen.getByRole("dialog", { name: "Alt text" });
    fireEvent.change(within(dlg).getByRole("textbox", { name: "Alt text" }), { target: { value: "  An orange circle " } });
    fireEvent.click(within(dlg).getByRole("button", { name: "OK" }));
    await flush();
    expect(last(backend.commands)).toEqual({ type: "setAltText", shape: 9, alt: "An orange circle" });
  });

  it("Home › Layout changes the current slide's layout; Hide slide toggles", async () => {
    const { backend } = await mount();
    const slides = within(screen.getByRole("toolbar", { name: "Formatting" })).getByRole("group", { name: "Slides" });
    fireEvent.click(within(slides).getByRole("button", { name: "Layout" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Blank" }));
    await flush();
    expect(last(backend.commands)).toEqual({ type: "setSlideLayout", slide: 1, layout: "blank" });
    fireEvent.click(within(slides).getByRole("button", { name: "Hide slide" }));
    await flush();
    expect(last(backend.commands)).toEqual({ type: "setSlidesHidden", slides: [1], hidden: true });
    expect(within(slides).getByRole("button", { name: "Hide slide" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("Increase font size and line spacing from the ribbon", async () => {
    const { backend, store } = await mount();
    fireEvent.click(screen.getAllByTestId("thumbnail")[1]!);
    act(() => store.select([6]));
    fireEvent.click(screen.getByRole("button", { name: "Increase font size" }));
    await flush();
    const grow = last(backend.commands)!;
    expect(grow.type === "compound" && grow.commands[0]).toMatchObject({ type: "setRunProps", patch: { size: 3200 } });
    fireEvent.click(screen.getByRole("button", { name: "Line spacing" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "1.5" }));
    await flush();
    expect(last(backend.commands)).toMatchObject({ type: "setParagraphProps", shape: 6, patch: { lineSpacing: { kind: "percent", value: 150000 } } });
  });

  it("Design › Apply to all copies the background to every slide", async () => {
    const pres = fixture();
    pres.slides[0]!.background = { kind: "solid", value: { kind: "rgb", value: "FFEEDD" } };
    const { backend } = await mount(new FakeBackend(pres));
    fireEvent.click(screen.getByRole("tab", { name: "Design" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply to all" }));
    await flush();
    const c = last(backend.commands)!;
    expect(c.type === "compound" && c.commands.length).toBe(3);
    fireEvent.click(screen.getByRole("button", { name: "Reset background" }));
    await flush();
    expect(last(backend.commands)).toEqual({ type: "setSlideBackground", slide: 1, fill: null });
  });

  it("the text overlay follows the anchor; Tab indents, Shift+Tab outdents", async () => {
    const pres = fixture();
    const title = pres.slides[1]!.shapes[0]!;
    if (title.kind.kind === "auto") title.kind.value.text!.props.anchor = "middle";
    title.transform.rotationDeg = 15;
    const { backend, store } = await mount(new FakeBackend(pres));
    fireEvent.click(screen.getAllByTestId("thumbnail")[1]!);
    act(() => store.startEdit(5));
    const box = screen.getByTestId("text-overlay-box");
    expect(box.getAttribute("data-anchor")).toBe("middle");
    expect(box.style.justifyContent).toBe("center");
    expect(box.style.transform).toBe("rotate(15deg)");
    fireEvent.keyDown(screen.getByTestId("text-overlay"), { key: "Escape" });
    await flush();
    act(() => store.startEdit(6));
    const ta = screen.getByTestId("text-overlay");
    fireEvent.keyDown(ta, { key: "Tab" });
    await flush();
    expect(last(backend.commands)).toMatchObject({ type: "setParagraphProps", shape: 6, patch: { level: 1 } });
    fireEvent.keyDown(screen.getByTestId("text-overlay"), { key: "Tab", shiftKey: true });
    await flush();
    expect(last(backend.commands)).toMatchObject({ type: "setParagraphProps", shape: 6, patch: { level: 0 } });
  });

  it("the show skips hidden slides", async () => {
    HTMLElement.prototype.requestFullscreen = vi.fn().mockResolvedValue(undefined);
    const pres = fixture();
    pres.slides[1]!.hidden = true;
    const { store } = await mount(new FakeBackend(pres));
    fireEvent.keyDown(window, { key: "F5" });
    expect(screen.getByTestId("presenter-counter").textContent).toBe("1 / 2");
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(store.getState().current).toBe(7);
    fireEvent.keyDown(window, { key: "Escape" });
  });
});
