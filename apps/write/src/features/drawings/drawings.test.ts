// P8-34: shapes and text boxes in the sync layer (toPM/fromPM, canonical
// form, the transaction mapper: shape changes → SetDrawingProps, text box
// edits → text commands addressed to the paragraphs inside), picture
// format / link mapping, and the drawing helpers (gallery command, styles,
// rotation, outline cache, adjust handles).

import { afterEach, describe, expect, it, vi } from "vitest";
import { NodeSelection } from "@tiptap/pm/state";
import type { Block } from "../../generated/Block";
import type { Drawing } from "../../generated/Drawing";
import type { Inline } from "../../generated/Inline";
import { fromPM } from "../../sync/fromPM";
import { blockKey, canonDrawing } from "../../sync/model";
import { writeSchema } from "../../sync/schema";
import { toPM } from "../../sync/toPM";
import { drawingShell, mapDocChange, sanitizeDrawingIds } from "../../sync/transactionMapper";
import { makeEditor, select } from "../../test/harness";
import { makeDoc, para, run } from "../../test/fixtures";
import {
  dashArray, defaultSize, flipped, insertDrawingCommand, rotated, SHAPE_GROUPS, SHAPE_STYLES, strokeAttrs, withShapeStyle,
} from "./drawings";
import { dragHandle, effectiveAdjust, handleFocusOf, handlePos, handlesOf, setHandleFocus } from "./handles";
import { adjustHandleKey } from "./objects";
import { pathKey, pathQuery, rectOutline, shapePaths } from "./paths";
import { rotationAt } from "./drawingView";

const theme = (slot: string, tint = 0) => ({ kind: "theme", value: { slot, tint } }) as never;

function shape(text: Block[] | null = [para(31, "Inside")]): Drawing {
  const d: Drawing = {
    id: 30,
    width: 1828800,
    height: 914400,
    preset: "roundRect",
    fill: { kind: "solid", value: theme("accent1") },
    line: { fill: { kind: "solid", value: theme("accent1", -0.5) }, width: 12700 },
    textColor: theme("light1"),
  };
  if (text) d.text = { blocks: text, verticalAlign: "center" };
  return d;
}

const drawingInline = (d: Drawing): Inline => ({ kind: "drawing", value: d });
const docWith = (d: Drawing) => makeDoc([para(1, [run("He"), drawingInline(d), run("llo")]), para(2, "After")]);

/** The PM position of the first drawing node. */
function drawingPos(editor: ReturnType<typeof makeEditor>): number {
  let at = -1;
  editor.state.doc.descendants((n, p) => {
    if (at < 0 && n.type.name === "drawing") at = p;
    return at < 0;
  });
  return at;
}

/** Replaces the drawing's value in the editor and maps the change. */
function changeDrawing(d0: Drawing, f: (d: Drawing) => Drawing) {
  const editor = makeEditor(docWith(d0));
  const before = editor.state.doc;
  const pos = drawingPos(editor);
  const node = before.nodeAt(pos)!;
  editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { value: canonDrawing(f(structuredClone(node.attrs.value as Drawing))) }));
  return mapDocChange(before, editor.state.doc);
}

afterEach(() => {
  shapePaths.fetcher = null;
  shapePaths.clear();
  vi.useRealTimers();
});

