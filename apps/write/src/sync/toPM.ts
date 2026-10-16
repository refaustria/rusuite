// `model-text` Document JSON → ProseMirror document (ADR 0007 §6).

import { Mark, type Node as PMNode, type Schema } from "@tiptap/pm/model";
import type { Block } from "../generated/Block";
import type { Document } from "../generated/Document";
import type { Inline } from "../generated/Inline";
import type { Note } from "../generated/Note";
import type { Numbering } from "../generated/Numbering";
import type { Paragraph } from "../generated/Paragraph";
import type { Table } from "../generated/Table";
import type { Toc } from "../generated/Toc";
import { buildLists } from "./listMapping";
import { canonValue, walkBlocks, type RunProperties } from "./model";
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

/** Run properties (and a character style) → marks (inverse of `propsFromMarks` / `styleFromMarks`). */
export function marksFromProps(schema: Schema, props: RunProperties | undefined, charStyle?: string | null): Mark[] {
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
  if (charStyle) marks.push(m.charStyle!.create({ id: charStyle }));
  return Mark.setFrom(marks) as Mark[];
}

export function inlinesToPM(schema: Schema, inlines: Inline[]): PMNode[] {
  const out: PMNode[] = [];
  for (const inline of inlines) {
    switch (inline.kind) {
      case "run":
        if (inline.value.text !== "") out.push(schema.text(inline.value.text, marksFromProps(schema, inline.value.props, inline.value.style)));
        break;
      case "image": {
        const img = inline.value;
        out.push(
          schema.nodes.image!.create({
            mediaId: img.media, width: img.width, height: img.height, alt: img.alt ?? null, name: img.name ?? null, anchor: img.anchor ? canonValue(img.anchor) : null,
          }),
        );
        break;
      }
      case "break":
        out.push(inline.value === "page" ? schema.nodes.pageBreak!.create() : schema.nodes.hardBreak!.create());
        break;
      case "field":
        out.push(
          schema.nodes.field!.create(
            { kind: canonValue(inline.value.kind), cached: inline.value.cached ?? "" },
            null,
            marksFromProps(schema, inline.value.props),
          ),
        );
        break;
      case "noteRef":
        out.push(schema.nodes.noteRef!.create({ id: inline.value.id, kind: inline.value.kind }, null, marksFromProps(schema, inline.value.props)));
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
    listLabel: p.listLabel ?? null,
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

type Cell = Table["rows"][number]["cells"][number];

/** Grid columns a cell spans (`gridSpan`, ≥ 1). */
export const spanOf = (c: Cell): number => Math.max(1, c.gridSpan ?? 1);

/**
 * The vertical merges of a table: for every `restart` cell the
 * `continue` cells below it (same grid column and span, docx semantics),
 * keyed `"row:cell"`; `covered` holds the keys of those continue cells.
 */
export function verticalMerges(t: Table): { continues: Map<string, Cell[]>; covered: Set<string> } {
  const continues = new Map<string, Cell[]>();
  const covered = new Set<string>();
  // Open regions by "gridStart:span" → the origin's key.
  let open = new Map<string, string>();
  t.rows.forEach((row, r) => {
    const next = new Map<string, string>();
    let col = 0;
    row.cells.forEach((cell, i) => {
      const slot = `${col}:${spanOf(cell)}`;
      const key = `${r}:${i}`;
      if (cell.vMerge === "continue" && open.has(slot)) {
        const origin = open.get(slot)!;
        continues.get(origin)!.push(cell);
        covered.add(key);
        next.set(slot, origin);
      } else if (cell.vMerge === "restart") {
        continues.set(key, []);
        next.set(slot, key);
      }
      col += spanOf(cell);
    });
    open = next;
  });
  return { continues, covered };
}

/**
 * A table as ProseMirror nodes: `gridSpan` → `colspan`, a vertical merge
 * → `rowspan` on its first cell, which keeps the covered `continue` cells
 * in its `continues` attribute (restored by `tableFromPM`).
 */
export function tableToPM(ctx: ToPMContext, t: Table): PMNode {
  const { schema } = ctx;
  const widths = t.props?.colWidths ?? [];
  const { continues, covered } = verticalMerges(t);
  const rows = t.rows.map((row, r) => {
    let col = 0;
    const cells: PMNode[] = [];
    row.cells.forEach((cell, i) => {
      const start = col;
      const span = spanOf(cell);
      col += span;
      if (covered.has(`${r}:${i}`)) return;
      const { shading, width, ...rest } = cell.props ?? {};
      const w = widths.slice(start, start + span);
      const below = continues.get(`${r}:${i}`) ?? [];
      cells.push(
        schema.nodes.tableCell!.create(
          {
            id: cell.id,
            shading: shading ?? null,
            width: width ?? null,
            extra: emptyToNull(rest),
            colspan: span,
            rowspan: 1 + below.length,
            colwidth: w.length === span && w.every((x) => x > 0) ? w.map((x) => Math.round(x / TWIPS_PER_PX)) : null,
            vMerge: cell.vMerge ?? null,
            continues: below.length ? canonValue(below) : null,
          },
          blocksToPM(ctx, cell.blocks),
        ),
      );
    });
    return schema.nodes.tableRow!.create({ id: row.id, props: emptyToNull(row.props) }, cells);
  });
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
    out.push(b.kind === "paragraph" ? paragraphToPM(ctx.schema, b.value) : b.kind === "table" ? tableToPM(ctx, b.value) : tocToPM(ctx.schema, b.value));
    i++;
  }
  return out;
}

/** A table of contents block. */
export function tocToPM(schema: Schema, t: Toc): PMNode {
  return schema.nodes.toc!.create({
    id: t.id,
    fromLevel: t.fromLevel,
    toLevel: t.toLevel,
    title: t.title ?? null,
    entries: canonValue(t.entries ?? []),
  });
}

/** Note ids in the order of their first reference in `blocks` (cells included). */
export function noteRefOrder(blocks: Block[]): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const b of walkBlocks(blocks)) {
    if (b.kind !== "paragraph") continue;
    for (const i of b.value.inlines ?? []) {
      if (i.kind === "noteRef" && !seen.has(i.value.id)) {
        seen.add(i.value.id);
        out.push(i.value.id);
      }
    }
  }
  return out;
}

