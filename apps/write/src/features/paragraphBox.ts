// Paragraph borders as Word draws them: consecutive paragraphs with the
// same borders form one box (docx `w:pBdr`): the top border above the
// first, the bottom border below the last, the "between" border between
// them, and the spacing between them inside the box. A node decoration on
// the group's members adjusts their borders, margins and padding (the
// borders themselves come from the paragraph's own CSS, see
// `paragraphBoxCss`).

import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { ParagraphBorders } from "../generated/ParagraphBorders";
import type { Spacing } from "../generated/Spacing";
import { stableStringify } from "../sync/model";
import { paraBorderCss, TWIPS_PER_PX } from "../sync/schema";

export const paragraphBoxKey = new PluginKey<DecorationSet>("rusuiteParagraphBox");

const bordersOf = (n: PMNode): ParagraphBorders | null => {
  if (!n.isTextblock) return null;
  const b = (n.attrs.extra as { borders?: ParagraphBorders } | null)?.borders;
  return b && Object.values(b).some((s) => paraBorderCss(s)) ? b : null;
};

/** Default space after a paragraph (twips) when the paragraph sets none (Normal: 8 pt). */
const DEFAULT_AFTER = 160;

/**
 * The extra CSS of member `i` of a group of `n` bordered paragraphs
 * (`null` for a paragraph on its own).
 */
export function groupMemberCss(i: number, n: number, borders: ParagraphBorders, spacing: Spacing | null): string | null {
  if (n < 2) return null;
  const css: string[] = [];
  const px = (tw: number) => `${(tw / TWIPS_PER_PX).toFixed(2)}px`;
  if (i > 0) css.push("border-top: none", `padding-top: ${px(spacing?.before ?? 0)}`, "margin-top: 0");
  if (i < n - 1) {
    const between = paraBorderCss(borders.between);
    css.push(`border-bottom: ${between ?? "none"}`, "margin-bottom: 0");
    // The gap to the next paragraph stays inside the box.
    css.push(`padding-bottom: ${px(spacing?.after ?? DEFAULT_AFTER)}`);
  }
  return css.join("; ");
}

/** Groups of consecutive sibling paragraphs with equal borders, anywhere in `doc`. */
export function borderGroups(doc: PMNode): { pos: number; node: PMNode }[][] {
  const groups: { pos: number; node: PMNode }[][] = [];
  const visit = (parent: PMNode, start: number) => {
    let cur: { pos: number; node: PMNode }[] = [];
    let key = "";
    const flush = () => {
      if (cur.length > 1) groups.push(cur);
      cur = [];
      key = "";
    };
    parent.forEach((child, offset) => {
      const pos = start + offset;
      const b = bordersOf(child);
      if (b) {
        const k = stableStringify(b);
        if (k !== key) flush();
        key = k;
        cur.push({ pos, node: child });
        return;
      }
      flush();
      if (!child.isTextblock && !child.isLeaf) visit(child, pos + 1);
    });
    flush();
  };
  visit(doc, 0);
  return groups;
}

function build(doc: PMNode): DecorationSet {
  const decos: Decoration[] = [];
  for (const g of borderGroups(doc)) {
    const borders = bordersOf(g[0]!.node)!;
    g.forEach((m, i) => {
      const css = groupMemberCss(i, g.length, borders, m.node.attrs.spacing as Spacing | null);
      if (css) decos.push(Decoration.node(m.pos, m.pos + m.node.nodeSize, { style: css, "data-border-group": i === 0 ? "first" : i === g.length - 1 ? "last" : "middle" }));
    });
  }
  return DecorationSet.create(doc, decos);
}

export function paragraphBoxPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: paragraphBoxKey,
    state: {
      init: (_c, state) => build(state.doc),
      apply: (tr, old, _o, state) => (tr.docChanged ? build(state.doc) : old),
    },
    props: { decorations: (state) => paragraphBoxKey.getState(state) },
  });
}
