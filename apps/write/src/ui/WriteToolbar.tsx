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
  RibbonRow, RibbonStack, RibbonTableSizePicker, StyleToggles, triggerShortcut,
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
import { TEXTBLOCK_TYPES } from "../sync/schema";
import type { SyncController, SyncState } from "../sync/SyncPlugin";
import { cm, fromCm, fromPt, pt } from "./dialogs";
import { useThrottledEditorState } from "./useThrottledEditorState";

// ----- page setup ---------------------------------------------------------------

/** Paper sizes in twips (portrait). */
export const PAGE_SIZES: { id: string; label: string; width: number; height: number }[] = [
  { id: "A4", label: "A4 (21 × 29.7 cm)", width: 11906, height: 16838 },
  { id: "Letter", label: "Letter (8.5 × 11 in)", width: 12240, height: 15840 },
];

/** Margin presets in twips (Word's Normal / Narrow / Moderate / Wide). */
export const MARGIN_PRESETS: { id: string; label: string; top: number; right: number; bottom: number; left: number }[] = [
  { id: "normal", label: "Normal (2.54 cm)", top: 1440, right: 1440, bottom: 1440, left: 1440 },
  { id: "narrow", label: "Narrow (1.27 cm)", top: 720, right: 720, bottom: 720, left: 720 },
  { id: "moderate", label: "Moderate (2.54 / 1.91 cm)", top: 1440, right: 1080, bottom: 1440, left: 1080 },
  { id: "wide", label: "Wide (2.54 / 5.08 cm)", top: 1440, right: 2880, bottom: 1440, left: 2880 },
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

const STYLE_ITEMS: RibbonGalleryItem[] = PARAGRAPH_STYLES.map((s) => ({
  id: s.id,
  label: s.label,
  preview: <span className={`leading-5 ${STYLE_PREVIEW[s.id] ?? "text-xs"}`}>AaBbCc</span>,
}));

/** Styles shown inline; the rest are in "More styles". */
const INLINE_STYLES = 5;

// ----- small controls ------------------------------------------------------------------

/** Word's text highlight colors. */
export const HIGHLIGHT_COLORS: { label: string; hex: string }[] = [
  { label: "Yellow", hex: "FFFF00" }, { label: "Bright green", hex: "00FF00" }, { label: "Turquoise", hex: "00FFFF" },
  { label: "Pink", hex: "FF00FF" }, { label: "Blue", hex: "0000FF" }, { label: "Red", hex: "FF0000" },
  { label: "Dark blue", hex: "000080" }, { label: "Teal", hex: "008080" }, { label: "Green", hex: "008000" },
  { label: "Violet", hex: "800080" }, { label: "Dark red", hex: "800000" }, { label: "Dark yellow", hex: "808000" },
  { label: "Gray 50%", hex: "808080" }, { label: "Gray 25%", hex: "C0C0C0" }, { label: "Black", hex: "000000" },
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
  zoom: number;
  onZoom: (zoom: number) => void;
}

export const WRITE_ZOOM_LEVELS = [0.5, 0.75, 1, 1.25, 1.5, 2];

/** What the Table / Picture Format tabs need from the selection. */
function selectionInfo(e: Editor): { table: TableContext | null; image: { node: PMNode; pos: number } | null } {
  return { table: tableContext(e.state), image: selectedImage(e.state) };
}

export function WriteRibbon({ editor, ctl, session, page, features, onOpen, onSave, onFind, onReplace, onExportPdf, zoom, onZoom }: WriteRibbonProps) {
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
      ctl.pushError(new Error("Paste needs clipboard access here – use Ctrl+V."));
    }
  };

  const setPage = (patch: PageSetupPatch | null) => {
    if (patch) void ctl.run({ type: "setPage", patch });
  };
  const paper = paperOf(page);
  const margins = marginPresetOf(page);
  const orientation = page?.orientation ?? "portrait";

  const pickStyle = (id: string) => {
    editor.commands.focus();
    setParagraphStyle(editor, id);
  };
  const para = (f: () => unknown) => () => {
    editor.commands.focus();
    f();
  };

  const highlightMenu: RibbonMenuItem[] = [
    { id: "none", label: "No color", icon: swatch(undefined), onSelect: () => textStyle({ highlight: null }) },
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
    { id: "options", label: "Line spacing options…", onSelect: () => features.ui.openDialog("paragraph") },
    { separator: true },
    (s.before ?? 0) > 0
      ? { id: "before", label: "Remove space before paragraph", onSelect: para(() => setSpacing(editor, { before: 0 })) }
      : { id: "before", label: "Add space before paragraph", onSelect: para(() => setSpacing(editor, { before: 240 })) },
    (s.after ?? 1) > 0
      ? { id: "after", label: "Remove space after paragraph", onSelect: para(() => setSpacing(editor, { after: 0 })) }
      : { id: "after", label: "Add space after paragraph", onSelect: para(() => setSpacing(editor, { after: 160 })) },
  ];

  const home: RibbonTab = {
    id: "home",
    label: "Home",
    toolbarLabel: "Formatting",
    groups: [
      {
        label: "Undo",
        items: (
          <RibbonStack>
            <RibbonButton label="Undo" icon="undo" shortcut="Mod+Z" disabled={!canUndo} onClick={() => ctl.undo()} />
            <RibbonButton label="Redo" icon="redo" shortcut="Mod+Y" disabled={!canRedo} onClick={() => ctl.redo()} />
          </RibbonStack>
        ),
      },
      {
        label: "Clipboard",
        items: (
          <>
            <RibbonButton label="Paste" icon="paste" size="large" shortcut="Mod+V" onClick={() => void paste()} />
            <RibbonStack>
              <RibbonButton label="Cut" icon="cut" showLabel shortcut="Mod+X" onClick={() => clipboard("cut")} />
              <RibbonButton label="Copy" icon="copy" showLabel shortcut="Mod+C" onClick={() => clipboard("copy")} />
              <span
                onDoubleClick={() => {
                  features.painter.copy(editor, true);
                }}
              >
                <RibbonButton
                  label="Format painter"
                  icon={PAINTER_ICON}
                  pressed={painter}
                  shortcut="Mod+Shift+C"
                  tooltip="Format painter (double-click: apply several times, Esc stops)"
                  onClick={() => (features.painter.active ? features.painter.cancel(editor) : features.painter.copy(editor))}
                />
              </span>
            </RibbonStack>
          </>
        ),
      },
      {
        label: "Font",
        items: (
          <RibbonStack>
            <RibbonRow>
              <FontControls {...fmt} />
              <RibbonButton label="Clear formatting" icon="clear" tooltip="Clear all formatting" onClick={() => void clearFormatting(editor, ctl, true)} />
            </RibbonRow>
            <RibbonRow>
              <StyleToggles {...fmt} />
              <RibbonButton label="Subscript" icon={SCRIPT_ICON(false)} shortcut="Mod+=" pressed={s.subscript} onClick={() => toggleScript(editor, "subscript")} />
              <RibbonButton label="Superscript" icon={SCRIPT_ICON(true)} shortcut="Mod+Shift+=" pressed={s.superscript} onClick={() => toggleScript(editor, "superscript")} />
              <RibbonMenuButton label="Text highlight color" icon={HIGHLIGHT_ICON} menu={highlightMenu} />
              <ColorPicker label="Font color" kind="text" value={s.props.color ?? undefined} onSelect={(c) => textStyle({ color: c && c.kind !== "auto" ? c : null })} />
            </RibbonRow>
          </RibbonStack>
        ),
      },
      {
        label: "Paragraph",
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
              <RibbonMenuButton label="Line spacing" icon="lineSpacing" menu={lineMenu} />
              <RibbonButton label="Paragraph settings" icon="format" tooltip="Paragraph… (indents and spacing)" onClick={() => features.ui.openDialog("paragraph")} />
            </RibbonRow>
            <RibbonRow>
              {alignBtn("left", "Align left", <Icon name="alignLeft" />, "Mod+L")}
              {alignBtn("center", "Align center", <Icon name="alignCenter" />, "Mod+E")}
              {alignBtn("right", "Align right", <Icon name="alignRight" />, "Mod+R")}
              {alignBtn("justify", "Justify", <RibbonIcon name="alignJustify" />, "Mod+J")}
            </RibbonRow>
          </RibbonStack>
        ),
      },
      {
        label: "Styles",
        items: (
          <>
            <RibbonGallery label="Paragraph styles" items={STYLE_ITEMS.slice(0, INLINE_STYLES)} selected={s.style} onSelect={pickStyle} />
            <RibbonGallery
              label="More styles"
              variant="dropdown"
              size="small"
              icon="chevronDown"
              items={STYLE_ITEMS}
              selected={s.style}
              columns={4}
              itemClassName="h-14 w-20 p-1"
              onSelect={pickStyle}
            />
          </>
        ),
      },
      {
        label: "Editing",
        items: (
          <RibbonStack>
            <RibbonButton label="Find and replace" icon="find" showLabel shortcut="Mod+F" tooltip="Find" onClick={onFind} />
            <RibbonButton label="Replace" icon="format" showLabel shortcut="Mod+H" onClick={onReplace ?? onFind} />
          </RibbonStack>
        ),
      },
    ],
  };

  const insert: RibbonTab = {
    id: "insert",
    label: "Insert",
    groups: [
      {
        label: "Tables",
        items: (
          <RibbonMenuButton
            label="Table"
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
        label: "Illustrations",
        items: (
          <>
            <RibbonButton label="Picture" icon="image" size="large" tooltip="Insert a picture (or paste one with Ctrl+V)" onClick={() => fileInput.current?.click()} />
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
        label: "Header & footer",
        items: (
          <>
            <RibbonButton label="Header" icon="pageSize" size="large" onClick={() => features.ui.openDialog("headerFooter", "header")} />
            <RibbonButton label="Footer" icon="pageSize" size="large" onClick={() => features.ui.openDialog("headerFooter", "footer")} />
            <RibbonMenuButton
              label="Page number"
              icon="pageSize"
              size="large"
              menu={[
                { id: "top", label: "Top of page", onSelect: () => setPage({ headerText: withPageNumber(page?.headerText) }) },
                { id: "bottom", label: "Bottom of page", onSelect: () => setPage({ footerText: withPageNumber(page?.footerText) }) },
              ]}
            />
          </>
        ),
      },
      {
        label: "Breaks",
        items: (
          <>
            <RibbonButton label="Page break" icon="pageBreak" size="large" onClick={() => editor.chain().focus().insertContent({ type: "pageBreak" }).run()} />
            <RibbonButton label="Line break" icon="lineBreak" size="large" shortcut="Shift+Enter" onClick={() => editor.chain().focus().setHardBreak().run()} />
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
    label: "Layout",
    groups: [
      {
        label: "Page setup",
        items: (
          <>
            <RibbonMenuButton
              label="Margins"
              icon="margins"
              size="large"
              menu={[
                ...MARGIN_PRESETS.map((m) => ({
                  id: m.id,
                  label: m.label,
                  checked: margins === m.id,
                  onSelect: () => setPage({ margins: { top: m.top, right: m.right, bottom: m.bottom, left: m.left } }),
                })),
                { separator: true as const },
                { id: "custom", label: "Custom margins…", onSelect: () => features.ui.openDialog("pageSetup") },
              ]}
            />
            <RibbonMenuButton
              label="Orientation"
              icon="orientation"
              size="large"
              menu={(["portrait", "landscape"] as const).map((o) => ({
                id: o,
                label: o === "portrait" ? "Portrait" : "Landscape",
                checked: orientation === o,
                onSelect: () => setPage({ orientation: o }),
              }))}
            />
            <RibbonMenuButton
              label="Size"
              icon="pageSize"
              size="large"
              menu={PAGE_SIZES.map((p) => ({ id: p.id, label: p.label, checked: paper === p.id, onSelect: () => setPage(paperPatch(page, p.id)) }))}
            />
          </>
        ),
      },
      {
        label: "Paragraph",
        items: (
          <>
            <RibbonStack>
              <NumberField label="Indent left (cm)" value={cm(s.indentLeft ?? 0)} onCommit={(t) => commitTwips(t, "cm", (v) => setIndent(editor, { left: v }))} />
              <NumberField label="Indent right (cm)" value={cm(s.indentRight ?? 0)} onCommit={(t) => commitTwips(t, "cm", (v) => setIndent(editor, { right: v }))} />
            </RibbonStack>
            <RibbonStack>
              <NumberField label="Spacing before (pt)" value={pt(s.before ?? 0)} onCommit={(t) => commitTwips(t, "pt", (v) => setSpacing(editor, { before: v }))} />
              <NumberField label="Spacing after (pt)" value={pt(s.after ?? 0)} onCommit={(t) => commitTwips(t, "pt", (v) => setSpacing(editor, { after: v }))} />
            </RibbonStack>
          </>
        ),
      },
    ],
  };

  const view: RibbonTab = {
    id: "view",
    label: "View",
    groups: [
      {
        label: "Views",
        items: (
          <>
            <RibbonButton label="Print layout" icon="pageSize" size="large" pressed={ui.view === "print"} onClick={() => features.ui.set({ view: "print" })} />
            <RibbonButton label="Draft" icon="lineSpacing" size="large" pressed={ui.view === "draft"} onClick={() => features.ui.set({ view: "draft" })} />
          </>
        ),
      },
      {
        label: "Zoom",
        items: (
          <RibbonStack>
            <select aria-label="Zoom" className={`${RIBBON_SELECT} w-20`} value={String(zoom)} onChange={(e) => onZoom(Number(e.target.value))}>
              {WRITE_ZOOM_LEVELS.map((z) => (
                <option key={z} value={String(z)}>
                  {Math.round(z * 100)} %
                </option>
              ))}
            </select>
            <RibbonButton label="100 %" icon="zoom" showLabel tooltip="Zoom to 100 %" onClick={() => onZoom(1)} />
          </RibbonStack>
        ),
      },
      {
        label: "Proofing",
        items: (
          <RibbonButton
            label="Spelling"
            icon="find"
            size="large"
            pressed={ui.spellcheck}
            tooltip="Check spelling as you type (the browser's spell checker)"
            onClick={() => features.ui.set({ spellcheck: !ui.spellcheck })}
          />
        ),
      },
      {
        label: "Help",
        items: <RibbonButton label="Keyboard shortcuts" icon="keyboard" size="large" shortcut="Mod+/" onClick={() => triggerShortcut("Mod+/")} />,
      },
    ],
  };

  const t = s.table;
  const runT = (cmd: Parameters<SyncController["run"]>[0] | null) => () => {
    if (cmd) void ctl.run(cmd);
  };
  // Commands are built from the live selection when clicked (the throttled one may lag).
  const live = () => tableContext(editor.state);
  const firstRow = t?.node.firstChild?.attrs.props as { header?: boolean } | null | undefined;
  const tableTab: RibbonTab | null = t
    ? {
        id: "table",
        label: "Table",
        toolbarLabel: "Table",
        groups: [
          {
            label: "Rows & columns",
            items: (
              <>
                <RibbonButton label="Insert above" icon="insertRows" size="large" onClick={() => runT(live() && insertRow(live()!, false))()} />
                <RibbonButton label="Insert below" icon="insertRows" size="large" onClick={() => runT(live() && insertRow(live()!, true))()} />
                <RibbonButton label="Insert left" icon="insertCols" size="large" onClick={() => runT(live() && insertCol(live()!, false))()} />
                <RibbonButton label="Insert right" icon="insertCols" size="large" onClick={() => runT(live() && insertCol(live()!, true))()} />
                <RibbonMenuButton
                  label="Delete"
                  icon="trash"
                  size="large"
                  menu={[
                    { id: "rows", label: "Delete rows", icon: "deleteRows", onSelect: () => runT(live() && deleteRows(live()!))() },
                    { id: "cols", label: "Delete columns", icon: "deleteCols", onSelect: () => runT(live() && deleteCols(live()!))() },
                    { id: "table", label: "Delete table", icon: "table", onSelect: () => runT(live() && deleteTable(live()!))() },
                  ]}
                />
              </>
            ),
          },
          {
            label: "Style options",
            items: (
              <RibbonButton
                label="Header row"
                icon="insertRows"
                size="large"
                pressed={!!firstRow?.header}
                tooltip="Header row: repeat the first row at the top of each page"
                onClick={() => runT(live() && toggleHeaderRow(live()!))()}
              />
            ),
          },
          {
            label: "Table styles",
            items: (
              <RibbonStack>
                <ColorPicker label="Shading" kind="fill" onSelect={(c) => runT(live() && shadeCells(live()!, c))()} />
                <RibbonMenuButton
                  label="Borders"
                  icon={<Icon name="borders" />}
                  menu={[
                    { id: "all", label: "All borders", icon: <Icon name="borderAll" />, onSelect: () => runT(live() && setBorders(live()!, "all"))() },
                    { id: "outside", label: "Outside borders", icon: <Icon name="borderOutline" />, onSelect: () => runT(live() && setBorders(live()!, "outside"))() },
                    { id: "none", label: "No border", icon: <Icon name="borderNone" />, onSelect: () => runT(live() && setBorders(live()!, "none"))() },
                  ]}
                />
              </RibbonStack>
            ),
          },
          {
            label: "Cell size",
            items: <RibbonButton label="Row height" icon="rowHeight" size="large" tooltip="Row height…" onClick={() => features.ui.openDialog("rowHeight")} />,
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
        label: "Picture Format",
        groups: [
          {
            label: "Accessibility",
            items: <RibbonButton label="Alt text" icon="textBox" size="large" tooltip="Alt text…" onClick={() => features.ui.openDialog("altText")} />,
          },
          {
            label: "Arrange",
            items: (
              <RibbonRow>
                {alignBtn("left", "Picture align left", <Icon name="alignLeft" />, "Mod+L")}
                {alignBtn("center", "Picture align center", <Icon name="alignCenter" />, "Mod+E")}
                {alignBtn("right", "Picture align right", <Icon name="alignRight" />, "Mod+R")}
              </RibbonRow>
            ),
          },
          {
            label: "Size",
            items: (
              <>
                <RibbonStack>
                  <NumberField
                    label="Height (cm)"
                    value={String(Math.round((img.height / EMU_PER_CM) * 100) / 100)}
                    onCommit={(text) => {
                      const v = Number(text.replace(",", "."));
                      if (v > 0) setImageSize(null, Math.round(v * EMU_PER_CM));
                    }}
                  />
                  <NumberField
                    label="Width (cm)"
                    value={String(Math.round((img.width / EMU_PER_CM) * 100) / 100)}
                    onCommit={(text) => {
                      const v = Number(text.replace(",", "."));
                      if (v > 0) setImageSize(Math.round(v * EMU_PER_CM), null);
                    }}
                  />
                </RibbonStack>
                <RibbonButton label="Reset size" icon="undo" size="large" onClick={() => void resetImageSize(editor.view, ctl, img.pos)} />
                <RibbonButton label="Delete picture" icon="trash" size="large" onClick={() => editor.chain().focus().deleteSelection().run()} />
              </>
            ),
          },
        ],
      }
    : null;

  return (
    <Ribbon
      appName="Rusuite Write"
      documentTitle={`${name ?? "Untitled"}${dirty ? " •" : ""}`}
      accent="#2b579a"
      tabs={[home, insert, layout, view, ...(tableTab ? [tableTab] : []), ...(pictureTab ? [pictureTab] : [])]}
      backstage={{
        session,
        onNew: () => triggerShortcut("Mod+N"),
        onOpen,
        onSave,
        onSaveAs: () => triggerShortcut("Mod+Shift+S"),
        onExportPdf,
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
