// P8-34: character formatting completeness — the effects' CSS, their marks
// mapping and SetRunProps, the Font dialog's patch, Text Effects, Change
// Case transforms and commands, picture crop / frame / filter helpers.

import { describe, expect, it } from "vitest";
import type { RunProperties } from "../sync/model";
import { mapDocChange } from "../sync/transactionMapper";
import { propsFromMarks } from "../sync/fromPM";
import { pictureFilterCss, runEffectsCss, writeSchema } from "../sync/schema";
import { marksFromProps } from "../sync/toPM";
import { makeEditor, select } from "../test/harness";
import { makeDoc, para, run } from "../test/fixtures";
import { caseChar, changeCase, changeCaseCommand } from "./changeCase";
import { applyRunPatch, patchRun, runPatchBetween, toggleEffect } from "./runFormat";
import { croppedSize, cropBy, pictureFrameCss, visibleFraction } from "./imageView";
import { PICTURE_STYLES, withPictureStyle } from "../ui/drawingTabs";

describe("character effects", () => {
  it("small caps, all caps and spacing render as CSS", () => {
    expect(runEffectsCss({ smallCaps: true }).css).toContain("font-variant: small-caps");
    expect(runEffectsCss({ allCaps: true }).css).toContain("text-transform: uppercase");
    expect(runEffectsCss({ charSpacing: 40 }).css).toContain("letter-spacing: 2.00pt");
    expect(runEffectsCss({ charSpacing: -10 }).css).toContain("letter-spacing: -0.50pt");
  });

  it("position raises / lowers, scale widens, kerning turns font kerning on", () => {
    expect(runEffectsCss({ position: 6 }).css).toContain("vertical-align: 3.0pt");
    expect(runEffectsCss({ position: -4 }).css).toContain("vertical-align: -2.0pt");
    expect(runEffectsCss({ scale: 150 }).css.join(";")).toMatch(/letter-spacing: calc\(0\.00pt \+ 0\.225em\)/);
    expect(runEffectsCss({ kerning: 28 }).css).toContain("font-kerning: normal");
  });

  it("double strike, outline, shadow, emboss, engrave and hidden text", () => {
    expect(runEffectsCss({ doubleStrike: true }).css).toEqual(["text-decoration-line: line-through", "text-decoration-style: double"]);
    expect(runEffectsCss({ outline: true }).css.join(";")).toContain("-webkit-text-fill-color: transparent");
    expect(runEffectsCss({ shadow: true }).css.join(";")).toContain("text-shadow: 0.06em 0.06em");
    expect(runEffectsCss({ emboss: true }).css.join(";")).toContain("-0.04em -0.04em");
    expect(runEffectsCss({ imprint: true }).css.join(";")).toContain("0.04em 0.04em 0 rgba");
    expect(runEffectsCss({ hidden: true }).classes).toEqual(["hidden-text"]);
    expect(runEffectsCss(null)).toEqual({ css: [], classes: [] });
  });

  it("the effects travel in the textStyle mark and come back as run properties", () => {
    const schema = writeSchema();
    const props: RunProperties = { smallCaps: true, charSpacing: 40, position: -6, scale: 80, kerning: 24, doubleStrike: true, hidden: true, rtl: true, bold: true };
    const marks = marksFromProps(schema, props);
    expect(marks.map((m) => m.type.name).sort()).toEqual(["bold", "textStyle"]);
    expect(propsFromMarks(marks)).toEqual(props);
    // Rendered on the span.
    const editor = makeEditor(makeDoc([para(1, [run("Hi", { smallCaps: true, hidden: true })])]));
    const span = editor.view.dom.querySelector("span.text-style") as HTMLElement;
    expect(span.style.fontVariant).toBe("small-caps");
    expect(span.classList.contains("hidden-text")).toBe(true);
  });

  it("turning small caps on and spacing up → one SetRunProps; off → false", () => {
    const editor = makeEditor(makeDoc([para(1, "abcdef")]));
    select(editor, 1, 0, 1, 3);
    let before = editor.state.doc;
    applyRunPatch(editor, { smallCaps: true, charSpacing: 40 });
    expect(mapDocChange(before, editor.state.doc)?.command).toEqual({ type: "setRunProps", block: 1, from: 0, to: 3, patch: { smallCaps: true, charSpacing: 40 } });
    before = editor.state.doc;
    applyRunPatch(editor, { smallCaps: false });
    expect(mapDocChange(before, editor.state.doc)?.command).toEqual({ type: "setRunProps", block: 1, from: 0, to: 3, patch: { smallCaps: false } });
  });

  it("run patches: false removes a toggle, null a value; the dialog patch is the difference", () => {
    expect(patchRun({ smallCaps: true, scale: 120, bold: true }, { smallCaps: false, scale: null, outline: true })).toEqual({ bold: true, outline: true });
    expect(runPatchBetween({ smallCaps: true, charSpacing: 20 }, { charSpacing: 40, shadow: true })).toEqual({ smallCaps: false, charSpacing: 40, shadow: true });
    expect(runPatchBetween({ bold: true }, { bold: true })).toEqual({});
  });

  it("Text Effects: emboss and engrave exclude each other", () => {
    const editor = makeEditor(makeDoc([para(1, [run("abc", { imprint: true })])]));
    select(editor, 1, 0, 1, 3);
    const before = editor.state.doc;
    toggleEffect(editor, "emboss", { imprint: true });
    expect(mapDocChange(before, editor.state.doc)?.command).toEqual({ type: "setRunProps", block: 1, from: 0, to: 3, patch: { emboss: true, imprint: false } });
  });
});

