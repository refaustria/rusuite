// Decorations of the page editor (never document edits – spike rule a):
// - tag icons before tagged blocks (OneNote style); a click on a to-do icon ticks it (`checked`);
// - find on page (Ctrl+F) and the search-hit highlight: every match, the current one stronger;
// - a short highlight of the block a task / search result jumped to.

import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { isToDoKind, tagIconSvg, tagLook } from "../tags";
import { NO_ENV, type EditorEnv } from "./env";

// ---- tag icons ------------------------------------------------------------------------------------------------

export const tagsKey = new PluginKey<number>("notesTags");

/** Ticks / unticks the to-do of the block at `pos`. */
export function toggleChecked(view: EditorView, pos: number): boolean {
  const node = view.state.doc.nodeAt(pos);
  if (!node) return false;
  view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked: !node.attrs.checked }));
  return true;
}

function tagWidget(env: EditorEnv, tags: readonly string[], checked: boolean) {
  return (view: EditorView, getPos: () => number | undefined) => {
    const wrap = document.createElement("span");
    wrap.className = "notes-tag-icons";
    wrap.contentEditable = "false";
    wrap.setAttribute("data-testid", "tag-icons");
    for (const id of tags) {
      const def = env.tag(id);
      const look = tagLook(def);
      const todo = isToDoKind(def?.kind ?? (id === "todo" ? "toDo" : undefined));
      const el = document.createElement(todo ? "button" : "span");
      el.className = "notes-tag-icon";
      el.setAttribute("data-tag", id);
      el.innerHTML = tagIconSvg(look.icon, look.color, todo && checked);
      const label = env.tagLabel(id);
      el.title = label;
      if (todo) {
        const b = el as HTMLButtonElement;
        b.type = "button";
        b.setAttribute("role", "checkbox");
        b.setAttribute("aria-checked", String(checked));
        b.setAttribute("aria-label", label);
        b.setAttribute("data-testid", "tag-checkbox");
        b.addEventListener("mousedown", (e) => e.preventDefault());
        b.addEventListener("click", (e) => {
          e.preventDefault();
          const p = getPos();
          if (p !== undefined && view.editable) toggleChecked(view, p - 1);
        });
      } else el.setAttribute("aria-label", label);
      wrap.appendChild(el);
    }
    return wrap;
  };
}

function tagDecorations(doc: PMNode, env: EditorEnv): DecorationSet {
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    const tags = node.attrs.tags;
    if (Array.isArray(tags) && tags.length > 0 && node.isTextblock) {
      const checked = node.attrs.checked === true;
      decos.push(Decoration.widget(pos + 1, tagWidget(env, tags as string[], checked), { side: -1, ignoreSelection: true, key: `tags:${tags.join(",")}:${checked}` }));
      decos.push(Decoration.node(pos, pos + node.nodeSize, { class: checked ? "notes-tagged notes-done" : "notes-tagged" }));
    }
    return !node.isTextblock;
  });
  return DecorationSet.create(doc, decos);
}

// ---- find on page ------------------------------------------------------------------------------------------

export interface FindState {
  query: string;
  /** Matches `[from, to)` in document order. */
  matches: { from: number; to: number }[];
  current: number;
}

export const findKey = new PluginKey<FindState>("notesFind");

/** Case-insensitive matches of `query` in the text blocks of `doc`. */
export function findMatches(doc: PMNode, query: string): { from: number; to: number }[] {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return [];
  const out: { from: number; to: number }[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    // Text of the block with a position per UTF-16 unit (atoms count as one opaque char).
    let text = "";
    const at: number[] = [];
    node.forEach((child, offset) => {
      if (child.isText) {
        const s = child.text ?? "";
        for (let i = 0; i < s.length; i++) at.push(pos + 1 + offset + i);
        text += s;
      } else {
        at.push(pos + 1 + offset);
        text += "￼";
      }
    });
    const lower = text.toLocaleLowerCase();
    for (let i = lower.indexOf(q); i >= 0; i = lower.indexOf(q, i + q.length)) {
      const end = i + q.length - 1;
      if (end < at.length) out.push({ from: at[i]!, to: at[end]! + 1 });
    }
    return false;
  });
  return out;
}

/** Sets the find query (empty clears) and selects the first match at or after the selection. */
export function setFind(view: EditorView, query: string): FindState {
  const matches = findMatches(view.state.doc, query);
  const from = view.state.selection.from;
  const i = matches.findIndex((m) => m.from >= from);
  const st: FindState = { query, matches, current: matches.length ? (i < 0 ? 0 : i) : -1 };
  view.dispatch(view.state.tr.setMeta(findKey, st));
  return st;
}

/** Moves to the next (`dir` 1) or previous (-1) match, selects and scrolls to it. */
export function findStep(view: EditorView, dir: 1 | -1): FindState | null {
  const st = findKey.getState(view.state);
  if (!st || st.matches.length === 0) return st ?? null;
  const current = (st.current + dir + st.matches.length) % st.matches.length;
  const m = st.matches[current]!;
  const next = { ...st, current };
  view.dispatch(view.state.tr.setMeta(findKey, next).setSelection(TextSelection.create(view.state.doc, m.from, m.to)).scrollIntoView());
  return next;
}

