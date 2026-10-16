// The in-place editor's model: splicing typed text into the rich body (P8-45 S-01).
import { describe, expect, it } from "vitest";
import type { TextBody } from "../generated/TextBody";
import { bodyText } from "../model";
import { charStep, cleanBody, editOffset, editPos, spliceBody, textDiff, typingRun } from "./editing";

const props = { anchor: "top", wrap: true, insets: { left: 0, top: 0, right: 0, bottom: 0 }, autofit: "none" } as const;
const bold = { bold: true };
const red = { color: { kind: "rgb", value: "FF0000" } } as const;
const body = (paragraphs: TextBody["paragraphs"]): TextBody => ({ props: { ...props }, paragraphs });
const bullet = { bullet: { kind: "char", value: "•" } } as const;

// "Hello world" with "world" bold; a second paragraph at level 1
const sample = () =>
  body([
    { props: { ...bullet }, runs: [{ text: "Hello " }, { text: "world", props: bold }] },
    { props: { ...bullet, level: 1 }, runs: [{ text: "Next", props: red }] },
  ]);

describe("editor model: positions", () => {
  it("maps offsets of the joined text to paragraph positions and back", () => {
    const b = sample();
    expect(editPos(b, 0)).toEqual({ paragraph: 0, offset: 0 });
    expect(editPos(b, 11)).toEqual({ paragraph: 0, offset: 11 });
    expect(editPos(b, 12)).toEqual({ paragraph: 1, offset: 0 });
    expect(editPos(b, 99)).toEqual({ paragraph: 1, offset: 4 });
    for (const at of [0, 5, 11, 12, 16]) expect(editOffset(b, editPos(b, at))).toBe(at);
  });

  it("steps over surrogate pairs by whole characters", () => {
    const s = "a😀b";
    expect(charStep(s, 3, -1)).toBe(1);
    expect(charStep(s, 1, 1)).toBe(3);
    expect(charStep(s, 0, -1)).toBe(0);
    expect(charStep(s, 4, 1)).toBe(4);
  });
});

describe("editor model: typing keeps the formatting", () => {
  it("text typed after a bold run is bold; inside the plain run it is plain", () => {
    const b = sample();
    const end = spliceBody(b, 11, 11, "!");
    expect(end.paragraphs[0]!.runs).toEqual([{ text: "Hello " }, { text: "world!", props: bold }]);
    const mid = spliceBody(b, 2, 2, "XY");
    expect(mid.paragraphs[0]!.runs).toEqual([{ text: "HeXYllo " }, { text: "world", props: bold }]);
    expect(bodyText(mid)).toBe("HeXYllo world\nNext");
  });

  it("at a run border the text takes the run before the caret; at a paragraph start the first run", () => {
    const b = sample();
    expect(typingRun(b, { paragraph: 0, offset: 6 }).props).toBeUndefined();
    expect(typingRun(b, { paragraph: 0, offset: 7 }).props).toEqual(bold);
    expect(typingRun(b, { paragraph: 1, offset: 0 }).props).toEqual(red);
  });

  it("an empty paragraph types with the previous paragraph's last run", () => {
    const b = body([{ runs: [{ text: "A", props: bold }] }, { runs: [] }]);
    expect(typingRun(b, { paragraph: 1, offset: 0 }).props).toEqual(bold);
    expect(spliceBody(b, 2, 2, "B").paragraphs[1]!.runs).toEqual([{ text: "B", props: bold }]);
  });

  it("fields are not continued and a hyperlink only inside it", () => {
    const link = { target: { kind: "url", value: "https://x.test" } } as never;
    const b = body([{ runs: [{ text: "3", field: { kind: "slideNumber" } }, { text: "go", hyperlink: link }] }]);
    const afterField = spliceBody(b, 1, 1, "a");
    expect(afterField.paragraphs[0]!.runs[0]).toEqual({ text: "3", field: { kind: "slideNumber" } });
    expect(afterField.paragraphs[0]!.runs[1]).toEqual({ text: "a" });
    expect(spliceBody(b, 2, 2, "o").paragraphs[0]!.runs.map((r) => [r.text, !!r.hyperlink])).toEqual([["3", false], ["goo", true]]);
    expect(spliceBody(b, 3, 3, "!").paragraphs[0]!.runs.map((r) => [r.text, !!r.hyperlink])).toEqual([["3", false], ["go", true], ["!", false]]);
  });
});

