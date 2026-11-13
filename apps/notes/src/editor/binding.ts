// The Loro ↔ ProseMirror binding of a page editor (loro-prosemirror 0.4.4, unpatched): the sync plugin on the
// mirror doc and Loro's UndoManager (local peer only) behind Ctrl+Z / Ctrl+Y.

import { Extension } from "@tiptap/core";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { LoroSyncPlugin, LoroUndoPlugin, redo as loroRedo, undo as loroUndo, type LoroDocType } from "loro-prosemirror";
import type { PageMirror } from "./mirror";

type Dispatch = ((tr: Transaction) => void) | undefined;

export const editorUndo = (state: EditorState, dispatch: Dispatch): boolean => loroUndo(state, dispatch);
export const editorRedo = (state: EditorState, dispatch: Dispatch): boolean => loroRedo(state, dispatch);

/** Binds the editor to `mirror` (create the editor only after the mirror was seeded). */
export function LoroBinding(mirror: PageMirror) {
  return Extension.create({
    name: "loroBinding",
    addProseMirrorPlugins() {
      return [LoroSyncPlugin({ doc: mirror.doc as unknown as LoroDocType }), LoroUndoPlugin({ doc: mirror.doc, undoManager: mirror.undo })];
    },
    addKeyboardShortcuts() {
      return {
        "Mod-z": () => editorUndo(this.editor.state, this.editor.view.dispatch),
        "Mod-y": () => editorRedo(this.editor.state, this.editor.view.dispatch),
        "Mod-Shift-z": () => editorRedo(this.editor.state, this.editor.view.dispatch),
      };
    },
  });
}
