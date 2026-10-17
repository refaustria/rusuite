// P8-10: structure rendering (note numbers, section markers, live fields),
// section-aware pagination and the structure UI commands, on headless editors.

import { afterEach, describe, expect, it } from "vitest";
import { Extension, type Editor } from "@tiptap/core";
import { TextSelection, type EditorState } from "@tiptap/pm/state";
import type { Document } from "../generated/Document";
import type { Section } from "../generated/Section";
import { field, li, makeDoc, note, noteRef, para, run, structureDoc, toc } from "../test/fixtures";
import { makeEditor, posOf, select, Tagger } from "../test/harness";
import { findPos } from "../sync/SyncPlugin";
import {
  blocksText, computeBreaks, computeLayout, pageHfText, pageInfos, sectionHf, sectionLayout, type PageBreak,
} from "./pagination";
import {
  fieldValue, formatDateTime, formatNumber, goToNextRef, goToNote, goToRef, noteNumbers, structurePlugin, updateFieldsCommand,
  type FieldContext,
} from "./structure";
import { currentSection } from "./structureCommands";

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

const A4 = { width: 11906, height: 16838, orientation: "portrait" as const, margins: { top: 1440, right: 1440, bottom: 1440, left: 1440, header: 708, footer: 708 } };
const LANDSCAPE = { ...A4, width: 16838, height: 11906, orientation: "landscape" as const };
const section = (id: number, extra: Partial<Section> = {}): Section => ({ id, page: A4, kind: "nextPage", titlePage: false, ...extra });
const hfPara = (id: number, text: string, page = false) => para(id, page ? [run(text), field({ kind: "page" }, "1")] : text);

const ctx = (over: Partial<FieldContext> = {}): FieldContext => ({
  pageAt: () => null,
  pages: () => null,
  fileName: () => "Report.docx",
  now: () => new Date(2026, 9, 15, 9, 5, 7),
  locale: () => "en",
  ...over,
});

function openWith(doc: Document, sections: Section[] = [], fields: FieldContext = ctx()): Editor {
  const ext = Extension.create({ name: "testStructure", addProseMirrorPlugins: () => [structurePlugin({ sections: () => sections, fields })] });
  return (editor = makeEditor(doc, [Tagger, ext]));
}

describe("numbers", () => {
  it("formatNumber: decimal, roman, letters", () => {
    expect([formatNumber(4, "decimal"), formatNumber(4, "lowerRoman"), formatNumber(14, "upperRoman"), formatNumber(28, "lowerLetter"), formatNumber(3, "upperLetter")]).toEqual(
      ["4", "iv", "XIV", "bb", "C"],
    );
  });

  it("noteNumbers: footnotes 1, 2 and endnotes i, ii in reference order", () => {
    const e = openWith(structureDoc());
    expect([...noteNumbers(e.state.doc)]).toEqual([[2, "1"], [1, "2"], [3, "i"]]);
  });

  it("formatDateTime: Word pictures with quoted text", () => {
    const d = new Date(2026, 9, 15, 14, 5, 7);
    expect(formatDateTime(d, "d.M.yyyy")).toBe("15.10.2026");
    expect(formatDateTime(d, "dd/MM/yy HH:mm")).toBe("15/10/26 14:05");
    expect(formatDateTime(d, "h:mm AM/PM")).toBe("2:05 PM");
    expect(formatDateTime(d, "d MMMM yyyy", "en")).toBe("15 October 2026");
    expect(formatDateTime(d, "'Day' d")).toBe("Day 15");
    expect(formatDateTime(d, "dd\\.MM\\.yyyy")).toBe("15.10.2026");
  });
});

