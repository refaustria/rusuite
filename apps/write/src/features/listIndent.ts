// Word's list placement (P9-W1): a list paragraph sits at its numbering
// level's real indent (`w:ind` left / hanging of the level, overlaid by the
// paragraph's own direct indent, as in Word), not at a fixed step per
// nesting level. The label hangs at the first-line position and a tab (the
// level's suffix) moves the text to the hanging indent; `w:lvlJc` aligns
// the label left, centred or right at that position. Paragraphs numbered
// through their style (heading numbering) are placed the same way.
//
// Node decorations carry the placement as CSS variables (`--li-left`,
// `--li-hang`) and the list nodes lose the browser's list padding, so the
// editor, the measured pagination (it reads the DOM) and the print clones
// all show the same geometry.

import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import type { Indent } from "../generated/Indent";
import type { Level } from "../generated/Level";
import type { Numbering } from "../generated/Numbering";
import type { NumberingRef } from "../generated/NumberingRef";
import type { StyleSheet } from "../generated/StyleSheet";
import { listContext, type ListContext } from "../sync/listMapping";
import { TEXTBLOCK_TYPES, TWIPS_PER_PX } from "../sync/schema";
import { paragraphStyleId, resolveParagraph } from "./styleCss";

/** Where a list paragraph goes (twips) and how its label sits. */
export interface ListPlacement {
  left: number;
  /** First-line outdent of the label (0 = the label starts at `left`). */
  hanging: number;
  align: "left" | "center" | "right";
  suffix: "tab" | "space" | "nothing";
  /** A text font of the label (`Courier New`'s "o"); symbol fonts are mapped to Unicode already. */
  font: string | null;
  /** Whether the paragraph shows the label (the first paragraph of a list item, a numbered heading). */
  labelled: boolean;
}

const SYMBOL_FONTS = /^(symbol|wingdings[ 23]*|webdings)$/i;

/** The level of `num` in `numbering`, if defined. */
export function levelOf(numbering: Numbering | null | undefined, num: NumberingRef): Level | null {
  if (!numbering || num.numId <= 0) return null;
  const def = numbering.defs.find((d) => d.id === num.numId);
  return def?.levels[Math.min(8, num.level)] ?? null;
}

/** The label's first-line outdent of an indent (`hanging`, or a negative first line). */
function hangOf(ind: Indent | null | undefined): number | null {
  if (!ind) return null;
  if (ind.firstLine != null) return -ind.firstLine || 0;
  if (ind.hanging != null) return ind.hanging;
  return null;
}

/**
 * The placement of a paragraph on `level` with the direct indent `direct`: the paragraph's own left / first-line
 * values win (Word: direct formatting beats the numbering level), the level gives the rest.
 */
export function placement(level: Level, direct: Indent | null | undefined, labelled = true): ListPlacement {
  const ind = level.indent ?? null;
  const left = direct?.left ?? ind?.left ?? 0;
  const hanging = labelled ? (hangOf(direct) ?? hangOf(ind) ?? 0) : 0;
  const face = level.font?.kind === "named" ? level.font.value : null;
  return {
    left,
    hanging,
    align: level.alignment ?? "left",
    suffix: level.suffix ?? "tab",
    font: face && !SYMBOL_FONTS.test(face) ? face : null,
    labelled,
  };
}

export interface ListIndentMark {
  pos: number;
  node: PMNode;
  /** A paragraph's placement, or null for a list node (it only loses its padding). */
  place: ListPlacement | null;
}

/** Every list node and list paragraph of `doc` with its placement (document order). */
export function listIndentMarks(doc: PMNode, numbering: Numbering | null | undefined, sheet: StyleSheet | null | undefined): ListIndentMark[] {
  const out: ListIndentMark[] = [];
  const styleNum = new Map<string, NumberingRef | null>();
  const numberingOfStyle = (node: PMNode): NumberingRef | null => {
    const id = paragraphStyleId(sheet, node);
    if (!styleNum.has(id)) styleNum.set(id, resolveParagraph(sheet, id).numbering ?? null);
    return styleNum.get(id) ?? null;
  };
  const walk = (parent: PMNode, start: number, ctx: ListContext | null, inItem: boolean) => {
    parent.forEach((child, offset, index) => {
      const pos = start + offset;
      const name = child.type.name;
      if (name === "bulletList" || name === "orderedList") {
        const inner = listContext(child, ctx);
        const placed = levelOf(numbering, { numId: inner.numId, level: inner.level });
        if (placed) out.push({ pos, node: child, place: null });
        walk(child, pos + 1, inner, false);
      } else if (name === "listItem") {
        walk(child, pos + 1, ctx, true);
      } else if (TEXTBLOCK_TYPES.has(name)) {
        const direct = child.attrs.indent as Indent | null;
        if (inItem && ctx) {
          const level = levelOf(numbering, { numId: ctx.numId, level: ctx.level });
          if (level) out.push({ pos, node: child, place: placement(level, direct, index === 0) });
        } else if (child.attrs.listLabel != null) {
          const num = (child.attrs.extra as { numbering?: NumberingRef } | null)?.numbering ?? numberingOfStyle(child);
          const level = num ? levelOf(numbering, num) : null;
          if (level) out.push({ pos, node: child, place: placement(level, direct) });
        }
      } else if (!child.isLeaf) {
        walk(child, pos + 1, null, false);
      }
    });
  };
  walk(doc, 0, null, false);
  return out;
}

const px = (twips: number) => `${(twips / TWIPS_PER_PX).toFixed(2)}px`;

/** The decoration attributes of a placement. */
export function placementAttrs(p: ListPlacement): Record<string, string> {
  const vars = [`--li-left: ${px(p.left)}`, `--li-hang: ${px(p.hanging)}`];
  if (p.font) vars.push(`--li-font: "${p.font.replace(/"/g, "")}"`);
  return {
    class: p.labelled ? "list-ind" : "list-ind list-cont",
    style: vars.join("; "),
    "data-label-align": p.align,
    "data-label-suffix": p.suffix,
  };
}

function build(doc: PMNode, numbering: Numbering | null | undefined, sheet: StyleSheet | null | undefined): DecorationSet {
  const decos = listIndentMarks(doc, numbering, sheet).map((m) =>
    Decoration.node(m.pos, m.pos + m.node.nodeSize, m.place ? placementAttrs(m.place) : { class: "list-word" }),
  );
  return DecorationSet.create(doc, decos);
}

export const listIndentKey = new PluginKey<DecorationSet>("rusuiteListIndent");

/** The decorations; rebuilt on document changes and on `refreshListIndent` (numbering or style changes). */
export function listIndentPlugin(numbering: () => Numbering | null | undefined, styles: () => StyleSheet | null | undefined): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: listIndentKey,
    state: {
      init: (_c, state) => build(state.doc, numbering(), styles()),
      apply: (tr, old, _o, state) => (tr.docChanged || tr.getMeta(listIndentKey) ? build(state.doc, numbering(), styles()) : old),
    },
    props: { decorations: (state) => listIndentKey.getState(state) },
  });
}

export function refreshListIndent(view: EditorView): void {
  view.dispatch(view.state.tr.setMeta(listIndentKey, true).setMeta("addToHistory", false));
}
