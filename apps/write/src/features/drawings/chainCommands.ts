// Shape Format › Text › Create Link / Break Link (P9-W4): linking a text
// box to an empty one makes the second continue the first's story; Break
// Link ends the chain after the selected box (the later boxes become
// empty, standalone text boxes again). The changes are edits of the
// drawings' `chain` (the mapper sends `SetDrawingProps`; the core empties
// a box that joins a chain).

import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { NodeSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import type { Drawing } from "../../generated/Drawing";
import { canonDrawing } from "../../sync/model";

/** Whether a text box holds no text (one empty paragraph). */
export function isEmptyBox(d: Drawing): boolean {
  const blocks = d.text?.blocks ?? [];
  return blocks.every((b) => b.kind === "paragraph" && !(b.value.inlines ?? []).some((i) => i.kind !== "run" || i.value.text.length > 0));
}

export type LinkError = "notTextBox" | "notEmpty" | "linked" | "same" | "hasNext";

/**
 * Linking `source` to `target`: the new chain values of both, or why it is
 * not possible (Word: the target must be an empty text box outside any
 * chain, the source must not link onward already). `nextId` is a chain id
 * not in use.
 */
export function linkBoxes(source: Drawing, target: Drawing, nextId: number, sourceHasNext: boolean): { source: Drawing; target: Drawing } | LinkError {
  if (source.kind !== "textBox" || target.kind !== "textBox") return "notTextBox";
  if (source.id === target.id) return "same";
  if (target.chain) return "linked";
  if (!isEmptyBox(target)) return "notEmpty";
  if (sourceHasNext) return "hasNext";
  const chain = source.chain ?? { id: nextId, seq: 0 };
  return { source: { ...source, chain }, target: { ...target, chain: { id: chain.id, seq: chain.seq + 1 } } };
}

/** Break Link at `source`: the boxes of its chain (any order) with their new values (only the ones that change). */
export function breakAfter(source: Drawing, boxes: Drawing[]): Drawing[] {
  const c = source.chain;
  if (!c) return [];
  const later = boxes.filter((b) => b.chain?.id === c.id && b.chain.seq > c.seq);
  const out = later.map((b) => {
    const d = { ...b };
    delete d.chain;
    return d;
  });
  if (c.seq === 0) {
    const s = { ...source };
    delete s.chain;
    out.push(s);
  }
  return out;
}

/** Every text box of the document with its position (group members are not linked). */
function textBoxes(doc: PMNode): { pos: number; value: Drawing }[] {
  const out: { pos: number; value: Drawing }[] = [];
  doc.descendants((n, pos) => {
    if (n.type.name === "drawing" && n.attrs.value) {
      const d = n.attrs.value as Drawing;
      if (d.kind === "textBox") out.push({ pos, value: d });
      return false;
    }
    return true;
  });
  return out;
}

/** A chain id not in use. */
export function freeChainId(doc: PMNode): number {
  return Math.max(0, ...textBoxes(doc).map((b) => b.value.chain?.id ?? 0)) + 1;
}

/** Whether the text box `d` links onward (a box with the next `seq` exists). */
export function hasNext(doc: PMNode, d: Drawing): boolean {
  const c = d.chain;
  return !!c && textBoxes(doc).some((b) => b.value.chain?.id === c.id && b.value.chain.seq === c.seq + 1);
}

/** Links the text box at `sourcePos` to the one at `targetPos` (one transaction), or says why not. */
export function linkAt(view: EditorView, sourcePos: number, targetPos: number): LinkError | null {
  const doc = view.state.doc;
  const s = doc.nodeAt(sourcePos)?.attrs.value as Drawing | undefined;
  const t = doc.nodeAt(targetPos)?.attrs.value as Drawing | undefined;
  if (!s || !t) return "notTextBox";
  const r = linkBoxes(s, t, freeChainId(doc), hasNext(doc, s));
  if (typeof r === "string") return r;
  const tr = view.state.tr.setNodeMarkup(sourcePos, undefined, { value: canonDrawing(r.source) }).setNodeMarkup(targetPos, undefined, { value: canonDrawing(r.target) });
  tr.setSelection(NodeSelection.create(tr.doc, sourcePos));
  view.dispatch(tr);
  return null;
}

/** Break Link at the text box at `pos`. */
export function breakLinkAt(view: EditorView, pos: number): boolean {
  const s = view.state.doc.nodeAt(pos)?.attrs.value as Drawing | undefined;
  if (!s?.chain) return false;
  const boxes = textBoxes(view.state.doc);
  const changed = breakAfter(s, boxes.map((b) => b.value));
  if (!changed.length) return false;
  let tr = view.state.tr;
  for (const d of changed) {
    const at = boxes.find((b) => b.value.id === d.id);
    if (at) tr = tr.setNodeMarkup(at.pos, undefined, { value: canonDrawing(d) });
  }
  tr.setSelection(NodeSelection.create(tr.doc, pos));
  view.dispatch(tr);
  return true;
}

let linking: (() => void) | null = null;

/** Whether Create Link waits for the box to link to. */
export const linkModeActive = (): boolean => !!linking;

/**
 * Create Link: the next click on an empty text box links the box at
 * `sourcePos` to it (any other click or Escape cancels). `onError` hears
 * why a link was refused.
 */
export function startLinkMode(editor: Editor, sourcePos: number, onError: (e: LinkError) => void): void {
  linking?.();
  const view = editor.view;
  const dom = view.dom as HTMLElement;
  const sourceId = (view.state.doc.nodeAt(sourcePos)?.attrs.value as Drawing | undefined)?.id;
  dom.classList.add("linking-text-box");
  const stop = () => {
    dom.removeEventListener("pointerdown", onDown, true);
    window.removeEventListener("keydown", onKey, true);
    dom.classList.remove("linking-text-box");
    linking = null;
  };
  const onDown = (e: PointerEvent) => {
    const el = (e.target as HTMLElement).closest?.(".drawing-wrap") as HTMLElement | null;
    stop();
    if (!el || el.dataset.kind !== "textBox") return;
    e.preventDefault();
    e.stopPropagation();
    let target: number;
    try {
      target = view.posAtDOM(el, 0);
    } catch {
      return;
    }
    // The source may have moved: find it again by id.
    let source = -1;
    view.state.doc.descendants((n, p) => {
      if (source >= 0) return false;
      if (n.type.name === "drawing" && (n.attrs.value as Drawing | null)?.id === sourceId) source = p;
      return true;
    });
    if (source < 0) return;
    const err = linkAt(view, source, target);
    if (err) onError(err);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") stop();
  };
  dom.addEventListener("pointerdown", onDown, true);
  window.addEventListener("keydown", onKey, true);
  linking = stop;
}
