// Rich-text layout for shape text (ADR 0008 text in DrawingML shape).
// Konva has no rich text, so paragraphs are laid out here into
// positioned single-style fragments, each drawn as its own `Konva.Text`.
//
// Supported: per-run font, size, bold/italic, underline/strike, colour,
// highlight, super/subscript; paragraph alignment (justify renders
// left), outline level indent, bullets (char or auto-number), spacing
// before/after, line spacing; body anchor, wrap, insets and "shrink"
// autofit (fonts scaled down until the text fits).
// Not supported: kerning/letter spacing, tabs, hyphenation, east-asian
// line breaking, "resize" autofit (text overflows instead), the exact
// PowerPoint line metrics (line height = 1.2 × the largest font).

import type { RunProperties } from "../../../../packages/ui-shared/src/generated/RunProperties";
import type { AutoNumScheme } from "../generated/AutoNumScheme";
import type { Bullet } from "../generated/Bullet";
import type { TextBody } from "../generated/TextBody";
import type { TextField } from "../generated/TextField";
import type { TextParagraphProps } from "../generated/TextParagraphProps";
import type { TextSpacing } from "../generated/TextSpacing";
import { emuToPx, PX_PER_PT } from "../geometry";

/** Measures the advance width of `text` in CSS px for a CSS `font` shorthand. */
export type Measure = (text: string, font: string) => number;

/** A resolved run style. */
export interface RunStyle {
  fontFamily: string;
  /** Font size in px (before autofit scaling). */
  sizePx: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  color: string;
  highlight?: string;
  verticalAlign?: "superscript" | "subscript";
}

/** A positioned piece of text with one style (local px of the text box). */
export interface Fragment {
  x: number;
  y: number;
  text: string;
  fontFamily: string;
  fontSize: number;
  /** Konva `fontStyle`: `normal`, `bold`, `italic` or `italic bold`. */
  fontStyle: string;
  /** Konva `textDecoration`: `""`, `underline`, `line-through` or both. */
  textDecoration: string;
  fill: string;
  width: number;
  highlight?: string;
}

export interface TextLayout {
  fragments: Fragment[];
  /** Height of the text (unscaled box coordinates, before anchoring). */
  height: number;
  /** Autofit font scale (1 = none). */
  scale: number;
}

export interface LayoutOptions {
  /** Box size in px (the shape box; insets are applied here). */
  width: number;
  height: number;
  measure: Measure;
  /** Resolves a run's style (placeholder defaults of the paragraph's outline `level`, theme fonts, colours). */
  runStyle: (props: RunProperties | undefined, level?: number) => RunStyle;
  /** Effective paragraph properties (placeholder defaults merged). */
  paragraphProps: (props: TextParagraphProps | undefined) => TextParagraphProps;
  /** The text a field run shows (slide number, date); absent = the run's stored text. */
  fieldText?: (field: TextField, stored: string) => string;
}

const LEVEL_INDENT_PX = 48; // 0.5"

export function cssFont(s: { italic: boolean; bold: boolean }, sizePx: number, family: string): string {
  return `${s.italic ? "italic " : ""}${s.bold ? "bold " : ""}${sizePx}px ${family}`;
}

const konvaStyle = (s: RunStyle) => (s.italic && s.bold ? "italic bold" : s.italic ? "italic" : s.bold ? "bold" : "normal");
const konvaDecoration = (s: RunStyle) => [s.underline ? "underline" : "", s.strike ? "line-through" : ""].filter(Boolean).join(" ");

