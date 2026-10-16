// Find highlighting (Ctrl+F): every match in the editor gets a decoration,
// the current one a stronger one; next/previous move the selection. The
// matching rules mirror `write_core::find` (char offsets, simple case
// folding, whole words = no letter/digit/underscore on either side), so
// that "Replace all" (the Rust `FindReplace` command) replaces exactly
// what is highlighted.

import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { pmOffsetOf } from "../sync/SyncPlugin";

export interface FindQuery {
  text: string;
  matchCase: boolean;
  wholeWord: boolean;
}

/** One match as PM positions. */
export interface FindMatch {
  from: number;
  to: number;
}

const fold = (c: string): string => {
  const l = c.toLowerCase();
  return [...l].length === 1 ? l : c;
};
const isWordChar = (c: string | undefined): boolean => c !== undefined && /[\p{L}\p{N}_]/u.test(c);

/**
 * Non-overlapping matches of `pattern` in `text` (both as arrays of
 * Unicode scalars), as `[start, end)` char offsets.
 */
export function findInChars(text: string[], pattern: string[], matchCase: boolean, wholeWord: boolean): [number, number][] {
  const out: [number, number][] = [];
  const n = pattern.length;
  if (n === 0 || n > text.length) return out;
  const eq = (a: string, b: string) => a === b || (!matchCase && fold(a) === fold(b));
  let i = 0;
  while (i + n <= text.length) {
    let hit = true;
    for (let k = 0; k < n && hit; k++) hit = eq(text[i + k]!, pattern[k]!);
    if (hit && wholeWord) hit = !isWordChar(text[i - 1]) && !isWordChar(text[i + n]);
    if (hit) {
      out.push([i, i + n]);
      i += n;
    } else i++;
  }
  return out;
}

/** The chars of a textblock (atoms as U+FFFC, like `Paragraph::text`). */
function blockChars(block: PMNode): string[] {
  const out: string[] = [];
  block.forEach((child) => {
    if (child.isText) out.push(...child.text!);
    else out.push("￼");
  });
  return out;
}

/** All matches of `q` in `doc`, in document order. */
export function findAll(doc: PMNode, q: FindQuery): FindMatch[] {
  const pattern = [...q.text];
  if (!pattern.length) return [];
  const out: FindMatch[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    for (const [s, e] of findInChars(blockChars(node), pattern, q.matchCase, q.wholeWord)) {
      out.push({ from: pos + 1 + pmOffsetOf(node, s), to: pos + 1 + pmOffsetOf(node, e) });
    }
    return false;
  });
  return out;
}

export interface FindState {
  /** The highlighted query; `external` = matches computed by Rust (formatting / wildcards). */
  query: FindQuery | null;
  external?: boolean;
  matches: FindMatch[];
  /** Index of the current match, or -1. */
  current: number;
  decorations: DecorationSet;
}

export const findKey = new PluginKey<FindState>("rusuiteFind");

type FindMeta = { query: FindQuery | null } | { current: number } | { external: FindMatch[] | null };

function decorate(doc: PMNode, matches: FindMatch[], current: number): DecorationSet {
  if (!matches.length) return DecorationSet.empty;
  return DecorationSet.create(
    doc,
    matches.map((m, i) => Decoration.inline(m.from, m.to, { class: i === current ? "find-match find-current" : "find-match" })),
  );
}

/** Index of the first match at or after `pos` (wrapping to 0). */
function firstFrom(matches: FindMatch[], pos: number): number {
  if (!matches.length) return -1;
  const i = matches.findIndex((m) => m.from >= pos);
  return i < 0 ? 0 : i;
}

