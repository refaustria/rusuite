// Show's print layouts (pure): full-page slides, notes pages (slide +
// speaker notes) and handouts with 2, 3, 4 or 6 numbered slides per page.

import { escapeHtml, paperSize, withLabel, type PageOrientation, type PaperName, type PrintChoice, type PrintDoc } from "@rusuite/ui-shared";
import { t } from "../i18n";
import type { Slide } from "../generated/Slide";
import type { SlideSize } from "../generated/SlideSize";

export type ShowPrintLayout = "full" | "notes" | "handout2" | "handout3" | "handout4" | "handout6";

export interface ShowPrintOptions {
  /** `""` = all pages. */
  range: string;
  layout: ShowPrintLayout;
  /** `slide` = pages as big as the slide (full-page slides; A4 for the other layouts). */
  paper: PaperName | "slide";
  /** `auto`: landscape for full-page slides, portrait for notes and handouts. */
  orientation: PageOrientation | "auto";
  /** A thin frame around each slide. */
  frame: boolean;
  /** Scale the slide to fit the page (else `scale` % of the slide's size). */
  fit: boolean;
  scale: number;
  /** Print hidden slides too. */
  hidden: boolean;
}

export const DEFAULT_SHOW_PRINT: ShowPrintOptions = { range: "", layout: "full", paper: "slide", orientation: "auto", frame: false, fit: true, scale: 100, hidden: false };

export const SHOW_LAYOUT_CHOICES: PrintChoice[] = [
  withLabel({ value: "full" }, "show.print.full"),
  withLabel({ value: "notes" }, "show.print.notes"),
  withLabel({ value: "handout2" }, "show.print.handout2"),
  withLabel({ value: "handout3" }, "show.print.handout3"),
  withLabel({ value: "handout4" }, "show.print.handout4"),
  withLabel({ value: "handout6" }, "show.print.handout6"),
];

export const SHOW_PAPER_CHOICES: PrintChoice[] = [
  withLabel({ value: "slide" }, "show.print.slideSize"),
  withLabel({ value: "A4" }, "print.paper.A4"),
  withLabel({ value: "Letter" }, "print.paper.Letter"),
  withLabel({ value: "Legal" }, "print.paper.Legal"),
  withLabel({ value: "A3" }, "print.paper.A3"),
];

export const SHOW_ORIENTATION_CHOICES: PrintChoice[] = [
  withLabel({ value: "auto" }, "show.print.auto"),
  withLabel({ value: "portrait" }, "print.portrait"),
  withLabel({ value: "landscape" }, "print.landscape"),
];

const EMU_PER_IN = 914_400;

/** A box in inches. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Slides per printed page. */
export function slidesPerPage(layout: ShowPrintLayout): number {
  return layout.startsWith("handout") ? Number(layout.slice(7)) : 1;
}

/** Slides that print: hidden ones only when asked; with their 1-based number in the deck. */
export function printedSlides(slides: readonly Slide[], hidden: boolean): { slide: Slide; number: number }[] {
  return slides.map((slide, i) => ({ slide, number: i + 1 })).filter((s) => hidden || !s.slide.hidden);
}

/** The sheet size in inches. */
export function showPageSize(o: Pick<ShowPrintOptions, "paper" | "orientation" | "layout">, slide: SlideSize): { w: number; h: number } {
  if (o.paper === "slide" && o.layout === "full") return { w: slide.width / EMU_PER_IN, h: slide.height / EMU_PER_IN };
  const paper = o.paper === "slide" ? "A4" : o.paper;
  const orientation = o.orientation !== "auto" ? o.orientation : o.layout === "full" ? "landscape" : "portrait";
  return paperSize(paper, orientation);
}

/** The largest box of `aspect` (w / h) inside `box`, centred. */
export function fitRect(box: Rect, aspect: number): Rect {
  const w = Math.min(box.w, box.h * aspect);
  const h = w / aspect;
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}

/** Columns × rows of a handout grid. */
export function handoutGrid(per: number): { cols: number; rows: number } {
  switch (per) {
    case 2:
      return { cols: 1, rows: 2 };
    case 3:
      return { cols: 1, rows: 3 };
    case 4:
      return { cols: 2, rows: 2 };
    default:
      return { cols: 2, rows: 3 };
  }
}

/** Handout margin and gap between cells (inches). */
export const HANDOUT_MARGIN_IN = 0.6;
export const HANDOUT_GAP_IN = 0.35;

/**
 * The slide boxes of a handout page: a grid filled row by row (3 per
 * page: slides on the left half, note lines on the right).
 */
