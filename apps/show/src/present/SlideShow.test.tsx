import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("react-konva", () => import("../test/konvaMock"));

import { ShowApi } from "../api";
import { ShowStore } from "../state/store";
import { FakeBackend } from "../test/fakeBackend";
import { Audience } from "./Audience";
import { SlideShow, customShowIds } from "./SlideShow";
import { audienceIdOf, fakeSyncPair, type AudienceLink, type SyncMessage } from "./sync";

afterEach(cleanup);

const flush = () => act(() => new Promise((r) => setTimeout(r, 0)));

async function storeWithNotes() {
  const store = new ShowStore(new ShowApi(new FakeBackend()));
  await store.init();
  await store.setNotes(1, "Welcome everyone");
  await store.setNotes(4, "Second slide notes");
  return store;
}

function fakeLink(open = true) {
  const [presenter, audience] = fakeSyncPair();
  const win = { isOpen: vi.fn(() => true), close: vi.fn() };
  const link: AudienceLink = { id: "t1", sync: Promise.resolve(presenter), window: Promise.resolve(open ? win : null) };
  return { link, audience, win };
}

describe("sync channel", () => {
  it("fake pair delivers to the other side only, copied", () => {
    const [a, b] = fakeSyncPair();
    const gotA: SyncMessage[] = [];
    const gotB: SyncMessage[] = [];
    a.listen((m) => gotA.push(m));
    const off = b.listen((m) => gotB.push(m));
    const msg: SyncMessage = { kind: "state", slideIndex: 2, step: 0, blackout: "black", ended: false };
    a.post(msg);
    expect(gotA).toEqual([]);
    expect(gotB).toEqual([msg]);
    expect(gotB[0]).not.toBe(msg);
    off();
    a.post({ kind: "end" });
    expect(gotB).toHaveLength(1);
  });

  it("reads the audience id from the URL", () => {
    expect(audienceIdOf("?audience=ab12")).toBe("ab12");
    expect(audienceIdOf("")).toBeNull();
    expect(audienceIdOf("?audience=../x")).toBeNull();
  });
});

