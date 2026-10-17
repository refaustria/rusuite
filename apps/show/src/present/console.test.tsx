// The presenter view round 2 (P9-S5): editable notes, timers, white
// screen, See all slides, ink shared with the audience window, "Keep ink
// annotations?" at the end.

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("react-konva", () => import("../test/konvaMock"));

import { ShowApi } from "../api";
import { ShowStore } from "../state/store";
import { FakeBackend } from "../test/fakeBackend";
import { Audience } from "./Audience";
import { SlideShow } from "./SlideShow";
import { fakeSyncPair, type AudienceLink, type SyncMessage } from "./sync";

afterEach(cleanup);

const flush = () => act(() => new Promise((r) => setTimeout(r, 0)));

async function setup() {
  const store = new ShowStore(new ShowApi(new FakeBackend()));
  await store.init();
  await store.setNotes(1, "Welcome everyone");
  const [presenter, audience] = fakeSyncPair();
  const link: AudienceLink = { id: "c1", sync: Promise.resolve(presenter), window: Promise.resolve({ isOpen: () => true, close: vi.fn() }) };
  const onEnd = vi.fn();
  const got: SyncMessage[] = [];
  audience.listen((m) => got.push(m));
  render(<SlideShow store={store} mode="presenter" link={link} onEnd={onEnd} />);
  await flush();
  return { store, audience, onEnd, got, console: screen.getByTestId("presenter-console") };
}

/** Draws a stroke on the ink layer `layer` from (x0, y0) to (x1, y1) (screen px). */
function draw(layer: Element, x0: number, y0: number, x1: number, y1: number) {
  fireEvent.pointerDown(layer, { button: 0, buttons: 1, pointerId: 1, clientX: x0, clientY: y0 });
  fireEvent.pointerMove(layer, { buttons: 1, pointerId: 1, clientX: (x0 + x1) / 2, clientY: (y0 + y1) / 2 });
  fireEvent.pointerMove(layer, { buttons: 1, pointerId: 1, clientX: x1, clientY: y1 });
  fireEvent.pointerUp(layer, { button: 0, pointerId: 1, clientX: x1, clientY: y1 });
}

describe("presenter view: notes and timers", () => {
  it("notes typed in the presenter view are saved to the deck (undoable); keys typed there do not drive the show", async () => {
    const { store, console } = await setup();
    const notes = screen.getByTestId("console-notes") as HTMLTextAreaElement;
    expect(notes.value).toBe("Welcome everyone");
    fireEvent.keyDown(notes, { key: "n" }); // a show key, but typed into the notes
    expect(screen.getByTestId("console-counter").textContent).toBe("Slide 1 of 3");
    fireEvent.change(notes, { target: { value: "Welcome everyone – mention the demo" } });
    fireEvent.blur(notes);
    await flush();
    expect(store.getState().pres!.slides[0]!.notes).toBe("Welcome everyone – mention the demo");
    await act(() => store.undo());
    expect(store.getState().pres!.slides[0]!.notes).toBe("Welcome everyone");
    // an edit left unsaved is saved when the presenter moves on
    fireEvent.change(notes, { target: { value: "Edited" } });
    fireEvent.click(within(console).getByRole("button", { name: "Next" }));
    await flush();
    expect(store.getState().pres!.slides[0]!.notes).toBe("Edited");
    expect((screen.getByTestId("console-notes") as HTMLTextAreaElement).value).toBe("");
  });

  it("pause / resume the timer, white screen, See all slides", async () => {
    const { console, got } = await setup();
    const pause = screen.getByTestId("timer-pause");
    expect(pause.textContent).toBe("Pause timer");
    fireEvent.click(pause);
    expect(screen.getByTestId("presenter-timer").getAttribute("data-paused")).toBe("true");
    expect(pause.textContent).toBe("Resume timer");
    fireEvent.click(pause);
    expect(screen.getByTestId("presenter-timer").getAttribute("data-paused")).toBeNull();
    expect(screen.getByTestId("presenter-slide-timer").textContent).toBe("00:00");

    fireEvent.click(within(console).getByRole("button", { name: "White screen" }));
    await flush();
    expect(got.filter((m) => m.kind === "state").at(-1)).toMatchObject({ blackout: "white" });
    expect(screen.getByTestId("console-screen").textContent).toBe("White screen");
    fireEvent.keyDown(window, { key: "w" });
    await flush();
    expect(got.filter((m) => m.kind === "state").at(-1)).toMatchObject({ blackout: "none" });

    fireEvent.keyDown(window, { key: "g" });
    const grid = screen.getByTestId("see-all");
    fireEvent.click(within(grid).getByRole("button", { name: "Slide 3" }));
    expect(screen.queryByTestId("see-all")).toBeNull();
    expect(screen.getByTestId("console-counter").textContent).toBe("Slide 3 of 3");
  });
});

