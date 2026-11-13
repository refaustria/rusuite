// The page editor's schema (docs/notes-format.md §4.4: the node and mark names notes-core reads). Binding rules
// from the spike (docs/notes-spike-report.md): StarterKit's `trailingNode` and `undoRedo` are off, no plugin edits
// the document in `appendTransaction`, there is no initial content (the Loro binding fills the editor).

import { Extension, Mark, mergeAttributes, Node, type AnyExtension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Link } from "@tiptap/extension-link";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import { Plugin } from "@tiptap/pm/state";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    notesMarks: {
      setHighlight: (color?: string | null) => ReturnType;
      unsetHighlight: () => ReturnType;
      setTextColor: (color: string | null) => ReturnType;
    };
    pageLink: {
      insertPageLink: (attrs: { pageId: string; title: string }) => ReturnType;
    };
  }
}

/** `highlight` (attr `color`, default yellow in CSS), inclusive like Word's highlighter. */
export const Highlight = Mark.create({
  name: "highlight",
  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-color"),
        renderHTML: (a) => (a.color ? { "data-color": a.color, style: `background-color: ${a.color}` } : {}),
      },
    };
  },
  parseHTML: () => [{ tag: "mark" }],
  renderHTML: ({ HTMLAttributes }) => ["mark", HTMLAttributes, 0],
  addCommands() {
    return {
      setHighlight:
        (color) =>
        ({ commands }) =>
          commands.setMark(this.name, { color: color ?? null }),
      unsetHighlight:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },
});

/** `textStyle` with `color` (the text colour). */
export const TextStyle = Mark.create({
  name: "textStyle",
  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (el) => (el as HTMLElement).style.color || null,
        renderHTML: (a) => (a.color ? { style: `color: ${a.color}` } : {}),
      },
    };
  },
  parseHTML: () => [{ tag: "span[style]", getAttrs: (el) => (((el as HTMLElement).style.color ? {} : false)) }],
  renderHTML: ({ HTMLAttributes }) => ["span", HTMLAttributes, 0],
  addCommands() {
    return {
      setTextColor:
        (color) =>
        ({ commands }) =>
          color ? commands.setMark(this.name, { color }) : commands.unsetMark(this.name),
    };
  },
});

export interface PageLinkOptions {
  /** Click on a page link: open the page (its page doc id). */
  onOpen: (pageId: string) => void;
}

/** `pageLink`: an inline atom `[[title]]` pointing at a page doc id (`pageId`); a click opens the page. */
export const PageLink = Node.create<PageLinkOptions>({
  name: "pageLink",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addOptions: () => ({ onOpen: () => undefined }),
  addAttributes() {
    return {
      pageId: { default: null, parseHTML: (el) => el.getAttribute("data-page-id") },
      title: { default: "", parseHTML: (el) => el.textContent ?? "" },
    };
  },
  parseHTML: () => [{ tag: "a[data-page-id]" }],
  renderHTML({ node, HTMLAttributes }) {
    return ["a", mergeAttributes(HTMLAttributes, { "data-page-id": node.attrs.pageId, class: "page-link", href: `#page=${node.attrs.pageId}`, title: node.attrs.title }), node.attrs.title || "?"];
  },
  renderText: ({ node }) => String(node.attrs.title ?? ""),
  addCommands() {
    return {
      insertPageLink:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent([{ type: this.name, attrs }, { type: "text", text: " " }]),
    };
  },
  addProseMirrorPlugins() {
    const onOpen = () => this.options.onOpen;
    return [
      new Plugin({
        props: {
          handleClickOn: (_view, _pos, node, _np, event) => {
            if (node.type.name !== "pageLink" || !node.attrs.pageId) return false;
            event.preventDefault();
            onOpen()(node.attrs.pageId);
            return true;
          },
        },
      }),
    ];
  },
});

/** Top-level block types (notes-format §7.1: `canvasItem` may sit on any of them). */
const BLOCKS = ["paragraph", "heading", "bulletList", "orderedList", "taskList", "blockquote", "codeBlock", "horizontalRule", "table", "image", "attachment"];

