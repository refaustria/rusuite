// Show view-model store (ADR 0001: the frontend only holds a view of the
// Rust document). The presentation comes from `getPresentation` and is
// updated by `ShowPatch`es (whole slides); UI-only state (current slide,
// selection, text editing session, toasts) lives next to it. A tiny
// `useSyncExternalStore` store like Calc's.

import { useSyncExternalStore } from "react";
import type { RunProperties } from "../../../../packages/ui-shared/src/generated/RunProperties";
import { ShowApiError, type PatchEnvelope, type ShowApi } from "../api";
import type { Alignment } from "../generated/Alignment";
import type { Animation } from "../generated/Animation";
import type { AnimationKind } from "../generated/AnimationKind";
import type { AnimationPatch } from "../generated/AnimationPatch";
import type { Effect } from "../generated/Effect";
import type { AlignMode } from "../generated/AlignMode";
import type { Axis } from "../generated/Axis";
import type { Bullet } from "../generated/Bullet";
import type { Color } from "../../../../packages/ui-shared/src/generated/Color";
import type { Layout } from "../generated/Layout";
import type { LayoutKind } from "../generated/LayoutKind";
import type { PlaceholderKind } from "../generated/PlaceholderKind";
import type { SlideScale } from "../generated/SlideScale";
import type { SlideMaster } from "../generated/SlideMaster";
import { bytesToBase64 } from "@rusuite/ui-shared";
import type { NodeId } from "../generated/NodeId";
import type { Presentation } from "../generated/Presentation";
import type { Shape } from "../generated/Shape";
import type { ShowCommand } from "../generated/ShowCommand";
import type { ShowPatch } from "../generated/ShowPatch";
import type { Slide } from "../generated/Slide";
import type { TextBody } from "../generated/TextBody";
import type { Transform } from "../generated/Transform";
import type { ZOp } from "../generated/ZOp";
import type { BodyProps } from "../generated/BodyProps";
import type { GuideOrient } from "../generated/GuideOrient";
import type { ShowSettings } from "../generated/ShowSettings";
import type { ViewProps } from "../generated/ViewProps";
import { dragGuide, newGuide, nudgeDelta } from "../canvas/guides";
import { boundsPx, EMU_PER_PX, type Rect as BoxRect } from "../geometry";
import { moveSlidesCommand, sorterSelect, type SorterDrop } from "../views/sorter";
import { bodyWithLines, outlinePlan, outlineSlide } from "../views/outline";
import { allCommand, hideCommand, moveToZ, renameCommand } from "../ui/selection";
import { autofitProps, fitHeight, fitSize, withScale } from "../text/autofit";
import { cleanBody, editorText, spliceBody, textDiff } from "../text/editing";
import type { ChartData } from "../generated/ChartData";
import type { ChartShape } from "../generated/ChartShape";
import type { Hyperlink } from "../generated/Hyperlink";
import type { MediaPatch } from "../generated/MediaPatch";
import { applyPreset, presetById } from "../charts/presets";
import { transposeData } from "../charts/data";
import type { Chart } from "../charts/types";
import { linkAt, linkCommands, reusePayload } from "./rich";
import { effectiveParagraph, findShape, placeholderDef, textOf } from "../model";
import {
  alignCommand, alignmentCommand, bodyFromText, bulletCommand, compound, duplicateCommand, formatCommands, indentCommands,
  lineSpacingCommand, newShape, nudgeCommand, pasteOffset, runPropsRange, runPropsWhole, selectedParagraphs, stepFontSize, textPos as textPosOf,
  type FormatValues, type InsertKind,
} from "./commands";
import type { ShortcutAction } from "./shortcuts";
import { changeTransition, effectPatch, newAnimation, type TransitionChange } from "../anim/effects";
import type { Alignment as Align } from "../generated/Alignment";
import type { Anchor } from "../generated/Anchor";
import type { ArrowKind } from "../generated/ArrowKind";
import type { ArrowSize } from "../generated/ArrowSize";
import type { ConnectorKind } from "../generated/ConnectorKind";
import type { Insets } from "../generated/Insets";
import type { Line } from "../generated/Line";
import type { TableCellPatch } from "../generated/TableCellPatch";
import type { TextDirection } from "../generated/TextDirection";
import type { Preset } from "../generated/Preset";
import type { Table } from "../generated/Table";
import type { TableLook } from "../generated/TableLook";
import { pathCache } from "../shapes/paths";
import type { Background } from "../generated/Background";
import type { BackgroundTarget } from "../generated/BackgroundTarget";
import type { BuiltinTheme } from "../generated/BuiltinTheme";
import type { ColorScheme } from "../generated/ColorScheme";
import type { Crop } from "../generated/Crop";
import type { DesignTarget } from "../generated/DesignTarget";
import type { FontScheme } from "../generated/FontScheme";
import type { PicturePatch } from "../generated/PicturePatch";
import type { SlideSize } from "../generated/SlideSize";
import type { TextField } from "../generated/TextField";
import { DESIGN_COMMANDS, DESIGN_SHAPE_BASE, designSlide, placeholderOfShape, targetPlaceholders, translateDesignCommand, validTarget } from "../design/master";
import { hfCommand, insertField, type HfValues } from "../design/hf";
import { moveToSectionCommand, removeAllSectionsCommand } from "../design/sections";
import { fieldText } from "../design/fields";
import { NO_CROP, stylePatch, type PictureStyle } from "../design/picture";
import { t } from "../i18n";
import { centredTransform } from "../geometry";
import { choiceOf, choiceShape, clickBox, freeformShape, pushRecent } from "../shapes/presets";
import { refit } from "../shapes/editPoints";
import type { GeomPath } from "../generated/GeomPath";
import type { PathCmd } from "../generated/PathCmd";
import type { ThemeColorSlot } from "../../../../packages/ui-shared/src/generated/ThemeColorSlot";
import {
  arrowCommand, arrowSizeCommand, connectorKindCommand, drawConnectorCommand, moveEndCommands, rerouteCommand, type ConnEnd, type SlideSite,
} from "../shapes/connectors";
import {
  alignCommand as cellAlignCommand, anchorCommand, anchorOf, bordersCommand, deleteColsCommand, deleteRowsCommand, distributeCommand,
  expandRange, insertColsCommand, insertRowsCommand, insertTableCommand, lookCommand, marginsCommand, mergeCommand, moveCell, splitGridCommand,
  resizeColCommand, resizeRowCommand, shadingCommand, splitCommand, clearTableCommand, vertCommand, penLine, cellPropsCommand, DEFAULT_PEN, type Pen, styleCommand, type BorderKind, type CellMove, type CellRange,
} from "../shapes/tables";

export interface Toast {
  id: number;
  message: string;
}

/** The overlay text editor's session. */
export interface EditSession {
  shape: NodeId;
  /** A table cell being edited (`shape` is the table). */
  cell?: { row: number; col: number };
  text: string;
  /** Editor selection (UTF-16 offsets into `text`). */
  start: number;
  end: number;
  /**
   * The rich body `text` stands for, once the editor spliced it (typing
   * keeps the runs' formatting); absent = `bodyFromText(text, model body)`.
   */
  body?: TextBody;
}

export interface ShowState {
  pres: Presentation | null;
  /** Id of the slide shown in the editor. */
  current: NodeId | null;
  /** Selected top-level shapes of the current slide. */
  selection: NodeId[];
  editing: EditSession | null;
  revision: number;
  canUndo: boolean;
  canRedo: boolean;
  dirty: boolean;
  /** File name (`null` = new). */
  name: string | null;
  /** Status bar message of the last patch. */
  info: string | null;
  warnings: string[];
  toasts: Toast[];
  /** Bumped when an image arrives in the media cache. */
  mediaVersion: number;
  /** The core answers the file requests (`openPptx`/`savePptx`). */
  fileIo: boolean;
  /** What the internal clipboard holds (`null` = empty). */
  clipboard: "shapes" | "slides" | null;
  /** The speaker notes pane under the stage is shown. */
  notesVisible: boolean;
  /** An open dialog of the slide editor. */
  dialog: ShowDialog | null;
  /** The ribbon tab shown (the stage shows animation badges on the Animations tab). */
  ribbonTab: string;
  /** The Animation pane on the right is open. */
  animPane: boolean;
  /** The animation selected in the pane (or by its badge); the Animations tab edits it. */
  animSelection: NodeId | null;
  /** A Preview playing on the editor stage (`seq` restarts it). */
  preview: { kind: "transition" | "animations"; seq: number } | null;
  /** Insert › Shapes: the gallery item being drawn on the slide (click or drag; Esc cancels). */
  drawMode: string | null;
  /** Recently used gallery items, newest first. */
  recentShapes: string[];
  /** Selected cells of the selected table. */
  cellSel: { shape: NodeId; range: CellRange } | null;
  /** View › Slide Master: the master or layout being edited (`null` = normal view). */
  masterView: DesignTarget | null;
  /**
   * Slide Master view: the outline level (0-based) formatting of the
   * selected master body placeholder applies to (`null` = each paragraph
   * to its own level); Tab / Shift+Tab step it, like moving through
   * PowerPoint's "Second level, Third level …" sample text.
   */
  masterLevel: number | null;
  /** The built-in themes (`getThemes`, loaded once for the Design tab). */
  themes: BuiltinTheme[] | null;
  /** The Format Background pane on the right is open. */
  bgPane: boolean;
  /** Picture Format › Crop: the picture being cropped, its crop and box so far. */
  crop: { shape: NodeId; crop: Crop; box: Transform } | null;
  /** The chart Format pane (right of the stage). */
  chartPane: boolean;
  /** The series the chart Format tab and pane edit. */
  chartSeries: number;
  /** The Reuse Slides pane and the presentation it shows. */
  reusePane: boolean;
  reuse: { name: string; pres: Presentation; warnings: string[] } | null;
  /** View › Presentation Views (P8-28; the Slide Master view is `masterView`). */
  view: PresentationView;
  /** Slides selected in the Slide Sorter / the slide panel (the current one included). */
  slideSel: NodeId[];
  /** Home › Select › Selection Pane (right of the stage). */
  selectionPane: boolean;
  /** The Format Shape pane (right of the stage) on Size & Properties or Text Options. */
  formatPane: "size" | "text" | "cell" | null;
  /** Arrange › Align: align to the slide or to the selected objects (two or more). */
  alignTo: "slide" | "selection";
  /** Table Design › Table Styles: the style the pointer rests on, shown on the selected table (live preview). */
  tablePreview: string | null;
  /** Table Design › Draw Borders: the pen the Borders menu draws with. */
  pen: Pen;
  /** Shape Format › Edit Points: the shape whose vertices are shown (`null` = off). */
  editPoints: NodeId | null;
}

/** The presentation views of View › Presentation Views. */
export type PresentationView = "normal" | "outline" | "sorter" | "notesPage" | "reading";

/** Theme shape styles of Shape Format › Shape Styles: fill and outline per accent. */
export type ShapeStyleChoice = { accent: number; kind: "fill" | "outline" | "light" };

/** Dialogs opened from menus: Format Shape, Alt Text, the Replace Picture file picker. */
export type ShowDialog =
  | { kind: "format" }
  | { kind: "alt"; shape: NodeId }
  | { kind: "replacePicture"; shape: NodeId }
  | { kind: "insertTable" }
  | { kind: "splitCells" }
  | { kind: "cellLayout" }
  | { kind: "slideScale"; size: SlideSize }
  | { kind: "renameLayout"; layout: LayoutKind }
  | { kind: "headerFooter"; tab?: "slide" | "notes" }
  | { kind: "slideSize" }
  | { kind: "renameSection"; index: number }
  | { kind: "insertChart" }
  | { kind: "chartType" }
  | { kind: "editData" }
  | { kind: "link" }
  | { kind: "action" }
  | { kind: "gridGuides" }
  | { kind: "setUpShow" };

/** The internal clipboard: shapes (with the slide they came from) or slide ids. */
type Clip = { kind: "shapes"; shapes: Shape[]; slide: NodeId | null; pastes: number } | { kind: "slides"; ids: NodeId[] };

/** Applies a patch to a presentation (ShowPatch doc: delete, replace/add, reorder). Pure. */
export function applyPatch(pres: Presentation, patch: ShowPatch): Presentation {
  const deleted = new Set(patch.deletedSlides);
  let slides = pres.slides.filter((s) => !deleted.has(s.id));
  for (const s of patch.slides) {
    const i = slides.findIndex((x) => x.id === s.id);
    if (i >= 0) slides[i] = s;
    else slides.push(s);
  }
  if (patch.slidesOrder) {
    const byId = new Map(slides.map((s) => [s.id, s]));
    slides = patch.slidesOrder.map((id) => byId.get(id)).filter((s): s is Slide => !!s);
  }
  const out: Presentation = { ...pres, slides, slideSize: patch.slideSize ?? pres.slideSize };
  if (patch.theme) out.theme = patch.theme;
  if (patch.master) out.master = patch.master;
  if (patch.layouts) out.layouts = patch.layouts;
  if (patch.sections) out.sections = patch.sections;
  if (patch.view) out.view = patch.view;
  if (patch.showSettings) out.showSettings = patch.showSettings;
  return out;
}

/** Rewrites temporary ids by the patch's `idMap`. */
export function mapIds(ids: number[], idMap: Map<number, number>): number[] {
  return ids.map((id) => idMap.get(id) ?? id);
}

const errorMessage = (e: unknown) =>
  e instanceof ShowApiError ? `${e.message} (${e.code})` : e instanceof Error ? e.message : String(e);

