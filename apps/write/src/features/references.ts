// References: captions (Insert Caption), cross-references, Update Fields
// (F9) and tables of figures. The commands are Rust-first (`InsertCaption`,
// `InsertCrossReference`, `UpdateFields { refresh }`, `InsertToc {
// caption }`); Rust computes SEQ / REF / NOTEREF, the UI supplies the page
// numbers of its pagination.

import type { Node as PMNode } from "@tiptap/pm/model";
import type { EditorState } from "@tiptap/pm/state";
import type { FieldKind } from "../generated/FieldKind";
import type { RefShow } from "../generated/RefShow";
import type { RefTarget } from "../generated/RefTarget";
import type { WriteCommand } from "../generated/WriteCommand";
import { notesNode } from "../sync/fromPM";
import { charOffsetOf } from "../sync/SyncPlugin";
import { TEXTBLOCK_TYPES } from "../sync/schema";
import { bookmarksOf, headingsOf } from "./links";
import { noteNumbers } from "./numbers";
import { currentLayout, pageAtPos } from "./pagination";
import { fieldValue, type FieldContext } from "./structure";

/** Word's built-in caption labels (more can be added in the dialog). */
export const CAPTION_LABELS = ["Figure", "Table", "Equation"];

/** The reference types of the Cross-reference dialog. */
export type RefType = "numbered" | "heading" | "bookmark" | "footnote" | "endnote" | `caption:${string}`;

/** One "For which" entry. */
export interface RefItem {
  label: string;
  target: RefTarget;
  /** The paragraph (or bookmark start) the reference points at, for its page. */
  pos: number;
}

/** What "Insert reference to" offers per type (Word's lists, above/below omitted). */
export function showOptions(type: RefType): RefShow[] {
  if (type === "footnote" || type === "endnote") return ["number", "noteFormatted", "page"];
  if (type === "numbered" || type === "heading") return ["text", "number", "page"];
  if (type === "bookmark") return ["text", "page", "number"];
  return ["text", "number", "page"]; // captions: entire caption, only label and number, page
}

/** The SEQ identifiers (caption labels) used in `doc`, Word's three first. */
export function captionLabels(doc: PMNode, extra: string[] = []): string[] {
  const out = [...CAPTION_LABELS];
  const add = (l: string) => {
    if (l && !out.some((x) => x.toLowerCase() === l.toLowerCase())) out.push(l);
  };
  extra.forEach(add);
  doc.descendants((n) => {
    if (n.type.name === "field" && (n.attrs.kind as FieldKind)?.kind === "seq") add((n.attrs.kind as Extract<FieldKind, { kind: "seq" }>).value.identifier.replace(/_/g, " "));
    return true;
  });
  return out;
}

/** The text of a textblock as shown (field results instead of the atoms). */
function shownText(n: PMNode): string {
  let s = "";
  n.forEach((c) => {
    if (c.isText) s += c.text;
    else if (c.type.name === "field") s += String(c.attrs.cached ?? "");
    else if (c.type.name === "hardBreak") s += " ";
  });
  return s.trim();
}

/** Body textblocks (not the notes area) with their positions. */
function bodyBlocks(doc: PMNode): { node: PMNode; pos: number }[] {
  const out: { node: PMNode; pos: number }[] = [];
  const area = notesNode(doc);
  const end = area ? doc.content.size - area.nodeSize : doc.content.size;
  doc.nodesBetween(0, end, (n, pos) => {
    if (TEXTBLOCK_TYPES.has(n.type.name)) {
      out.push({ node: n, pos });
      return false;
    }
    return true;
  });
  return out;
}

