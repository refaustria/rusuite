// Print setup of Calc: paper, orientation, fit-to-width and the `@page` CSS.

import { PAPER_IN, pageRule, type PageOrientation, type PaperName } from "@rusuite/ui-shared";

export interface PrintSetup {
  paper: PaperName;
  /** `auto`: landscape when the table is wider than tall. */
  orientation: PageOrientation | "auto";
  /** Shrinks a wider-than-page table to the page width (CSS zoom). */
  fitToWidth: boolean;
}

export const DEFAULT_PRINT_SETUP: PrintSetup = { paper: "A4", orientation: "auto", fitToWidth: true };

/** Page margin in inches. */
export const PAGE_MARGIN_IN = 0.5;

/** The effective orientation for a table of `width × height` px. */
export function resolveOrientation(setup: PrintSetup, width: number, height: number): PageOrientation {
  if (setup.orientation !== "auto") return setup.orientation;
  return width > height ? "landscape" : "portrait";
}

/** `@page { size: A4 landscape; margin: 0.5in; }` */
export function calcPageCss(setup: PrintSetup, orientation: PageOrientation): string {
  return pageRule(orientation === "landscape" ? `${setup.paper} landscape` : setup.paper, `${PAGE_MARGIN_IN}in`);
}

/** Printable page width in CSS px. */
export function printableWidthPx(setup: PrintSetup, orientation: PageOrientation): number {
  const p = PAPER_IN[setup.paper];
  return ((orientation === "landscape" ? p.h : p.w) - 2 * PAGE_MARGIN_IN) * 96;
}

/** CSS zoom of the table: shrinks to the page width when `fitToWidth`, never enlarges. */
export function fitZoom(setup: PrintSetup, orientation: PageOrientation, tableWidth: number): number {
  if (!setup.fitToWidth || tableWidth <= 0) return 1;
  return Math.min(1, printableWidthPx(setup, orientation) / tableWidth);
}

/** Global rules: during printing only the print overlay is shown. */
export const CALC_PRINT_RULES = `@media print {
  html, body { height: auto !important; overflow: visible !important; background: #fff !important; }
  #root { display: none !important; }
  .print-overlay { position: static !important; overflow: visible !important; padding: 0 !important; }
  .print-overlay .print-bar { display: none !important; }
}`;
