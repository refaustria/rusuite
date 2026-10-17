// Transitions / Animations tabs, the Animation pane and the stage badges (P8-8), through the real App.
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

const flush = () => act(() => new Promise((r) => setTimeout(r, 0)));

async function mount() {
  const backend = new FakeBackend();
  const store = new ShowStore(new ShowApi(backend));
  render(<App backend={backend} store={store} />);
  await waitFor(() => expect(screen.getAllByTestId("thumbnail")).toHaveLength(3));
  await flush();
  return { backend, store };
}

const toolbar = () => screen.getByRole("toolbar");
const group = (name: string) => within(toolbar()).getByRole("group", { name });
const last = (b: FakeBackend) => b.commands.at(-1);

async function openTab(name: string) {
  fireEvent.click(screen.getByRole("tab", { name }));
  await flush();
}

/** Selects shapes 8 and 9's slide and shape `id`, then opens the Animations tab. */
async function animationsOn(store: ShowStore, id: number) {
  act(() => {
    store.selectSlide(7);
    store.select([id]);
  });
  await openTab("Animations");
}

async function pick(menuButton: string, section: string, effect: string) {
  fireEvent.click(screen.getByRole("button", { name: menuButton }));
  const gallery = screen.getByRole("group", { name: section });
  fireEvent.click(within(gallery).getByRole("button", { name: effect }));
  await flush();
}

