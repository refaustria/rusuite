// Show's ribbon: File (backstage) / Home / Insert / Design / View, plus a
// contextual Shape Format tab while shapes are selected, with Present in
// the tab strip. Run formatting → `SetRunProps`, shape fill/outline →
// `SetShapeStyle`, arrange/insert → the store's slide commands. Everything
// is inside `[data-keep-edit]`, so using it does not end the overlay text
// editor.

import { aiRibbonGroup, HelpMenu } from "@rusuite/ui-shared";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ColorPicker, FontControls, Icon, ListButtons, RIBBON_SELECT, Ribbon, RibbonButton, RibbonGallery, RibbonIcon, RibbonMenuButton,
  RibbonRow, RibbonSplitButton, RibbonStack, StyleToggles, bytesToBase64, formatCombo, triggerShortcut, languageRibbonGroup, withLabel,
  type AnySession, type CellStylePatch, type CellStyleView, type FormatControlProps, type RibbonMenuItem,
  type RibbonTab, contextualTabs, CONTEXT_COLORS,
} from "@rusuite/ui-shared";
import type { RunProperties } from "../../../../packages/ui-shared/src/generated/RunProperties";
import type { Alignment } from "../generated/Alignment";
import type { AlignMode } from "../generated/AlignMode";
import type { LayoutKind } from "../generated/LayoutKind";
import type { Shape } from "../generated/Shape";
import type { ZOp } from "../generated/ZOp";
import { charLen, effectiveParagraph, effectiveRun, findShape, textOf, themePalette } from "../model";
import { LINE_SPACINGS, lineSpacingOf, textPos } from "../state/commands";
import { QUICK_SHAPES, shapeItems } from "./ShapeGallery";
import { shapeFormatGroups, shapesMenu, tableDesignTab, tableLayoutTab, tableMenu } from "./ShapeTabs";
import { DEFAULT_SHOW_SETTINGS, DEFAULT_VIEW, useShow, viewSlide, type ShowState, type ShowStore } from "../state/store";
import { placeholderFor, stableDeck } from "../design/deck";
import { useT } from "../i18n";
import { animationsTab, transitionsTab } from "./AnimTabs";
import { LayoutGallery, designTab } from "./DesignTab";
import { slideMasterTab } from "./MasterView";
import { pictureFormatTab } from "./PictureTab";
import { DI } from "./designIcons";
import { chartDesignTab, chartFormatTab, insertChartButton } from "../charts/ChartRibbon";
import { MediaInsertButtons, playbackTab } from "../media/PlaybackTab";
import { canDetectScreens, choiceLabel, detectScreens, listScreens, loadScreenChoice, saveScreenChoice, type ScreenChoice, type ScreenInfo } from "../present/screens";

/** Slide Show › Monitor: the screens and the remembered choice (P9-S5). */
function useScreenChoice(): { screens: ScreenInfo[]; choice: ScreenChoice; choose: (c: ScreenChoice) => void; detect: () => void } {
  const [screens, setScreens] = useState<ScreenInfo[]>([]);
  const [choice, setChoice] = useState<ScreenChoice>(loadScreenChoice);
  useEffect(() => {
    let alive = true;
    void listScreens().then((l) => alive && setScreens(l));
    return () => {
      alive = false;
    };
  }, []);
  return {
    screens,
    choice,
    choose: (c) => {
      saveScreenChoice(c);
      setChoice(c);
    },
    detect: () => void detectScreens().then(setScreens).catch(() => undefined),
  };
}

/** The shape the formatting controls reflect: the edited one, else the first selected. */
function focusShape(s: ShowState): Shape | null {
  const slide = viewSlide(s);
  if (!slide) return null;
  const id = s.editing?.shape ?? s.selection[0];
  return id === undefined ? null : (findShape(slide.shapes, id)?.shape ?? null);
}

