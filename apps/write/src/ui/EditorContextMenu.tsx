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
import { numberedAtCaret } from "../features/structureCommands";
import type { SyncController } from "../sync/SyncPlugin";
import { t, useT } from "../i18n";

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
    { id: "cut", label: t("cmd.cut"), shortcut: "Ctrl+X", disabled: editor.state.selection.empty, onSelect: exec("cut") },
    { id: "copy", label: t("cmd.copy"), shortcut: "Ctrl+C", disabled: editor.state.selection.empty, onSelect: exec("copy") },
    {
      id: "paste",
      label: t("cmd.paste"),
      shortcut: "Ctrl+V",
      onSelect: () => {
        void navigator.clipboard
          ?.readText()
          .then((text) => text && editor.chain().focus().insertContent(text).run())
          .catch(() => ctl.pushError(new Error(t("write.pasteNeedsClipboard"))));
      },
    },
  ];
  const image = selectedImage(editor.state);
  if (image) {
    items.push(
      sep,
      { id: "alt", label: t("write.editAlt"), onSelect: () => features.ui.openDialog("altText") },
      { id: "reset", label: t("write.resetPicSize"), onSelect: () => void resetImageSize(editor.view, ctl, image.pos) },
      { id: "delete-picture", label: t("write.deletePicture"), shortcut: "Del", onSelect: () => editor.chain().focus().deleteSelection().run() },
    );
  }
  const tc = tableContext(editor.state);
  if (tc) {
    const run = (c: Parameters<SyncController["run"]>[0]) => () => void ctl.run(c);
    items.push(
      sep,
      { id: "row-above", label: t("write.rowAbove"), onSelect: run(insertRow(tc, false)) },
      { id: "row-below", label: t("write.rowBelow"), onSelect: run(insertRow(tc, true)) },
      { id: "col-left", label: t("write.colLeft"), onSelect: run(insertCol(tc, false)) },
      { id: "col-right", label: t("write.colRight"), onSelect: run(insertCol(tc, true)) },
      sep,
      { id: "delete-row", label: tc.rowIndices.length > 1 ? t("write.deleteRows") : t("write.deleteRow"), onSelect: run(deleteRows(tc)) },
      { id: "delete-col", label: tc.colIndices.length > 1 ? t("write.deleteCols") : t("write.deleteCol"), onSelect: run(deleteCols(tc)) },
      { id: "delete-table", label: t("write.deleteTable"), onSelect: run(deleteTable(tc)) },
      sep,
      { id: "row-height", label: t("write.rowHeightDots"), onSelect: () => features.ui.openDialog("rowHeight") },
    );
  }
  const numbered = numberedAtCaret(editor);
  if (numbered != null && numbered > 0) {
    items.push(
      sep,
      { id: "restart-list", label: t("write.restartAt1"), onSelect: () => void ctl.run({ type: "restartList", block: numbered, start: 1 }) },
      { id: "continue-list", label: t("write.continueNumbering"), onSelect: () => void ctl.run({ type: "continueList", block: numbered }) },
    );
  }
  items.push(
    sep,
    { id: "paragraph", label: t("write.paragraphDots"), onSelect: () => features.ui.openDialog("paragraph") },
    { id: "clear", label: t("write.clearFormatting"), shortcut: "Ctrl+Space", onSelect: () => void clearFormatting(editor, ctl, false) },
  );
  return items;
}

export function EditorContextMenu({ editor, ctl, features }: { editor: Editor | null; ctl: SyncController; features: WriteFeatures }) {
  const t = useT();
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
  return <ContextMenu at={at} label={t("write.editor")} items={items} onClose={() => setAt(null)} />;
}
