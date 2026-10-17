// Unequal text columns (Layout › Columns › More Columns… without "Equal
// column width", `w:cols w:equalWidth="0"` with per-column `w:col`), P9-W5.
//
// CSS multi-column layout only knows equal columns, so an unequal box is
// laid out as explicit column boxes: the box keeps n equal CSS columns
// without a gap (`columnsCss`), which decides where the content breaks (the
// pagination's column-break markers and balancing work unchanged), and each
// child block is moved into the place and width of the column it starts in
// with a margin pair: in CSS column k (origin k·T/n) a block with
// `margin-left = X_k − k·T/n` and `margin-right = T/n − w_k − margin-left` is
// exactly w_k wide at X_k (X_k = the column's x of the section's
// `columnLayout`). Margins change the line breaks and so the heights, so the
// plugin re-checks after each layout until every child sits in the column
// its margins are for (a few passes at most). A paragraph that continues in
// the next column keeps the width of the column it starts in (documented in
// docs/write-layout.md).

import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import type { Columns } from "../generated/Columns";
import { isUnequal, TWIPS_PER_PX } from "../sync/schema";
import { columnLayout } from "./columns";

export const unequalColumnsKey = new PluginKey<DecorationSet>("rusuiteUnequalColumns");

/** Column `k`'s margins (px) for a box `total` px wide with n equal CSS columns, given the model columns' x / width (px). */
export function columnMargins(total: number, n: number, k: number, x: number, width: number): { left: number; right: number } {
  const slot = total / Math.max(1, n);
  const left = x - k * slot;
  return { left, right: slot - width - left };
}

/** The columns' x and width (px) of `c` in a box `total` px wide (the model's `columnLayout`). */
export function columnBoxes(c: Columns, total: number): { x: number; width: number }[] {
  let x = 0;
  return columnLayout(c, total * TWIPS_PER_PX).map((col) => {
    const out = { x: x / TWIPS_PER_PX, width: col.width / TWIPS_PER_PX };
    x += col.width + col.space;
    return out;
  });
}

/** The CSS column (0-based) a fragment starting at `left` px from the box sits in, its current margin-left removed. */
export function cssColumnOf(left: number, marginLeft: number, total: number, n: number): number {
  const slot = total / Math.max(1, n);
  return Math.max(0, Math.min(n - 1, Math.round((left - marginLeft) / slot)));
}

/** child PM position → column it is laid out for. */
type Assignment = Map<number, number>;

function decorations(view: EditorView, assign: Assignment, geometry: Map<number, { total: number; n: number; boxes: { x: number; width: number }[] }>): DecorationSet {
  const decos: Decoration[] = [];
  const doc = view.state.doc;
  doc.forEach((box, boxPos) => {
    const g = geometry.get(boxPos);
    if (box.type.name !== "columns" || !g) return;
    box.forEach((child, off) => {
      const pos = boxPos + 1 + off;
      const k = assign.get(pos) ?? 0;
      const b = g.boxes[k];
      if (!b) return;
      const m = columnMargins(g.total, g.n, k, b.x, b.width);
      decos.push(Decoration.node(pos, pos + child.nodeSize, { style: `margin-left: ${m.left.toFixed(2)}px; margin-right: ${m.right.toFixed(2)}px`, "data-ucol": String(k) }));
    });
  });
  return DecorationSet.create(doc, decos);
}

/** Reads where every child of the unequal boxes is; null when nothing changed. */
function measure(view: EditorView, prev: Assignment): { assign: Assignment; geometry: Map<number, { total: number; n: number; boxes: { x: number; width: number }[] }>; changed: boolean } | null {
  const assign: Assignment = new Map();
  const geometry = new Map<number, { total: number; n: number; boxes: { x: number; width: number }[] }>();
  let changed = false;
  let any = false;
  view.state.doc.forEach((box, boxPos) => {
    const c = box.attrs.columns as Columns | null;
    if (box.type.name !== "columns" || !isUnequal(c)) return;
    const el = view.nodeDOM(boxPos) as HTMLElement | null;
    if (!el?.getBoundingClientRect) return;
    any = true;
    const r = el.getBoundingClientRect();
    const zoom = el.offsetWidth ? r.width / el.offsetWidth || 1 : 1;
    const total = el.offsetWidth || r.width / zoom;
    const n = c!.count;
    geometry.set(boxPos, { total, n, boxes: columnBoxes(c!, total) });
    box.forEach((_child, off) => {
      const pos = boxPos + 1 + off;
      const dom = view.nodeDOM(pos) as HTMLElement | null;
      const first = dom?.getClientRects?.()[0];
      const cur = prev.get(pos) ?? 0;
      let k = cur;
      if (first && dom) {
        const ml = parseFloat(getComputedStyle(dom).marginLeft) || 0;
        k = cssColumnOf((first.left - r.left) / zoom, ml, total, n);
      }
      assign.set(pos, k);
      if (k !== cur || !prev.has(pos)) changed = true;
    });
  });
  if (!any) return prev.size ? { assign, geometry, changed: true } : null;
  return { assign, geometry, changed };
}

/** The plugin: decorations with each child's margins, refreshed after layout changes. */
export function unequalColumnsPlugin(): Plugin<DecorationSet> {
  let assign: Assignment = new Map();
  return new Plugin<DecorationSet>({
    key: unequalColumnsKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, old) {
        const meta = tr.getMeta(unequalColumnsKey) as DecorationSet | undefined;
        if (meta) return meta;
        return old.map(tr.mapping, tr.doc);
      },
    },
    props: { decorations: (state) => unequalColumnsKey.getState(state) },
    view(view) {
      let frame = 0;
      let passes = 0;
      const check = () => {
        frame = 0;
        const m = measure(view, assign);
        if (!m) return;
        if (!m.changed) {
          passes = 0;
          return;
        }
        assign = m.assign;
        view.dispatch(view.state.tr.setMeta(unequalColumnsKey, decorations(view, assign, m.geometry)).setMeta("addToHistory", false));
        // The margins change the line breaks: look again (bounded; a child moving back and forth stops after 6 passes).
        if (++passes < 6) schedule();
        else passes = 0;
      };
      const schedule = () => {
        if (!frame && typeof requestAnimationFrame !== "undefined") frame = requestAnimationFrame(check);
      };
      const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => schedule()) : null;
      ro?.observe(view.dom);
      schedule();
      return {
        update(v, prevState) {
          if (v.state.doc !== prevState.doc) {
            // Positions moved: measure every child again (the DOM margins tell which column each is laid out for).
            assign = new Map();
            passes = 0;
            schedule();
          }
        },
        destroy() {
          if (frame) cancelAnimationFrame(frame);
          ro?.disconnect();
        },
      };
    },
  });
}