describe("drawings in the sync layer", () => {
  it("toPM / fromPM keep a shape with its text (one atom per drawing)", () => {
    const doc = docWith(shape());
    const pm = toPM(doc, writeSchema());
    const node = pm.firstChild!;
    expect(node.childCount).toBe(3);
    expect(node.child(1).type.name).toBe("drawing");
    expect(node.child(1).isAtom).toBe(true);
    const back = fromPM(pm);
    expect(blockKey(back[0]!)).toBe(blockKey(doc.body[0]!));
  });

  it("the canonical form leaves out what Rust leaves out", () => {
    const d = canonDrawing({
      ...shape(),
      kind: "shape",
      rotation: 0,
      flipH: false,
      adjust: {},
      text: { blocks: [para(31, "x")], insets: { top: 45720, bottom: 45720, left: 91440, right: 91440 }, verticalAlign: "top", autofit: "none", wrap: true },
    });
    expect(d.kind).toBeUndefined();
    expect(d.rotation).toBeUndefined();
    expect(d.flipH).toBeUndefined();
    expect(d.adjust).toBeUndefined();
    expect(d.text).toEqual({ blocks: [para(31, "x")] });
    expect(canonDrawing({ ...shape(), fill: { kind: "none" }, line: { fill: { kind: "none" }, width: 9525 } }).line).toBeUndefined();
  });

  it("a geometry / fill change of the shape → SetDrawingProps without the text blocks", () => {
    const r = changeDrawing(shape(), (d) => ({ ...d, preset: "ellipse", fill: { kind: "solid", value: theme("accent2") } }));
    expect(r?.command.type).toBe("setDrawingProps");
    const c = r!.command as Extract<NonNullable<typeof r>["command"], { type: "setDrawingProps" }>;
    expect(c.block).toBe(1);
    expect(c.offset).toBe(2);
    expect(c.drawing.preset).toBe("ellipse");
    expect(c.drawing.text?.blocks).toEqual([]);
  });

  it("typing in the text box → InsertText addressed to the paragraph inside", () => {
    const r = changeDrawing(shape(), (d) => ({ ...d, text: { ...d.text!, blocks: [para(31, "Inside!")] } }));
    expect(r?.command).toEqual({ type: "insertText", block: 31, offset: 6, text: "!", props: {} });
  });

  it("Enter in the text box → SplitParagraph of the paragraph inside", () => {
    const r = changeDrawing(shape(), (d) => ({ ...d, text: { ...d.text!, blocks: [para(31, "Ins"), para(-5, "ide")] } }));
    expect(r?.command).toEqual({ type: "splitParagraph", block: 31, offset: 3, newId: -5 });
  });

  it("a change the text commands cannot express → SetDrawingText with all blocks", () => {
    const two = shape([para(31, "a"), para(32, "b")]);
    const r = changeDrawing(two, (d) => ({ ...d, text: { ...d.text!, blocks: [para(31, "a1"), para(32, "b1")] } }));
    expect(r?.command.type).toBe("setDrawingText");
    const c = r!.command as Extract<NonNullable<typeof r>["command"], { type: "setDrawingText" }>;
    expect(c.blocks?.map((b) => b.value.id)).toEqual([31, 32]);
  });

  it("shape and text changed together → SetDrawingProps then the text command", () => {
    const r = changeDrawing(shape(), (d) => ({ ...d, rotation: 45, text: { ...d.text!, blocks: [para(31, "Insid")] } }));
    expect(r?.command.type).toBe("compound");
    const cmds = (r!.command as Extract<NonNullable<typeof r>["command"], { type: "compound" }>).commands;
    expect(cmds.map((c) => c.type)).toEqual(["setDrawingProps", "deleteText"]);
  });

  it("picture format and link changes → SetImageFormat / SetImageLink", () => {
    const img: Inline = { kind: "image", value: { media: 1, width: 952500, height: 952500 } };
    const editor = makeEditor(makeDoc([para(1, [img])]));
    const before = editor.state.doc;
    const node = before.nodeAt(1)!;
    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(1, undefined, { ...node.attrs, format: { crop: { left: 10000, top: 0, right: 0, bottom: 0 } }, link: { target: { kind: "url", value: "https://x.test/" } } }),
    );
    const r = mapDocChange(before, editor.state.doc);
    expect(r?.command).toEqual({
      type: "compound",
      commands: [
        { type: "setImageFormat", block: 1, offset: 0, format: { crop: { left: 10000, top: 0, right: 0, bottom: 0 } } },
        { type: "setImageLink", block: 1, offset: 0, link: { target: { kind: "url", value: "https://x.test/" } } },
      ],
    });
  });

  it("temporary ids inside drawings become 0 in fallback blocks (the core gives fresh ones)", () => {
    const blocks = sanitizeDrawingIds([para(-3, [drawingInline({ ...shape([para(-9, "x")]), id: -4 })])]);
    const p = blocks[0]!.value as { id: number; inlines: Inline[] };
    expect(p.id).toBe(-3);
    const d = (p.inlines[0] as Extract<Inline, { kind: "drawing" }>).value;
    expect(d.id).toBe(0);
    expect(d.text!.blocks[0]!.value.id).toBe(0);
    expect(drawingShell(shape()).text).toEqual({ blocks: [], verticalAlign: "center" });
  });
});

