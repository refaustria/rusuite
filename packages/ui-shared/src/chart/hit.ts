// Hit-testing and selection marks of chart elements (pure).

import type { Box, ChartElement, ChartScene, HitShape } from "./scene";
import { sameElement } from "./scene";

function distToSegment(px: number, py: number, x0: number, y0: number, x1: number, y1: number): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / len2));
  return Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy));
}

function inPolygon(x: number, y: number, pts: number[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
    const xi = pts[i]!, yi = pts[i + 1]!, xj = pts[j]!, yj = pts[j + 1]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-12) + xi) inside = !inside;
  }
  return inside;
}

/** Whether chart-local point x, y lies on `shape`. */
export function hitShape(shape: HitShape, x: number, y: number): boolean {
  switch (shape.kind) {
    case "rect":
      return x >= shape.x && x <= shape.x + shape.w && y >= shape.y && y <= shape.y + shape.h;
    case "circle":
      return Math.hypot(x - shape.cx, y - shape.cy) <= shape.r;
    case "polygon":
      return inPolygon(x, y, shape.points);
    case "polyline": {
      const p = shape.points;
      if (p.length === 2) return Math.hypot(x - p[0]!, y - p[1]!) <= shape.width / 2;
      for (let i = 0; i + 3 < p.length; i += 2) if (distToSegment(x, y, p[i]!, p[i + 1]!, p[i + 2]!, p[i + 3]!) <= shape.width / 2) return true;
      return false;
    }
    case "sector": {
      const r = Math.hypot(x - shape.cx, y - shape.cy);
      if (r < shape.r0 || r > shape.r1) return false;
      let a = Math.atan2(x - shape.cx, shape.cy - y);
      const tau = Math.PI * 2;
      while (a < shape.a0) a += tau;
      while (a >= shape.a0 + tau) a -= tau;
      return a <= shape.a1;
    }
  }
}

/** The topmost element at chart-local x, y (`null` outside the chart). */
export function hitTestChart(scene: ChartScene, x: number, y: number): ChartElement | null {
  for (let i = scene.hits.length - 1; i >= 0; i--) {
    const h = scene.hits[i]!;
    if (hitShape(h.shape, x, y)) return h.el;
  }
  return null;
}

/** Bounding box of a hit shape. */
export function shapeBox(s: HitShape): Box {
  switch (s.kind) {
    case "rect":
      return { x: s.x, y: s.y, w: s.w, h: s.h };
    case "circle":
      return { x: s.cx - s.r, y: s.cy - s.r, w: 2 * s.r, h: 2 * s.r };
    case "sector":
      return { x: s.cx - s.r1, y: s.cy - s.r1, w: 2 * s.r1, h: 2 * s.r1 };
    default: {
      const xs = s.points.filter((_, i) => i % 2 === 0);
      const ys = s.points.filter((_, i) => i % 2 === 1);
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
    }
  }
}

/** The bounding box of every region of `el` (`null`: not in the scene). */
export function elementBounds(scene: ChartScene, el: ChartElement): Box | null {
  const boxes = scene.hits.filter((h) => sameElement(h.el, el) || (el.type === "series" && el.point === undefined && h.el.type === "series" && h.el.series === el.series)).map((h) => shapeBox(h.shape));
  if (!boxes.length) return null;
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return { x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y };
}

/** Selection marks (Excel style): handle squares at the points of a series, a frame around other elements. */
export function selectionMarks(scene: ChartScene, el: ChartElement): { frames: Box[]; handles: { x: number; y: number }[] } {
  const frames: Box[] = [];
  const handles: { x: number; y: number }[] = [];
  if (el.type === "chartArea") return { frames, handles };
  if (el.type === "series" || el.type === "trendline") {
    for (const h of scene.hits) {
      if (h.el.type !== el.type || h.el.series !== el.series) continue;
      const point = h.el.type === "series" ? h.el.point : undefined;
      if (el.type === "series" && el.point !== undefined && point !== el.point) continue;
      const s = h.shape;
      if (s.kind === "rect") handles.push({ x: s.x, y: s.y }, { x: s.x + s.w, y: s.y }, { x: s.x, y: s.y + s.h }, { x: s.x + s.w, y: s.y + s.h });
      else if (s.kind === "circle") handles.push({ x: s.cx, y: s.cy });
      else if (s.kind === "sector") {
        const mid = (s.a0 + s.a1) / 2;
        for (const r of [s.r1, (s.r0 + s.r1) / 2]) handles.push({ x: s.cx + r * Math.sin(mid), y: s.cy - r * Math.cos(mid) });
      } else if (s.kind === "polyline" && point === undefined && !scene.hits.some((o) => o.el.type === "series" && o.el.series === el.series && o.el.point !== undefined)) {
        for (let i = 0; i + 1 < s.points.length; i += 2 * Math.max(1, Math.floor(s.points.length / 40))) handles.push({ x: s.points[i]!, y: s.points[i + 1]! });
      }
    }
    if (handles.length) return { frames, handles };
  }
  const b = elementBounds(scene, el);
  if (b) {
    frames.push(b);
    handles.push({ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y }, { x: b.x, y: b.y + b.h }, { x: b.x + b.w, y: b.y + b.h });
  }
  return { frames, handles };
}
