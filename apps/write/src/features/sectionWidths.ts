// Print layout with mixed page widths (W-18): node decorations that put the
// top-level blocks of each section into its own text column (moved and
// widened relative to the first section's), so a landscape section's lines
// are as long as on its sheet. The pagination measures the blocks as they
// are drawn (re-measured when the sections change).

import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import type { PageSetup } from "../generated/PageSetup";
import type { Section } from "../generated/Section";
import type { StyleSheet } from "../generated/StyleSheet";
import type { TableProperties } from "../generated/TableProperties";
import { TEXTBLOCK_TYPES, TWIPS_PER_PX } from "../sync/schema";
import { blockShiftCss, sectionFrames } from "./layout/sectionFrames";
import { sectionLayout } from "./pagination";
import { effectiveIndent } from "./wordKeys";

export interface SectionWidthOptions {
  enabled: () => boolean;
  sections: () => Section[];
  page: () => PageSetup | null;
  styles: () => StyleSheet | null | undefined;
}

/** The decorations: `[pos, css]` for every top-level block that leaves the first section's text column. */
export function sectionShifts(doc: PMNode, sections: Section[], page: PageSetup | null, sheet: StyleSheet | null | undefined): [number, string][] {
  if (sections.length < 2) return [];
  const frames = sectionFrames(sections, page);
  const { section } = sectionLayout(doc, sections);
  const out: [number, string][] = [];
  doc.forEach((node, pos, i) => {
    const f = frames.sections[section[i] ?? 0];
    if (!f || node.type.name === "notes") return;
    let css: string | null;
    if (TEXTBLOCK_TYPES.has(node.type.name)) {
      const ind = effectiveIndent(sheet, node);
      css = blockShiftCss("text", f, { left: (ind.left ?? 0) / TWIPS_PER_PX, right: (ind.right ?? 0) / TWIPS_PER_PX });
    } else if (node.type.name === "table") {
      css = blockShiftCss("table", f, undefined, (node.attrs.props as TableProperties | null)?.alignment ?? null);
    } else css = blockShiftCss("other", f);
    if (css) out.push([pos, css]);
  });
  return out;
}

export const sectionWidthKey = new PluginKey<DecorationSet>("rusuiteSectionWidths");

export function sectionWidthPlugin(opts: SectionWidthOptions): Plugin<DecorationSet> {
  const build = (doc: PMNode) =>
    opts.enabled()
      ? DecorationSet.create(
          doc,
          sectionShifts(doc, opts.sections(), opts.page(), opts.styles()).map(([pos, style]) =>
            Decoration.node(pos, pos + doc.nodeAt(pos)!.nodeSize, { style, "data-section-shift": "" }),
          ),
        )
      : DecorationSet.empty;
  return new Plugin<DecorationSet>({
    key: sectionWidthKey,
    state: {
      init: (_c, state) => build(state.doc),
      apply: (tr, old, _o, state) => (tr.docChanged || tr.getMeta(sectionWidthKey) ? build(state.doc) : old),
    },
    props: { decorations: (state) => sectionWidthKey.getState(state) },
  });
}

/** Rebuilds the decorations (sections, page setup, view mode or styles changed). */
export function refreshSectionWidths(view: EditorView): void {
  view.dispatch(view.state.tr.setMeta(sectionWidthKey, true).setMeta("addToHistory", false));
}