/** The "For which" list of `type`. */
export function refItems(doc: PMNode, type: RefType): RefItem[] {
  if (type === "heading") return headingsOf(doc).filter((h) => h.id > 0 && h.text.trim()).map((h) => ({ label: h.text, target: { kind: "paragraph", value: h.id }, pos: h.pos }));
  if (type === "bookmark") return bookmarksOf(doc).filter((b) => !b.hidden).map((b) => ({ label: b.name, target: { kind: "bookmark", value: b.name }, pos: b.pos }));
  if (type === "numbered") {
    return bodyBlocks(doc)
      .filter(({ node }) => node.attrs.listLabel && node.attrs.id > 0 && !/^[•◦▪·\-–o]$/.test(String(node.attrs.listLabel)))
      .map(({ node, pos }) => ({ label: `${node.attrs.listLabel} ${node.textContent}`.trim(), target: { kind: "paragraph", value: node.attrs.id }, pos }));
  }
  if (type === "footnote" || type === "endnote") {
    const kind = type === "footnote" ? "foot" : "end";
    const numbers = noteNumbers(doc);
    const texts = new Map<number, string>();
    notesNode(doc)?.forEach((n) => texts.set(n.attrs.id as number, n.textContent.trim()));
    const out: RefItem[] = [];
    const area = notesNode(doc);
    const end = area ? doc.content.size - area.nodeSize : doc.content.size;
    doc.nodesBetween(0, end, (n, pos) => {
      if (n.type.name === "noteRef" && n.attrs.kind === kind) {
        const id = n.attrs.id as number;
        out.push({ label: `${numbers.get(id) ?? "?"} ${texts.get(id) ?? ""}`.trim(), target: { kind: "note", value: id }, pos });
      }
      return true;
    });
    return out;
  }
  const label = type.slice("caption:".length).replace(/\s+/g, "_").toLowerCase();
  return bodyBlocks(doc)
    .filter(({ node }) => {
      let hit = false;
      node.forEach((c) => {
        const k = c.type.name === "field" ? (c.attrs.kind as FieldKind) : null;
        if (k?.kind === "seq" && k.value.identifier.toLowerCase() === label) hit = true;
      });
      return hit && node.attrs.id > 0;
    })
    .map(({ node, pos }) => ({ label: shownText(node), target: { kind: "paragraph", value: node.attrs.id }, pos }));
}

/** The caret as a `(block, offset)` point in a textblock with a real id. */
export function caretPoint(state: EditorState): { block: number; offset: number } | null {
  const { $from } = state.selection;
  if (!$from.parent.isTextblock || $from.parent.attrs.id == null || $from.parent.attrs.id < 0) return null;
  return { block: $from.parent.attrs.id as number, offset: charOffsetOf($from.parent, $from.parentOffset) };
}

/** The page number (numeric) of position `pos` in print layout, or null. */
export function pageOfPos(state: EditorState, pos: number): number | null {
  const layout = currentLayout(state);
  if (!layout) return null;
  return pageAtPos(layout, Math.min(Math.max(pos, 0), state.doc.content.size))?.value ?? null;
}

/** Insert › Cross-reference: the command for `item` shown as `show`; a caption's "number" is its label and number. */
export function crossRefCommand(state: EditorState, type: RefType, item: RefItem, show: RefShow, hyperlink: boolean): WriteCommand | null {
  const at = caretPoint(state);
  if (!at) return null;
  let target = item.target;
  let how = show;
  if (type.startsWith("caption:") && show === "number" && target.kind === "paragraph") {
    target = { kind: "captionLabel", value: target.value };
    how = "text";
  }
  const cmd: WriteCommand = { type: "insertCrossReference", block: at.block, offset: at.offset, target, show: how, hyperlink };
  if (show === "page") cmd.page = pageOfPos(state, item.pos) ?? 1;
  return cmd;
}

/** The block a caption goes with: the selected picture's paragraph, the caret's table, else its paragraph. */
export function captionAnchor(state: EditorState): number | null {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const n = $from.node(d);
    if (n.type.name === "table" && n.attrs.id > 0) return n.attrs.id as number;
  }
  const p = $from.parent;
  return p.isTextblock && p.attrs.id > 0 ? (p.attrs.id as number) : null;
}

