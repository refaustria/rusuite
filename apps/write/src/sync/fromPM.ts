// ProseMirror document → `model-text` blocks (inverse of `toPM`).

import type { Mark, Node as PMNode } from "@tiptap/pm/model";
import type { Block } from "../generated/Block";
import type { Inline } from "../generated/Inline";
import type { NumberingRef } from "../generated/NumberingRef";
import type { Paragraph } from "../generated/Paragraph";
import type { ParagraphProperties } from "../generated/ParagraphProperties";
import type { Table } from "../generated/Table";
import { listContext, numberingOf, type ListContext } from "./listMapping";
import { canonValue, mergeRuns, type RunProperties } from "./model";
import { LIST_TYPES, TEXTBLOCK_TYPES } from "./schema";

/** Marks → run properties (inverse of `marksFromProps`). */
export function propsFromMarks(marks: readonly Mark[]): RunProperties {
  const p: RunProperties = {};
  for (const m of marks) {
    switch (m.type.name) {
      case "textStyle": {
        const a = m.attrs;
        Object.assign(p, a.extra ?? {});
        if (a.font != null) p.font = a.font;
        if (a.size != null) p.size = a.size;
        if (a.color != null) p.color = a.color;
        if (a.highlight != null) p.highlight = a.highlight;
        break;
      }
      case "bold":
        p.bold = true;
        break;
      case "italic":
        p.italic = true;
        break;
      case "strike":
        p.strike = true;
        break;
      case "underline":
        p.underline = m.attrs.kind ?? "single";
        break;
      case "superscript":
        p.verticalAlign = "superscript";
        break;
      case "subscript":
        p.verticalAlign = "subscript";
        break;
    }
  }
  return p;
}

export function inlinesFromPM(node: PMNode): Inline[] {
  const out: Inline[] = [];
  node.forEach((child) => {
    if (child.isText) {
      const props = propsFromMarks(child.marks);
      out.push({ kind: "run", value: Object.keys(props).length ? { props, text: child.text! } : { text: child.text! } });
    } else if (child.type.name === "image") {
      const a = child.attrs;
      out.push({
        kind: "image",
        value: canonValue({ media: a.mediaId, width: a.width, height: a.height, alt: a.alt, name: a.name }) as never,
      });
    } else if (child.type.name === "hardBreak") {
      out.push({ kind: "break", value: "line" });
    } else if (child.type.name === "pageBreak") {
      out.push({ kind: "break", value: "page" });
    }
  });
  return mergeRuns(out);
}

/** Paragraph properties of a textblock node (`numbering` from its list, if any). */
export function paragraphPropsFromPM(node: PMNode, numbering?: NumberingRef): ParagraphProperties {
  const a = node.attrs;
  const props: ParagraphProperties = { ...(a.extra ?? {}) };
  if (node.type.name === "heading") props.style = `Heading${a.level}`;
  else if (node.type.name === "title") props.style = "Title";
  else if (a.style) props.style = a.style;
  if (a.align) props.alignment = a.align;
  if (a.indent) props.indent = a.indent;
  if (a.spacing) props.spacing = a.spacing;
  if (numbering) props.numbering = numbering;
  return canonValue(props) as ParagraphProperties;
}

export function paragraphFromPM(node: PMNode, numbering?: NumberingRef): Paragraph {
  const props = paragraphPropsFromPM(node, numbering);
  const p: Paragraph = { id: node.attrs.id, inlines: inlinesFromPM(node) };
  if (Object.keys(props).length) p.props = props;
  return p;
}

export function tableFromPM(node: PMNode): Table {
  const t: Table = { id: node.attrs.id, rows: [] };
  if (node.attrs.props) t.props = node.attrs.props;
  node.forEach((rowNode) => {
    const row: Table["rows"][number] = { id: rowNode.attrs.id, cells: [] };
    if (rowNode.attrs.props) row.props = rowNode.attrs.props;
    rowNode.forEach((cellNode) => {
      const a = cellNode.attrs;
      const props = canonValue({ ...(a.extra ?? {}), shading: a.shading, width: a.width }) as Record<string, unknown>;
      const cell: Table["rows"][number]["cells"][number] = { id: a.id, blocks: nodesToBlocks(cellNode) };
      if (Object.keys(props).length) cell.props = props;
      row.cells.push(cell);
    });
    t.rows.push(row);
  });
  return t;
}

function listToBlocks(list: PMNode, parent: ListContext | null, out: Block[]): void {
  const ctx = listContext(list, parent);
  list.forEach((item) => {
    item.forEach((child, _offset, index) => {
      if (index === 0 && TEXTBLOCK_TYPES.has(child.type.name)) {
        out.push({ kind: "paragraph", value: paragraphFromPM(child, numberingOf(ctx)) });
      } else if (LIST_TYPES.has(child.type.name)) {
        listToBlocks(child, ctx, out);
      } else {
        nodeToBlocks(child, out);
      }
    });
  });
}

/** One block-level node (paragraph, heading, title, list, table) → blocks. */
export function nodeToBlocks(node: PMNode, out: Block[] = [], parentList: ListContext | null = null): Block[] {
  const name = node.type.name;
  if (TEXTBLOCK_TYPES.has(name)) out.push({ kind: "paragraph", value: paragraphFromPM(node) });
  else if (LIST_TYPES.has(name)) listToBlocks(node, parentList, out);
  else if (name === "table") out.push({ kind: "table", value: tableFromPM(node) });
  return out;
}

/** The blocks of a container node (doc or table cell). */
export function nodesToBlocks(container: PMNode): Block[] {
  const out: Block[] = [];
  container.forEach((child) => nodeToBlocks(child, out));
  return out;
}

/** The whole body. */
export function fromPM(doc: PMNode): Block[] {
  return nodesToBlocks(doc);
}

/**
 * The list context of the textblock at `pos` (null outside lists), from
 * its ancestors.
 */
export function listContextAt(doc: PMNode, pos: number): ListContext | null {
  const $pos = doc.resolve(pos);
  let ctx: ListContext | null = null;
  for (let d = 1; d <= $pos.depth; d++) {
    const n = $pos.node(d);
    if (LIST_TYPES.has(n.type.name)) ctx = listContext(n, ctx);
    if (n.type.name === "tableCell") ctx = null;
  }
  return ctx;
}

/** The model block of the id-carrying node at `pos` (with its list numbering). */
export function blockAt(doc: PMNode, pos: number): Block | null {
  const node = doc.nodeAt(pos);
  if (!node) return null;
  if (node.type.name === "table") return { kind: "table", value: tableFromPM(node) };
  if (!TEXTBLOCK_TYPES.has(node.type.name)) return null;
  const ctx = listContextAt(doc, pos + 1);
  // Only the first textblock of a list item is numbered.
  const $pos = doc.resolve(pos);
  const inItemHead = $pos.parent.type.name === "listItem" && $pos.index() === 0;
  return { kind: "paragraph", value: paragraphFromPM(node, ctx && inItemHead ? numberingOf(ctx) : undefined) };
}