describe("editor model: paragraphs", () => {
  it("Enter splits a paragraph; both halves keep its level and bullet, the runs their formatting", () => {
    const b = sample();
    const out = spliceBody(b, 8, 8, "\n"); // "Hello wo|rld"
    expect(out.paragraphs).toHaveLength(3);
    expect(out.paragraphs[0]).toEqual({ props: { ...bullet }, runs: [{ text: "Hello " }, { text: "wo", props: bold }] });
    expect(out.paragraphs[1]).toEqual({ props: { ...bullet }, runs: [{ text: "rld", props: bold }] });
    expect(out.paragraphs[2]!.props?.level).toBe(1);
  });

  it("Enter at the end makes an empty paragraph that carries the formatting for the next keystroke", () => {
    const out = spliceBody(sample(), 16, 16, "\n");
    expect(out.paragraphs[2]).toEqual({ props: { ...bullet, level: 1 }, runs: [{ text: "", props: red }] });
    const typed = spliceBody(out, 17, 17, "x");
    expect(typed.paragraphs[2]!.runs).toEqual([{ text: "x", props: red }]);
    // committed: the carrying run is dropped
    expect(cleanBody(out).paragraphs[2]!.runs).toEqual([]);
    expect(cleanBody(typed)).toEqual(typed);
  });

  it("Backspace at a paragraph start joins it to the previous one (which keeps its properties)", () => {
    const out = spliceBody(sample(), 11, 12, "");
    expect(out.paragraphs).toHaveLength(1);
    expect(out.paragraphs[0]!.props).toEqual({ ...bullet });
    expect(out.paragraphs[0]!.runs).toEqual([{ text: "Hello " }, { text: "world", props: bold }, { text: "Next", props: red }]);
  });

  it("deleting across paragraphs and pasting lines", () => {
    const out = spliceBody(sample(), 3, 14, "p\r\nq");
    expect(bodyText(out)).toBe("Help\nqxt");
    expect(out.paragraphs.map((p) => p.props?.level ?? 0)).toEqual([0, 0]);
    expect(out.paragraphs[1]!.runs).toEqual([{ text: "q" }, { text: "xt", props: red }]);
  });

  it("deleting all text keeps the first run's formatting for what is typed next", () => {
    const b = body([{ runs: [{ text: "Bold", props: bold }] }]);
    const empty = spliceBody(b, 0, 4, "");
    expect(empty.paragraphs[0]!.runs).toEqual([{ text: "", props: bold }]);
    expect(spliceBody(empty, 0, 0, "New").paragraphs[0]!.runs).toEqual([{ text: "New", props: bold }]);
  });

  it("a cut field becomes plain text", () => {
    const b = body([{ runs: [{ text: "12", field: { kind: "slideNumber" } }] }]);
    expect(spliceBody(b, 1, 2, "").paragraphs[0]!.runs).toEqual([{ text: "1" }]);
  });
});

describe("editor model: diffing (composition, legacy updates)", () => {
  it("finds the one edit, placed by the caret when ambiguous", () => {
    expect(textDiff("abc", "abXc", 3)).toEqual({ from: 2, to: 2, insert: "X" });
    expect(textDiff("aa", "aaa", 1)).toEqual({ from: 0, to: 0, insert: "a" });
    expect(textDiff("aa", "aaa", 3)).toEqual({ from: 2, to: 2, insert: "a" });
    expect(textDiff("hello", "hlo", 1)).toEqual({ from: 1, to: 3, insert: "" });
    expect(textDiff("こ", "こんにちは", 5)).toEqual({ from: 1, to: 1, insert: "んにちは" });
    expect(textDiff("same", "same", 4)).toEqual({ from: 4, to: 4, insert: "" });
  });
});
