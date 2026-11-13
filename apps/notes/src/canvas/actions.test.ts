import { Editor } from "@tiptap/core";
import { LoroDoc, UndoManager } from "loro-crdt";
import { afterEach, describe, expect, it } from "vitest";
import { LoroBinding, editorUndo } from "../editor/binding";
import type { PageMirror } from "../editor/mirror";
import { notesSchemaExtensions } from "../editor/schema";
import { createTextBox, deleteItems, enterCanvas, leaveCanvas, moveItems, recolor } from "./actions";
import { ptToPx } from "./geometry";
import { assignBlocks, CanvasLayout, canvasBoxes, layoutBoxes, setLayout } from "./layout";
import { addStroke, CanvasSteps, isCanvasPage, readItems, readStrokes } from "./model";

const tick = () => new Promise((r) => setTimeout(r, 0));
let editors: Editor[] = [];
afterEach(() => {
  for (const e of editors) e.destroy();
  editors = [];
});

async function setup(html = "<p>Hello</p><p>World</p>") {
  const doc = new LoroDoc();
  doc.setPeerId(9);
  const undo = new UndoManager(doc, { mergeInterval: 1000, maxUndoSteps: 100 });
  const mirror = { doc, undo } as unknown as PageMirror;
  const steps = new CanvasSteps({ doc, undo }, 1000);
  const editor = new Editor({ element: document.createElement("div"), extensions: [...notesSchemaExtensions(), LoroBinding(mirror), CanvasLayout.configure({ steps })] });
  editors.push(editor);
  await tick();
  editor.commands.setContent(html);
  doc.commit();
  // Steps after the content (merging would join them otherwise).
  undo.setMergeInterval(0);
  undo.setMergeInterval(1000);
  const ctx = { view: editor.view, doc, steps };
  /** Feeds the layout the doc's items (the canvas view does this on every canvas change). */
  const sync = () =>
    setLayout(editor.view, {
      enabled: isCanvasPage(doc),
      items: readItems(doc)
        .filter((i) => i.kind === "text")
        .map((i, z) => ({ id: i.id, x: ptToPx(i.x), y: ptToPx(i.y), w: ptToPx(i.w), z })),
    });
  return { doc, undo, editor, ctx, sync };
}

const boxAttrs = (e: Editor) => (e.getJSON().content ?? []).map((n) => n.attrs?.canvasItem ?? null);
const texts = (e: Editor) => (e.getJSON().content ?? []).map((n) => (n.content ?? []).map((c) => (c as { text?: string }).text ?? "").join(""));

describe("canvas layout (pure)", () => {
  it("assigns orphan blocks to the previous box, leading ones to the first", () => {
    expect(assignBlocks([null, "a", null, "b", "zz", "b"], new Set(["a", "b"]))).toEqual(["a", "a", "a", "b", "b", "b"]);
    expect(assignBlocks([null, null], new Set())).toEqual(["", ""]);
  });

  it("stacks a box's blocks with a gap and sizes it", () => {
    const items = new Map([
      ["a", { id: "a", x: 10, y: 20, w: 100, z: 0 }],
      ["b", { id: "b", x: 300, y: 0, w: 0, z: 1 }],
    ]);
    const blocks = [
      { box: "a", from: 0, to: 5, empty: false },
      { box: "b", from: 5, to: 9, empty: false },
      { box: "a", from: 9, to: 12, empty: true },
    ];
    const { tops, boxes } = layoutBoxes(blocks, items, [30, 40, 10], [100, 250, 80]);
    expect(tops).toEqual([20, 0, 55]);
    expect(boxes.find((b) => b.id === "a")).toMatchObject({ x: 10, y: 20, w: 100, h: 45, blocks: [0, 2], empty: false });
    expect(boxes.find((b) => b.id === "b")).toMatchObject({ w: 250, h: 40, z: 1 });
  });
});