export class ShowStore {
  private state: ShowState = {
    pres: null,
    current: null,
    selection: [],
    editing: null,
    revision: -1,
    canUndo: false,
    canRedo: false,
    dirty: false,
    name: null,
    info: null,
    warnings: [],
    toasts: [],
    mediaVersion: 0,
    fileIo: false,
    clipboard: null,
    notesVisible: false,
    dialog: null,
    ribbonTab: "home",
    animPane: false,
    animSelection: null,
    preview: null,
    drawMode: null,
    recentShapes: loadRecent(),
    cellSel: null,
    masterView: null,
    masterLevel: null,
    themes: null,
    bgPane: false,
    crop: null,
    chartPane: false,
    chartSeries: 0,
    reusePane: false,
    reuse: null,
    view: "normal",
    slideSel: [],
    selectionPane: false,
    formatPane: null,
    alignTo: "selection",
    tablePreview: null,
    pen: DEFAULT_PEN,
    editPoints: null,
  };
  /** The children of the last Ungroup (Regroup). */
  private lastUngrouped: NodeId[] | null = null;
  private clip: Clip | null = null;
  /** The editor session Insert › Link was opened from (the editor closes when the dialog opens). */
  private linkEdit: EditSession | null = null;
  private listeners = new Set<() => void>();
  private toastSeq = 0;
  private tempSeq = 0;
  private queue: Promise<unknown> = Promise.resolve();
  /** Media id → data URL. */
  readonly media = new Map<number, string>();
  private mediaPending = new Set<number>();

  constructor(readonly api: ShowApi) {
    pathCache.setFetcher((queries) => api.shapePaths(queries));
  }

  // --- plumbing -----------------------------------------------------------

  getState = (): ShowState => this.state;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private set(partial: Partial<ShowState>): void {
    this.state = { ...this.state, ...partial };
    for (const fn of this.listeners) fn();
  }

  /** A fresh temporary (negative) id. */
  temp = (): number => --this.tempSeq;

  pushError(e: unknown): void {
    this.set({ toasts: [...this.state.toasts, { id: ++this.toastSeq, message: errorMessage(e) }] });
  }

  dismissToast(id: number): void {
    this.set({ toasts: this.state.toasts.filter((t) => t.id !== id) });
  }

