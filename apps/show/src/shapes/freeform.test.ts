import { describe, expect, it } from "vitest";
import { freeformCommands, freeformDown, freeformFinish, freeformGeometry, freeformMove, freeformPreview, freeformUp, simplify, startFreeform, type FreeformState } from "./freeform";
import { addVertex, deleteVertex, editable, moveVertex, nearestSegment, refit, setSegment, smoothVertex, toggleClosed, vertices } from "./editPoints";
import { mapLocal } from "./geom";
import type { PathCmd } from "../generated/PathCmd";

const TOL = { snap: 50, step: 10 };
const click = (s: FreeformState, x: number, y: number) => freeformUp(freeformDown(s, { x, y }), { x, y }, TOL);

describe("Freeform: Shape tool", () => {
  it("clicks add corners joined by straight lines; a click on the start closes the shape", () => {
    let s = startFreeform("freeform");
    for (const [x, y] of [[0, 0], [1000, 0], [1000, 800], [0, 800]] as const) s = click(s, x, y);
    expect(s.points).toHaveLength(4);
    expect(s.done).toBeNull();
    // the rubber band follows the pointer between clicks
    s = freeformMove(s, { x: 20, y: 30 }, TOL);
    expect(freeformPreview(s).at(-1)).toEqual({ x: 20, y: 30 });
    s = click(s, 20, 30);
    expect(s.done).toEqual({ closed: true });
    const g = freeformGeometry(s, 5)!;
    expect(g.transform).toMatchObject({ x: 0, y: 0, w: 1000, h: 800 });
    expect(g.path).toMatchObject({ w: 1000, h: 800, fill: true, stroke: true });
    expect(g.path.commands.map((c) => c.kind)).toEqual(["moveTo", "lineTo", "lineTo", "lineTo", "close"]);
  });

  it("dragging draws freehand curves; a double-click ends the shape open", () => {
    let s = startFreeform("freeform");
    s = click(s, 100, 100);
    s = freeformDown(s, { x: 100, y: 100 });
    for (let i = 1; i <= 20; i++) s = freeformMove(s, { x: 100 + i * 50, y: 100 + Math.round(Math.sin(i / 3) * 300) }, TOL);
    s = freeformUp(s, { x: 1100, y: 100 }, TOL);
    expect(s.points.some((p) => p.free)).toBe(true);
    s = click(s, 1500, 900);
    s = click(s, 1500, 900); // the double-click's second click
    s = freeformFinish(s, TOL);
    expect(s.done).toEqual({ closed: false });
    const g = freeformGeometry(s, 5)!;
    const kinds = g.path.commands.map((c) => c.kind);
    expect(kinds[0]).toBe("moveTo");
    expect(kinds).toContain("cubicTo");
    expect(kinds.at(-1)).toBe("lineTo");
    expect(g.path.fill).toBe(false);
    // coordinates are in the box
    expect(g.transform.x).toBeLessThanOrEqual(100);
    for (const c of g.path.commands) if (c.kind === "lineTo" || c.kind === "cubicTo" || c.kind === "moveTo") expect(c.x).toBeGreaterThanOrEqual(0);
  });

  it("Scribble: one drag, released ends it; a click alone draws nothing", () => {
    let s = startFreeform("scribble");
    s = click(s, 5, 5);
    expect(s.points).toHaveLength(0);
    s = freeformDown(s, { x: 0, y: 0 });
    for (let i = 1; i <= 10; i++) s = freeformMove(s, { x: i * 100, y: i * 40 }, TOL);
    s = freeformUp(s, { x: 1000, y: 400 }, TOL);
    expect(s.done).toEqual({ closed: false });
    expect(freeformGeometry(s, 5)!.path.commands.filter((c) => c.kind === "cubicTo").length).toBeGreaterThan(0);
  });

  it("simplify keeps the points that matter", () => {
    const line = Array.from({ length: 11 }, (_, i) => ({ x: i * 10, y: 0 }));
    expect(simplify(line, 1)).toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }]);
    expect(simplify([{ x: 0, y: 0 }, { x: 50, y: 40 }, { x: 100, y: 0 }], 1)).toHaveLength(3);
    expect(freeformCommands([{ x: 0, y: 0, free: false }, { x: 10, y: 0, free: false }], true, 1).at(-1)).toEqual({ kind: "close" });
  });
});

