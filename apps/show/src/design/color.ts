// Theme colour resolution ported from `model_show::Theme` (theme.rs):
// DrawingML colour modifiers (`apply_mods`), format-scheme colours and
// fills (`resolve_style_color`, `resolve_style_fill`), backgrounds
// (`resolve_background`, `p:bgRef` 1001… → `bgFillStyles`). A TS port
// rather than a `resolveColors` request: the arithmetic is small and the
// renderer needs it synchronously (thumbnails, print, the audience window
// without a core).

import type { Color } from "../../../../packages/ui-shared/src/generated/Color";
import type { ThemeColorSlot } from "../../../../packages/ui-shared/src/generated/ThemeColorSlot";
import type { Background } from "../generated/Background";
import type { ColorMod } from "../generated/ColorMod";
import type { Fill } from "../generated/Fill";
import type { ResolvedFill } from "../generated/ResolvedFill";
import type { StyleColor } from "../generated/StyleColor";
import type { StyleFill } from "../generated/StyleFill";
import type { Theme } from "../generated/Theme";
import { SCHEME_SLOTS } from "../model";

type RGB = [number, number, number];

const hexToRgb = (hex: string): RGB => {
  const n = parseInt(hex.replace(/^#/, "").padEnd(6, "0").slice(0, 6), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const rgbToHex = (c: RGB): string => c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("").toUpperCase();

/** RGB → (hue, saturation, lightness), all `0..=1` (Python's `colorsys`, as the core). */
export function toHsl([r8, g8, b8]: RGB): [number, number, number] {
  const r = r8 / 255, g = g8 / 255, b = b8 / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l <= 0.5 ? d / (max + min) : d / (2 - max - min);
  const rc = (max - r) / d, gc = (max - g) / d, bc = (max - b) / d;
  const h = r === max ? bc - gc : g === max ? 2 + rc - bc : 4 + gc - rc;
  return [(((h / 6) % 1) + 1) % 1, s, l];
}

/** Inverse of [`toHsl`], rounded. */
export function fromHsl(h: number, s: number, l: number): RGB {
  const u8 = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
  if (s === 0) return [u8(l), u8(l), u8(l)];
  const m2 = l <= 0.5 ? l * (1 + s) : l + s - l * s;
  const m1 = 2 * l - m2;
  const v = (hue: number) => {
    hue = ((hue % 1) + 1) % 1;
    if (hue < 1 / 6) return m1 + (m2 - m1) * hue * 6;
    if (hue < 0.5) return m2;
    if (hue < 2 / 3) return m1 + (m2 - m1) * (2 / 3 - hue) * 6;
    return m1;
  };
  return [u8(v(h + 1 / 3)), u8(v(h)), u8(v(h - 1 / 3))];
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/**
 * Applies DrawingML colour modifiers (values in file units, 100000 =
 * 100 %) to `base` (RRGGBB); returns the colour and its opacity. Tint and
 * shade mix towards white / black in sRGB, the sat/lum/hue modifiers
 * work in HSL (consecutive ones on unrounded values) – like the core.
 */
export function applyMods(base: string, mods: readonly ColorMod[] | undefined): { rgb: string; alpha: number } {
  let c = hexToRgb(base);
  let hsl: [number, number, number] | null = null;
  let alpha = 1;
  for (const m of mods ?? []) {
    const v = m.value / 100000;
    if (m.kind === "tint" || m.kind === "shade") {
      if (hsl) {
        c = fromHsl(...hsl);
        hsl = null;
      }
      const k = clamp01(v);
      c = c.map((x) => Math.round(m.kind === "tint" ? 255 - (255 - x) * k : x * k)) as RGB;
    } else if (m.kind === "alpha") {
      alpha = clamp01(v);
    } else {
      let [h, s, l]: [number, number, number] = hsl ?? toHsl(c);
      if (m.kind === "satMod") s *= v;
      else if (m.kind === "satOff") s += v;
      else if (m.kind === "lumMod") l *= v;
      else if (m.kind === "lumOff") l += v;
      else if (m.kind === "hueMod") h = (((h * v) % 1) + 1) % 1;
      hsl = [h, clamp01(s), clamp01(l)];
    }
  }
  if (hsl) c = fromHsl(...hsl);
  return { rgb: rgbToHex(c), alpha };
}

/** The scheme colour of `slot` (RRGGBB; Office colours when the theme lacks it). */
export function schemeColor(theme: Theme | undefined, slot: ThemeColorSlot): string {
  const i = SCHEME_SLOTS.indexOf(slot);
  return (theme?.colors.colors[i] ?? OFFICE[i] ?? "000000").replace(/^#/, "").toUpperCase();
}

const OFFICE = ["000000", "FFFFFF", "44546A", "E7E6E6", "4472C4", "ED7D31", "A5A5A5", "FFC000", "5B9BD5", "70AD47", "0563C1", "954F72"];

/** Excel/ECMA tint of a model colour (`core_model::apply_tint`). */
export function tint(hex: string, t: number): string {
  if (!t || Number.isNaN(t)) return hex.toUpperCase();
  const k = Math.max(-1, Math.min(1, t));
  const [h, s, l0] = toHsl(hexToRgb(hex));
  const l = k < 0 ? l0 * (1 + k) : l0 * (1 - k) + k;
  return rgbToHex(fromHsl(h, s, clamp01(l)));
}

/** A model colour as RRGGBB (`Theme::resolve`; auto = Dark 1). */
export function resolveColor(theme: Theme | undefined, c: Color | null | undefined): string {
  if (!c || c.kind === "auto") return schemeColor(theme, "dark1");
  if (c.kind === "rgb") return c.value.toUpperCase();
  return tint(schemeColor(theme, c.value.slot), c.value.tint);
}

/** A format-scheme colour; `placeholder` (RRGGBB) stands for `phClr`. */
export function resolveStyleColor(theme: Theme | undefined, c: StyleColor, placeholder: string): { rgb: string; alpha: number } {
  const b = c.base;
  const base = b.kind === "placeholder" ? placeholder : b.kind === "scheme" ? schemeColor(theme, b.value) : b.value;
  return applyMods(base, c.mods);
}

/** A style fill resolved to RGB. */
export function resolveStyleFill(theme: Theme | undefined, f: StyleFill, placeholder: string): ResolvedFill {
  if (f.kind === "none") return { kind: "none" };
  if (f.kind === "solid") {
    const { rgb, alpha } = resolveStyleColor(theme, f.value, placeholder);
    return { kind: "solid", value: { color: rgb, alpha } };
  }
  const g = f.value;
  return {
    kind: "gradient",
    value: {
      angleDeg: g.angleDeg,
      shape: g.shape,
      stops: g.stops.map((s) => {
        const { rgb, alpha } = resolveStyleColor(theme, s.color, placeholder);
        return { pos: s.pos, color: rgb, alpha };
      }),
    },
  };
}

/** A model fill resolved to RGB. */
export function resolveFill(theme: Theme | undefined, f: Fill | null | undefined): ResolvedFill {
  if (!f || f.kind === "none") return { kind: "none" };
  return { kind: "solid", value: { color: resolveColor(theme, f.value), alpha: 1 } };
}

/**
 * A background resolved to RGB: a style reference `index` 1001… picks
 * `bgFillStyles[index − 1001]`, 1…999 `fillStyles[index − 1]` (out of
 * range: the last style; no styles: the reference colour).
 */
export function resolveBackground(theme: Theme | undefined, bg: Background): ResolvedFill {
  if (bg.kind === "fill") return resolveFill(theme, bg.value);
  const { index, color } = bg.value;
  const ph = resolveColor(theme, color);
  const list = (index >= 1001 ? theme?.format?.bgFillStyles : theme?.format?.fillStyles) ?? [];
  const i = index >= 1001 ? index - 1001 : Math.max(0, index - 1);
  const style = list[i] ?? list[list.length - 1];
  return style ? resolveStyleFill(theme, style, ph) : { kind: "solid", value: { color: ph, alpha: 1 } };
}

/** `rgba()` / `#RRGGBB` of a colour with opacity. */
export function cssRgba(hex: string, alpha = 1): string {
  if (alpha >= 1) return `#${hex}`;
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${Math.round(alpha * 1000) / 1000})`;
}

/** A CSS `background` value of a resolved fill (`undefined` = none). */
export function fillCssBackground(f: ResolvedFill): string | undefined {
  if (f.kind === "none") return undefined;
  if (f.kind === "solid") return cssRgba(f.value.color, f.value.alpha);
  const stops = f.value.stops.map((s) => `${cssRgba(s.color, s.alpha)} ${Math.round(s.pos * 100)}%`).join(", ");
  if (f.value.shape !== "linear") return `radial-gradient(circle, ${stops})`;
  // DrawingML: 0° = left → right, clockwise; CSS: 0deg = bottom → top, clockwise.
  return `linear-gradient(${(f.value.angleDeg + 90) % 360}deg, ${stops})`;
}

/**
 * Konva attributes of a resolved fill over a `w` × `h` box: `fill`, or the
 * linear / radial gradient attributes (DrawingML angle: clockwise from
 * left → right).
 */
export function konvaFill(f: ResolvedFill, w: number, h: number): Record<string, unknown> {
  if (f.kind === "none") return {};
  if (f.kind === "solid") return { fill: cssRgba(f.value.color, f.value.alpha) };
  const stops = f.value.stops.flatMap((s) => [clamp01(s.pos), cssRgba(s.color, s.alpha)]);
  if (f.value.shape !== "linear") {
    return {
      fillRadialGradientStartPoint: { x: w / 2, y: h / 2 },
      fillRadialGradientEndPoint: { x: w / 2, y: h / 2 },
      fillRadialGradientStartRadius: 0,
      fillRadialGradientEndRadius: Math.hypot(w, h) / 2,
      fillRadialGradientColorStops: stops,
    };
  }
  const { start, end } = gradientLine(f.value.angleDeg, w, h);
  return { fillLinearGradientStartPoint: start, fillLinearGradientEndPoint: end, fillLinearGradientColorStops: stops };
}

/** Start and end of a linear gradient at `angleDeg` (clockwise from →) spanning a `w` × `h` box. */
export function gradientLine(angleDeg: number, w: number, h: number): { start: { x: number; y: number }; end: { x: number; y: number } } {
  const a = (angleDeg * Math.PI) / 180;
  const dx = Math.cos(a), dy = Math.sin(a);
  const half = (Math.abs(w * dx) + Math.abs(h * dy)) / 2;
  const cx = w / 2, cy = h / 2;
  const r = (v: number) => Math.round(v * 1000) / 1000 || 0;
  return { start: { x: r(cx - dx * half), y: r(cy - dy * half) }, end: { x: r(cx + dx * half), y: r(cy + dy * half) } };
}
