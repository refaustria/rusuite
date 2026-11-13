import { describe, expect, it } from "vitest";
import { exportFileName, importKindOf, isOneNotePackage } from "./formats";

describe("import/export formats", () => {
  it("picks the importer by extension", () => {
    expect(importKindOf("Work.onepkg")).toBe("oneNote");
    expect(importKindOf("New Section 1.ONE")).toBe("oneNote");
    expect(importKindOf("notes.md")).toBe("markdown");
    expect(importKindOf("page.htm")).toBe("html");
    expect(importKindOf("Letter.docx")).toBe("docx");
    expect(importKindOf("sheet.xlsx")).toBeNull();
    expect(importKindOf("README")).toBeNull();
  });

  it("recognises packages by their signature", () => {
    expect(isOneNotePackage(new TextEncoder().encode("MSCF\0\0"))).toBe(true);
    expect(isOneNotePackage(new Uint8Array([0xe4, 0x52]))).toBe(false);
  });

  it("names exported files", () => {
    expect(exportFileName("Plan: Q3/Q4", "md", false)).toBe("Plan_ Q3_Q4.md");
    expect(exportFileName("Inbox", "md", true)).toBe("Inbox.zip");
    expect(exportFileName("Inbox", "html", true)).toBe("Inbox.html");
    expect(exportFileName("  ", "docx", false, "Untitled")).toBe("Untitled.docx");
  });
});
