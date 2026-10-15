// Builds Calc's print document: the active sheet, every sheet or the
// selection, paginated per the print settings, as fixed-size HTML pages.

import type { CSSProperties } from "react";
import { EMPTY_SLOTS, escapeHtml, headerFooterHtml, paperSize, type HeaderFooterSlots, type PrintDoc } from "@rusuite/ui-shared";
import { isWholeCols, isWholeRows, normalize, type Range } from "../grid/Selection";
import type { CalcStore } from "../state/store";
import { loadUsedRange } from "./loadUsed";
import { CALC_MARGINS, HEADING_COL_PX, HEADING_ROW_PX, colLetters, paginate, printableArea, type CalcPrintOptions, type PageSlice } from "./layout";
import { buildPrintTable, type PrintTable } from "./printTable";

/** One sheet (or the selection) to print. */
export interface CalcPrintPart {
  sheetName: string;
  table: PrintTable;
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

/** The `<table>` of one page slice. */
export function sliceTableHtml(table: PrintTable, slice: PageSlice, o: Pick<CalcPrintOptions, "gridlines" | "headings">): string {
  const cols = table.cols.slice(slice.cols[0], slice.cols[1]);
  const width = cols.reduce((s, c) => s + c.width, 0) + (o.headings ? HEADING_COL_PX : 0);
  const colgroup = `${o.headings ? `<col style="width:${HEADING_COL_PX}px">` : ""}${cols.map((c) => `<col style="width:${c.width}px">`).join("")}`;
  const head = o.headings ? `<tr style="height:${HEADING_ROW_PX}px"><th></th>${cols.map((c) => `<th>${colLetters(c.col)}</th>`).join("")}</tr>` : "";
  const rowIdx = [...Array.from({ length: slice.repeat }, (_, i) => i), ...Array.from({ length: slice.rows[1] - slice.rows[0] }, (_, i) => slice.rows[0] + i)];
  const body = rowIdx
    .map((ri) => {
      const r = table.rows[ri]!;
      const cells = r.cells
        .slice(slice.cols[0], slice.cols[1])
        .map((c) => `<td style="${styleText(c.style)}">${escapeHtml(c.text)}</td>`)
        .join("");
      return `<tr style="height:${r.height}px" data-row="${r.row}">${o.headings ? `<th>${r.row + 1}</th>` : ""}${cells}</tr>`;
    })
    .join("");
  return `<table class="rs-calc-table${o.gridlines ? " rs-grid" : ""}" style="width:${width}px"><colgroup>${colgroup}</colgroup>${head}${body}</table>`;
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
        `${hf(o.header, "header", n, l.part.sheetName)}<div class="rs-calc-body" style="top:${m.top}in;left:${m.left}in"><div${zoom}>${sliceTableHtml(l.part.table, slice, o)}</div></div>${hf(o.footer, "footer", n, l.part.sheetName)}`,
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
    const { lastRow, lastCol } = await loadUsedRange(store, id);
    if (lastRow < 0 || lastCol < 0) return;
    parts.push({ sheetName: nameOf(id), table: buildPrintTable(store.cache(id), store.styles(), lastRow, lastCol) });
  };
  if (o.what === "workbook") {
    for (const s of sheets) await sheetPart(s.id);
  } else if (o.what === "selection") {
    const id = st.activeSheet;
    const used = await loadUsedRange(store, id);
    const r = selectionRange(normalize(st.selection), used);
    if (r) {
      await store.ensureRegion(id, r.r0, r.c0, r.r1, r.c1);
      parts.push({ sheetName: nameOf(id), table: buildPrintTable(store.cache(id), store.styles(), r.r1, r.c1, r.r0, r.c0) });
    }
  } else await sheetPart(st.activeSheet);
  return calcPrintDocument(parts, o, { file: st.name ?? undefined });
}
