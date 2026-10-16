// The Styles pane (Alt+Ctrl+Shift+S, Word's): every style with a preview,
// filters Recommended / In use / All, Show Preview, Disable Linked Styles,
// a ▾ menu per style (Update to Match Selection, Modify…, Select All N
// Instances, Rename…, Add to / Remove from the gallery, Delete…), New Style,
// the Style Inspector and Clear All; the Apply Styles box (Ctrl+Shift+S);
// the Navigation pane (View › Navigation: Heading 1–3, click to go); and
// the host that shows the style dialogs the UI store asks for.

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Editor } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import { ContextMenu, PromptDialog, type ContextMenuItem } from "@rusuite/ui-shared";
import type { RunProperties } from "../../../../packages/ui-shared/src/generated/RunProperties";
import type { ParagraphProperties } from "../generated/ParagraphProperties";
import type { Style } from "../generated/Style";
import type { StyleSheet } from "../generated/StyleSheet";
import { propsFromMarks, styleFromMarks } from "../sync/fromPM";
import { findPos, type SyncController } from "../sync/SyncPlugin";
import { TEXTBLOCK_TYPES } from "../sync/schema";
import { fontBoxValue } from "../features/fontBox";
import type { WriteFeatures, WriteUi } from "../features/WriteFeatures";
import { clearFormatting } from "../features/formatting";
import {
  galleryStyles, getStyle, isParagraphKind, overlayRun, paneStyles, paragraphStyleId, previewStyle, resolveCharacter, resolveParagraph, resolveRun,
  styleChain, styleLabel, stylesInUse, findStyleByName,
} from "../features/styleCss";
import {
  applyStyle, blocksWithStyle, createStyleFromSelectionCommand, galleryFlagCommand, goToBlock, modifyStyleCommand, newStyleCommand, newStyleValues,
  selectContiguous, styleFormValues, updateToMatchCommand, type StyleFormValues,
} from "../features/styleCommands";
import { CreateStyleDialog, DeleteStyleDialog, ModifyStyleDialog, describeFormat } from "./styleDialogs";
import { useThrottledEditorState } from "./useThrottledEditorState";
import { BUTTON } from "./dialogs";
import { t as tr, useT } from "../i18n";

const PANE = "flex w-64 shrink-0 flex-col border-ui-border bg-ui-panel text-sm text-ui-fg";
const SMALL_BTN = "h-8 min-w-8 rounded border border-ui-border bg-ui-bg px-2 text-xs text-ui-fg hover:bg-ui-hover";

function useStyles(ctl: SyncController): StyleSheet | null {
  return useSyncExternalStore(ctl.subscribe, () => ctl.styles);
}

/** Style use in the editor document, recomputed on changes (debounced). */
function useInUse(editor: Editor, sheet: StyleSheet | null): Map<string, number> {
  const [map, setMap] = useState(() => stylesInUse(editor.state.doc, sheet));
  useEffect(() => {
    setMap(stylesInUse(editor.state.doc, sheet));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const on = ({ transaction }: { transaction: { docChanged: boolean } }) => {
      if (!transaction.docChanged) return;
      clearTimeout(timer);
      timer = setTimeout(() => setMap(stylesInUse(editor.state.doc, sheet)), 150);
    };
    editor.on("transaction", on);
    return () => {
      clearTimeout(timer);
      editor.off("transaction", on);
    };
  }, [editor, sheet]);
  return map;
}

/** The caret's paragraph and character style. */
function caretStyles(editor: Editor, sheet: StyleSheet | null): { paragraph: string; character: string | null } {
  const { $from } = editor.state.selection;
  let paragraph = "Normal";
  for (let d = $from.depth; d > 0; d--) {
    const n = $from.node(d);
    if (TEXTBLOCK_TYPES.has(n.type.name)) {
      paragraph = paragraphStyleId(sheet, n);
      break;
    }
  }
  const character = styleFromMarks(editor.state.storedMarks ?? $from.marks()) ?? null;
  return { paragraph, character };
}

