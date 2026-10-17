// Excel table styles (P8-35): the built-in Light 1–21, Medium 1–28 and
// Dark 1–11 as a few parameters per style derived from the Office theme
// colours, and the per-cell look the grid (and print, and Convert to
// Range) draws over a table's cells from their position in the table and
// the Table Style Options. The cells carry no table formatting; the look
// is the view's (as for pivot tables, pivot/styles.ts).

import { applyTint, OFFICE_THEME } from "@rusuite/ui-shared";
import type { CellStyle } from "../generated/CellStyle";
import type { CustomTableStyle } from "../generated/CustomTableStyle";
import type { DxfStyle } from "../generated/DxfStyle";
import type { Table } from "../generated/Table";
import type { TableStyleElementType } from "../generated/TableStyleElementType";
import type { TableStyles } from "../generated/TableStyles";
import { colorCss } from "../grid/style";
import type { PivotLook } from "../pivot/styles";

/** The parameters of one built-in table style. */
export interface TableStyleDef {
  id: string;
  headerFill: string | null;
  headerColor: string;
  /** The line under the header and over / under the table. */
  line: string;
  /** Lines between rows inside the body (`null`: none). */
  inner: string | null;
  /** Vertical lines between columns (`null`: none). */
  vertical: string | null;
  /** The shaded stripe (banded rows / columns). */
  band: string;
  bodyFill: string | null;
  bodyColor: string;
  totalsFill: string | null;
  /** The line over the totals row (Excel: double in the light styles). */
  totalsLine: string;
  /** First / last column emphasis fill (dark styles); bold always. */
  edgeFill: string | null;
}

const ACCENTS = ["000000", OFFICE_THEME.accent1, OFFICE_THEME.accent2, OFFICE_THEME.accent3, OFFICE_THEME.accent4, OFFICE_THEME.accent5, OFFICE_THEME.accent6];
const hex = (h: string) => `#${h.toUpperCase()}`;
function tint(a: number, t: number): string {
  return hex(applyTint(a === 0 ? "808080" : ACCENTS[a]!, t));
}

/** How many styles each family has (Excel's gallery). */
export const TABLE_STYLE_COUNTS = { Light: 21, Medium: 28, Dark: 11 } as const;

export const DEFAULT_TABLE_STYLE = "TableStyleMedium2";

/** The definition of `TableStyleMedium2` and the others (unknown names: none). */
export function tableStyle(id: string): TableStyleDef | null {
  const m = /^TableStyle(Light|Medium|Dark)(\d+)$/.exec(id);
  if (!m) return null;
  const family = m[1] as keyof typeof TABLE_STYLE_COUNTS;
  const n = Math.max(1, Math.min(TABLE_STYLE_COUNTS[family], Number(m[2])));
  const a = (n - 1) % 7;
  const group = Math.floor((n - 1) / 7);
  const solid = a === 0 ? "#000000" : hex(ACCENTS[a]!);
  const base: TableStyleDef = {
    id, headerFill: null, headerColor: "#000000", line: solid, inner: null, vertical: null, band: tint(a, 0.8),
    bodyFill: null, bodyColor: "#000000", totalsFill: null, totalsLine: solid, edgeFill: null,
  };
  if (family === "Light") {
    if (group === 0) return { ...base, headerColor: a === 0 ? "#000000" : hex(applyTint(ACCENTS[a]!, -0.25)) };
    if (group === 1) return { ...base, headerFill: solid, headerColor: "#FFFFFF", band: "#FFFFFF", inner: solid };
    return { ...base, inner: tint(a, 0.4), vertical: tint(a, 0.4) };
  }
  if (family === "Medium") {
    if (group === 0) return { ...base, headerFill: solid, headerColor: "#FFFFFF", inner: tint(a, 0.4), band: tint(a, 0.8) };
    if (group === 1) return { ...base, headerFill: solid, headerColor: "#FFFFFF", line: "#FFFFFF", inner: "#FFFFFF", vertical: "#FFFFFF", bodyFill: tint(a, 0.8), band: tint(a, 0.6), totalsFill: solid, totalsLine: "#FFFFFF" };
    if (group === 2) return { ...base, headerFill: "#000000", headerColor: "#FFFFFF", inner: tint(a, 0.6), band: tint(a, 0.8), edgeFill: tint(a, 0.6) };
    return { ...base, headerFill: tint(a, 0.6), headerColor: "#000000", inner: tint(a, 0.4), vertical: tint(a, 0.4), bodyFill: tint(a, 0.8), band: tint(a, 0.6) };
  }
  // Dark: dark bodies with white text (1–7), black headers on tinted bodies (8–11).
  if (group === 0) {
    return {
      ...base, headerFill: "#000000", headerColor: "#FFFFFF", line: "#FFFFFF", bodyFill: a === 0 ? "#737373" : tint(a, -0.25), bodyColor: "#FFFFFF",
      band: a === 0 ? "#404040" : tint(a, -0.5), totalsFill: a === 0 ? "#404040" : tint(a, -0.5), totalsLine: "#FFFFFF", edgeFill: a === 0 ? "#404040" : tint(a, -0.5),
    };
  }
  const b = [0, 1, 3, 5][n - 8] ?? 0;
  return { ...base, headerFill: "#000000", headerColor: "#FFFFFF", bodyFill: tint(b, 0.6), band: tint(b, 0.4), totalsFill: tint(b, 0.4), line: "#000000" };
}

