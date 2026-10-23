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
import { paginationPlugin, relayoutPages, remeasurePages, type PageLayout } from "./pagination";
import type { FlowProps } from "./layout/measure";
import { layoutFieldContext, refreshStructure, structurePlugin, updateFieldsCommand, type FieldContext } from "./structure";
import { linksPlugin } from "./links";
import { objectsPlugin } from "./drawings/objects";
import { wrapBothPlugin } from "./wrapBoth";
import { plainTextSlice } from "./plainPaste";
import { selectsAll, updateFieldsCommand as updateSelectedFields } from "./references";
import { fieldCodesPlugin, lockFieldsCommand, toggleAllFieldCodes, toggleSelectedFieldCodes } from "./fieldsW6";
import { paragraphStyleId, resolveParagraph } from "./styleCss";
import type { Node as PMNode } from "@tiptap/pm/model";
import { insertNote } from "./structureCommands";
import { listBackspace } from "./listKeys";
import { formatTarget } from "./runFormat";
import { toggleChar, toggleRun, wordUnderline } from "./wordKeys";
import { wordsUnderlinePlugin } from "./wordsUnderline";
import { loadDefaultSet } from "./styleSets";
import { toggleHeading } from "../sync/editorCommands";
import { getLocale } from "@rusuite/ui-shared";
import { caretToCell, inLastCell, tableContext } from "./tables";
import { paragraphBoxPlugin } from "./paragraphBox";
import { contextualSpacingPlugin, refreshContextualSpacing } from "./contextualSpacing";
import { listIndentPlugin, refreshListIndent } from "./listIndent";
import { refreshSectionWidths, sectionWidthPlugin } from "./sectionWidths";
import { refreshTables, tableRenderPlugin } from "./tableRender";
import { refreshTabs, tabStopsPlugin } from "./tabStops";
import { installStyleSheetCss } from "./styleCss";
import type { SyncController } from "../sync/SyncPlugin";
import { commentsPlugin, refreshComments } from "../comments/plugin";
import { draftFromSelection, type CommentDraft } from "../comments/commands";
import { authorColor, type CommentFilter } from "../comments/model";
import { t } from "../i18n";
import { innerEditors } from "./drawings/innerEditors";
import type { BorderSide } from "../generated/BorderSide";
import { autoCorrectPlugin } from "./autoCorrect";
import { borderPainterPlugin } from "./borderPainter";
import { specialCharFor } from "./specialChars";
import { caretAfterSplit, joinTablesTarget, mergeTablesCommand, splitTableCommand } from "./tables2";
import { loadOptions, type WriteOptions } from "./writeOptions";
import { rulerPreviewPlugin } from "./rulerDrag";
import { unequalColumnsPlugin } from "./unequalColumns";
import { findPos } from "../sync/SyncPlugin";

export type WriteView = "print" | "draft";
export type WriteDialog =
  | "rowHeight" | "altText" | "pageSetup" | "headerFooter" | "paragraph" | "pageNumbers"
  | "splitCells" | "cellMargins" | "tableProps" | "bordersShading" | "tabs" | "userName"
  | "link" | "bookmark" | "goTo" | "caption" | "crossRef" | "columns" | "symbol" | "dateTime" | "font"
  | "numberFormat" | "bulletFormat" | "numberingValue" | "notes" | "newDocument" | "manageStyles" | "layout"
  | "textToTable" | "tableToText" | "tableBorders" | "writeOptions" | "field" | "convertNotes" | "separators" | null;

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
  /** Review › Display for Review (P9-W6): All Markup (balloons), Simple Markup (markers, click opens one), No Markup / Original (none). */
  markup: MarkupMode;
}