/** Formatting state shown by the ribbon. */
export function formattingOf(s: ShowState) {
  const slide = viewSlide(s);
  const shape = focusShape(s);
  if (!s.pres || !slide || !shape) return null;
  const def = placeholderFor(stableDeck(s.pres), slide.layout, shape, s.masterView?.kind === "master");
  // while editing: the session's body (typed text keeps the formatting of the run before the caret)
  const body = s.editing?.body && !s.editing.cell ? s.editing.body : textOf(shape);
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

/** Insert › Link and Insert › Action icons. */
const LinkIcon = () => (
  <svg aria-hidden="true" width="24" height="24" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
    <path d="M8.5 11.5l3-3M7 9.5l-2 2a2.5 2.5 0 0 0 3.5 3.5l2-2M13 10.5l2-2A2.5 2.5 0 0 0 11.5 5l-2 2" />
  </svg>
);
const ActionIcon = () => (
  <svg aria-hidden="true" width="24" height="24" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round">
    <path d="M6 3l9 7-4 .8 2.2 4.6-1.8.9-2.2-4.6L6 14z" fill="currentColor" fillOpacity="0.15" />
  </svg>
);

// ----- galleries ------------------------------------------------------------------------

const Thumb = ({ children }: { children: ReactNode }) => (
  <svg aria-hidden="true" width="72" height="40" viewBox="0 0 72 40" className="rounded-sm border border-ui-border bg-white text-gray-400">
    {children}
  </svg>
);

export const LAYOUTS: { id: LayoutKind; readonly label: string; preview: ReactNode }[] = [
  withLabel({
    id: "title" as LayoutKind,
    preview: (
      <Thumb>
        <rect x="12" y="12" width="48" height="7" fill="currentColor" />
        <rect x="20" y="23" width="32" height="4" fill="currentColor" opacity="0.5" />
      </Thumb>
    ),
  }, "show.layout.title"),
  withLabel({
    id: "titleContent" as LayoutKind,
    preview: (
      <Thumb>
        <rect x="6" y="5" width="60" height="6" fill="currentColor" />
        <path d="M8 18h40M8 24h48M8 30h36" stroke="currentColor" strokeWidth="2" />
      </Thumb>
    ),
  }, "show.layout.titleContent"),
  withLabel({ id: "blank" as LayoutKind, preview: <Thumb>{null}</Thumb> }, "show.layout.blank"),
];

const ORDER: { value: ZOp; readonly label: string; shortcut: string }[] = [
  withLabel({ value: "bringToFront" as ZOp, shortcut: "Mod+Shift+]" }, "show.order.bringToFront"),
  withLabel({ value: "bringForward" as ZOp, shortcut: "Mod+]" }, "show.order.bringForward"),
  withLabel({ value: "sendBackward" as ZOp, shortcut: "Mod+[" }, "show.order.sendBackward"),
  withLabel({ value: "sendToBack" as ZOp, shortcut: "Mod+Shift+[" }, "show.order.sendToBack"),
];
const ALIGN: { value: AlignMode; readonly label: string }[] = [
  withLabel({ value: "left" as AlignMode }, "fmt.alignLeft"),
  withLabel({ value: "centerH" as AlignMode }, "fmt.alignCenter"),
  withLabel({ value: "right" as AlignMode }, "fmt.alignRight"),
  withLabel({ value: "top" as AlignMode }, "fmt.alignTop"),
  withLabel({ value: "centerV" as AlignMode }, "fmt.alignMiddle"),
  withLabel({ value: "bottom" as AlignMode }, "fmt.alignBottom"),
];

export const SHOW_ZOOM_LEVELS = [0.5, 0.75, 1, 1.25, 1.5, 2];
/** `"fit"`: the slide fills the canvas area. */
export type ShowZoom = number | "fit";

/** A checkbox of the View › Show group (Ruler, Gridlines, Guides). */
function ViewCheck({ label, checked, disabled, shortcut, onChange }: { label: string; checked: boolean; disabled?: boolean; shortcut?: string; onChange: (on: boolean) => void }) {
  return (
    <label className={`flex h-[17px] items-center gap-1.5 px-1 text-xs leading-none ${disabled ? "opacity-40" : ""}`} title={shortcut ? `${label} (${formatCombo(shortcut)})` : label}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.currentTarget.checked)} />
      {label}
    </label>
  );
}

// ----- the ribbon -------------------------------------------------------------------------

/** Home › Section ▾ (PowerPoint's): Add, and for the current slide's section Rename, Remove; Remove All, Collapse / Expand All. */
export function sectionRibbonMenu(store: ShowStore, state: ShowState, t: (k: string) => string): RibbonMenuItem[] {
  const secs = state.pres?.sections ?? [];
  const cur = state.current;
  const index = cur === null ? -1 : secs.findIndex((s) => s.slideIds.includes(cur));
  return [
    { id: "addSection", label: t("show.section.add"), onSelect: () => void store.addSection() },
    { id: "renameSection", label: t("show.section.renameDots"), disabled: index < 0, onSelect: () => store.openDialog({ kind: "renameSection", index }) },
    { id: "removeSection", label: t("show.section.remove"), disabled: index < 0, onSelect: () => void store.removeSection(index, true) },
    { id: "removeAllSections", label: t("show.section.removeAll"), disabled: !secs.length, onSelect: () => void store.removeAllSections() },
    { separator: true },
    { id: "collapseAll", label: t("show.section.collapseAll"), disabled: !secs.length, onSelect: () => store.setAllSections(true) },
    { id: "expandAll", label: t("show.section.expandAll"), disabled: !secs.length, onSelect: () => store.setAllSections(false) },
  ];
}