/** Selects and scrolls to the current match. */
export function revealCurrent(view: EditorView): void {
  const st = findKey.getState(view.state);
  const m = st?.matches[st.current];
  if (m) view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, m.from, m.to)).scrollIntoView());
}

const EMPTY_FIND: FindState = { query: "", matches: [], current: -1 };

function mapFind(tr: Transaction, st: FindState, doc: PMNode): FindState {
  const meta = tr.getMeta(findKey) as FindState | undefined;
  if (meta) return meta;
  if (!tr.docChanged || !st.query) return st;
  const matches = findMatches(doc, st.query);
  return { ...st, matches, current: matches.length ? Math.max(0, Math.min(st.current, matches.length - 1)) : -1 };
}

// ---- flash (jump target) ---------------------------------------------------------------------------------------

export const flashKey = new PluginKey<{ from: number; to: number } | null>("notesFlash");

/** The document position of the node at `path` (child indices from the doc), or null. */
export function posOfPath(doc: PMNode, path: readonly number[]): number | null {
  let node = doc;
  let pos = 0;
  for (let d = 0; d < path.length; d++) {
    const i = path[d]!;
    if (i >= node.childCount) return null;
    let offset = 0;
    for (let k = 0; k < i; k++) offset += node.child(k).nodeSize;
    pos += offset + (d === 0 ? 0 : 1);
    node = node.child(i);
  }
  return pos;
}

/** Scrolls the node at `path` into view and highlights it for a moment. */
export function flashPath(view: EditorView, path: readonly number[], ms = 2000): boolean {
  const pos = posOfPath(view.state.doc, path);
  if (pos === null) return false;
  const node = view.state.doc.nodeAt(pos);
  if (!node) return false;
  const inside = node.isTextblock ? pos + 1 : pos;
  view.dispatch(view.state.tr.setMeta(flashKey, { from: pos, to: pos + node.nodeSize }).setSelection(TextSelection.near(view.state.doc.resolve(inside))));
  (view.nodeDOM(pos) as HTMLElement | null)?.scrollIntoView?.({ block: "center" });
  setTimeout(() => {
    if (!(view as { isDestroyed?: boolean }).isDestroyed) view.dispatch(view.state.tr.setMeta(flashKey, null));
  }, ms);
  return true;
}

// ---- the extension ---------------------------------------------------------------------------------------------

export interface DecorationsOptions {
  env: EditorEnv;
}

export const NotesDecorations = Extension.create<DecorationsOptions>({
  name: "notesDecorations",
  addOptions: () => ({ env: NO_ENV }),
  addProseMirrorPlugins() {
    const env = () => this.options.env;
    let cache: { doc: PMNode; version: number; set: DecorationSet } | null = null;
    return [
      new Plugin<number>({
        key: tagsKey,
        state: { init: () => 0, apply: (tr, v) => (tr.getMeta(tagsKey) as number | undefined) ?? v },
        props: {
          decorations(state: EditorState) {
            const version = tagsKey.getState(state) ?? 0;
            if (!cache || cache.doc !== state.doc || cache.version !== version) cache = { doc: state.doc, version, set: tagDecorations(state.doc, env()) };
            return cache.set;
          },
        },
      }),
      new Plugin<FindState>({
        key: findKey,
        state: { init: () => EMPTY_FIND, apply: (tr, st, _old, state) => mapFind(tr, st, state.doc) },
        props: {
          decorations(state) {
            const st = findKey.getState(state);
            if (!st || st.matches.length === 0) return null;
            return DecorationSet.create(
              state.doc,
              st.matches.map((m, i) => Decoration.inline(m.from, m.to, { class: i === st.current ? "notes-find notes-find-current" : "notes-find", "data-testid": "find-match" })),
            );
          },
        },
      }),
      new Plugin<{ from: number; to: number } | null>({
        key: flashKey,
        state: {
          init: () => null,
          apply: (tr, v) => {
            const meta = tr.getMeta(flashKey) as { from: number; to: number } | null | undefined;
            if (meta !== undefined) return meta;
            return v && tr.docChanged ? { from: tr.mapping.map(v.from), to: tr.mapping.map(v.to) } : v;
          },
        },
        props: {
          decorations(state) {
            const v = flashKey.getState(state);
            if (!v || v.to <= v.from || v.to > state.doc.content.size) return null;
            return DecorationSet.create(state.doc, [Decoration.node(v.from, v.to, { class: "notes-flash", "data-testid": "flash" })]);
          },
        },
      }),
    ];
  },
});

/** Re-renders the tag icons (tag definitions changed). */
export function refreshTags(view: EditorView): void {
  view.dispatch(view.state.tr.setMeta(tagsKey, (tagsKey.getState(view.state) ?? 0) + 1));
}
