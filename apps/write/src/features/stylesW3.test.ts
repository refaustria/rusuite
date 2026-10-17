// P9-W3: toggle semantics between styles and direct formatting, style sets,
// Manage Styles lists and commands, Reveal Formatting, property fields and
// the template helpers.
import { afterEach, describe, expect, it } from "vitest";
import type { Editor } from "@tiptap/core";
import type { StyleSet } from "../generated/StyleSet";
import type { StyleSheet } from "../generated/StyleSheet";
import { propsFromMarks } from "../sync/fromPM";
import { makeDoc, para, run } from "../test/fixtures";
import { makeEditor, select } from "../test/harness";
import { applyCharacterStyle, styleSheetCss } from "./styleCss";
import { applyRunEach, switchRun, toggleRun } from "./wordKeys";
import { currentParagraphSpacing, currentSetId, paragraphSpacingCommand, withStyleSet } from "./styleSets";
import { docProperty, fieldValue, type FieldContext } from "./structure";
import { manageStylesList, priorityCommand, setDefaultsCommand, defaultsForm, visibilityCommand, visibilityOf } from "../ui/manageStyles";
import { revealFormatting, sourceLabel } from "../ui/revealFormatting";
import { saveAsName, templateFile, templateUrl } from "../ui/templatesUi";
import { levelSample } from "../ui/styleDialogs";

let editor: Editor | null = null;
afterEach(() => editor?.destroy());
const open = (...body: Parameters<typeof makeDoc>[0]) => (editor = makeEditor(makeDoc(body)));

const sheet: StyleSheet = {
  defaults: { run: { size: 1100, font: { kind: "theme", value: "minorLatin" } }, paragraph: { spacing: { after: 160, line: { kind: "multiple", value: 1.08 } } } },
  styles: [
    { id: "Normal", name: "Normal", kind: "paragraph", isDefault: true, quickFormat: true },
    { id: "Heading1", name: "heading 1", kind: "linked", link: "Heading1Char", basedOn: "Normal", quickFormat: true, priority: 9, run: { bold: true, size: 1600 }, paragraph: { outlineLevel: 0 } },
    { id: "Heading1Char", name: "Heading 1 Char", kind: "character", link: "Heading1", run: { bold: true, size: 1600 } },
    { id: "Strong", name: "Strong", kind: "character", quickFormat: true, priority: 22, run: { bold: true } },
    { id: "Quote", name: "Quote", kind: "paragraph", basedOn: "Normal", quickFormat: true, priority: 29, run: { italic: true, font: { kind: "named", value: "Georgia" } } },
    { id: "Secret", name: "Secret", kind: "paragraph", basedOn: "Normal", hidden: true, custom: true },
    { id: "Later", name: "Later", kind: "paragraph", basedOn: "Normal", semiHidden: true, priority: 99 },
  ],
} as StyleSheet;

