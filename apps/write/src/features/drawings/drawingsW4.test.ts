// P9-W4 item 1: rotated resize math, snapping and nudging, group frames and
// member transforms, linked text box flow and chain edits, the drawing tool
// and the multi-object selection with Group / Ungroup.

import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import type { Anchor } from "../../generated/Anchor";
import type { Drawing } from "../../generated/Drawing";
import { makeDoc, para } from "../../test/fixtures";
import { blocksToPM } from "../../sync/toPM";
import { writeExtensions, writeSchema } from "../../sync/schema";
import { breakAfter, isEmptyBox, linkBoxes } from "./chainCommands";
import { drawnCommand, drawnRect } from "./drawTool";
import { propagateToMembers, selectedDrawing, selectMember } from "./drawings";
import {
  alignBoxes, bounds, distributeBoxes, groupMembers, memberAt, memberPath, nudgeDelta, NUDGE_PX, rotatedResize, scaleGroup, snapMove, toLocal, ungroupMembers,
  withMember,
} from "./geometry";
import { canGroup, groupSelected, objectsKey, objectsPlugin, selectedObjects, ungroupSelected } from "./objects";
import { chainSlices, fitLines, lineOf, nodeAt, pathOf } from "./textChain";
import { Extension } from "@tiptap/core";

const shape = (id: number, extra: Partial<Drawing> = {}): Drawing => ({ id, width: 952500, height: 476250, preset: "rect", ...extra });
const anchor = (x: number, y: number): Anchor => ({
  h: { relativeTo: "column", place: { kind: "offset", value: x } },
  v: { relativeTo: "paragraph", place: { kind: "offset", value: y } },
  wrap: "inFront",
  distance: { top: 0, bottom: 0, left: 0, right: 0 },
  allowOverlap: true,
});

describe("rotated frames", () => {
  it("a delta in the shape's own frame", () => {
    const d = toLocal(10, 0, 90);
    expect(d.x).toBeCloseTo(0);
    expect(d.y).toBeCloseTo(-10);
  });

  it("resizing from a handle keeps the opposite handle in place (unrotated and rotated)", () => {
    expect(rotatedResize("e", 100, 50, 20, 0, 0, false)).toEqual({ w: 120, h: 50, dx: 0, dy: 0 });
    expect(rotatedResize("w", 100, 50, -20, 0, 0, false)).toEqual({ w: 120, h: 50, dx: -20, dy: 0 });
    expect(rotatedResize("se", 100, 50, 10, 30, 0, true)).toMatchObject({ w: 160, h: 80 });
    // Rotated by 90°: the screen's downward drag is the shape's "east".
    const r = rotatedResize("e", 100, 50, 0, 20, 90, false);
    expect(r.w).toBe(120);
    expect(r.h).toBe(50);
    // The west edge (on screen: the top edge at x = 50 ± 25) stays; the centre moves down by 10.
    expect(r.dx).toBeCloseTo(-10);
    expect(r.dy).toBeCloseTo(10);
  });
});

describe("moving and nudging", () => {
  it("snaps edges and centres to guides within 5 px unless Alt is held", () => {
    const rect = { x: 0, y: 0, w: 100, h: 40 };
    const guides = { x: [0, 300, 600], y: [0] };
    expect(snapMove(rect, 197, 50, guides, false)).toMatchObject({ dx: 200, dy: 50, snapped: { x: 300 } });
    expect(snapMove(rect, 197, 50, guides, true)).toMatchObject({ dx: 197, dy: 50 });
    expect(snapMove(rect, 497, 2, guides, false)).toMatchObject({ dx: 500, dy: 0 });
  });

  it("arrow keys move by the grid, Ctrl+arrows by one pixel", () => {
    expect(nudgeDelta("ArrowLeft", false)).toEqual({ dx: -NUDGE_PX, dy: 0 });
    expect(nudgeDelta("ArrowDown", true)).toEqual({ dx: 0, dy: 1 });
    expect(nudgeDelta("a", false)).toBeNull();
    expect(NUDGE_PX).toBeCloseTo(12.48);
  });
});

