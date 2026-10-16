// Applying and managing styles from the UI (P8-21): the gallery, the Styles
// pane, the Apply Styles box and the style dialogs build Rust commands here.
// Paragraph styles go through the editor (`setParagraphStyle`, mapped to
// `SetStyle`); character styles, "Update to Match Selection", new / modified
// / renamed / deleted styles are Rust-first commands.

import type { Editor } from "@tiptap/core";
import type { EditorState } from "@tiptap/pm/state";
import { TextSelection } from "@tiptap/pm/state";
import type { RunProperties } from "../../../../packages/ui-shared/src/generated/RunProperties";
import type { ParagraphProperties } from "../generated/ParagraphProperties";
import type { Style } from "../generated/Style";
import type { StyleKind } from "../generated/StyleKind";
import type { StylePatch } from "../generated/StylePatch";
import type { StyleSheet } from "../generated/StyleSheet";
import type { WriteCommand } from "../generated/WriteCommand";
import { canonValue, stableStringify } from "../sync/model";
import { cursorBlock, setParagraphStyle } from "../sync/editorCommands";
import { charOffsetOf, findPos, type SyncController } from "../sync/SyncPlugin";
import { TEXTBLOCK_TYPES } from "../sync/schema";
import { getStyle, isParagraphKind, resolveCharacter, resolveParagraph, resolveRun, uniqueStyleId } from "./styleCss";

/** A char range of one paragraph. */
export interface BlockRange {
  block: number;
  from: number;
  to: number;
  /** The paragraph's length (chars). */
  length: number;
}

/** The selected part of every selected paragraph (char offsets). */
export function selectionRanges(state: EditorState): BlockRange[] {
  const { from, to } = state.selection;
  const out: BlockRange[] = [];
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (!TEXTBLOCK_TYPES.has(node.type.name)) return true;
    if (node.attrs.id == null) return false;
    const start = pos + 1;
    const end = pos + node.nodeSize - 1;
    const length = charOffsetOf(node, node.content.size);
    out.push({
      block: node.attrs.id as number,
      from: charOffsetOf(node, Math.max(from, start) - start),
      to: charOffsetOf(node, Math.min(to, end) - start),
      length,
    });
    return false;
  });
  return out;
}

/** The word around the caret as a range (Word applies a character style to it when nothing is selected). */
export function wordAtCaret(state: EditorState): BlockRange | null {
  const { $from } = state.selection;
  const node = $from.parent;
  if (!node.isTextblock || node.attrs.id == null) return null;
  const text = node.textBetween(0, node.content.size, undefined, "￼");
  const chars = [...text];
  const at = charOffsetOf(node, $from.parentOffset);
  const word = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}_]/u.test(c);
  let a = at;
  let b = at;
  while (a > 0 && word(chars[a - 1])) a--;
  while (b < chars.length && word(chars[b])) b++;
  return a < b ? { block: node.attrs.id as number, from: a, to: b, length: chars.length } : null;
}

const compound = (cmds: WriteCommand[]): WriteCommand | null =>
  cmds.length === 0 ? null : cmds.length === 1 ? cmds[0]! : { type: "compound", commands: cmds };

/** `ApplyCharacterStyle` for ranges (`null` style removes it). */
export function characterStyleCommand(ranges: BlockRange[], style: string | null): WriteCommand | null {
  return compound(ranges.filter((r) => r.from < r.to).map((r) => ({ type: "applyCharacterStyle", block: r.block, from: r.from, to: r.to, style })));
}

export interface ApplyStyleOptions {
  /** Styles pane › Disable Linked Styles: linked styles act as paragraph styles only. */
  linkedDisabled?: boolean;
  /** Paragraphs chosen by "Select All N Instances" (the style goes to all of them). */
  instances?: number[] | null;
}

/**
 * What applying style `id` to the selection means, like Word: a character
 * style formats the selected text (or the word at the caret); a linked
 * style formats the selected text as its character half when only part of
 * one paragraph is selected; otherwise the paragraphs get the style.
 */
export function applyStyleAction(state: EditorState, sheet: StyleSheet | null, id: string, opts: ApplyStyleOptions = {}):
  | { kind: "paragraph" }
  | { kind: "command"; command: WriteCommand }
  | { kind: "none" } {
  const s = getStyle(sheet, id);
  if (!s) return { kind: "none" };
  if (opts.instances?.length && isParagraphKind(s.kind)) {
    return { kind: "command", command: { type: "setStyle", blocks: opts.instances, style: id } };
  }
  if (s.kind === "character") {
    const ranges = state.selection.empty ? [wordAtCaret(state)].filter((r): r is BlockRange => !!r) : selectionRanges(state);
    const cmd = characterStyleCommand(ranges, id);
    return cmd ? { kind: "command", command: cmd } : { kind: "none" };
  }
  if (s.kind === "linked" && !opts.linkedDisabled && !state.selection.empty) {
    const ranges = selectionRanges(state);
    const r = ranges[0];
    if (ranges.length === 1 && r && r.from < r.to && (r.from > 0 || r.to < r.length)) {
      return { kind: "command", command: { type: "applyCharacterStyle", block: r.block, from: r.from, to: r.to, style: id } };
    }
  }
  return isParagraphKind(s.kind) ? { kind: "paragraph" } : { kind: "none" };
}

