// Chart colours (docs/charts.md "Colours"): the automatic colour of a
// series or point from the chart style's colour rule, resolved with the
// workbook theme (the default Office theme unless the host passes one).

import type { Color } from "../generated/Color";
import type { ThemeColorSlot } from "../generated/ThemeColorSlot";
import { OFFICE_THEME, applyTint } from "../toolbar/color";
import type { ChartFill } from "./model";

/** Theme colours as `RRGGBB` by slot (missing slots fall back to the Office theme). */
export type ChartTheme = Partial<Record<ThemeColorSlot, string>>;

/** Office 2013's `colors1.xml` variations for the colourful rule. */
export const PALETTE_VARIATIONS = [0, -0.4, 0.2, -0.2, 0.4, -0.5, 0.3, -0.3, 0.5];
const ACCENTS: ThemeColorSlot[] = ["accent1", "accent2", "accent3", "accent4", "accent5", "accent6"];

const round3 = (t: number) => Math.round(t * 1000) / 1000;

/** The colour rule column of a style: `(style − 1) mod 8`, styles outside 1..48 count as 2. */
export function styleColumn(style: number | undefined): number {
  const s = style ?? 2;
  return s >= 1 && s <= 48 ? (Math.floor(s) - 1) % 8 : 1;
}

/** `core_model::chart::palette_color`: the automatic colour of item `index` of `count`. */
export function paletteColor(style: number | undefined, index: number, count: number): Color {
  const column = styleColumn(style);
  const spread = (lo: number, hi: number) => (count <= 1 ? (lo + hi) / 2 : lo + ((hi - lo) * Math.min(index, count - 1)) / (count - 1));
  if (column === 0) return { kind: "theme", value: { slot: "dark1", tint: round3(spread(0.15, 0.85)) } };
  if (column === 1) {
    return { kind: "theme", value: { slot: ACCENTS[index % 6]!, tint: PALETTE_VARIATIONS[Math.floor(index / 6) % PALETTE_VARIATIONS.length]! } };
  }
  return { kind: "theme", value: { slot: ACCENTS[column - 2]!, tint: count <= 1 ? 0 : round3(spread(-0.5, 0.4)) } };
}

/** `#RRGGBB` of a model colour (`auto` → `fallback`). */
export function resolveColor(c: Color | undefined, theme: ChartTheme = {}, fallback = "#000000"): string {
  if (!c || c.kind === "auto") return fallback;
  if (c.kind === "rgb") return `#${c.value.toUpperCase()}`;
  const slot = c.value.slot;
  const base = theme[slot] ?? (OFFICE_THEME as Partial<Record<ThemeColorSlot, string>>)[slot] ?? (slot === "hyperlink" ? "0563C1" : slot === "followedHyperlink" ? "954F72" : "000000");
  return `#${applyTint(base, c.value.tint)}`;
}

/** A fill override's colour; `null` = no fill; `undefined` = automatic. */
export function fillColor(f: ChartFill | undefined, theme: ChartTheme): string | null | undefined {
  if (!f) return undefined;
  if (f.type === "none") return null;
  return resolveColor(f.color, theme);
}