describe("structure decorations", () => {
  it("references and notes show their numbers; the notes area has foot/end separators and labels", () => {
    const e = openWith(structureDoc());
    const dom = e.view.dom;
    expect(Array.from(dom.querySelectorAll("sup.note-ref"), (x) => x.getAttribute("data-n"))).toEqual(["1", "2", "i"]);
    expect(Array.from(dom.querySelectorAll(".notes-area .note-label"), (x) => x.textContent)).toEqual(["1", "2", "i"]);
    expect(Array.from(dom.querySelectorAll(".notes-separator"), (x) => x.textContent)).toEqual(["Footnotes", "Endnotes"]);
  });

  it("a section end shows the kind of the next section", () => {
    const e = openWith(structureDoc(), [section(1), section(2, { kind: "continuous" })]);
    const p = e.view.dom.querySelector("[data-section-end='1']")!;
    expect(p.getAttribute("data-section-label")).toBe("Section break (Continuous)");
    expect(p.getAttribute("data-section-next")).toBe("continuous");
  });

  it("fields show live values where known, else the cached result", () => {
    const e = openWith(structureDoc(), [], ctx({ pageAt: () => "7", pages: () => 9 }));
    const live = (kind: string) => e.view.dom.querySelector(`.field[data-field=${kind}]`)!.getAttribute("data-live");
    expect(live("page")).toBe("7");
    expect(live("numPages")).toBe("9");
    expect(live("fileName")).toBe("Report.docx");
    expect(live("date")).toBeNull(); // 15.10.2026 = cached
  });

  it("updateFieldsCommand lists the fields whose live value differs", () => {
    const e = openWith(structureDoc(), [], ctx({ pageAt: () => "2", pages: () => 3 }));
    expect(updateFieldsCommand(e.state, ctx({ pageAt: () => "2", pages: () => 3 }))).toEqual({
      type: "updateFields",
      values: [[3, 5, "2"], [5, 2, "Report.docx"]],
    });
    const none = ctx({ pageAt: () => "1", pages: () => 3, fileName: () => "x.docx" });
    expect(updateFieldsCommand(e.state, none)).toBeNull();
  });

  it("fieldValue: author and unknown pages keep the cached value", () => {
    const st = {} as EditorState;
    expect(fieldValue({ kind: "author" }, 0, st, ctx())).toBeNull();
    expect(fieldValue({ kind: "page" }, 0, st, ctx())).toBeNull();
    expect(fieldValue({ kind: "time", value: { format: "HH:mm:ss" } }, 0, st, ctx())).toBe("09:05:07");
  });
});

describe("navigation", () => {
  it("double-click targets: reference → note, note → reference", () => {
    const e = openWith(structureDoc());
    expect(goToNote(e.view, 1)).toBe(true);
    expect(e.state.selection.$from.parent.attrs.id).toBe(10);
    expect(goToRef(e.view, 1)).toBe(true);
    expect(e.state.selection.$from.parent.attrs.id).toBe(4);
    expect(goToNote(e.view, 99)).toBe(false);
  });

  it("next/previous footnote move between references", () => {
    const e = openWith(structureDoc());
    e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, 1)));
    expect(goToNextRef(e.view, 1)).toBe(true);
    const first = e.state.selection.from;
    expect(goToNextRef(e.view, 1)).toBe(true);
    expect(e.state.selection.from).toBeGreaterThan(first);
    expect(goToNextRef(e.view, 1)).toBe(false);
    expect(goToNextRef(e.view, -1)).toBe(true);
    expect(e.state.selection.from).toBe(first);
  });

  it("clicking a TOC entry puts the caret into its heading", () => {
    const e = openWith(structureDoc());
    const entry = e.view.dom.querySelector<HTMLElement>(".toc-entry[data-target='4']")!;
    entry.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(e.state.selection.$from.parent.attrs.id).toBe(4);
  });
});

