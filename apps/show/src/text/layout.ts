// Rich-text layout for shape text (ADR 0008 text in DrawingML shape).
// Konva has no rich text, so paragraphs are laid out here into
// positioned single-style fragments, each drawn as its own `Konva.Text`.
//
// Supported: per-run font, size, bold/italic, underline/strike, colour,
// highlight, super/subscript; paragraph alignment (justify renders
// left), outline level indent, bullets (char or auto-number), spacing
// before/after, line spacing; body anchor, wrap, insets and "shrink"
// autofit (the stored `fontScale` / `lineReduction`, else computed with
// `shrinkFit` like PowerPoint: line spacing reduced first, then the font);
// text direction (rotated 90° / 270°: laid out in the swapped box and
// turned by the renderer; stacked: one character per line) and columns
// (lines flow into the next column at the bottom).
// Not supported: kerning/letter spacing, tabs, hyphenation, east-asian
// line breaking, "resize" autofit (text overflows instead), the exact
// PowerPoint line metrics (line height = 1.2 × the largest font).

import type { RunProperties } from "../../../../packages/ui-shared/src/generated/RunProperties";
import type { AutoNumScheme } from "../generated/AutoNumScheme";
import type { Bullet } from "../generated/Bullet";
import type { Hyperlink } from "../generated/Hyperlink";
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
  /** The run's hyperlink (drawn underlined in the theme's hyperlink colour). */
  link?: Hyperlink;
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
  /** The hyperlink of the run the fragment belongs to. */
  link?: Hyperlink;
}

/**
 * Where and how a paragraph is laid out (local px of the text box, from
 * the left inset): what the in-place editor needs to draw the same text
 * with CSS (P8-45 S-01).
 */
export interface ParagraphMetrics {
  /** Outline level (`0..=8`). */
  level: number;
  /** Start of the bullet (the outline indent). */
  indent: number;
  /** Start of the text (after the bullet's hanging indent). */
  textX: number;
  /** The bullet or number (`null` = none; drawn only on paragraphs with text). */
  label: string | null;
  /** Style of the bullet: the paragraph's first run (size before autofit scaling). */
  bulletStyle: RunStyle;
  /** Font size of the first run (autofit scale applied). */
  baseSize: number;
  /** Space before / after the paragraph (px). */
  spaceBefore: number;
  spaceAfter: number;
  /** Line height: fixed px, or a factor of the line's largest font (line spacing reduction applied). */
  lineHeight: { kind: "fixed"; px: number } | { kind: "factor"; value: number };
  /** Alignment as drawn (justify draws left; no wrap: left). */
  alignment: "left" | "center" | "right";
}

export interface TextLayout {
  fragments: Fragment[];
  /** Per paragraph: indents, bullet, spacing, line height (the in-place editor's CSS). */
  paragraphs?: ParagraphMetrics[];
  /** Height of the text (unscaled box coordinates, before anchoring). */
  height: number;
  /** Autofit font scale (1 = none). */
  scale: number;
  /** Autofit line spacing reduction (0 = none). */
  lineReduction?: number;
  /** Rotated text (`vert`): the fragments are laid out in the swapped box; the renderer turns them. */
  rotation?: 90 | 270;
  /** The text does not fit its box (and autofit does not shrink it). */
  overflow?: boolean;
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
  /** Colour of hyperlinks (the theme's `hlink`); absent = the run's own colour. */
  linkColor?: string;
}