const square: PathCmd[] = [
  { kind: "moveTo", x: 0, y: 0 },
  { kind: "lineTo", x: 100, y: 0 },
  { kind: "lineTo", x: 100, y: 100 },
  { kind: "lineTo", x: 0, y: 100 },
  { kind: "close" },
];

describe("Edit Points", () => {
  it("vertices, move, add and delete", () => {
    expect(editable(square)).toBe(true);
    expect(editable([{ kind: "moveTo", x: 0, y: 0 }, { kind: "arcTo", wr: 1, hr: 1, startDeg: 0, sweepDeg: 90 }])).toBe(false);
    expect(vertices(square).map((v) => v.index)).toEqual([0, 1, 2, 3]);
    const moved = moveVertex(square, 2, 50, 20);
    expect(moved[2]).toEqual({ kind: "lineTo", x: 150, y: 120 });
    const added = addVertex(square, 1);
    expect(added[1]).toEqual({ kind: "lineTo", x: 50, y: 0 });
    expect(vertices(added)).toHaveLength(5);
    const del = deleteVertex(square, 0);
    expect(del[0]).toEqual({ kind: "moveTo", x: 100, y: 0 });
    expect(vertices(deleteVertex(deleteVertex(square, 3), 2))).toHaveLength(2);
    expect(deleteVertex(deleteVertex(deleteVertex(square, 3), 2), 1)).toHaveLength(3);
  });

  it("straight / curved segments, smooth points, open / close, picking a segment", () => {
    const curved = setSegment(square, 1, "curved");
    expect(curved[1]).toMatchObject({ kind: "cubicTo", x: 100, y: 0 });
    expect(setSegment(curved, 1, "straight")[1]).toEqual({ kind: "lineTo", x: 100, y: 0 });
    const smooth = smoothVertex(square, 2);
    const a = smooth[2]!;
    const b = smooth[3]!;
    expect(a.kind).toBe("cubicTo");
    expect(b.kind).toBe("cubicTo");
    if (a.kind === "cubicTo" && b.kind === "cubicTo") {
      // the handles around the vertex are collinear with it
      const cross = (a.x2 - 100) * (b.y1 - 100) - (a.y2 - 100) * (b.x1 - 100);
      expect(Math.abs(cross)).toBeLessThan(1e-6);
    }
    expect(toggleClosed(square).at(-1)?.kind).toBe("lineTo");
    expect(toggleClosed(toggleClosed(square)).at(-1)?.kind).toBe("close");
    expect(nearestSegment(square, { x: 101, y: 50 }, 5)).toMatchObject({ index: 2 });
    expect(nearestSegment(square, { x: 50, y: 50 }, 5)).toBeNull();
  });

  it("refit: the box follows the points, the outline stays on the slide (rotated too)", () => {
    const t = { x: 1000, y: 1000, w: 100, h: 100, rotationDeg: 30 };
    const cmds = moveVertex(square, 2, 100, 60);
    const before = mapLocal(t, 200, 160);
    const r = refit(t, cmds, true);
    expect(r.transform).toMatchObject({ w: 200, h: 160, rotationDeg: 30 });
    const v = r.path.commands[2]!;
    expect(v).toMatchObject({ x: 200, y: 160 });
    const after = mapLocal(r.transform, 200, 160);
    expect(Math.abs(after.x - before.x)).toBeLessThan(1.5);
    expect(Math.abs(after.y - before.y)).toBeLessThan(1.5);
  });
});
