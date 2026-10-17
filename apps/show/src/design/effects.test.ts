import { describe, expect, it } from "vitest";
import { addStop, currentEffectScheme, EFFECT_SCHEMES, gradientPreset, removeStop, sortStops } from "./effects";
import { PATTERN_PRESETS, patternDataUrl, patternPixel } from "./patterns";
import { effectShadow, fillCssBackground, resolveBackground } from "./color";
import { fixture } from "../test/fixture";

describe("effect schemes and gradient presets (P9-S3)", () => {
  it("every scheme has three effect styles; the current one is found by its styles", () => {
    for (const s of EFFECT_SCHEMES) expect(s.styles).toHaveLength(3);
    expect(currentEffectScheme(EFFECT_SCHEMES[2]!.styles)).toBe("subtle");
    expect(currentEffectScheme([])).toBeUndefined();
  });

  it("a shape's effectRef resolves to a Konva shadow of the theme's effect style", () => {
    const theme = fixture().theme;
    theme.format = { ...theme.format!, effectStyles: EFFECT_SCHEMES.find((s) => s.id === "intense")!.styles };
    const sh = effectShadow(theme, 3, 12700 / (96 / 72));
    expect(sh.shadowColor).toBe("#000000");
    expect(sh.shadowOpacity).toBeCloseTo(0.6);
    expect(sh.shadowOffsetX as number).toBeGreaterThan(0);
    expect(effectShadow(theme, 0, 9525)).toEqual({});
    // past the end: the last style
    expect(effectShadow(theme, 7, 9525)).toEqual(effectShadow(theme, 3, 9525));
  });

  it("gradient presets resolve to CSS; stops are added halfway and two stay", () => {
    const g = gradientPreset("radial", "accent2");
    expect(g.shape).toBe("circle");
    const css = fillCssBackground(resolveBackground(fixture().theme, { kind: "gradient", value: g }));
    expect(css).toMatch(/^radial-gradient\(circle, /);
    const stops = [{ pos: 0 }, { pos: 1 }];
    const added = addStop(stops, 0);
    expect(added.stops.map((s) => s.pos)).toEqual([0, 0.5, 1]);
    expect(added.index).toBe(1);
    expect(removeStop(added.stops, 1).map((s) => s.pos)).toEqual([0, 1]);
    expect(removeStop(stops, 0)).toHaveLength(2);
    expect(sortStops([{ pos: 0.7 }, { pos: 0.2 }]).map((s) => s.pos)).toEqual([0.2, 0.7]);
  });

  it("patterns: 48 presets as 8 × 8 tiles in two colours", () => {
    expect(PATTERN_PRESETS).toHaveLength(48);
    expect(patternPixel("smCheck", 0, 0)).toBe(true);
    expect(patternPixel("horz", 3, 1)).toBe(false);
    expect(patternPixel("horz", 3, 0)).toBe(true);
    const url = decodeURIComponent(patternDataUrl("pct50", "FF0000", "FFFFFF"));
    expect(url).toContain('fill="#FFFFFF"');
    expect(url.match(/<rect x=/g)).toHaveLength(32);
    const bg = resolveBackground(fixture().theme, { kind: "pattern", value: { preset: "dnDiag", fg: { kind: "rgb", value: "000000" }, bg: { kind: "rgb", value: "FFFFFF" } } });
    expect(bg).toEqual({ kind: "pattern", value: { preset: "dnDiag", fg: "000000", bg: "FFFFFF" } });
    expect(fillCssBackground(bg)).toMatch(/^url\("data:image\/svg\+xml,/);
  });
});
