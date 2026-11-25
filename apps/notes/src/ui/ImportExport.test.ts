import { describe, expect, it } from "vitest";
import "../i18n";
import { convertWarningText } from "./ImportExport";

describe("convertWarningText", () => {
  it("a known code is translated, with its params", () => {
    const w = { code: "notes.link.unsafe", params: { href: "javascript:x" }, text: "A link to \"javascript:x\" was removed (only web, e-mail and phone links are kept)", count: 1 };
    expect(convertWarningText(w, "en")).toBe(w.text);
    expect(convertWarningText(w, "de")).toContain("javascript:x");
    expect(convertWarningText(w, "de")).not.toBe(w.text);
  });

  it("repeats show their count", () => {
    const w = { code: "docx.toc", params: {}, text: "A table of contents was left out", count: 3 };
    expect(convertWarningText(w, "en")).toBe("A table of contents was left out (3×)");
    expect(convertWarningText(w, "de")).toMatch(/\(3×\)$/);
  });

  it("the Word reader's own codes use the shared reader messages", () => {
    const w = { code: "docx.run.complexScript", params: { ctx: "word/document.xml" }, text: "x", count: 1 };
    expect(convertWarningText(w, "de")).not.toBe("x");
  });

  it("an unknown code or none: the English text", () => {
    expect(convertWarningText({ code: "notes.future", text: "Something new", count: 1 }, "de")).toBe("Something new");
    expect(convertWarningText({ text: "No code", count: 2 }, "de")).toBe("No code (2×)");
  });
});
