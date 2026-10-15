// Headless Tiptap editors for the sync tests.

import { Editor, Extension, type Extensions } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import type { Document } from "../generated/Document";
import { findPos, idTaggerPlugin, pmOffsetOf } from "../sync/SyncPlugin";
import { writeExtensions, writeSchema } from "../sync/schema";
import { toPM } from "../sync/toPM";
import { mapDocChange, type MapperOptions, type MapResult } from "../sync/transactionMapper";

export const Tagger = Extension.create({
  name: "testTagger",
  addProseMirrorPlugins: () => [idTaggerPlugin()],
});

export function makeEditor(doc: Document, extensions: Extensions = [Tagger]): Editor {
  return new Editor({
    element: document.createElement("div"),
    extensions: [...writeExtensions(), ...extensions],
    content: toPM(doc, writeSchema()).toJSON(),
  });
}

/** PM position of char `offset` in the textblock with id `id`. */
export function posOf(editor: Editor, id: number, offset: number): number {
  const doc = editor.state.doc;
  const pos = findPos(doc, id);
  if (pos < 0) throw new Error(`no block ${id}`);
  return pos + 1 + pmOffsetOf(doc.nodeAt(pos)!, offset);
}

export function select(editor: Editor, id: number, from: number, toId = id, to = from): void {
  const { state } = editor;
  const sel = TextSelection.create(state.doc, posOf(editor, id, from), posOf(editor, toId, to));
  editor.view.dispatch(state.tr.setSelection(sel));
}

/** Runs `fn` and maps the resulting change. */
export function change(editor: Editor, fn: () => unknown, opts: MapperOptions = {}): MapResult | null {
  const before = editor.state.doc;
  fn();
  return mapDocChange(before, editor.state.doc, opts);
}

/** Types `text` like the keyboard does (stored marks or the marks at the cursor). */
export function type(editor: Editor, text: string): void {
  editor.view.dispatch(editor.state.tr.insertText(text));
}

export const press = (editor: Editor, key: string) => editor.commands.keyboardShortcut(key);
