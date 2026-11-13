// The Loro ↔ ProseMirror binding of a page editor (loro-prosemirror 0.4.4, unpatched): the sync plugin on the
// mirror doc and Loro's UndoManager (local peer only) behind Ctrl+Z / Ctrl+Y.

import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { LoroSyncPlugin, LoroUndoPlugin, loroSyncPluginKey, redo as loroRedo, undo as loroUndo, type LoroDocType } from "loro-prosemirror";
import type { PageMirror } from "./mirror";

type Dispatch = ((tr: Transaction) => void) | undefined;

export const editorUndo = (state: EditorState, dispatch: Dispatch): boolean => loroUndo(state, dispatch);
export const editorRedo = (state: EditorState, dispatch: Dispatch): boolean => loroRedo(state, dispatch);

/**
 * Binds the editor to `mirror` (create the editor only after the mirror was seeded). `cursors` (the remote cursor
 * plugin) must come after the sync plugin: it reads the sync plugin's state of the same transaction.
 */
export function LoroBinding(mirror: PageMirror, cursors?: () => Plugin) {
  return Extension.create({
    name: "loroBinding",
    addProseMirrorPlugins() {
      return [LoroSyncPlugin({ doc: mirror.doc as unknown as LoroDocType }), LoroUndoPlugin({ doc: mirror.doc, undoManager: mirror.undo }), selectionKeeper(), ...(cursors ? [cursors()] : [])];
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

const keeperKey = new PluginKey("notesSelectionKeeper");

/** Maps a position of `before` into `after` around the one changed range between them. */
export function mapAcrossDiff(before: PMNode, after: PMNode, pos: number): number {
  const start = before.content.findDiffStart(after.content);
  if (start === null) return pos;
  const end = before.content.findDiffEnd(after.content);
  let a = end?.a ?? before.content.size;
  let b = end?.b ?? after.content.size;
  // Repeated content can make the ends overlap the start (as in prosemirror's own diffing).
  const overlap = start - Math.min(a, b);
  if (overlap > 0) {
    a += overlap;
    b += overlap;
  }
  if (pos <= start) return pos;
  if (pos >= a) return pos + (b - a);
  return Math.min(pos, b);
}

/**
 * Remote imports (P11-N5b): loro-prosemirror replaces the whole document on every import and restores the selection
 * a task later from cursors it computes from the *old* ProseMirror offsets against the *already imported* Loro text –
 * off by the remote insertions before the caret. Typing in between also landed in the wrong place (the replace maps
 * the caret to the end of the document). Under concurrent typing in one paragraph the text came out scrambled. This
 * plugin keeps the caret where it was right in the import's own dispatch (mapped across the changed range) and drops
 * the binding's late restore (one bare selection transaction per import, within a second).
 */
export function selectionKeeper(): Plugin {
  // One late restore per import (the binding schedules one when it could read the caret); expired after a second.
  let pending: number[] = [];
  return new Plugin({
    key: keeperKey,
    filterTransaction: (tr) => {
      if (tr.getMeta(keeperKey)) return true;
      const sync = tr.getMeta(loroSyncPluginKey) as { type?: string } | undefined;
      const now = performance.now();
      if (sync?.type === "non-local-updates") {
        pending.push(now);
        return true;
      }
      // The restore is a bare `tr.setSelection`: user selections carry "pointer" (mouse) or scroll into view (keys).
      const restoreLike = !sync && !tr.docChanged && tr.selectionSet && tr.getMeta("pointer") === undefined && !tr.scrolledIntoView;
      if (!restoreLike) return true;
      pending = pending.filter((t) => now - t < 1000);
      if (pending.length === 0) return true;
      pending.shift();
      return false;
    },
    appendTransaction: (trs, oldState, newState) => {
      const imported = trs.some((tr) => (tr.getMeta(loroSyncPluginKey) as { type?: string } | undefined)?.type === "non-local-updates");
      if (!imported || !(oldState.selection instanceof TextSelection)) return null;
      const doc = newState.doc;
      const clamp = (p: number) => Math.max(0, Math.min(doc.content.size, p));
      const anchor = clamp(mapAcrossDiff(oldState.doc, doc, oldState.selection.anchor));
      const head = clamp(mapAcrossDiff(oldState.doc, doc, oldState.selection.head));
      if (newState.selection.anchor === anchor && newState.selection.head === head) return null;
      try {
        return newState.tr.setSelection(TextSelection.between(doc.resolve(anchor), doc.resolve(head))).setMeta(keeperKey, true).setMeta("addToHistory", false);
      } catch {
        return null;
      }
    },
  });
}