export type MarkupMode = "all" | "simple" | "none" | "original";

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
  /** Reveal Formatting pane (Shift+F1) and its "Distinguish style source". */
  revealFormatting: boolean;
  /** Layout › Arrange › Selection Pane (Alt+F10). */
  selectionPane: boolean;
  revealSource: boolean;
  /** The Apply Styles box (Ctrl+Shift+S). */
  applyStyles: boolean;
  styleDialog: StyleDialog | null;
  /** "Select All N Instances": the paragraphs the next style applies to. */
  styleInstances: number[] | null;
  spellcheck: boolean;
  /** View › Ruler. */
  ruler: boolean;
  /** View › Hidden Text: hidden text (w:vanish) shown dotted. */
  hiddenText: boolean;
  find: { open: boolean; replace: boolean; seed: number };
  dialog: WriteDialog;
  /** Which field the header/footer dialog focuses. */
  headerFooterFocus: "header" | "footer";
  pages: number;
  /** Header of the first page and footer of the last page in print layout (from the sections). */
  frame: { firstHeader: string; lastFooter: string } | null;
  /** The print layout's pages (null in draft view). */
  layout: PageLayout | null;
  /** Word's Hide White Space (double-click a page gap). */
  hideWhiteSpace: boolean;
  comments: CommentsUiState;
  /** After the user name dialog: start the comment that asked for it. */
  userThen: "newComment" | null;
  /** The Paragraph dialog's tab. */
  paragraphTab: "indents" | "breaks";
  /** The Symbol dialog's tab. */
  symbolTab: "symbols" | "special";
  /** View › Gridlines (Table Layout › View Gridlines): dashed lines where a table has no border. */
  gridlines: boolean;
  /** Table Design › Border Painter and its pen. */
  borderPainter: boolean;
  pen: BorderSide;
  /** File › Options (ruler unit, AutoCorrect), this browser only. */
  options: WriteOptions;
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
    revealFormatting: false,
    selectionPane: false,
    revealSource: false,
    applyStyles: false,
    styleDialog: null,
    styleInstances: null,
    spellcheck: true,
    ruler: true,
    hiddenText: false,
    find: { open: false, replace: false, seed: 0 },
    dialog: null,
    headerFooterFocus: "header",
    pages: 1,
    frame: null,
    layout: null,
    hideWhiteSpace: false,
    comments: { show: true, pane: false, filter: "all", active: null, hover: null, draft: null, editing: null, markup: "all" },
    userThen: null,
    paragraphTab: "indents",
    symbolTab: "symbols",
    gridlines: true,
    borderPainter: false,
    pen: { style: "single", width: 10, color: { kind: "auto" } },
    options: loadOptions(),
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
  /** The band between pages in layout px (P10-M4: phones keep it at 8 px on the screen); null = `PAGE_GAP_PX`. */
  pageGap: number | null = null;
  /** Live field values: pages from the pagination, the clock, the document name. */
  readonly fields: FieldContext;

  constructor(readonly ctl: SyncController) {
    this.fields = layoutFieldContext(() => ctl.getState().name, () => getLocale(), () => new Date(), () => ctl.savingProperties ?? ctl.properties);
    ctl.defaultStyleSet = loadDefaultSet;
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

  /** Lock Fields (Ctrl+F11) / Unlock Fields (Ctrl+Shift+F11) on the selection (everything with Ctrl+A). */
  lockFields(locked: boolean): void {
    const editor = this.editor;
    if (!editor || editor.isDestroyed) return;
    const cmd = lockFieldsCommand(editor.state, locked, selectsAll(editor.state));
    if (cmd) void this.ctl.run(cmd);
  }

  /** Flow options of a paragraph (widow control, keep lines together, keep with next, page break before): its style chain, then its direct formatting. */
  flow(node: PMNode): FlowProps {
    const sheet = this.ctl.styles;
    const style = resolveParagraph(sheet, paragraphStyleId(sheet, node));
    const direct = (node.attrs.extra ?? {}) as FlowProps;
    return {
      widowControl: direct.widowControl ?? style.widowControl,
      keepLines: direct.keepLines ?? style.keepLines,
      keepNext: direct.keepNext ?? style.keepNext,
      pageBreakBefore: direct.pageBreakBefore ?? style.pageBreakBefore,
    };
  }

  /** Attributes of the editor element (spell check follows the View › Spelling toggle). */
  editorAttributes(): Record<string, string> {
    // Hyphenation (Layout › Hyphenation › Automatic) uses the UI language's patterns.
    const lang = getLocale() || (typeof navigator !== "undefined" && navigator.language ? navigator.language : "en");
    return {
      "data-testid": "editor",
      class: `tiptap-content min-h-full outline-none${this.ui.getState().hiddenText ? " show-hidden" : ""}${this.ui.getState().gridlines ? "" : " hide-gridlines"}`,
      spellcheck: this.ui.getState().spellcheck ? "true" : "false",
      lang,
      "data-hyphenate": this.ctl.settings.autoHyphenation ? "auto" : "none",
    };
  }

  /**
   * Review › New Comment (Ctrl+Alt+M): a draft balloon on the selection
   * (the word at the caret when nothing is selected). The first comment
   * asks for the user name unless the document has an author.
   */
  newComment(): void {
    const editor = this.editor;
    if (!editor || editor.isDestroyed) return;
    // Without a user name the document's author names the comment (the core's fallback); with neither, ask.
    if (!this.ctl.user && !this.ctl.properties.author?.trim()) {
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

  /** Ctrl+Shift+Enter: Split Table above the caret's row (in the first row: a paragraph above the table). */
  splitTable(editor: Editor): boolean {
    const t = tableContext(editor.state);
    const cmd = splitTableCommand(editor.state, t);
    if (!t || !cmd) return false;
    const first = t.row === 0;
    void this.ctl.run(cmd).then(() => {
      if (editor.isDestroyed) return;
      caretAfterSplit(editor.view, findPos(editor.state.doc, t.table), first);
    });
    return true;
  }

  /** Delete / Backspace in the empty paragraph between two tables: the tables are joined (Word). */
  joinTables(editor: Editor): boolean {
    const p = joinTablesTarget(editor.state);
    if (p == null) return false;
    void this.ctl.run(mergeTablesCommand(p));
    return true;
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
          // Word: Ctrl+Shift+K / A / D are small caps, all caps, double underline (W-30); bound here so that ProseMirror's
          // Shift fallback does not run Ctrl+K / Ctrl+A / Ctrl+D instead.
          "Mod-Shift-k": () => toggleChar(formatTarget(this.editor as Editor), ctl.styles, "smallCaps"),
          "Mod-Shift-a": () => toggleChar(formatTarget(this.editor as Editor), ctl.styles, "allCaps"),
          "Mod-Shift-d": () => toggleChar(formatTarget(this.editor as Editor), ctl.styles, "doubleUnderline"),
          "Mod-Shift-w": () => wordUnderline(formatTarget(this.editor as Editor), ctl.styles),
          // Word: Ctrl+B / I / U switch relative to the style (in a bold heading Ctrl+B un-bolds: `w:b w:val="0"`).
          "Mod-b": () => toggleRun(formatTarget(this.editor as Editor), ctl.styles, "bold"),
          "Mod-i": () => toggleRun(formatTarget(this.editor as Editor), ctl.styles, "italic"),
          "Mod-u": () => toggleRun(formatTarget(this.editor as Editor), ctl.styles, "underline"),
          // Word: Ctrl+Alt+1/2/3 are the Heading 1–3 styles (a toggle). Bound before Tiptap's heading keymap so that
          // both paths (focus in the editor, focus elsewhere: ShortcutLayer) do the same thing.
          "Mod-Alt-1": () => toggleHeading(this.editor as Editor, 1),
          "Mod-Alt-2": () => toggleHeading(this.editor as Editor, 2),
          "Mod-Alt-3": () => toggleHeading(this.editor as Editor, 3),
          // Word: Backspace at a list item's start removes the number first, keeping the indent (W-28); in the empty
          // paragraph between two tables Backspace / Delete join them (P9-W5).
          Backspace: () => features.joinTables(this.editor as Editor) || listBackspace(this.editor as Editor, ctl),
          Delete: () => features.joinTables(this.editor as Editor),
          // Word: Ctrl+Shift+Enter splits the table above the caret's row.
          "Mod-Shift-Enter": () => features.splitTable(this.editor as Editor),
          Escape: () => {
            if (ui.getState().borderPainter) {
              ui.set({ borderPainter: false });
              return true;
            }
            if (!painter.active) return false;
            painter.cancel(this.editor as Editor);
            return true;
          },
          // Word: Ctrl+Enter is a page break (Tiptap's hard break keeps Shift+Enter; W-29).
          "Mod-Enter": () => {
            if (tableContext(this.editor.state) || !this.editor.state.selection.$from.parent.isTextblock) return false;
            return this.editor.chain().insertContent({ type: "pageBreak" }).run();
          },
          // Word: Ctrl+Shift+S is Apply Styles (not Tiptap's strikethrough).
          "Mod-Shift-s": () => {
            ui.set({ applyStyles: true });
            return true;
          },
          // Word: Alt+F10 shows the Selection Pane.
          "Alt-F10": () => {
            ui.set({ selectionPane: !ui.getState().selectionPane });
            return true;
          },
          // Word: Shift+F1 shows the Reveal Formatting pane.
          "Shift-F1": () => {
            ui.set({ revealFormatting: !ui.getState().revealFormatting });
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
          // Word: Ctrl+D opens the Font dialog.
          "Mod-d": () => {
            ui.openDialog("font");
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
          // Word: Alt+F9 all field codes, Shift+F9 the selection's, Ctrl+F11 / Ctrl+Shift+F11 lock / unlock.
          "Alt-F9": () => {
            const view = (this.editor as Editor).view;
            view.dispatch(toggleAllFieldCodes(view.state));
            return true;
          },
          "Shift-F9": () => {
            const view = (this.editor as Editor).view;
            const tr = toggleSelectedFieldCodes(view.state);
            if (tr) view.dispatch(tr);
            return true;
          },
          "Mod-F11": () => {
            features.lockFields(true);
            return true;
          },
          "Mod-Shift-F11": () => {
            features.lockFields(false);
            return true;
          },
        };
      },
      addProseMirrorPlugins() {
        const editor = this.editor as Editor;
        return [
          findPlugin(),
          fieldCodesPlugin(),
          linksPlugin(),
          objectsPlugin(),
          wrapBothPlugin(),
          wordsUnderlinePlugin(),
          tableRenderPlugin(() => ctl.styles),
          autoCorrectPlugin(() => ui.getState().options.autoCorrect, () => getLocale() || "en"),
          rulerPreviewPlugin(),
          unequalColumnsPlugin(),
          borderPainterPlugin(
            () => ({ on: ui.getState().borderPainter, pen: ui.getState().pen }),
            (cmds) => void ctl.run(cmds.length === 1 ? cmds[0]! : { type: "compound", commands: cmds }),
          ),
          paragraphBoxPlugin(),
          contextualSpacingPlugin(() => ctl.styles),
          listIndentPlugin(() => ctl.numbering, () => ctl.styles),
          sectionWidthPlugin({ enabled: () => ui.getState().view === "print", sections: () => ctl.sections, page: () => ctl.page, styles: () => ctl.styles }),
          tabStopsPlugin(() => ctl.styles),
          columnResizePlugin(ctl),
          paginationPlugin({
            enabled: () => ui.getState().view === "print",
            page: () => ctl.page,
            sections: () => ctl.sections,
            onEditHeaderFooter: (which) => ui.openDialog("headerFooter", which),
            onPages: (pages) => ui.set({ pages }),
            flow: (node) => features.flow(node),
            hideWhiteSpace: () => ui.getState().hideWhiteSpace,
            pageGap: () => features.pageGap,
            endnotesAtSectionEnd: () => !!ctl.settings.endnotesAtSectionEnd,
            onLayout: (l) => {
              const f = ui.getState().frame;
              const frame = l && (f?.firstHeader !== l.firstHeader || f?.lastFooter !== l.lastFooter) ? { firstHeader: l.firstHeader, lastFooter: l.lastFooter } : l ? f : null;
              ui.set({ layout: l, frame });
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
              // No Markup / Original: no highlights at all; Simple Markup: only the opened comment's (Word).
              if (c.markup === "none" || c.markup === "original") return { show: false, active: null, hover: null, draft: c.draft ? { from: c.draft.from, to: c.draft.to } : null };
              return { show: c.show && c.markup !== "simple", active: c.active, hover: c.hover, draft: c.draft ? { from: c.draft.from, to: c.draft.to } : null };
            },
          }),
          new Plugin({
            key: featuresKey,
            props: {
              handleKeyDown(view, e) {
                // A selection the browser has just changed (Shift+Home, then Delete at once) may not have
                // reached the editor state yet: take it over before Delete / Backspace / Enter act on it.
                if (e.key === "Delete" || e.key === "Backspace" || e.key === "Enter") syncDomSelection(view);
                // Word's special-character keys (Ctrl+Shift+Space, Alt+Ctrl+C, Ctrl+Hyphen …).
                const special = specialCharFor(e);
                if (special && view.state.selection.$from.parent.isTextblock) {
                  e.preventDefault();
                  view.dispatch(view.state.tr.insertText(special).scrollIntoView());
                  return true;
                }
                // Word: Ctrl+= subscript, Ctrl+Shift+= superscript.
                if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.code === "Equal" || e.key === "=" || e.key === "+")) {
                  e.preventDefault();
                  toggleScript(editor, e.shiftKey ? "superscript" : "subscript");
                  return true;
                }
                return false;
              },
              // Plain text from other programs: a paragraph per line (W-06).
              clipboardTextParser: (text, $context, _plain, view) => plainTextSlice(text, $context, view.state.schema),
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
                mousedown: (_view, e) => {
                  // A click in the text ends "Select All N Instances".
                  if (ui.getState().styleInstances) ui.set({ styleInstances: null });
                  // A click outside a text box gives the caret back to the main editor.
                  if (!(e.target as HTMLElement | null)?.closest?.(".drawing-text")) innerEditors.release();
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
              let numbering = ctl.numbering;
              installStyleSheetCss(styles, view.dom.ownerDocument);
              // Shortcuts that read the selection (Ctrl+K, Ctrl+Alt+M, F9…) must see the one the browser shows: a
              // Shift+Arrow just before may not have reached the editor state yet (ProseMirror reads it on
              // `selectionchange`, which a busy frame – a page layout – delays).
              const flushBeforeShortcut = (e: KeyboardEvent) => {
                if (e.ctrlKey || e.metaKey || e.altKey || /^F\d+$/.test(e.key)) syncDomSelection(view);
              };
              view.dom.addEventListener("keydown", flushBeforeShortcut, true);
              let name = ctl.getState().name;
              let mode = ui.getState().view;
              let comments = ctl.comments;
              let commentsUi = ui.getState().comments;
              let hide = ui.getState().hideWhiteSpace;
              let hidden = ui.getState().hiddenText;
              let gridlines = ui.getState().gridlines;
              let borderPainter = ui.getState().borderPainter;
              let settings = ctl.settings;
              let properties = ctl.properties;
              const offCtl = ctl.subscribe(() => {
                if (ctl.styles !== styles) {
                  styles = ctl.styles;
                  installStyleSheetCss(styles, view.dom.ownerDocument);
                  refreshTables(view);
                  refreshTabs(view);
                  refreshContextualSpacing(view);
                  refreshListIndent(view);
                  refreshSectionWidths(view);
                  // Defaults and style sets change paragraphs the patch does not list: lay the pages out again.
                  remeasurePages(view);
                }
                if (ctl.numbering !== numbering) {
                  numbering = ctl.numbering;
                  refreshListIndent(view);
                }
                if (ctl.page !== page || ctl.sections !== sections) {
                  page = ctl.page;
                  sections = ctl.sections;
                  refreshSectionWidths(view);
                  // Blocks whose section width changed are measured again; the pages resume before the changed section.
                  relayoutPages(view);
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
                if (ui.getState().hideWhiteSpace !== hide) {
                  hide = ui.getState().hideWhiteSpace;
                  remeasurePages(view);
                }
                if (ui.getState().gridlines !== gridlines || ui.getState().borderPainter !== borderPainter) {
                  gridlines = ui.getState().gridlines;
                  borderPainter = ui.getState().borderPainter;
                  view.dispatch(view.state.tr.setMeta("addToHistory", false));
                }
                if (ui.getState().hiddenText !== hidden) {
                  hidden = ui.getState().hiddenText;
                  // Re-evaluates the editor attributes (the show-hidden class) and lays the pages out again.
                  view.dispatch(view.state.tr.setMeta("addToHistory", false));
                  remeasurePages(view);
                }
                if (ui.getState().view !== mode) {
                  mode = ui.getState().view;
                  if (mode === "draft") ui.set({ frame: null });
                  refreshSectionWidths(view);
                  remeasurePages(view);
                }
              });
              return {
                destroy() {
                  view.dom.removeEventListener("keydown", flushBeforeShortcut, true);
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