/** The menu of one style (gallery right-click, the pane's ▾). */
export function styleMenuItems(opts: {
  editor: Editor;
  ctl: SyncController;
  ui: WriteUi;
  style: Style;
  count: number;
  inPane: boolean;
}): ContextMenuItem[] {
  const { editor, ctl, ui, style, count, inPane } = opts;
  const name = styleLabel(style);
  const items: ContextMenuItem[] = [
    {
      id: "update",
      label: tr("write.styles.updateToMatch", { name }),
      onSelect: () => {
        const cmd = updateToMatchCommand(editor, style.id);
        if (cmd) void ctl.run(cmd);
      },
    },
    { id: "modify", label: tr("write.styles.modifyDots"), onSelect: () => ui.set({ styleDialog: { mode: "modify", id: style.id } }) },
    {
      id: "selectAll",
      label: count ? tr("write.styles.selectAll", { count }) : tr("write.styles.selectAllNone"),
      disabled: !count,
      onSelect: () => void selectAllInstances(editor, ctl, ui, style.id),
    },
    { id: "rename", label: tr("write.styles.renameDots"), onSelect: () => ui.set({ styleDialog: { mode: "rename", id: style.id } }) },
    style.quickFormat
      ? { id: "gallery", label: tr("write.styles.removeFromGallery"), onSelect: () => void ctl.run(galleryFlagCommand(style.id, false)) }
      : { id: "gallery", label: tr("write.styles.addToGalleryCmd"), onSelect: () => void ctl.run(galleryFlagCommand(style.id, true)) },
  ];
  if (inPane) {
    items.push({ separator: true }, {
      id: "delete",
      label: tr("write.styles.deleteDots", { name }),
      disabled: !style.custom || !!style.isDefault,
      onSelect: () => ui.set({ styleDialog: { mode: "delete", id: style.id } }),
    });
  }
  return items;
}

/** Select All N Instances: a contiguous run becomes the selection; otherwise the caret goes to the first and the next style applies to all of them. */
export async function selectAllInstances(editor: Editor, ctl: SyncController, ui: WriteUi, id: string): Promise<void> {
  const ids = await blocksWithStyle(ctl, id);
  if (!ids.length) return;
  const visible = ids.filter((b) => findPos(editor.state.doc, b) >= 0);
  if (selectContiguous(editor, visible)) {
    ui.set({ styleInstances: null });
    return;
  }
  goToBlock(editor, visible[0] ?? ids[0]!);
  ui.set({ styleInstances: ids });
}

function kindGlyph(s: Style): string {
  return s.kind === "character" ? "a" : s.kind === "linked" ? "¶a" : "¶";
}

