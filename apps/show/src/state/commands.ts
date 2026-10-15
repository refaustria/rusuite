// Pure builders of `ShowCommand`s from UI gestures (no Konva, no store),
// so every gesture → command mapping is unit-testable.

import type { RunProperties } from "../../../../packages/ui-shared/src/generated/RunProperties";
import type { Alignment } from "../generated/Alignment";
import type { AlignMode } from "../generated/AlignMode";
import type { Bullet } from "../generated/Bullet";
import type { NodeId } from "../generated/NodeId";
import type { Shape } from "../generated/Shape";
import type { ShowCommand } from "../generated/ShowCommand";
import type { SlideSize } from "../generated/SlideSize";
import type { TextBody } from "../generated/TextBody";
import type { TextParagraph } from "../generated/TextParagraph";
import type { Transform } from "../generated/Transform";
import { centredTransform, EMU_PER_PT, EMU_PER_PX, sameTransform, transformFromNode, type NodeAttrs } from "../geometry";
import { charLen, paragraphText } from "../model";

/** Several commands as one undo step (a single command stays as is; none → `null`). */
export function compound(commands: ShowCommand[]): ShowCommand | null {
  if (commands.length === 0) return null;
  return commands.length === 1 ? commands[0]! : { type: "compound", commands };
}

/** `SetTransform` for the shapes whose node attributes changed in one gesture (`null` if none did). */
export function gestureCommand(nodes: { shape: Shape; attrs: NodeAttrs }[]): ShowCommand | null {
  const shapes: [NodeId, Transform][] = [];
  for (const { shape, attrs } of nodes) {
    const t = transformFromNode(attrs, shape.transform);
    if (!sameTransform(t, shape.transform)) shapes.push([shape.id, t]);
  }
  return shapes.length ? { type: "setTransform", shapes } : null;
}

/** Moves shapes by `dx`/`dy` slide px. */
export function nudgeCommand(shapes: Shape[], dx: number, dy: number): ShowCommand | null {
  if (!shapes.length) return null;
  return {
    type: "setTransform",
    shapes: shapes.map((s) => [s.id, { ...s.transform, x: s.transform.x + Math.round(dx * EMU_PER_PX), y: s.transform.y + Math.round(dy * EMU_PER_PX) }]),
  };
}

/** Allocates temporary (negative) ids. */
export type TempIds = () => number;

/** A deep copy of `shape` with temporary ids (also for group children), empty name (the core assigns a default), moved by `offset` EMU. */
export function copyShape(shape: Shape, temp: TempIds, offset = 0): Shape {
  const id = temp();
  const kind: Shape["kind"] =
    shape.kind.kind === "group"
      ? { kind: "group", value: { children: shape.kind.value.children.map((c) => copyShape(c, temp)) } }
      : shape.kind;
  return {
    ...shape,
    id,
    name: "",
    kind,
    transform: { ...shape.transform, x: shape.transform.x + offset, y: shape.transform.y + offset },
  };
}

/** Duplicate offset (PowerPoint-like: a little down and right). */
export const DUPLICATE_OFFSET_EMU = 20 * EMU_PER_PX;

/** `AddShape` copies of `shapes` on `slide` (one undo step); returns the command and the copies' top-level temp ids. */
export function duplicateCommand(slide: NodeId, shapes: Shape[], temp: TempIds): { command: ShowCommand | null; ids: number[] } {
  const copies = shapes.map((s) => copyShape(s, temp, DUPLICATE_OFFSET_EMU));
  return {
    command: compound(copies.map((shape) => ({ type: "addShape", slide, shape }))),
    ids: copies.map((c) => c.id),
  };
}

export type InsertKind = "rect" | "ellipse" | "line" | "textBox";

const EMPTY_BODY = (): TextBody => ({
  props: { anchor: "top", wrap: true, insets: { left: 91440, top: 45720, right: 91440, bottom: 45720 }, autofit: "none" },
  paragraphs: [{ runs: [] }],
});

/** A new shape of `kind` centred on the slide, with temporary id `id`. */
export function newShape(kind: InsertKind, size: SlideSize, id: number): Shape {
  const accent = { kind: "theme", value: { slot: "accent1", tint: 0 } } as const;
  const dark = { kind: "theme", value: { slot: "accent1", tint: -0.25 } } as const;
  const base = { id, name: "", fill: { kind: "none" } as const, line: { fill: { kind: "none" } as const, width: EMU_PER_PT, dash: "solid" as const } };
  switch (kind) {
    case "rect":
    case "ellipse": {
      const body = EMPTY_BODY();
      body.props.anchor = "middle";
      return {
        ...base,
        transform: centredTransform(size, 1828800, 1371600),
        kind: { kind: "auto", value: { geometry: kind === "rect" ? "rect" : "ellipse", text: body } },
        fill: { kind: "solid", value: accent },
        line: { fill: { kind: "solid", value: dark }, width: EMU_PER_PT, dash: "solid" },
      };
    }
    case "line":
      return {
        ...base,
        transform: centredTransform(size, 2743200, 0),
        kind: { kind: "auto", value: { geometry: "line", text: null } },
        line: { fill: { kind: "solid", value: accent }, width: 2 * EMU_PER_PT, dash: "solid" },
      };
    case "textBox":
      return { ...base, transform: centredTransform(size, 2743200, 457200), kind: { kind: "auto", value: { geometry: "rect", text: EMPTY_BODY() } } };
  }
}

