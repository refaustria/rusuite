import { afterEach, describe, expect, it } from "vitest";
import type { Editor } from "@tiptap/core";
import { Slice } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import type { Block } from "../generated/Block";
import type { WriteCommand } from "../generated/WriteCommand";
import { FIXTURES, li, makeDoc, para, run } from "../test/fixtures";
import { change, makeEditor, posOf, press, select, type } from "../test/harness";
import { setAlignment, setParagraphStyle, setTextStyle } from "./editorCommands";
import { classify } from "./transactionMapper";

let editor: Editor | null = null;
afterEach(() => editor?.destroy());

const open = (body: Block[]) => (editor = makeEditor(makeDoc(body)));
const cmd = (r: { command: WriteCommand } | null) => r?.command;

describe("transactionMapper: text", () => {
  it("typing at the end of a paragraph → insertText", () => {
    const e = open([para(1, "Hello")]);
    select(e, 1, 5);
    expect(cmd(change(e, () => type(e, "!")))).toEqual({ type: "insertText", block: 1, offset: 5, text: "!", props: {} });
  });

  it("typing in the middle of bold text → insertText with the bold props", () => {
    const e = open([para(1, [run("ab "), run("bold", { bold: true }), run(" cd")])]);
    select(e, 1, 5);
    expect(cmd(change(e, () => type(e, "X")))).toEqual({ type: "insertText", block: 1, offset: 5, text: "X", props: { bold: true } });
  });

  it("offsets count Unicode scalars, not UTF-16 units", () => {
    const e = open([para(1, "😀😀ab")]);
    select(e, 1, 3);
    expect(cmd(change(e, () => type(e, "é")))).toMatchObject({ type: "insertText", offset: 3, text: "é" });
  });

  it("deleting a character → deleteText", () => {
    const e = open([para(1, "Hello")]);
    const from = posOf(e, 1, 1);
    expect(cmd(change(e, () => e.view.dispatch(e.state.tr.delete(from, from + 1))))).toEqual({
      type: "deleteText", block: 1, from: 1, to: 2,
    });
  });

  it("typing over a selection → replaceText", () => {
    const e = open([para(1, "Hello world")]);
    select(e, 1, 6, 1, 11);
    expect(cmd(change(e, () => type(e, "there")))).toEqual({ type: "replaceText", block: 1, from: 6, to: 11, text: "there" });
  });

  it("typing with a stored mark → insertText with those props", () => {
    const e = open([para(1, "ab")]);
    select(e, 1, 2);
    e.commands.toggleItalic();
    expect(cmd(change(e, () => type(e, "c")))).toEqual({ type: "insertText", block: 1, offset: 2, text: "c", props: { italic: true } });
  });

  it("a selection without a document change maps to nothing", () => {
    const e = open([para(1, "ab")]);
    expect(change(e, () => select(e, 1, 1))).toBeNull();
  });
});

describe("transactionMapper: paragraphs", () => {
  it("Enter at the end of a heading → splitParagraph at the end", () => {
    const e = open([para(1, "Title", { style: "Heading1" }), para(2, "body")]);
    select(e, 1, 5);
    const c = cmd(change(e, () => press(e, "Enter")));
    expect(c).toMatchObject({ type: "splitParagraph", block: 1, offset: 5 });
    expect((c as { newId: number }).newId).toBeLessThan(0);
  });

  it("Enter in the middle of a heading → splitParagraph at the cursor", () => {
    const e = open([para(1, "Heading", { style: "Heading2" })]);
    select(e, 1, 4);
    const c = cmd(change(e, () => press(e, "Enter")));
    expect(c).toMatchObject({ type: "splitParagraph", block: 1, offset: 4 });
    expect((c as { newId: number }).newId).toBeLessThan(0);
  });

  it("Enter at the start of a paragraph → splitParagraph at 0", () => {
    const e = open([para(1, "one"), para(2, "two")]);
    select(e, 2, 0);
    expect(cmd(change(e, () => press(e, "Enter")))).toMatchObject({ type: "splitParagraph", block: 2, offset: 0 });
  });

  it("Backspace at the start of a paragraph → joinWithPrevious", () => {
    const e = open([para(1, "one"), para(2, "two")]);
    select(e, 2, 0);
    expect(cmd(change(e, () => press(e, "Backspace")))).toEqual({ type: "joinWithPrevious", block: 2 });
  });

  it("deleting across paragraphs → replaceBlocks of both", () => {
    const e = open([para(1, "one"), para(2, "two"), para(3, "three")]);
    select(e, 1, 1, 2, 1);
    expect(cmd(change(e, () => e.view.dispatch(e.state.tr.deleteSelection())))).toEqual({
      type: "replaceBlocks", ids: [1, 2], blocks: [para(1, "owo")],
    });
  });

  it("paragraph style → setStyle (ids kept)", () => {
    const e = open([para(1, "a"), para(2, "b")]);
    select(e, 1, 0, 2, 1);
    expect(cmd(change(e, () => setParagraphStyle(e, "Heading2")))).toEqual({ type: "setStyle", blocks: [1, 2], style: "Heading2" });
    expect(cmd(change(e, () => setParagraphStyle(e, "Normal")))).toEqual({ type: "setStyle", blocks: [1, 2], style: "Normal" });
  });

  it("alignment → setParagraphProps", () => {
    const e = open([para(1, "a")]);
    select(e, 1, 0);
    expect(cmd(change(e, () => setAlignment(e, "center")))).toEqual({
      type: "setParagraphProps", blocks: [1], patch: { alignment: "center" },
    });
  });
});

