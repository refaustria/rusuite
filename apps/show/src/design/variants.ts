// Design › Variants (colour variants of the current theme: the accents
// rotated, PowerPoint's variants keep the dark/light colours) and
// Fonts ▾ (own heading/body font pairings; fonts are only named, never
// shipped – docs/legal-notes.md).

import type { ColorScheme } from "../generated/ColorScheme";
import type { FontScheme } from "../generated/FontScheme";

/** Variant `k` (0…3) of a colour scheme: accents 1–6 rotated by `k` (variant 0 = the scheme itself). */
export function variantColors(scheme: ColorScheme, k: number): ColorScheme {
  if (k === 0) return scheme;
  const c = [...scheme.colors];
  const accents = c.slice(4, 10);
  const rot = accents.map((_, i) => accents[(i + k) % accents.length]!);
  c.splice(4, 6, ...rot);
  return { name: `${scheme.name} ${k + 1}`, colors: c };
}

/** Whether two schemes have the same colours. */
export const sameColors = (a: ColorScheme | undefined, b: ColorScheme | undefined) =>
  !!a && !!b && a.colors.length === b.colors.length && a.colors.every((c, i) => c.toUpperCase() === b.colors[i]?.toUpperCase());

const pair = (name: string, major: string, minor: string): FontScheme => ({
  name, majorLatin: major, minorLatin: minor, majorEastAsian: "", minorEastAsian: "", majorComplexScript: "", minorComplexScript: "",
});

/** Fonts ▾: heading / body pairings (scheme names are Rusuite's own). */
export const FONT_PAIRS: FontScheme[] = [
  pair("Office", "Calibri Light", "Calibri"),
  pair("Rusuite Classic", "Cambria", "Calibri"),
  pair("Rusuite Sans", "Arial", "Arial"),
  pair("Rusuite Serif", "Georgia", "Georgia"),
  pair("Rusuite Editorial", "Georgia", "Verdana"),
  pair("Rusuite Humanist", "Trebuchet MS", "Trebuchet MS"),
  pair("Rusuite Geometric", "Century Gothic", "Century Gothic"),
  pair("Rusuite Gothic", "Franklin Gothic Medium", "Franklin Gothic Book"),
  pair("Rusuite Compact", "Tahoma", "Verdana"),
  pair("Rusuite Book", "Garamond", "Garamond"),
];
