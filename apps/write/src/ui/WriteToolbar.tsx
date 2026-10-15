// Write's ribbon: File (backstage) / Home / Insert / Layout / View, plus
// the contextual Table and Picture Format tabs while the caret is in a
// table or a picture is selected, built from the ui-shared ribbon and
// formatting controls. Run formatting goes through the editor's marks,
// paragraph formatting and picture size/alt text through node attributes
// (the transaction mapper turns them into Rust commands); insertions, table
// structure, page setup and clear formatting are Rust-first commands
// (`InsertTable`, `InsertImage`, `InsertTableRow`, `SetPage`, …).

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { Editor } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import {
  ColorPicker, FontControls, Icon, ListButtons, RIBBON_SELECT, Ribbon, RibbonButton, RibbonGallery, RibbonIcon, RibbonMenuButton,
  RibbonRow, RibbonStack, RibbonTableSizePicker, StyleToggles, triggerShortcut, languageRibbonGroup, withLabel,
  type AnySession, type CellStylePatch, type CellStyleView, type FormatControlProps, type RibbonGalleryItem, type RibbonMenuItem, type RibbonTab,
} from "@rusuite/ui-shared";
import type { Color } from "../../../../packages/ui-shared/src/generated/Color";
import type { Alignment } from "../generated/Alignment";
import type { PageSetup } from "../generated/PageSetup";
import type { PageSetupPatch } from "../generated/PageSetupPatch";
import type { Spacing } from "../generated/Spacing";
import {
  PARAGRAPH_STYLES, alignmentAt, cursorBlock, indent, runPropsAt, setAlignment, setParagraphStyle, setTextStyle, styleOf,
} from "../sync/editorCommands";
import { clearFormatting, indentAt, setIndent, setSpacing, spacingAt, toggleScript } from "../features/formatting";
import { insertImageFile, resetImageSize, selectedImage, setImageAttrs } from "../features/images";
import {
  deleteCols, deleteRows, deleteTable, insertCol, insertRow, setBorders, shadeCells, tableContext, toggleHeaderRow, type TableContext,
} from "../features/tables";
import type { WriteFeatures } from "../features/WriteFeatures";
import { currentLayout } from "../features/pagination";
import { formatDateTime, goToNextRef } from "../features/structure";
import {
  applyMultilevel, currentSection, insertField, insertNote, insertSectionBreak, insertToc, sectionCommand, updateTocs, type MultilevelPreset,
} from "../features/structureCommands";
import type { FieldKind } from "../generated/FieldKind";
import type { SectionKind } from "../generated/SectionKind";
import { TEXTBLOCK_TYPES } from "../sync/schema";
import type { SyncController, SyncState } from "../sync/SyncPlugin";
import { cm, fromCm, fromPt, pt } from "./dialogs";
import { useThrottledEditorState } from "./useThrottledEditorState";
import { useT } from "../i18n";
import { getLocale } from "@rusuite/ui-shared";

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

const STYLE_PREVIEW: Record<string, string> = {
  Normal: "text-xs",
  Title: "text-sm font-light",
  Heading1: "text-sm font-semibold text-blue-800 dark:text-blue-300",
  Heading2: "text-xs font-semibold text-blue-800 dark:text-blue-300",
  Heading3: "text-xs font-medium text-blue-900 dark:text-blue-200",
  Heading4: "text-xs italic text-blue-800 dark:text-blue-300",
  Heading5: "text-[11px] text-blue-800 dark:text-blue-300",
  Heading6: "text-[11px] italic text-blue-900 dark:text-blue-200",
};

const styleItems = (): RibbonGalleryItem[] => PARAGRAPH_STYLES.map((s) => ({
  id: s.id,
  label: s.label,
  preview: <span className={`leading-5 ${STYLE_PREVIEW[s.id] ?? "text-xs"}`}>AaBbCc</span>, // i18n-ignore: sample text
}));

