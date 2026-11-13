// Canvas page actions that touch both the editor (text boxes are top-level blocks with `canvasItem`) and the canvas
// data (items, strokes, `meta.canvas`). Each runs as one undo step; editor changes go through ProseMirror
// transactions (the binding writes them to Loro), the rest directly into the mirror doc.

import { Fragment, type Node as PMNode } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import type { LoroDoc } from "loro-crdt";
import { readingOrder, translateStroke } from "./geometry";
import { assignBlocks, canvasBoxes, IMPLICIT_BOX } from "./layout";
import { addItem, isCanvasPage, newId, patchItems, patchStrokes, readItems, readStrokes, removeItems, removeStrokes, setCanvasMeta, type CanvasSteps, type ItemPatch } from "./model";

export interface CanvasCtx {
  view: EditorView;
  doc: LoroDoc;
  steps: CanvasSteps;
}

/** Width of the text box a flowing page's content becomes (pt): the normal page width. */
export const FLOW_BOX_W_PT = 510;
/** Width of a text box created by a click (pt). */
export const NEW_BOX_W_PT = 300;

const withoutBox = (node: PMNode): PMNode => (node.attrs.canvasItem ? node.type.create({ ...node.attrs, canvasItem: null }, node.content, node.marks) : node);

/** Flowing → canvas: all content becomes one text box at (0, 0); strokes kept from earlier reappear. */
export function enterCanvas(ctx: CanvasCtx): void {
  const { view, doc, steps } = ctx;
  if (isCanvasPage(doc)) return;
  const id = newId("c");
  steps.step(() => {
    const tr = view.state.tr;
    view.state.doc.forEach((node, offset) => {
      tr.setNodeMarkup(offset, undefined, { ...node.attrs, canvasItem: id });
    });
    view.dispatch(tr);
    removeItems(
      doc,
      readItems(doc)
        .filter((i) => i.kind === "text")
        .map((i) => i.id),
    );
    addItem(doc, { id, kind: "text", x: 0, y: 0, w: FLOW_BOX_W_PT, h: 0, blob: null });
    setCanvasMeta(doc, true);
  });
}

/**
 * Canvas → flowing: boxes (and images/attachments, as blocks) in reading order (top to bottom, then left to right);
 * `canvasItem` attributes and canvas items go, strokes stay in the data (hidden on flowing pages).
 */
export function leaveCanvas(ctx: CanvasCtx): void {
  const { view, doc, steps } = ctx;
  if (!isCanvasPage(doc)) return;
  const items = readItems(doc);
  const textIds = new Set(items.filter((i) => i.kind === "text").map((i) => i.id));
  const nodes: PMNode[] = [];
  view.state.doc.forEach((n) => void nodes.push(n));
  const assign = assignBlocks(
    nodes.map((n) => n.attrs.canvasItem as string | null),
    textIds,
  );
  const schema = view.state.schema;
  type Group = { x: number; y: number; nodes: PMNode[]; first: number };
  const groups = new Map<string, Group>();
  nodes.forEach((n, i) => {
    const id = assign[i]!;
    let g = groups.get(id);
    if (!g) {
      const it = items.find((x) => x.id === id);
      g = { x: it?.x ?? 0, y: it?.y ?? (id === IMPLICIT_BOX ? -Infinity : 0), nodes: [], first: i };
      groups.set(id, g);
    }
    g.nodes.push(n);
  });
  const all: Group[] = [...groups.values()];
  for (const it of items) {
    if (it.kind === "image" && it.blob && schema.nodes.image)
      all.push({ x: it.x, y: it.y, first: -1, nodes: [schema.nodes.image.create({ blob: it.blob, width: it.w || null, height: it.h || null })] });
    if (it.kind === "attachment" && it.blob && schema.nodes.attachment) all.push({ x: it.x, y: it.y, first: -1, nodes: [schema.nodes.attachment.create({ blob: it.blob, name: "", size: 0 })] });
  }
  const ordered = readingOrder(all).flatMap((g) => g.nodes);
  const same = ordered.length === nodes.length && ordered.every((n, i) => n === nodes[i]);
  steps.step(() => {
    const tr = view.state.tr;
    if (same) {
      view.state.doc.forEach((node, offset) => {
        if (node.attrs.canvasItem) tr.setNodeMarkup(offset, undefined, { ...node.attrs, canvasItem: null });
      });
    } else {
      tr.replaceWith(0, view.state.doc.content.size, Fragment.from(ordered.map(withoutBox)));
    }
    if (tr.docChanged) view.dispatch(tr);
    removeItems(
      doc,
      items.map((i) => i.id),
    );
    setCanvasMeta(doc, false);
  });
}

