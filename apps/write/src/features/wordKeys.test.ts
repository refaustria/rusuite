// P8-46 (W-30): Word's extra character / paragraph keys → formatting.

import { afterEach, describe, expect, it } from "vitest";
import type { Editor } from "@tiptap/core";
import type { StyleSheet } from "../generated/StyleSheet";
import { propsFromMarks } from "../sync/fromPM";
import { makeDoc, para, run } from "../test/fixtures";
import { change, makeEditor, select } from "../test/harness";
import {
  cycleCaseCommand, effectiveIndent, growFont, hangingIndent, nextCase, removeParagraphFormatting, stepFontList, stepFontPoint, stepHangingIndent,
  switchRun, toggleChar, withoutParagraphFormatting,
} from "./wordKeys";

let editor: Editor | null = null;
afterEach(() => editor?.destroy());
const open = (...body: Parameters<typeof makeDoc>[0]) => (editor = makeEditor(makeDoc(body)));

const sheet: StyleSheet = {
  defaults: { run: { size: 1100 } },
  styles: [
    { id: "Normal", name: "Normal", kind: "paragraph", isDefault: true },
    { id: "Big", name: "Big", kind: "paragraph", basedOn: "Normal", run: { size: 2000 } },
    { id: "ListParagraph", name: "List Paragraph", kind: "paragraph", basedOn: "Normal", paragraph: { indent: { left: 720 } } },
  ],
};

describe("font size steps", () => {
  it("Ctrl+] / Ctrl+[: one point, bounded", () => {
    expect(stepFontPoint(1100, 1)).toBe(1200);
    expect(stepFontPoint(1050, -1)).toBe(1000);
    expect(stepFontPoint(100, -1)).toBe(100);
    expect(stepFontPoint(163800, 1)).toBe(163800);
  });

  it("Ctrl+Shift+> / <: Word's list, steps of 10 above 72, of 1 below 8", () => {
    expect(stepFontList(1100, 1)).toBe(1200);
    expect(stepFontList(1000, 1)).toBe(1050);
    expect(stepFontList(2800, 1)).toBe(3600);
    expect(stepFontList(7200, 1)).toBe(8000);
    expect(stepFontList(8000, -1)).toBe(7200);
    expect(stepFontList(10000, -1)).toBe(9000);
    expect(stepFontList(1300, -1)).toBe(1200);
    expect(stepFontList(800, -1)).toBe(700);
    expect(stepFontList(100, -1)).toBe(100);
  });

  it("each run grows from its own effective size (style, direct)", () => {
    const e = open(para(1, [run("ab"), run("cd", { size: 1600 })]), para(2, "ef", { style: "Big" }));
    select(e, 1, 0, 2, 2);
    const r = change(e, () => growFont(e, sheet, "point", 1));
    const sizes: number[] = [];
    e.state.doc.descendants((n) => {
      if (n.isText) sizes.push(propsFromMarks(n.marks).size!);
      return true;
    });
    expect(sizes).toEqual([1200, 1700, 2100]);
    expect(r?.command).toBeDefined();
  });

  it("at a caret the typing formatting grows", () => {
    const e = open(para(1, "ab"));
    select(e, 1, 1);
    growFont(e, sheet, "list", 1);
    expect(propsFromMarks(e.state.storedMarks ?? []).size).toBe(1200);
  });
});

