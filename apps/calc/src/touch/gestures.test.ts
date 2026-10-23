import { describe, expect, it } from "vitest";
import { clampZoom, edgeScroll, isDoubleTap, TOUCH_EDGE } from "./gestures";

describe("touch gestures (P10-M3)", () => {
  it("clamps the pinch zoom to 50 – 200 % in whole percent", () => {
    expect(clampZoom(3)).toBe(2);
    expect(clampZoom(0.1)).toBe(0.5);
    expect(clampZoom(1.234)).toBe(1.23);
    expect(clampZoom(Number.NaN)).toBe(1);
  });
  it("recognises a double tap on the same target only", () => {
    const a = { key: "col1", x: 10, y: 10, at: 1000 };
    expect(isDoubleTap(null, a)).toBe(false);
    expect(isDoubleTap(a, { ...a, at: 1300, x: 14 })).toBe(true);
    expect(isDoubleTap(a, { ...a, at: 1500 })).toBe(false);
    expect(isDoubleTap(a, { ...a, key: "col2", at: 1100 })).toBe(false);
    expect(isDoubleTap(a, { ...a, x: 60, at: 1100 })).toBe(false);
  });
  it("scrolls near the edges while a handle is dragged", () => {
    expect(edgeScroll(5, 300, 20)).toBe(-20);
    expect(edgeScroll(300 - TOUCH_EDGE / 2, 300, 20)).toBe(20);
    expect(edgeScroll(150, 300, 20)).toBe(0);
    expect(edgeScroll(5, 40, 20)).toBe(0);
  });
});

describe("tokenStep", async () => {
  const { tokenStep } = await import("./gestures");
  const { tokenize } = await import("../formula/tokenize");
  it("moves the caret over whole tokens", () => {
    const text = "=SUM(B2:B5)";
    const toks = tokenize(text).tokens;
    expect(tokenStep(toks, text.length, text.length, -1)).toBe(10);
    expect(tokenStep(toks, text.length, 10, -1)).toBe(8);
    expect(tokenStep(toks, text.length, 8, -1)).toBe(7);
    expect(tokenStep(toks, text.length, 1, 1)).toBe(4);
    expect(tokenStep(toks, text.length, 0, -1)).toBe(0);
    expect(tokenStep(toks, text.length, text.length, 1)).toBe(text.length);
  });
});
