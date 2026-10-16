// P8-21: style resolution, CSS, gallery / pane lists, style commands, the
// charStyle mark mapping and the find-format helpers.
import { afterEach, describe, expect, it } from "vitest";
import type { Editor } from "@tiptap/core";
import type { Style } from "../generated/Style";
import type { StyleSheet } from "../generated/StyleSheet";
import type { Document } from "../generated/Document";
import { makeDoc, para, run } from "../test/fixtures";
import { change, makeEditor, select, type } from "../test/harness";
import { fromPM } from "../sync/fromPM";
import { toPM } from "../sync/toPM";
import { writeSchema } from "../sync/schema";
import {
  displayName, findStyleByName, galleryStyles, paneStyles, paragraphSelectors, previewStyle, resolveCharacter, resolveParagraph, resolveRun, runCss,
  styleChain, styleSheetCss, stylesInUse, uniqueStyleId,
} from "./styleCss";
import {
  applyStyleAction, characterStyleCommand, createStyleFromSelectionCommand, modifyStyleCommand, newStyleCommand, newStyleValues, paragraphChanges,
  runChanges, selectionRanges, styleFormValues, wordAtCaret,
} from "./styleCommands";
import { formatCommands, formatSummary, isEmptyFormat, paragraphDiff } from "../ui/FindBar";
import { headingsOf, outlineLevel } from "../ui/stylesPane";
import template from "../test/newDocument.json";

const sheet = (): StyleSheet => structuredClone((template as unknown as Document).styles);
const withStyles = (...extra: Style[]): StyleSheet => {
  const s = sheet();
  s.styles.push(...extra);
  return s;
};
const custom = (id: string, kind: Style["kind"], extra: Partial<Style> = {}): Style => ({
  id, name: id, kind, basedOn: kind === "character" ? "DefaultParagraphFont" : "Normal", custom: true, quickFormat: true, priority: 1, ...extra,
});

let editor: Editor | null = null;
afterEach(() => editor?.destroy());

describe("style resolution (mirror of StyleSheet)", () => {
  it("resolves defaults → based-on chain for paragraph and run formatting", () => {
    const s = sheet();
    expect(styleChain(s, "Heading2").map((x) => x.id)).toEqual(["Normal", "Heading2"]);
    const r = resolveRun(s, "Heading1");
    expect(r.size).toBe(1600);
    expect(r.font).toEqual({ kind: "theme", value: "majorLatin" });
    expect(resolveRun(s, "Normal").size).toBe(1100);
    const p = resolveParagraph(s, "Heading1");
    expect(p.spacing).toEqual(expect.objectContaining({ before: 240, after: 0 }));
    expect(p.keepNext).toBe(true);
    expect(resolveParagraph(s, "Quote").alignment).toBe("center");
  });

  it("character styles add their chain only; a linked style resolves through its character half", () => {
    const s = withStyles(custom("Red", "character", { basedOn: "Strong", run: { color: { kind: "rgb", value: "FF0000" } } }));
    expect(resolveCharacter(s, "Red")).toEqual({ bold: true, color: { kind: "rgb", value: "FF0000" } });
    expect(resolveCharacter(s, "Heading1").size).toBe(1600);
    expect(resolveCharacter(s, "Strong").size).toBeUndefined();
  });

  it("cuts based-on cycles", () => {
    const s = withStyles(custom("A", "paragraph", { basedOn: "B" }), custom("B", "paragraph", { basedOn: "A" }));
    expect(styleChain(s, "A").map((x) => x.id)).toEqual(["B", "A"]);
  });
});

