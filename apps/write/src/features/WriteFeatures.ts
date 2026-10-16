// The editor features of P6-4 bundled for the App: a small UI store
// (view mode, spell check, find bar, dialogs, page count), the format
// painter, and one Tiptap extension with the keyboard handling (Tab in
// tables, Ctrl+= / Ctrl+Shift+=, Esc), clipboard/drop images, find
// highlighting and the print-layout pagination.

import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { columnResizePlugin } from "./columnResize";
import { findPlugin } from "./find";
import { clearFormatting, FormatPainter, toggleScript } from "./formatting";
import { imageFiles, insertImageFile } from "./images";
import { paginationPlugin, remeasurePages } from "./pagination";
import { layoutFieldContext, refreshStructure, structurePlugin, updateFieldsCommand, type FieldContext } from "./structure";
import { linksPlugin } from "./links";
import { selectsAll, updateFieldsCommand as updateSelectedFields } from "./references";
import { paragraphStyleId, resolveParagraph } from "./styleCss";
import type { Node as PMNode } from "@tiptap/pm/model";
import { insertNote } from "./structureCommands";
import { getLocale } from "@rusuite/ui-shared";
import { caretToCell, inLastCell, tableContext } from "./tables";
import { paragraphBoxPlugin } from "./paragraphBox";
import { refreshTables, tableRenderPlugin } from "./tableRender";
import { refreshTabs, tabStopsPlugin } from "./tabStops";
import { installStyleSheetCss } from "./styleCss";
import type { SyncController } from "../sync/SyncPlugin";
import { commentsPlugin, refreshComments } from "../comments/plugin";
import { draftFromSelection, type CommentDraft } from "../comments/commands";
import { authorColor, type CommentFilter } from "../comments/model";
import { t } from "../i18n";

export type WriteView = "print" | "draft";
export type WriteDialog =
  | "rowHeight" | "altText" | "pageSetup" | "headerFooter" | "paragraph" | "pageNumbers"
  | "splitCells" | "cellMargins" | "tableProps" | "bordersShading" | "tabs" | "userName"
  | "link" | "bookmark" | "goTo" | "caption" | "crossRef" | "columns" | "symbol" | "dateTime" | null;

/** Review › Comments: what the margin / pane shows. */
export interface CommentsUiState {
  /** Review › Show Comments: balloons (or the pane); off = margin indicators only. */
  show: boolean;
  /** Review › Comments Pane: the list instead of balloons at any width. */
  pane: boolean;
  filter: CommentFilter;
  /** The selected comment (its thread is highlighted darker, its balloon aligned). */
  active: number | null;
  hover: number | null;
  /** A comment being written (New Comment). */
  draft: CommentDraft | null;
  /** The comment whose text is being edited. */
  editing: number | null;
}

/** The style dialog the UI shows: Modify Style (`id`), a new style (Styles pane › New Style), Create a Style (from the selection), Rename. */
export type StyleDialog =
  | { mode: "modify"; id: string }
  | { mode: "new"; basedOn: string }
  | { mode: "create" }
  | { mode: "rename"; id: string }
  | { mode: "delete"; id: string };

export interface WriteUiState {
  view: WriteView;
  /** Home › Styles pane (Alt+Ctrl+Shift+S) and its options. */
  stylesPane: boolean;
  styleFilter: "recommended" | "inUse" | "all";
  stylePreview: boolean;
  linkedDisabled: boolean;
  /** The Style Inspector section of the pane. */
  styleInspector: boolean;
  /** View › Navigation pane. */
  navigation: boolean;
  /** The Apply Styles box (Ctrl+Shift+S). */
  applyStyles: boolean;
  styleDialog: StyleDialog | null;
  /** "Select All N Instances": the paragraphs the next style applies to. */
  styleInstances: number[] | null;
  spellcheck: boolean;
  /** View › Ruler. */
  ruler: boolean;
  find: { open: boolean; replace: boolean; seed: number };
  dialog: WriteDialog;
  /** Which field the header/footer dialog focuses. */
  headerFooterFocus: "header" | "footer";
  pages: number;
  /** Header of the first page and footer of the last page in print layout (from the sections). */
  frame: { firstHeader: string; lastFooter: string } | null;
  comments: CommentsUiState;
  /** After the user name dialog: start the comment that asked for it. */
  userThen: "newComment" | null;
  /** The Paragraph dialog's tab. */
  paragraphTab: "indents" | "breaks";
  /** The Symbol dialog's tab. */
  symbolTab: "symbols" | "special";
}

