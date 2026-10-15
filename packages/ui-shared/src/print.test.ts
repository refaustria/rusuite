import { afterEach, describe, expect, it, vi } from "vitest";
import { pageRule, pageSizeCss, printAndWait } from "./print";
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
