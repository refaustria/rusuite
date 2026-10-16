import { describe, expect, it } from "vitest";
import { dragGuide, gridEmu, gridLabel, gridLines, guideLabel, guideTargets, nearestGrid, newGuide, nudgeDelta, rulerTicks, rulerUnit, snapMove, snapToGrid } from "./guides";
import { snapTargets } from "./snap";

const size = { width: 12192000, height: 6858000 };
const slide = { width: 1280, height: 720 };
const none = { xs: [], ys: [] };

describe("grid", () => {
  it("units by language and the dialog's spacing choices", () => {
    expect(rulerUnit("en")).toBe("in");
    expect(rulerUnit("de")).toBe("cm");
    expect(gridEmu({ n: 1, d: 8 }, "in")).toBe(114300);
    expect(gridEmu({ n: 2, d: 1 }, "cm")).toBe(720000);
    expect(gridLabel({ n: 1, d: 4 }, "cm")).toBe("1/4 cm");
    expect(gridLabel({ n: 1, d: 1 }, "in")).toBe("1 in");
    expect(nearestGrid(76200, "in")).toEqual({ n: 1, d: 8 });
    expect(nearestGrid(360000, "cm")).toEqual({ n: 1, d: 1 });
  });

  it("snaps values and lists the lines inside", () => {
    expect(snapToGrid(13, 8)).toBe(16);
    expect(snapToGrid(11.9, 8)).toBe(8);
    expect(snapToGrid(5, 0)).toBe(5);
    expect(gridLines(40, 10)).toEqual([10, 20, 30]);
    expect(gridLines(40, 0)).toEqual([]);
  });

  it("arrow keys: the grid step onto the grid when snapping, Ctrl 1 px, Shift 10 px", () => {
    const box = { x: 13, y: 20, width: 10, height: 10 };
    expect(nudgeDelta({ dx: 1, dy: 0 }, box, { ctrl: false, shift: false, grid: 8 })).toEqual({ dx: 3, dy: 0 }); // 13 → 16
    expect(nudgeDelta({ dx: -1, dy: 0 }, box, { ctrl: false, shift: false, grid: 8 })).toEqual({ dx: -5, dy: 0 }); // 13 → 8
    expect(nudgeDelta({ dx: 0, dy: 1 }, box, { ctrl: false, shift: false, grid: 10 })).toEqual({ dx: 0, dy: 10 }); // on the grid: one step
    expect(nudgeDelta({ dx: 1, dy: 0 }, box, { ctrl: true, shift: false, grid: 8 })).toEqual({ dx: 1, dy: 0 });
    expect(nudgeDelta({ dx: 1, dy: 0 }, box, { ctrl: false, shift: true, grid: 0 })).toEqual({ dx: 10, dy: 0 });
  });
});

describe("drawing guides", () => {
  it("snap lines only while shown", () => {
    const guides = [newGuide("vertical", size), newGuide("horizontal", size, 952500)];
    expect(guideTargets({ guides, showGuides: false })).toEqual(none);
    expect(guideTargets({ guides, showGuides: true })).toEqual({ xs: [640], ys: [100] });
  });

  it("drag moves, Ctrl+drag copies, off the slide deletes", () => {
    const g = [newGuide("vertical", size), newGuide("horizontal", size)];
    expect(dragGuide(g, 0, 1000, size, false)).toEqual({ guides: [{ orient: "vertical", pos: 1000 }, g[1]], result: "moved" });
    expect(dragGuide(g, 0, 1000, size, true).guides).toHaveLength(3);
    expect(dragGuide(g, 1, -5, size, false)).toEqual({ guides: [g[0]], result: "deleted" });
    expect(dragGuide(g, 0, size.width + 1, size, false).result).toBe("deleted");
  });

  it("label: the distance from the slide centre", () => {
    expect(guideLabel({ orient: "vertical", pos: size.width / 2 }, size, "in")).toBe("0.00");
    expect(guideLabel({ orient: "horizontal", pos: 0 }, size, "in")).toBe("3.75");
    expect(guideLabel({ orient: "vertical", pos: 0 }, size, "cm")).toBe("16.93");
  });

  it("snapMove: smart guides win, drawing guides also without them, else the grid", () => {
    const shapes = snapTargets(slide, [{ x: 100, y: 100, width: 100, height: 100 }]);
    const guides = { xs: [403], ys: [] };
    const box = { x: 401, y: 297, width: 50, height: 50 };
    // left edge 401 → guide 403; top 297 → nothing (grid off)
    expect(snapMove(box, { shapes, guides }, [], { shapes: true, grid: 0, threshold: 4 })).toMatchObject({ dx: 2, dy: 0 });
    // smart guides off: still the guide; the grid catches y
    const r = snapMove(box, { shapes, guides }, [], { shapes: false, grid: 10, threshold: 4 });
    expect(r.dx).toBe(2);
    expect(r.dy).toBe(3); // 297 → 300 on the grid
    // a shape edge within the threshold beats the grid
    const s = snapMove({ x: 198, y: 50, width: 20, height: 20 }, { shapes, guides: none }, [], { shapes: true, grid: 7, threshold: 4 });
    expect(s.dx).toBe(2);
    expect(s.guides.v).toEqual([200]);
  });
});

describe("rulers", () => {
  it("count from the centre in whole units", () => {
    const ticks = rulerTicks(914400 * 4, "in");
    const majors = ticks.filter((t) => t.kind === "major");
    expect(majors.map((t) => t.label)).toEqual(["2", "1", "0", "1", "2"]);
    expect(majors[2]!.at).toBe(192);
    expect(ticks.filter((t) => t.kind === "half")).toHaveLength(4);
    const cm = rulerTicks(360000 * 2, "cm");
    expect(cm.filter((t) => t.kind === "minor")).toHaveLength(4);
  });
});
