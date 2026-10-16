// Tiptap schema of the Write document (ADR 0006/0007). Every block node that
// has a `NodeId` in `model-text` carries an `id` attribute; properties
// without a dedicated attribute travel in an `extra` JSON attribute so that
// `fromPM(toPM(doc))` is lossless.

import { Extension, Mark, Node, mergeAttributes, type Extensions } from "@tiptap/core";
import { Table, TableCell, TableRow } from "@tiptap/extension-table";
import StarterKit from "@tiptap/starter-kit";
import { getSchema } from "@tiptap/core";
import type { Schema } from "@tiptap/pm/model";
import { applyTint } from "@rusuite/ui-shared";
import type { Color } from "../../../../packages/ui-shared/src/generated/Color";
import type { FontFace } from "../../../../packages/ui-shared/src/generated/FontFace";
import type { BorderSide } from "../generated/BorderSide";
import type { Indent } from "../generated/Indent";
import type { ParagraphBorders } from "../generated/ParagraphBorders";
import type { RowProperties } from "../generated/RowProperties";
import type { Spacing } from "../generated/Spacing";
import type { TableProperties } from "../generated/TableProperties";
import { imageNodeView } from "../features/imageView";
import { t } from "../i18n";

/** Twips per CSS pixel (96 dpi). */
export const TWIPS_PER_PX = 15;
/** EMU per CSS pixel (96 dpi). */
export const EMU_PER_PX = 9525;

/** Node types that carry a `NodeId`. */
export const ID_NODE_TYPES = new Set(["paragraph", "heading", "title", "table", "tableRow", "tableCell", "toc"]);
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
    const hex = theme[c.value.slot] ?? "000000";
    return `#${c.value.tint ? applyTint(hex, c.value.tint) : hex}`;
  }
  return undefined;
}

const PX_PER_PT = 96 / 72;

/** CSS of one paragraph border side (`none` / absent: no border). */
export function paraBorderCss(side: BorderSide | null | undefined): string | null {
  if (!side || side.style === "none") return null;
  const w = Math.max(1, Math.round(side.width / TWIPS_PER_PX));
  const color = colorCss(side.color) ?? "#000";
  const style = side.style === "double" ? "double" : side.style === "dashed" ? "dashed" : side.style === "dotted" ? "dotted" : "solid";
  return `${side.style === "double" ? Math.max(3, w) : side.style === "thick" ? Math.max(2, w) : w}px ${style} ${color}`;
}

/** Width (px) a paragraph border side takes: line plus its distance from the text. */
export function paraBorderExtent(side: BorderSide | null | undefined): number {
  if (!paraBorderCss(side)) return 0;
  return Math.max(1, Math.round(side!.width / TWIPS_PER_PX)) + (side!.space ?? 0) * PX_PER_PT;
}

/** CSS declarations of paragraph borders (`w:pBdr`) and shading (`w:shd`): the left/right borders sit in the indent like Word's. */
export function paragraphBoxCss(borders: ParagraphBorders | null | undefined, shading: Color | null | undefined, indent: Indent | null | undefined): string[] {
  const css: string[] = [];
  const bg = shading && shading.kind !== "auto" ? colorCss(shading) : undefined;
  if (bg) css.push(`background-color: ${bg}`);
  if (!borders) return css;
  for (const side of ["top", "bottom", "left", "right"] as const) {
    const b = borders[side];
    const v = paraBorderCss(b);
    if (!v) continue;
    css.push(`border-${side}: ${v}`, `padding-${side}: ${((b!.space ?? 0) * PX_PER_PT).toFixed(2)}px`);
  }
  const left = paraBorderExtent(borders.left);
  if (left) css.push(`margin-left: ${((indent?.left ?? 0) / TWIPS_PER_PX - left).toFixed(2)}px`);
  const right = paraBorderExtent(borders.right);
  if (right) css.push(`margin-right: ${((indent?.right ?? 0) / TWIPS_PER_PX - right).toFixed(2)}px`);
  return css;
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
  const extra = attrs.extra as { borders?: ParagraphBorders; shading?: Color } | null;
  if (extra?.borders || extra?.shading) css.push(...paragraphBoxCss(extra.borders, extra.shading, indent));
  return css.join("; ");
}

