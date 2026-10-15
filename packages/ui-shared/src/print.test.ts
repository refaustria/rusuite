import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PRINT_ROOT_ID, applyPageRange, expandHeaderFooter, headerFooterHtml, mountPrintRoot, pageRule, pageSizeCss, paperSize, parsePageRange, printAndWait,
  printDocCss, printDocHtml, printDocument, unmountPrintRoot,
} from "./print";
import { WasmBackend } from "./backend";

afterEach(() => vi.restoreAllMocks());

describe("pageSizeCss", () => {
  it("names A4 and Letter", () => {
    expect(pageSizeCss(11906 / 1440, 16838 / 1440)).toBe("A4");
    expect(pageSizeCss(8.5, 11)).toBe("Letter");
    expect(pageSizeCss(11, 8.5)).toBe("Letter landscape");
    expect(pageSizeCss(16838 / 1440, 11906 / 1440)).toBe("A4 landscape");
  });
  it("falls back to explicit inches", () => {
    expect(pageSizeCss(13.333, 7.5)).toBe("13.333in 7.5in");
  });
  it("builds the @page rule", () => {
    expect(pageRule("A4", "1in 2in")).toBe("@page { size: A4; margin: 1in 2in; }");
  });
});

describe("printing", () => {
  it("WasmBackend.print calls window.print", async () => {
    const spy = vi.spyOn(window, "print").mockImplementation(() => {});
    await new WasmBackend({ ping: () => "", dispatch: () => "" }).print();
    expect(spy).toHaveBeenCalledOnce();
  });
  it("printAndWait resolves on afterprint or after the grace period", async () => {
    const print = vi.fn(async () => {
      setTimeout(() => window.dispatchEvent(new Event("afterprint")), 5);
    });
    await printAndWait({ print }, 10_000);
    expect(print).toHaveBeenCalledOnce();
    await printAndWait({ print: async () => {} }, 10);
  });
});

describe("page ranges", () => {
  it("empty means all pages", () => {
    expect(parsePageRange("", 3)).toEqual({ pages: [1, 2, 3] });
    expect(parsePageRange("  ", 2)).toEqual({ pages: [1, 2] });
  });
  it("pages and ranges, sorted and unique; open ends", () => {
    expect(parsePageRange("5, 1-3,2", 9)).toEqual({ pages: [1, 2, 3, 5] });
    expect(parsePageRange("7-", 9)).toEqual({ pages: [7, 8, 9] });
    expect(parsePageRange("-2", 9)).toEqual({ pages: [1, 2] });
    expect(parsePageRange("2-2", 3)).toEqual({ pages: [2] });
  });
  it("pages past the end are dropped; nothing left is an error", () => {
    expect(parsePageRange("2-10", 3)).toEqual({ pages: [2, 3] });
    expect(parsePageRange("9", 3)).toEqual({ error: "The document has 3 pages" });
  });
  it("rejects garbage and reversed ranges", () => {
    expect("error" in parsePageRange("a", 3)).toBe(true);
    expect("error" in parsePageRange("3-1", 3)).toBe(true);
    expect("error" in parsePageRange("0", 3)).toBe(true);
    expect("error" in parsePageRange("1 2", 3)).toBe(true);
  });
  it("applyPageRange keeps the selected pages", () => {
    const doc = { widthIn: 1, heightIn: 1, css: "", pages: ["a", "b", "c"] };
    expect(applyPageRange(doc, "1,3").pages).toEqual(["a", "c"]);
    expect(applyPageRange(doc, "x").pages).toEqual([]);
  });
});

describe("print documents", () => {
  const doc = { widthIn: 8.5, heightIn: 11, css: ".x{color:red}", pages: ["<p>one</p>", "<p>two</p>"] };
  it("@page and page boxes from the document size", () => {
    const css = printDocCss({ widthIn: 210 / 25.4, heightIn: 297 / 25.4 });
    expect(css).toContain("@page { size: 8.268in 11.693in; margin: 0; }");
    expect(css).toContain("width: 8.268in; height: 11.693in;");
    expect(css).toContain("break-after: page");
  });
  it("paper sizes and orientation", () => {
    expect(paperSize("Legal", "portrait")).toEqual({ w: 8.5, h: 14 });
    expect(paperSize("Letter", "landscape")).toEqual({ w: 11, h: 8.5 });
    expect(pageSizeCss(297 / 25.4, 420 / 25.4)).toBe("A3");
  });
  it("standalone HTML with one page box per page; preview adds the screen styles", () => {
    const html = printDocHtml(doc);
    expect(html.match(/class="rs-print-page"/g)).toHaveLength(2);
    expect(html).toContain(".x{color:red}");
    expect(html).not.toContain("rs-preview-off");
    expect(printDocHtml(doc, { preview: true })).toContain("rs-preview-off");
  });
  it("printDocument mounts the print root while printing and removes it after (web)", async () => {
    let during = 0;
    const backend = {
      kind: "wasm" as const,
      print: async () => {
        during = document.getElementById(PRINT_ROOT_ID)?.querySelectorAll(".rs-print-page").length ?? -1;
        setTimeout(() => window.dispatchEvent(new Event("afterprint")), 1);
      },
    };
    await printDocument(doc, backend);
    expect(during).toBe(2);
    expect(document.getElementById(PRINT_ROOT_ID)).toBeNull();
    await expect(printDocument({ ...doc, pages: [] }, backend)).rejects.toThrow("Nothing to print");
  });
  it("the desktop keeps the print root until the next print", async () => {
    vi.useFakeTimers();
    try {
      const p = printDocument(doc, { kind: "tauri", print: async () => void window.dispatchEvent(new Event("afterprint")) });
      await vi.runAllTimersAsync();
      await p;
    } finally {
      vi.useRealTimers();
    }
    mountPrintRoot(doc);
    expect(document.querySelectorAll(`#${PRINT_ROOT_ID}`)).toHaveLength(1);
    unmountPrintRoot();
  });
});

describe("header and footer tokens", () => {
  const ctx = { page: 2, pages: 5, date: new Date(2026, 9, 15, 9, 5), sheet: "Data", file: "Book.xlsx" };
  it("expands &P &N &A &F && and keeps unknown ones", () => {
    expect(expandHeaderFooter("Page &P of &N – &A (&F) &&Q &X", ctx)).toBe("Page 2 of 5 – Data (Book.xlsx) &Q &X");
    expect(expandHeaderFooter("&D", ctx)).toBe(ctx.date.toLocaleDateString());
  });
  it("three slots, escaped; nothing for empty slots", () => {
    const html = headerFooterHtml({ left: "<b>", center: "&P", right: "" }, ctx, "footer", 0.3, 0.7, 0.7);
    expect(html).toContain("bottom:0.3in");
    expect(html).toContain("&lt;b&gt;");
    expect(html).toContain('class="rs-hf-center"');
    expect(html).not.toContain("rs-hf-right");
    expect(headerFooterHtml({ left: "", center: "", right: "" }, ctx, "header", 0.3, 0.7, 0.7)).toBe("");
  });
});