/** Observable UI state shared by the ribbon, the dialogs and the editor plugins. */
export class WriteUi {
  private state: WriteUiState = {
    view: "print",
    stylesPane: false,
    styleFilter: "recommended",
    stylePreview: true,
    linkedDisabled: false,
    styleInspector: false,
    navigation: false,
    applyStyles: false,
    styleDialog: null,
    styleInstances: null,
    spellcheck: true,
    ruler: true,
    find: { open: false, replace: false, seed: 0 },
    dialog: null,
    headerFooterFocus: "header",
    pages: 1,
    frame: null,
    comments: { show: true, pane: false, filter: "all", active: null, hover: null, draft: null, editing: null },
    userThen: null,
    paragraphTab: "indents",
    symbolTab: "symbols",
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

  setComments(partial: Partial<CommentsUiState>): void {
    this.set({ comments: { ...this.state.comments, ...partial } });
  }
}

const featuresKey = new PluginKey("rusuiteWriteFeatures");

/** Reads a pending DOM selection change into the editor state now (ProseMirror otherwise waits for `selectionchange`). */
export function syncDomSelection(view: EditorView): void {
  const observer = (view as unknown as { domObserver?: { forceFlush?: () => void; flush?: () => void } }).domObserver;
  observer?.forceFlush?.();
  observer?.flush?.();
}

export class WriteFeatures {
  readonly ui = new WriteUi();
  readonly painter = new FormatPainter();
  editor: Editor | null = null;
  /** Live field values: pages from the pagination, the clock, the document name. */
  readonly fields: FieldContext;

  constructor(readonly ctl: SyncController) {
    this.fields = layoutFieldContext(() => ctl.getState().name, () => getLocale(), () => new Date(), () => ctl.properties);
    ctl.beforeSave = () => (this.editor && !this.editor.isDestroyed ? updateFieldsCommand(this.editor.state, this.fields) : null);
    ctl.saveStats = () => ({ pages: this.ui.getState().view === "print" ? this.ui.getState().pages : undefined });
  }

  /** Update Field (F9): the selection's fields, all of them when everything is selected (Ctrl+A, F9). */
  async updateFields(): Promise<void> {
    const editor = this.editor;
    if (!editor || editor.isDestroyed) return;
    await this.ctl.idle();
    await this.ctl.run(updateSelectedFields(editor.state, this.fields, selectsAll(editor.state)));
  }

  /** Keep with next / page break before of a paragraph: its style chain, then its direct formatting. */
  flow(node: PMNode): { keepNext?: boolean | null; pageBreakBefore?: boolean | null } {
    const sheet = this.ctl.styles;
    const style = resolveParagraph(sheet, paragraphStyleId(sheet, node));
    const direct = (node.attrs.extra ?? {}) as { keepNext?: boolean | null; pageBreakBefore?: boolean | null };
    return { keepNext: direct.keepNext ?? style.keepNext, pageBreakBefore: direct.pageBreakBefore ?? style.pageBreakBefore };
  }

  /** Attributes of the editor element (spell check follows the View › Spelling toggle). */
  editorAttributes(): Record<string, string> {
    // Hyphenation (Layout › Hyphenation › Automatic) uses the UI language's patterns.
    const lang = getLocale() || (typeof navigator !== "undefined" && navigator.language ? navigator.language : "en");
    return {
      "data-testid": "editor",
      class: "tiptap-content min-h-full outline-none",
      spellcheck: this.ui.getState().spellcheck ? "true" : "false",
      lang,
      "data-hyphenate": this.ctl.settings.autoHyphenation ? "auto" : "none",
    };
  }

