// P8-38 (W-23): the Paragraph dialog shows the values in effect and sends only what changed.
import { describe, expect, it } from "vitest";
import { paragraphValuesPatch, type ParagraphValues } from "./dialogs";

const normal: ParagraphValues = { alignment: null, indent: {}, spacing: { after: 160, line: { kind: "multiple", value: 1.08 } } };

describe("Paragraph dialog patch", () => {
  it("OK without changes changes nothing", () => {
    expect(paragraphValuesPatch(normal, { alignment: "left", indent: { left: 0, right: 0, firstLine: 0, hanging: null }, spacing: { before: 0, after: 160, line: { kind: "multiple", value: 1.08 } } })).toEqual({});
  });

  it("only the changed fields: space after and a hanging indent", () => {
    const after: ParagraphValues = { alignment: "left", indent: { left: 0, right: 0, firstLine: null, hanging: 360 }, spacing: { before: 0, after: 0, line: { kind: "multiple", value: 1.08 } } };
    expect(paragraphValuesPatch(normal, after)).toEqual({ indent: { firstLine: null, hanging: 360 }, spacing: { after: 0 } });
  });

  it("values equal as shown (rounded cm) are unchanged", () => {
    const before: ParagraphValues = { alignment: "center", indent: { left: 709 }, spacing: {} };
    const after: ParagraphValues = { alignment: "center", indent: { left: 709, right: 0, firstLine: 0, hanging: null }, spacing: { before: 0, after: 0, line: { kind: "multiple", value: 1 } } };
    expect(paragraphValuesPatch(before, after)).toEqual({});
  });
});
