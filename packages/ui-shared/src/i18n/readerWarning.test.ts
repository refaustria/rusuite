// W-26: reader warnings by code in the UI language.
import { describe, expect, it } from "vitest";
import de from "./locales/de.json";
import en from "./locales/en.json";
import { readerWarningKey, readerWarningText } from "./readerWarning";

const style = { code: "docx.numbering.levelStyleLink", params: {}, text: "word/numbering.xml: list level linked to a style; link dropped", count: 1 };

describe("readerWarningText", () => {
  it("translates a known code into German", () => {
    expect(readerWarningText(style, "de")).toBe("word/numbering.xml: Listenebene mit einer Formatvorlage verknüpft; Verknüpfung verworfen");
    expect(readerWarningText(style, "en")).toBe(style.text);
  });

  it("fills the placeholders with the reader's parameters", () => {
    const w = { code: "docx.paragraph.propertyDropped", params: { ctx: "word/document.xml", name: "w:framePr" }, text: "x", count: 1 };
    expect(readerWarningText(w, "de")).toBe("word/document.xml: Absatzeigenschaft w:framePr verworfen");
    expect(readerWarningText(w, "en")).toBe("word/document.xml: paragraph property w:framePr dropped");
  });

  it("repeats show their count", () => {
    expect(readerWarningText({ ...style, count: 4 }, "de")).toMatch(/verworfen \(4×\)$/);
  });

  it("an unknown code, no code or a plain string: the English text", () => {
    expect(readerWarningText({ code: "docx.future", text: "future thing dropped" }, "de")).toBe("future thing dropped");
    expect(readerWarningText({ text: "no code" }, "de")).toBe("no code");
    expect(readerWarningText("plain", "de")).toBe("plain");
  });

  it("every reader code has an English and a German message", () => {
    // The Rust readers' tests check that each code they emit is here with the same English text
    // (fmt-docx `warning_sites_are_consistent`, fmt-xlsx / fmt-pptx `templates_match_the_ui_catalogs`).
    const keys = Object.keys(en).filter((k) => k.startsWith("reader."));
    const count = (p: string) => keys.filter((k) => k.startsWith(`reader.${p}.`)).length;
    expect(count("docx")).toBeGreaterThanOrEqual(77);
    expect(count("xlsx")).toBeGreaterThanOrEqual(85);
    expect(count("pptx")).toBeGreaterThanOrEqual(121);
    const names = (t: string) => [...t.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const k of keys) {
      const german = (de as Record<string, string>)[k];
      expect(german, k).toBeTruthy();
      expect(names(german!), k).toEqual(names((en as Record<string, string>)[k]!));
    }
    expect(readerWarningKey("docx.x")).toBe("reader.docx.x");
  });

  it("translates spreadsheet and presentation codes (W-26, P9-X2)", () => {
    const iso = { code: "xlsx.cell.isoDate", params: { sheet: "Data", cell: "B2" }, text: 'sheet "Data": B2: ISO date cell kept as text', count: 1 };
    expect(readerWarningText(iso, "de")).toBe("Blatt „Data“: B2: ISO-Datumszelle als Text behalten");
    expect(readerWarningText(iso, "en")).toBe(iso.text);
    const dash = { code: "pptx.line.dash", params: { value: "sysDot" }, text: "line dash sysDot read as dashed", count: 2 };
    expect(readerWarningText(dash, "de")).toBe("Linienstrich sysDot als gestrichelt gelesen (2×)");
  });
});
