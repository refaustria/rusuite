// Right-click menu of the editor (Word's): clipboard, then picture
// commands on an image, table commands inside a table, and paragraph /
// formatting commands.

import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";
import { NodeSelection } from "@tiptap/pm/state";
import { ContextMenu, type ContextMenuItem } from "@rusuite/ui-shared";
import { clearFormatting } from "../features/formatting";
import { resetImageSize, selectedImage } from "../features/images";
import { deleteCols, deleteRows, deleteTable, insertCol, insertRow, tableContext } from "../features/tables";
import type { WriteFeatures } from "../features/WriteFeatures";
import type { SyncController } from "../sync/SyncPlugin";

const sep: ContextMenuItem = { separator: true };

/** The menu items for the editor's current selection. */
export function contextItems(editor: Editor, ctl: SyncController, features: WriteFeatures): ContextMenuItem[] {
  const exec = (cmd: "cut" | "copy") => () => {
    editor.commands.focus();
    try {
      document.execCommand(cmd);
    } catch {
      // keyboard shortcuts still work
    }
  };
  const items: ContextMenuItem[] = [
    { id: "cut", label: "Cut", shortcut: "Ctrl+X", disabled: editor.state.selection.empty, onSelect: exec("cut") },
    { id: "copy", label: "Copy", shortcut: "Ctrl+C", disabled: editor.state.selection.empty, onSelect: exec("copy") },
    {
      id: "paste",
      label: "Paste",
      shortcut: "Ctrl+V",
      onSelect: () => {
        void navigator.clipboard
          ?.readText()
          .then((t) => t && editor.chain().focus().insertContent(t).run())
          .catch(() => ctl.pushError(new Error("Paste needs clipboard access here – use Ctrl+V.")));
      },
    },
  ];
  const image = selectedImage(editor.state);
  if (image) {
    items.push(
      sep,
      { id: "alt", label: "Edit alt text…", onSelect: () => features.ui.openDialog("altText") },
      { id: "reset", label: "Reset picture size", onSelect: () => void resetImageSize(editor.view, ctl, image.pos) },
      { id: "delete-picture", label: "Delete picture", shortcut: "Del", onSelect: () => editor.chain().focus().deleteSelection().run() },
    );
  }
  const t = tableContext(editor.state);
  if (t) {
    const run = (c: Parameters<SyncController["run"]>[0]) => () => void ctl.run(c);
    items.push(
      sep,
      { id: "row-above", label: "Insert row above", onSelect: run(insertRow(t, false)) },
      { id: "row-below", label: "Insert row below", onSelect: run(insertRow(t, true)) },
      { id: "col-left", label: "Insert column left", onSelect: run(insertCol(t, false)) },
      { id: "col-right", label: "Insert column right", onSelect: run(insertCol(t, true)) },
      sep,
      { id: "delete-row", label: t.rowIndices.length > 1 ? "Delete rows" : "Delete row", onSelect: run(deleteRows(t)) },
      { id: "delete-col", label: t.colIndices.length > 1 ? "Delete columns" : "Delete column", onSelect: run(deleteCols(t)) },
      { id: "delete-table", label: "Delete table", onSelect: run(deleteTable(t)) },
      sep,
      { id: "row-height", label: "Row height…", onSelect: () => features.ui.openDialog("rowHeight") },
    );
  }
  items.push(
    sep,
    { id: "paragraph", label: "Paragraph…", onSelect: () => features.ui.openDialog("paragraph") },
    { id: "clear", label: "Clear formatting", shortcut: "Ctrl+Space", onSelect: () => void clearFormatting(editor, ctl, false) },
  );
  return items;
}

export function EditorContextMenu({ editor, ctl, features }: { editor: Editor | null; ctl: SyncController; features: WriteFeatures }) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const [items, setItems] = useState<ContextMenuItem[]>([]);
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    const onMenu = (e: MouseEvent) => {
      e.preventDefault();
      const view = editor.view;
      const target = e.target as HTMLElement;
      // A right-click on a picture selects it; elsewhere outside the selection moves the caret.
      const img = target.closest?.(".inline-image-wrap");
      if (img) {
        const pos = view.posAtDOM(img, 0);
        const node = view.state.doc.nodeAt(pos);
        if (node?.type.name === "image") view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
      } else {
        let hit: { pos: number } | null = null;
        try {
          hit = view.posAtCoords({ left: e.clientX, top: e.clientY });
        } catch {
          // no layout (tests): keep the selection
        }
        const { from, to } = view.state.selection;
        if (hit && (hit.pos < from || hit.pos > to)) editor.commands.setTextSelection(hit.pos);
      }
      setItems(contextItems(editor, ctl, features));
      setAt({ x: e.clientX, y: e.clientY });
    };
    dom.addEventListener("contextmenu", onMenu);
    return () => dom.removeEventListener("contextmenu", onMenu);
  }, [editor, ctl, features]);
  return <ContextMenu at={at} label="Editor" items={items} onClose={() => setAt(null)} />;
}
