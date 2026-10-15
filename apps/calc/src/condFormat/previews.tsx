// Small previews of the conditional formatting galleries and dialogs:
// icon glyphs as SVG (the same paths the canvas draws), data bars, colour
// scales, and a format sample of a highlight rule.

import type { CSSProperties } from "react";
import type { DxfStyle } from "../generated/DxfStyle";
import type { IconSetKind } from "../generated/IconSetKind";
import { ICON_SETS, type Glyph } from "../grid/cf";
import { colorCss } from "../grid/style";

export function GlyphSvg({ glyph, size = 16 }: { glyph: Glyph; size?: number }) {
  return (
    <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 16 16">
      {glyph.map((p, i) => (
        <path key={i} d={p.d} fill={p.fill} fillRule="evenodd" stroke={p.stroke} strokeWidth={p.stroke ? 1 : undefined} />
      ))}
    </svg>
  );
}

/** An icon set as Excel's gallery shows it: highest icon first. */
export function IconSetPreview({ set, size = 16 }: { set: IconSetKind; size?: number }) {
  return (
    <span className="flex gap-0.5">
      {[...ICON_SETS[set]].reverse().map((g, i) => (
        <GlyphSvg key={i} glyph={g} size={size} />
      ))}
    </span>
  );
}

/** Four gradient bars of growing length. */
export function DataBarPreview({ color }: { color: string }) {
  const id = `bar-${color}`;
  return (
    <svg aria-hidden="true" focusable="false" width="32" height="32" viewBox="0 0 32 32">
      <defs>
        <linearGradient id={id}>
          <stop offset="0" stopColor={`#${color}`} />
          <stop offset="1" stopColor="#ffffff" />
        </linearGradient>
      </defs>
      {[10, 18, 26, 14].map((w, i) => (
        <rect key={i} x="2" y={3 + i * 7} width={w} height="5" fill={`url(#${id})`} stroke={`#${color}`} strokeWidth="0.75" />
      ))}
    </svg>
  );
}

/** A 3 × 3 block coloured from the highest (top) to the lowest (bottom) value. */
export function ScalePreview({ colors }: { colors: string[] }) {
  const rows = colors.length === 3 ? [...colors].reverse() : [colors[1]!, mix(colors[0]!, colors[1]!), colors[0]!];
  return (
    <svg aria-hidden="true" focusable="false" width="30" height="30" viewBox="0 0 30 30">
      {rows.map((c, r) => [0, 1, 2].map((k) => <rect key={`${r}${k}`} x={k * 10} y={r * 10} width="10" height="10" fill={`#${c}`} stroke="#ffffff" />))}
    </svg>
  );
}

/** The colour halfway between two RRGGBB colours. */
export function mix(a: string, b: string): string {
  const ch = (s: string, i: number) => parseInt(s.slice(i, i + 2), 16);
  return [0, 2, 4].map((i) => Math.round((ch(a, i) + ch(b, i)) / 2).toString(16).padStart(2, "0")).join("").toUpperCase();
}

/** Inline CSS of a highlight format (the dialogs' preview box). */
export function dxfCss(dxf: DxfStyle | undefined): CSSProperties {
  const css: CSSProperties = {};
  if (!dxf) return css;
  if (dxf.fill) css.backgroundColor = colorCss(dxf.fill);
  if (dxf.fontColor) css.color = colorCss(dxf.fontColor);
  if (dxf.bold) css.fontWeight = "bold";
  if (dxf.italic) css.fontStyle = "italic";
  const deco = [dxf.underline ? "underline" : "", dxf.strike ? "line-through" : ""].filter(Boolean).join(" ");
  if (deco) css.textDecoration = deco;
  const side = dxf.borders?.top ?? dxf.borders?.left;
  if (side) css.border = `1px solid ${colorCss(side.color) ?? "#000"}`;
  return css;
}

/** "AaBbCcYyZz" in the rule's format. */
export function DxfSample({ dxf, label }: { dxf: DxfStyle | undefined; label: string }) {
  return (
    <span
      data-testid="dxf-sample"
      className="inline-flex h-6 min-w-28 items-center justify-center border border-ui-border bg-white px-2 text-sm text-black"
      style={dxfCss(dxf)}
    >
      {label}
    </span>
  );
}
