import { describe, expect, it } from "vitest";
import {
  boundsPx, boxAttrs, centredTransform, EMU_PER_PX, emuToPx, fitScale, normalizeDeg, pxToEmu, rectFromPoints,
  shapesInRect, slidePx, transformFromNode,
} from "./geometry";
import { rect } from "./test/fixture";

const WIDE = { width: 12192000, height: 6858000 };

describe("geometry", () => {
  it("converts EMU and px at 96 dpi", () => {
    expect(EMU_PER_PX).toBe(9525);
    expect(emuToPx(914400)).toBe(96);
    expect(pxToEmu(96)).toBe(914400);
    expect(slidePx(WIDE)).toEqual({ width: 1280, height: 720 });
  });

  it("fits the slide into the viewport", () => {
    expect(fitScale(1280, 720, WIDE)).toBe(1);
    expect(fitScale(640, 720, WIDE)).toBe(0.5);
    expect(fitScale(1920, 540, WIDE)).toBe(0.75);
    expect(fitScale(0, 100, WIDE)).toBe(0);
  });

  it("puts the node origin at the box centre and round-trips an unchanged node", () => {
    const t = { x: 914400, y: 457200, w: 1828800, h: 914401, rotationDeg: 30 };
    const a = boxAttrs(t);
    expect(a).toMatchObject({ x: 192, offsetX: 96, width: 192, rotation: 30 });
    expect(a.y).toBeCloseTo(96, 3);
    expect(transformFromNode({ x: a.x, y: a.y, rotation: 30, scaleX: 1, scaleY: 1 }, t)).toEqual(t);
  });

  it("maps a resize/rotate/move gesture to a transform (flips kept)", () => {
    const t = { x: 0, y: 0, w: 952500, h: 952500, rotationDeg: 0, flipH: true };
    // 100 px box scaled 2× horizontally around a new centre at (300, 200), rotated −90°.
    const out = transformFromNode({ x: 300, y: 200, rotation: -90, scaleX: 2, scaleY: 1 }, t);
    expect(out).toEqual({ x: (300 - 100) * EMU_PER_PX, y: (200 - 50) * EMU_PER_PX, w: 1905000, h: 952500, rotationDeg: 270, flipH: true });
    expect(normalizeDeg(-0.0001)).toBe(0);
    expect(normalizeDeg(725)).toBe(5);
  });

  it("computes rotated bounds and marquee hits", () => {
    const b = boundsPx({ x: 0, y: 0, w: 952500 * 2, h: 952500, rotationDeg: 90 });
    expect(b.width).toBeCloseTo(100);
    expect(b.height).toBeCloseTo(200);
    const shapes = [rect(1, 0, 0), rect(2, 6096000, 2743200)];
    expect(shapesInRect(shapes, rectFromPoints(400, 400, -1, -1))).toEqual([1]);
    expect(shapesInRect(shapes, { x: 0, y: 0, width: 1280, height: 720 })).toEqual([1, 2]);
  });

  it("centres a new shape on the slide", () => {
    expect(centredTransform(WIDE, 1828800, 1371600)).toEqual({ x: 5181600, y: 2743200, w: 1828800, h: 1371600, rotationDeg: 0 });
  });
});
