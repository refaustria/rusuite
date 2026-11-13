// Tables (Tiptap's schema with colspan/rowspan, notes-format §7.1, plus `colwidth` from column resizing) with
// prosemirror-tables' editing: cell selection, Tab navigation, add/delete rows and columns, header row,
// merge/split, column resize. One change to the plugin (spike rule a): `tableEditing`'s appendTransaction also
// "fixes" malformed tables (`fixTables`) – that edits the document on every peer at once (duplicated cells after
// concurrent row/column edits), so only its selection normalisation is kept.

import type { Editor } from "@tiptap/core";
import { Table } from "@tiptap/extension-table";
import { Plugin, type PluginSpec } from "@tiptap/pm/state";
import { tableEditingKey } from "@tiptap/pm/tables";

/** `tableEditing` without document-editing `appendTransaction` results. */
export function withoutDocFixes(plugin: Plugin): Plugin {
  const spec = plugin.spec as PluginSpec<unknown>;
  if (spec.key !== tableEditingKey || !spec.appendTransaction) return plugin;
  const orig = spec.appendTransaction;
  return new Plugin({
    ...spec,
    appendTransaction(trs, oldState, state) {
      const tr = orig.call(plugin, trs, oldState, state);
      return tr && !tr.docChanged ? tr : null;
    },
  });
}

export const NotesTable = Table.extend({
  addProseMirrorPlugins() {
    return (this.parent?.() ?? []).map(withoutDocFixes);
  },
});

export type TableCommand =
  | "rowBefore"
  | "rowAfter"
  | "colBefore"
  | "colAfter"
  | "deleteRow"
  | "deleteCol"
  | "deleteTable"
  | "merge"
  | "split"
  | "headerRow"
  | "headerCol";

export const TABLE_COMMANDS: TableCommand[] = ["rowBefore", "rowAfter", "colBefore", "colAfter", "deleteRow", "deleteCol", "deleteTable", "merge", "split", "headerRow", "headerCol"];

/** Runs a table command on the selection (`dry`: only whether it applies). */
export function tableCommand(editor: Editor, cmd: TableCommand, dry = false): boolean {
  const c = dry ? editor.can().chain() : editor.chain().focus();
  switch (cmd) {
    case "rowBefore":
      return c.addRowBefore().run();
    case "rowAfter":
      return c.addRowAfter().run();
    case "colBefore":
      return c.addColumnBefore().run();
    case "colAfter":
      return c.addColumnAfter().run();
    case "deleteRow":
      return c.deleteRow().run();
    case "deleteCol":
      return c.deleteColumn().run();
    case "deleteTable":
      return c.deleteTable().run();
    case "merge":
      return c.mergeCells().run();
    case "split":
      return c.splitCell().run();
    case "headerRow":
      return c.toggleHeaderRow().run();
    case "headerCol":
      return c.toggleHeaderColumn().run();
  }
}

/** Inserts a `rows × cols` table with a header row (Insert › Table grid picker). */
export function insertTable(editor: Editor, rows: number, cols: number): boolean {
  return editor.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run();
}

/** Whether the selection is inside a table. */
export const inTable = (editor: Editor | null): boolean => !!editor && !editor.isDestroyed && editor.isActive("table");
