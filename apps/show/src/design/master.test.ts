import { describe, expect, it } from "vitest";
import { designFixture } from "../test/fixture";
import { DESIGN_SHAPE_BASE, designSlide, placeholderOfShape, sampleParagraphs, translateDesignCommand, validTarget } from "./master";

describe("the master view's pseudo slide and its commands", () => {
  const pres = designFixture();

  it("one shape per placeholder with PowerPoint's sample text (5 levels in the body)", () => {
    const s = designSlide(pres, { kind: "master" });
    expect(s.shapes.map((x) => x.placeholder)).toEqual(["title", "body", "dateTime", "footer", "slideNumber"]);
    expect(s.shapes[0]!.id).toBe(DESIGN_SHAPE_BASE);
    expect(s.shapes[1]!.transform).toEqual(pres.master!.placeholders[1]!.transform);
    const body = s.shapes[1]!.kind.kind === "auto" ? s.shapes[1]!.kind.value.text! : null;
    expect(body!.paragraphs.map((p) => p.props?.level ?? 0)).toEqual([0, 1, 2, 3, 4]);
    expect(sampleParagraphs("slideNumber")[0]!.runs[0]!.field).toEqual({ kind: "slideNumber" });
    expect(designSlide(pres, { kind: "master" })).toBe(s); // memoized
    const two = designSlide(pres, { kind: "layout", value: "twoContent" });
    expect(two.layout).toBe("twoContent");
    expect(two.shapes.filter((x) => x.placeholder === "body").map((x) => x.placeholderIdx)).toEqual([1, 2]);
  });

  it("moving a placeholder → SetMasterPlaceholderProps with the transform (idx kept)", () => {
    const t = { x: 1, y: 2, w: 3, h: 4 };
    const r = translateDesignCommand(pres, { kind: "layout", value: "twoContent" }, { type: "setTransform", shapes: [[DESIGN_SHAPE_BASE + 2, t]] });
    expect(r).toEqual({
      commands: [{ type: "setMasterPlaceholderProps", target: { kind: "layout", value: "twoContent" }, placeholder: "body", idx: 2, patch: { transform: { ...t, rotationDeg: 0 } } }],
      dropped: false,
    });
  });

  it("level-1 run and paragraph formatting → run / paragraph patches; deeper levels are dropped", () => {
    const target = { kind: "master" } as const;
    const r = translateDesignCommand(pres, target, {
      type: "compound",
      commands: [
        { type: "setTextBody", shape: DESIGN_SHAPE_BASE, body: { props: pres.master!.placeholders[0]!.bodyDefaults, paragraphs: [] } },
        { type: "setRunProps", shape: DESIGN_SHAPE_BASE, paragraph: 0, from: 0, to: 5, patch: { bold: true } },
        { type: "setRunProps", shape: DESIGN_SHAPE_BASE + 1, paragraph: 2, from: 0, to: 5, patch: { bold: true } },
      ],
    });
    expect(r.commands).toEqual([{ type: "setMasterPlaceholderProps", target, placeholder: "title", patch: { run: { bold: true } } }]);
    expect(r.dropped).toBe(true);
    const p = translateDesignCommand(pres, target, { type: "setParagraphProps", shape: DESIGN_SHAPE_BASE + 1, paragraphs: [0], patch: { alignment: "center", level: 1 } });
    expect(p).toEqual({ commands: [{ type: "setMasterPlaceholderProps", target, placeholder: "body", idx: 1, patch: { paragraph: { alignment: "center" } } }], dropped: false });
    expect(translateDesignCommand(pres, target, { type: "deleteShapes", ids: [DESIGN_SHAPE_BASE] }).dropped).toBe(true);
    expect(placeholderOfShape(pres, target, 5)).toBeUndefined();
  });

  it("a deleted layout target falls back to the master", () => {
    expect(validTarget(pres, { kind: "layout", value: "custom:gone" })).toEqual({ kind: "master" });
    expect(validTarget(pres, { kind: "layout", value: "twoContent" })).toEqual({ kind: "layout", value: "twoContent" });
  });
});
