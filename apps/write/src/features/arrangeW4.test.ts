// P9-W4 item 4: z-order (Bring Forward …), the Selection Pane's rows,
// Layout › Position values ↔ anchors, positions relative to the margins and
// as percentages, drawing canvases (new members, Fit).

import { describe, expect, it } from "vitest";
import type { Anchor } from "../generated/Anchor";
import type { Drawing } from "../generated/Drawing";
import { makeDoc, para } from "../test/fixtures";
import { makeEditor } from "../test/harness";
import { anchorOfLayout, layoutValues, paneRows } from "../ui/arrangeControls";
import { defaultSize, fitCanvas, insertDrawingCommand } from "./drawings/drawings";
import { canvasMember } from "./drawings/drawTool";
import { allObjects, defaultName, reorder, Z_BASE, Z_STEP } from "./drawings/objects";
import { floatPlacement, horizontalPos, newAnchor, verticalPos, zIndex, type FloatContext } from "./floating";

const anchor = (extra: Partial<Anchor> = {}): Anchor => ({ ...newAnchor("inFront"), ...extra });

describe("z-order", () => {
  const items = [
    { key: 1, z: 0 },
    { key: 2, z: 0 },
    { key: 3, z: 0 },
  ];
  it("Bring to Front / Send to Back / Forward / Backward renumber Word's relativeHeight", () => {
    // Without own z: document order; the first object comes to the front.
    const front = reorder(items, 1, "front");
    expect([...front.entries()]).toEqual([
      [2, Z_BASE + Z_STEP],
      [3, Z_BASE + 2 * Z_STEP],
      [1, Z_BASE + 3 * Z_STEP],
    ]);
    const z = (m: Map<number, number>, k: number, cur = 0) => m.get(k) ?? cur;
    const placed = [1, 2, 3].map((k, i) => ({ key: k, z: Z_BASE + (i + 1) * Z_STEP }));
    expect(reorder(placed, 3, "back").get(3)).toBe(Z_BASE + Z_STEP);
    const fwd = reorder(placed, 1, "forward");
    expect(z(fwd, 1)).toBe(Z_BASE + 2 * Z_STEP);
    expect(z(fwd, 2)).toBe(Z_BASE + Z_STEP);
    expect(fwd.has(3)).toBe(false);
    expect(reorder(placed, 1, "backward").size).toBe(0);
    expect(reorder(placed, 9, "front").size).toBe(0);
  });

  it("z-index: in front above the text by z-order, behind below it", () => {
    expect(zIndex(anchor({ z: Z_BASE + 2048 }))).toBe("2051");
    expect(zIndex(anchor({ z: 4 }))).toBe("7");
    expect(Number(zIndex(anchor({ wrap: "behind", z: Z_BASE + 5 })))).toBeLessThan(0);
    expect(Number(zIndex(anchor({ wrap: "behind", z: Z_BASE + 5 })))).toBeGreaterThan(Number(zIndex(anchor({ wrap: "behind", z: Z_BASE + 1 }))));
  });
});

describe("Selection Pane", () => {
  it("lists every object top-most first with Word's default names", () => {
    const e = makeEditor(
      makeDoc([
        para(1, [
          { kind: "image", value: { media: 1, width: 10, height: 10, anchor: anchor({ z: Z_BASE + 3 * Z_STEP }) } },
          { kind: "drawing", value: { id: 10, kind: "textBox", width: 10, height: 10, preset: "rect", text: { blocks: [para(11)] }, anchor: anchor({ z: Z_BASE + Z_STEP }) } },
          { kind: "drawing", value: { id: 12, width: 10, height: 10, preset: "rect", name: "Logo frame", hidden: true } },
        ]),
      ]),
    );
    const objs = allObjects(e.state);
    expect(objs.map((o) => defaultName(o.node, 1))).toEqual(["Picture 1", "Text Box 1", "Shape 1"]);
    const rows = paneRows(objs);
    expect(rows.map((r) => [r.name, r.hidden])).toEqual([
      ["Picture 1", false],
      ["Text Box 2", false],
      ["Logo frame", true],
    ]);
    e.destroy();
  });
});

