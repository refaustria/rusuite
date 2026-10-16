// Word's "Don't add space between paragraphs of the same style" (docx
// `w:contextualSpacing`, set by List Paragraph; W-03): the space after a
// paragraph and the space before the next one are dropped when both use the
// same style and the paragraph that owns the space has the option. A node
// decoration on each affected paragraph removes its margin, so the editor,
// the measured flow of the print layout (pagination reads the DOM margins)
// and the printed clones all lose the same space.

import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import type { StyleSheet } from "../generated/StyleSheet";
import { TEXTBLOCK_TYPES } from "../sync/schema";
import { paragraphStyleId, resolveParagraph } from "./styleCss";

/** A paragraph of a run of consecutive paragraphs: its style and its (effective) contextual spacing; `null` = something else in between. */
export interface ContextPara {
  style: string;
  contextual: boolean;
}

/** Which paragraphs of the run lose their space before / after. */
export function contextualGaps(paras: (ContextPara | null)[]): { before: boolean; after: boolean }[] {
  return paras.map((p, i) => {
    const prev = i > 0 ? paras[i - 1] : null;
    const next = i + 1 < paras.length ? paras[i + 1] : null;
    if (!p || !p.contextual) return { before: false, after: false };
    return { before: !!prev && prev.style === p.style, after: !!next && next.style === p.style };
  });
}

/** Containers whose paragraphs continue the surrounding run (list structure, column boxes). */
const FLATTEN = new Set(["bulletList", "orderedList", "listItem", "columns"]);

/** The paragraphs of `doc` that lose their space before / after: [pos, node, before, after]. */
export function contextualSpacingMarks(doc: PMNode, sheet: StyleSheet | null | undefined): { pos: number; node: PMNode; before: boolean; after: boolean }[] {
  const cache = new Map<string, boolean>();
  const contextualOf = (node: PMNode): ContextPara => {
    const style = paragraphStyleId(sheet, node);
    const direct = (node.attrs.extra as { contextualSpacing?: boolean } | null)?.contextualSpacing;
    let fromStyle = cache.get(style);
    if (fromStyle === undefined) {
      fromStyle = !!resolveParagraph(sheet, style).contextualSpacing;
      cache.set(style, fromStyle);
    }
    return { style, contextual: direct ?? fromStyle };
  };
  const out: { pos: number; node: PMNode; before: boolean; after: boolean }[] = [];
  const flush = (run: ({ pos: number; node: PMNode; p: ContextPara } | null)[]) => {
    if (!run.some((r) => r?.p.contextual)) return;
    contextualGaps(run.map((r) => r?.p ?? null)).forEach((g, i) => {
      const r = run[i];
      if (r && (g.before || g.after)) out.push({ pos: r.pos, node: r.node, ...g });
    });
  };
  const walk = (parent: PMNode, start: number, run: ({ pos: number; node: PMNode; p: ContextPara } | null)[]) => {
    parent.forEach((child, offset) => {
      const pos = start + offset;
      const name = child.type.name;
      if (TEXTBLOCK_TYPES.has(name)) run.push({ pos, node: child, p: contextualOf(child) });
      else if (FLATTEN.has(name)) walk(child, pos + 1, run);
      else {
        run.push(null);
        if (!child.isLeaf && !child.isTextblock) {
          const inner: ({ pos: number; node: PMNode; p: ContextPara } | null)[] = [];
          walk(child, pos + 1, inner);
          flush(inner);
        }
      }
    });
  };
  const run: ({ pos: number; node: PMNode; p: ContextPara } | null)[] = [];
  walk(doc, 0, run);
  flush(run);
  return out.sort((a, b) => a.pos - b.pos);
}

export const contextualSpacingKey = new PluginKey<DecorationSet>("rusuiteContextualSpacing");

function build(doc: PMNode, sheet: StyleSheet | null | undefined): DecorationSet {
  const decos = contextualSpacingMarks(doc, sheet).map((m) =>
    Decoration.node(m.pos, m.pos + m.node.nodeSize, { class: [m.before ? "ctx-no-before" : "", m.after ? "ctx-no-after" : ""].filter(Boolean).join(" ") }),
  );
  return DecorationSet.create(doc, decos);
}

/** The decorations; rebuilt on document changes and on `refreshContextualSpacing` (style sheet changes). */
export function contextualSpacingPlugin(styles: () => StyleSheet | null | undefined): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: contextualSpacingKey,
    state: {
      init: (_c, state) => build(state.doc, styles()),
      apply: (tr, old, _o, state) => (tr.docChanged || tr.getMeta(contextualSpacingKey) ? build(state.doc, styles()) : old),
    },
    props: { decorations: (state) => contextualSpacingKey.getState(state) },
  });
}

export function refreshContextualSpacing(view: EditorView): void {
  view.dispatch(view.state.tr.setMeta(contextualSpacingKey, true).setMeta("addToHistory", false));
}
