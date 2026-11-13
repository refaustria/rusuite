// Pure helpers over the core's notebook tree (`TreeNode`s, children in order): lookups, the flat page list with
// sub-page levels (OneNote's page list), and the move targets of drag & drop and Tab / Shift+Tab.

import type { TreeNode } from "./generated/TreeNode";

/** Sub-pages go at most two levels deep (levels 0–2, as OneNote). */
export const MAX_PAGE_LEVEL = 2;

export function findNode(tree: readonly TreeNode[], id: string | null | undefined): TreeNode | null {
  if (!id) return null;
  for (const n of tree) {
    if (n.id === id) return n;
    const c = findNode(n.children, id);
    if (c) return c;
  }
  return null;
}

/** The chain of ancestors of `id`, root first (without the node itself). */
export function ancestors(tree: readonly TreeNode[], id: string): TreeNode[] {
  const path: TreeNode[] = [];
  const walk = (nodes: readonly TreeNode[]): boolean => {
    for (const n of nodes) {
      if (n.id === id) return true;
      path.push(n);
      if (walk(n.children)) return true;
      path.pop();
    }
    return false;
  };
  return walk(tree) ? path : [];
}

/** The section a page (or the section itself) belongs to. */
export function sectionOf(tree: readonly TreeNode[], id: string): TreeNode | null {
  const n = findNode(tree, id);
  if (n?.kind === "section") return n;
  return [...ancestors(tree, id)].reverse().find((a) => a.kind === "section") ?? null;
}

/** All sections in display order (groups flattened). */
export function allSections(tree: readonly TreeNode[]): TreeNode[] {
  const out: TreeNode[] = [];
  const walk = (nodes: readonly TreeNode[]) => {
    for (const n of nodes) {
      if (n.kind === "section") out.push(n);
      else if (n.kind === "group") walk(n.children);
    }
  };
  walk(tree);
  return out;
}

export interface FlatPage {
  node: TreeNode;
  level: number;
  /** The page's parent: the section or a page. */
  parent: string;
}

/** The pages of a section in list order (pre-order), with their sub-page level. */
export function flatPages(section: TreeNode | null): FlatPage[] {
  const out: FlatPage[] = [];
  const walk = (nodes: readonly TreeNode[], level: number, parent: string) => {
    for (const n of nodes) {
      if (n.kind !== "page") continue;
      out.push({ node: n, level, parent });
      walk(n.children, level + 1, n.id);
    }
  };
  if (section) walk(section.children, 0, section.id);
  return out;
}

/** Every page of a tree (pre-order). */
export function allPages(tree: readonly TreeNode[]): TreeNode[] {
  const out: TreeNode[] = [];
  const walk = (nodes: readonly TreeNode[]) => {
    for (const n of nodes) {
      if (n.kind === "page") out.push(n);
      walk(n.children);
    }
  };
  walk(tree);
  return out;
}

/** How many levels of sub-pages hang below `node` (0 = none). */
export function subtreeDepth(node: TreeNode): number {
  let d = 0;
  for (const c of node.children) if (c.kind === "page") d = Math.max(d, 1 + subtreeDepth(c));
  return d;
}

export interface MoveTarget {
  parent: string;
  index: number;
}

/**
 * Where a page dropped into the page list goes: `gap` is the gap index in `flat` (0 = before the first entry,
 * `flat.length` = after the last), `level` the sub-page level the pointer asks for. The page moves with its
 * sub-pages; the level is clamped to what the entry above allows (at most one deeper) and to `MAX_PAGE_LEVEL`.
 * `null`: the drop changes nothing that can be expressed (never happens for a valid page).
 */
export function planPageDrop(flat: readonly FlatPage[], section: string, dragged: string, gap: number, level: number): MoveTarget | null {
  const from = flat.findIndex((f) => f.node.id === dragged);
  if (from < 0) return null;
  let end = from + 1;
  while (end < flat.length && flat[end]!.level > flat[from]!.level) end++;
  const depth = subtreeDepth(flat[from]!.node);
  // The list without the moved block, and the gap in it.
  const rest = [...flat.slice(0, from), ...flat.slice(end)];
  const g = gap <= from ? gap : gap >= end ? gap - (end - from) : from;
  const above = rest[g - 1];
  const max = Math.min(above ? above.level + 1 : 0, MAX_PAGE_LEVEL - depth);
  const lvl = Math.max(0, Math.min(level, max));
  if (lvl === 0) return { parent: section, index: rest.slice(0, g).filter((f) => f.level === 0).length };
  // The parent: the nearest entry above at level − 1; the index: its children above the gap.
  let p = g - 1;
  while (p >= 0 && rest[p]!.level !== lvl - 1) p--;
  const parent = rest[p]!;
  const index = rest.slice(p + 1, g).filter((f) => f.level === lvl).length;
  return { parent: parent.node.id, index };
}

/** Tab: the page becomes the last sub-page of the page above it on its level; `null` when it cannot. */
export function indentTarget(flat: readonly FlatPage[], id: string): MoveTarget | null {
  const i = flat.findIndex((f) => f.node.id === id);
  if (i < 0) return null;
  const me = flat[i]!;
  if (me.level + 1 + subtreeDepth(me.node) > MAX_PAGE_LEVEL) return null;
  for (let j = i - 1; j >= 0; j--) {
    const f = flat[j]!;
    if (f.level < me.level) return null;
    if (f.level === me.level) return { parent: f.node.id, index: f.node.children.filter((c) => c.kind === "page").length };
  }
  return null;
}

/** Shift+Tab: the page moves up one level, right after its parent; `null` on level 0. */
export function outdentTarget(flat: readonly FlatPage[], id: string): MoveTarget | null {
  const me = flat.find((f) => f.node.id === id);
  if (!me || me.level === 0) return null;
  const parent = flat.find((f) => f.node.id === me.parent)!;
  const siblings = flat.filter((f) => f.parent === parent.parent && f.level === parent.level);
  return { parent: parent.parent, index: siblings.findIndex((f) => f.node.id === parent.node.id) + 1 };
}

/** Section colours offered in the menus (OneNote-like, readable on light and dark). */
export const SECTION_COLORS = ["#8E6CC7", "#4B8FDB", "#3FA69A", "#6AAF45", "#D6A01E", "#E07B39", "#D9534F", "#C9548F", "#6E7B8B", "#2F6DB5", "#7F9C3A", "#A0522D"];

/** The colour for the n-th new section. */
export function nextSectionColor(existing: number): string {
  return SECTION_COLORS[existing % SECTION_COLORS.length]!;
}
