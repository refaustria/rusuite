// Print/PDF of a canvas page: the surface's content bounding box, scaled to the paper's printable width (never
// enlarged), as a strip cut into pages of the shared print pipeline (ui-shared `PrintDoc`). The pages carry a copy of
// the rendered surface (text boxes as laid out, images, both ink layers) without the editing chrome.

import { escapeHtml, paperSize, type PaperName, type PrintDoc } from "@rusuite/ui-shared";
import type { Rect } from "./geometry";

const DPI = 96;
const MARGIN_IN = 0.5;
const TITLE_H = 44;

/** Content bounds of a rendered surface (px at 100 %): text blocks, images, strokes. */
export function surfaceBounds(surface: HTMLElement): Rect | null {
  const s = surface.getBoundingClientRect();
  const zoom = Number(surface.dataset.zoom) || 1;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const els = surface.querySelectorAll<Element>(".ProseMirror > *:not([style*='display: none']), [data-canvas-image], .notes-ink path");
  for (const el of Array.from(els)) {
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) continue;
    x0 = Math.min(x0, (r.left - s.left) / zoom);
    y0 = Math.min(y0, (r.top - s.top) / zoom);
    x1 = Math.max(x1, (r.right - s.left) / zoom);
    y1 = Math.max(y1, (r.bottom - s.top) / zoom);
  }
  return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** The layout of the strip on paper: scale, printable size (px) and page count. */
export function canvasPageLayout(bounds: Rect, paper: { w: number; h: number }): { scale: number; pageW: number; pageH: number; pages: number } {
  const pageW = (paper.w - 2 * MARGIN_IN) * DPI;
  const pageH = (paper.h - 2 * MARGIN_IN) * DPI;
  const scale = Math.min(1, pageW / Math.max(1, bounds.w));
  const pages = Math.max(1, Math.ceil((TITLE_H + bounds.h * scale) / pageH - 1e-6));
  return { scale, pageW, pageH, pages };
}

/** The print document of a rendered canvas surface. */
export function canvasPrintDoc(surface: HTMLElement, title: string, paperName: PaperName = "A4"): PrintDoc {
  const paper = paperSize(paperName, "portrait");
  const bounds = surfaceBounds(surface) ?? { x: 0, y: 0, w: 1, h: 1 };
  const { scale, pageH, pages } = canvasPageLayout(bounds, paper);
  const clone = surface.cloneNode(true) as HTMLElement;
  for (const el of Array.from(clone.querySelectorAll("[data-canvas-chrome], .notes-canvas-tool, .notes-canvas-band, .notes-drag-handle"))) el.remove();
  for (const el of Array.from(clone.querySelectorAll("[contenteditable]"))) el.removeAttribute("contenteditable");
  clone.removeAttribute("data-testid");
  clone.style.transform = `scale(${scale})`;
  clone.style.left = `${-bounds.x * scale}px`;
  clone.style.top = `${TITLE_H - bounds.y * scale}px`;
  clone.style.background = "none";
  const strip = `<div class="nc-print-title">${escapeHtml(title)}</div>${clone.outerHTML}`;
  const m = MARGIN_IN * DPI;
  const html: string[] = [];
  for (let k = 0; k < pages; k++) {
    html.push(`<div class="nc-print-window" style="left:${m}px;top:${m}px;height:${pageH}px;right:${m}px"><div class="nc-print-strip" style="top:${-k * pageH}px">${strip}</div></div>`);
  }
  return {
    widthIn: paper.w,
    heightIn: paper.h,
    css: `.nc-print-window { position: absolute; overflow: hidden; }
.nc-print-strip { position: absolute; left: 0; right: 0; }
.nc-print-title { height: ${TITLE_H - 12}px; font: 600 20pt Calibri, Carlito, "Segoe UI", sans-serif; border-bottom: 1px solid #ccc; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.nc-print-strip .notes-canvas-surface { background: none !important; }
.nc-print-strip .notes-ink-highlighter { mix-blend-mode: multiply; }`,
    pages: html,
  };
}
