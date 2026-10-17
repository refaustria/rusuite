// Format Cells (Ctrl+1, P8-44 / C-08): the state of the six tabs (Number,
// Alignment, Font, Border, Fill, Protection) read from the active cell's
// style, and the commands OK sends – only what the user changed, as one
// undo step (`compound` when more than one command).

import type { Color } from "@rusuite/ui-shared";
import type { BorderEdits } from "../generated/BorderEdits";
import type { BorderSide } from "../generated/BorderSide";
import type { Borders } from "../generated/Borders";
import type { CalcCommand } from "../generated/CalcCommand";
import type { CellStyle } from "../generated/CellStyle";
import type { EdgeEdit } from "../generated/EdgeEdit";
import type { HAlign } from "../generated/HAlign";
import type { PatternType } from "../generated/PatternType";
import type { VAlign } from "../generated/VAlign";
import { DEFAULT_FONT_FAMILY, DEFAULT_FONT_SIZE } from "../grid/style";

export type FormatTab = "number" | "alignment" | "font" | "border" | "fill" | "protection";
export const FORMAT_TABS: FormatTab[] = ["number", "alignment", "font", "border", "fill", "protection"];

/** Format Cells › Border: the eight buttons of the preview. */
export type Edge = "top" | "insideHorizontal" | "bottom" | "diagonalUp" | "left" | "insideVertical" | "right" | "diagonalDown";
export const EDGES: Edge[] = ["top", "insideHorizontal", "bottom", "diagonalUp", "left", "insideVertical", "right", "diagonalDown"];

export type UnderlineKind = "none" | "single" | "double" | "singleAccounting" | "doubleAccounting";
export const UNDERLINE_KINDS: UnderlineKind[] = ["none", "single", "double", "singleAccounting", "doubleAccounting"];
export type ScriptKind = "baseline" | "superscript" | "subscript";

export interface FormatState {
  numberFormat: string;
  horizontal: HAlign;
  vertical: VAlign;
  indent: number;
  wrapText: boolean;
  shrinkToFit: boolean;
  merge: boolean;
  /** Degrees, -90..90. */
  rotation: number;
  fontFamily: string;
  bold: boolean;
  italic: boolean;
  /** Points. */
  fontSize: number;
  underline: UnderlineKind;
  /** `null` = automatic. */
  color: Color | null;
  strike: boolean;
  script: ScriptKind;
  /** Per edge: a line or none. */
  edges: Record<Edge, BorderSide | null>;
  /** `null` = no colour (the background colour of a pattern). */
  fill: Color | null;
  /** Fill › Pattern Style; `null` = none (solid or no fill). */
  pattern: PatternType | null;
  /** Fill › Pattern Color; `null` = automatic. */
  patternColor: Color | null;
  locked: boolean;
  hidden: boolean;
}

const fontName = (style: CellStyle) => {
  const f = style.font?.font;
  if (f?.kind === "named") return f.value;
  if (f?.kind === "theme") return f.value.startsWith("major") ? "Cambria" : "Calibri";
  return DEFAULT_FONT_FAMILY;
};

