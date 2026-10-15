// ListMapping layer (ADR 0007 §4): docx-style numbered paragraphs
// (`numbering: {numId, level}` per paragraph) ↔ ProseMirror's nested
// `bulletList/orderedList > listItem` structure.
//
// Model → PM: consecutive numbered paragraphs form one list per `numId`;
// a deeper level nests a list into the previous item. Each list node
// records `numId`, `level` and the level `kind` it was built from.
//
// PM → model: a list's level is its `level` attribute, or (for lists the
// editor created, e.g. by Tab) the parent list's level + 1, or 0. Its
// numId is its `numId` attribute if the node type still matches the
// recorded kind (a bullet list toggled to ordered is a new list), else the
// parent list's numId when the parent has the same type, else a synthetic
// negative id (`SYNTHETIC_BULLET`/`SYNTHETIC_DECIMAL`) meaning "a new list
// of this kind" (translated to `ApplyList`).

import type { Node as PMNode } from "@tiptap/pm/model";
import type { LevelKind } from "../generated/LevelKind";
import type { NumberingRef } from "../generated/NumberingRef";
import type { Paragraph } from "../generated/Paragraph";
import { SYNTHETIC_BULLET, SYNTHETIC_DECIMAL } from "./model";
import { paragraphToPM, type ToPMContext } from "./toPM";

interface ListB {
  numId: number;
  level: number;
  kind: LevelKind | null;
  items: { para: PMNode; sublists: ListB[] }[];
}

export function levelKind(ctx: ToPMContext, numId: number, level: number): LevelKind | null {
  if (numId === SYNTHETIC_BULLET) return "bullet";
  if (numId === SYNTHETIC_DECIMAL) return "decimal";
  const def = ctx.numbering.defs.find((d) => d.id === numId);
  return def?.levels[level]?.kind ?? def?.levels[0]?.kind ?? null;
}

/** Numbered paragraphs (all with `numId != 0`) → top-level list nodes. */
export function buildLists(ctx: ToPMContext, paragraphs: Paragraph[]): PMNode[] {
  const tops: ListB[] = [];
  const stack: ListB[] = [];
  for (const p of paragraphs) {
    const n = p.props!.numbering!;
    const item = { para: paragraphToPM(ctx.schema, p, true), sublists: [] as ListB[] };
    while (stack.length && stack[stack.length - 1]!.level > n.level) stack.pop();
    let top = stack[stack.length - 1];
    if (top && top.level === n.level && top.numId === n.numId) {
      top.items.push(item);
      continue;
    }
    if (top && top.level === n.level) {
      stack.pop();
      top = stack[stack.length - 1];
    }
    const list: ListB = { numId: n.numId, level: n.level, kind: levelKind(ctx, n.numId, n.level), items: [item] };
    if (top) top.items[top.items.length - 1]!.sublists.push(list);
    else tops.push(list);
    stack.push(list);
  }
  const { schema } = ctx;
  const render = (l: ListB): PMNode =>
    schema.nodes[l.kind === "bullet" || l.kind === null ? "bulletList" : "orderedList"]!.create(
      { numId: l.numId, level: l.level, kind: l.kind },
      l.items.map((it) => schema.nodes.listItem!.create(null, [it.para, ...it.sublists.map(render)])),
    );
  return tops.map(render);
}

/** The list context of a list node: its effective level and numbering id. */
export interface ListContext {
  numId: number;
  level: number;
  bullet: boolean;
}

export function listContext(list: PMNode, parent: ListContext | null): ListContext {
  const bullet = list.type.name === "bulletList";
  const a = list.attrs as { numId: number | null; level: number | null; kind: LevelKind | null };
  const level = a.level ?? (parent ? parent.level + 1 : 0);
  const valid = a.numId != null && (a.kind == null || (a.kind === "bullet") === bullet);
  const numId = valid
    ? a.numId!
    : parent && parent.bullet === bullet
      ? parent.numId
      : bullet
        ? SYNTHETIC_BULLET
        : SYNTHETIC_DECIMAL;
  return { numId, level, bullet };
}

export function numberingOf(ctx: ListContext): NumberingRef {
  return { numId: ctx.numId, level: ctx.level };
}
