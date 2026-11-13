// Committed ink: one SVG layer per kind (highlighter strokes under the text, pen strokes over it), one filled path
// per stroke (its outline, `geometry.strokeOutline`). Outlines and hit-test data are cached per stroke; panning is
// native scrolling of a composited layer and zoom a CSS scale, so neither re-renders the paths.

import { memo } from "react";
import type { InkStroke } from "../generated/InkStroke";
import { boundsOf, decodeStroke, PX_PER_INK, strokeOutline, type InkPoint, type Rect } from "./geometry";

export interface StrokeGeom {
  d: string;
  pts: InkPoint[];
  /** Bounds including the stroke's width (surface px). */
  bbox: Rect;
  widthPx: number;
}

const cache = new Map<string, { key: string; g: StrokeGeom }>();

/** Outline and points of a stored stroke (cached; recomputed when its points or width change). */
export function strokeGeom(s: InkStroke): StrokeGeom {
  const p = s.points;
  const key = `${s.tool}|${s.width}|${p.length}|${p[0]}|${p[1]}|${p[p.length - 3]}|${p[p.length - 2]}`;
  const hit = cache.get(s.id);
  if (hit && hit.key === key) return hit.g;
  const pts = decodeStroke(p);
  const widthPx = Math.max(0.5, s.width * PX_PER_INK);
  const g: StrokeGeom = { d: strokeOutline(pts, widthPx, s.tool !== "highlighter"), pts, bbox: boundsOf(pts, widthPx), widthPx };
  cache.set(s.id, { key, g });
  if (cache.size > 20000) cache.clear();
  return g;
}

const StrokePath = memo(function StrokePath({ id, d, color }: { id: string; d: string; color: string }) {
  return <path data-id={id} data-testid="ink-stroke" d={d} fill={color} />;
});

export function InkLayer({
  strokes,
  kind,
  width,
  height,
  hidden,
  moving,
  dx,
  dy,
}: {
  strokes: readonly InkStroke[];
  kind: "pen" | "highlighter";
  width: number;
  height: number;
  /** Strokes not drawn (being erased). */
  hidden: ReadonlySet<string>;
  /** Strokes drawn offset by (dx, dy) (being moved). */
  moving: ReadonlySet<string>;
  dx: number;
  dy: number;
}) {
  const still: InkStroke[] = [];
  const moved: InkStroke[] = [];
  for (const s of strokes) {
    if (hidden.has(s.id)) continue;
    (moving.has(s.id) ? moved : still).push(s);
  }
  return (
    <svg
      className={`notes-ink notes-ink-${kind}`}
      data-testid={`ink-layer-${kind}`}
      width={width}
      height={height}
      aria-hidden="true"
      style={{ position: "absolute", left: 0, top: 0, overflow: "visible", pointerEvents: "none", zIndex: kind === "pen" ? 1000 : 1 }}
    >
      <g opacity={kind === "highlighter" ? 0.45 : undefined}>
        {still.map((s) => (
          <StrokePath key={s.id} id={s.id} d={strokeGeom(s).d} color={s.color} />
        ))}
        {moved.length > 0 && (
          <g transform={`translate(${dx} ${dy})`}>
            {moved.map((s) => (
              <StrokePath key={s.id} id={s.id} d={strokeGeom(s).d} color={s.color} />
            ))}
          </g>
        )}
      </g>
    </svg>
  );
}
