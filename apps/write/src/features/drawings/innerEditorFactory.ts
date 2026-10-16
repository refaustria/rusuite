// The nested editor of a text box or shape text: the Write schema (no
// nested drawings are created there: the core strips them), temporary ids
// for new paragraphs, Rust undo/redo, Escape back to the drawing.

import { Editor, Extension } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import type { Block } from "../../generated/Block";
import { idTaggerPlugin, type SyncController } from "../../sync/SyncPlugin";
import { writeExtensions, writeSchema, type WriteExtensionsOptions } from "../../sync/schema";
import { blocksToPM } from "../../sync/toPM";
import { innerEditors } from "./innerEditors";

export function innerEditorFactory(ctl: SyncController, opts: Pick<WriteExtensionsOptions, "resolveMedia" | "page">, outer: () => Editor | null) {
  return (element: HTMLElement, blocks: Block[]): Editor => {
    const nodes = blocksToPM({ schema: writeSchema(), numbering: ctl.numbering }, blocks);
    const editor: Editor = new Editor({
      element,
      extensions: [
        ...writeExtensions({ resolveMedia: opts.resolveMedia, page: opts.page }),
        Extension.create({
          name: "rusuiteDrawingText",
          addProseMirrorPlugins: () => [idTaggerPlugin()],
          addKeyboardShortcuts: () => ({
            "Mod-z": () => (ctl.undo(), true),
            "Mod-y": () => (ctl.redo(), true),
            "Shift-Mod-z": () => (ctl.redo(), true),
            Tab: () => editor.commands.insertContent("\t"),
            // Word: Escape leaves the text and selects the shape.
            Escape: () => {
              const main = outer();
              const pos = innerEditors.hostPos(editor);
              editor.commands.blur();
              innerEditors.release();
              if (main && pos !== undefined) {
                main.view.dispatch(main.state.tr.setSelection(NodeSelection.create(main.state.doc, pos)));
                main.view.focus();
              }
              return true;
            },
          }),
        }),
      ],
      content: { type: "doc", content: (nodes.length ? nodes : [writeSchema().nodes.paragraph!.create()]).map((n) => n.toJSON()) },
      editorProps: { attributes: { class: "tiptap-content drawing-text-editor", "data-testid": "drawing-text", spellcheck: "true" } },
    });
    return editor;
  };
}
