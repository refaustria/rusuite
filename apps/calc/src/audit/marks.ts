// Error checking's green triangles (P9-C4): painted in the top-left corner
// of every flagged cell, as Excel does.

import type { ErrorIssue } from "../generated/ErrorIssue";

/** The triangle's legs in px. */
export const MARK_SIZE = 6;
const GREEN = "#1d8f3a";

/** Paints the marks; `rect` gives a cell's box in viewport pixels (`null`: not visible). */
export function paintErrorMarks(
  ctx: CanvasRenderingContext2D,
  issues: readonly ErrorIssue[],
  rect: (row: number, col: number) => { x: number; y: number; w: number; h: number } | null,
): void {
  ctx.save();
  ctx.fillStyle = GREEN;
  for (const i of issues) {
    const r = rect(i.row, i.col);
    if (!r) continue;
    ctx.beginPath();
    ctx.moveTo(r.x + 1, r.y + 1);
    ctx.lineTo(r.x + 1 + MARK_SIZE, r.y + 1);
    ctx.lineTo(r.x + 1, r.y + 1 + MARK_SIZE);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}