const paragraphAttrs = {
  id: idAttr,
  // Derived list label from Rust (`Paragraph.listLabel`); rendered, never sent.
  listLabel: {
    default: null,
    keepOnSplit: false,
    parseHTML: () => null,
    renderHTML: (a: Record<string, unknown>) => (a.listLabel ? { "data-label": String(a.listLabel) } : {}),
  },
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

/** The document: body blocks, then the notes area (footnotes and endnotes) if the document has notes. */
export const WriteDoc = Node.create({
  name: "doc",
  topNode: true,
  content: "block+ notes?",
});

const jsonAttrPlain = { default: null, parseHTML: () => null, renderHTML: () => ({}) };

/**
 * A field (`Inline::Field`): an inline atom showing its cached result in
 * grey (the structure plugin may decorate it with a live value). Attrs
 * `kind` (`FieldKind` JSON) and `cached`; the result's formatting is the
 * node's marks.
 */
export const FieldNode = Node.create({
  name: "field",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { kind: { ...jsonAttrPlain, default: { kind: "page" } }, cached: { ...jsonAttrPlain, default: "" } };
  },
  parseHTML() {
    return [
      {
        tag: "span.field[data-field-kind]",
        getAttrs: (el) => {
          const e = el as HTMLElement;
          try {
            return { kind: JSON.parse(e.dataset.fieldKind ?? ""), cached: e.dataset.cached ?? e.textContent ?? "" };
          } catch {
            return false;
          }
        },
      },
    ];
  },
  renderHTML({ node }) {
    const kind = node.attrs.kind as { kind: string } | null;
    const cached = String(node.attrs.cached ?? "");
    return [
      "span",
      { class: "field", "data-field": kind?.kind ?? "", "data-field-kind": JSON.stringify(kind), "data-cached": cached, contenteditable: "false" },
      ["span", { class: "field-cached" }, cached],
    ];
  },
});

/**
 * A footnote/endnote reference (`Inline::NoteRef`): a superscript inline
 * atom; its number is computed from the order of the references (the
 * structure plugin decorates it with `data-n`). Attrs `id` (note id), `kind`.
 */
export const NoteRefNode = Node.create({
  name: "noteRef",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { id: { ...jsonAttrPlain }, kind: { ...jsonAttrPlain, default: "foot" } };
  },
  parseHTML() {
    // Pasted references are not new notes: never parsed from HTML.
    return [];
  },
  renderHTML({ node }) {
    return ["sup", { class: "note-ref", "data-note-id": String(node.attrs.id), "data-note-kind": String(node.attrs.kind), contenteditable: "false" }];
  },
});

export interface TocEntryAttr {
  text: string;
  level: number;
  page?: number;
  target: number;
}

/**
 * A table of contents (`Block::Toc`): a non-editable block atom rendered
 * from its entries (click an entry to go to the heading). Attrs `id`,
 * `fromLevel`, `toLevel`, `title`, `entries`.
 */
export const TocNode = Node.create({
  name: "toc",
  group: "block",
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      id: idAttr,
      fromLevel: { ...jsonAttrPlain, default: 1 },
      toLevel: { ...jsonAttrPlain, default: 3 },
      title: { ...jsonAttrPlain },
      entries: { ...jsonAttrPlain, default: [] },
    };
  },
  parseHTML() {
    return [];
  },
  renderHTML({ node }) {
    const entries = (node.attrs.entries as TocEntryAttr[] | null) ?? [];
    const title = node.attrs.title as string | null;
    return [
      "div",
      { class: "toc", "data-toc": String(node.attrs.id), contenteditable: "false" },
      ...(title ? [["p", { class: "toc-title" }, title] as const] : []),
      ...entries.map(
        (e) =>
          [
            "p",
            { class: `toc-entry toc-level-${e.level}`, "data-target": String(e.target), style: `padding-left: ${(Math.max(1, e.level) - 1) * 1.5}em` },
            ["span", { class: "toc-text" }, e.text],
            ["span", { class: "toc-page" }, e.page == null ? "" : String(e.page)],
          ] as const,
      ),
      ...(entries.length ? [] : [["p", { class: "toc-empty" }, t("write.toc.empty")] as const]),
    ] as never;
  },
});

/** The notes area after the body: footnotes, then endnotes, each a `note`. */
export const NotesNode = Node.create({
  name: "notes",
  content: "note+",
  isolating: true,
  defining: true,
  parseHTML() {
    return [];
  },
  renderHTML() {
    return ["div", { class: "notes-area", "data-testid": "notes-area" }, 0];
  },
});