export function StylesPane({ editor, ctl, features }: { editor: Editor; ctl: SyncController; features: WriteFeatures }) {
  const t = useT();
  const ui = features.ui;
  const state = useSyncExternalStore(ui.subscribe, ui.getState);
  const sheet = useStyles(ctl);
  const inUse = useInUse(editor, sheet);
  const caret = useThrottledEditorState({ editor, selector: ({ editor: e }) => caretStyles(e, ctl.styles) });
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; style: Style } | null>(null);
  const list = useMemo(() => paneStyles(sheet, state.styleFilter, inUse), [sheet, state.styleFilter, inUse]);
  if (!state.stylesPane) return null;
  const close = () => ui.set({ stylesPane: false });
  return (
    <aside className={`${PANE} border-l`} role="complementary" aria-label={t("write.styles.pane")} data-testid="styles-pane">
      <div className="flex items-center justify-between border-b border-ui-border px-2 py-1">
        <span className="font-medium">{t("write.styles.pane")}</span>
        <button type="button" className={SMALL_BTN} aria-label={t("common.close")} onClick={close}>
          ×
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-1" role="listbox" aria-label={t("write.styles.list")}>
        {list.map((s) => {
          const current = s.id === caret.paragraph || s.id === caret.character || s.link === caret.character;
          return (
            <div key={s.id} className={`group flex items-center gap-1 rounded px-1 ${current ? "bg-ui-active" : "hover:bg-ui-hover"}`}>
              <button
                type="button"
                role="option"
                aria-selected={current}
                aria-label={styleLabel(s)}
                data-style-id={s.id}
                className="flex min-h-8 min-w-0 flex-1 items-center truncate text-left"
                onClick={() => {
                  void applyStyle(editor, ctl, s.id, { linkedDisabled: state.linkedDisabled, instances: state.styleInstances });
                  if (state.styleInstances) ui.set({ styleInstances: null });
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenu({ at: { x: e.clientX, y: e.clientY }, style: s });
                }}
              >
                <span className="truncate" style={state.stylePreview ? previewStyle(sheet, s, 14) : undefined}>
                  {styleLabel(s)}
                </span>
              </button>
              <span className="w-5 shrink-0 text-center text-xs text-ui-muted" aria-hidden="true">
                {kindGlyph(s)}
              </span>
              <button
                type="button"
                className="h-8 w-6 shrink-0 rounded text-xs text-ui-muted hover:bg-ui-bg"
                aria-label={t("write.styles.styleMenu", { name: styleLabel(s) })}
                aria-haspopup="menu"
                onClick={(e) => {
                  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  setMenu({ at: { x: r.left, y: r.bottom }, style: s });
                }}
              >
                ▾
              </button>
            </div>
          );
        })}
      </div>
      <div className="flex flex-col gap-1 border-t border-ui-border p-2">
        <label className="flex items-center justify-between gap-2 text-xs">
          {t("write.styles.show")}
          <select
            aria-label={t("write.styles.show")}
            className="h-7 rounded border border-ui-border bg-ui-bg px-1 text-xs text-ui-fg"
            value={state.styleFilter}
            onChange={(e) => ui.set({ styleFilter: e.target.value as typeof state.styleFilter })}
          >
            <option value="recommended">{t("write.styles.filter.recommended")}</option>
            <option value="inUse">{t("write.styles.filter.inUse")}</option>
            <option value="all">{t("write.styles.filter.all")}</option>
          </select>
        </label>
        <label className="flex items-center gap-1 text-xs">
          <input type="checkbox" checked={state.stylePreview} onChange={(e) => ui.set({ stylePreview: e.target.checked })} /> {t("write.styles.showPreview")}
        </label>
        <label className="flex items-center gap-1 text-xs">
          <input type="checkbox" checked={state.linkedDisabled} onChange={(e) => ui.set({ linkedDisabled: e.target.checked })} /> {t("write.styles.disableLinked")}
        </label>
        <div className="flex flex-wrap gap-1">
          <button type="button" className={SMALL_BTN} onClick={() => ui.set({ styleDialog: { mode: "new", basedOn: caret.paragraph } })}>
            {t("write.styles.newStyle")}
          </button>
          <button type="button" className={SMALL_BTN} aria-pressed={state.styleInspector} onClick={() => ui.set({ styleInspector: !state.styleInspector })}>
            {t("write.styles.inspector")}
          </button>
          <button type="button" className={SMALL_BTN} onClick={() => void clearFormatting(editor, ctl, true)}>
            {t("write.styles.clearAll")}
          </button>
        </div>
      </div>
      {state.styleInspector && <StyleInspector editor={editor} ctl={ctl} />}
      <ContextMenu
        at={menu?.at ?? null}
        label={t("write.styles.styleMenu", { name: menu ? styleLabel(menu.style) : "" })}
        items={menu ? styleMenuItems({ editor, ctl, ui, style: menu.style, count: inUse.get(menu.style.id) ?? 0, inPane: true }) : []}
        onClose={() => setMenu(null)}
      />
    </aside>
  );
}

