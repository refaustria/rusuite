// Word's Backspace at the start of a list item (W-28): the first press
// removes the number or bullet and keeps the text at the level's indent
// (Rust's `ListBackspace`); the paragraph is then an ordinary one, so the
// next Backspace joins it to the previous paragraph.

import type { Editor } from "@tiptap/core";
import type { EditorState } from "@tiptap/pm/state";
import type { WriteCommand } from "../generated/WriteCommand";
import { TEXTBLOCK_TYPES } from "../sync/schema";
import type { SyncController } from "../sync/SyncPlugin";

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

/** The Backspace key: true when it handled the key (a list item's start). */
export function listBackspace(editor: Editor, ctl: SyncController): boolean {
  if (!atListItemStart(editor.state)) return false;
  void (async () => {
    // A list item just made with Enter gets its real id with the confirming patch.
    await ctl.idle();
    if (editor.isDestroyed) return;
    const cmd = listBackspaceCommand(editor.state);
    if (cmd) await ctl.run(cmd);
  })().catch((e) => ctl.pushError(e));
  return true;
}

