// Shape Format › Edit Shape › Edit Points (P9-S2): the vertices of a
// shape's outline and the edits PowerPoint offers on them, pure. The
// outline is the core's (`shapePaths`: arcs already turned into cubic
// curves) in the shape's own box; editing a preset turns it into a custom
// geometry like PowerPoint does. After an edit the box is refitted to the
// points (the shape's transform changes, the drawing stays in place).

import type { GeomPath } from "../generated/GeomPath";
import type { PathCmd } from "../generated/PathCmd";
import type { Transform } from "../generated/Transform";
import { commandsBox, shiftCommands } from "./freeform";
import { mapLocal, type Pt } from "./geom";

/** A vertex: the end point of command `index`. */
export interface Vertex extends Pt {
  index: number;
}

const endOf = (c: PathCmd): Pt | null => (c.kind === "moveTo" || c.kind === "lineTo" || c.kind === "quadTo" || c.kind === "cubicTo" ? { x: c.x, y: c.y } : null);

/** The vertices of a command list (a closing segment's end is the start vertex, not repeated). */
export function vertices(cmds: PathCmd[]): Vertex[] {
  const out: Vertex[] = [];
  cmds.forEach((c, index) => {
    const p = endOf(c);
    if (p) out.push({ ...p, index });
  });
  // a closed path whose last segment returns to its start: one vertex
  const closed = cmds[cmds.length - 1]?.kind === "close";
  if (closed && out.length > 2) {
    const a = out[0]!;
    const b = out[out.length - 1]!;
    if (Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5) out.pop();
  }
  return out;
}

/** Whether commands can be edited point by point: one sub-path of lines and curves. */
export function editable(cmds: PathCmd[]): boolean {
  return cmds.length >= 2 && cmds[0]?.kind === "moveTo" && cmds.slice(1).every((c) => c.kind !== "arcTo" && c.kind !== "moveTo");
}

/** Moves vertex `index` by `dx`, `dy`; its curve handles move along. */
export function moveVertex(cmds: PathCmd[], index: number, dx: number, dy: number): PathCmd[] {
  const out = cmds.slice();
  const c = out[index];
  if (!c) return out;
  if (c.kind === "moveTo" || c.kind === "lineTo") out[index] = { ...c, x: c.x + dx, y: c.y + dy };
  else if (c.kind === "quadTo") out[index] = { ...c, x: c.x + dx, y: c.y + dy };
  else if (c.kind === "cubicTo") out[index] = { ...c, x2: c.x2 + dx, y2: c.y2 + dy, x: c.x + dx, y: c.y + dy };
  const next = out[index + 1];
  if (next?.kind === "cubicTo") out[index + 1] = { ...next, x1: next.x1 + dx, y1: next.y1 + dy };
  // the start of a closed path: the segment closing onto it follows too
  if (c.kind === "moveTo" && out[out.length - 1]?.kind === "close") {
    const lastI = out.length - 2;
    const last = out[lastI];
    if (last && last !== out[index] && (last.kind === "lineTo" || last.kind === "cubicTo") && Math.abs(last.x - c.x) < 0.5 && Math.abs(last.y - c.y) < 0.5) {
      out[lastI] = last.kind === "cubicTo" ? { ...last, x2: last.x2 + dx, y2: last.y2 + dy, x: last.x + dx, y: last.y + dy } : { ...last, x: last.x + dx, y: last.y + dy };
    }
  }
  return out;
}

/** Deletes vertex `index` (PowerPoint: Delete Point; the path keeps at least two points). */
export function deleteVertex(cmds: PathCmd[], index: number): PathCmd[] {
  if (vertices(cmds).length <= 2 || !cmds[index] || !endOf(cmds[index]!)) return cmds;
  const out = cmds.slice();
  if (index === 0) {
    const next = out[1];
    out.splice(0, 1);
    if (next) {
      const p = endOf(next)!;
      out[0] = { kind: "moveTo", x: p.x, y: p.y };
    }
    return out;
  }
  out.splice(index, 1);
  return out;
}

const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** The start point of command `index` (the previous end, or the sub-path start). */
function startOf(cmds: PathCmd[], index: number): Pt {
  for (let i = index - 1; i >= 0; i--) {
    const p = endOf(cmds[i]!);
    if (p) return p;
  }
  return { x: 0, y: 0 };
}

/** Adds a vertex on segment `index` at parameter `t` (Add Point; a curve is split in two). */
export function addVertex(cmds: PathCmd[], index: number, t = 0.5): PathCmd[] {
  const c = cmds[index];
  if (!c || (c.kind !== "lineTo" && c.kind !== "cubicTo")) return cmds;
  const a = startOf(cmds, index);
  const out = cmds.slice();
  if (c.kind === "lineTo") {
    const m = lerp(a, c, t);
    out.splice(index, 1, { kind: "lineTo", x: m.x, y: m.y }, c);
    return out;
  }
  // de Casteljau
  const p1 = { x: c.x1, y: c.y1 };
  const p2 = { x: c.x2, y: c.y2 };
  const p3 = { x: c.x, y: c.y };
  const q0 = lerp(a, p1, t);
  const q1 = lerp(p1, p2, t);
  const q2 = lerp(p2, p3, t);
  const r0 = lerp(q0, q1, t);
  const r1 = lerp(q1, q2, t);
  const m = lerp(r0, r1, t);
  out.splice(index, 1, { kind: "cubicTo", x1: q0.x, y1: q0.y, x2: r0.x, y2: r0.y, x: m.x, y: m.y }, { kind: "cubicTo", x1: r1.x, y1: r1.y, x2: q2.x, y2: q2.y, x: p3.x, y: p3.y });
  return out;
}