/** Direct formatting of the caret paragraph and run, as text. */
function inspectorState(editor: Editor): { para: string; paraDirect: ParagraphProperties; charStyle: string | null; run: RunProperties } {
  const { $from } = editor.state.selection;
  let node: PMNode | null = null;
  for (let d = $from.depth; d > 0; d--) {
    if (TEXTBLOCK_TYPES.has($from.node(d).type.name)) {
      node = $from.node(d);
      break;
    }
  }
  const a = node?.attrs ?? {};
  const extra = (a.extra ?? {}) as ParagraphProperties;
  const paraDirect: ParagraphProperties = {};
  if (a.align) paraDirect.alignment = a.align;
  if (a.indent) paraDirect.indent = a.indent;
  if (a.spacing) paraDirect.spacing = a.spacing;
  if (extra.borders) paraDirect.borders = extra.borders;
  if (extra.shading) paraDirect.shading = extra.shading;
  const marks = editor.state.storedMarks ?? $from.marks();
  return { para: node ? String(node.attrs.style ?? "") : "", paraDirect, charStyle: styleFromMarks(marks) ?? null, run: propsFromMarks(marks) };
}

/** Style Inspector: paragraph style + direct paragraph formatting, character style + direct character formatting, each with Clear. */
export function StyleInspector({ editor, ctl }: { editor: Editor; ctl: SyncController }) {
  const t = useT();
  const sheet = useStyles(ctl);
  const s = useThrottledEditorState({ editor, selector: ({ editor: e }) => inspectorState(e) });
  const box = useThrottledEditorState({ editor, selector: ({ editor: e }) => fontBoxValue(e.state, ctl.styles) });
  const { paragraph } = caretStyles(editor, sheet);
  const pStyle = getStyle(sheet, paragraph);
  const cStyle = getStyle(sheet, s.charStyle);
  const none = t("write.styles.inspectorNone");
  const clearParagraph = () => {
    const { $from } = editor.state.selection;
    const block = $from.parent.attrs.id as number | null;
    if (block != null) void ctl.run({ type: "clearFormatting", block, from: 0, to: 0, paragraph: true, keepStyle: true });
  };
  return (
    <section className="flex flex-col gap-1 border-t border-ui-border p-2 text-xs" aria-label={t("write.styles.inspector")} data-testid="style-inspector">
      <p className="font-medium">{t("write.styles.paragraphFormatting")}</p>
      <p data-testid="inspector-paragraph-style">{pStyle ? styleLabel(pStyle) : paragraph}</p>
      <p className="text-ui-muted" data-testid="inspector-paragraph-direct">
        {describeFormat({}, s.paraDirect, t) || none}
      </p>
      <button type="button" className={SMALL_BTN} onClick={clearParagraph}>
        {t("write.styles.clearParagraphFormatting")}
      </button>
      <p className="mt-1 font-medium">{t("write.styles.textFormatting")}</p>
      <p data-testid="inspector-character-style">{cStyle ? styleLabel(cStyle) : t("write.styleName.defaultParagraphFont")}</p>
      <p className="text-ui-muted" data-testid="inspector-character-direct">
        {describeFormat(s.run, null, t) || none}
      </p>
      <p data-testid="inspector-resolved-font">{t("write.styles.inEffect", { font: box.font.kind === "named" ? box.font.value : "", size: box.size / 100 })}</p>
      <button type="button" className={SMALL_BTN} onClick={() => void clearFormatting(editor, ctl, false)}>
        {t("write.styles.clearCharacterFormatting")}
      </button>
    </section>
  );
}