/** One footnote or endnote (`Note`): attrs `id`, `kind`; content its blocks. */
export const NoteNode = Node.create({
  name: "note",
  content: "block+",
  isolating: true,
  defining: true,
  addAttributes() {
    return { id: { ...jsonAttrPlain }, kind: { ...jsonAttrPlain, default: "foot" } };
  },
  parseHTML() {
    return [];
  },
  renderHTML({ node }) {
    return ["div", { class: "note", "data-note-id": String(node.attrs.id), "data-note-kind": String(node.attrs.kind) }, 0];
  },
});

export interface ImageOptions {
  /** Resolves a media id to an object URL (via `GetMedia`). */
  resolveMedia: ((id: number) => Promise<string>) | null;
  /** Page geometry (CSS px) for page-relative floating positions. */
  page: (() => { width: number; marginLeft: number; columnWidth: number } | null) | null;
}

/** Inline image: attrs `mediaId`, `width`/`height` (EMU), `alt`, `name`. */
export const InlineImageNode = Node.create<ImageOptions>({
  name: "image",
  group: "inline",
  inline: true,
  atom: true,
  draggable: true,
  addOptions() {
    return { resolveMedia: null, page: null };
  },
  addAttributes() {
    return {
      mediaId: { default: null },
      width: { default: 952500 },
      height: { default: 952500 },
      alt: { default: null },
      name: { default: null },
      // Floating placement (`Anchor`), null = inline.
      anchor: { default: null, parseHTML: () => null, renderHTML: () => ({}) },
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
    const page = this.options.page;
    return ({ node, view, getPos }) => imageNodeView(node, view, getPos, { emuPerPx: EMU_PER_PX, resolve, page });
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
 * A character style on a run (`Run.style`); the look comes from the
 * generated style sheet CSS (`span[data-cstyle]`, features/styleCss.ts).
 */
export const CharStyle = Mark.create({
  name: "charStyle",
  addAttributes() {
    return { id: { default: null, parseHTML: () => null, renderHTML: () => ({}) } };
  },
  parseHTML() {
    return [{ tag: "span[data-cstyle]", getAttrs: (el) => ({ id: (el as HTMLElement).getAttribute("data-cstyle") }) }];
  },
  renderHTML({ mark }) {
    return ["span", { class: "char-style", "data-cstyle": String(mark.attrs.id ?? "") }, 0];
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
              const end = (attrs.extra as { sectionEnd?: number } | null)?.sectionEnd;
              return { ...(style ? { style } : {}), ...(end != null ? { "data-section-end": String(end) } : {}) };
            },
          },
        },
      },
    ];
  },
});

/** CSS `border` value of a table border side (`none` shows as a light gridline on screen). */
export function borderCss(side: BorderSide | null | undefined): string {
  if (!side || side.style === "none") return "1px dashed var(--write-gridline, transparent)";
  const px = Math.max(1, Math.round(side.width / TWIPS_PER_PX));
  const color = colorCss(side.color) ?? "#000";
  switch (side.style) {
    case "double":
      return `${Math.max(3, px)}px double ${color}`;
    case "dashed":
      return `${px}px dashed ${color}`;
    case "dotted":
      return `${px}px dotted ${color}`;
    case "thick":
      return `${Math.max(2, px)}px solid ${color}`;
    default:
      return `${px}px solid ${color}`;
  }
}

/** CSS variables of a table's borders (consumed by `table[data-borders]` rules in styles.css). */
export function tableBorderStyle(props: TableProperties | null | undefined): Record<string, string> {
  const b = props?.borders;
  if (!b) return {};
  const vars: [string, BorderSide | undefined | null][] = [
    ["--tb-top", b.top], ["--tb-left", b.left], ["--tb-bottom", b.bottom], ["--tb-right", b.right],
    ["--tb-ih", b.insideH], ["--tb-iv", b.insideV],
  ];
  return { "data-borders": "", style: vars.map(([k, v]) => `${k}: ${borderCss(v)}`).join("; ") };
}

/** Number of grid columns of a table node (its widest row, spans counted). */
export function gridColumns(table: { forEach: (f: (row: PMNodeLike) => void) => void }): number {
  let n = 0;
  table.forEach((row) => {
    let w = 0;
    row.forEach((cell) => (w += Number(cell.attrs.colspan ?? 1)));
    n = Math.max(n, w);
  });
  return n;
}

