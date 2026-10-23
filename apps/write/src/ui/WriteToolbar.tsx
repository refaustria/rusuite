// Write's ribbon: File (backstage) / Home / Insert / Layout / View, plus
// the contextual Table and Picture Format tabs while the caret is in a
// table or a picture is selected, built from the ui-shared ribbon and
// formatting controls. Run formatting goes through the editor's marks,
// paragraph formatting and picture size/alt text through node attributes
// (the transaction mapper turns them into Rust commands); insertions, table
// structure, page setup and clear formatting are Rust-first commands
// (`InsertTable`, `InsertImage`, `InsertTableRow`, `SetPage`, …).

import { aiRibbonGroup, HelpMenu } from "@rusuite/ui-shared";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { Editor } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import {
  ColorPicker, ContextMenu, FontControls, Icon, ListButtons, RIBBON_SELECT, Ribbon, RibbonButton, RibbonGallery, RibbonIcon, RibbonMenuButton,
  RibbonRow, RibbonSplitButton, RibbonStack, RibbonTableSizePicker, StyleToggles, triggerShortcut, languageRibbonGroup, withLabel,
  type AnySession, type CellStylePatch, type CellStyleView, type FormatControlProps, type RibbonGalleryItem, type RibbonMenuItem, type RibbonTab,
} from "@rusuite/ui-shared";
import type { Color } from "../../../../packages/ui-shared/src/generated/Color";
import type { Alignment } from "../generated/Alignment";
import type { PageSetup } from "../generated/PageSetup";
import type { PageSetupPatch } from "../generated/PageSetupPatch";
import type { Spacing } from "../generated/Spacing";
import {
  alignmentAt, cursorBlock, indent, runPropsAt, setAlignment, setTextStyle, styleOf,
} from "../sync/editorCommands";
import { clearFormatting, setIndent, setSpacing, toggleScript } from "../features/formatting";
import { insertImageFile, resetImageSize, selectedImage, setImageAttrs } from "../features/images";
import { caretIntoNewTable, tableContext, tableIds } from "../features/tables";
import { plainTextSlice } from "../features/plainPaste";
import { tableInfo, tableTabs, type TableInfo } from "./tableTabs";
import { ListGalleries } from "./listGalleries";
import { paragraphBorderState, selectedParagraphs } from "../features/paragraphFormat";
import { paragraphBordersMenu, paragraphShadingPicker } from "./paragraphControls";
import { pictureArrangeItems, setSelectedAnchor } from "./pictureControls";
import { alignOne, fontExtras, groupMenu, insertDrawingButtons, pictureCropButton, pictureFormatGroups, shapeFormatTab } from "./drawingTabs";
import { alignObjectsMenu, orderMenus, selectionPaneButton } from "./arrangeControls";
import { editSelectedDrawing, selectedDrawing } from "../features/drawings/drawings";
import { formatTarget } from "../features/runFormat";
import { innerEditors } from "../features/drawings/innerEditors";
import { selectedObjects } from "../features/drawings/objects";
import type { Drawing } from "../generated/Drawing";
import type { PictureFormat } from "../generated/PictureFormat";
import type { Anchor } from "../generated/Anchor";
import type { MarkupMode } from "../features/WriteFeatures";
import type { WriteFeatures } from "../features/WriteFeatures";
import { currentLayout, pageAtPos } from "../features/pagination";
import { formatDateTime, goToNextRef } from "../features/structure";
import {
  currentSection, insertField, insertNote, insertSectionBreak, insertToc, sectionCommand, updateTocs,
} from "../features/structureCommands";
import type { FieldKind } from "../generated/FieldKind";
import type { SectionKind } from "../generated/SectionKind";
import { TEXTBLOCK_TYPES } from "../sync/schema";
import type { SyncController, SyncState } from "../sync/SyncPlugin";
import { cm, fromCm, fromPt, paragraphInEffect, pt } from "./dialogs";
import { useThrottledEditorState } from "./useThrottledEditorState";
import { styleMenuItems, useGallery } from "./stylesPane";
import { previewStyle, styleLabel } from "../features/styleCss";
import { applyStyle } from "../features/styleCommands";
import { styleFromMarks } from "../sync/fromPM";
import type { Style } from "../generated/Style";
import { useT } from "../i18n";
import { getLocale, contextualTabs, CONTEXT_COLORS } from "@rusuite/ui-shared";
import { fontBoxValue, resolvedRunAt } from "../features/fontBox";
import { toggleRun, type RunSwitch } from "../features/wordKeys";
import { designTab } from "./designTab";
import { presetColumns, presetOf, textWidth, type ColumnPreset } from "../features/columns";
import { columnsCommand } from "../features/columns";
import { CAPTION_LABELS } from "../features/references";
import { insertTableOfFigures } from "../features/structureCommands";
import { symbolGallery } from "./referenceDialogs";
import { deleteAllComments, deleteComment, goToComment, resolveComment } from "../comments/commands";
import {
  DELETE_COMMENT_ICON, NEW_COMMENT_ICON, NEXT_COMMENT_ICON, PANE_ICON, PREV_COMMENT_ICON, RESOLVE_ICON, SHOW_COMMENTS_ICON,
} from "../comments/CommentsUi";

// ----- page setup ---------------------------------------------------------------

/** Paper sizes in twips (portrait). */
export const PAGE_SIZES: { id: string; readonly label: string; width: number; height: number }[] = [
  withLabel({ id: "A4", width: 11906, height: 16838 }, "print.paper.A4"),
  withLabel({ id: "Letter", width: 12240, height: 15840 }, "print.paper.Letter"),
];

/** Margin presets in twips (Word's Normal / Narrow / Moderate / Wide). */
export const MARGIN_PRESETS: { id: string; readonly label: string; top: number; right: number; bottom: number; left: number }[] = [
  withLabel({ id: "normal", top: 1440, right: 1440, bottom: 1440, left: 1440 }, "write.margins.normal"),
  withLabel({ id: "narrow", top: 720, right: 720, bottom: 720, left: 720 }, "write.margins.narrow"),
  withLabel({ id: "moderate", top: 1440, right: 1080, bottom: 1440, left: 1080 }, "write.margins.moderate"),
  withLabel({ id: "wide", top: 1440, right: 2880, bottom: 1440, left: 2880 }, "write.margins.wide"),
];

const near = (a: number, b: number) => Math.abs(a - b) <= 20;

/** The paper of a page (either orientation), if it is a known size. */
export function paperOf(page: PageSetup | null): string | null {
  if (!page) return null;
  const short = Math.min(page.width, page.height);
  const long = Math.max(page.width, page.height);
  return PAGE_SIZES.find((p) => near(p.width, short) && near(p.height, long))?.id ?? null;
}

/** `SetPage` patch for a paper size, keeping the orientation. */
export function paperPatch(page: PageSetup | null, id: string): PageSetupPatch | null {
  const p = PAGE_SIZES.find((x) => x.id === id);
  if (!p) return null;
  const landscape = page?.orientation === "landscape";
  return landscape ? { width: p.height, height: p.width } : { width: p.width, height: p.height };
}

export function marginPresetOf(page: PageSetup | null): string | null {
  if (!page) return null;
  const m = page.margins;
  return MARGIN_PRESETS.find((p) => near(p.top, m.top) && near(p.right, m.right) && near(p.bottom, m.bottom) && near(p.left, m.left))?.id ?? null;
}

// ----- paragraph helpers ----------------------------------------------------------

export const LINE_SPACINGS = [1, 1.15, 1.5, 2, 2.5, 3];

function selectedTextblocks(editor: Editor): [PMNode, number][] {
  const { from, to } = editor.state.selection;
  const out: [PMNode, number][] = [];
  editor.state.doc.nodesBetween(from, to, (node, pos) => {
    if (TEXTBLOCK_TYPES.has(node.type.name)) {
      out.push([node, pos]);
      return false;
    }
    return true;
  });
  return out;
}

/** Sets the line spacing (multiple) of the selected paragraphs. */
export function setLineSpacing(editor: Editor, value: number): boolean {
  const tr = editor.state.tr;
  for (const [node, pos] of selectedTextblocks(editor)) {
    const cur = (node.attrs.spacing as Spacing | null) ?? {};
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, spacing: { ...cur, line: { kind: "multiple", value } } });
  }
  if (!tr.docChanged) return false;
  editor.view.dispatch(tr);
  return true;
}

