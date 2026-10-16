// The buttons the grid draws on pivot tables (P8-33): the −/+ buttons in
// front of item labels with inner items (expand / collapse) and the
// dropdown buttons on the `Row Labels` / `Column Labels` headers, the field
// headers (outline and tabular form) and the page field cells. Layout and
// hit-testing are pure (sheet coordinates); painting is canvas code.

import type { CellView } from "../generated/CellView";
import type { AxisGeometry } from "../grid/geometry";
import { INDENT_PX } from "../grid/render";

/** Side of a −/+ button, px. */
export const EXPAND_SIZE = 9;
/** Side of a dropdown button, px (as the AutoFilter's). */
export const DROP_SIZE = 16;
const SLOP = 2;

/** What a dropdown button filters. */
export type DropTarget =
  /** The compact `Row Labels` / `Column Labels` header: the axis' fields (a field chooser in the panel). */
  | { kind: "axis"; axis: "rows" | "cols" }
  /** A field header (outline / tabular form). */
  | { kind: "field"; field: number }
  /** A page field's selection cell. */
  | { kind: "page"; field: number };

export type PivotButton =
  | { kind: "expand"; id: number; row: number; col: number; field: number; item: number; collapsed: boolean; x: number; y: number; size: number }
  | { kind: "drop"; id: number; row: number; col: number; target: DropTarget; filtered: boolean; x: number; y: number; size: number };

/** The dropdown target of a pivot cell (`null`: none). */
export function dropTarget(cell: CellView): DropTarget | null {
  const p = cell.pivot;
  if (!p) return null;
  if (p.kind === "page" && p.field !== undefined) return { kind: "page", field: p.field };
  if (p.kind !== "header") return null;
  if (p.field !== undefined) return { kind: "field", field: p.field };
  if (cell.display === "Row Labels") return { kind: "axis", axis: "rows" };
  if (cell.display === "Column Labels") return { kind: "axis", axis: "cols" };
  return null;
}

export interface ButtonOptions {
  /** Analyze › +/- Buttons. */
  expand: boolean;
  /** Analyze › Field Headers (dropdowns on the headers). */
  headers: boolean;
  /** The indent level of a cell (its style's `alignment.indent`). */
  indentOf: (cell: CellView) => number;
  /** Whether a dropdown's field(s) are filtered (a funnel instead of ▾). */
  filtered: (id: number, target: DropTarget) => boolean;
  /** Whether a header cell lies inside its table (page field names do not get a dropdown). */
  inTable: (id: number, row: number, col: number) => boolean;
}

/** The buttons of the pivot cells among `cells` (sheet coordinates). */
export function pivotButtons(cells: Iterable<CellView>, colGeo: AxisGeometry, rowGeo: AxisGeometry, o: ButtonOptions): PivotButton[] {
  const out: PivotButton[] = [];
  for (const cell of cells) {
    const p = cell.pivot;
    if (!p) continue;
    const w = colGeo.size(cell.col), h = rowGeo.size(cell.row);
    if (w === 0 || h === 0) continue;
    const x0 = colGeo.offset(cell.col), y0 = rowGeo.offset(cell.row);
    if (o.expand && p.collapsed !== undefined && p.field !== undefined && p.item !== undefined && (p.kind === "rowLabel" || p.kind === "colLabel")) {
      const size = Math.min(EXPAND_SIZE, h - 4);
      if (size >= 5) {
        const indent = o.indentOf(cell) * INDENT_PX;
        out.push({ kind: "expand", id: p.id, row: cell.row, col: cell.col, field: p.field, item: p.item, collapsed: p.collapsed, x: x0 + 2 + indent, y: y0 + (h - size) / 2, size });
      }
    }
    const target = dropTarget(cell);
    if (target && (target.kind === "page" || (o.headers && o.inTable(p.id, cell.row, cell.col)))) {
      const size = Math.min(DROP_SIZE, w - 2, h - 2);
      if (size >= 6) out.push({ kind: "drop", id: p.id, row: cell.row, col: cell.col, target, filtered: o.filtered(p.id, target), x: x0 + w - size - 1, y: y0 + h - size - 1, size });
    }
  }
  return out;
}

/** The button containing the sheet point `(x, y)` (a small slop around it), else `null`. */
export function buttonAt(buttons: readonly PivotButton[], x: number, y: number): PivotButton | null {
  for (const b of buttons) {
    if (x >= b.x - SLOP && x <= b.x + b.size + SLOP && y >= b.y - SLOP && y <= b.y + b.size + SLOP) return b;
  }
  return null;
}

/** Paints the buttons (scrolled by `scrollX/Y`). */
export function drawPivotButtons(ctx: CanvasRenderingContext2D, buttons: readonly PivotButton[], scrollX: number, scrollY: number): void {
  for (const b of buttons) {
    const x = Math.round(b.x - scrollX) + 0.5, y = Math.round(b.y - scrollY) + 0.5, s = b.size;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(x, y, s, s);
    ctx.lineWidth = 1;
    if (b.kind === "expand") {
      ctx.strokeStyle = "#7f7f7f";
      ctx.strokeRect(x, y, s - 1, s - 1);
      ctx.strokeStyle = "#222222";
      ctx.beginPath();
      const cx = x + (s - 1) / 2, cy = y + (s - 1) / 2;
      ctx.moveTo(x + 2, cy);
      ctx.lineTo(x + s - 3, cy);
      if (b.collapsed) {
        ctx.moveTo(cx, y + 2);
        ctx.lineTo(cx, y + s - 3);
      }
      ctx.stroke();
      continue;
    }
    ctx.strokeStyle = "#a6a6a6";
    ctx.strokeRect(x, y, s - 1, s - 1);
    ctx.fillStyle = "#444444";
    const tx = b.filtered ? x + s - 5 : x + s / 2, ty = b.filtered ? y + s - 5 : y + s / 2 - 1;
    ctx.beginPath();
    ctx.moveTo(tx - 3, ty);
    ctx.lineTo(tx + 3, ty);
    ctx.lineTo(tx, ty + 3);
    ctx.closePath();
    ctx.fill();
    if (b.filtered) {
      ctx.fillStyle = "#217346";
      ctx.beginPath();
      ctx.moveTo(x + 2, y + 3);
      ctx.lineTo(x + 10, y + 3);
      ctx.lineTo(x + 7, y + 7);
      ctx.lineTo(x + 7, y + s - 3);
      ctx.lineTo(x + 5, y + s - 4);
      ctx.lineTo(x + 5, y + 7);
      ctx.closePath();
      ctx.fill();
    }
  }
}

/**
 * The empty table's placeholder text (Excel: the table's name and "To
 * build a report, choose fields from the PivotTable Field List"), centred
 * in its box (canvas px), wrapped to the box width.
 */
export function drawPlaceholder(ctx: CanvasRenderingContext2D, box: { x: number; y: number; w: number; h: number }, title: string, text: string): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(box.x, box.y, box.w, box.h);
  ctx.clip();
  ctx.fillStyle = "#595959";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const cx = box.x + box.w / 2;
  ctx.font = "bold 14.67px Calibri, Carlito, Arial, sans-serif";
  ctx.fillText(title, cx, box.y + box.h * 0.35);
  ctx.font = "13.33px Calibri, Carlito, Arial, sans-serif";
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (line && ctx.measureText(next).width > box.w - 16) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  lines.forEach((l, i) => ctx.fillText(l, cx, box.y + box.h * 0.35 + 26 + i * 18));
  ctx.restore();
}
