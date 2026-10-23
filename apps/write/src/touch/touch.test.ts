// P10-M4: the pure parts of Write's touch handling.
import { describe, expect, it } from "vitest";
import { clampZoom, fitWidthZoom, gapForZoom } from "./zoomGestures";

describe("fit-width zoom", () => {
  it("fits the page into the width less 16 px, never above 100 %", () => {
    expect(fitWidthZoom(412, 816)).toBeCloseTo(396 / 816, 2);
    expect(fitWidthZoom(2000, 816)).toBe(1);
    expect(fitWidthZoom(0, 816)).toBe(1);
  });
  it("clamps and keeps the screen gap", () => {
    expect(clampZoom(3, 0.5, 2)).toBe(2);
    expect(clampZoom(0.1, 0.5, 2)).toBe(0.5);
    expect(gapForZoom(8, 0.5)).toBe(16);
    expect(gapForZoom(8, 2)).toBe(4);
  });
});