/** The Apply Styles box (Ctrl+Shift+S): type a style name (autocomplete), Enter applies; an unknown name creates a style from the selection. */
export function ApplyStylesBox({ editor, ctl, features }: { editor: Editor; ctl: SyncController; features: WriteFeatures }) {
  const t = useT();
  const ui = features.ui;
  const open = useSyncExternalStore(ui.subscribe, () => ui.getState().applyStyles);
  const sheet = useStyles(ctl);
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const names = useMemo(() => paneStyles(sheet, "all", new Map()).map(styleLabel), [sheet]);
  useEffect(() => {
    if (!open) return;
    const { paragraph, character } = caretStyles(editor, sheet);
    const s = getStyle(sheet, character) ?? getStyle(sheet, paragraph);
    setText(s ? styleLabel(s) : "");
    setTimeout(() => {
      input.current?.focus();
      input.current?.select();
    }, 0);
  }, [open, editor, sheet]);
  if (!open) return null;
  const close = () => {
    ui.set({ applyStyles: false });
    editor.commands.focus();
  };
  const apply = async () => {
    const s = findStyleByName(sheet, text);
    if (s) await applyStyle(editor, ctl, s.id, { linkedDisabled: ui.getState().linkedDisabled });
    else if (text.trim()) {
      const made = createStyleFromSelectionCommand(editor, sheet, text, caretStyles(editor, sheet).paragraph);
      if (made) await ctl.run(made.command);
    }
    close();
  };
  const current = findStyleByName(sheet, text);
  return (
    <div
      role="dialog"
      aria-label={t("write.styles.applyStyles")}
      className="fixed left-6 top-[100px] z-30 flex w-72 flex-col gap-2 rounded-lg border border-ui-border bg-ui-panel p-3 text-sm text-ui-fg shadow-xl"
      data-testid="apply-styles"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          close();
        }
      }}
    >
      <label className="flex flex-col gap-1">
        {t("write.styles.styleName")}
        <input
          ref={input}
          aria-label={t("write.styles.styleName")}
          className="h-7 rounded border border-ui-border bg-ui-bg px-2 text-ui-fg"
          list="write-style-names"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void apply();
            }
          }}
        />
      </label>
      <datalist id="write-style-names">
        {names.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className={BUTTON} onClick={() => void apply()}>
          {current ? t("write.styles.reapply") : t("write.styles.newStyle")}
        </button>
        <button type="button" className={BUTTON} disabled={!current} onClick={() => current && ui.set({ applyStyles: false, styleDialog: { mode: "modify", id: current.id } })}>
          {t("write.styles.modifyDots")}
        </button>
        <button type="button" className={BUTTON} title="Mod+Alt+Shift+S" onClick={() => ui.set({ applyStyles: false, stylesPane: true })}>
          {t("write.styles.pane")}
        </button>
      </div>
    </div>
  );
}

// ----- navigation pane ----------------------------------------------------------------

export interface HeadingEntry {
  id: number;
  level: number;
  text: string;
}

/** The outline level of a style: N for Heading N or a style based on it. */
export function outlineLevel(sheet: StyleSheet | null, id: string): number | null {
  for (const s of [...styleChain(sheet, id)].reverse()) {
    const m = /^Heading([1-9])$/.exec(s.id) ?? /^heading ([1-9])$/i.exec(s.name);
    if (m) return Number(m[1]);
  }
  const m = /^Heading([1-9])$/.exec(id);
  return m ? Number(m[1]) : null;
}

/** Heading 1–3 paragraphs of the editor document (non-empty), in order. */
export function headingsOf(doc: PMNode, sheet: StyleSheet | null, maxLevel = 3): HeadingEntry[] {
  const out: HeadingEntry[] = [];
  doc.descendants((node) => {
    if (node.type.name === "notes") return false;
    if (!TEXTBLOCK_TYPES.has(node.type.name)) return true;
    const level = outlineLevel(sheet, paragraphStyleId(sheet, node));
    const text = node.textContent.trim();
    if (level && level <= maxLevel && text && node.attrs.id != null) out.push({ id: node.attrs.id as number, level, text });
    return false;
  });
  return out;
}