/** Insert Caption: `label N` + `text` below (or above) the anchor. */
export function captionCommand(state: EditorState, label: string, below: boolean, text: string, newId: number): WriteCommand | null {
  const anchor = captionAnchor(state);
  if (anchor == null || !label.trim()) return null;
  return { type: "insertCaption", anchor, below, label: label.trim(), text, newId };
}

/** What the caption text box shows: `Figure 1` (the number the new caption will get, counting the captions before the caret). */
export function captionPreview(state: EditorState, label: string, below: boolean): string {
  const id = label.trim().replace(/\s+/g, "_").toLowerCase();
  let n = 1;
  state.doc.nodesBetween(0, below ? Math.min(state.selection.$from.end(), state.doc.content.size) : state.selection.$from.start(), (node) => {
    if (node.type.name === "field" && (node.attrs.kind as FieldKind)?.kind === "seq") {
      const k = node.attrs.kind as Extract<FieldKind, { kind: "seq" }>;
      if (k.value.identifier.toLowerCase() === id) n++;
    }
    return true;
  });
  return `${label.trim()} ${n}`;
}

/** Page (numeric) of every textblock in print layout: `[id, page]` (empty in draft view). */
export function paragraphPages(state: EditorState): [number, number][] {
  const layout = currentLayout(state);
  if (!layout) return [];
  const out: [number, number][] = [];
  state.doc.forEach((top, offset) => {
    if (top.type.name === "notes") return;
    const visit = (n: PMNode, pos: number) => {
      if (n.isTextblock && n.attrs.id > 0) out.push([n.attrs.id as number, pageAtPos(layout, pos + 1)?.value ?? 1]);
      return !n.isTextblock;
    };
    if (visit(top, offset)) top.descendants((n, p) => visit(n, offset + 1 + p));
  });
  return out;
}

/** Ids of the textblocks the selection touches. */
export function selectedBlockIds(state: EditorState): number[] {
  const out: number[] = [];
  const { from, to } = state.selection;
  state.doc.nodesBetween(from, to, (n) => {
    if (n.isTextblock) {
      if (n.attrs.id > 0) out.push(n.attrs.id as number);
      return false;
    }
    return true;
  });
  return out;
}

/**
 * Update Field (F9): the selection's fields (all of them when everything is
 * selected, Ctrl+A F9) — the live values the UI knows (page, date, …) plus
 * Rust's computation of REF / PAGEREF / NOTEREF / SEQ / TITLE / AUTHOR.
 */
export function updateFieldsCommand(state: EditorState, ctx: FieldContext, all: boolean): WriteCommand {
  const scope = all ? null : new Set(selectedBlockIds(state));
  const values: [number, number, string][] = [];
  state.doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const id = node.attrs.id as number | null;
    if (id == null || id < 0 || (scope && !scope.has(id))) return false;
    node.forEach((child, offset) => {
      if (child.type.name !== "field") return;
      const kind = child.attrs.kind as FieldKind;
      // Rust recomputes these itself.
      if (["ref", "pageRef", "noteRef", "seq", "title", "author"].includes(kind.kind)) return;
      const v = fieldValue(kind, pos + 1 + offset, state, ctx);
      if (v != null && v !== child.attrs.cached) values.push([id, charOffsetOf(node, offset), v]);
    });
    return false;
  });
  const refresh = scope ? { pages: paragraphPages(state), blocks: [...scope] } : { pages: paragraphPages(state) };
  return { type: "updateFields", values, refresh };
}

/** Whether the selection covers the whole body (Ctrl+A). */
export function selectsAll(state: EditorState): boolean {
  const { from, to } = state.selection;
  const area = notesNode(state.doc);
  const end = area ? state.doc.content.size - area.nodeSize : state.doc.content.size;
  return from <= 2 && to >= end - 2;
}
