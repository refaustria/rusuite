// Show's ribbon: File (backstage) / Home / Insert / Design / View, plus a
// contextual Shape Format tab while shapes are selected, with Present in
// the tab strip. Run formatting → `SetRunProps`, shape fill/outline →
// `SetShapeStyle`, arrange/insert → the store's slide commands. Everything
// is inside `[data-keep-edit]`, so using it does not end the overlay text
// editor.

import { useMemo, useRef, type ReactNode } from "react";
import { LAYOUT_LABELS } from "../canvas/menus";
import {
  ColorPicker, FontControls, Icon, ListButtons, RIBBON_SELECT, Ribbon, RibbonButton, RibbonGallery, RibbonIcon, RibbonMenuButton,
  RibbonRow, RibbonSplitButton, RibbonStack, StyleToggles, bytesToBase64, triggerShortcut,
  type AnySession, type CellStylePatch, type CellStyleView, type FormatControlProps, type RibbonGalleryItem, type RibbonMenuItem,
  type RibbonTab,
} from "@rusuite/ui-shared";
import type { RunProperties } from "../../../../packages/ui-shared/src/generated/RunProperties";
import type { Alignment } from "../generated/Alignment";
import type { AlignMode } from "../generated/AlignMode";
import type { LayoutKind } from "../generated/LayoutKind";
import type { Shape } from "../generated/Shape";
import type { ZOp } from "../generated/ZOp";
import { charLen, effectiveParagraph, effectiveRun, findShape, placeholderDef, textOf, themePalette } from "../model";
import { LINE_SPACINGS, lineSpacingOf, newShape, textPos, type InsertKind } from "../state/commands";
import { useShow, type ShowState, type ShowStore } from "../state/store";

/** The shape the formatting controls reflect: the edited one, else the first selected. */
function focusShape(s: ShowState): Shape | null {
  const slide = s.pres?.slides.find((x) => x.id === s.current);
  if (!slide) return null;
  const id = s.editing?.shape ?? s.selection[0];
  return id === undefined ? null : (findShape(slide.shapes, id)?.shape ?? null);
}

/** Formatting state shown by the ribbon. */
export function formattingOf(s: ShowState) {
  const slide = s.pres?.slides.find((x) => x.id === s.current);
  const shape = focusShape(s);
  if (!s.pres || !slide || !shape) return null;
  const def = placeholderDef(s.pres, slide, shape);
  const body = textOf(shape);
  let pi = 0;
  let runProps: RunProperties | undefined = body?.paragraphs[0]?.runs[0]?.props;
  if (s.editing && body) {
    const pos = textPos(s.editing.text, s.editing.start);
    pi = Math.min(pos.paragraph, body.paragraphs.length - 1);
    let at = 0;
    for (const r of body.paragraphs[pi]?.runs ?? []) {
      runProps = r.props;
      at += charLen(r.text);
      if (pos.offset <= at) break;
    }
  }
  const para = effectiveParagraph(def, body?.paragraphs[pi]?.props);
  return { shape, run: effectiveRun(def, runProps), para, hasText: !!body };
}

/** "A" with a small + / − (Increase / Decrease font size). */
const FontStep = ({ sign }: { sign: "+" | "-" }) => (
  <span aria-hidden="true" className="flex items-start text-[13px] font-semibold leading-none">
    A<span className="text-[9px]">{sign === "+" ? "▲" : "▼"}</span>
  </span>
);

// ----- galleries ------------------------------------------------------------------------

const Thumb = ({ children }: { children: ReactNode }) => (
  <svg aria-hidden="true" width="72" height="40" viewBox="0 0 72 40" className="rounded-sm border border-ui-border bg-white text-gray-400">
    {children}
  </svg>
);