export interface ShowRibbonProps {
  store: ShowStore;
  session: AnySession;
  /** Starts the show; `fromStart` = from the first slide. */
  onPresent: (fromStart: boolean) => void;
  /** Starts the presenter view (Alt+F5). */
  onPresenterView: () => void;
  onExportPdf: () => void;
  /** File › Print page (settings and preview). */
  print?: ReactNode;
  zoom: ShowZoom;
  onZoom: (zoom: ShowZoom) => void;
  /** Slide Show › Rehearse Timings. */
  onRehearse?: () => void;
}

export function ShowRibbon({ store, session, onPresent, onPresenterView, onExportPdf, print, zoom, onZoom, onRehearse }: ShowRibbonProps) {
  const t = useT();
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
  const masterView = state.masterView !== null;
  const pview = state.view;
  const vp = state.pres?.view ?? DEFAULT_VIEW;
  const monitor = useScreenChoice();

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

  const insertImage = async (file: File) => {
    const bytesBase64 = bytesToBase64(new Uint8Array(await file.arrayBuffer()));
    await store.insertPicture(file.type || "image/png", bytesBase64);
  };

  // Shape clipboard (inside this window); text keeps the native Ctrl+X/C/V while editing.
  const copy = () => void store.copy();
  const paste = () => store.paste();
  const clipTip = editing ? t("show.clipTip", { keys: [formatCombo("Mod+X"), formatCombo("Mod+C"), formatCombo("Mod+V")].join(" / ") }) : undefined;

  const addSlide = (layout: string) => void store.addSlide(layout as LayoutKind);
  const newSlide = (size: "large" | "small") => (
    <RibbonSplitButton
      label={t("show.newSlide")}
      icon="newSlide"
      size={size}
      showLabel={size === "small"}
      disabled={!state.pres}
      tooltip={t("show.newSlideTip")}
      onClick={() => addSlide("titleContent")}
      menuLabel={t("show.slideLayouts")}
      menu={(close) => (
        <div className="flex flex-col gap-1">
          <LayoutGallery store={store} label={t("show.slideLayouts")} close={close} onSelect={(k) => addSlide(k)} />
          <button
            type="button"
            className="rounded px-2 py-1 text-left text-sm hover:bg-ui-hover"
            data-testid="reuse-slides"
            onClick={() => {
              close();
              store.toggleReusePane(true);
            }}
          >
            {t("show.reuse.menu")}
          </button>
        </div>
      )}
    />
  );
  const quickKeyboard = { current: false };
  const textBoxKeyboard = { current: false };
  const shapesGallery = (
    <div className="flex items-start gap-0.5" onClickCapture={(e) => (quickKeyboard.current = e.detail === 0)}>
      <RibbonGallery
        label={t("show.shapes")}
        items={shapeItems(QUICK_SHAPES, t)}
        columns={5}
        hideLabels
        itemClassName="h-6 w-7"
        disabled={!hasSlide}
        selected={undefined}
        onSelect={(id) => (quickKeyboard.current ? void store.insertChoice(id) : store.setDrawMode(id))}
      />
      <RibbonMenuButton label={t("show.moreShapes")} icon="chevronDown" disabled={!hasSlide} menu={shapesMenu(store, state)} />
    </div>
  );
  const arrange: RibbonMenuItem[] = [
    { separator: true, label: t("show.order") },
    ...ORDER.map((o) => ({ id: o.value, label: o.label, shortcut: o.shortcut, disabled: selCount === 0, onSelect: () => void store.zOrder(o.value) })),
    { separator: true, label: t("show.align") },
    ...ALIGN.map((a) => ({ id: a.value, label: a.label, disabled: selCount === 0, onSelect: () => void store.align(a.value) })),
    { id: "distH", label: t("show.distH"), disabled: selCount < 3, onSelect: () => void store.distribute("horizontal") },
    { id: "distV", label: t("show.distV"), disabled: selCount < 3, onSelect: () => void store.distribute("vertical") },
    { id: "alignToSlide", label: t("show.alignToSlide"), checked: state.alignTo === "slide" || selCount < 2, onSelect: () => store.setAlignTo("slide") },
    { id: "alignSelected", label: t("show.alignSelected"), checked: state.alignTo === "selection" && selCount >= 2, disabled: selCount < 2, onSelect: () => store.setAlignTo("selection") },
    { separator: true, label: t("show.group") },
    { id: "group", label: t("show.group"), shortcut: "Mod+G", disabled: selCount < 2, onSelect: () => void store.group() },
    { id: "ungroup", label: t("show.ungroup"), shortcut: "Mod+Shift+G", disabled: !store.selectedShapes().some((sh) => sh.kind.kind === "group"), onSelect: () => void store.ungroup() },
    { id: "regroup", label: t("show.regroup"), disabled: !store.canRegroup(), onSelect: () => void store.regroup() },
    { separator: true, label: t("show.rotate") },
    { id: "rotRight", label: t("show.rotate.right"), disabled: selCount === 0, onSelect: () => void store.rotateOrFlip("right") },
    { id: "rotLeft", label: t("show.rotate.left"), disabled: selCount === 0, onSelect: () => void store.rotateOrFlip("left") },
    { id: "flipV", label: t("show.rotate.flipV"), disabled: selCount === 0, onSelect: () => void store.rotateOrFlip("flipV") },
    { id: "flipH", label: t("show.rotate.flipH"), disabled: selCount === 0, onSelect: () => void store.rotateOrFlip("flipH") },
    { id: "moreRotation", label: t("show.rotate.moreDots"), disabled: selCount === 0, onSelect: () => store.openFormatPane("size") },
    { separator: true },
    { id: "selectionPane", label: t("show.selPane.titleDots"), onSelect: () => store.toggleSelectionPane(true) },
  ];
  const selectMenu: RibbonMenuItem[] = [
    { id: "selectAll", label: t("show.sc.selectAll"), shortcut: "Mod+A", disabled: !hasSlide, onSelect: () => store.shortcut({ kind: "selectAll" }) },
    { id: "selectObjects", label: t("show.selectObjects"), disabled: !hasSlide, onSelect: () => store.setDrawMode(null) },
    { id: "selectionPane", label: t("show.selPane.titleDots"), checked: state.selectionPane, onSelect: () => store.toggleSelectionPane() },
  ];

  const currentSlide = state.pres?.slides.find((x) => x.id === state.current) ?? null;
  const layoutMenu = (close: () => void) => (
    <LayoutGallery store={store} label={t("tab.layout")} selected={currentSlide?.layout} close={close} onSelect={(k) => void store.setSlideLayout(k)} />
  );
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
    label: t("tab.home"),
    toolbarLabel: t("fmt.toolbar"),
    groups: [
      {
        label: t("group.undo"),
        items: (
          <RibbonStack>
            <RibbonButton label={t("group.undo")} icon="undo" shortcut="Mod+Z" disabled={!canUndo} onClick={() => void store.undo()} />
            <RibbonButton label={t("cmd.redo")} icon="redo" shortcut="Mod+Y" disabled={!canRedo} onClick={() => void store.redo()} />
          </RibbonStack>
        ),
      },
      {
        label: t("group.clipboard"),
        items: (
          <>
            <RibbonButton label={t("cmd.paste")} icon="paste" size="large" shortcut="Mod+V" tooltip={clipTip ?? t("cmd.paste")} disabled={editing || !hasSlide || state.clipboard === null} onClick={() => void paste()} />
            <RibbonStack>
              <RibbonButton
                label={t("cmd.cut")}
                icon="cut"
                showLabel
                tooltip={clipTip}
                disabled={editing || selCount === 0}
                shortcut="Mod+X"
                onClick={() => void store.cut()}
              />
              <RibbonRow>
                <RibbonButton label={t("cmd.copy")} icon="copy" showLabel shortcut="Mod+C" tooltip={clipTip} disabled={editing || selCount === 0} onClick={copy} />
                {/* small, so that Home fits a 1400 px window (P8-40) */}
                <RibbonButton label={t("show.duplicate")} icon="duplicate" shortcut="Mod+D" disabled={editing || selCount === 0} onClick={() => void store.duplicateSelection()} />
              </RibbonRow>
            </RibbonStack>
          </>
        ),
      },
      {
        label: t("show.slides"),
        items: (
          <>
            {newSlide("large")}
            <RibbonStack>
              <RibbonMenuButton label={t("tab.layout")} icon="format" showLabel disabled={!hasSlide || masterView} menu={layoutMenu} />
              <RibbonButton label={t("show.resetSlide")} icon={DI.reset} showLabel disabled={!hasSlide || masterView} tooltip={t("show.resetSlideTip")} onClick={() => void store.resetSlide()} />
            </RibbonStack>
            <RibbonStack>
              <RibbonMenuButton label={t("show.section.menu")} icon={DI.section} showLabel disabled={!hasSlide || masterView} menu={sectionRibbonMenu(store, state, t)} />
              <RibbonButton label={t("show.hideSlide")} icon="close" showLabel pressed={!!currentSlide?.hidden} disabled={!hasSlide || masterView} onClick={() => void store.toggleHidden()} />
            </RibbonStack>
            <RibbonStack>
              <RibbonButton label={t("show.duplicateSlide")} icon="duplicate" showLabel disabled={!hasSlide || masterView} onClick={() => state.current !== null && void store.duplicateSlide(state.current)} />
              <RibbonButton
                label={t("show.deleteSlide")}
                icon="trash"
                showLabel
                disabled={!hasSlide || slideCount <= 1 || masterView}
                onClick={() => state.current !== null && void store.deleteSlides([state.current])}
              />
            </RibbonStack>
          </>
        ),
      },
      {
        label: t("group.font"),
        items: (
          <RibbonStack>
            <RibbonRow>
              <FontControls {...f} />
              <RibbonButton label={t("show.fontBigger")} icon={<FontStep sign="+" />} shortcut="Mod+Shift+>" disabled={!fmt?.hasText} onClick={() => void store.stepFont(1, fmt?.run.size ?? 1800)} />
              <RibbonButton label={t("show.fontSmaller")} icon={<FontStep sign="-" />} shortcut="Mod+Shift+<" disabled={!fmt?.hasText} onClick={() => void store.stepFont(-1, fmt?.run.size ?? 1800)} />
            </RibbonRow>
            <RibbonRow>
              <StyleToggles {...f} />
              <ColorPicker
                label={t("fmt.textColor")}
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
        label: t("group.paragraph"),
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
              {alignBtn("left", t("show.alignTextLeft"), <Icon name="alignLeft" />)}
              {alignBtn("center", t("show.centerText"), <Icon name="alignCenter" />)}
              {alignBtn("right", t("show.alignTextRight"), <Icon name="alignRight" />)}
              {alignBtn("justify", t("show.justifyText"), <RibbonIcon name="alignJustify" />)}
              <RibbonMenuButton label={t("show.lineSpacing")} icon="lineSpacing" disabled={!fmt?.hasText} menu={spacingMenu} />
            </RibbonRow>
          </RibbonStack>
        ),
      },
      {
        label: t("show.drawing"),
        collapsePriority: 1,
        items: (
          <>
            {shapesGallery}
            <RibbonMenuButton label={t("show.arrange")} icon="arrange" size="large" disabled={!hasSlide} menu={arrange} />
            <RibbonStack>
              <ColorPicker
                label={t("show.shapeFill")}
                kind="fill"
                value={fmt && fmt.shape.fill.kind === "solid" ? fmt.shape.fill.value : undefined}
                theme={palette}
                disabled={!fmt}
                onSelect={(c) => void store.setFill(c)}
              />
              <ColorPicker
                label={t("show.shapeOutline")}
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
      {
        label: t("group.editing"),
        items: <RibbonMenuButton label={t("show.select")} icon={DI.select} showLabel disabled={!hasSlide} menu={selectMenu} />,
      },
      { ...aiRibbonGroup(session.ai), collapsePriority: 2 },
    ],
  };

  const insert: RibbonTab = {
    id: "insert",
    label: t("tab.insert"),
    groups: [
      { label: t("show.slides"), items: newSlide("large") },
      {
        label: t("show.tables"),
        items: <RibbonMenuButton label={t("show.table")} icon="table" size="large" disabled={!hasSlide} menu={tableMenu(store, t)} />,
      },
      {
        label: t("show.images"),
        items: (
          <>
            <RibbonButton label={t("show.picture")} icon="image" size="large" tooltip={t("show.insertPicture")} disabled={!hasSlide} onClick={() => fileInput.current?.click()} />
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
        label: t("show.illustrations"),
        items: (
          // A menu button around an inline gallery in a `w-max` box: the popup is anchored to the narrow trigger, so
          // the gallery's auto-sized columns would otherwise shrink and its buttons overlap.
          <>
            <RibbonMenuButton label={t("show.shapes")} icon="shapes" size="large" disabled={!hasSlide} menu={shapesMenu(store, state)} />
            {insertChartButton(store, t, !hasSlide || masterView)}
          </>
        ),
      },
      {
        label: t("show.links"),
        items: (
          <>
            <RibbonButton label={t("show.link.insert")} icon={<LinkIcon />} size="large" shortcut="Mod+K" disabled={!hasSlide || (selCount === 0 && !editing)} onClick={() => store.openDialog({ kind: "link" })} />
            <RibbonButton label={t("show.action.insert")} icon={<ActionIcon />} size="large" disabled={selCount === 0} onClick={() => store.openDialog({ kind: "action" })} />
          </>
        ),
      },
      {
        label: t("show.media.group"),
        items: <MediaInsertButtons store={store} t={t} disabled={!hasSlide || masterView} />,
      },
      {
        label: t("show.text"),
        items: (
          <>
            {/* a click arms drawing (click = default size, drag = the box, like Shapes); Enter / Space insert at once (P8-45 S-14) */}
            <span className="contents" onClickCapture={(e) => (textBoxKeyboard.current = e.detail === 0)}>
              <RibbonButton
                label={t("show.shape.textBox")}
                icon="textBox"
                size="large"
                disabled={!hasSlide}
                pressed={state.drawMode === "textBox"}
                tooltip={t("show.shape.textBoxTip")}
                onClick={() => (textBoxKeyboard.current ? void store.insertChoice("textBox") : store.setDrawMode(state.drawMode === "textBox" ? null : "textBox"))}
              />
            </span>
            <RibbonButton label={t("show.hf.titleDots")} icon={DI.headerFooter} size="large" showLabel disabled={!hasSlide} onClick={() => store.openDialog({ kind: "headerFooter" })} />
            <RibbonStack>
              <RibbonButton label={t("show.hf.insertDate")} icon={DI.dateTime} showLabel disabled={!hasSlide} tooltip={t("show.hf.insertFieldTip")} onClick={() => void store.insertField({ kind: "dateTime", value: { format: 1 } })} />
              <RibbonButton label={t("show.hf.insertNumber")} icon={DI.slideNumber} showLabel disabled={!hasSlide} tooltip={t("show.hf.insertFieldTip")} onClick={() => void store.insertField({ kind: "slideNumber" })} />
            </RibbonStack>
          </>
        ),
      },
    ],
  };

  const design = designTab(store, state, t);

  const shapeFormat: RibbonTab = {
    id: "shapeFormat",
    label: t("show.shapeFormat"),
    groups: [
      {
        label: t("sc.format"),
        items: (
          <>
            <RibbonButton label={t("show.formatShapeDots")} icon="format" size="large" disabled={selCount === 0} onClick={() => store.openDialog({ kind: "format" })} />
            <RibbonButton
              label={t("show.altTextDots")}
              icon="textBox"
              size="large"
              disabled={selCount !== 1}
              onClick={() => state.selection[0] !== undefined && store.openDialog({ kind: "alt", shape: state.selection[0] })}
            />
          </>
        ),
      },
      {
        label: t("show.picture"),
        items: onePicture && (
          <RibbonStack>
            <RibbonButton label={t("show.changePictureDots")} icon="image" showLabel onClick={() => store.openDialog({ kind: "replacePicture", shape: onePicture.id })} />
            <RibbonButton label={t("show.resetSize")} icon="zoom" showLabel onClick={() => void store.resetPictureSize()} />
          </RibbonStack>
        ),
      },
      ...shapeFormatGroups(store, state, palette, t, arrange),
    ],
  };
  const tableDesign = tableDesignTab(store, palette, t);
  const tableLayout = tableLayoutTab(store, t);
  const pictures = sel.filter((x) => x.kind.kind === "picture");
  const chartDesign = chartDesignTab(store, state, t);
  const chartFormat = chartFormatTab(store, state, t);
  const playback = sel.length > 0 && sel.every((x) => x.kind.kind === "media") ? playbackTab(store, state, t) : null;
  // contextual tabs with Office's context groups (P8-28)
  const drawingTools = (tabs: RibbonTab[]) => contextualTabs(tabs, t("ribbon.ctx.drawingTools"), CONTEXT_COLORS.drawing);
  const contextual = masterView || state.view !== "normal"
    ? []
    : tableDesign && tableLayout
      ? contextualTabs([tableDesign, tableLayout], t("ribbon.ctx.tableTools"), CONTEXT_COLORS.table)
      : chartDesign && chartFormat
        ? contextualTabs([chartDesign, chartFormat], t("ribbon.ctx.chartTools"), CONTEXT_COLORS.chart)
        : playback
          ? [...contextualTabs([playback], t("ribbon.ctx.mediaTools"), CONTEXT_COLORS.media), ...drawingTools([shapeFormat])]
          : pictures.length > 0 && pictures.length === sel.length
            ? contextualTabs([pictureFormatTab(store, state, t, pictures)], t("ribbon.ctx.pictureTools"), CONTEXT_COLORS.picture)
            : selCount > 0 ? drawingTools([shapeFormat]) : [];

  const view: RibbonTab = {
    id: "view",
    label: t("tab.view"),
    groups: [
      {
        label: t("show.master.views"),
        items: (
          <>
            <RibbonButton label={t("show.master.normal")} icon={DI.normalView} size="large" showLabel pressed={!masterView && pview === "normal"} onClick={() => store.setView("normal")} />
            <RibbonButton label={t("show.view.outline")} icon={DI.outlineView} size="large" showLabel pressed={!masterView && pview === "outline"} disabled={!state.pres} onClick={() => store.setView("outline")} />
            <RibbonButton label={t("show.view.sorter")} icon={DI.sorterView} size="large" showLabel pressed={!masterView && pview === "sorter"} disabled={!state.pres} onClick={() => store.setView("sorter")} />
            <RibbonButton label={t("show.view.notesPage")} icon={DI.notesPageView} size="large" showLabel pressed={!masterView && pview === "notesPage"} disabled={!hasSlide} onClick={() => store.setView("notesPage")} />
            <RibbonButton label={t("show.view.reading")} icon={DI.readingView} size="large" showLabel pressed={!masterView && pview === "reading"} disabled={!hasSlide} onClick={() => store.setView("reading")} />
          </>
        ),
      },
      {
        label: t("show.view.masterViews"),
        items: <RibbonButton label={t("show.master.tab")} icon={DI.master} size="large" showLabel pressed={masterView} disabled={!state.pres} onClick={() => (masterView ? store.closeMasterView() : store.openMasterView())} />,
      },
      {
        label: t("group.show"),
        items: (
          <>
            <div className="flex flex-col justify-center">
              <ViewCheck label={t("show.view.ruler")} checked={vp.showRuler} disabled={!state.pres} onChange={(on) => void store.toggleRuler(on)} />
              <ViewCheck label={t("show.view.gridlines")} checked={vp.showGrid} disabled={!state.pres} shortcut="Shift+F9" onChange={(on) => void store.toggleGrid(on)} />
              <ViewCheck label={t("show.view.guides")} checked={vp.showGuides} disabled={!state.pres} shortcut="Alt+F9" onChange={(on) => void store.toggleGuides(on)} />
            </div>
            <RibbonStack>
              <RibbonButton label={t("show.notes")} icon="textBox" showLabel pressed={state.notesVisible} tooltip={t("show.notesTip")} onClick={() => store.toggleNotes()} />
              <RibbonButton label={t("show.view.gridGuidesDots")} icon={DI.guides} showLabel disabled={!state.pres} onClick={() => store.openDialog({ kind: "gridGuides" })} />
            </RibbonStack>
          </>
        ),
      },
      {
        label: t("show.slideShow"),
        items: (
          <>
            <RibbonButton label={t("show.fromBeginning")} icon="present" size="large" shortcut="F5" disabled={!hasSlide} onClick={() => onPresent(true)} />
            <RibbonButton label={t("show.fromCurrent")} icon="presentCurrent" size="large" shortcut="Shift+F5" disabled={!hasSlide} onClick={() => onPresent(false)} />
            <RibbonButton
              label={t("show.presenterView")}
              icon="presentCurrent"
              size="large"
              shortcut="Alt+F5"
              tooltip={t("show.presenterTip")}
              disabled={!hasSlide}
              onClick={onPresenterView}
            />
          </>
        ),
      },
      {
        label: t("group.zoom"),
        items: (
          <RibbonStack>
            <select aria-label={t("group.zoom")} className={`${RIBBON_SELECT} w-24`} value={String(zoom)} onChange={(e) => onZoom(e.target.value === "fit" ? "fit" : Number(e.target.value))}>
              <option value="fit">{t("show.fit")}</option>
              {SHOW_ZOOM_LEVELS.map((z) => (
                <option key={z} value={String(z)}>
                  {Math.round(z * 100)} %
                </option>
              ))}
            </select>
            <RibbonButton label={t("show.fit")} icon="zoom" showLabel pressed={zoom === "fit"} onClick={() => onZoom("fit")} />
          </RibbonStack>
        ),
      },
      languageRibbonGroup(t),
      {
        label: t("group.help"),
        items: <RibbonButton label={t("shortcuts.title")} icon="keyboard" size="large" shortcut="Mod+/" onClick={() => triggerShortcut("Mod+/")} />,
      },
    ],
  };

  const settings = state.pres?.showSettings ?? DEFAULT_SHOW_SETTINGS;
  const slideShow: RibbonTab = {
    id: "slideShow",
    label: t("show.tab.slideShow"),
    groups: [
      {
        label: t("show.startShow"),
        items: (
          <>
            <RibbonButton label={t("show.fromBeginning")} icon="present" size="large" shortcut="F5" disabled={!hasSlide} onClick={() => onPresent(true)} />
            <RibbonButton label={t("show.fromCurrent")} icon="presentCurrent" size="large" shortcut="Shift+F5" disabled={!hasSlide} onClick={() => onPresent(false)} />
            <RibbonMenuButton
              label={t("show.custom.menu")}
              icon={DI.customShow}
              size="large"
              showLabel
              disabled={!state.pres}
              menu={[
                ...(state.pres?.customShows ?? []).map((c) => ({ id: `custom-${c.id}`, label: c.name, disabled: !c.slideIds.length, onSelect: () => store.requestShow({ customShow: c.id }) })),
                ...(state.pres?.customShows?.length ? [{ separator: true as const }] : []),
                { id: "customShows", label: t("show.custom.titleDots"), onSelect: () => store.openDialog({ kind: "customShows" }) },
              ]}
            />
          </>
        ),
      },
      {
        label: t("show.setUp"),
        items: (
          <>
            <RibbonButton label={t("show.setup.titleDots")} icon={DI.setUpShow} size="large" showLabel disabled={!state.pres} onClick={() => store.openDialog({ kind: "setUpShow" })} />
            <RibbonButton label={t("show.hideSlide")} icon={DI.hideSlide} size="large" showLabel pressed={!!currentSlide?.hidden} disabled={!hasSlide || masterView} onClick={() => void store.toggleHidden(state.view === "sorter" ? store.selectedSlides() : undefined)} />
            <RibbonButton label={t("show.rehearse")} icon={DI.rehearse} size="large" showLabel disabled={!hasSlide || !onRehearse} onClick={() => onRehearse?.()} />
            <RibbonStack>
              <ViewCheck label={t("show.useTimings")} checked={settings.useTimings} disabled={!state.pres} onChange={(on) => void store.setShowSettings({ ...settings, useTimings: on })} />
              <ViewCheck label={t("show.setup.loopShort")} checked={settings.loop} disabled={!state.pres} onChange={(on) => void store.setShowSettings({ ...settings, loop: on })} />
            </RibbonStack>
          </>
        ),
      },
      {
        label: t("show.monitors"),
        items: (
          <>
            <RibbonMenuButton
              label={t("show.monitor.label", { name: choiceLabel(monitor.choice, monitor.screens, t) })}
              icon="presentCurrent"
              showLabel
              tooltip={t("show.monitor.tip")}
              menu={[
                { id: "monitor-auto", label: t("show.monitor.auto"), checked: monitor.choice === "auto", onSelect: () => monitor.choose("auto") },
                { id: "monitor-primary", label: t("show.monitor.primary"), checked: monitor.choice === "primary", onSelect: () => monitor.choose("primary") },
                ...monitor.screens.map((sc) => ({ id: `monitor-${sc.id}`, label: `${sc.label} (${Math.round(sc.width)} × ${Math.round(sc.height)})`, checked: monitor.choice === sc.id, onSelect: () => monitor.choose(sc.id) })),
                ...(canDetectScreens() ? [{ separator: true as const }, { id: "monitor-detect", label: t("show.monitor.detect"), onSelect: monitor.detect }] : []),
              ]}
            />
            <RibbonButton label={t("show.presenterView")} icon="presentCurrent" size="large" shortcut="Alt+F5" tooltip={t("show.presenterTip")} disabled={!hasSlide} onClick={onPresenterView} />
          </>
        ),
      },
    ],
  };

  const transitions = transitionsTab(store, state, t);
  const animations = animationsTab(store, state, t);

  const fileOff = fileIo ? undefined : t("show.noFileIo");
  return (
    <div data-keep-edit>
      <Ribbon
        appName="Rusuite Show"
        documentTitle={`${name ?? t("doc.untitled")}${dirty ? " •" : ""}`}
        accent="#c2410c"
        tabs={masterView ? [slideMasterTab(store, state, t), home, view] : [home, insert, design, transitions, animations, slideShow, view, ...contextual]}
        activeTab={state.ribbonTab}
        onTabChange={(id) => store.setRibbonTab(id)}
        rightSlot={<>
          <HelpMenu docStats={() => ({ slides: store.getState().pres?.slides.length ?? 0 })} />
          <button
            type="button"
            onClick={() => onPresent(false)}
            disabled={!hasSlide}
            title={t("show.presentTip")}
            className="flex h-6 items-center gap-1 rounded bg-orange-700 px-3 text-sm font-medium text-white hover:bg-orange-800 disabled:opacity-40"
          >
            <RibbonIcon name="present" />
            {t("show.present")}
          </button>
        </>}
        backstage={{
          session,
          onNew: () => triggerShortcut("Mod+N"),
          onOpen: () => triggerShortcut("Mod+O"),
          onSave: () => void store.save(),
          onSaveAs: () => triggerShortcut("Mod+Shift+S"),
          onExportPdf,
          print,
          onCloseDocument: () => triggerShortcut("Mod+N"),
          fileDisabledReason: fileOff,
          exportDisabled: !hasSlide,
        }}
      />
    </div>
  );
}