function lineSpacingAt(editor: Editor): number | null {
  const first = selectedTextblocks(editor)[0];
  const line = (first?.[0].attrs.spacing as Spacing | null)?.line;
  return line?.kind === "multiple" ? line.value : null;
}

// ----- style gallery ----------------------------------------------------------------

const GALLERY_SAMPLE = "AaBbCc"; // i18n-ignore: sample text

/** Styles shown inline; the rest are in "More styles". */
const INLINE_STYLES = 6;

// ----- small controls ------------------------------------------------------------------

/** Word's text highlight colors. */
export const HIGHLIGHT_COLORS: { readonly label: string; hex: string }[] = [
  withLabel({ hex: "FFFF00" }, "write.color.yellow"), withLabel({ hex: "00FF00" }, "write.color.brightGreen"), withLabel({ hex: "00FFFF" }, "write.color.turquoise"),
  withLabel({ hex: "FF00FF" }, "write.color.pink"), withLabel({ hex: "0000FF" }, "write.color.blue"), withLabel({ hex: "FF0000" }, "write.color.red"),
  withLabel({ hex: "000080" }, "write.color.darkBlue"), withLabel({ hex: "008080" }, "write.color.teal"), withLabel({ hex: "008000" }, "write.color.green"),
  withLabel({ hex: "800080" }, "write.color.violet"), withLabel({ hex: "800000" }, "write.color.darkRed"), withLabel({ hex: "808000" }, "write.color.darkYellow"),
  withLabel({ hex: "808080" }, "write.color.gray50"), withLabel({ hex: "C0C0C0" }, "write.color.gray25"), withLabel({ hex: "000000" }, "write.color.black"),
];

const swatch = (css: string | undefined) => (
  <span className="inline-block h-3.5 w-3.5 rounded-sm border border-ui-border" style={{ background: css ?? "transparent" }} />
);

/** A labelled number field that commits on Enter or blur. */
function NumberField({ label, value, onCommit, width = "w-14" }: { label: string; value: string; onCommit: (text: string) => void; width?: string }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <label className="flex items-center gap-1 text-[11px] text-ui-fg">
      <span className="whitespace-nowrap">{label}</span>
      <input
        aria-label={label}
        className={`${RIBBON_SELECT} ${width}`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text !== value && onCommit(text)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onCommit(text);
          }
        }}
      />
    </label>
  );
}

const SCRIPT_ICON = (sup: boolean) => (
  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <path d="M3 6l7 9M10 6l-7 9" />
    <path d={sup ? "M13 3.5h4M13 3.5c1.5-1.5 4-1 4 .8 0 1.6-4 2.2-4 4.2h4" : "M13 12.5c1.5-1.5 4-1 4 .8 0 1.6-4 2.2-4 4.2h4"} />
  </svg>
);

const PAINTER_ICON = (
  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
    <rect x="3" y="2.5" width="12" height="5" rx="1" />
    <path d="M15 5h2v4h-7v3" />
    <rect x="8.5" y="12" width="3" height="5.5" rx="0.5" />
  </svg>
);

const HIGHLIGHT_ICON = (
  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
    <path d="M5 13l7-9 3 2.5-6 9.5H5z" />
    <path d="M3 18h14" strokeWidth="2.5" stroke="#f5d90a" />
  </svg>
);

const svg = (children: ReactNode) => (
  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);
const FOOTNOTE_ICON = svg(<><path d="M3 4h9M3 7.5h9M3 11h6" /><path d="M14 3.5v4" /><path d="M3 15.5h4M3 17.5h8" strokeWidth="1" /></>);
const ENDNOTE_ICON = svg(<><path d="M3 4h9M3 7.5h9" /><path d="M14 3.5v4" /><path d="M3 13h14" strokeDasharray="1.5 1.5" /><path d="M3 16h8" strokeWidth="1" /></>);
const TOC_ICON = svg(<><path d="M3 4h8M5 8h7M5 12h7M3 16h8" /><path d="M14 4h3M14 8h3M14 12h3M14 16h3" strokeDasharray="1 1.2" /></>);
const UPDATE_ICON = svg(<><path d="M15.5 8A6 6 0 004.6 6M4.5 12a6 6 0 0010.9 2" /><path d="M4.5 3v3h3M15.5 17v-3h-3" /></>);
const FIELD_ICON = svg(<><rect x="3" y="6" width="14" height="8" rx="1.5" /><path d="M6.5 10h7" strokeDasharray="1.5 1.2" /></>);
const TABS_ICON = svg(<><path d="M3 5v6h5M10 5v6M7 11h6M17 5v6h-5" /><path d="M3 15h14" strokeDasharray="1.5 1.5" /></>);
const LINK_ICON = svg(<><path d="M8.5 11.5a3.5 3.5 0 005 0l2.5-2.5a3.5 3.5 0 00-5-5L10 5" /><path d="M11.5 8.5a3.5 3.5 0 00-5 0L4 11a3.5 3.5 0 005 5l1-1" /></>);
const BOOKMARK_ICON = svg(<path d="M6 3h8v14l-4-3-4 3z" />);
const XREF_ICON = svg(<><path d="M3 5h7M3 9h5M3 13h7" /><path d="M13 6h4v4M17 6l-5 5" /></>);
const CAPTION_ICON = svg(<><rect x="4" y="3" width="12" height="9" rx="1" /><path d="M5 15.5h10M7 17.5h6" /></>);
const FIGURES_ICON = svg(<><rect x="3" y="3" width="5" height="4" /><path d="M10 5h7" /><rect x="3" y="10" width="5" height="4" /><path d="M10 12h7" strokeDasharray="1.2 1.2" /></>);
const SYMBOL_ICON = svg(<path d="M6 16.5h3v-2.2A5.5 5.5 0 015 9.2a5 5 0 1110 0 5.5 5.5 0 01-4 5.1v2.2h3" />);
const DATE_ICON = svg(<><rect x="3" y="4.5" width="14" height="12" rx="1.5" /><path d="M3 8h14M7 3v3M13 3v3" /></>);
const COLUMNS_ICON = svg(<><path d="M3 4h6M3 7h6M3 10h6M3 13h6M3 16h6" /><path d="M11 4h6M11 7h6M11 10h6M11 13h6M11 16h4" /></>);
const HYPHEN_ICON = svg(<><path d="M3 6h9M3 10h6M3 14h9" /><path d="M11 10h3" strokeWidth="2" /></>);
const NEXT_ICON = (down: boolean) => svg(<><path d="M4 5h7M4 9h7M4 13h4" /><path d={down ? "M15 6v8M12.5 11.5L15 14l2.5-2.5" : "M15 14V6M12.5 8.5L15 6l2.5 2.5"} /></>);

/** Fields of Insert › Field. */
export const FIELD_CHOICES: { id: FieldKind["kind"]; readonly label: string }[] = [
  withLabel({ id: "page" as const }, "write.field.page"),
  withLabel({ id: "numPages" as const }, "write.field.numPages"),
  withLabel({ id: "date" as const }, "write.field.date"),
  withLabel({ id: "time" as const }, "write.field.time"),
  withLabel({ id: "fileName" as const }, "write.field.fileName"),
  withLabel({ id: "author" as const }, "write.field.author"),
  withLabel({ id: "title" as const }, "write.field.title"),
  withLabel({ id: "subject" as const }, "write.field.subject"),
  withLabel({ id: "keywords" as const }, "write.field.keywords"),
  withLabel({ id: "comments" as const }, "write.field.comments"),
  withLabel({ id: "docProperty" as const }, "write.field.company"),
  withLabel({ id: "lastSavedBy" as const }, "write.field.lastSavedBy"),
  withLabel({ id: "saveDate" as const }, "write.field.saveDate"),
];

/** Date/time pictures by UI language (Word's defaults). */
export function datePicture(locale: string, kind: "date" | "time"): string {
  if (kind === "time") return "HH:mm";
  return locale.startsWith("de") ? "dd.MM.yyyy" : "M/d/yyyy";
}

// ----- the ribbon ----------------------------------------------------------------------