export function NavigationPane({ editor, ctl, features }: { editor: Editor; ctl: SyncController; features: WriteFeatures }) {
  const t = useT();
  const ui = features.ui;
  const open = useSyncExternalStore(ui.subscribe, () => ui.getState().navigation);
  const sheet = useStyles(ctl);
  const [items, setItems] = useState<HeadingEntry[]>([]);
  useEffect(() => {
    if (!open) return;
    setItems(headingsOf(editor.state.doc, sheet));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const on = ({ transaction }: { transaction: { docChanged: boolean } }) => {
      if (!transaction.docChanged) return;
      clearTimeout(timer);
      timer = setTimeout(() => setItems(headingsOf(editor.state.doc, sheet)), 200);
    };
    editor.on("transaction", on);
    return () => {
      clearTimeout(timer);
      editor.off("transaction", on);
    };
  }, [open, editor, sheet]);
  if (!open) return null;
  return (
    <aside className={`${PANE} border-r`} role="complementary" aria-label={t("write.navigation")} data-testid="navigation-pane">
      <div className="flex items-center justify-between border-b border-ui-border px-2 py-1">
        <span className="font-medium">{t("write.navigation")}</span>
        <button type="button" className={SMALL_BTN} aria-label={t("common.close")} onClick={() => ui.set({ navigation: false })}>
          ×
        </button>
      </div>
      <nav className="min-h-0 flex-1 overflow-auto p-1" aria-label={t("write.navigation.headings")}>
        {items.length === 0 && <p className="p-2 text-xs text-ui-muted">{t("write.navigation.empty")}</p>}
        {items.map((h) => (
          <button
            key={h.id}
            type="button"
            className="block min-h-8 w-full truncate rounded px-1 text-left hover:bg-ui-hover"
            style={{ paddingLeft: `${(h.level - 1) * 12 + 4}px`, fontWeight: h.level === 1 ? 600 : 400 }}
            onClick={() => goToBlock(editor, h.id)}
          >
            {h.text}
          </button>
        ))}
      </nav>
    </aside>
  );
}

// ----- dialogs host ---------------------------------------------------------------------

/** Formatting at the caret: paragraph style + direct (for Create a Style's preview and its Modify…). */
function selectionFormat(editor: Editor, sheet: StyleSheet | null): { style: string; run: RunProperties; paragraph: ParagraphProperties } {
  const { paragraph } = caretStyles(editor, sheet);
  const insp = inspectorState(editor);
  let run = resolveRun(sheet, paragraph);
  if (insp.charStyle) run = overlayRun(run, resolveCharacter(sheet, insp.charStyle));
  run = overlayRun(run, insp.run);
  const p = { ...resolveParagraph(sheet, paragraph), ...insp.paraDirect };
  delete p.style;
  return { style: paragraph, run, paragraph: p };
}