/**
 * A click on empty canvas: a text box at (x, y) pt with the caret in it. An empty box elsewhere is reused (moved
 * there) and other empty boxes are removed, so clicking around leaves no empty boxes behind (OneNote).
 */
export function createTextBox(ctx: CanvasCtx, x: number, y: number, w = NEW_BOX_W_PT): string {
  const { view, doc, steps } = ctx;
  let id = "";
  steps.step(
    () => {
      const boxes = canvasBoxes(view.state);
      const empties = boxes.filter((b) => b.empty);
      const reuse = empties[0];
      const tr = view.state.tr;
      const drop: Array<[number, number]> = [];
      for (const b of empties) for (const [k, r] of b.ranges.entries()) if (b !== reuse || k > 0) drop.push(r);
      drop.sort((a, b) => b[0] - a[0]);
      for (const [from, to] of drop) tr.delete(from, to);
      const dropIds = empties.filter((b) => b !== reuse && !b.implicit).map((b) => b.id);
      let caret: number;
      if (reuse) {
        const from = tr.mapping.map(reuse.ranges[0]![0]);
        if (reuse.implicit) {
          id = newId("c");
          tr.setNodeMarkup(from, undefined, { ...tr.doc.nodeAt(from)!.attrs, canvasItem: id });
        } else id = reuse.id;
        caret = from + 1;
      } else {
        id = newId("c");
        const para = view.state.schema.nodes.paragraph!.create({ canvasItem: id });
        const end = tr.doc.content.size;
        tr.insert(end, para);
        caret = end + 1;
      }
      tr.setSelection(TextSelection.create(tr.doc, caret));
      view.dispatch(tr.scrollIntoView());
      removeItems(doc, dropIds);
      if (reuse && !reuse.implicit) patchItems(doc, [{ id, x, y, w }]);
      else addItem(doc, { id, kind: "text", x, y, w, h: 0, blob: null });
    },
    { isolate: false },
  );
  view.focus();
  return id;
}

/** Removes boxes (their text), images and strokes. */
export function deleteItems(ctx: CanvasCtx, itemIds: ReadonlySet<string>, strokeIds: ReadonlySet<string>): void {
  const { view, doc, steps } = ctx;
  if (!itemIds.size && !strokeIds.size) return;
  steps.step(() => {
    const boxes = canvasBoxes(view.state).filter((b) => itemIds.has(b.id));
    const ranges = boxes.flatMap((b) => b.ranges).sort((a, b) => b[0] - a[0]);
    if (ranges.length) {
      const tr = view.state.tr;
      const total = ranges.reduce((n, [a, b]) => n + (b - a), 0);
      if (total >= view.state.doc.content.size) tr.replaceWith(0, view.state.doc.content.size, view.state.schema.nodes.paragraph!.create());
      else for (const [from, to] of ranges) tr.delete(from, to);
      view.dispatch(tr);
    }
    removeItems(doc, itemIds);
    removeStrokes(doc, strokeIds);
  });
}

/** Moves boxes/images (pt) and strokes by (dx, dy) surface px. */
export function moveItems(ctx: CanvasCtx, items: readonly ItemPatch[], strokeIds: ReadonlySet<string>, dxPx: number, dyPx: number): void {
  const { doc, steps } = ctx;
  steps.step(() => {
    patchItems(doc, items);
    if (strokeIds.size && (dxPx || dyPx)) {
      patchStrokes(
        doc,
        readStrokes(doc)
          .filter((s) => strokeIds.has(s.id))
          .map((s) => ({ id: s.id, points: translateStroke(s.points, dxPx, dyPx) })),
      );
    }
  });
}

/** Sets x/y/w/h of items (a box moved or resized). */
export function patchItemsStep(ctx: CanvasCtx, patches: readonly ItemPatch[]): void {
  ctx.steps.step(() => patchItems(ctx.doc, patches));
}

/** Recolours strokes and the text of boxes. */
export function recolor(ctx: CanvasCtx, itemIds: ReadonlySet<string>, strokeIds: ReadonlySet<string>, color: string): void {
  const { view, doc, steps } = ctx;
  steps.step(() => {
    const mark = view.state.schema.marks.textStyle;
    const boxes = canvasBoxes(view.state).filter((b) => itemIds.has(b.id));
    if (mark && boxes.length) {
      const tr = view.state.tr;
      for (const b of boxes) for (const [from, to] of b.ranges) tr.addMark(from, to, mark.create({ color }));
      if (tr.docChanged) view.dispatch(tr);
    }
    patchStrokes(
      doc,
      [...strokeIds].map((id) => ({ id, color })),
    );
  });
}
