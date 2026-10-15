// Tiptap schema of the Write document (ADR 0006/0007). Every block node that
// has a `NodeId` in `model-text` carries an `id` attribute; properties
// without a dedicated attribute travel in an `extra` JSON attribute so that
// `fromPM(toPM(doc))` is lossless.

import { Extension, Mark, Node, mergeAttributes, type Extensions } from "@tiptap/core";
import { Table, TableCell, TableRow } from "@tiptap/extension-table";
import StarterKit from "@tiptap/starter-kit";
import { getSchema } from "@tiptap/core";
import type { Schema } from "@tiptap/pm/model";
import type { Color } from "../../../../packages/ui-shared/src/generated/Color";
import type { FontFace } from "../../../../packages/ui-shared/src/generated/FontFace";
import type { Indent } from "../generated/Indent";
import type { Spacing } from "../generated/Spacing";

/** Twips per CSS pixel (96 dpi). */
export const TWIPS_PER_PX = 15;
/** EMU per CSS pixel (96 dpi). */
export const EMU_PER_PX = 9525;

/** Node types that carry a `NodeId`. */
export const ID_NODE_TYPES = new Set(["paragraph", "heading", "title", "table", "tableRow", "tableCell"]);
/** Paragraph-like node types. */
export const TEXTBLOCK_TYPES = new Set(["paragraph", "heading", "title"]);
export const LIST_TYPES = new Set(["bulletList", "orderedList"]);

/** An attribute holding JSON, never parsed from or rendered to HTML. */
const jsonAttr = (keepOnSplit = true) => ({
  default: null,
  keepOnSplit,
  parseHTML: () => null,
  renderHTML: () => ({}),
});

/** The `id` attribute: not copied on split, not taken over from pasted HTML. */
const idAttr = { default: null, keepOnSplit: false, parseHTML: () => null, renderHTML: () => ({}) };

const px = (twips: number) => `${(twips / TWIPS_PER_PX).toFixed(2)}px`;

export function colorCss(c: Color | null | undefined): string | undefined {
  if (!c) return undefined;
  if (c.kind === "rgb") return `#${c.value.replace(/^#/, "")}`;
  if (c.kind === "theme") {
    // Approximate Office theme colors for display only.
    const theme: Record<string, string> = {
      dark1: "000000", light1: "FFFFFF", dark2: "44546A", light2: "E7E6E6", accent1: "4472C4", accent2: "ED7D31",
      accent3: "A5A5A5", accent4: "FFC000", accent5: "5B9BD5", accent6: "70AD47", hyperlink: "0563C1", followedHyperlink: "954F72",
    };
    return `#${theme[c.value.slot] ?? "000000"}`;
  }
  return undefined;
}

function paragraphStyle(attrs: Record<string, unknown>): string {
  const css: string[] = [];
  if (attrs.align) css.push(`text-align: ${String(attrs.align)}`);
  const indent = attrs.indent as Indent | null;
  if (indent) {
    if (indent.left != null) css.push(`margin-left: ${px(indent.left)}`);
    if (indent.right != null) css.push(`margin-right: ${px(indent.right)}`);
    if (indent.firstLine != null) css.push(`text-indent: ${px(indent.firstLine)}`);
    else if (indent.hanging != null) css.push(`text-indent: -${px(indent.hanging)}`);
  }
  const spacing = attrs.spacing as Spacing | null;
  if (spacing) {
    if (spacing.before != null) css.push(`margin-top: ${px(spacing.before)}`);
    if (spacing.after != null) css.push(`margin-bottom: ${px(spacing.after)}`);
    if (spacing.line?.kind === "multiple") css.push(`line-height: ${spacing.line.value}`);
    else if (spacing.line) css.push(`line-height: ${px(spacing.line.value)}`);
  }
  return css.join("; ");
}

