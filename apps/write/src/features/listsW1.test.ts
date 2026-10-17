// P9-W1: Word's list placement (level indents), the second Backspace, the list galleries' commands, heading
// numbers in the Navigation pane, Shift+F3 at a sentence end and Ctrl+Shift+W.

import { afterEach, describe, expect, it } from "vitest";
import type { Editor } from "@tiptap/core";
import type { Block } from "../generated/Block";
import type { Level } from "../generated/Level";
import type { Numbering } from "../generated/Numbering";
import type { StyleSheet } from "../generated/StyleSheet";
import { headingsOf } from "../ui/stylesPane";
import { li, makeDoc, numberingDef, para, run } from "../test/fixtures";
import { makeEditor, select } from "../test/harness";
import { changeCaseCommand } from "./changeCase";
import {
  levelAtCaret, levelFromFormat, listCommand, listTargets, numberedParagraphAtCaret, presetSamples, sampleLabel, BULLET_PRESETS, MULTILEVEL_PRESETS,
  NUMBERING_PRESETS,
} from "./listGallery";
import { listIndentMarks, placement, placementAttrs } from "./listIndent";
import { outdentAtStart } from "./listKeys";
import { endsSentence, nextCase, wordBefore, wordUnderline } from "./wordKeys";
import { toggleHeading } from "../sync/editorCommands";

let editor: Editor | null = null;
afterEach(() => editor?.destroy());
const open = (body: Block[], numbering?: Numbering) => {
  const doc = makeDoc(body);
  if (numbering) doc.numbering = numbering;
  return (editor = makeEditor(doc));
};

const sheet: StyleSheet = {
  defaults: {},
  styles: [
    { id: "Normal", name: "Normal", kind: "paragraph", isDefault: true },
    { id: "ListParagraph", name: "List Paragraph", kind: "paragraph", basedOn: "Normal", paragraph: { contextualSpacing: true, indent: { left: 720 } } },
    { id: "Heading1", name: "heading 1", kind: "paragraph", basedOn: "Normal", paragraph: { outlineLevel: 0, numbering: { numId: 7, level: 0 } } },
    { id: "Heading2", name: "heading 2", kind: "paragraph", basedOn: "Normal", paragraph: { outlineLevel: 1, numbering: { numId: 7, level: 1 } } },
  ],
};

const headingList = (): Numbering => ({
  defs: [
    numberingDef(1, ["bullet"]),
    numberingDef(2, ["decimal", "lowerLetter", "lowerRoman"]),
    {
      id: 7,
      levels: Array.from({ length: 9 }, (_, i): Level => ({ kind: "decimal", text: "%1", start: 1, style: `Heading${i + 1}`, indent: { left: 432 + 144 * i, hanging: 432 + 144 * i } })),
    },
  ],
});

describe("list placement from the level's indent", () => {
  it("items sit at their level's left / hanging, not at a fixed step", () => {
    const e = open([li(1, "a", 2, 0), li(2, "b", 2, 1), li(3, "c", 2, 0)]);
    const marks = listIndentMarks(e.state.doc, { defs: [numberingDef(2, ["decimal"])] }, sheet);
    const paras = marks.filter((m) => m.place).map((m) => [m.node.attrs.id, m.place!.left, m.place!.hanging]);
    expect(paras).toEqual([[1, 720, 360], [2, 1440, 360], [3, 720, 360]]);
    // The list nodes lose the browser's padding.
    expect(marks.filter((m) => !m.place).map((m) => m.node.type.name)).toEqual(["orderedList", "orderedList"]);
  });

  it("a level with Word's multilevel indents (432 / 1224 …) is used as it is", () => {
    const levels: Level[] = Array.from({ length: 9 }, (_, i) => ({ kind: "decimal", text: "%1.", start: 1, indent: { left: 360 + 432 * i, hanging: 360 + 72 * i } }));
    const e = open([li(1, "a", 5, 0), li(2, "b", 5, 2)], { defs: [{ id: 5, levels }] });
    const p = listIndentMarks(e.state.doc, { defs: [{ id: 5, levels }] }, sheet).filter((m) => m.place);
    expect(p.map((m) => [m.place!.left, m.place!.hanging])).toEqual([[360, 360], [1224, 504]]);
  });

  it("the paragraph's direct indent beats the level's (Word)", () => {
    const level: Level = { kind: "decimal", text: "%1.", start: 1, indent: { left: 720, hanging: 360 } };
    expect(placement(level, { left: 1080 })).toMatchObject({ left: 1080, hanging: 360 });
    expect(placement(level, { firstLine: 0 })).toMatchObject({ left: 720, hanging: 0 });
    expect(placement(level, { hanging: 200 })).toMatchObject({ hanging: 200 });
    expect(placement(level, null, false)).toMatchObject({ left: 720, hanging: 0, labelled: false });
  });

  it("label alignment, suffix and font become decoration attributes", () => {
    const level: Level = { kind: "upperRoman", text: "%1.", start: 1, indent: { left: 720, hanging: 360 }, alignment: "right", suffix: "space", font: { kind: "named", value: "Courier New" } };
    const a = placementAttrs(placement(level, null));
    expect(a["data-label-align"]).toBe("right");
    expect(a["data-label-suffix"]).toBe("space");
    expect(a.style).toContain("--li-left: 48.00px");
    expect(a.style).toContain("--li-hang: 24.00px");
    expect(a.style).toContain('--li-font: "Courier New"');
    // Symbol fonts are already mapped to Unicode: no font.
    expect(placement({ ...level, font: { kind: "named", value: "Wingdings" } }, null).font).toBeNull();
  });

  it("a heading numbered through its style is placed by its level", () => {
    const e = open([para(1, "Intro", { style: "Heading1" }), para(2, "Body")], headingList());
    e.view.dispatch(e.state.tr.setNodeAttribute(0, "listLabel", "1").setMeta("addToHistory", false));
    const marks = listIndentMarks(e.state.doc, headingList(), sheet);
    expect(marks.map((m) => [m.node.attrs.id, m.place?.left, m.place?.hanging])).toEqual([[1, 432, 432]]);
  });

  it("a second paragraph in an item continues at the text position (no label)", () => {
    const e = open([li(1, "a", 2, 0)]);
    const pos = e.state.doc.content.size - 2;
    e.view.dispatch(e.state.tr.insert(pos, e.state.schema.nodes.paragraph!.create({ id: 9 }, e.state.schema.text("more"))));
    const p = listIndentMarks(e.state.doc, { defs: [numberingDef(2, ["decimal"])] }, sheet).filter((m) => m.place);
    expect(p.map((m) => [m.node.attrs.id, m.place!.labelled, m.place!.hanging])).toEqual([[1, true, 360], [9, false, 0]]);
  });
});

