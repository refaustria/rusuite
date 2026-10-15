// Calc's print settings and the pagination math (pure): scale, page
// rows × page columns ("down, then over", as Excel), repeated header rows,
// row/column headings.

import { colName } from "../grid/address";
import "../i18n";
import { EMPTY_SLOTS, paperSize, withLabel, type HeaderFooterSlots, type PageOrientation, type PaperName, type PrintChoice, type PrintMargins } from "@rusuite/ui-shared";

export type CalcPrintWhat = "active" | "workbook" | "selection";
export type CalcScaleMode = "actual" | "fitSheet" | "fitColumns" | "fitRows" | "custom";
export type CalcMarginPreset = "normal" | "narrow" | "wide";

export interface CalcPrintOptions {
  what: CalcPrintWhat;
  /** `""` = all pages. */
  range: string;
  orientation: PageOrientation;
  paper: PaperName;
  margins: CalcMarginPreset;
  scale: CalcScaleMode;
  /** Custom scale in percent (10–400). */
  percent: number;
  gridlines: boolean;
  /** Row numbers and column letters. */
  headings: boolean;
  /** The first `repeatRows` printed rows repeat at the top of every page. */
  repeatRows: number;
  header: HeaderFooterSlots;
  footer: HeaderFooterSlots;
}

export const DEFAULT_CALC_PRINT: CalcPrintOptions = {
  what: "active",
  range: "",
  orientation: "portrait",
  paper: "A4",
  margins: "normal",
  scale: "actual",
  percent: 100,
  gridlines: false,
  headings: false,
  repeatRows: 0,
  header: EMPTY_SLOTS,
  footer: EMPTY_SLOTS,
};

/** Excel's margin presets (inches). */
export const CALC_MARGINS: Record<CalcMarginPreset, PrintMargins> = {
  normal: { top: 0.75, right: 0.7, bottom: 0.75, left: 0.7, header: 0.3, footer: 0.3 },
  narrow: { top: 0.75, right: 0.25, bottom: 0.75, left: 0.25, header: 0.3, footer: 0.3 },
  wide: { top: 1, right: 1, bottom: 1, left: 1, header: 0.5, footer: 0.5 },
};

export const CALC_WHAT_CHOICES: PrintChoice[] = [
  withLabel({ value: "active" }, "calc.print.active"),
  withLabel({ value: "workbook" }, "calc.print.workbook"),
  withLabel({ value: "selection" }, "calc.print.selection"),
];

export const CALC_SCALE_CHOICES: PrintChoice[] = [
  withLabel({ value: "actual" }, "calc.print.noScaling"),
  withLabel({ value: "fitSheet" }, "calc.print.fitSheet"),
  withLabel({ value: "fitColumns" }, "calc.print.fitColumns"),
  withLabel({ value: "fitRows" }, "calc.print.fitRows"),
  withLabel({ value: "custom" }, "calc.print.customScale"),
];

export const CALC_MARGIN_CHOICES: PrintChoice[] = [
  withLabel({ value: "normal" }, "calc.print.margins.normal"),
  withLabel({ value: "narrow" }, "calc.print.margins.narrow"),
  withLabel({ value: "wide" }, "calc.print.margins.wide"),
];

/** Height of the column-letter heading row and width of the row-number column (CSS px, unscaled). */
export const HEADING_ROW_PX = 20;
export const HEADING_COL_PX = 40;

/** Printable area (inside the margins) in CSS px. */
export function printableArea(o: Pick<CalcPrintOptions, "paper" | "orientation" | "margins">): { width: number; height: number } {
  const s = paperSize(o.paper, o.orientation);
  const m = CALC_MARGINS[o.margins];
  return { width: (s.w - m.left - m.right) * 96, height: (s.h - m.top - m.bottom) * 96 };
}

/**
 * The print scale for content of `contentW × contentH` px (headings
 * included) on a printable area of `availW × availH` px. Fit modes only
 * shrink (as Excel); the result is at least 10 %.
 */
export function calcScale(o: Pick<CalcPrintOptions, "scale" | "percent">, contentW: number, contentH: number, availW: number, availH: number): number {
  const fitW = contentW > 0 ? availW / contentW : 1;
  const fitH = contentH > 0 ? availH / contentH : 1;
  let s: number;
  switch (o.scale) {
    case "custom":
      s = o.percent / 100;
      break;
    case "fitSheet":
      s = Math.min(1, fitW, fitH);
      break;
    case "fitColumns":
      s = Math.min(1, fitW);
      break;
    case "fitRows":
      s = Math.min(1, fitH);
      break;
    default:
      s = 1;
  }
  return Math.max(0.1, Math.min(4, s));
}

/**
 * Splits consecutive sizes into runs whose sums fit `first` (the first
 * run) or `rest` (every later one); an item larger than the space gets a
 * run of its own. Returns `[start, end)` index pairs.
 */
export function splitRuns(sizes: readonly number[], first: number, rest: number = first): [number, number][] {
  const out: [number, number][] = [];
  let start = 0;
  let sum = 0;
  const eps = 0.01;
  for (let i = 0; i < sizes.length; i++) {
    const avail = out.length === 0 ? first : rest;
    if (i > start && sum + sizes[i]! > avail + eps) {
      out.push([start, i]);
      start = i;
      sum = 0;
    }
    sum += sizes[i]!;
  }
  if (sizes.length > 0) out.push([start, sizes.length]);
  return out;
}

/** One printed page: table rows `[r0, r1)` and columns `[c0, c1)`, plus the repeated header rows `[0, repeat)` when not on the page anyway. */
export interface PageSlice {
  rows: [number, number];
  cols: [number, number];
  /** Number of leading table rows repeated above `rows` (0 on the first page row). */
  repeat: number;
}

export interface CalcPagination {
  scale: number;
  pages: PageSlice[];
}

/**
 * Paginates a table of `colWidths × rowHeights` (unscaled px) onto pages
 * of `area` px: scale per the options, column runs (page columns) and row
 * runs (page rows), ordered down, then over.
 */
export function paginate(colWidths: readonly number[], rowHeights: readonly number[], o: Pick<CalcPrintOptions, "scale" | "percent" | "headings" | "repeatRows">, area: { width: number; height: number }): CalcPagination {
  const headW = o.headings ? HEADING_COL_PX : 0;
  const headH = o.headings ? HEADING_ROW_PX : 0;
  const totalW = colWidths.reduce((a, b) => a + b, 0) + headW;
  const totalH = rowHeights.reduce((a, b) => a + b, 0) + headH;
  const scale = calcScale(o, totalW + 2, totalH + 2, area.width, area.height);
  // Unscaled space; 2 px of slack for collapsed borders.
  const w = area.width / scale - headW - 2;
  const h = area.height / scale - headH - 2;
  const repeat = Math.max(0, Math.min(o.repeatRows, rowHeights.length));
  const repeatH = rowHeights.slice(0, repeat).reduce((a, b) => a + b, 0);
  const colRuns = colWidths.length ? splitRuns(colWidths, w) : [[0, 0] as [number, number]];
  const rowRuns = rowHeights.length ? splitRuns(rowHeights, h, repeatH < h ? h - repeatH : h) : [[0, 0] as [number, number]];
  const pages: PageSlice[] = [];
  for (const cols of colRuns) {
    for (const rows of rowRuns) pages.push({ rows, cols, repeat: rows[0] >= repeat && repeatH < h ? repeat : 0 });
  }
  return { scale, pages };
}

/** Column letters of a 0-based index (`0` → `A`, `26` → `AA`). */
export const colLetters = colName;
