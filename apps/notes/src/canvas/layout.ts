// Text boxes of canvas pages in the page's one editor (P11-N4). A canvas page keeps all its text in the page doc's
// `"doc"` like a flowing page; each top-level block names its box in the `canvasItem` attribute (notes-format §7.1).
// loro-prosemirror binds one ProseMirror document to the whole `"doc"` map (a sub-range of `children` cannot be
// bound), so instead of one editor per box the page keeps its single editor and this plugin lays its top-level blocks
// out as boxes: node decorations position every block absolutely (the box's x, the box's y plus the heights of the
// box's earlier blocks, the box's width); after each update the plugin view measures the blocks and feeds the heights
// back (a meta transaction, never a document change – the binding rule "no plugin edits the document").
//
// Blocks without a valid `canvasItem` (pasted from elsewhere, the genesis paragraph) belong to the box of the block
// before them (leading ones: to the first box); with no box at all they form an implicit box at (0, 0), hidden while
// empty.

import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { loroSyncPluginKey } from "loro-prosemirror";
import type { CanvasSteps } from "./model";

/** A positioned item in surface px (100 %); `z` = stacking order. */
export interface LayoutItem {
  id: string;
  x: number;
  y: number;
  /** 0 = automatic width. */
  w: number;
  z: number;
}

/** A laid-out text box (surface px). `implicit`: the orphan blocks' box (no canvas item). */
export interface BoxLayout {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  /** Top-level block indices, in document order. */
  blocks: number[];
  /** Document range of the first and after the last block (for deleting a box's text). */
  ranges: Array<[number, number]>;
  empty: boolean;
  implicit: boolean;
}

/** The implicit box of blocks without a box (no canvas item). */
export const IMPLICIT_BOX = "";
/** Space between the blocks of a box (px). */
export const BLOCK_GAP_PX = 5;
/** Automatic box width: up to this wide (px). */
export const AUTO_MAX_W = 600;
/** Height assumed for blocks not measured yet. */
const DEFAULT_H = 20;

/** Box of every top-level block: its `canvasItem` if that is a text item, else the previous block's box. */
export function assignBlocks(attrs: readonly (string | null | undefined)[], textItems: ReadonlySet<string>): string[] {
  const valid = (a: string | null | undefined): a is string => !!a && textItems.has(a);
  const first = attrs.find(valid) ?? IMPLICIT_BOX;
  let cur = first;
  return attrs.map((a) => (valid(a) ? (cur = a) : cur));
}

/**
 * Block tops and boxes. `heights`/`widths` are measured per block (missing → defaults); items not referenced by any
 * block get no box. The implicit box sits at (0, 0) above everything else.
 */
export function layoutBoxes(
  blocks: ReadonlyArray<{ box: string; from: number; to: number; empty: boolean }>,
  items: ReadonlyMap<string, LayoutItem>,
  heights: readonly number[],
  widths: readonly number[],
): { tops: number[]; boxes: BoxLayout[] } {
  const boxes = new Map<string, BoxLayout>();
  const tops: number[] = [];
  blocks.forEach((b, i) => {
    let box = boxes.get(b.box);
    if (!box) {
      const it = items.get(b.box);
      box = { id: b.box, x: it?.x ?? 0, y: it?.y ?? 0, w: it?.w ?? 0, h: 0, z: it?.z ?? 0, blocks: [], ranges: [], empty: true, implicit: !it };
      boxes.set(b.box, box);
    }
    const h = heights[i] ?? DEFAULT_H;
    const top = box.y + box.h + (box.blocks.length ? BLOCK_GAP_PX : 0);
    tops.push(top);
    box.h = top + h - box.y;
    box.blocks.push(i);
    box.ranges.push([b.from, b.to]);
    box.empty &&= b.empty;
  });
  for (const box of boxes.values()) {
    if (!(items.get(box.id)?.w ?? 0)) box.w = Math.max(40, ...box.blocks.map((i) => widths[i] ?? 0));
  }
  return { tops, boxes: [...boxes.values()] };
}

/** Whether a top-level block is an empty paragraph (an empty box is removed when another one is created). */
export function isEmptyBlock(node: PMNode): boolean {
  return node.type.name === "paragraph" && node.content.size === 0;
}

interface LayoutState {
  enabled: boolean;
  items: Map<string, LayoutItem>;
  heights: number[];
  widths: number[];
  boxes: BoxLayout[];
  /** Box of each top-level block. */
  assign: string[];
  decos: DecorationSet;
}

export type LayoutMeta = Partial<Pick<LayoutState, "enabled" | "heights" | "widths">> & { items?: readonly LayoutItem[] };

export const canvasLayoutKey = new PluginKey<LayoutState>("notesCanvasLayout");

