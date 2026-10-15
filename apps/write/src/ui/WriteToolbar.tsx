// Write's ribbon: File (backstage) / Home / Insert / Layout / View, built
// from the ui-shared ribbon and formatting controls. Run formatting goes
// through the editor's marks, paragraph formatting through node attributes
// (the transaction mapper turns both into Rust commands); insertions and
// page setup are Rust-first commands (`InsertTable`, `InsertImage`,
// `SetPage`).

import { useRef, useSyncExternalStore, type ReactNode } from "react";
import type { Editor } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import {
  ColorControls, FontControls, Icon, ListButtons, RIBBON_SELECT, Ribbon, RibbonButton, RibbonGallery, RibbonIcon, RibbonMenuButton,
  RibbonRow, RibbonStack, RibbonTableSizePicker, StyleToggles, bytesToBase64, triggerShortcut,
  type AnySession, type CellStylePatch, type CellStyleView, type FormatControlProps, type RibbonGalleryItem, type RibbonTab,
} from "@rusuite/ui-shared";
import type { Alignment } from "../generated/Alignment";
import type { PageSetup } from "../generated/PageSetup";
import type { PageSetupPatch } from "../generated/PageSetupPatch";
import type { Spacing } from "../generated/Spacing";
import {
  PARAGRAPH_STYLES, alignmentAt, cursorBlock, indent, runPropsAt, setAlignment, setParagraphStyle, setTextStyle, styleOf,
} from "../sync/editorCommands";
import { EMU_PER_PX, TEXTBLOCK_TYPES, TWIPS_PER_PX } from "../sync/schema";
import type { SyncController, SyncState } from "../sync/SyncPlugin";
import { useThrottledEditorState } from "./useThrottledEditorState";

/** Natural size of an image (falls back to 96×96 px when it cannot be decoded). */
function naturalSize(dataUrl: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    const done = (w: number, h: number) => resolve({ w: w || 96, h: h || 96 });
    const timer = setTimeout(() => done(96, 96), 3000);
    img.onload = () => {
      clearTimeout(timer);
      done(img.naturalWidth, img.naturalHeight);
    };
    img.onerror = () => {
      clearTimeout(timer);
      done(96, 96);
    };
    img.src = dataUrl;
  });
}

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
  Title: "text-lg font-light",
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

// ----- the ribbon ----------------------------------------------------------------------

function useSync<T>(ctl: SyncController, select: (s: SyncState) => T): T {
  return useSyncExternalStore(ctl.subscribe, () => select(ctl.getState()));
}

export interface WriteRibbonProps {
  editor: Editor;
  ctl: SyncController;
  session: AnySession;
  page: PageSetup | null;
  onOpen: () => void;
  onSave: () => void;
  onFind: () => void;
  onExportPdf: () => void;
  zoom: number;
  onZoom: (zoom: number) => void;
}

export const WRITE_ZOOM_LEVELS = [0.5, 0.75, 1, 1.25, 1.5, 2];

export function WriteRibbon({ editor, ctl, session, page, onOpen, onSave, onFind, onExportPdf, zoom, onZoom }: WriteRibbonProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const canUndo = useSync(ctl, (s) => s.canUndo);
  const canRedo = useSync(ctl, (s) => s.canRedo);
  const name = useSync(ctl, (s) => s.name);
  const dirty = useSync(ctl, (s) => s.dirty);
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
      return {
        props: runPropsAt(e),
        style,
        align: alignmentAt(e),
        line: lineSpacingAt(e),
        bullet: e.isActive("bulletList"),
        ordered: e.isActive("orderedList"),
      };
    },
  });
  const value: CellStyleView = {
    font: { ...s.props, font: s.props.font ?? undefined, size: s.props.size ?? undefined } as CellStyleView["font"],
    fill: s.props.highlight ? { kind: "solid", color: s.props.highlight } : undefined,
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
    if (patch.fill) ts.highlight = patch.fill.kind === "solid" ? patch.fill.color : null;
    if (Object.keys(ts).length) {
      editor.commands.focus();
      setTextStyle(editor, ts);
    }
  };
  const fmt: FormatControlProps = { value, onChange };

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

  const insertImage = async (file: File) => {
    const at = cursorBlock(editor);
    if (!at) return;
    const bytesBase64 = bytesToBase64(new Uint8Array(await file.arrayBuffer()));
    const contentType = file.type || "image/png";
    const { w, h } = await naturalSize(`data:${contentType};base64,${bytesBase64}`);
    const pg = ctl.page;
    const maxPx = pg ? (pg.width - pg.margins.left - pg.margins.right) / TWIPS_PER_PX : 600;
    const scale = Math.min(1, maxPx / w);
    await ctl.run({
      type: "insertImage", block: at.id, offset: at.offset, contentType, bytesBase64,
      width: Math.round(w * scale * EMU_PER_PX), height: Math.round(h * scale * EMU_PER_PX), alt: file.name,
    });
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
            </RibbonRow>
            <RibbonRow>
              <StyleToggles {...fmt} />
              <ColorControls {...fmt} fillLabel="Highlight color" />
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
              <RibbonMenuButton
                label="Line spacing"
                icon="lineSpacing"
                menu={LINE_SPACINGS.map((v) => ({
                  id: String(v),
                  label: v.toFixed(v === 1.15 ? 2 : 1),
                  checked: s.line === v,
                  onSelect: () => {
                    editor.commands.focus();
                    setLineSpacing(editor, v);
                  },
                }))}
              />
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
        items: <RibbonButton label="Find and replace" icon="find" size="large" shortcut="Mod+F" onClick={onFind} />,
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
            <RibbonButton label="Picture" icon="image" size="large" tooltip="Insert a picture" onClick={() => fileInput.current?.click()} />
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/gif"
              className="hidden"
              data-testid="image-input"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void insertImage(file);
              }}
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
              menu={MARGIN_PRESETS.map((m) => ({
                id: m.id,
                label: m.label,
                checked: margins === m.id,
                onSelect: () => setPage({ margins: { top: m.top, right: m.right, bottom: m.bottom, left: m.left } }),
              }))}
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
    ],
  };

  const view: RibbonTab = {
    id: "view",
    label: "View",
    groups: [
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
        label: "Help",
        items: <RibbonButton label="Keyboard shortcuts" icon="keyboard" size="large" shortcut="Mod+/" onClick={() => triggerShortcut("Mod+/")} />,
      },
    ],
  };

  return (
    <Ribbon
      appName="Rusuite Write"
      documentTitle={`${name ?? "Untitled"}${dirty ? " •" : ""}`}
      accent="#2b579a"
      tabs={[home, insert, layout, view]}
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
