// Formula Auditing (P8-23): Trace Precedents / Dependents arrows from the
// engine's dependency graph (`precedents` / `dependents` requests), their
// geometry (pure, unit-tested) and the canvas painter. Excel's look: blue
// arrows from the precedent to the formula cell with a dot at the start, a
// blue box around precedent ranges, a dashed black arrow with a sheet icon
// for references to other sheets.

import type { SheetRect } from "../generated/SheetRect";
import type { AxisGeometry } from "../grid/geometry";
import type { Cell, Range } from "../grid/Selection";
import type { CalcStore } from "../state/store";
import { t } from "../i18n";

/** One arrow: from a precedent (cell or range) to the formula cell. */
export interface TraceArrow {
  /** The sheet the arrow is drawn on (the formula cell's). */
  sheet: number;
  from: Range;
  to: Cell;
  /** The precedent lies on another sheet: drawn from a sheet icon. */
  external: boolean;
  /** `precedents` (blue) or `dependents` (blue as well; kept to remove them separately). */
  kind: "precedents" | "dependents";
}

export interface ArrowGeometry {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** The precedent range's box (ranges of more than one cell). */
  box: { x: number; y: number; w: number; h: number } | null;
  /** The arrowhead's two back corners. */
  head: [number, number, number, number];
}

const HEAD = 7;

/** The centre of the cell's box in sheet pixels. */
function centre(col: AxisGeometry, row: AxisGeometry, c: Cell): { x: number; y: number } {
  return { x: (col.offset(c.col) + col.offset(c.col + 1)) / 2, y: (row.offset(c.row) + row.offset(c.row + 1)) / 2 };
}

/**
 * Sheet-pixel geometry of an arrow: from the top-left cell's centre of
 * the precedent (or a point up-left of the formula cell for another
 * sheet) to the formula cell's centre, with the arrowhead at the end.
 */
export function arrowGeometry(col: AxisGeometry, row: AxisGeometry, a: TraceArrow): ArrowGeometry {
  const end = centre(col, row, a.to);
  let start: { x: number; y: number };
  let box: ArrowGeometry["box"] = null;
  if (a.external) {
    start = { x: Math.max(4, col.offset(a.to.col) - 40), y: Math.max(4, row.offset(a.to.row) - 24) };
  } else {
    start = centre(col, row, { row: a.from.r0, col: a.from.c0 });
    if (a.from.r1 > a.from.r0 || a.from.c1 > a.from.c0) {
      const x = col.offset(a.from.c0);
      const y = row.offset(a.from.r0);
      box = { x, y, w: col.offset(a.from.c1 + 1) - x, h: row.offset(a.from.r1 + 1) - y };
    }
  }
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const bx = end.x - ux * HEAD;
  const by = end.y - uy * HEAD;
  const px = -uy * (HEAD / 2);
  const py = ux * (HEAD / 2);
  return { x1: start.x, y1: start.y, x2: end.x, y2: end.y, box, head: [bx + px, by + py, bx - px, by - py] };
}

/** Arrows for a formula cell from its precedents. */
export function precedentArrows(sheet: number, cell: Cell, refs: readonly SheetRect[]): TraceArrow[] {
  return refs
    .filter((r) => !(r.sheet === sheet && r.r0 === cell.row && r.c0 === cell.col && r.r1 === cell.row && r.c1 === cell.col))
    .map((r) => ({ sheet, from: { r0: r.r0, c0: r.c0, r1: r.r1, c1: r.c1 }, to: { ...cell }, external: r.sheet !== sheet, kind: "precedents" as const }));
}

/** Arrows from a cell to its dependents (those on other sheets start from the sheet icon of their own sheet). */
export function dependentArrows(sheet: number, cell: Cell, refs: readonly SheetRect[]): TraceArrow[] {
  return refs.map((r) =>
    r.sheet === sheet
      ? { sheet, from: { r0: cell.row, c0: cell.col, r1: cell.row, c1: cell.col }, to: { row: r.r0, col: r.c0 }, external: false, kind: "dependents" as const }
      : { sheet: r.sheet, from: { r0: 0, c0: 0, r1: 0, c1: 0 }, to: { row: r.r0, col: r.c0 }, external: true, kind: "dependents" as const },
  );
}