/** Notes in display order: footnotes, then endnotes, each by first reference (unreferenced last, by id). */
export function orderNotes(notes: Note[], body: Block[]): Note[] {
  const order = new Map(noteRefOrder(body).map((id, i) => [id, i]));
  const rank = (n: Note) => order.get(n.id) ?? Number.MAX_SAFE_INTEGER;
  return [...notes].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "foot" ? -1 : 1) || rank(a) - rank(b) || a.id - b.id);
}

/** One note (its blocks; an empty paragraph-less note gets an empty paragraph for the cursor). */
export function noteToPM(ctx: ToPMContext, note: Note): PMNode {
  const content = blocksToPM(ctx, note.blocks ?? []);
  return ctx.schema.nodes.note!.create({ id: note.id, kind: note.kind }, content.length ? content : [ctx.schema.nodes.paragraph!.create()]);
}

/** The notes area, or null without notes. */
export function notesToPM(ctx: ToPMContext, notes: Note[] | undefined, body: Block[]): PMNode | null {
  if (!notes?.length) return null;
  return ctx.schema.nodes.notes!.create(null, orderNotes(notes, body).map((n) => noteToPM(ctx, n)));
}

/** The whole document. */
export function toPM(doc: Document, schema: Schema): PMNode {
  const ctx: ToPMContext = { schema, numbering: doc.numbering };
  const content = blocksToPM(ctx, doc.body);
  if (!content.length) content.push(schema.nodes.paragraph!.create());
  const notes = notesToPM(ctx, doc.notes, doc.body);
  if (notes) content.push(notes);
  return schema.nodes.doc!.create(null, content);
}