describe("presenter view: ink, laser and zoom on both screens", () => {
  it("pen ink drawn in the presenter view shows on the audience screen; Keep saves it as freeforms", async () => {
    const { store, audience, console, onEnd } = await setup();
    render(<Audience id="c1" channel={Promise.resolve(audience)} onEnd={vi.fn()} />);
    await flush();
    fireEvent.keyDown(window, { key: "p", ctrlKey: true });
    const current = screen.getByTestId("console-current");
    expect(current.getAttribute("data-tool")).toBe("pen");
    const layer = within(current).getByTestId("ink-layer");
    draw(layer, 10, 10, 200, 100);
    await flush();
    expect(layer.getAttribute("data-strokes")).toBe("1");
    const show = screen.getByTestId("presenter");
    expect(within(show).getByTestId("ink-layer").getAttribute("data-strokes")).toBe("1");
    // the highlighter (Ctrl+I) draws behind the slide's shapes when kept
    fireEvent.keyDown(window, { key: "i", ctrlKey: true });
    draw(layer, 20, 300, 300, 300);
    await flush();
    // zoom (+) is mirrored too
    fireEvent.keyDown(window, { key: "+" });
    await flush();
    expect(current.getAttribute("data-zoom")).toBe("1.5");
    expect(show.getAttribute("data-zoom")).toBe("1.5");

    const before = store.getState().pres!.slides[0]!.shapes.length;
    fireEvent.keyDown(window, { key: "Escape" }); // zoom out
    fireEvent.keyDown(window, { key: "Escape" }); // highlighter off
    fireEvent.click(within(console).getByRole("button", { name: "End show" }));
    expect(onEnd).not.toHaveBeenCalled();
    const ask = screen.getByTestId("ink-confirm");
    expect(ask.textContent).toContain("Do you want to keep your ink annotations?");
    fireEvent.click(within(ask).getByRole("button", { name: "Keep" }));
    await flush();
    expect(onEnd).toHaveBeenCalled();
    const shapes = store.getState().pres!.slides[0]!.shapes;
    expect(shapes).toHaveLength(before + 2);
    const pen = shapes.at(-1)!;
    expect(pen.name).toBe("Ink 1");
    expect(pen.kind.kind === "auto" && "custom" in (pen.kind.value.geometry as object)).toBe(true);
    expect(pen.line.fill).toEqual({ kind: "solid", value: { kind: "rgb", value: "E81123" } });
    expect(shapes[0]!.name).toBe("Ink 2"); // highlighter at the back
    expect(shapes[0]!.line.fill).toEqual({ kind: "solid", value: { kind: "rgb", value: "FFB900" } });
    await act(() => store.undo());
    expect(store.getState().pres!.slides[0]!.shapes).toHaveLength(before);
  });

  it("Discard drops the ink; a show without ink ends at once", async () => {
    const { store, console, onEnd } = await setup();
    fireEvent.keyDown(window, { key: "p", ctrlKey: true });
    draw(within(screen.getByTestId("console-current")).getByTestId("ink-layer"), 10, 10, 100, 100);
    const before = store.getState().pres!.slides[0]!.shapes.length;
    fireEvent.keyDown(window, { key: "e" }); // E erases the slide's ink
    fireEvent.click(within(console).getByRole("button", { name: "End show" }));
    expect(onEnd).toHaveBeenCalledTimes(1);
    cleanup();
    const again = await setup();
    fireEvent.keyDown(window, { key: "p", ctrlKey: true });
    draw(within(screen.getByTestId("console-current")).getByTestId("ink-layer"), 10, 10, 100, 100);
    fireEvent.click(within(again.console).getByRole("button", { name: "End show" }));
    fireEvent.click(within(screen.getByTestId("ink-confirm")).getByRole("button", { name: "Discard" }));
    expect(again.onEnd).toHaveBeenCalled();
    expect(again.store.getState().pres!.slides[0]!.shapes.length).toBe(before);
  });
});
