import { describe, expect, it } from "vitest";
import { anchorAxes, sameGuides, snapBox, snapPoint, snapTargets } from "./snap";

const slide = { width: 1280, height: 720 };

describe("smart guides", () => {
  it("targets: slide edges and centres plus other shapes' edges and centres", () => {
    const t = snapTargets(slide, [{ x: 100, y: 50, width: 200, height: 100 }]);
    expect(t.xs).toEqual([0, 640, 1280, 100, 200, 300]);
    expect(t.ys).toEqual([0, 360, 720, 50, 100, 150]);
  });

  it("snaps a box's centre to the slide centre within the threshold", () => {
    const t = snapTargets(slide, []);
    const r = snapBox({ x: 537, y: 300, width: 200, height: 50 }, t, 6);
    expect(r.dx).toBe(3); // centre 637 → 640
    expect(r.dy).toBe(0); // nothing within 6 px vertically (centre 325, edges 300/350)
    expect(r.guides).toEqual({ v: [640], h: [] });
  });

  it("does not snap beyond the threshold", () => {
    const t = snapTargets(slide, []);
    const r = snapBox({ x: 530, y: 300, width: 200, height: 50 }, t, 6);
    expect(r).toEqual({ dx: 0, dy: 0, guides: { v: [], h: [] } });
  });

  it("snaps edges to other shapes and picks the nearest candidate", () => {
    const t = snapTargets(slide, [{ x: 400, y: 200, width: 100, height: 100 }]);
    // left edge 504 → 500 (other's right edge, d=-4); top 197 → 200 (d=3)
    const r = snapBox({ x: 504, y: 197, width: 50, height: 40 }, t, 6);
    expect(r.dx).toBe(-4);
    expect(r.dy).toBe(3);
    expect(r.guides.v).toContain(500);
    expect(r.guides.h).toContain(200);
  });

  it("reports every coinciding line after snapping", () => {
    const t = snapTargets(slide, [{ x: 0, y: 0, width: 640, height: 10 }]);
    const r = snapBox({ x: 2, y: 400, width: 640, height: 10 }, t, 6);
    expect(r.dx).toBe(-2);
    expect(r.guides.v).toEqual([0, 320, 640]);
  });

  it("snaps resize handles only along the anchor's axes", () => {
    const t = snapTargets(slide, []);
    expect(snapPoint({ x: 637, y: 357 }, t, 6, { x: true, y: false })).toEqual({ x: 640, y: 357, guides: { v: [640], h: [] } });
    expect(snapPoint({ x: 637, y: 357 }, t, 6, { x: true, y: true })).toEqual({ x: 640, y: 360, guides: { v: [640], h: [360] } });
    expect(anchorAxes("top-left")).toEqual({ x: true, y: true });
    expect(anchorAxes("middle-right")).toEqual({ x: true, y: false });
    expect(anchorAxes("bottom-center")).toEqual({ x: false, y: true });
    expect(anchorAxes("rotater")).toEqual({ x: false, y: false });
  });

  it("compares guide sets", () => {
    expect(sameGuides({ v: [1], h: [] }, { v: [1], h: [] })).toBe(true);
    expect(sameGuides({ v: [1], h: [] }, { v: [2], h: [] })).toBe(false);
  });
});
