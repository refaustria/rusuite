// In-memory backend for tests: records every request and answers like a
// (much simplified) Show core – enough commands to drive the store.

import type { OpenedFile } from "@rusuite/ui-shared";
import type { Envelope } from "../../../../packages/ui-shared/src/generated/Envelope";
import type { ShowBackend } from "../backend";
import type { NodeId } from "../generated/NodeId";
import type { Presentation } from "../generated/Presentation";
import type { Request } from "../generated/Request";
import type { Shape } from "../generated/Shape";
import type { ShowCommand } from "../generated/ShowCommand";
import type { ShowPatch } from "../generated/ShowPatch";
import type { Slide } from "../generated/Slide";
import { findShape } from "../model";
import { fixture } from "./fixture";

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

  constructor(pres: Presentation = fixture()) {
    this.pres = clone(pres);
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
      dirty: this.history.length > 0 || this.restored,
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
        return ok({ type: "documentState", dirty: this.history.length > 0 || this.restored, revision: this.revision, name: this.name });
      case "recoverySnapshot":
        return ok({
          type: "recoverySnapshot",
          json: JSON.stringify(this.pres),
          revision: this.revision,
          dirty: this.history.length > 0 || this.restored,
          name: this.name,
        });
      case "restoreRecovery": {
        try {
          this.pres = JSON.parse(request.json) as Presentation;
        } catch {
          return { err: { code: "invalid_snapshot", message: "not JSON" } };
        }
        this.history = [];
        this.restored = true;
        this.name = request.name ?? null;
        this.revision++;
        return ok({ type: "presentation", presentation: clone(this.pres), envelope: this.envelope({}) });
      }
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
    return null;
  }

  async saveFile() {
    return false;
  }

  async setTitle() {}
}
