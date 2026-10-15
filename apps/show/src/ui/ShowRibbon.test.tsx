// Show's ribbon, driven through the real App.
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

describe("Show ribbon", () => {
  it("has File, Home, Insert, Design and View, and Present in the strip", async () => {
    await mount();
    expect(screen.getAllByRole("tab").filter((t) => !t.closest("[data-testid=slide-list]")).map((t) => t.textContent)).toEqual(["File", "Home", "Insert", "Design", "View"]);
    const toolbar = screen.getByRole("toolbar", { name: "Formatting" });
    for (const g of ["Clipboard", "Slides", "Font", "Paragraph", "Drawing"]) expect(within(toolbar).getByRole("group", { name: g })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Present" })).toBeTruthy();
  });

  it("New slide: main button adds Title and content; the gallery offers the 3 layouts", async () => {
    const { backend } = await mount();
    const slides = within(screen.getByRole("toolbar", { name: "Formatting" })).getByRole("group", { name: "Slides" });
    fireEvent.click(within(slides).getByRole("button", { name: "New slide" }));
    await flush();
    expect(backend.commands[0]).toEqual({ type: "addSlide", after: 1, layout: "titleContent" });
    fireEvent.click(within(slides).getByRole("button", { name: "Slide layouts" }));
    const gallery = screen.getByRole("group", { name: "Slide layouts" });
    expect(within(gallery).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual(["Title slide", "Title and content", "Blank"]);
    expect(document.activeElement).toBe(within(gallery).getByRole("button", { name: "Title slide" }));
    fireEvent.click(within(gallery).getByRole("button", { name: "Blank" }));
    await flush();
    expect(backend.commands[1]).toMatchObject({ type: "addSlide", layout: "blank" });
    expect(screen.getAllByTestId("thumbnail")).toHaveLength(5);
  });

  it("duplicate and delete the current slide", async () => {
    const { backend } = await mount();
    fireEvent.click(screen.getByRole("button", { name: "Duplicate slide" }));
    await flush();
    expect(backend.commands[0]).toMatchObject({ type: "duplicateSlide", id: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Delete slide" }));
    await flush();
    expect(backend.commands[1]).toMatchObject({ type: "deleteSlides" });
  });

  it("shapes gallery inserts a rounded rectangle", async () => {
    const { backend } = await mount();
    fireEvent.click(within(screen.getByRole("group", { name: "Shapes" })).getByRole("button", { name: "Rounded rectangle" }));
    await flush();
    expect(backend.commands[0]).toMatchObject({ type: "addShape", slide: 1, shape: { kind: { kind: "auto", value: { geometry: "roundRect" } } } });
  });

  it("Arrange menu: order and group follow the selection", async () => {
    const { backend, store } = await mount();
    act(() => store.select([2]));
    fireEvent.click(screen.getByRole("button", { name: "Arrange" }));
    expect((screen.getByRole("menuitem", { name: /Group/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("menuitem", { name: /Bring to front/ }));
    await flush();
    expect(backend.commands[0]).toMatchObject({ type: "zOrder", op: "bringToFront" });
  });

  it("copy and paste shapes; cut removes them", async () => {
    const { backend, store } = await mount();
    act(() => store.select([2]));
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    fireEvent.click(screen.getByRole("button", { name: "Paste" }));
    await flush();
    expect(backend.commands[0]).toMatchObject({ type: "addShape", slide: 1 });
    act(() => store.select([2]));
    fireEvent.click(screen.getByRole("button", { name: "Cut" }));
    await flush();
    expect(backend.commands[1]).toEqual({ type: "deleteShapes", ids: [2] });
  });

  it("Insert tab: text box, shapes dropdown", async () => {
    const { backend } = await mount();
    fireEvent.click(tab("Insert"));
    fireEvent.click(screen.getByRole("button", { name: "Text box" }));
    await flush();
    expect(backend.commands[0]).toMatchObject({ type: "addShape" });
    fireEvent.click(tab("Insert"));
    fireEvent.click(screen.getByRole("button", { name: "Shapes" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Shapes" })).getByRole("button", { name: "Line" }));
    await flush();
    expect(backend.commands[backend.commands.length - 1]).toMatchObject({ type: "addShape", shape: { kind: { value: { geometry: "line" } } } });
  });

  it("View: zoom and present from the beginning", async () => {
    HTMLElement.prototype.requestFullscreen = vi.fn().mockResolvedValue(undefined);
    await mount();
    fireEvent.click(screen.getAllByTestId("thumbnail")[1]!);
    fireEvent.click(tab("View"));
    fireEvent.change(screen.getByRole("combobox", { name: "Zoom" }), { target: { value: "0.5" } });
    expect(screen.getByTestId("zoom").textContent).toBe("50 %");
    fireEvent.click(screen.getByRole("button", { name: "Fit to window" }));
    expect(screen.getByTestId("zoom").textContent).toBe("Fit");
    fireEvent.click(screen.getByRole("button", { name: "From beginning" }));
    expect(screen.getByTestId("presenter-counter").textContent).toBe("1 / 3");
  });

  it("keyboard only: Alt, arrows and Enter reach View; Esc returns", async () => {
    await mount();
    const before = document.activeElement;
    fireEvent.keyDown(window, { key: "Alt", altKey: true });
    fireEvent.keyUp(window, { key: "Alt" });
    expect(document.activeElement).toBe(tab("Home"));
    fireEvent.keyDown(tab("Home"), { key: "End" });
    fireEvent.keyDown(tab("View"), { key: " " });
    expect(tab("View").getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(tab("View"), { key: "Escape" });
    expect(document.activeElement).toBe(before);
  });

  it("File view: commands disabled without file access", async () => {
    const backend = new FakeBackend();
    vi.spyOn(backend, "dispatch").mockImplementation(async (req) => {
      if ((req as { type: string }).type === "documentState") return { err: { code: "unknown_request", message: "no" } } as never;
      return FakeBackend.prototype.dispatch.call(backend, req) as never;
    });
    render(<App backend={backend} store={new ShowStore(new ShowApi(backend))} />);
    await waitFor(() => expect(screen.getAllByTestId("thumbnail")).toHaveLength(3));
    await flush();
    fireEvent.click(tab("File"));
    const view = screen.getByRole("dialog", { name: "File" });
    await waitFor(() => expect((within(view).getByRole("button", { name: "Open…" }) as HTMLButtonElement).disabled).toBe(true));
    expect((within(view).getByRole("button", { name: "Export PDF…" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
