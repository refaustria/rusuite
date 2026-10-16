// The comments editor plugin:
// * keeps a comment range's surviving marker when an edit deletes the
//   other one (the range shrinks to what is left; ends go before typed
//   text, starts after it, as `write_core` does) — deleting the whole
//   range removes both and Rust deletes the comment;
// * highlights the ranges in their author's light colour (the selected /
//   hovered comment darker; only those when comments are hidden), and the
//   range of a comment being written;
// * steps the caret over the invisible markers and reports clicks into a
//   range (the balloon of the innermost comment there becomes active).

import { Mapping } from "@tiptap/pm/transform";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import { SYNC_META } from "../sync/SyncPlugin";
import { RANGE_MARKS } from "../sync/schema";
import { pmRanges, rangeAt, type PmRange } from "./model";

export interface CommentsView {
  /** Show Comments (all ranges highlighted) or not (only the active one). */
  show: boolean;
  active: number | null;
  hover: number | null;
  /** The range of a comment being written. */
  draft: { from: number; to: number } | null;
}

export interface CommentsPluginOptions {
  /** The highlight colour of comment `id` (its author's). */
  color: (id: number) => { light: string; dark: string };
  /** A click put the caret into comment `id`'s range (null: outside any). */
  onActivate: (id: number | null) => void;
  view: () => CommentsView;
}

interface PluginState {
  ranges: PmRange[];
  deco: DecorationSet;
  key: string;
}

export const commentsKey = new PluginKey<PluginState>("rusuiteComments");

const viewKey = (v: CommentsView) => `${v.show}|${v.active}|${v.hover}|${v.draft?.from}-${v.draft?.to}`;

function decorations(doc: PMNode, ranges: PmRange[], v: CommentsView, color: CommentsPluginOptions["color"]): DecorationSet {
  const out: Decoration[] = [];
  for (const r of ranges) {
    const on = r.id === v.active || r.id === v.hover;
    if (!v.show && !on) continue;
    if (r.end <= r.start + 1) continue;
    const c = color(r.id);
    out.push(
      Decoration.inline(r.start + 1, r.end, {
        class: `comment-range${on ? " comment-range-active" : ""}`,
        style: `--comment-bg: ${on ? c.dark : c.light}`,
        "data-comment-range": String(r.id),
      }),
    );
  }
  if (v.draft && v.draft.to > v.draft.from && v.draft.to <= doc.content.size) {
    out.push(Decoration.inline(v.draft.from, v.draft.to, { class: "comment-range comment-range-draft" }));
  }
  return DecorationSet.create(doc, out);
}

/** Every comment and bookmark marker of `doc`: `"c:id"` / `"b:id"` → its start and end (position and node). */
function markers(doc: PMNode): Map<string, { start?: number; end?: number; startNode?: PMNode; endNode?: PMNode }> {
  const out = new Map<string, { start?: number; end?: number; startNode?: PMNode; endNode?: PMNode }>();
  doc.descendants((node, pos) => {
    if (!RANGE_MARKS.has(node.type.name)) return true;
    const key = `${node.type.name.startsWith("comment") ? "c" : "b"}:${node.attrs.id}`;
    const m = out.get(key) ?? {};
    if (node.type.name.endsWith("Start")) {
      m.start ??= pos;
      m.startNode ??= node;
    } else {
      m.end ??= pos;
      m.endNode ??= node;
    }
    out.set(key, m);
    return false;
  });
  return out;
}

/**
 * The transaction re-inserting the markers that `trs` deleted while their
 * partner survived (null when there are none).
 */
