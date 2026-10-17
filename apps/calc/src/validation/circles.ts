// Data › Data Validation › Circle Invalid Data: the red ellipses around
// invalid cells (pure geometry; the canvas painter is not unit-tested).

import type { Rect } from "../generated/Rect";

/** Excel's validation circle colour. */
export const CIRCLE_COLOR = "#FF0000";

/** The ellipse around a cell rect: a little wider and taller than the cell, as Excel draws it. */
export function circleBox(r: { x: number; y: number; w: number; h: number }): { cx: number; cy: number; rx: number; ry: number } {
  return { cx: r.x + r.w / 2, cy: r.y + r.h / 2, rx: r.w / 2 + 4, ry: r.h / 2 + 3 };
}

/** Paints the circles of `cells` (rects from the grid's geometry; `null`: not visible). */
export function paintValidationCircles(
  ctx: CanvasRenderingContext2D,
  cells: readonly Rect[],
  rect: (row: number, col: number) => { x: number; y: number; w: number; h: number } | null,
): void {
  ctx.save();
  ctx.strokeStyle = CIRCLE_COLOR;
  ctx.lineWidth = 1.5;
  for (const c of cells) {
    const r = rect(c.r0, c.c0);
    if (!r) continue;
    const e = circleBox(r);
    ctx.beginPath();
    ctx.ellipse(e.cx, e.cy, e.rx, e.ry, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}