function toRoman(n: number): string {
  const table: [number, string][] = [
    [1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"],
    [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"],
  ];
  let out = "";
  for (const [v, s] of table) while (n >= v) { out += s; n -= v; }
  return out;
}

function toAlpha(n: number): string {
  let out = "";
  while (n > 0) {
    n--;
    out = String.fromCharCode(97 + (n % 26)) + out;
    n = Math.floor(n / 26);
  }
  return out;
}

/** The label of item `n` (1-based) of an auto-numbered list. */
export function autoNumLabel(scheme: AutoNumScheme, n: number): string {
  switch (scheme) {
    case "arabicPeriod": return `${n}.`;
    case "arabicParenR": return `${n})`;
    case "alphaLcPeriod": return `${toAlpha(n)}.`;
    case "alphaUcPeriod": return `${toAlpha(n).toUpperCase()}.`;
    case "romanLcPeriod": return `${toRoman(n)}.`;
    case "romanUcPeriod": return `${toRoman(n).toUpperCase()}.`;
  }
}

/** Bullet labels per paragraph (`null` = no bullet); numbering restarts after an unnumbered paragraph at the same level. */
export function bulletLabels(bullets: { bullet: Bullet | null | undefined; level: number }[]): (string | null)[] {
  const counters = new Map<number, { scheme: string; n: number }>();
  return bullets.map(({ bullet, level }) => {
    for (const l of [...counters.keys()]) if (l > level) counters.delete(l);
    if (!bullet || bullet.kind === "none") {
      counters.delete(level);
      return null;
    }
    if (bullet.kind === "char") {
      counters.delete(level);
      return bullet.value;
    }
    const c = counters.get(level);
    const n = c && c.scheme === bullet.value ? c.n + 1 : 1;
    counters.set(level, { scheme: bullet.value, n });
    return autoNumLabel(bullet.value, n);
  });
}

function spacingPx(s: TextSpacing | null | undefined, lineHeight: number): number {
  if (!s) return 0;
  return s.kind === "points" ? (s.value / 100) * PX_PER_PT : (s.value / 100000) * lineHeight;
}

interface Token {
  text: string;
  style: RunStyle;
  space: boolean;
}

function tokenize(runs: { text: string; style: RunStyle }[]): Token[] {
  const out: Token[] = [];
  for (const r of runs) {
    for (const piece of r.text.split(/(\s+)/)) {
      if (piece) out.push({ text: piece, style: r.style, space: /^\s+$/.test(piece) });
    }
  }
  return out;
}

const effSize = (s: RunStyle, scale: number) => s.sizePx * scale * (s.verticalAlign ? 0.65 : 1);

function layoutAt(body: TextBody, o: LayoutOptions, scale: number): TextLayout {
  const ins = body.props.insets;
  const left = emuToPx(ins.left);
  const top = emuToPx(ins.top);
  const avail = Math.max(1, o.width - left - emuToPx(ins.right));
  const wrap = body.props.wrap;
  const paras = body.paragraphs.map((p) => ({ p, props: o.paragraphProps(p.props) }));
  const labels = bulletLabels(paras.map(({ props }) => ({ bullet: props.bullet, level: props.level ?? 0 })));
  const fragments: Fragment[] = [];
  let y = 0;

  paras.forEach(({ p, props }, pi) => {
    const level = props.level ?? p.props?.level ?? 0;
    const runs = p.runs.map((r) => ({ text: r.field && o.fieldText ? o.fieldText(r.field, r.text) : r.text, style: o.runStyle(r.props, level) }));
    const firstStyle = runs[0]?.style ?? o.runStyle(undefined, level);
    const baseSize = firstStyle.sizePx * scale;
    const lineFactor = props.lineSpacing?.kind === "percent" ? props.lineSpacing.value / 100000 : 1;
    const fixedLine = props.lineSpacing?.kind === "points" ? (props.lineSpacing.value / 100) * PX_PER_PT * scale : null;
    const indent = (props.level ?? 0) * LEVEL_INDENT_PX;
    y += spacingPx(props.spacingBefore, baseSize * 1.2) * (props.spacingBefore?.kind === "points" ? scale : 1);

    const label = labels[pi];
    let textX = indent;
    let bulletFrag: Fragment | null = null;
    if (label !== null && label !== undefined && runs.some((r) => r.text.length > 0)) {
      const font = cssFont(firstStyle, baseSize, firstStyle.fontFamily);
      const w = o.measure(label, font);
      const hang = Math.max(w + baseSize * 0.4, baseSize * 1.1);
      bulletFrag = {
        x: indent, y: 0, text: label, fontFamily: firstStyle.fontFamily, fontSize: baseSize,
        fontStyle: konvaStyle(firstStyle), textDecoration: "", fill: firstStyle.color, width: w,
      };
      textX = indent + hang;
    }
    const lineWidth = Math.max(1, avail - textX);

    // Greedy line breaking.
    type Piece = { text: string; style: RunStyle; width: number; space: boolean };
    const lines: Piece[][] = [[]];
    let used = 0;
    const measure = (t: string, s: RunStyle) => o.measure(t, cssFont(s, effSize(s, scale), s.fontFamily));
    for (const tok of tokenize(runs)) {
      const line = lines[lines.length - 1]!;
      const w = measure(tok.text, tok.style);
      if (!wrap || tok.space || used + w <= lineWidth) {
        if (tok.space && line.length === 0 && lines.length > 1) continue; // no leading spaces on wrapped lines
        line.push({ ...tok, width: w });
        used += w;
        continue;
      }
      if (w > lineWidth) {
        // Break a long word by characters.
        let rest = Array.from(tok.text);
        let cur = line;
        while (rest.length) {
          let n = rest.length;
          while (n > 1 && used + measure(rest.slice(0, n).join(""), tok.style) > lineWidth) n--;
          if (used > 0 && used + measure(rest.slice(0, 1).join(""), tok.style) > lineWidth) {
            cur = [];
            lines.push(cur);
            used = 0;
            continue;
          }
          const text = rest.slice(0, n).join("");
          const pw = measure(text, tok.style);
          cur.push({ text, style: tok.style, width: pw, space: false });
          used += pw;
          rest = rest.slice(n);
          if (rest.length) {
            cur = [];
            lines.push(cur);
            used = 0;
          }
        }
        continue;
      }
      lines.push([{ ...tok, width: w }]);
      used = w;
    }

    lines.forEach((raw, li) => {
      while (raw.length && raw[raw.length - 1]!.space) raw.pop();
      // Coalesce neighbouring pieces of one run style into one fragment.
      const line: Piece[] = [];
      for (const pc of raw) {
        const last = line[line.length - 1];
        if (last && last.style === pc.style) line[line.length - 1] = { ...last, text: last.text + pc.text, width: last.width + pc.width };
        else line.push({ ...pc });
      }
      const maxPx = line.reduce((m, pc) => Math.max(m, pc.style.sizePx * scale), line.length ? 0 : baseSize);
      const lh = fixedLine ?? maxPx * 1.2 * lineFactor;
      const baseline = y + (lh - maxPx) / 2 + maxPx * 0.85;
      const width = line.reduce((s, pc) => s + pc.width, 0);
      const align = props.alignment ?? "left";
      const shift = align === "center" ? (lineWidth - width) / 2 : align === "right" ? lineWidth - width : 0;
      let x = left + textX + Math.max(0, wrap ? shift : 0);
      if (li === 0 && bulletFrag) {
        bulletFrag.x = left + bulletFrag.x + (wrap && align !== "left" && align !== "justify" ? shift : 0);
        bulletFrag.y = top + baseline - baseSize * 0.85;
        fragments.push(bulletFrag);
      }
      for (const pc of line) {
        const size = effSize(pc.style, scale);
        const raise = pc.style.verticalAlign === "superscript" ? -maxPx * 0.35 : pc.style.verticalAlign === "subscript" ? maxPx * 0.12 : 0;
        fragments.push({
          x, y: top + baseline - size * 0.85 + raise, text: pc.text, fontFamily: pc.style.fontFamily, fontSize: size,
          fontStyle: konvaStyle(pc.style), textDecoration: konvaDecoration(pc.style), fill: pc.style.color,
          width: pc.width, highlight: pc.style.highlight,
        });
        x += pc.width;
      }
      y += lh;
    });
    y += spacingPx(props.spacingAfter, baseSize * 1.2) * (props.spacingAfter?.kind === "points" ? scale : 1);
  });

  return { fragments, height: y + top + emuToPx(ins.bottom), scale };
}

/** Lays out `body` in a box of `o.width` × `o.height` px and applies the body anchor. */
export function layoutText(body: TextBody, o: LayoutOptions): TextLayout {
  let res = layoutAt(body, o, 1);
  if (body.props.autofit === "shrink" && res.height > o.height) {
    for (let s = 0.9; s >= 0.25; s -= 0.05) {
      res = layoutAt(body, o, s);
      if (res.height <= o.height) break;
    }
  }
  const anchor = body.props.anchor;
  const dy = anchor === "middle" ? (o.height - res.height) / 2 : anchor === "bottom" ? o.height - res.height : 0;
  if (dy !== 0) for (const f of res.fragments) f.y += dy;
  return res;
}

// --- measuring ---------------------------------------------------------

let ctx: CanvasRenderingContext2D | null | undefined;

/** Rough metrics for environments without a canvas (tests). */
export const approxMeasure: Measure = (text, font) => {
  const m = /(\d+(?:\.\d+)?)px/.exec(font);
  return Array.from(text).length * (m ? Number(m[1]) : 16) * 0.5;
};

let override: Measure | null = null;

/** Replaces the measurer (tests). `null` restores the canvas measurer. */
export function setMeasure(m: Measure | null): void {
  override = m;
}

/** Canvas-based text measuring (falls back to [`approxMeasure`]). */
export const measureText: Measure = (text, font) => {
  if (override) return override(text, font);
  if (ctx === undefined) {
    try {
      ctx = typeof document !== "undefined" && !/jsdom/i.test(navigator.userAgent)
        ? document.createElement("canvas").getContext("2d")
        : null;
    } catch {
      ctx = null;
    }
  }
  if (!ctx) return approxMeasure(text, font);
  ctx.font = font;
  return ctx.measureText(text).width;
};
