// Pure geometry of drawing objects (P9-W4): resizing a rotated frame from
// one of its eight handles (the opposite handle stays put, Word) and
// pointer deltas in a shape's own frame (both from ui-shared, P9-X1), snapping a move to guides (Alt moves
// freely), arrow-key nudging (Ctrl: 1 px), group frames and member
// transforms, Align / Distribute of several objects.

import { rotateVec as rotate } from "@rusuite/ui-shared";
import type { Drawing } from "../../generated/Drawing";

/** EMU per CSS pixel (96 dpi). */
export const EMU_PER_PX = 9525;

/** Word's drawing grid (0.13 in): one arrow-key step. */
export const NUDGE_PX = 0.13 * 96;

// Rotating vectors and resizing a rotated frame are shared with Show (ui-shared, P9-X1).
export { rotatedResize, rotateVec as rotate, unrotateVec as toLocal } from "@rusuite/ui-shared";

/**
 * A move snapped to guides: when the moved object's left / centre / right
 * (top / middle / bottom) comes within `tol` px of a guide, it lands on it.
 * `free` (Alt held) moves without snapping (Word's fine positioning).
 */
export function snapMove(
  rect: { x: number; y: number; w: number; h: number },
  dx: number,
  dy: number,
  guides: { x: number[]; y: number[] },
  free: boolean,
  tol = 5,
): { dx: number; dy: number; snapped: { x: number | null; y: number | null } } {
  if (free) return { dx, dy, snapped: { x: null, y: null } };
  const best = (edges: number[], lines: number[]) => {
    let out: { d: number; at: number } | null = null;
    for (const e of edges)
      for (const g of lines) {
        const d = g - e;
        if (Math.abs(d) <= tol && (!out || Math.abs(d) < Math.abs(out.d))) out = { d, at: g };
      }
    return out;
  };
  const x = rect.x + dx;
  const y = rect.y + dy;
  const bx = best([x, x + rect.w / 2, x + rect.w], guides.x);
  const by = best([y, y + rect.h / 2, y + rect.h], guides.y);
  return { dx: dx + (bx?.d ?? 0), dy: dy + (by?.d ?? 0), snapped: { x: bx?.at ?? null, y: by?.at ?? null } };
}

/** The move of an arrow key (Ctrl: one pixel, else one grid step), or null for other keys. */
export function nudgeDelta(key: string, ctrl: boolean): { dx: number; dy: number } | null {
  const step = ctrl ? 1 : NUDGE_PX;
  switch (key) {
    case "ArrowLeft":
      return { dx: -step, dy: 0 };
    case "ArrowRight":
      return { dx: step, dy: 0 };
    case "ArrowUp":
      return { dx: 0, dy: -step };
    case "ArrowDown":
      return { dx: 0, dy: step };
    default:
      return null;
  }
}

/** A rectangle (px or EMU). */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The bounding box of `boxes`. */
export function bounds(boxes: Box[]): Box {
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const r = Math.max(...boxes.map((b) => b.x + b.w));
  const b = Math.max(...boxes.map((b) => b.y + b.h));
  return { x, y, w: r - x, h: b - y };
}

/**
 * Group (Arrange › Group): members (drawings without placement, in the
 * order given = z-order) placed at their frames `boxes` (EMU, any common
 * origin). Returns the members positioned in the group's frame and the
 * group's frame in the same coordinates.
 */
export function groupMembers(members: Drawing[], boxes: Box[]): { children: Drawing[]; frame: Box } {
  const frame = bounds(boxes);
  const children = members.map((m, i) => {
    const b = boxes[i]!;
    const out: Drawing = { ...m, x: Math.round(b.x - frame.x), y: Math.round(b.y - frame.y), width: Math.max(1, Math.round(b.w)), height: Math.max(1, Math.round(b.h)) };
    delete out.anchor;
    if (!out.x) delete out.x;
    if (!out.y) delete out.y;
    return out;
  });
  return { children, frame: { ...frame, w: Math.max(1, Math.round(frame.w)), h: Math.max(1, Math.round(frame.h)) } };
}

/**
 * Ungroup: the members' frames (EMU) in the coordinates of the group's
 * frame origin `(gx, gy)`, with the group's rotation (around its centre)
 * and flips applied to their places and rotations.
 */
export function ungroupMembers(group: Drawing, gx: number, gy: number): { member: Drawing; box: Box }[] {
  const cx = group.width / 2;
  const cy = group.height / 2;
  const rot = group.rotation ?? 0;
  return (group.children ?? []).map((c) => {
    let mx = (c.x ?? 0) + c.width / 2 - cx;
    let my = (c.y ?? 0) + c.height / 2 - cy;
    const m: Drawing = { ...c };
    if (group.flipH) {
      mx = -mx;
      m.flipH = !c.flipH;
    }
    if (group.flipV) {
      my = -my;
      m.flipV = !c.flipV;
    }
    const p = rotate({ x: mx, y: my }, rot);
    const r = (((c.rotation ?? 0) + rot) % 360 + 360) % 360;
    if (r) m.rotation = Math.round(r * 10) / 10;
    else delete m.rotation;
    if (!m.flipH) delete m.flipH;
    if (!m.flipV) delete m.flipV;
    delete m.x;
    delete m.y;
    return { member: m, box: { x: Math.round(gx + cx + p.x - c.width / 2) || 0, y: Math.round(gy + cy + p.y - c.height / 2) || 0, w: c.width, h: c.height } };
  });
}