/** Shows the style dialog the UI store asks for and runs its result. */
export function StyleDialogsHost({ editor, ctl, features }: { editor: Editor; ctl: SyncController; features: WriteFeatures }) {
  const t = useT();
  const ui = features.ui;
  const dialog = useSyncExternalStore(ui.subscribe, () => ui.getState().styleDialog);
  const sheet = useStyles(ctl);
  const numbering = useSyncExternalStore(ctl.subscribe, () => ctl.numbering);
  // A Create a Style → Modify… switches to the full dialog with these values.
  const [fromSelection, setFromSelection] = useState<StyleFormValues | null>(null);
  const close = () => {
    ui.set({ styleDialog: null });
    setFromSelection(null);
    editor.commands.focus();
  };
  const sel = useMemo(() => (dialog?.mode === "create" ? selectionFormat(editor, sheet) : null), [dialog, editor, sheet]);
  const modifyInitial = useMemo(() => (dialog?.mode === "modify" ? styleFormValues(sheet, dialog.id) : null), [dialog, sheet]);
  const newInitial = useMemo(
    () => (dialog?.mode === "new" ? newStyleValues(sheet, getStyle(sheet, dialog.basedOn) && isParagraphKind(getStyle(sheet, dialog.basedOn)!.kind) ? dialog.basedOn : "Normal", "paragraph", t("write.styles.newStyleName")) : null),
    [dialog, sheet, t],
  );
  const target = dialog && "id" in dialog ? getStyle(sheet, dialog.id) : undefined;
  const run = (cmd: Parameters<SyncController["run"]>[0] | null) => {
    if (cmd) void ctl.run(cmd);
    close();
  };
  return (
    <>
      <ModifyStyleDialog
        open={dialog?.mode === "modify" && !!modifyInitial}
        title={t("write.styles.modifyTitle")}
        sheet={sheet}
        numbering={numbering}
        initial={modifyInitial}
        kindEditable={false}
        ownId={dialog?.mode === "modify" ? dialog.id : undefined}
        onClose={close}
        onSubmit={(v) => dialog?.mode === "modify" && modifyInitial && run(modifyStyleCommand(sheet, dialog.id, modifyInitial, v))}
      />
      <ModifyStyleDialog
        open={(dialog?.mode === "new" && !!newInitial) || !!fromSelection}
        title={t("write.styles.newTitle")}
        sheet={sheet}
        numbering={numbering}
        initial={fromSelection ?? newInitial}
        kindEditable
        onClose={close}
        onSubmit={(v) => {
          const base = newStyleValues(sheet, v.basedOn || "Normal", v.kind, v.name);
          const made = newStyleCommand(sheet, base, v);
          if (!made) return close();
          if (fromSelection) {
            // Create a Style › Modify…: the selection's paragraph takes the new style.
            const block = editor.state.selection.$from.parent.attrs.id as number | null;
            const cmds = [made.command];
            if (block != null && isParagraphKind(v.kind)) {
              cmds.push({ type: "setStyle", blocks: [block], style: made.id });
              cmds.push({ type: "clearFormatting", block, from: 0, to: [...editor.state.selection.$from.parent.textContent].length, paragraph: true, keepStyle: true });
            }
            run({ type: "compound", commands: cmds });
          } else run(made.command);
        }}
      />
      <CreateStyleDialog
        open={dialog?.mode === "create" && !fromSelection && !!sel}
        preview={sel ?? { run: {}, paragraph: {} }}
        onClose={close}
        onSubmit={(name) => {
          const made = createStyleFromSelectionCommand(editor, sheet, name, sel?.style ?? "Normal");
          run(made?.command ?? null);
        }}
        onModify={(name) => {
          if (!sel) return;
          setFromSelection({ name, kind: "paragraph", basedOn: sel.style, next: "", run: sel.run, paragraph: sel.paragraph, quickFormat: true, autoRedefine: false });
        }}
      />
      <PromptDialog
        open={dialog?.mode === "rename" && !!target}
        title={t("write.styles.renameTitle")}
        label={t("write.styles.name")}
        initial={target ? styleLabel(target) : ""}
        confirmLabel={t("common.ok")}
        onClose={close}
        onSubmit={(name) => dialog?.mode === "rename" && run(name === styleLabel(target!) ? null : { type: "renameStyle", id: dialog.id, name })}
      />
      <DeleteStyleDialog
        open={dialog?.mode === "delete" && !!target}
        name={target ? styleLabel(target) : ""}
        onClose={close}
        onConfirm={() => dialog?.mode === "delete" && run({ type: "deleteStyle", id: dialog.id, replacement: null })}
      />
    </>
  );
}

/** Gallery items of the Home › Styles group (live previews). */
export function useGallery(editor: Editor, ctl: SyncController): { styles: Style[]; inUse: Map<string, number>; sheet: StyleSheet | null } {
  const sheet = useStyles(ctl);
  const inUse = useInUse(editor, sheet);
  const styles = useMemo(() => galleryStyles(sheet, inUse), [sheet, inUse]);
  return { styles, inUse, sheet };
}
