// Connectors in the editor: connection sites on the slide, snapping an
// end to the nearest site, the commands of drawing a connector and of
// dragging one of its ends, Reroute Connectors, the arrowhead outlines.

import type { ArrowEnd } from "../generated/ArrowEnd";
import type { ArrowKind } from "../generated/ArrowKind";
import type { ArrowSize } from "../generated/ArrowSize";
import type { Attach } from "../generated/Attach";
import type { Connector } from "../generated/Connector";
import type { ConnectorPatch } from "../generated/ConnectorPatch";
import type { NodeId } from "../generated/NodeId";
import type { Shape } from "../generated/Shape";
import type { ShowCommand } from "../generated/ShowCommand";
import type { Site } from "../generated/Site";
import type { Transform } from "../generated/Transform";
import { dist, fromLineEnds, lineEnds, mapLocal, type Pt } from "./geom";
import { choiceShape, type ShapeChoice } from "./presets";

/** A connection site on the slide (EMU). */
export interface SlideSite extends Pt {
  shape: NodeId;
  site: number;
}

/** Whether a shape takes connectors (auto shapes, pictures, tables; not groups or connectors). */
export const connectable = (s: Shape): boolean => s.kind.kind === "auto" || s.kind.kind === "picture" || s.kind.kind === "table";

/** The sites of a shape (`sites` from its outline query) on the slide. */
export function slideSites(shape: Shape, sites: readonly Site[], t: Transform = shape.transform): SlideSite[] {
  return sites.map((s, i) => ({ ...mapLocal(t, s.x, s.y), shape: shape.id, site: i }));
}

/** The top-most connectable shape whose box (grown by `margin` EMU) contains `p`, skipping `exclude`. */
export function shapeUnder(shapes: readonly Shape[], p: Pt, margin: number, exclude?: NodeId): Shape | null {
  for (let i = shapes.length - 1; i >= 0; i--) {
    const s = shapes[i]!;
    if (s.id === exclude || !connectable(s)) continue;
    const t = s.transform;
    // in the shape's own space, so rotated shapes work
    const a = (-(t.rotationDeg ?? 0) * Math.PI) / 180;
    const dx = p.x - (t.x + t.w / 2);
    const dy = p.y - (t.y + t.h / 2);
    const lx = dx * Math.cos(a) - dy * Math.sin(a);
    const ly = dx * Math.sin(a) + dy * Math.cos(a);
    if (Math.abs(lx) <= t.w / 2 + margin && Math.abs(ly) <= t.h / 2 + margin) return s;
  }
  return null;
}

/** The nearest site within `radius` EMU of `p`, else `null`. */
export function snapToSite(sites: readonly SlideSite[], p: Pt, radius: number): SlideSite | null {
  let best: SlideSite | null = null;
  let bd = radius;
  for (const s of sites) {
    const d = dist(s, p);
    if (d <= bd) {
      best = s;
      bd = d;
    }
  }
  return best;
}

/** One end while drawing or dragging: a point, glued to a site when `site` is set. */
export interface ConnEnd {
  p: Pt;
  site: SlideSite | null;
}

const attachOf = (e: ConnEnd): Attach | undefined => (e.site ? { shape: e.site.shape, site: e.site.site } : undefined);
const endPoint = (e: ConnEnd): Pt => (e.site ? { x: e.site.x, y: e.site.y } : e.p);

/** `AddShape` of a connector drawn from `start` to `end` on `slide` (the core reroutes glued ends). */
export function drawConnectorCommand(slide: NodeId, choice: Extract<ShapeChoice, { kind: "connector" }>, start: ConnEnd, end: ConnEnd, id: number): ShowCommand {
  const shape = choiceShape(choice, fromLineEnds(endPoint(start), endPoint(end)), id);
  if (shape.kind.kind === "connector") {
    const a = attachOf(start);
    const b = attachOf(end);
    if (a) shape.kind.value.start = a;
    if (b) shape.kind.value.end = b;
  }
  return { type: "addShape", slide, shape };
}