/** The group with its members scaled to `width` × `height` (Rust's `Drawing::scale_children`). */
export function scaleGroup(d: Drawing, width: number, height: number): Drawing {
  const scale = (m: Drawing, sx: number, sy: number): Drawing => {
    const w = Math.max(1, Math.round(m.width * sx));
    const h = Math.max(1, Math.round(m.height * sy));
    const out: Drawing = { ...m, width: w, height: h };
    const x = Math.round((m.x ?? 0) * sx);
    const y = Math.round((m.y ?? 0) * sy);
    if (x) out.x = x;
    else delete out.x;
    if (y) out.y = y;
    else delete out.y;
    if (m.children?.length) out.children = m.children.map((c) => scale(c, w / Math.max(1, m.width), h / Math.max(1, m.height)));
    return out;
  };
  const sx = width / Math.max(1, d.width);
  const sy = height / Math.max(1, d.height);
  return { ...d, width, height, ...(d.children?.length ? { children: d.children.map((c) => scale(c, sx, sy)) } : {}) };
}

/** The member at `path` (indices into `children`), or null. */
export function memberAt(d: Drawing, path: number[]): Drawing | null {
  let cur: Drawing | undefined = d;
  for (const i of path) cur = cur?.children?.[i];
  return cur ?? null;
}

/** The drawing with the member at `path` replaced by `m`. */
export function withMember(d: Drawing, path: number[], m: Drawing): Drawing {
  if (!path.length) return m;
  const [i, ...rest] = path;
  const children = [...(d.children ?? [])];
  children[i!] = withMember(children[i!]!, rest, m);
  return { ...d, children };
}

/** The path of the member with node id `id` (depth first), or null. */
export function memberPath(d: Drawing, id: number): number[] | null {
  const kids = d.children ?? [];
  for (let i = 0; i < kids.length; i++) {
    if (kids[i]!.id === id) return [i];
    const sub = memberPath(kids[i]!, id);
    if (sub) return [i, ...sub];
  }
  return null;
}

export type AlignMode = "left" | "center" | "right" | "top" | "middle" | "bottom";

/** Align: each box's move (dx, dy) so that its edge / centre lines up with `ref` (page, margin or the selection's bounds). */
export function alignBoxes(boxes: Box[], mode: AlignMode, ref: Box): { dx: number; dy: number }[] {
  return boxes.map((b) => {
    switch (mode) {
      case "left":
        return { dx: ref.x - b.x, dy: 0 };
      case "center":
        return { dx: ref.x + ref.w / 2 - (b.x + b.w / 2), dy: 0 };
      case "right":
        return { dx: ref.x + ref.w - (b.x + b.w), dy: 0 };
      case "top":
        return { dx: 0, dy: ref.y - b.y };
      case "middle":
        return { dx: 0, dy: ref.y + ref.h / 2 - (b.y + b.h / 2) };
      case "bottom":
        return { dx: 0, dy: ref.y + ref.h - (b.y + b.h) };
    }
  });
}

/**
 * Distribute Horizontally / Vertically: equal gaps between the boxes
 * (sorted by position). With several boxes the outer ones stay; one box
 * (relative to the page or margin `ref`) is centred.
 */
export function distributeBoxes(boxes: Box[], axis: "h" | "v", ref: Box | null): { dx: number; dy: number }[] {
  const pos = (b: Box) => (axis === "h" ? b.x : b.y);
  const size = (b: Box) => (axis === "h" ? b.w : b.h);
  const order = boxes.map((_b, i) => i).sort((a, b) => pos(boxes[a]!) - pos(boxes[b]!));
  const out = boxes.map(() => ({ dx: 0, dy: 0 }));
  const total = boxes.reduce((s, b) => s + size(b), 0);
  let start: number;
  let span: number;
  if (ref && boxes.length < 3) {
    start = axis === "h" ? ref.x : ref.y;
    span = axis === "h" ? ref.w : ref.h;
  } else {
    const first = boxes[order[0]!]!;
    const last = boxes[order[order.length - 1]!]!;
    start = pos(first);
    span = pos(last) + size(last) - start;
  }
  const n = boxes.length;
  const gap = ref && n < 3 ? (span - total) / (n + 1) : (span - total) / Math.max(1, n - 1);
  let at = start + (ref && n < 3 ? gap : 0);
  for (const i of order) {
    const b = boxes[i]!;
    const d = Math.round((at - pos(b)) * 100) / 100;
    out[i] = axis === "h" ? { dx: d, dy: 0 } : { dx: 0, dy: d };
    at += size(b) + gap;
  }
  return out;
}
