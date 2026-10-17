// Home › Bullets ▾ / Numbering ▾ / Multilevel List ▾ (P9-W1): Word's list
// libraries, Define New Number Format / Define New Bullet, Set Numbering
// Value. Every choice is one Rust `ApplyNumbering` (a preset id, or an
// explicit level format) for the paragraphs it applies to: the selected
// paragraphs, or with the caret in a list the whole list (Word, W-27).

import type { Editor } from "@tiptap/core";
import type { EditorState } from "@tiptap/pm/state";
import type { Level } from "../generated/Level";
import type { LevelKind } from "../generated/LevelKind";
import type { ListPreset } from "../generated/ListPreset";
import type { Numbering } from "../generated/Numbering";
import type { NumberingRef } from "../generated/NumberingRef";
import type { StyleSheet } from "../generated/StyleSheet";
import type { WriteCommand } from "../generated/WriteCommand";
import { TEXTBLOCK_TYPES } from "../sync/schema";
import type { SyncController } from "../sync/SyncPlugin";
import { listContext, type ListContext } from "../sync/listMapping";
import { levelOf } from "./listIndent";
import { formatNumber } from "./numbers";
import { paragraphStyleId, resolveParagraph } from "./styleCss";

/** Home › Numbering ▾: Word's numbering library. */
export const NUMBERING_PRESETS: ListPreset[] = ["decimal", "decimalParen", "upperRoman", "upperLetter", "lowerLetterParen", "lowerLetter", "lowerRoman"];
/** Home › Bullets ▾: Word's bullet library. */
export const BULLET_PRESETS: ListPreset[] = ["bulletDisc", "bulletCircle", "bulletSquare", "bulletArrow", "bulletCheck", "bulletDiamond", "bulletDash"];
/** Home › Multilevel List ▾: Word's list library (the last four number the Heading 1–9 styles). */
export const MULTILEVEL_PRESETS: ListPreset[] = ["outlineParen", "outlineDecimal", "outlineBullets", "articleSection", "headingDecimal", "headingOutline", "headingChapter"];

/** The format of a single-level preset (kind, template with `%1`), as in the core's `ListPreset::level_format`. */
export const PRESET_FORMATS: Partial<Record<ListPreset, { kind: LevelKind; text: string }>> = {
  decimal: { kind: "decimal", text: "%1." },
  decimalParen: { kind: "decimal", text: "%1)" },
  upperRoman: { kind: "upperRoman", text: "%1." },
  upperLetter: { kind: "upperLetter", text: "%1." },
  lowerLetterParen: { kind: "lowerLetter", text: "%1)" },
  lowerLetter: { kind: "lowerLetter", text: "%1." },
  lowerRoman: { kind: "lowerRoman", text: "%1." },
  bulletDisc: { kind: "bullet", text: "•" },
  bulletCircle: { kind: "bullet", text: "○" },
  bulletSquare: { kind: "bullet", text: "■" },
  bulletArrow: { kind: "bullet", text: "➢" },
  bulletCheck: { kind: "bullet", text: "✓" },
  bulletDiamond: { kind: "bullet", text: "◆" },
  bulletDash: { kind: "bullet", text: "–" },
};

/** Lines of a multilevel preset's preview: [label, heading level or null]. */
export const MULTILEVEL_SAMPLES: Partial<Record<ListPreset, [string, number | null][]>> = {
  outlineParen: [["1)", null], ["a)", null], ["i)", null]],
  outlineDecimal: [["1.", null], ["1.1.", null], ["1.1.1.", null]],
  outlineBullets: [["➢", null], ["■", null], ["•", null]],
  articleSection: [["Article I.", 1], ["Section 1.01", 2], ["(a)", 3]],
  headingDecimal: [["1", 1], ["1.1", 2], ["1.1.1", 3]],
  headingOutline: [["I.", 1], ["A.", 2], ["1.", 3]],
  headingChapter: [["Chapter 1", 1], ["", 2], ["", 3]],
};

/** `template` (`%1` = the number) with the number `n` in `kind`. */
export function sampleLabel(kind: LevelKind, template: string, n: number): string {
  if (kind === "bullet") return template;
  return template.replace(/%[1-9]/g, () => (kind === "none" ? "" : formatNumber(n, kind)));
}

/** The first three labels of a single-level preset ("1." "2." "3."; a bullet three times). */
export function presetSamples(preset: ListPreset): string[] {
  const f = PRESET_FORMATS[preset];
  if (!f) return (MULTILEVEL_SAMPLES[preset] ?? []).map(([l]) => l);
  return [1, 2, 3].map((n) => sampleLabel(f.kind, f.text, n));
}

const isList = (name: string) => name === "bulletList" || name === "orderedList";

/** A paragraph a list command applies to: its id and list level. */
export interface ListTarget {
  id: number;
  level: number;
}