const paragraphAttrs = {
  id: idAttr,
  align: { default: null, keepOnSplit: true, parseHTML: () => null, renderHTML: () => ({}) },
  indent: jsonAttr(),
  spacing: jsonAttr(),
  extra: jsonAttr(),
};

/**
 * Attributes on StarterKit's nodes and marks (no extension subclassing
 * needed): paragraph/heading properties, list numbering, underline kind.
 */
const RusuiteAttributes = Extension.create({
  name: "rusuiteAttributes",
  addGlobalAttributes() {
    return [
      { types: ["paragraph", "heading"], attributes: paragraphAttrs },
      {
        types: ["paragraph"],
        attributes: {
          style: {
            default: null,
            keepOnSplit: true,
            parseHTML: () => null,
            renderHTML: (a: Record<string, unknown>) => (a.style ? { "data-style": a.style } : {}),
          },
        },
      },
      {
        // ListMapping (ADR 0007 §4): numbering id, list level and level kind
        // of the definition the list was built from.
        types: ["bulletList", "orderedList"],
        attributes: {
          numId: jsonAttr(),
          level: jsonAttr(),
          kind: jsonAttr(),
        },
      },
      {
        types: ["underline"],
        attributes: { kind: { default: "single", parseHTML: () => "single", renderHTML: () => ({}) } },
      },
    ];
  },
});

/** Paragraph with style `Title`. */
export const Title = Node.create({
  name: "title",
  group: "block",
  content: "inline*",
  defining: true,
  addAttributes() {
    return paragraphAttrs;
  },
  parseHTML() {
    return [{ tag: "p.doc-title", priority: 60 }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return ["p", mergeAttributes(HTMLAttributes, { class: "doc-title", style: paragraphStyle(node.attrs) }), 0];
  },
});

/** A manual page break (`Break(page)`), an inline atom. */
export const PageBreak = Node.create({
  name: "pageBreak",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  parseHTML() {
    return [{ tag: "span.page-break" }];
  },
  renderHTML() {
    return ["span", { class: "page-break", contenteditable: "false" }];
  },
});

export interface ImageOptions {
  /** Resolves a media id to an object URL (via `GetMedia`). */
  resolveMedia: ((id: number) => Promise<string>) | null;
}

/** Inline image: attrs `mediaId`, `width`/`height` (EMU), `alt`, `name`. */
export const InlineImageNode = Node.create<ImageOptions>({
  name: "image",
  group: "inline",
  inline: true,
  atom: true,
  draggable: true,
  addOptions() {
    return { resolveMedia: null };
  },
  addAttributes() {
    return {
      mediaId: { default: null },
      width: { default: 952500 },
      height: { default: 952500 },
      alt: { default: null },
      name: { default: null },
    };
  },
  parseHTML() {
    return [{ tag: "img[data-media-id]", getAttrs: (el) => ({ mediaId: Number((el as HTMLElement).dataset.mediaId) }) }];
  },
  renderHTML({ node }) {
    return [
      "img",
      {
        "data-media-id": String(node.attrs.mediaId),
        alt: node.attrs.alt ?? "",
        width: Math.round(node.attrs.width / EMU_PER_PX),
        height: Math.round(node.attrs.height / EMU_PER_PX),
      },
    ];
  },
  addNodeView() {
    const resolve = this.options.resolveMedia;
    return ({ node }) => {
      const img = document.createElement("img");
      img.dataset.mediaId = String(node.attrs.mediaId);
      img.alt = node.attrs.alt ?? "";
      img.width = Math.round(node.attrs.width / EMU_PER_PX);
      img.height = Math.round(node.attrs.height / EMU_PER_PX);
      img.className = "inline-image";
      if (resolve && node.attrs.mediaId != null) {
        resolve(node.attrs.mediaId).then(
          (url) => (img.src = url),
          () => img.classList.add("missing"),
        );
      }
      return { dom: img };
    };
  },
});

export const Superscript = Mark.create({
  name: "superscript",
  excludes: "subscript",
  parseHTML() {
    return [{ tag: "sup" }];
  },
  renderHTML() {
    return ["sup", 0];
  },
});

export const Subscript = Mark.create({
  name: "subscript",
  excludes: "superscript",
  parseHTML() {
    return [{ tag: "sub" }];
  },
  renderHTML() {
    return ["sub", 0];
  },
});

/**
 * Run properties without a toggle mark: `font`, `size` (hundredths of a
 * point), `color`, `highlight`, plus `extra` (explicit `false` toggles,
 * `underline: none`, `verticalAlign: baseline`).
 */
export const TextStyle = Mark.create({
  name: "textStyle",
  addAttributes() {
    return {
      font: jsonAttr(),
      size: jsonAttr(),
      color: jsonAttr(),
      highlight: jsonAttr(),
      extra: jsonAttr(),
    };
  },
  parseHTML() {
    return [{ tag: "span.text-style" }];
  },
  renderHTML({ mark }) {
    const css: string[] = [];
    const font = mark.attrs.font as FontFace | null;
    if (font?.kind === "named") css.push(`font-family: "${font.value}"`);
    if (mark.attrs.size != null) css.push(`font-size: ${mark.attrs.size / 100}pt`);
    const color = colorCss(mark.attrs.color);
    if (color) css.push(`color: ${color}`);
    const hl = colorCss(mark.attrs.highlight);
    if (hl) css.push(`background-color: ${hl}`);
    return ["span", { class: "text-style", style: css.join("; ") }, 0];
  },
});

/** Renders paragraph properties as CSS on paragraph and heading nodes. */
const ParagraphCss = Extension.create({
  name: "paragraphCss",
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph", "heading"],
        attributes: {
          // A rendering-only attribute key that never holds a value: its
          // renderHTML reads the sibling attributes.
          _style: {
            default: null,
            parseHTML: () => null,
            renderHTML: (attrs: Record<string, unknown>) => {
              const style = paragraphStyle(attrs);
              return style ? { style } : {};
            },
          },
        },
      },
    ];
  },
});