  /**
   * Review › New Comment (Ctrl+Alt+M): a draft balloon on the selection
   * (the word at the caret when nothing is selected). The first comment
   * asks for the user name.
   */
  newComment(): void {
    const editor = this.editor;
    if (!editor || editor.isDestroyed) return;
    if (!this.ctl.user) {
      this.ui.set({ dialog: "userName", userThen: "newComment" });
      return;
    }
    const draft = draftFromSelection(editor.state);
    if (!draft) {
      this.ctl.pushError(new Error(t("write.comments.notInBody")));
      return;
    }
    this.ui.setComments({ draft, active: null, show: true, editing: null });
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
            if (!t) {
              // Word: Tab in a list item indents it (the list keymap); elsewhere it types a tab character.
              const { $from } = this.editor.state.selection;
              for (let d = $from.depth; d > 0; d--) if ($from.node(d).type.name === "listItem") return false;
              if (!$from.parent.isTextblock) return false;
              return this.editor.commands.command(({ tr }) => {
                tr.insertText("\t");
                return true;
              });
            }
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
          // Word: Ctrl+Shift+S is Apply Styles (not Tiptap's strikethrough).
          "Mod-Shift-s": () => {
            ui.set({ applyStyles: true });
            return true;
          },
          "Mod-Alt-Shift-s": () => {
            ui.set({ stylesPane: !ui.getState().stylesPane });
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
          // Word: Ctrl+Alt+M inserts a comment.
          "Mod-Alt-m": () => {
            features.newComment();
            return true;
          },
          // Word: Ctrl+K Insert Link, Ctrl+G / F5 Go To, F9 Update Field.
          "Mod-k": () => {
            ui.openDialog("link");
            return true;
          },
          "Mod-g": () => {
            ui.openDialog("goTo");
            return true;
          },
          F5: () => {
            ui.openDialog("goTo");
            return true;
          },
          F9: () => {
            void features.updateFields();
            return true;
          },
        };
      },
      addProseMirrorPlugins() {
        const editor = this.editor as Editor;
        return [
          findPlugin(),
          linksPlugin(),
          tableRenderPlugin(() => ctl.styles),
          paragraphBoxPlugin(),
          tabStopsPlugin(() => ctl.styles),
          columnResizePlugin(ctl),
          paginationPlugin({
            enabled: () => ui.getState().view === "print",
            page: () => ctl.page,
            sections: () => ctl.sections,
            onEditHeaderFooter: (which) => ui.openDialog("headerFooter", which),
            onPages: (pages) => ui.set({ pages }),
            flow: (node) => features.flow(node),
            onLayout: (l) => {
              const f = ui.getState().frame;
              if (f?.firstHeader !== l.firstHeader || f?.lastFooter !== l.lastFooter) ui.set({ frame: { firstHeader: l.firstHeader, lastFooter: l.lastFooter } });
            },
          }),
          // After the pagination: page fields read its layout.
          structurePlugin({ sections: () => ctl.sections, fields: features.fields }),
          commentsPlugin({
            color: (id) => {
              const c = ctl.comments.find((x) => x.id === id);
              return authorColor(c?.author ?? "");
            },
            onActivate: (id) => {
              const cur = ui.getState().comments;
              if (cur.active !== id && (id !== null || !cur.draft)) ui.setComments({ active: id });
            },
            view: () => {
              const c = ui.getState().comments;
              return { show: c.show, active: c.active, hover: c.hover, draft: c.draft ? { from: c.draft.from, to: c.draft.to } : null };
            },
          }),
          new Plugin({
            key: featuresKey,
            props: {
              handleKeyDown(view, e) {
                // A selection the browser has just changed (Shift+Home, then Delete at once) may not have
                // reached the editor state yet: take it over before Delete / Backspace / Enter act on it.
                if (e.key === "Delete" || e.key === "Backspace" || e.key === "Enter") syncDomSelection(view);
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
                mousedown: () => {
                  // A click in the text ends "Select All N Instances".
                  if (ui.getState().styleInstances) ui.set({ styleInstances: null });
                  return false;
                },
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
              let styles = ctl.styles;
              installStyleSheetCss(styles, view.dom.ownerDocument);
              let name = ctl.getState().name;
              let mode = ui.getState().view;
              let comments = ctl.comments;
              let commentsUi = ui.getState().comments;
              let settings = ctl.settings;
              let properties = ctl.properties;
              const offCtl = ctl.subscribe(() => {
                if (ctl.styles !== styles) {
                  styles = ctl.styles;
                  installStyleSheetCss(styles, view.dom.ownerDocument);
                  refreshTables(view);
                  refreshTabs(view);
                }
                if (ctl.page !== page || ctl.sections !== sections) {
                  page = ctl.page;
                  sections = ctl.sections;
                  remeasurePages(view);
                  refreshStructure(view);
                }
                if (ctl.settings !== settings) {
                  settings = ctl.settings;
                  // Re-evaluates the editor attributes (hyphenation).
                  view.dispatch(view.state.tr.setMeta("addToHistory", false));
                  remeasurePages(view);
                }
                if (ctl.properties !== properties) {
                  properties = ctl.properties;
                  refreshStructure(view);
                }
                if (ctl.getState().name !== name) {
                  name = ctl.getState().name;
                  refreshStructure(view);
                }
                if (ctl.comments !== comments) {
                  comments = ctl.comments;
                  // A deleted comment cannot stay selected.
                  const a = ui.getState().comments.active;
                  if (a != null && !comments.some((c) => c.id === a)) ui.setComments({ active: null, editing: null });
                  refreshComments(view);
                }
              });
              const offUi = ui.subscribe(() => {
                if (ui.getState().comments !== commentsUi) {
                  commentsUi = ui.getState().comments;
                  refreshComments(view);
                }
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
