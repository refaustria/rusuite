// Hyperlinks (Insert › Link, Ctrl+K) and bookmarks (Insert › Bookmark,
// Go To): what the dialogs start from, the Rust commands they send, and
// Ctrl+click following (internal links scroll to the bookmark or heading,
// external ones open through an anchor element — no `window.open`,
// docs/mobile-plan.md).

import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection, type EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import type { Hyperlink } from "../generated/Hyperlink";
import type { LinkTarget } from "../generated/LinkTarget";
import type { WriteCommand } from "../generated/WriteCommand";
import { charOffsetOf, findPos, pmOffsetOf } from "../sync/SyncPlugin";
import { linkHref, TEXTBLOCK_TYPES } from "../sync/schema";
import { stableStringify } from "../sync/model";
import { currentLayout } from "./pagination";

// ----- links at the caret ---------------------------------------------------------------

/** A link's extent in one paragraph: PM positions, char offsets, the link. */
export interface LinkRange {
  block: number;
  from: number;
  to: number;
  fromOffset: number;
  toOffset: number;
  link: Hyperlink;
  text: string;
}

/** The link mark of a text node, if any. */
const linkOf = (n: PMNode | null | undefined): Hyperlink | null =>
  (n?.marks.find((m) => m.type.name === "link")?.attrs.link as Hyperlink | null | undefined) ?? null;

const sameLink = (a: Hyperlink | null, b: Hyperlink | null) => !!a && !!b && stableStringify(a) === stableStringify(b);

/** The link around position `pos` (inside it or touching its end), or null. */
export function linkAt(state: EditorState, pos: number): LinkRange | null {
  const $p = state.doc.resolve(pos);
  const para = $p.parent;
  if (!para.isTextblock || para.attrs.id == null) return null;
  const start = $p.start();
  // The text node at the position (or just before it).
  const at = $p.parentOffset;
  let link: Hyperlink | null = null;
  let offset = 0;
  const spans: { from: number; to: number; link: Hyperlink | null; node: PMNode }[] = [];
  para.forEach((child) => {
    spans.push({ from: offset, to: offset + child.nodeSize, link: child.isText ? linkOf(child) : null, node: child });
    offset += child.nodeSize;
  });
  const hit = spans.find((s) => s.link && s.from <= at && at < s.to) ?? spans.find((s) => s.link && s.to === at);
  if (!hit) return null;
  link = hit.link;
  let i = spans.indexOf(hit);
  let j = i;
  // Markers and other links break nothing in between only when the link continues.
  while (i > 0 && (sameLink(spans[i - 1]!.link, link) || (spans[i - 1]!.node.isAtom && !spans[i - 1]!.node.isText && i > 1 && sameLink(spans[i - 2]!.link, link)))) i--;
  while (j < spans.length - 1 && (sameLink(spans[j + 1]!.link, link) || (spans[j + 1]!.node.isAtom && !spans[j + 1]!.node.isText && j + 2 < spans.length && sameLink(spans[j + 2]!.link, link)))) j++;
  const fromPm = spans[i]!.from;
  const toPm = spans[j]!.to;
  return {
    block: para.attrs.id as number,
    from: start + fromPm,
    to: start + toPm,
    fromOffset: charOffsetOf(para, fromPm),
    toOffset: charOffsetOf(para, toPm),
    link: link!,
    text: para.textBetween(fromPm, toPm, "", ""),
  };
}

/** What Insert › Link starts from: the link at the selection, else the selected text (one paragraph). */
export interface LinkDialogInit {
  block: number;
  from: number;
  to: number;
  /** "Text to display" (empty for a caret: the address is shown). */
  text: string;
  link: Hyperlink | null;
  /** The selection spans paragraphs or non-text: the text cannot be edited. */
  textFixed: boolean;
}

export function linkDialogInit(state: EditorState): LinkDialogInit | null {
  const { from, to, $from, $to } = state.selection;
  const at = linkAt(state, from);
  if (at && (from === to || (from >= at.from && to <= at.to))) {
    return { block: at.block, from: at.fromOffset, to: at.toOffset, text: at.text, link: at.link, textFixed: false };
  }
  if (!$from.parent.isTextblock || $from.parent.attrs.id == null) return null;
  const para = $from.parent;
  const sameBlock = $from.parent === $to.parent;
  const end = sameBlock ? $to.parentOffset : para.content.size;
  const text = para.textBetween($from.parentOffset, end, "", "￼");
  return {
    block: para.attrs.id as number,
    from: charOffsetOf(para, $from.parentOffset),
    to: charOffsetOf(para, end),
    text: text.replace(/￼/g, ""),
    link: null,
    textFixed: !sameBlock || text.includes("￼"),
  };
}

