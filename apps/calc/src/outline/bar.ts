// The outline bars (P8-35): Data › Group adds outline levels to rows and
// columns; the grid shows a bar left of the row headers (above the
// column headers for columns) with the level buttons 1–8 and a −/+
// button at each group's summary line. Pure geometry, drawing and hit
// testing; GridCanvas places the bars.

import type { AxisGeometry } from "../grid/geometry";

/** Width of one outline level in the bar, px. */
export const OUTLINE_STEP = 14;
/** The −/+ and level button size, px. */
export const OUTLINE_BUTTON = 11;

/** The bar's width (rows) or height (columns) for the deepest level `max` (0: no bar). */
export function gutterSize(max: number): number {
  return max > 0 ? (max + 1) * OUTLINE_STEP + 3 : 0;
}

export interface OutlineLine {
  level: number;
  collapsed: boolean;
}

/** A group of the outline: its detail lines and summary line. */
export interface OutlineGroup {
  /** 1-based level of the detail lines. */
  level: number;
  start: number;
  end: number;
  /** The summary line (`end + 1` or `start - 1`); `null` off the sheet. */
  summary: number | null;
  collapsed: boolean;
}

/**
 * The groups of lines `i0..=i1` (runs of lines with level ≥ k for every
 * level k, clipped to the range plus one line on each side so that runs
 * crossing the range edge are found).
 */
export function outlineGroups(line: (i: number) => OutlineLine, i0: number, i1: number, max: number, summaryAfter: boolean, last: number): OutlineGroup[] {
  const out: OutlineGroup[] = [];
  const lo = Math.max(0, i0 - 1);
  const hi = Math.min(last, i1 + 1);
  for (let k = 1; k <= max; k++) {
    let start: number | null = null;
    for (let i = lo; i <= hi + 1; i++) {
      const inRun = i <= hi && line(i).level >= k;
      if (inRun && start === null) start = i;
      if (!inRun && start !== null) {
        const end = i - 1;
        const summary = summaryAfter ? (end + 1 <= last ? end + 1 : null) : start - 1 >= 0 ? start - 1 : null;
        out.push({ level: k, start, end, summary, collapsed: summary !== null && line(summary).collapsed });
        start = null;
      }
    }
  }
  return out;
}

/** What a click on a bar does. */
export type OutlineHit = { kind: "level"; axis: "rows" | "cols"; level: number } | { kind: "toggle"; axis: "rows" | "cols"; index: number; collapsed: boolean };

export interface BarLayout {
  /** Row bar width / column bar height. */
  gw: number;
  gh: number;
  /** Header sizes (row header width, column header height). */
  headerW: number;
  headerH: number;
  /** The cell area's offsets: screen position of a sheet offset. */
  screenX: (x: number) => number;
  screenY: (y: number) => number;
  width: number;
  height: number;
}

const BUTTON_FILL = "#ffffff";
const LINE = "#808080";

function button(ctx: CanvasRenderingContext2D, x: number, y: number, text: string): void {
  const s = OUTLINE_BUTTON;
  ctx.fillStyle = BUTTON_FILL;
  ctx.fillRect(x, y, s, s);
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 1;
  ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, s - 1, s - 1);
  ctx.fillStyle = "#333333";
  if (text === "−" || text === "+") {
    const cx = Math.round(x + s / 2) - 0.5, cy = Math.round(y + s / 2) - 0.5;
    ctx.fillRect(cx - 2.5, cy, 6, 1);
    if (text === "+") ctx.fillRect(cx, cy - 2.5, 1, 6);
    return;
  }
  ctx.font = "9px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + s / 2, y + s / 2 + 0.5);
}

/** The level buttons' position (row bar: across its top; column bar: down its left side). */
export function levelButton(axis: "rows" | "cols", k: number, l: BarLayout): { x: number; y: number } {
  const off = (k - 1) * OUTLINE_STEP + (OUTLINE_STEP - OUTLINE_BUTTON) / 2;
  return axis === "rows"
    ? { x: off, y: l.gh + (l.headerH - OUTLINE_BUTTON) / 2 }
    : { x: l.gw + (l.headerW - OUTLINE_BUTTON) / 2 - (l.gw > 0 ? 0 : 0), y: off };
}