describe("character toggles", () => {
  it("switches relative to the style: explicit off where the style turns it on (Word's toggles)", () => {
    const bold = { key: "bold" as const, on: true, off: false, isOn: (v: unknown) => v === true };
    // Plain text: on sets it, off removes it.
    expect(switchRun({}, {}, bold, true)).toEqual({ bold: true });
    expect(switchRun({ bold: true }, {}, bold, false)).toEqual({});
    // A bold style: off is an explicit false (w:b w:val="0"), on again removes the direct value.
    expect(switchRun({}, { bold: true }, bold, false)).toEqual({ bold: false });
    expect(switchRun({ bold: false }, { bold: true }, bold, true)).toEqual({});
  });

  it("small caps and all caps exclude each other; double underline toggles", () => {
    const e = open(para(1, "hello"));
    select(e, 1, 0, 1, 5);
    toggleChar(e, sheet, "allCaps");
    toggleChar(e, sheet, "smallCaps");
    expect(propsFromMarks(e.state.doc.child(0).child(0).marks)).toEqual({ smallCaps: true });
    toggleChar(e, sheet, "doubleUnderline");
    expect(propsFromMarks(e.state.doc.child(0).child(0).marks).underline).toBe("double");
    toggleChar(e, sheet, "doubleUnderline");
    expect(propsFromMarks(e.state.doc.child(0).child(0).marks).underline).toBeUndefined();
  });

  it("Ctrl+Shift+K formats the selection → setRunProps smallCaps", () => {
    const e = open(para(1, "hello"));
    select(e, 1, 0, 1, 5);
    const r = change(e, () => toggleChar(e, sheet, "smallCaps"));
    expect(r?.command).toMatchObject({ type: "setRunProps", block: 1, from: 0, to: 5, patch: { smallCaps: true } });
  });

  it("Ctrl+Shift+D → a double underline mark", () => {
    const e = open(para(1, "hello"));
    select(e, 1, 0, 1, 5);
    toggleChar(e, sheet, "doubleUnderline");
    expect(propsFromMarks(e.state.doc.firstChild!.firstChild!.marks).underline).toBe("double");
  });
});

describe("Shift+F3", () => {
  it("lowercase → Capitalize Each Word → UPPERCASE → lowercase", () => {
    expect(nextCase("hello world")).toBe("capitalize");
    expect(nextCase("Hello World")).toBe("upper");
    expect(nextCase("HELLO WORLD")).toBe("lower");
    expect(nextCase("hELLo")).toBe("upper");
    expect(nextCase("123")).toBe("upper");
  });

  it("the word at the caret → ChangeCase for that word", () => {
    const e = open(para(1, "one two"));
    select(e, 1, 5);
    expect(cycleCaseCommand(e)).toEqual({ type: "changeCase", block: 1, from: 4, to: 7, case: "capitalize" });
  });
});

describe("hanging indent (Ctrl+T / Ctrl+Shift+T)", () => {
  it("the text moves by a tab stop, the first line stays", () => {
    expect(hangingIndent({}, 1)).toEqual({ left: 720, hanging: 720 });
    expect(hangingIndent({ left: 720, hanging: 720 }, 1)).toEqual({ left: 1440, hanging: 1440 });
    expect(hangingIndent({ left: 1440, hanging: 1440 }, -1)).toEqual({ left: 720, hanging: 720 });
    expect(hangingIndent({ left: 720, hanging: 720 }, -1)).toEqual({ left: 0, hanging: 0 });
    expect(hangingIndent({ left: 720 }, 1)).toEqual({ left: 1440, hanging: 720 });
    expect(hangingIndent({ left: 0, firstLine: 360 }, 1)).toEqual({ left: 1080, hanging: 720 });
  });

  it("starts from the style's indent (List Paragraph) and sends setParagraphProps", () => {
    const e = open(para(1, "x", { style: "ListParagraph" }));
    expect(effectiveIndent(sheet, e.state.doc.firstChild!)).toEqual({ left: 720 });
    select(e, 1, 0);
    const r = change(e, () => stepHangingIndent(e, sheet, 1));
    expect(r?.command).toEqual({ type: "setParagraphProps", blocks: [1], patch: { indent: { left: 1440, hanging: 720 } } });
  });
});

describe("Ctrl+Q", () => {
  it("drops alignment, indents, spacing and the other paragraph formatting; keeps the style and the list", () => {
    const out = withoutParagraphFormatting({
      id: 1, style: "Quote", align: "center", indent: { left: 720 }, spacing: { after: 0 },
      extra: { keepNext: true, borders: {}, numbering: { numId: 1, level: 0 }, sectionEnd: 3 },
    });
    expect(out).toEqual({ id: 1, style: "Quote", align: null, indent: null, spacing: null, extra: { numbering: { numId: 1, level: 0 }, sectionEnd: 3 } });
  });

  it("the editor paragraph loses its direct formatting (sent as Rust commands)", () => {
    const e = open(para(1, "x", { alignment: "center", spacing: { after: 0 }, keepNext: true }));
    select(e, 1, 0);
    const r = change(e, () => removeParagraphFormatting(e));
    expect(r).not.toBeNull();
    const n = e.state.doc.firstChild!;
    expect([n.attrs.align, n.attrs.spacing, n.attrs.extra]).toEqual([null, null, null]);
  });
});
