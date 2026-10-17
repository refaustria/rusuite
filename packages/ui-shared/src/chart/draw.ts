// Canvas painter of a ChartScene (not unit-tested: jsdom has no canvas).

import { selectionMarks } from "./hit";
import type { ChartElement, ChartScene, SceneItem } from "./scene";

export const CHART_FONT = "Calibri, Carlito, 'Liberation Sans', Arial, sans-serif";

/** A text item's CSS font family list (its own font first). */
export const fontFamily = (font: string | undefined) => (font ? `'${font.replace(/'/g, "")}', ${CHART_FONT}` : CHART_FONT);

// Picture fills: decoded images by data URL; a host redraws when one arrives.
const images = new Map<string, HTMLImageElement>();
let imageListener: (() => void) | null = null;
/** Called when a picture fill finished loading (the host repaints). */
export function setChartImageListener(fn: (() => void) | null): void {
  imageListener = fn;
}
function imageOf(src: string): HTMLImageElement | null {
  let img = images.get(src);
  if (!img) {
    if (typeof Image === "undefined") return null;
    img = new Image();
    img.onload = () => imageListener?.();
    img.src = src;
    images.set(src, img);
  }
  return img.complete && img.naturalWidth > 0 ? img : null;
}

function paintFill(ctx: CanvasRenderingContext2D, it: Extract<SceneItem, { t: "rect" | "path" }>): string | CanvasGradient | null {
  const g = it.gradient;
  if (g && typeof ctx.createLinearGradient === "function") {
    const grad = g.radial ? ctx.createRadialGradient(g.x0, g.y0, 0, g.x0, g.y0, g.r ?? 1) : ctx.createLinearGradient(g.x0, g.y0, g.x1, g.y1);
    for (const st of g.stops) grad.addColorStop(Math.min(1, Math.max(0, st.pos)), st.color);
    return grad;
  }
  return it.fill ?? null;
}

function shapePath(it: Extract<SceneItem, { t: "rect" }>): Path2D {
  const p = new Path2D();
  const r = Math.min(it.radius ?? 0, it.w / 2, it.h / 2);
  if (r > 0) {
    p.moveTo(it.x + r, it.y);
    p.arcTo(it.x + it.w, it.y, it.x + it.w, it.y + it.h, r);
    p.arcTo(it.x + it.w, it.y + it.h, it.x, it.y + it.h, r);
    p.arcTo(it.x, it.y + it.h, it.x, it.y, r);
    p.arcTo(it.x, it.y, it.x + it.w, it.y, r);
    p.closePath();
  } else p.rect(it.x, it.y, it.w, it.h);
  return p;
}

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
    case "rect": {
      const fancy = it.gradient || it.image || it.shadow || it.radius;
      if (!fancy) {
        if (it.fill) {
          ctx.fillStyle = it.fill;
          ctx.fillRect(it.x, it.y, it.w, it.h);
        }
        if (applyStroke(ctx, it)) ctx.strokeRect(it.x, it.y, it.w, it.h);
        break;
      }
      const p = shapePath(it);
      const fill = paintFill(ctx, it);
      ctx.save();
      if (it.shadow) {
        ctx.shadowColor = "rgba(0,0,0,0.4)";
        ctx.shadowBlur = 4;
        ctx.shadowOffsetX = 2;
        ctx.shadowOffsetY = 2;
      }
      if (fill || it.shadow) {
        ctx.fillStyle = fill ?? "#FFFFFF";
        ctx.fill(p);
      }
      ctx.restore();
      if (it.image) {
        const img = imageOf(it.image);
        if (img) {
          ctx.save();
          ctx.clip(p);
          if (it.tile) {
            const pattern = ctx.createPattern(img, "repeat");
            if (pattern) {
              ctx.fillStyle = pattern;
              ctx.fillRect(it.x, it.y, it.w, it.h);
            }
          } else ctx.drawImage(img, it.x, it.y, it.w, it.h);
          ctx.restore();
        }
      }
      if (applyStroke(ctx, it)) ctx.stroke(p);
      break;
    }
    case "path": {
      const p = new Path2D(it.d);
      const fill = paintFill(ctx, it);
      if (fill) {
        ctx.fillStyle = fill;
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
      ctx.font = `${it.italic ? "italic " : ""}${it.bold ? "bold " : ""}${it.size}px ${fontFamily(it.font)}`;
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
