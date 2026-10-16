import { describe, expect, it } from "vitest";
import type { PictureProps } from "../generated/PictureProps";
import { CORRECTION_STEPS, PICTURE_STYLES, SHADOW_PRESETS, cropSource, cssFilter, dragCrop, fullImageBox, needsPixels, processPixels, recolorPresets, stylePatch, transfer } from "./picture";
import { panCrop } from "../canvas/CropOverlay";

const shadow = { color: { kind: "rgb", value: "000000" }, alpha: 0.4, blur: 50800, distance: 38100, directionDeg: 45 } as const;

describe("picture adjustments (docs/pptx-suite.md)", () => {
  it("brightness / contrast transfer like PictureProps::transfer", () => {
    expect(transfer({ brightness: 0.2, contrast: 0.5 })).toEqual([2, -0.3]);
    const [s, i] = transfer({ contrast: -0.4 });
    expect(s).toBeCloseTo(0.6);
    expect(i).toBeCloseTo(0.2);
    expect(transfer({})).toEqual([1, 0]);
  });

  it("the CSS filter string equals the core's css_filter", () => {
    const p: PictureProps = { brightness: 0.2, contrast: 0.5, recolor: { kind: "grayscale" }, transparency: 0.25, shadow };
    expect(cssFilter(p)).toBe("grayscale(1) brightness(1.2) contrast(2) opacity(0.75) drop-shadow(2.828px 2.828px 2.667px rgba(0, 0, 0, 0.4))");
    expect(cssFilter({})).toBe("");
    expect(cssFilter({ recolor: { kind: "blackWhite", value: { threshold: 0.5 } } })).toBe("grayscale(1) contrast(100)");
    expect(cssFilter({ recolor: { kind: "duotone", value: { dark: "000000", light: "FFFFFF" } } })).toBe("sepia(1)");
  });

  it("pixels: recolour, then the linear transfer", () => {
    const px = (p: PictureProps, rgb: number[]) => {
      const d = [...rgb, 255];
      processPixels(d, p);
      return d.slice(0, 3);
    };
    expect(px({ recolor: { kind: "grayscale" } }, [255, 0, 0])).toEqual([76, 76, 76]);
    expect(px({ recolor: { kind: "blackWhite", value: { threshold: 0.5 } } }, [200, 200, 200])).toEqual([255, 255, 255]);
    expect(px({ recolor: { kind: "blackWhite", value: { threshold: 0.5 } } }, [100, 100, 100])).toEqual([0, 0, 0]);
    expect(px({ recolor: { kind: "sepia" } }, [255, 255, 255])).toEqual([0xd9, 0xc3, 0xa5]);
    expect(px({ recolor: { kind: "duotone", value: { dark: "102030", light: "FFFFFF" } } }, [0, 0, 0])).toEqual([0x10, 0x20, 0x30]);
    expect(px({ brightness: 0.2 }, [100, 100, 100])).toEqual([151, 151, 151]);
    expect(px({ contrast: 0.5 }, [64, 128, 192])).toEqual([0, 129, 255]);
    expect(needsPixels({ transparency: 0.5 })).toBe(false);
    expect(needsPixels({ contrast: 0.1 })).toBe(true);
  });

  it("crop source rectangle and the whole image's box", () => {
    expect(Object.fromEntries(Object.entries(cropSource({ left: 0.1, top: 0.2, right: 0.3, bottom: 0 }, 1000, 500)).map(([k, v]) => [k, Math.round(v)]))).toEqual({ x: 100, y: 100, width: 600, height: 400 });
    expect(cropSource(undefined, 10, 10)).toEqual({ x: 0, y: 0, width: 10, height: 10 });
    expect(fullImageBox({ left: 0.25, top: 0, right: 0.25, bottom: 0.5 }, { x: 1000, y: 0, w: 500, h: 300 })).toEqual({ x: 750, y: 0, w: 1000, h: 600 });
  });

  it("dragging crop handles moves that edge, the image stays put", () => {
    const box = { x: 0, y: 0, w: 1000, h: 1000 };
    const l = dragCrop(undefined, box, "l", 100, 0);
    expect(l.crop).toEqual({ left: 0.1, top: 0, right: 0, bottom: 0 });
    expect(l.box).toEqual({ x: 100, y: 0, w: 900, h: 1000 });
    const br = dragCrop(l.crop, l.box, "br", -100, -200);
    expect(br.crop).toEqual({ left: 0.1, top: 0, right: 0.1, bottom: 0.2 });
    expect(br.box).toEqual({ x: 100, y: 0, w: 800, h: 800 });
    // outwards = padding
    expect(dragCrop(undefined, box, "t", 0, -100).crop.top).toBeCloseTo(-0.1);
    // never less than 1 % visible
    expect(dragCrop(undefined, box, "r", -5000, 0).crop.right).toBeCloseTo(0.99);
    expect(panCrop({ left: 0.1, top: 0, right: 0.1, bottom: 0 }, { w: 800, h: 1000 }, 100, 0)).toEqual({ left: 0, top: 0, right: 0.2, bottom: 0 });
  });

  it("presets: 5 × 5 corrections, recolours with a duotone per accent, ≥ 8 picture styles", () => {
    expect(CORRECTION_STEPS).toHaveLength(5);
    const r = recolorPresets(["4472C4", "ED7D31", "A5A5A5", "FFC000", "5B9BD5", "70AD47"]);
    expect(r.map((x) => x.id)).toEqual(["none", "grayscale", "sepia", "bw25", "bw50", "bw75", "duo1", "duo2", "duo3", "duo4", "duo5", "duo6"]);
    expect(r[6]!.recolor).toEqual({ kind: "duotone", value: { dark: "182845", light: "FFFFFF" } });
    expect(PICTURE_STYLES.length).toBeGreaterThanOrEqual(8);
    expect(new Set(PICTURE_STYLES.map((s) => s.geometry)).size).toBeGreaterThanOrEqual(4);
    expect(stylePatch(PICTURE_STYLES.find((s) => s.id === "oval")!)).toEqual({ geometry: "ellipse", shadow: null });
    expect(SHADOW_PRESETS[0]!.shadow).toBeNull();
  });
});
