import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";

vi.mock("react-konva", () => import("../test/konvaMock"));

import { fixture } from "../test/fixture";
import { Presenter, presenterKey } from "./Presenter";

afterEach(cleanup);

describe("presenter", () => {
  it("maps keys to slide indices", () => {
    expect(presenterKey("ArrowRight", 0, 3)).toBe(1);
    expect(presenterKey(" ", 2, 3)).toBe(2);
    expect(presenterKey("PageDown", 1, 3)).toBe(2);
    expect(presenterKey("ArrowLeft", 0, 3)).toBe(0);
    expect(presenterKey("PageUp", 2, 3)).toBe(1);
    expect(presenterKey("Home", 2, 3)).toBe(0);
    expect(presenterKey("End", 0, 3)).toBe(2);
    expect(presenterKey("Escape", 1, 3)).toBe("exit");
    expect(presenterKey("x", 1, 3)).toBeNull();
  });

  it("goes fullscreen, scales to the screen, navigates by keys and clicks and exits on Esc", () => {
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    HTMLElement.prototype.requestFullscreen = requestFullscreen;
    Object.defineProperty(window, "innerWidth", { value: 1920, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 1200, configurable: true });
    const pres = fixture();
    const onExit = vi.fn();
    function Host() {
      const [i, setI] = useState(0);
      return <Presenter deck={pres} slides={pres.slides} media={new Map()} mediaVersion={0} index={i} onIndex={setI} onExit={onExit} />;
    }
    render(<Host />);
    const p = screen.getByTestId("presenter");
    expect(requestFullscreen).toHaveBeenCalled();
    const stage = p.querySelector('[data-konva="Stage"]')!;
    expect(stage.getAttribute("data-width")).toBe("1920");
    expect(stage.getAttribute("data-height")).toBe("1080");
    expect(p.textContent).toContain("Rusuite"); // the title wraps: one Text node per line
    expect(p.querySelector('[data-draggable="true"]')).toBeNull();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(p.textContent).toContain("Slide two");
    fireEvent.click(p);
    expect(screen.getByTestId("presenter-counter").textContent).toBe("3 / 3");
    fireEvent.keyDown(window, { key: "Home" });
    expect(screen.getByTestId("presenter-counter").textContent).toBe("1 / 3");
    fireEvent.keyDown(window, { key: "End" });
    fireEvent.keyDown(window, { key: "PageUp" });
    expect(p.textContent).toContain("Slide two");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onExit).toHaveBeenCalled();
  });
});
