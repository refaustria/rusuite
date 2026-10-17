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
import { fixture } from "../test/fixture";
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