describe("groups", () => {
  it("group members are placed in the common frame; ungroup puts them back", () => {
    const a = { ...shape(1), anchor: anchor(0, 0) };
    const b = shape(2, { rotation: 30 });
    const { children, frame } = groupMembers([a, b], [{ x: 1000, y: 2000, w: 100, h: 50 }, { x: 1300, y: 1900, w: 200, h: 100 }]);
    expect(frame).toEqual({ x: 1000, y: 1900, w: 500, h: 150 });
    expect(children[0]).toMatchObject({ id: 1, y: 100, width: 100, height: 50 });
    expect(children[0]!.x).toBeUndefined();
    expect(children[0]!.anchor).toBeUndefined();
    expect(children[1]).toMatchObject({ x: 300, width: 200, rotation: 30 });
    const g: Drawing = { id: 9, kind: "group", width: 500, height: 150, preset: "rect", children };
    const out = ungroupMembers(g, 1000, 1900);
    expect(out.map((o) => o.box)).toEqual([
      { x: 1000, y: 2000, w: 100, h: 50 },
      { x: 1300, y: 1900, w: 200, h: 100 },
    ]);
    // A rotated group: members turn around its centre and take its rotation.
    const r = ungroupMembers({ ...g, rotation: 180 }, 0, 0);
    expect(r[0]!.box).toEqual({ x: 400, y: 0, w: 100, h: 50 });
    expect(r[1]!.member.rotation).toBe(210);
  });

  it("scaling a group scales its members (nested groups too)", () => {
    const inner: Drawing = { id: 3, kind: "group", width: 100, height: 100, preset: "rect", y: 50, children: [shape(4, { width: 50, height: 100 })] };
    const g: Drawing = { id: 1, kind: "group", width: 200, height: 150, preset: "rect", children: [shape(2, { x: 100, width: 100, height: 50 }), inner] };
    const s = scaleGroup(g, 400, 300);
    expect(s.children![0]).toMatchObject({ x: 200, width: 200, height: 100 });
    expect(s.children![1]).toMatchObject({ y: 100, width: 200, height: 200 });
    expect(s.children![1]!.children![0]).toMatchObject({ width: 100, height: 200 });
    expect(bounds([{ x: 0, y: 0, w: 1, h: 1 }, { x: 5, y: -2, w: 1, h: 1 }])).toEqual({ x: 0, y: -2, w: 6, h: 3 });
  });

  it("members by path and id; Shape Format on a group formats its shapes", () => {
    const g: Drawing = { id: 1, kind: "group", width: 10, height: 10, preset: "rect", children: [shape(2), { id: 3, kind: "group", width: 1, height: 1, preset: "rect", children: [shape(4)] }] };
    expect(memberPath(g, 4)).toEqual([1, 0]);
    expect(memberAt(g, [1, 0])!.id).toBe(4);
    const g2 = withMember(g, [1, 0], shape(4, { rotation: 45 }));
    expect(memberAt(g2, [1, 0])!.rotation).toBe(45);
    expect(memberAt(g, [1, 0])!.rotation).toBeUndefined();
    const red = { kind: "solid", value: { kind: "rgb", value: "FF0000" } } as Drawing["fill"];
    const p = propagateToMembers(g, { ...g, fill: red });
    expect(p.children![0]!.fill).toEqual(red);
    expect(p.children![1]!.children![0]!.fill).toEqual(red);
  });
});

describe("align and distribute", () => {
  const boxes = [
    { x: 10, y: 10, w: 20, h: 10 },
    { x: 50, y: 40, w: 40, h: 20 },
    { x: 200, y: 0, w: 10, h: 10 },
  ];
  it("aligns edges and centres to a reference box", () => {
    const ref = { x: 0, y: 0, w: 300, h: 100 };
    expect(alignBoxes(boxes, "left", ref).map((m) => m.dx)).toEqual([-10, -50, -200]);
    expect(alignBoxes(boxes, "center", ref).map((m) => m.dx)).toEqual([130, 80, -55]);
    expect(alignBoxes(boxes, "bottom", ref).map((m) => m.dy)).toEqual([80, 40, 90]);
  });

  it("distributes with equal gaps between the outer boxes; one box centred on the page", () => {
    const d = distributeBoxes(boxes, "h", null);
    // Span 10..210, sizes 70 → gaps of 65: 10, 95, 200.
    expect(d.map((m) => m.dx)).toEqual([0, 45, 0]);
    expect(distributeBoxes([{ x: 0, y: 0, w: 100, h: 10 }], "h", { x: 0, y: 0, w: 500, h: 10 })).toEqual([{ dx: 200, dy: 0 }]);
  });
});

