// P8-46: new lists (List Paragraph, contextual spacing; W-03), Backspace at a list item's start (W-28).

import { afterEach, describe, expect, it } from "vitest";
import type { Editor } from "@tiptap/core";
import { Extension } from "@tiptap/core";
import type { Block } from "../generated/Block";
import type { StyleSheet } from "../generated/StyleSheet";
import { idTaggerPlugin, newListStyleTransaction, newListStylePlugin } from "../sync/SyncPlugin";
import { li, makeDoc, para } from "../test/fixtures";
import { change, makeEditor, select } from "../test/harness";
import { contextualGaps, contextualSpacingMarks } from "./contextualSpacing";
import { atListItemStart, listBackspaceCommand } from "./listKeys";

let editor: Editor | null = null;
afterEach(() => editor?.destroy());

const WithListStyle = Extension.create({ name: "testListStyle", addProseMirrorPlugins: () => [idTaggerPlugin(), newListStylePlugin()] });
const open = (body: Block[], withPlugin = false) => (editor = makeEditor(makeDoc(body), withPlugin ? [WithListStyle] : undefined));

const sheet: StyleSheet = {
  defaults: { paragraph: { spacing: { after: 160 } } },
  styles: [
    { id: "Normal", name: "Normal", kind: "paragraph", isDefault: true },
    { id: "ListParagraph", name: "List Paragraph", kind: "paragraph", basedOn: "Normal", paragraph: { contextualSpacing: true, indent: { left: 720 } } },
    { id: "Quote", name: "Quote", kind: "paragraph", basedOn: "ListParagraph" },
    { id: "Plain", name: "Plain", kind: "paragraph", basedOn: "ListParagraph", paragraph: { contextualSpacing: false } },
  ],
};

describe("contextualGaps", () => {
  const p = (style: string, contextual = true) => ({ style, contextual });

  it("drops the space between paragraphs of the same style", () => {
    expect(contextualGaps([p("L"), p("L"), p("L")])).toEqual([
      { before: false, after: true },
      { before: true, after: true },
      { before: true, after: false },
    ]);
  });

  it("keeps the space towards a paragraph of another style", () => {
    expect(contextualGaps([p("N", false), p("L"), p("L"), p("N", false)])).toEqual([
      { before: false, after: false },
      { before: false, after: true },
      { before: true, after: false },
      { before: false, after: false },
    ]);
  });

  it("only the paragraph with the option loses its space", () => {
    expect(contextualGaps([p("L", false), p("L", true)])).toEqual([
      { before: false, after: false },
      { before: true, after: false },
    ]);
  });

  it("something else in between (a table) breaks the run", () => {
    expect(contextualGaps([p("L"), null, p("L")])).toEqual([
      { before: false, after: false },
      { before: false, after: false },
      { before: false, after: false },
    ]);
  });

  it("a single paragraph keeps its spacing", () => {
    expect(contextualGaps([p("L")])).toEqual([{ before: false, after: false }]);
  });
});

