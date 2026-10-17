// Floating objects as a set (P9-W4): Shift/Ctrl+click adds pictures and
// drawings to the selection (the editor's node selection is the first one,
// the others are kept here and drawn selected), arrow keys nudge the
// selected objects (Ctrl: 1 px), Arrange › Group / Ungroup / Regroup, Align
// and Distribute. Group builds the group value in the editor from the
// objects' rendered frames (one transaction; the mapper sends it with the
// always-correct fallback); members keep their ids.

import type { Node as PMNode } from "@tiptap/pm/model";
import { NodeSelection, Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import type { Anchor } from "../../generated/Anchor";
import type { Drawing } from "../../generated/Drawing";
import type { Indent } from "../../generated/Indent";
import type { PictureFormat } from "../../generated/PictureFormat";
import { canonDrawing } from "../../sync/model";
import { movedAnchor, newAnchor, renderedOffset, zoomOf } from "../floating";
import { innerEditors } from "./innerEditors";
import { alignBoxes, distributeBoxes, EMU_PER_PX, groupMembers, nudgeDelta, ungroupMembers, type AlignMode, type Box } from "./geometry";

const TWIPS_PER_PX = 15;

interface ObjectsState {
  /** Further selected objects (positions), besides the node selection. */
  extra: number[];
}

export const objectsKey = new PluginKey<ObjectsState>("rusuiteObjects");

/** A floating picture or drawing node. */
const isObject = (n: PMNode | null | undefined): n is PMNode =>
  !!n && ((n.type.name === "drawing" && !!n.attrs.value) || n.type.name === "image");

const isFloating = (n: PMNode) => (n.type.name === "drawing" ? !!(n.attrs.value as Drawing).anchor : !!n.attrs.anchor);

/** The selected objects: the node selection first, then the ones added with Shift/Ctrl+click. */
export function selectedObjects(state: EditorState): { pos: number; node: PMNode }[] {
  const sel = state.selection;
  if (!(sel instanceof NodeSelection) || !isObject(sel.node)) return [];
  const out = [{ pos: sel.from, node: sel.node }];
  for (const pos of objectsKey.getState(state)?.extra ?? []) {
    const node = state.doc.nodeAt(pos);
    if (isObject(node) && pos !== sel.from) out.push({ pos, node });
  }
  return out;
}

export function objectsPlugin(): Plugin<ObjectsState> {
  return new Plugin<ObjectsState>({
    key: objectsKey,
    state: {
      init: () => ({ extra: [] }),
      apply(tr: Transaction, prev: ObjectsState, _old, state): ObjectsState {
        const meta = tr.getMeta(objectsKey) as ObjectsState | undefined;
        if (meta) return meta;
        const sel = state.selection;
        // Another selection than an object ends the set.
        if (!(sel instanceof NodeSelection) || !isObject(sel.node)) return prev.extra.length ? { extra: [] } : prev;
        if (!prev.extra.length) return prev;
        const extra = prev.extra.map((p) => tr.mapping.map(p)).filter((p) => isObject(state.doc.nodeAt(p)) && p !== sel.from);
        return { extra };
      },
    },
    view: () => ({
      update(view, prev) {
        // An object selected in the main editor is the formatting target from now on (not a text box edited before).
        if (!prev.selection.eq(view.state.selection) && view.state.selection instanceof NodeSelection) innerEditors.mainSelected();
      },
    }),
    props: {
      decorations(state) {
        const extra = objectsKey.getState(state)?.extra ?? [];
        if (!extra.length) return null;
        return DecorationSet.create(
          state.doc,
          extra.flatMap((p) => {
            const n = state.doc.nodeAt(p);
            return n ? [Decoration.node(p, p + n.nodeSize, { class: "multi-selected" })] : [];
          }),
        );
      },
      handleDOMEvents: {
        mousedown(view, e) {
          if (!(e.shiftKey || e.ctrlKey || e.metaKey) || e.button !== 0) return false;
          const el = (e.target as HTMLElement | null)?.closest?.(".drawing-wrap, .inline-image-wrap") as HTMLElement | null;
          const sel = view.state.selection;
          if (!el || !(sel instanceof NodeSelection) || !isObject(sel.node) || !isFloating(sel.node)) return false;
          let pos: number;
          try {
            pos = view.posAtDOM(el, 0);
          } catch {
            return false;
          }
          if (!toggleObject(view, pos)) return false;
          e.preventDefault();
          return true;
        },
      },
      handleKeyDown(view, e) {
        if (e.altKey || e.shiftKey) return false;
        const d = nudgeDelta(e.key, e.ctrlKey || e.metaKey);
        if (!d) return false;
        const objs = selectedObjects(view.state).filter((o) => isFloating(o.node));
        if (!objs.length) return false;
        e.preventDefault();
        moveObjects(view, objs.map((o) => ({ ...o, dx: d.dx, dy: d.dy })));
        return true;
      },
    },
  });
}

/**
 * Shift/Ctrl+click on the object at `pos`: added to (or removed from) the
 * selected floating objects. Returns whether it was handled (an object is
 * selected and both are floating).
 */
export function toggleObject(view: EditorView, pos: number): boolean {
  const sel = view.state.selection;
  const node = view.state.doc.nodeAt(pos);
  if (!(sel instanceof NodeSelection) || !isObject(sel.node) || !isFloating(sel.node) || !isObject(node) || !isFloating(node) || pos === sel.from) return false;
  const extra = objectsKey.getState(view.state)?.extra ?? [];
  const next = extra.includes(pos) ? extra.filter((p) => p !== pos) : [...extra, pos];
  view.dispatch(view.state.tr.setMeta(objectsKey, { extra: next }));
  return true;
}

/** Selects the objects at `positions` (the first as the node selection). */
export function selectObjects(view: EditorView, positions: number[]): void {
  const [first, ...rest] = positions;
  if (first == null) return;
  const tr = view.state.tr.setSelection(NodeSelection.create(view.state.doc, first));
  tr.setMeta(objectsKey, { extra: rest });
  view.dispatch(tr);
}

const indentLeft = (view: EditorView, pos: number) => {
  try {
    return ((view.state.doc.resolve(pos).parent.attrs.indent as Indent | null)?.left ?? 0) / TWIPS_PER_PX;
  } catch {
    return 0;
  }
};

/** The anchor of an object node. */
const anchorOf = (n: PMNode): Anchor | null => (n.type.name === "drawing" ? ((n.attrs.value as Drawing).anchor ?? null) : (n.attrs.anchor as Anchor | null));

/** The node with a new anchor. */
function withAnchor(n: PMNode, a: Anchor): Record<string, unknown> {
  if (n.type.name === "drawing") return { value: canonDrawing({ ...(n.attrs.value as Drawing), anchor: a }) };
  return { ...n.attrs, anchor: a };
}

/** Moves floating objects by (dx, dy) px each (one transaction; the selection stays). */
export function moveObjects(view: EditorView, moves: { pos: number; node: PMNode; dx: number; dy: number }[]): boolean {
  let tr = view.state.tr;
  let any = false;
  for (const m of moves) {
    const a = anchorOf(m.node);
    const el = view.nodeDOM(m.pos) as HTMLElement | null;
    if (!a || !el || (!m.dx && !m.dy)) continue;
    const o = renderedOffset(el, indentLeft(view, m.pos));
    tr = tr.setNodeMarkup(m.pos, undefined, withAnchor(m.node, movedAnchor(a, o.x, o.y, m.dx, m.dy)));
    any = true;
  }
  if (!any) return false;
  const sel = view.state.selection;
  if (sel instanceof NodeSelection) tr.setSelection(NodeSelection.create(tr.doc, sel.from));
  tr.setMeta(objectsKey, objectsKey.getState(view.state));
  view.dispatch(tr);
  return true;
}

/** The rendered frame of an object (px, page coordinates, unzoomed); rotation is in the box, so this is its unrotated frame. */
function frameOf(view: EditorView, pos: number): Box | null {
  const el = view.nodeDOM(pos) as HTMLElement | null;
  if (!el?.getBoundingClientRect) return null;
  const r = el.getBoundingClientRect();
  const z = zoomOf(el);
  return { x: r.left / z, y: r.top / z, w: r.width / z, h: r.height / z };
}

/** A picture node as a group member (`kind: picture`). */
function pictureMember(n: PMNode, tempId: number): Drawing {
  const d: Drawing = { id: tempId, kind: "picture", width: n.attrs.width, height: n.attrs.height, preset: "rect", picture: { media: n.attrs.mediaId } };
  const f = n.attrs.format as PictureFormat | null;
  if (f && Object.keys(f).length) d.picture!.format = f;
  if (n.attrs.alt) d.alt = n.attrs.alt;
  if (n.attrs.name) d.name = n.attrs.name;
  return d;
}

/** Whether the selected objects can be grouped (two or more, all floating). */
export function canGroup(state: EditorState): boolean {
  const objs = selectedObjects(state);
  return objs.length >= 2 && objs.every((o) => isFloating(o.node));
}

/** The keys of the objects of the last Ungroup (Regroup finds them again). */
let lastUngroup: string[] = [];

const keyOf = (n: PMNode): string => (n.type.name === "drawing" ? `d:${(n.attrs.value as Drawing).id}` : `i:${n.attrs.mediaId}:${n.attrs.width}x${n.attrs.height}`);

/**
 * Group: the selected floating objects become one floating group anchored
 * where the first one is (its paragraph), at the objects' common frame;
 * pictures become picture members. Returns whether it grouped.
 */
export function groupSelected(view: EditorView): boolean {
  const objs = selectedObjects(view.state);
  if (objs.length < 2 || !objs.every((o) => isFloating(o.node))) return false;
  // z-order: document order (later = on top), as Word without explicit z.
  objs.sort((a, b) => a.pos - b.pos);
  const frames = objs.map((o) => frameOf(view, o.pos));
  if (frames.some((f) => !f)) return false;
  let temp = -1;
  const members = objs.map((o) => {
    if (o.node.type.name === "image") return pictureMember(o.node, temp--);
    const d = { ...(o.node.attrs.value as Drawing) };
    delete d.anchor;
    return d;
  });
  const boxes = frames.map((f) => ({ x: f!.x * EMU_PER_PX, y: f!.y * EMU_PER_PX, w: f!.w * EMU_PER_PX, h: f!.h * EMU_PER_PX }));
  const { children, frame } = groupMembers(members, boxes);
  // Anchor: offsets of the frame from the first object's column and paragraph.
  const first = objs[0]!;
  const firstEl = view.nodeDOM(first.pos) as HTMLElement;
  const o = renderedOffset(firstEl, indentLeft(view, first.pos));
  const f0 = frames[0]!;
  const base = anchorOf(first.node) ?? newAnchor("inFront");
  const anchor = movedAnchor(base, o.x, o.y, frame.x / EMU_PER_PX - f0.x, frame.y / EMU_PER_PX - f0.y);
  const group: Drawing = canonDrawing({ id: temp--, kind: "group", width: frame.w, height: frame.h, preset: "rect", anchor, children });
  let tr = view.state.tr;
  // Remove from the end so that earlier positions stay valid; the group takes the first object's place.
  for (const ob of [...objs].reverse()) tr = tr.delete(ob.pos, ob.pos + ob.node.nodeSize);
  const at = tr.mapping.map(first.pos);
  tr = tr.insert(at, view.state.schema.nodes.drawing!.create({ value: group }));
  tr.setSelection(NodeSelection.create(tr.doc, at));
  tr.setMeta(objectsKey, { extra: [] });
  view.dispatch(tr);
  return true;
}

/** Ungroup: the selected group's members become floating objects of its paragraph at their places. */
export function ungroupSelected(view: EditorView): boolean {
  const sel = view.state.selection;
  if (!(sel instanceof NodeSelection) || sel.node.type.name !== "drawing") return false;
  const g = sel.node.attrs.value as Drawing;
  if (g.kind !== "group" || !g.children?.length) return false;
  const el = view.nodeDOM(sel.from) as HTMLElement | null;
  const base = g.anchor ?? newAnchor("inFront");
  const o = el ? renderedOffset(el, indentLeft(view, sel.from)) : { x: 0, y: 0 };
  const placed = ungroupMembers(g, o.x * EMU_PER_PX, o.y * EMU_PER_PX);
  const schema = view.state.schema;
  const nodes = placed.map(({ member, box }) => {
    const anchor: Anchor = { ...base, h: { relativeTo: "column", place: { kind: "offset", value: Math.round(box.x) } }, v: { relativeTo: "paragraph", place: { kind: "offset", value: Math.round(box.y) } } };
    if (member.kind === "picture" && member.picture) {
      return schema.nodes.image!.create({
        mediaId: member.picture.media,
        width: member.width,
        height: member.height,
        alt: member.alt ?? null,
        name: member.name ?? null,
        anchor,
        format: member.picture.format && Object.keys(member.picture.format).length ? member.picture.format : null,
      });
    }
    return schema.nodes.drawing!.create({ value: canonDrawing({ ...member, anchor }) });
  });
  lastUngroup = nodes.map(keyOf);
  const tr = view.state.tr.replaceWith(sel.from, sel.to, nodes);
  const positions: number[] = [];
  let p = sel.from;
  for (const n of nodes) {
    positions.push(p);
    p += n.nodeSize;
  }
  tr.setSelection(NodeSelection.create(tr.doc, positions[0]!));
  tr.setMeta(objectsKey, { extra: positions.slice(1) });
  view.dispatch(tr);
  return true;
}

/** Whether Regroup has objects to group again. */
export function canRegroup(state: EditorState): boolean {
  return regroupPositions(state).length >= 2;
}

function regroupPositions(state: EditorState): number[] {
  if (lastUngroup.length < 2) return [];
  const want = new Set(lastUngroup);
  const out: number[] = [];
  state.doc.descendants((n, pos) => {
    if (isObject(n) && want.has(keyOf(n))) {
      out.push(pos);
      want.delete(keyOf(n));
    }
    return true;
  });
  return out;
}

/** Regroup: the objects of the last Ungroup grouped again. */
export function regroup(view: EditorView): boolean {
  const positions = regroupPositions(view.state);
  if (positions.length < 2) return false;
  selectObjects(view, positions);
  const ok = groupSelected(view);
  if (ok) lastUngroup = [];
  return ok;
}

/** What Align and Distribute line the objects up with. */
export type AlignTo = "page" | "margin" | "selected";

/** The page / margin box (page coordinates, px) of the page holding the object at `pos`. */
function referenceBox(view: EditorView, pos: number, to: AlignTo): Box | null {
  const el = view.nodeDOM(pos) as HTMLElement | null;
  const frameEl = el?.closest(".write-page") as HTMLElement | null;
  const editor = el?.closest(".ProseMirror") as (HTMLElement & { rusuiteLayout?: { sheets: { top: number; height: number; bodyTop: number; bodyBottom: number; left?: number; width?: number }[] } }) | null;
  const page = view.dom.getBoundingClientRect();
  const z = el ? zoomOf(el) : 1;
  const sheets = editor?.rusuiteLayout?.sheets;
  const fr = frameEl?.getBoundingClientRect() ?? page;
  const r = el?.getBoundingClientRect();
  const y = r ? (r.top - fr.top) / z : 0;
  const s = sheets?.length ? ([...sheets].reverse().find((x) => x.top <= y + 0.5) ?? sheets[0]!) : null;
  // The editor's content box is the margin box horizontally.
  const mx = page.left / z;
  const mw = page.width / z;
  if (to === "margin") {
    if (s) return { x: mx, y: fr.top / z + s.bodyTop, w: mw, h: s.bodyBottom - s.bodyTop };
    return { x: mx, y: page.top / z, w: mw, h: page.height / z };
  }
  const left = fr.left / z;
  const width = fr.width / z;
  if (s) return { x: left, y: fr.top / z + s.top, w: width, h: s.height };
  return { x: left, y: fr.top / z, w: width, h: fr.height / z };
}

/** Align ▾ for the selected objects (relative to the page, the margin or — with several — the selection). */
export function alignSelected(view: EditorView, mode: AlignMode, to: AlignTo): boolean {
  const objs = selectedObjects(view.state).filter((o) => isFloating(o.node));
  if (!objs.length) return false;
  const boxes = objs.map((o) => frameOf(view, o.pos)!);
  if (boxes.some((b) => !b)) return false;
  const ref = to === "selected" && objs.length > 1 ? boundsOf(boxes) : referenceBox(view, objs[0]!.pos, to === "selected" ? "margin" : to);
  if (!ref) return false;
  const moves = alignBoxes(boxes, mode, ref);
  return moveObjects(view, objs.map((o, i) => ({ ...o, ...moves[i]! })));
}

/** Distribute Horizontally / Vertically. */
export function distributeSelected(view: EditorView, axis: "h" | "v", to: AlignTo): boolean {
  const objs = selectedObjects(view.state).filter((o) => isFloating(o.node));
  if (!objs.length) return false;
  const boxes = objs.map((o) => frameOf(view, o.pos)!);
  if (boxes.some((b) => !b)) return false;
  const ref = to === "selected" && objs.length >= 3 ? null : referenceBox(view, objs[0]!.pos, to === "selected" ? "margin" : to);
  const moves = distributeBoxes(boxes, axis, ref);
  return moveObjects(view, objs.map((o, i) => ({ ...o, ...moves[i]! })));
}

const boundsOf = (boxes: Box[]): Box => {
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return { x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y };
};