describe("Backspace: the second step outdents (Word)", () => {
  it("at the start of an indented paragraph the indent goes", () => {
    const e = open([para(1, "a"), para(2, "b", { indent: { left: 720, firstLine: 0 } })]);
    select(e, 2, 0);
    const tr = outdentAtStart(e.state, sheet)!;
    expect(tr).not.toBeNull();
    e.view.dispatch(tr);
    expect(e.state.doc.child(1).attrs.indent).toBeNull();
    // Third press: nothing to outdent, the paragraph joins (not handled here).
    select(e, 2, 0);
    expect(outdentAtStart(e.state, sheet)).toBeNull();
  });

  it("a List Paragraph (style indent 720) gets an explicit 0", () => {
    const e = open([para(1, "a"), para(2, "b", { style: "ListParagraph", indent: { left: 720, firstLine: 0 } })]);
    select(e, 2, 0);
    e.view.dispatch(outdentAtStart(e.state, sheet)!);
    expect(e.state.doc.child(1).attrs.indent).toEqual({ left: 0 });
    select(e, 2, 0);
    expect(outdentAtStart(e.state, sheet)).toBeNull();
  });

  it("not in a list item, not inside the text, not without an indent", () => {
    const e = open([li(1, "a", 2, 0, { indent: { left: 720 } }), para(2, "bc", { indent: { left: 720 } }), para(3, "d")]);
    select(e, 1, 0);
    expect(outdentAtStart(e.state, sheet)).toBeNull();
    select(e, 2, 1);
    expect(outdentAtStart(e.state, sheet)).toBeNull();
    select(e, 3, 0);
    expect(outdentAtStart(e.state, sheet)).toBeNull();
  });
});

