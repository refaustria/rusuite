import { LoroDoc, UndoManager } from "loro-crdt";
import { describe, expect, it } from "vitest";
import { addItem, addStroke, CanvasSteps, isCanvasPage, newId, patchItems, patchStrokes, readItems, readStrokes, removeItems, removeStrokes, reorderItems, setCanvasMeta } from "./model";

function setup() {
  const doc = new LoroDoc();
  doc.setPeerId(7);
  const undo = new UndoManager(doc, { mergeInterval: 1000, maxUndoSteps: 100 });
  return { doc, undo, steps: new CanvasSteps({ doc, undo }, 1000) };
}

const item = (id: string, x = 0, y = 0) => ({ id, kind: "text", x, y, w: 200, h: 0, blob: null });
const stroke = (id: string) => ({ id, tool: "pen", color: "#000000", width: 20, points: [0, 0, 128, 100, 100, 200] });

describe("canvas model", () => {
  it("writes and reads items and strokes in the notes-format layout", () => {
    const { doc } = setup();
    addItem(doc, item("c1", 10, 20));
    addItem(doc, { id: "c2", kind: "image", x: 1, y: 2, w: 30, h: 40, blob: "ab" });
    addStroke(doc, stroke("s1"));
    setCanvasMeta(doc, true);
    doc.commit();
    expect(isCanvasPage(doc)).toBe(true);
    expect(readItems(doc)).toEqual([item("c1", 10, 20), { id: "c2", kind: "image", x: 1, y: 2, w: 30, h: 40, blob: "ab" }]);
    expect(readStrokes(doc)).toEqual([stroke("s1")]);
    expect(doc.toJSON().ink[0].points).toEqual([0, 0, 128, 100, 100, 200]);
  });

  it("patches, reorders and removes", () => {
    const { doc } = setup();
    for (const id of ["a", "b", "c", "d"]) addItem(doc, item(id));
    patchItems(doc, [{ id: "b", x: 5, w: 99 }]);
    expect(readItems(doc)[1]).toMatchObject({ id: "b", x: 5, w: 99, y: 0 });
    reorderItems(doc, new Set(["a", "c"]), "front");
    expect(readItems(doc).map((i) => i.id)).toEqual(["b", "d", "a", "c"]);
    reorderItems(doc, new Set(["c"]), "back");
    expect(readItems(doc).map((i) => i.id)).toEqual(["c", "b", "d", "a"]);
    removeItems(doc, ["b", "zz"]);
    expect(readItems(doc).map((i) => i.id)).toEqual(["c", "d", "a"]);
    addStroke(doc, stroke("s1"));
    addStroke(doc, stroke("s2"));
    patchStrokes(doc, [{ id: "s2", color: "#ff0000", points: [1, 2, 3] }]);
    expect(readStrokes(doc)[1]).toMatchObject({ color: "#ff0000", points: [1, 2, 3] });
    removeStrokes(doc, new Set(["s1"]));
    expect(readStrokes(doc).map((s) => s.id)).toEqual(["s2"]);
  });

  it("each stroke is one undo step, also right after typing and before typing", () => {
    const { doc, undo, steps } = setup();
    const text = doc.getText("t");
    text.insert(0, "a");
    doc.commit();
    steps.step(() => addStroke(doc, stroke("s1")));
    steps.step(() => addStroke(doc, stroke("s2")));
    // Typing right after the stroke: its own step (merging resumes after its first commit).
    text.insert(1, "b");
    doc.commit();
    steps.afterForeignCommit();
    text.insert(2, "c");
    doc.commit();
    const state = () => [
      doc.getText("t").toString(),
      readStrokes(doc)
        .map((s) => s.id)
        .join(","),
    ];
    expect(state()).toEqual(["abc", "s1,s2"]);
    undo.undo();
    expect(state()).toEqual(["a", "s1,s2"]);
    undo.undo();
    expect(state()).toEqual(["a", "s1"]);
    undo.undo();
    expect(state()).toEqual(["a", ""]);
    undo.redo();
    expect(state()).toEqual(["a", "s1"]);
  });

  it("a step groups several commits", () => {
    const { doc, undo, steps } = setup();
    steps.step(() => {
      addItem(doc, item("c1"));
      doc.commit();
      setCanvasMeta(doc, true);
    });
    expect(readItems(doc)).toHaveLength(1);
    undo.undo();
    expect(readItems(doc)).toHaveLength(0);
    expect(isCanvasPage(doc)).toBe(false);
  });

  it("ids are prefixed and random", () => {
    expect(newId("c")).toMatch(/^c-[0-9a-f]{12}$/);
    expect(newId("s")).not.toBe(newId("s"));
  });
});