/**
 * The text body for the overlay editor's text: paragraphs split on `\n`.
 * A paragraph whose text is unchanged keeps its runs; others get one run
 * with the formatting of the old paragraph's first run. Paragraph
 * properties are kept by index; new paragraphs copy the previous one's.
 */
export function bodyFromText(text: string, old: TextBody): TextBody {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const paragraphs: TextParagraph[] = lines.map((line, i) => {
    const prev = old.paragraphs[i] ?? old.paragraphs[old.paragraphs.length - 1];
    if (old.paragraphs[i] && paragraphText(old.paragraphs[i]!) === line) return old.paragraphs[i]!;
    const runProps = prev?.runs[0]?.props;
    const p: TextParagraph = { runs: line ? [runProps ? { props: runProps, text: line } : { text: line }] : [] };
    if (prev?.props) p.props = prev.props;
    return p;
  });
  return { props: old.props, paragraphs };
}

/** A position in a text body: paragraph index and char offset. */
export interface TextPos {
  paragraph: number;
  offset: number;
}

/** Maps a textarea offset (UTF-16) in `text` (paragraphs joined by `\n`) to a paragraph position (Unicode scalars). */
export function textPos(text: string, utf16: number): TextPos {
  const before = text.slice(0, Math.max(0, utf16));
  const lines = before.split("\n");
  return { paragraph: lines.length - 1, offset: charLen(lines[lines.length - 1]!) };
}

/** `SetRunProps` for every non-empty paragraph of a body (whole ranges). */
export function runPropsWhole(shape: NodeId, body: TextBody, patch: RunProperties): ShowCommand[] {
  return body.paragraphs.flatMap((p, i) => {
    const len = charLen(paragraphText(p));
    return len ? [{ type: "setRunProps", shape, paragraph: i, from: 0, to: len, patch } as ShowCommand] : [];
  });
}

/** `SetRunProps` for the selection `start..end` (UTF-16 offsets into `text`); a collapsed selection formats the whole body. */
export function runPropsRange(shape: NodeId, text: string, start: number, end: number, patch: RunProperties): ShowCommand[] {
  const lines = text.split("\n");
  if (start === end) {
    return lines.flatMap((l, i) => (charLen(l) ? [{ type: "setRunProps", shape, paragraph: i, from: 0, to: charLen(l), patch } as ShowCommand] : []));
  }
  const a = textPos(text, Math.min(start, end));
  const b = textPos(text, Math.max(start, end));
  const out: ShowCommand[] = [];
  for (let p = a.paragraph; p <= b.paragraph; p++) {
    const from = p === a.paragraph ? a.offset : 0;
    const to = p === b.paragraph ? b.offset : charLen(lines[p] ?? "");
    if (to > from) out.push({ type: "setRunProps", shape, paragraph: p, from, to, patch });
  }
  return out;
}

/** Paragraph indices covered by a selection (all when `sel` is null). */
export function selectedParagraphs(body: TextBody, text: string | null, sel: { start: number; end: number } | null): number[] {
  if (!sel || text === null) return body.paragraphs.map((_, i) => i);
  const a = textPos(text, Math.min(sel.start, sel.end)).paragraph;
  const b = textPos(text, Math.max(sel.start, sel.end)).paragraph;
  const out: number[] = [];
  for (let i = a; i <= b && i < body.paragraphs.length; i++) out.push(i);
  return out;
}

export function alignmentCommand(shape: NodeId, paragraphs: number[], alignment: Alignment): ShowCommand {
  return { type: "setParagraphProps", shape, paragraphs, patch: { alignment } };
}

/** Bullet toggle: on (`bullet`) unless every paragraph already has that kind, then off (`none`). */
export function bulletCommand(shape: NodeId, paragraphs: number[], current: (Bullet | null | undefined)[], want: Bullet): ShowCommand {
  const on = current.length > 0 && current.every((b) => b?.kind === want.kind);
  return { type: "setParagraphProps", shape, paragraphs, patch: { bullet: on ? { kind: "none" } : want } };
}

/** Changes the outline level of each paragraph by `delta` (one command per distinct level). */
export function indentCommands(shape: NodeId, paragraphs: number[], levels: number[], delta: 1 | -1): ShowCommand[] {
  const byLevel = new Map<number, number[]>();
  paragraphs.forEach((p, i) => {
    const next = Math.min(8, Math.max(0, (levels[i] ?? 0) + delta));
    if (next !== (levels[i] ?? 0)) byLevel.set(next, [...(byLevel.get(next) ?? []), p]);
  });
  return [...byLevel].map(([level, ps]) => ({ type: "setParagraphProps", shape, paragraphs: ps, patch: { level } }));
}

/** `Align` to the selection (two or more shapes) or the slide (one). */
export function alignCommand(shapes: NodeId[], mode: AlignMode): ShowCommand | null {
  if (!shapes.length) return null;
  return { type: "align", shapes, mode, to: shapes.length > 1 ? "selection" : "slide" };
}