/**
 * The commands of dragging end `which` of connector `shape` to `to`: the
 * new box (the other end stays), then the attachments of both ends (the
 * move lets go of glued ends, `SetConnector` glues them again and the
 * core reroutes).
 */
export function moveEndCommands(shape: Shape, which: "start" | "end", to: ConnEnd): ShowCommand[] {
  if (shape.kind.kind !== "connector") return [];
  const c = shape.kind.value;
  const [s0, e0] = lineEnds(shape.transform);
  const start = which === "start" ? endPoint(to) : s0;
  const end = which === "end" ? endPoint(to) : e0;
  const patch: ConnectorPatch = which === "start" ? { start: attachOf(to) ?? null, end: c.end ?? null } : { start: c.start ?? null, end: attachOf(to) ?? null };
  const t = fromLineEnds(start, end);
  return [
    { type: "setTransform", shapes: [[shape.id, t]] },
    { type: "setConnector", shape: shape.id, patch },
  ];
}

/**
 * Reroute Connectors: each glued end moves to the site of its shape that
 * is nearest to the other end (`sitesOf` gives a shape's sites on the
 * slide). `null` when nothing changes.
 */
export function rerouteCommand(shape: Shape, sitesOf: (id: NodeId) => SlideSite[]): ShowCommand | null {
  if (shape.kind.kind !== "connector") return null;
  const c = shape.kind.value;
  let [s, e] = lineEnds(shape.transform);
  const pick = (a: Attach | undefined, other: Pt): Attach | undefined => {
    if (!a) return a;
    const best = snapToSite(sitesOf(a.shape), other, Infinity);
    return best ? { shape: a.shape, site: best.site } : a;
  };
  // the other end's position: its current site, if glued
  const at = (a: Attach | undefined, fallback: Pt) => (a ? (sitesOf(a.shape)[a.site] ?? fallback) : fallback);
  s = at(c.start, s);
  e = at(c.end, e);
  const start = pick(c.start, e);
  const end = pick(c.end, start ? (sitesOf(start.shape)[start.site] ?? s) : s);
  const same = (a?: Attach, b?: Attach) => a?.shape === b?.shape && a?.site === b?.site;
  if (same(start, c.start) && same(end, c.end)) return null;
  return { type: "setConnector", shape: shape.id, patch: { start: start ?? null, end: end ?? null } };
}

// ----- arrowheads ----------------------------------------------------------------

/** Size factor of an arrowhead dimension (× the line width), as DrawingML. */
export const arrowFactor = (s: ArrowSize): number => (s === "small" ? 2 : s === "large" ? 5 : 3);

/**
 * The outline of an arrowhead at `tip` pointing along `dir` (unit vector
 * from the line into the tip), line width `lw` (px): polygon points and
 * whether it is filled (`arrow` is an open V) or an ellipse (`oval`).
 */
export function arrowHead(end: ArrowEnd, tip: Pt, dir: Pt, lw: number): { kind: "polygon" | "polyline" | "oval"; points: number[]; rx?: number; ry?: number } | null {
  if (end.kind === "none") return null;
  const lwEff = Math.max(lw, 1);
  const len = arrowFactor(end.length) * lwEff;
  const wid = arrowFactor(end.width) * lwEff;
  const nx = -dir.y;
  const ny = dir.x;
  const back = (d: number) => ({ x: tip.x - dir.x * d, y: tip.y - dir.y * d });
  const side = (p: Pt, s: number) => [p.x + nx * s, p.y + ny * s];
  const b = back(len);
  switch (end.kind as ArrowKind) {
    case "triangle":
      return { kind: "polygon", points: [tip.x, tip.y, ...side(b, wid / 2), ...side(b, -wid / 2)] };
    case "stealth": {
      const notch = back(len * 0.6);
      return { kind: "polygon", points: [tip.x, tip.y, ...side(b, wid / 2), notch.x, notch.y, ...side(b, -wid / 2)] };
    }
    case "arrow":
      return { kind: "polyline", points: [...side(b, wid / 2), tip.x, tip.y, ...side(b, -wid / 2)] };
    case "diamond":
      return {
        kind: "polygon",
        points: [tip.x + dir.x * (len / 2), tip.y + dir.y * (len / 2), ...side(tip, wid / 2), tip.x - dir.x * (len / 2), tip.y - dir.y * (len / 2), ...side(tip, -wid / 2)],
      };
    case "oval":
      return { kind: "oval", points: [tip.x, tip.y], rx: len / 2, ry: wid / 2 };
    default:
      return null;
  }
}

