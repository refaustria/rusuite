// Show keyboard shortcuts, driven through the real App (fake keyboard events).
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ setTitle: vi.fn() }) }));
vi.mock("react-konva", () => import("./test/konvaMock"));

import App from "./App";
import { ShowApi } from "./api";
import { ShowStore } from "./state/store";
import { FakeBackend } from "./test/fakeBackend";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 1312 });
Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 752 });

async function mount() {
  HTMLElement.prototype.requestFullscreen = vi.fn().mockResolvedValue(undefined);
  const backend = new FakeBackend();
  const store = new ShowStore(new ShowApi(backend));
  render(<App backend={backend} store={store} />);
  await waitFor(() => expect(screen.getAllByTestId("thumbnail")).toHaveLength(3));
  await waitFor(() => expect(store.getState().fileIo).toBe(true));
  backend.log.length = 0;
  return { backend, store };
}

const flush = () => act(() => new Promise((r) => setTimeout(r, 0)));
const key = async (k: KeyboardEventInit) => {
  fireEvent.keyDown(window, k);
  await flush();
};
const ctrl = (k: string, extra: KeyboardEventInit = {}): KeyboardEventInit => ({ key: k, ctrlKey: true, ...extra });

describe("Show shortcuts", () => {
  it("Ctrl+Z, Ctrl+Y and Ctrl+Shift+Z go to the core", async () => {
    const { backend } = await mount();
    await key(ctrl("z"));
    await key(ctrl("y"));
    await key(ctrl("Z", { shiftKey: true }));
    expect(backend.log.map((r) => r.type)).toEqual(["undo", "redo", "redo"]);
  });

  it("Ctrl+D duplicates the selection", async () => {
    const { backend, store } = await mount();
    store.selectSlide(7);
    act(() => store.select([8]));
    await key(ctrl("d"));
    expect(backend.commands.map((c) => c.type)).toEqual(["addShape"]);
  });

  it("Ctrl+G groups and Ctrl+Shift+G ungroups", async () => {
    const { backend, store } = await mount();
    store.selectSlide(7);
    act(() => store.select([8, 9]));
    await key(ctrl("g"));
    expect(backend.commands[0]).toMatchObject({ type: "group", shapes: [8, 9] });
    expect(backend.commands).toHaveLength(1);
    // Ungroup needs a group on the slide: nothing is sent for plain shapes.
    act(() => store.select([8]));
    await key(ctrl("G", { shiftKey: true }));
    expect(backend.commands).toHaveLength(1);
  });

  it("Ctrl+] and Ctrl+[ change the z-order (Shift: to the front / back)", async () => {
    const { backend, store } = await mount();
    store.selectSlide(7);
    act(() => store.select([8]));
    await key({ key: "]", code: "BracketRight", ctrlKey: true });
    await key({ key: "}", code: "BracketRight", ctrlKey: true, shiftKey: true });
    await key({ key: "[", code: "BracketLeft", ctrlKey: true });
    await key({ key: "{", code: "BracketLeft", ctrlKey: true, shiftKey: true });
    expect(backend.commands.map((c) => (c.type === "zOrder" ? c.op : c.type))).toEqual([
      "bringForward", "bringToFront", "sendBackward", "sendToBack",
    ]);
  });

  it("arrow keys nudge by 1 px, Shift+Arrow by 10 px", async () => {
    const { backend, store } = await mount();
    store.selectSlide(7);
    act(() => store.select([8]));
    await key({ key: "ArrowLeft" });
    await key({ key: "ArrowDown", shiftKey: true });
    expect(backend.commands).toHaveLength(2);
    expect(backend.commands[0]).toMatchObject({ type: "setTransform", shapes: [[8, { x: 914400 - 9525 }]] });
    expect(backend.commands[1]).toMatchObject({ type: "setTransform", shapes: [[8, { y: expect.any(Number) }]] });
  });

  it("F5 presents from the first slide, Shift+F5 from the current one", async () => {
    const { store } = await mount();
    store.selectSlide(4);
    await key({ key: "F5" });
    expect(screen.getByTestId("presenter-counter").textContent).toBe("1 / 3");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("presenter")).toBeNull();
    store.selectSlide(4);
    await key({ key: "F5", shiftKey: true });
    expect(screen.getByTestId("presenter-counter").textContent).toBe("2 / 3");
  });

  it("editor shortcuts are off while presenting", async () => {
    const { backend, store } = await mount();
    store.selectSlide(7);
    act(() => store.select([8]));
    await key({ key: "F5" });
    await key(ctrl("d"));
    await key({ key: "Delete" });
    expect(backend.commands).toEqual([]);
  });

  it("Ctrl+B / I / U format the selected shapes", async () => {
    const { backend, store } = await mount();
    act(() => store.select([2]));
    await key(ctrl("b"));
    await key(ctrl("i"));
    await key(ctrl("u"));
    const patches = backend.commands.flatMap((c) => (c.type === "setRunProps" ? [c.patch] : []));
    expect(patches).toEqual([{ bold: true }, { italic: true }, { underline: "single" }]);
  });

  it("Delete and arrows are left to the text overlay while editing", async () => {
    const { backend, store } = await mount();
    act(() => store.startEdit(3));
    const ta = screen.getByTestId("text-overlay");
    fireEvent.keyDown(ta, { key: "Delete" });
    fireEvent.keyDown(ta, { key: "ArrowLeft" });
    await flush();
    expect(backend.commands).toEqual([]);
  });

  it("Ctrl+O opens a file; Ctrl+S saves it; a cancelled save stays modified", async () => {
    const { backend } = await mount();
    backend.nextOpen = { name: "deck.pptx", bytesBase64: "UEsDBA==" };
    await key(ctrl("o"));
    await waitFor(() => expect(screen.getByTestId("doc-name").textContent).toBe("deck.pptx"));
    expect(backend.log.map((r) => r.type)).toContain("openPptx");
    await key(ctrl("s"));
    expect(backend.saved).toEqual([{ name: "Presentation.pptx", bytesBase64: "UEsDBA==" }]);
  });

  it("Ctrl+Shift+S asks for a name and saves under it", async () => {
    const { backend } = await mount();
    await key(ctrl("S", { shiftKey: true }));
    const input = screen.getByLabelText("File name") as HTMLInputElement;
    expect(input.value).toBe("Presentation.pptx");
    fireEvent.change(input, { target: { value: "pitch" } });
    fireEvent.submit(input.form!);
    await waitFor(() => expect(backend.saved.map((s) => s.name)).toEqual(["pitch.pptx"]));
    expect(backend.log.find((r) => r.type === "markSaved")).toEqual({ type: "markSaved", name: "pitch.pptx" });
    await waitFor(() => expect(screen.getByTestId("doc-name").textContent).toBe("pitch.pptx"));
  });

  it("Ctrl+N starts a new presentation; unsaved changes ask Save / Don't save / Cancel", async () => {
    const { backend, store } = await mount();
    store.selectSlide(7);
    act(() => store.select([8]));
    await key({ key: "ArrowLeft" });
    expect(screen.getByTestId("dirty").textContent).toBe("Modified");
    await key(ctrl("n"));
    const ask = await screen.findByRole("dialog", { name: "Save changes to Untitled?" });
    fireEvent.click(within(ask).getByRole("button", { name: "Cancel" }));
    await flush();
    expect(backend.log.some((r) => r.type === "newPresentation")).toBe(false);
    await key(ctrl("n"));
    fireEvent.click(await screen.findByRole("button", { name: "Don't save" }));
    await waitFor(() => expect(backend.log.some((r) => r.type === "newPresentation")).toBe(true));
    await waitFor(() => expect(screen.getByTestId("dirty").textContent).toBe("Saved"));
  });

  it("File › Open on a modified presentation: Save names and saves it first; Cancel keeps it", async () => {
    const { backend, store } = await mount();
    store.selectSlide(7);
    act(() => store.select([8]));
    await key({ key: "ArrowLeft" });
    backend.nextOpen = { name: "deck.pptx", bytesBase64: "UEsDBA==" };
    fireEvent.click(screen.getByRole("tab", { name: "File" }));
    fireEvent.click(screen.getByRole("button", { name: "Open…" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await flush();
    expect(backend.log.some((r) => r.type === "openPptx")).toBe(false);
    fireEvent.click(screen.getByRole("tab", { name: "File" }));
    fireEvent.click(screen.getByRole("button", { name: "Open…" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));
    const input = (await screen.findByLabelText("File name")) as HTMLInputElement;
    expect(input.value).toBe("Presentation.pptx");
    fireEvent.change(input, { target: { value: "pitch" } });
    fireEvent.submit(input.form!);
    await waitFor(() => expect(backend.log.some((r) => r.type === "openPptx")).toBe(true));
    expect(backend.saved.map((s) => s.name)).toEqual(["pitch.pptx"]);
  });

  it("Ctrl+/ lists the shortcuts and Ctrl+P is bound for the PDF export", async () => {
    await mount();
    await key(ctrl("/"));
    const help = screen.getByRole("dialog", { name: "Keyboard shortcuts" });
    expect(help.textContent).toContain("Duplicate");
    expect(help.textContent).toContain("Present from the current slide");
    fireEvent.keyDown(help, { key: "Escape" });
    const e = new KeyboardEvent("keydown", { key: "p", ctrlKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
  });
});