/** Every built-in style id in the gallery's order (Light, Medium, Dark). */
export const TABLE_STYLES: string[] = (Object.keys(TABLE_STYLE_COUNTS) as (keyof typeof TABLE_STYLE_COUNTS)[]).flatMap((f) =>
  Array.from({ length: TABLE_STYLE_COUNTS[f] }, (_, i) => `TableStyle${f}${i + 1}`),
);

/** Excel's gallery name: `Medium 2`. */
export function tableStyleNumber(id: string): { family: "light" | "medium" | "dark"; n: number } | null {
  const m = /^TableStyle(Light|Medium|Dark)(\d+)$/.exec(id);
  return m ? { family: m[1]!.toLowerCase() as "light" | "medium" | "dark", n: Number(m[2]) } : null;
}

/** First and last data row of a table. */
export function dataRows(t: Table): [number, number] {
  return [t.r0 + (t.headerRow ? 1 : 0), t.r1 - (t.totalsRow ? 1 : 0)];
}

/**
 * The look of cell `(row, col)` of table `t` (`undefined` outside it or
 * without a style): header band, banded rows / columns, first / last
 * column, totals row and lines.
 */
export function tableLook(t: Table, row: number, col: number, styles?: TableStyles): PivotLook | undefined {
  if (row < t.r0 || row > t.r1 || col < t.c0 || col > t.c1) return undefined;
  const custom = customStyle(styles, t.style);
  if (custom) return customLook(custom, t, row, col);
  const def = tableStyle(t.style);
  if (!def) return undefined;
  const look: PivotLook = {};
  const [d0, d1] = dataRows(t);
  const isHeader = t.headerRow && row === t.r0;
  const isTotals = !!t.totalsRow && row === t.r1;
  const first = t.look.firstColumn && col === t.c0;
  const last = t.look.lastColumn && col === t.c1;
  if (isHeader) {
    if (def.headerFill) look.fill = def.headerFill;
    look.color = def.headerColor;
    look.bold = true;
    look.bottom = def.line;
    if (!def.headerFill) look.top = def.line;
    return look;
  }
  if (isTotals) {
    look.bold = true;
    look.top = def.totalsLine;
    look.bottom = def.line;
    if (def.totalsFill) look.fill = def.totalsFill;
    if (def.bodyColor !== "#000000") look.color = def.bodyColor;
    return look;
  }
  if (def.bodyFill) look.fill = def.bodyFill;
  if (def.bodyColor !== "#000000") look.color = def.bodyColor;
  if (t.look.bandedRows && (row - d0) % 2 === 0) look.fill = def.band;
  if (t.look.bandedColumns && !t.look.bandedRows && (col - t.c0) % 2 === 0) look.fill = def.band;
  if ((first || last) && def.edgeFill) look.fill = def.edgeFill;
  if (first || last) look.bold = true;
  if (def.inner && row < d1) look.bottom = def.inner;
  if (row === d1 && !t.totalsRow) look.bottom = def.line;
  if (row === d0 && !t.headerRow) look.top = def.line;
  if (def.vertical && col < t.c1) look.right = def.vertical;
  return look;
}

