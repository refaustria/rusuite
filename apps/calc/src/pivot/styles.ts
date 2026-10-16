// PivotTable styles (P8-33): Excel's built-in Light 1–28, Medium 1–28 and
// Dark 1–28 as a small set of parameters per style (header band, lines,
// bands, totals) derived from the Office theme colours, and the per-cell
// look the grid draws over a pivot table's cells from their roles
// (`CellView.pivot`). The cells themselves carry no pivot formatting (the
// core writes plain cells, docs/pivot.md); the look is the view's.

import { applyTint, OFFICE_THEME } from "@rusuite/ui-shared";
import type { CellView } from "../generated/CellView";
import type { PivotSummary } from "../generated/PivotSummary";
import type { CellAt } from "./model";
import { firstBodyRow, firstDataCol } from "./model";

/** What the grid draws for one pivot cell on top of its own style. */
export interface PivotLook {
  fill?: string;
  bold?: boolean;
  color?: string;
  /** Lines on the cell's top / bottom edge. */
  top?: string;
  bottom?: string;
  /** Lines on the left / right edge (the empty table's placeholder box). */
  left?: string;
  right?: string;
  /** Text shift (px) for the expand / collapse button in front of a label. */
  shift?: number;
}

/** The parameters of one built-in style. */
export interface PivotStyleDef {
  id: string;
  /** Header band (the rows above the body). */
  headerFill: string | null;
  headerColor: string;
  /** Lines: under the header, over the grand total, under the table. */
  line: string;
  /** Banded rows' fill. */
  band: string;
  /** Subtotal rows (an item with inner items) fill; `null` = none. */
  subtotalFill: string | null;
  /** Grand total row fill. */
  totalFill: string | null;
  /** Body fill and text colour (dark styles). */
  bodyFill: string | null;
  bodyColor: string;
}

const ACCENTS = ["000000", OFFICE_THEME.accent1, OFFICE_THEME.accent2, OFFICE_THEME.accent3, OFFICE_THEME.accent4, OFFICE_THEME.accent5, OFFICE_THEME.accent6];
const hex = (h: string) => `#${h.toUpperCase()}`;
/** A tint of accent `a` (0 = black → greys). */
function tint(a: number, t: number): string {
  if (a === 0) return hex(applyTint("808080", t > 0 ? t : t));
  return hex(applyTint(ACCENTS[a]!, t));
}

/** The definition of `PivotStyleLight16` and the others (unknown names: Light16). */
export function pivotStyle(id: string): PivotStyleDef {
  const m = /^PivotStyle(Light|Medium|Dark)(\d+)$/.exec(id);
  const family = m?.[1] ?? "Light";
  const n = m ? Math.max(1, Math.min(28, Number(m[2]))) : 16;
  if (!m) return pivotStyle("PivotStyleLight16");
  const a = (n - 1) % 7;
  const group = Math.floor((n - 1) / 7);
  const solid = a === 0 ? "#000000" : hex(ACCENTS[a]!);
  const base: PivotStyleDef = {
    id, headerFill: null, headerColor: "#000000", line: solid, band: tint(a, 0.8), subtotalFill: null, totalFill: null, bodyFill: null, bodyColor: "#000000",
  };
  if (family === "Light") {
    if (group === 0) return { ...base, line: a === 0 ? "#000000" : solid };
    if (group === 1) return { ...base, headerFill: solid, headerColor: "#FFFFFF" };
    if (group === 2) return { ...base, headerFill: tint(a, 0.8), line: tint(a, 0.4) };
    return { ...base, headerFill: tint(a, 0.6), line: tint(a, 0.4), subtotalFill: tint(a, 0.8) };
  }
  if (family === "Medium") {
    if (group === 0) return { ...base, headerFill: solid, headerColor: "#FFFFFF", subtotalFill: tint(a, 0.8), totalFill: tint(a, 0.6) };
    if (group === 1) return { ...base, headerFill: tint(a, -0.25), headerColor: "#FFFFFF", band: tint(a, 0.6), totalFill: tint(a, 0.8) };
    if (group === 2) return { ...base, headerFill: solid, headerColor: "#FFFFFF", line: "#FFFFFF", bodyFill: tint(a, 0.8), band: tint(a, 0.6) };
    return { ...base, headerFill: tint(a, 0.4), line: tint(a, 0.4), bodyFill: tint(a, 0.8), band: tint(a, 0.6), totalFill: tint(a, 0.6) };
  }
  // Dark: dark bodies with white text.
  if (group === 0) return { ...base, headerFill: "#000000", headerColor: "#FFFFFF", line: "#FFFFFF", bodyFill: a === 0 ? "#595959" : tint(a, -0.25), bodyColor: "#FFFFFF", band: a === 0 ? "#404040" : tint(a, -0.5), totalFill: "#262626" };
  if (group === 1) return { ...base, headerFill: tint(a, -0.5), headerColor: "#FFFFFF", line: "#FFFFFF", bodyFill: solid, bodyColor: "#FFFFFF", band: tint(a, -0.25), totalFill: tint(a, -0.5) };
  if (group === 2) return { ...base, headerFill: "#000000", headerColor: "#FFFFFF", bodyFill: tint(a, 0.6), band: tint(a, 0.4), subtotalFill: tint(a, 0.4), totalFill: tint(a, 0.4) };
  return { ...base, headerFill: tint(a, -0.25), headerColor: "#FFFFFF", bodyFill: tint(a, 0.8), band: tint(a, 0.6), totalFill: tint(a, 0.4), line: solid };
}