/** The dialog's starting state from the active cell's effective style; `merged`: the selection is (part of) a merge. */
export function formatState(style: CellStyle, merged = false): FormatState {
  const a = style.alignment ?? {};
  const f = style.font ?? {};
  const b: Borders = style.borders ?? {};
  const u = f.underline;
  return {
    numberFormat: style.numberFormat ?? "General",
    horizontal: a.horizontal ?? "general",
    vertical: a.vertical ?? "bottom",
    indent: a.indent ?? 0,
    wrapText: !!a.wrapText,
    shrinkToFit: !!a.shrinkToFit,
    merge: merged,
    rotation: a.textRotation ?? 0,
    fontFamily: fontName(style),
    bold: !!f.bold,
    italic: !!f.italic,
    fontSize: (f.size ?? DEFAULT_FONT_SIZE) / 100,
    underline: u && u !== "none" ? ((u === "double" ? "double" : "single") + (style.underlineAccounting ? "Accounting" : "")) as UnderlineKind : "none",
    color: f.color ?? null,
    strike: !!f.strike,
    script: f.verticalAlign === "superscript" || f.verticalAlign === "subscript" ? f.verticalAlign : "baseline",
    edges: {
      top: b.top ?? null,
      bottom: b.bottom ?? null,
      left: b.left ?? null,
      right: b.right ?? null,
      // The lines between cells are not known for a range: none until set.
      insideHorizontal: null,
      insideVertical: null,
      diagonalUp: b.diagonalUp ?? null,
      diagonalDown: b.diagonalDown ?? null,
    },
    fill: style.fill?.kind === "solid" ? style.fill.color : style.fill?.kind === "pattern" ? (style.fill.color.bg ?? null) : null,
    pattern: style.fill?.kind === "pattern" ? style.fill.color.pattern : null,
    patternColor: style.fill?.kind === "pattern" ? (style.fill.color.fg ?? null) : null,
    locked: style.protection?.locked ?? true,
    hidden: !!style.protection?.hidden,
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Border presets: None clears every line, Outline sets the four outer ones, Inside the lines between cells. */
export function borderPreset(edges: FormatState["edges"], preset: "none" | "outline" | "inside", line: BorderSide): FormatState["edges"] {
  if (preset === "none") return Object.fromEntries(EDGES.map((e) => [e, null])) as FormatState["edges"];
  const set = preset === "outline" ? (["top", "bottom", "left", "right"] as Edge[]) : (["insideHorizontal", "insideVertical"] as Edge[]);
  const next = { ...edges };
  for (const e of set) next[e] = { ...line };
  return next;
}

/** One border button: toggles the edge (a different line style or colour replaces it). */
export function toggleEdge(edges: FormatState["edges"], edge: Edge, line: BorderSide): FormatState["edges"] {
  const cur = edges[edge];
  return { ...edges, [edge]: cur && same(cur, line) ? null : { ...line } };
}

/** The style patch of the changed Number, Alignment, Font, Fill and Protection fields (`null` when nothing changed). */
export function stylePatch(init: FormatState, next: FormatState): CellStyle | null {
  const patch: CellStyle = {};
  if (next.numberFormat !== init.numberFormat) patch.numberFormat = next.numberFormat;
  const alignment: NonNullable<CellStyle["alignment"]> = {};
  if (next.horizontal !== init.horizontal) alignment.horizontal = next.horizontal;
  if (next.vertical !== init.vertical) alignment.vertical = next.vertical;
  if (next.indent !== init.indent) alignment.indent = next.indent;
  if (next.wrapText !== init.wrapText) alignment.wrapText = next.wrapText;
  if (next.shrinkToFit !== init.shrinkToFit) alignment.shrinkToFit = next.shrinkToFit;
  if (next.rotation !== init.rotation) alignment.textRotation = Math.max(-90, Math.min(90, Math.round(next.rotation)));
  if (Object.keys(alignment).length) patch.alignment = alignment;
  const font: NonNullable<CellStyle["font"]> = {};
  if (next.fontFamily !== init.fontFamily) font.font = { kind: "named", value: next.fontFamily };
  if (next.bold !== init.bold) font.bold = next.bold;
  if (next.italic !== init.italic) font.italic = next.italic;
  if (next.fontSize !== init.fontSize) font.size = Math.round(next.fontSize * 100);
  if (next.underline !== init.underline) {
    font.underline = next.underline.startsWith("double") ? "double" : next.underline === "none" ? "none" : "single";
    patch.underlineAccounting = next.underline.endsWith("Accounting");
  }
  // Automatic colour is the explicit `auto` colour (an absent patch field would keep the old one).
  if (!same(next.color, init.color)) font.color = next.color ?? { kind: "auto" };
  if (next.strike !== init.strike) font.strike = next.strike;
  if (next.script !== init.script) font.verticalAlign = next.script;
  if (Object.keys(font).length) patch.font = font;
  if (!same(next.fill, init.fill) || next.pattern !== init.pattern || !same(next.patternColor, init.patternColor)) {
    patch.fill = next.pattern
      ? { kind: "pattern", color: { pattern: next.pattern, ...(next.patternColor ? { fg: next.patternColor } : {}), ...(next.fill ? { bg: next.fill } : {}) } }
      : next.fill ? { kind: "solid", color: next.fill } : { kind: "none" };
  }
  const protection: NonNullable<CellStyle["protection"]> = {};
  if (next.locked !== init.locked) protection.locked = next.locked;
  if (next.hidden !== init.hidden) protection.hidden = next.hidden;
  if (Object.keys(protection).length) patch.protection = protection;
  return Object.keys(patch).length ? patch : null;
}

/** The changed border edges (`null` when none changed). */
export function borderEdits(init: FormatState, next: FormatState): BorderEdits | null {
  const edits: BorderEdits = {};
  for (const e of EDGES) {
    if (same(init.edges[e], next.edges[e])) continue;
    const side = next.edges[e];
    edits[e] = side ? { kind: "line", side } : { kind: "none" };
  }
  return Object.keys(edits).length ? edits : null;
}

/** The commands OK sends for the selection `r` (empty when nothing changed). */
export function formatCommands(init: FormatState, next: FormatState, sheet: number, r: { r0: number; c0: number; r1: number; c1: number }): CalcCommand[] {
  const out: CalcCommand[] = [];
  const rect = { sheet, r0: r.r0, c0: r.c0, r1: r.r1, c1: r.c1 };
  if (next.merge !== init.merge) {
    const multi = r.r0 !== r.r1 || r.c0 !== r.c1;
    if (next.merge && multi) out.push({ type: "mergeCells", ...rect });
    if (!next.merge) out.push({ type: "unmergeCells", ...rect });
  }
  const patch = stylePatch(init, next);
  if (patch) out.push({ type: "applyStyle", ...rect, patch });
  const edits = borderEdits(init, next);
  if (edits) out.push({ type: "setBorders", ...rect, edits });
  return out;
}

/** The borders of cell `(row, col)` of the range after `edits` (the core's `BorderEdits::apply`; used by the fake core). */
export function applyBorderEdits(b: Borders, row: number, col: number, r: { r0: number; c0: number; r1: number; c1: number }, edits: BorderEdits): Borders {
  const edit = (cur: BorderSide | null | undefined, e: EdgeEdit | undefined) => (e === undefined ? cur : e.kind === "none" ? undefined : e.side);
  const out: Borders = {
    top: edit(b.top, row === r.r0 ? edits.top : edits.insideHorizontal),
    bottom: edit(b.bottom, row === r.r1 ? edits.bottom : edits.insideHorizontal),
    left: edit(b.left, col === r.c0 ? edits.left : edits.insideVertical),
    right: edit(b.right, col === r.c1 ? edits.right : edits.insideVertical),
    diagonalUp: edit(b.diagonalUp, edits.diagonalUp),
    diagonalDown: edit(b.diagonalDown, edits.diagonalDown),
  };
  for (const k of Object.keys(out) as (keyof Borders)[]) if (!out[k]) delete out[k];
  return out;
}