/** `SetHyperlink` for the dialog's result (the text only when it changed or nothing was selected). */
export function hyperlinkCommand(init: LinkDialogInit, link: Hyperlink, text: string): WriteCommand {
  const shown = text.length ? text : addressOf(link.target);
  const cmd: WriteCommand = { type: "setHyperlink", block: init.block, from: init.from, to: init.to, link };
  if (!init.textFixed && (init.from === init.to || shown !== init.text)) cmd.text = shown;
  return cmd;
}

/** Remove Link: the link around the caret (or the selected text's links). */
export function removeLinkCommand(state: EditorState): WriteCommand | null {
  const init = linkDialogInit(state);
  if (!init || init.from === init.to) return null;
  return { type: "removeHyperlink", block: init.block, from: init.from, to: init.to };
}

/** The address a link shows when it has no text: the URL, the e-mail address, the bookmark name. */
export function addressOf(t: LinkTarget): string {
  return t.kind === "url" ? t.value : t.kind === "email" ? t.value.address : t.value;
}

/** A typed address as a target: `mailto:`/`@` → e-mail, `#name` → bookmark, else a URL (`www.` gets `https://`). */
export function parseAddress(text: string): LinkTarget | null {
  const s = text.trim();
  if (!s) return null;
  if (/^mailto:/i.test(s)) {
    const [address, query] = s.slice(7).split("?");
    const subject = /(?:^|&)subject=([^&]*)/.exec(query ?? "")?.[1];
    return { kind: "email", value: subject ? { address: address!, subject: decodeURIComponent(subject) } : { address: address! } };
  }
  if (/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(s)) return { kind: "email", value: { address: s } };
  if (s.startsWith("#")) return s.length > 1 ? { kind: "bookmark", value: s.slice(1) } : null;
  if (/^www\./i.test(s)) return { kind: "url", value: `https://${s}` };
  return { kind: "url", value: s };
}

// ----- bookmarks -----------------------------------------------------------------------

/** A bookmark of the document as the editor shows it. */
export interface BookmarkInfo {
  id: number;
  name: string;
  /** PM position of its start marker. */
  pos: number;
  /** PM position of its end marker (−1 when missing). */
  end: number;
  hidden: boolean;
}

/** Every bookmark of `doc` (body and notes) in document order. */
export function bookmarksOf(doc: PMNode): BookmarkInfo[] {
  const out: BookmarkInfo[] = [];
  const ends = new Map<number, number>();
  doc.descendants((n, pos) => {
    if (n.type.name === "bookmarkStart") out.push({ id: n.attrs.id, name: String(n.attrs.name ?? ""), pos, end: -1, hidden: String(n.attrs.name ?? "").startsWith("_") });
    else if (n.type.name === "bookmarkEnd" && !ends.has(n.attrs.id)) ends.set(n.attrs.id, pos);
    return true;
  });
  for (const b of out) b.end = ends.get(b.id) ?? -1;
  return out;
}

/** The Bookmark dialog's list: visible bookmarks (hidden ones too with `hidden`), by name or location. */
export function bookmarkList(doc: PMNode, sort: "name" | "location", hidden: boolean): BookmarkInfo[] {
  const list = bookmarksOf(doc).filter((b) => hidden || !b.hidden);
  return sort === "name" ? [...list].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" })) : list;
}

/** Word's bookmark names: a letter (or `_`) first, then letters, digits and `_`, at most 40 characters. */
export function validBookmarkName(name: string): boolean {
  return /^[\p{L}_][\p{L}\p{N}_]{0,39}$/u.test(name);
}

/** A (block, offset) point of a PM position inside a textblock, or null. */
export function pointOf(state: EditorState, pos: number): { block: number; offset: number } | null {
  const $p = state.doc.resolve(pos);
  if (!$p.parent.isTextblock || $p.parent.attrs.id == null || $p.parent.attrs.id < 0) return null;
  return { block: $p.parent.attrs.id as number, offset: charOffsetOf($p.parent, $p.parentOffset) };
}

/** Insert › Bookmark › Add: the selection (or the caret) becomes bookmark `name`. */
export function addBookmarkCommand(state: EditorState, name: string): WriteCommand | null {
  const start = pointOf(state, state.selection.from);
  const end = pointOf(state, state.selection.to);
  if (!start || !end || !validBookmarkName(name)) return null;
  return { type: "addBookmark", name, start, end };
}

/** A fresh hidden bookmark name (`_Ref` + nine digits) not used in `doc`. */
export function freshRefName(doc: PMNode): string {
  const used = new Set(bookmarksOf(doc).map((b) => b.name.toLowerCase()));
  let n = 100000000 + bookmarksOf(doc).length + 1;
  while (used.has(`_ref${n}`)) n++;
  return `_Ref${n}`;
}

// ----- following ----------------------------------------------------------------------

/** Where a link goes: a position in the document, or an external address. */
export type LinkDestination = { kind: "internal"; pos: number } | { kind: "external"; href: string } | { kind: "missing" };

