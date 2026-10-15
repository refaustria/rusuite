import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ setTitle: vi.fn() }) }));
vi.mock("react-konva", () => import("./test/konvaMock"));

import { setLocale } from "@rusuite/ui-shared";
import App from "./App";
import { ShowApi } from "./api";
import { ShowStore } from "./state/store";
import { FakeBackend } from "./test/fakeBackend";

afterEach(cleanup);

// jsdom has no layout: give the canvas area a size so the editor stage renders.
Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 1312 });
Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 752 });

async function mount() {
  const backend = new FakeBackend();
  const store = new ShowStore(new ShowApi(backend));
  render(<App backend={backend} store={store} />);
  await waitFor(() => expect(screen.getAllByTestId("thumbnail")).toHaveLength(3));
  return { backend, store };
}

const flush = () => act(() => new Promise((r) => setTimeout(r, 0)));

describe("Show app in German", () => {
  it("shows the German ribbon, status bar and slide prompts' language", async () => {
    setLocale("de", { persist: false });
    try {
      await mount();
      expect(screen.getByTestId("slide-count").textContent).toBe("Folie 1 von 3");
      expect(screen.getByTestId("dirty").textContent).toBe("Gespeichert");
      expect(screen.getByRole("tab", { name: "Entwurf" })).toBeTruthy();
      expect(screen.getByRole("button", { name: /Präsentieren/ })).toBeTruthy();
    } finally {
      setLocale("en", { persist: false });
    }
  });
});

describe("Show app", () => {
  it("renders thumbnails from the model, the status bar and enabled file buttons", async () => {
    const { store } = await mount();
    expect(screen.getByTestId("slide-count").textContent).toBe("Slide 1 of 3");
    expect(screen.getByTestId("dirty").textContent).toBe("Saved");
    expect(screen.getByTestId("doc-name").textContent).toBe("Untitled");
    const thumbs = screen.getAllByTestId("thumbnail");
    expect(thumbs[2]!.querySelector('[data-konva="Ellipse"]')).not.toBeNull();
    expect(thumbs[0]!.textContent).toContain("Rusuite"); // wrapped: one Text node per line
    await flush();
    fireEvent.click(screen.getByRole("tab", { name: "File" }));
    const open = within(screen.getByRole("dialog", { name: "File" })).getByRole("button", { name: "Open…" }) as HTMLButtonElement;
    expect(open.disabled).toBe(false);
    expect(open.title).toBe("Open… (Ctrl+O)");
    fireEvent.keyDown(open, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "File" })).toBeNull();
    fireEvent.click(thumbs[1]!);
    expect(store.getState().current).toBe(4);
    expect(screen.getByTestId("slide-count").textContent).toBe("Slide 2 of 3");
  });

  it("keyboard shortcuts send commands; Delete removes the selection", async () => {
    const { backend, store } = await mount();
    fireEvent.click(screen.getAllByTestId("thumbnail")[2]!);
    act(() => store.select([9]));
    fireEvent.keyDown(window, { key: "ArrowUp" });
    await flush();
    fireEvent.keyDown(window, { key: "Delete" });
    await flush();
    expect(backend.commands.map((c) => c.type)).toEqual(["setTransform", "deleteShapes"]);
    expect(screen.getByTestId("dirty").textContent).toBe("Modified");
    const stage = screen.getByTestId("editor-stage");
    expect(stage.querySelector('[data-shape-id="9"]')).toBeNull();
    expect(stage.querySelector('[data-shape-id="8"]')!.getAttribute("data-draggable")).toBe("true");
  });

  it("edits text in the overlay and commits on blur", async () => {
    const { backend, store } = await mount();
    act(() => store.startEdit(3));
    const ta = screen.getByTestId("text-overlay") as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "A subtitle\nsecond line" } });
    fireEvent.blur(ta);
    await flush();
    expect(backend.commands[0]).toMatchObject({
      type: "setTextBody",
      shape: 3,
      body: { paragraphs: [{ runs: [{ text: "A subtitle" }] }, { runs: [{ text: "second line" }] }] },
    });
    expect(screen.queryByTestId("text-overlay")).toBeNull();
    expect(screen.getByTestId("editor-stage").textContent).toContain("second line");
  });

  it("ribbon: bold applies SetRunProps, insert adds shapes, undo goes through the core", async () => {
    const { backend, store } = await mount();
    act(() => store.select([2]));
    fireEvent.click(screen.getByRole("button", { name: "Bold" }));
    await flush();
    expect(backend.commands[0]).toEqual({ type: "setRunProps", shape: 2, paragraph: 0, from: 0, to: 23, patch: { bold: true } });
    fireEvent.click(within(screen.getByRole("group", { name: "Shapes" })).getByRole("button", { name: "Oval" }));
    await flush();
    expect(backend.commands[1]).toMatchObject({ type: "addShape", slide: 1, shape: { kind: { value: { geometry: "ellipse" } } } });
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await flush();
    expect(backend.log[backend.log.length - 1]!.type).toBe("undo");
  });

  it("adds slides from the + menu and presents from the current slide", async () => {
    HTMLElement.prototype.requestFullscreen = vi.fn().mockResolvedValue(undefined);
    const { backend } = await mount();
    const list = screen.getByTestId("slide-list");
    fireEvent.click(within(list).getByRole("button", { name: "New slide" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Blank" }));
    await flush();
    expect(backend.commands[0]).toEqual({ type: "addSlide", after: 1, layout: "blank" });
    expect(screen.getAllByTestId("thumbnail")).toHaveLength(4);
    expect(screen.getByTestId("slide-count").textContent).toBe("Slide 2 of 4");
    fireEvent.click(screen.getByRole("button", { name: "Present" }));
    expect(screen.getByTestId("presenter-counter").textContent).toBe("2 / 4");
    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("presenter")).toBeNull();
    expect(screen.getByTestId("slide-count").textContent).toBe("Slide 3 of 4");
  });
});

describe("Show app recovery (P5-3)", () => {
  it("restores an autosaved presentation from the banner as modified", async () => {
    const { MemoryDocStorage } = await import("@rusuite/ui-shared");
    const earlier = new FakeBackend();
    const snap = await earlier.dispatch<{ type: string; json: string }>({ type: "recoverySnapshot" });
    const deck = JSON.parse("ok" in snap ? snap.ok.json : "{}") as { slides: unknown[] };
    deck.slides = deck.slides.slice(0, 2);
    const storage = new MemoryDocStorage();
    await storage.putRecovery({ id: "crashed", name: "deck.pptx", savedAt: Date.now(), revision: 5, json: JSON.stringify(deck) });

    const backend = Object.assign(new FakeBackend(), { storage });
    render(<App backend={backend} />);
    await waitFor(() => expect(screen.getAllByTestId("thumbnail")).toHaveLength(3));
    const banner = await screen.findByRole("region", { name: "Recovered documents" });
    expect(within(banner).getByText("deck.pptx")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Restore deck.pptx" }));
    await waitFor(() => expect(screen.getAllByTestId("thumbnail")).toHaveLength(2));
    expect(screen.getByTestId("doc-name").textContent).toBe("deck.pptx");
    expect(screen.getByTestId("dirty").textContent).toBe("Modified");
    expect(screen.queryByTestId("recovery-banner")).toBeNull();
    await waitFor(() => expect(storage.recovery.has("crashed")).toBe(false));
    expect(storage.recovery.size).toBe(1);
  });
});
