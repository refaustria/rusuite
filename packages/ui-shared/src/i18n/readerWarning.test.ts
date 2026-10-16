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
    const keys = Object.keys(en).filter((k) => k.startsWith("reader."));
    expect(keys.length).toBeGreaterThanOrEqual(77);
    for (const k of keys) expect((de as Record<string, string>)[k], k).toBeTruthy();
    expect(readerWarningKey("docx.x")).toBe("reader.docx.x");
  });
});
