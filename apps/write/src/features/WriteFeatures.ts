// The editor features of P6-4 bundled for the App: a small UI store
// (view mode, spell check, find bar, dialogs, page count), the format
// painter, and one Tiptap extension with the keyboard handling (Tab in
// tables, Ctrl+= / Ctrl+Shift+=, Esc), clipboard/drop images, find
// highlighting and the print-layout pagination.

import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { columnResizePlugin } from "./columnResize";
import { findPlugin } from "./find";
import { clearFormatting, FormatPainter, toggleScript } from "./formatting";
import { imageFiles, insertImageFile } from "./images";
import { paginationPlugin, remeasurePages } from "./pagination";
import { layoutFieldContext, refreshStructure, structurePlugin, updateFieldsCommand, type FieldContext } from "./structure";
import { insertNote } from "./structureCommands";
import { getLocale } from "@rusuite/ui-shared";
import { caretToCell, inLastCell, tableContext } from "./tables";
import type { SyncController } from "../sync/SyncPlugin";

export type WriteView = "print" | "draft";
export type WriteDialog = "rowHeight" | "altText" | "pageSetup" | "headerFooter" | "paragraph" | "pageNumbers" | null;

export interface WriteUiState {
  view: WriteView;
  spellcheck: boolean;
  find: { open: boolean; replace: boolean; seed: number };
  dialog: WriteDialog;
  /** Which field the header/footer dialog focuses. */
  headerFooterFocus: "header" | "footer";
  pages: number;
  /** Header of the first page and footer of the last page in print layout (from the sections). */
  frame: { firstHeader: string; lastFooter: string } | null;
}

/** Observable UI state shared by the ribbon, the dialogs and the editor plugins. */
export class WriteUi {
  private state: WriteUiState = {
    view: "print",
    spellcheck: true,
    find: { open: false, replace: false, seed: 0 },
    dialog: null,
    headerFooterFocus: "header",
    pages: 1,
    frame: null,
  };
  private listeners = new Set<() => void>();

  getState = (): WriteUiState => this.state;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  set(partial: Partial<WriteUiState>): void {
    this.state = { ...this.state, ...partial };
    for (const fn of this.listeners) fn();
  }

  openFind(replace: boolean): void {
    this.set({ find: { open: true, replace, seed: this.state.find.seed + 1 } });
  }

  closeFind(): void {
    this.set({ find: { ...this.state.find, open: false } });
  }

  openDialog(dialog: WriteDialog, headerFooterFocus: "header" | "footer" = "header"): void {
    this.set({ dialog, headerFooterFocus });
  }
}

const featuresKey = new PluginKey("rusuiteWriteFeatures");

export class WriteFeatures {
  readonly ui = new WriteUi();
  readonly painter = new FormatPainter();
  editor: Editor | null = null;
  /** Live field values: pages from the pagination, the clock, the document name. */
  readonly fields: FieldContext;

  constructor(readonly ctl: SyncController) {
    this.fields = layoutFieldContext(() => ctl.getState().name, () => getLocale());
    ctl.beforeSave = () => (this.editor && !this.editor.isDestroyed ? updateFieldsCommand(this.editor.state, this.fields) : null);
  }

  /** Attributes of the editor element (spell check follows the View › Spelling toggle). */
  editorAttributes(): Record<string, string> {
    const lang = typeof navigator !== "undefined" && navigator.language ? navigator.language : "en";
    return {
      "data-testid": "editor",
      class: "tiptap-content min-h-full outline-none",
      spellcheck: this.ui.getState().spellcheck ? "true" : "false",
      lang,
    };
  }

  /** Appends a row after the last one and moves the caret into its first cell (Tab in the last cell). */
  async appendRow(editor: Editor): Promise<void> {
    const t = tableContext(editor.state);
    if (!t) return;
    await this.ctl.run({ type: "insertTableRow", table: t.table, at: t.rows });
    caretToCell(editor.view, t.table, t.rows, 0);
  }