  /** Runs `fn` after every earlier request (requests are strictly serialized). */
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => undefined);
    return next;
  }

  // --- model access ---------------------------------------------------------

  currentSlide(): Slide | null {
    return viewSlide(this.state);
  }

  /** Selected top-level shapes, in z-order. */
  selectedShapes(): Shape[] {
    const sel = new Set(this.state.selection);
    return this.currentSlide()?.shapes.filter((s) => sel.has(s.id)) ?? [];
  }

  /** A shape of the current slide (also inside groups). */
  shape(id: NodeId): Shape | null {
    const slide = this.currentSlide();
    return slide ? (findShape(slide.shapes, id)?.shape ?? null) : null;
  }

  // --- loading and patches ----------------------------------------------------

  /** Installs a whole presentation (after `getPresentation`/`load`/`newPresentation`/open). */
  setPresentation(pres: Presentation, env: PatchEnvelope, extra: Partial<ShowState> = {}): void {
    this.media.clear();
    this.mediaPending.clear();
    for (const m of pres.media) this.media.set(m.id, `data:${m.contentType};base64,${m.data}`);
    this.set({
      pres,
      current: pres.slides[0]?.id ?? null,
      selection: [],
      editing: null,
      revision: env.revision,
      canUndo: env.canUndo,
      canRedo: env.canRedo,
      dirty: env.dirty,
      info: null,
      mediaVersion: this.state.mediaVersion + 1,
      animSelection: null,
      preview: null,
      masterView: null,
      crop: null,
      cellSel: null,
      ribbonTab: this.state.ribbonTab === "slideMaster" ? "home" : this.state.ribbonTab,
      view: viewOfLast(pres.view?.lastView),
      slideSel: pres.slides[0] ? [pres.slides[0].id] : [],
      ...extra,
    });
  }

  /**
   * Applies a reply: discards out-of-order revisions (ADR 0002 §5),
   * applies the patch, rewrites temporary ids in the selection and the
   * edit session, and keeps the current slide valid. Returns the id map,
   * or `null` when the reply was discarded.
   */
  applyEnvelope(env: PatchEnvelope): Map<number, number> | null {
    const s = this.state;
    if (!s.pres || env.revision < s.revision) return null;
    const p = env.patch;
    const idMap = new Map<number, number>(p.idMap);
    const pres = applyPatch(s.pres, p);
    let current = s.current === null ? null : (idMap.get(s.current) ?? s.current);
    if (current === null || !pres.slides.some((x) => x.id === current)) {
      const oldIndex = Math.max(0, s.pres.slides.findIndex((x) => x.id === s.current));
      current = pres.slides[Math.min(oldIndex, pres.slides.length - 1)]?.id ?? null;
    }
    const masterView = s.masterView && p.layouts ? validTarget(pres, s.masterView) : s.masterView;
    const slide = masterView ? designSlide(pres, masterView) : pres.slides.find((x) => x.id === current);
    const top = new Set(slide?.shapes.map((x) => x.id) ?? []);
    const selection = mapIds(s.selection, idMap).filter((id) => top.has(id));
    let editing = s.editing ? { ...s.editing, shape: idMap.get(s.editing.shape) ?? s.editing.shape } : null;
    if (editing && !(slide && findShape(slide.shapes, editing.shape))) editing = null;
    if (editing?.cell) {
      const tb = tableOf(slide ? (findShape(slide.shapes, editing.shape)?.shape ?? null) : null);
      const cell = tb?.cells[editing.cell.row]?.[editing.cell.col];
      if (!cell || cell.covered) editing = null;
    }
    if (editing?.body && slide) {
      // the session's text went to the core with this change: the model's body (with the formatting just applied) is the session's again
      const sh = findShape(slide.shapes, editing.shape)?.shape ?? null;
      const now = editing.cell ? tableOf(sh)?.cells[editing.cell.row]?.[editing.cell.col]?.text : sh ? textOf(sh) : null;
      if (now && editorText(now) === editing.text) editing = { ...editing, body: undefined };
    }
    let cellSel = s.cellSel;
    if (cellSel) {
      const tb = selection.includes(cellSel.shape) ? tableOf(slide?.shapes.find((x) => x.id === cellSel!.shape) ?? null) : null;
      const r = cellSel.range;
      cellSel = tb && r.r1 < tb.rows.length && r.c1 < tb.cols.length ? cellSel : null;
    }
    let animSelection = s.animSelection === null ? null : (idMap.get(s.animSelection) ?? s.animSelection);
    if (animSelection !== null && !slide?.animations?.some((a) => a.id === animSelection)) animSelection = null;
    const crop = s.crop && top.has(s.crop.shape) ? s.crop : null;
    const alive = new Set(pres.slides.map((x) => x.id));
    let slideSel = mapIds(s.slideSel, idMap).filter((id) => alive.has(id));
    if (current !== null && !slideSel.includes(current)) slideSel = [current];
    this.set({
      pres,
      current,
      slideSel,
      selection,
      editing,
      cellSel,
      animSelection,
      masterView,
      crop,
      revision: env.revision,
      canUndo: env.canUndo,
      canRedo: env.canRedo,
      dirty: env.dirty,
      info: p.info ?? s.info,
    });
    this.fetchMissingMedia(p.slides, { master: p.master, layouts: p.layouts });
    return idMap;
  }

  private fetchMissingMedia(slides: Slide[], design?: { master?: SlideMaster; layouts?: Layout[] }): void {
    const want = new Set<number>();
    // picture backgrounds of slides, layouts and the master
    const bg = (b: Background | null | undefined) => {
      if (b?.kind === "picture") want.add(b.value.media);
    };
    slides.forEach((s) => bg(s.background));
    bg(design?.master?.background);
    design?.layouts?.forEach((l) => bg(l.background));
    const walk = (shapes: Shape[]) => {
      for (const sh of shapes) {
        if (sh.kind.kind === "picture") want.add(sh.kind.value.media);
        else if (sh.kind.kind === "media") {
          want.add(sh.kind.value.media);
          if (sh.kind.value.poster !== undefined) want.add(sh.kind.value.poster);
        } else if (sh.kind.kind === "group") walk(sh.kind.value.children);
      }
    };
    slides.forEach((s) => walk(s.shapes));
    for (const id of want) {
      if (this.media.has(id) || this.mediaPending.has(id)) continue;
      this.mediaPending.add(id);
      void this.enqueue(() => this.api.getMedia(id))
        .then((m) => {
          this.media.set(id, `data:${m.contentType};base64,${m.bytesBase64}`);
          this.set({ mediaVersion: this.state.mediaVersion + 1 });
        })
        .catch((e) => this.pushError(e))
        .finally(() => this.mediaPending.delete(id));
    }
  }

  /** Loads the core's current presentation. */
  async init(): Promise<void> {
    try {
      const body = await this.enqueue(() => this.api.getPresentation());
      const state = await this.enqueue(() => this.api.documentState()).catch(() => null);
      this.setPresentation(body.presentation, body.envelope, { name: state?.name ?? null });
    } catch (e) {
      this.pushError(e);
    }
  }

  /** Sends a command and applies its patch; errors become toasts (`null`). */
  async run(command: ShowCommand | null): Promise<{ env: PatchEnvelope; idMap: Map<number, number> } | null> {
    if (!command) return null;
    const mv = this.state.masterView;
    if (mv && this.state.pres && !DESIGN_COMMANDS.has(command.type)) {
      // the master view's pseudo slide: placeholder edits become design commands
      const tr = translateDesignCommand(this.state.pres, mv, command, { level: this.state.editing ? null : this.state.masterLevel });
      if (tr.dropped) this.set({ info: t("show.master.notHere") });
      command = compound(tr.commands);
      if (!command) return null;
    }
    try {
      const env = await this.enqueue(() => this.api.apply(command));
      const idMap = this.applyEnvelope(env) ?? new Map();
      return { env, idMap };
    } catch (e) {
      this.pushError(e);
      return null;
    }
  }

  async undo(): Promise<void> {
    await this.history("undo");
  }

  async redo(): Promise<void> {
    await this.history("redo");
  }

  private async history(kind: "undo" | "redo"): Promise<void> {
    if (this.state.editing) await this.commitEdit();
    try {
      const env = await this.enqueue(() => (kind === "undo" ? this.api.undo() : this.api.redo()));
      this.applyEnvelope(env);
    } catch (e) {
      this.pushError(e);
    }
  }

  // --- slides -----------------------------------------------------------------

  selectSlide(id: NodeId, slideSel: NodeId[] = [id]): void {
    if (this.state.editing) void this.commitEdit();
    this.set({ current: id, selection: [], editing: null, animSelection: null, preview: null, slideSel });
  }

  /** Runs a slide command and makes the slide it created current; returns its id. */
  private async runSlideCommand(command: ShowCommand): Promise<NodeId | undefined> {
    const before = new Set(this.state.pres?.slides.map((s) => s.id) ?? []);
    const res = await this.run(command);
    const added = res?.env.patch.slidesOrder?.find((id) => !before.has(id));
    if (added !== undefined) this.set({ current: added, selection: [] });
    return added;
  }

  async addSlide(layout: LayoutKind): Promise<void> {
    const after = this.state.current;
    await this.runSlideCommand(after === null ? { type: "addSlide", layout } : { type: "addSlide", after, layout });
  }

  async duplicateSlide(id: NodeId): Promise<void> {
    await this.runSlideCommand({ type: "duplicateSlide", id });
  }

  /** Changes the layout of `slides` (default: the current one). */
  async setSlideLayout(layout: LayoutKind, slides?: NodeId[]): Promise<void> {
    if (this.state.editing) await this.commitEdit();
    const ids = slides ?? (this.state.current === null ? [] : [this.state.current]);
    await this.run(compound(ids.map((slide) => ({ type: "setSlideLayout", slide, layout }))));
  }

  /** Hides `slides` (default: the current one) in the slide show, or shows them again when all are hidden. */
  async toggleHidden(slides?: NodeId[]): Promise<void> {
    const ids = slides ?? (this.state.current === null ? [] : [this.state.current]);
    const all = this.state.pres?.slides.filter((s) => ids.includes(s.id)) ?? [];
    if (!all.length) return;
    await this.run({ type: "setSlidesHidden", slides: ids, hidden: !all.every((s) => s.hidden) });
  }

  /** Sets the speaker notes of a slide (no command when unchanged). */
  async setNotes(slide: NodeId, notes: string): Promise<void> {
    const old = this.state.pres?.slides.find((s) => s.id === slide)?.notes ?? "";
    if (old === notes) return;
    await this.run({ type: "setNotes", slide, notes: notes || null });
  }

  /** Background colour of the current slide, or of every slide (`null` = the master's). */
  async setBackground(color: Color | null, all = false): Promise<void> {
    const ids = all ? (this.state.pres?.slides.map((s) => s.id) ?? []) : this.state.current === null ? [] : [this.state.current];
    const fill = color ? ({ kind: "solid", value: color } as const) : null;
    await this.run(compound(ids.map((slide) => ({ type: "setSlideBackground", slide, fill }))));
  }

  toggleNotes(): void {
    this.set({ notesVisible: !this.state.notesVisible });
  }

  async deleteSlides(ids: NodeId[]): Promise<void> {
    await this.run({ type: "deleteSlides", ids });
  }

  async moveSlide(id: NodeId, toIndex: number): Promise<void> {
    const from = this.state.pres?.slides.findIndex((s) => s.id === id) ?? -1;
    if (from < 0 || from === toIndex) return;
    await this.run({ type: "moveSlide", id, toIndex });
  }

  // --- clipboard (internal; text keeps the native clipboard while editing) ------

  /** Copies the selected shapes. */
  copy(): boolean {
    const shapes = this.selectedShapes();
    if (this.state.editing || !shapes.length) return false;
    this.clip = { kind: "shapes", shapes: structuredClone(shapes), slide: this.state.current, pastes: 0 };
    this.set({ clipboard: "shapes" });
    return true;
  }

  /** Copies and deletes the selected shapes. */
  async cut(): Promise<void> {
    if (this.copy()) await this.deleteSelection();
  }

  /** Copies slides (the slide sorter's Ctrl+C). */
  copySlides(ids: NodeId[]): void {
    if (!ids.length) return;
    this.clip = { kind: "slides", ids: [...ids] };
    this.set({ clipboard: "slides" });
  }

  /**
   * Pastes the clipboard: shapes onto the current slide (new ids, offset
   * further with every paste onto the slide they came from) and selects
   * them; slides as copies after the current slide.
   */
  async paste(): Promise<void> {
    const c = this.clip;
    const slide = this.state.current;
    if (!c) return;
    if (c.kind === "slides") return this.pasteSlides(c.ids);
    if (slide === null || !c.shapes.length) return;
    if (this.state.editing) await this.commitEdit();
    const same = c.slide === slide;
    if (same) c.pastes += 1;
    const { command, ids } = duplicateCommand(slide, c.shapes, this.temp, pasteOffset(same, c.pastes));
    if (!command) return;
    this.set({ selection: ids });
    await this.run(command);
  }

  /** Inserts copies of `ids` (in order) after the current slide. */
  private async pasteSlides(ids: NodeId[]): Promise<void> {
    for (const id of ids) {
      const pres = this.state.pres;
      if (!pres?.slides.some((s) => s.id === id)) continue;
      const target = pres.slides.findIndex((s) => s.id === this.state.current) + 1;
      const copy = await this.runSlideCommand({ type: "duplicateSlide", id });
      if (copy === undefined) return;
      const at = this.state.pres?.slides.findIndex((s) => s.id === copy) ?? -1;
      if (at >= 0 && at !== target) await this.run({ type: "moveSlide", id: copy, toIndex: target });
    }
  }

  // --- dialogs ----------------------------------------------------------------

  openDialog(dialog: ShowDialog): void {
    // Insert › Link works on the text selection the editor had
    this.linkEdit = dialog.kind === "link" && this.state.editing && !this.state.editing.cell ? this.state.editing : null;
    if (this.state.editing) void this.commitEdit();
    this.set({ dialog });
  }

  closeDialog(): void {
    this.set({ dialog: null });
  }

  /** Applies the Format Shape dialog to the selected shapes (one undo step). */
  async applyFormat(before: FormatValues, values: FormatValues): Promise<void> {
    await this.run(compound(formatCommands(this.selectedShapes(), before, values)));
  }

  async setAltText(shape: NodeId, alt: string): Promise<void> {
    if ((this.shape(shape)?.alt ?? "") === alt) return;
    await this.run({ type: "setAltText", shape, alt: alt || null });
  }

  async replacePicture(shape: NodeId, contentType: string, bytesBase64: string): Promise<void> {
    await this.run({ type: "replacePicture", shape, contentType, bytesBase64 });
  }

  /** Natural size for the selected pictures. */
  async resetPictureSize(): Promise<void> {
    const shapes = this.selectedShapes().filter((s) => s.kind.kind === "picture").map((s) => s.id);
    if (shapes.length) await this.run({ type: "resetPictureSize", shapes });
  }

  // --- selection --------------------------------------------------------------

  /** `replace` the selection, `toggle` one shape (shift-click) or `add`. */
  select(ids: NodeId[], mode: "replace" | "toggle" | "add" = "replace"): void {
    const cur = this.state.selection;
    let next: NodeId[];
    if (mode === "replace") next = ids;
    else if (mode === "add") next = [...cur, ...ids.filter((i) => !cur.includes(i))];
    else {
      next = [...cur];
      for (const id of ids) {
        const i = next.indexOf(id);
        if (i >= 0) next.splice(i, 1);
        else next.push(id);
      }
    }
    if (this.state.editing && !next.includes(this.state.editing.shape)) void this.commitEdit();
    const a = this.animation(this.state.animSelection);
    const keep = a && next.includes(this.topOf(a.shape));
    const cs = this.state.cellSel;
    const ep = this.state.editPoints;
    this.set({
      selection: next,
      animSelection: keep ? this.state.animSelection : null,
      cellSel: cs && next.length === 1 && next[0] === cs.shape ? cs : null,
      editPoints: ep !== null && next.length === 1 && next[0] === ep ? ep : null,
    });
  }

  // --- transitions and animations (P8-8) ------------------------------------------

  setRibbonTab(id: string): void {
    if (id !== this.state.ribbonTab) this.set({ ribbonTab: id });
  }

  toggleAnimPane(open = !this.state.animPane): void {
    this.set({ animPane: open });
  }

  /** The current slide's animations, in play order. */
  animations(): Animation[] {
    return this.currentSlide()?.animations ?? [];
  }

  private animation(id: NodeId | null): Animation | undefined {
    return id === null ? undefined : this.animations().find((a) => a.id === id);
  }

  /** The selected animation while its shape is still selected (inserting a shape replaces the selection directly). */
  private selectedAnimation(): Animation | undefined {
    const a = this.animation(this.state.animSelection);
    return a && this.state.selection.includes(this.topOf(a.shape)) ? a : undefined;
  }

  /** The top-level shape of a (possibly grouped) shape of the current slide. */
  private topOf(shape: NodeId): NodeId {
    return findShape(this.currentSlide()?.shapes ?? [], shape)?.top.id ?? shape;
  }

  /** Selects an animation (pane row, stage badge) and its shape; `null` clears it. */
  selectAnimation(id: NodeId | null): void {
    const a = this.animation(id);
    if (!a) {
      this.set({ animSelection: null });
      return;
    }
    if (this.state.editing) void this.commitEdit();
    this.set({ animSelection: a.id, selection: [this.topOf(a.shape)] });
  }

  /**
   * What the Animations tab edits: the selected animation, else every
   * animation of the selected shapes (also of their grouped children).
   */
  targetAnimations(): Animation[] {
    const one = this.selectedAnimation();
    if (one) return [one];
    const sel = new Set(this.state.selection);
    return this.animations().filter((a) => sel.has(this.topOf(a.shape)));
  }

  /** Changes the current slide's transition (Transitions tab). */
  async setTransition(change: TransitionChange): Promise<void> {
    const slide = this.currentSlide();
    if (!slide) return;
    const transition = changeTransition(slide.transition, change);
    if (JSON.stringify(transition ?? null) === JSON.stringify(slide.transition ?? null)) return;
    await this.run({ type: "setTransition", slides: [slide.id], transition });
  }

  /** Transitions › Apply To All: every slide gets the current slide's transition. */
  async applyTransitionToAll(): Promise<void> {
    const from = this.state.current;
    if (from !== null) await this.run({ type: "applyTransitionToAll", from });
  }

  /**
   * The Animation gallery: gives the selected animation (else each selected
   * shape's first animation) this effect; shapes without one get a new On
   * Click animation. `null` (None) removes their animations.
   */
  async applyEffect(choice: { kind: AnimationKind; effect: Effect } | null): Promise<void> {
    const slide = this.currentSlide();
    if (!slide) return;
    if (this.state.editing) await this.commitEdit();
    if (!choice) {
      const ids = this.targetAnimations().map((a) => a.id);
      await this.run(compound(ids.map((id) => ({ type: "removeAnimation", id }))));
      return;
    }
    const sel = this.selectedAnimation();
    if (sel) {
      await this.run({ type: "updateAnimation", id: sel.id, patch: effectPatch(sel, choice.kind, choice.effect) });
      return;
    }
    const commands: ShowCommand[] = [];
    let added: number | null = null;
    for (const shape of this.state.selection) {
      const first = this.animations().find((a) => this.topOf(a.shape) === shape);
      if (first) commands.push({ type: "updateAnimation", id: first.id, patch: effectPatch(first, choice.kind, choice.effect) });
      else {
        const newId = this.temp();
        added ??= newId;
        commands.push({ type: "addAnimation", slide: slide.id, animation: newAnimation(shape, choice.kind, choice.effect), newId });
      }
    }
    const res = await this.run(compound(commands));
    if (res && added !== null && this.state.selection.length === 1) this.selectAnimation(res.idMap.get(added) ?? null);
  }

  /** Add Animation: one more animation for each selected shape (after the last one); selects the new one. */
  async addAnimation(kind: AnimationKind, effect: Effect): Promise<void> {
    const slide = this.currentSlide();
    if (!slide || !this.state.selection.length) return;
    if (this.state.editing) await this.commitEdit();
    const temps = this.state.selection.map(() => this.temp());
    const commands: ShowCommand[] = this.state.selection.map((shape, i) => ({
      type: "addAnimation",
      slide: slide.id,
      animation: newAnimation(shape, kind, effect),
      newId: temps[i]!,
    }));
    const res = await this.run(compound(commands));
    const id = res?.idMap.get(temps[temps.length - 1]!);
    if (id !== undefined) this.selectAnimation(id);
  }

  /** Effect Options, Start, Duration, Delay: for every target animation (one undo step). */
  async updateAnimations(patch: AnimationPatch): Promise<void> {
    const ids = this.targetAnimations().map((a) => a.id);
    await this.run(compound(ids.map((id) => ({ type: "updateAnimation", id, patch }))));
  }

  async removeAnimation(id: NodeId): Promise<void> {
    await this.run({ type: "removeAnimation", id });
  }

  /** Moves an animation to `index` of the play order (pane drag, Move Earlier / Later). */
  async reorderAnimation(id: NodeId, index: number): Promise<void> {
    const list = this.animations();
    const from = list.findIndex((a) => a.id === id);
    if (from < 0 || index < 0 || index >= list.length || index === from) return;
    await this.run({ type: "reorderAnimation", id, index });
  }

  /** Move Earlier (`-1`) / Move Later (`1`) of the selected animation. */
  async moveAnimation(delta: -1 | 1): Promise<void> {
    const id = this.state.animSelection;
    const from = this.animations().findIndex((a) => a.id === id);
    if (id !== null && from >= 0) await this.reorderAnimation(id, from + delta);
  }

  /** Plays the slide's transition or its animations on the editor stage. */
  startPreview(kind: "transition" | "animations"): void {
    if (this.state.current === null) return;
    if (this.state.editing) void this.commitEdit();
    this.set({ preview: { kind, seq: (this.state.preview?.seq ?? 0) + 1 } });
  }

  endPreview(): void {
    if (this.state.preview) this.set({ preview: null });
  }

  // --- shape commands ---------------------------------------------------------

  async setTransforms(shapes: [NodeId, Transform][]): Promise<void> {
    if (shapes.length) await this.run({ type: "setTransform", shapes });
  }

  async deleteSelection(): Promise<void> {
    const ids = this.state.selection;
    if (ids.length) await this.run({ type: "deleteShapes", ids });
  }

  /**
   * Arrow keys: by 1 px (10 with Shift); with "Snap objects to grid" by the
   * grid step onto the grid, unless `fine` (Ctrl) or Shift.
   */
  async nudge(dx: number, dy: number, o: { fine?: boolean; shift?: boolean } = {}): Promise<void> {
    const shapes = this.selectedShapes();
    const v = this.viewProps();
    const grid = v.snapToGrid && !o.shift ? v.gridSpacing / EMU_PER_PX : 0;
    const box = shapes.length ? boundsOf(shapes) : null;
    const d = grid > 0 && !o.fine ? nudgeDelta({ dx: Math.sign(dx), dy: Math.sign(dy) }, box, { ctrl: false, shift: false, grid }) : { dx, dy };
    await this.run(nudgeCommand(shapes, d.dx, d.dy));
  }

  async duplicateSelection(): Promise<void> {
    const slide = this.state.current;
    if (slide === null) return;
    const { command, ids } = duplicateCommand(slide, this.selectedShapes(), this.temp);
    if (!command) return;
    this.set({ selection: ids });
    await this.run(command);
  }

  async group(): Promise<void> {
    const shapes = this.state.selection;
    if (shapes.length < 2) return;
    const newId = this.temp();
    this.set({ selection: [newId] });
    await this.run({ type: "group", shapes, newId });
  }

  async ungroup(): Promise<void> {
    const groups = this.selectedShapes().filter((s) => s.kind.kind === "group");
    if (!groups.length) return;
    const children = groups.flatMap((g) => (g.kind.kind === "group" ? g.kind.value.children.map((c) => c.id) : []));
    const res = await this.run(compound(groups.map((g) => ({ type: "ungroup", group: g.id }))));
    if (res) {
      this.lastUngrouped = children;
      this.select(children);
    }
  }

  /** Regroup: groups the shapes of the last Ungroup again (those still on the slide). */
  async regroup(): Promise<void> {
    const top = new Set(this.currentSlide()?.shapes.map((s) => s.id) ?? []);
    const ids = (this.lastUngrouped ?? []).filter((id) => top.has(id));
    if (ids.length < 2) return;
    this.lastUngrouped = null;
    this.set({ selection: ids });
    await this.group();
  }

  /** Whether Regroup has shapes to group. */
  canRegroup(): boolean {
    const top = new Set(this.currentSlide()?.shapes.map((s) => s.id) ?? []);
    return (this.lastUngrouped ?? []).filter((id) => top.has(id)).length >= 2;
  }

  async zOrder(op: ZOp): Promise<void> {
    const shapes = this.state.selection;
    if (shapes.length) await this.run({ type: "zOrder", shapes, op });
  }

  async align(mode: AlignMode): Promise<void> {
    await this.run(alignCommand(this.state.selection, mode, this.state.alignTo));
  }

  /** Arrange › Align › Align to Slide / Align Selected Objects. */
  setAlignTo(to: "slide" | "selection"): void {
    this.set({ alignTo: to });
  }

  async distribute(axis: Axis): Promise<void> {
    const shapes = this.state.selection;
    if (shapes.length >= 3) await this.run({ type: "distribute", shapes, axis });
  }

  /** Inserts a shape centred on the current slide and selects it (a text box opens the editor). */
  async insert(kind: InsertKind): Promise<void> {
    const { pres, current } = this.state;
    if (!pres || current === null) return;
    if (this.state.editing) await this.commitEdit();
    const shape = newShape(kind, pres.slideSize, this.temp());
    this.set({ selection: [shape.id] });
    const res = await this.run({ type: "addShape", slide: current, shape });
    const real = res?.idMap.get(shape.id);
    if (kind === "textBox" && real !== undefined) this.startEdit(real);
  }

  /** Inserts an image (natural size, centred by the core) and selects it. */
  async insertPicture(contentType: string, bytesBase64: string): Promise<void> {
    const slide = this.state.current;
    if (slide === null) return;
    const newId = this.temp();
    this.set({ selection: [newId] });
    await this.run({ type: "insertPicture", slide, contentType, bytesBase64, newId });
  }

  /** Fill of the selected shapes (`null` = no fill). */
  async setFill(color: Color | null): Promise<void> {
    const shapes = this.state.selection;
    if (shapes.length) await this.run({ type: "setShapeStyle", shapes, fill: color ? { kind: "solid", value: color } : null });
  }

  /** Outline of the selected shapes (`null` = none); width and dash of the first selected outline are kept. */
  async setLine(color: Color | null): Promise<void> {
    const sel = this.selectedShapes();
    if (!sel.length) return;
    const base = sel[0]!.line;
    await this.run({
      type: "setShapeStyle",
      shapes: sel.map((s) => s.id),
      line: color ? { fill: { kind: "solid", value: color }, width: base.width || 12700, dash: base.dash } : null,
    });
  }

  // --- text -------------------------------------------------------------------

  /** Starts the overlay editor on a text-bearing shape (a table: its first cell). */
  startEdit(id: NodeId): void {
    const shape = this.shape(id);
    if (shape?.kind.kind === "table") {
      this.startCellEdit(id, 0, 0);
      return;
    }
    if (!shape || shape.kind.kind !== "auto" || shape.kind.value.geometry === "line") return;
    const text = textOf(shape);
    const t = text ? editorText(text) : "";
    const top = findShape(this.currentSlide()?.shapes ?? [], id)?.top.id ?? id;
    this.set({ editing: { shape: id, text: t, start: t.length, end: t.length }, selection: [top] });
  }

  /** The editor's text and selection; a changed text is spliced into the session's body (one edit, found by diffing). */
  updateEdit(text: string, start: number, end: number): void {
    const e = this.state.editing;
    if (!e) return;
    if (text === e.text) {
      if (start !== e.start || end !== e.end) this.set({ editing: { ...e, start, end } });
      return;
    }
    const d = textDiff(e.text, text, end);
    const body = spliceBody(this.sessionBody(e), d.from, d.to, d.insert);
    this.set({ editing: { ...e, text, body, start, end } });
  }

  /** Replaces `from`…`to` of the edited text by `insert` (`\n` = new paragraph); the caret goes after it. */
  editText(from: number, to: number, insert: string): void {
    const e = this.state.editing;
    if (!e) return;
    const lo = Math.max(0, Math.min(from, to, e.text.length));
    const hi = Math.min(e.text.length, Math.max(from, to));
    const clean = insert.replace(/\r\n?/g, "\n");
    const text = e.text.slice(0, lo) + clean + e.text.slice(hi);
    const body = spliceBody(this.sessionBody(e), lo, hi, clean);
    const at = lo + clean.length;
    this.set({ editing: { ...e, text, body, start: at, end: at } });
  }

  /** Restores an editor state (its own undo / redo). */
  restoreEdit(text: string, body: TextBody | undefined, start: number, end: number): void {
    const e = this.state.editing;
    if (e) this.set({ editing: { ...e, text, body, start, end } });
  }

  /** The rich body of an editor session. */
  sessionBody(e: EditSession): TextBody {
    return e.body ?? bodyFromText(e.text, this.oldBody(e.shape, e.cell));
  }

  private oldBody(id: NodeId, cell?: { row: number; col: number }): TextBody {
    const shape = this.shape(id);
    if (cell) {
      const body = tableOf(shape)?.cells[cell.row]?.[cell.col]?.text;
      if (body) return body;
    }
    return (shape && textOf(shape)) ?? {
      props: { anchor: "middle", wrap: true, insets: { left: 91440, top: 45720, right: 91440, bottom: 45720 }, autofit: "none" },
      paragraphs: [{ runs: [] }],
    };
  }

  /** `SetTextBody` for the session's text, when it changed. */
  private textCommand(e: EditSession): ShowCommand | null {
    const same = (old: TextBody, body: TextBody) => (e.body ? JSON.stringify(old) === JSON.stringify(body) : editorText(old) === e.text);
    if (e.cell) {
      const old = this.oldBody(e.shape, e.cell);
      const body = cleanBody(this.sessionBody(e));
      if (same(old, body)) return null;
      return { type: "setTableCellText", shape: e.shape, row: e.cell.row, col: e.cell.col, body };
    }
    const old = this.oldBody(e.shape);
    const shape = this.shape(e.shape);
    let body = cleanBody(this.sessionBody(e));
    if (shape && textOf(shape) && same(old, body)) return null;
    // Shrink text on overflow: the scale for the new text goes with it (P8-28)
    const pres = this.state.pres;
    const slide = this.currentSlide();
    if (shape && pres && slide) {
      const props = autofitProps(pres, slide, shape, body);
      if (props) body = { ...body, props };
      // Resize shape to fit text: the box follows the text (a box that does not wrap also grows in width)
      if (body.props.autofit === "resize" && findShape(slide.shapes, e.shape)?.top.id === e.shape) {
        const fit = fitSize(pres, slide, shape, body);
        if (fit && (fit.h !== shape.transform.h || fit.w !== shape.transform.w)) {
          return { type: "compound", commands: [{ type: "setTextBody", shape: e.shape, body }, { type: "setTransform", shapes: [[shape.id, { ...shape.transform, ...fit }]] }] };
        }
      }
    }
    return { type: "setTextBody", shape: e.shape, body };
  }

  /**
   * A move / resize gesture's command plus the new shrink scale of resized
   * shapes whose text shrinks on overflow (one undo step).
   */
  withAutofit(command: ShowCommand | null): ShowCommand | null {
    const pres = this.state.pres;
    const slide = this.currentSlide();
    if (!command || command.type !== "setTransform" || !pres || !slide) return command;
    const extra: ShowCommand[] = [];
    for (const [id, t] of command.shapes) {
      const shape = slide.shapes.find((s) => s.id === id);
      const body = shape ? textOf(shape) : null;
      if (!shape || !body || (t.w === shape.transform.w && t.h === shape.transform.h)) continue;
      const props = autofitProps(pres, slide, shape, body, t);
      if (props) extra.push({ type: "setBodyProps", shapes: [id], props });
    }
    return extra.length ? { type: "compound", commands: [command, ...extra] } : command;
  }

  /** Commits the overlay editor (blur / Esc / Ctrl+Enter) and closes it. */
  async commitEdit(): Promise<void> {
    const e = this.state.editing;
    if (!e) return;
    this.set({ editing: null });
    await this.run(this.textCommand(e));
  }

  /** Shapes the text commands apply to: the edited one, else every selected shape that can hold text. */
  private textTargets(): Shape[] {
    const e = this.state.editing;
    if (e?.cell) return [];
    if (e) {
      const s = this.shape(e.shape);
      return s ? [s] : [];
    }
    return this.selectedShapes().filter((s) => s.kind.kind === "auto" && s.kind.value.geometry !== "line" && !!s.kind.value.text);
  }

  /** Run formatting from the toolbar: the editor's selection, else the whole text of the selected shapes. */
  async applyRunPatch(patch: RunProperties): Promise<void> {
    const e = this.state.editing;
    if (e?.cell) {
      // the edited text first, then the formatting of the whole cell
      const text = this.textCommand(e);
      const body = text?.type === "setTableCellText" ? text.body : this.oldBody(e.shape, e.cell);
      const formatted = { ...body, paragraphs: body.paragraphs.map((p) => ({ ...p, runs: p.runs.map((r) => ({ ...r, props: { ...(r.props ?? {}), ...patch } })) })) };
      await this.run({ type: "setTableCellText", shape: e.shape, row: e.cell.row, col: e.cell.col, body: formatted });
      return;
    }
    if (e) {
      const commands = [this.textCommand(e), ...runPropsRange(e.shape, e.text, e.start, e.end, patch)].filter(
        (c): c is ShowCommand => !!c,
      );
      await this.run(compound(commands));
      return;
    }
    await this.run(compound(this.textTargets().flatMap((s) => runPropsWhole(s.id, textOf(s)!, patch))));
  }

  /** Per target shape: its (new) body and the affected paragraph indices. */
  private paragraphTargets(): { shape: Shape; body: TextBody; paragraphs: number[]; pre: ShowCommand | null }[] {
    const e = this.state.editing;
    return this.textTargets().map((shape) => {
      if (e && shape.id === e.shape) {
        const body = cleanBody(this.sessionBody(e));
        return { shape, body, paragraphs: selectedParagraphs(body, e.text, e), pre: this.textCommand(e) };
      }
      const body = textOf(shape)!;
      return { shape, body, paragraphs: selectedParagraphs(body, null, null), pre: null };
    });
  }

  private effParagraphs(shape: Shape, body: TextBody, idx: number[]) {
    const slide = this.currentSlide();
    const def = slide && this.state.pres ? placeholderDef(this.state.pres, slide, shape) : undefined;
    return idx.map((i) => effectiveParagraph(def, body.paragraphs[i]?.props));
  }

  async setAlignment(a: Alignment): Promise<void> {
    const cmds = this.paragraphTargets().flatMap((t) => [t.pre, alignmentCommand(t.shape.id, t.paragraphs, a)]);
    await this.run(compound(cmds.filter((c): c is ShowCommand => !!c)));
  }

  async toggleBullet(kind: "bullet" | "decimal"): Promise<void> {
    const want: Bullet = kind === "bullet" ? { kind: "char", value: "•" } : { kind: "autoNum", value: "arabicPeriod" };
    const cmds = this.paragraphTargets().flatMap((t) => [
      t.pre,
      bulletCommand(t.shape.id, t.paragraphs, this.effParagraphs(t.shape, t.body, t.paragraphs).map((p) => p.bullet), want),
    ]);
    await this.run(compound(cmds.filter((c): c is ShowCommand => !!c)));
  }

  async setLineSpacing(multiple: number): Promise<void> {
    const cmds = this.paragraphTargets().flatMap((t) => [t.pre, lineSpacingCommand(t.shape.id, t.paragraphs, multiple)]);
    await this.run(compound(cmds.filter((c): c is ShowCommand => !!c)));
  }

  /** Grow (`1`) / shrink (`-1`) font: the next size step from `current` (hundredths of a point). */
  async stepFont(dir: 1 | -1, current: number): Promise<void> {
    await this.applyRunPatch({ size: stepFontSize(current, dir) });
  }

  async indent(delta: 1 | -1): Promise<void> {
    const cmds = this.paragraphTargets().flatMap((t) => [
      t.pre,
      ...indentCommands(t.shape.id, t.paragraphs, t.paragraphs.map((i) => t.body.paragraphs[i]?.props?.level ?? 0), delta),
    ]);
    await this.run(compound(cmds.filter((c): c is ShowCommand => !!c)));
  }


  // --- shapes library, connectors, tables (P8-16) --------------------------------------

  /** Arms (or with `null` disarms) drawing the gallery item `id` on the slide. */
  setDrawMode(id: string | null): void {
    if (id !== null && this.state.editing) void this.commitEdit();
    if (id !== this.state.drawMode) this.set({ drawMode: id });
  }

  private useShape(id: string): void {
    const recentShapes = pushRecent(this.state.recentShapes, id);
    saveRecent(recentShapes);
    this.set({ recentShapes, drawMode: null });
  }

  /**
   * Inserts gallery item `id` in `box` (slide EMU), or centred at its
   * default size (keyboard), and selects it; a text box opens the editor.
   * A text box from a click (`drag` false, also the keyboard) is a
   * one-line box growing with the text; a dragged one keeps the dragged
   * width and fits its height to the text (`spAutoFit`).
   */
  async insertChoice(id: string, box?: Transform, drag = false): Promise<void> {
    const choice = choiceOf(id);
    const { pres, current } = this.state;
    if (!choice || !pres || current === null) return;
    if (this.state.editing) await this.commitEdit();
    this.useShape(id);
    const def = clickBox(choice, 0, 0);
    let t = box ?? centredTransform(pres.slideSize, def.w, def.h);
    if (choice.kind === "textBox" && drag) t = { ...t, h: def.h };
    const shape = choiceShape(choice, t, this.temp(), choice.kind === "textBox" && !drag);
    this.set({ selection: [shape.id] });
    const res = await this.run({ type: "addShape", slide: current, shape });
    const real = res?.idMap.get(shape.id);
    if (choice.kind === "textBox" && real !== undefined) this.startEdit(real);
  }

  /** Inserts a connector drawn from `start` to `end` (glued where an end is on a site) and selects it. */
  async insertConnector(id: string, start: ConnEnd, end: ConnEnd): Promise<void> {
    const choice = choiceOf(id);
    const slide = this.state.current;
    if (!choice || choice.kind !== "connector" || slide === null) return;
    this.useShape(id);
    const temp = this.temp();
    this.set({ selection: [temp] });
    await this.run(drawConnectorCommand(slide, choice, start, end, temp));
  }

  /** A finished Freeform: Shape / Scribble drawing: inserted as a custom geometry and selected. */
  async insertFreeform(id: string, transform: Transform, path: GeomPath): Promise<void> {
    const slide = this.state.current;
    if (slide === null) return;
    this.useShape(id);
    const shape = freeformShape(transform, path, this.temp());
    this.set({ selection: [shape.id] });
    await this.run({ type: "addShape", slide, shape });
  }

  /** Edit Shape › Edit Points for the selected auto shape (`false` ends it). */
  setEditPoints(on: boolean): void {
    const one = this.selectedShapes();
    const s = on && one.length === 1 && one[0]!.kind.kind === "auto" ? one[0]! : null;
    if (on && this.state.editing) void this.commitEdit();
    this.set({ editPoints: s ? s.id : null });
  }

  /**
   * An Edit Points change: the shape gets the edited outline (box
   * commands) as its custom geometry, its box refitted to the points.
   */
  async applyEditPoints(shape: NodeId, cmds: PathCmd[], fill: boolean): Promise<void> {
    const s = this.shape(shape);
    if (!s || s.kind.kind !== "auto") return;
    const r = refit(s.transform, cmds, fill);
    await this.run({
      type: "compound",
      commands: [
        { type: "setGeometry", shapes: [shape], geometry: { custom: { paths: [r.path] } } },
        { type: "setTransform", shapes: [[shape, r.transform]] },
      ],
    });
  }

  /** Edit Shape › Change Shape: the selected auto shapes get `geometry`. */
  async changeShape(geometry: Preset): Promise<void> {
    const shapes = this.selectedShapes().filter((s) => s.kind.kind === "auto").map((s) => s.id);
    if (shapes.length) await this.run({ type: "setGeometry", shapes, geometry });
  }

  /** An adjust handle drag: the shape's adjust values. */
  async setAdjust(shape: NodeId, adjust: Record<string, number>): Promise<void> {
    await this.run({ type: "setGeometry", shapes: [shape], adjust });
  }

  /** Shape Styles gallery: theme fill / outline of the selected shapes. */
  async applyShapeStyle(choice: ShapeStyleChoice): Promise<void> {
    const shapes = this.state.selection;
    if (!shapes.length) return;
    const slot = `accent${choice.accent}` as ThemeColorSlot;
    const color = (tint: number): Color => ({ kind: "theme", value: { slot, tint } });
    const line = (tint: number): Line => ({ fill: { kind: "solid", value: color(tint) }, width: 12700, dash: "solid" });
    if (choice.kind === "fill") await this.run({ type: "setShapeStyle", shapes, fill: { kind: "solid", value: color(0) }, line: line(-0.25) });
    else if (choice.kind === "light") await this.run({ type: "setShapeStyle", shapes, fill: { kind: "solid", value: color(0.8) }, line: line(0) });
    else await this.run({ type: "setShapeStyle", shapes, fill: null, line: { ...line(0), width: 19050 } });
  }

  /** Arrange › Rotate: by `deg` (±90) or flip horizontally / vertically. */
  async rotateOrFlip(op: "right" | "left" | "flipH" | "flipV"): Promise<void> {
    const sel = this.selectedShapes();
    if (!sel.length) return;
    const shapes: [NodeId, Transform][] = sel.map((s) => {
      const t = s.transform;
      if (op === "flipH") return [s.id, { ...t, flipH: !t.flipH }];
      if (op === "flipV") return [s.id, { ...t, flipV: !t.flipV }];
      const r = (((t.rotationDeg ?? 0) + (op === "right" ? 90 : -90)) % 360 + 360) % 360;
      return [s.id, { ...t, rotationDeg: r }];
    });
    await this.run({ type: "setTransform", shapes });
  }

  /** The selected connectors. */
  selectedConnectors(): Shape[] {
    return this.selectedShapes().filter((s) => s.kind.kind === "connector");
  }

  /** Dragging an end of a connector to `to` (glued when on a site). */
  async moveConnectorEnd(shape: NodeId, which: "start" | "end", to: ConnEnd): Promise<void> {
    const s = this.shape(shape);
    if (s) await this.run(compound(moveEndCommands(s, which, to)));
  }

  /** The elbow handle: where the middle segment of a two-turn connector runs. */
  async setConnectorAdjust(shape: NodeId, adjust: Record<string, number>): Promise<void> {
    await this.run({ type: "setConnector", shape, patch: { adjust } });
  }

  /** Shape Outline › Arrows preset for the selected connectors. */
  async setArrows(head: ArrowKind, tail: ArrowKind): Promise<void> {
    await this.run(compound(this.selectedConnectors().map((s) => arrowCommand(s, head, tail)).filter((c): c is ShowCommand => !!c)));
  }

  /** Shape Outline › Arrows › size of the selected connectors' arrowheads. */
  async setArrowSize(size: ArrowSize): Promise<void> {
    await this.run(compound(this.selectedConnectors().map((s) => arrowSizeCommand(s, size)).filter((c): c is ShowCommand => !!c)));
  }

  /** Connector type of the selected connectors. */
  async setConnectorKind(kind: ConnectorKind): Promise<void> {
    await this.run(compound(this.selectedConnectors().map((s) => connectorKindCommand(s, kind)).filter((c): c is ShowCommand => !!c)));
  }

  /** Reroute Connectors: glued ends move to the nearest sites (`sitesOf` gives a shape's sites on the slide). */
  async rerouteConnectors(sitesOf: (id: NodeId) => SlideSite[]): Promise<void> {
    await this.run(compound(this.selectedConnectors().map((s) => rerouteCommand(s, sitesOf)).filter((c): c is ShowCommand => !!c)));
  }

  // ----- tables

  /** Insert › Table: a `rows` × `cols` table centred on the slide, selected. */
  async insertTable(rows: number, cols: number): Promise<void> {
    const slide = this.state.current;
    if (slide === null || rows < 1 || cols < 1) return;
    if (this.state.editing) await this.commitEdit();
    const temp = this.temp();
    this.set({ selection: [temp], drawMode: null });
    await this.run(insertTableCommand(slide, rows, cols, temp));
  }

  /** The selected table (a single selected table shape). */
  selectedTable(): { shape: Shape; table: Table } | null {
    const sel = this.selectedShapes();
    const one = sel.length === 1 ? sel[0]! : null;
    const table = tableOf(one);
    return one && table ? { shape: one, table } : null;
  }

  /** The cells the table commands work on: the cell selection, else the edited cell, else the whole table. */
  cellRange(): CellRange | null {
    const t = this.selectedTable();
    if (!t) return null;
    const cs = this.state.cellSel;
    if (cs && cs.shape === t.shape.id) return cs.range;
    const e = this.state.editing;
    if (e?.cell && e.shape === t.shape.id) {
      const cell = t.table.cells[e.cell.row]?.[e.cell.col];
      return { r0: e.cell.row, c0: e.cell.col, r1: e.cell.row + (cell?.rowSpan ?? 1) - 1, c1: e.cell.col + (cell?.colSpan ?? 1) - 1 };
    }
    return { r0: 0, c0: 0, r1: t.table.rows.length - 1, c1: t.table.cols.length - 1 };
  }

  /** Selects cells of a table (drag across cells); ends cell editing. */
  selectCells(shape: NodeId, range: CellRange | null): void {
    if (this.state.editing) void this.commitEdit();
    if (!this.state.selection.includes(shape) || this.state.selection.length !== 1) this.select([shape]);
    this.set({ cellSel: range ? { shape, range } : null });
  }

  /**
   * Starts editing cell `row`, `col` (its anchor) of table `shape`, the caret at the end of its text;
   * `caret` "all" selects the text (Tab / Shift+Tab, as PowerPoint), "start" puts the caret before it.
   */
  startCellEdit(shape: NodeId, row: number, col: number, caret: "end" | "start" | "all" = "end"): void {
    const table = tableOf(this.shape(shape));
    if (!table) return;
    const [r, c] = anchorOf(table, row, col);
    const body = table.cells[r]?.[c]?.text;
    const text = body ? editorText(body) : "";
    this.set({
      editing: { shape, cell: { row: r, col: c }, text, start: caret === "end" ? text.length : 0, end: caret === "start" ? 0 : text.length },
      selection: [shape],
      cellSel: { shape, range: { r0: r, c0: c, r1: r, c1: c } },
    });
  }

  /** Moves the cell editor (Tab, Shift+Tab, arrows at the text's edges); Tab in the last cell adds a row. */
  async moveCellEdit(move: CellMove): Promise<void> {
    const e = this.state.editing;
    if (!e?.cell) return;
    const table = tableOf(this.shape(e.shape));
    if (!table) return;
    const to = moveCell(table, e.cell.row, e.cell.col, move);
    if (to === null) return;
    const shape = e.shape;
    await this.commitEdit();
    if (to === "insertRow") {
      const rows = table.rows.length;
      await this.run({ type: "insertTableRow", shape, index: rows });
      this.startCellEdit(shape, rows, 0);
      return;
    }
    // Tab selects the next cell's text; ← enters at its end, → at its start
    this.startCellEdit(shape, to[0], to[1], move === "next" || move === "prev" ? "all" : move === "right" ? "start" : "end");
  }

  private async tableRun(build: (shape: NodeId, table: Table, range: CellRange) => ShowCommand | null): Promise<void> {
    const t = this.selectedTable();
    const range = this.cellRange();
    if (!t || !range) return;
    if (this.state.editing) await this.commitEdit();
    await this.run(build(t.shape.id, t.table, range));
  }

  insertRows(below: boolean): Promise<void> {
    return this.tableRun((s, t, r) => insertRowsCommand(s, t, r, below));
  }

  insertCols(right: boolean): Promise<void> {
    return this.tableRun((s, t, r) => insertColsCommand(s, t, r, right));
  }

  deleteRows(): Promise<void> {
    return this.tableRun((s, t, r) => deleteRowsCommand(s, t, r));
  }

  deleteCols(): Promise<void> {
    return this.tableRun((s, t, r) => deleteColsCommand(s, t, r));
  }

  async deleteTable(): Promise<void> {
    const t = this.selectedTable();
    if (t) {
      if (this.state.editing) this.set({ editing: null });
      await this.run({ type: "deleteShapes", ids: [t.shape.id] });
    }
  }

  async mergeCells(): Promise<void> {
    await this.tableRun((s, t, r) => mergeCommand(s, t, r));
    const t = this.selectedTable();
    const cs = this.state.cellSel;
    if (t && cs) this.set({ cellSel: { shape: cs.shape, range: expandRange(t.table, cs.range) } });
  }

  splitCell(): Promise<void> {
    return this.tableRun((s, t, r) => splitCommand(s, t, r.r0, r.c0));
  }

  /** Split Cells… OK: the cell (its merged region) into `rows` × `cols`. */
  splitCellGrid(rows: number, cols: number): Promise<void> {
    return this.tableRun((s, t, r) => splitGridCommand(s, t, r.r0, r.c0, rows, cols));
  }

  setCellShading(color: Color | null): Promise<void> {
    return this.tableRun((s, _t, r) => shadingCommand(s, r, color ? { kind: "solid", value: color } : null));
  }

  /** Table Design › Borders: `kind` with the pen (Draw Borders) on the cell range. */
  setCellBorders(kind: BorderKind, pen: Pen = this.state.pen): Promise<void> {
    return this.tableRun((s, _t, r) => bordersCommand(s, r, kind, penLine(pen)));
  }

  /** Draw Borders › Pen Style / Weight / Color. */
  setPen(pen: Partial<Pen>): void {
    this.set({ pen: { ...this.state.pen, ...pen } });
  }

  /** Layout › Text Direction of the cell range. */
  setCellVert(vert: TextDirection): Promise<void> {
    return this.tableRun((s, _t, r) => vertCommand(s, r, vert));
  }

  /** Any cell properties of the range (Format Shape pane, Cell Text Layout). */
  setCellProps(patch: TableCellPatch): Promise<void> {
    return this.tableRun((s, _t, r) => cellPropsCommand(s, r, patch));
  }

  setCellAnchor(anchor: Anchor): Promise<void> {
    return this.tableRun((s, _t, r) => anchorCommand(s, r, anchor));
  }

  setCellAlignment(alignment: Align): Promise<void> {
    return this.tableRun((s, t, r) => cellAlignCommand(s, t, r, alignment));
  }

  setCellMargins(margins: Insets): Promise<void> {
    return this.tableRun((s, _t, r) => marginsCommand(s, r, margins));
  }

  distributeTable(axis: "rows" | "cols"): Promise<void> {
    return this.tableRun((s, t, r) => distributeCommand(s, t, r, axis));
  }

  async setTableStyle(styleId: string | null): Promise<void> {
    this.previewTableStyle(null);
    const t = this.selectedTable();
    if (t) await this.run(styleCommand(t.shape.id, t.table, styleId));
  }

  /** Live preview of a table style on the selected table (`null` ends it). */
  previewTableStyle(styleId: string | null): void {
    if (styleId !== this.state.tablePreview) this.set({ tablePreview: styleId });
  }

  /** Table Design › Clear Table: no style, no cell fills or borders. */
  async clearTable(): Promise<void> {
    const t = this.selectedTable();
    if (t) await this.run(clearTableCommand(t.shape.id, t.table));
  }

  async setTableLook(key: keyof TableLook, on: boolean): Promise<void> {
    const t = this.selectedTable();
    if (t) await this.run(lookCommand(t.shape.id, t.table, key, on));
  }

  /** Dragging a column border (`axis` cols) or a row border by `delta` EMU. */
  async resizeTrack(shape: NodeId, axis: "rows" | "cols", index: number, delta: number): Promise<void> {
    const table = tableOf(this.shape(shape));
    if (!table) return;
    await this.run(axis === "cols" ? resizeColCommand(shape, table, index, delta) : resizeRowCommand(shape, table, index, delta));
  }

  // --- design: themes, backgrounds, layouts, master view, header & footer, sections, pictures (P8-22) ---------

  /** Loads the built-in themes once (Design tab). */
  async loadThemes(): Promise<void> {
    if (this.state.themes) return;
    try {
      const themes = await this.enqueue(() => this.api.getThemes());
      this.set({ themes });
    } catch {
      // an older core without built-in themes: the gallery stays empty
      this.set({ themes: [] });
    }
  }

  /** Design › Themes: applies built-in theme `id`. */
  async applyTheme(id: string): Promise<void> {
    if (this.state.editing) await this.commitEdit();
    await this.run({ type: "applyTheme", theme: { kind: "builtin", value: id } });
  }

  /** Variants / Colors ▾: replaces the theme's colours. */
  async setThemeColors(colors: ColorScheme): Promise<void> {
    await this.run({ type: "setThemeColors", colors });
  }

  /** Fonts ▾: replaces the theme's fonts. */
  async setThemeFonts(fonts: FontScheme): Promise<void> {
    await this.run({ type: "setThemeFonts", fonts });
  }

  /**
   * Design › Slide Size: with content on the slides PowerPoint asks
   * whether to Maximize it or Ensure Fit (the prompt dialog); an empty
   * presentation changes at once.
   */
  async setSlideSize(size: SlideSize): Promise<void> {
    const pres = this.state.pres;
    const cur = pres?.slideSize;
    if (cur && cur.width === size.width && cur.height === size.height) return;
    if (pres?.slides.some((s) => s.shapes.length > 0)) {
      this.openDialog({ kind: "slideScale", size });
      return;
    }
    await this.run({ type: "setSlideSize", size });
  }

  /** The slide-size prompt's answer: scale the content by the smaller (Ensure Fit) or larger (Maximize) ratio. */
  async applySlideSize(size: SlideSize, scale: SlideScale): Promise<void> {
    this.closeDialog();
    await this.run({ type: "setSlideSize", size, scale });
  }

  toggleBgPane(open = !this.state.bgPane): void {
    this.set({ bgPane: open });
  }

  /** What Format Background changes: the master view's target, else the current slide. */
  backgroundTarget(): BackgroundTarget | null {
    const mv = this.state.masterView;
    if (mv) return mv.kind === "master" ? { kind: "master" } : { kind: "layout", value: mv.value };
    return this.state.current === null ? null : { kind: "slides", value: [this.state.current] };
  }

  /** Format Background: sets (or with `null` resets) the background of the target; `hide` = Hide background graphics. */
  async setBackgroundOf(target: BackgroundTarget | null, fill: Background | null, hide?: boolean): Promise<void> {
    if (!target) return;
    const c: ShowCommand = { type: "setBackground", target, fill };
    if (hide !== undefined && target.kind !== "master") c.hideMasterShapes = hide;
    await this.run(c);
  }

  /**
   * A gradient (theme background style) in the normal view: slides only
   * take explicit fills, so it goes to the master and the current slide's
   * own fill is removed (one undo step).
   */
  async setMasterBackgroundStyle(bg: Background): Promise<void> {
    const cur = this.state.current;
    const commands: ShowCommand[] = [{ type: "setBackground", target: { kind: "master" }, fill: bg }];
    if (cur !== null && this.currentSlide()?.background) commands.push({ type: "setBackground", target: { kind: "slides", value: [cur] }, fill: null });
    await this.run(compound(commands));
  }

  /**
   * Format Background › Picture or texture fill › Insert: the file becomes
   * the target's background (stretched or tiled, with transparency); the
   * core adds it to the media store (one undo step).
   */
  async setBackgroundPictureFile(target: BackgroundTarget | null, file: File, opts: { tile: boolean; transparency: number }, hide?: boolean): Promise<void> {
    if (!target) return;
    const type = file.type || "image/png";
    if (!type.startsWith("image/")) {
      this.set({ info: t("show.bg.notPicture") });
      return;
    }
    const bytesBase64 = bytesToBase64(new Uint8Array(await file.arrayBuffer()));
    const cmd: ShowCommand = { type: "setBackgroundPicture", target, contentType: type, bytesBase64, tile: opts.tile, transparency: opts.transparency };
    // the slide's "hide background graphics" stays as it was
    void hide;
    await this.run(cmd);
  }

  /** Format Background › Apply to All: every slide gets the current slide's fill and background graphics setting. */
  async applyBackgroundToAll(): Promise<void> {
    const pres = this.state.pres;
    const slide = this.currentSlide();
    if (!pres || !slide || this.state.masterView) return;
    await this.run({
      type: "setBackground",
      target: { kind: "slides", value: pres.slides.map((s) => s.id) },
      fill: slide.background ?? null,
      hideMasterShapes: slide.showMasterShapes === false,
    });
  }

  /** Home › Reset: the current slide's placeholders back to the layout. */
  async resetSlide(): Promise<void> {
    const cur = this.state.current;
    if (cur === null) return;
    if (this.state.editing) await this.commitEdit();
    await this.run({ type: "resetSlide", slides: [cur] });
  }

  // ----- master view

  /** View › Slide Master: shows the master (or the current slide's layout). */
  openMasterView(): void {
    if (this.state.editing) void this.commitEdit();
    const pres = this.state.pres;
    if (!pres) return;
    const layout = this.currentSlide()?.layout;
    const target: DesignTarget = layout && pres.layouts.some((l) => l.kind === layout) ? { kind: "layout", value: layout } : { kind: "master" };
    this.set({ masterView: target, selection: [], editing: null, animSelection: null, preview: null, crop: null, cellSel: null, ribbonTab: "slideMaster", drawMode: null });
  }

  closeMasterView(): void {
    if (!this.state.masterView) return;
    if (this.state.editing) void this.commitEdit();
    this.set({ masterView: null, selection: [], editing: null, ribbonTab: "home" });
  }

  /** Selects the master or a layout in the master view's panel. */
  selectDesignTarget(target: DesignTarget): void {
    if (this.state.editing) void this.commitEdit();
    this.set({ masterView: target, selection: [], editing: null, masterLevel: null });
  }

  /** The master's body placeholder is the (only) selected pseudo shape. */
  masterBodySelected(): boolean {
    const mv = this.state.masterView;
    const pres = this.state.pres;
    if (mv?.kind !== "master" || !pres || this.state.selection.length !== 1) return false;
    return placeholderOfShape(pres, mv, this.state.selection[0]!)?.kind === "body";
  }

  /** Slide Master › Text level: which outline level formatting changes (`null` = all, each paragraph its own). */
  setMasterLevel(level: number | null): void {
    this.set({ masterLevel: level === null ? null : Math.max(0, Math.min(8, level)), info: level === null ? null : t("show.master.levelInfo", { n: Math.max(0, Math.min(8, level)) + 1 }) });
  }

  /** Tab / Shift+Tab on the selected master body placeholder: the next / previous text level. */
  stepMasterLevel(delta: 1 | -1): boolean {
    if (!this.masterBodySelected()) return false;
    const cur = this.state.masterLevel;
    const next = cur === null ? (delta > 0 ? 0 : 8) : cur + delta;
    this.setMasterLevel(next < 0 || next > 8 ? null : next);
    return true;
  }

  /** Slide Master › Rename: the selected layout's name (the dialog). */
  async renameLayout(kind: LayoutKind, name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) return;
    const mv = this.state.masterView;
    const shown = mv?.kind === "layout" && mv.value === kind;
    const res = await this.run({ type: "renameLayout", layout: kind, name: trimmed });
    // a custom layout's kind follows its name
    if (res && kind.startsWith("custom:") && shown) this.selectDesignTarget({ kind: "layout", value: `custom:${trimmed}` });
  }

  /**
   * Slide Master › Insert Placeholder: a placeholder of `kind` in the
   * selected layout (the master: only kinds it lacks), centred at half
   * the slide's size (date / footer / number at the master's position),
   * then selected.
   */
  async insertPlaceholder(kind: PlaceholderKind): Promise<void> {
    const pres = this.state.pres;
    const mv = this.state.masterView;
    if (!pres || !mv) return;
    const size = pres.slideSize;
    const fromMaster = pres.master?.placeholders.find((d) => d.kind === (kind === "centeredTitle" ? "title" : kind));
    const hf = kind === "dateTime" || kind === "footer" || kind === "slideNumber" || kind === "title";
    const transform = hf && fromMaster
      ? fromMaster.transform
      : { x: Math.round(size.width / 4), y: Math.round(size.height / 4), w: Math.round(size.width / 2), h: Math.round(size.height / 2), rotationDeg: 0 };
    const before = targetPlaceholders(pres, mv).length;
    const res = await this.run({ type: "addPlaceholder", target: mv, kind, transform });
    if (res && this.state.pres) {
      const after = targetPlaceholders(this.state.pres, mv);
      if (after.length > before) this.set({ selection: [DESIGN_SHAPE_BASE + after.length - 1] });
    }
  }

  /** Slide Master › Title / Footers check boxes of a layout: add or remove those placeholders. */
  async setLayoutPlaceholders(which: "title" | "footers", on: boolean): Promise<void> {
    const pres = this.state.pres;
    const mv = this.state.masterView;
    if (!pres || mv?.kind !== "layout") return;
    const defs = targetPlaceholders(pres, mv);
    const kinds: PlaceholderKind[] = which === "title" ? ["title"] : ["dateTime", "footer", "slideNumber"];
    const commands: ShowCommand[] = [];
    for (const k of kinds) {
      const has = defs.filter((d) => d.kind === k || (k === "title" && d.kind === "centeredTitle"));
      if (on && !has.length) {
        const m = pres.master?.placeholders.find((d) => d.kind === k);
        if (m) commands.push({ type: "addPlaceholder", target: mv, kind: k, transform: m.transform });
      } else if (!on) {
        for (const d of has) commands.push({ type: "removePlaceholder", target: mv, placeholder: d.kind, ...(d.idx ? { idx: d.idx } : {}) });
      }
    }
    await this.run(compound(commands));
  }

  /** Insert Layout: a custom layout (title and footers) after the last one, selected. */
  async addLayout(): Promise<void> {
    const pres = this.state.pres;
    if (!pres) return;
    const names = new Set(pres.layouts.map((l) => l.name || l.kind.replace(/^custom:/, "")));
    let n = 1;
    let name = t("show.master.customLayout");
    while (names.has(name)) name = `${n++}_${t("show.master.customLayout")}`;
    const res = await this.run({ type: "addLayout", name });
    const added = res?.env.patch.layouts?.find((l) => !pres.layouts.some((o) => o.kind === l.kind));
    if (added && this.state.masterView) this.selectDesignTarget({ kind: "layout", value: added.kind });
  }

  /** Duplicate Layout: copies the selected layout and selects the copy. */
  async duplicateLayout(): Promise<void> {
    const pres = this.state.pres;
    const mv = this.state.masterView;
    if (!pres || mv?.kind !== "layout") return;
    const res = await this.run({ type: "duplicateLayout", layout: mv.value });
    const added = res?.env.patch.layouts?.find((l) => !pres.layouts.some((o) => o.kind === l.kind));
    if (added) this.selectDesignTarget({ kind: "layout", value: added.kind });
  }

  /** Whether layout `kind` is used by a slide (the core refuses to delete those). */
  layoutInUse(kind: string): boolean {
    return !!this.state.pres?.slides.some((s) => s.layout === kind);
  }

  /** Delete Layout (unused layouts only); the master becomes selected. */
  async deleteLayout(): Promise<void> {
    const mv = this.state.masterView;
    if (mv?.kind !== "layout" || this.layoutInUse(mv.value)) return;
    const res = await this.run({ type: "deleteLayout", layout: mv.value });
    if (res) this.selectDesignTarget({ kind: "master" });
  }

  // ----- header & footer, fields

  /** Insert › Header & Footer › Apply (current slide) / Apply to All. */
  async setHeaderFooter(values: HfValues, all: boolean): Promise<void> {
    const cur = this.state.current;
    if (!all && cur === null) return;
    if (this.state.editing) await this.commitEdit();
    await this.run(hfCommand(values, all ? { kind: "all" } : { kind: "slides", value: [cur!] }));
  }

  /**
   * Insert › Slide Number / Date & Time: a field run at the editor's caret
   * (the edited text is committed with it); without an editor the dialog
   * of Header & Footer opens, like PowerPoint.
   */
  async insertField(field: TextField): Promise<void> {
    const e = this.state.editing;
    if (!e || e.cell) {
      this.openDialog({ kind: "headerFooter" });
      return;
    }
    const pos = textPosOf(e.text, e.start);
    const base = cleanBody(this.sessionBody(e));
    const pres = this.state.pres;
    const n = pres ? pres.slides.findIndex((s) => s.id === this.state.current) + 1 : 0;
    const text = fieldText(field, n || null, "");
    const body = insertField(base, pos.paragraph, pos.offset, field, text);
    const shape = e.shape;
    this.set({ editing: null });
    const res = await this.run({ type: "setTextBody", shape, body });
    if (!res) return;
    // back into the editor, caret after the field
    const after = e.start + text.length;
    const sh = this.shape(shape);
    const full = sh && textOf(sh) ? editorText(textOf(sh)!) : "";
    this.set({ editing: { shape, text: full, start: Math.min(after, full.length), end: Math.min(after, full.length) } });
  }

  // ----- sections

  /** Add Section at the current slide (PowerPoint then asks for the name: the rename dialog opens). */
  async addSection(): Promise<void> {
    const cur = this.state.current;
    const res = await this.run(cur === null ? { type: "addSection", name: t("show.section.untitled") } : { type: "addSection", name: t("show.section.untitled"), firstSlide: cur });
    const secs = res?.env.patch.sections;
    if (!secs) return;
    const index = cur === null ? secs.length - 1 : secs.findIndex((s) => s.slideIds[0] === cur);
    if (index >= 0) this.openDialog({ kind: "renameSection", index });
  }

  async renameSection(index: number, name: string): Promise<void> {
    const old = this.state.pres?.sections?.[index]?.name;
    if (old === undefined || old === name || !name.trim()) return;
    await this.run({ type: "renameSection", index, name: name.trim() });
  }

  /** Remove Section (`keepSlides` false: Remove Section & Slides). */
  async removeSection(index: number, keepSlides = true): Promise<void> {
    await this.run({ type: "removeSection", index, keepSlides });
  }

  async removeAllSections(): Promise<void> {
    if (this.state.pres?.sections?.length) await this.run(removeAllSectionsCommand());
  }

  async moveSection(index: number, delta: -1 | 1): Promise<void> {
    const n = this.state.pres?.sections?.length ?? 0;
    const to = index + delta;
    if (index < 0 || index >= n || to < 0 || to >= n) return;
    await this.run({ type: "moveSection", index, toIndex: to });
  }

  /** Drags a slide into section `section` at position `at` among its slides. */
  async moveSlideToSection(id: NodeId, section: number, at: number): Promise<void> {
    const pres = this.state.pres;
    if (pres) await this.run(moveToSectionCommand(pres, id, section, at));
  }

  // ----- pictures

  /** The selected pictures. */
  selectedPictures(): Shape[] {
    return this.selectedShapes().filter((s) => s.kind.kind === "picture");
  }

  /** Corrections, Color, Shadow, outline shape of the selected pictures. */
  async setPictureProps(patch: PicturePatch): Promise<void> {
    const shapes = this.selectedPictures().map((s) => s.id);
    if (shapes.length) await this.run({ type: "setPictureProps", shapes, patch });
  }

  /** Picture Styles: outline shape, shadow and border (one undo step). */
  async applyPictureStyle(style: PictureStyle): Promise<void> {
    const shapes = this.selectedPictures().map((s) => s.id);
    if (!shapes.length) return;
    await this.run(compound([
      { type: "setPictureProps", shapes, patch: stylePatch(style) },
      { type: "setShapeStyle", shapes, line: style.line.fill.kind === "none" ? null : style.line },
    ]));
  }

  /** Picture Border: colour (`null` = none), keeping or setting width / dash. */
  async setPictureBorder(line: Line | null): Promise<void> {
    const shapes = this.selectedPictures().map((s) => s.id);
    if (shapes.length) await this.run({ type: "setShapeStyle", shapes, line });
  }

  /** Reset Picture (`size`: & Size). */
  async resetPicture(size: boolean): Promise<void> {
    const shapes = this.selectedPictures().map((s) => s.id);
    if (shapes.length) await this.run({ type: "resetPicture", shapes, size });
  }

  /** Crop: enters crop mode for the one selected picture. */
  startCrop(): void {
    const pics = this.selectedPictures();
    if (pics.length !== 1 || this.state.selection.length !== 1) return;
    const p = pics[0]!;
    const props = p.kind.kind === "picture" ? p.kind.value.props : undefined;
    this.set({ crop: { shape: p.id, crop: { ...NO_CROP, ...(props?.crop ?? {}) }, box: p.transform } });
  }

  /** A crop handle drag (live, not sent yet). */
  updateCrop(crop: Crop, box: Transform): void {
    const c = this.state.crop;
    if (c) this.set({ crop: { ...c, crop, box } });
  }

  /** Enter / a click outside: sends the crop (`CropPicture` with the box). */
  async commitCrop(): Promise<void> {
    const c = this.state.crop;
    if (!c) return;
    this.set({ crop: null });
    const shape = this.shape(c.shape);
    const old = shape?.kind.kind === "picture" ? { ...NO_CROP, ...(shape.kind.value.props?.crop ?? {}) } : NO_CROP;
    if (JSON.stringify(old) === JSON.stringify(c.crop) && shape && JSON.stringify(shape.transform) === JSON.stringify(c.box)) return;
    await this.run({ type: "cropPicture", shape: c.shape, crop: c.crop, transform: c.box });
  }

  /** Esc: leaves crop mode without changes. */
  cancelCrop(): void {
    if (this.state.crop) this.set({ crop: null });
  }

  // ----- charts (P8-24)

  /** The one selected chart shape and its chart. */
  selectedChart(): { shape: Shape; chart: ChartShape } | null {
    const sel = this.selectedShapes();
    const s = sel.length === 1 ? sel[0]! : null;
    return s && s.kind.kind === "chart" ? { shape: s, chart: s.kind.value } : null;
  }

  /** Insert › Chart: a chart of preset `id` on PowerPoint's sample data, selected, with Chart Design shown. */
  async insertChart(id: string): Promise<void> {
    const preset = presetById(id);
    const slide = this.state.current;
    if (!preset || slide === null || this.state.masterView) return;
    if (this.state.editing) await this.commitEdit();
    const newId = this.temp();
    const kind = preset.combo ? ({ type: "bar", direction: "column", grouping: "clustered" } as const) : preset.kind;
    const res = await this.run({ type: "insertChart", slide, kind, newId });
    const real = res?.idMap.get(newId);
    if (real === undefined) return;
    this.set({ selection: [real], ribbonTab: "chartDesign" });
    if (preset.combo) {
      const c = this.selectedChart();
      if (c) await this.run({ type: "updateChart", shape: real, chart: applyPreset(c.chart.chart as Chart, preset) });
    }
  }

  /** Chart Design / Format edits of the selected chart (one `UpdateChart`). */
  async updateChart(fn: (c: Chart) => Chart): Promise<void> {
    const c = this.selectedChart();
    if (!c || c.chart.chart.kind.type === "unsupported") return;
    const next = fn(c.chart.chart as Chart);
    if (JSON.stringify(next) === JSON.stringify(c.chart.chart)) return;
    await this.run({ type: "updateChart", shape: c.shape.id, chart: next });
  }

  /** Edit Data: the selected chart's table. */
  async setChartData(data: ChartData): Promise<void> {
    const c = this.selectedChart();
    if (c) await this.run({ type: "setChartData", shape: c.shape.id, data });
  }

  /** Switch Row/Column: the table transposed. */
  async switchRowCol(): Promise<void> {
    const c = this.selectedChart();
    if (c) await this.setChartData(transposeData(c.chart.data));
  }

  toggleChartPane(open = !this.state.chartPane): void {
    this.set({ chartPane: open });
  }

  /** The series the chart Format tab and pane edit. */
  selectChartSeries(i: number): void {
    this.set({ chartSeries: Math.max(0, Math.floor(i)) });
  }

  // ----- hyperlinks and actions (P8-24)

  /** The link Insert › Link starts from: the run at the editor's caret, else the selected shape's click action. */
  currentLink(): Hyperlink | null {
    const e = this.state.editing ?? this.linkEdit;
    if (e && !e.cell) {
      const s = this.shape(e.shape);
      return s ? linkAt(s, e.text, e.start) : null;
    }
    const sel = this.selectedShapes();
    return sel.length === 1 ? (sel[0]!.clickAction ?? null) : null;
  }

  /**
   * Insert › Link (Ctrl+K): on the editor's selection (the word at the
   * caret when nothing is selected), else as the click action of the
   * selected shapes; `null` removes it.
   */
  async setLink(link: Hyperlink | null): Promise<void> {
    const e = this.state.editing ?? this.linkEdit;
    this.linkEdit = null;
    if (e && !e.cell) {
      const text = this.state.editing ? this.textCommand(e) : null;
      const links = linkCommands(e.shape, e.text, e.start, e.end, link);
      if (links.length) {
        await this.run(compound([text, ...links].filter((c): c is ShowCommand => !!c)));
        return;
      }
    }
    await this.setAction(link);
  }

  /** Insert › Action: the mouse-click action of the selected shapes (`null` = none). */
  async setAction(action: Hyperlink | null): Promise<void> {
    if (this.state.editing) await this.commitEdit();
    const shapes = this.state.selection;
    if (shapes.length) await this.run({ type: "setClickAction", shapes, action });
  }

  // ----- audio and video (P8-24)

  /** The selected audio/video shapes. */
  selectedMedia(): Shape[] {
    return this.selectedShapes().filter((s) => s.kind.kind === "media");
  }

  /** Insert › Video / Audio: the clip (centred by the core), selected, with Playback shown. */
  async insertMedia(contentType: string, bytesBase64: string): Promise<void> {
    const slide = this.state.current;
    if (slide === null || this.state.masterView) return;
    if (this.state.editing) await this.commitEdit();
    const newId = this.temp();
    const res = await this.run({ type: "insertMedia", slide, contentType, bytesBase64, newId });
    const real = res?.idMap.get(newId);
    if (real !== undefined) this.set({ selection: [real], ribbonTab: "playback" });
  }

  /** Playback settings of the selected clips. */
  async setMediaProps(patch: MediaPatch): Promise<void> {
    const shapes = this.selectedMedia().map((s) => s.id);
    if (shapes.length) await this.run({ type: "setMediaProps", shapes, patch });
  }

  /** Poster Frame › Image from File (`null`: Reset) of the one selected clip. */
  async setMediaPoster(image: { contentType: string; bytesBase64: string } | null): Promise<void> {
    const m = this.selectedMedia();
    if (m.length !== 1) return;
    await this.run(image ? { type: "setMediaPoster", shape: m[0]!.id, contentType: image.contentType, bytesBase64: image.bytesBase64 } : { type: "setMediaPoster", shape: m[0]!.id });
  }

  // ----- Reuse Slides (P8-24)

  toggleReusePane(open = !this.state.reusePane): void {
    this.set({ reusePane: open });
  }

  /** Reads a `.pptx` for the Reuse Slides pane (the presentation stays as it is). */
  async peekReuse(file: { name: string; bytesBase64: string }): Promise<void> {
    try {
      const body = await this.enqueue(() => this.api.peekPresentation(file.bytesBase64));
      this.set({ reuse: { name: file.name, pres: body.presentation, warnings: body.warnings }, reusePane: true });
    } catch (e) {
      this.pushError(e);
    }
  }

  /** Inserts slides `ids` of the pane's presentation after the current slide (one undo step) and selects the last one. */
  async reuseSlides(ids: NodeId[], keepSourceFormatting: boolean): Promise<void> {
    const src = this.state.reuse?.pres;
    if (!src || !ids.length || this.state.masterView) return;
    if (this.state.editing) await this.commitEdit();
    const { slides, layouts, media } = reusePayload(src, ids);
    const before = new Set(this.state.pres?.slides.map((s) => s.id) ?? []);
    const res = await this.run({ type: "insertSlides", after: this.state.current ?? undefined, slides, layouts, media, keepSourceFormatting });
    const added = res?.env.patch.slidesOrder?.filter((id) => !before.has(id)) ?? [];
    const last = added[added.length - 1];
    if (last !== undefined) this.selectSlide(last);
  }

  // --- views, guides, selection pane, text options, show setup (P8-28) ------------------

  /** View › Presentation Views: switches the view (Normal, Outline, Slide Sorter, Notes Page, Reading). */
  setView(view: PresentationView): void {
    if (this.state.editing) void this.commitEdit();
    if (this.state.masterView) this.closeMasterView();
    const cur = this.state.current;
    this.set({ view, slideSel: cur === null ? [] : this.state.slideSel.includes(cur) ? this.state.slideSel : [cur], crop: null, drawMode: null });
  }

  /** The presentation's view settings (defaults when it has none). */
  viewProps(): ViewProps {
    return this.state.pres?.view ?? DEFAULT_VIEW;
  }

  /** Changes view settings (`SetViewProps`; undoable like PowerPoint's guide moves). */
  async updateView(patch: Partial<ViewProps>): Promise<void> {
    const view = { ...this.viewProps(), ...patch };
    if (JSON.stringify(view) === JSON.stringify(this.viewProps())) return;
    await this.run({ type: "setViewProps", view });
  }

  /** View › Guides (Alt+F9): shows / hides the drawing guides; the two centre guides appear when there are none. */
  async toggleGuides(on = !this.viewProps().showGuides): Promise<void> {
    const v = this.viewProps();
    const size = this.state.pres?.slideSize;
    const guides = on && !v.guides.length && size ? [newGuide("vertical", size), newGuide("horizontal", size)] : v.guides;
    await this.updateView({ showGuides: on, guides });
  }

  /** View › Gridlines (Shift+F9). */
  async toggleGrid(on = !this.viewProps().showGrid): Promise<void> {
    await this.updateView({ showGrid: on });
  }

  /** View › Ruler. */
  async toggleRuler(on = !this.viewProps().showRuler): Promise<void> {
    await this.updateView({ showRuler: on });
  }

  /** Adds a guide (through the slide centre unless `at` EMU is given) and shows the guides. */
  async addGuide(orient: GuideOrient, at?: number): Promise<void> {
    const size = this.state.pres?.slideSize;
    if (!size) return;
    await this.updateView({ guides: [...this.viewProps().guides, newGuide(orient, size, at)], showGuides: true });
  }

  /** The end of a guide drag: moved, Ctrl duplicates, off the slide deletes. */
  async dropGuide(index: number, pos: number, ctrl: boolean): Promise<void> {
    const size = this.state.pres?.slideSize;
    if (!size) return;
    await this.updateView({ guides: dragGuide(this.viewProps().guides, index, pos, size, ctrl).guides });
  }

  async deleteGuide(index: number): Promise<void> {
    await this.updateView({ guides: this.viewProps().guides.filter((_, i) => i !== index) });
  }

  /** A guide's colour (`null` = the default grey). */
  async setGuideColor(index: number, color: string | null): Promise<void> {
    await this.updateView({
      guides: this.viewProps().guides.map((g, i) => {
        if (i !== index) return g;
        const next = { ...g };
        if (color) next.color = color.replace(/^#/, "").toUpperCase();
        else delete next.color;
        return next;
      }),
    });
  }

  /** Slide Show › Set Up Slide Show. */
  async setShowSettings(settings: ShowSettings): Promise<void> {
    const old = this.state.pres?.showSettings ?? DEFAULT_SHOW_SETTINGS;
    if (JSON.stringify(old) === JSON.stringify(settings)) return;
    await this.run({ type: "setShowSettings", settings });
  }

  /** Rehearse Timings accepted: each rehearsed slide advances after its recorded time (one undo step). */
  async applyTimings(times: ReadonlyMap<NodeId, number>): Promise<void> {
    const slides = this.state.pres?.slides ?? [];
    const commands: ShowCommand[] = [];
    for (const slide of slides) {
      const ms = times.get(slide.id);
      if (ms === undefined) continue;
      const transition = changeTransition(slide.transition, { advanceAfterMs: Math.max(0, Math.round(ms / 1000) * 1000) });
      commands.push({ type: "setTransition", slides: [slide.id], transition });
    }
    const settings = this.state.pres?.showSettings ?? DEFAULT_SHOW_SETTINGS;
    if (!settings.useTimings) commands.push({ type: "setShowSettings", settings: { ...settings, useTimings: true } });
    await this.run(compound(commands));
  }

  // ----- Outline View

  /** Writes a slide's edited outline back: its placeholders, new slides for promoted lines, a demoted title joins the previous slide. */
  async commitOutline(id: NodeId, text: string): Promise<void> {
    const pres = this.state.pres;
    if (!pres) return;
    const plan = outlinePlan(pres, id, text);
    const commands = [...plan.commands];
    if (plan.deleteSlide !== null) commands.push({ type: "deleteSlides", ids: [plan.deleteSlide] });
    await this.run(compound(commands));
    let after = plan.newSlides?.after ?? null;
    for (const ns of plan.newSlides?.slides ?? []) {
      if (after === null) break;
      this.set({ current: after });
      const added = await this.runSlideCommand({ type: "addSlide", after, layout: "titleContent" });
      if (added === undefined) break;
      const slide = this.state.pres?.slides.find((x) => x.id === added);
      if (slide) {
        const o = outlineSlide(slide);
        const cmds: ShowCommand[] = [];
        if (o.titleShape !== null) cmds.push({ type: "setTextBody", shape: o.titleShape, body: bodyWithLines(textOf(slide.shapes.find((x) => x.id === o.titleShape)!), [{ level: 0, text: ns.title }]) });
        if (o.bodyShape !== null && ns.body.length) cmds.push({ type: "setTextBody", shape: o.bodyShape, body: bodyWithLines(textOf(slide.shapes.find((x) => x.id === o.bodyShape)!), ns.body) });
        await this.run(compound(cmds));
      }
      after = added;
    }
  }

  // ----- Slide Sorter

  /** A click on a thumbnail (sorter or panel): Ctrl toggles, Shift selects a range from the current slide. */
  clickSlide(id: NodeId, mode: "replace" | "toggle" | "range"): void {
    const order = this.state.pres?.slides.map((s) => s.id) ?? [];
    const sel = sorterSelect(order, this.state.slideSel, id, mode, this.state.current);
    const current = mode === "toggle" && !sel.includes(id) ? (sel[sel.length - 1] ?? id) : id;
    if (mode === "range") {
      this.set({ slideSel: sel });
      return;
    }
    this.selectSlide(current, sel);
  }

  /** The sorter's selected slides in deck order. */
  selectedSlides(): NodeId[] {
    const sel = new Set(this.state.slideSel);
    return this.state.pres?.slides.filter((s) => sel.has(s.id)).map((s) => s.id) ?? [];
  }

  /** Drops the sorter's selected slides (or `ids`) before slide `before` / into a section (one undo step). */
  async moveSlidesTo(drop: SorterDrop, ids: NodeId[] = this.selectedSlides()): Promise<void> {
    const pres = this.state.pres;
    if (!pres) return;
    await this.run(moveSlidesCommand(pres, ids, drop));
  }

  /** Duplicates the sorter's selected slides (each after itself). */
  async duplicateSlides(ids: NodeId[] = this.selectedSlides()): Promise<void> {
    for (const id of ids) await this.duplicateSlide(id);
  }

  // ----- Selection pane

  toggleSelectionPane(open = !this.state.selectionPane): void {
    this.set({ selectionPane: open });
  }

  /** Hides / shows shapes (Selection pane eye). Hidden shapes leave the selection. */
  async setShapesHidden(ids: NodeId[], hidden: boolean): Promise<void> {
    if (hidden) this.set({ selection: this.state.selection.filter((id) => !ids.includes(id)) });
    await this.run(hideCommand(ids, hidden));
  }

  /** Show All / Hide All. */
  async setAllHidden(hidden: boolean): Promise<void> {
    const slide = this.currentSlide();
    if (!slide) return;
    if (hidden) this.set({ selection: [] });
    await this.run(allCommand(slide, hidden));
  }

  async renameShape(id: NodeId, name: string): Promise<void> {
    const shape = this.shape(id);
    if (shape) await this.run(renameCommand(shape, name));
  }

  /** Moves a top-level shape to z-index `to` (Selection pane drag / ▲▼). */
  async moveShapeToZ(id: NodeId, to: number): Promise<void> {
    const slide = this.currentSlide();
    if (slide) await this.run(moveToZ(slide, id, to));
  }

  // ----- Format Shape pane: size & properties, text box

  openFormatPane(page: "size" | "text" | "cell" | null): void {
    this.set({ formatPane: page });
  }

  /** Lock aspect ratio (Size & Properties; saved as `noChangeAspect`, pictures start locked). */
  aspectLocked(shape: Shape): boolean {
    return !!shape.lockAspect;
  }

  async setAspectLocked(ids: NodeId[], locked: boolean): Promise<void> {
    if (ids.length) await this.run({ type: "setLockAspect", shapes: ids, locked });
  }

  /** Text body properties of the selected (or edited) text shapes, merged per shape; the shrink scale is recomputed. */
  async setBodyProps(change: Partial<BodyProps> | ((props: BodyProps) => Partial<BodyProps>)): Promise<void> {
    const pres = this.state.pres;
    const slide = this.currentSlide();
    if (!pres || !slide) return;
    if (this.state.editing) await this.commitEdit();
    const shapes = this.selectedShapes().filter((s) => s.kind.kind === "auto" && s.kind.value.geometry !== "line");
    const commands: ShowCommand[] = [];
    for (const shape of shapes) {
      const body: TextBody = textOf(shape) ?? { props: DEFAULT_BODY, paragraphs: [{ runs: [] }] };
      const patch = typeof change === "function" ? change(body.props) : change;
      let props: BodyProps = { ...body.props, ...patch };
      if (patch.autofit && patch.autofit !== "shrink") {
        delete props.fontScale;
        delete props.lineReduction;
      }
      if (props.autofit === "shrink") props = autofitProps(pres, slide, shape, { ...body, props: { ...props, fontScale: undefined, lineReduction: undefined } }) ?? withScale(props, { fontScale: 1, lineReduction: 0 });
      const extra: ShowCommand[] = [];
      if (patch.autofit === "resize" && shape.kind.kind === "auto") {
        // Resize shape to fit text: the box grows (or shrinks) to the text's height
        const fit = fitHeight(pres, slide, shape, { ...body, props });
        if (fit !== null && fit !== shape.transform.h) extra.push({ type: "setTransform", shapes: [[shape.id, { ...shape.transform, h: fit }]] });
      }
      if (JSON.stringify(props) !== JSON.stringify(body.props)) commands.push({ type: "setBodyProps", shapes: [shape.id], props });
      commands.push(...extra);
    }
    await this.run(compound(commands));
  }

  // --- keyboard -----------------------------------------------------------------

  /** Executes a shortcut of the slide editor. Returns false when it did nothing applicable. */
  shortcut(a: ShortcutAction): boolean {
    switch (a.kind) {
      case "delete": void this.deleteSelection(); break;
      case "nudge": void this.nudge(a.dx, a.dy, { fine: a.fine, shift: a.shift }); break;
      case "duplicate": void this.duplicateSelection(); break;
      case "group": void this.group(); break;
      case "ungroup": void this.ungroup(); break;
      case "zOrder": void this.zOrder(a.op); break;
      case "undo": void this.undo(); break;
      case "redo": void this.redo(); break;
      case "copy": return this.copy();
      case "cut": if (!this.copy()) return false; void this.deleteSelection(); break;
      case "paste": if (!this.clip || this.state.editing) return false; void this.paste(); break;
      case "selectAll": this.select(this.currentSlide()?.shapes.map((s) => s.id) ?? []); break;
      case "deselect":
        if (this.state.drawMode) this.setDrawMode(null);
        else this.select([]);
        break;
      case "editText": {
        const one = this.state.selection.length === 1 ? this.state.selection[0]! : null;
        if (one === null) return false;
        this.startEdit(one);
        break;
      }
      default: return false;
    }
    return true;
  }

  // --- files ----------------------------------------------------------------------

  /** Checks whether the core answers file requests (`documentState`, cheap); enables Open/Save. */
  async probeFileIo(): Promise<boolean> {
    try {
      await this.enqueue(() => this.api.documentState());
      this.set({ fileIo: true });
      return true;
    } catch {
      this.set({ fileIo: false });
      return false;
    }
  }

  /** Replaces the presentation by a new one (Ctrl+N). */
  async newFile(): Promise<void> {
    try {
      const body = await this.enqueue(() => this.api.newPresentation());
      this.setPresentation(body.presentation, body.envelope, { name: null, warnings: [] });
    } catch (e) {
      this.pushError(e);
    }
  }

  async open(): Promise<void> {
    try {
      const file = await this.api.backend.openFile();
      if (file) await this.openBytesUnguarded(file);
    } catch (e) {
      this.pushError(e);
    }
  }

  /** Opens a `.pptx` file's contents (recent files); `false` on failure. */
  async openBytes(file: { name: string; bytesBase64: string }): Promise<boolean> {
    try {
      await this.openBytesUnguarded(file);
      return true;
    } catch (e) {
      this.pushError(e);
      return false;
    }
  }

  private async openBytesUnguarded(file: { name: string; bytesBase64: string }): Promise<void> {
    const opened = await this.enqueue(() => this.api.openPptx(file.bytesBase64, file.name));
    const body = await this.enqueue(() => this.api.getPresentation());
    this.setPresentation(body.presentation, body.envelope, { name: file.name, warnings: opened.warnings });
  }

  /** Replaces the presentation by an autosaved snapshot (crash recovery); it stays dirty. `false` on failure. */
  async restoreRecovery(json: string, name: string | null): Promise<boolean> {
    try {
      if (this.state.editing) await this.commitEdit();
      const body = await this.enqueue(() => this.api.restoreRecovery(json, name));
      this.setPresentation(body.presentation, body.envelope, { name, warnings: [] });
      return true;
    } catch (e) {
      this.pushError(e);
      return false;
    }
  }

  /**
   * Saves as `.pptx` (desktop: to the presentation's file, or through the
   * save dialog; web: a download); `asName` (Save As) replaces the
   * suggested file name and makes the desktop ask even when the
   * presentation has a file. The name becomes the file actually written.
   */
  async save(asName?: string): Promise<void> {
    try {
      if (this.state.editing) await this.commitEdit();
      const view = lastViewOf(this.state.view);
      const saved = await this.enqueue(() => this.api.savePptx(view));
      const result = await this.api.backend.saveFile(asName ?? saved.suggestedName, saved.bytesBase64, { saveAs: asName !== undefined });
      if (!result) return;
      const name = typeof result === "object" ? result.name : asName;
      const st = await this.enqueue(() => this.api.markSaved(name ?? (this.state.name === null ? saved.suggestedName : undefined)));
      this.set({ dirty: st.dirty, name: st.name, revision: Math.max(this.state.revision, st.revision) });
    } catch (e) {
      this.pushError(e);
    }
  }
}

