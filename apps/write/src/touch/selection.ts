// Touch selection helpers (P10-M4): the word under a long press, where the selection handles and the floating bar
// go, and the auto-scroll speed while a handle is dragged near an edge.

import type { Node as PMNode } from "@tiptap/pm/model";

const WORD = /[\p{L}\p{N}\p{M}_'’-]/u;

/** The word range around `pos` in `doc` (PM positions), or null when `pos` is not in or at the end of a word. */
export function wordAt(doc: PMNode, pos: number): { from: number; to: number } | null {
  if (pos < 0 || pos > doc.content.size) return null;
  const $pos = doc.resolve(pos);
  const parent = $pos.parent;
  if (!parent.isTextblock) return null;
  const start = $pos.start();
  // Atoms (fields, images, notes) count as one non-word character.
  const text = parent.textBetween(0, parent.content.size, undefined, "￼");
  const at = pos - start;
  const isWord = (i: number) => i >= 0 && i < text.length && WORD.test(text[i]!);
  let i = isWord(at) ? at : isWord(at - 1) ? at - 1 : -1;
  if (i < 0) return null;
  let a = i;
  while (isWord(a - 1)) a--;
  let b = i + 1;
  while (isWord(b)) b++;
  // Apostrophes and hyphens only inside a word.
  while (a < b && /['’-]/.test(text[a]!)) a++;
  while (b > a && /['’-]/.test(text[b - 1]!)) b--;
  if (a >= b) return null;
  return { from: start + a, to: start + b };
}

/** Distance (px) from an edge of the scroll area where a dragged handle scrolls it. */
export const AUTOSCROLL_ZONE = 40;

/** Scroll speed (px per frame, negative = up) for a pointer at `y` in the band [top, bottom]. */
export function autoScrollSpeed(y: number, top: number, bottom: number): number {
  if (y < top + AUTOSCROLL_ZONE) return -Math.ceil(Math.min(AUTOSCROLL_ZONE, top + AUTOSCROLL_ZONE - y) / 3);
  if (y > bottom - AUTOSCROLL_ZONE) return Math.ceil(Math.min(AUTOSCROLL_ZONE, y - (bottom - AUTOSCROLL_ZONE)) / 3);
  return 0;
}

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Where the floating bar (`w` × `h`) goes for a selection spanning `sel`: centred above it, inside `bounds` (the
 * visible area between the top bar and the command bar or the keyboard, 8 px off its edges); when there is no room
 * above, below the selection (and below its handles: `below` px).
 */
export function barPosition(sel: Box, w: number, h: number, bounds: Box, below = 32): { left: number; top: number } {
  const m = 8;
  const left = Math.max(bounds.left + m, Math.min(bounds.right - m - w, (sel.left + sel.right) / 2 - w / 2));
  let top = sel.top - h - m;
  if (top < bounds.top + m) top = sel.bottom + below;
  top = Math.max(bounds.top + m, Math.min(bounds.bottom - m - h, top));
  return { left, top };
}