/** Resolves a link: a bookmark (case-insensitive; `_top` = the start) → its position; URLs and e-mail → the href. */
export function resolveLink(doc: PMNode, link: Hyperlink): LinkDestination {
  const t = link.target;
  if (t.kind !== "bookmark") return { kind: "external", href: linkHref(link) };
  if (t.value.toLowerCase() === "_top") return { kind: "internal", pos: 0 };
  const b = bookmarksOf(doc).find((x) => x.name.toLowerCase() === t.value.toLowerCase());
  return b ? { kind: "internal", pos: b.pos } : { kind: "missing" };
}

/** Puts the caret at `pos` (inside the nearest textblock) and scrolls there. */
export function goToPos(view: EditorView, pos: number): void {
  const doc = view.state.doc;
  const at = Math.max(0, Math.min(pos, doc.content.size));
  view.dispatch(view.state.tr.setSelection(TextSelection.near(doc.resolve(at))).scrollIntoView());
  view.focus();
  try {
    const dom = view.domAtPos(at).node as HTMLElement;
    (dom.nodeType === 1 ? dom : dom.parentElement)?.scrollIntoView?.({ block: "center" });
  } catch {
    // no layout (tests)
  }
}

/** Opens an external address in a new tab through an anchor element (works where `window.open` does not). */
export function openExternal(href: string, doc: Document = document): void {
  const a = doc.createElement("a");
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.style.display = "none";
  doc.body.appendChild(a);
  a.click();
  a.remove();
}

/** Follows `link`: internal → the bookmark; external → a new tab. Returns what happened. */
export function followLink(view: EditorView, link: Hyperlink, open: (href: string) => void = openExternal): LinkDestination {
  const dest = resolveLink(view.state.doc, link);
  if (dest.kind === "internal") goToPos(view, dest.pos);
  else if (dest.kind === "external") open(dest.href);
  return dest;
}

/** Selects the text of bookmark `name` (Go To / the Bookmark dialog's Go To). */
export function goToBookmark(view: EditorView, name: string): boolean {
  const b = bookmarksOf(view.state.doc).find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (!b) return false;
  const doc = view.state.doc;
  const from = b.pos + 1;
  const to = b.end > from ? b.end : from;
  view.dispatch(view.state.tr.setSelection(TextSelection.between(doc.resolve(from), doc.resolve(to))).scrollIntoView());
  view.focus();
  return true;
}

// ----- Go To ------------------------------------------------------------------------------

/** Go To › Heading: every heading paragraph (text, position). */
export function headingsOf(doc: PMNode): { id: number; text: string; level: number; pos: number }[] {
  const out: { id: number; text: string; level: number; pos: number }[] = [];
  doc.descendants((n, pos) => {
    if (n.type.name === "notes") return false;
    if (n.type.name === "heading") {
      out.push({ id: n.attrs.id, text: n.textContent, level: n.attrs.level as number, pos });
      return false;
    }
    return !n.isTextblock;
  });
  return out;
}

/** Go To › Page `n` (1-based): the position of the page's first block in print layout, else null. */
export function pageStart(state: EditorState, n: number): number | null {
  const layout = currentLayout(state);
  if (!layout) return null;
  if (layout.pageStarts.length) {
    const start = layout.pageStarts[n - 1];
    return start == null ? null : Math.min(state.doc.content.size, start + (start === 0 ? 1 : 0));
  }
  const k = layout.nodePage.findIndex((p) => p === n - 1);
  if (k < 0) return null;
  let pos = 0;
  for (let i = 0; i < k; i++) pos += state.doc.child(i).nodeSize;
  return pos + 1;
}

/** Selection → `[block, offset]` of a textblock id (for the links dialog's "place in this document"). */
export function blockStart(doc: PMNode, id: number): number {
  const pos = findPos(doc, id);
  if (pos < 0) return -1;
  const node = doc.nodeAt(pos);
  return node && TEXTBLOCK_TYPES.has(node.type.name) ? pos + 1 + pmOffsetOf(node, 0) : pos;
}

// ----- the plugin -----------------------------------------------------------------------

export const linksKey = new PluginKey("rusuiteLinks");

/** Ctrl+click (Cmd+click) follows a link; a plain click edits like Word. */
export function linksPlugin(open: (href: string) => void = openExternal): Plugin {
  return new Plugin({
    key: linksKey,
    props: {
      handleClick(view, pos, event) {
        if (!(event.ctrlKey || event.metaKey)) return false;
        const r = linkAt(view.state, pos);
        if (!r) return false;
        event.preventDefault();
        followLink(view, r.link, open);
        return true;
      },
      handleDOMEvents: {
        // Links in a contenteditable must never navigate on their own.
        click: (_view, e) => {
          const a = (e.target as HTMLElement | null)?.closest?.("a.doc-link");
          if (a) e.preventDefault();
          return false;
        },
      },
    },
  });
}
