// P10-M4: the pure parts of Write's touch handling.
import { describe, expect, it } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { clampZoom, fitWidthZoom, gapForZoom } from "./zoomGestures";
import { autoScrollSpeed, barPosition, wordAt } from "./selection";
import { installTouchMode, isTouchMode, setTouchMode } from "./touchMode";

const schema = new Schema({
  nodes: { doc: { content: "paragraph+" }, paragraph: { content: "inline*", group: "block" }, text: { group: "inline" }, atom: { inline: true, group: "inline", atom: true } },
});
const doc = (text: string) => schema.node("doc", null, [schema.node("paragraph", null, text ? [schema.text(text)] : [])]);

describe("fit-width zoom", () => {
  it("fits the page into the width less 16 px, never above 100 %", () => {
    expect(fitWidthZoom(412, 816)).toBeCloseTo(396 / 816, 2);
    expect(fitWidthZoom(2000, 816)).toBe(1);
    expect(fitWidthZoom(0, 816)).toBe(1);
  });
  it("clamps and keeps the screen gap", () => {
    expect(clampZoom(3, 0.5, 2)).toBe(2);
    expect(clampZoom(0.1, 0.5, 2)).toBe(0.5);
    expect(gapForZoom(8, 0.5)).toBe(16);
    expect(gapForZoom(8, 2)).toBe(4);
  });
});

describe("wordAt", () => {
  it("finds the word around or before a position", () => {
    const d = doc("Hello brave world");
    expect(wordAt(d, 1 + 8)).toEqual({ from: 7, to: 12 });
    expect(wordAt(d, 1 + 5)).toEqual({ from: 1, to: 6 });
    expect(wordAt(d, 1)).toEqual({ from: 1, to: 6 });
  });
  it("keeps apostrophes inside, drops them at the ends; none in spaces or empty paragraphs", () => {
    const d = doc("it's 'quoted'  x");
    expect(wordAt(d, 2)).toEqual({ from: 1, to: 5 });
    expect(wordAt(d, 9)).toEqual({ from: 7, to: 13 });
    expect(wordAt(d, 15)).toBeNull();
    expect(wordAt(doc(""), 1)).toBeNull();
  });
});

describe("bar and handles", () => {
  const bounds = { left: 0, top: 50, right: 412, bottom: 700 };
  it("goes above the selection, centred, inside the bounds", () => {
    expect(barPosition({ left: 100, right: 200, top: 300, bottom: 320 }, 200, 48, bounds)).toEqual({ left: 50, top: 244 });
    expect(barPosition({ left: 380, right: 410, top: 300, bottom: 320 }, 200, 48, bounds).left).toBe(204);
  });
  it("goes below the selection and its handles without room above", () => {
    expect(barPosition({ left: 100, right: 200, top: 60, bottom: 80 }, 200, 48, bounds, 44).top).toBe(124);
  });
  it("scrolls near the edges only", () => {
    expect(autoScrollSpeed(300, 50, 700)).toBe(0);
    expect(autoScrollSpeed(55, 50, 700)).toBeLessThan(0);
    expect(autoScrollSpeed(695, 50, 700)).toBeGreaterThan(0);
  });
});

describe("touch mode", () => {
  it("follows the pointer type and mirrors it on the root", () => {
    setTouchMode(false);
    const root = document.createElement("main");
    const stop = installTouchMode(root);
    window.dispatchEvent(Object.assign(new Event("pointerdown"), { pointerType: "touch" }));
    expect(isTouchMode()).toBe(true);
    expect(root.hasAttribute("data-touch")).toBe(true);
    window.dispatchEvent(Object.assign(new Event("pointerdown"), { pointerType: "mouse" }));
    expect(isTouchMode()).toBe(false);
    expect(root.hasAttribute("data-touch")).toBe(false);
    stop();
  });
});
