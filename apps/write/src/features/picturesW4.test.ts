// P9-W4 item 2: crop mask geometry, Aspect Ratio / Fill / Fit crops, soft
// edges and bevel CSS, both-sided wrapping (placement and per-line spacers),
// line-relative vertical positions.

import { describe, expect, it } from "vitest";
import type { Anchor } from "../generated/Anchor";
import { floatPlacement, MIN_SIDE_GAP, newAnchor, verticalPos, WRAP_CHOICES, type FloatContext } from "./floating";
import { aspectCrop, bevelCss, bevelOf, cropMaskRects, fitCrop, fullImageSize, imageRect, softEdgeCss, withBevel, withSoftEdge } from "./pictures";
import { spacerFits, spacerFor, type WrapLine } from "./wrapBoth";

describe("crop mode", () => {
  it("dims the image outside the crop window (four bands)", () => {
    const img = imageRect(100, 50, { left: 25000, top: 0, right: 25000, bottom: 50000 });
    expect(img).toEqual({ x: -50, y: -0, w: 200, h: 100 });
    expect(cropMaskRects(img, 100, 50)).toEqual([
      { x: -50, y: 50, w: 200, h: 50 },
      { x: -50, y: 0, w: 50, h: 50 },
      { x: 100, y: 0, w: 50, h: 50 },
    ]);
    expect(cropMaskRects({ x: 0, y: 0, w: 100, h: 50 }, 100, 50)).toEqual([]);
  });
});

describe("Crop ▾", () => {
  it("Aspect Ratio crops the largest centred part with the proportions", () => {
    expect(aspectCrop(400, 200, 1, 1)).toEqual({ left: 25000, top: 0, right: 25000, bottom: 0 });
    expect(aspectCrop(200, 400, 1, 1)).toEqual({ left: 0, top: 25000, right: 0, bottom: 25000 });
    expect(aspectCrop(160, 90, 16, 9)).toEqual({ left: 0, top: 0, right: 0, bottom: 0 });
  });

  it("Fit pads the box, Fill crops it; the full image size follows the crop", () => {
    expect(fitCrop(100, 100, 200, 100)).toEqual({ left: 0, top: -50000, right: 0, bottom: -50000 });
    expect(fitCrop(200, 100, 100, 100)).toEqual({ left: -50000, top: 0, right: -50000, bottom: 0 });
    expect(fullImageSize(952500, 476250, { left: 25000, top: 0, right: 25000, bottom: 0 })).toEqual({ w: 200, h: 50 });
  });
});

describe("Picture Effects", () => {
  it("soft edges in points; a feathered mask in the editor", () => {
    const f = withSoftEdge({}, 5);
    expect(f.softEdge).toBe(63500);
    expect(withSoftEdge(f, 0).softEdge).toBeUndefined();
    const css = softEdgeCss(f, 200, 100);
    expect(css["mask-image"]).toContain("6.7px");
    expect(css["mask-composite"]).toBe("intersect");
    expect(softEdgeCss({}, 10, 10)).toEqual({});
  });

  it("bevel presets: Word's sizes, an inset light and shade", () => {
    expect(bevelOf("circle")).toEqual({ preset: "circle", width: 76200, height: 25400 });
    expect(bevelOf("angle").height).toBe(76200);
    expect(withBevel({ shadow: true }, "riblet").bevel?.preset).toBe("riblet");
    expect(withBevel({ bevel: bevelOf("circle") }, null).bevel).toBeUndefined();
    expect(bevelCss(bevelOf("circle"))).toMatch(/^inset 2\.7px 2\.7px 4\.0px 2\.0px rgba\(255, 255, 255, 0\.5\), inset -2\.7px/);
    expect(bevelCss(null)).toBe("");
  });
});

describe("Wrap Text both sides", () => {
  const ctx: FloatContext = { width: 200, height: 100, indentLeft: 0, indentRight: 0, columnWidth: 600, page: null };
  const centred: Anchor = { ...newAnchor("square"), h: { relativeTo: "margin", place: { kind: "align", value: "center" } } };

  it("a centred square picture leaves text areas on both sides: out of the flow at its place", () => {
    const p = floatPlacement(centred, ctx);
    expect(p.mode).toBe("both");
    expect(p.css).toMatchObject({ position: "absolute", left: "200px", top: "0px" });
    // One side only (wrapSide), or too narrow a side: a float.
    expect(floatPlacement({ ...centred, wrapSide: "left" }, ctx).mode).toBe("float-right");
    expect(floatPlacement(centred, { ...ctx, width: 600 - 2 * MIN_SIDE_GAP }).mode).not.toBe("both");
    expect(floatPlacement({ ...centred, wrap: "through" }, ctx).mode).toBe("both");
    expect(floatPlacement({ ...centred, wrap: "topAndBottom" }, ctx).mode).toBe("block");
    expect(WRAP_CHOICES).toContain("through");
  });

  const line = (top: number, words: [string, number][]): WrapLine => {
    let x = 0;
    let pos = 10;
    const chars: WrapLine["chars"] = [];
    for (const [w, width] of words) {
      for (const ch of w) {
        x += width / w.length;
        pos += 1;
        chars.push({ right: x, space: ch === " ", after: pos });
      }
    }
    return { top, bottom: top + 18, left: 0, right: x, chars, start: 10 };
  };

  it("a line crossing the picture gets a spacer after its last word that ends left of it", () => {
    const ex = { top: 0, bottom: 100, left: 200, right: 420 };
    const l = line(20, [["Lorem ", 60], ["ipsum ", 60], ["dolor ", 60], ["sitamet ", 70], ["more ", 50]]);
    // "Lorem ipsum dolor " ends at 180; "sitamet" would cross 200.
    expect(spacerFor(l, ex)).toEqual({ pos: 28, width: 240 });
    // Above or below the picture, or a line ending before it: no spacer.
    expect(spacerFor(line(120, [["x ", 600]]), ex)).toBeNull();
    expect(spacerFor(line(20, [["short ", 100]]), ex)).toBeNull();
    // A first word wider than the left area: the spacer opens the line.
    expect(spacerFor(line(20, [["Averyveryverylongword ", 300]]), ex)).toEqual({ pos: 10, width: 420 });
    expect(spacerFits({ left: 180, right: 420 }, ex)).toBe(true);
    expect(spacerFits({ left: 210, right: 420 }, ex)).toBe(false);
    expect(spacerFits({ left: 180, right: 400 }, ex)).toBe(false);
  });
});

describe("vertical positions", () => {
  it("relative to the line: from the line's top", () => {
    const a: Anchor = { ...newAnchor("square"), v: { relativeTo: "line", place: { kind: "offset", value: 95250 } } };
    expect(verticalPos(a, null, 0, 40)).toBe(50);
    expect(verticalPos({ ...a, v: { relativeTo: "paragraph", place: { kind: "offset", value: 95250 } } }, null, 0, 40)).toBe(10);
  });
});