function useSync<T>(ctl: SyncController, select: (s: SyncState) => T): T {
  return useSyncExternalStore(ctl.subscribe, () => select(ctl.getState()));
}

/** Layout › Columns presets. */
export const COLUMN_PRESETS: [ColumnPreset, string][] = [
  ["one", "write.columns.one"],
  ["two", "write.columns.two"],
  ["three", "write.columns.three"],
  ["left", "write.columns.left"],
  ["right", "write.columns.right"],
];

export interface WriteRibbonProps {
  editor: Editor;
  ctl: SyncController;
  session: AnySession;
  page: PageSetup | null;
  features: WriteFeatures;
  onOpen: () => void;
  onSave: () => void;
  onFind: () => void;
  onReplace?: () => void;
  onExportPdf: () => void;
  /** File › Print page (settings and preview). */
  print?: ReactNode;
  /** File › Info page (document properties). */
  infoPage?: ReactNode;
  zoom: number;
  onZoom: (zoom: number) => void;
}

export const WRITE_ZOOM_LEVELS = [0.5, 0.75, 1, 1.25, 1.5, 2];

/** What the Table / Picture Format tabs need from the selection. */
function selectionInfo(e: Editor): { table: TableInfo | null; image: { node: PMNode; pos: number } | null; drawing: Drawing | null } {
  return { table: tableInfo(tableContext(e.state)), image: selectedImage(e.state), drawing: selectedDrawing(e.state)?.value ?? null };
}

