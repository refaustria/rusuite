// P8-27: Layout › Columns math and commands, symbols, the font box
// resolution and the flow options of the print-layout pagination.

import { afterEach, describe, expect, it } from "vitest";
import type { Editor } from "@tiptap/core";
import type { Section } from "../generated/Section";
import { makeDoc, para, run } from "../test/fixtures";
import { makeEditor, select, Tagger } from "../test/harness";
import {
  columnLayout, columnsCommand, columnsForm, formColumns, presetColumns, presetOf, rulerSegments, withCount, withWidth, DEFAULT_SPACING,
} from "./columns";
import {
  charCode, fromCharCode, gallerySymbols, recentSymbols, rememberSymbol, searchSymbols, specialGlyph, subsetOf, symbolName, SYMBOL_SUBSETS,
} from "./symbols";
import { fontBoxValue, fontName, resolvedRunAt } from "./fontBox";
import { computeBreaks } from "./pagination";
import type { StyleSheet } from "../generated/StyleSheet";
import { toPM } from "../sync/toPM";
import { writeSchema } from "../sync/schema";
import { countDocWords } from "../wordCount";

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

const A4 = { width: 11906, height: 16838, orientation: "portrait" as const, margins: { top: 1440, right: 1440, bottom: 1440, left: 1440, header: 708, footer: 708 } };
const CONTENT = 9026;

describe("columns", () => {
  it("columnLayout: equal columns share what the spacing leaves; unequal ones scale to the text width", () => {
    expect(columnLayout({ count: 2, equal: true }, CONTENT)).toEqual([{ width: 4153, space: 720 }, { width: 4153, space: 0 }]);
    expect(columnLayout({ count: 3, equal: true, spacing: 567 }, CONTENT).map((c) => c.width)).toEqual([2630, 2630, 2630]);
    const u = columnLayout({ count: 2, equal: false, widths: [{ width: 1000, space: 500 }, { width: 3000, space: 0 }] }, 9000);
    expect(u).toEqual([{ width: 2000, space: 1000 }, { width: 6000, space: 0 }]);
  });

  it("presets: One / Two / Three, Left and Right narrow-wide; presetOf recognises them", () => {
    expect(presetColumns("two", CONTENT)).toEqual({ count: 2, equal: true });
    const left = presetColumns("left", CONTENT);
    expect(left.equal).toBe(false);
    expect(left.widths![0]!.width).toBeLessThan(left.widths![1]!.width);
    expect(left.widths!.reduce((s, w) => s + w.width + w.space, 0)).toBe(CONTENT);
    const right = presetColumns("right", CONTENT);
    expect(right.widths![0]!.width).toBeGreaterThan(right.widths![1]!.width);
    expect(presetOf(left, CONTENT)).toBe("left");
    expect(presetOf(right, CONTENT)).toBe("right");
    expect(presetOf(null, CONTENT)).toBe("one");
    expect(presetOf({ count: 3, equal: true }, CONTENT)).toBe("three");
    expect(presetOf({ count: 4, equal: true }, CONTENT)).toBeNull();
  });

  it("the More Columns form: count resets to equal widths; widths and spacing follow Word", () => {
    let f = columnsForm({ count: 1, equal: true }, CONTENT);
    f = withCount(f, 3, CONTENT);
    expect(f.widths.map((w) => w.width)).toEqual([2528, 2528, 2528]);
    f = withWidth(f, 0, { space: 1000 }, CONTENT);
    expect(f.widths[0]).toEqual({ width: 2342, space: 1000 });
    f = { ...f, equal: false };
    f = withWidth(f, 0, { width: 2000 }, CONTENT);
    expect(f.widths[2]!.width).toBe(CONTENT - 2000 - 1000 - 2342 - 1000);
    expect(formColumns({ ...f, separator: true })).toMatchObject({ count: 3, equal: false, separator: true });
    expect(formColumns(withCount(f, 2, CONTENT))).toEqual({ count: 2, equal: true, spacing: 1000 });
    expect(formColumns(withCount(f, 1, CONTENT))).toEqual({ count: 1, equal: true });
  });

  it("columnsCommand: this section, the whole document, this point forward (a continuous break first)", () => {
    const sections: Section[] = [
      { id: 1, page: A4, kind: "nextPage", titlePage: false },
      { id: 2, page: A4, kind: "continuous", titlePage: false },
    ];
    const doc = makeDoc([para(1, "a", { sectionEnd: 1 }), para(2, "bc")]);
    const e = (editor = makeEditor(doc, [Tagger]));
    select(e, 2, 1);
    const cols = { count: 2, equal: true };
    expect(columnsCommand(e.state, sections, cols, "section")).toEqual({ type: "setSection", section: 2, patch: { columns: cols } });
    expect(columnsCommand(e.state, sections, cols, "whole")).toMatchObject({ type: "compound", commands: [{ section: 1 }, { section: 2 }] });
    const fwd = columnsCommand(e.state, sections, cols, "forward") as { type: "compound"; commands: { type: string }[] };
    expect(fwd.commands.map((c) => c.type)).toEqual(["splitParagraph", "insertSectionBreak", "setSection"]);
    expect(fwd.commands[1]).toMatchObject({ block: 2, kind: "continuous" });
  });

  it("the word count includes the paragraphs of a multi-column section box", () => {
    const doc = makeDoc([para(1, "one two", { sectionEnd: 1 }), para(2, "three four five"), para(3, "six")]);
    doc.sections = [
      { id: 1, page: A4, kind: "nextPage", titlePage: false },
      { id: 2, page: A4, kind: "continuous", titlePage: false, columns: { count: 2, equal: true } },
    ];
    const pm = toPM(doc, writeSchema());
    expect(pm.child(1).type.name).toBe("columns");
    expect(countDocWords(pm)).toBe(6);
  });

  it("rulerSegments: one per column with the gaps between", () => {
    expect(rulerSegments(null, 9000)).toEqual([[0, 600]]);
    expect(rulerSegments({ count: 2, equal: true, spacing: 1500 }, 9000)).toEqual([[0, 250], [350, 600]]);
    expect(DEFAULT_SPACING).toBe(720);
  });
});