/** The union of the shapes' bounds (slide px). */
function boundsOf(shapes: Shape[]): BoxRect {
  const r = shapes.map((s) => boundsPx(s.transform));
  const x = Math.min(...r.map((b) => b.x));
  const y = Math.min(...r.map((b) => b.y));
  return { x, y, width: Math.max(...r.map((b) => b.x + b.width)) - x, height: Math.max(...r.map((b) => b.y + b.height)) - y };
}

/** View settings of a presentation without any (`ViewProps::default`). */
export const DEFAULT_VIEW: ViewProps = {
  guides: [], gridSpacing: 76200, snapToGrid: false, snapToShapes: true, showGrid: false, showGuides: false, showRuler: false, lastView: "normal",
};

/** `ShowSettings::default`. */
export const DEFAULT_SHOW_SETTINGS: ShowSettings = { loop: false, withoutNarration: false, withoutAnimation: false, useTimings: true };

const DEFAULT_BODY: BodyProps = { anchor: "top", wrap: true, insets: { left: 91440, top: 45720, right: 91440, bottom: 45720 }, autofit: "none" };

/** The view to open a file in (its `lastView`). */
function viewOfLast(v: ViewProps["lastView"] | undefined): PresentationView {
  switch (v) {
    case "outline": return "outline";
    case "slideSorter": return "sorter";
    case "notesPage": return "notesPage";
    default: return "normal";
  }
}

