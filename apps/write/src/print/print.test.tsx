import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ setTitle: vi.fn() }) }));

import App from "../App";
import type { PageSetup } from "../generated/PageSetup";
import { FakeWriteBackend } from "../test/fakeWriteBackend";
import { writePageCss, writePrintCss } from "./printCss";

afterEach(cleanup);

const margins = { top: 1440, right: 1440, bottom: 1440, left: 1440, header: 720, footer: 720 };
const page = (p: Partial<PageSetup>): PageSetup => ({ width: 11906, height: 16838, margins, orientation: "portrait", ...p });


/** Runs a File (backstage) command. */
function fileCommand(name: string) {
  fireEvent.click(screen.getByRole("tab", { name: "File" }));
  fireEvent.click(within(screen.getByRole("dialog", { name: "File" })).getByRole("button", { name }));
}

describe("writePageCss", () => {
  it("A4 portrait with 1in margins", () => {
    expect(writePageCss(page({}))).toBe("@page { size: A4; margin: 1in 1in 1in 1in; }");
  });
  it("Letter landscape with custom margins, even when stored unrotated", () => {
    const m = { ...margins, top: 720, left: 2160 };
    expect(writePageCss(page({ width: 12240, height: 15840, orientation: "landscape", margins: m }))).toBe(
      "@page { size: Letter landscape; margin: 0.5in 1in 1in 1.5in; }",
    );
  });
  it("custom sizes are explicit; defaults without a page", () => {
    expect(writePageCss(page({ width: 7200, height: 14400 }))).toBe("@page { size: 5in 10in; margin: 1in 1in 1in 1in; }");
    expect(writePageCss(null)).toBe("@page { size: A4; margin: 1in; }");
  });
  it("print rules hide the chrome and break at page breaks", () => {
    const css = writePrintCss(page({}));
    expect(css).toContain("main > :not(.write-scroll) { display: none !important; }");
    expect(css).toContain("break-before: page");
  });
});

describe("Write export", () => {
  it("Ctrl+P and File › Export PDF… print; the document's @page is in the DOM", async () => {
    const backend = new FakeWriteBackend();
    const print = vi.spyOn(backend, "print");
    render(<App backend={backend} />);
    await screen.findByTestId("editor");
    await waitFor(() => expect([...document.querySelectorAll("style")].some((s) => s.textContent?.includes("@page"))).toBe(true));
    fireEvent.keyDown(window, { key: "p", ctrlKey: true });
    fileCommand("Export PDF…");
    await waitFor(() => expect(print).toHaveBeenCalledTimes(2));
  });
});
