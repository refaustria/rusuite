// Word's character and paragraph shortcuts beyond the ribbon (W-30):
// Ctrl+] / Ctrl+[ (font size ±1 pt), Ctrl+Shift+> / < (the next size of
// the font size list), Ctrl+Shift+K / A / D (small caps, all caps, double
// underline), Shift+F3 (cycle the case), Ctrl+T / Ctrl+Shift+T (hanging
// indent), Ctrl+Q (remove paragraph formatting). The run changes are mark
// edits (the mapper sends `SetRunProps`), the paragraph changes node
// attributes; Shift+F3 is Rust's `ChangeCase`.

import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { Indent } from "../generated/Indent";
import type { StyleSheet } from "../generated/StyleSheet";
import type { TextCase } from "../generated/TextCase";
import type { WriteCommand } from "../generated/WriteCommand";
import { linkFromMarks, propsFromMarks, styleFromMarks } from "../sync/fromPM";
import type { RunProperties } from "../sync/model";
import { TEXTBLOCK_TYPES } from "../sync/schema";
import { marksFromProps } from "../sync/toPM";
import { changeCaseCommand } from "./changeCase";
import { resolvedRunAt } from "./fontBox";
import { wordAt } from "./formatting";
import { patchRun, type RunPatch } from "./runFormat";
import { overlayRun, paragraphStyleId, resolveCharacter, resolveParagraph, resolveRun } from "./styleCss";

// ----- font size ---------------------------------------------------------------------

/** Word's font size list (points), the steps of Grow / Shrink Font. */
export const WORD_FONT_STEPS = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72];

/** Word's fallback size (hundredths of a point) when nothing sets one. */
const DEFAULT_SIZE = 1000;

/** Ctrl+] / Ctrl+[: the size (hundredths of a point) `delta` points bigger, 1 to 1638 pt. */
export function stepFontPoint(size: number, delta: 1 | -1): number {
  return Math.max(100, Math.min(163800, Math.round(size / 100 + delta) * 100));
}

/** Ctrl+Shift+> / <: the next size of Word's list up / down; above 72 pt in steps of 10, below 8 pt by 1. */
export function stepFontList(size: number, dir: 1 | -1): number {
  const pt = size / 100;
  if (dir > 0) {
    const next = WORD_FONT_STEPS.find((s) => s > pt + 1e-9);
    return Math.min(163800, Math.round((next ?? (Math.floor(pt / 10) + 1) * 10) * 100));
  }
  const last = WORD_FONT_STEPS[WORD_FONT_STEPS.length - 1]!;
  if (pt > last + 1e-9) return Math.max(last, Math.ceil(pt / 10 - 1) * 10) * 100;
  const prev = [...WORD_FONT_STEPS].reverse().find((s) => s < pt - 1e-9);
  return Math.round((prev ?? Math.max(1, Math.ceil(pt) - 1)) * 100);
}

/** The effective run formatting of a text node in `para` (styles, character style, direct). */
function resolvedOf(sheet: StyleSheet | null | undefined, para: PMNode, node: PMNode): RunProperties {
  let out: RunProperties = resolveRun(sheet, paragraphStyleId(sheet, para));
  const cs = styleFromMarks(node.marks);
  if (cs) out = overlayRun(out, resolveCharacter(sheet, cs));
  return overlayRun(out, propsFromMarks(node.marks));
}

/**
 * Applies a patch computed per text node from its effective formatting (each run grows from its own size, as in
 * Word); at a caret the typing formatting changes.
 */
export function applyRunPatchEach(editor: Editor, sheet: StyleSheet | null | undefined, patchOf: (resolved: RunProperties) => RunPatch): boolean {
  const { state } = editor;
  const { from, to, empty } = state.selection;
  const schema = state.schema;
  const tr = state.tr;
  if (empty) {
    const marks = state.storedMarks ?? state.selection.$from.marks();
    const props = patchRun(propsFromMarks(marks), patchOf(resolvedRunAt(state, sheet)));
    editor.view.dispatch(tr.setStoredMarks(marksFromProps(schema, props, styleFromMarks(marks), linkFromMarks(marks))));
    return true;
  }
  state.doc.nodesBetween(from, to, (node, pos, parent) => {
    if (!node.isText || !parent) return true;
    const start = Math.max(from, pos);
    const end = Math.min(to, pos + node.nodeSize);
    const props = patchRun(propsFromMarks(node.marks), patchOf(resolvedOf(sheet, parent, node)));
    const marks = marksFromProps(schema, props, styleFromMarks(node.marks), linkFromMarks(node.marks));
    for (const m of node.marks) tr.removeMark(start, end, m.type);
    for (const m of marks) tr.addMark(start, end, m);
    return false;
  });
  if (!tr.docChanged) return false;
  editor.view.dispatch(tr);
  return true;
}

