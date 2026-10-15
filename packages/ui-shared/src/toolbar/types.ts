// Mirrors the serde shapes of `core-model` / `model-sheet` (camelCase).

export type ThemeColorSlot =
  | "dark1"
  | "light1"
  | "dark2"
  | "light2"
  | "accent1"
  | "accent2"
  | "accent3"
  | "accent4"
  | "accent5"
  | "accent6"
  | "hyperlink"
  | "followedHyperlink";

export type Color =
  | { kind: "auto" }
  | { kind: "rgb"; value: string }
  | { kind: "theme"; value: { slot: ThemeColorSlot; tint: number } };

export type ThemeFontSlot =
  | "majorLatin"
  | "minorLatin"
  | "majorEastAsian"
  | "minorEastAsian"
  | "majorComplexScript"
  | "minorComplexScript";

export type FontFace =
  | { kind: "named"; value: string }
  | { kind: "theme"; value: ThemeFontSlot };

export type Underline = "none" | "single" | "double" | "dotted" | "dashed" | "wavy";
export type VerticalAlign = "baseline" | "superscript" | "subscript";
export type HAlign = "general" | "left" | "center" | "right" | "fill" | "justify";
export type VAlign = "top" | "center" | "bottom";
export type BorderStyle = "thin" | "medium" | "thick" | "dashed" | "dotted" | "double" | "hair";

export interface RunPropertiesView {
  font?: FontFace;
  /** Hundredths of a point (1100 = 11 pt). */
  size?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: Underline;
  strike?: boolean;
  color?: Color;
  highlight?: Color;
  verticalAlign?: VerticalAlign;
}

export type FillView = { kind: "none" } | { kind: "solid"; color: Color };
export interface BorderSideView {
  style: BorderStyle;
  color: Color;
}
export interface BordersView {
  left?: BorderSideView;
  right?: BorderSideView;
  top?: BorderSideView;
  bottom?: BorderSideView;
}
export interface AlignmentView {
  horizontal?: HAlign;
  vertical?: VAlign;
  wrapText?: boolean;
  indent?: number;
}

/** Resolved style of the active cell / selection; every field optional. */
export interface CellStyleView {
  font?: RunPropertiesView;
  fill?: FillView;
  borders?: BordersView;
  alignment?: AlignmentView;
  numberFormat?: string;
}

/**
 * `CellStyle`-shaped JSON for the backend's `ApplyStyle`: only the changed
 * fields are set. Border sides set to `null` request "remove this border"
 * (the current backend merge ignores them; see the P2-6 report).
 */
export interface CellStylePatch {
  font?: RunPropertiesView;
  fill?: FillView;
  borders?: { [K in keyof BordersView]?: BorderSideView | null };
  alignment?: AlignmentView;
  numberFormat?: string;
}

/** Theme palette: hex (RRGGBB) per slot. */
export type ThemePalette = Partial<Record<ThemeColorSlot, string>>;
