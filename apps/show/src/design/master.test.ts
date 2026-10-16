import { describe, expect, it } from "vitest";
import { designFixture } from "../test/fixture";
import type { ShowCommand } from "../generated/ShowCommand";
import { DESIGN_SHAPE_BASE, designSlide, placeholderOfShape, placeholderText, sampleParagraphs, targetPlaceholders, translateDesignCommand, validTarget } from "./master";

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

  it("level-1 run and paragraph formatting → placeholder patches; deeper master body levels → the text style", () => {
    const target = { kind: "master" } as const;
    const r = translateDesignCommand(pres, target, {
      type: "compound",
      commands: [
        { type: "setRunProps", shape: DESIGN_SHAPE_BASE, paragraph: 0, from: 0, to: 5, patch: { bold: true } },
        { type: "setRunProps", shape: DESIGN_SHAPE_BASE + 1, paragraph: 2, from: 0, to: 5, patch: { bold: true } },
      ],
    });
    expect(r.commands).toEqual([
      { type: "setMasterPlaceholderProps", target, placeholder: "title", patch: { run: { bold: true } } },
      { type: "setMasterTextStyle", which: "body", level: 2, run: { bold: true } },
    ]);
    expect(r.dropped).toBe(false);
    const p = translateDesignCommand(pres, target, { type: "setParagraphProps", shape: DESIGN_SHAPE_BASE + 1, paragraphs: [0, 1], patch: { alignment: "center", level: 1 } });
    expect(p).toEqual({
      commands: [
        { type: "setMasterPlaceholderProps", target, placeholder: "body", idx: 1, patch: { paragraph: { alignment: "center" } } },
        { type: "setMasterTextStyle", which: "body", level: 1, paragraph: { alignment: "center" } },
      ],
      dropped: false,
    });
    expect(placeholderOfShape(pres, target, 5)).toBeUndefined();
  });

  it("a chosen text level takes the master body's formatting (levels 6–9 too)", () => {
    const target = { kind: "master" } as const;
    const whole: ShowCommand = {
      type: "compound",
      commands: [0, 1, 2].map((paragraph) => ({ type: "setRunProps", shape: DESIGN_SHAPE_BASE + 1, paragraph, from: 0, to: 3, patch: { italic: true } }) as ShowCommand),
    };
    expect(translateDesignCommand(pres, target, whole, { level: 6 }).commands).toEqual([{ type: "setMasterTextStyle", which: "body", level: 6, run: { italic: true } }]);
    // other placeholders ignore the level
    expect(translateDesignCommand(pres, target, { type: "setRunProps", shape: DESIGN_SHAPE_BASE, paragraph: 0, from: 0, to: 1, patch: { italic: true } }, { level: 6 }).commands[0]).toMatchObject({ type: "setMasterPlaceholderProps", placeholder: "title" });
  });

  it("deeper levels of layout placeholders are not stored (status message)", () => {
    const target = { kind: "layout", value: "titleContent" } as const;
    const r = translateDesignCommand(pres, target, { type: "setRunProps", shape: DESIGN_SHAPE_BASE + 1, paragraph: 1, from: 0, to: 2, patch: { bold: true } });
    expect(r).toEqual({ commands: [], dropped: true });
  });

  it("typed text becomes the prompt; the sample text again removes it", () => {
    const target = { kind: "layout", value: "titleContent" } as const;
    const typed = translateDesignCommand(pres, target, { type: "setTextBody", shape: DESIGN_SHAPE_BASE, body: { props: pres.master!.placeholders[0]!.bodyDefaults, paragraphs: [{ runs: [{ text: "Agenda" }] }] } });
    expect(typed.commands).toEqual([{ type: "setPlaceholderPrompt", target, placeholder: "title", prompt: "Agenda" }]);
    const withPrompt = { ...pres, layouts: pres.layouts.map((l) => (l.kind === "titleContent" ? { ...l, placeholders: l.placeholders.map((d, i) => (i === 0 ? { ...d, prompt: "Agenda" } : d)) } : l)) };
    const back = translateDesignCommand(withPrompt, target, { type: "setTextBody", shape: DESIGN_SHAPE_BASE, body: { props: pres.master!.placeholders[0]!.bodyDefaults, paragraphs: sampleParagraphs("title") } });
    expect(back.commands).toEqual([{ type: "setPlaceholderPrompt", target, placeholder: "title", prompt: null }]);
    // the pseudo shape shows the prompt
    expect(placeholderText({ ...withPrompt.layouts.find((l) => l.kind === "titleContent")!.placeholders[0]! })).toEqual([{ props: undefined, runs: [{ text: "Agenda" }] }]);
    // on the master's body every line is a level
    expect(placeholderText({ ...pres.master!.placeholders[1]!, prompt: "One\nTwo" }).map((p) => p.props?.level)).toEqual([undefined, 1]);
  });

  it("deleting a pseudo shape removes the placeholder", () => {
    const target = { kind: "layout", value: "titleContent" } as const;
    const defs = targetPlaceholders(pres, target);
    const body = defs.findIndex((d) => d.kind === "body");
    const idx = defs[body]!.idx;
    expect(translateDesignCommand(pres, target, { type: "deleteShapes", ids: [DESIGN_SHAPE_BASE + body] }).commands).toEqual([
      { type: "removePlaceholder", target, placeholder: "body", ...(idx ? { idx } : {}) },
    ]);
  });

  it("a deleted layout target falls back to the master", () => {
    expect(validTarget(pres, { kind: "layout", value: "custom:gone" })).toEqual({ kind: "master" });
    expect(validTarget(pres, { kind: "layout", value: "twoContent" })).toEqual({ kind: "layout", value: "twoContent" });
  });
});