/** Styles shown inline; the rest are in "More styles". */
const INLINE_STYLES = 5;

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
const MULTILEVEL_ICON = svg(<><path d="M3 4.5h1M7 4.5h10M5 10h1M9 10h8M7 15.5h1M11 15.5h6" /></>);
const FIELD_ICON = svg(<><rect x="3" y="6" width="14" height="8" rx="1.5" /><path d="M6.5 10h7" strokeDasharray="1.5 1.2" /></>);
const NEXT_ICON = (down: boolean) => svg(<><path d="M4 5h7M4 9h7M4 13h4" /><path d={down ? "M15 6v8M12.5 11.5L15 14l2.5-2.5" : "M15 14V6M12.5 8.5L15 6l2.5 2.5"} /></>);

/** Multilevel list presets (Word's gallery). */
export const MULTILEVEL_PRESETS: { id: MultilevelPreset; readonly label: string; sample: string[] }[] = [
  withLabel({ id: "decimal" as MultilevelPreset, sample: ["1.", "1.1", "1.1.1"] }, "write.multilevel.decimal"),
  withLabel({ id: "outline" as MultilevelPreset, sample: ["1.", "a)", "i."] }, "write.multilevel.outline"),
  withLabel({ id: "legal" as MultilevelPreset, sample: ["I.", "1.1", "1.1.1"] }, "write.multilevel.legal"),
];

/** Fields of Insert › Field. */
export const FIELD_CHOICES: { id: FieldKind["kind"]; readonly label: string }[] = [
  withLabel({ id: "page" as const }, "write.field.page"),
  withLabel({ id: "numPages" as const }, "write.field.numPages"),
  withLabel({ id: "date" as const }, "write.field.date"),
  withLabel({ id: "time" as const }, "write.field.time"),
  withLabel({ id: "fileName" as const }, "write.field.fileName"),
  withLabel({ id: "author" as const }, "write.field.author"),
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
  zoom: number;
  onZoom: (zoom: number) => void;
}

export const WRITE_ZOOM_LEVELS = [0.5, 0.75, 1, 1.25, 1.5, 2];

/** What the Table / Picture Format tabs need from the selection. */
function selectionInfo(e: Editor): { table: TableContext | null; image: { node: PMNode; pos: number } | null } {
  return { table: tableContext(e.state), image: selectedImage(e.state) };
}

