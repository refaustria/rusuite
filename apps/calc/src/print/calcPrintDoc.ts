// Builds Calc's print document: the active sheet, every sheet or the
// selection, paginated per the print settings, as fixed-size HTML pages.

import type { CSSProperties } from "react";
import { EMPTY_SLOTS, escapeHtml, headerFooterHtml, paperSize, sceneToSvg, type HeaderFooterSlots, type PrintDoc } from "@rusuite/ui-shared";
import { anchorRect, rectsIntersect, type PxRect } from "../charts/anchor";
import { isWholeCols, isWholeRows, normalize, type Range } from "../grid/Selection";
import type { CalcStore } from "../state/store";
import { loadUsedRange } from "./loadUsed";
import { CALC_MARGINS, HEADING_COL_PX, HEADING_ROW_PX, colLetters, paginate, printableArea, type CalcPrintOptions, type PageSlice } from "./layout";
import { buildPrintTable, type PrintLook, type PrintTable } from "./printTable";
import type { IconSetKind } from "../generated/IconSetKind";
import type { NameInfo } from "../generated/NameInfo";
import { iconGlyph } from "../grid/cf";
import { cellAddress } from "../grid/address";
import { noteBoxRect, runsText } from "../comments/model";
import { runsToHtml } from "../comments/richText";
import { t } from "../i18n";

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

