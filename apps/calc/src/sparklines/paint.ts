// Sparklines on the grid canvas: each sparkline drawn in its location cell
// (clipped to it), with the group's shared axis range where it has one.

import type { SparklineGroupView } from "../generated/SparklineGroupView";
import { groupRange, paintSparkOps, sparklineOps } from "./render";

/** Paints the sparklines of the visible cells (`rectOf`: a cell's canvas rectangle, `null` when off screen). */
export function paintSparklines(
  ctx: CanvasRenderingContext2D,
  views: readonly SparklineGroupView[],
  rectOf: (row: number, col: number) => { x: number; y: number; w: number; h: number } | null,
  vis: { r0: number; c0: number; r1: number; c1: number },
): void {
  for (const v of views) {
    const g = v.group;
    const shared = g.minAxis?.type === "group" || g.maxAxis?.type === "group" ? groupRange(v.data, g) : null;
    g.sparklines.forEach((s, i) => {
      if (s.row < vis.r0 || s.row > vis.r1 || s.col < vis.c0 || s.col > vis.c1) return;
      const r = rectOf(s.row, s.col);
      const data = v.data[i];
      if (!r || !data || r.w < 4 || r.h < 4) return;
      ctx.save();
      ctx.beginPath();
      ctx.rect(r.x, r.y, r.w, r.h);
      ctx.clip();
      paintSparkOps(ctx, sparklineOps(g, data, r, {}, shared));
      ctx.restore();
    });
  }
}
