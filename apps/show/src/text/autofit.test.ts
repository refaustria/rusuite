import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TextBody } from "../generated/TextBody";
import { approxMeasure, layoutText, setMeasure, shrinkFit, SHRINK_STEPS, type LayoutOptions } from "./layout";
import { autofitProps, overflows, shrinkStep, toThousandths, withScale } from "./autofit";
import { fixture, textShape } from "../test/fixture";

const opts = (width: number, height: number): LayoutOptions => ({
  width,
  height,
  measure: approxMeasure,
  runStyle: () => ({ fontFamily: "Calibri", sizePx: 20, bold: false, italic: false, underline: false, strike: false, color: "#000" }),
  paragraphProps: (p) => p ?? {},
});
const body = (lines: string[], autofit: "none" | "shrink" = "shrink"): TextBody => ({
  props: { anchor: "top", wrap: true, insets: { left: 0, top: 0, right: 0, bottom: 0 }, autofit },
  paragraphs: lines.map((text) => ({ runs: [{ text }] })),
});

beforeEach(() => setMeasure(approxMeasure));
afterEach(() => setMeasure(null));

describe("text autofit", () => {
  it("fits: no scale; overflow: line spacing first, then the font", () => {
    expect(shrinkFit(body(["a"]), opts(200, 100))).toEqual({ fontScale: 1, lineReduction: 0 });
    // 4 lines × 24 px = 96 px into 90 px: 10 % less line spacing is enough
    expect(shrinkFit(body(["a", "b", "c", "d"]), opts(200, 90))).toEqual({ fontScale: 1, lineReduction: 0.1 });
    const deep = shrinkFit(body(["a", "b", "c", "d", "e", "f"]), opts(200, 80));
    expect(deep.lineReduction).toBe(0.2);
    expect(deep.fontScale).toBeLessThan(1);
    expect(SHRINK_STEPS.some((s) => s.fontScale === deep.fontScale)).toBe(true);
  });

  it("stores the scale in 1/1000 % (fields left out at 100 % / 0)", () => {
    expect(toThousandths(0.625)).toBe(62500);
    const p = body([""]).props;
    expect(withScale(p, { fontScale: 0.85, lineReduction: 0.2 })).toMatchObject({ fontScale: 85000, lineReduction: 20000 });
    expect(withScale(p, { fontScale: 1, lineReduction: 0 })).not.toHaveProperty("fontScale");
    expect(withScale({ ...p, autofit: "none", fontScale: 50000 }, { fontScale: 0.5, lineReduction: 0 })).not.toHaveProperty("fontScale");
    expect(shrinkStep(body(["a", "b", "c", "d"], "none"), opts(200, 10))).toEqual({ fontScale: 1, lineReduction: 0 });
  });

  it("the layout uses the stored scale (as written to the file)", () => {
    const b = { ...body(["a", "b"]), props: { ...body(["a"]).props, fontScale: 50000 } };
    const lay = layoutText(b, opts(200, 400));
    expect(lay.fragments[0]!.fontSize).toBe(10);
    expect(lay.overflow).toBe(false);
    expect(layoutText(body(["a", "b", "c"], "none"), opts(200, 30)).overflow).toBe(true);
  });

  it("vertical text and columns", () => {
    const rotated = { ...body(["abc"]), props: { ...body([""]).props, vert: "rotate90" as const } };
    expect(layoutText(rotated, opts(100, 300)).rotation).toBe(90);
    const cols = { ...body(["a", "b", "c", "d"], "none"), props: { ...body([""], "none").props, columns: 2 } };
    const lay = layoutText(cols, opts(200, 48));
    // two lines per column: c and d move to the second column
    expect(lay.fragments.map((f) => [f.text, Math.round(f.x), Math.round(f.y)])).toEqual([["a", 0, 2], ["b", 0, 26], ["c", 100, 2], ["d", 100, 26]]);
    const stacked = { ...body(["ab"], "none"), props: { ...body([""], "none").props, vert: "stacked" as const } };
    expect(layoutText(stacked, opts(100, 300)).fragments.map((f) => f.text)).toEqual(["a", "b"]);
  });

  it("autofitProps for a shape on a slide (null when unchanged)", () => {
    const p = fixture();
    const slide = p.slides[1]!;
    const shape = textShape(6, Array.from({ length: 12 }, (_, i) => `Point ${i}`), { placeholder: "body" });
    shape.transform = { x: 0, y: 0, w: 2000000, h: 600000 };
    if (shape.kind.kind !== "auto") throw new Error();
    const b = { ...shape.kind.value.text!, props: { ...shape.kind.value.text!.props, autofit: "shrink" as const } };
    const props = autofitProps(p, slide, shape, b);
    expect(props?.fontScale).toBeLessThan(100000);
    expect(autofitProps(p, slide, shape, { ...b, props: props! })).toBeNull();
    expect(autofitProps(p, slide, shape, { ...b, props: { ...b.props, autofit: "none" } })).toBeNull();
    expect(overflows(p, slide, { ...shape, kind: { kind: "auto", value: { ...shape.kind.value, text: { ...b, props: { ...b.props, autofit: "none" } } } } })).toBe(true);
  });
});
