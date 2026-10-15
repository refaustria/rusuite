import { describe, expect, it } from "vitest";
import type { Shape } from "../generated/Shape";
import { rect } from "../test/fixture";
import {
  arrowCommand, arrowHead, arrowSizeCommand, connectorKindCommand, drawConnectorCommand, endDirections, moveEndCommands, rerouteCommand,
  shapeUnder, slideSites, snapToSite, type SlideSite,
} from "./connectors";
import { choiceOf } from "./presets";

const A = rect(1, 0, 0); // 0..1828800 × 0..1371600
const B = rect(2, 4000000, 3000000);
const sitesOf = (s: Shape): SlideSite[] =>
  slideSites(s, [
    { x: s.transform.w / 2, y: 0, angleDeg: 270 },
    { x: 0, y: s.transform.h / 2, angleDeg: 180 },
    { x: s.transform.w / 2, y: s.transform.h, angleDeg: 90 },
    { x: s.transform.w, y: s.transform.h / 2, angleDeg: 0 },
  ]);
const conn = (extra: Partial<Extract<Shape["kind"], { kind: "connector" }>["value"]> = {}): Shape => ({
  ...rect(3, 1828800, 685800),
  kind: { kind: "connector", value: { kind: "elbow", bends: 2, ...extra } },
  transform: { x: 1828800, y: 685800, w: 2171200, h: 3000000, rotationDeg: 0 },
});

describe("connection sites", () => {
  it("maps sites onto the slide (rotation too)", () => {
    const s = sitesOf(A);
    expect(s[3]).toEqual({ x: 1828800, y: 685800, shape: 1, site: 3 });
    const rotated = { ...A, transform: { ...A.transform, rotationDeg: 90 } };
    const r = sitesOf(rotated)[3]!;
    expect(r.x).toBeCloseTo(914400);
    expect(r.y).toBeCloseTo(685800 + 914400);
  });

  it("finds the top-most connectable shape under a point, with a margin", () => {
    expect(shapeUnder([A, B], { x: 100, y: 100 }, 0)?.id).toBe(1);
    expect(shapeUnder([A, B], { x: 1828800 + 50, y: 10 }, 100)?.id).toBe(1);
    expect(shapeUnder([A, B], { x: 1828800 + 500, y: 10 }, 100)).toBeNull();
    expect(shapeUnder([A, conn()], { x: 2000000, y: 2000000 }, 0)).toBeNull(); // connectors take no connectors
    expect(shapeUnder([A], { x: 10, y: 10 }, 0, 1)).toBeNull();
  });

  it("snaps to the nearest site within the radius", () => {
    const s = sitesOf(A);
    expect(snapToSite(s, { x: 1828000, y: 690000 }, 10000)?.site).toBe(3);
    expect(snapToSite(s, { x: 1700000, y: 690000 }, 10000)).toBeNull();
  });
});

describe("connector commands", () => {
  it("draws a connector glued at both ends (box from the sites)", () => {
    const [a, b] = [sitesOf(A)[3]!, sitesOf(B)[1]!];
    const c = drawConnectorCommand(5, choiceOf("elbowArrow") as never, { p: a, site: a }, { p: b, site: b }, -1);
    expect(c).toMatchObject({
      type: "addShape",
      slide: 5,
      shape: { id: -1, transform: { x: 1828800, y: 685800, w: 4000000 - 1828800, h: 3000000 + 685800 - 685800 }, kind: { kind: "connector", value: { kind: "elbow", start: { shape: 1, site: 3 }, end: { shape: 2, site: 1 }, tail: { kind: "triangle" } } } },
    });
  });

  it("an unglued end keeps its point; drawing backwards flips the box", () => {
    const c = drawConnectorCommand(5, choiceOf("line") as never, { p: { x: 1000, y: 1000 }, site: null }, { p: { x: 0, y: 0 }, site: null }, -1);
    expect(c).toMatchObject({ shape: { transform: { x: 0, y: 0, w: 1000, h: 1000, flipH: true, flipV: true } } });
    expect(c.type === "addShape" && c.shape.kind.kind === "connector" && c.shape.kind.value.start).toBeUndefined();
  });

  it("moving an end: new box, then both attachments again (the core reroutes)", () => {
    const s = conn({ start: { shape: 1, site: 3 }, end: { shape: 2, site: 1 } });
    const cmds = moveEndCommands(s, "end", { p: { x: 5000000, y: 100 }, site: null });
    expect(cmds[0]).toMatchObject({ type: "setTransform", shapes: [[3, { x: 1828800, y: 100, w: 5000000 - 1828800, h: 685700, flipV: true }]] });
    expect(cmds[1]).toEqual({ type: "setConnector", shape: 3, patch: { start: { shape: 1, site: 3 }, end: null } });
  });

  it("Reroute picks the sites nearest to the other end", () => {
    const s = conn({ start: { shape: 1, site: 0 }, end: { shape: 2, site: 2 } });
    const byId = (id: number) => sitesOf(id === 1 ? A : B);
    expect(rerouteCommand(s, byId)).toEqual({ type: "setConnector", shape: 3, patch: { start: { shape: 1, site: 3 }, end: { shape: 2, site: 1 } } });
    const good = conn({ start: { shape: 1, site: 3 }, end: { shape: 2, site: 1 } });
    expect(rerouteCommand(good, byId)).toBeNull();
  });

  it("arrows, arrow sizes and connector type", () => {
    const s = conn({ tail: { kind: "triangle", width: "large", length: "large" } });
    expect(arrowCommand(s, "oval", "stealth")).toEqual({
      type: "setConnector",
      shape: 3,
      patch: { head: { kind: "oval", width: "medium", length: "medium" }, tail: { kind: "stealth", width: "large", length: "large" } },
    });
    expect(arrowSizeCommand(s, "small")).toEqual({ type: "setConnector", shape: 3, patch: { tail: { kind: "triangle", width: "small", length: "small" } } });
    expect(arrowSizeCommand(conn(), "small")).toBeNull();
    expect(connectorKindCommand(s, "curved")).toEqual({ type: "setConnector", shape: 3, patch: { kind: "curved", bends: 2 } });
    expect(connectorKindCommand(s, "elbow")).toBeNull();
    expect(arrowCommand(A, "none", "none")).toBeNull();
  });

  it("arrowheads: a filled triangle at the tip, open V, oval; directions at the ends", () => {
    const tri = arrowHead({ kind: "triangle", width: "medium", length: "medium" }, { x: 10, y: 0 }, { x: 1, y: 0 }, 2)!;
    expect(tri).toEqual({ kind: "polygon", points: [10, 0, 4, 3, 4, -3] });
    expect(arrowHead({ kind: "arrow", width: "small", length: "small" }, { x: 0, y: 0 }, { x: 1, y: 0 }, 1)!.kind).toBe("polyline");
    expect(arrowHead({ kind: "oval", width: "large", length: "large" }, { x: 0, y: 0 }, { x: 1, y: 0 }, 1)).toMatchObject({ kind: "oval", rx: 2.5, ry: 2.5 });
    expect(arrowHead({ kind: "none", width: "small", length: "small" }, { x: 0, y: 0 }, { x: 1, y: 0 }, 1)).toBeNull();
    const d = endDirections([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }])!;
    expect(d.start).toEqual({ x: -1, y: 0 });
    expect(d.end).toEqual({ x: 0, y: 1 });
  });
});