describe("section pagination", () => {
  it("computeBreaks: per-page heights and footnote room", () => {
    const blocks = [
      { top: 0, bottom: 300, breakAfter: false, notes: 0 },
      { top: 300, bottom: 600, breakAfter: false, notes: 150 },
      { top: 600, bottom: 800, breakAfter: false },
    ];
    // 800 px pages: block 2 no longer fits with the footnote of block 1.
    expect(computeBreaks(blocks, 800).breaks.map((b) => b.index)).toEqual([2]);
    expect(computeBreaks(blocks.map((b) => ({ ...b, notes: 0 })), 800).breaks).toEqual([]);
    // The page starting at block 1 is short.
    expect(computeBreaks(blocks.map((b) => ({ ...b, notes: 0 })), (i) => (i === 0 ? 300 : 1000)).breaks.map((b) => b.index)).toEqual([1]);
  });

  it("sectionLayout: blocks per section, a break after next-page section ends only", () => {
    const doc = makeDoc([para(1, "a", { sectionEnd: 1 }), para(2, "b", { sectionEnd: 2 }), para(3, "c")]);
    const e = openWith(doc);
    const sections = [section(1), section(2, { kind: "nextPage", page: LANDSCAPE }), section(3, { kind: "continuous" })];
    expect(sectionLayout(e.state.doc, sections)).toEqual({ section: [0, 1, 2], breakAfter: [true, false, false] });
  });

  it("pageInfos: restarts and formats per section", () => {
    const sections = [section(1, { pageNumberFormat: "lowerRoman" }), section(2, { pageNumberStart: 1 })];
    const infos = pageInfos([0, 2, 5, 7], (b) => (b < 5 ? 0 : 1), sections);
    expect(infos.map((p) => p.number)).toEqual(["i", "ii", "1", "2"]);
    expect(infos.map((p) => p.first)).toEqual([true, false, true, false]);
  });

  it("pageHfText: first-page header, inheritance and page fields", () => {
    const sections = [
      section(1, { titlePage: true, headers: { default: [hfPara(20, "Body ", true)], first: [hfPara(21, "Cover")] } }),
      section(2),
    ];
    const info = (s: number, first: boolean, value: number) => ({ section: s, first, value, number: String(value) });
    expect(pageHfText(info(0, true, 1), 3, false, sections, null)).toBe("Cover");
    expect(pageHfText(info(0, false, 2), 3, false, sections, null)).toBe("Body 2");
    expect(pageHfText(info(1, true, 3), 3, false, sections, null)).toBe("Body 3");
    expect(sectionHf(sections, 1, true, "default")).toBeNull();
    expect(blocksText([para(1, [run("Page "), field({ kind: "page" }, "1"), run(" of "), field({ kind: "numPages" }, "1")])])).toBe("Page {PAGE} of {NUMPAGES}");
  });

  it("computeLayout: node pages and the frame's first header / last footer", () => {
    const doc = makeDoc([para(1, "a", { sectionEnd: 1 }), para(2, "b")]);
    const e = openWith(doc);
    const sections = [section(1, { headers: { default: [hfPara(20, "Head")] } }), section(2, { footers: { default: [hfPara(21, "Page ", true)] }, pageNumberStart: 5 })];
    const breaks: PageBreak[] = [{ index: 1, fill: 100 }];
    const layout = computeLayout(e.state.doc, breaks, sections, null);
    expect(layout.nodePage).toEqual([0, 1]);
    expect(layout.pages.map((p) => p.number)).toEqual(["1", "5"]);
    expect(layout.firstHeader).toBe("Head");
    expect(layout.lastFooter).toBe("Page 5");
  });

  it("currentSection: the section ending at or after the caret", () => {
    const doc = makeDoc([para(1, "a"), para(2, "b", { sectionEnd: 1 }), para(3, "c")]);
    const e = openWith(doc);
    const sections = [section(1), section(2)];
    select(e, 1, 0);
    expect(currentSection(e.state, sections)?.id).toBe(1);
    select(e, 3, 0);
    expect(currentSection(e.state, sections)?.id).toBe(2);
    expect(currentSection(e.state, [])).toBeNull();
  });
});

describe("notes area rendering in the editor", () => {
  it("note paragraphs are editable textblocks with ids", () => {
    const doc = makeDoc([para(1, [run("x"), noteRef(1)]), li(2, "item", 2, 0)]);
    doc.notes = [note(1, "foot", [para(5, " text")])];
    const e = openWith(doc);
    expect(findPos(e.state.doc, 5)).toBeGreaterThan(0);
    select(e, 5, 5);
    e.view.dispatch(e.state.tr.insertText("!"));
    expect(e.view.dom.querySelector(".note")!.textContent).toContain("text!");
    expect(posOf(e, 5, 0)).toBeGreaterThan(posOf(e, 2, 0));
  });

  it("a TOC without entries shows a hint", () => {
    const e = openWith(makeDoc([toc(1, []), para(2, "")]));
    expect(e.view.dom.querySelector(".toc-empty")!.textContent).toContain("No headings");
  });
});
