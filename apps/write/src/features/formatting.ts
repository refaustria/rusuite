// Formatting details of Word's Home tab: clear formatting (Rust-first
// `ClearFormatting`), superscript/subscript, paragraph spacing and indents
// (node attributes → `SetParagraphProps`), and the format painter.

import type { Editor } from "@tiptap/core";
import type { Mark, Node as PMNode } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import type { Indent } from "../generated/Indent";
import type { LineSpacing } from "../generated/LineSpacing";
import type { Spacing } from "../generated/Spacing";
import type { WriteCommand } from "../generated/WriteCommand";
import { TEXTBLOCK_TYPES } from "../sync/schema";
import { charOffsetOf, type SyncController } from "../sync/SyncPlugin";

/** Textblocks touched by the selection: [node, pos]. */
export function selectedTextblocks(editor: Editor): [PMNode, number][] {
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

/**
 * `ClearFormatting` for every paragraph of the selection (the selected
 * part of its text). `all` also resets the paragraph to Normal (Word's
 * "Clear All Formatting"); otherwise only character formatting goes
 * (Ctrl+Space). With an empty selection and `!all` nothing is sent; the
 * typing formatting at the caret is reset instead.
 */
export function clearFormattingCommand(editor: Editor, all: boolean): WriteCommand | null {
  const { from, to, empty } = editor.state.selection;
  const cmds: WriteCommand[] = [];
  for (const [node, pos] of selectedTextblocks(editor)) {
    if (node.attrs.id == null) continue;
    const start = pos + 1;
    const end = pos + node.nodeSize - 1;
    const a = empty ? 0 : charOffsetOf(node, Math.max(from, start) - start);
    const b = empty ? (all ? charOffsetOf(node, node.content.size) : 0) : charOffsetOf(node, Math.min(to, end) - start);
    if (a === b && !all) continue;
    cmds.push({ type: "clearFormatting", block: node.attrs.id as number, from: a, to: b, paragraph: all });
  }
  if (!cmds.length) return null;
  return cmds.length === 1 ? cmds[0]! : { type: "compound", commands: cmds };
}

export async function clearFormatting(editor: Editor, ctl: SyncController, all: boolean): Promise<void> {
  const cmd = clearFormattingCommand(editor, all);
  if (editor.state.selection.empty) editor.view.dispatch(editor.state.tr.setStoredMarks([]));
  if (cmd) await ctl.run(cmd);
}

/** Toggles superscript or subscript (they exclude each other). */
export function toggleScript(editor: Editor, kind: "superscript" | "subscript"): boolean {
  return editor.chain().focus().toggleMark(kind).run();
}

/** Merges `patch` into the spacing of the selected paragraphs. */
export function setSpacing(editor: Editor, patch: Partial<Spacing>): boolean {
  const tr = editor.state.tr;
  for (const [node, pos] of selectedTextblocks(editor)) {
    const cur = (node.attrs.spacing as Spacing | null) ?? {};
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, spacing: { ...cur, ...patch } });
  }
  if (!tr.docChanged) return false;
  editor.view.dispatch(tr);
  return true;
}

/** Sets the line spacing of the selected paragraphs. */
export const setLineSpacingRule = (editor: Editor, line: LineSpacing): boolean => setSpacing(editor, { line });

/** Merges `patch` into the indentation of the selected paragraphs. */
export function setIndent(editor: Editor, patch: Partial<Indent>): boolean {
  const tr = editor.state.tr;
  for (const [node, pos] of selectedTextblocks(editor)) {
    const cur = (node.attrs.indent as Indent | null) ?? {};
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: { ...cur, ...patch } });
  }
  if (!tr.docChanged) return false;
  editor.view.dispatch(tr);
  return true;
}

/** Spacing of the first selected paragraph (direct formatting). */
export function spacingAt(editor: Editor): Spacing {
  return (selectedTextblocks(editor)[0]?.[0].attrs.spacing as Spacing | null) ?? {};
}

export function indentAt(editor: Editor): Indent {
  return (selectedTextblocks(editor)[0]?.[0].attrs.indent as Indent | null) ?? {};
}

/** Word's 12 pt "Add space before paragraph" toggle (Ctrl+0). */
export function toggleSpaceBefore(editor: Editor): boolean {
  const cur = spacingAt(editor).before ?? 0;
  return setSpacing(editor, { before: cur > 0 ? 0 : 240 });
}

/** The word around position `pos` (letters, digits, `_`), as PM positions, or null. */
export function wordAt(doc: PMNode, pos: number): { from: number; to: number } | null {
  const $pos = doc.resolve(pos);
  const block = $pos.parent;
  if (!block.isTextblock) return null;
  const text = block.textBetween(0, block.content.size, undefined, "￼");
  const isWord = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}_]/u.test(c);
  let a = $pos.parentOffset;
  let b = a;
  while (a > 0 && isWord(text[a - 1])) a--;
  while (b < text.length && isWord(text[b])) b++;
  if (a === b) return null;
  const start = $pos.start();
  return { from: start + a, to: start + b };
}

/**
 * Format painter: `copy` remembers the character formatting at the caret;
 * the next selection made with the mouse (or the word under a click) gets
 * it. `sticky` (double-click on the button) keeps painting until Esc.
 */
export class FormatPainter {
  marks: readonly Mark[] | null = null;
  sticky = false;
  private listeners = new Set<() => void>();

  get active(): boolean {
    return this.marks !== null;
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  copy(editor: Editor, sticky = false): void {
    const { state } = editor;
    this.marks = state.storedMarks ?? state.selection.$from.marks();
    if (state.selection.empty && state.selection.$from.parentOffset === 0) {
      // At a paragraph start the marks of the first character count.
      const first = state.selection.$from.parent.firstChild;
      if (first?.isText) this.marks = first.marks;
    }
    this.sticky = sticky;
    editor.view.dom.classList.add("format-painter");
    this.emit();
  }

  cancel(editor?: Editor | null): void {
    this.marks = null;
    this.sticky = false;
    editor?.view.dom.classList.remove("format-painter");
    this.emit();
  }

  /** Applies the copied formatting to the selection (or the word at the caret). */
  paste(editor: Editor): boolean {
    if (!this.marks) return false;
    const { state } = editor;
    let { from, to } = state.selection;
    if (from === to) {
      const w = wordAt(state.doc, from);
      if (!w) return false;
      ({ from, to } = w);
    }
    const tr = state.tr;
    for (const type of Object.values(state.schema.marks)) tr.removeMark(from, to, type);
    for (const m of this.marks) tr.addMark(from, to, m);
    tr.setSelection(TextSelection.create(tr.doc, from, to));
    editor.view.dispatch(tr);
    if (!this.sticky) this.cancel(editor);
    return true;
  }
}