/** Unit direction from `a` to `b` (`{1, 0}` when they coincide). */
export function unit(a: Pt, b: Pt): Pt {
  const d = dist(a, b);
  return d < 1e-9 ? { x: 1, y: 0 } : { x: (b.x - a.x) / d, y: (b.y - a.y) / d };
}

/** The tangents at the ends of a path's points: direction into the start (reversed) and into the end. */
export function endDirections(points: readonly Pt[]): { start: Pt; end: Pt } | null {
  if (points.length < 2) return null;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const nextDifferent = points.find((p) => dist(p, first) > 1e-6) ?? last;
  const prevDifferent = [...points].reverse().find((p) => dist(p, last) > 1e-6) ?? first;
  return { start: unit(nextDifferent, first), end: unit(prevDifferent, last) };
}

/** Connector type of the Shape Format menu → `SetConnector`. */
export function connectorKindCommand(shape: Shape, kind: Connector["kind"]): ShowCommand | null {
  if (shape.kind.kind !== "connector" || shape.kind.value.kind === kind) return null;
  return { type: "setConnector", shape: shape.id, patch: kind === "straight" ? { kind } : { kind, bends: shape.kind.value.bends ?? 2 } };
}

/** The arrow presets of Shape Outline › Arrows: `[head, tail]` kinds. */
export const ARROW_PRESETS: { id: string; head: ArrowKind; tail: ArrowKind }[] = [
  { id: "none", head: "none", tail: "none" },
  { id: "end", head: "none", tail: "triangle" },
  { id: "start", head: "triangle", tail: "none" },
  { id: "both", head: "triangle", tail: "triangle" },
  { id: "stealthEnd", head: "none", tail: "stealth" },
  { id: "openEnd", head: "none", tail: "arrow" },
  { id: "diamondEnd", head: "none", tail: "diamond" },
  { id: "ovalEnd", head: "none", tail: "oval" },
  { id: "ovalBoth", head: "oval", tail: "oval" },
];

/** `SetConnector` for an arrow preset (sizes of existing ends kept). */
export function arrowCommand(shape: Shape, head: ArrowKind, tail: ArrowKind): ShowCommand | null {
  if (shape.kind.kind !== "connector") return null;
  const c = shape.kind.value;
  const end = (kind: ArrowKind, old?: ArrowEnd): ArrowEnd => ({ kind, width: old?.width ?? "medium", length: old?.length ?? "medium" });
  return { type: "setConnector", shape: shape.id, patch: { head: end(head, c.head), tail: end(tail, c.tail) } };
}

/** `SetConnector` giving the arrowheads of a connector `size` (ends without one stay without). */
export function arrowSizeCommand(shape: Shape, size: ArrowSize): ShowCommand | null {
  if (shape.kind.kind !== "connector") return null;
  const c = shape.kind.value;
  const patch: ConnectorPatch = {};
  if (c.head && c.head.kind !== "none") patch.head = { ...c.head, width: size, length: size };
  if (c.tail && c.tail.kind !== "none") patch.tail = { ...c.tail, width: size, length: size };
  return Object.keys(patch).length ? { type: "setConnector", shape: shape.id, patch } : null;
}
