// Style table lookups and CSS conversions for the canvas.

import { cssColor, OFFICE_THEME, type CellStyleView, type ThemePalette } from "@rusuite/ui-shared";
import type { CellKind } from "../generated/CellKind";
import type { CellStyle } from "../generated/CellStyle";
import type { Color } from "../../../../packages/ui-shared/src/generated/Color";

export const DEFAULT_FONT_FAMILY = "Calibri";
export const DEFAULT_FONT_SIZE = 1100;
const FALLBACK_FAMILIES = "Carlito, Arial, sans-serif";

export function styleAt(styles: readonly CellStyle[], id: number): CellStyle {
  return styles[id] ?? styles[0] ?? {};
}

/** Drops `null`s recursively: the wire type allows them, the toolbar's view type does not. */
function stripNulls<T>(v: T): T {
  if (Array.isArray(v) || typeof v !== "object" || v === null) return v;
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) {
    if (x !== null && x !== undefined) out[k] = stripNulls(x);
  }
  return out as T;
}

export function toStyleView(style: CellStyle): CellStyleView {
  return stripNulls(style) as CellStyleView;
}

/** The toolbar's view of a resolved style: absent font parts show the defaults (Calibri 11). */
export function toolbarValue(style: CellStyle): CellStyleView {
  const v = toStyleView(style);
  return { ...v, font: { font: { kind: "named", value: DEFAULT_FONT_FAMILY }, size: DEFAULT_FONT_SIZE, ...v.font } };
}

/** The Office theme with its hyperlink colours (the Hyperlink cell style uses them). */
export const CALC_THEME: ThemePalette = { ...OFFICE_THEME, hyperlink: "0563C1", followedHyperlink: "954F72" };

export function colorCss(c: Color | null | undefined): string | undefined {
  return cssColor(c ?? undefined, CALC_THEME);
}

export function fontFamily(style: CellStyle): string {
  const f = style.font?.font;
  let name = DEFAULT_FONT_FAMILY;
  if (f?.kind === "named") name = f.value;
  else if (f?.kind === "theme") name = f.value.startsWith("major") ? "Cambria" : "Calibri";
  return `"${name}", ${FALLBACK_FAMILIES}`;
}

/** Font size in CSS px. */
export function fontPx(style: CellStyle): number {
  const hundredths = style.font?.size ?? DEFAULT_FONT_SIZE;
  return (hundredths / 100) * (96 / 72);
}

/** A canvas `font` shorthand. */
export function fontCss(style: CellStyle): string {
  const f = style.font;
  return `${f?.italic ? "italic " : ""}${f?.bold ? "bold " : ""}${fontPx(style).toFixed(2)}px ${fontFamily(style)}`;
}

export type TextAlign = "left" | "center" | "right";

export function horizontalAlign(style: CellStyle, kind: CellKind): TextAlign {
  switch (style.alignment?.horizontal) {
    case "left":
    case "fill":
    case "justify":
      return "left";
    case "center":
      return "center";
    case "right":
      return "right";
    default:
      return kind === "number" ? "right" : kind === "bool" || kind === "error" ? "center" : "left";
  }
}

export type VAlignKind = "top" | "middle" | "bottom";

export function verticalAlign(style: CellStyle): VAlignKind {
  const v = style.alignment?.vertical;
  return v === "top" ? "top" : v === "center" ? "middle" : "bottom";
}