export const LAYOUTS: { id: LayoutKind; label: string; preview: ReactNode }[] = [
  {
    id: "title",
    label: "Title slide",
    preview: (
      <Thumb>
        <rect x="12" y="12" width="48" height="7" fill="currentColor" />
        <rect x="20" y="23" width="32" height="4" fill="currentColor" opacity="0.5" />
      </Thumb>
    ),
  },
  {
    id: "titleContent",
    label: "Title and content",
    preview: (
      <Thumb>
        <rect x="6" y="5" width="60" height="6" fill="currentColor" />
        <path d="M8 18h40M8 24h48M8 30h36" stroke="currentColor" strokeWidth="2" />
      </Thumb>
    ),
  },
  { id: "blank", label: "Blank", preview: <Thumb>{null}</Thumb> },
];
const LAYOUT_ITEMS: RibbonGalleryItem[] = LAYOUTS;

export type ShapeChoice = InsertKind | "roundRect";

export const SHAPES: { id: ShapeChoice; label: string; icon: "rect" | "roundRect" | "ellipse" | "line" | "textBox" }[] = [
  { id: "rect", label: "Rectangle", icon: "rect" },
  { id: "roundRect", label: "Rounded rectangle", icon: "roundRect" },
  { id: "ellipse", label: "Oval", icon: "ellipse" },
  { id: "line", label: "Line", icon: "line" },
  { id: "textBox", label: "Text box", icon: "textBox" },
];
const SHAPE_ITEMS: RibbonGalleryItem[] = SHAPES.map((s) => ({ id: s.id, label: s.label, preview: <RibbonIcon name={s.icon} /> }));

const ORDER: { value: ZOp; label: string; shortcut: string }[] = [
  { value: "bringToFront", label: "Bring to front", shortcut: "Mod+Shift+]" },
  { value: "bringForward", label: "Bring forward", shortcut: "Mod+]" },
  { value: "sendBackward", label: "Send backward", shortcut: "Mod+[" },
  { value: "sendToBack", label: "Send to back", shortcut: "Mod+Shift+[" },
];
const ALIGN: { value: AlignMode; label: string }[] = [
  { value: "left", label: "Align left" },
  { value: "centerH", label: "Align center" },
  { value: "right", label: "Align right" },
  { value: "top", label: "Align top" },
  { value: "centerV", label: "Align middle" },
  { value: "bottom", label: "Align bottom" },
];

export const SHOW_ZOOM_LEVELS = [0.5, 0.75, 1, 1.25, 1.5, 2];
/** `"fit"`: the slide fills the canvas area. */
export type ShowZoom = number | "fit";

// ----- the ribbon -------------------------------------------------------------------------

export interface ShowRibbonProps {
  store: ShowStore;
  session: AnySession;
  /** Starts the show; `fromStart` = from the first slide. */
  onPresent: (fromStart: boolean) => void;
  onExportPdf: () => void;
  zoom: ShowZoom;
  onZoom: (zoom: ShowZoom) => void;
}