export function handoutSlots(per: number, page: { w: number; h: number }, aspect: number): Rect[] {
  const { cols, rows } = handoutGrid(per);
  const m = HANDOUT_MARGIN_IN;
  const g = HANDOUT_GAP_IN;
  const areaW = per === 3 ? (page.w - 2 * m - g) / 2 : page.w - 2 * m;
  const cellW = (areaW - (cols - 1) * g) / cols;
  const cellH = (page.h - 2 * m - (rows - 1) * g) / rows;
  const out: Rect[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) out.push(fitRect({ x: m + c * (cellW + g), y: m + r * (cellH + g), w: cellW, h: cellH }, aspect));
  }
  return out;
}

const n3 = (v: number) => Number(v.toFixed(3));
const box = (r: Rect) => `left:${n3(r.x)}in;top:${n3(r.y)}in;width:${n3(r.w)}in;height:${n3(r.h)}in`;

function slideImg(src: string, r: Rect, number: number, frame: boolean): string {
  return `<img class="rs-show-slide${frame ? " rs-frame" : ""}" alt="${escapeHtml(t("show.slideN", { n: number }))}" src="${escapeHtml(src)}" style="${box(r)}">`;
}

const pageNumber = (n: number) => `<div class="rs-show-pageno" style="right:0.5in;bottom:0.3in">${n}</div>`;

export const SHOW_PRINT_CSS = `.rs-show-slide { position: absolute; display: block; object-fit: fill; box-sizing: border-box; }
.rs-show-slide.rs-frame { outline: 1px solid #000; }
.rs-show-num { position: absolute; font: 10pt Calibri, Carlito, Arial, sans-serif; color: #000; text-align: right; }
.rs-show-lines { position: absolute; display: flex; flex-direction: column; justify-content: space-around; }
.rs-show-lines > div { border-bottom: 1px solid #888; height: 0; }
.rs-show-notes { position: absolute; font: 12pt/1.35 Calibri, Carlito, Arial, sans-serif; color: #000; white-space: pre-wrap; overflow: hidden; }
.rs-show-pageno { position: absolute; font: 10pt Calibri, Carlito, Arial, sans-serif; color: #000; }`;

/** Builds the pages; `images[i]` is the picture of `slides[i]` (the printed slides, see `printedSlides`). */
export function buildShowPrintDoc(slides: readonly { slide: Slide; number: number }[], images: readonly string[], size: SlideSize, o: ShowPrintOptions): PrintDoc {
  const page = showPageSize(o, size);
  const aspect = size.width / size.height;
  const slideIn = { w: size.width / EMU_PER_IN, h: size.height / EMU_PER_IN };
  const pages: string[] = [];
  if (o.layout === "full") {
    const edge = o.paper === "slide" ? 0 : 0.25;
    const area = { x: edge, y: edge, w: page.w - 2 * edge, h: page.h - 2 * edge };
    slides.forEach((s, i) => {
      const r = o.fit
        ? fitRect(area, aspect)
        : { w: (slideIn.w * o.scale) / 100, h: (slideIn.h * o.scale) / 100, x: (page.w - (slideIn.w * o.scale) / 100) / 2, y: (page.h - (slideIn.h * o.scale) / 100) / 2 };
      pages.push(slideImg(images[i] ?? "", r, s.number, o.frame));
    });
  } else if (o.layout === "notes") {
    const m = 0.75;
    slides.forEach((s, i) => {
      const r = fitRect({ x: m, y: m, w: page.w - 2 * m, h: (page.h - 2 * m) * 0.45 }, aspect);
      const top = r.y + r.h + 0.35;
      const notes = `<div class="rs-show-notes" style="${box({ x: m, y: top, w: page.w - 2 * m, h: page.h - m - top - 0.2 })}">${escapeHtml(s.slide.notes ?? "")}</div>`;
      pages.push(`${slideImg(images[i] ?? "", r, s.number, o.frame)}${notes}${pageNumber(i + 1)}`);
    });
  } else {
    const per = slidesPerPage(o.layout);
    const slots = handoutSlots(per, page, aspect);
    for (let start = 0; start < slides.length; start += per) {
      const parts: string[] = [];
      slides.slice(start, start + per).forEach((s, k) => {
        const r = slots[k]!;
        parts.push(`<div class="rs-show-num" style="left:${n3(r.x - 0.45)}in;top:${n3(r.y)}in;width:0.35in">${s.number}</div>`);
        parts.push(slideImg(images[start + k] ?? "", r, s.number, true));
        if (per === 3) {
          const lines = Array.from({ length: 8 }, () => "<div></div>").join("");
          parts.push(`<div class="rs-show-lines" style="${box({ x: page.w / 2 + HANDOUT_GAP_IN / 2, y: r.y, w: page.w / 2 - HANDOUT_GAP_IN / 2 - HANDOUT_MARGIN_IN, h: r.h })}">${lines}</div>`);
        }
      });
      parts.push(pageNumber(pages.length + 1));
      pages.push(parts.join(""));
    }
  }
  return { widthIn: page.w, heightIn: page.h, css: SHOW_PRINT_CSS, pages };
}