describe("Transitions tab", () => {
  it("the gallery sets the slide's transition; the sorter shows a star", async () => {
    const { backend } = await mount();
    await openTab("Transitions");
    const gallery = within(group("Transition to this slide")).getByRole("group", { name: "Transitions" });
    expect(within(gallery).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual(["None", "Fade", "Push", "Wipe", "Cover", "Split", "Cut", "Zoom"]);
    expect(within(gallery).getByRole("button", { name: "None" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryAllByTestId("effects-star")).toHaveLength(0);
    fireEvent.click(within(gallery).getByRole("button", { name: "Push" }));
    await flush();
    expect(last(backend)).toEqual({ type: "setTransition", slides: [1], transition: { kind: "push", durationMs: 1000, advanceOnClick: true, direction: "up" } });
    expect(within(gallery).getByRole("button", { name: "Push" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(screen.getAllByTestId("thumbnail")[0]!).getByTestId("effects-star")).toBeTruthy();
    fireEvent.click(within(gallery).getByRole("button", { name: "None" }));
    await flush();
    expect(last(backend)).toEqual({ type: "setTransition", slides: [1], transition: null });
    expect(screen.queryAllByTestId("effects-star")).toHaveLength(0);
  });

  it("Effect Options lists the kind's directions (none for Fade)", async () => {
    const { backend } = await mount();
    await openTab("Transitions");
    const options = () => within(group("Transition to this slide")).getByRole("button", { name: "Effect options" });
    expect((options() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(group("Transition to this slide")).getByRole("button", { name: "Cover" }));
    await flush();
    fireEvent.click(options());
    const menu = screen.getByRole("menu", { name: "Effect options" });
    const items = within(menu).getAllByRole("menuitemradio");
    expect(items).toHaveLength(8);
    expect(items[0]!.textContent).toBe("From Right");
    expect(items[0]!.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(within(menu).getByRole("menuitemradio", { name: "From Top-Left" }));
    await flush();
    expect(last(backend)).toMatchObject({ type: "setTransition", transition: { kind: "cover", direction: "rightDown" } });
    fireEvent.click(within(group("Transition to this slide")).getByRole("button", { name: "Fade" }));
    await flush();
    expect((options() as HTMLButtonElement).disabled).toBe(true);
  });

  it("Duration, On mouse click, After and Apply to all", async () => {
    const { backend, store } = await mount();
    await openTab("Transitions");
    fireEvent.click(within(group("Transition to this slide")).getByRole("button", { name: "Fade" }));
    await flush();
    const timing = group("Timing");
    const duration = within(timing).getByRole("textbox", { name: "Duration (s)" });
    expect((duration as HTMLInputElement).value).toBe("0.7");
    fireEvent.change(duration, { target: { value: "2,5" } });
    fireEvent.keyDown(duration, { key: "Enter" });
    await flush();
    expect(last(backend)).toMatchObject({ transition: { kind: "fade", durationMs: 2500 } });
    fireEvent.click(within(timing).getByRole("checkbox", { name: "On mouse click" }));
    await flush();
    expect(last(backend)).toMatchObject({ transition: { advanceOnClick: false } });
    fireEvent.click(within(timing).getByRole("checkbox", { name: "After:" }));
    await flush();
    expect(last(backend)).toMatchObject({ transition: { advanceAfterMs: 0 } });
    const after = within(timing).getByRole("textbox", { name: "Advance after (mm:ss)" });
    fireEvent.change(after, { target: { value: "00:05" } });
    fireEvent.blur(after);
    await flush();
    expect(store.currentSlide()?.transition).toEqual({ kind: "fade", durationMs: 2500, advanceOnClick: false, advanceAfterMs: 5000 });
    expect((after as HTMLInputElement).value).toBe("00:05.00");
    // A bad value is not sent and the field shows the model again.
    const n = backend.commands.length;
    fireEvent.change(after, { target: { value: "soon" } });
    fireEvent.blur(after);
    await flush();
    expect(backend.commands).toHaveLength(n);
    expect((after as HTMLInputElement).value).toBe("00:05.00");
    fireEvent.click(within(timing).getByRole("button", { name: "Apply to all" }));
    await flush();
    expect(last(backend)).toEqual({ type: "applyTransitionToAll", from: 1 });
    expect(screen.getAllByTestId("effects-star")).toHaveLength(3);
  });

  it("Preview plays the transition on the editor stage, then the editor is back", async () => {
    const { store } = await mount();
    await openTab("Transitions");
    const preview = () => within(group("Preview")).getByRole("button", { name: "Preview" }) as HTMLButtonElement;
    expect(preview().disabled).toBe(true);
    act(() => store.selectSlide(4));
    await act(() => store.setTransition({ kind: "push" }));
    await act(() => store.setTransition({ durationMs: 30 }));
    fireEvent.click(preview());
    const overlay = screen.getByTestId("stage-preview");
    expect(overlay.getAttribute("data-kind")).toBe("transition");
    // jsdom has no Web Animations: the previous slide (1) is dropped at once, this one (4) stays until the end.
    expect(within(overlay).getAllByTestId("animated-slide").map((e) => e.getAttribute("data-slide"))).toEqual(["4"]);
    await waitFor(() => expect(screen.queryByTestId("stage-preview")).toBeNull());
  });
});

describe("Animations tab and pane", () => {
  it("the gallery is grouped Entrance / Emphasis / Exit and adds an animation to the selected shape", async () => {
    const { backend, store } = await mount();
    await openTab("Animations");
    expect((within(group("Animation")).getByRole("button", { name: "Animation styles" }) as HTMLButtonElement).disabled).toBe(true);
    await animationsOn(store, 8);
    fireEvent.click(screen.getByRole("button", { name: "Animation styles" }));
    const galleries = within(screen.getByTestId("animation-gallery"));
    expect(galleries.getAllByRole("group").map((g) => g.getAttribute("aria-label"))).toEqual(["None", "Entrance", "Emphasis", "Exit", "Motion Paths"]);
    expect(within(galleries.getByRole("group", { name: "Emphasis" })).getAllByRole("button").map((b) => b.getAttribute("aria-label")).slice(0, 5)).toEqual([
      "Pulse", "Color Pulse", "Teeter", "Spin", "Grow/Shrink",
    ]);
    expect(within(galleries.getByRole("group", { name: "Exit" })).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual([
      "Disappear", "Fade", "Fly Out", "Float Out", "Split", "Wipe", "Shape", "Wheel", "Random Bars", "Shrink & Turn", "Zoom", "Swivel", "Bounce",
    ]);
    expect(within(galleries.getByRole("group", { name: "Motion Paths" })).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual([
      "Lines", "Arcs", "Turns", "Shapes", "Loops", "Custom Path",
    ]);
    fireEvent.click(within(galleries.getByRole("group", { name: "Entrance" })).getByRole("button", { name: "Fly In" }));
    await flush();
    expect(last(backend)).toMatchObject({ type: "addAnimation", slide: 7, animation: { shape: 8, kind: "entrance", effect: "flyIn", trigger: "onClick", durationMs: 500 } });
    expect(store.getState().animSelection).toBe(store.currentSlide()!.animations![0]!.id);
    // The badge shows on the Animations tab.
    expect(screen.getAllByTestId("anim-badge").map((b) => b.textContent)).toEqual(["1"]);
    // The gallery again on the animated shape changes its effect instead of adding one.
    await pick("Animation styles", "Emphasis", "Spin");
    expect(last(backend)).toMatchObject({ type: "updateAnimation", patch: { kind: "emphasis", effect: "spin", durationMs: 2000 } });
    expect(store.currentSlide()!.animations).toHaveLength(1);
    await pick("Animation styles", "None", "None");
    expect(last(backend)).toMatchObject({ type: "removeAnimation" });
    expect(store.currentSlide()!.animations).toEqual([]);
  });

  it("after inserting a shape the gallery animates the new shape, not the last selected animation", async () => {
    const { backend, store } = await mount();
    await animationsOn(store, 8);
    await pick("Animation styles", "Entrance", "Fade");
    expect(store.getState().animSelection).not.toBeNull();
    await act(() => store.insert("rect"));
    await pick("Animation styles", "Entrance", "Zoom");
    expect(last(backend)).toMatchObject({ type: "addAnimation", animation: { effect: "zoom" } });
    expect(store.currentSlide()!.animations!.map((a) => a.effect)).toEqual(["fade", "zoom"]);
  });

  it("Effect Options, Start, Duration and Delay edit the selected animation", async () => {
    const { backend, store } = await mount();
    await animationsOn(store, 9);
    await pick("Animation styles", "Entrance", "Wipe");
    const id = store.getState().animSelection!;
    fireEvent.click(screen.getByRole("button", { name: "Effect options" }));
    const menu = screen.getByRole("menu", { name: "Effect options" });
    expect(within(menu).getAllByRole("menuitemradio").map((b) => b.textContent)).toEqual(["From Bottom", "From Left", "From Right", "From Top"]);
    fireEvent.click(within(menu).getByRole("menuitemradio", { name: "From Left" }));
    await flush();
    expect(last(backend)).toEqual({ type: "updateAnimation", id, patch: { direction: "left" } });
    const timing = group("Timing");
    fireEvent.change(within(timing).getByRole("combobox", { name: "Start" }), { target: { value: "afterPrevious" } });
    await flush();
    expect(last(backend)).toEqual({ type: "updateAnimation", id, patch: { trigger: "afterPrevious" } });
    const dur = within(timing).getByRole("textbox", { name: "Animation duration (s)" });
    expect((dur as HTMLInputElement).value).toBe("0.5");
    fireEvent.change(dur, { target: { value: "1.25" } });
    fireEvent.keyDown(dur, { key: "Enter" });
    await flush();
    expect(last(backend)).toEqual({ type: "updateAnimation", id, patch: { durationMs: 1250 } });
    const delay = within(timing).getByRole("textbox", { name: "Delay (s)" });
    fireEvent.change(delay, { target: { value: "0.3" } });
    fireEvent.blur(delay);
    await flush();
    expect(last(backend)).toEqual({ type: "updateAnimation", id, patch: { delayMs: 300 } });
    expect(store.currentSlide()!.animations![0]).toMatchObject({ effect: "wipe", direction: "left", trigger: "afterPrevious", durationMs: 1250, delayMs: 300 });
  });

  it("the pane lists the animations in order with numbers; select, reorder and remove", async () => {
    const { backend, store } = await mount();
    await animationsOn(store, 8);
    await pick("Animation styles", "Entrance", "Fade");
    act(() => store.select([9]));
    await pick("Add animation", "Entrance", "Fly In");
    await pick("Add animation", "Exit", "Fade"); // a second animation of shape 9
    expect(screen.queryByTestId("animation-pane")).toBeNull();
    fireEvent.click(within(group("Advanced animation")).getByRole("button", { name: "Animation pane" }));
    const pane = screen.getByTestId("animation-pane");
    const rows = () => within(pane).getAllByTestId("anim-row");
    expect(rows().map((r) => r.getAttribute("aria-label"))).toEqual(["1 Shape 8: Fade", "2 Shape 9: Fly In", "3 Shape 9: Fade"]);
    expect(rows()[2]!.getAttribute("aria-selected")).toBe("true");
    const [a1, a2, a3] = store.currentSlide()!.animations!.map((a) => a.id);
    // Badges: shape 9 has two.
    expect(screen.getAllByTestId("anim-badge").map((b) => b.textContent)).toEqual(["1", "2", "3"]);

    fireEvent.click(rows()[0]!);
    expect(store.getState().animSelection).toBe(a1);
    expect(store.getState().selection).toEqual([8]);
    fireEvent.click(within(pane).getByRole("button", { name: "Move later" }));
    await flush();
    // Move Later swaps the click steps (P9-S4: the order of every animation)
    expect(last(backend)).toEqual({ type: "setAnimationOrder", slide: 7, order: [a2, a1, a3] });
    expect(rows().map((r) => r.getAttribute("aria-label"))).toEqual(["1 Shape 9: Fly In", "2 Shape 8: Fade", "3 Shape 9: Fade"]);

    // Keyboard: arrows select, Delete removes.
    const list = within(pane).getByRole("listbox");
    fireEvent.keyDown(list, { key: "ArrowDown" });
    expect(store.getState().animSelection).toBe(a3);
    fireEvent.keyDown(list, { key: "Delete" });
    await flush();
    expect(last(backend)).toEqual({ type: "removeAnimation", id: a3 });
    // The bin of a row.
    fireEvent.click(within(rows()[0]!).getByRole("button", { name: "Remove the animation of Shape 9" }));
    await flush();
    expect(last(backend)).toEqual({ type: "removeAnimation", id: a2 });
    expect(rows()).toHaveLength(1);
    fireEvent.click(within(pane).getByRole("button", { name: "Close" }));
    expect(screen.queryByTestId("animation-pane")).toBeNull();
  });

  it("dragging a row by its grip reorders (pointer events)", async () => {
    const { backend, store } = await mount();
    await animationsOn(store, 8);
    await pick("Animation styles", "Entrance", "Fade");
    act(() => store.select([9]));
    await pick("Animation styles", "Entrance", "Zoom");
    act(() => store.toggleAnimPane(true));
    const pane = screen.getByTestId("animation-pane");
    within(pane)
      .getAllByTestId("anim-row")
      .forEach((r, i) => {
        r.getBoundingClientRect = () => ({ top: i * 32, height: 32, bottom: i * 32 + 32, left: 0, right: 200, width: 200, x: 0, y: i * 32, toJSON: () => ({}) });
      });
    const first = store.currentSlide()!.animations![0]!.id;
    const grip = within(pane).getAllByTestId("anim-grip")[0]!;
    fireEvent.pointerDown(grip, { pointerId: 1, clientY: 10 });
    fireEvent.pointerMove(grip, { pointerId: 1, clientY: 60 });
    expect(within(pane).getAllByTestId("anim-drop")).toHaveLength(1);
    fireEvent.pointerUp(grip, { pointerId: 1, clientY: 60 });
    await flush();
    expect(last(backend)).toEqual({ type: "reorderAnimation", id: first, index: 1 });
    expect(within(pane).queryByTestId("anim-drop")).toBeNull();
  });

  it("badges select their animation; Preview plays the slide's sequence on the stage", async () => {
    const { store } = await mount();
    await animationsOn(store, 8);
    await pick("Animation styles", "Entrance", "Fade");
    act(() => store.select([9]));
    await pick("Animation styles", "Exit", "Zoom");
    const [a1] = store.currentSlide()!.animations!.map((a) => a.id);
    fireEvent.click(screen.getAllByTestId("anim-badge")[0]!);
    expect(store.getState().animSelection).toBe(a1);
    expect(store.getState().selection).toEqual([8]);
    // Not on other tabs (pane closed).
    await openTab("Home");
    expect(screen.queryAllByTestId("anim-badge")).toHaveLength(0);
    await openTab("Animations");
    const shown: string[] = [];
    const spy = vi.spyOn(store, "endPreview").mockImplementation(() => {
      shown.push(screen.getByTestId("stage-preview").getAttribute("data-kind")!);
    });
    fireEvent.click(within(group("Preview")).getByRole("button", { name: "Preview" }));
    expect(shown).toEqual(["animations"]);
    spy.mockRestore();
    act(() => store.endPreview());
    expect(screen.queryByTestId("stage-preview")).toBeNull();
  });
});
