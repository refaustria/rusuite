// The handle geometry Show and Write share (P9-X1).

import { describe, expect, it } from "vitest";
import {
  axisCoord, axisValue, dragHandle, dragHandleOnScreen, effectiveAdjust, elbowHandle, handleAt, handleDefs, handleNudgeKey,
  handleOnScreen, handlePos, mapLocal, nudgeAdjust, resizeCursor, resizeHandlePoints, rotateHandlePoint, rotatedResize,
  rotateVec, rotationAt, stepHandleFocus, toLocal, unrotateVec, type HandleAxis, type HandleDef,
} from "./handles";

const near = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  expect(a.x).toBeCloseTo(b.x, 6);
  expect(a.y).toBeCloseTo(b.y, 6);
};

/** roundRect's corner handle in a 2000 × 1000 box (k = shorter side / 100000). */
const corner: HandleDef = { x: 166.67, y: 0, w: 2000, h: 1000, xAxis: { adj: "adj", base: 0, k: 0.01, min: 0, max: 50000 } };

describe("box frames", () => {
  it("mapLocal and toLocal invert each other with rotation and flips", () => {
    const t = { x: 100, y: 50, w: 200, h: 100, rotationDeg: 37, flipH: true, flipV: true };
    for (const p of [{ x: 0, y: 0 }, { x: 200, y: 100 }, { x: 30, y: 80 }]) {
      const s = mapLocal(t, p.x, p.y);
      near(toLocal(t, s.x, s.y), p);
    }
  });

  it("a quarter turn maps the top-left corner to the top-right of the turned box", () => {
    near(mapLocal({ x: 0, y: 0, w: 200, h: 100, rotationDeg: 90 }, 0, 0), { x: 150, y: -50 });
    near(mapLocal({ x: 0, y: 0, w: 200, h: 100, flipH: true }, 0, 0), { x: 200, y: 0 });
  });

  it("rotateVec and unrotateVec are inverse", () => {
    near(rotateVec({ x: 10, y: 0 }, 90), { x: 0, y: 10 });
    near(unrotateVec(0, 10, 90), { x: 10, y: 0 });
  });
});

describe("adjust handles", () => {
  it("effectiveAdjust and handleDefs", () => {
    expect(effectiveAdjust({ adj1: 1, adj2: 2 }, { adj2: 5 })).toEqual({ adj1: 1, adj2: 5 });
    expect(effectiveAdjust({ adj: 3 }, null)).toEqual({ adj: 3 });
    expect(handleDefs([{ x: 1, y: 2 }], 10, 20)).toEqual([{ x: 1, y: 2, w: 10, h: 20 }]);
    expect(handleDefs(undefined, 10, 20)).toEqual([]);
  });

  it("axisCoord follows the samples, else base + k·v", () => {
    const a: HandleAxis = { adj: "adj", base: 5, k: 2, min: 0, max: 100, samples: [[0, 0], [50, 100], [100, 100]] };
    expect(axisCoord(a, 25)).toBe(50);
    expect(axisCoord(a, 75)).toBe(100);
    expect(axisCoord({ ...a, samples: [] }, 10)).toBe(25);
  });

  it("axisValue inverts, clamps and extrapolates", () => {
    const lin: HandleAxis = { adj: "adj", base: 0, k: 0.01, min: 0, max: 50000 };
    expect(axisValue(lin, 250)).toBe(25000);
    expect(axisValue(lin, 900)).toBe(50000);
    expect(axisValue(lin, -5)).toBe(0);
    const s: HandleAxis = { adj: "adj", base: 0, k: 1, min: -1000, max: 1000, samples: [[0, 0], [100, 100]] };
    expect(axisValue(s, 40)).toBe(40);
    expect(axisValue(s, 300)).toBe(300); // past the samples: base + k·v
    const flat: HandleAxis = { adj: "adj", base: 0, k: 0, min: 0, max: 100, samples: [[0, 10], [100, 20]] };
    expect(axisValue(flat, 50)).toBe(100); // nearest sample
  });

  it("handlePos and dragHandle of an xy handle", () => {
    near(handlePos(corner, { adj: 16667 }), { x: 166.67, y: 0 });
    expect(dragHandle(corner, { x: 250, y: 0 })).toEqual({ adj: 25000 });
    expect(dragHandle({ x: 0, y: 0, w: 1, h: 1 }, { x: 5, y: 5 })).toEqual({});
  });

  it("polar handles turn around the centre and wrap angles into their range", () => {
    const h: HandleDef = { x: 0, y: 0, w: 200, h: 200, polar: true,
      xAxis: { adj: "r", base: 0, k: 1, min: 0, max: 100 }, yAxis: { adj: "ang", base: 0, k: 1, min: 0, max: 21600000 } };
    near(handlePos(h, { r: 50, ang: 90 * 60000 }), { x: 100, y: 150 });
    expect(dragHandle(h, { x: 200, y: 100 })).toEqual({ ang: 0, r: 100 });
    const wide = { ...h, yAxis: { adj: "ang", base: 0, k: 1, min: 10800000, max: 27000000 } };
    expect(dragHandle(wide, { x: 150, y: 100 }).ang).toBe(21600000);
  });

  it("handles turn and flip with the shape", () => {
    const t = { x: 0, y: 0, w: 2000, h: 1000, rotationDeg: 90 };
    // the top edge of a quarter-turned box is its right side on screen
    near(handleOnScreen(corner, { adj: 16667 }, t), { x: 1500, y: -500 + 166.67 });
    const flipped = { x: 0, y: 0, w: 2000, h: 1000, flipH: true };
    near(handleOnScreen(corner, { adj: 16667 }, flipped), { x: 2000 - 166.67, y: 0 });
  });

  it("a drag on screen is inverted through rotation and flips", () => {
    const t = { x: 0, y: 0, w: 2000, h: 1000, rotationDeg: 90 };
    expect(dragHandleOnScreen(corner, t, { x: 1500, y: -500 + 250 })).toEqual({ adj: 25000 });
    const flipped = { x: 0, y: 0, w: 2000, h: 1000, flipH: true };
    expect(dragHandleOnScreen(corner, flipped, { x: 2000 - 250, y: 0 })).toEqual({ adj: 25000 });
  });

  it("nudging moves the handle in screen directions", () => {
    const t = { x: 0, y: 0, w: 2000, h: 1000 };
    expect(nudgeAdjust(corner, { adj: 16667 }, t, 10, 0)).toEqual({ adj: 17667 });
    // turned a quarter: the top edge runs downwards, so "down" grows the corner
    expect(nudgeAdjust(corner, { adj: 16667 }, { ...t, rotationDeg: 90 }, 0, 10)).toEqual({ adj: 17667 });
    expect(nudgeAdjust(corner, { adj: 16667 }, { ...t, flipH: true }, 10, 0)).toEqual({ adj: 15667 });
  });

  it("Tab cycles the handles and returns to the shape", () => {
    expect(stepHandleFocus(null, 2, 1)).toBe(0);
    expect(stepHandleFocus(0, 2, 1)).toBe(1);
    expect(stepHandleFocus(1, 2, 1)).toBeNull();
    expect(stepHandleFocus(null, 2, -1)).toBe(1);
    expect(stepHandleFocus(0, 2, -1)).toBeNull();
    expect(stepHandleFocus(null, 0, 1)).toBeNull();
  });

  it("arrow keys give the handle's step (Shift: 10)", () => {
    expect(handleNudgeKey("ArrowLeft", false)).toEqual({ x: -1, y: 0 });
    expect(handleNudgeKey("ArrowDown", true)).toEqual({ x: 0, y: 10 });
    expect(handleNudgeKey("a", false)).toBeNull();
  });

  it("the elbow connector's middle handle", () => {
    const e = elbowHandle(1000, 400, { adj1: 25000 });
    expect(handlePos(e, { adj1: 25000 })).toEqual({ x: 250, y: 200 });
    expect(e.x).toBe(250);
    expect(dragHandle(e, { x: 750, y: 0 })).toEqual({ adj1: 75000 });
    expect(elbowHandle(1000, 400, null).x).toBe(500);
  });
});

