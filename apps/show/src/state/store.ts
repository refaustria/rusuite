// Show view-model store (ADR 0001: the frontend only holds a view of the
// Rust document). The presentation comes from `getPresentation` and is
// updated by `ShowPatch`es (whole slides); UI-only state (current slide,
// selection, text editing session, toasts) lives next to it. A tiny
// `useSyncExternalStore` store like Calc's.

import { useSyncExternalStore } from "react";
import type { RunProperties } from "../../../../packages/ui-shared/src/generated/RunProperties";
import { ShowApiError, type PatchEnvelope, type ShowApi } from "../api";
import type { Alignment } from "../generated/Alignment";
import type { AlignMode } from "../generated/AlignMode";
import type { Axis } from "../generated/Axis";
import type { Bullet } from "../generated/Bullet";
import type { Color } from "../../../../packages/ui-shared/src/generated/Color";
import type { LayoutKind } from "../generated/LayoutKind";
import type { NodeId } from "../generated/NodeId";
import type { Presentation } from "../generated/Presentation";
import type { Shape } from "../generated/Shape";
import type { ShowCommand } from "../generated/ShowCommand";
import type { ShowPatch } from "../generated/ShowPatch";
import type { Slide } from "../generated/Slide";
import type { TextBody } from "../generated/TextBody";
import type { Transform } from "../generated/Transform";
import type { ZOp } from "../generated/ZOp";
import { bodyText, effectiveParagraph, findShape, placeholderDef, textOf } from "../model";
import {
  alignCommand, alignmentCommand, bodyFromText, bulletCommand, compound, duplicateCommand, formatCommands, indentCommands,
  lineSpacingCommand, newShape, nudgeCommand, pasteOffset, runPropsRange, runPropsWhole, selectedParagraphs, stepFontSize,
  type FormatValues, type InsertKind,
} from "./commands";
import type { ShortcutAction } from "./shortcuts";

export interface Toast {
  id: number;
  message: string;
}

/** The overlay text editor's session. */
export interface EditSession {
  shape: NodeId;
  text: string;
  /** Textarea selection (UTF-16 offsets). */
  start: number;
  end: number;
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
}

/** Dialogs opened from menus: Format Shape, Alt Text, the Replace Picture file picker. */
export type ShowDialog = { kind: "format" } | { kind: "alt"; shape: NodeId } | { kind: "replacePicture"; shape: NodeId };

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
  return { ...pres, slides, slideSize: patch.slideSize ?? pres.slideSize };
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
  };
  private clip: Clip | null = null;
  private listeners = new Set<() => void>();
  private toastSeq = 0;
  private tempSeq = 0;
  private queue: Promise<unknown> = Promise.resolve();
  /** Media id → data URL. */
  readonly media = new Map<number, string>();
  private mediaPending = new Set<number>();

  constructor(readonly api: ShowApi) {}

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
    const { pres, current } = this.state;
    return pres?.slides.find((s) => s.id === current) ?? null;
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
    const slide = pres.slides.find((x) => x.id === current);
    const top = new Set(slide?.shapes.map((x) => x.id) ?? []);
    const selection = mapIds(s.selection, idMap).filter((id) => top.has(id));
    let editing = s.editing ? { ...s.editing, shape: idMap.get(s.editing.shape) ?? s.editing.shape } : null;
    if (editing && !(slide && findShape(slide.shapes, editing.shape))) editing = null;
    this.set({
      pres,
      current,
      selection,
      editing,
      revision: env.revision,
      canUndo: env.canUndo,
      canRedo: env.canRedo,
      dirty: env.dirty,
      info: p.info ?? s.info,
    });
    this.fetchMissingMedia(p.slides);
    return idMap;
  }

  private fetchMissingMedia(slides: Slide[]): void {
    const want = new Set<number>();
    const walk = (shapes: Shape[]) => {
      for (const sh of shapes) {
        if (sh.kind.kind === "picture") want.add(sh.kind.value.media);
        else if (sh.kind.kind === "group") walk(sh.kind.value.children);
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

  selectSlide(id: NodeId): void {
    if (this.state.editing) void this.commitEdit();
    this.set({ current: id, selection: [], editing: null });
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
    this.set({ selection: next });
  }

  // --- shape commands ---------------------------------------------------------

  async setTransforms(shapes: [NodeId, Transform][]): Promise<void> {
    if (shapes.length) await this.run({ type: "setTransform", shapes });
  }

  async deleteSelection(): Promise<void> {
    const ids = this.state.selection;
    if (ids.length) await this.run({ type: "deleteShapes", ids });
  }

  async nudge(dx: number, dy: number): Promise<void> {
    await this.run(nudgeCommand(this.selectedShapes(), dx, dy));
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
    if (res) this.select(children);
  }

  async zOrder(op: ZOp): Promise<void> {
    const shapes = this.state.selection;
    if (shapes.length) await this.run({ type: "zOrder", shapes, op });
  }

  async align(mode: AlignMode): Promise<void> {
    await this.run(alignCommand(this.state.selection, mode));
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

  /** Starts the overlay editor on a text-bearing shape. */
  startEdit(id: NodeId): void {
    const shape = this.shape(id);
    if (!shape || shape.kind.kind !== "auto" || shape.kind.value.geometry === "line") return;
    const text = textOf(shape);
    const t = text ? bodyText(text) : "";
    const top = findShape(this.currentSlide()?.shapes ?? [], id)?.top.id ?? id;
    this.set({ editing: { shape: id, text: t, start: t.length, end: t.length }, selection: [top] });
  }

  updateEdit(text: string, start: number, end: number): void {
    if (this.state.editing) this.set({ editing: { ...this.state.editing, text, start, end } });
  }

  private oldBody(id: NodeId): TextBody {
    const shape = this.shape(id);
    return (shape && textOf(shape)) ?? {
      props: { anchor: "middle", wrap: true, insets: { left: 91440, top: 45720, right: 91440, bottom: 45720 }, autofit: "none" },
      paragraphs: [{ runs: [] }],
    };
  }

  /** `SetTextBody` for the session's text, when it changed. */
  private textCommand(e: EditSession): ShowCommand | null {
    const old = this.oldBody(e.shape);
    const shape = this.shape(e.shape);
    if (shape && textOf(shape) && bodyText(old) === e.text) return null;
    return { type: "setTextBody", shape: e.shape, body: bodyFromText(e.text, old) };
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
    if (e) {
      const s = this.shape(e.shape);
      return s ? [s] : [];
    }
    return this.selectedShapes().filter((s) => s.kind.kind === "auto" && s.kind.value.geometry !== "line" && !!s.kind.value.text);
  }

  /** Run formatting from the toolbar: the editor's selection, else the whole text of the selected shapes. */
  async applyRunPatch(patch: RunProperties): Promise<void> {
    const e = this.state.editing;
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
        const body = bodyFromText(e.text, this.oldBody(e.shape));
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

  // --- keyboard -----------------------------------------------------------------

  /** Executes a shortcut of the slide editor. Returns false when it did nothing applicable. */
  shortcut(a: ShortcutAction): boolean {
    switch (a.kind) {
      case "delete": void this.deleteSelection(); break;
      case "nudge": void this.nudge(a.dx, a.dy); break;
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
      case "deselect": this.select([]); break;
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
      const saved = await this.enqueue(() => this.api.savePptx());
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

/** Subscribes a component to a slice of the store. */
export function useShow<T>(store: ShowStore, select: (s: ShowState) => T): T {
  return useSyncExternalStore(store.subscribe, () => select(store.getState()));
}