/** Straight Segment / Curved Segment for segment `index` (a straight curve keeps its shape as a line). */
export function setSegment(cmds: PathCmd[], index: number, kind: "straight" | "curved"): PathCmd[] {
  const c = cmds[index];
  if (!c) return cmds;
  const out = cmds.slice();
  if (kind === "straight" && (c.kind === "cubicTo" || c.kind === "quadTo")) out[index] = { kind: "lineTo", x: c.x, y: c.y };
  else if (kind === "curved" && c.kind === "lineTo") {
    const a = startOf(cmds, index);
    const p1 = lerp(a, c, 1 / 3);
    const p2 = lerp(a, c, 2 / 3);
    out[index] = { kind: "cubicTo", x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, x: c.x, y: c.y };
  }
  return out;
}

/** Smooth Point: the handles around vertex `index` lie on one line through it (the neighbours' direction), a third of each segment long. */
export function smoothVertex(cmds: PathCmd[], index: number): PathCmd[] {
  const c = cmds[index];
  const p = c ? endOf(c) : null;
  if (!c || !p || index === 0) return cmds;
  let out = setSegment(cmds, index, "curved");
  const nextI = index + 1;
  if (out[nextI] && endOf(out[nextI]!)) out = setSegment(out, nextI, "curved");
  const prev = startOf(out, index);
  const next = out[nextI] ? endOf(out[nextI]!) : null;
  const dir = next ? { x: next.x - prev.x, y: next.y - prev.y } : { x: p.x - prev.x, y: p.y - prev.y };
  const len = Math.hypot(dir.x, dir.y) || 1;
  const u = { x: dir.x / len, y: dir.y / len };
  const inLen = Math.hypot(p.x - prev.x, p.y - prev.y) / 3;
  const cur = out[index]!;
  if (cur.kind === "cubicTo") out[index] = { ...cur, x2: p.x - u.x * inLen, y2: p.y - u.y * inLen };
  const n = out[nextI];
  if (n?.kind === "cubicTo" && next) {
    const outLen = Math.hypot(next.x - p.x, next.y - p.y) / 3;
    out[nextI] = { ...n, x1: p.x + u.x * outLen, y1: p.y + u.y * outLen };
  }
  return out;
}

/** Open Path / Close Path. */
export function toggleClosed(cmds: PathCmd[]): PathCmd[] {
  return cmds[cmds.length - 1]?.kind === "close" ? cmds.slice(0, -1) : [...cmds, { kind: "close" }];
}

/** The segment (command index) nearest to box point `p` within `tol`, with the parameter there (sampled). */
export function nearestSegment(cmds: PathCmd[], p: Pt, tol: number): { index: number; t: number } | null {
  let best: { index: number; t: number; d: number } | null = null;
  cmds.forEach((c, index) => {
    if (c.kind !== "lineTo" && c.kind !== "cubicTo") return;
    const a = startOf(cmds, index);
    for (let k = 1; k < 20; k++) {
      const t = k / 20;
      const q =
        c.kind === "lineTo"
          ? lerp(a, c, t)
          : {
              x: (1 - t) ** 3 * a.x + 3 * (1 - t) ** 2 * t * c.x1 + 3 * (1 - t) * t * t * c.x2 + t ** 3 * c.x,
              y: (1 - t) ** 3 * a.y + 3 * (1 - t) ** 2 * t * c.y1 + 3 * (1 - t) * t * t * c.y2 + t ** 3 * c.y,
            };
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d <= tol && (!best || d < best.d)) best = { index, t, d };
    }
  });
  const b = best as { index: number; t: number; d: number } | null;
  return b ? { index: b.index, t: b.t } : null;
}

/**
 * The shape's new box and custom geometry for edited box commands: the
 * box shrinks or grows to the points, the outline stays where it is on
 * the slide (also for rotated and flipped shapes).
 */
export function refit(t: Transform, cmds: PathCmd[], fill: boolean): { transform: Transform; path: GeomPath } {
  const b = commandsBox(cmds);
  // the new box's centre in the old box's space, mapped to the slide
  const c = mapLocal(t, b.x + b.w / 2, b.y + b.h / 2);
  // flipped shapes draw their path mirrored: keep the path, mirror the offset only
  const transform: Transform = { ...t, x: Math.round(c.x - b.w / 2), y: Math.round(c.y - b.h / 2), w: b.w, h: b.h };
  return { transform, path: { w: b.w, h: b.h, fill, stroke: true, commands: shiftCommands(cmds, b.x, b.y) } };
}