/** The −/+ button of a group (screen coordinates of the header canvas). */
export function toggleButton(axis: "rows" | "cols", g: OutlineGroup, geo: AxisGeometry, l: BarLayout): { x: number; y: number } | null {
  if (g.summary === null) return null;
  const off = (g.level - 1) * OUTLINE_STEP + (OUTLINE_STEP - OUTLINE_BUTTON) / 2;
  if (axis === "rows") {
    const size = geo.size(g.summary);
    if (size === 0) return null;
    const y = l.gh + l.headerH + l.screenY(geo.offset(g.summary)) + (size - OUTLINE_BUTTON) / 2;
    return { x: off, y };
  }
  const size = geo.size(g.summary);
  if (size === 0) return null;
  const x = l.gw + l.headerW + l.screenX(geo.offset(g.summary)) + (size - OUTLINE_BUTTON) / 2;
  return { x, y: off };
}

/** Paints a bar: level buttons, group brackets and −/+ buttons. */
export function drawOutlineBar(
  ctx: CanvasRenderingContext2D, axis: "rows" | "cols", groups: readonly OutlineGroup[], max: number, geo: AxisGeometry, l: BarLayout,
): void {
  ctx.save();
  ctx.fillStyle = "#f8f8f8";
  if (axis === "rows") ctx.fillRect(0, 0, l.gw, l.gh + l.headerH + l.height);
  else ctx.fillRect(0, 0, l.gw + l.headerW + l.width, l.gh);
  for (let k = 1; k <= max + 1; k++) {
    const p = levelButton(axis, k, l);
    button(ctx, p.x, p.y, String(k));
  }
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 1;
  for (const g of groups) {
    const mid = (g.level - 1) * OUTLINE_STEP + OUTLINE_STEP / 2;
    const a = geo.offset(g.start);
    const b = geo.offset(g.end + 1);
    if (axis === "rows") {
      const top = l.gh + l.headerH + l.screenY(a);
      const bottom = l.gh + l.headerH + l.screenY(b);
      if (bottom > top + 1) {
        ctx.beginPath();
        ctx.moveTo(Math.round(mid) + 0.5, top + 2);
        ctx.lineTo(Math.round(mid) + 0.5, bottom - 2);
        ctx.stroke();
      }
    } else {
      const left = l.gw + l.headerW + l.screenX(a);
      const right = l.gw + l.headerW + l.screenX(b);
      if (right > left + 1) {
        ctx.beginPath();
        ctx.moveTo(left + 2, Math.round(mid) + 0.5);
        ctx.lineTo(right - 2, Math.round(mid) + 0.5);
        ctx.stroke();
      }
    }
    const p = toggleButton(axis, g, geo, l);
    if (p) button(ctx, p.x, p.y, g.collapsed ? "+" : "−");
  }
  ctx.restore();
}

/** The bar button at a point of the grid root (header canvas coordinates). */
export function outlineHitAt(
  x: number, y: number, rows: { groups: readonly OutlineGroup[]; max: number; geo: AxisGeometry }, cols: { groups: readonly OutlineGroup[]; max: number; geo: AxisGeometry }, l: BarLayout,
): OutlineHit | null {
  const inside = (p: { x: number; y: number } | null) => p !== null && x >= p.x - 2 && x <= p.x + OUTLINE_BUTTON + 2 && y >= p.y - 2 && y <= p.y + OUTLINE_BUTTON + 2;
  if (rows.max > 0 && x < l.gw) {
    for (let k = 1; k <= rows.max + 1; k++) if (inside(levelButton("rows", k, l))) return { kind: "level", axis: "rows", level: k };
    for (const g of rows.groups) if (g.summary !== null && inside(toggleButton("rows", g, rows.geo, l))) return { kind: "toggle", axis: "rows", index: g.summary, collapsed: !g.collapsed };
  }
  if (cols.max > 0 && y < l.gh) {
    for (let k = 1; k <= cols.max + 1; k++) if (inside(levelButton("cols", k, l))) return { kind: "level", axis: "cols", level: k };
    for (const g of cols.groups) if (g.summary !== null && inside(toggleButton("cols", g, cols.geo, l))) return { kind: "toggle", axis: "cols", index: g.summary, collapsed: !g.collapsed };
  }
  return null;
}
