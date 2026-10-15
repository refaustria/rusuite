import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ setTitle: vi.fn() }) }));
vi.mock("react-konva", () => import("../test/konvaMock"));

import App from "../App";
import { ShowApi } from "../api";
import { ShowStore } from "../state/store";
import { FakeBackend } from "../test/fakeBackend";
import { fixture } from "../test/fixture";
import { PrintView } from "./PrintView";
import { showPageCss, showPrintCss } from "./printCss";

afterEach(cleanup);

Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 1312 });
Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 752 });

describe("print CSS", () => {
  it("sizes the page like the slide with no margin", () => {
    expect(showPageCss({ width: 12192000, height: 6858000 })).toBe("@page { size: 13.333in 7.5in; margin: 0; }");
    expect(showPageCss({ width: 9144000, height: 6858000 })).toBe("@page { size: 10in 7.5in; margin: 0; }");
    expect(showPrintCss({ width: 12192000, height: 6858000 })).toContain("break-after: page");
  });
});

describe("PrintView", () => {
  it("renders one page per slide and reports ready", async () => {
    const pres = fixture();
    const onReady = vi.fn();
    render(<PrintView deck={pres} slides={pres.slides} media={new Map()} onReady={onReady} />);
    await waitFor(() => expect(onReady).toHaveBeenCalledWith(3));
    expect(screen.getAllByTestId("print-page")).toHaveLength(3);
  });

  it("Ctrl+P in the app prints and returns to the editor", async () => {
    const backend = new FakeBackend();
    const print = vi.spyOn(backend, "print");
    const store = new ShowStore(new ShowApi(backend));
    render(<App backend={backend} store={store} />);
    await waitFor(() => expect(screen.getAllByTestId("thumbnail")).toHaveLength(3));
    fireEvent.keyDown(window, { key: "p", ctrlKey: true });
    await waitFor(() => expect(print).toHaveBeenCalledOnce());
    expect(screen.getAllByTestId("print-page")).toHaveLength(3);
    window.dispatchEvent(new Event("afterprint"));
    await waitFor(() => expect(screen.queryByTestId("print-view")).toBeNull());
    expect(screen.getAllByTestId("thumbnail")).toHaveLength(3);
  });
});