describe("transactionMapper: marks", () => {
  it("toggling bold on a selection → setRunProps bold", () => {
    const e = open([para(1, "Hello world")]);
    select(e, 1, 0, 1, 5);
    expect(cmd(change(e, () => e.commands.toggleBold()))).toEqual({
      type: "setRunProps", block: 1, from: 0, to: 5, patch: { bold: true },
    });
    expect(cmd(change(e, () => e.commands.toggleBold()))).toEqual({
      type: "setRunProps", block: 1, from: 0, to: 5, patch: { bold: false },
    });
  });

  it("font and color through textStyle → setRunProps", () => {
    const e = open([para(1, [run("ab", { italic: true }), run("cd")])]);
    select(e, 1, 1, 1, 3);
    const color = { kind: "rgb" as const, value: "FF0000" };
    expect(cmd(change(e, () => setTextStyle(e, { color, size: 1400 })))).toEqual({
      type: "setRunProps", block: 1, from: 1, to: 3, patch: { color, size: 1400 },
    });
  });
});

describe("transactionMapper: lists", () => {
  it("toggling a bullet list on two paragraphs → applyList bullet", () => {
    const e = open([para(1, "a"), para(2, "b"), para(3, "c")]);
    select(e, 1, 0, 2, 1);
    expect(cmd(change(e, () => e.commands.toggleBulletList()))).toEqual({ type: "applyList", blocks: [1, 2], kind: "bullet" });
  });

  it("switching a bullet list to numbered → applyList decimal", () => {
    const e = open([li(1, "a", 1), li(2, "b", 1)]);
    select(e, 1, 0, 2, 1);
    expect(cmd(change(e, () => e.commands.toggleOrderedList()))).toEqual({ type: "applyList", blocks: [1, 2], kind: "decimal" });
  });

  it("Tab / Shift-Tab in a list → indentList ±1", () => {
    const e = open([li(1, "a", 1), li(2, "b", 1)]);
    select(e, 2, 0);
    expect(cmd(change(e, () => e.commands.sinkListItem("listItem")))).toEqual({ type: "indentList", blocks: [2], delta: 1 });
    expect(cmd(change(e, () => e.commands.liftListItem("listItem")))).toEqual({ type: "indentList", blocks: [2], delta: -1 });
  });

  it("lifting the only item out of the list → applyList none", () => {
    const e = open([para(1, "x"), li(2, "a", 1)]);
    select(e, 2, 0);
    expect(cmd(change(e, () => e.commands.liftListItem("listItem")))).toEqual({ type: "applyList", blocks: [2], kind: "none" });
  });

  it("Enter in a list item → splitParagraph keeping the numbering", () => {
    const e = open([li(1, "item", 1)]);
    select(e, 1, 4);
    expect(cmd(change(e, () => press(e, "Enter")))).toMatchObject({ type: "splitParagraph", block: 1, offset: 4 });
  });
});