describe("Word's toggle properties (P9-W3)", () => {
  it("a character style switches what the paragraph style has on; a false in it leaves the value", () => {
    expect(applyCharacterStyle({ bold: true, italic: false }, { bold: true, italic: true })).toEqual({ bold: false, italic: true });
    expect(applyCharacterStyle({ smallCaps: true }, { smallCaps: false, size: 900 })).toEqual({ smallCaps: true, size: 900 });
  });

  it("the style sheet CSS turns Strong off inside a bold heading", () => {
    const css = styleSheetCss(sheet);
    expect(css).toMatch(/h1 span\[data-cstyle="Strong"\][^{]*\{ font-weight: 400; \}/);
  });

  it("Ctrl+B in a bold heading writes an explicit off; again: the style's bold back", () => {
    const e = open(para(1, "Title", { style: "Heading1" }));
    select(e, 1, 0, 1, 5);
    toggleRun(e, sheet, "bold");
    expect(propsFromMarks(e.state.doc.child(0).child(0).marks)).toEqual({ bold: false });
    select(e, 1, 0, 1, 5);
    toggleRun(e, sheet, "bold");
    expect(propsFromMarks(e.state.doc.child(0).child(0).marks)).toEqual({});
  });

  it("underline in an underlined style becomes underline none; a forced state is kept", () => {
    const u = { key: "underline" as const, on: "single", off: "none", isOn: (v: unknown) => v != null && v !== "none" };
    expect(switchRun({}, { underline: "single" }, u, false)).toEqual({ underline: "none" });
    expect(switchRun({}, {}, u, true)).toEqual({ underline: "single" });
    const e = open(para(1, [run("ab", { bold: true })]));
    select(e, 1, 0, 1, 2);
    toggleRun(e, sheet, "bold", true);
    expect(propsFromMarks(e.state.doc.child(0).child(0).marks)).toEqual({ bold: true });
  });

  it("applyRunEach hands every run its inherited formatting", () => {
    const e = open(para(1, [run("a"), run("b", { italic: true })], { style: "Quote" }));
    select(e, 1, 0, 1, 2);
    const seen: boolean[] = [];
    applyRunEach(e, sheet, (direct, inherited) => {
      seen.push(!!inherited.italic);
      return direct;
    });
    expect(seen).toEqual([true, true]);
  });
});

describe("style sets", () => {
  const set: StyleSet = {
    id: "shaded",
    defaults: { run: { size: 1100 }, paragraph: { spacing: { after: 200 } } },
    styles: [{ id: "Heading1", name: "heading 1", paragraph: { shading: { kind: "theme", value: { slot: "accent1", tint: 0 } } }, run: { allCaps: true, size: 1400 } }],
  };

  it("withStyleSet replaces the defaults and the listed styles' formatting", () => {
    const s = withStyleSet(sheet, set);
    expect(s.defaults).toEqual(set.defaults);
    const h1 = s.styles.find((x) => x.id === "Heading1")!;
    expect(h1.run).toEqual({ allCaps: true, size: 1400 });
    expect(h1.kind).toBe("linked");
    expect(sheet.styles.find((x) => x.id === "Heading1")!.run?.bold).toBe(true);
  });

  it("the gallery marks the set the document matches", () => {
    expect(currentSetId(withStyleSet(sheet, set), [set])).toBe("shaded");
    expect(currentSetId(sheet, [set])).toBeNull();
  });

  it("Paragraph Spacing presets set the document defaults", () => {
    expect(paragraphSpacingCommand("open")).toEqual({ type: "setStyleDefaults", paragraph: { spacing: { before: 0, after: 200, line: { kind: "multiple", value: 1.15 } } } });
    expect(currentParagraphSpacing({ ...sheet, defaults: { run: {}, paragraph: { spacing: { after: 0, line: { kind: "multiple", value: 1 } } } } } as StyleSheet)).toBe("none");
    expect(currentParagraphSpacing(sheet)).toBeNull();
  });
});

describe("Manage Styles", () => {
  const inUse = new Map([["Normal", 3]]);

  it("Recommended leaves hidden and semi-hidden styles out, All lists them; the linked halves never", () => {
    const ids = (f: "recommended" | "inUse" | "all") => manageStylesList(sheet, f, "alphabetical", inUse).map((s) => s.id);
    expect(ids("recommended")).toEqual(["Heading1", "Normal", "Quote", "Strong"]);
    expect(ids("all")).toEqual(["Heading1", "Later", "Normal", "Quote", "Secret", "Strong"]);
    expect(ids("inUse")).toEqual(["Normal"]);
  });

  it("sorts as recommended (priority), by font and by type", () => {
    expect(manageStylesList(sheet, "recommended", "recommended", inUse).map((s) => s.id)).toEqual(["Normal", "Heading1", "Strong", "Quote"]);
    expect(manageStylesList(sheet, "recommended", "font", inUse)[0]!.id).toBe("Heading1");
    expect(manageStylesList(sheet, "recommended", "font", inUse).at(-1)!.id).toBe("Quote");
    expect(manageStylesList(sheet, "recommended", "type", inUse).map((s) => s.kind)).toEqual(["paragraph", "paragraph", "linked", "character"]);
  });

  it("Recommend: show / hide until used / hide and Assign Value", () => {
    expect(visibilityOf(sheet.styles[5]!)).toBe("hide");
    expect(visibilityOf(sheet.styles[6]!)).toBe("hideUntilUsed");
    expect(visibilityCommand("Later", "show")).toEqual({ type: "updateStyle", id: "Later", patch: { hidden: false, semiHidden: false } });
    expect(visibilityCommand("Quote", "hideUntilUsed")).toEqual({ type: "updateStyle", id: "Quote", patch: { hidden: false, semiHidden: true } });
    expect(priorityCommand("Quote", 3)).toEqual({ type: "updateStyle", id: "Quote", patch: { priority: 3 } });
    expect(priorityCommand("Quote", 120)).toBeNull();
  });

  it("Set Defaults sends only what changed", () => {
    const before = defaultsForm(sheet);
    expect(before).toEqual({ font: "+minor", size: "11", before: "0", after: "8", line: "1.08" });
    expect(setDefaultsCommand(before, before)).toBeNull();
    expect(setDefaultsCommand(before, { ...before, font: "Georgia", after: "6" })).toEqual({
      type: "setStyleDefaults",
      run: { font: { kind: "named", value: "Georgia" } },
      paragraph: { spacing: { after: 120 } },
    });
  });
});

describe("Reveal Formatting", () => {
  it("lists the font and paragraph in effect with their sources", () => {
    const e = open(para(1, [run("Title", { italic: true })], { style: "Heading1" }));
    select(e, 1, 2);
    const [font, paragraph, section] = revealFormatting(e.state, sheet, { width: 11906, height: 16838, margins: { top: 1440, right: 1440, bottom: 1440, left: 1440, header: 720, footer: 720 }, orientation: "portrait" });
    const item = (list: typeof font, key: string) => list!.items.find((i) => i.key === key);
    expect(item(font, "size")).toMatchObject({ value: "16 pt", source: "Heading 1" });
    expect(item(font, "bold")).toMatchObject({ source: "Heading 1" });
    expect(item(font, "italic")).toMatchObject({ source: "direct" });
    expect(item(font, "font")).toMatchObject({ value: "Calibri", source: "defaults" });
    expect(item(paragraph, "style")!.value).toBe("Heading 1");
    expect(item(paragraph, "outlineLevel")!.value).toBe("Level 1");
    expect(item(section, "paper")!.value).toBe("21 × 29.7 cm");
    expect(sourceLabel("direct")).toBe("Direct formatting");
    expect(sourceLabel("defaults")).toBe("Document defaults");
  });
});

describe("property fields and templates", () => {
  const ctx = (props: Record<string, string>): FieldContext =>
    ({ pageAt: () => null, pages: () => null, fileName: () => null, now: () => new Date(0), locale: () => "en", properties: () => props }) as unknown as FieldContext;

  it("SUBJECT, KEYWORDS, COMMENTS, LASTSAVEDBY, DOCPROPERTY and SAVEDATE take the properties", () => {
    const e = open(para(1, "x"));
    const c = ctx({ subject: "Budget", keywords: "q3", description: "Draft", lastModifiedBy: "Ann", company: "ACME", modified: "2026-10-17T09:30:00Z" });
    const v = (kind: Parameters<typeof fieldValue>[0]) => fieldValue(kind, 1, e.state, c);
    expect([v({ kind: "subject" }), v({ kind: "keywords" }), v({ kind: "comments" }), v({ kind: "lastSavedBy" })]).toEqual(["Budget", "q3", "Draft", "Ann"]);
    expect(v({ kind: "docProperty", value: { name: "Company" } })).toBe("ACME");
    expect(v({ kind: "saveDate", value: { format: "yyyy-MM-dd" } })).toBe("2026-10-17");
    expect(docProperty({ title: "T" }, "TITLE")).toBe("T");
    expect(docProperty({}, "Manager")).toBeNull();
  });

  it("template files by language, Save As names by type", () => {
    expect(templateFile("memo", "de-AT")).toBe("memo.de.dotx");
    expect(templateFile("memo", "en")).toBe("memo.dotx");
    expect(templateUrl("report", "en", "/write/")).toBe("/write/templates/report.dotx");
    expect(saveAsName("Plan", true)).toBe("Plan.dotx");
    expect(saveAsName("Plan.docx", true)).toBe("Plan.dotx");
    expect(saveAsName("Plan.dotx", false)).toBe("Plan.docx");
    expect(saveAsName("Plan", false)).toBe("Plan.docx");
  });

  it("the Numbering… dialog shows each level's own label", () => {
    const numbering = {
      defs: [{ id: 3, levels: [{ kind: "decimal", text: "%1." }, { kind: "decimal", text: "%1.%2." }, { kind: "lowerLetter", text: "%3)" }] }],
    } as never;
    expect(levelSample(numbering, 3, 0)).toBe("1.");
    expect(levelSample(numbering, 3, 1)).toBe("1.1.");
    expect(levelSample(numbering, 3, 2)).toBe("a)");
    expect(levelSample(numbering, 9, 0)).toBe("");
  });
});
