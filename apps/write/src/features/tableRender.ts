// Rendering of table styles: a node decoration on every table cell with
// its resolved formatting (`tableStyles.resolveCell`: edges, fill,
// padding, vertical alignment, the style's text colour / bold / italic).
// Merged cells come from the cells' `colspan` / `rowspan`. The print view
// clones the editor DOM, so it shows the same.

import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { TableMap } from "@tiptap/pm/tables";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import type { CellProperties } from "../generated/CellProperties";
import type { StyleSheet } from "../generated/StyleSheet";
import type { TableProperties } from "../generated/TableProperties";
import { borderCss, colorCss, TWIPS_PER_PX } from "../sync/schema";
import { resolveCell, tableStyleFor, type ResolvedCell } from "./tableStyles";

export const tableRenderKey = new PluginKey<DecorationSet>("rusuiteTableRender");

/** CSS declarations of a resolved cell. */
export function cellCss(r: ResolvedCell): string {
  const css: string[] = [];
  const b = r.cell.borders ?? {};
  css.push(`border-top: ${borderCss(b.top)}`, `border-left: ${borderCss(b.left)}`, `border-bottom: ${borderCss(b.bottom)}`, `border-right: ${borderCss(b.right)}`);
  const fill = r.cell.shading && r.cell.shading.kind !== "auto" ? colorCss(r.cell.shading) : undefined;
  if (fill) css.push(`background-color: ${fill}`);
  const m = r.cell.margins;
  if (m) {
    const p = (v: number | null | undefined, d: number) => `${((v ?? d) / TWIPS_PER_PX).toFixed(1)}px`;
    css.push(`padding: ${p(m.top, 0)} ${p(m.right, 108)} ${p(m.bottom, 0)} ${p(m.left, 108)}`);
  }
  if (r.cell.verticalAlign) css.push(`vertical-align: ${r.cell.verticalAlign === "center" ? "middle" : r.cell.verticalAlign}`);
  const color = r.run.color && r.run.color.kind !== "auto" ? colorCss(r.run.color) : undefined;
  if (color) css.push(`color: ${color}`);
  if (r.run.bold === true) css.push("font-weight: 700");
  if (r.run.italic === true) css.push("font-style: italic");
  return css.join("; ");
}

/** The direct cell properties of a PM cell node (as `tableFromPM` builds them). */
const cellProps = (cell: PMNode): CellProperties => ({ ...((cell.attrs.extra as CellProperties | null) ?? {}), shading: cell.attrs.shading ?? undefined, width: cell.attrs.width ?? undefined });

/** `[offset in the table, style]` of every cell of a table node. */
export function tableCellStyles(table: PMNode, styles: StyleSheet | null): [number, string][] {
  const map = TableMap.get(table);
  const props = (table.attrs.props as TableProperties | null) ?? {};
  const style = styles ? tableStyleFor(styles.styles, props.style) : null;
  const out: [number, string][] = [];
  const seen = new Set<number>();
  for (const off of map.map) {
    if (seen.has(off)) continue;
    seen.add(off);
    const cell = table.nodeAt(off);
    if (!cell) continue;
    const r = map.findCell(off);
    const rect = { row0: r.top, row1: r.bottom - 1, col0: r.left, col1: r.right - 1 };
    out.push([off, cellCss(resolveCell(style, props, cellProps(cell), rect, map.height, map.width))]);
  }
  return out;
}

/** Decorations for every table of `doc` (cached per table node while the styles stay the same). */
function build(doc: PMNode, styles: StyleSheet | null, cache: WeakMap<PMNode, [number, string][]>): DecorationSet {
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === "table") {
      let cells = cache.get(node);
      if (!cells) {
        cells = tableCellStyles(node, styles);
        cache.set(node, cells);
      }
      for (const [off, style] of cells) {
        const cell = node.nodeAt(off);
        if (cell) decos.push(Decoration.node(pos + 1 + off, pos + 1 + off + cell.nodeSize, { style, "data-styled": "" }));
      }
      return true;
    }
    return node.isBlock && !node.isTextblock;
  });
  return DecorationSet.create(doc, decos);
}

/** The plugin; `styles` returns the document's current style sheet. */
export function tableRenderPlugin(styles: () => StyleSheet | null): Plugin<DecorationSet> {
  let cache = new WeakMap<PMNode, [number, string][]>();
  let last: StyleSheet | null | undefined;
  const current = (doc: PMNode) => {
    const s = styles();
    if (s !== last) {
      last = s;
      cache = new WeakMap();
    }
    return build(doc, s, cache);
  };
  return new Plugin<DecorationSet>({
    key: tableRenderKey,
    state: {
      init: (_c, state: EditorState) => current(state.doc),
      apply: (tr, old, _o, state) => (tr.docChanged || tr.getMeta(tableRenderKey) || styles() !== last ? current(state.doc) : old),
    },
    props: {
      decorations: (state) => tableRenderKey.getState(state),
    },
  });
}

/** Re-renders the tables (after the style sheet changed). */
export function refreshTables(view: EditorView): void {
  view.dispatch(view.state.tr.setMeta(tableRenderKey, true).setMeta("addToHistory", false));
}