// --- custom table styles (P9-C2) ------------------------------------------

/** The elements of the New Table Style dialog, lowest precedence first (Excel's list order). */
export const TABLE_STYLE_ELEMENTS: TableStyleElementType[] = [
  "wholeTable", "firstColumnStripe", "secondColumnStripe", "firstRowStripe", "secondRowStripe", "lastColumn", "firstColumn", "headerRow", "totalRow",
];

/** Elements with a stripe size. */
export const isStripe = (k: TableStyleElementType): boolean => k.endsWith("Stripe");

/** The custom style named `name` (any case). */
export function customStyle(styles: TableStyles | undefined, name: string): CustomTableStyle | undefined {
  const n = name.toLowerCase();
  return styles?.custom?.find((s) => s.name.toLowerCase() === n);
}

/** The rows / columns an element covers in a cell's table, or `null` when it does not apply to the cell. */
function elementBox(t: Table, kind: TableStyleElementType, size: (k: TableStyleElementType) => number, row: number, col: number): { r0: number; c0: number; r1: number; c1: number } | null {
  const [d0, d1] = dataRows(t);
  const all = { r0: t.r0, c0: t.c0, r1: t.r1, c1: t.c1 };
  const inData = row >= d0 && row <= d1;
  const band = (i: number, first: TableStyleElementType, second: TableStyleElementType, wanted: TableStyleElementType) => {
    const a = size(first), b = size(second);
    const pos = i % (a + b);
    const isFirst = pos < a;
    if ((wanted === first) !== isFirst) return null;
    const start = i - (isFirst ? pos : pos - a);
    return [start, start + (isFirst ? a : b) - 1] as const;
  };
  switch (kind) {
    case "wholeTable":
      return all;
    case "headerRow":
      return t.headerRow && row === t.r0 ? { ...all, r1: t.r0 } : null;
    case "totalRow":
      return t.totalsRow && row === t.r1 ? { ...all, r0: t.r1 } : null;
    case "firstColumn":
      return t.look.firstColumn && col === t.c0 ? { ...all, c1: t.c0 } : null;
    case "lastColumn":
      return t.look.lastColumn && col === t.c1 ? { ...all, c0: t.c1 } : null;
    case "firstRowStripe":
    case "secondRowStripe": {
      if (!t.look.bandedRows || !inData) return null;
      const b = band(row - d0, "firstRowStripe", "secondRowStripe", kind);
      return b ? { r0: d0 + b[0], r1: Math.min(d1, d0 + b[1]), c0: t.c0, c1: t.c1 } : null;
    }
    case "firstColumnStripe":
    case "secondColumnStripe": {
      if (!t.look.bandedColumns || !inData) return null;
      const b = band(col - t.c0, "firstColumnStripe", "secondColumnStripe", kind);
      return b ? { r0: d0, r1: d1, c0: t.c0 + b[0], c1: Math.min(t.c1, t.c0 + b[1]) } : null;
    }
  }
}

