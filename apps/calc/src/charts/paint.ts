// Charts on the grid canvas: each chart at its anchor over the cells
// (per frozen-pane quadrant), the selected one with its frame, 8 handles
// and the selected element's marks, plus Excel's coloured outlines of the
// selected chart's data ranges.

import { drawChartScene, drawChartSelection } from "@rusuite/ui-shared";
import type { Chart } from "../generated/Chart";
import type { Viewport, RefHighlight } from "../grid/render";
import { handlePoints } from "./anchor";
import type { ChartFrame, ChartSelection } from "./controller";
import { parseRange } from "./refs";

export const CHART_FRAME = "#5f6368";

/** Paints the chart frames over one quadrant (`vp`: its scroll and size; the context is translated to the quadrant). */
export function paintCharts(ctx: CanvasRenderingContext2D, frames: ChartFrame[], vp: Viewport, sel: ChartSelection | null): void {
  for (const f of frames) {
    const x = f.rect.x - vp.scrollX;
    const y = f.rect.y - vp.scrollY;
    if (x > vp.width || y > vp.height || x + f.rect.w < -8 || y + f.rect.h < -8 || f.rect.w < 1 || f.rect.h < 1) continue;
    ctx.save();
    ctx.translate(Math.round(x), Math.round(y));
    if (f.scene) drawChartScene(ctx, f.scene);
    else {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, f.rect.w, f.rect.h);
      ctx.strokeStyle = "#d9d9d9";
      ctx.strokeRect(0.5, 0.5, f.rect.w - 1, f.rect.h - 1);
    }
    const selected = sel !== null && sel.id === f.obj.id;
    if (selected && f.scene && sel.element) drawChartSelection(ctx, f.scene, sel.element);
    if (selected) {
      ctx.strokeStyle = CHART_FRAME;
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, 0.5, Math.round(f.rect.w) - 1, Math.round(f.rect.h) - 1);
      for (const p of handlePoints({ x: 0, y: 0, w: Math.round(f.rect.w), h: Math.round(f.rect.h) })) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff";
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}

const NAME_COLOR = "#d8352a";
const CATEGORY_COLOR = "#8a3fbf";
const VALUE_COLOR = "#2a62d6";

/** Excel's outlines of a selected chart's source ranges on the sheet named `sheetName`: names red, categories purple, values blue. */
export function chartRefMarks(chart: Chart, sheetName: string): RefHighlight[] {
  const out: RefHighlight[] = [];
  const add = (formula: string | undefined, color: string) => {
    const r = formula ? parseRange(formula) : null;
    if (!r || (r.sheet !== null && r.sheet.toLowerCase() !== sheetName.toLowerCase())) return;
    if (out.some((m) => m.color === color && m.range.r0 === r.r0 && m.range.c0 === r.c0 && m.range.r1 === r.r1 && m.range.c1 === r.c1)) return;
    out.push({ range: { r0: r.r0, c0: r.c0, r1: r.r1, c1: r.c1 }, color, dashed: false });
  };
  const formula = (x: { type: string; formula?: string } | undefined) => (x?.type === "ref" ? x.formula : undefined);
  add(formula(chart.categories), CATEGORY_COLOR);
  for (const s of chart.series) {
    add(formula(s.name), NAME_COLOR);
    add(formula(s.categories), CATEGORY_COLOR);
    add(formula(s.values), VALUE_COLOR);
  }
  return out;
}
