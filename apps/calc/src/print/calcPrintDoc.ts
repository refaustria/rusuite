// Builds Calc's print document: the active sheet, every sheet or the
// selection, paginated per the print settings, as fixed-size HTML pages.

import type { CSSProperties } from "react";
import { EMPTY_SLOTS, escapeHtml, headerFooterHtml, paperSize, sceneToSvg, type HeaderFooterSlots, type PrintDoc } from "@rusuite/ui-shared";
import { anchorRect, rectsIntersect, type PxRect } from "../charts/anchor";
import { isWholeCols, isWholeRows, normalize, type Range } from "../grid/Selection";
import type { CalcStore } from "../state/store";
import { loadUsedRange } from "./loadUsed";
import { CALC_MARGINS, HEADING_COL_PX, HEADING_ROW_PX, colLetters, paginate, printableArea, type CalcPrintOptions, type PageSlice } from "./layout";
import { buildPrintTable, type PrintTable } from "./printTable";
import type { IconSetKind } from "../generated/IconSetKind";
import { iconGlyph } from "../grid/cf";

/** A chart to print: its box in px from the part's first printed cell, and its SVG. */
export interface PrintChart extends PxRect {
  svg: string;
}

/** One sheet (or the selection) to print. */
export interface CalcPrintPart {
  sheetName: string;
  table: PrintTable;
  /** Charts over the table (P8-20). */
  charts?: PrintChart[];
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
  const laid = parts.map((p) => ({ part: p, ...paginate(p.table.cols.map((c) => c.width), p.table.rows.map((r) => r.height), o, area) }));
  const total = laid.reduce((s, l) => s + (l.part.table.rows.length && l.part.table.cols.length ? l.pages.length : 0), 0);
  const date = ctx.date ?? new Date();
  const pages: string[] = [];
  const hf = (slots: HeaderFooterSlots, where: "header" | "footer", page: number, sheet: string) =>
    headerFooterHtml(slots ?? EMPTY_SLOTS, { page, pages: total, date, sheet, file: ctx.file }, where, where === "header" ? m.header : m.footer, m.left, m.right);
  for (const l of laid) {
    if (!l.part.table.rows.length || !l.part.table.cols.length) continue;
    for (const slice of l.pages) {
      const n = pages.length + 1;
      const zoom = l.scale === 1 ? "" : ` style="zoom:${Number(l.scale.toFixed(4))}"`;
      pages.push(
        `${hf(o.header, "header", n, l.part.sheetName)}<div class="rs-calc-body" style="top:${m.top}in;left:${m.left}in"><div${zoom}><div style="position:relative">${sliceTableHtml(l.part.table, slice, o)}${sliceChartsHtml(l.part, slice, o)}</div></div></div>${hf(o.footer, "footer", n, l.part.sheetName)}`,
      );
    }
  }
  return { widthIn: size.w, heightIn: size.h, css: CALC_PRINT_CSS, pages };
}

/** The selection range clipped to the sheet's used range (whole rows/columns would be huge). */
export function selectionRange(sel: Range, used: { lastRow: number; lastCol: number }): Range | null {
  const r = { ...sel };
  if (isWholeCols(r)) r.r1 = Math.min(r.r1, used.lastRow);
  if (isWholeRows(r)) r.c1 = Math.min(r.c1, used.lastCol);
  if (r.r1 < r.r0 || r.c1 < r.c0) return null;
  return r;
}

/** Loads what the options print from the store and builds the document. */
export async function buildCalcPrintDoc(store: CalcStore, o: CalcPrintOptions): Promise<PrintDoc> {
  const st = store.getState();
  const sheets = st.info?.sheets ?? [{ id: st.activeSheet, name: "Sheet1" }];
  const nameOf = (id: number) => sheets.find((s) => s.id === id)?.name ?? "";
  const parts: CalcPrintPart[] = [];
  const sheetPart = async (id: number) => {
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
    if (lastRow > used.lastRow || lastCol > used.lastCol) await store.ensureRegion(id, 0, 0, lastRow, lastCol);
    parts.push({ sheetName: nameOf(id), table: buildPrintTable(store.cache(id), store.styles(), lastRow, lastCol), charts });
  };
  if (o.what === "workbook") {
    // Hidden sheets are not printed (Excel).
    for (const s of sheets) if (!("hidden" in s && s.hidden)) await sheetPart(s.id);
  } else if (o.what === "selection") {
    const id = st.activeSheet;
    const used = await loadUsedRange(store, id);
    const r = selectionRange(normalize(st.selection), used);
    if (r) {
      await store.ensureRegion(id, r.r0, r.c0, r.r1, r.c1);
      // Charts intersecting the selection print with it (cut at its edges).
      const geo = store.geometry(id);
      const x0 = geo.col.offset(r.c0);
      const y0 = geo.row.offset(r.r0);
      const box = { x: x0, y: y0, w: geo.col.offset(r.c1 + 1) - x0, h: geo.row.offset(r.r1 + 1) - y0 };
      const charts = (await printCharts(store, id, { x: 0, y: 0 }))
        .filter((c) => rectsIntersect(c, box))
        .map((c) => ({ ...c, x: c.x - x0, y: c.y - y0 }));
      parts.push({ sheetName: nameOf(id), table: buildPrintTable(store.cache(id), store.styles(), r.r1, r.c1, r.r0, r.c0), charts });
    }
  } else await sheetPart(st.activeSheet);
  return calcPrintDocument(parts, o, { file: st.name ?? undefined });
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