/**
 * Global block attributes (notes-format §4.4, §7.1) – declared so the binding keeps them: `tags: string[]` (tag
 * ids) and `checked` for to-do tags; `canvasItem` (the canvas text item a block belongs to, P11-N4). The display of
 * tags beyond a minimal marker and the tasks view come in P11-N3.
 */
export const BlockTags = Extension.create({
  name: "blockTags",
  addGlobalAttributes() {
    return [
      {
        types: BLOCKS,
        attributes: {
          tags: {
            default: null,
            parseHTML: (el) => el.getAttribute("data-tags")?.split(" ").filter(Boolean) ?? null,
            renderHTML: (a) => (Array.isArray(a.tags) && a.tags.length ? { "data-tags": a.tags.join(" ") } : {}),
          },
          checked: {
            default: null,
            parseHTML: (el) => (el.hasAttribute("data-checked") ? el.getAttribute("data-checked") === "true" : null),
            renderHTML: (a) => (typeof a.checked === "boolean" ? { "data-checked": String(a.checked) } : {}),
          },
          canvasItem: {
            default: null,
            parseHTML: (el) => el.getAttribute("data-canvas-item"),
            renderHTML: (a) => (a.canvasItem ? { "data-canvas-item": a.canvasItem } : {}),
          },
        },
      },
    ];
  },
});

/** `subscript` / `superscript` marks (read by the core; no ribbon commands yet). */
export const Subscript = Mark.create({ name: "subscript", excludes: "superscript", parseHTML: () => [{ tag: "sub" }], renderHTML: () => ["sub", 0] });
export const Superscript = Mark.create({ name: "superscript", excludes: "subscript", parseHTML: () => [{ tag: "sup" }], renderHTML: () => ["sup", 0] });

/** `image` (notes-format §7.1): a block atom showing a blob; schema only until P11-N3 (shown as its alt text). */
export const Image = Node.create({
  name: "image",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes: () => ({ blob: { default: null }, alt: { default: null }, width: { default: null }, height: { default: null } }),
  parseHTML: () => [{ tag: "figure[data-blob]" }],
  renderHTML: ({ node }) => ["figure", { "data-blob": node.attrs.blob, class: "notes-image" }, `🖼 ${node.attrs.alt ?? ""}`],
});

/** `attachment` (notes-format §7.1): a block atom for a file blob; schema only until P11-N3. */
export const Attachment = Node.create({
  name: "attachment",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes: () => ({ blob: { default: null }, name: { default: "" }, size: { default: 0 } }),
  parseHTML: () => [{ tag: "div[data-attachment]" }],
  renderHTML: ({ node }) => ["div", { "data-attachment": node.attrs.blob, class: "notes-attachment" }, `📎 ${node.attrs.name}`],
});

/** Tables (Tiptap's schema with colspan/rowspan); no table editing plugins (they edit the doc in appendTransaction) – UI: P11-N3. */
const SchemaOnlyTable = Table.extend({ addProseMirrorPlugins: () => [] });

/** The schema extensions (without the Loro binding and the app's keymap). */
export function notesSchemaExtensions(options: { onOpenPage?: (pageId: string) => void; taskLabel?: (text: string) => string } = {}): AnyExtension[] {
  return [
    StarterKit.configure({
      undoRedo: false,
      trailingNode: false,
      link: false,
      heading: { levels: [1, 2, 3] },
    }),
    // Links never grow when typing at their end (`none`, as notes-core's text style config).
    Link.extend({ inclusive: false }).configure({ openOnClick: false, autolink: true, HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" } }),
    TaskList,
    TaskItem.configure({ nested: true, ...(options.taskLabel ? { a11y: { checkboxLabel: (node) => options.taskLabel!(node.textContent) } } : {}) }),
    Highlight,
    TextStyle,
    PageLink.configure({ onOpen: options.onOpenPage ?? (() => undefined) }),
    Subscript,
    Superscript,
    Image,
    Attachment,
    SchemaOnlyTable.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    BlockTags,
  ];
}
