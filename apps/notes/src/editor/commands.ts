// Editor commands shared by the ribbon, the keymap and the shortcut layer.

import type { Editor } from "@tiptap/core";
import { getLocale } from "@rusuite/ui-shared";

/** Paragraph styles of Home › Styles. */
export type ParagraphStyle = "normal" | "h1" | "h2" | "h3" | "quote" | "code";

export const PARAGRAPH_STYLES: ParagraphStyle[] = ["normal", "h1", "h2", "h3", "quote", "code"];

/** The style of the block at the selection. */
export function currentStyle(editor: Editor): ParagraphStyle {
  if (editor.isActive("codeBlock")) return "code";
  for (const level of [1, 2, 3] as const) if (editor.isActive("heading", { level })) return `h${level}`;
  if (editor.isActive("blockquote")) return "quote";
  return "normal";
}

export function setStyle(editor: Editor, style: ParagraphStyle): boolean {
  const c = editor.chain().focus();
  // Leave a quote / code block first, then apply.
  if (editor.isActive("blockquote") && style !== "quote") c.lift("blockquote");
  switch (style) {
    case "normal":
      return c.setParagraph().run();
    case "h1":
    case "h2":
    case "h3":
      return c.setHeading({ level: Number(style[1]) as 1 | 2 | 3 }).run();
    case "quote":
      return editor.isActive("blockquote") ? c.run() : c.setParagraph().setBlockquote().run();
    case "code":
      return c.setCodeBlock().run();
  }
}

/** Tag ids on the textblock at the selection. */
export function blockTags(editor: Editor): string[] {
  const { $from } = editor.state.selection;
  const node = $from.parent;
  return Array.isArray(node.attrs.tags) ? (node.attrs.tags as string[]) : [];
}

/** Adds or removes a tag on the textblocks of the selection (`todo`: also `checked: false`). */
export function toggleTag(editor: Editor, tag: string, toDo = tag === "todo"): boolean {
  const has = blockTags(editor).includes(tag);
  const { state } = editor;
  const tr = state.tr;
  state.doc.nodesBetween(state.selection.from, state.selection.to, (node, pos) => {
    if (!node.isTextblock || !("tags" in node.attrs)) return true;
    const tags = Array.isArray(node.attrs.tags) ? (node.attrs.tags as string[]) : [];
    const next = has ? tags.filter((x) => x !== tag) : [...tags.filter((x) => x !== tag), tag];
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, tags: next.length ? next : null, checked: toDo ? (has ? null : false) : node.attrs.checked });
    return false;
  });
  if (!tr.docChanged) return false;
  editor.view.dispatch(tr);
  editor.view.focus();
  return true;
}

/** Removes every tag of the selected blocks. */
export function clearTags(editor: Editor): boolean {
  const { state } = editor;
  const tr = state.tr;
  state.doc.nodesBetween(state.selection.from, state.selection.to, (node, pos) => {
    if (!node.isTextblock || !node.attrs.tags) return true;
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, tags: null, checked: null });
    return false;
  });
  if (!tr.docChanged) return false;
  editor.view.dispatch(tr);
  return true;
}

/** Clear formatting: marks off, the blocks back to normal paragraphs. */
export function clearFormatting(editor: Editor): boolean {
  return editor.chain().focus().unsetAllMarks().clearNodes().run();
}

/** Insert › Date / Time / Date and time, in the UI language. */
export function insertDateTime(editor: Editor, what: "date" | "time" | "both", now = new Date()): boolean {
  const locale = getLocale();
  const date = now.toLocaleDateString(locale, { year: "numeric", month: "long", day: "numeric" });
  const time = now.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  const text = what === "date" ? date : what === "time" ? time : `${date} ${time}`;
  return editor.chain().focus().insertContent(text).run();
}

/** Sets (or with an empty `href` removes) the link on the selection; inserts `text` when nothing is selected. */
export function applyLink(editor: Editor, href: string, text?: string): boolean {
  const c = editor.chain().focus();
  if (!href) return c.extendMarkRange("link").unsetLink().run();
  const url = /^[a-z][a-z0-9+.-]*:/i.test(href) ? href : `https://${href}`;
  if (editor.state.selection.empty) {
    return c.insertContent({ type: "text", text: text || url, marks: [{ type: "link", attrs: { href: url } }] }).run();
  }
  return c.extendMarkRange("link").setLink({ href: url }).run();
}