describe("list galleries → ApplyNumbering", () => {
  it("Word's libraries: 7 numbering formats, 7 bullets, 7 multilevel lists", () => {
    expect([NUMBERING_PRESETS.length, BULLET_PRESETS.length, MULTILEVEL_PRESETS.length]).toEqual([7, 7, 7]);
    expect(presetSamples("decimalParen")).toEqual(["1)", "2)", "3)"]);
    expect(presetSamples("upperRoman")).toEqual(["I.", "II.", "III."]);
    expect(presetSamples("lowerLetterParen")).toEqual(["a)", "b)", "c)"]);
    expect(presetSamples("bulletArrow")).toEqual(["➢", "➢", "➢"]);
    expect(presetSamples("headingDecimal")).toEqual(["1", "1.1", "1.1.1"]);
    expect(sampleLabel("lowerRoman", "(%1)", 4)).toBe("(iv)");
  });

  it("the caret in a list: the whole list with its levels", () => {
    const e = open([li(1, "one", 2, 0), li(2, "sub", 2, 1), li(3, "two", 2, 0), para(4, "after")]);
    select(e, 2, 1);
    const targets = listTargets(e.state);
    expect(targets).toEqual([{ id: 1, level: 0 }, { id: 2, level: 1 }, { id: 3, level: 0 }]);
    expect(listCommand(targets, { preset: "upperRoman" })).toEqual({ type: "applyNumbering", preset: "upperRoman", items: [[1, 0], [2, 1], [3, 0]] });
  });

  it("a selection of plain paragraphs: each on level 0", () => {
    const e = open([para(1, "a"), para(2, "b"), para(3, "c")]);
    select(e, 1, 0, 2, 1);
    expect(listTargets(e.state)).toEqual([{ id: 1, level: 0 }, { id: 2, level: 0 }]);
  });

  it("Define New Number Format: %1 becomes the level's token; font and alignment", () => {
    expect(levelFromFormat({ kind: "upperLetter", text: "Part %1:", font: "Arial", alignment: "center" }, 1)).toEqual({
      kind: "upperLetter", text: "Part %2:", start: 1, font: { kind: "named", value: "Arial" }, alignment: "center",
    });
    expect(levelFromFormat({ kind: "bullet", text: "★", font: "", alignment: "left" }, 3)).toEqual({ kind: "bullet", text: "★", start: 1 });
    const cmd = listCommand([{ id: 4, level: 1 }], { format: levelFromFormat({ kind: "decimal", text: "%1)", font: "", alignment: "left" }, 1) });
    expect(cmd).toEqual({ type: "applyNumbering", format: { kind: "decimal", text: "%2)", start: 1 }, items: [[4, 1]] });
  });

  it("the caret's level: a list item's, or a numbered heading's through its style", () => {
    const e = open([li(1, "a", 2, 1), para(2, "Intro", { style: "Heading2" })], headingList());
    select(e, 1, 0);
    expect(levelAtCaret(e.state, headingList(), sheet)).toMatchObject({ index: 1, level: { kind: "lowerLetter" } });
    select(e, 2, 0);
    expect(levelAtCaret(e.state, headingList(), sheet)).toMatchObject({ index: 1, level: { style: "Heading2" } });
    expect(numberedParagraphAtCaret(e.state)).toBeNull();
    e.view.dispatch(e.state.tr.setNodeAttribute(e.state.selection.$from.before(), "listLabel", "1.1"));
    expect(numberedParagraphAtCaret(e.state)).toBe(2);
  });
});

describe("Navigation pane: outline levels and heading numbers", () => {
  it("a paragraph with an outline level is listed; body text takes a heading out; numbers shown", () => {
    const e = open([
      para(1, "Intro", { style: "Heading1" }),
      para(2, "Summary", { outlineLevel: 1 }),
      para(3, "Hidden", { style: "Heading2", outlineLevel: 9 }),
      para(4, "Body"),
    ]);
    e.view.dispatch(e.state.tr.setNodeAttribute(0, "listLabel", "1").setMeta("addToHistory", false));
    expect(headingsOf(e.state.doc, sheet)).toEqual([
      { id: 1, level: 1, text: "1 Intro" },
      { id: 2, level: 2, text: "Summary" },
    ]);
  });
});

describe("Shift+F3 at a sentence end", () => {
  it("a sentence cycles through Sentence case", () => {
    expect(endsSentence("hello world.")).toBe(true);
    expect(endsSentence("hello world")).toBe(false);
    expect(endsSentence('he said "go!"')).toBe(true);
    expect(nextCase("hello world.")).toBe("sentence");
    expect(nextCase("hello world")).toBe("capitalize");
    expect(nextCase("Hello world.")).toBe("upper");
    expect(nextCase("HELLO WORLD.")).toBe("lower");
  });

  it("the caret right after the period changes the word before it", () => {
    const e = open([para(1, "the end.")]);
    select(e, 1, 8);
    expect(wordBefore(e.state.doc, e.state.selection.from)).toEqual({ from: e.state.selection.from - 4, to: e.state.selection.from - 1 });
    expect(changeCaseCommand(e, "upper")).toEqual({ type: "changeCase", block: 1, from: 4, to: 7, case: "upper" });
  });
});

describe("Ctrl+Shift+W and Ctrl+Alt+1", () => {
  it("word underline: the words, not the spaces between them; again: off", () => {
    const e = open([para(1, [run("one two  three")])]);
    select(e, 1, 0, 1, 14);
    expect(wordUnderline(e, sheet)).toBe(true);
    const marks: [string, boolean][] = [];
    e.state.doc.child(0).forEach((n) => marks.push([n.text!, n.marks.some((m) => m.type.name === "underline")]));
    expect(marks).toEqual([["one", true], [" ", false], ["two", true], ["  ", false], ["three", true]]);
    select(e, 1, 0, 1, 14);
    wordUnderline(e, sheet);
    let any = false;
    e.state.doc.child(0).forEach((n) => (any ||= n.marks.some((m) => m.type.name === "underline")));
    expect(any).toBe(false);
  });

  it("Ctrl+Alt+1 toggles the Heading 1 style and keeps the paragraph's id", () => {
    const e = open([para(1, "Title")]);
    select(e, 1, 0);
    toggleHeading(e, 1);
    expect([e.state.doc.child(0).type.name, e.state.doc.child(0).attrs.id]).toEqual(["heading", 1]);
    toggleHeading(e, 1);
    expect([e.state.doc.child(0).type.name, e.state.doc.child(0).attrs.id]).toEqual(["paragraph", 1]);
  });
});
