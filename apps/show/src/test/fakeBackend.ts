// In-memory backend for tests: records every request and answers like a
// (much simplified) Show core – enough commands to drive the store.

import type { OpenedFile } from "@rusuite/ui-shared";
import type { Envelope } from "../../../../packages/ui-shared/src/generated/Envelope";
import type { ShowBackend } from "../backend";
import type { NodeId } from "../generated/NodeId";
import type { PathCmd } from "../generated/PathCmd";
import type { PathQuery } from "../generated/PathQuery";
import type { ShapePaths } from "../generated/ShapePaths";
import type { Presentation } from "../generated/Presentation";
import type { Request } from "../generated/Request";
import type { Shape } from "../generated/Shape";
import type { ShowCommand } from "../generated/ShowCommand";
import type { ShowPatch } from "../generated/ShowPatch";
import type { Slide } from "../generated/Slide";
import { findShape } from "../model";
import { applyAnimationPatch } from "../anim/effects";
import { fixture } from "./fixture";

/** Outlines like the core's for tests: a box (filled presets) or a line (connectors, `line`), rectangle sites. */
export function fakePaths(q: PathQuery): ShapePaths {
  const { w, h } = q;
  const line = q.kind.kind === "connector" || q.kind.value === "line";
  const commands: PathCmd[] = line
    ? [{ kind: "moveTo", x: 0, y: 0 }, { kind: "lineTo", x: w, y: h }]
    : [{ kind: "moveTo", x: 0, y: 0 }, { kind: "lineTo", x: w, y: 0 }, { kind: "lineTo", x: w, y: h }, { kind: "lineTo", x: 0, y: h }, { kind: "close" }];
  return {
    paths: [{ fill: !line, stroke: true, commands }],
    sites: q.kind.kind === "connector" ? [] : [
      { x: w / 2, y: 0, angleDeg: 270 },
      { x: 0, y: h / 2, angleDeg: 180 },
      { x: w / 2, y: h, angleDeg: 90 },
      { x: w, y: h / 2, angleDeg: 0 },
    ],
  };
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export class FakeBackend implements ShowBackend {
  readonly kind = "wasm" as const;
  readonly log: Request[] = [];
  pres: Presentation;
  revision = 0;
  private nextId = 100;
  private history: Presentation[] = [];
  /** Commands that answer with this error code. */
  failWith: string | null = null;
  /** Unsaved changes (cleared by `markSaved`). */
  private dirty = false;
  /** What `openFile` returns next (`null` = cancelled). */
  nextOpen: OpenedFile | null = null;
  /** What `saveFile` returns (`false` = cancelled). */
  saveResult = true;
  saved: { name: string; bytesBase64: string }[] = [];

  private fresh: Presentation;

  constructor(pres: Presentation = fixture()) {
    this.pres = clone(pres);
    this.fresh = clone(pres);
  }

  /** The commands sent (`apply` requests only). */
  get commands(): ShowCommand[] {
    return this.log.flatMap((r) => (r.type === "apply" ? [r.command] : []));
  }

  async ping() {
    return "Rusuite Show fake";
  }

  /** Set by `restoreRecovery` (dirty until saved; the fake has no save). */
  restored = false;
  name: string | null = null;

  private envelope(patch: Partial<ShowPatch>): Envelope<ShowPatch> {
    return {
      revision: this.revision,
      patch: { slidesOrder: null, slides: [], deletedSlides: [], idMap: [], slideSize: null, info: null, ...patch },
      canUndo: this.history.length > 0,
      canRedo: false,
      dirty: this.dirty,
    };
  }

  private slideOf(id: NodeId): Slide {
    const s = this.pres.slides.find((sl) => findShape(sl.shapes, id) || sl.id === id);
    if (!s) throw new Error(`unknown id ${id}`);
    return s;
  }

  private real(temp: number, idMap: [number, number][]): number {
    if (temp >= 0) return temp;
    const id = this.nextId++;
    idMap.push([temp, id]);
    return id;
  }

  private withIds(shape: Shape, idMap: [number, number][]): Shape {
    const out: Shape = { ...shape, id: this.real(shape.id, idMap), name: shape.name || `Shape ${shape.id}` };
    if (shape.kind.kind === "group") out.kind = { kind: "group", value: { children: shape.kind.value.children.map((c) => this.withIds(c, idMap)) } };
    return out;
  }

  /** Applies the commands the tests need; others change nothing but still bump the revision. */
  private exec(c: ShowCommand, touched: Set<Slide>, idMap: [number, number][], order: { changed: boolean }): void {
    const p = this.pres;
    switch (c.type) {
      case "compound":
        c.commands.forEach((x) => this.exec(x, touched, idMap, order));
        return;
      case "addShape": {
        const s = this.slideOf(c.slide);
        s.shapes.push(this.withIds(c.shape, idMap));
        touched.add(s);
        return;
      }
      case "insertPicture": {
        const s = this.slideOf(c.slide);
        const media = p.media.length + 1;
        p.media.push({ id: media, contentType: c.contentType, data: c.bytesBase64 });
        s.shapes.push({
          id: this.real(c.newId, idMap), name: "Picture", transform: { x: 0, y: 0, w: 952500, h: 952500 },
          kind: { kind: "picture", value: { media } }, fill: { kind: "none" }, line: { fill: { kind: "none" }, width: 12700, dash: "solid" },
        });
        touched.add(s);
        return;
      }
      case "setTransform":
        for (const [id, t] of c.shapes) {
          const s = this.slideOf(id);
          findShape(s.shapes, id)!.shape.transform = t;
          touched.add(s);
        }
        return;
      case "deleteShapes":
        for (const id of c.ids) {
          const s = this.slideOf(id);
          s.shapes = s.shapes.filter((x) => x.id !== id);
          touched.add(s);
        }
        return;
      case "setTextBody": {
        const s = this.slideOf(c.shape);
        const sh = findShape(s.shapes, c.shape)!.shape;
        if (sh.kind.kind === "auto") sh.kind.value.text = c.body;
        touched.add(s);
        return;
      }
      case "addSlide": {
        const id = this.nextId++;
        const at = c.after === undefined || c.after === null ? 0 : p.slides.findIndex((s) => s.id === c.after) + 1;
        const slide: Slide = { id, layout: c.layout, shapes: [] };
        p.slides.splice(at, 0, slide);
        touched.add(slide);
        order.changed = true;
        return;
      }
      case "deleteSlides":
        p.slides = p.slides.filter((s) => !c.ids.includes(s.id));
        order.changed = true;
        return;
      case "moveSlide": {
        const i = p.slides.findIndex((s) => s.id === c.id);
        const [s] = p.slides.splice(i, 1);
        p.slides.splice(c.toIndex, 0, s!);
        order.changed = true;
        return;
      }
      case "duplicateSlide": {
        const i = p.slides.findIndex((s) => s.id === c.id);
        const copy = clone(p.slides[i]!);
        copy.id = this.nextId++;
        copy.shapes = copy.shapes.map((sh) => ({ ...sh, id: this.nextId++ }));
        p.slides.splice(i + 1, 0, copy);
        touched.add(copy);
        order.changed = true;
        return;
      }
      case "setSlideLayout": {
        const s = this.slideOf(c.slide);
        s.layout = c.layout;
        touched.add(s);
        return;
      }
      case "setSlidesHidden":
        for (const id of c.slides) {
          const s = this.slideOf(id);
          s.hidden = c.hidden;
          touched.add(s);
        }
        return;
      case "setNotes": {
        const s = this.slideOf(c.slide);
        s.notes = c.notes;
        touched.add(s);
        return;
      }
      case "setSlideBackground": {
        const s = this.slideOf(c.slide);
        s.background = c.fill;
        touched.add(s);
        return;
      }
      case "setAltText": {
        const s = this.slideOf(c.shape);
        findShape(s.shapes, c.shape)!.shape.alt = c.alt;
        touched.add(s);
        return;
      }
      case "setShapeStyle":
        for (const id of c.shapes) {
          const s = this.slideOf(id);
          const sh = findShape(s.shapes, id)!.shape;
          if (c.fill !== undefined) sh.fill = c.fill ?? { kind: "none" };
          if (c.line !== undefined) sh.line = c.line ?? { fill: { kind: "none" }, width: 12700, dash: "solid" };
          touched.add(s);
        }
        return;
      case "setParagraphProps": {
        const s = this.slideOf(c.shape);
        const sh = findShape(s.shapes, c.shape)!.shape;
        if (sh.kind.kind === "auto" && sh.kind.value.text) {
          for (const i of c.paragraphs) {
            const para = sh.kind.value.text.paragraphs[i];
            if (para) para.props = { ...(para.props ?? {}), ...(c.patch as object) } as typeof para.props;
          }
        }
        touched.add(s);
        return;
      }
      case "setTransition":
        for (const id of c.slides) {
          const s = this.slideOf(id);
          if (c.transition) s.transition = c.transition;
          else delete s.transition;
          touched.add(s);
        }
        return;
      case "applyTransitionToAll": {
        const t = this.slideOf(c.from).transition;
        for (const s of p.slides) {
          if (t) s.transition = clone(t);
          else delete s.transition;
          touched.add(s);
        }
        return;
      }
      case "addAnimation": {
        const s = this.slideOf(c.slide);
        const list = (s.animations ??= []);
        list.splice(c.index ?? list.length, 0, { ...c.animation, id: this.real(c.newId, idMap) });
        touched.add(s);
        return;
      }
      case "updateAnimation":
      case "removeAnimation":
      case "reorderAnimation": {
        const s = p.slides.find((sl) => sl.animations?.some((a) => a.id === c.id));
        if (!s) throw new Error(`unknown animation ${c.id}`);
        const list = s.animations!;
        const i = list.findIndex((a) => a.id === c.id);
        if (c.type === "updateAnimation") list[i] = applyAnimationPatch(list[i]!, c.patch);
        else {
          const [a] = list.splice(i, 1);
          if (c.type === "reorderAnimation") list.splice(c.index, 0, a!);
        }
        touched.add(s);
        return;
      }
      case "insertTable": {
        const s = this.slideOf(c.slide);
        const t = c.transform ?? { x: 914400, y: 914400, w: 6096000, h: 370840 * c.rows };
        const cell = () => ({ text: { props: { anchor: "top" as const, wrap: true, insets: { left: 91440, top: 45720, right: 91440, bottom: 45720 }, autofit: "none" as const }, paragraphs: [{ runs: [] }] } });
        s.shapes.push({
          id: this.real(c.newId, idMap), name: "Table", transform: t,
          kind: {
            kind: "table",
            value: {
              rows: Array.from({ length: c.rows }, () => ({ height: Math.round(t.h / c.rows) })),
              cols: Array.from({ length: c.cols }, () => ({ width: Math.round(t.w / c.cols) })),
              cells: Array.from({ length: c.rows }, () => Array.from({ length: c.cols }, cell)),
              styleId: "{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}",
              look: { firstRow: true, bandRows: true },
            },
          },
          fill: { kind: "none" }, line: { fill: { kind: "none" }, width: 12700, dash: "solid" },
        });
        touched.add(s);
        return;
      }
      case "setTableCellText":
      case "mergeTableCells":
      case "splitTableCell":
      case "setTableStyle":
      case "setTableCellProps":
      case "insertTableRow":
      case "setTableGrid": {
        const s = this.slideOf(c.shape);
        const sh = findShape(s.shapes, c.shape)!.shape;
        if (sh.kind.kind !== "table") throw new Error("not a table");
        const t = sh.kind.value;
        if (c.type === "setTableCellText") t.cells[c.row]![c.col]!.text = c.body;
        else if (c.type === "mergeTableCells") {
          for (let r = c.row; r < c.row + c.rowSpan; r++) for (let k = c.col; k < c.col + c.colSpan; k++) if (r !== c.row || k !== c.col) t.cells[r]![k]!.covered = true;
          Object.assign(t.cells[c.row]![c.col]!, { rowSpan: c.rowSpan, colSpan: c.colSpan });
        } else if (c.type === "splitTableCell") {
          const a = t.cells[c.row]![c.col]!;
          for (let r = c.row; r < c.row + (a.rowSpan ?? 1); r++) for (let k = c.col; k < c.col + (a.colSpan ?? 1); k++) t.cells[r]![k]!.covered = false;
          delete a.rowSpan;
          delete a.colSpan;
        } else if (c.type === "setTableStyle") {
          t.styleId = c.styleId ?? undefined;
          t.look = c.look;
        } else if (c.type === "setTableCellProps") {
          for (let r = c.row; r < c.row + (c.rowSpan ?? 1); r++)
            for (let k = c.col; k < c.col + (c.colSpan ?? 1); k++) {
              const cell = t.cells[r]![k]!;
              if (c.patch.fill !== undefined) cell.fill = c.patch.fill ?? undefined;
            }
        } else if (c.type === "insertTableRow") {
          t.rows.splice(c.index, 0, { ...t.rows[0]! });
          t.cells.splice(c.index, 0, clone(t.cells[0]!).map((x) => ({ text: { ...x.text, paragraphs: [{ runs: [] }] } })));
        } else {
          if (c.colWidths) t.cols = c.colWidths.map((width) => ({ width }));
          if (c.rowHeights) t.rows = c.rowHeights.map((height) => ({ height }));
        }
        touched.add(s);
        return;
      }
      case "setGeometry":
        for (const id of c.shapes) {
          const s = this.slideOf(id);
          const sh = findShape(s.shapes, id)!.shape;
          if (sh.kind.kind === "auto") {
            if (c.geometry !== undefined) sh.kind.value.geometry = c.geometry;
            if (c.adjust !== undefined) sh.kind.value.adjust = c.adjust;
          }
          touched.add(s);
        }
        return;
      case "setConnector": {
        const s = this.slideOf(c.shape);
        const sh = findShape(s.shapes, c.shape)!.shape;
        if (sh.kind.kind === "connector") {
          const v = sh.kind.value as unknown as Record<string, unknown>;
          for (const [k, x] of Object.entries(c.patch)) {
            if (x === null) delete v[k];
            else v[k] = x;
          }
        }
        touched.add(s);
        return;
      }
      default:
        for (const id of "shapes" in c && Array.isArray(c.shapes) ? (c.shapes as unknown[]) : []) {
          if (typeof id === "number") touched.add(this.slideOf(id));
        }
    }
  }

  async dispatch<T>(request: Request) {
    this.log.push(request);
    const ok = (body: unknown) => ({ ok: body as T });
    switch (request.type) {
      case "getPresentation":
        return ok({ type: "presentation", presentation: clone(this.pres), envelope: this.envelope({}) });
      case "documentState":
        return ok({ type: "documentState", dirty: this.dirty, revision: this.revision, name: this.name });
      case "recoverySnapshot":
        return ok({ type: "recoverySnapshot", json: JSON.stringify(this.pres), revision: this.revision, dirty: this.dirty, name: this.name });
      case "restoreRecovery": {
        try {
          this.pres = JSON.parse(request.json) as Presentation;
        } catch {
          return { err: { code: "invalid_snapshot", message: "not JSON" } };
        }
        this.history = [];
        this.dirty = true;
        this.name = request.name ?? null;
        this.revision++;
        return ok({ type: "presentation", presentation: clone(this.pres), envelope: this.envelope({}) });
      }
      case "newPresentation":
        this.pres = clone(this.fresh);
        this.history = [];
        this.dirty = false;
        return ok({ type: "presentation", presentation: clone(this.pres), envelope: this.envelope({}) });
      case "openPptx":
        return ok({ type: "opened", presentation: clone(this.pres), warnings: [], envelope: this.envelope({}) });
      case "savePptx":
        return ok({ type: "saved", bytesBase64: "UEsDBA==", suggestedName: "Presentation.pptx" });
      case "markSaved":
        this.dirty = false;
        if (request.name) this.name = request.name;
        return ok({ type: "documentState", dirty: false, revision: this.revision, name: this.name });
      case "shapePaths":
        return ok({ type: "shapePaths", shapes: request.queries.map((q) => fakePaths(q)) });
      case "getMedia": {
        const m = this.pres.media.find((x) => x.id === request.id);
        return m ? ok({ type: "media", contentType: m.contentType, bytesBase64: m.data }) : { err: { code: "unknown_media", message: "?" } };
      }
      case "undo": {
        const prev = this.history.pop();
        if (!prev) return ok({ type: "patch", envelope: this.envelope({}) });
        const deleted = this.pres.slides.filter((s) => !prev.slides.some((x) => x.id === s.id)).map((s) => s.id);
        this.pres = prev;
        this.revision++;
        return ok({ type: "patch", envelope: this.envelope({ slides: clone(prev.slides), deletedSlides: deleted, slidesOrder: prev.slides.map((s) => s.id) }) });
      }
      case "apply": {
        if (this.failWith) return { err: { code: this.failWith, message: `fake ${this.failWith}` } };
        this.history.push(clone(this.pres));
        this.dirty = true;
        const touched = new Set<Slide>();
        const idMap: [number, number][] = [];
        const order = { changed: false };
        this.exec(request.command, touched, idMap, order);
        this.revision++;
        return ok({
          type: "patch",
          envelope: this.envelope({
            slides: clone([...touched].filter((s) => this.pres.slides.includes(s))),
            idMap,
            slidesOrder: order.changed ? this.pres.slides.map((s) => s.id) : null,
          }),
        });
      }
      default:
        return { err: { code: "bad_request", message: `unknown variant \`${(request as { type: string }).type}\`` } };
    }
  }

  async openFile(): Promise<OpenedFile | null> {
    return this.nextOpen;
  }

  async saveFile(name: string, bytesBase64: string) {
    if (this.saveResult) this.saved.push({ name, bytesBase64 });
    return this.saveResult;
  }

  async setTitle() {}
  async print() {}
}