export function WriteRibbon({ editor, ctl, session, page, features, onOpen, onSave, onFind, onReplace, onExportPdf, print, infoPage, zoom, onZoom }: WriteRibbonProps) {
  const t = useT();
  const gallery = useGallery(editor, ctl);
  const [styleMenu, setStyleMenu] = useState<{ at: { x: number; y: number }; style: Style } | null>(null);
  // Word's highlighter applies the last colour chosen (yellow at first; "No Color" erases) – W-04.
  const [lastHighlight, setLastHighlight] = useState<string | null>("FFFF00");
  const fileInput = useRef<HTMLInputElement>(null);
  const canUndo = useSync(ctl, (s) => s.canUndo);
  const canRedo = useSync(ctl, (s) => s.canRedo);
  const name = useSync(ctl, (s) => s.name);
  const dirty = useSync(ctl, (s) => s.dirty);
  const ui = useSyncExternalStore(features.ui.subscribe, features.ui.getState);
  // The text box with the caret (its Shape Format tab stays while its text is edited).
  const activeInner = useSyncExternalStore(innerEditors.subscribe, () => innerEditors.active());
  const painter = useSyncExternalStore(features.painter.subscribe, () => features.painter.active);
  const s = useThrottledEditorState({
    editor,
    selector: ({ editor: e }) => {
      const { $from } = e.state.selection;
      let style = "Normal";
      for (let d = $from.depth; d > 0; d--) {
        if (TEXTBLOCK_TYPES.has($from.node(d).type.name)) {
          style = styleOf($from.node(d));
          break;
        }
      }
      const charStyle = styleFromMarks(e.state.storedMarks ?? $from.marks()) ?? null;
      const { table, image, drawing } = selectionInfo(e);
      const sec = currentSection(e.state, ctl.sections);
      // Layout › Paragraph shows the values in effect, like the Paragraph dialog (W-23).
      const { spacing: sp, indent: ind } = paragraphInEffect(e, ctl);
      return {
        props: runPropsAt(e),
        // Home › Font shows what is in effect (style chain and theme fonts), not only direct formatting.
        fontBox: fontBoxValue(e.state, ctl.styles),
        // Bold / Italic / Underline / Strikethrough are pressed for what is in effect (a bold heading: Bold on).
        resolved: resolvedRunAt(e.state, ctl.styles),
        columns: sec?.columns ?? null,
        style,
        charStyle,
        align: alignmentAt(e),
        line: lineSpacingAt(e),
        bullet: e.isActive("bulletList"),
        ordered: e.isActive("orderedList"),
        superscript: e.isActive("superscript"),
        subscript: e.isActive("subscript"),
        before: sp.before ?? null,
        after: sp.after ?? null,
        indentLeft: ind.left ?? null,
        indentRight: ind.right ?? null,
        table,
        sectionPage: sec?.page ?? null,
        image: image
          ? {
              pos: image.pos,
              width: image.node.attrs.width as number,
              height: image.node.attrs.height as number,
              alt: (image.node.attrs.alt as string | null) ?? "",
              anchor: (image.node.attrs.anchor as Anchor | null) ?? null,
              format: (image.node.attrs.format as PictureFormat | null) ?? null,
            }
          : null,
        drawing,
        // The Shift/Ctrl+click object set: Group / Align / Distribute are enabled from it, and adding an object is a
        // meta-only transaction that changes nothing else here – without it the menus kept the old state (P9-Q1).
        objects: selectedObjects(e.state).map((o) => o.pos),
        borders: paragraphBorderState(selectedParagraphs(e.state)),
      };
    },
  });
  // The gallery marks the character style at the caret, else the paragraph style.
  const charGallery = s.charStyle ? (gallery.sheet?.styles.find((x) => x.id === s.charStyle) ?? null) : null;
  const currentStyle = charGallery?.link && gallery.styles.some((g) => g.id === charGallery.link) ? charGallery.link : (s.charStyle ?? s.style);
  const galleryItems: RibbonGalleryItem[] = gallery.styles.map((st) => ({
    id: st.id,
    label: styleLabel(st),
    preview: (
      <span className="block max-w-full truncate px-0.5 leading-5" style={previewStyle(gallery.sheet, st, 12)}>
        {GALLERY_SAMPLE}
      </span>
    ),
  }));
  const value: CellStyleView = {
    font: {
      ...s.props,
      bold: !!s.resolved.bold, italic: !!s.resolved.italic, strike: !!s.resolved.strike, underline: s.resolved.underline ?? "none",
      font: s.fontBox.font, size: s.fontBox.size,
    } as CellStyleView["font"],
  };

  const onChange = (patch: CellStylePatch) => {
    const f = patch.font ?? {};
    // Inside a text box the text box's editor is formatted (Word).
    const target = formatTarget(editor);
    const chain = () => target.chain().focus();
    // Word's toggle semantics: switched relative to the style (Bold off in a bold heading writes `w:b w:val="0"`).
    const sw = (kind: RunSwitch, on: boolean) => {
      target.commands.focus();
      toggleRun(target, ctl.styles, kind, on);
    };
    if (f.bold !== undefined) sw("bold", f.bold);
    if (f.italic !== undefined) sw("italic", f.italic);
    if (f.strike !== undefined) sw("strike", f.strike);
    if (f.underline !== undefined) {
      if (f.underline === "none") sw("underline", false);
      else if (f.underline === "single") sw("underline", true);
      else chain().setMark("underline", { kind: f.underline }).run();
    }
    const ts: Parameters<typeof setTextStyle>[1] = {};
    if (f.font) ts.font = f.font;
    if (f.size) ts.size = f.size;
    if (f.color) ts.color = f.color.kind === "auto" ? null : f.color;
    if (Object.keys(ts).length) {
      target.commands.focus();
      setTextStyle(target, ts);
    }
  };
  const fmt: FormatControlProps = { value, onChange };
  const textStyle = (patch: Parameters<typeof setTextStyle>[1]) => {
    const target = formatTarget(editor);
    target.commands.focus();
    setTextStyle(target, patch);
  };

  const alignBtn = (a: Alignment, label: string, icon: ReactNode, shortcut: string) => (
    <RibbonButton
      label={label}
      icon={icon}
      shortcut={shortcut}
      pressed={s.align === a}
      onClick={() => {
        editor.commands.focus();
        setAlignment(editor, a);
      }}
    />
  );

  const insertTable = async (rows: number, cols: number) => {
    const at = cursorBlock(editor);
    const known = tableIds(editor.state.doc);
    await ctl.run({ type: "insertTable", after: at?.id ?? null, parent: at?.cell ?? null, rows, cols });
    if (!editor.isDestroyed) caretIntoNewTable(editor.view, known);
  };

  const clipboard = (kind: "cut" | "copy") => {
    editor.commands.focus();
    try {
      document.execCommand(kind);
    } catch {
      // not supported: the keyboard shortcut still works
    }
  };
  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      // As text (never parsed as HTML), one paragraph per line like Ctrl+V of plain text.
      if (text) {
        editor.commands.focus();
        const { state } = editor;
        editor.view.dispatch(state.tr.replaceSelection(plainTextSlice(text, state.selection.$from, state.schema)).scrollIntoView());
      }
    } catch {
      ctl.pushError(new Error(t("write.pasteNeedsClipboard")));
    }
  };

  const setPage = (patch: PageSetupPatch | null) => {
    if (patch) void ctl.run({ type: "setPage", patch });
  };
  // Layout › page setup acts on the caret's section (Word); documents without sections use SetPage.
  const secPage = s.sectionPage ?? page;
  const setSectionPage = (patch: PageSetupPatch | null) => {
    if (!patch) return;
    const cmd = sectionCommand(editor.state, ctl, { page: patch });
    if (cmd) void ctl.run(cmd);
  };
  const paper = paperOf(secPage);
  const margins = marginPresetOf(secPage);
  const orientation = secPage?.orientation ?? "portrait";
  const fieldCached = (kind: FieldKind["kind"]): FieldKind & { cached: string } => {
    const now = new Date();
    const locale = getLocale();
    const layout = currentLayout(editor.state);
    switch (kind) {
      case "page": {
        return { kind, cached: pageAtPos(layout, editor.state.selection.from)?.number ?? "1" };
      }
      case "numPages":
        return { kind, cached: String(layout?.pages.length ?? 1) };
      case "date":
      case "time": {
        const format = datePicture(locale, kind);
        return { kind, value: { format }, cached: formatDateTime(now, format, locale) };
      }
      case "fileName":
        return { kind, cached: name ?? "" };
      case "title":
        return { kind, cached: ctl.properties.title ?? "" };
      case "subject":
        return { kind, cached: ctl.properties.subject ?? "" };
      case "keywords":
        return { kind, cached: ctl.properties.keywords ?? "" };
      case "comments":
        return { kind, cached: ctl.properties.description ?? "" };
      case "lastSavedBy":
        return { kind, cached: ctl.properties.lastModifiedBy ?? "" };
      // Insert › Field › Company: Word's DOCPROPERTY Company.
      case "docProperty":
        return { kind, value: { name: "Company" }, cached: ctl.properties.company ?? "" };
      case "saveDate": {
        const format = datePicture(locale, "date");
        const m = ctl.properties.modified ? new Date(ctl.properties.modified) : null;
        return { kind, value: { format }, cached: m && !Number.isNaN(m.getTime()) ? formatDateTime(m, format, locale) : "" };
      }
      default:
        return { kind: "author", cached: ctl.properties.author ?? "" };
    }
  };
  const addField = (kind: FieldKind["kind"]) => {
    const { cached, ...field } = fieldCached(kind);
    void insertField(editor, ctl, field as FieldKind, cached);
  };
  const sectionBreak = (kind: SectionKind) => void insertSectionBreak(editor, ctl, kind);

  const pickStyle = (id: string) => {
    const st = features.ui.getState();
    void applyStyle(editor, ctl, id, { linkedDisabled: st.linkedDisabled, instances: st.styleInstances });
    if (st.styleInstances) features.ui.set({ styleInstances: null });
  };
  const onStyleMenu = (id: string, at: { x: number; y: number }) => {
    const style = gallery.sheet?.styles.find((x) => x.id === id);
    if (style) setStyleMenu({ at, style });
  };
  const para = (f: () => unknown) => () => {
    editor.commands.focus();
    f();
  };

  const highlightMenu: RibbonMenuItem[] = [
    {
      id: "none",
      label: t("write.noColor"),
      icon: swatch(undefined),
      onSelect: () => {
        setLastHighlight(null);
        textStyle({ highlight: null });
      },
    },
    ...HIGHLIGHT_COLORS.map((c) => ({
      id: c.hex,
      label: c.label,
      icon: swatch(`#${c.hex}`),
      checked: s.props.highlight?.kind === "rgb" && s.props.highlight.value.toUpperCase() === c.hex,
      onSelect: () => {
        setLastHighlight(c.hex);
        textStyle({ highlight: { kind: "rgb", value: c.hex } as Color });
      },
    })),
  ];

  const lineMenu: RibbonMenuItem[] = [
    ...LINE_SPACINGS.map((v) => ({
      id: String(v),
      label: v.toFixed(v === 1.15 ? 2 : 1),
      checked: s.line === v,
      onSelect: para(() => setLineSpacing(editor, v)),
    })),
    { separator: true },
    { id: "options", label: t("write.lineSpacingOptions"), onSelect: () => features.ui.openDialog("paragraph") },
    { separator: true },
    (s.before ?? 0) > 0
      ? { id: "before", label: t("write.removeSpaceBefore"), onSelect: para(() => setSpacing(editor, { before: 0 })) }
      : { id: "before", label: t("write.addSpaceBefore"), onSelect: para(() => setSpacing(editor, { before: 240 })) },
    (s.after ?? 1) > 0
      ? { id: "after", label: t("write.removeSpaceAfter"), onSelect: para(() => setSpacing(editor, { after: 0 })) }
      : { id: "after", label: t("write.addSpaceAfter"), onSelect: para(() => setSpacing(editor, { after: 160 })) },
  ];

  const home: RibbonTab = {
    id: "home",
    label: t("tab.home"),
    toolbarLabel: t("fmt.toolbar"),
    groups: [
      {
        label: t("group.undo"),
        items: (
          <RibbonStack>
            <RibbonButton label={t("group.undo")} icon="undo" shortcut="Mod+Z" disabled={!canUndo} onClick={() => ctl.undo()} />
            <RibbonButton label={t("cmd.redo")} icon="redo" shortcut="Mod+Y" disabled={!canRedo} onClick={() => ctl.redo()} />
          </RibbonStack>
        ),
      },
      {
        label: t("group.clipboard"),
        items: (
          <>
            <RibbonButton label={t("cmd.paste")} icon="paste" size="large" shortcut="Mod+V" onClick={() => void paste()} />
            {/* Two rows fit the 64 px group: Cut; Copy + the format painter (W-01). */}
            <RibbonStack>
              <RibbonButton label={t("cmd.cut")} icon="cut" showLabel shortcut="Mod+X" onClick={() => clipboard("cut")} />
              <RibbonRow>
                <RibbonButton label={t("cmd.copy")} icon="copy" showLabel shortcut="Mod+C" onClick={() => clipboard("copy")} />
                <span
                  onDoubleClick={() => {
                    features.painter.copy(editor, true);
                  }}
                >
                  <RibbonButton
                    label={t("write.formatPainter")}
                    icon={PAINTER_ICON}
                    pressed={painter}
                    shortcut="Mod+Shift+C"
                    tooltip={t("write.formatPainterTip")}
                    onClick={() => (features.painter.active ? features.painter.cancel(editor) : features.painter.copy(editor))}
                  />
                </span>
              </RibbonRow>
            </RibbonStack>
          </>
        ),
      },
      {
        label: t("group.font"),
        items: (
          <RibbonStack>
            <RibbonRow>
              <FontControls {...fmt} />
              <RibbonButton label={t("write.clearFormatting")} icon="clear" tooltip={t("write.clearAllFormatting")} onClick={() => void clearFormatting(editor, ctl, true)} />
            </RibbonRow>
            <RibbonRow>
              <StyleToggles {...fmt} />
              <RibbonButton label={t("write.subscript")} icon={SCRIPT_ICON(false)} shortcut="Mod+=" pressed={s.subscript} onClick={() => toggleScript(editor, "subscript")} />
              <RibbonButton label={t("write.superscript")} icon={SCRIPT_ICON(true)} shortcut="Mod+Shift+=" pressed={s.superscript} onClick={() => toggleScript(editor, "superscript")} />
              <RibbonSplitButton
                label={t("write.highlight")}
                icon={HIGHLIGHT_ICON}
                menu={highlightMenu}
                onClick={() => textStyle({ highlight: lastHighlight ? ({ kind: "rgb", value: lastHighlight } as Color) : null })}
              />
              <ColorPicker label={t("write.fontColor")} kind="text" value={s.props.color ?? undefined} onSelect={(c) => textStyle({ color: c && c.kind !== "auto" ? c : null })} />
              {fontExtras(editor, ctl, s.props)}
              <RibbonButton label={t("write.fontDialog")} icon="format" shortcut="Mod+D" tooltip={t("write.fontDialogTip")} onClick={() => features.ui.openDialog("font")} />
            </RibbonRow>
          </RibbonStack>
        ),
      },
      {
        label: t("group.paragraph"),
        items: (
          <RibbonStack>
            <RibbonRow>
              <ListButtons
                bullet={s.bullet}
                ordered={s.ordered}
                onToggle={(kind) => (kind === "bullet" ? editor.chain().focus().toggleBulletList() : editor.chain().focus().toggleOrderedList()).run()}
                onIndent={(d) => {
                  editor.commands.focus();
                  indent(editor, d);
                }}
              />
              <ListGalleries editor={editor} ctl={ctl} features={features} />
              <RibbonMenuButton label={t("write.lineSpacing")} icon="lineSpacing" menu={lineMenu} />
              <RibbonButton label={t("write.paragraphSettings")} icon="format" tooltip={t("write.paragraphSettingsTip")} onClick={() => features.ui.openDialog("paragraph")} />
            </RibbonRow>
            <RibbonRow>
              {alignBtn("left", t("fmt.alignLeft"), <Icon name="alignLeft" />, "Mod+L")}
              {alignBtn("center", t("fmt.alignCenter"), <Icon name="alignCenter" />, "Mod+E")}
              {alignBtn("right", t("fmt.alignRight"), <Icon name="alignRight" />, "Mod+R")}
              {alignBtn("justify", t("write.justify"), <RibbonIcon name="alignJustify" />, "Mod+J")}
              {paragraphShadingPicker(editor, ctl)}
              {paragraphBordersMenu(editor, ctl, features, s.borders)}
              <RibbonButton label={t("write.tabsDots")} icon={TABS_ICON} tooltip={t("write.tabsTip")} onClick={() => features.ui.openDialog("tabs")} />
            </RibbonRow>
          </RibbonStack>
        ),
      },
      {
        label: t("write.styles"),
        items: (
          <>
            <RibbonGallery
              label={t("write.paragraphStyles")}
              items={galleryItems.slice(0, INLINE_STYLES)}
              selected={currentStyle}
              onSelect={pickStyle}
              itemClassName="h-12 w-16"
              onItemContextMenu={onStyleMenu}
            />
            <RibbonStack>
              <RibbonMenuButton
                label={t("write.moreStyles")}
                icon="chevronDown"
                menu={(close) => (
                  <div className="flex flex-col gap-1 p-1" data-testid="styles-gallery-more">
                    <RibbonGallery
                      label={t("write.moreStyles")}
                      items={galleryItems}
                      selected={currentStyle}
                      columns={4}
                      itemClassName="h-14 w-20 p-1"
                      autoFocus
                      onItemContextMenu={(id, at) => {
                        close();
                        onStyleMenu(id, at);
                      }}
                      onSelect={(id) => {
                        close();
                        pickStyle(id);
                      }}
                    />
                    <div className="flex flex-col border-t border-ui-border pt-1 text-xs">
                      {(
                        [
                          ["create", t("write.styles.createDots"), () => features.ui.set({ styleDialog: { mode: "create" } })],
                          ["clear", t("write.clearAllFormatting"), () => void clearFormatting(editor, ctl, true)],
                          ["apply", t("write.styles.applyStylesDots"), () => features.ui.set({ applyStyles: true })],
                        ] as const
                      ).map(([id, label, run]) => (
                        <button
                          key={id}
                          type="button"
                          className="min-h-8 rounded px-2 text-left hover:bg-ui-hover"
                          onClick={() => {
                            close();
                            run();
                          }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              />
              <RibbonButton
                label={t("write.styles.pane")}
                icon="format"
                shortcut="Mod+Alt+Shift+S"
                pressed={ui.stylesPane}
                onClick={() => features.ui.set({ stylesPane: !ui.stylesPane })}
              />
            </RibbonStack>
            <ContextMenu
              at={styleMenu?.at ?? null}
              label={t("write.styles.styleMenu", { name: styleMenu ? styleLabel(styleMenu.style) : "" })}
              items={styleMenu ? styleMenuItems({ editor, ctl, ui: features.ui, style: styleMenu.style, count: gallery.inUse.get(styleMenu.style.id) ?? 0, inPane: false }) : []}
              onClose={() => setStyleMenu(null)}
            />
          </>
        ),
      },
      {
        label: t("group.editing"),
        collapsePriority: 1,
        items: (
          <RibbonStack>
            <RibbonButton label={t("cmd.findReplace")} icon="find" showLabel shortcut="Mod+F" tooltip={t("cmd.find")} onClick={onFind} />
            <RibbonButton label={t("cmd.replace")} icon="format" showLabel shortcut="Mod+H" onClick={onReplace ?? onFind} />
          </RibbonStack>
        ),
      },
      aiRibbonGroup(session.ai),
    ],
  };

  const insert: RibbonTab = {
    id: "insert",
    label: t("tab.insert"),
    groups: [
      {
        label: t("write.tables"),
        items: (
          <RibbonMenuButton
            label={t("write.table")}
            icon="table"
            size="large"
            menu={(close) => (
              <div className="flex flex-col">
                <RibbonTableSizePicker
                  onPick={(r, c) => {
                    close();
                    void insertTable(r, c);
                  }}
                />
                <button
                  type="button"
                  className="min-h-8 rounded border-t border-ui-border px-2 text-left text-xs hover:bg-ui-hover"
                  data-testid="convert-text-to-table"
                  onClick={() => {
                    close();
                    features.ui.openDialog("textToTable");
                  }}
                >
                  {t("write.w5.textToTableDots")}
                </button>
              </div>
            )}
          />
        ),
      },
      {
        label: t("write.illustrations"),
        items: (
          <>
            <RibbonButton label={t("write.picture")} icon="image" size="large" tooltip={t("write.pictureTip")} onClick={() => fileInput.current?.click()} />
            {insertDrawingButtons(editor, ctl)}
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/gif"
              className="hidden"
              data-testid="image-input"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void insertImageFile(editor, ctl, file, file.name).catch((err) => ctl.pushError(err));
              }}
            />
          </>
        ),
      },
      {
        label: t("write.links"),
        items: (
          <>
            <RibbonButton label={t("write.link.button")} icon={LINK_ICON} size="large" shortcut="Mod+K" tooltip={t("write.link.tip")} onClick={() => features.ui.openDialog("link")} />
            <RibbonStack>
              <RibbonButton label={t("write.bookmark.button")} icon={BOOKMARK_ICON} showLabel tooltip={t("write.bookmark.tip")} onClick={() => features.ui.openDialog("bookmark")} />
              <RibbonButton label={t("write.xref.button")} icon={XREF_ICON} showLabel tooltip={t("write.xref.tip")} onClick={() => features.ui.openDialog("crossRef")} />
            </RibbonStack>
          </>
        ),
      },
      {
        label: t("write.headerFooter"),
        items: (
          <>
            <RibbonButton label={t("print.header")} icon="pageSize" size="large" onClick={() => features.ui.openDialog("headerFooter", "header")} />
            <RibbonButton label={t("print.footer")} icon="pageSize" size="large" onClick={() => features.ui.openDialog("headerFooter", "footer")} />
            <RibbonMenuButton
              label={t("write.pageNumber")}
              icon="pageSize"
              size="large"
              menu={[
                { id: "top", label: t("write.topOfPage"), onSelect: () => setPage({ headerText: withPageNumber(page?.headerText) }) },
                { id: "bottom", label: t("write.bottomOfPage"), onSelect: () => setPage({ footerText: withPageNumber(page?.footerText) }) },
                { id: "current", label: t("write.currentPosition"), onSelect: () => addField("page") },
                { separator: true as const },
                { id: "format", label: t("write.formatPageNumbers"), onSelect: () => features.ui.openDialog("pageNumbers") },
              ]}
            />
          </>
        ),
      },
      {
        label: t("write.text"),
        items: (
          <>
            <RibbonMenuButton
              label={t("write.field")}
              icon={FIELD_ICON}
              size="large"
              menu={[
                ...FIELD_CHOICES.map((f) => ({ id: f.id, label: f.label, onSelect: () => addField(f.id) })),
                { id: "fieldDialog", label: t("write.fieldDialog.more"), onSelect: () => features.ui.openDialog("field") },
              ]}
            />
            <RibbonButton label={t("write.dateTime.button")} icon={DATE_ICON} size="large" tooltip={t("write.dateTime.tip")} onClick={() => features.ui.openDialog("dateTime")} />
          </>
        ),
      },
      {
        label: t("write.symbols"),
        items: (
          <RibbonMenuButton
            label={t("write.symbol.button")}
            icon={SYMBOL_ICON}
            size="large"
            menu={(close) => (
              <div className="flex w-56 flex-col gap-1 p-1" data-testid="symbol-gallery">
                <div className="grid grid-cols-5 gap-0.5">
                  {symbolGallery().map((ch) => (
                    <button
                      key={ch}
                      type="button"
                      className="flex h-9 items-center justify-center rounded border border-ui-border text-base hover:bg-ui-hover"
                      title={`U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`}
                      onClick={() => {
                        close();
                        editor.chain().focus().insertContent(ch).run();
                      }}
                    >
                      {ch}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="min-h-8 rounded border-t border-ui-border px-2 text-left text-xs hover:bg-ui-hover"
                  onClick={() => {
                    close();
                    features.ui.set({ dialog: "symbol", symbolTab: "symbols" });
                  }}
                >
                  {t("write.symbol.more")}
                </button>
              </div>
            )}
          />
        ),
      },
      {
        label: t("write.footnotes"),
        items: (
          <>
            <RibbonButton label={t("write.insertFootnote")} icon={FOOTNOTE_ICON} size="large" shortcut="Mod+Alt+F" onClick={() => void insertNote(editor, ctl, "foot")} />
            <RibbonButton label={t("write.insertEndnote")} icon={ENDNOTE_ICON} size="large" shortcut="Mod+Alt+D" onClick={() => void insertNote(editor, ctl, "end")} />
          </>
        ),
      },
      {
        label: t("write.breaks"),
        items: (
          <>
            <RibbonButton label={t("write.pageBreak")} icon="pageBreak" size="large" onClick={() => editor.chain().focus().insertContent({ type: "pageBreak" }).run()} />
            <RibbonButton label={t("write.lineBreak")} icon="lineBreak" size="large" shortcut="Shift+Enter" onClick={() => editor.chain().focus().setHardBreak().run()} />
          </>
        ),
      },
    ],
  };

  const commitTwips = (text: string, unit: "cm" | "pt", apply: (twips: number) => void) => {
    const v = unit === "cm" ? fromCm(text) : fromPt(text);
    if (v == null) return;
    editor.commands.focus();
    apply(Math.max(unit === "pt" ? 0 : -31680, v));
  };

  const layout: RibbonTab = {
    id: "layout",
    label: t("tab.layout"),
    groups: [
      {
        label: t("write.pageSetup"),
        items: (
          <>
            <RibbonMenuButton
              label={t("print.margins")}
              icon="margins"
              size="large"
              menu={[
                ...MARGIN_PRESETS.map((m) => ({
                  id: m.id,
                  label: m.label,
                  checked: margins === m.id,
                  onSelect: () => setSectionPage({ margins: { top: m.top, right: m.right, bottom: m.bottom, left: m.left } }),
                })),
                { separator: true as const },
                { id: "custom", label: t("write.customMargins"), onSelect: () => features.ui.openDialog("pageSetup") },
              ]}
            />
            <RibbonMenuButton
              label={t("print.orientation")}
              icon="orientation"
              size="large"
              menu={(["portrait", "landscape"] as const).map((o) => ({
                id: o,
                label: o === "portrait" ? t("print.portrait") : t("print.landscape"),
                checked: orientation === o,
                onSelect: () => setSectionPage({ orientation: o }),
              }))}
            />
            <RibbonMenuButton
              label={t("write.size")}
              icon="pageSize"
              size="large"
              menu={PAGE_SIZES.map((p) => ({ id: p.id, label: p.label, checked: paper === p.id, onSelect: () => setSectionPage(paperPatch(secPage, p.id)) }))}
            />
            <RibbonMenuButton
              label={t("write.columns.button")}
              icon={COLUMNS_ICON}
              size="large"
              menu={[
                ...COLUMN_PRESETS.map(([id, key]) => ({
                  id,
                  label: t(key),
                  checked: presetOf(s.columns, textWidth(secPage)) === id,
                  onSelect: () => {
                    const cmd = columnsCommand(editor.state, ctl.sections, presetColumns(id, textWidth(secPage)), "section");
                    if (cmd) void ctl.run(cmd);
                  },
                })),
                { separator: true as const },
                { id: "more", label: t("write.columns.more"), onSelect: () => features.ui.openDialog("columns") },
              ]}
            />
            <RibbonMenuButton
              label={t("write.breaks")}
              icon="pageBreak"
              size="large"
              menu={[
                { id: "page", label: t("write.pageBreak"), onSelect: () => editor.chain().focus().insertContent({ type: "pageBreak" }).run() },
                { id: "column", label: t("write.columnBreak"), onSelect: () => editor.chain().focus().insertContent({ type: "columnBreak" }).run() },
                { separator: true as const, label: t("write.sectionBreaks") },
                { id: "nextPage", label: t("write.sectionKind.nextPage"), onSelect: () => sectionBreak("nextPage") },
                { id: "continuous", label: t("write.sectionKind.continuous"), onSelect: () => sectionBreak("continuous") },
                { id: "evenPage", label: t("write.sectionKind.evenPage"), onSelect: () => sectionBreak("evenPage") },
                { id: "oddPage", label: t("write.sectionKind.oddPage"), onSelect: () => sectionBreak("oddPage") },
              ]}
            />
            <RibbonMenuButton
              label={t("write.hyphenation")}
              icon={HYPHEN_ICON}
              size="large"
              menu={[
                { id: "none", label: t("write.hyphenation.none"), checked: !ctl.settings.autoHyphenation, onSelect: () => void ctl.run({ type: "setSettings", settings: { ...ctl.settings, autoHyphenation: false } }) },
                { id: "auto", label: t("write.hyphenation.auto"), checked: !!ctl.settings.autoHyphenation, onSelect: () => void ctl.run({ type: "setSettings", settings: { ...ctl.settings, autoHyphenation: true } }) },
                { separator: true, label: t("write.hyphenation.zone") },
                ...[360, 425, 720].map((z) => ({
                  id: `zone-${z}`,
                  label: t("write.hyphenation.zoneCm", { n: cm(z) }),
                  checked: (ctl.settings.hyphenationZone ?? 360) === z,
                  onSelect: () => void ctl.run({ type: "setSettings", settings: { ...ctl.settings, hyphenationZone: z } }),
                })),
              ]}
            />
          </>
        ),
      },
      {
        label: t("group.paragraph"),
        items: (
          <>
            <RibbonStack>
              <NumberField label={t("write.indentLeft")} value={cm(s.indentLeft ?? 0)} onCommit={(text) => commitTwips(text, "cm", (v) => setIndent(editor, { left: v }))} />
              <NumberField label={t("write.indentRight")} value={cm(s.indentRight ?? 0)} onCommit={(text) => commitTwips(text, "cm", (v) => setIndent(editor, { right: v }))} />
            </RibbonStack>
            <RibbonStack>
              <NumberField label={t("write.spacingBefore")} value={pt(s.before ?? 0)} onCommit={(text) => commitTwips(text, "pt", (v) => setSpacing(editor, { before: v }))} />
              <NumberField label={t("write.spacingAfter")} value={pt(s.after ?? 0)} onCommit={(text) => commitTwips(text, "pt", (v) => setSpacing(editor, { after: v }))} />
            </RibbonStack>
          </>
        ),
      },
      {
        // Word's Layout › Arrange: for the selected picture or shape.
        label: t("write.arrange"),
        items: (
          <>
            {orderMenus(editor)}
            {selectionPaneButton(features)}
            {alignObjectsMenu(editor, (mode, to) => {
              if (selectedImage(editor.state)) alignOne(mode, to, (make) => setSelectedAnchor(editor, make));
              else alignOne(mode, to, (make) => editSelectedDrawing(editor, (d) => {
                const a = make(d.anchor ?? null);
                const out = { ...d };
                if (a) out.anchor = a;
                else delete out.anchor;
                return out;
              }));
            })}
            {groupMenu(editor)}
          </>
        ),
      },
    ],
  };

  const references: RibbonTab = {
    id: "references",
    label: t("write.tab.references"),
    groups: [
      {
        label: t("write.tableOfContents"),
        items: (
          <>
            <RibbonMenuButton
              label={t("write.tableOfContents")}
              icon={TOC_ICON}
              size="large"
              menu={[3, 2, 1].map((levels) => ({
                id: `toc${levels}`,
                label: t("write.tocLevels", { n: levels }),
                onSelect: () => void insertToc(editor, ctl, levels, t("write.tocTitle")),
              }))}
            />
            <RibbonButton label={t("write.updateTable")} icon={UPDATE_ICON} size="large" tooltip={t("write.updateTableTip")} onClick={() => void updateTocs(editor, ctl)} />
          </>
        ),
      },
      {
        label: t("write.captions"),
        items: (
          <>
            <RibbonButton label={t("write.caption.button")} icon={CAPTION_ICON} size="large" tooltip={t("write.caption.tip")} onClick={() => features.ui.openDialog("caption")} />
            <RibbonStack>
              <RibbonMenuButton
                label={t("write.figures.button")}
                icon={FIGURES_ICON}
                showLabel
                menu={CAPTION_LABELS.map((l) => ({
                  id: l,
                  label: t(`write.caption.${l.toLowerCase()}`),
                  onSelect: () => void insertTableOfFigures(editor, ctl, l),
                }))}
              />
              <RibbonButton label={t("write.xref.button")} icon={XREF_ICON} showLabel tooltip={t("write.xref.tip")} onClick={() => features.ui.openDialog("crossRef")} />
            </RibbonStack>
            {/* Two rows per stack: three overflow the 64 px group (W-19). */}
            <RibbonStack>
              <RibbonButton label={t("write.bookmark.button")} icon={BOOKMARK_ICON} showLabel tooltip={t("write.bookmark.tip")} onClick={() => features.ui.openDialog("bookmark")} />
              <RibbonButton label={t("write.updateFields")} icon={UPDATE_ICON} showLabel shortcut="F9" tooltip={t("write.updateFieldsTip")} onClick={() => void features.updateFields()} />
            </RibbonStack>
          </>
        ),
      },
      {
        label: t("write.footnotes"),
        items: (
          <>
            <RibbonButton label={t("write.insertFootnote")} icon={FOOTNOTE_ICON} size="large" shortcut="Mod+Alt+F" onClick={() => void insertNote(editor, ctl, "foot")} />
            <RibbonButton label={t("write.insertEndnote")} icon={ENDNOTE_ICON} size="large" shortcut="Mod+Alt+D" onClick={() => void insertNote(editor, ctl, "end")} />
            <RibbonStack>
              <RibbonButton label={t("write.nextFootnote")} icon={NEXT_ICON(true)} showLabel onClick={() => goToNextRef(editor.view, 1)} />
              <RibbonButton label={t("write.prevFootnote")} icon={NEXT_ICON(false)} showLabel onClick={() => goToNextRef(editor.view, -1)} />
            </RibbonStack>
            <RibbonStack>
              <RibbonMenuButton
                label={t("write.endnotesAt")}
                icon={ENDNOTE_ICON}
                showLabel
                menu={[
                  { id: "doc", label: t("write.endnotesAt.document"), checked: !ctl.settings.endnotesAtSectionEnd, onSelect: () => void ctl.run({ type: "setSettings", settings: { ...ctl.settings, endnotesAtSectionEnd: false } }) },
                  { id: "sect", label: t("write.endnotesAt.section"), checked: !!ctl.settings.endnotesAtSectionEnd, onSelect: () => void ctl.run({ type: "setSettings", settings: { ...ctl.settings, endnotesAtSectionEnd: true } }) },
                ]}
              />
              <RibbonButton label={t("write.noteDialog.open")} icon={FOOTNOTE_ICON} showLabel onClick={() => features.ui.openDialog("notes")} />
            </RibbonStack>
          </>
        ),
      },
    ],
  };

  const cui = ui.comments;
  const activeComment = cui.active != null ? ctl.comments.find((c) => c.id === cui.active) ?? null : null;
  const goTo = (dir: 1 | -1) => {
    const id = goToComment(editor.view, dir);
    if (id != null) features.ui.setComments({ active: id, show: true });
  };
  const review: RibbonTab = {
    id: "review",
    label: t("write.tab.review"),
    groups: [
      {
        label: t("write.markup.group"),
        items: (
          <RibbonStack>
            <select
              aria-label={t("write.markup.label")}
              title={t("write.markup.label")}
              className={`${RIBBON_SELECT} w-36`}
              data-testid="markup-mode"
              value={cui.markup}
              onChange={(e) => features.ui.setComments({ markup: e.target.value as MarkupMode, active: null })}
            >
              {(["simple", "all", "none", "original"] as const).map((m) => (
                <option key={m} value={m}>
                  {t(`write.markup.${m}`)}
                </option>
              ))}
            </select>
          </RibbonStack>
        ),
      },
      {
        label: t("write.comments.title"),
        items: (
          <>
            <RibbonButton
              label={t("write.comments.new")}
              icon={NEW_COMMENT_ICON}
              size="large"
              shortcut="Mod+Alt+M"
              tooltip={t("write.comments.newTip")}
              onClick={() => features.newComment()}
            />
            <RibbonSplitButton
              label={t("write.comments.delete")}
              icon={DELETE_COMMENT_ICON}
              size="large"
              tooltip={t("write.comments.deleteTip")}
              disabled={ctl.comments.length === 0}
              onClick={() => {
                if (activeComment) {
                  features.ui.setComments({ active: null });
                  void deleteComment(ctl, activeComment.id);
                }
              }}
              menu={[
                {
                  id: "delete",
                  label: t("write.comments.delete"),
                  disabled: !activeComment,
                  onSelect: () => {
                    if (!activeComment) return;
                    features.ui.setComments({ active: null });
                    void deleteComment(ctl, activeComment.id);
                  },
                },
                { id: "deleteAll", label: t("write.comments.deleteAll"), onSelect: () => void deleteAllComments(ctl) },
                {
                  id: "deleteResolved",
                  label: t("write.comments.deleteResolved"),
                  disabled: !ctl.comments.some((c) => c.resolved),
                  onSelect: () => void deleteAllComments(ctl, true),
                },
              ]}
            />
            <RibbonStack>
              <RibbonButton label={t("write.comments.previous")} icon={PREV_COMMENT_ICON} showLabel disabled={ctl.comments.length === 0} onClick={() => goTo(-1)} />
              <RibbonButton label={t("write.comments.next")} icon={NEXT_COMMENT_ICON} showLabel disabled={ctl.comments.length === 0} onClick={() => goTo(1)} />
            </RibbonStack>
            <RibbonStack>
              <RibbonButton
                label={activeComment?.resolved ? t("write.comments.reopen") : t("write.comments.resolve")}
                icon={RESOLVE_ICON}
                showLabel
                disabled={!activeComment}
                pressed={!!activeComment?.resolved}
                onClick={() => activeComment && void resolveComment(ctl, activeComment.id, !activeComment.resolved)}
              />
            </RibbonStack>
            <RibbonButton
              label={t("write.comments.show")}
              icon={SHOW_COMMENTS_ICON}
              size="large"
              pressed={cui.show}
              onClick={() => features.ui.setComments({ show: !cui.show })}
            />
            <RibbonButton
              label={t("write.comments.pane")}
              icon={PANE_ICON}
              size="large"
              pressed={cui.pane}
              onClick={() => features.ui.setComments(cui.pane ? { pane: false } : { pane: true, show: true })}
            />
          </>
        ),
      },
    ],
  };

  const view: RibbonTab = {
    id: "view",
    label: t("tab.view"),
    groups: [
      {
        label: t("write.views"),
        items: (
          <>
            <RibbonButton label={t("write.printLayout")} icon="pageSize" size="large" pressed={ui.view === "print"} onClick={() => features.ui.set({ view: "print" })} />
            <RibbonButton label={t("write.draft")} icon="lineSpacing" size="large" pressed={ui.view === "draft"} onClick={() => features.ui.set({ view: "draft" })} />
          </>
        ),
      },
      {
        label: t("group.zoom"),
        items: (
          <RibbonStack>
            <select aria-label={t("group.zoom")} className={`${RIBBON_SELECT} w-20`} value={String(zoom)} onChange={(e) => onZoom(Number(e.target.value))}>
              {/* A pinch or fit-width zoom (P10-M4) between the levels is listed as it is. */}
              {(WRITE_ZOOM_LEVELS.includes(zoom) ? WRITE_ZOOM_LEVELS : [...WRITE_ZOOM_LEVELS, zoom].sort((a, b) => a - b)).map((z) => (
                <option key={z} value={String(z)}>
                  {Math.round(z * 100)} %
                </option>
              ))}
            </select>
            <RibbonButton label="100 %" icon="zoom" showLabel tooltip={t("cmd.zoomTo100")} onClick={() => onZoom(1)} />
          </RibbonStack>
        ),
      },
      {
        label: t("write.show"),
        items: (
          <>
            <RibbonStack>
              <label className="flex min-h-6 items-center gap-1 text-[11px] text-ui-fg">
                <input type="checkbox" checked={ui.ruler} onChange={() => features.ui.set({ ruler: !ui.ruler })} />
                {t("write.ruler")}
              </label>
              <label className="flex min-h-6 items-center gap-1 text-[11px] text-ui-fg">
                <input type="checkbox" checked={ui.navigation} onChange={() => features.ui.set({ navigation: !ui.navigation })} />
                {t("write.navigationPane")}
              </label>
            </RibbonStack>
            <RibbonStack>
              <label className="flex min-h-6 items-center gap-1 text-[11px] text-ui-fg">
                <input type="checkbox" checked={ui.hiddenText} onChange={() => features.ui.set({ hiddenText: !ui.hiddenText })} />
                {t("write.hiddenText")}
              </label>
              <label className="flex min-h-6 items-center gap-1 text-[11px] text-ui-fg">
                <input type="checkbox" checked={ui.gridlines} onChange={() => features.ui.set({ gridlines: !ui.gridlines })} />
                {t("write.w5.gridlines")}
              </label>
            </RibbonStack>
          </>
        ),
      },
      {
        label: t("write.proofing"),
        items: (
          <RibbonButton
            label={t("write.spelling")}
            icon="find"
            size="large"
            pressed={ui.spellcheck}
            tooltip={t("write.spellingTip")}
            onClick={() => features.ui.set({ spellcheck: !ui.spellcheck })}
          />
        ),
      },
      languageRibbonGroup(t),
      {
        label: t("group.help"),
        items: <RibbonButton label={t("shortcuts.title")} icon="keyboard" size="large" shortcut="Mod+/" onClick={() => triggerShortcut("Mod+/")} />,
      },
    ],
  };

  const tableTabList = s.table ? tableTabs({ editor, ctl, features, info: s.table, styles: ctl.styles?.styles ?? [] }) : [];

  const img = s.image;
  const setImageSize = (w: number | null, h: number | null) => {
    const cur = selectedImage(editor.state);
    if (!cur) return;
    const ow = cur.node.attrs.width as number;
    const oh = cur.node.attrs.height as number;
    // Proportional (Word's "Lock aspect ratio" for pictures).
    const width = w ?? Math.round((h! / oh) * ow);
    const height = h ?? Math.round((w! / ow) * oh);
    if (width > 0 && height > 0) setImageAttrs(editor.view, cur.pos, { width, height });
  };
  const EMU_PER_CM = 360000;
  const pictureTab: RibbonTab | null = img
    ? {
        id: "picture",
        label: t("write.pictureFormat"),
        groups: [
          ...pictureFormatGroups(editor, img.format),
          {
            label: t("write.accessibility"),
            items: <RibbonButton label={t("write.altText")} icon="textBox" size="large" tooltip={t("write.altTextDots")} onClick={() => features.ui.openDialog("altText")} />,
          },
          {
            label: t("write.arrange"),
            items: (
              <>
                {pictureArrangeItems(editor, img.anchor, () => features.ui.openDialog("layout"))}
                {groupMenu(editor)}
                {alignObjectsMenu(editor, (mode, to) => alignOne(mode, to, (make) => setSelectedAnchor(editor, make)))}
                {orderMenus(editor)}
                {selectionPaneButton(features)}
                <RibbonStack>
                  <RibbonRow>
                    {alignBtn("left", t("write.picAlignLeft"), <Icon name="alignLeft" />, "Mod+L")}
                    {alignBtn("center", t("write.picAlignCenter"), <Icon name="alignCenter" />, "Mod+E")}
                    {alignBtn("right", t("write.picAlignRight"), <Icon name="alignRight" />, "Mod+R")}
                  </RibbonRow>
                </RibbonStack>
              </>
            ),
          },
          {
            label: t("write.size"),
            items: (
              <>
                {pictureCropButton(editor)}
                <RibbonStack>
                  <NumberField
                    label={t("write.heightCm")}
                    value={String(Math.round((img.height / EMU_PER_CM) * 100) / 100)}
                    onCommit={(text) => {
                      const v = Number(text.replace(",", "."));
                      if (v > 0) setImageSize(null, Math.round(v * EMU_PER_CM));
                    }}
                  />
                  <NumberField
                    label={t("write.widthCm")}
                    value={String(Math.round((img.width / EMU_PER_CM) * 100) / 100)}
                    onCommit={(text) => {
                      const v = Number(text.replace(",", "."));
                      if (v > 0) setImageSize(Math.round(v * EMU_PER_CM), null);
                    }}
                  />
                </RibbonStack>
                <RibbonButton label={t("write.resetSize")} icon="undo" size="large" onClick={() => void resetImageSize(editor.view, ctl, img.pos)} />
                <RibbonButton label={t("write.deletePicture")} icon="trash" size="large" onClick={() => editor.chain().focus().deleteSelection().run()} />
              </>
            ),
          },
        ],
      }
    : null;

  return (
    <Ribbon
      appName="Rusuite Write"
      documentTitle={`${name ?? t("doc.untitled")}${dirty ? " •" : ""}`}
      accent="#2b579a"
      rightSlot={<HelpMenu docStats={() => ({ blocks: editor.state.doc.childCount })} />}
      undo={{ canUndo, canRedo, onUndo: () => ctl.undo(), onRedo: () => ctl.redo() }}
      tabs={[
        home, insert, designTab(ctl, t), layout, references, review, view,
        ...contextualTabs(tableTabList, t("ribbon.ctx.tableTools"), CONTEXT_COLORS.table),
        ...contextualTabs(pictureTab ? [pictureTab] : [], t("ribbon.ctx.pictureTools"), CONTEXT_COLORS.picture),
        ...((d) => contextualTabs(d ? [shapeFormatTab(editor, ctl, d, features)] : [], t("ribbon.ctx.drawingTools"), CONTEXT_COLORS.drawing))(
          s.drawing ?? (activeInner ? (selectedDrawing(editor.state)?.value ?? null) : null),
        ),
      ]}
      backstage={{
        session,
        // File › New shows the template gallery (Ctrl+N: a blank document at once, as in Word).
        onNew: () => features.ui.openDialog("newDocument"),
        onOpen,
        onSave,
        onSaveAs: () => triggerShortcut("F12"),
        saveAsShortcut: "F12",
        onExportPdf,
        print,
        onCloseDocument: () => triggerShortcut("Mod+N"),
        onOptions: () => features.ui.openDialog("writeOptions"),
        infoPage,
      }}
    />
  );
}

/** `text` with a page number field appended (Insert › Page number); unchanged when it has one. */
export function withPageNumber(text: string | null | undefined): string {
  const t = text ?? "";
  if (t.includes("{PAGE}")) return t;
  return t ? `${t}\t{PAGE}` : "{PAGE}";
}
