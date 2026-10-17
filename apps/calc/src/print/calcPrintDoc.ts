// Builds Calc's print document: the active sheet, every sheet or the
// selection, paginated per the print settings, as fixed-size HTML pages.

import type { CSSProperties } from "react";
import { EMPTY_SLOTS, escapeHtml, headerFooterHtml, paperSize, sceneToSvg, type HeaderFooterSlots, type PrintDoc } from "@rusuite/ui-shared";
import { anchorRect, rectsIntersect, type PxRect } from "../charts/anchor";
import { isWholeCols, isWholeRows, normalize, type Range } from "../grid/Selection";
import type { CalcStore } from "../state/store";
import { loadUsedRange } from "./loadUsed";
import { CALC_MARGINS, HEADING_COL_PX, HEADING_ROW_PX, colLetters, paginate, printableArea, type CalcPrintOptions, type PageSlice, type PrintTitlesSpec } from "./layout";
import { parseRange } from "../charts/refs";
import { lettersToCol } from "../formula/refs";
import { buildPrintTable, type PrintLook, type PrintTable } from "./printTable";
import type { IconSetKind } from "../generated/IconSetKind";
import type { NameInfo } from "../generated/NameInfo";
import { iconGlyph } from "../grid/cf";
import { cellAddress } from "../grid/address";
import { noteBoxRect, runsText } from "../comments/model";
import { runsToHtml } from "../comments/richText";
import { t } from "../i18n";
import { groupRange, sparkOpsSvg, sparklineOps } from "../sparklines/render";

/** A chart to print: its box in px from the part's first printed cell, and its SVG. */
export interface PrintChart extends PxRect {
  svg: string;
}

/** A note or comment printed at the end of its sheet (Page Setup › Comments: At end of sheet). */
export interface PrintAnnotation {
  /** `A2`. */
  cell: string;
  kind: "note" | "comment";
  author: string;
  text: string;
  replies?: { author: string; text: string }[];
}

/** One sheet (or the selection) to print. */
export interface CalcPrintPart {
  sheetName: string;
  table: PrintTable;
  /** Charts over the table (P8-20) and, with Comments "As displayed on sheet", the visible notes (`svg` holds their HTML). */
  charts?: PrintChart[];
  /** Notes and comments listed on pages after the sheet. */
  annotations?: PrintAnnotation[];
  /** Manual page breaks: indices into the table's rows / columns that start a page. */
  breaks?: { rows: number[]; cols: number[] };
  /** Print titles (table indices): repeated on the pages after them. */
  titles?: PrintTitlesSpec;
  /** A chart sheet: one page with its chart (SVG at the printable area's size), no table. */
  chartPage?: string;
}