/** Ctrl+] / Ctrl+[ (`"point"`) and Ctrl+Shift+> / < (`"list"`). */
export function growFont(editor: Editor, sheet: StyleSheet | null | undefined, how: "point" | "list", dir: 1 | -1): boolean {
  return applyRunPatchEach(editor, sheet, (r) => ({ size: (how === "point" ? stepFontPoint : stepFontList)(r.size ?? DEFAULT_SIZE, dir) }));
}

// ----- character toggles ---------------------------------------------------------------

export type CharToggle = "smallCaps" | "allCaps" | "doubleUnderline";

/** The patch of a toggle given the formatting at the selection's start (small caps and all caps exclude each other). */
export function togglePatch(kind: CharToggle, at: RunProperties): RunPatch {
  switch (kind) {
    case "smallCaps":
      return at.smallCaps ? { smallCaps: false } : { smallCaps: true, allCaps: false };
    case "allCaps":
      return at.allCaps ? { allCaps: false } : { allCaps: true, smallCaps: false };
    case "doubleUnderline":
      return { underline: at.underline === "double" ? null : "double" };
  }
}

/** Ctrl+Shift+K / A / D: one toggle decided by the selection's start, applied to the whole selection. */
export function toggleChar(editor: Editor, sheet: StyleSheet | null | undefined, kind: CharToggle): boolean {
  const patch = togglePatch(kind, resolvedRunAt(editor.state, sheet));
  return applyRunPatchEach(editor, sheet, () => patch);
}

/**
 * Ctrl+Shift+W (Word's word underline): the words of the selection get a single underline, the spaces between
 * them none; pressed where the selection's start is underlined, the underline goes. (The model has no `words`
 * underline kind: the result is stored as underlined words, which looks the same in Word.)
 */
export function wordUnderline(editor: Editor, sheet: StyleSheet | null | undefined): boolean {
  const { state } = editor;
  const at = resolvedRunAt(state, sheet);
  const on = !at.underline || at.underline === "none";
  const { from, to, empty } = state.selection;
  if (empty) return applyRunPatchEach(editor, sheet, () => ({ underline: on ? "single" : null }));
  const schema = state.schema;
  const tr = state.tr;
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText) return true;
    const start = Math.max(from, pos);
    const end = Math.min(to, pos + node.nodeSize);
    const text = node.text!.slice(start - pos, end - pos);
    let offset = start;
    for (const part of text.split(/(\s+)/u)) {
      if (!part) continue;
      const a = offset;
      const b = offset + part.length;
      offset = b;
      const props = patchRun(propsFromMarks(node.marks), { underline: on && !/^\s+$/u.test(part) ? "single" : null });
      const marks = marksFromProps(schema, props, styleFromMarks(node.marks), linkFromMarks(node.marks));
      for (const m of node.marks) tr.removeMark(a, b, m.type);
      for (const m of marks) tr.addMark(a, b, m);
    }
    return false;
  });
  if (!tr.docChanged) return false;
  editor.view.dispatch(tr);
  return true;
}

// ----- Shift+F3 ---------------------------------------------------------------------------