describe("Layout › Position", () => {
  it("values of an anchor and back (alignment, absolute, relative; options)", () => {
    const a: Anchor = {
      ...newAnchor("square"),
      h: { relativeTo: "leftMargin", place: { kind: "percent", value: 25000 } },
      v: { relativeTo: "paragraph", place: { kind: "offset", value: 720000 } },
      locked: true,
    };
    const v = layoutValues(a);
    expect(v).toMatchObject({ hMode: "relative", hPct: "25", hPctTo: "leftMargin", vMode: "absolute", vAbs: "2", vAbsTo: "paragraph", moveWithText: true, lockAnchor: true, layoutInCell: true });
    expect(anchorOfLayout(v, a)).toEqual(a);
    // Align the object centred on the page, Move object with text off, no table cell layout.
    const b = anchorOfLayout({ ...v, hMode: "align", hAlign: "center", hAlignTo: "page", moveWithText: false, layoutInCell: false, lockAnchor: false }, a)!;
    expect(b.h).toEqual({ relativeTo: "page", place: { kind: "align", value: "center" } });
    expect(b.v.relativeTo).toBe("page");
    expect(b.layoutInCell).toBe(false);
    expect(b.locked).toBeUndefined();
    expect(anchorOfLayout({ ...v, vAbs: "x" }, a)).toBeNull();
  });

  it("positions relative to the margins and as percentages", () => {
    const ctx: FloatContext = { width: 100, height: 50, indentLeft: 0, indentRight: 0, columnWidth: 600, page: { width: 794, marginLeft: 96 } };
    const h = (rel: Anchor["h"]["relativeTo"], place: Anchor["h"]["place"]) => horizontalPos(anchor({ h: { relativeTo: rel, place } }), ctx).value;
    expect(h("leftMargin", { kind: "align", value: "left" })).toBe(-96);
    expect(h("rightMargin", { kind: "align", value: "right" })).toBe(794 - 96 - 100);
    expect(h("page", { kind: "percent", value: 50000 })).toBe(-96 + 397);
    expect(h("margin", { kind: "percent", value: 25000 })).toBe(150);
    expect(h("leftMargin", { kind: "offset", value: 9525 * 10 })).toBe(-86);
    const page = { paraTop: 200, height: 1123, bodyTop: 96, bodyBottom: 1027 };
    const v = (rel: Anchor["v"]["relativeTo"], place: Anchor["v"]["place"]) => verticalPos(anchor({ v: { relativeTo: rel, place } }), page, 50);
    expect(v("topMargin", { kind: "align", value: "top" })).toBe(-200);
    expect(v("bottomMargin", { kind: "align", value: "bottom" })).toBe(1123 - 50 - 200);
    expect(v("page", { kind: "percent", value: 50000 })).toBe(561.5 - 200);
    expect(floatPlacement(anchor({ h: { relativeTo: "rightMargin", place: { kind: "align", value: "left" } } }), ctx).css.left).toBe("600px");
  });
});

describe("drawing canvas", () => {
  it("Insert › Shapes › New Drawing Canvas: an inline canvas of Word's size", () => {
    expect(defaultSize("rect", "canvas")).toEqual({ width: 15 * 360000, height: 6 * 360000 });
    const e = makeEditor(makeDoc([para(1, "Hello")]));
    e.commands.setTextSelection(3);
    expect(insertDrawingCommand(e, "canvas")).toMatchObject({ type: "insertDrawing", kind: "canvas", preset: "rect", width: 5400000, height: 2160000 });
    e.destroy();
  });

  it("a shape drawn on the canvas becomes a member at the drawn place; Fit shrinks the canvas to its members", () => {
    const m = canvasMember("ellipse", { x: 50, y: 20, w: 100, h: 60 }, -7);
    expect(m).toMatchObject({ id: -7, preset: "ellipse", x: 476250, y: 190500, width: 952500, height: 571500, fill: { kind: "solid" } });
    const tb = canvasMember("textBox", { x: 0, y: 0, w: 0, h: 0 }, -9);
    expect(tb).toMatchObject({ kind: "textBox", width: 1800000, height: 900000, text: { blocks: [{ kind: "paragraph", value: { id: -10 } }] } });
    expect(tb.x).toBeUndefined();
    const c: Drawing = { id: 1, kind: "canvas", width: 5400000, height: 2160000, preset: "rect", children: [m, { ...tb, x: 2000000, y: 1000000 }] };
    const fit = fitCanvas(c)!;
    expect(fit.dx).toBe(476250);
    expect(fit.dy).toBe(190500);
    expect(fit.canvas.width).toBe(2000000 + 1800000 - 476250);
    expect(fit.canvas.children![0]!.x).toBeUndefined();
    expect(fitCanvas({ ...c, children: [] })).toBeNull();
  });
});