describe("presenter view", () => {
  it("shows notes, next slide and timer here; the audience window follows and drives the show", async () => {
    const store = await storeWithNotes();
    const { link, audience } = fakeLink();
    const onEnd = vi.fn();
    const audienceEnd = vi.fn();
    render(<SlideShow store={store} mode="presenter" link={link} onEnd={onEnd} />);
    await flush();
    const console = screen.getByTestId("presenter-console");
    expect(screen.getByTestId("console-counter").textContent).toBe("Slide 1 of 3");
    expect(screen.getByTestId("console-notes").textContent).toBe("Welcome everyone");
    expect(screen.getByTestId("console-next").textContent).toContain("Slide two");
    expect(screen.getByTestId("presenter-timer").textContent).toBe("00:00");
    expect(screen.getAllByTestId("console-strip-item")).toHaveLength(3);

    // The audience window: says hello, gets the deck and the state.
    const sent: SyncMessage[] = [];
    audience.listen((m) => sent.push(m));
    render(<Audience id="t1" channel={Promise.resolve(audience)} onEnd={audienceEnd} />);
    await flush();
    expect(sent.map((m) => m.kind)).toContain("deck");
    const screenEl = screen.getByTestId("presenter");
    expect(within(screenEl).getByTestId("presenter-counter").textContent).toBe("1 / 3");

    fireEvent.click(within(console).getByRole("button", { name: "Next" }));
    await flush();
    expect(screen.getByTestId("console-counter").textContent).toBe("Slide 2 of 3");
    expect(screen.getByTestId("console-notes").textContent).toBe("Second slide notes");
    expect(within(screenEl).getByTestId("presenter-counter").textContent).toBe("2 / 3");
    expect(store.getState().current).toBe(4);

    // A click on the audience screen's right half goes to the presenter, which moves both.
    fireEvent.click(screenEl, { clientX: 2000 });
    await flush();
    expect(screen.getByTestId("console-counter").textContent).toBe("Slide 3 of 3");
    expect(within(screenEl).getByTestId("presenter-counter").textContent).toBe("3 / 3");

    // Black screen from the console; jump with the strip.
    fireEvent.click(within(console).getByRole("button", { name: "Black screen" }));
    await flush();
    expect(screenEl.getAttribute("data-blank")).toBe("black");
    expect(screen.getByTestId("console-screen").textContent).toBe("Black screen");
    fireEvent.click(within(console).getByRole("button", { name: "Go to slide 1" }));
    await flush();
    expect(screenEl.getAttribute("data-blank")).toBe("none");
    expect(within(screenEl).getByTestId("presenter-counter").textContent).toBe("1 / 3");

    // Notes text size.
    const notes = screen.getByTestId("console-notes");
    const before = parseInt(notes.style.fontSize);
    fireEvent.click(within(console).getByRole("button", { name: "Larger notes text" }));
    expect(parseInt(notes.style.fontSize)).toBeGreaterThan(before);

    fireEvent.click(within(console).getByRole("button", { name: "End show" }));
    expect(onEnd).toHaveBeenCalled();
  });

  it("ends the show and closes the audience window", async () => {
    const store = await storeWithNotes();
    const { link, audience, win } = fakeLink();
    const got: SyncMessage[] = [];
    audience.listen((m) => got.push(m));
    const { unmount } = render(<SlideShow store={store} mode="presenter" link={link} onEnd={vi.fn()} />);
    await flush();
    unmount();
    await flush();
    expect(got.at(-1)).toEqual({ kind: "end" });
    expect(win.close).toHaveBeenCalled();
  });

  it("ends when the audience window is closed", async () => {
    const store = await storeWithNotes();
    const { link, audience } = fakeLink();
    const onEnd = vi.fn();
    render(<SlideShow store={store} mode="presenter" link={link} onEnd={onEnd} />);
    await flush();
    audience.post({ kind: "bye" });
    expect(onEnd).toHaveBeenCalled();
  });

  it("falls back to the single-window show with a notes overlay when the window cannot open", async () => {
    const store = await storeWithNotes();
    const { link } = fakeLink(false);
    render(<SlideShow store={store} mode="presenter" link={link} onEnd={vi.fn()} />);
    await flush();
    expect(screen.queryByTestId("presenter-console")).toBeNull();
    expect(screen.getByTestId("notes-overlay").textContent).toBe("Welcome everyone");
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByTestId("notes-overlay").textContent).toBe("Second slide notes");
    fireEvent.click(screen.getByTestId("notes-overlay-toggle"));
    expect(screen.queryByTestId("notes-overlay")).toBeNull();
    expect(screen.getByTestId("presenter-counter").textContent).toBe("2 / 3");
  });

  it("the audience window forwards its keys and closes when the show ends", async () => {
    const [presenter, audience] = fakeSyncPair();
    const got: SyncMessage[] = [];
    presenter.listen((m) => got.push(m));
    const onEnd = vi.fn();
    render(<Audience id="t2" channel={Promise.resolve(audience)} onEnd={onEnd} />);
    await flush();
    expect(screen.getByTestId("audience-waiting")).toBeTruthy();
    expect(got).toEqual([{ kind: "hello" }]);
    const pres = (await storeWithNotes()).getState().pres!;
    act(() => presenter.post({ kind: "deck", deck: pres, slides: pres.slides, media: [] }));
    act(() => presenter.post({ kind: "state", slideIndex: 1, step: 0, blackout: "none", ended: false }));
    expect(screen.getByTestId("presenter-counter").textContent).toBe("2 / 3");
    fireEvent.keyDown(window, { key: "b" });
    fireEvent.keyDown(window, { key: "4" });
    expect(got.slice(1)).toEqual([
      { kind: "action", action: { type: "blank", color: "black" } },
      { kind: "action", action: { type: "digit", digit: "4" } },
    ]);
    presenter.post({ kind: "end" });
    expect(onEnd).toHaveBeenCalled();
  });

  it("skips hidden slides unless the show starts on one", async () => {
    const store = await storeWithNotes();
    await store.toggleHidden(); // slide 1 (current) hidden
    render(<SlideShow store={store} mode="single" onEnd={vi.fn()} />);
    expect(screen.getByTestId("presenter-counter").textContent).toBe("1 / 3");
    cleanup();
    store.selectSlide(4);
    render(<SlideShow store={store} mode="single" onEnd={vi.fn()} />);
    expect(screen.getByTestId("presenter-counter").textContent).toBe("1 / 2");
  });
});

/** A store whose third slide (id 7) animates its shapes 8 and 9 in on two clicks. */
async function storeWithAnimations() {
  const store = await storeWithNotes();
  store.selectSlide(7);
  store.select([8]);
  await store.addAnimation("entrance", "fade");
  store.select([9]);
  await store.addAnimation("entrance", "flyIn");
  return store;
}

const hiddenOn = () => screen.getByTestId("animated-slide").getAttribute("data-hidden-shapes");