/** Inline CSS text of React style properties (`fontWeight` → `font-weight`; numbers as px). */
export function styleText(css: CSSProperties): string {
  return Object.entries(css)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}:${typeof v === "number" ? `${v}px` : String(v)}`)
    .join(";")
    .replace(/"/g, "'");
}

export const CALC_PRINT_CSS = `.rs-calc-body { position: absolute; }
.rs-calc-note { box-sizing: border-box; width: 100%; height: 100%; overflow: hidden; white-space: pre-wrap; background: #ffffe1; border: 1px solid #767676; padding: 1px 3px; font: 9pt Tahoma, Verdana, sans-serif; color: #000; }
.rs-calc-annots { font: 10pt Calibri, Carlito, Arial, sans-serif; color: #000; border-collapse: collapse; width: 100%; }
.rs-calc-annots td { vertical-align: top; padding: 2px 4px; border-bottom: 1px solid #ddd; white-space: pre-wrap; }
.rs-calc-table { border-collapse: collapse; table-layout: fixed; font: 11pt Calibri, Carlito, Arial, sans-serif; color: #000; }
.rs-calc-table td { overflow: hidden; white-space: nowrap; padding: 0 3px; box-sizing: border-box; line-height: 1.1; }
.rs-calc-table.rs-grid td { border: 1px solid #c8c8c8; }
.rs-calc-table th { overflow: hidden; white-space: nowrap; padding: 0 2px; background: #efefef; border: 1px solid #a6a6a6; font: 8pt Arial, sans-serif; color: #333; text-align: center; }`;

/** A conditional-formatting icon as inline SVG (the canvas glyph), floated left of the cell text. */
export function iconHtml(set: IconSetKind, index: number): string {
  const glyph = iconGlyph(set, index);
  if (!glyph) return "";
  const paths = glyph
    .map((p) => `<path d="${p.d}" fill="${p.fill}" fill-rule="evenodd"${p.stroke ? ` stroke="${p.stroke}"` : ""}/>`)
    .join("");
  return `<svg class="rs-cf-icon" width="14" height="14" viewBox="0 0 16 16" style="float:left;margin-top:1px">${paths}</svg>`;
}

/** The table rows of a slice: repeated rows first, then the page's own. */
export function sliceRows(slice: PageSlice): number[] {
  const range = (a: number, b: number) => Array.from({ length: Math.max(0, b - a) }, (_, i) => a + i);
  const titles = slice.titleRows ? range(slice.titleRows[0], slice.titleRows[1]) : range(0, slice.repeat);
  return [...titles, ...range(slice.rows[0], slice.rows[1])];
}

/** The table columns of a slice: repeated title columns first, then the page's own. */
export function sliceCols(slice: PageSlice): number[] {
  const range = (a: number, b: number) => Array.from({ length: Math.max(0, b - a) }, (_, i) => a + i);
  return [...(slice.titleCols ? range(slice.titleCols[0], slice.titleCols[1]) : []), ...range(slice.cols[0], slice.cols[1])];
}

/** The `<table>` of one page slice. */
export function sliceTableHtml(table: PrintTable, slice: PageSlice, o: Pick<CalcPrintOptions, "gridlines" | "headings">): string {
  const colIdx = sliceCols(slice);
  const cols = colIdx.map((i) => table.cols[i]!);
  const width = cols.reduce((s, c) => s + c.width, 0) + (o.headings ? HEADING_COL_PX : 0);
  const colgroup = `${o.headings ? `<col style="width:${HEADING_COL_PX}px">` : ""}${cols.map((c) => `<col style="width:${c.width}px">`).join("")}`;
  const head = o.headings ? `<tr style="height:${HEADING_ROW_PX}px"><th></th>${cols.map((c) => `<th>${colLetters(c.col)}</th>`).join("")}</tr>` : "";
  const rowIdx = sliceRows(slice);
  // Merged cells: colspan/rowspan cut to the page; covered cells whose
  // top-left cell is on another page print as empty cells.
  const taken = new Set<string>();
  const body = rowIdx
    .map((ri, p) => {
      const r = table.rows[ri]!;
      const cells = colIdx
        .map((ci, k) => {
          const c = r.cells[ci];
          if (!c) return "<td></td>";
          if (c.covered) return taken.has(`${p}:${k}`) ? "" : "<td></td>";
          let attrs = "";
          if (c.span) {
            let cols = 1;
            while (cols < c.span.cols && colIdx[k + cols] === ci + cols) cols++;
            let rows = 1;
            while (rows < c.span.rows && rowIdx[p + rows] === ri + rows) rows++;
            for (let dr = 0; dr < rows; dr++) for (let dc = 0; dc < cols; dc++) if (dr || dc) taken.add(`${p + dr}:${k + dc}`);
            attrs = `${cols > 1 ? ` colspan="${cols}"` : ""}${rows > 1 ? ` rowspan="${rows}"` : ""}`;
          }
          // Rotated text turns around the cell centre and stays inside the cell (as on the canvas).
          const text = c.rotation
            ? `<span class="rs-rot" style="display:inline-block;white-space:nowrap;transform:rotate(${-c.rotation}deg)">${escapeHtml(c.text)}</span>`
            : escapeHtml(c.text);
          return `<td${attrs} style="${styleText(c.style)}${c.rotation ? ";overflow:hidden" : ""}">${c.icon ? iconHtml(c.icon.set, c.icon.index) : ""}${text}</td>`;
        })
        .join("");
      return `<tr style="height:${r.height}px" data-row="${r.row}">${o.headings ? `<th>${r.row + 1}</th>` : ""}${cells}</tr>`;
    })
    .join("");
  return `<table class="rs-calc-table${o.gridlines ? " rs-grid" : ""}" style="width:${width}px"><colgroup>${colgroup}</colgroup>${head}${body}</table>`;
}

/** The charts of one page: absolutely placed SVGs over the slice's table, cut at the page's cell area. */
export function sliceChartsHtml(part: CalcPrintPart, slice: PageSlice, o: Pick<CalcPrintOptions, "headings">): string {
  const charts = part.charts ?? [];
  if (!charts.length) return "";
  const { table } = part;
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const colX0 = sum(table.cols.slice(0, slice.cols[0]).map((c) => c.width));
  const rowY0 = sum(table.rows.slice(0, slice.rows[0]).map((r) => r.height));
  const w = sum(table.cols.slice(slice.cols[0], slice.cols[1]).map((c) => c.width));
  const h = sum(table.rows.slice(slice.rows[0], slice.rows[1]).map((r) => r.height));
  const titleRows = slice.titleRows ?? [0, slice.repeat];
  const repeatH = sum(table.rows.slice(titleRows[0], titleRows[1]).map((r) => r.height));
  const repeatW = slice.titleCols ? sum(table.cols.slice(slice.titleCols[0], slice.titleCols[1]).map((c) => c.width)) : 0;
  const area = { x: colX0, y: rowY0, w, h };
  const shown = charts.filter((c) => rectsIntersect(c, area));
  if (!shown.length) return "";
  const left = (o.headings ? HEADING_COL_PX : 0) + repeatW;
  const top = (o.headings ? HEADING_ROW_PX : 0) + repeatH;
  const body = shown
    .map((c) => `<div class="rs-calc-chart" style="position:absolute;left:${c.x - colX0}px;top:${c.y - rowY0}px;width:${c.w}px;height:${c.h}px">${c.svg}</div>`)
    .join("");
  return `<div class="rs-calc-charts" style="position:absolute;left:${left}px;top:${top}px;width:${w}px;height:${h}px;overflow:hidden">${body}</div>`;
}

/**
 * The pages of all parts: each part paginated on its own (a sheet starts
 * a new page), `&P`/`&N` counted over the whole printout.
 */
export function calcPrintDocument(parts: CalcPrintPart[], o: CalcPrintOptions, ctx: { date?: Date; file?: string } = {}): PrintDoc {
  const size = paperSize(o.paper, o.orientation);
  const m = CALC_MARGINS[o.margins];
  const area = printableArea(o);
  const laid = parts.map((p) => ({ part: p, ...paginate(p.table.cols.map((c) => c.width), p.table.rows.map((r) => r.height), o, area, p.breaks, p.titles) }));
  const total = laid.reduce((s, l) => s + (l.part.chartPage ? 1 : l.part.table.rows.length && l.part.table.cols.length ? l.pages.length : 0), 0);
  const date = ctx.date ?? new Date();
  const pages: string[] = [];
  // Pages of annotation lists after their sheet (counted into &N).
  const lists = laid.map((l) => annotationPages(l.part.annotations ?? [], area.height));
  const allPages = total + lists.reduce((sum, p) => sum + p.length, 0);
  const hf = (slots: HeaderFooterSlots, where: "header" | "footer", page: number, sheet: string) =>
    headerFooterHtml(slots ?? EMPTY_SLOTS, { page, pages: allPages, date, sheet, file: ctx.file }, where, where === "header" ? m.header : m.footer, m.left, m.right);
  const body = (inner: string) => `<div class="rs-calc-body" style="top:${m.top}in;left:${m.left}in;width:${area.width}px">${inner}</div>`;
  laid.forEach((l, i) => {
    if (l.part.chartPage) {
      const n = pages.length + 1;
      pages.push(`${hf(o.header, "header", n, l.part.sheetName)}${body(`<div class="rs-calc-chartsheet" style="width:${area.width}px;height:${area.height}px">${l.part.chartPage}</div>`)}${hf(o.footer, "footer", n, l.part.sheetName)}`);
    } else if (l.part.table.rows.length && l.part.table.cols.length) {
      for (const slice of l.pages) {
        const n = pages.length + 1;
        const zoom = l.scale === 1 ? "" : ` style="zoom:${Number(l.scale.toFixed(4))}"`;
        pages.push(
          `${hf(o.header, "header", n, l.part.sheetName)}<div class="rs-calc-body" style="top:${m.top}in;left:${m.left}in"><div${zoom}><div style="position:relative">${sliceTableHtml(l.part.table, slice, o)}${sliceChartsHtml(l.part, slice, o)}</div></div></div>${hf(o.footer, "footer", n, l.part.sheetName)}`,
        );
      }
    }
    for (const list of lists[i]!) {
      const n = pages.length + 1;
      pages.push(`${hf(o.header, "header", n, l.part.sheetName)}${body(list)}${hf(o.footer, "footer", n, l.part.sheetName)}`);
    }
  });

  return { widthIn: size.w, heightIn: size.h, css: CALC_PRINT_CSS, pages };
}

/** Line height of the annotation list (px). */
const ANNOT_LINE_PX = 16;

/** The annotation list of a sheet split into page bodies (Excel: "Cell: A2  Note: …"). */
export function annotationPages(list: readonly PrintAnnotation[], heightPx: number): string[] {
  if (!list.length) return [];
  const perPage = Math.max(1, Math.floor(heightPx / ANNOT_LINE_PX) - 1);
  const lines = (a: PrintAnnotation) => 1 + a.text.split("\n").length + (a.replies ?? []).reduce((s, r) => s + r.text.split("\n").length, 0);
  const pages: string[] = [];
  let rows: string[] = [];
  let used = 0;
  for (const a of list) {
    const n = lines(a);
    if (used > 0 && used + n > perPage) {
      pages.push(rows.join(""));
      rows = [];
      used = 0;
    }
    const label = a.kind === "note" ? t("calc.print.noteLabel") : t("calc.print.commentLabel");
    const replies = (a.replies ?? []).map((r) => `<div>${escapeHtml(r.author)}: ${escapeHtml(r.text)}</div>`).join("");
    rows.push(`<tr data-annotation="${escapeHtml(a.cell)}"><td style="width:5em"><b>${escapeHtml(a.cell)}</b></td><td><div>${escapeHtml(label)} · <b>${escapeHtml(a.author)}</b></div><div>${escapeHtml(a.text)}</div>${replies}</td></tr>`);
    used += n;
  }
  if (rows.length) pages.push(rows.join(""));
  return pages.map((r) => `<table class="rs-calc-annots">${r}</table>`);
}

/** The selection range clipped to the sheet's used range (whole rows/columns would be huge). */
export function selectionRange(sel: Range, used: { lastRow: number; lastCol: number }): Range | null {
  const r = { ...sel };
  if (isWholeCols(r)) r.r1 = Math.min(r.r1, used.lastRow);
  if (isWholeRows(r)) r.c1 = Math.min(r.c1, used.lastCol);
  if (r.r1 < r.r0 || r.c1 < r.c0) return null;
  return r;
}

/** The pivot table and table looks of a sheet for print (the grid's looks). */
export function printLooks(store: CalcStore, sheet: number): PrintLook {
  const pivot = store.pivots.looks(sheet);
  const table = store.tables.looks(sheet);
  return (cell, row, col) => (cell?.pivot ? pivot?.(cell, row, col) : table?.(row, col));
}

/** The sheet's manual page breaks as indices into the printed rows / columns. */
export function tableBreaks(store: CalcStore, sheet: number, table: PrintTable): { rows: number[]; cols: number[] } {
  const info = store.getState().info?.sheets.find((s) => s.id === sheet);
  const idx = <T extends { row?: number; col?: number }>(list: readonly T[], key: "row" | "col", breaks: readonly number[]) =>
    breaks.map((b) => list.findIndex((x) => (x[key] ?? -1) >= b)).filter((i) => i > 0);
  return { rows: idx(table.rows, "row", info?.rowBreaks ?? []), cols: idx(table.cols, "col", info?.colBreaks ?? []) };
}

/** A sheet's Page Layout names: every print area and the print titles (sheet rows / columns, inclusive). */
export interface SheetPrintNames {
  /** `Print_Area` (several areas print one after the other). */
  areas: Range[];
  /** `Print_Titles`: rows repeated at the top, columns repeated at the left. */
  rows: [number, number] | null;
  cols: [number, number] | null;
}

/**
 * Reads a sheet's `Print_Area` (a union of areas: `$A$1:$C$9,$E$1:$F$4`)
 * and `Print_Titles` (`$1:$2` rows and / or `$A:$B` columns).
 */
export function sheetPrintNames(names: readonly NameInfo[], sheet: number): SheetPrintNames {
  const own = (b: string) => names.find((n) => n.builtin === b && n.sheet === sheet);
  const parts = (text: string | undefined) => (text ?? "").split(",").map((p) => p.trim().replace(/^=/, "")).filter(Boolean);
  const areas: Range[] = [];
  for (const part of parts(own("printArea")?.refersTo)) {
    const r = parseRange(part);
    if (r) areas.push({ r0: r.r0, c0: r.c0, r1: r.r1, c1: r.c1 });
  }
  let rows: [number, number] | null = null;
  let cols: [number, number] | null = null;
  for (const part of parts(own("printTitles")?.refersTo)) {
    const body = part.replace(/^.*!/, "");
    const mr = /^\$?(\d+):\$?(\d+)$/.exec(body);
    if (mr) rows = [Number(mr[1]) - 1, Number(mr[2]) - 1];
    const mc = /^\$?([A-Za-z]{1,3}):\$?([A-Za-z]{1,3})$/.exec(body);
    if (mc) {
      const a = lettersToCol(mc[1]!.toUpperCase());
      const b = lettersToCol(mc[2]!.toUpperCase());
      if (a !== null && b !== null) cols = [Math.min(a, b), Math.max(a, b)];
    }
  }
  return { areas, rows, cols };
}

/** The table index range of the sheet lines `lines` (inclusive) in `list` (`undefined`: none printed). */
function indexRange<T>(list: readonly T[], key: (x: T) => number, lines: [number, number] | null): [number, number] | undefined {
  if (!lines) return undefined;
  const idx = list.map((x, i) => [key(x), i] as const).filter(([v]) => v >= lines[0] && v <= lines[1]).map(([, i]) => i);
  return idx.length ? [idx[0]!, idx[idx.length - 1]! + 1] : undefined;
}

/** The table without the rows / columns `keepRow` / `keepCol` reject (title lines outside a print area). */
export function filterTable(table: PrintTable, keepRow: (row: number) => boolean, keepCol: (col: number) => boolean): PrintTable {
  const colIdx = table.cols.map((c, i) => (keepCol(c.col) ? i : -1)).filter((i) => i >= 0);
  const cols = colIdx.map((i) => table.cols[i]!);
  const rows = table.rows.filter((r) => keepRow(r.row)).map((r) => ({ ...r, cells: colIdx.map((i) => r.cells[i]!).filter(Boolean) }));
  return { cols, rows, width: cols.reduce((a, c) => a + c.width, 0), height: rows.reduce((a, r) => a + r.height, 0) };
}

/** Loads what the options print from the store and builds the document. */
export async function buildCalcPrintDoc(store: CalcStore, o: CalcPrintOptions): Promise<PrintDoc> {
  const st = store.getState();
  const printNames = (id: number) => sheetPrintNames(st.info?.names ?? [], id);
  const sheets = st.info?.sheets ?? [{ id: st.activeSheet, name: "Sheet1" }];
  const nameOf = (id: number) => sheets.find((s) => s.id === id)?.name ?? "";
  const parts: CalcPrintPart[] = [];
  /** A range with the sheet's print titles (title lines above / left of it are printed with it). */
  const rangePart = async (id: number, r: Range, titles: SheetPrintNames | null) => {
    const up = titles?.rows && titles.rows[0] < r.r0 ? titles.rows : null;
    const left = titles?.cols && titles.cols[0] < r.c0 ? titles.cols : null;
    const box0 = { r0: up ? up[0] : r.r0, c0: left ? left[0] : r.c0 };
    await store.ensureRegion(id, box0.r0, box0.c0, r.r1, r.c1);
    // Charts intersecting the range print with it (cut at its edges).
    const geo = store.geometry(id);
    const x0 = geo.col.offset(r.c0);
    const y0 = geo.row.offset(r.r0);
    const box = { x: x0, y: y0, w: geo.col.offset(r.c1 + 1) - x0, h: geo.row.offset(r.r1 + 1) - y0 };
    let table = buildPrintTable(store.cache(id), store.styles(), r.r1, r.c1, box0.r0, box0.c0, printLooks(store, id));
    const inRows = (row: number) => (row >= r.r0 && row <= r.r1) || (!!up && row >= up[0] && row <= Math.min(up[1], r.r0 - 1));
    const inCols = (col: number) => (col >= r.c0 && col <= r.c1) || (!!left && col >= left[0] && col <= Math.min(left[1], r.c0 - 1));
    if (up || left) table = filterTable(table, inRows, inCols);
    // Title lines printed before the range shift the charts.
    const before = <T,>(list: readonly T[], key: (x: T) => number, size: (x: T) => number, at: number) => list.filter((x) => key(x) < at).reduce((a, x) => a + size(x), 0);
    const dy = before(table.rows, (x) => x.row, (x) => x.height, r.r0);
    const dx = before(table.cols, (x) => x.col, (x) => x.width, r.c0);
    const charts = (await printCharts(store, id, { x: 0, y: 0 }))
      .filter((c) => rectsIntersect(c, box))
      .map((c) => ({ ...c, x: c.x - x0 + dx, y: c.y - y0 + dy }));
    const spec: PrintTitlesSpec = titles ? { rows: indexRange(table.rows, (x) => x.row, titles.rows), cols: indexRange(table.cols, (x) => x.col, titles.cols) } : {};
    parts.push({ sheetName: nameOf(id), table, charts, breaks: tableBreaks(store, id, table), titles: spec });
  };
  const sheetPart = async (id: number) => {
    if (store.isChartSheet(id)) {
      // A chart sheet prints its chart as one page, scaled to the printable area (Excel).
      const area = printableArea(o);
      const list = await store.charts.ensureList(id);
      const obj = list[0];
      if (!obj) return;
      if (!store.charts.dataOf(id, obj)) await store.charts.fetchData(id, obj);
      const scene = store.charts.scene(id, obj, Math.round(area.width), Math.round(area.height));
      if (scene) parts.push({ sheetName: nameOf(id), table: { cols: [], rows: [], width: 0, height: 0 }, chartPage: sceneToSvg(scene) });
      return;
    }
    const names = printNames(id);
    // Page Layout › Print Area: each area on its own pages.
    if (names.areas.length) {
      for (const area of names.areas) await rangePart(id, area, names);
      return;
    }
    const used = await loadUsedRange(store, id);
    const charts = await printCharts(store, id);
    // The printed area reaches the charts' bottom-right cells.
    const geo = store.geometry(id);
    let { lastRow, lastCol } = used;
    for (const c of charts) {
      lastRow = Math.max(lastRow, geo.row.indexAt(c.y + c.h - 1));
      lastCol = Math.max(lastCol, geo.col.indexAt(c.x + c.w - 1));
    }
    if (lastRow < 0 || lastCol < 0) return;
    const annots = await printAnnotations(store, id, o);
    for (const n of annots.boxes) {
      lastRow = Math.max(lastRow, geo.row.indexAt(n.y + n.h - 1));
      lastCol = Math.max(lastCol, geo.col.indexAt(n.x + n.w - 1));
    }
    if (lastRow > used.lastRow || lastCol > used.lastCol) await store.ensureRegion(id, 0, 0, lastRow, lastCol);
    const table = buildPrintTable(store.cache(id), store.styles(), lastRow, lastCol, 0, 0, printLooks(store, id));
    const titles: PrintTitlesSpec = { rows: indexRange(table.rows, (x) => x.row, names.rows), cols: indexRange(table.cols, (x) => x.col, names.cols) };
    parts.push({ sheetName: nameOf(id), table, charts: [...charts, ...annots.boxes], annotations: annots.list, breaks: tableBreaks(store, id, table), titles });
  };
  if (o.what === "workbook") {
    // Hidden sheets are not printed (Excel).
    for (const s of sheets) if (!("hidden" in s && s.hidden)) await sheetPart(s.id);
  } else if (o.what === "selection") {
    const id = st.activeSheet;
    const used = await loadUsedRange(store, id);
    const r = selectionRange(normalize(st.selection), used);
    if (r) await rangePart(id, r, null);
  } else await sheetPart(st.activeSheet);
  return calcPrintDocument(parts, o, { file: st.name ?? undefined });
}

/** The notes and comments to print for a sheet: visible note boxes (As displayed) or the list (At end of sheet). */
export async function printAnnotations(store: CalcStore, sheet: number, o: Pick<CalcPrintOptions, "comments">): Promise<{ boxes: PrintChart[]; list: PrintAnnotation[] }> {
  const mode = o.comments ?? "none";
  if (mode === "none") return { boxes: [], list: [] };
  await store.comments.ensure(sheet);
  const { notes, threads } = store.comments.of(sheet);
  if (mode === "asDisplayed") {
    const geo = store.geometry(sheet);
    const shown = notes.filter((n) => n.visible || store.comments.showAllNotes);
    return {
      boxes: shown.map((n) => {
        const r = noteBoxRect(n, geo.col, geo.row);
        return { ...r, svg: `<div class="rs-calc-note" data-note="${cellAddress(n.row, n.col)}">${runsToHtml(n.text)}</div>` };
      }),
      list: [],
    };
  }
  const list: PrintAnnotation[] = [
    ...notes.map((n) => ({ row: n.row, col: n.col, a: { cell: cellAddress(n.row, n.col), kind: "note" as const, author: n.author ?? "", text: runsText(n.text) } })),
    ...threads.map((th) => ({
      row: th.row, col: th.col,
      a: { cell: cellAddress(th.row, th.col), kind: "comment" as const, author: th.author.name, text: th.text, replies: (th.replies ?? []).map((r) => ({ author: r.author.name, text: r.text })) },
    })),
  ]
    .sort((x, y) => x.row - y.row || x.col - y.col)
    .map((x) => x.a);
  return { boxes: [], list };
}

/** The charts of a sheet as print SVGs, in sheet px (`origin`: subtracted). */
export async function printCharts(store: CalcStore, sheet: number, origin = { x: 0, y: 0 }): Promise<PrintChart[]> {
  const list = await store.charts.ensureList(sheet);
  const geo = store.geometry(sheet);
  const out: PrintChart[] = [];
  for (const obj of list) {
    const r = anchorRect(obj.anchor, geo.col, geo.row);
    if (r.w < 1 || r.h < 1) continue;
    if (!store.charts.dataOf(sheet, obj)) await store.charts.fetchData(sheet, obj);
    const scene = store.charts.scene(sheet, obj, Math.round(r.w), Math.round(r.h));
    if (scene) out.push({ x: r.x - origin.x, y: r.y - origin.y, w: Math.round(r.w), h: Math.round(r.h), svg: sceneToSvg(scene) });
  }
  // Sparklines print inside their cells like small charts (P9-C6).
  for (const v of await store.sparklines.ensure(sheet)) {
    const shared = v.group.minAxis?.type === "group" || v.group.maxAxis?.type === "group" ? groupRange(v.data, v.group) : null;
    v.group.sparklines.forEach((sp, i) => {
      const data = v.data[i];
      const x = geo.col.offset(sp.col);
      const y = geo.row.offset(sp.row);
      const w = geo.col.offset(sp.col + 1) - x;
      const h = geo.row.offset(sp.row + 1) - y;
      if (!data || w < 4 || h < 4) return;
      const ops = sparklineOps(v.group, data, { x: 0, y: 0, w, h }, {}, shared);
      out.push({ x: x - origin.x, y: y - origin.y, w, h, svg: sparkOpsSvg(ops, w, h) });
    });
  }
  return out;
}
