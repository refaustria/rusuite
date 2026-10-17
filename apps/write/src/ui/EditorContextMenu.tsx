// Right-click menu of the editor (Word's): clipboard, then picture
// commands on an image, table commands inside a table, New Comment, and
// paragraph / formatting commands.

import { toggleSelectedFieldCodes } from "../features/fieldsW6";
import { noteAtCaret } from "./w6Dialogs";
import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";
import { NodeSelection } from "@tiptap/pm/state";
import { ContextMenu, type ContextMenuItem } from "@rusuite/ui-shared";
import { clearFormatting } from "../features/formatting";
import { resetImageSize, selectedImage } from "../features/images";
import { deleteCols, deleteRows, deleteTable, insertCol, insertRow, mergeCellsCommand, tableContext } from "../features/tables";
import type { WriteFeatures } from "../features/WriteFeatures";
import { numberedParagraphAtCaret } from "../features/listGallery";
import { followLink, linkAt, objectLink, removeLinkCommand } from "../features/links";
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
      ...(mergeCellsCommand(tc) ? [{ id: "merge-cells", label: t("write.mergeCells"), onSelect: run(mergeCellsCommand(tc)!) }] : []),
      { id: "split-cells", label: t("write.splitCellsDots"), onSelect: () => features.ui.openDialog("splitCells") },
      sep,
      { id: "row-height", label: t("write.rowHeightDots"), onSelect: () => features.ui.openDialog("rowHeight") },
      { id: "table-props", label: t("write.tablePropertiesDots"), onSelect: () => features.ui.openDialog("tableProps") },
    );
  }
  // A picture or shape with a link: Edit / Open / Remove Link (the object stays).
  const obj = objectLink(editor.state);
  const link = obj ? null : linkAt(editor.state, editor.state.selection.from);
  if (obj?.link) {
    const objLink = obj.link;
    items.push(
      sep,
      { id: "edit-link", label: t("write.link.edit"), onSelect: () => features.ui.openDialog("link") },
      { id: "open-link", label: t("write.link.open"), onSelect: () => void followLink(editor.view, objLink) },
      { id: "remove-link", label: t("write.link.remove"), onSelect: () => void ctl.run(obj.set(null)) },
    );
  } else if (link) {
    const remove = removeLinkCommand(editor.state);
    items.push(
      sep,
      { id: "edit-link", label: t("write.link.edit"), onSelect: () => features.ui.openDialog("link") },
      { id: "open-link", label: t("write.link.open"), onSelect: () => void followLink(editor.view, link.link) },
      { id: "remove-link", label: t("write.link.remove"), disabled: !remove, onSelect: () => remove && void ctl.run(remove) },
    );
  } else {
    items.push(sep, { id: "link", label: t("write.link.insertDots"), shortcut: "Ctrl+K", onSelect: () => features.ui.openDialog("link") });
  }
  const { $from } = editor.state.selection;
  const field = $from.nodeAfter?.type.name === "field" || $from.nodeBefore?.type.name === "field" || !editor.state.selection.empty;
  if (field) {
    items.push(
      { id: "update-field", label: t("write.updateField"), shortcut: "F9", onSelect: () => void features.updateFields() },
      { id: "toggle-codes", label: t("write.fields.toggleCodes"), shortcut: "Shift+F9", onSelect: () => {
        const tr = toggleSelectedFieldCodes(editor.state);
        if (tr) editor.view.dispatch(tr);
      } },
    );
  }
  const note = noteAtCaret(editor);
  if (note) {
    const to = note.kind === "foot" ? "end" : "foot";
    items.push({ id: "convert-note", label: t(to === "end" ? "write.notes.toEndnote" : "write.notes.toFootnote"), onSelect: () => void ctl.run({ type: "convertNotes", ids: [note.id], to }) });
  }
  const numbered = numberedParagraphAtCaret(editor.state);
  if (numbered != null && numbered > 0) {
    items.push(
      sep,
      { id: "restart-list", label: t("write.restartAt1"), onSelect: () => void ctl.run({ type: "restartList", block: numbered, start: 1 }) },
      { id: "continue-list", label: t("write.continueNumbering"), onSelect: () => void ctl.run({ type: "continueList", block: numbered }) },
      { id: "numbering-value", label: t("write.setNumberingValue"), onSelect: () => features.ui.openDialog("numberingValue") },
    );
  }
  items.push(
    sep,
    { id: "new-comment", label: t("write.comments.new"), shortcut: "Ctrl+Alt+M", onSelect: () => features.newComment() },
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
      const img = target.closest?.(".inline-image-wrap, .drawing-wrap");
      if (img && !target.closest(".drawing-text .ProseMirror")) {
        const pos = view.posAtDOM(img, 0);
        const node = view.state.doc.nodeAt(pos);
        if (node?.type.name === "image" || node?.type.name === "drawing") view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
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