/** Whether `text` ends a sentence (`.`, `!` or `?`, closing quotes and brackets after it allowed). */
export function endsSentence(text: string): boolean {
  return /[.!?]["'”’»)\]]*\s*$/u.test(text);
}

/**
 * The next case of Shift+F3 (Word): lowercase → Capitalize Each Word → UPPERCASE → lowercase; a selection that
 * ends a sentence cycles through Sentence case instead of Capitalize Each Word. Mixed text becomes UPPERCASE.
 */
export function nextCase(text: string): TextCase {
  const letters = [...text].filter((c) => c.toLowerCase() !== c.toUpperCase());
  if (!letters.length) return "upper";
  if (letters.every((c) => c === c.toUpperCase())) return "lower";
  if (letters.every((c) => c === c.toLowerCase())) return endsSentence(text) ? "sentence" : "capitalize";
  return "upper";
}

/** The text Shift+F3 changes: the selection, else the word at the caret (after a sentence's end: the word before it). */
function caseTarget(editor: Editor): string {
  const { state } = editor;
  const { from, to, empty } = state.selection;
  if (!empty) return state.doc.textBetween(from, to, " ", " ");
  const w = wordAt(state.doc, from) ?? wordBefore(state.doc, from);
  return w ? state.doc.textBetween(w.from, w.to) : "";
}

/** The word ending before position `pos` across punctuation (`end.|` → `end`), or null. */
export function wordBefore(doc: PMNode, pos: number): { from: number; to: number } | null {
  const $pos = doc.resolve(pos);
  const block = $pos.parent;
  if (!block.isTextblock) return null;
  const text = block.textBetween(0, $pos.parentOffset, undefined, "￼");
  const m = /([\p{L}\p{N}_']+)[^\p{L}\p{N}_\s]*$/u.exec(text);
  if (!m) return null;
  const start = $pos.start() + m.index;
  return { from: start, to: start + m[1]!.length };
}

/** Shift+F3: `ChangeCase` with the next case of the selection (or the word at the caret), or null. */
export function cycleCaseCommand(editor: Editor): WriteCommand | null {
  const text = caseTarget(editor);
  return text.trim() ? changeCaseCommand(editor, nextCase(text)) : null;
}

// ----- paragraph ------------------------------------------------------------------------------

/** Word's default tab stop (twips): the step of Ctrl+T. */
export const HANGING_STEP = 720;

/**
 * Ctrl+T (`1`) / Ctrl+Shift+T (`-1`): the text moves one step right / left while the first line stays where it is
 * (the hanging indent grows / shrinks). `ind` is the effective indent.
 */
export function hangingIndent(ind: Indent, dir: 1 | -1): Indent {
  const left = ind.left ?? 0;
  const hanging = ind.hanging ?? (ind.firstLine != null ? -ind.firstLine : 0);
  const first = left - hanging;
  const h = dir > 0 ? Math.max(0, hanging) + HANGING_STEP : Math.max(0, hanging - HANGING_STEP);
  return { left: Math.max(0, first + h), hanging: h };
}

/** The textblocks of the selection: [node, pos]. */
function textblocks(editor: Editor): [PMNode, number][] {
  const { from, to } = editor.state.selection;
  const out: [PMNode, number][] = [];
  editor.state.doc.nodesBetween(from, to, (node, pos) => {
    if (TEXTBLOCK_TYPES.has(node.type.name)) {
      out.push([node, pos]);
      return false;
    }
    return true;
  });
  return out;
}

/** The effective indent of a textblock (style chain, then its direct indent). */
export function effectiveIndent(sheet: StyleSheet | null | undefined, node: PMNode): Indent {
  const style = resolveParagraph(sheet, paragraphStyleId(sheet, node)).indent ?? {};
  const direct = (node.attrs.indent as Indent | null) ?? {};
  const out: Indent = { ...style };
  for (const [k, v] of Object.entries(direct)) if (v != null) (out as Record<string, unknown>)[k] = v;
  if (direct.firstLine != null) delete out.hanging;
  if (direct.hanging != null) delete out.firstLine;
  return out;
}

/** Ctrl+T / Ctrl+Shift+T on the selected paragraphs. */
export function stepHangingIndent(editor: Editor, sheet: StyleSheet | null | undefined, dir: 1 | -1): boolean {
  const tr = editor.state.tr;
  for (const [node, pos] of textblocks(editor)) {
    const next = hangingIndent(effectiveIndent(sheet, node), dir);
    const cur = { ...((node.attrs.indent as Indent | null) ?? {}) };
    delete cur.firstLine;
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: { ...cur, left: next.left, hanging: next.hanging } });
  }
  if (!tr.docChanged) return false;
  editor.view.dispatch(tr);
  return true;
}

/** Paragraph properties Ctrl+Q keeps (not paragraph formatting: list membership, the section break, the mark's run formatting). */
const KEPT_EXTRA = new Set(["numbering", "sectionEnd", "runDefaults"]);

/** The attributes of a textblock without its direct paragraph formatting (its style stays). */
export function withoutParagraphFormatting(attrs: Record<string, unknown>): Record<string, unknown> {
  const extra = (attrs.extra as Record<string, unknown> | null) ?? {};
  const kept = Object.fromEntries(Object.entries(extra).filter(([k]) => KEPT_EXTRA.has(k)));
  return { ...attrs, align: null, indent: null, spacing: null, extra: Object.keys(kept).length ? kept : null };
}

/** Ctrl+Q: removes the direct paragraph formatting of the selected paragraphs (alignment, indents, spacing, borders…). */
export function removeParagraphFormatting(editor: Editor): boolean {
  const tr = editor.state.tr;
  for (const [node, pos] of textblocks(editor)) tr.setNodeMarkup(pos, undefined, withoutParagraphFormatting(node.attrs));
  if (!tr.docChanged) return false;
  editor.view.dispatch(tr);
  return true;
}