describe("Change Case", () => {
  it("transforms like Word", () => {
    const s = "hello WORLD. it's me! ok";
    expect(changeCase(s, "upper")).toBe("HELLO WORLD. IT'S ME! OK");
    expect(changeCase(s, "lower")).toBe("hello world. it's me! ok");
    expect(changeCase(s, "toggle")).toBe("HELLO world. IT'S ME! OK");
    expect(changeCase(s, "capitalize")).toBe("Hello World. It's Me! Ok");
    expect(changeCase(s, "sentence")).toBe("Hello world. It's me! Ok");
  });

  it("only the range changes; the context decides sentence starts", () => {
    expect(changeCase("one. two three", "sentence", 5, 14)).toBe("one. Two three");
    expect(changeCase("abc def", "upper", 4)).toBe("abc DEF");
    expect(caseChar([..."x y"], 2, "capitalize")).toBe("Y");
  });

  it("the selection → one ChangeCase per paragraph", () => {
    const editor = makeEditor(makeDoc([para(1, "first line"), para(2, "second line")]));
    select(editor, 1, 6, 2, 6);
    expect(changeCaseCommand(editor, "upper")).toEqual({
      type: "compound",
      commands: [
        { type: "changeCase", block: 1, from: 6, to: 10, case: "upper" },
        { type: "changeCase", block: 2, from: 0, to: 6, case: "upper" },
      ],
    });
  });

  it("a caret changes the word it is in", () => {
    const editor = makeEditor(makeDoc([para(1, "make this loud")]));
    select(editor, 1, 7);
    expect(changeCaseCommand(editor, "capitalize")).toEqual({ type: "changeCase", block: 1, from: 5, to: 9, case: "capitalize" });
    select(editor, 1, 4);
    expect(changeCaseCommand(editor, "upper")).toEqual({ type: "changeCase", block: 1, from: 0, to: 4, case: "upper" });
  });
});

describe("picture formatting helpers", () => {
  it("crop handles: the right handle 30 px inward on a 300 px picture crops 10 %", () => {
    const c = cropBy({ left: 0, top: 0, right: 0, bottom: 0 }, "e", 300, 200, -30, 0);
    expect(c).toEqual({ left: 0, top: 0, right: 10000, bottom: 0 });
    const corner = cropBy(c, "nw", 300, 200, 15, 20);
    expect(corner).toEqual({ left: 5000, top: 10000, right: 10000, bottom: 0 });
    // At least 1 % stays.
    expect(cropBy(c, "w", 300, 200, 1000, 0).left).toBe(89000);
  });

  it("the picture keeps its scale: the box follows the visible part", () => {
    expect(visibleFraction({ left: 10000, top: 0, right: 15000, bottom: 50000 })).toEqual({ w: 0.75, h: 0.5 });
    expect(croppedSize(1000000, 500000, null, { left: 0, top: 0, right: 25000, bottom: 0 })).toEqual({ width: 750000, height: 500000 });
    expect(croppedSize(750000, 500000, { left: 0, top: 0, right: 25000, bottom: 0 }, { left: 0, top: 0, right: 0, bottom: 0 })).toEqual({ width: 1000000, height: 500000 });
  });

  it("border, shadow, outline shape and corrections as CSS", () => {
    const css = pictureFrameCss({ border: { fill: { kind: "solid", value: { kind: "rgb", value: "000000" } as never }, width: 38100, dash: "dot" }, shadow: true, geometry: "ellipse" }, 100, 50);
    expect(css.outline).toBe("4.0px dotted #000000");
    expect(css["box-shadow"]).toContain("rgba(0, 0, 0, 0.4)");
    expect(css["border-radius"]).toBe("50%");
    expect(pictureFilterCss({ brightness: 20000, contrast: -20000, recolor: "grayscale" })).toBe("filter: brightness(1.200) contrast(0.800) grayscale(1)");
    expect(pictureFilterCss({})).toBe("");
  });

  it("Picture Styles: at least 8, keeping crop and corrections", () => {
    expect(PICTURE_STYLES.length).toBeGreaterThanOrEqual(8);
    const f = withPictureStyle({ crop: { left: 1000, top: 0, right: 0, bottom: 0 }, brightness: 20000, border: { fill: { kind: "none" }, width: 1 } }, "roundedShadow");
    expect(f).toEqual({ crop: { left: 1000, top: 0, right: 0, bottom: 0 }, brightness: 20000, geometry: "roundRect", shadow: true });
  });
});
