import { describe, expect, it } from "vitest";
import { dragBox, fromLineEnds, lineEnds, mapLocal, snap45, toLocal } from "./geom";
import { dragHandle, effectiveAdjust, elbowHandle, handlePos, handlesOf } from "./handles";

describe("box geometry", () => {
  it("toLocal inverts mapLocal with rotation and flips", () => {
    const t = { x: 100, y: 200, w: 400, h: 100, rotationDeg: 30, flipH: true, flipV: true };
    const p = mapLocal(t, 50, 20);
    const back = toLocal(t, p.x, p.y);
    expect(back.x).toBeCloseTo(50);
    expect(back.y).toBeCloseTo(20);
  });

  it("line ends follow the flips; fromLineEnds is their inverse", () => {
    const t = fromLineEnds({ x: 500, y: 100 }, { x: 100, y: 300 });
    expect(t).toMatchObject({ x: 100, y: 100, w: 400, h: 200, flipH: true, flipV: false });
    const [a, b] = lineEnds(t);
    expect(a.x).toBeCloseTo(500);
    expect(b.y).toBeCloseTo(300);
  });

  it("dragging draws a box from either corner; Shift makes it square; lines snap to 45°", () => {
    expect(dragBox({ x: 100, y: 100 }, { x: 50, y: 160 }, false)).toEqual({ x: 50, y: 100, w: 50, h: 60 });
    expect(dragBox({ x: 100, y: 100 }, { x: 50, y: 160 }, true)).toEqual({ x: 40, y: 100, w: 60, h: 60 });
    const p = snap45({ x: 0, y: 0 }, { x: 100, y: 90 });
    expect(p.x).toBe(p.y);
  });
});

describe("adjust handles", () => {
  it("rounded rectangle: the corner radius along the top edge", () => {
    const [h] = handlesOf("roundRect", 1000, 500);
    expect(handlePos(h!, effectiveAdjust("roundRect", undefined))).toEqual({ x: 500 * 0.16667, y: 0 });
    expect(dragHandle(h!, { x: 100, y: 999 })).toEqual({ adj: 20000 });
    expect(dragHandle(h!, { x: 900, y: 0 })).toEqual({ adj: 50000 }); // clamped
    expect(dragHandle(h!, { x: -50, y: 0 })).toEqual({ adj: 0 });
  });

  it("right arrow: shaft thickness (y) and head length (x)", () => {
    const [thick, head] = handlesOf("rightArrow", 2000, 1000);
    const adj = effectiveAdjust("rightArrow", { adj1: 60000 });
    expect(handlePos(thick!, adj)).toEqual({ x: 0, y: 500 - 300 });
    expect(handlePos(head!, adj)).toEqual({ x: 2000 - 500, y: 0 });
    expect(dragHandle(thick!, { x: 0, y: 400 })).toEqual({ adj1: 20000 });
    expect(dragHandle(head!, { x: 1000, y: 0 })).toEqual({ adj2: 100000 });
  });

  it("callout tails move on both axes, relative to the centre", () => {
    const [tail] = handlesOf("wedgeRectCallout", 1000, 400);
    expect(handlePos(tail!, effectiveAdjust("wedgeRectCallout", undefined))).toEqual({ x: 500 - 208.33, y: 200 + 250 });
    expect(dragHandle(tail!, { x: 1000, y: 0 })).toEqual({ adj1: 50000, adj2: -50000 });
  });

  it("stars: the inner radius from the top point; presets without adjust values have none", () => {
    const [h] = handlesOf("star5", 1000, 1000);
    expect(dragHandle(h!, { x: 500, y: 300 })).toEqual({ adj: 20000 });
    expect(handlesOf("rect", 10, 10)).toEqual([]);
    expect(handlesOf("ellipse", 10, 10)).toEqual([]);
    expect(handlesOf("wedgeRoundRectCallout", 10, 10)).toHaveLength(2);
  });

  it("the elbow's middle handle sets adj1 as a fraction of the width", () => {
    const h = elbowHandle(1000, 400, undefined);
    expect(handlePos(h, { adj1: 50000 })).toEqual({ x: 500, y: 200 });
    expect(dragHandle(h, { x: 250, y: 0 })).toEqual({ adj1: 25000 });
  });
});
