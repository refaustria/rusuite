// Slide Show › Record, the Set Up toggles and Show Media Controls (P9-S5).

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ setTitle: vi.fn() }) }));
vi.mock("react-konva", () => import("../test/konvaMock"));

import App from "../App";
import { ShowApi } from "../api";
import { ShowStore } from "../state/store";
import { FakeBackend } from "../test/fakeBackend";
import { fixture } from "../test/fixture";
import { deckOf } from "../design/deck";
import { initialShow } from "./showState";
import { Presenter } from "./Presenter";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const flush = () => act(() => new Promise((r) => setTimeout(r, 0)));
const tab = (name: string) => screen.getByRole("tab", { name });

async function mount() {
  const backend = new FakeBackend();
  const store = new ShowStore(new ShowApi(backend));
  render(<App backend={backend} store={store} />);
  await waitFor(() => expect(screen.getAllByTestId("thumbnail")).toHaveLength(3));
  await flush();
  return { backend, store };
}

describe("Slide Show › Set Up", () => {
  it("Play Narrations, Use Timings and Show Media Controls are stored in the show settings", async () => {
    const { store } = await mount();
    fireEvent.click(tab("Slide Show"));
    const narr = screen.getByRole("checkbox", { name: "Play Narrations" }) as HTMLInputElement;
    const media = screen.getByRole("checkbox", { name: "Show Media Controls" }) as HTMLInputElement;
    expect(narr.checked).toBe(true);
    expect(media.checked).toBe(true);
    fireEvent.click(narr);
    await flush();
    fireEvent.click(screen.getByRole("checkbox", { name: "Show Media Controls" }));
    await flush();
    fireEvent.click(screen.getByRole("checkbox", { name: "Use Timings" }));
    await flush();
    expect(store.getState().pres!.showSettings).toMatchObject({ withoutNarration: true, showMediaControls: false, useTimings: false });
  });

  it("Show Media Controls off: the show's clips have no play bar", () => {
    const p = fixture();
    p.slides[2]!.shapes.push({ ...p.slides[2]!.shapes[0]!, id: 60, kind: { kind: "media", value: { kind: "video", media: 3 } } });
    const media = new Map([[3, "data:video/webm;base64,GkXfow=="]]);
    const { unmount } = render(<Presenter deck={deckOf(p)} slides={p.slides} media={media} mediaVersion={0} show={initialShow(3, 2)} onAction={vi.fn()} />);
    expect((screen.getByTestId("show-media-60") as HTMLVideoElement).controls).toBe(true);
    unmount();
    render(<Presenter deck={deckOf(p)} slides={p.slides} media={media} mediaVersion={0} show={initialShow(3, 2)} onAction={vi.fn()} mediaControls={false} />);
    expect((screen.getByTestId("show-media-60") as HTMLVideoElement).controls).toBe(false);
  });
});

describe("Slide Show › Record", () => {
  it("records the timings and the ink without asking; narration is not recorded", async () => {
    const { store, backend } = await mount();
    fireEvent.click(tab("Slide Show"));
    fireEvent.click(screen.getByRole("button", { name: "Record" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "From Beginning…" }));
    await flush();
    const show = screen.getByTestId("presenter");
    expect(within(show).getByTestId("rehearse-bar").textContent).toContain("Recording");
    fireEvent.keyDown(window, { key: "p", ctrlKey: true });
    const layer = within(show).getByTestId("ink-layer");
    fireEvent.pointerDown(layer, { button: 0, buttons: 1, pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(layer, { buttons: 1, pointerId: 1, clientX: 90, clientY: 50 });
    fireEvent.pointerUp(layer, { button: 0, pointerId: 1, clientX: 90, clientY: 50 });
    fireEvent.keyDown(window, { key: "Escape" }); // pen off
    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: "Escape" }); // ends the recording
    await flush();
    await flush();
    expect(screen.queryByTestId("presenter")).toBeNull();
    expect(screen.queryByTestId("rehearse-confirm")).toBeNull();
    expect(screen.queryByTestId("ink-confirm")).toBeNull();
    const slides = store.getState().pres!.slides;
    expect(slides[0]!.transition?.advanceAfterMs).toBeDefined();
    expect(slides[1]!.transition?.advanceAfterMs).toBeDefined();
    expect(slides[0]!.shapes.at(-1)!.name).toBe("Ink 1");
    expect(backend.commands.some((c) => c.type === "compound" && c.commands.some((x) => x.type === "setTransition"))).toBe(true);
  });
});