export function keepMarkers(trs: readonly Transaction[], before: EditorState, after: EditorState): Transaction | null {
  if (!trs.some((t) => t.docChanged && t.getMeta(SYNC_META) !== "remote")) return null;
  const old = markers(before.doc);
  if (!old.size) return null;
  const now = markers(after.doc);
  const mapping = new Mapping();
  for (const t of trs) mapping.appendMapping(t.mapping);
  const inserts: { pos: number; start: boolean; node: PMNode }[] = [];
  for (const [key, m] of old) {
    const n = now.get(key) ?? {};
    const lostStart = m.start !== undefined && n.start === undefined;
    const lostEnd = m.end !== undefined && n.end === undefined;
    if (lostStart && lostEnd) continue; // the whole range went: so does the comment (bookmark)
    if (lostStart) inserts.push({ pos: mapping.map(m.start!, 1), start: true, node: m.startNode! });
    if (lostEnd) inserts.push({ pos: mapping.map(m.end!, -1), start: false, node: m.endNode! });
  }
  if (!inserts.length) return null;
  // Right to left; at one position starts first, so that ends end up before them.
  inserts.sort((a, b) => b.pos - a.pos || Number(b.start) - Number(a.start));
  const tr = after.tr;
  const schema = after.schema;
  for (const ins of inserts) {
    if (ins.pos < 0 || ins.pos > tr.doc.content.size) continue;
    const $p = tr.doc.resolve(ins.pos);
    if (!$p.parent.inlineContent) continue; // its paragraph is gone: Rust places it
    tr.insert(ins.pos, schema.nodes[ins.node.type.name]!.create(ins.node.attrs));
  }
  if (!tr.docChanged) return null;
  return tr.setMeta("addToHistory", false);
}

/** The caret position past the markers next to `pos` in direction `dir`. */
function skipMarkers(doc: PMNode, pos: number, dir: 1 | -1): number {
  let p = pos;
  for (;;) {
    const $p = doc.resolve(p);
    const n = dir > 0 ? $p.nodeAfter : $p.nodeBefore;
    if (!n || !RANGE_MARKS.has(n.type.name)) return p;
    p += dir;
  }
}

export function commentsPlugin(opts: CommentsPluginOptions): Plugin<PluginState> {
  return new Plugin<PluginState>({
    key: commentsKey,
    state: {
      init(_c, state) {
        const ranges = pmRanges(state.doc);
        const v = opts.view();
        return { ranges, deco: decorations(state.doc, ranges, v, opts.color), key: viewKey(v) };
      },
      apply(tr, prev, _old, state) {
        const v = opts.view();
        const key = viewKey(v);
        if (!tr.docChanged && key === prev.key && !tr.getMeta(commentsKey)) return prev;
        const ranges = tr.docChanged ? pmRanges(state.doc) : prev.ranges;
        return { ranges, deco: decorations(state.doc, ranges, v, opts.color), key };
      },
    },
    appendTransaction: keepMarkers,
    props: {
      decorations(state) {
        return commentsKey.getState(state)?.deco ?? null;
      },
      handleKeyDown(view, e) {
        if ((e.key !== "ArrowLeft" && e.key !== "ArrowRight") || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return false;
        const sel = view.state.selection;
        if (!sel.empty) return false;
        const dir = e.key === "ArrowRight" ? 1 : -1;
        const to = skipMarkers(view.state.doc, sel.from, dir);
        if (to !== sel.from) view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, to)));
        return false; // the browser still moves one character
      },
      handleClick(view, pos) {
        const r = rangeAt(commentsKey.getState(view.state)?.ranges ?? [], pos);
        // After the click is handled: re-rendering the highlight mid-click would lose the DOM selection.
        setTimeout(() => opts.onActivate(r?.id ?? null), 0);
        return false;
      },
    },
  });
}

/** Re-renders the highlights after the comments view (active, hover, shown) changed. */
export function refreshComments(view: EditorView): void {
  if (view.isDestroyed) return;
  // Take over a caret the browser just moved (End, a click) before re-rendering, or it would be reset.
  (view as unknown as { domObserver?: { flush?: () => void } }).domObserver?.flush?.();
  view.dispatch(view.state.tr.setMeta(commentsKey, true).setMeta("addToHistory", false));
}

/** The comment ranges of the editor (from the plugin state). */
export function commentRangesOf(state: EditorState): PmRange[] {
  return commentsKey.getState(state)?.ranges ?? pmRanges(state.doc);
}
