// P8-17: floating picture anchors (Wrap Text, Position presets, drag) and
// their CSS placement.

import { describe, expect, it } from "vitest";
import type { Anchor } from "../generated/Anchor";
import { floatPlacement, horizontalPos, movedAnchor, newAnchor, POSITION_PRESETS, presetAnchor, presetOf, verticalPos, withWrap, wrapOf, type FloatContext } from "./floating";

const ctx: FloatContext = { width: 100, height: 50, indentLeft: 0, indentRight: 0, columnWidth: 600, page: { width: 794, marginLeft: 96 } };

describe("anchors", () => {
  it("newAnchor mirrors Anchor::new (column/paragraph offset 0, distances only for square/tight)", () => {
    expect(newAnchor("square")).toEqual({
      h: { relativeTo: "column", place: { kind: "offset", value: 0 } },
      v: { relativeTo: "paragraph", place: { kind: "offset", value: 0 } },
      wrap: "square",
      distance: { top: 0, bottom: 0, left: 114300, right: 114300 },
      allowOverlap: true,
    });
    expect(newAnchor("behind").distance.left).toBe(0);
  });

  it("withWrap: inline removes the anchor, an existing anchor keeps its position", () => {
    expect(withWrap(newAnchor("square"), "inline")).toBeNull();
    const moved = movedAnchor(newAnchor("square"), 0, 0, 50, 20);
    expect(withWrap(moved, "inFront")).toEqual({ ...moved, wrap: "inFront" });
    expect(withWrap(null, "topAndBottom")?.wrap).toBe("topAndBottom");
    expect(wrapOf(null)).toBe("inline");
    expect(wrapOf(moved)).toBe("square");
  });

  it("the nine position presets align to the margin and round-trip through presetOf", () => {
    expect(POSITION_PRESETS).toHaveLength(9);
    for (const p of POSITION_PRESETS) expect(presetOf(presetAnchor(null, p))).toBe(p);
    const a = presetAnchor(null, "bottom-right");
    expect(a.h).toEqual({ relativeTo: "margin", place: { kind: "align", value: "right" } });
    expect(a.v).toEqual({ relativeTo: "margin", place: { kind: "align", value: "bottom" } });
    expect(a.wrap).toBe("square");
    // Behind/in front become square ("With Text Wrapping"); tight stays.
    expect(presetAnchor({ ...newAnchor("behind") }, "top-left").wrap).toBe("square");
    expect(presetAnchor({ ...newAnchor("tight") }, "top-left").wrap).toBe("tight");
    expect(presetOf(newAnchor("square"))).toBeNull();
  });

  it("movedAnchor: offsets from the column and the paragraph in EMU", () => {
    const a = movedAnchor(presetAnchor(null, "top-center"), 250, 10, 30, -5);
    expect(a.h).toEqual({ relativeTo: "column", place: { kind: "offset", value: 280 * 9525 } });
    expect(a.v).toEqual({ relativeTo: "paragraph", place: { kind: "offset", value: 5 * 9525 } });
  });
});

describe("placement", () => {
  const at = (h: Anchor["h"], extra: Partial<Anchor> = {}): Anchor => ({ ...newAnchor("square"), h, ...extra });

  it("horizontalPos: offsets (column / page), page alignment, column alignment as calc()", () => {
    expect(horizontalPos(at({ relativeTo: "column", place: { kind: "offset", value: 952500 } }), ctx)).toEqual({ value: 100, css: "100px" });
    expect(horizontalPos(at({ relativeTo: "page", place: { kind: "offset", value: 952500 } }), ctx).value).toBe(4);
    expect(horizontalPos(at({ relativeTo: "page", place: { kind: "align", value: "right" } }), ctx).value).toBe(794 - 96 - 100);
    expect(horizontalPos(at({ relativeTo: "margin", place: { kind: "align", value: "center" } }), ctx).css).toBe("calc((100% + 0px - 100px) / 2)");
  });

  it("verticalPos: paragraph / line offsets; margin and page positions stay at the paragraph", () => {
    expect(verticalPos({ ...newAnchor("square"), v: { relativeTo: "paragraph", place: { kind: "offset", value: 190500 } } })).toBe(20);
    expect(verticalPos({ ...newAnchor("square"), v: { relativeTo: "margin", place: { kind: "align", value: "bottom" } } })).toBe(0);
  });

  it("square/tight float left at their offset, minus the paragraph indent; right-aligned ones float right", () => {
    const left = floatPlacement(at({ relativeTo: "column", place: { kind: "offset", value: 476250 } }), { ...ctx, indentLeft: 20 });
    expect(left.mode).toBe("float-left");
    expect(left.css["margin-left"]).toBe("30px");
    expect(left.css["margin-right"]).toBe("12px");
    const right = floatPlacement(at({ relativeTo: "margin", place: { kind: "align", value: "right" } }), ctx);
    expect(right.mode).toBe("float-right");
    // An offset in the right half floats right too, at its distance from the right edge.
    const off = floatPlacement(at({ relativeTo: "column", place: { kind: "offset", value: 450 * 9525 } }), ctx);
    expect(off.mode).toBe("float-right");
    expect(off.css["margin-right"]).toBe("50px");
  });

  it("wrapSide decides the side", () => {
    expect(floatPlacement(at({ relativeTo: "margin", place: { kind: "align", value: "right" } }, { wrapSide: "right" }), ctx).mode).toBe("float-left");
    expect(floatPlacement(at({ relativeTo: "margin", place: { kind: "align", value: "left" } }, { wrapSide: "left" }), ctx).mode).toBe("float-right");
  });

  it("top and bottom is a block; behind / in front are out of the flow with their z-order", () => {
    expect(floatPlacement(newAnchor("topAndBottom"), ctx)).toEqual({ mode: "block", css: { display: "block", "margin-left": "0px", "margin-top": "0px", "margin-bottom": "0px" } });
    const behind = floatPlacement({ ...newAnchor("behind"), v: { relativeTo: "paragraph", place: { kind: "offset", value: 95250 } } }, ctx);
    expect(behind).toEqual({ mode: "behind", css: { position: "absolute", left: "0px", top: "10px", "z-index": "-1000000000" } });
    expect(floatPlacement(newAnchor("inFront"), ctx).css["z-index"]).toBe("3");
  });
});
