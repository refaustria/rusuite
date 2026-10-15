import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ setTitle: vi.fn() }) }));
// react-konva needs a real <canvas> (native `canvas` package under jsdom);
// replace its components with plain elements that record their props.
vi.mock("react-konva", async () => {
  const React = await import("react");
  const el = (kind: string) =>
    React.forwardRef<unknown, Record<string, unknown>>(function Mock(props, _ref) {
      const { children, text, width, height, draggable } = props as {
        children?: React.ReactNode;
        text?: string;
        width?: number;
        height?: number;
        draggable?: boolean;
      };
      return React.createElement(
        "div",
        { "data-konva": kind, "data-width": width, "data-height": height, "data-draggable": String(!!draggable) },
        text,
        children as React.ReactNode,
      );
    });
  return {
    Stage: el("Stage"),
    Layer: el("Layer"),
    Rect: el("Rect"),
    Ellipse: el("Ellipse"),
    Text: el("Text"),
    Transformer: el("Transformer"),
  };
});

import App from "./App";
import { fitScale } from "./SlideStage";
import { pingCore } from "./backend";
import { FakeBackend } from "./fakeBackend";

afterEach(cleanup);

const kinds = (root: ParentNode) => [...root.querySelectorAll("[data-konva]")].map((n) => n.getAttribute("data-konva"));

describe("Show", () => {
  it("mounts the stage with the placeholder slide, three thumbnails and a status bar", async () => {
    render(<App backend={new FakeBackend()} />);
    expect(screen.getAllByTestId("thumbnail").length).toBe(3);
    const host = screen.getByTestId("stage-host");
    // jsdom has no layout, so the stage is not sized yet; scaling is covered by fitScale.
    expect(host).toBeTruthy();
    expect(screen.getByRole("button", { name: "Present" })).toBeTruthy();
    expect(screen.getByTestId("backend-kind").textContent).toBe("wasm");
    await waitFor(() => expect(screen.getByTestId("ping").textContent).toBe("Rusuite Show fake"));
    expect(fitScale(1280, 720)).toBe(1);
    expect(fitScale(640, 720)).toBe(0.5);
    expect(fitScale(0, 100)).toBe(0);
  });

  it("Present shows a fullscreen stage; arrows navigate and Esc exits", async () => {
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    HTMLElement.prototype.requestFullscreen = requestFullscreen;
    Object.defineProperty(window, "innerWidth", { value: 1920, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 1080, configurable: true });
    render(<App backend={new FakeBackend()} />);
    fireEvent.click(screen.getByRole("button", { name: "Present" }));
    const presenter = screen.getByTestId("presenter");
    expect(requestFullscreen).toHaveBeenCalled();
    expect(kinds(presenter)).toEqual(["Stage", "Layer", "Rect", "Text", "Rect", "Ellipse", "Transformer"]);
    const stage = presenter.querySelector('[data-konva="Stage"]')!;
    expect(stage.getAttribute("data-width")).toBe("1920");
    expect(stage.getAttribute("data-height")).toBe("1080");
    expect(presenter.querySelector('[data-konva="Ellipse"]')!.getAttribute("data-draggable")).toBe("false");
    expect(presenter.textContent).toContain("Welcome to Rusuite Show");
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(presenter.textContent).toContain("Slide two");
    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(presenter.textContent).toContain("Slide three");
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(presenter.textContent).toContain("Slide two");
    act(() => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(screen.queryByTestId("presenter")).toBeNull();
    expect(screen.getByTestId("slide-count").textContent).toBe("Slide 2 of 3");
  });

  it("pingCore sends {type:ping} and recognises pong", async () => {
    const backend = new FakeBackend();
    expect(await pingCore(backend)).toBe(true);
    expect(backend.log).toEqual([{ type: "ping" }]);
  });
});
