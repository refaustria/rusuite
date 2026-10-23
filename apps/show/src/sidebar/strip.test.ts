import { describe, expect, it } from "vitest";
import { stripDropIndex } from "./SlideStrip";

describe("slide strip (P10-M5)", () => {
  const edges = [{ left: 0, right: 100 }, { left: 108, right: 208 }, { left: 216, right: 316 }];
  it("drops before the thumbnail whose middle is right of the finger", () => {
    expect(stripDropIndex(edges, -5)).toBe(0);
    expect(stripDropIndex(edges, 49)).toBe(0);
    expect(stripDropIndex(edges, 51)).toBe(1);
    expect(stripDropIndex(edges, 200)).toBe(2);
    expect(stripDropIndex(edges, 300)).toBe(3);
    expect(stripDropIndex([], 10)).toBe(0);
  });
});
