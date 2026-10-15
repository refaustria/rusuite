import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";

vi.mock("react-konva", () => import("../test/konvaMock"));

import { fixture } from "../test/fixture";
import { IDLE_CURSOR_MS, Presenter } from "./Presenter";
import { initialShow, reduceShow, type ShowState } from "./showState";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function mount(onExit = vi.fn()) {
  const pres = fixture();
  function Host() {
    const [s, setS] = useState<ShowState>(initialShow(pres.slides.length));
    return (
      <Presenter
        deck={pres}
        slides={pres.slides}
        media={new Map()}
        mediaVersion={0}
        show={s}
        onAction={(a) => {
          const n = reduceShow(s, a);
          if (n === "exit") onExit();
          else setS(n);
        }}
      />
    );
  }
  render(<Host />);
  return { p: screen.getByTestId("presenter"), onExit, counter: () => screen.queryByTestId("presenter-counter")?.textContent };
}

describe("presenter", () => {
  it("goes fullscreen, scales to the screen, navigates by keys and clicks and exits on Esc", () => {
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    HTMLElement.prototype.requestFullscreen = requestFullscreen;
    Object.defineProperty(window, "innerWidth", { value: 1920, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 1200, configurable: true });
    const { p, onExit, counter } = mount();
    expect(requestFullscreen).toHaveBeenCalled();
    const stage = p.querySelector('[data-konva="Stage"]')!;
    expect(stage.getAttribute("data-width")).toBe("1920");
    expect(stage.getAttribute("data-height")).toBe("1080");
    expect(p.textContent).toContain("Rusuite"); // the title wraps: one Text node per line
    expect(p.querySelector('[data-draggable="true"]')).toBeNull();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(p.textContent).toContain("Slide two");
    // Right half: next; left half: previous.
    fireEvent.click(p, { clientX: 1500 });
    expect(counter()).toBe("3 / 3");
    fireEvent.click(p, { clientX: 200 });
    expect(counter()).toBe("2 / 3");
    fireEvent.keyDown(window, { key: "Home" });
    expect(counter()).toBe("1 / 3");
    fireEvent.keyDown(window, { key: "End" });
    fireEvent.keyDown(window, { key: "PageUp" });
    expect(p.textContent).toContain("Slide two");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onExit).toHaveBeenCalled();
  });

  it("blanks the screen black (B) or white (W)", () => {
    const { p, counter } = mount();
    fireEvent.keyDown(window, { key: "b" });
    expect(p.getAttribute("data-blank")).toBe("black");
    expect(p.className).toContain("bg-black");
    expect(p.querySelector('[data-konva="Stage"]')).toBeNull();
    fireEvent.keyDown(window, { key: "w" });
    expect(p.getAttribute("data-blank")).toBe("white");
    expect(p.className).toContain("bg-white");
    fireEvent.keyDown(window, { key: "w" });
    expect(p.getAttribute("data-blank")).toBe("none");
    expect(counter()).toBe("1 / 3");
    // Ctrl/Alt combinations are not show keys.
    fireEvent.keyDown(window, { key: "b", ctrlKey: true });
    expect(p.getAttribute("data-blank")).toBe("none");
  });

  it("jumps with number + Enter and ends on a black end slide", () => {
    const { p, onExit, counter } = mount();
    fireEvent.keyDown(window, { key: "3" });
    fireEvent.keyDown(window, { key: "Enter" });
    expect(counter()).toBe("3 / 3");
    fireEvent.keyDown(window, { key: " " });
    expect(screen.getByTestId("presenter-end").textContent).toContain("End of slide show");
    expect(p.querySelector('[data-konva="Stage"]')).toBeNull();
    expect(onExit).not.toHaveBeenCalled();
    fireEvent.click(p, { clientX: 1500 });
    expect(onExit).toHaveBeenCalled();
  });

  it("hides the mouse pointer after 3 s without movement", () => {
    vi.useFakeTimers();
    const { p } = mount();
    expect(p.className).toContain("cursor-pointer");
    act(() => void vi.advanceTimersByTime(IDLE_CURSOR_MS + 10));
    expect(p.className).toContain("cursor-none");
    fireEvent.mouseMove(window);
    expect(p.className).toContain("cursor-pointer");
    act(() => void vi.advanceTimersByTime(IDLE_CURSOR_MS - 100));
    expect(p.getAttribute("data-idle")).toBeNull();
  });
});
