// `model-text` Document JSON → ProseMirror document (ADR 0007 §6).

import { Mark, type Node as PMNode, type Schema } from "@tiptap/pm/model";
import type { Block } from "../generated/Block";
import type { Document } from "../generated/Document";
import type { Inline } from "../generated/Inline";
import type { Numbering } from "../generated/Numbering";
import type { Paragraph } from "../generated/Paragraph";
import type { Table } from "../generated/Table";
import { buildLists } from "./listMapping";
import { canonValue, type RunProperties } from "./model";
import { TWIPS_PER_PX } from "./schema";

export interface ToPMContext {
  schema: Schema;
  /** List definitions, for the list node type (bullet vs ordered). */
  numbering: Numbering;
}

const HEADING = /^Heading([1-6])$/;

const emptyToNull = (v: unknown) => {
  const c = canonValue(v);
  return c && typeof c === "object" && Object.keys(c).length === 0 ? null : (c ?? null);
};

/** Run properties → marks (inverse of `propsFromMarks`). */
export function marksFromProps(schema: Schema, props: RunProperties | undefined): Mark[] {
  const p = (canonValue(props ?? {}) ?? {}) as RunProperties;
  const marks: Mark[] = [];
  const extra: RunProperties = {};
  const m = schema.marks;
  if (p.bold === true) marks.push(m.bold!.create());
  else if (p.bold === false) extra.bold = false;
  if (p.italic === true) marks.push(m.italic!.create());
  else if (p.italic === false) extra.italic = false;
  if (p.strike === true) marks.push(m.strike!.create());
  else if (p.strike === false) extra.strike = false;
  if (p.underline && p.underline !== "none") marks.push(m.underline!.create({ kind: p.underline }));
  else if (p.underline === "none") extra.underline = "none";
  if (p.verticalAlign === "superscript") marks.push(m.superscript!.create());
  else if (p.verticalAlign === "subscript") marks.push(m.subscript!.create());
  else if (p.verticalAlign === "baseline") extra.verticalAlign = "baseline";
  const attrs = {
    font: p.font ?? null,
    size: p.size ?? null,
    color: p.color ?? null,
    highlight: p.highlight ?? null,
    extra: Object.keys(extra).length ? extra : null,
  };
  if (Object.values(attrs).some((v) => v !== null)) marks.push(m.textStyle!.create(attrs));
  return Mark.setFrom(marks) as Mark[];
}

export function inlinesToPM(schema: Schema, inlines: Inline[]): PMNode[] {
  const out: PMNode[] = [];
  for (const inline of inlines) {
    switch (inline.kind) {
      case "run":
        if (inline.value.text !== "") out.push(schema.text(inline.value.text, marksFromProps(schema, inline.value.props)));
        break;
      case "image": {
        const img = inline.value;
        out.push(
          schema.nodes.image!.create({ mediaId: img.media, width: img.width, height: img.height, alt: img.alt ?? null, name: img.name ?? null }),
        );
        break;
      }
      case "break":
        out.push(inline.value === "page" ? schema.nodes.pageBreak!.create() : schema.nodes.hardBreak!.create());
        break;
    }
  }
  return out;
}

/**
 * One paragraph as a `paragraph`, `heading` (style `Heading1..6`) or
 * `title` node. Inside a list item it is always a `paragraph` (its style in
 * the `style` attribute) and its numbering lives in the list structure.
 */
export function paragraphToPM(schema: Schema, p: Paragraph, inList = false): PMNode {
  const { style, alignment, indent, spacing, numbering, ...rest } = p.props ?? {};
  const extra: Record<string, unknown> = { ...rest };
  if (numbering && !inList) extra.numbering = numbering;
  const attrs = {
    id: p.id,
    align: alignment ?? null,
    indent: emptyToNull(indent),
    spacing: emptyToNull(spacing),
    extra: emptyToNull(extra),
  };
  const content = inlinesToPM(schema, p.inlines ?? []);
  const heading = !inList && style ? HEADING.exec(style) : null;
  if (heading) return schema.nodes.heading!.create({ ...attrs, level: Number(heading[1]) }, content);
  if (!inList && style === "Title") return schema.nodes.title!.create(attrs, content);
  return schema.nodes.paragraph!.create({ ...attrs, style: style ?? null }, content);
}

export function tableToPM(ctx: ToPMContext, t: Table): PMNode {
  const { schema } = ctx;
  const widths = t.props?.colWidths ?? [];
  const rows = t.rows.map((row) =>
    schema.nodes.tableRow!.create(
      { id: row.id, props: emptyToNull(row.props) },
      row.cells.map((cell, ci) => {
        const { shading, width, ...rest } = cell.props ?? {};
        const w = widths[ci];
        return schema.nodes.tableCell!.create(
          {
            id: cell.id,
            shading: shading ?? null,
            width: width ?? null,
            extra: emptyToNull(rest),
            colwidth: w ? [Math.round(w / TWIPS_PER_PX)] : null,
          },
          blocksToPM(ctx, cell.blocks),
        );
      }),
    ),
  );
  return schema.nodes.table!.create({ id: t.id, props: emptyToNull(t.props) }, rows);
}

/** Numbered: a real (> 0) or synthetic (< 0, a list created in the editor) numbering id. */
const isNumbered = (b: Block): boolean => b.kind === "paragraph" && (b.value.props?.numbering?.numId ?? 0) !== 0;

/** Blocks → nodes; runs of numbered paragraphs become nested lists. */
export function blocksToPM(ctx: ToPMContext, blocks: Block[]): PMNode[] {
  const out: PMNode[] = [];
  let i = 0;
  while (i < blocks.length) {
    const b = blocks[i]!;
    if (isNumbered(b)) {
      const run: Paragraph[] = [];
      while (i < blocks.length && isNumbered(blocks[i]!)) run.push((blocks[i++] as { value: Paragraph }).value);
      out.push(...buildLists(ctx, run));
      continue;
    }
    out.push(b.kind === "paragraph" ? paragraphToPM(ctx.schema, b.value) : tableToPM(ctx, b.value));
    i++;
  }
  return out;
}

/** The whole document. */
export function toPM(doc: Document, schema: Schema): PMNode {
  const ctx: ToPMContext = { schema, numbering: doc.numbering };
  const content = blocksToPM(ctx, doc.body);
  return schema.nodes.doc!.create(null, content.length ? content : [schema.nodes.paragraph!.create()]);
}