interface PMNodeLike {
  attrs: Record<string, unknown>;
  forEach: (f: (child: PMNodeLike) => void) => void;
}

/** Table geometry as CSS: width from the grid, alignment and indent (`w:jc`, `w:tblInd`). */
export function tablePlacementCss(props: TableProperties | null | undefined, cols: number): string {
  const css: string[] = [];
  const w = props?.colWidths ?? [];
  if (cols > 0 && w.length >= cols) css.push(`width: ${(w.slice(0, cols).reduce((a, b) => a + b, 0) / TWIPS_PER_PX).toFixed(1)}px`);
  if (props?.alignment === "center") css.push("margin-left: auto", "margin-right: auto");
  else if (props?.alignment === "right") css.push("margin-left: auto", "margin-right: 0");
  else if (props?.indent) css.push(`margin-left: ${(props.indent / TWIPS_PER_PX).toFixed(1)}px`);
  if (props?.layout === "autofit" && !w.length) css.push("table-layout: auto");
  return css.join("; ");
}

const WriteTable = Table.extend({
  addAttributes() {
    return {
      id: idAttr,
      props: { ...jsonAttr(), renderHTML: (a: Record<string, unknown>) => tableBorderStyle(a.props as TableProperties | null) },
    };
  },
  renderHTML({ node, HTMLAttributes }) {
    const props = node.attrs.props as TableProperties | null;
    const cols = gridColumns(node as unknown as PMNodeLike);
    const w = props?.colWidths ?? [];
    const colgroup = ["colgroup", {}, ...Array.from({ length: cols }, (_, i) => ["col", w[i] ? { style: `width: ${(w[i]! / TWIPS_PER_PX).toFixed(1)}px` } : {}])];
    const placement = tablePlacementCss(props, cols);
    return ["table", mergeAttributes(HTMLAttributes, placement ? { style: placement } : {}), colgroup, ["tbody", 0]] as never;
  },
}).configure({ resizable: false, View: null });

const WriteTableRow = TableRow.extend({
  // A row may hold no cell of its own when every cell continues a vertical merge from above.
  content: "tableCell*",
  addAttributes() {
    return {
      id: idAttr,
      props: {
        ...jsonAttr(),
        renderHTML: (a: Record<string, unknown>) => {
          const p = a.props as RowProperties | null;
          const out: Record<string, string> = {};
          if (p?.header) out["data-header"] = "";
          if (p?.cantSplit) out["data-cant-split"] = "";
          if (p?.height && p.height.value > 0) {
            out.style = `height: ${(p.height.value / TWIPS_PER_PX).toFixed(1)}px`;
          }
          return out;
        },
      },
    };
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
      // Merged cells (docx `w:vMerge`): the cell's own state, and the `continue` cells of the rows below
      // (`TableCell` JSON, top to bottom) that the cell's `rowspan` covers in the editor.
      vMerge: jsonAttr(false),
      continues: jsonAttr(false),
    };
  },
});

export interface WriteExtensionsOptions {
  resolveMedia?: (id: number) => Promise<string>;
  /** Page geometry for floating pictures (CSS px). */
  page?: () => { width: number; marginLeft: number; columnWidth: number } | null;
}

/** All Tiptap extensions of the Write editor. */
export function writeExtensions(options: WriteExtensionsOptions = {}): Extensions {
  return [
    StarterKit.configure({
      undoRedo: false,
      document: false,
      blockquote: false,
      codeBlock: false,
      code: false,
      horizontalRule: false,
      link: false,
      trailingNode: false,
      listItem: { HTMLAttributes: {} },
    }),
    WriteDoc,
    RusuiteAttributes,
    ParagraphCss,
    Title,
    PageBreak,
    InlineImageNode.configure({ resolveMedia: options.resolveMedia ?? null, page: options.page ?? null }),
    Superscript,
    Subscript,
    TextStyle,
    CharStyle,
    WriteTable,
    WriteTableRow,
    WriteTableCell,
    FieldNode,
    NoteRefNode,
    TocNode,
    NotesNode,
    NoteNode,
  ];
}

let cachedSchema: Schema | null = null;

/** The ProseMirror schema (without an editor; used by tests and the mapper). */
export function writeSchema(): Schema {
  if (!cachedSchema) cachedSchema = getSchema(writeExtensions());
  return cachedSchema;
}
