// Editor-side formatting commands used by the toolbar. They change the
// ProseMirror document in place, keeping block ids (so that the mapper can
// send `SetStyle`/`SetParagraphProps`/`SetRunProps` instead of a
// `ReplaceBlocks`).

import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { Alignment } from "../generated/Alignment";
import type { Indent } from "../generated/Indent";
import { propsFromMarks } from "./fromPM";
import type { RunProperties } from "./model";
import { TEXTBLOCK_TYPES } from "./schema";

/** Paragraph styles offered by the style select. */
export const PARAGRAPH_STYLES: { id: string; label: string }[] = [
  { id: "Normal", label: "Normal" },
  { id: "Title", label: "Title" },
  ...[1, 2, 3, 4, 5, 6].map((n) => ({ id: `Heading${n}`, label: `Heading ${n}` })),
];

/** Textblocks touched by the selection: [node, pos]. */
function selectedTextblocks(editor: Editor): [PMNode, number][] {
  const { from, to } = editor.state.selection;
  const out: [PMNode, number][] = [];
  editor.state.doc.nodesBetween(from, to, (node, pos) => {
    if (TEXTBLOCK_TYPES.has(node.type.name)) {
      out.push([node, pos]);
      return false;
    }
    return true;
  });
  return out;
}

/** Style id of a textblock node. */
export function styleOf(node: PMNode): string {
  if (node.type.name === "heading") return `Heading${node.attrs.level}`;
  if (node.type.name === "title") return "Title";
  return (node.attrs.style as string | null) ?? "Normal";
}

/** Sets the paragraph style of the selected paragraphs (keeps ids and properties). */
export function setParagraphStyle(editor: Editor, style: string): boolean {
  const { state } = editor;
  const tr = state.tr;
  const { schema } = state;
  for (const [node, pos] of selectedTextblocks(editor)) {
    const $pos = state.doc.resolve(pos);
    const inListHead = $pos.parent.type.name === "listItem" && $pos.index() === 0;
    const base = { id: node.attrs.id, align: node.attrs.align, indent: node.attrs.indent, spacing: node.attrs.spacing, extra: node.attrs.extra };
    const heading = /^Heading([1-6])$/.exec(style);
    if (!inListHead && heading) tr.setNodeMarkup(pos, schema.nodes.heading, { ...base, level: Number(heading[1]) });
    else if (!inListHead && style === "Title") tr.setNodeMarkup(pos, schema.nodes.title, base);
    else tr.setNodeMarkup(pos, schema.nodes.paragraph, { ...base, style: style === "Normal" ? null : style });
  }
  if (!tr.docChanged) return false;
  editor.view.dispatch(tr);
  return true;
}

export function setAlignment(editor: Editor, align: Alignment): boolean {
  const tr = editor.state.tr;
  for (const [node, pos] of selectedTextblocks(editor)) tr.setNodeMarkup(pos, undefined, { ...node.attrs, align });
  if (!tr.docChanged) return false;
  editor.view.dispatch(tr);
  return true;
}

export function alignmentAt(editor: Editor): Alignment | null {
  const first = selectedTextblocks(editor)[0];
  return (first?.[0].attrs.align as Alignment | null) ?? null;
}

const INDENT_STEP = 720;

/** Indent (+1) or outdent (−1): list level inside lists, left indent elsewhere. */
export function indent(editor: Editor, delta: 1 | -1): boolean {
  if (editor.isActive("listItem")) {
    return delta > 0 ? editor.commands.sinkListItem("listItem") : editor.commands.liftListItem("listItem");
  }
  const tr = editor.state.tr;
  for (const [node, pos] of selectedTextblocks(editor)) {
    const cur = (node.attrs.indent as Indent | null) ?? {};
    const left = Math.max(0, (cur.left ?? 0) + delta * INDENT_STEP);
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: { ...cur, left } });
  }
  if (!tr.docChanged) return false;
  editor.view.dispatch(tr);
  return true;
}

/** Run properties at the selection start (stored marks win). */
export function runPropsAt(editor: Editor): RunProperties {
  const { state } = editor;
  const marks = state.storedMarks ?? state.selection.$from.marks();
  return propsFromMarks(marks);
}

/**
 * Merges `patch` into the `textStyle` mark (font, size, color, highlight)
 * of the selection, keeping the other attributes of each text node.
 */
export function setTextStyle(editor: Editor, patch: Pick<RunProperties, "font" | "size" | "color" | "highlight">): boolean {
  const { state } = editor;
  const type = state.schema.marks.textStyle!;
  const { from, to, empty } = state.selection;
  const tr = state.tr;
  const merged = (attrs: Record<string, unknown> | undefined) => ({
    font: null, size: null, color: null, highlight: null, extra: null, ...(attrs ?? {}), ...patch,
  });
  if (empty) {
    const current = (state.storedMarks ?? state.selection.$from.marks()).find((m) => m.type === type);
    editor.view.dispatch(tr.addStoredMark(type.create(merged(current?.attrs))));
    return true;
  }
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText) return true;
    const start = Math.max(from, pos);
    const end = Math.min(to, pos + node.nodeSize);
    const current = node.marks.find((m) => m.type === type);
    tr.addMark(start, end, type.create(merged(current?.attrs)));
    return false;
  });
  if (!tr.docChanged) return false;
  editor.view.dispatch(tr);
  return true;
}

/** The id and char offset of the cursor's paragraph (for Rust-first commands). */
export function cursorBlock(editor: Editor): { id: number; offset: number; cell: number | null } | null {
  const { $from } = editor.state.selection;
  const block = $from.parent;
  if (!block.isTextblock || block.attrs.id == null) return null;
  let offset = 0;
  let pm = 0;
  block.forEach((child) => {
    if (pm >= $from.parentOffset) return;
    if (child.isText) offset += [...child.text!.slice(0, $from.parentOffset - pm)].length;
    else offset += 1;
    pm += child.nodeSize;
  });
  let cell: number | null = null;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === "tableCell") {
      cell = $from.node(d).attrs.id;
      break;
    }
  }
  // Model-wise the paragraph is a direct child of the cell or the body
  // (lists are flat), so it is the sibling to insert after.
  return { id: block.attrs.id, offset, cell };
}