describe("resize and rotation handles", () => {
  it("resize handles sit on the frame and turn with it, unflipped", () => {
    const p = resizeHandlePoints({ x: 0, y: 0, w: 200, h: 100 });
    expect(p.nw).toEqual({ x: 0, y: 0 });
    expect(p.e).toEqual({ x: 200, y: 50 });
    const r = resizeHandlePoints({ x: 0, y: 0, w: 200, h: 100, rotationDeg: 90, flipH: true });
    near(r.nw, { x: 150, y: -50 });
    near(r.s, { x: 50, y: 50 });
  });

  it("the rotation handle stays above the top edge", () => {
    near(rotateHandlePoint({ x: 0, y: 0, w: 200, h: 100 }, 20), { x: 100, y: -20 });
    near(rotateHandlePoint({ x: 0, y: 0, w: 200, h: 100, rotationDeg: 90 }, 20), { x: 170, y: 50 });
  });

  it("resize cursors follow the rotation", () => {
    expect(resizeCursor("n", 0)).toBe("ns-resize");
    expect(resizeCursor("e", 0)).toBe("ew-resize");
    expect(resizeCursor("se", 0)).toBe("nwse-resize");
    expect(resizeCursor("ne", 0)).toBe("nesw-resize");
    expect(resizeCursor("n", 90)).toBe("ew-resize");
    expect(resizeCursor("n", 45)).toBe("nesw-resize");
    expect(resizeCursor("e", 135)).toBe("nesw-resize");
    expect(resizeCursor("w", -45)).toBe("nesw-resize");
    expect(resizeCursor("w", 45)).toBe("nwse-resize");
  });

  it("rotation for a pointer, with 15° steps", () => {
    expect(rotationAt(0, 0, 10, 0)).toBe(90);
    expect(rotationAt(0, 0, 0, -10)).toBe(0);
    expect(rotationAt(0, 0, -10, 0)).toBe(270);
    expect(rotationAt(0, 0, 10, 9, true)).toBe(135);
  });

  it("resizing a rotated frame keeps the opposite handle in place", () => {
    expect(rotatedResize("e", 100, 50, 20, 0, 0, false)).toEqual({ w: 120, h: 50, dx: 0, dy: 0 });
    expect(rotatedResize("nw", 100, 50, 10, 10, 0, false)).toEqual({ w: 90, h: 40, dx: 10, dy: 10 });
    const r = rotatedResize("e", 100, 50, 0, 20, 90, false);
    expect(r.w).toBe(120);
    // the west edge's midpoint stays where it was on screen
    const before = mapLocal({ x: 0, y: 0, w: 100, h: 50, rotationDeg: 90 }, 0, 25);
    const after = mapLocal({ x: r.dx, y: r.dy, w: r.w, h: r.h, rotationDeg: 90 }, 0, 25);
    near(after, before);
    expect(rotatedResize("w", 100, 50, 200, 0, 0, false).w).toBe(8);
  });

  it("hit testing picks the nearest handle in reach", () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 100, y: 100 }];
    expect(handleAt(pts, { x: 7, y: 1 }, 5)).toBe(1);
    expect(handleAt(pts, { x: 4, y: 0 }, 5)).toBe(0);
    expect(handleAt(pts, { x: 50, y: 50 }, 5)).toBe(-1);
  });
});
