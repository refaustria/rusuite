// Canvas painter of a ChartScene (not unit-tested: jsdom has no canvas).

import { selectionMarks } from "./hit";
import type { ChartElement, ChartScene, SceneItem } from "./scene";

export const CHART_FONT = "Calibri, Carlito, 'Liberation Sans', Arial, sans-serif";

function applyStroke(ctx: CanvasRenderingContext2D, it: { stroke?: string; lineWidth?: number; dash?: number[] }): boolean {
  if (!it.stroke) return false;
  ctx.strokeStyle = it.stroke;
  ctx.lineWidth = it.lineWidth ?? 1;
  ctx.setLineDash(it.dash ?? []);
  return true;
}

function drawItem(ctx: CanvasRenderingContext2D, it: SceneItem): void {
  if (it.clip) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(it.clip.x, it.clip.y, it.clip.w, it.clip.h);
    ctx.clip();
  }
  switch (it.t) {
    case "rect":
      if (it.fill) {
        ctx.fillStyle = it.fill;
        ctx.fillRect(it.x, it.y, it.w, it.h);
      }
      if (applyStroke(ctx, it)) ctx.strokeRect(it.x, it.y, it.w, it.h);
      break;
    case "path": {
      const p = new Path2D(it.d);
      if (it.fill) {
        ctx.fillStyle = it.fill;
        ctx.fill(p, "evenodd");
      }
      if (applyStroke(ctx, it)) {
        ctx.lineJoin = it.join ?? "miter";
        ctx.lineCap = it.cap ?? "butt";
        ctx.stroke(p);
      }
      break;
    }
    case "text": {
      ctx.save();
      ctx.font = `${it.bold ? "bold " : ""}${it.size}px ${CHART_FONT}`;
      ctx.fillStyle = it.color;
      ctx.textAlign = it.align;
      ctx.textBaseline = it.baseline;
      ctx.translate(it.x, it.y);
      if (it.rotate) ctx.rotate((it.rotate * Math.PI) / 180);
      ctx.fillText(it.text, 0, 0);
      ctx.restore();
      break;
    }
  }
  ctx.setLineDash([]);
  if (it.clip) ctx.restore();
}

/** Paints `scene` with its top-left corner at the context's origin. */
export function drawChartScene(ctx: CanvasRenderingContext2D, scene: ChartScene): void {
  ctx.save();
  for (const it of scene.items) drawItem(ctx, it);
  ctx.restore();
}

/** Paints the selection marks of element `el` (frame and handle squares) over a drawn scene. */
export function drawChartSelection(ctx: CanvasRenderingContext2D, scene: ChartScene, el: ChartElement, color = "#217346"): void {
  const { frames, handles } = selectionMarks(scene, el);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  for (const f of frames) ctx.strokeRect(Math.round(f.x) + 0.5, Math.round(f.y) + 0.5, Math.round(f.w), Math.round(f.h));
  ctx.fillStyle = "#FFFFFF";
  for (const h of handles) {
    ctx.fillRect(h.x - 2.5, h.y - 2.5, 5, 5);
    ctx.strokeRect(h.x - 2.5, h.y - 2.5, 5, 5);
  }
  ctx.restore();
}
