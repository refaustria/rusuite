import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ setTitle: vi.fn() }) }));

import App from "../App";
import type { PageSetup } from "../generated/PageSetup";
import { FakeWriteBackend } from "../test/fakeWriteBackend";
import { writePageCss, writePrintCss } from "./printCss";
import { buildWritePrintDoc, DEFAULT_WRITE_PRINT, editorBlocks, pageGroups, writePageHtml, writePrintGeometry } from "./writePrintDoc";

afterEach(cleanup);

const margins = { top: 1440, right: 1440, bottom: 1440, left: 1440, header: 720, footer: 720 };
const page = (p: Partial<PageSetup>): PageSetup => ({ width: 11906, height: 16838, margins, orientation: "portrait", ...p });


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

describe("print document", () => {
  const D = DEFAULT_WRITE_PRINT;
  it("geometry: the document's page setup by default, overrides for paper, orientation and margins", () => {
    const g = writePrintGeometry(page({}), D);
    expect([g.width, g.height, g.top, g.left]).toEqual([11906 / 15, 16838 / 15, 96, 96]);
    const l = writePrintGeometry(page({}), { ...D, paper: "Letter", orientation: "landscape", margins: "narrow" });
    expect([l.width, l.height, l.top, l.left, l.header]).toEqual([1056, 816, 48, 48, 28.799999999999997]);
    const keep = writePrintGeometry(page({ width: 16838, height: 11906, orientation: "landscape" }), { ...D, paper: "A3" });
    expect(keep.width).toBeGreaterThan(keep.height);
  });
  it("pageGroups packs blocks like the print layout; scale shrinks them", () => {
    const blocks = Array.from({ length: 10 }, (_, i) => ({ top: i * 100, bottom: i * 100 + 90, breakAfter: false }));
    expect(pageGroups(blocks, 450)).toEqual([[0, 4], [4, 8], [8, 10]]);
    expect(pageGroups(blocks, 450, 0.5)).toEqual([[0, 9], [9, 10]]);
    expect(pageGroups([], 450)).toEqual([[0, 0]]);
  });
  it("a manual page break ends its page", () => {
    const blocks = [{ top: 0, bottom: 10, breakAfter: true }, { top: 10, bottom: 20, breakAfter: false }, { top: 20, bottom: 30, breakAfter: false }];
    expect(pageGroups(blocks, 1000)).toEqual([[0, 1], [1, 3]]);
  });
  it("page HTML: header and footer with the page number, scaled text area", () => {
    const g = writePrintGeometry(page({ headerText: "Report", footerText: "Page {PAGE}" }), D);
    const html = writePageHtml("<p>x</p>", 3, g, page({ headerText: "Report", footerText: "Page {PAGE}" }), 0.5, "tiptap-content");
    expect(html).toContain(">Report</div>");
    expect(html).toContain(">Page 3</div>");
    expect(html).toContain("zoom:0.5;");
    expect(html).toContain('class="tiptap-content rs-write-content"');
  });
  it("builds pages from the editor DOM without the pagination widgets", () => {
    const dom = document.createElement("div");
    dom.className = "tiptap ProseMirror tiptap-content ProseMirror-focused";
    dom.innerHTML = '<p>One</p><div class="page-gap">gap</div><p contenteditable="false">Two</p><div class="page-end"></div>';
    expect(editorBlocks(dom).map((e) => e.textContent)).toEqual(["One", "Two"]);
    const doc = buildWritePrintDoc(dom, page({}), DEFAULT_WRITE_PRINT);
    expect(doc.pages).toHaveLength(1);
    expect(doc.pages[0]).toContain("<p>One</p><p>Two</p>");
    expect(doc.pages[0]).not.toContain("ProseMirror-focused");
    expect(doc.widthIn).toBeCloseTo(11906 / 1440, 3);
    expect(doc.head).toContain("<style>");
  });
});

describe("Write printing", () => {
  it("Ctrl+P opens File › Print with the preview; Print and File › Export PDF… print", async () => {
    const backend = new FakeWriteBackend();
    const print = vi.spyOn(backend, "print");
    render(<App backend={backend} />);
    await screen.findByTestId("editor");
    fireEvent.keyDown(window, { key: "p", ctrlKey: true });
    const backstage = await screen.findByRole("dialog", { name: "File" });
    await waitFor(() => expect(screen.getByTestId("print-page-count").textContent).toBe("Page 1 of 1"));
    expect(within(backstage).getByLabelText("Paper size")).toBeTruthy();
    fireEvent.click(screen.getByTestId("print-button"));
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    window.dispatchEvent(new Event("afterprint"));
    fireEvent.click(within(backstage).getByRole("button", { name: "Export PDF…" }));
    await waitFor(() => expect(print).toHaveBeenCalledTimes(2));
    window.dispatchEvent(new Event("afterprint"));
  });
});
