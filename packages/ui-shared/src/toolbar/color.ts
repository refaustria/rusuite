import type { Color, ThemeColorSlot, ThemePalette } from "./types";

export const OFFICE_THEME: Required<
  Pick<ThemePalette, "light1" | "dark1" | "light2" | "dark2" | "accent1" | "accent2" | "accent3" | "accent4" | "accent5" | "accent6">
> = {
  light1: "FFFFFF",
  dark1: "000000",
  light2: "E7E6E6",
  dark2: "44546A",
  accent1: "4472C4",
  accent2: "ED7D31",
  accent3: "A5A5A5",
  accent4: "FFC000",
  accent5: "5B9BD5",
  accent6: "70AD47",
};

/** Column order of the theme grid (like Excel). */
export const THEME_SLOTS: ThemeColorSlot[] = [
  "light1", "dark1", "light2", "dark2",
  "accent1", "accent2", "accent3", "accent4", "accent5", "accent6",
];

/** Row order, top to bottom (like Excel). */
export const TINTS = [0, 0.8, 0.6, 0.4, -0.25, -0.5];

export const STANDARD_COLORS = [
  "C00000", "FF0000", "FFC000", "FFFF00", "92D050",
  "00B050", "00B0F0", "0070C0", "002060", "7030A0",
];

export function isHex6(s: string): boolean {
  return /^[0-9a-fA-F]{6}$/.test(s);
}

function toHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}

function fromHsl(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l, l, l].map((v) => Math.round(v * 255)) as [number, number, number];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)].map((v) => Math.round(v * 255)) as [number, number, number];
}

/** Excel-style tint (luminance shift in HSL). Returns RRGGBB. */
export function applyTint(hex: string, tint: number): string {
  const n = parseInt(hex, 16);
  const [h, s, l0] = toHsl((n >> 16) & 255, (n >> 8) & 255, n & 255);
  const l = tint < 0 ? l0 * (1 + tint) : l0 * (1 - tint) + tint;
  return fromHsl(h, s, Math.min(1, Math.max(0, l)))
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

/** CSS color for a model color, or undefined for auto. */
export function cssColor(c: Color | undefined, theme: ThemePalette): string | undefined {
  if (!c || c.kind === "auto") return undefined;
  if (c.kind === "rgb") return `#${c.value}`;
  const base = theme[c.value.slot] ?? OFFICE_THEME[c.value.slot as keyof typeof OFFICE_THEME];
  return base ? `#${applyTint(base, c.value.tint)}` : undefined;
}