/**
 * The paragraphs a gallery choice applies to: the selected paragraphs (their list levels kept), or with the caret
 * in a list (no selection) every item of that list (W-27).
 */
export function listTargets(state: EditorState): ListTarget[] {
  let { from, to } = state.selection;
  if (from === to) {
    const $c = state.selection.$from;
    for (let d = 1; d <= $c.depth; d++) {
      if (isList($c.node(d).type.name)) {
        from = $c.before(d);
        to = $c.after(d);
        break;
      }
    }
  }
  const items: ListTarget[] = [];
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (!TEXTBLOCK_TYPES.has(node.type.name)) return true;
    const id = node.attrs.id as number | null;
    if (id == null || id < 0) return false;
    // List level: the list nesting (its levels as the mapper computes them).
    const $p = state.doc.resolve(pos);
    let ctx: ListContext | null = null;
    for (let d = 1; d <= $p.depth; d++) if (isList($p.node(d).type.name)) ctx = listContext($p.node(d), ctx);
    items.push({ id, level: Math.min(8, ctx?.level ?? 0) });
    return false;
  });
  return items;
}

/** `ApplyNumbering` with a preset or an explicit level format for `targets`. */
export function listCommand(targets: ListTarget[], spec: { preset: ListPreset } | { format: Level }): WriteCommand {
  const items = targets.map((t) => [t.id, Math.min(8, t.level)] as [number, number]);
  return "preset" in spec ? { type: "applyNumbering", preset: spec.preset, items } : { type: "applyNumbering", format: spec.format, items };
}

/** Applies a gallery choice (or a defined format) to the selection's paragraphs; false when there are none. */
export async function applyListChoice(editor: Editor, ctl: SyncController, spec: { preset: ListPreset } | { format: Level }): Promise<boolean> {
  await ctl.idle();
  const targets = listTargets(editor.state);
  if (!targets.length) return false;
  await ctl.run(listCommand(targets, spec));
  editor.commands.focus();
  return true;
}

/** The numbering of the caret's paragraph: its list item's list, or its style's numbering (numbered headings). */
export function numberingAtCaret(state: EditorState, sheet: StyleSheet | null | undefined): NumberingRef | null {
  const $p = state.selection.$from;
  let ctx: ListContext | null = null;
  let inItem = false;
  for (let d = 1; d <= $p.depth; d++) {
    const name = $p.node(d).type.name;
    if (isList(name)) ctx = listContext($p.node(d), ctx);
    if (name === "listItem") inItem = true;
  }
  if (inItem && ctx && ctx.numId > 0) return { numId: ctx.numId, level: ctx.level };
  const node = $p.parent;
  if (!TEXTBLOCK_TYPES.has(node.type.name)) return null;
  const direct = (node.attrs.extra as { numbering?: NumberingRef } | null)?.numbering;
  const num = direct ?? resolveParagraph(sheet, paragraphStyleId(sheet, node)).numbering ?? null;
  return num && num.numId > 0 ? num : null;
}

/** The caret's list level (for the Define New Number Format / Bullet dialogs' initial values), or null. */
export function levelAtCaret(state: EditorState, numbering: Numbering | null | undefined, sheet: StyleSheet | null | undefined): { level: Level; index: number } | null {
  const num = numberingAtCaret(state, sheet);
  const level = num ? levelOf(numbering, num) : null;
  return level && num ? { level, index: Math.min(8, num.level) } : null;
}

/** The numbered paragraph at the caret (a list item's first paragraph or a numbered heading): its id, or null. */
export function numberedParagraphAtCaret(state: EditorState): number | null {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === "listItem") {
      const p = $from.node(d).firstChild;
      return (p?.attrs.id as number | null) ?? null;
    }
  }
  const node = $from.parent;
  return TEXTBLOCK_TYPES.has(node.type.name) && node.attrs.listLabel ? ((node.attrs.id as number | null) ?? null) : null;
}

/** The number format the Define New Number Format dialog turns into a level: `%1` becomes the level's token. */
export function levelFromFormat(v: { kind: LevelKind; text: string; font: string; alignment: "left" | "center" | "right"; start?: number }, index: number): Level {
  const text = v.kind === "bullet" ? v.text : v.text.replace(/%[1-9]/g, `%${index + 1}`);
  const level: Level = { kind: v.kind, text, start: Math.max(0, Math.floor(v.start ?? 1)) };
  if (v.font.trim()) level.font = { kind: "named", value: v.font.trim() };
  if (v.alignment !== "left") level.alignment = v.alignment;
  return level;
}

/** Whether a format text holds the number (`%1`); a format without one is a fixed text (Word allows it, with no number). */
export function hasNumberToken(text: string): boolean {
  return /%[1-9]/.test(text);
}
