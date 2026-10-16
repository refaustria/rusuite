import { describe, expect, it } from "vitest";
import type { Preset } from "../generated/Preset";
import { adjustDefaults, choiceOf, choiceShape, clickBox, NAMED_PRESETS, pushRecent, SHAPE_GROUPS, textRect } from "./presets";

const T = { x: 0, y: 0, w: 914400, h: 914400, rotationDeg: 0 };

describe("shape library", () => {
  it("has PowerPoint's groups and every named preset once (39 with the line)", () => {
    expect(SHAPE_GROUPS.map((g) => g.id)).toEqual(["lines", "rectangles", "basic", "arrows", "flowchart", "stars", "callouts", "actionButtons"]);
    expect(NAMED_PRESETS).toHaveLength(51);
    expect(new Set(NAMED_PRESETS).size).toBe(51);
    for (const g of SHAPE_GROUPS) for (const id of g.items) expect(choiceOf(id)).not.toBeNull();
    expect(choiceOf("nope")).toBeNull();
  });

  it("lines insert connectors with the arrowheads of the item", () => {
    const line = choiceShape(choiceOf("line")!, T, -1);
    expect(line.kind).toEqual({ kind: "connector", value: { kind: "straight" } });
    const arrow = choiceShape(choiceOf("elbowArrow")!, T, -1);
    expect(arrow.kind).toMatchObject({ kind: "connector", value: { kind: "elbow", bends: 2, tail: { kind: "triangle" } } });
    expect(arrow.kind.kind === "connector" && arrow.kind.value.head).toBeUndefined();
    const both = choiceShape(choiceOf("lineDoubleArrow")!, T, -1);
    expect(both.kind).toMatchObject({ kind: "connector", value: { head: { kind: "triangle" }, tail: { kind: "triangle" } } });
    expect(line.fill).toEqual({ kind: "none" });
  });

  it("every group's presets insert accent-filled auto shapes with centred text", () => {
    for (const g of SHAPE_GROUPS.filter((x) => x.id !== "lines")) {
      for (const id of g.items.filter((i) => i !== "textBox")) {
        const s = choiceShape(choiceOf(id)!, T, -7);
        expect(s.id).toBe(-7);
        expect(s.kind).toMatchObject({ kind: "auto", value: { geometry: id, text: { props: { anchor: "middle" } } } });
        expect(s.fill).toEqual({ kind: "solid", value: { kind: "theme", value: { slot: "accent1", tint: 0 } } });
      }
    }
  });

  it("the text box has no fill and top-anchored text", () => {
    const s = choiceShape(choiceOf("textBox")!, T, -1);
    expect(s.kind).toMatchObject({ kind: "auto", value: { geometry: "rect", text: { props: { anchor: "top" } } } });
    expect(s.fill.kind).toBe("none");
  });

  it("a click inserts the default size at the click (lines: 1 inch wide, flat)", () => {
    expect(clickBox(choiceOf("star5")!, 100, 200)).toEqual({ x: 100, y: 200, w: 914400, h: 914400, rotationDeg: 0 });
    expect(clickBox(choiceOf("line")!, 1, 2)).toMatchObject({ w: 914400, h: 0 });
  });

  it("recently used: newest first, no duplicates, bounded", () => {
    expect(pushRecent(["a", "b", "c"], "b")).toEqual(["b", "a", "c"]);
    expect(pushRecent(["a", "b"], "c", 2)).toEqual(["c", "a"]);
  });

  it("adjust defaults mirror the core's", () => {
    expect(adjustDefaults("star5")).toEqual({ adj: 19098, hf: 105146, vf: 110557 });
    expect(adjustDefaults("rightArrow")).toEqual({ adj1: 50000, adj2: 50000 });
    expect(adjustDefaults("rect")).toEqual({});
  });

  it("text sits inside round and pointed shapes (approximate a:rect)", () => {
    expect(textRect("rect", 100, 50)).toEqual({ x: 0, y: 0, w: 100, h: 50 });
    const e = textRect("ellipse", 100, 100);
    expect(e.x).toBeCloseTo(14.64);
    expect(e.w).toBeCloseTo(70.72);
    expect(textRect("diamond", 100, 100)).toEqual({ x: 25, y: 25, w: 50, h: 50 });
    expect(textRect("triangle", 100, 100)).toEqual({ x: 25, y: 50, w: 50, h: 50 });
    expect(textRect({ custom: { paths: [] } } as Preset, 10, 10)).toEqual({ x: 0, y: 0, w: 10, h: 10 });
  });
});

describe("action buttons", () => {
  it("get PowerPoint's default actions when inserted", async () => {
    const { defaultAction, isActionButton } = await import("./presets");
    expect(defaultAction("actionButtonForwardNext")).toEqual({ target: { kind: "slide", value: { kind: "next" } } });
    expect(defaultAction("actionButtonReturn")).toEqual({ target: { kind: "slide", value: { kind: "lastViewed" } } });
    expect(defaultAction("actionButtonHelp")).toBeUndefined();
    expect(isActionButton("actionButtonBlank")).toBe(true);
    expect(isActionButton("rect")).toBe(false);
    const s = choiceShape(choiceOf("actionButtonHome")!, { x: 0, y: 0, w: 10, h: 10, rotationDeg: 0 }, -1);
    expect(s.clickAction).toEqual({ target: { kind: "slide", value: { kind: "first" } } });
    expect(choiceShape(choiceOf("rect")!, { x: 0, y: 0, w: 10, h: 10, rotationDeg: 0 }, -1).clickAction).toBeUndefined();
  });
});