describe("linked text boxes", () => {
  const lines = [0, 20, 40, 60, 80].map((t) => ({ top: t, bottom: t + 18 }));
  it("fills each box with whole lines", () => {
    expect(fitLines(lines, 0, 40)).toEqual({ end: 2, top: 0, bottom: 38 });
    expect(fitLines(lines, 2, 100)).toEqual({ end: 5, top: 40, bottom: 98 });
    // At least one line per box.
    expect(fitLines(lines, 0, 5).end).toBe(1);
    expect(chainSlices(lines, [40, 25, 100])).toEqual([
      { from: 0, end: 2 },
      { from: 2, end: 3 },
      { from: 3, end: 5 },
    ]);
    expect(chainSlices(lines.slice(0, 1), [40, 40])).toEqual([
      { from: 0, end: 1 },
      { from: 1, end: 1 },
    ]);
  });

  it("character references survive a copy of the story", () => {
    const root = document.createElement("div");
    root.innerHTML = "<p>one</p><p>two <b>three</b></p>";
    const t = root.querySelector("b")!.firstChild!;
    const path = pathOf(root, t)!;
    expect(path).toEqual([1, 1, 0]);
    const copy = root.cloneNode(true) as HTMLElement;
    expect(nodeAt(copy, path)!.textContent).toBe("three");
    const story = [
      { top: 0, bottom: 10, start: { path: [0, 0], offset: 0 } },
      { top: 10, bottom: 20, start: { path: [1, 0], offset: 0 } },
    ];
    expect(lineOf(story, { path: [1, 1, 0], offset: 2 })).toBe(1);
    expect(lineOf(story, { path: [0, 0], offset: 2 })).toBe(0);
  });

  it("Create Link needs an empty, unlinked target; Break Link frees the later boxes", () => {
    const box = (id: number, text = ""): Drawing => ({
      id,
      kind: "textBox",
      width: 1,
      height: 1,
      preset: "rect",
      text: { blocks: [para(id * 10, text)] },
    });
    expect(isEmptyBox(box(1))).toBe(true);
    expect(isEmptyBox(box(1, "x"))).toBe(false);
    const r = linkBoxes(box(1, "story"), box(2), 7, false);
    expect(r).toMatchObject({ source: { chain: { id: 7, seq: 0 } }, target: { chain: { id: 7, seq: 1 } } });
    expect(linkBoxes(box(1, "story"), box(2, "full"), 7, false)).toBe("notEmpty");
    expect(linkBoxes(box(1), box(1), 7, false)).toBe("same");
    expect(linkBoxes(box(1), { ...box(2), chain: { id: 3, seq: 1 } }, 7, false)).toBe("linked");
    expect(linkBoxes(box(1), box(2), 7, true)).toBe("hasNext");
    expect(linkBoxes({ ...box(1), kind: "shape" }, box(2), 7, false)).toBe("notTextBox");
    // Continue the chain from its last box.
    const r2 = linkBoxes({ ...box(2), chain: { id: 7, seq: 1 } }, box(3), 8, false);
    expect(r2).toMatchObject({ target: { chain: { id: 7, seq: 2 } } });
    const chain = [0, 1, 2].map((seq) => ({ ...box(seq + 1), chain: { id: 7, seq } }));
    expect(breakAfter(chain[1]!, chain).map((d) => [d.id, d.chain])).toEqual([[3, undefined]]);
    expect(breakAfter(chain[0]!, chain).map((d) => d.id).sort()).toEqual([1, 2, 3]);
  });
});

describe("drawing tool", () => {
  it("the drawn rectangle, square with Shift, lines at 45°", () => {
    expect(drawnRect({ x: 10, y: 10 }, { x: 50, y: 30 }, false)).toEqual({ x: 10, y: 10, w: 40, h: 20 });
    expect(drawnRect({ x: 10, y: 10 }, { x: 0, y: 0 }, false)).toEqual({ x: 0, y: 0, w: 10, h: 10 });
    expect(drawnRect({ x: 0, y: 0 }, { x: 50, y: 30 }, true)).toEqual({ x: 0, y: 0, w: 50, h: 50 });
    expect(drawnRect({ x: 0, y: 0 }, { x: 50, y: 4 }, true, true)).toEqual({ x: 0, y: 0, w: 50, h: 0 });
  });

  it("a click inserts the default size in front of the text, a drag the drawn size", () => {
    const click = drawnCommand("ellipse", 3, 2, { x: 100, y: 20, w: 0, h: 0 });
    expect(click).toMatchObject({ type: "insertDrawing", block: 3, offset: 2, kind: "shape", preset: "ellipse", width: 900000, height: 900000 });
    expect(click.type === "insertDrawing" && click.anchor).toMatchObject({ wrap: "inFront", h: { place: { value: 952500 } }, v: { place: { value: 190500 } } });
    const drag = drawnCommand("textBox", 3, 0, { x: 0, y: 0, w: 200, h: 100 });
    expect(drag).toMatchObject({ kind: "textBox", preset: "rect", width: 1905000, height: 952500, text: "", anchor: { wrap: "square" } });
  });
});

