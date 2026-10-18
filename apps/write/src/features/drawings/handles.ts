// Adjust handles (Word's yellow dots) of the presets. They come with the
// outline from the core (`shapePaths`: ECMA-376 `a:ahXY` / `a:ahPolar`,
// computed by `core_model::geometry`, the same handles Show's shape editor
// gets); positions are in the query's box (EMU, unflipped, unrotated). The
// math around them (positions, drag inversion, polar handles, rotation and
// flips, keyboard nudging) is shared with Show in ui-shared
// (`geometry/handles.ts`, P9-X1). This module also keeps the keyboard focus
// of a drawing's handles (Tab cycles, arrows nudge, Escape leaves).

import { handleDefs, type HandleDef } from "@rusuite/ui-shared";
import type { ShapeOutline } from "../../generated/ShapeOutline";

export { dragHandle, effectiveAdjust, handlePos, type HandleDef } from "@rusuite/ui-shared";

/** The adjust handles of an outline computed for a `w` × `h` EMU box (none while it loads or for presets without adjust values). */
export function handlesOf(outline: ShapeOutline | null | undefined, w: number, h: number): HandleDef[] {
  return handleDefs(outline?.handles, w, h);
}

/** The last outline seen per drawing: its handles stand in while the outline for new adjust values loads. */
const lastOutline = new Map<number, ShapeOutline>();

/** `outline` (remembered for drawing `id`), or the last one remembered while it is still loading. */
export function outlineFor(id: number, outline: ShapeOutline | null | undefined): ShapeOutline | null {
  if (outline) {
    lastOutline.set(id, outline);
    return outline;
  }
  return lastOutline.get(id) ?? null;
}

/** The adjust handle the keyboard moves: drawing id and handle index (one at a time, like the selection). */
let focus: { id: number; index: number } | null = null;
const listeners = new Set<() => void>();

/** The drawing whose handle has the keyboard focus, or null. */
export function focusedDrawing(): number | null {
  return focus?.id ?? null;
}

/** The focused handle of drawing `id`, or null. */
export function handleFocusOf(id: number): number | null {
  return focus && focus.id === id ? focus.index : null;
}

/** Focuses handle `index` of drawing `id` (null: none). */
export function setHandleFocus(id: number | null, index: number | null): void {
  const next = id === null || index === null ? null : { id, index };
  if (next?.id === focus?.id && next?.index === focus?.index) return;
  focus = next;
  for (const fn of listeners) fn();
}

/** Calls `fn` when the focused handle changes; returns the unsubscribe function. */
export function onHandleFocus(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
