import { describe, expect, it } from "vitest";
import { angleDelta, clampTouchZoom, pinchMetrics, pinchNodes, snapRotation, touchAnchorHit } from "./touch";

describe("touch gestures (P10-M5)", () => {
  it("measures two fingers", () => {
    const m = pinchMetrics({ x: 0, y: 0 }, { x: 0, y: 10 });
    expect(m.dist).toBe(10);
    expect(m.angle).toBe(90);
    expect(m.mid).toEqual({ x: 0, y: 5 });
  });
  it("takes the short way round", () => {
    expect(angleDelta(170, -170)).toBe(20);
    expect(angleDelta(-170, 170)).toBe(-20);
    expect(angleDelta(10, 40)).toBe(30);
  });
  it("snaps within 3° of a right angle", () => {
    expect(snapRotation(88)).toBe(90);
    expect(snapRotation(-2)).toBe(-0);
    expect(snapRotation(273)).toBe(270);
    expect(snapRotation(86)).toBe(86);
  });
  it("clamps the canvas zoom to 50–300 %", () => {
    expect(clampTouchZoom(0.1)).toBe(0.5);
    expect(clampTouchZoom(5)).toBe(3);
    expect(clampTouchZoom(1.5)).toBe(1.5);
  });
  it("scales and turns the selection about its centre", () => {
    const [a, b] = pinchNodes(
      [
        { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
        { x: 10, y: 0, rotation: 10, scaleX: 1, scaleY: 1 },
      ],
      { x: 5, y: 0 },
      { x: 1, y: 2 },
      2,
      89,
    );
    // the first node's rotation snaps to 90, the second turns by the same amount
    expect(a!.rotation).toBe(90);
    expect(b!.rotation).toBe(100);
    expect(a!.scaleX).toBe(2);
    expect(a!.x).toBeCloseTo(6);
    expect(a!.y).toBeCloseTo(-8);
    expect(b!.x).toBeCloseTo(6);
    expect(b!.y).toBeCloseTo(12);
  });
  it("gives handles 44 px outwards and at most a quarter of the box inwards", () => {
    expect(touchAnchorHit("top-left", 400, 400)).toEqual({ x: -22, y: -22, width: 44, height: 44 });
    expect(touchAnchorHit("bottom-right", 40, 40)).toEqual({ x: -10, y: -10, width: 32, height: 32 });
    expect(touchAnchorHit("top-center", 40, 400)).toEqual({ x: -10, y: -22, width: 20, height: 44 });
    expect(touchAnchorHit("rotater", 10, 10)).toEqual({ x: -22, y: -22, width: 44, height: 44 });
  });
});