export function ShowRibbon({ store, session, onPresent, onExportPdf, zoom, onZoom }: ShowRibbonProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const state = useShow(store, (s) => s);
  const fmt = useMemo(() => formattingOf(state), [state]);
  const { canUndo, canRedo, fileIo, name, dirty } = state;
  const selCount = state.selection.length;
  const editing = state.editing !== null;
  const theme = state.pres?.theme;
  const hasSlide = state.current !== null;
  const slideCount = state.pres?.slides.length ?? 0;
  const palette = themePalette(theme);

  const value: CellStyleView = fmt
    ? {
        font: {
          // Theme fonts are shown by their resolved name.
          font: fmt.run.font?.kind === "theme" ? { kind: "named", value: theme?.fonts[fmt.run.font.value] || "Calibri" } : (fmt.run.font ?? undefined),
          size: fmt.run.size ?? undefined,
          bold: fmt.run.bold ?? undefined,
          italic: fmt.run.italic ?? undefined,
          underline: fmt.run.underline ?? undefined,
          strike: fmt.run.strike ?? undefined,
          color: fmt.run.color ?? undefined,
        } as CellStyleView["font"],
        fill: fmt.shape.fill.kind === "solid" ? { kind: "solid", color: fmt.shape.fill.value } : { kind: "none" },
      }
    : {};
  const onChange = (patch: CellStylePatch) => {
    if (patch.font) void store.applyRunPatch(patch.font as RunProperties);
    if (patch.fill) void store.setFill(patch.fill.kind === "solid" ? patch.fill.color : null);
  };
  const f: FormatControlProps = { value, onChange, disabled: !fmt, theme: palette };

  const alignBtn = (a: Alignment, label: string, icon: ReactNode) => (
    <RibbonButton label={label} icon={icon} pressed={fmt?.para.alignment === a} disabled={!fmt?.hasText} onClick={() => void store.setAlignment(a)} />
  );

  const insertShape = async (kind: ShapeChoice) => {
    if (kind !== "roundRect") return store.insert(kind);
    const { pres, current } = store.getState();
    if (!pres || current === null) return;
    if (store.getState().editing) await store.commitEdit();
    const shape = newShape("rect", pres.slideSize, store.temp());
    if (shape.kind.kind === "auto") shape.kind.value.geometry = "roundRect";
    store.select([shape.id]);
    await store.run({ type: "addShape", slide: current, shape });
  };
  const insertImage = async (file: File) => {
    const bytesBase64 = bytesToBase64(new Uint8Array(await file.arrayBuffer()));
    await store.insertPicture(file.type || "image/png", bytesBase64);
  };

  // Shape clipboard (inside this window); text keeps the native Ctrl+X/C/V while editing.
  const copy = () => void store.copy();
  const paste = () => store.paste();
  const clipTip = editing ? "While editing text, use Ctrl+X / Ctrl+C / Ctrl+V" : undefined;

  const addSlide = (layout: string) => void store.addSlide(layout as LayoutKind);
  const newSlide = (size: "large" | "small") => (
    <RibbonSplitButton
      label="New slide"
      icon="newSlide"
      size={size}
      showLabel={size === "small"}
      disabled={!state.pres}
      tooltip="New slide (Title and content)"
      onClick={() => addSlide("titleContent")}
      menuLabel="Slide layouts"
      menu={(close) => (
        <RibbonGallery
          label="Slide layouts"
          items={LAYOUT_ITEMS}
          columns={3}
          itemClassName="h-16 w-24 p-1"
          autoFocus
          onSelect={(id) => {
            close();
            addSlide(id);
          }}
        />
      )}
    />
  );
  const shapesGallery = (
    <RibbonGallery
      label="Shapes"
      items={SHAPE_ITEMS}
      columns={3}
      hideLabels
      itemClassName="h-6 w-7"
      disabled={!hasSlide}
      onSelect={(id) => void insertShape(id as ShapeChoice)}
    />
  );

  const arrange: RibbonMenuItem[] = [
    { separator: true, label: "Order" },
    ...ORDER.map((o) => ({ id: o.value, label: o.label, shortcut: o.shortcut, disabled: selCount === 0, onSelect: () => void store.zOrder(o.value) })),
    { separator: true, label: "Align" },
    ...ALIGN.map((a) => ({ id: a.value, label: a.label, disabled: selCount === 0, onSelect: () => void store.align(a.value) })),
    { id: "distH", label: "Distribute horizontally", disabled: selCount < 3, onSelect: () => void store.distribute("horizontal") },
    { id: "distV", label: "Distribute vertically", disabled: selCount < 3, onSelect: () => void store.distribute("vertical") },
    { separator: true, label: "Group" },
    { id: "group", label: "Group", shortcut: "Mod+G", disabled: selCount < 2, onSelect: () => void store.group() },
    { id: "ungroup", label: "Ungroup", shortcut: "Mod+Shift+G", disabled: selCount === 0, onSelect: () => void store.ungroup() },
  ];

  const currentSlide = state.pres?.slides.find((x) => x.id === state.current) ?? null;
  const layoutMenu: RibbonMenuItem[] = LAYOUT_LABELS.map((l) => ({
    id: l.id,
    label: l.label,
    checked: currentSlide?.layout === l.id,
    onSelect: () => void store.setSlideLayout(l.id),
  }));
  const spacing = lineSpacingOf(fmt?.para.lineSpacing);
  const spacingMenu: RibbonMenuItem[] = LINE_SPACINGS.map((m) => ({
    id: String(m),
    label: m.toFixed(m === 1.15 ? 2 : 1),
    checked: spacing !== null && Math.abs(spacing - m) < 0.001,
    onSelect: () => void store.setLineSpacing(m),
  }));
  const sel = store.selectedShapes();
  const onePicture = sel.length === 1 && sel[0]!.kind.kind === "picture" ? sel[0]! : null;

  const home: RibbonTab = {
    id: "home",
    label: "Home",
    toolbarLabel: "Formatting",
    groups: [
      {
        label: "Undo",
        items: (
          <RibbonStack>
            <RibbonButton label="Undo" icon="undo" shortcut="Mod+Z" disabled={!canUndo} onClick={() => void store.undo()} />
            <RibbonButton label="Redo" icon="redo" shortcut="Mod+Y" disabled={!canRedo} onClick={() => void store.redo()} />
          </RibbonStack>
        ),
      },
      {
        label: "Clipboard",
        items: (
          <>
            <RibbonButton label="Paste" icon="paste" size="large" shortcut="Mod+V" tooltip={clipTip ?? "Paste"} disabled={editing || !hasSlide || state.clipboard === null} onClick={() => void paste()} />
            <RibbonStack>
              <RibbonButton
                label="Cut"
                icon="cut"
                showLabel
                tooltip={clipTip}
                disabled={editing || selCount === 0}
                shortcut="Mod+X"
                onClick={() => void store.cut()}
              />
              <RibbonButton label="Copy" icon="copy" showLabel shortcut="Mod+C" tooltip={clipTip} disabled={editing || selCount === 0} onClick={copy} />
            </RibbonStack>
            <RibbonButton label="Duplicate" icon="duplicate" size="large" shortcut="Mod+D" disabled={editing || selCount === 0} onClick={() => void store.duplicateSelection()} />
          </>
        ),
      },
      {
        label: "Slides",
        items: (
          <>
            {newSlide("large")}
            <RibbonStack>
              <RibbonMenuButton label="Layout" icon="format" showLabel disabled={!hasSlide} menu={layoutMenu} />
              <RibbonButton label="Hide slide" icon="close" showLabel pressed={!!currentSlide?.hidden} disabled={!hasSlide} onClick={() => void store.toggleHidden()} />
            </RibbonStack>
            <RibbonStack>
              <RibbonButton label="Duplicate slide" icon="duplicate" showLabel disabled={!hasSlide} onClick={() => state.current !== null && void store.duplicateSlide(state.current)} />
              <RibbonButton
                label="Delete slide"
                icon="trash"
                showLabel
                disabled={!hasSlide || slideCount <= 1}
                onClick={() => state.current !== null && void store.deleteSlides([state.current])}
              />
            </RibbonStack>
          </>
        ),
      },
      {
        label: "Font",
        items: (
          <RibbonStack>
            <RibbonRow>
              <FontControls {...f} />
              <RibbonButton label="Increase font size" icon={<FontStep sign="+" />} shortcut="Mod+Shift+>" disabled={!fmt?.hasText} onClick={() => void store.stepFont(1, fmt?.run.size ?? 1800)} />
              <RibbonButton label="Decrease font size" icon={<FontStep sign="-" />} shortcut="Mod+Shift+<" disabled={!fmt?.hasText} onClick={() => void store.stepFont(-1, fmt?.run.size ?? 1800)} />
            </RibbonRow>
            <RibbonRow>
              <StyleToggles {...f} />
              <ColorPicker
                label="Text color"
                kind="text"
                value={value.font?.color}
                theme={palette}
                disabled={!fmt}
                onSelect={(c) => onChange({ font: { color: c ?? { kind: "auto" } } })}
              />
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
                bullet={fmt?.para.bullet?.kind === "char"}
                ordered={fmt?.para.bullet?.kind === "autoNum"}
                disabled={!fmt?.hasText}
                onToggle={(kind) => void store.toggleBullet(kind)}
                onIndent={(d) => void store.indent(d)}
              />
            </RibbonRow>
            <RibbonRow>
              {alignBtn("left", "Align text left", <Icon name="alignLeft" />)}
              {alignBtn("center", "Center text", <Icon name="alignCenter" />)}
              {alignBtn("right", "Align text right", <Icon name="alignRight" />)}
              {alignBtn("justify", "Justify text", <RibbonIcon name="alignJustify" />)}
              <RibbonMenuButton label="Line spacing" icon="lineSpacing" disabled={!fmt?.hasText} menu={spacingMenu} />
            </RibbonRow>
          </RibbonStack>
        ),
      },
      {
        label: "Drawing",
        items: (
          <>
            {shapesGallery}
            <RibbonMenuButton label="Arrange" icon="arrange" size="large" disabled={!hasSlide} menu={arrange} />
            <RibbonStack>
              <ColorPicker
                label="Shape fill"
                kind="fill"
                value={fmt && fmt.shape.fill.kind === "solid" ? fmt.shape.fill.value : undefined}
                theme={palette}
                disabled={!fmt}
                onSelect={(c) => void store.setFill(c)}
              />
              <ColorPicker
                label="Shape outline"
                kind="fill"
                value={fmt && fmt.shape.line.fill.kind === "solid" ? fmt.shape.line.fill.value : undefined}
                theme={palette}
                disabled={!fmt}
                onSelect={(c) => void store.setLine(c)}
              />
            </RibbonStack>
          </>
        ),
      },
    ],
  };

  const insert: RibbonTab = {
    id: "insert",
    label: "Insert",
    groups: [
      { label: "Slides", items: newSlide("large") },
      {
        label: "Images",
        items: (
          <>
            <RibbonButton label="Picture" icon="image" size="large" tooltip="Insert a picture" disabled={!hasSlide} onClick={() => fileInput.current?.click()} />
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/gif"
              className="hidden"
              data-testid="image-input"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void insertImage(file).catch((err) => store.pushError(err));
              }}
            />
          </>
        ),
      },
      {
        label: "Illustrations",
        items: (
          <RibbonGallery
            label="Shapes"
            variant="dropdown"
            icon="shapes"
            items={SHAPE_ITEMS}
            columns={5}
            hideLabels
            itemClassName="h-8 w-8"
            disabled={!hasSlide}
            onSelect={(id) => void insertShape(id as ShapeChoice)}
          />
        ),
      },
      {
        label: "Text",
        items: <RibbonButton label="Text box" icon="textBox" size="large" disabled={!hasSlide} onClick={() => void insertShape("textBox")} />,
      },
    ],
  };

  const background = currentSlide?.background?.kind === "solid" ? currentSlide.background.value : undefined;
  const design: RibbonTab = {
    id: "design",
    label: "Design",
    groups: [
      {
        label: "Background",
        items: (
          <>
            <ColorPicker label="Background color" kind="fill" value={background} theme={palette} disabled={!hasSlide} onSelect={(c) => void store.setBackground(c)} />
            <RibbonStack>
              <RibbonButton label="Apply to all" icon="duplicate" showLabel disabled={!hasSlide} onClick={() => void store.setBackground(background ?? null, true)} />
              <RibbonButton label="Reset background" icon="clear" showLabel disabled={!currentSlide?.background} onClick={() => void store.setBackground(null)} />
            </RibbonStack>
          </>
        ),
      },
    ],
  };

  const shapeFormat: RibbonTab = {
    id: "shapeFormat",
    label: "Shape Format",
    groups: [
      {
        label: "Format",
        items: (
          <>
            <RibbonButton label="Format shape…" icon="format" size="large" disabled={selCount === 0} onClick={() => store.openDialog({ kind: "format" })} />
            <RibbonButton
              label="Alt text…"
              icon="textBox"
              size="large"
              disabled={selCount !== 1}
              onClick={() => state.selection[0] !== undefined && store.openDialog({ kind: "alt", shape: state.selection[0] })}
            />
          </>
        ),
      },
      {
        label: "Picture",
        items: onePicture && (
          <RibbonStack>
            <RibbonButton label="Change picture…" icon="image" showLabel onClick={() => store.openDialog({ kind: "replacePicture", shape: onePicture.id })} />
            <RibbonButton label="Reset size" icon="zoom" showLabel onClick={() => void store.resetPictureSize()} />
          </RibbonStack>
        ),
      },
      { label: "Arrange", items: <RibbonMenuButton label="Arrange" icon="arrange" size="large" menu={arrange} /> },
    ],
  };

  const view: RibbonTab = {
    id: "view",
    label: "View",
    groups: [
      {
        label: "Show",
        items: <RibbonButton label="Notes" icon="textBox" size="large" pressed={state.notesVisible} tooltip="Show or hide the speaker notes" onClick={() => store.toggleNotes()} />,
      },
      {
        label: "Slide show",
        items: (
          <>
            <RibbonButton label="From beginning" icon="present" size="large" shortcut="F5" disabled={!hasSlide} onClick={() => onPresent(true)} />
            <RibbonButton label="From current slide" icon="presentCurrent" size="large" shortcut="Shift+F5" disabled={!hasSlide} onClick={() => onPresent(false)} />
          </>
        ),
      },
      {
        label: "Zoom",
        items: (
          <RibbonStack>
            <select aria-label="Zoom" className={`${RIBBON_SELECT} w-24`} value={String(zoom)} onChange={(e) => onZoom(e.target.value === "fit" ? "fit" : Number(e.target.value))}>
              <option value="fit">Fit to window</option>
              {SHOW_ZOOM_LEVELS.map((z) => (
                <option key={z} value={String(z)}>
                  {Math.round(z * 100)} %
                </option>
              ))}
            </select>
            <RibbonButton label="Fit to window" icon="zoom" showLabel pressed={zoom === "fit"} onClick={() => onZoom("fit")} />
          </RibbonStack>
        ),
      },
      {
        label: "Help",
        items: <RibbonButton label="Keyboard shortcuts" icon="keyboard" size="large" shortcut="Mod+/" onClick={() => triggerShortcut("Mod+/")} />,
      },
    ],
  };

  const fileOff = fileIo ? undefined : "File access is not available with this core";
  return (
    <div data-keep-edit>
      <Ribbon
        appName="Rusuite Show"
        documentTitle={`${name ?? "Untitled"}${dirty ? " •" : ""}`}
        accent="#c2410c"
        tabs={selCount > 0 ? [home, insert, design, view, shapeFormat] : [home, insert, design, view]}
        rightSlot={
          <button
            type="button"
            onClick={() => onPresent(false)}
            disabled={!hasSlide}
            title="Present from the current slide (Shift+F5)"
            className="flex h-6 items-center gap-1 rounded bg-orange-700 px-3 text-sm font-medium text-white hover:bg-orange-800 disabled:opacity-40"
          >
            <RibbonIcon name="present" />
            Present
          </button>
        }
        backstage={{
          session,
          onNew: () => triggerShortcut("Mod+N"),
          onOpen: () => void store.open(),
          onSave: () => void store.save(),
          onSaveAs: () => triggerShortcut("Mod+Shift+S"),
          onExportPdf,
          onCloseDocument: () => triggerShortcut("Mod+N"),
          fileDisabledReason: fileOff,
          exportDisabled: !hasSlide,
        }}
      />
    </div>
  );
}