describe("symbols", () => {
  it("subsets: Greek letters, Latin-1 without the soft hyphen, currencies with the euro", () => {
    const greek = SYMBOL_SUBSETS.find((s) => s.id === "greek")!;
    expect(greek.chars.length).toBe(49);
    expect(SYMBOL_SUBSETS.find((s) => s.id === "latin1")!.chars).not.toContain("­");
    expect(SYMBOL_SUBSETS.find((s) => s.id === "currency")!.chars).toContain("€");
    expect(subsetOf("→")?.id).toBe("arrows");
    expect(subsetOf("\u0001")).toBeNull();
  });

  it("names and codes: lookup, generic names, hex codes both ways", () => {
    expect(symbolName("€")).toBe("euro sign");
    expect(symbolName("Ω")).toBe("greek capital letter omega");
    expect(symbolName("─")).toBe("box drawings");
    expect(charCode("€")).toBe("20AC");
    expect(charCode("😀")).toBe("1F600");
    expect(fromCharCode("20ac")).toBe("€");
    expect(fromCharCode("U+00A9")).toBe("©");
    expect(fromCharCode("D800")).toBeNull();
    expect(fromCharCode("zz")).toBeNull();
  });

  it("search by name (all words) or by code", () => {
    expect(searchSymbols("euro")).toEqual(["€"]);
    expect(searchSymbols("right arrow").slice(0, 2)).toContain("→");
    expect(searchSymbols("2122")[0]).toBe("™");
    expect(searchSymbols("")).toEqual([]);
  });

  it("recently used symbols come first in the gallery (this browser only)", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    expect(recentSymbols(storage)).toEqual([]);
    rememberSymbol("Ω", storage);
    rememberSymbol("→", storage);
    rememberSymbol("Ω", storage);
    expect(recentSymbols(storage)).toEqual(["Ω", "→"]);
    const g = gallerySymbols(recentSymbols(storage));
    expect(g.slice(0, 3)).toEqual(["Ω", "→", "€"]);
    expect(g.length).toBe(20);
    expect(recentSymbols({ getItem: () => "not json" })).toEqual([]);
    expect(specialGlyph(" ")).toBe("°");
    expect(specialGlyph("—")).toBe("—");
  });
});

describe("the font box", () => {
  it("shows the resolved font and size: the style chain and the theme fonts", () => {
    const doc = makeDoc([
      para(1, "plain"),
      { kind: "paragraph", value: { id: 2, props: { style: "Heading1" }, inlines: [run("Heading")] } },
      para(3, [run("big", { size: 2400, font: { kind: "named", value: "Arial" } })]),
      para(4, [{ kind: "run", value: { text: "link", style: "Hyperlink" } }]),
    ]);
    const e = (editor = makeEditor(doc, [Tagger]));
    const sheet = doc.styles as StyleSheet;
    select(e, 1, 2);
    expect(fontBoxValue(e.state, sheet)).toEqual({ font: { kind: "named", value: "Calibri" }, size: 1100 });
    select(e, 2, 2);
    expect(fontBoxValue(e.state, sheet)).toEqual({ font: { kind: "named", value: "Calibri Light" }, size: 1600 });
    select(e, 3, 2);
    expect(fontBoxValue(e.state, sheet)).toEqual({ font: { kind: "named", value: "Arial" }, size: 2400 });
    select(e, 4, 2);
    expect(resolvedRunAt(e.state, sheet).underline).toBe("single");
    expect(fontName({ kind: "theme", value: "majorLatin" })).toBe("Calibri Light");
    expect(fontName(null)).toBeNull();
  });
});

describe("flow options in print layout", () => {
  const box = (top: number, h: number, extra: object = {}) => ({ top, bottom: top + h, breakAfter: false, ...extra });

  it("page break before starts a new page", () => {
    const { breaks } = computeBreaks([box(0, 100), box(100, 100, { breakBefore: true }), box(200, 100)], 1000);
    expect(breaks.map((b) => b.index)).toEqual([1]);
  });

  it("keep with next moves a heading to the next page with its paragraph", () => {
    const blocks = [box(0, 700), box(700, 100, { keepNext: true }), box(800, 300)];
    expect(computeBreaks(blocks, 1000).breaks.map((b) => b.index)).toEqual([1]);
    // Without keep with next the heading stays at the bottom of page 1.
    expect(computeBreaks([box(0, 700), box(700, 100), box(800, 300)], 1000).breaks.map((b) => b.index)).toEqual([2]);
    // A chain that would empty the page does not move.
    expect(computeBreaks([box(0, 600, { keepNext: true }), box(600, 600)], 1000).breaks.map((b) => b.index)).toEqual([1]);
  });
});
