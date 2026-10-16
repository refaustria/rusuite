import { describe, expect, it } from "vitest";
import { FAKE_THEMES } from "../test/fixture";
import { FONT_PAIRS, sameColors, variantColors } from "./variants";

describe("Variants and Fonts", () => {
  const office = FAKE_THEMES[0]!.theme.colors;
  it("four colour variants: the accents rotate, dark/light stay", () => {
    const vs = [0, 1, 2, 3].map((k) => variantColors(office, k));
    expect(vs[0]).toBe(office);
    expect(vs[1]!.colors.slice(0, 4)).toEqual(office.colors.slice(0, 4));
    expect(vs[1]!.colors.slice(4, 10)).toEqual([...office.colors.slice(5, 10), office.colors[4]]);
    expect(new Set(vs.map((v) => v.colors.join())).size).toBe(4);
    expect(sameColors(vs[2], variantColors(office, 2))).toBe(true);
    expect(sameColors(vs[1], vs[2])).toBe(false);
  });
  it("at least eight font pairings with distinct names", () => {
    expect(FONT_PAIRS.length).toBeGreaterThanOrEqual(8);
    expect(new Set(FONT_PAIRS.map((f) => f.name)).size).toBe(FONT_PAIRS.length);
  });
});
