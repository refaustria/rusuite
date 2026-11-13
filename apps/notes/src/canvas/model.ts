// Canvas data in the page's Loro mirror (docs/notes-format.md §4.1): `"canvas"` (movable list of item maps – list
// order is the z-order, last = front), `"ink"` (list of stroke maps), `meta.canvas`. Every user action is one undo
// step of the mirror's UndoManager (`CanvasSteps`).

import { LoroList, LoroMap, LoroMovableList, type LoroDoc, type UndoManager } from "loro-crdt";
import type { CanvasItem } from "../generated/CanvasItem";
import type { InkStroke } from "../generated/InkStroke";

export type { CanvasItem, InkStroke };

export const CANVAS = "canvas";
export const INK = "ink";
export const META = "meta";

export type ItemPatch = { id: string } & Partial<Pick<CanvasItem, "x" | "y" | "w" | "h">>;
export type StrokePatch = { id: string; points?: number[]; color?: string };

/** A random id (`c-…` items, `s-…` strokes). */
export function newId(prefix: "c" | "s"): string {
  const b = new Uint8Array(6);
  crypto.getRandomValues(b);
  return `${prefix}-${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")}`;
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

export function isCanvasPage(doc: LoroDoc): boolean {
  return doc.getMap(META).get("canvas") === true;
}

export function readItems(doc: LoroDoc): CanvasItem[] {
  const list = doc.getMovableList(CANVAS);
  const out: CanvasItem[] = [];
  for (let i = 0; i < list.length; i++) {
    const m = list.get(i);
    if (!(m instanceof LoroMap)) continue;
    const blob = m.get("blob");
    out.push({ id: str(m.get("id")), kind: str(m.get("kind")), x: num(m.get("x")), y: num(m.get("y")), w: num(m.get("w")), h: num(m.get("h")), blob: typeof blob === "string" ? blob : null });
  }
  return out;
}

export function readStrokes(doc: LoroDoc): InkStroke[] {
  const list = doc.getList(INK);
  const out: InkStroke[] = [];
  for (let i = 0; i < list.length; i++) {
    const m = list.get(i);
    if (!(m instanceof LoroMap)) continue;
    const pts = m.get("points");
    out.push({
      id: str(m.get("id")),
      tool: str(m.get("tool")) || "pen",
      color: str(m.get("color")) || "#000000",
      width: Math.max(1, Math.round(num(m.get("width")))),
      points: Array.isArray(pts) ? pts.map((v) => Math.round(num(v))) : [],
    });
  }
  return out;
}

function indexOf(list: LoroMovableList | LoroList, id: string): number {
  for (let i = 0; i < list.length; i++) {
    const m = list.get(i);
    if (m instanceof LoroMap && m.get("id") === id) return i;
  }
  return -1;
}

export function addItem(doc: LoroDoc, item: CanvasItem): void {
  const m = doc.getMovableList(CANVAS).pushContainer(new LoroMap());
  m.set("id", item.id);
  m.set("kind", item.kind);
  m.set("x", item.x);
  m.set("y", item.y);
  m.set("w", item.w);
  m.set("h", item.h);
  if (item.blob) m.set("blob", item.blob);
}

export function patchItems(doc: LoroDoc, patches: readonly ItemPatch[]): void {
  const list = doc.getMovableList(CANVAS);
  for (const p of patches) {
    const i = indexOf(list, p.id);
    const m = i >= 0 ? list.get(i) : undefined;
    if (!(m instanceof LoroMap)) continue;
    for (const k of ["x", "y", "w", "h"] as const) {
      const v = p[k];
      if (v !== undefined && m.get(k) !== v) m.set(k, v);
    }
  }
}

export function removeItems(doc: LoroDoc, ids: Iterable<string>): void {
  const list = doc.getMovableList(CANVAS);
  for (const id of ids) {
    const i = indexOf(list, id);
    if (i >= 0) list.delete(i, 1);
  }
}

/** Brings items to the front (end of the list) or sends them to the back, keeping their relative order. */
export function reorderItems(doc: LoroDoc, ids: ReadonlySet<string>, where: "front" | "back"): void {
  const list = doc.getMovableList(CANVAS);
  const order = readItems(doc).map((i) => i.id);
  const picked = order.filter((id) => ids.has(id));
  const rest = order.filter((id) => !ids.has(id));
  const target = where === "front" ? [...rest, ...picked] : [...picked, ...rest];
  for (let to = 0; to < target.length; to++) {
    const from = indexOf(list, target[to]!);
    if (from >= 0 && from !== to) list.move(from, to);
  }
}

export function addStroke(doc: LoroDoc, s: InkStroke): void {
  const list = doc.getList(INK);
  const m = list.insertContainer(list.length, new LoroMap());
  m.set("id", s.id);
  m.set("tool", s.tool);
  m.set("color", s.color);
  m.set("width", Math.round(s.width));
  m.set(
    "points",
    s.points.map((v) => Math.round(v)),
  );
}

export function removeStrokes(doc: LoroDoc, ids: ReadonlySet<string>): void {
  const list = doc.getList(INK);
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list.get(i);
    if (m instanceof LoroMap && ids.has(str(m.get("id")))) list.delete(i, 1);
  }
}

export function patchStrokes(doc: LoroDoc, patches: readonly StrokePatch[]): void {
  const list = doc.getList(INK);
  for (const p of patches) {
    const i = indexOf(list, p.id);
    const m = i >= 0 ? list.get(i) : undefined;
    if (!(m instanceof LoroMap)) continue;
    if (p.points)
      m.set(
        "points",
        p.points.map((v) => Math.round(v)),
      );
    if (p.color && m.get("color") !== p.color) m.set("color", p.color);
  }
}

export function setCanvasMeta(doc: LoroDoc, on: boolean): void {
  doc.getMap(META).set("canvas", on);
}

/** The mirror parts canvas edits need (a `PageMirror`). */
export interface StepHost {
  doc: LoroDoc;
  undo: UndoManager;
}

/**
 * One user action = one undo step. The UndoManager merges commits less than `mergeMs` apart (typing), so a step
 * starts with merging off (it never joins the previous step), groups its commits, and – for strokes, moves and
 * other self-contained actions (`isolate`) – keeps merging off until the next commit after it (typing right after a
 * stroke starts a step of its own), which `afterForeignCommit` restores.
 */
export class CanvasSteps {
  private isolated = false;
  private inStep = false;

  constructor(
    private readonly host: StepHost,
    private readonly mergeMs: number,
  ) {}

  step(fn: () => void, options: { isolate?: boolean } = {}): void {
    const { doc, undo } = this.host;
    if (this.inStep) return fn();
    undo.setMergeInterval(0);
    undo.groupStart();
    this.inStep = true;
    try {
      fn();
      doc.commit();
    } finally {
      this.inStep = false;
      undo.groupEnd();
      this.isolated = options.isolate !== false;
      if (!this.isolated) undo.setMergeInterval(this.mergeMs);
    }
  }

  /** Called after a commit that was not a canvas step (the editor's sync commit): normal merging again. */
  afterForeignCommit(): void {
    if (!this.isolated || this.inStep) return;
    this.isolated = false;
    this.host.undo.setMergeInterval(this.mergeMs);
  }
}
