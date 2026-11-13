// React access to a page mirror's canvas data and to the editor's box layout.

import { useEffect, useMemo, useState } from "react";
import type { Editor } from "@tiptap/core";
import type { LoroDoc } from "loro-crdt";
import { UNDO_MERGE_MS, type PageMirror } from "../editor/mirror";
import { canvasBoxes, type BoxLayout } from "./layout";
import { CANVAS, CanvasSteps, INK, isCanvasPage, META, readItems, readStrokes, type CanvasItem, type InkStroke } from "./model";

const stepsByDoc = new WeakMap<LoroDoc, CanvasSteps>();

/** The canvas undo steps of a page mirror (one per mirror; the editor's layout plugin and the canvas view share it). */
export function canvasStepsFor(mirror: PageMirror): CanvasSteps {
  let s = stepsByDoc.get(mirror.doc);
  if (!s) {
    s = new CanvasSteps(mirror, UNDO_MERGE_MS);
    stepsByDoc.set(mirror.doc, s);
  }
  return s;
}

/** Re-renders when any of the given root containers (or something inside them) changes. */
function useDocVersion(doc: LoroDoc | null, roots: readonly string[]): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!doc) return;
    const unsub = doc.subscribe((batch) => {
      if (batch.events.some((e) => roots.includes(String(e.path[0])))) setV((n) => n + 1);
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc]);
  return v;
}

/** Whether the page is a canvas page (`meta.canvas`, live). */
export function useCanvasMode(mirror: PageMirror | null): boolean {
  const v = useDocVersion(mirror?.doc ?? null, [META]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => (mirror ? isCanvasPage(mirror.doc) : false), [mirror, v]);
}

/** The page's canvas items and strokes (live). */
export function useCanvasData(mirror: PageMirror): { items: CanvasItem[]; strokes: InkStroke[] } {
  const v = useDocVersion(mirror.doc, [CANVAS, INK]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => ({ items: readItems(mirror.doc), strokes: readStrokes(mirror.doc) }), [mirror, v]);
}

/** Number of strokes on the page (the flowing page's "drawings hidden" notice). */
export function useStrokeCount(mirror: PageMirror): number {
  const v = useDocVersion(mirror.doc, [INK]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => mirror.doc.getList(INK).length, [mirror, v]);
}

/** The editor's laid-out boxes and the box holding the selection (re-read on every transaction). */
export function useBoxes(editor: Editor): { boxes: BoxLayout[]; active: string | null } {
  const [, setN] = useState(0);
  useEffect(() => {
    const on = () => setN((n) => n + 1);
    editor.on("transaction", on);
    editor.on("focus", on);
    editor.on("blur", on);
    return () => {
      editor.off("transaction", on);
      editor.off("focus", on);
      editor.off("blur", on);
    };
  }, [editor]);
  if (editor.isDestroyed) return { boxes: [], active: null };
  const boxes = canvasBoxes(editor.state);
  const pos = editor.state.selection.from;
  const active = editor.isFocused ? (boxes.find((b) => b.ranges.some(([a, z]) => pos > a && pos < z))?.id ?? null) : null;
  return { boxes, active };
}