/** Every built-in style id in the gallery's order (Light, Medium, Dark). */
export const PIVOT_STYLES: string[] = (["Light", "Medium", "Dark"] as const).flatMap((f) => Array.from({ length: 28 }, (_, i) => `PivotStyle${f}${i + 1}`));

export const DEFAULT_PIVOT_STYLE = "PivotStyleLight16";

/** Excel's gallery name: `Light 16`. */
export function styleNumber(id: string): { family: "light" | "medium" | "dark"; n: number } {
  const m = /^PivotStyle(Light|Medium|Dark)(\d+)$/.exec(id);
  return m ? { family: m[1]!.toLowerCase() as "light" | "medium" | "dark", n: Number(m[2]) } : { family: "light", n: 16 };
}

/** Width (px) reserved in front of a label with an expand / collapse button. */
export const BUTTON_ROOM = 13;

/** The regions of one table that the looks need (header rows, data columns). */
interface Geometry {
  s: PivotSummary;
  def: PivotStyleDef;
  body: number;
  dataCol: number;
  rows: Map<number, "grand" | "subtotal" | "data">;
  /** No fields yet: Excel's placeholder box. */
  empty: boolean;
}

/** Whether a table shows nothing but blank cells (no fields yet: the placeholder). */
export function isEmptyTable(at: CellAt, s: PivotSummary): boolean {
  const t = s.table;
  for (let r = t.r0; r <= t.r1; r++) for (let c = t.c0; c <= t.c1; c++) {
    const k = at(r, c)?.pivot?.kind;
    if (k && k !== "blank") return false;
  }
  return true;
}

/** Colour of the placeholder box of an empty table. */
export const PLACEHOLDER_LINE = "#a6a6a6";

/**
 * The look function of a sheet's pivot tables: header band (bold, fill),
 * subtotal and grand total lines (bold, a line over the grand total),
 * banded rows, the style's body colours, and room for the +/- buttons.
 * `buttons`: whether the +/- buttons are shown.
 */
export function pivotLooks(summaries: readonly PivotSummary[], at: CellAt, buttons = true): (cell: CellView | undefined, row: number, col: number) => PivotLook | undefined {
  const geo = new Map<number, Geometry>();
  const geometry = (s: PivotSummary): Geometry => {
    let g = geo.get(s.id);
    if (!g) {
      g = { s, def: pivotStyle(s.style), body: firstBodyRow(at, s), dataCol: firstDataCol(at, s), rows: new Map(), empty: isEmptyTable(at, s) };
      geo.set(s.id, g);
    }
    return g;
  };
  const byId = new Map(summaries.map((s) => [s.id, s]));
  return (cell, row, col) => {
    const p = cell?.pivot;
    if (!p) return undefined;
    const s = byId.get(p.id);
    if (!s) return undefined;
    const t = s.table;
    if (row < t.r0 || row > t.r1 || col < t.c0 || col > t.c1) return undefined; // page fields
    const g = geometry(s);
    const { def } = g;
    const look: PivotLook = {};
    if (g.empty) {
      if (row === t.r0) look.top = PLACEHOLDER_LINE;
      if (row === t.r1) look.bottom = PLACEHOLDER_LINE;
      if (col === t.c0) look.left = PLACEHOLDER_LINE;
      if (col === t.c1) look.right = PLACEHOLDER_LINE;
      return look;
    }
    if (row < g.body) {
      // The header band.
      if (def.headerFill) look.fill = def.headerFill;
      look.color = def.headerColor;
      look.bold = s.colHeaders || p.kind === "header";
      if (row === g.body - 1) look.bottom = def.line;
      if (row === t.r0 && !def.headerFill) look.top = def.line;
      return look;
    }
    if (def.bodyFill) look.fill = def.bodyFill;
    if (def.bodyColor !== "#000000") look.color = def.bodyColor;
    if (s.banded && (row - g.body) % 2 === 1) look.fill = def.band;
    // A line with a grand total label is the grand total row; with a subtotal role, a subtotal line.
    let lineKind = g.rows.get(row);
    if (lineKind === undefined) g.rows.set(row, (lineKind = rowKind(at, s, row, g.dataCol)));
    if (lineKind === "grand") {
      look.bold = true;
      look.top = def.line;
      if (def.totalFill) look.fill = def.totalFill;
      if (row === t.r1) look.bottom = def.line;
      return look;
    }
    if (lineKind === "subtotal") {
      look.bold = s.rowHeaders || p.kind !== "rowLabel";
      if (def.subtotalFill) look.fill = def.subtotalFill;
    } else if (p.kind === "grandTotal") look.bold = true;
    if (p.kind === "rowLabel" && p.collapsed !== undefined && s.rowHeaders) look.bold = true;
    if (buttons && p.collapsed !== undefined && (p.kind === "rowLabel" || p.kind === "colLabel")) look.shift = BUTTON_ROOM;
    if (row === t.r1) look.bottom = def.line;
    return look;
  };
}

/** What a body row is: a grand total line, a subtotal line (subtotal values or labels) or a plain line. */
export function rowKind(at: CellAt, s: PivotSummary, row: number, dataCol: number): "grand" | "subtotal" | "data" {
  const t = s.table;
  let kind: "grand" | "subtotal" | "data" = "data";
  for (let c = t.c0; c <= t.c1; c++) {
    const p = at(row, c)?.pivot;
    if (!p) continue;
    if (c < dataCol && p.kind === "grandTotal") return "grand";
    // Compact / outline: an item with inner items carries its subtotals on its own line.
    if (p.kind === "subtotal") kind = "subtotal";
  }
  return kind;
}
