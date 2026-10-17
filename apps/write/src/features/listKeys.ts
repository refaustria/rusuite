// Word's Backspace at the start of a list item (W-28, P9-W1): the first
// press removes the number or bullet and keeps the text at the level's
// indent (Rust's `ListBackspace`); the second press outdents the paragraph
// to the margin (Word's "set left- and first-indent with tabs and
// backspaces": Backspace at the start of an indented paragraph removes the
// indent); the next one joins it to the previous paragraph.

import type { Editor } from "@tiptap/core";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import type { Indent } from "../generated/Indent";
import type { StyleSheet } from "../generated/StyleSheet";
import type { WriteCommand } from "../generated/WriteCommand";
import { TEXTBLOCK_TYPES } from "../sync/schema";
import type { SyncController } from "../sync/SyncPlugin";
import { paragraphStyleId, resolveParagraph } from "./styleCss";

/** Whether the caret (no selection) is at the very start of a list item's first paragraph. */
export function atListItemStart(state: EditorState): boolean {
  const { selection } = state;
  if (!selection.empty) return false;
  const $from = selection.$from;
  if ($from.parentOffset !== 0 || !TEXTBLOCK_TYPES.has($from.parent.type.name) || $from.depth < 2) return false;
  return $from.node($from.depth - 1).type.name === "listItem" && $from.index($from.depth - 1) === 0;
}

/** `ListBackspace` for the caret's list item, or null (not at an item's start, or its id not confirmed yet). */
export function listBackspaceCommand(state: EditorState): WriteCommand | null {
  if (!atListItemStart(state)) return null;
  const id = state.selection.$from.parent.attrs.id as number | null;
  return id != null && id > 0 ? { type: "listBackspace", block: id } : null;
}

/**
 * Backspace at the start of an indented paragraph outside a list (the second step after the number went): the
 * transaction that moves it to the margin (its left and first-line indents become 0, the right indent stays), or
 * null (not at a paragraph's start, in a list, or not indented).
 */
export function outdentAtStart(state: EditorState, sheet: StyleSheet | null | undefined): Transaction | null {
  const { selection } = state;
  if (!selection.empty) return null;
  const $from = selection.$from;
  const node = $from.parent;
  if ($from.parentOffset !== 0 || !TEXTBLOCK_TYPES.has(node.type.name)) return null;
  for (let d = $from.depth - 1; d > 0; d--) if ($from.node(d).type.name === "listItem") return null;
  const style = resolveParagraph(sheet, paragraphStyleId(sheet, node)).indent ?? {};
  const direct = (node.attrs.indent as Indent | null) ?? {};
  const left = direct.left ?? style.left ?? 0;
  const first = direct.firstLine ?? (direct.hanging != null ? -direct.hanging : (style.firstLine ?? (style.hanging != null ? -style.hanging : 0)));
  if (left <= 0 && first <= 0) return null;
  // Zeros where the style indents, nothing where it does not.
  const next: Indent = { ...direct, left: null, firstLine: null, hanging: null };
  if (style.left) next.left = 0;
  if (style.firstLine || style.hanging) next.firstLine = 0;
  const clean = Object.fromEntries(Object.entries(next).filter(([, v]) => v != null)) as Indent;
  const pos = $from.before();
  return state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: Object.keys(clean).length ? clean : null });
}

/** The Backspace key: true when it handled the key (a list item's start, an indented paragraph's start). */
export function listBackspace(editor: Editor, ctl: SyncController): boolean {
  if (!atListItemStart(editor.state)) {
    const tr = outdentAtStart(editor.state, ctl.styles);
    if (!tr) return false;
    editor.view.dispatch(tr);
    return true;
  }
  void (async () => {
    // A list item just made with Enter gets its real id with the confirming patch.
    await ctl.idle();
    if (editor.isDestroyed) return;
    const cmd = listBackspaceCommand(editor.state);
    if (cmd) await ctl.run(cmd);
  })().catch((e) => ctl.pushError(e));
  return true;
}

