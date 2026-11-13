import { describe, expect, it } from "vitest";
import {
  clampZoom,
  decodeStroke,
  encodeStroke,
  normPressure,
  pointInPolygon,
  PX_PER_INK,
  radiusAt,
  readingOrder,
  rectInLasso,
  simplify,
  snap,
  strokeHit,
  strokeInLasso,
  strokeOutline,
  translateStroke,
  type InkPoint,
} from "./geometry";

const line = (n: number, f: (i: number) => [number, number], p = 0.5): InkPoint[] => Array.from({ length: n }, (_, i) => ({ x: f(i)[0], y: f(i)[1], p }));

describe("canvas geometry", () => {
  it("simplifies a straight line to its end points and keeps corners", () => {
    expect(
      simplify(
        line(50, (i) => [i, 2 * i]),
        0.5,
      ),
    ).toHaveLength(2);
    const corner = [...line(20, (i) => [i, 0]), ...line(20, (i) => [19, i + 1])];
    const s = simplify(corner, 0.5);
    expect(s).toHaveLength(3);
    expect(s[1]).toMatchObject({ x: 19, y: 0 });
  });

  it("keeps points that deviate more than ε", () => {
    const zig = line(11, (i) => [i * 10, i % 2 ? 0.6 : 0]);
    expect(simplify(zig, 0.5).length).toBeGreaterThan(2);
    expect(simplify(zig, 1).length).toBe(2);
  });

  it("encodes strokes in 1/10 pt with pressure 0–255 and round-trips", () => {
    const pts = [
      { x: 0, y: 0, p: 0 },
      { x: 13.333, y: 26.667, p: 1 },
      { x: 40, y: 0, p: 0.5 },
    ];
    const flat = encodeStroke(pts);
    expect(flat).toEqual([0, 0, 0, 100, 200, 255, 300, 0, 128]);
    expect(flat.every(Number.isInteger)).toBe(true);
    const back = decodeStroke(flat);
    expect(back[1]!.x).toBeCloseTo(13.333, 1);
    expect(back[1]!.p).toBe(1);
  });

  it("drops points that quantise to the same position", () => {
    const flat = encodeStroke([
      { x: 0, y: 0, p: 0.5 },
      { x: 0.02, y: 5, p: 0.5 },
      { x: 0.03, y: 5.01, p: 0.5 },
      { x: 0, y: 10, p: 0.5 },
    ]);
    expect(flat.length % 3).toBe(0);
    for (let i = 3; i < flat.length; i += 3) expect([flat[i], flat[i + 1]]).not.toEqual([flat[i - 3], flat[i - 2]]);
  });

  it("translates stored points by surface px", () => {
    const moved = translateStroke([10, 20, 128, 30, 40, 0], 4 * PX_PER_INK, -2 * PX_PER_INK);
    expect(moved).toEqual([14, 18, 128, 34, 38, 0]);
  });

  it("pressure: mouse and missing pressure are 0.5", () => {
    expect(normPressure(0.5, "mouse")).toBe(0.5);
    expect(normPressure(0, "pen")).toBe(0.5);
    expect(normPressure(0.9, "pen")).toBe(0.9);
    expect(radiusAt(4, 1, true)).toBeGreaterThan(radiusAt(4, 0.2, true));
    expect(radiusAt(12, 1, false)).toBe(6);
  });

  it("outlines a stroke as one closed path; a single point is a dot", () => {
    const d = strokeOutline(
      line(10, (i) => [i * 5, Math.sin(i) * 10]),
      3,
    );
    expect(d.startsWith("M")).toBe(true);
    expect(d.endsWith("Z")).toBe(true);
    expect(d).toContain("A");
    expect(strokeOutline([{ x: 5, y: 5, p: 0.5 }], 4)).toMatch(/^M3 5a2 2 0 1 0 4 0/);
    expect(strokeOutline([], 2)).toBe("");
  });

  it("the outline is about as wide as the stroke", () => {
    const d = strokeOutline(
      line(3, (i) => [i * 50, 0]),
      10,
      false,
    );
    const ys = [...d.matchAll(/[MLQ][^A-Za-z]*/g)].flatMap((m) => m[0].slice(1).trim().split(/[ ,]+/).map(Number)).filter((_, i) => i % 2 === 1);
    expect(Math.max(...ys)).toBeLessThanOrEqual(5.01);
  });

  it("hit tests strokes with the eraser radius", () => {
    const s = line(2, (i) => [i * 100, 0]);
    expect(strokeHit(s, 2, 50, 4, 3)).toBe(true);
    expect(strokeHit(s, 2, 50, 10, 3)).toBe(false);
    expect(strokeHit([{ x: 0, y: 0, p: 1 }], 2, 3, 0, 2)).toBe(true);
  });

  it("lasso: points in polygon, strokes mostly inside, boxes by centre", () => {
    const sq = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    expect(pointInPolygon(50, 50, sq)).toBe(true);
    expect(pointInPolygon(150, 50, sq)).toBe(false);
    expect(
      strokeInLasso(
        line(10, (i) => [10 + i * 5, 50]),
        sq,
      ),
    ).toBe(true);
    expect(
      strokeInLasso(
        line(10, (i) => [60 + i * 10, 50]),
        sq,
      ),
    ).toBe(false);
    expect(rectInLasso({ x: 40, y: 40, w: 100, h: 10 }, sq)).toBe(true);
    expect(rectInLasso({ x: 90, y: 40, w: 100, h: 10 }, sq)).toBe(false);
  });

  it("snaps to the 8 px grid unless disabled; clamps zoom; reading order", () => {
    expect(snap(13, true)).toBe(16);
    expect(snap(11.9, true)).toBe(8);
    expect(snap(13, false)).toBe(13);
    expect(clampZoom(0.1)).toBe(0.25);
    expect(clampZoom(9)).toBe(4);
    expect(
      readingOrder([
        { x: 50, y: 10 },
        { x: 0, y: 10 },
        { x: 0, y: 0 },
      ]),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 10 },
      { x: 50, y: 10 },
    ]);
  });
});