/** The `<table>` of one page slice. */
export function sliceTableHtml(table: PrintTable, slice: PageSlice, o: Pick<CalcPrintOptions, "gridlines" | "headings">): string {
  const cols = table.cols.slice(slice.cols[0], slice.cols[1]);
  const width = cols.reduce((s, c) => s + c.width, 0) + (o.headings ? HEADING_COL_PX : 0);
  const colgroup = `${o.headings ? `<col style="width:${HEADING_COL_PX}px">` : ""}${cols.map((c) => `<col style="width:${c.width}px">`).join("")}`;
  const head = o.headings ? `<tr style="height:${HEADING_ROW_PX}px"><th></th>${cols.map((c) => `<th>${colLetters(c.col)}</th>`).join("")}</tr>` : "";
  const rowIdx = [...Array.from({ length: slice.repeat }, (_, i) => i), ...Array.from({ length: slice.rows[1] - slice.rows[0] }, (_, i) => slice.rows[0] + i)];
  // Merged cells: colspan/rowspan cut to the page; covered cells whose
  // top-left cell is on another page print as empty cells.
  const taken = new Set<string>();
  const body = rowIdx
    .map((ri, p) => {
      const r = table.rows[ri]!;
      const cells = r.cells
        .slice(slice.cols[0], slice.cols[1])
        .map((c, k) => {
          const ci = slice.cols[0] + k;
          if (c.covered) return taken.has(`${p}:${ci}`) ? "" : "<td></td>";
          let attrs = "";
          if (c.span) {
            const cols = Math.min(c.span.cols, slice.cols[1] - ci);
            let rows = 1;
            while (rows < c.span.rows && rowIdx[p + rows] === ri + rows) rows++;
            for (let dr = 0; dr < rows; dr++) for (let dc = 0; dc < cols; dc++) if (dr || dc) taken.add(`${p + dr}:${ci + dc}`);
            attrs = `${cols > 1 ? ` colspan="${cols}"` : ""}${rows > 1 ? ` rowspan="${rows}"` : ""}`;
          }
          return `<td${attrs} style="${styleText(c.style)}">${c.icon ? iconHtml(c.icon.set, c.icon.index) : ""}${escapeHtml(c.text)}</td>`;
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
  const repeatH = sum(table.rows.slice(0, slice.repeat).map((r) => r.height));
  const area = { x: colX0, y: rowY0, w, h };
  const shown = charts.filter((c) => rectsIntersect(c, area));
  if (!shown.length) return "";
  const left = o.headings ? HEADING_COL_PX : 0;
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
  const laid = parts.map((p) => ({ part: p, ...paginate(p.table.cols.map((c) => c.width), p.table.rows.map((r) => r.height), o, area, p.breaks) }));
  const total = laid.reduce((s, l) => s + (l.part.table.rows.length && l.part.table.cols.length ? l.pages.length : 0), 0);
  const date = ctx.date ?? new Date();
  const pages: string[] = [];
  // Pages of annotation lists after their sheet (counted into &N).
  const lists = laid.map((l) => annotationPages(l.part.annotations ?? [], area.height));
  const allPages = total + lists.reduce((sum, p) => sum + p.length, 0);
  const hf = (slots: HeaderFooterSlots, where: "header" | "footer", page: number, sheet: string) =>
    headerFooterHtml(slots ?? EMPTY_SLOTS, { page, pages: allPages, date, sheet, file: ctx.file }, where, where === "header" ? m.header : m.footer, m.left, m.right);
  const body = (inner: string) => `<div class="rs-calc-body" style="top:${m.top}in;left:${m.left}in;width:${area.width}px">${inner}</div>`;
  laid.forEach((l, i) => {
    if (l.part.table.rows.length && l.part.table.cols.length) {
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

/** Loads what the options print from the store and builds the document. */
/**
 * A sheet's Page Layout names (P8-35): the print area (`Print_Area`, a
 * single area) and the number of rows repeated at the top
 * (`Print_Titles` rows `$1:$k`; titles further down are not supported by
 * the layout and ignored).
 */
export function sheetPrintNames(names: readonly NameInfo[], sheet: number): { area: Range | null; titleRows: number } {
  const own = (b: string) => names.find((n) => n.builtin === b && n.sheet === sheet);
  const a = own("printArea")?.range;
  const area = a && a.sheet === sheet ? { r0: a.r0, c0: a.c0, r1: a.r1, c1: a.c1 } : null;
  let titleRows = 0;
  for (const part of (own("printTitles")?.refersTo ?? "").split(",")) {
    const m = /(?:^|!)\$?(\d+):\$?(\d+)$/.exec(part.trim());
    if (m && Number(m[1]) === 1) titleRows = Number(m[2]);
  }
  return { area, titleRows };
}

export async function buildCalcPrintDoc(store: CalcStore, o: CalcPrintOptions): Promise<PrintDoc> {
  const st = store.getState();
  const printNames = (id: number) => sheetPrintNames(st.info?.names ?? [], id);
  const sheets = st.info?.sheets ?? [{ id: st.activeSheet, name: "Sheet1" }];
  const nameOf = (id: number) => sheets.find((s) => s.id === id)?.name ?? "";
  const parts: CalcPrintPart[] = [];
  const rangePart = async (id: number, r: Range) => {
    await store.ensureRegion(id, r.r0, r.c0, r.r1, r.c1);
    // Charts intersecting the range print with it (cut at its edges).
    const geo = store.geometry(id);
    const x0 = geo.col.offset(r.c0);
    const y0 = geo.row.offset(r.r0);
    const box = { x: x0, y: y0, w: geo.col.offset(r.c1 + 1) - x0, h: geo.row.offset(r.r1 + 1) - y0 };
    const charts = (await printCharts(store, id, { x: 0, y: 0 }))
      .filter((c) => rectsIntersect(c, box))
      .map((c) => ({ ...c, x: c.x - x0, y: c.y - y0 }));
    const table = buildPrintTable(store.cache(id), store.styles(), r.r1, r.c1, r.r0, r.c0, printLooks(store, id));
    parts.push({ sheetName: nameOf(id), table, charts, breaks: tableBreaks(store, id, table) });
  };
  const sheetPart = async (id: number) => {
    // Page Layout › Print Area.
    const area = printNames(id).area;
    if (area) return rangePart(id, area);
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
    parts.push({ sheetName: nameOf(id), table, charts: [...charts, ...annots.boxes], annotations: annots.list, breaks: tableBreaks(store, id, table) });
  };
  if (o.what === "workbook") {
    // Hidden sheets are not printed (Excel).
    for (const s of sheets) if (!("hidden" in s && s.hidden)) await sheetPart(s.id);
  } else if (o.what === "selection") {
    const id = st.activeSheet;
    const used = await loadUsedRange(store, id);
    const r = selectionRange(normalize(st.selection), used);
    if (r) await rangePart(id, r);
  } else await sheetPart(st.activeSheet);
  // Print Titles: rows repeated at the top (the active sheet's, when printing it alone from row 1).
  const titles = o.what === "workbook" ? 0 : printNames(st.activeSheet);
  const repeat = typeof titles === "number" || (titles.area && titles.area.r0 > 0) ? 0 : titles.titleRows;
  return calcPrintDocument(parts, o.repeatRows || o.what === "selection" ? o : { ...o, repeatRows: repeat }, { file: st.name ?? undefined });
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
  return out;
}
