// Adjust handles (Word's yellow dots) of the presets: where a handle sits
// for the current adjust values and which values a drag to a point gives.
// Positions are in the shape's own box (EMU, unflipped, unrotated),
// following the presets' `a:ahXY` of ECMA-376 — the same table Show's
// shape editor uses (apps/show/src/shapes/handles.ts).

/** One coordinate driven by an adjust value: `coord = base + k · value`, value clamped to `min..max`. */
export interface AxisDef {
  adj: string;
  base: number;
  k: number;
  min: number;
  max: number;
}

/** A handle: each coordinate is fixed or driven by an adjust value. */
export interface HandleDef {
  x: AxisDef | number;
  y: AxisDef | number;
}

const ax = (adj: string, base: number, k: number, min: number, max: number): AxisDef => ({ adj, base, k, min, max });

/** The adjust handles of a preset in a `w` × `h` box (none for presets without adjust values). */
export function handlesOf(p: string, w: number, h: number): HandleDef[] {
  const ss = Math.max(1, Math.min(w, h));
  const s = ss / 100000;
  const maxW = (f: number) => Math.round((f * w) / ss);
  const maxH = (f: number) => Math.round((f * h) / ss);
  switch (p) {
    case "roundRect":
      return [{ x: ax("adj", 0, s, 0, 50000), y: 0 }];
    case "snip1Rect":
    case "round1Rect":
      return [{ x: ax("adj", w, -s, 0, 50000), y: 0 }];
    case "snip2SameRect":
    case "round2SameRect":
      return [
        { x: ax("adj1", w, -s, 0, 50000), y: 0 },
        { x: ax("adj2", 0, s, 0, 50000), y: h },
      ];
    case "triangle":
      return [{ x: ax("adj", 0, w / 100000, 0, 100000), y: 0 }];
    case "parallelogram":
      return [{ x: ax("adj", 0, s, 0, maxW(100000)), y: 0 }];
    case "trapezoid":
    case "hexagon":
      return [{ x: ax("adj", 0, s, 0, maxW(50000)), y: 0 }];
    case "octagon":
      return [{ x: ax("adj", 0, s, 0, 50000), y: 0 }];
    case "chevron":
    case "homePlate":
      return [{ x: ax("adj", w, -s, 0, maxW(100000)), y: 0 }];
    case "rightArrow":
      return [
        { x: 0, y: ax("adj1", h / 2, -h / 200000, 0, 100000) },
        { x: ax("adj2", w, -s, 0, maxW(100000)), y: 0 },
      ];
    case "leftArrow":
      return [
        { x: w, y: ax("adj1", h / 2, -h / 200000, 0, 100000) },
        { x: ax("adj2", 0, s, 0, maxW(100000)), y: 0 },
      ];
    case "upArrow":
      return [
        { x: ax("adj1", w / 2, -w / 200000, 0, 100000), y: h },
        { x: 0, y: ax("adj2", 0, s, 0, maxH(100000)) },
      ];
    case "downArrow":
      return [
        { x: ax("adj1", w / 2, -w / 200000, 0, 100000), y: 0 },
        { x: 0, y: ax("adj2", h, -s, 0, maxH(100000)) },
      ];
    case "leftRightArrow":
      return [
        { x: w / 2, y: ax("adj1", h / 2, -h / 200000, 0, 100000) },
        { x: ax("adj2", 0, s, 0, maxW(50000)), y: 0 },
      ];
    case "upDownArrow":
      return [
        { x: ax("adj1", w / 2, -w / 200000, 0, 100000), y: h / 2 },
        { x: 0, y: ax("adj2", 0, s, 0, maxH(50000)) },
      ];
    case "star4":
    case "star5":
    case "star6":
    case "star8":
      return [{ x: w / 2, y: ax("adj", h / 2, -h / 100000, 0, 50000) }];
    case "wedgeRectCallout":
    case "wedgeEllipseCallout":
      return [{ x: ax("adj1", w / 2, w / 100000, -1000000, 1000000), y: ax("adj2", h / 2, h / 100000, -1000000, 1000000) }];
    case "wedgeRoundRectCallout":
      return [
        { x: ax("adj1", w / 2, w / 100000, -1000000, 1000000), y: ax("adj2", h / 2, h / 100000, -1000000, 1000000) },
        { x: ax("adj3", 0, s, 0, 50000), y: 0 },
      ];
    default:
      return [];
  }
}

/** The adjust values in effect: the preset's defaults (from the core) overridden by the shape's own. */
export function effectiveAdjust(defaults: Record<string, number>, own: Record<string, number> | undefined): Record<string, number> {
  return { ...defaults, ...(own ?? {}) };
}

const coord = (a: AxisDef | number, adjust: Record<string, number>) => (typeof a === "number" ? a : a.base + a.k * (adjust[a.adj] ?? 0));

/** Where a handle sits (box EMU) for `adjust` (effective values). */
export function handlePos(h: HandleDef, adjust: Record<string, number>): { x: number; y: number } {
  return { x: coord(h.x, adjust), y: coord(h.y, adjust) };
}

const valueAt = (a: AxisDef, c: number) => {
  const v = a.k === 0 ? 0 : (c - a.base) / a.k;
  return Math.round(Math.min(a.max, Math.max(a.min, v)));
};

/** The adjust values a drag of handle `h` to the box point `p` sets (only the handle's own names). */
export function dragHandle(h: HandleDef, p: { x: number; y: number }): Record<string, number> {
  const out: Record<string, number> = {};
  if (typeof h.x !== "number") out[h.x.adj] = valueAt(h.x, p.x);
  if (typeof h.y !== "number") out[h.y.adj] = valueAt(h.y, p.y);
  return out;
}
