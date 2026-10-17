import { describe, expect, it } from "vitest";
import type { Preset } from "../generated/Preset";
import type { Shape } from "../generated/Shape";
import type { ShapePaths } from "../generated/ShapePaths";
import presetInfo from "../generated/presetInfo.json";
import samples from "../generated/shapePathSamples.json";
import { pathCache, pathKey, pathQueryOf } from "./paths";
import { adjustDefaults, choiceOf, choiceShape, clickBox, NAMED_PRESETS, pushRecent, SHAPE_GROUPS, textRect } from "./presets";

const T = { x: 0, y: 0, w: 914400, h: 914400, rotationDeg: 0 };

describe("shape library", () => {
  it("has PowerPoint's groups and every named preset once (110 with the line)", () => {
    expect(SHAPE_GROUPS.map((g) => g.id)).toEqual(["lines", "rectangles", "basic", "arrows", "equation", "flowchart", "stars", "callouts", "actionButtons"]);
    expect(NAMED_PRESETS).toHaveLength(110);
    expect(new Set(NAMED_PRESETS).size).toBe(110);
    // the whole flowchart group of PowerPoint (28) plus offline storage
    expect(SHAPE_GROUPS.find((g) => g.id === "flowchart")!.items).toHaveLength(29);
    // every preset the core knows is in the gallery
    expect([...NAMED_PRESETS].sort()).toEqual(Object.keys(presetInfo).sort());
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
    expect(clickBox(choiceOf("textBox")!, 5, 6)).toEqual({ x: 5, y: 6, w: 900000, h: 369332, rotationDeg: 0 });
  });

  it("recently used: newest first, no duplicates, bounded", () => {
    expect(pushRecent(["a", "b", "c"], "b")).toEqual(["b", "a", "c"]);
    expect(pushRecent(["a", "b"], "c", 2)).toEqual(["c", "a"]);
  });

  it("adjust defaults come from the core's preset data", () => {
    expect(adjustDefaults("star5")).toEqual({ adj: 19098, hf: 105146, vf: 110557 });
    expect(adjustDefaults("rightArrow")).toEqual({ adj1: 50000, adj2: 50000 });
    expect(adjustDefaults("uturnArrow")).toEqual({ adj1: 25000, adj2: 25000, adj3: 25000, adj4: 43750, adj5: 75000 });
    expect(adjustDefaults("rect")).toEqual({});
  });

  it("text sits in the core's text rectangle, scaled to the drawn box", () => {
    pathCache.clear();
    const shape = (geometry: Preset): Shape => ({ id: 1, name: "", transform: { x: 0, y: 0, w: 1000000, h: 600000, rotationDeg: 0 }, kind: { kind: "auto", value: { geometry } }, fill: { kind: "none" }, line: { fill: { kind: "none" }, width: 0, dash: "solid" } });
    const e = shape("ellipse");
    // not cached yet: the whole box
    expect(textRect(e, 100, 60)).toEqual({ x: 0, y: 0, w: 100, h: 60 });
    pathCache.load([[pathKey(pathQueryOf(e)!), (samples as unknown as Record<string, { paths: ShapePaths }>).ellipse!.paths]]);
    const r = textRect(e, 100, 60);
    expect(r.x).toBeCloseTo(14.64, 1);
    expect(r.w).toBeCloseTo(70.71, 1);
    expect(r.y).toBeCloseTo(8.79, 1);
    expect(textRect({ ...shape({ custom: { paths: [] } } as Preset) }, 10, 10)).toEqual({ x: 0, y: 0, w: 10, h: 10 });
    pathCache.clear();
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