/** The `lastView` a view is saved as (Reading View has its own Rusuite value, written by the core). */
export function lastViewOf(v: PresentationView): ViewProps["lastView"] {
  switch (v) {
    case "outline": return "outline";
    case "sorter": return "slideSorter";
    case "notesPage": return "notesPage";
    case "reading": return "reading";
    default: return "normal";
  }
}


/** The slide the editor shows: the master view's pseudo slide, else the current slide. */
export function viewSlide(s: Pick<ShowState, "pres" | "current" | "masterView">): Slide | null {
  if (!s.pres) return null;
  if (s.masterView) return designSlide(s.pres, s.masterView);
  return s.pres.slides.find((x) => x.id === s.current) ?? null;
}

/** The table of a table shape. */
export function tableOf(shape: Shape | null | undefined): Table | null {
  return shape?.kind.kind === "table" ? shape.kind.value : null;
}

const RECENT_KEY = "rusuite.show.recentShapes";

function loadRecent(): string[] {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(RECENT_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string" && choiceOf(x) !== null).slice(0, 10) : [];
  } catch {
    return [];
  }
}

function saveRecent(list: string[]): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    // private mode: recent shapes only for this session
  }
}

/** Subscribes a component to a slice of the store. */
export function useShow<T>(store: ShowStore, select: (s: ShowState) => T): T {
  return useSyncExternalStore(store.subscribe, () => select(store.getState()));
}