describe("transactionMapper: structure", () => {
  it("pasting several paragraphs in the middle of one → replaceBlocks with temporary ids", () => {
    const e = open([para(1, "Hello world"), para(9, "end")]);
    select(e, 1, 5);
    const s = e.state.schema;
    const slice = new Slice(
      s.nodes.doc!.create(null, [s.nodes.paragraph!.create(null, s.text(" one")), s.nodes.paragraph!.create(null, s.text("two "))]).content,
      1,
      1,
    );
    const c = cmd(change(e, () => e.view.dispatch(e.state.tr.replaceSelection(slice)))) as Extract<WriteCommand, { type: "replaceBlocks" }>;
    expect(c.type).toBe("replaceBlocks");
    expect(c.ids).toEqual([1]);
    expect(c.blocks.map((b) => (b.value as { inlines: unknown }).inlines)).toEqual([[run("Hello one")], [run("two  world")]]);
    expect(c.blocks[0]!.value.id).toBe(1);
    expect(c.blocks[1]!.value.id).toBeLessThan(0);
  });

  it("pasting whole paragraphs between two others → insertBlocks", () => {
    const e = open([para(1, "a"), para(2, "b")]);
    const s = e.state.schema;
    const at = posOf(e, 2, 0) - 1;
    const c = cmd(change(e, () => e.view.dispatch(e.state.tr.insert(at, [s.nodes.paragraph!.create(null, s.text("x")), s.nodes.paragraph!.create(null, s.text("y"))]))));
    expect(c).toMatchObject({ type: "insertBlocks", after: 1 });
    expect((c as { blocks: Block[] }).blocks).toHaveLength(2);
  });

  it("typing inside a table cell → insertText on the cell paragraph", () => {
    const e = (editor = makeEditor(FIXTURES.table!));
    select(e, 7, 2);
    expect(cmd(change(e, () => type(e, "!")))).toEqual({ type: "insertText", block: 7, offset: 2, text: "!", props: {} });
    select(e, 13, 1);
    expect(cmd(change(e, () => e.view.dispatch(e.state.tr.delete(posOf(e, 13, 0), posOf(e, 13, 1)))))).toEqual({
      type: "deleteText", block: 13, from: 0, to: 1,
    });
  });

  it("splitting a paragraph inside a table cell → replaceBlocks of the table", () => {
    const e = (editor = makeEditor(FIXTURES.table!));
    select(e, 7, 1);
    const c = cmd(change(e, () => press(e, "Enter"))) as Extract<WriteCommand, { type: "replaceBlocks" }>;
    expect(c.type).toBe("replaceBlocks");
    expect(c.ids).toEqual([2]);
    expect(c.blocks[0]!.kind).toBe("table");
    const json = JSON.stringify(c.blocks[0]);
    expect(json).toContain('"text":"B"');
    expect(json).toContain('"colWidths":[4513,4513]');
  });

  it("inserting a hard break → replaceBlocks of the paragraph", () => {
    const e = open([para(1, "ab")]);
    select(e, 1, 1);
    const c = cmd(change(e, () => e.commands.setHardBreak()));
    expect(c).toEqual({ type: "replaceBlocks", ids: [1], blocks: [para(1, [run("a"), { kind: "break", value: "line" }, run("b")])] });
  });

  it("selecting everything and deleting → replaceBlocks to one empty paragraph", () => {
    const e = open([para(1, "a"), para(2, "b")]);
    e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, 1, e.state.doc.content.size - 1)));
    const c = cmd(change(e, () => e.view.dispatch(e.state.tr.deleteSelection()))) as Extract<WriteCommand, { type: "replaceBlocks" }>;
    expect(c).toMatchObject({ type: "replaceBlocks", ids: [1, 2] });
    expect(c.blocks).toHaveLength(1);
    expect(c.blocks[0]!.value).toMatchObject({ inlines: [] });
  });
});

describe("classify", () => {
  it("removing blocks → deleteBlocks", () => {
    expect(classify([para(2, "x")], [], para(1, "a"))?.command).toEqual({ type: "deleteBlocks", ids: [2] });
  });

  it("new lists in a ReplaceBlocks use a known definition or get a follow-up ApplyList", () => {
    const blocks = [li(-5, "x", -1)];
    const known = classify([para(1, "a"), para(2, "b")], blocks, null, { listIdFor: () => 7 });
    expect(known?.command).toEqual({ type: "replaceBlocks", ids: [1, 2], blocks: [li(-5, "x", 7)] });
    const unknown = classify([para(1, "a"), para(2, "b")], blocks, null);
    expect(unknown?.command).toEqual({ type: "replaceBlocks", ids: [1, 2], blocks: [para(-5, "x", {})] });
    expect(unknown?.followUp).toEqual({ ids: [-5], kind: "bullet" });
  });
});