  /** The Tiptap extension (add it to the editor's extensions). */
  extension() {
    const features = this;
    const { ctl, ui, painter } = this;
    return Extension.create({
      name: "rusuiteWriteFeatures",
      // Before Tiptap's table and list keymaps.
      priority: 200,
      onCreate() {
        features.editor = this.editor as Editor;
      },
      onDestroy() {
        if (features.editor === this.editor) features.editor = null;
      },
      addKeyboardShortcuts() {
        return {
          Tab: () => {
            const t = tableContext(this.editor.state);
            if (!t) return false;
            if (!inLastCell(t)) return this.editor.commands.goToNextCell();
            void features.appendRow(this.editor as Editor);
            return true;
          },
          "Shift-Tab": () => {
            if (!tableContext(this.editor.state)) return false;
            this.editor.commands.goToPreviousCell();
            return true;
          },
          Escape: () => {
            if (!painter.active) return false;
            painter.cancel(this.editor as Editor);
            return true;
          },
          "Mod-Space": () => {
            void clearFormatting(this.editor as Editor, ctl, false);
            return true;
          },
          // Word: Ctrl+Alt+F footnote, Ctrl+Alt+D endnote.
          "Mod-Alt-f": () => {
            void insertNote(this.editor as Editor, ctl, "foot");
            return true;
          },
          "Mod-Alt-d": () => {
            void insertNote(this.editor as Editor, ctl, "end");
            return true;
          },
        };
      },
      addProseMirrorPlugins() {
        const editor = this.editor as Editor;
        return [
          findPlugin(),
          columnResizePlugin(ctl),
          paginationPlugin({
            enabled: () => ui.getState().view === "print",
            page: () => ctl.page,
            sections: () => ctl.sections,
            onEditHeaderFooter: (which) => ui.openDialog("headerFooter", which),
            onPages: (pages) => ui.set({ pages }),
            onLayout: (l) => {
              const f = ui.getState().frame;
              if (f?.firstHeader !== l.firstHeader || f?.lastFooter !== l.lastFooter) ui.set({ frame: { firstHeader: l.firstHeader, lastFooter: l.lastFooter } });
            },
          }),
          // After the pagination: page fields read its layout.
          structurePlugin({ sections: () => ctl.sections, fields: features.fields }),
          new Plugin({
            key: featuresKey,
            props: {
              handleKeyDown(_view, e) {
                // Word: Ctrl+= subscript, Ctrl+Shift+= superscript.
                if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.code === "Equal" || e.key === "=" || e.key === "+")) {
                  e.preventDefault();
                  toggleScript(editor, e.shiftKey ? "superscript" : "subscript");
                  return true;
                }
                return false;
              },
              handlePaste(_view, e) {
                const data = e.clipboardData;
                const files = imageFiles(data);
                if (!files.length || (data?.getData("text/plain") ?? "").trim()) return false;
                void insertImageFile(editor, ctl, files[0]!, files[0]!.name || "Pasted picture").catch((err) => ctl.pushError(err));
                return true;
              },
              handleDrop(view, e) {
                const files = imageFiles((e as DragEvent).dataTransfer);
                if (!files.length) return false;
                const at = view.posAtCoords({ left: (e as DragEvent).clientX, top: (e as DragEvent).clientY });
                if (at) editor.commands.setTextSelection(at.pos);
                void insertImageFile(editor, ctl, files[0]!, files[0]!.name).catch((err) => ctl.pushError(err));
                return true;
              },
              handleDOMEvents: {
                mouseup: () => {
                  if (painter.active) setTimeout(() => painter.paste(editor), 0);
                  return false;
                },
              },
            },
            view(view) {
              // Lay the pages out again when the page setup or the view mode changes.
              let page = ctl.page;
              let sections = ctl.sections;
              let name = ctl.getState().name;
              let mode = ui.getState().view;
              const offCtl = ctl.subscribe(() => {
                if (ctl.page !== page || ctl.sections !== sections) {
                  page = ctl.page;
                  sections = ctl.sections;
                  remeasurePages(view);
                  refreshStructure(view);
                }
                if (ctl.getState().name !== name) {
                  name = ctl.getState().name;
                  refreshStructure(view);
                }
              });
              const offUi = ui.subscribe(() => {
                if (ui.getState().view !== mode) {
                  mode = ui.getState().view;
                  if (mode === "draft") ui.set({ frame: null });
                  remeasurePages(view);
                }
              });
              return {
                destroy() {
                  offCtl();
                  offUi();
                },
              };
            },
          }),
        ];
      },
    });
  }
}