describe("selecting several objects; Group and Ungroup", () => {
  let editor: Editor | null = null;
  afterEach(() => {
    editor?.destroy();
    editor = null;
  });

  function mount(): Editor {
    const doc = makeDoc([
      para(1, [
        { kind: "run", value: { text: "Text " } },
        { kind: "drawing", value: { ...shape(10), anchor: anchor(0, 0) } },
        { kind: "drawing", value: { ...shape(11), anchor: anchor(952500, 0) } },
        { kind: "image", value: { media: 5, width: 476250, height: 476250, anchor: anchor(0, 952500) } },
      ]),
    ]);
    const schema = writeSchema();
    const nodes = blocksToPM({ schema, numbering: doc.numbering }, doc.body);
    editor = new Editor({
      element: document.createElement("div"),
      extensions: [...writeExtensions(), Extension.create({ name: "objectsTest", addProseMirrorPlugins: () => [objectsPlugin()] })],
      content: { type: "doc", content: nodes.map((n) => n.toJSON()) },
    });
    return editor;
  }

  const positions = (e: Editor) => {
    const out: number[] = [];
    e.state.doc.descendants((n, pos) => {
      if (n.type.name === "drawing" || n.type.name === "image") out.push(pos);
      return true;
    });
    return out;
  };

  it("the node selection plus the added objects; another selection ends the set", () => {
    const e = mount();
    const [a, b, c] = positions(e);
    e.view.dispatch(e.state.tr.setSelection(NodeSelection.create(e.state.doc, a!)).setMeta(objectsKey, { extra: [b!, c!] }));
    expect(selectedObjects(e.state).map((o) => o.pos)).toEqual([a, b, c]);
    expect(canGroup(e.state)).toBe(true);
    e.commands.setTextSelection(2);
    expect(selectedObjects(e.state)).toEqual([]);
  });

  it("Group makes one group of the objects (members keep their ids, a picture member), Ungroup splits it", () => {
    const e = mount();
    const [a, b, c] = positions(e);
    // Rendered frames (jsdom has no layout).
    const rects: Record<number, DOMRect> = {
      [a!]: new DOMRect(100, 100, 100, 50),
      [b!]: new DOMRect(200, 100, 100, 50),
      [c!]: new DOMRect(100, 200, 50, 50),
    };
    const nodeDOM = e.view.nodeDOM.bind(e.view);
    e.view.nodeDOM = (pos: number) => {
      const el = nodeDOM(pos) as HTMLElement | null;
      if (el && rects[pos]) el.getBoundingClientRect = () => rects[pos]!;
      return el;
    };
    e.view.dispatch(e.state.tr.setSelection(NodeSelection.create(e.state.doc, a!)).setMeta(objectsKey, { extra: [b!, c!] }));
    expect(groupSelected(e.view)).toBe(true);
    const sel = e.state.selection as NodeSelection;
    const g = sel.node.attrs.value as Drawing;
    expect(g.kind).toBe("group");
    expect(g.id).toBeLessThan(0);
    expect(g.width).toBe(200 * 9525);
    expect(g.height).toBe(150 * 9525);
    expect(g.children!.map((m) => [m.id, m.kind ?? "shape", m.x ?? 0, m.y ?? 0])).toEqual([
      [10, "shape", 0, 0],
      [11, "shape", 952500, 0],
      [expect.any(Number), "picture", 0, 952500],
    ]);
    expect(g.children![2]!.picture).toEqual({ media: 5 });
    expect(positions(e)).toHaveLength(1);
    // Select a member: Shape Format edits it.
    selectMember(e.view, g.id, 11);
    expect(selectedDrawing(e.state)).toMatchObject({ value: { id: 11 }, path: [1] });
    selectMember(e.view, g.id, null);
    expect(ungroupSelected(e.view)).toBe(true);
    const after: string[] = [];
    e.state.doc.descendants((n) => {
      if (n.type.name === "drawing") after.push(`d${(n.attrs.value as Drawing).id}`);
      if (n.type.name === "image") after.push(`i${n.attrs.mediaId}`);
      return true;
    });
    expect(after).toEqual(["d10", "d11", "i5"]);
    expect(selectedObjects(e.state)).toHaveLength(3);
  });
});
