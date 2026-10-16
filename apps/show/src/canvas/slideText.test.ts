// Text of placeholders on the canvas: picture prompts, vertical placeholders (P8-40 S-03, S-04).
import { describe, expect, it, vi } from "vitest";

vi.mock("react-konva", () => import("../test/konvaMock"));

import { deckOf } from "../design/deck";
import { themePalette } from "../model";
import type { Shape } from "../generated/Shape";
import { designFixture, rect } from "../test/fixture";
import { layoutShapeText, type TextCtx } from "./SlideView";

const pres = designFixture();
const empty = (placeholder: Shape["placeholder"], idx?: number): Shape => ({
  ...rect(50, 0, 0),
  kind: { kind: "auto", value: { geometry: "rect", text: { props: { anchor: "top", wrap: true, insets: { left: 91440, top: 45720, right: 91440, bottom: 45720 }, autofit: "none" }, paragraphs: [{ runs: [] }] } } },
  placeholder,
  placeholderIdx: idx,
});
const body = (s: Shape) => (s.kind.kind === "auto" ? s.kind.value.text! : null)!;

function ctx(layouts = pres.layouts): TextCtx {
  return { deck: { ...deckOf(pres), layouts }, slide: { ...pres.slides[1]!, layout: "titleContent" }, palette: themePalette(pres.theme), asMaster: false, slideNumber: 2 };
}

describe("placeholder text on the canvas", () => {
  it("a vertical placeholder (orient=vert) turns its text 90°", () => {
    const shape = empty("body", 1);
    expect(layoutShapeText(ctx(), shape, body(shape), 300, 200, "Click to add text").rotation).toBeUndefined();
    const vertical = pres.layouts.map((l) => (l.kind === "titleContent" ? { ...l, placeholders: l.placeholders.map((p) => (p.kind === "body" ? { ...p, vertical: true } : p)) } : l));
    expect(layoutShapeText(ctx(vertical), shape, body(shape), 300, 200, "Click to add text").rotation).toBe(90);
  });

  it("a picture placeholder's prompt is drawn without a bullet", () => {
    const shape = empty("picture", 1);
    const texts = layoutShapeText(ctx(), shape, body(shape), 300, 200, "Picture").fragments.map((f) => f.text);
    expect(texts.join("")).toBe("Picture");
  });
});