describe("drawing helpers", () => {
  it("the gallery item at the caret → InsertDrawing with Word's default size", () => {
    const editor = makeEditor(makeDoc([para(1, "Hello")]));
    select(editor, 1, 2);
    expect(insertDrawingCommand(editor, "roundRect")).toEqual({ type: "insertDrawing", block: 1, offset: 2, kind: "shape", preset: "roundRect", width: 900000, height: 900000 });
    expect(insertDrawingCommand(editor, "textBox", { text: "" })).toMatchObject({ kind: "textBox", preset: "rect", width: 1800000, height: 900000, text: "" });
    expect(defaultSize("rightArrow", "shape").width).toBeGreaterThan(defaultSize("rightArrow", "shape").height);
    expect(SHAPE_GROUPS.flatMap((g) => g.items)).toContain("textBox");
  });

  it("Shape Styles: 18 presets (3 rows × 6 accents), applied as fill, outline and text colour", () => {
    expect(SHAPE_STYLES).toHaveLength(18);
    const d = withShapeStyle(shape(), SHAPE_STYLES[7]!);
    expect(d.fill).toEqual({ kind: "solid", value: theme("accent2", 0.8) });
    expect(d.textColor).toEqual(theme("dark1"));
  });

  it("rotate and flip keep the model's defaults out", () => {
    expect(rotated(shape(), 90).rotation).toBe(90);
    expect(rotated(rotated(shape(), 90), -90).rotation).toBeUndefined();
    expect(rotated(shape(), -90).rotation).toBe(270);
    const f = flipped(shape(), "h");
    expect(f.flipH).toBe(true);
    expect(flipped(f, "h").flipH).toBeUndefined();
    expect(rotationAt(0, 0, 10, 0)).toBe(90);
    expect(rotationAt(0, 0, 0, -10)).toBe(0);
    expect(rotationAt(0, 0, 10, 9, true)).toBe(135);
  });

  it("outline strokes and dashes", () => {
    expect(strokeAttrs({ fill: { kind: "none" }, width: 12700 }).stroke).toBe("none");
    const s = strokeAttrs({ fill: { kind: "solid", value: { kind: "rgb", value: "FF0000" } as never }, width: 19050, dash: "dash" });
    expect(s.stroke).toBe("#FF0000");
    expect(s.width).toBe(2);
    expect(s.dash).toBe("8 6");
    expect(dashArray("solid", 1)).toBe("");
  });

  it("outline cache: queries are batched, rounded to pixels, rectangles meanwhile", async () => {
    const fetcher = vi.fn(async (qs: { preset: string; w: number; h: number }[]) => qs.map((q) => ({ paths: [{ d: `M0 0 L${q.w} ${q.h}`, fill: false, stroke: true }], defaults: {} })));
    shapePaths.fetcher = fetcher;
    const a = pathQuery("ellipse", 952600, 952400);
    expect(a.w).toBe(952500);
    expect(pathKey(a)).toBe("ellipse|952500x952500|");
    expect(shapePaths.get(a)).toBeNull();
    shapePaths.get(pathQuery("star5", 9525 * 20, 9525 * 20, { adj: 19098 }));
    const out = await shapePaths.load(a);
    expect(out.paths[0]!.d).toBe("M0 0 L952500 952500");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]![0]).toHaveLength(2);
    expect(rectOutline(a).paths[0]!.d).toBe("M0 0 L952500 0 L952500 952500 L0 952500 Z");
  });

  it("adjust handles: a rounded rectangle's corner handle moves along the top edge", () => {
    // the core's handle of roundRect in a 2000000 × 1000000 box (shapePaths, core_model::geometry)
    const outline = { paths: [], defaults: { adj: 16667 }, handles: [{ x: 166670, y: 0, xAxis: { adj: "adj", base: 0, k: 10, min: 0, max: 50000 } }] };
    const [h] = handlesOf(outline, 2000000, 1000000);
    const adj = effectiveAdjust({ adj: 16667 }, undefined);
    expect(handlePos(h!, adj)).toEqual({ x: 166670, y: 0 });
    expect(dragHandle(h!, { x: 250000, y: 0 })).toEqual({ adj: 25000 });
    expect(dragHandle(h!, { x: 900000, y: 0 })).toEqual({ adj: 50000 });
    expect(handlesOf({ paths: [], defaults: {} }, 1, 1)).toEqual([]);
    expect(handlesOf(null, 1, 1)).toEqual([]);
  });

  it("adjust handles from the keyboard: Tab cycles, arrows move the focused one in screen directions (P9-X1)", async () => {
    const k = 1828800 / 2 / 100000; // roundRect's corner: the shorter side / 100000 per unit
    const outline = { paths: [], defaults: { adj: 16667 }, handles: [{ x: 16667 * k, y: 0, xAxis: { adj: "adj", base: 0, k, min: 0, max: 50000 } }] };
    shapePaths.fetcher = async (qs) => qs.map(() => outline);
    const d: Drawing = { ...shape(), rotation: 90 };
    const editor = makeEditor(docWith(d));
    const pos = drawingPos(editor);
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)));
    await shapePaths.load(pathQuery(d.preset, d.width, d.height, null));
    const key = (k: string, shiftKey = false) =>
      adjustHandleKey(editor.view, { key: k, shiftKey, altKey: false, ctrlKey: false, metaKey: false, preventDefault: () => {} });
    expect(key("ArrowDown")).toBe(false); // no handle focused: the arrows nudge the object
    expect(key("Tab")).toBe(true);
    expect(handleFocusOf(30)).toBe(0);
    // turned a quarter: the top edge runs down the screen, so "down" grows the corner
    expect(key("ArrowDown", true)).toBe(true);
    const v = editor.state.doc.nodeAt(pos)!.attrs.value as Drawing;
    expect(v.adjust).toEqual({ adj: Math.round((16667 * k + 10 * 9525) / k) });
    // the outline for the new values is still loading: the last handles stand in
    expect(key("ArrowUp", true)).toBe(true);
    expect((editor.state.doc.nodeAt(pos)!.attrs.value as Drawing).adjust).toEqual({ adj: 16667 });
    expect(key("Tab")).toBe(true);
    expect(handleFocusOf(30)).toBeNull();
    expect(key("Tab", true)).toBe(true);
    expect(handleFocusOf(30)).toBe(0);
    expect(key("Escape")).toBe(true);
    expect(handleFocusOf(30)).toBeNull();
    setHandleFocus(null, null);
  });

  it("selecting a drawing as an object: NodeSelection on the atom", () => {
    const editor = makeEditor(docWith(shape()));
    const pos = drawingPos(editor);
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)));
    expect((editor.state.selection as NodeSelection).node.type.name).toBe("drawing");
  });
});
