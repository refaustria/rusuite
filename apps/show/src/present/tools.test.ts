import { describe, expect, it } from "vitest";
import { eraseAt, seeAllColumns, svgPoints, toolKey, withStrokes, zoomOffset, zoomStep, type InkStroke } from "./tools";
import { initialShow, reduceShow, showRange, type ShowState } from "./showState";
import { showSlides } from "./SlideShow";
import type { Slide } from "../generated/Slide";

describe("slide-show tools", () => {
  it("PowerPoint's keys", () => {
    expect(toolKey({ key: "l", ctrlKey: true }, false)).toEqual({ type: "mode", mode: "laser" });
    expect(toolKey({ key: "P", ctrlKey: true }, false)).toEqual({ type: "mode", mode: "pen" });
    expect(toolKey({ key: "i", metaKey: true }, false)).toEqual({ type: "mode", mode: "highlighter" });
    expect(toolKey({ key: "e", ctrlKey: true }, false)).toEqual({ type: "mode", mode: "eraser" });
    expect(toolKey({ key: "a", ctrlKey: true }, false)).toEqual({ type: "mode", mode: "arrow" });
    expect(toolKey({ key: "m", ctrlKey: true }, false)).toEqual({ type: "toggleInk" });
    expect(toolKey({ key: "e" }, false)).toEqual({ type: "eraseAll" });
    expect(toolKey({ key: "g" }, false)).toEqual({ type: "seeAll" });
    expect(toolKey({ key: "+" }, false)).toEqual({ type: "zoom", dir: 1 });
    expect(toolKey({ key: "-" }, true)).toEqual({ type: "zoom", dir: -1 });
    expect(toolKey({ key: "-" }, false)).toEqual({ type: "seeAll" });
    expect(toolKey({ key: "n" }, false)).toBeNull(); // navigation stays with the show
    expect(toolKey({ key: "l", ctrlKey: true, altKey: true }, false)).toBeNull();
  });

  it("zoom steps and the offset keeping the point under the pointer", () => {
    expect(zoomStep(1, 1)).toBe(1.5);
    expect(zoomStep(4, 1)).toBe(4);
    expect(zoomStep(1.5, -1)).toBe(1);
    expect(zoomOffset({ x: 100, y: 50 }, 2, 1000, 500)).toEqual({ x: -100, y: -50 });
    // clamped so the slide still covers the area
    expect(zoomOffset({ x: 1000, y: 500 }, 2, 1000, 500)).toEqual({ x: -1000, y: -500 });
    expect(zoomOffset({ x: 0, y: 0 }, 2, 1000, 500)).toEqual({ x: 0, y: 0 });
  });

  it("the eraser removes strokes passing near the pointer; ink is per slide", () => {
    const a: InkStroke = { mode: "pen", color: "#f00", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] };
    const b: InkStroke = { mode: "highlighter", color: "#ff0", points: [{ x: 0, y: 50 }] };
    expect(eraseAt([a, b], { x: 50, y: 3 }, 5)).toEqual([b]);
    expect(eraseAt([a, b], { x: 2, y: 49 }, 5)).toEqual([a]);
    expect(eraseAt([a, b], { x: 50, y: 30 }, 5)).toHaveLength(2);
    const ink = withStrokes(new Map(), 7, [a]);
    expect(ink.get(7)).toEqual([a]);
    expect(withStrokes(ink, 7, []).has(7)).toBe(false);
    expect(svgPoints(a.points)).toBe("0,0 100,0");
  });

  it("See all slides grid columns", () => {
    expect(seeAllColumns(1, 1200)).toBe(2);
    expect(seeAllColumns(20, 1200)).toBe(6);
    expect(seeAllColumns(40, 400)).toBe(2);
  });
});

describe("Set Up Slide Show in the show", () => {
  const slides = [1, 2, 3, 4].map((id) => ({ id, layout: "blank", shapes: [], hidden: id === 3 }) as Slide);

  it("range and hidden slides", () => {
    expect(showRange(slides, 1, null).map((s) => s.id)).toEqual([1, 2, 4]);
    expect(showRange(slides, 2, { start: 2, end: 3 }).map((s) => s.id)).toEqual([2]);
    expect(showRange(slides, 3, { start: 2, end: 4 }).map((s) => s.id)).toEqual([2, 3, 4]);
  });

  it("loop continuously: after the last slide the first comes again", () => {
    const s: ShowState = { ...initialShow(2, 1), loop: true };
    const next = reduceShow(s, { type: "next" }) as ShowState;
    expect(next.index).toBe(0);
    expect(next.ended).toBe(false);
    expect((reduceShow(initialShow(2, 1), { type: "next" }) as ShowState).ended).toBe(true);
  });

  it("without animation / manual advance strip animations and After timings", () => {
    const s = { id: 1, layout: "blank", shapes: [], animations: [{ id: 9 }], transition: { kind: "fade", durationMs: 500, advanceOnClick: true, advanceAfterMs: 3000 } } as unknown as Slide;
    expect(showSlides([s], undefined)[0]).toBe(s);
    const out = showSlides([s], { withoutAnimation: true, useTimings: false })[0]!;
    expect(out.animations).toBeUndefined();
    expect(out.transition?.advanceAfterMs).toBeUndefined();
    expect(out.transition?.kind).toBe("fade");
    expect(showSlides([s], { withoutAnimation: false, useTimings: true }, true)[0]!.transition?.advanceAfterMs).toBeUndefined(); // rehearsal
  });
});