/** Applies style `id` (see `applyStyleAction`). */
export async function applyStyle(editor: Editor, ctl: SyncController, id: string, opts: ApplyStyleOptions = {}): Promise<void> {
  // A click into the text just before the gallery click may not have reached the editor state yet
  // (ProseMirror reads the DOM selection on `selectionchange`): take it over, or the style lands on the old paragraph.
  const observer = (editor.view as unknown as { domObserver?: { forceFlush?: () => void; flush?: () => void } }).domObserver;
  observer?.forceFlush?.();
  observer?.flush?.();
  const a = applyStyleAction(editor.state, ctl.styles, id, opts);
  if (a.kind === "paragraph") {
    editor.commands.focus();
    setParagraphStyle(editor, id);
  } else if (a.kind === "command") await ctl.run(a.command);
}

/** "Update <style> to Match Selection" at the caret (the selection start). */
export function updateToMatchCommand(editor: Editor, id: string): WriteCommand | null {
  const at = cursorBlock(editor);
  return at ? { type: "updateStyleFromSelection", id, block: at.id, offset: at.offset } : null;
}

/**
 * Word's "Create a Style": a new linked style named `name`, based on the
 * caret paragraph's style, that takes the selection's formatting (the
 * paragraph gets it, its direct formatting goes): `AddStyle` +
 * `UpdateStyleFromSelection` in one undo step.
 */
export function createStyleFromSelectionCommand(editor: Editor, sheet: StyleSheet | null, name: string, basedOn: string): { id: string; command: WriteCommand } | null {
  const at = cursorBlock(editor);
  const trimmed = name.trim();
  if (!at || !trimmed) return null;
  const id = uniqueStyleId(sheet, trimmed);
  const parent = getStyle(sheet, basedOn);
  // Word makes a linked pair ("Memo" + "Memo Char"); the core adds the character half.
  const style: Style = {
    id,
    name: trimmed,
    kind: "linked",
    basedOn: parent && isParagraphKind(parent.kind) ? parent.id : "Normal",
    next: id,
    link: `${id}Char`,
    quickFormat: true,
    custom: true,
    priority: 1,
  } as Style;
  return {
    id,
    command: { type: "compound", commands: [{ type: "addStyle", style }, { type: "updateStyleFromSelection", id, block: at.id, offset: at.offset }] },
  };
}

// ----- the Modify / New Style dialog's values -------------------------------------------

/** What the Modify Style dialog edits: effective formatting (as shown) and the style's settings. */
export interface StyleFormValues {
  name: string;
  kind: StyleKind;
  basedOn: string;
  next: string;
  run: RunProperties;
  paragraph: ParagraphProperties;
  quickFormat: boolean;
  autoRedefine: boolean;
}

/** The dialog's initial values for style `id` (its effective formatting). */
export function styleFormValues(sheet: StyleSheet | null, id: string): StyleFormValues | null {
  const s = getStyle(sheet, id);
  if (!s) return null;
  const para = isParagraphKind(s.kind);
  const p = para ? resolveParagraph(sheet, id) : {};
  delete p.style;
  return {
    name: s.name,
    kind: s.kind,
    basedOn: s.basedOn ?? "",
    next: para ? (s.next ?? s.id) : "",
    run: para ? resolveRun(sheet, id) : resolveCharacter(sheet, id),
    paragraph: p,
    quickFormat: s.quickFormat ?? false,
    autoRedefine: s.autoRedefine ?? false,
  };
}

/** Values for a new style based on `basedOn` (Styles pane › New Style). */
export function newStyleValues(sheet: StyleSheet | null, basedOn: string, kind: StyleKind, name: string): StyleFormValues {
  const para = isParagraphKind(kind);
  const p = para ? resolveParagraph(sheet, basedOn) : {};
  delete p.style;
  return {
    name,
    kind,
    basedOn,
    next: "",
    run: para ? resolveRun(sheet, basedOn) : resolveCharacter(sheet, basedOn),
    paragraph: p,
    quickFormat: true,
    autoRedefine: false,
  };
}

const same = (a: unknown, b: unknown) => stableStringify(canonValue(a ?? null)) === stableStringify(canonValue(b ?? null));

/** The run fields of `after` that differ from `before` (a toggle switched off is an explicit `false`). */
export function runChanges(before: RunProperties, after: RunProperties): RunProperties {
  const out: Record<string, unknown> = {};
  for (const k of ["font", "size", "bold", "italic", "underline", "strike", "color", "highlight", "verticalAlign"] as const) {
    if (same(before[k], after[k])) continue;
    const v = after[k];
    if (v == null) {
      if (k === "bold" || k === "italic" || k === "strike") out[k] = false;
      else if (k === "underline") out[k] = "none";
      else if (k === "verticalAlign") out[k] = "baseline";
      else if (k === "color" || k === "highlight") out[k] = { kind: "auto" };
    } else out[k] = v;
  }
  return out as RunProperties;
}