/** The look of a cell under a custom style: the elements that cover it, later ones over earlier ones. */
export function customLook(style: CustomTableStyle, t: Table, row: number, col: number): PivotLook {
  const size = (k: TableStyleElementType) => Math.max(1, style.elements.find((e) => e.type === k)?.size ?? 1);
  const look: PivotLook = {};
  for (const kind of TABLE_STYLE_ELEMENTS) {
    const el = style.elements.find((e) => e.type === kind);
    if (!el) continue;
    const box = elementBox(t, kind, size, row, col);
    if (!box) continue;
    applyDxf(look, el.dxf, { top: row === box.r0, bottom: row === box.r1, left: col === box.c0, right: col === box.c1 });
  }
  return look;
}

function applyDxf(look: PivotLook, dxf: DxfStyle, edge: { top: boolean; bottom: boolean; left: boolean; right: boolean }): void {
  const fill = colorCss(dxf.fill);
  if (fill) look.fill = fill;
  const color = colorCss(dxf.fontColor);
  if (color) look.color = color;
  if (dxf.bold !== undefined) look.bold = dxf.bold;
  const b = dxf.borders;
  if (!b) return;
  for (const side of ["top", "bottom", "left", "right"] as const) {
    const v = b[side];
    if (v && edge[side]) look[side] = colorCss(v.color) ?? "#000000";
  }
}

/** A custom style's gallery colours (the header, two stripes, the line). */
export function customPreviewColors(style: CustomTableStyle): { header: string; headerText: string; rows: [string, string]; line: string } {
  const fill = (k: TableStyleElementType) => colorCss(style.elements.find((e) => e.type === k)?.dxf.fill);
  const whole = fill("wholeTable") ?? "#FFFFFF";
  const headerEl = style.elements.find((e) => e.type === "headerRow");
  const line = colorCss(style.elements.find((e) => e.type === "wholeTable")?.dxf.borders?.bottom?.color) ?? colorCss(headerEl?.dxf.borders?.bottom?.color) ?? "#BFBFBF";
  return {
    header: fill("headerRow") ?? whole,
    headerText: colorCss(headerEl?.dxf.fontColor) ?? "#000000",
    rows: [fill("firstRowStripe") ?? whole, fill("secondRowStripe") ?? whole],
    line,
  };
}

/** `Table Style 1`, `Table Style 2`, …: the first name no custom style uses (`base` in the dialog's language). */
export function freshStyleName(styles: TableStyles | undefined, base: string): string {
  for (let n = 1; ; n++) {
    const name = `${base} ${n}`;
    if (!customStyle(styles, name)) return name;
  }
}

/** A look as a cell style patch (Convert to Range keeps the look as formats). */
export function lookAsStyle(look: PivotLook): CellStyle {
  const rgb = (c: string) => ({ kind: "rgb" as const, value: c.replace("#", "").toUpperCase() });
  const out: CellStyle = {};
  if (look.fill) out.fill = { kind: "solid", color: rgb(look.fill) };
  if (look.bold || look.color) out.font = { ...(look.bold ? { bold: true } : {}), ...(look.color && look.color !== "#000000" ? { color: rgb(look.color) } : {}) };
  const side = (c: string | undefined) => (c ? { style: "thin" as const, color: rgb(c) } : undefined);
  if (look.top || look.bottom || look.left || look.right) {
    out.borders = {};
    if (look.top) out.borders.top = side(look.top);
    if (look.bottom) out.borders.bottom = side(look.bottom);
    if (look.left) out.borders.left = side(look.left);
    if (look.right) out.borders.right = side(look.right);
  }
  return out;
}

/** The colours a gallery preview shows: header, two body rows, line. */
export function previewColors(id: string, styles?: TableStyles): { header: string; headerText: string; rows: [string, string]; line: string } {
  const custom = customStyle(styles, id);
  if (custom) return customPreviewColors(custom);
  const def = tableStyle(id);
  if (!def) return { header: "#FFFFFF", headerText: "#000000", rows: ["#FFFFFF", "#FFFFFF"], line: "#BFBFBF" };
  const body = def.bodyFill ?? "#FFFFFF";
  return { header: def.headerFill ?? "#FFFFFF", headerText: def.headerColor, rows: [def.band, body], line: def.line };
}