/** Removes duplicates (same sheet, ends and kind). */
export function mergeArrows(list: readonly TraceArrow[], more: readonly TraceArrow[]): TraceArrow[] {
  const key = (a: TraceArrow) => `${a.sheet}|${a.kind}|${a.external}|${a.from.r0},${a.from.c0},${a.from.r1},${a.from.c1}|${a.to.row},${a.to.col}`;
  const seen = new Set(list.map(key));
  const out = [...list];
  for (const a of more) {
    if (!seen.has(key(a))) {
      seen.add(key(a));
      out.push(a);
    }
  }
  return out;
}

const BLUE = "#2a62d6";

/** Paints the arrows of `sheet` (canvas already translated to the pane; `scroll` = the pane's scroll). */
export function paintArrows(ctx: CanvasRenderingContext2D, col: AxisGeometry, row: AxisGeometry, arrows: readonly TraceArrow[], scrollX: number, scrollY: number): void {
  for (const a of arrows) {
    const g = arrowGeometry(col, row, a);
    const color = a.external ? "#202020" : BLUE;
    ctx.save();
    ctx.translate(-scrollX, -scrollY);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1.5;
    if (g.box) {
      ctx.strokeRect(g.box.x + 1, g.box.y + 1, g.box.w - 2, g.box.h - 2);
    }
    ctx.setLineDash(a.external ? [4, 3] : []);
    ctx.beginPath();
    ctx.moveTo(g.x1, g.y1);
    ctx.lineTo(g.x2, g.y2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(g.x2, g.y2);
    ctx.lineTo(g.head[0], g.head[1]);
    ctx.lineTo(g.head[2], g.head[3]);
    ctx.closePath();
    ctx.fill();
    if (a.external) {
      // A small worksheet icon.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(g.x1 - 8, g.y1 - 6, 16, 12);
      ctx.strokeRect(g.x1 - 8, g.y1 - 6, 16, 12);
      ctx.beginPath();
      ctx.moveTo(g.x1 - 8, g.y1 - 2);
      ctx.lineTo(g.x1 + 8, g.y1 - 2);
      ctx.moveTo(g.x1 - 2, g.y1 - 6);
      ctx.lineTo(g.x1 - 2, g.y1 + 6);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(g.x1, g.y1, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

/** The arrows on the store (`store.trace`). */
export class TraceController {
  arrows: TraceArrow[] = [];

  constructor(private readonly store: CalcStore) {}

  /** Arrows drawn on `sheet`. */
  on(sheet: number): TraceArrow[] {
    return this.arrows.filter((a) => a.sheet === sheet);
  }

  /** Trace Precedents of the active cell (each call adds the arrows, as Excel's one level per click). */
  async precedents(): Promise<void> {
    const st = this.store.getState();
    const cell = this.store.activeAnchor();
    const refs = await this.store.api.precedents(st.activeSheet, cell.row, cell.col).catch((e: unknown) => {
      this.store.pushError(e);
      return null;
    });
    if (!refs) return;
    if (refs.length === 0) {
      this.store.pushError(new Error(t("calc.audit.noPrecedents")));
      return;
    }
    this.arrows = mergeArrows(this.arrows, precedentArrows(st.activeSheet, cell, refs));
    this.store.notify();
  }

  /** Trace Dependents of the active cell. */
  async dependents(): Promise<void> {
    const st = this.store.getState();
    const cell = this.store.activeAnchor();
    const refs = await this.store.api.dependents(st.activeSheet, cell.row, cell.col).catch((e: unknown) => {
      this.store.pushError(e);
      return null;
    });
    if (!refs) return;
    if (refs.length === 0) {
      this.store.pushError(new Error(t("calc.audit.noDependents")));
      return;
    }
    this.arrows = mergeArrows(this.arrows, dependentArrows(st.activeSheet, cell, refs));
    this.store.notify();
  }

  /** Remove Arrows (all, or only one kind). */
  clear(kind?: TraceArrow["kind"]): void {
    this.arrows = kind ? this.arrows.filter((a) => a.kind !== kind) : [];
    this.store.notify();
  }
}