describe("animations and timings in the show", () => {
  it("two On Click shapes need two clicks; ← rebuilds the steps", async () => {
    const store = await storeWithAnimations();
    render(<SlideShow store={store} mode="single" onEnd={vi.fn()} />);
    const presenter = screen.getByTestId("presenter");
    expect(screen.getByTestId("presenter-counter").textContent).toBe("3 / 3");
    expect(hiddenOn()).toBe("8,9");
    fireEvent.click(presenter, { clientX: 2000 });
    expect(presenter.getAttribute("data-step")).toBe("1");
    expect(hiddenOn()).toBe("9");
    fireEvent.keyDown(window, { key: " " });
    expect(hiddenOn()).toBe("");
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByTestId("presenter-end")).toBeTruthy();
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(hiddenOn()).toBe("9");
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(screen.getByTestId("presenter-counter").textContent).toBe("2 / 3");
    // Forward again to the animated slide: it starts from the beginning.
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(hiddenOn()).toBe("8,9");
  });

  it("advances by itself after the After time; S stops it", async () => {
    const store = await storeWithNotes();
    store.selectSlide(1);
    await store.setTransition({ kind: "fade" });
    await store.setTransition({ advanceAfterMs: 2000 });
    store.selectSlide(4);
    await store.setTransition({ advanceAfterMs: 1000 });
    store.selectSlide(1);
    vi.useFakeTimers();
    try {
      render(<SlideShow store={store} mode="single" onEnd={vi.fn()} />);
      const counter = () => screen.getByTestId("presenter-counter").textContent;
      act(() => vi.advanceTimersByTime(1999));
      expect(counter()).toBe("1 / 3");
      act(() => vi.advanceTimersByTime(1));
      expect(counter()).toBe("2 / 3");
      fireEvent.keyDown(window, { key: "s" });
      act(() => vi.advanceTimersByTime(5000));
      expect(counter()).toBe("2 / 3");
      fireEvent.keyDown(window, { key: "S" });
      act(() => vi.advanceTimersByTime(1000));
      expect(counter()).toBe("3 / 3");
      // The last slide has no timing: the show waits.
      act(() => vi.advanceTimersByTime(10_000));
      expect(screen.queryByTestId("presenter-end")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("the presenter view sends the step; the audience and the next preview follow", async () => {
    const store = await storeWithAnimations();
    const { link, audience } = fakeLink();
    const got: SyncMessage[] = [];
    audience.listen((m) => got.push(m));
    render(<SlideShow store={store} mode="presenter" link={link} onEnd={vi.fn()} />);
    await flush();
    const console = screen.getByTestId("presenter-console");
    const next = () => within(screen.getByTestId("console-next")).getByTestId("animated-slide");
    // Slide 3 of 3 at step 0: "Next" is the same slide after its first click.
    expect(next().getAttribute("data-slide")).toBe("7");
    expect(next().getAttribute("data-hidden-shapes")).toBe("9");
    fireEvent.click(within(console).getByRole("button", { name: "Next" }));
    await flush();
    expect(got.filter((m) => m.kind === "state").at(-1)).toMatchObject({ slideIndex: 2, step: 1 });
    expect(next().getAttribute("data-hidden-shapes")).toBe("");
    render(<Audience id="t1" channel={Promise.resolve(audience)} onEnd={vi.fn()} />);
    await flush();
    const screenEl = screen.getAllByTestId("presenter").at(-1)!;
    expect(screenEl.getAttribute("data-step")).toBe("1");
    expect(within(screenEl).getByTestId("animated-slide").getAttribute("data-hidden-shapes")).toBe("9");
  });
});

describe("custom shows (P9-S3)", () => {
  it("runs only the custom show's slides, in its order; a link with return comes back", async () => {
    const store = await storeWithNotes();
    await store.setCustomShows([{ id: 3, name: "Short", slideIds: [7, 1] }]);
    store.selectSlide(4);
    render(<SlideShow store={store} mode="single" customShow={3} onEnd={vi.fn()} />);
    expect(screen.getByTestId("presenter-counter").textContent).toBe("1 / 2");
    await flush();
    expect(store.getState().current).toBe(7);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    await flush();
    expect(store.getState().current).toBe(1);
  });

  it("customShowIds skips hidden and missing slides; an unknown show is null", () => {
    const p = { slides: [{ id: 1, layout: "blank" as const, shapes: [] }, { id: 2, layout: "blank" as const, shapes: [], hidden: true }], customShows: [{ id: 0, name: "A", slideIds: [2, 1, 99, 1] }] };
    expect(customShowIds(p, 0)).toEqual([1, 1]);
    expect(customShowIds(p, 5)).toBeNull();
  });
});