/** The paragraph fields of `after` that differ from `before`. */
export function paragraphChanges(before: ParagraphProperties, after: ParagraphProperties): ParagraphProperties {
  const out: Record<string, unknown> = {};
  for (const k of ["alignment", "indent", "spacing", "borders", "shading", "numbering", "keepNext", "pageBreakBefore"] as const) {
    if (!same(before[k], after[k]) && after[k] != null) out[k] = after[k];
  }
  return out as ParagraphProperties;
}

/** `UpdateStyle` for the dialog's result (only what changed). */
export function modifyStyleCommand(sheet: StyleSheet | null, id: string, before: StyleFormValues, after: StyleFormValues): WriteCommand | null {
  const s = getStyle(sheet, id);
  if (!s) return null;
  const patch: StylePatch = {};
  if (after.name.trim() && after.name.trim() !== s.name) patch.name = after.name.trim();
  if (after.basedOn !== before.basedOn) patch.basedOn = after.basedOn;
  if (isParagraphKind(s.kind) && after.next !== before.next) patch.next = after.next === id ? "" : after.next;
  const run = runChanges(before.run, after.run);
  if (Object.keys(run).length) patch.run = run;
  const para = paragraphChanges(before.paragraph, after.paragraph);
  if (Object.keys(para).length) patch.paragraph = para;
  if (after.quickFormat !== before.quickFormat) patch.quickFormat = after.quickFormat;
  if (after.autoRedefine !== before.autoRedefine) patch.autoRedefine = after.autoRedefine;
  return Object.keys(patch).length ? { type: "updateStyle", id, patch } : null;
}

/** `AddStyle` for a new style from the dialog (formatting stored where it differs from the parent). */
export function newStyleCommand(sheet: StyleSheet | null, base: StyleFormValues, v: StyleFormValues): { id: string; command: WriteCommand } | null {
  const name = v.name.trim();
  if (!name) return null;
  const id = uniqueStyleId(sheet, name);
  const style: Style = {
    id,
    name,
    kind: v.kind,
    basedOn: v.basedOn || null,
    next: isParagraphKind(v.kind) ? (v.next && v.next !== id ? v.next : null) : null,
    run: runChanges(base.run, v.run),
    paragraph: isParagraphKind(v.kind) ? paragraphChanges(base.paragraph, v.paragraph) : {},
    quickFormat: v.quickFormat,
    autoRedefine: v.autoRedefine,
    custom: true,
    priority: 1,
  } as Style;
  return { id, command: { type: "addStyle", style } };
}

/** "Remove from Style Gallery" / "Add to Style Gallery". */
export const galleryFlagCommand = (id: string, on: boolean): WriteCommand => ({ type: "updateStyle", id, patch: { quickFormat: on } });

// ----- select all instances -----------------------------------------------------------

/** Moves the caret to the start of block `id` and scrolls there; returns whether it was found. */
export function goToBlock(editor: Editor, id: number): boolean {
  const pos = findPos(editor.state.doc, id);
  if (pos < 0) return false;
  const node = editor.state.doc.nodeAt(pos);
  const at = node?.isTextblock ? pos + 1 : pos;
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(at))).scrollIntoView());
  editor.commands.focus();
  try {
    const dom = editor.view.nodeDOM(pos) as HTMLElement | null;
    dom?.scrollIntoView?.({ block: "center" });
  } catch {
    // no layout
  }
  return true;
}

/**
 * Word's "Select All N Instances": the paragraphs using `id` (from Rust);
 * a contiguous run of them becomes the selection, otherwise the caret goes
 * to the first and the UI keeps the list (the next style applies to all).
 */
export async function blocksWithStyle(ctl: SyncController, id: string): Promise<number[]> {
  const reply = await ctl.api.blocksWithStyle(id);
  return reply.ids;
}

/** Selects from the first to the last of `ids` when they are consecutive top-level blocks; returns whether it did. */
export function selectContiguous(editor: Editor, ids: number[]): boolean {
  if (!ids.length) return false;
  const doc = editor.state.doc;
  const idx: number[] = [];
  doc.forEach((node, _off, i) => {
    if (ids.includes(node.attrs.id as number)) idx.push(i);
  });
  if (idx.length !== ids.length || idx[idx.length - 1]! - idx[0]! !== idx.length - 1) return false;
  const first = findPos(doc, ids[0]!);
  const lastPos = findPos(doc, ids[ids.length - 1]!);
  const last = doc.nodeAt(lastPos);
  if (first < 0 || !last) return false;
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(doc, first + 1, lastPos + last.nodeSize - 1)).scrollIntoView());
  editor.commands.focus();
  return true;
}