export function WriteRibbon({ editor, ctl, session, page, features, onOpen, onSave, onFind, onReplace, onExportPdf, print, zoom, onZoom }: WriteRibbonProps) {
  const t = useT();
  const fileInput = useRef<HTMLInputElement>(null);
  const canUndo = useSync(ctl, (s) => s.canUndo);
  const canRedo = useSync(ctl, (s) => s.canRedo);
  const name = useSync(ctl, (s) => s.name);
  const dirty = useSync(ctl, (s) => s.dirty);
  const ui = useSyncExternalStore(features.ui.subscribe, features.ui.getState);
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
      const { table, image } = selectionInfo(e);
      const sec = currentSection(e.state, ctl.sections);
      const sp = spacingAt(e);
      const ind = indentAt(e);
      return {
        props: runPropsAt(e),
        style,
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
        image: image ? { pos: image.pos, width: image.node.attrs.width as number, height: image.node.attrs.height as number, alt: (image.node.attrs.alt as string | null) ?? "" } : null,
      };
    },
  });
  const value: CellStyleView = {
    font: { ...s.props, font: s.props.font ?? undefined, size: s.props.size ?? undefined } as CellStyleView["font"],
  };

  const onChange = (patch: CellStylePatch) => {
    const f = patch.font ?? {};
    const chain = () => editor.chain().focus();
    if (f.bold !== undefined) (f.bold ? chain().setBold() : chain().unsetBold()).run();
    if (f.italic !== undefined) (f.italic ? chain().setItalic() : chain().unsetItalic()).run();
    if (f.strike !== undefined) (f.strike ? chain().setStrike() : chain().unsetStrike()).run();
    if (f.underline !== undefined) {
      if (f.underline === "none") chain().unsetMark("underline").run();
      else chain().setMark("underline", { kind: f.underline }).run();
    }
    const ts: Parameters<typeof setTextStyle>[1] = {};
    if (f.font) ts.font = f.font;
    if (f.size) ts.size = f.size;
    if (f.color) ts.color = f.color.kind === "auto" ? null : f.color;
    if (Object.keys(ts).length) {
      editor.commands.focus();
      setTextStyle(editor, ts);
    }
  };
  const fmt: FormatControlProps = { value, onChange };
  const textStyle = (patch: Parameters<typeof setTextStyle>[1]) => {
    editor.commands.focus();
    setTextStyle(editor, patch);
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

  const insertTable = (rows: number, cols: number) => {
    const at = cursorBlock(editor);
    void ctl.run({ type: "insertTable", after: at?.id ?? null, parent: at?.cell ?? null, rows, cols });
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
      if (text) editor.chain().focus().insertContent(text).run();
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
        const i = editor.state.selection.$from.index(0);
        return { kind, cached: layout?.pages[layout.nodePage[i] ?? 0]?.number ?? "1" };
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
      default:
        return { kind: "author", cached: "" };
    }
  };
  const addField = (kind: FieldKind["kind"]) => {
    const { cached, ...field } = fieldCached(kind);
    void insertField(editor, ctl, field as FieldKind, cached);
  };
  const sectionBreak = (kind: SectionKind) => void insertSectionBreak(editor, ctl, kind);

  const pickStyle = (id: string) => {
    editor.commands.focus();
    setParagraphStyle(editor, id);
  };
  const para = (f: () => unknown) => () => {
    editor.commands.focus();
    f();
  };

  const highlightMenu: RibbonMenuItem[] = [
    { id: "none", label: t("write.noColor"), icon: swatch(undefined), onSelect: () => textStyle({ highlight: null }) },
    ...HIGHLIGHT_COLORS.map((c) => ({
      id: c.hex,
      label: c.label,
      icon: swatch(`#${c.hex}`),
      checked: s.props.highlight?.kind === "rgb" && s.props.highlight.value.toUpperCase() === c.hex,
      onSelect: () => textStyle({ highlight: { kind: "rgb", value: c.hex } as Color }),
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
            <RibbonStack>
              <RibbonButton label={t("cmd.cut")} icon="cut" showLabel shortcut="Mod+X" onClick={() => clipboard("cut")} />
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
              <RibbonMenuButton label={t("write.highlight")} icon={HIGHLIGHT_ICON} menu={highlightMenu} />
              <ColorPicker label={t("write.fontColor")} kind="text" value={s.props.color ?? undefined} onSelect={(c) => textStyle({ color: c && c.kind !== "auto" ? c : null })} />
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
              <RibbonMenuButton
                label={t("write.multilevel")}
                icon={MULTILEVEL_ICON}
                menu={MULTILEVEL_PRESETS.map((p) => ({
                  id: p.id,
                  label: `${p.label}  (${p.sample.join(" / ")})`,
                  onSelect: () => void applyMultilevel(editor, ctl, p.id),
                }))}
              />
              <RibbonMenuButton label={t("write.lineSpacing")} icon="lineSpacing" menu={lineMenu} />
              <RibbonButton label={t("write.paragraphSettings")} icon="format" tooltip={t("write.paragraphSettingsTip")} onClick={() => features.ui.openDialog("paragraph")} />
            </RibbonRow>
            <RibbonRow>
              {alignBtn("left", t("fmt.alignLeft"), <Icon name="alignLeft" />, "Mod+L")}
              {alignBtn("center", t("fmt.alignCenter"), <Icon name="alignCenter" />, "Mod+E")}
              {alignBtn("right", t("fmt.alignRight"), <Icon name="alignRight" />, "Mod+R")}
              {alignBtn("justify", t("write.justify"), <RibbonIcon name="alignJustify" />, "Mod+J")}
            </RibbonRow>
          </RibbonStack>
        ),
      },
      {
        label: t("write.styles"),
        items: (
          <>
            <RibbonGallery label={t("write.paragraphStyles")} items={styleItems().slice(0, INLINE_STYLES)} selected={s.style} onSelect={pickStyle} />
            <RibbonGallery
              label={t("write.moreStyles")}
              variant="dropdown"
              size="small"
              icon="chevronDown"
              items={styleItems()}
              selected={s.style}
              columns={4}
              itemClassName="h-14 w-20 p-1"
              onSelect={pickStyle}
            />
          </>
        ),
      },
      {
        label: t("group.editing"),
        items: (
          <RibbonStack>
            <RibbonButton label={t("cmd.findReplace")} icon="find" showLabel shortcut="Mod+F" tooltip={t("cmd.find")} onClick={onFind} />
            <RibbonButton label={t("cmd.replace")} icon="format" showLabel shortcut="Mod+H" onClick={onReplace ?? onFind} />
          </RibbonStack>
        ),
      },
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
              <RibbonTableSizePicker
                onPick={(r, c) => {
                  close();
                  insertTable(r, c);
                }}
              />
            )}
          />
        ),
      },
      {
        label: t("write.illustrations"),
        items: (
          <>
            <RibbonButton label={t("write.picture")} icon="image" size="large" tooltip={t("write.pictureTip")} onClick={() => fileInput.current?.click()} />
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
          <RibbonMenuButton
            label={t("write.field")}
            icon={FIELD_ICON}
            size="large"
            menu={FIELD_CHOICES.map((f) => ({ id: f.id, label: f.label, onSelect: () => addField(f.id) }))}
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
              label={t("write.breaks")}
              icon="pageBreak"
              size="large"
              menu={[
                { id: "page", label: t("write.pageBreak"), onSelect: () => editor.chain().focus().insertContent({ type: "pageBreak" }).run() },
                { separator: true as const, label: t("write.sectionBreaks") },
                { id: "nextPage", label: t("write.sectionKind.nextPage"), onSelect: () => sectionBreak("nextPage") },
                { id: "continuous", label: t("write.sectionKind.continuous"), onSelect: () => sectionBreak("continuous") },
                { id: "evenPage", label: t("write.sectionKind.evenPage"), onSelect: () => sectionBreak("evenPage") },
                { id: "oddPage", label: t("write.sectionKind.oddPage"), onSelect: () => sectionBreak("oddPage") },
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
        label: t("write.footnotes"),
        items: (
          <>
            <RibbonButton label={t("write.insertFootnote")} icon={FOOTNOTE_ICON} size="large" shortcut="Mod+Alt+F" onClick={() => void insertNote(editor, ctl, "foot")} />
            <RibbonButton label={t("write.insertEndnote")} icon={ENDNOTE_ICON} size="large" shortcut="Mod+Alt+D" onClick={() => void insertNote(editor, ctl, "end")} />
            <RibbonStack>
              <RibbonButton label={t("write.nextFootnote")} icon={NEXT_ICON(true)} showLabel onClick={() => goToNextRef(editor.view, 1)} />
              <RibbonButton label={t("write.prevFootnote")} icon={NEXT_ICON(false)} showLabel onClick={() => goToNextRef(editor.view, -1)} />
            </RibbonStack>
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
              {WRITE_ZOOM_LEVELS.map((z) => (
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

  const tbl = s.table;
  const runT = (cmd: Parameters<SyncController["run"]>[0] | null) => () => {
    if (cmd) void ctl.run(cmd);
  };
  // Commands are built from the live selection when clicked (the throttled one may lag).
  const live = () => tableContext(editor.state);
  const firstRow = tbl?.node.firstChild?.attrs.props as { header?: boolean } | null | undefined;
  const tableTab: RibbonTab | null = tbl
    ? {
        id: "table",
        label: t("write.table"),
        toolbarLabel: t("write.table"),
        groups: [
          {
            label: t("write.rowsCols"),
            items: (
              <>
                <RibbonButton label={t("write.insertAbove")} icon="insertRows" size="large" onClick={() => runT(live() && insertRow(live()!, false))()} />
                <RibbonButton label={t("write.insertBelow")} icon="insertRows" size="large" onClick={() => runT(live() && insertRow(live()!, true))()} />
                <RibbonButton label={t("write.insertLeft")} icon="insertCols" size="large" onClick={() => runT(live() && insertCol(live()!, false))()} />
                <RibbonButton label={t("write.insertRight")} icon="insertCols" size="large" onClick={() => runT(live() && insertCol(live()!, true))()} />
                <RibbonMenuButton
                  label={t("cmd.delete")}
                  icon="trash"
                  size="large"
                  menu={[
                    { id: "rows", label: t("write.deleteRows"), icon: "deleteRows", onSelect: () => runT(live() && deleteRows(live()!))() },
                    { id: "cols", label: t("write.deleteCols"), icon: "deleteCols", onSelect: () => runT(live() && deleteCols(live()!))() },
                    { id: "table", label: t("write.deleteTable"), icon: "table", onSelect: () => runT(live() && deleteTable(live()!))() },
                  ]}
                />
              </>
            ),
          },
          {
            label: t("write.styleOptions"),
            items: (
              <RibbonButton
                label={t("write.headerRow")}
                icon="insertRows"
                size="large"
                pressed={!!firstRow?.header}
                tooltip={t("write.headerRowTip")}
                onClick={() => runT(live() && toggleHeaderRow(live()!))()}
              />
            ),
          },
          {
            label: t("write.tableStyles"),
            items: (
              <RibbonStack>
                <ColorPicker label={t("write.shading")} kind="fill" onSelect={(c) => runT(live() && shadeCells(live()!, c))()} />
                <RibbonMenuButton
                  label={t("fmt.borders")}
                  icon={<Icon name="borders" />}
                  menu={[
                    { id: "all", label: t("fmt.border.all"), icon: <Icon name="borderAll" />, onSelect: () => runT(live() && setBorders(live()!, "all"))() },
                    { id: "outside", label: t("fmt.border.outline"), icon: <Icon name="borderOutline" />, onSelect: () => runT(live() && setBorders(live()!, "outside"))() },
                    { id: "none", label: t("fmt.border.none"), icon: <Icon name="borderNone" />, onSelect: () => runT(live() && setBorders(live()!, "none"))() },
                  ]}
                />
              </RibbonStack>
            ),
          },
          {
            label: t("write.cellSize"),
            items: <RibbonButton label={t("write.rowHeight")} icon="rowHeight" size="large" tooltip={t("write.rowHeightDots")} onClick={() => features.ui.openDialog("rowHeight")} />,
          },
        ],
      }
    : null;

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
          {
            label: t("write.accessibility"),
            items: <RibbonButton label={t("write.altText")} icon="textBox" size="large" tooltip={t("write.altTextDots")} onClick={() => features.ui.openDialog("altText")} />,
          },
          {
            label: t("write.arrange"),
            items: (
              <RibbonRow>
                {alignBtn("left", t("write.picAlignLeft"), <Icon name="alignLeft" />, "Mod+L")}
                {alignBtn("center", t("write.picAlignCenter"), <Icon name="alignCenter" />, "Mod+E")}
                {alignBtn("right", t("write.picAlignRight"), <Icon name="alignRight" />, "Mod+R")}
              </RibbonRow>
            ),
          },
          {
            label: t("write.size"),
            items: (
              <>
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
      tabs={[home, insert, layout, references, view, ...(tableTab ? [tableTab] : []), ...(pictureTab ? [pictureTab] : [])]}
      backstage={{
        session,
        onNew: () => triggerShortcut("Mod+N"),
        onOpen,
        onSave,
        onSaveAs: () => triggerShortcut("Mod+Shift+S"),
        onExportPdf,
        print,
        onCloseDocument: () => triggerShortcut("Mod+N"),
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