describe("canvas actions on the page editor", () => {
  it("switching to canvas makes the content one box at (0, 0) in one undo step", async () => {
    const { doc, editor, ctx, sync } = await setup();
    enterCanvas(ctx);
    sync();
    const items = readItems(doc);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "text", x: 0, y: 0 });
    expect(boxAttrs(editor)).toEqual([items[0]!.id, items[0]!.id]);
    expect(isCanvasPage(doc)).toBe(true);
    const box = canvasBoxes(editor.state);
    expect(box).toHaveLength(1);
    expect(editor.view.dom.querySelector("p")!.getAttribute("style")).toContain("left: 0px");
    expect(editorUndo(editor.state, editor.view.dispatch)).toBe(true);
    await tick();
    expect(isCanvasPage(doc)).toBe(false);
    expect(readItems(doc)).toHaveLength(0);
    expect(boxAttrs(editor)).toEqual([null, null]);
  });

  it("a click creates a box with the caret in it; clicking again moves the still empty box", async () => {
    const { doc, editor, ctx, sync } = await setup();
    enterCanvas(ctx);
    sync();
    const id = createTextBox(ctx, 200, 100);
    sync();
    expect(readItems(doc).map((i) => i.id)).toContain(id);
    expect(boxAttrs(editor).at(-1)).toBe(id);
    editor.commands.insertContent("x");
    expect(texts(editor).at(-1)).toBe("x");
    // An empty box is reused by the next click.
    editor.commands.deleteRange({ from: editor.state.selection.from - 1, to: editor.state.selection.from });
    sync();
    const again = createTextBox(ctx, 50, 400);
    sync();
    expect(again).toBe(id);
    expect(readItems(doc).find((i) => i.id === id)).toMatchObject({ x: 50, y: 400 });
    expect(readItems(doc)).toHaveLength(2);
  });

  it("switching back flows boxes in reading order, strips canvasItem, keeps strokes", async () => {
    const { doc, editor, ctx, sync } = await setup("<p>Lower</p>");
    enterCanvas(ctx);
    sync();
    const first = readItems(doc)[0]!;
    moveItems(ctx, [{ id: first.id, x: 0, y: 300 }], new Set(), 0, 0);
    sync();
    createTextBox(ctx, 400, 10);
    editor.commands.insertContent("Upper right");
    sync();
    createTextBox(ctx, 0, 10);
    editor.commands.insertContent("Upper left");
    sync();
    ctx.steps.step(() => addStroke(doc, { id: "s1", tool: "pen", color: "#000000", width: 20, points: [0, 0, 128] }));
    leaveCanvas(ctx);
    expect(texts(editor)).toEqual(["Upper left", "Upper right", "Lower"]);
    expect(boxAttrs(editor)).toEqual([null, null, null]);
    expect(readItems(doc)).toEqual([]);
    expect(readStrokes(doc)).toHaveLength(1);
    expect(isCanvasPage(doc)).toBe(false);
  });

  it("deletes boxes with their text; recolours box text and strokes", async () => {
    const { doc, editor, ctx, sync } = await setup("<p>Keep</p>");
    enterCanvas(ctx);
    sync();
    const id = createTextBox(ctx, 300, 0);
    editor.commands.insertContent("Gone");
    sync();
    ctx.steps.step(() => addStroke(doc, { id: "s1", tool: "pen", color: "#000000", width: 20, points: [0, 0, 128] }));
    const keep = readItems(doc)[0]!.id;
    recolor(ctx, new Set([keep]), new Set(["s1"]), "#7719AA");
    expect(readStrokes(doc)[0]!.color).toBe("#7719AA");
    expect(JSON.stringify(editor.getJSON())).toContain("#7719AA");
    deleteItems(ctx, new Set([id]), new Set(["s1"]));
    sync();
    expect(texts(editor)).toEqual(["Keep"]);
    expect(readItems(doc).map((i) => i.id)).toEqual([keep]);
    expect(readStrokes(doc)).toHaveLength(0);
    // Deleting the last box leaves an empty paragraph (a document has a block).
    deleteItems(ctx, new Set([keep]), new Set());
    expect(texts(editor)).toEqual([""]);
  });
});