export function findPlugin(): Plugin<FindState> {
  return new Plugin<FindState>({
    key: findKey,
    state: {
      init: () => ({ query: null, matches: [], current: -1, decorations: DecorationSet.empty }),
      apply(tr: Transaction, prev: FindState, _old: EditorState, state: EditorState): FindState {
        const meta = tr.getMeta(findKey) as FindMeta | undefined;
        let { query, current } = prev;
        if (meta && "external" in meta) {
          if (!meta.external) return { query: null, matches: [], current: -1, decorations: DecorationSet.empty };
          const matches = meta.external;
          const keep = prev.external ? prev.current : -2;
          let cur = keep === -2 ? firstFrom(matches, state.selection.from) : Math.min(keep, matches.length - 1);
          if (!matches.length) cur = -1;
          return { query: { text: "", matchCase: false, wholeWord: false }, external: true, matches, current: cur, decorations: decorate(state.doc, matches, cur) };
        }
        if (prev.external && tr.docChanged && !meta) {
          // Until Rust answers again, the old matches follow the edit.
          const matches = prev.matches
            .map((m) => ({ from: tr.mapping.map(m.from, 1), to: tr.mapping.map(m.to, -1) }))
            .filter((m) => m.to > m.from);
          const cur = Math.min(prev.current, matches.length - 1);
          return { ...prev, matches, current: cur, decorations: decorate(state.doc, matches, cur) };
        }
        if (prev.external && meta && "current" in meta) {
          return { ...prev, current: meta.current, decorations: decorate(state.doc, prev.matches, meta.current) };
        }
        if (prev.external && !(meta && "query" in meta)) return prev;
        if (meta && "query" in meta) {
          query = meta.query;
          current = -2; // recompute from the selection
        } else if (meta && "current" in meta) current = meta.current;
        if (!query) return { query: null, matches: [], current: -1, decorations: DecorationSet.empty };
        if (!tr.docChanged && meta === undefined) return prev;
        const matches = tr.docChanged || (meta && "query" in meta) ? findAll(state.doc, query) : prev.matches;
        if (current === -2) current = firstFrom(matches, state.selection.from);
        if (current >= matches.length) current = matches.length ? 0 : -1;
        return { query, matches, current, decorations: decorate(state.doc, matches, current) };
      },
    },
    props: {
      decorations: (state) => findKey.getState(state)?.decorations ?? null,
    },
  });
}

export function findState(state: EditorState): FindState | null {
  return findKey.getState(state) ?? null;
}

/** Highlights matches computed elsewhere (Rust's `find`: formatting, wildcards); `null` clears them. */
export function setFindMatches(view: EditorView, matches: FindMatch[] | null): void {
  view.dispatch(view.state.tr.setMeta(findKey, { external: matches }).setMeta("addToHistory", false));
}

/** Sets (or with `null`, clears) the highlighted query. */
export function setFindQuery(view: EditorView, query: FindQuery | null): void {
  view.dispatch(view.state.tr.setMeta(findKey, { query: query && query.text ? query : null }).setMeta("addToHistory", false));
}

/** Moves to the next (`dir = 1`) or previous match and selects it; returns its index. */
export function findStep(view: EditorView, dir: 1 | -1): number {
  const st = findState(view.state);
  if (!st || !st.matches.length) return -1;
  const { matches } = st;
  let i: number;
  const cur = matches[st.current];
  const sel = view.state.selection;
  const onCurrent = cur && sel.from === cur.from && sel.to === cur.to;
  if (onCurrent) i = (st.current + dir + matches.length) % matches.length;
  else if (dir > 0) i = firstFrom(matches, sel.from);
  else {
    const before = matches.map((m, k) => [m, k] as const).filter(([m]) => m.from < sel.from);
    i = before.length ? before[before.length - 1]![1] : matches.length - 1;
  }
  const m = matches[i]!;
  view.dispatch(
    view.state.tr.setMeta(findKey, { current: i }).setSelection(TextSelection.create(view.state.doc, m.from, m.to)).scrollIntoView(),
  );
  revealMatch(view, m.from);
  return i;
}

/**
 * Scrolls the match into the middle of the view. ProseMirror's own
 * `scrollIntoView` starts from the DOM selection, which is in the find
 * field while the bar has the focus.
 */
function revealMatch(view: EditorView, pos: number): void {
  try {
    const { node } = view.domAtPos(pos);
    const el = node.nodeType === 1 ? (node as Element) : node.parentElement;
    el?.scrollIntoView?.({ block: "center", inline: "nearest" });
  } catch {
    // no layout
  }
}

/**
 * Replaces the current match (when it is selected) by `text` through an
 * editor transaction (→ `ReplaceText`), then moves to the next match.
 * Returns whether something was replaced.
 */
export function replaceCurrent(view: EditorView, text: string): boolean {
  const st = findState(view.state);
  const cur = st?.matches[st.current];
  const sel = view.state.selection;
  if (!cur || sel.from !== cur.from || sel.to !== cur.to) {
    findStep(view, 1);
    return false;
  }
  const tr = view.state.tr;
  if (text) tr.insertText(text, cur.from, cur.to);
  else tr.delete(cur.from, cur.to);
  view.dispatch(tr);
  findStep(view, 1);
  return true;
}
