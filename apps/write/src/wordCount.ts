// Incremental word count for the status bar: the count of every top-level
// ProseMirror node is cached in a WeakMap (nodes are immutable, an edit
// re-creates only the changed top-level node), so a keystroke re-reads one
// block instead of the whole document.

import type { Node as PMNode } from "@tiptap/pm/model";

/** Whitespace-separated words of `text` (CJK without spaces counts as one word per run). */
export function countWords(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

/** Separator for a leaf node: comment and bookmark markers are invisible (no word break), other leaves (images, breaks) separate words. */
const leafText = (leaf: PMNode): string => (/^(comment|bookmark)(Start|End)$/.test(leaf.type.name) ? "" : " ");

/** Words of one node (a paragraph, list, table or multi-column section box); text blocks and leaf nodes inside it are separated by a space. */
export function countNodeWords(node: PMNode): number {
  return countWords(node.textBetween(0, node.content.size, " ", leafText));
}

/** A word counter over documents with its own cache; `countNode` is injectable (tests). */
export function createWordCounter(countNode: (node: PMNode) => number = countNodeWords): (doc: PMNode) => number {
  const cache = new WeakMap<PMNode, number>();
  return (doc) => {
    let total = 0;
    doc.forEach((child) => {
      let n = cache.get(child);
      if (n === undefined) {
        n = countNode(child);
        cache.set(child, n);
      }
      total += n;
    });
    return total;
  };
}

/** Shared counter used by the app. */
export const countDocWords = createWordCounter();