describe("style sheet CSS", () => {
  it("one rule per paragraph style with the heading and default selectors", () => {
    const css = styleSheetCss(sheet());
    expect(css).toContain('.tiptap-content p[data-style="Heading1"], .tiptap-content h1 {');
    expect(css).toMatch(/\.tiptap-content p:not\(\[data-style\]\):not\(\.doc-title\) \{[^}]*margin-bottom: 8pt/);
    expect(css).toMatch(/h1 \{[^}]*font-size: 16pt[^}]*color: #2F5597/i);
    expect(css).toContain('.tiptap-content span[data-cstyle="Strong"] { font-weight: 700; }');
    expect(css).toMatch(/span\[data-cstyle="Heading1Char"\] \{[^}]*font-size: 16pt/);
    expect(paragraphSelectors("Title", false)).toContain(".tiptap-content .doc-title");
  });

  it("a modified style changes its rule; quotes in ids are escaped", () => {
    const s = sheet();
    s.styles.find((x) => x.id === "Heading1")!.run = { color: { kind: "rgb", value: "C00000" } };
    expect(styleSheetCss(s)).toMatch(/h1 \{[^}]*color: #C00000/);
    expect(paragraphSelectors('a"b', false)[0]).toBe('.tiptap-content p[data-style="a\\"b"]');
  });

  it("run CSS states defaults only for paragraph styles", () => {
    expect(runCss({ italic: true }, false)).toEqual(["font-style: italic"]);
    expect(runCss({}, true)).toEqual(["font-weight: 400", "font-style: normal"]);
    expect(runCss({ underline: "single", strike: true }, false)).toContain("text-decoration: underline line-through");
    expect(runCss({ verticalAlign: "superscript" }, false)).toContain("vertical-align: super");
  });

  it("previews scale big sizes down and keep colour and weight", () => {
    const s = sheet();
    const title = previewStyle(s, s.styles.find((x) => x.id === "Title")!, 16);
    expect(title.fontSize).toBe("16pt");
    const strong = previewStyle(s, s.styles.find((x) => x.id === "Strong")!);
    expect(strong.fontWeight).toBe(700);
    expect(strong.fontSize).toBe("11pt");
  });
});

describe("gallery and Styles pane lists", () => {
  it("the gallery shows Word's quick styles by priority; Heading 3 once Heading 2 is used", () => {
    const s = sheet();
    const ids = galleryStyles(s, new Map()).map((x) => x.id);
    expect(ids.slice(0, 6)).toEqual(["Normal", "NoSpacing", "Heading1", "Heading2", "Title", "Subtitle"]);
    expect(ids).not.toContain("Heading3");
    expect(ids).not.toContain("Heading1Char");
    expect(galleryStyles(s, new Map([["Heading2", 1]])).map((x) => x.id)).toContain("Heading3");
  });

  it("the pane filters Recommended / In use / All", () => {
    const s = withStyles(custom("Memo", "paragraph", { quickFormat: false, priority: undefined }), custom("Secret", "paragraph", { hidden: true }));
    const inUse = new Map([["Normal", 3], ["Memo", 1]]);
    expect(paneStyles(s, "inUse", inUse).map((x) => x.id)).toEqual(["Memo", "Normal"]);
    const rec = paneStyles(s, "recommended", new Map()).map((x) => x.id);
    expect(rec[0]).toBe("Normal");
    expect(rec).toContain("Memo");
    expect(rec).not.toContain("FootnoteReference");
    const all = paneStyles(s, "all", new Map()).map((x) => x.id);
    expect(all).toContain("FootnoteReference");
    expect(all).not.toContain("Secret");
    expect(all).not.toContain("TableGrid");
    expect(all).not.toContain("Heading1Char");
  });

  it("styles in use count paragraph styles (unstyled = Normal) and character marks", () => {
    const s = sheet();
    editor = makeEditor(makeDoc([para(1, "a", { style: "Heading1" }), para(2, [run("x"), { kind: "run", value: { text: "y", style: "Heading1Char" } }])]));
    const used = stylesInUse(editor.state.doc, s);
    expect(used.get("Heading1")).toBe(2);
    expect(used.get("Normal")).toBe(1);
    expect(used.get("Heading1Char")).toBe(1);
  });

  it("display names follow the UI language for built-ins; new ids are unique", () => {
    expect(displayName("heading 3")).toBe("Heading 3");
    expect(displayName("toc 2")).toBe("TOC 2");
    expect(displayName("Heading 1 Char")).toBe("Heading 1 Char");
    expect(displayName("My Style")).toBe("My Style");
    expect(findStyleByName(sheet(), "quote")?.id).toBe("Quote");
    expect(findStyleByName(sheet(), "Heading 1")?.id).toBe("Heading1");
    expect(uniqueStyleId(sheet(), "Normal")).toBe("Normal1");
    expect(uniqueStyleId(sheet(), "My style!")).toBe("Mystyle");
  });

  it("outline levels and the navigation headings", () => {
    const s = withStyles(custom("Chapter", "paragraph", { basedOn: "Heading1" }));
    expect(outlineLevel(s, "Chapter")).toBe(1);
    expect(outlineLevel(s, "Normal")).toBeNull();
    editor = makeEditor(makeDoc([para(1, "One", { style: "Heading1" }), para(2, "body"), para(3, "Two", { style: "Heading2" }), para(4, "Deep", { style: "Heading4" }), para(5, "", { style: "Heading1" })]));
    expect(headingsOf(editor.state.doc, s)).toEqual([
      { id: 1, level: 1, text: "One" },
      { id: 3, level: 2, text: "Two" },
    ]);
  });
});

describe("style commands", () => {
  const open = () => (editor = makeEditor(makeDoc([para(1, "Hello world"), para(2, "Second")])));

  it("a character style applies to the selection, or the word at the caret", () => {
    const e = open();
    select(e, 1, 6, 1, 11);
    expect(applyStyleAction(e.state, sheet(), "Strong")).toEqual({
      kind: "command",
      command: { type: "applyCharacterStyle", block: 1, from: 6, to: 11, style: "Strong" },
    });
    select(e, 1, 2);
    expect(wordAtCaret(e.state)).toEqual({ block: 1, from: 0, to: 5, length: 11 });
    expect(applyStyleAction(e.state, sheet(), "Emphasis")).toMatchObject({ command: { from: 0, to: 5, style: "Emphasis" } });
  });

  it("a linked style formats part of a paragraph as characters, unless linked styles are disabled", () => {
    const e = open();
    select(e, 1, 0, 1, 5);
    expect(applyStyleAction(e.state, sheet(), "Heading1")).toMatchObject({ kind: "command", command: { type: "applyCharacterStyle", style: "Heading1" } });
    expect(applyStyleAction(e.state, sheet(), "Heading1", { linkedDisabled: true })).toEqual({ kind: "paragraph" });
    select(e, 1, 0, 1, 11);
    expect(applyStyleAction(e.state, sheet(), "Heading1")).toEqual({ kind: "paragraph" });
    select(e, 1, 3);
    expect(applyStyleAction(e.state, sheet(), "Quote")).toEqual({ kind: "paragraph" });
  });

  it("selected instances get the paragraph style through SetStyle", () => {
    const e = open();
    expect(applyStyleAction(e.state, sheet(), "Quote", { instances: [1, 2] })).toEqual({ kind: "command", command: { type: "setStyle", blocks: [1, 2], style: "Quote" } });
    expect(applyStyleAction(e.state, sheet(), "Nope")).toEqual({ kind: "none" });
  });

  it("selection ranges over several paragraphs; character style commands skip empty ranges", () => {
    const e = open();
    select(e, 1, 6, 2, 3);
    const ranges = selectionRanges(e.state);
    expect(ranges).toEqual([
      { block: 1, from: 6, to: 11, length: 11 },
      { block: 2, from: 0, to: 3, length: 6 },
    ]);
    expect(characterStyleCommand([...ranges, { block: 3, from: 2, to: 2, length: 4 }], null)).toEqual({
      type: "compound",
      commands: [
        { type: "applyCharacterStyle", block: 1, from: 6, to: 11, style: null },
        { type: "applyCharacterStyle", block: 2, from: 0, to: 3, style: null },
      ],
    });
  });

  it("Create a Style = AddStyle + UpdateStyleFromSelection with a unique id", () => {
    const e = open();
    select(e, 2, 3);
    const made = createStyleFromSelectionCommand(e as never, sheet(), " Normal ", "Quote")!;
    expect(made.id).toBe("Normal1");
    expect(made.command).toMatchObject({
      type: "compound",
      commands: [
        { type: "addStyle", style: { id: "Normal1", name: "Normal", kind: "paragraph", basedOn: "Quote", custom: true, quickFormat: true } },
        { type: "updateStyleFromSelection", id: "Normal1", block: 2, offset: 3 },
      ],
    });
    expect(createStyleFromSelectionCommand(e as never, sheet(), "  ", "Normal")).toBeNull();
  });

  it("Modify Style sends only what changed (a toggle off is an explicit false)", () => {
    const s = sheet();
    const before = styleFormValues(s, "Heading1")!;
    expect(before.run.size).toBe(1600);
    expect(before.next).toBe("Normal");
    const after = { ...before, run: { ...before.run, bold: true, color: { kind: "rgb" as const, value: "C00000" } }, paragraph: { ...before.paragraph, alignment: "center" as const }, autoRedefine: true };
    expect(modifyStyleCommand(s, "Heading1", before, after)).toEqual({
      type: "updateStyle",
      id: "Heading1",
      patch: { run: { bold: true, color: { kind: "rgb", value: "C00000" } }, paragraph: { alignment: "center" }, autoRedefine: true },
    });
    expect(modifyStyleCommand(s, "Heading1", before, before)).toBeNull();
    expect(runChanges({ italic: true, underline: "single" }, {})).toEqual({ italic: false, underline: "none" });
    expect(paragraphChanges({ alignment: "left" }, { alignment: "left", keepNext: true })).toEqual({ keepNext: true });
    const renamed = modifyStyleCommand(s, "Heading1", before, { ...before, name: "Chapter", next: "Heading1", basedOn: "Title" });
    expect(renamed).toEqual({ type: "updateStyle", id: "Heading1", patch: { name: "Chapter", basedOn: "Title", next: "" } });
  });

  it("New Style stores the formatting that differs from its parent", () => {
    const s = sheet();
    const base = newStyleValues(s, "Normal", "paragraph", "Memo");
    const v = { ...base, run: { ...base.run, italic: true }, next: "Heading1" };
    const made = newStyleCommand(s, base, v)!;
    expect(made).toEqual({
      id: "Memo",
      command: {
        type: "addStyle",
        style: { id: "Memo", name: "Memo", kind: "paragraph", basedOn: "Normal", next: "Heading1", run: { italic: true }, paragraph: {}, quickFormat: true, autoRedefine: false, custom: true, priority: 1 },
      },
    });
    expect(newStyleCommand(s, base, { ...v, name: " " })).toBeNull();
  });
});

describe("charStyle mark mapping", () => {
  it("toPM / fromPM keep a run's character style", () => {
    const schema = writeSchema();
    const doc = makeDoc([para(1, [run("a "), { kind: "run", value: { text: "key", style: "Strong", props: { italic: true } } }])]);
    const pm = toPM(doc, schema);
    const back = fromPM(pm);
    expect(back[0]).toEqual(doc.body[0]);
  });

  it("typing inside a character-styled run → insertText with its style", () => {
    const e = (editor = makeEditor(makeDoc([para(1, [run("ab "), { kind: "run", value: { text: "key", style: "Emphasis" } }])])));
    select(e, 1, 5);
    expect(change(e, () => type(e, "X"))?.command).toEqual({ type: "insertText", block: 1, offset: 5, text: "X", props: {}, style: "Emphasis" });
  });

  it("adding a charStyle mark → applyCharacterStyle; removing it → style null", () => {
    const e = (editor = makeEditor(makeDoc([para(1, "Hello world")])));
    select(e, 1, 6, 1, 11);
    const mark = e.state.schema.marks.charStyle!.create({ id: "Strong" });
    const r = change(e, () => e.view.dispatch(e.state.tr.addMark(e.state.selection.from, e.state.selection.to, mark)));
    expect(r?.command).toEqual({ type: "applyCharacterStyle", block: 1, from: 6, to: 11, style: "Strong" });
    const r2 = change(e, () => e.view.dispatch(e.state.tr.removeMark(e.state.selection.from, e.state.selection.to, e.state.schema.marks.charStyle!)));
    expect(r2?.command).toEqual({ type: "applyCharacterStyle", block: 1, from: 6, to: 11, style: null });
  });
});

describe("find formats", () => {
  it("summaries, emptiness and replace-format commands", () => {
    const name = (id: string) => (id === "Heading1" ? "Heading 1" : id);
    expect(isEmptyFormat({})).toBe(true);
    expect(isEmptyFormat({ run: {} })).toBe(true);
    expect(isEmptyFormat({ highlight: false })).toBe(false);
    expect(formatSummary({ run: { bold: true }, style: "Heading1", highlight: true }, name)).toBe("Format: Bold, Style: Heading 1, Highlight");
    expect(formatSummary({ run: { italic: false } }, name)).toBe("Format: Not Italic");
    const kind = (id: string) => (id === "Strong" ? "character" : id === "Quote" ? "linked" : null);
    expect(formatCommands(4, 2, 6, { run: { italic: true }, style: "Strong", highlight: true }, kind)).toEqual([
      { type: "setRunProps", block: 4, from: 2, to: 6, patch: { italic: true, highlight: { kind: "rgb", value: "FFFF00" } } },
      { type: "applyCharacterStyle", block: 4, from: 2, to: 6, style: "Strong" },
    ]);
    expect(formatCommands(4, 2, 6, { style: "Quote", paragraph: { alignment: "right" } }, kind)).toEqual([
      { type: "setStyle", blocks: [4], style: "Quote" },
      { type: "setParagraphProps", blocks: [4], patch: { alignment: "right" } },
    ]);
  });

  it("the Paragraph dialog contributes only the changed fields", () => {
    const none = { alignment: null, indent: {}, spacing: {} };
    expect(paragraphDiff(none, { alignment: "left", indent: { left: 0, right: 0, firstLine: 0, hanging: null }, spacing: { before: 0, after: 0, line: { kind: "multiple", value: 1 } } })).toEqual({});
    expect(paragraphDiff(none, { alignment: "center", indent: { left: 720, right: 0 }, spacing: { before: 0, after: 240, line: { kind: "multiple", value: 2 } } })).toEqual({
      alignment: "center",
      indent: { left: 720 },
      spacing: { after: 240, line: { kind: "multiple", value: 2 } },
    });
  });
});
