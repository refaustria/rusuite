// The sticky ruler must never cover text: the scroll container reserves its
// height (scroll-padding-top, ProseMirror's top scroll margin) and the
// ruler sits inside that scroll container, above the first block.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ setTitle: vi.fn() }) }));

import App from "../App";
import { FakeWriteBackend } from "../test/fakeWriteBackend";
import { RULER_HEIGHT_PX, SCROLL_PADDING_PX, rulerReserve } from "./Ruler";

afterEach(() => cleanup());

describe("ruler space", () => {
  it("the reserve covers the container padding and the (zoomed) ruler, nothing without a ruler", () => {
    expect(rulerReserve(false, 2)).toBe(0);
    expect(rulerReserve(true)).toBeGreaterThanOrEqual(SCROLL_PADDING_PX + RULER_HEIGHT_PX);
    expect(rulerReserve(true, 2)).toBeGreaterThanOrEqual(SCROLL_PADDING_PX + 2 * RULER_HEIGHT_PX);
    expect(rulerReserve(true, 0.5)).toBeGreaterThanOrEqual(SCROLL_PADDING_PX + RULER_HEIGHT_PX / 2);
  });

  it("the scroll container reserves the ruler height; the ruler is inside it before the first block", async () => {
    render(<App backend={new FakeWriteBackend()} />);
    const editor = await screen.findByTestId("editor");
    await waitFor(() => expect(editor.querySelector("p")).toBeTruthy());
    const scroll = screen.getByTestId("write-scroll");
    const ruler = await screen.findByTestId("ruler");
    expect(scroll.contains(ruler)).toBe(true);
    expect(ruler.compareDocumentPosition(editor.querySelector("p")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(parseFloat(scroll.style.scrollPaddingTop)).toBeGreaterThanOrEqual(SCROLL_PADDING_PX + RULER_HEIGHT_PX);
    expect(scroll.style.overflowAnchor).toBe("none");
    // View › Ruler off: no reserve.
    fireEvent.click(screen.getByRole("tab", { name: "View" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Ruler" }));
    await waitFor(() => expect(screen.queryByTestId("ruler")).toBeNull());
    expect(parseFloat(scroll.style.scrollPaddingTop)).toBe(0);
  });
});