describe("contextualSpacingMarks (the decorations the pagination measures)", () => {
  it("list items in List Paragraph: no space between them, the last one keeps its space after", () => {
    const e = open([para(1, "intro"), li(2, "a", 1, 0, { style: "ListParagraph" }), li(3, "b", 1, 0, { style: "ListParagraph" }), li(4, "c", 1, 0, { style: "ListParagraph" }), para(5, "after")]);
    const marks = contextualSpacingMarks(e.state.doc, sheet).map((m) => [m.node.attrs.id, m.before, m.after]);
    expect(marks).toEqual([
      [2, false, true],
      [3, true, true],
      [4, true, false],
    ]);
  });

  it("nested levels continue the run (one style)", () => {
    const e = open([li(1, "a", 1, 0, { style: "ListParagraph" }), li(2, "b", 1, 1, { style: "ListParagraph" }), li(3, "c", 1, 0, { style: "ListParagraph" })]);
    expect(contextualSpacingMarks(e.state.doc, sheet).map((m) => m.node.attrs.id)).toEqual([1, 2, 3]);
  });

  it("the option is inherited through basedOn and can be switched off by a style or direct formatting", () => {
    const e = open([
      para(1, "q1", { style: "Quote" }),
      para(2, "q2", { style: "Quote" }),
      para(3, "p1", { style: "Plain" }),
      para(4, "p2", { style: "Plain" }),
      para(5, "n1", { contextualSpacing: true }),
      para(6, "n2", { contextualSpacing: true }),
      para(7, "x1", { style: "ListParagraph", contextualSpacing: false }),
      para(8, "x2", { style: "ListParagraph", contextualSpacing: false }),
    ]);
    expect(contextualSpacingMarks(e.state.doc, sheet).map((m) => m.node.attrs.id)).toEqual([1, 2, 5, 6]);
  });

  it("Normal paragraphs keep their space (no option)", () => {
    const e = open([para(1, "a"), para(2, "b")]);
    expect(contextualSpacingMarks(e.state.doc, sheet)).toEqual([]);
  });

  it("different styles with the option keep the space between them", () => {
    const e = open([para(1, "a", { style: "ListParagraph" }), para(2, "b", { style: "Quote" })]);
    expect(contextualSpacingMarks(e.state.doc, sheet)).toEqual([]);
  });
});

describe("new lists get List Paragraph (W-03)", () => {
  it("toggling bullets on Normal paragraphs styles them in the editor; the mapper sends applyList only", () => {
    const e = open([para(1, "a"), para(2, "b"), para(3, "c")], true);
    select(e, 1, 0, 2, 1);
    const r = change(e, () => e.commands.toggleBulletList());
    expect(r?.command).toEqual({ type: "applyList", blocks: [1, 2], kind: "bullet" });
    const styles: (string | null)[] = [];
    e.state.doc.descendants((n) => {
      if (n.type.name === "paragraph") styles.push(n.attrs.style as string | null);
      return true;
    });
    expect(styles).toEqual(["ListParagraph", "ListParagraph", null]);
  });

  it("a styled paragraph keeps its style; existing list items are left alone", () => {
    const e = open([para(1, "a", { style: "Quote" }), li(2, "b", 1)]);
    const before = e.state.doc;
    select(e, 1, 0);
    e.commands.toggleBulletList();
    expect(newListStyleTransaction(before, e.state)).toBeNull();
  });

  it("paragraphs new to the document (Enter in a list) are not restyled", () => {
    const e = open([li(1, "a", 1)]);
    const before = e.state.doc;
    select(e, 1, 1);
    e.commands.splitListItem("listItem");
    expect(newListStyleTransaction(before, e.state)).toBeNull();
  });
});

describe("Backspace at a list item's start (W-28)", () => {
  it("at the start of an item → ListBackspace for it", () => {
    const e = open([li(1, "a", 1), li(2, "b", 1)]);
    select(e, 2, 0);
    expect(atListItemStart(e.state)).toBe(true);
    expect(listBackspaceCommand(e.state)).toEqual({ type: "listBackspace", block: 2 });
  });

  it("inside the text, with a selection or outside a list → not handled", () => {
    const e = open([li(1, "ab", 1), para(2, "c")]);
    select(e, 1, 1);
    expect(listBackspaceCommand(e.state)).toBeNull();
    select(e, 1, 0, 1, 2);
    expect(listBackspaceCommand(e.state)).toBeNull();
    select(e, 2, 0);
    expect(atListItemStart(e.state)).toBe(false);
  });

  it("a nested item's start is handled too", () => {
    const e = open([li(1, "a", 1), li(2, "b", 1, 1)]);
    select(e, 2, 0);
    expect(listBackspaceCommand(e.state)).toEqual({ type: "listBackspace", block: 2 });
  });

  it("an item whose id is still temporary waits for its real id", () => {
    const e = open([li(1, "a", 1)]);
    select(e, 1, 1);
    e.commands.splitListItem("listItem");
    expect(atListItemStart(e.state)).toBe(true);
    expect(listBackspaceCommand(e.state)).toBeNull();
  });
});