const WriteTable = Table.extend({
  addAttributes() {
    return { id: idAttr, props: jsonAttr() };
  },
}).configure({ resizable: false, View: null });

const WriteTableRow = TableRow.extend({
  content: "tableCell+",
  addAttributes() {
    return { id: idAttr, props: jsonAttr() };
  },
});

const WriteTableCell = TableCell.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      id: idAttr,
      shading: {
        default: null,
        parseHTML: () => null,
        renderHTML: (a: Record<string, unknown>) => {
          const c = colorCss(a.shading as Color | null);
          return c ? { style: `background-color: ${c}` } : {};
        },
      },
      width: jsonAttr(),
      extra: jsonAttr(),
    };
  },
});

export interface WriteExtensionsOptions {
  resolveMedia?: (id: number) => Promise<string>;
}

/** All Tiptap extensions of the Write editor. */
export function writeExtensions(options: WriteExtensionsOptions = {}): Extensions {
  return [
    StarterKit.configure({
      undoRedo: false,
      blockquote: false,
      codeBlock: false,
      code: false,
      horizontalRule: false,
      link: false,
      trailingNode: false,
      listItem: { HTMLAttributes: {} },
    }),
    RusuiteAttributes,
    ParagraphCss,
    Title,
    PageBreak,
    InlineImageNode.configure({ resolveMedia: options.resolveMedia ?? null }),
    Superscript,
    Subscript,
    TextStyle,
    WriteTable,
    WriteTableRow,
    WriteTableCell,
  ];
}

let cachedSchema: Schema | null = null;

/** The ProseMirror schema (without an editor; used by tests and the mapper). */
export function writeSchema(): Schema {
  if (!cachedSchema) cachedSchema = getSchema(writeExtensions());
  return cachedSchema;
}
