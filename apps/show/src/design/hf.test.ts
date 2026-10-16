import { describe, expect, it } from "vitest";
import { designFixture, textShape } from "../test/fixture";
import { DEFAULT_HF, hfCommand, hfValuesOf, insertField, resolvedFooter } from "./hf";
import type { Slide } from "../generated/Slide";

const footerSlide = (): Slide => ({
  id: 50,
  layout: "titleContent",
  shapes: [
    { ...textShape(51, [""]), placeholder: "dateTime", kind: { kind: "auto", value: { geometry: "rect", text: { props: { anchor: "middle", wrap: true, insets: { left: 0, top: 0, right: 0, bottom: 0 }, autofit: "none" }, paragraphs: [{ runs: [{ text: "10/16/2026", field: { kind: "dateTime", value: { format: 4 } } }] }] } } } },
    { ...textShape(52, ["Confidential"]), placeholder: "footer" },
    { ...textShape(53, ["‹#›"]), placeholder: "slideNumber" },
  ],
});

describe("Header & Footer", () => {
  it("resolved footer like Presentation::resolved_footer", () => {
    expect(resolvedFooter(footerSlide(), 2)).toEqual({ date: { kind: "auto", value: { format: 4 } }, footer: "Confidential", slideNumber: 3 });
    const fixed = footerSlide();
    fixed.shapes[0] = { ...textShape(51, ["1 May"]), placeholder: "dateTime" };
    expect(resolvedFooter(fixed, 0).date).toEqual({ kind: "fixed", value: "1 May" });
    expect(resolvedFooter({ id: 1, layout: "blank", shapes: [] }, 0)).toEqual({ date: null, footer: null, slideNumber: null });
  });

  it("dialog values from the current slide, else the master's settings", () => {
    const pres = designFixture();
    pres.slides.push(footerSlide());
    expect(hfValuesOf(pres, 50)).toEqual({ dateOn: true, auto: true, format: 4, fixed: "", slideNumber: true, footerOn: true, footer: "Confidential", notOnTitle: false });
    pres.master!.headerFooter = { slideNumber: true, footer: "Draft", notOnTitle: true, date: { kind: "fixed", value: { text: "Q4" } } };
    expect(hfValuesOf(pres, 1)).toEqual({ dateOn: true, auto: false, format: 1, fixed: "Q4", slideNumber: true, footerOn: true, footer: "Draft", notOnTitle: true });
  });

  it("SetHeaderFooter of the values (Apply / Apply to All)", () => {
    expect(hfCommand({ ...DEFAULT_HF, slideNumber: true, footerOn: true, footer: "F", notOnTitle: true }, { kind: "all" })).toEqual({
      type: "setHeaderFooter", date: { kind: "off" }, footer: "F", slideNumber: true, applyTo: { kind: "all" }, notOnTitle: true,
    });
    expect(hfCommand({ ...DEFAULT_HF, dateOn: true, format: 2 }, { kind: "slides", value: [4] })).toMatchObject({ date: { kind: "auto", value: { format: 2 } }, footer: null, applyTo: { kind: "slides", value: [4] } });
    expect(hfCommand({ ...DEFAULT_HF, dateOn: true, auto: false, fixed: "x" }, { kind: "all" })).toMatchObject({ date: { kind: "fixed", value: { text: "x" } } });
  });

  it("insert a field run at the caret, splitting the run and keeping its formatting", () => {
    const body = { props: { anchor: "top", wrap: true, insets: { left: 0, top: 0, right: 0, bottom: 0 }, autofit: "none" }, paragraphs: [{ runs: [{ props: { bold: true }, text: "Page  of" }] }] } as const;
    const out = insertField(structuredClone(body) as never, 0, 5, { kind: "slideNumber" }, "3");
    expect(out.paragraphs[0]!.runs).toEqual([
      { props: { bold: true }, text: "Page " },
      { props: { bold: true }, text: "3", field: { kind: "slideNumber" } },
      { props: { bold: true }, text: " of" },
    ]);
    const end = insertField(structuredClone(body) as never, 0, 99, { kind: "dateTime", value: { format: 1 } }, "d");
    expect(end.paragraphs[0]!.runs.at(-1)).toEqual({ props: { bold: true }, text: "d", field: { kind: "dateTime", value: { format: 1 } } });
  });
});
