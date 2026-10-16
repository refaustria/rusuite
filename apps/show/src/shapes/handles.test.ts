import { describe, expect, it } from "vitest";
import { dragBox, fromLineEnds, lineEnds, mapLocal, snap45, toLocal } from "./geom";
import type { Shape } from "../generated/Shape";
import type { ShapePaths } from "../generated/ShapePaths";
import samples from "../generated/shapePathSamples.json";
import { axisCoord, axisValue, dragHandle, effectiveAdjust, elbowHandle, handlePos, handlesOf, type HandleDef } from "./handles";
import { pathCache, pathKey, pathQueryOf } from "./paths";

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

// The core's handles of a few presets (written by `cargo test -p show-core`).
const SAMPLES = samples as unknown as Record<string, { w: number; h: number; paths: ShapePaths }>;

/** The handles of preset `p` in its sample box. */
const handlesFor = (p: string): HandleDef[] => {
  const s = SAMPLES[p]!;
  return (s.paths.handles ?? []).map((h) => ({ ...h, w: s.w, h: s.h }));
};

describe("adjust handles (from the core)", () => {
  it("rounded rectangle: the corner radius along the top edge", () => {
    const [h] = handlesFor("roundRect");
    const p = handlePos(h!, effectiveAdjust("roundRect", undefined));
    expect(p.x).toBeCloseTo(500000 * 0.16667, -2);
    expect(p.y).toBe(0);
    expect(dragHandle(h!, { x: 100000, y: 999 })).toEqual({ adj: 20000 });
    expect(dragHandle(h!, { x: 900000, y: 0 })).toEqual({ adj: 50000 }); // clamped
    expect(dragHandle(h!, { x: -50000, y: 0 })).toEqual({ adj: 0 });
  });

  it("right arrow: shaft thickness (y) and head length (x)", () => {
    const [thick, head] = handlesFor("rightArrow");
    const adj = effectiveAdjust("rightArrow", { adj1: 60000 });
    expect(handlePos(thick!, adj).y).toBeCloseTo(500000 - 300000, -2);
    expect(handlePos(head!, adj).x).toBeCloseTo(2000000 - 500000, -2);
    expect(dragHandle(thick!, { x: 0, y: 400000 })).toEqual({ adj1: 20000 });
    expect(dragHandle(head!, { x: 1000000, y: 0 })).toEqual({ adj2: 100000 });
  });

  it("callout tails move on both axes, beyond the sampled range too", () => {
    const [tail] = handlesFor("wedgeRectCallout");
    const p = handlePos(tail!, effectiveAdjust("wedgeRectCallout", undefined));
    expect(p.x).toBeCloseTo(500000 - 208330, -2);
    expect(p.y).toBeCloseTo(200000 + 250000, -2);
    expect(dragHandle(tail!, { x: 1000000, y: 0 })).toEqual({ adj1: 50000, adj2: -50000 });
    // far outside: extrapolated linearly
    expect(dragHandle(tail!, { x: 4500000, y: 200000 }).adj1).toBeCloseTo(400000, -3);
  });

  it("stars: the inner radius from the top point; presets without adjust values have none", () => {
    const [h] = handlesFor("star5");
    expect(h!.yAxis?.adj).toBe("adj");
    const v = dragHandle(h!, { x: 500000, y: 300000 }).adj!;
    expect(v).toBeGreaterThan(15000);
    expect(v).toBeLessThan(25000);
    expect(handlesFor("ellipse")).toEqual([]);
  });

  it("polar handles (pie) turn around the centre", () => {
    const [start, end] = handlesFor("pie");
    expect(start!.polar).toBe(true);
    // pointing down from the centre: 90°
    expect(dragHandle(start!, { x: 500000, y: 900000 })).toEqual({ adj1: 5400000 });
    // up and slightly left: just under 270°
    expect(dragHandle(end!, { x: 499000, y: 0 }).adj2).toBeGreaterThan(16100000);
    const at = handlePos(start!, { adj1: 10800000, adj2: 0 });
    expect(at.x).toBeCloseTo(0, -1);
    expect(at.y).toBeCloseTo(500000, -1);
  });

  it("sampled axes invert pinned curves (U-turn arrow)", () => {
    const hs = handlesFor("uturnArrow");
    expect(hs.length).toBe(5);
    for (const h of hs) {
      for (const a of [h.xAxis, h.yAxis]) {
        if (!a?.samples?.length) continue;
        // every sample maps back to a value that gives the same coordinate
        const [v, c] = a.samples[Math.floor(a.samples.length / 2)]!;
        const back = axisValue(a, c);
        expect(Math.abs(axisCoord(a, back) - c)).toBeLessThan(2000);
        expect(axisCoord(a, v)).toBeCloseTo(c);
      }
    }
  });

  it("handlesOf reads the cached outline; nothing before it arrives", () => {
    pathCache.clear();
    const shape: Shape = { id: 1, name: "", transform: { x: 0, y: 0, w: 1000000, h: 500000, rotationDeg: 0 }, kind: { kind: "auto", value: { geometry: "roundRect" } }, fill: { kind: "none" }, line: { fill: { kind: "none" }, width: 0, dash: "solid" } };
    expect(handlesOf(shape)).toEqual([]);
    pathCache.load([[pathKey(pathQueryOf(shape)!), SAMPLES.roundRect!.paths]]);
    expect(handlesOf(shape)).toHaveLength(1);
    expect(handlesOf(shape)[0]!.w).toBe(1000000);
    pathCache.clear();
  });

  it("the elbow's middle handle sets adj1 as a fraction of the width", () => {
    const h = elbowHandle(1000, 400, undefined);
    expect(handlePos(h, { adj1: 50000 })).toEqual({ x: 500, y: 200 });
    expect(dragHandle(h, { x: 250, y: 0 })).toEqual({ adj1: 25000 });
  });
});