/** A run style for a run with a hyperlink: underlined, in the hyperlink colour (PowerPoint). */
export function linkStyle(s: RunStyle, link: Hyperlink, color?: string): RunStyle {
  return { ...s, underline: true, color: color ?? s.color, link };
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

function layoutAt(body: TextBody, o: LayoutOptions, scale: number, reduction = 0): TextLayout {
  const ins = body.props.insets;
  const left = emuToPx(ins.left);
  const top = emuToPx(ins.top);
  const avail = Math.max(1, o.width - left - emuToPx(ins.right));
  const wrap = body.props.wrap;
  const paras = body.paragraphs.map((p) => ({ p, props: o.paragraphProps(p.props) }));
  const labels = bulletLabels(paras.map(({ props }) => ({ bullet: props.bullet, level: props.level ?? 0 })));
  const fragments: Fragment[] = [];
  const metrics: ParagraphMetrics[] = [];
  let y = 0;

  paras.forEach(({ p, props }, pi) => {
    const level = props.level ?? p.props?.level ?? 0;
    const runs = p.runs.map((r) => {
      const style = o.runStyle(r.props, level);
      return { text: r.field && o.fieldText ? o.fieldText(r.field, r.text) : r.text, style: r.hyperlink ? linkStyle(style, r.hyperlink, o.linkColor) : style };
    });
    const firstStyle = runs[0]?.style ?? o.runStyle(undefined, level);
    const baseSize = firstStyle.sizePx * scale;
    const lineFactor = props.lineSpacing?.kind === "percent" ? props.lineSpacing.value / 100000 : 1;
    const fixedLine = props.lineSpacing?.kind === "points" ? (props.lineSpacing.value / 100) * PX_PER_PT * scale : null;
    const indent = (props.level ?? 0) * LEVEL_INDENT_PX;
    const spaceBefore = spacingPx(props.spacingBefore, baseSize * 1.2) * (props.spacingBefore?.kind === "points" ? scale : 1);
    const spaceAfter = spacingPx(props.spacingAfter, baseSize * 1.2) * (props.spacingAfter?.kind === "points" ? scale : 1);
    y += spaceBefore;

    const label = labels[pi] ?? null;
    let textX = indent;
    let bulletFrag: Fragment | null = null;
    if (label !== null) {
      const font = cssFont(firstStyle, baseSize, firstStyle.fontFamily);
      const w = o.measure(label, font);
      const hang = Math.max(w + baseSize * 0.4, baseSize * 1.1);
      if (runs.some((r) => r.text.length > 0)) {
        bulletFrag = {
          x: indent, y: 0, text: label, fontFamily: firstStyle.fontFamily, fontSize: baseSize,
          fontStyle: konvaStyle(firstStyle), textDecoration: "", fill: firstStyle.color, width: w,
        };
      }
      textX = indent + hang;
    }
    const drawnAlign = props.alignment === "center" || props.alignment === "right" ? props.alignment : "left";
    metrics.push({
      level, indent, textX, label, bulletStyle: firstStyle, baseSize, spaceBefore, spaceAfter,
      lineHeight: fixedLine !== null ? { kind: "fixed", px: fixedLine * (1 - reduction) } : { kind: "factor", value: 1.2 * lineFactor * (1 - reduction) },
      alignment: wrap ? drawnAlign : "left",
    });
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
      const lh = (fixedLine ?? maxPx * 1.2 * lineFactor) * (1 - reduction);
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
          width: pc.width, highlight: pc.style.highlight, ...(pc.style.link ? { link: pc.style.link } : {}),
        });
        x += pc.width;
      }
      y += lh;
    });
    y += spaceAfter;
  });

  return { fragments, paragraphs: metrics, height: y + top + emuToPx(ins.bottom), scale, lineReduction: reduction };
}

/** PowerPoint's shrink steps: line spacing reduced first (10 %, 20 %), then the font (92.5 % … 25 %). */
export const SHRINK_STEPS: readonly { fontScale: number; lineReduction: number }[] = [
  { fontScale: 1, lineReduction: 0 },
  { fontScale: 1, lineReduction: 0.1 },
  { fontScale: 1, lineReduction: 0.2 },
  ...[0.925, 0.85, 0.775, 0.7, 0.625, 0.55, 0.475, 0.4, 0.325, 0.25].map((fontScale) => ({ fontScale, lineReduction: 0.2 })),
];

