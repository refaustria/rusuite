import { describe, expect, it } from "vitest";
import type { ColorMod } from "../generated/ColorMod";
import type { Theme } from "../generated/Theme";
import { FAKE_THEMES } from "../test/fixture";
import { applyMods, fillCssBackground, gradientLine, konvaFill, resolveBackground, resolveColor, resolveStyleColor, schemeColor, tint } from "./color";

const office = FAKE_THEMES[0]!.theme;
const harbor = FAKE_THEMES[1]!.theme;
const m = (kind: ColorMod["kind"], value: number) => ({ kind, value }) as ColorMod;

describe("theme colour resolution (port of Theme::resolve / apply_mods)", () => {
  // The same expectations as crates/model-show/src/theme.rs.
  it.each([
    ["4472C4", [m("lumMod", 60000), m("lumOff", 40000)], "8FAADC", 1],
    ["4472C4", [m("lumMod", 75000)], "2F5597", 1],
    ["FFFFFF", [m("shade", 50000), m("alpha", 40000)], "808080", 0.4],
    ["000000", [m("tint", 25000)], "BFBFBF", 1],
    ["4472C4", [], "4472C4", 1],
    ["808080", [m("lumMod", 0)], "000000", 1],
    ["FF0000", [m("satMod", 0)], "808080", 1],
    ["4472C4", [m("lumOff", 200000)], "FFFFFF", 1],
    ["FF0000", [m("hueMod", 100000)], "FF0000", 1],
  ])("%s with %j → %s", (base, mods, rgb, alpha) => {
    expect(applyMods(base, mods)).toEqual({ rgb, alpha });
  });

  it("model colours: scheme slots, tints like Excel/ECMA, auto = Dark 1", () => {
    expect(resolveColor(office, { kind: "theme", value: { slot: "accent1", tint: 0 } })).toBe("4472C4");
    expect(resolveColor(office, { kind: "theme", value: { slot: "accent1", tint: 0.4 } })).toBe("8FAADC");
    expect(resolveColor(office, { kind: "theme", value: { slot: "accent1", tint: -0.25 } })).toBe("2F5597");
    expect(resolveColor(office, { kind: "auto" })).toBe("000000");
    expect(resolveColor(harbor, { kind: "auto" })).toBe("1B2A3A");
    expect(resolveColor(office, { kind: "rgb", value: "abcdef" })).toBe("ABCDEF");
    expect(tint("000000", 0.5)).toBe("808080");
    expect(schemeColor(undefined, "accent2")).toBe("ED7D31");
  });

  it("format-scheme colours: phClr, scheme base, rgb base", () => {
    expect(resolveStyleColor(office, { base: { kind: "placeholder" }, mods: [m("shade", 50000)] }, "FFFFFF")).toEqual({ rgb: "808080", alpha: 1 });
    expect(resolveStyleColor(office, { base: { kind: "scheme", value: "accent2" } }, "000000").rgb).toBe("ED7D31");
    expect(resolveStyleColor(office, { base: { kind: "rgb", value: "112233" } }, "000000").rgb).toBe("112233");
  });

  it("backgrounds: fills, bgRef 1001… into bgFillStyles, out of range → the last, no styles → the colour", () => {
    expect(resolveBackground(office, { kind: "fill", value: { kind: "none" } })).toEqual({ kind: "none" });
    expect(resolveBackground(office, { kind: "fill", value: { kind: "solid", value: { kind: "rgb", value: "FF0000" } } })).toEqual({ kind: "solid", value: { color: "FF0000", alpha: 1 } });
    // Office in the fixture has no format scheme: the reference colour
    expect(resolveBackground(office, { kind: "style", value: { index: 1003, color: { kind: "theme", value: { slot: "accent1", tint: 0 } } } })).toEqual({ kind: "solid", value: { color: "4472C4", alpha: 1 } });
    const g = resolveBackground(harbor, { kind: "style", value: { index: 1003, color: { kind: "theme", value: { slot: "accent1", tint: 0 } } } });
    expect(g.kind).toBe("gradient");
    if (g.kind === "gradient") {
      expect(g.value.stops).toHaveLength(2);
      expect(g.value.stops[1]!.color).toBe(applyMods("0F6E8C", [m("shade", 60000)]).rgb);
    }
    const last = resolveBackground(harbor, { kind: "style", value: { index: 1009, color: { kind: "theme", value: { slot: "light1", tint: 0 } } } });
    expect(last.kind).toBe("gradient");
    const tinted = resolveBackground(harbor, { kind: "style", value: { index: 1002, color: { kind: "theme", value: { slot: "dark1", tint: 0 } } } });
    expect(tinted).toEqual({ kind: "solid", value: { color: applyMods("1B2A3A", [m("tint", 95000)]).rgb, alpha: 1 } });
    const fillStyle = resolveBackground(harbor as Theme, { kind: "style", value: { index: 1, color: { kind: "rgb", value: "123456" } } });
    expect(fillStyle).toEqual({ kind: "solid", value: { color: "123456", alpha: 1 } });
  });

  it("Konva and CSS fills of resolved fills", () => {
    expect(konvaFill({ kind: "solid", value: { color: "FF0000", alpha: 0.5 } }, 10, 10)).toEqual({ fill: "rgba(255, 0, 0, 0.5)" });
    const k = konvaFill({ kind: "gradient", value: { angleDeg: 90, shape: "linear", stops: [{ pos: 0, color: "000000", alpha: 1 }, { pos: 1, color: "FFFFFF", alpha: 1 }] } }, 100, 50);
    expect(k.fillLinearGradientStartPoint).toEqual({ x: 50, y: 0 });
    expect(k.fillLinearGradientEndPoint).toEqual({ x: 50, y: 50 });
    expect(k.fillLinearGradientColorStops).toEqual([0, "#000000", 1, "#FFFFFF"]);
    expect(gradientLine(0, 100, 50)).toEqual({ start: { x: 0, y: 25 }, end: { x: 100, y: 25 } });
    expect(fillCssBackground({ kind: "gradient", value: { angleDeg: 90, shape: "linear", stops: [{ pos: 0, color: "000000", alpha: 1 }, { pos: 1, color: "FFFFFF", alpha: 1 }] } })).toBe("linear-gradient(180deg, #000000 0%, #FFFFFF 100%)");
    expect(fillCssBackground({ kind: "none" })).toBeUndefined();
  });
});
