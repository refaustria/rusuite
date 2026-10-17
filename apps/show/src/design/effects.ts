// Design › Variants ▾ › Effects (P9-S3): effect schemes – the theme's
// three effect styles (subtle, moderate, intense; `a:effectStyleLst`)
// that shapes refer to with `a:effectRef` – and the gradient presets of
// Format Background. The schemes and presets are Rusuite's own.

import type { BgGradient } from "../generated/BgGradient";
import type { EffectStyle } from "../generated/EffectStyle";
import type { ThemeColorSlot } from "../../../../packages/ui-shared/src/generated/ThemeColorSlot";

const black = (alpha: number) => ({ base: { kind: "rgb" as const, value: "000000" }, mods: [{ kind: "alpha" as const, value: alpha }] });

/** An outer shadow: blur and distance in pt, direction in degrees, black at `alpha` (file units). */
const shadow = (blurPt: number, distPt: number, dir: number, alpha: number): EffectStyle => ({
  shadow: { blur: Math.round(blurPt * 12700), distance: Math.round(distPt * 12700), directionDeg: dir, color: black(alpha) },
});

export interface EffectScheme {
  id: string;
  /** The scheme's name (written as the format scheme's name). */
  name: string;
  styles: EffectStyle[];
}

/** The effect schemes of the Effects menu. */
export const EFFECT_SCHEMES: EffectScheme[] = [
  { id: "office", name: "Office", styles: [{}, {}, shadow(4, 2, 90, 63000)] },
  { id: "flat", name: "Rusuite Flat", styles: [{}, {}, {}] },
  { id: "subtle", name: "Rusuite Subtle Shadows", styles: [shadow(2, 1, 90, 30000), shadow(3, 2, 90, 35000), shadow(5, 3, 90, 40000)] },
  { id: "moderate", name: "Rusuite Soft Shadows", styles: [shadow(3, 2, 90, 40000), shadow(6, 3, 90, 45000), shadow(9, 5, 90, 50000)] },
  { id: "intense", name: "Rusuite Strong Shadows", styles: [shadow(4, 3, 45, 50000), shadow(8, 5, 45, 55000), shadow(14, 8, 45, 60000)] },
  { id: "lifted", name: "Rusuite Lifted", styles: [{}, shadow(10, 6, 90, 35000), shadow(18, 10, 90, 40000)] },
];

/** The scheme the theme's effect styles equal, if any. */
export function currentEffectScheme(styles: readonly EffectStyle[] | undefined): string | undefined {
  const json = JSON.stringify(styles ?? []);
  return EFFECT_SCHEMES.find((s) => JSON.stringify(s.styles) === json)?.id;
}

export type GradientPresetKind = "light" | "topSpot" | "medium" | "bottomSpot" | "radial";

/** Format Background › Preset gradients: five kinds per accent (PowerPoint's 5 × 6 grid). */
export const GRADIENT_KINDS: GradientPresetKind[] = ["light", "topSpot", "medium", "bottomSpot", "radial"];
export const GRADIENT_ACCENTS: ThemeColorSlot[] = ["accent1", "accent2", "accent3", "accent4", "accent5", "accent6"];

/** A preset gradient in theme colours. */
export function gradientPreset(kind: GradientPresetKind, slot: ThemeColorSlot): BgGradient {
  const c = (tint: number) => ({ kind: "theme" as const, value: { slot, tint } });
  const stop = (pos: number, tint: number) => ({ pos, color: c(tint) });
  switch (kind) {
    case "light":
      return { stops: [stop(0, 0.8), stop(0.5, 0.6), stop(1, 0.4)], angleDeg: 90, shape: "linear" };
    case "topSpot":
      return { stops: [stop(0, 0.9), stop(1, 0.2)], angleDeg: 90, shape: "linear" };
    case "medium":
      return { stops: [stop(0, 0.4), stop(0.5, 0), stop(1, -0.25)], angleDeg: 90, shape: "linear" };
    case "bottomSpot":
      return { stops: [stop(0, 0), stop(1, 0.9)], angleDeg: 90, shape: "linear" };
    case "radial":
      return { stops: [stop(0, 0.7), stop(1, -0.25)], angleDeg: 0, shape: "circle" };
  }
}

/** Gradient stops sorted by position (the pane keeps them in order). */
export function sortStops<T extends { pos: number }>(stops: readonly T[]): T[] {
  return [...stops].sort((a, b) => a.pos - b.pos);
}

/** Add gradient stop: halfway after stop `i` (before the last: between it and the next), with its colour. */
export function addStop<T extends { pos: number }>(stops: readonly T[], i: number): { stops: T[]; index: number } {
  const s = sortStops(stops);
  if (s.length >= 10) return { stops: s, index: i };
  const a = s[Math.min(i, s.length - 1)]!;
  const b = s[Math.min(i + 1, s.length - 1)]!;
  const pos = b === a ? Math.min(1, a.pos + (1 - a.pos) / 2) : (a.pos + b.pos) / 2;
  const made = { ...a, pos: Math.round(pos * 1000) / 1000 };
  const out = sortStops([...s, made]);
  return { stops: out, index: out.indexOf(made) };
}

/** Remove gradient stop `i` (a gradient keeps two). */
export function removeStop<T>(stops: readonly T[], i: number): T[] {
  return stops.length <= 2 ? [...stops] : stops.filter((_, k) => k !== i);
}