/** The first shrink step at which `body` fits `o.height` (the last step when none does). */
export function shrinkFit(body: TextBody, o: LayoutOptions): { fontScale: number; lineReduction: number } {
  const box = textBox(body, o);
  for (const step of SHRINK_STEPS) {
    if (layoutBox(body, box, step.fontScale, step.lineReduction).height <= box.height + 0.5) return step;
  }
  return SHRINK_STEPS[SHRINK_STEPS.length - 1]!;
}

/** The box the text is laid out in: swapped for rotated text, one character wide for stacked text, one column. */
function textBox(body: TextBody, o: LayoutOptions): LayoutOptions {
  const vert = body.props.vert ?? "horizontal";
  const rotated = vert === "rotate90" || vert === "rotate270";
  let box = rotated ? { ...o, width: o.height, height: o.width } : o;
  const cols = Math.max(1, body.props.columns ?? 1);
  if (vert === "stacked") {
    box = { ...box, width: emuToPx(body.props.insets.left + body.props.insets.right) + 1 };
  } else if (cols > 1) {
    const ins = body.props.insets;
    const avail = box.width - emuToPx(ins.left + ins.right);
    const colW = Math.max(1, (avail - (cols - 1) * emuToPx(body.props.columnSpacing ?? 0)) / cols);
    // all columns' lines in one tall column, split later
    box = { ...box, width: colW + emuToPx(ins.left + ins.right), height: box.height * cols };
  }
  return box;
}

function layoutBox(body: TextBody, box: LayoutOptions, scale: number, reduction: number): TextLayout {
  const stacked = body.props.vert === "stacked";
  return layoutAt(stacked ? { ...body, props: { ...body.props, wrap: true } } : body, box, scale, reduction);
}

/** Lays out `body` in a box of `o.width` × `o.height` px and applies the body anchor. */
export function layoutText(body: TextBody, o: LayoutOptions): TextLayout {
  const props = body.props;
  const vert = props.vert ?? "horizontal";
  const box = textBox(body, o);
  let res: TextLayout;
  if (props.autofit === "shrink") {
    const stored = props.fontScale !== undefined || props.lineReduction !== undefined;
    const step = stored ? { fontScale: (props.fontScale ?? 100000) / 100000, lineReduction: (props.lineReduction ?? 0) / 100000 } : shrinkFit(body, o);
    res = layoutBox(body, box, step.fontScale, step.lineReduction);
  } else {
    res = layoutBox(body, box, 1, 0);
  }
  const cols = Math.max(1, props.columns ?? 1);
  // the box height of one column / the unrotated box
  const height = vert === "rotate90" || vert === "rotate270" ? o.width : o.height;
  if (cols > 1 && vert !== "stacked") {
    const ins = props.insets;
    const top = emuToPx(ins.top);
    const colH = Math.max(1, height - top - emuToPx(ins.bottom));
    const colW = box.width - emuToPx(ins.left + ins.right);
    const gap = emuToPx(props.columnSpacing ?? 0);
    for (const f of res.fragments) {
      const col = Math.min(cols - 1, Math.max(0, Math.floor((f.y - top + f.fontSize * 0.2) / colH)));
      f.x += col * (colW + gap);
      f.y -= col * colH;
    }
    res = { ...res, height: Math.min(res.height, height), overflow: res.height > colH * cols + top + emuToPx(ins.bottom) + 0.5 };
  } else {
    res.overflow = res.height > height + 0.5;
  }
  if (vert === "stacked") {
    // centre the one-character lines in the box
    const w = vert === "stacked" ? o.width : box.width;
    for (const f of res.fragments) f.x = (w - f.width) / 2;
  }
  const anchor = props.anchor;
  const dy = cols > 1 ? 0 : anchor === "middle" ? (height - res.height) / 2 : anchor === "bottom" ? height - res.height : 0;
  if (dy !== 0) for (const f of res.fragments) f.y += dy;
  if (vert === "rotate90" || vert === "rotate270") res.rotation = vert === "rotate90" ? 90 : 270;
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
