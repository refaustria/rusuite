import { describe, expect, it, vi } from "vitest";
import { Schema, type Node as PMNode } from "@tiptap/pm/model";
import { countDocWords, countNodeWords, countWords, createWordCounter } from "./wordCount";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*" },
    text: { group: "inline" },
  },
});
const p = (text = "") => schema.node("paragraph", null, text ? [schema.text(text)] : []);
const doc = (...children: PMNode[]) => schema.node("doc", null, children);

describe("countWords", () => {
  it("splits on any whitespace", () => {
    expect(countWords("  one two\tthree\nfour ")).toBe(4);
    expect(countWords("")).toBe(0);
    expect(countWords("   ")).toBe(0);
  });
  it("counts emoji separated by spaces and CJK runs without spaces", () => {
    expect(countWords("hi 😀 there 👍🏽")).toBe(4);
    expect(countWords("日本語のテキスト")).toBe(1);
    expect(countWords("日本語 の テキスト")).toBe(3);
  });
});

describe("countDocWords", () => {
  it("sums paragraphs; empty paragraphs count 0", () => {
    expect(countDocWords(doc(p("one two"), p(), p("three"), p("")))).toBe(3);
    expect(countDocWords(doc(p()))).toBe(0);
  });
  it("matches the whole-document count", () => {
    const d = doc(p("a b"), p(), p("日本語 😀"), p("c"));
    expect(countDocWords(d)).toBe(countWords(d.textBetween(0, d.content.size, " ", " ")));
    expect(countNodeWords(p("x y z"))).toBe(3);
  });
});

describe("cache", () => {
  it("counts only changed nodes", () => {
    const spy = vi.fn(countNodeWords);
    const count = createWordCounter(spy);
    const a = p("one two");
    const b = p("three");
    const c = p("four five six");
    const d1 = doc(a, b, c);
    expect(count(d1)).toBe(6);
    expect(spy).toHaveBeenCalledTimes(3);
    expect(count(d1)).toBe(6);
    expect(spy).toHaveBeenCalledTimes(3);
    // A keystroke in b: new b, same a and c objects.
    const d2 = doc(a, p("three more"), c);
    expect(count(d2)).toBe(7);
    expect(spy).toHaveBeenCalledTimes(4);
    // Inserting a paragraph counts the new node only.
    expect(count(doc(a, p("x"), p("three more"), c))).toBe(8);
    expect(spy.mock.calls.length).toBeLessThanOrEqual(6);
  });
});