function compute(doc: PMNode, s: Omit<LayoutState, "boxes" | "assign" | "decos">): LayoutState {
  if (!s.enabled) return { ...s, boxes: [], assign: [], decos: DecorationSet.empty };
  const textIds = new Set(s.items.keys());
  const attrs: (string | null)[] = [];
  const spans: Array<{ from: number; to: number; empty: boolean }> = [];
  doc.forEach((node, offset) => {
    attrs.push((node.attrs.canvasItem as string | null | undefined) ?? null);
    spans.push({ from: offset, to: offset + node.nodeSize, empty: isEmptyBlock(node) });
  });
  const assign = assignBlocks(attrs, textIds);
  const blocks = spans.map((sp, i) => ({ ...sp, box: assign[i]! }));
  const { tops, boxes } = layoutBoxes(blocks, s.items, s.heights, s.widths);
  const byId = new Map(boxes.map((b) => [b.id, b]));
  const decos = blocks.map((b, i) => {
    const box = byId.get(b.box)!;
    const it = s.items.get(b.box);
    const hidden = box.implicit && box.empty;
    const width = it && it.w > 0 ? `width:${it.w}px` : `width:max-content;max-width:${AUTO_MAX_W}px`;
    const style = hidden ? "display:none" : `left:${box.x}px;top:${tops[i]}px;${width};z-index:${2 + box.z}`;
    return Decoration.node(b.from, b.to, { style, "data-canvas-box": b.box || "implicit" });
  });
  return { ...s, boxes, assign, decos: DecorationSet.create(doc, decos) };
}

const near = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]!) < 0.5);

/** Measures the top-level blocks; dispatches their sizes when they changed. */
function measure(view: EditorView): void {
  const st = canvasLayoutKey.getState(view.state);
  if (!st?.enabled) return;
  const heights: number[] = [];
  const widths: number[] = [];
  view.state.doc.forEach((_node, offset) => {
    const dom = view.nodeDOM(offset) as HTMLElement | null;
    heights.push(dom?.offsetHeight ?? DEFAULT_H);
    widths.push(dom?.offsetWidth ?? 0);
  });
  if (near(heights, st.heights) && near(widths, st.widths)) return;
  view.dispatch(view.state.tr.setMeta(canvasLayoutKey, { heights, widths } satisfies LayoutMeta).setMeta("addToHistory", false));
}

/** The boxes of the editor's canvas layout (empty while the page flows). */
export function canvasBoxes(state: EditorState): BoxLayout[] {
  return canvasLayoutKey.getState(state)?.boxes ?? [];
}

/** Sets the layout's inputs (canvas on/off, items). */
export function setLayout(view: EditorView, meta: LayoutMeta): void {
  view.dispatch(view.state.tr.setMeta(canvasLayoutKey, meta).setMeta("addToHistory", false));
}

export interface CanvasLayoutOptions {
  /** The page's canvas undo steps (merging resumes after the editor's next commit). */
  steps: CanvasSteps | null;
}

export const CanvasLayout = Extension.create<CanvasLayoutOptions>({
  name: "notesCanvasLayout",
  addOptions: () => ({ steps: null }),
  addProseMirrorPlugins() {
    const steps = this.options.steps;
    return [
      new Plugin<LayoutState>({
        key: canvasLayoutKey,
        state: {
          init: (_c, state) => compute(state.doc, { enabled: false, items: new Map(), heights: [], widths: [] }),
          apply: (tr: Transaction, prev, _old, state) => {
            const meta = tr.getMeta(canvasLayoutKey) as LayoutMeta | undefined;
            if (!meta && !tr.docChanged) return prev;
            const next = {
              enabled: meta?.enabled ?? prev.enabled,
              items: meta?.items ? new Map(meta.items.map((i) => [i.id, i])) : prev.items,
              heights: meta?.heights ?? prev.heights,
              widths: meta?.widths ?? prev.widths,
            };
            return compute(state.doc, next);
          },
        },
        props: {
          decorations: (state) => canvasLayoutKey.getState(state)?.decos ?? DecorationSet.empty,
        },
        appendTransaction: (trs) => {
          // The binding commits the editor's change to Loro in its "doc-changed" transaction.
          if (trs.some((tr) => (tr.getMeta(loroSyncPluginKey) as { type?: string } | undefined)?.type === "doc-changed")) steps?.afterForeignCommit();
          return null;
        },
        view: (view) => {
          let pending = false;
          const schedule = () => {
            if (pending) return;
            pending = true;
            queueMicrotask(() => {
              pending = false;
              if (!view.isDestroyed) measure(view);
            });
          };
          // Web fonts and images change heights after the first layout.
          void document.fonts?.ready.then(schedule);
          const onLoad = () => schedule();
          view.dom.addEventListener("load", onLoad, true);
          schedule();
          return {
            update: schedule,
            destroy: () => view.dom.removeEventListener("load", onLoad, true),
          };
        },
      }),
    ];
  },
});
