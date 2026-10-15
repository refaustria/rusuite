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
import type { Color } from "../../../../packages/ui-shared/src/generated/Color";
import type { Anchor } from "../generated/Anchor";
import type { LineDash } from "../generated/LineDash";
import type { TextSpacing } from "../generated/TextSpacing";
import { centredTransform, EMU_PER_PT, EMU_PER_PX, normalizeDeg, sameTransform, transformFromNode, type NodeAttrs } from "../geometry";
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

/**
 * `AddShape` copies of `shapes` on `slide` (one undo step), moved by
 * `offset` EMU (default: the duplicate offset); returns the command and
 * the copies' top-level temp ids.
 */
export function duplicateCommand(slide: NodeId, shapes: Shape[], temp: TempIds, offset = DUPLICATE_OFFSET_EMU): { command: ShowCommand | null; ids: number[] } {
  const copies = shapes.map((s) => copyShape(s, temp, offset));
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

// ----- P6-5: clipboard, slides, text polish, format dialog -------------------------------

/**
 * Offset of the `n`-th paste (1-based) of a clipboard: PowerPoint pastes
 * onto the same slide one step further each time, and in place on
 * another slide.
 */
export function pasteOffset(sameSlide: boolean, n: number): number {
  return sameSlide ? DUPLICATE_OFFSET_EMU * Math.max(1, n) : 0;
}

/**
 * The `toIndex` of `MoveSlide` for a drop on thumbnail `over` (in the
 * upper half: `after` false) of a slide dragged from `from`; `null` when
 * the slide would not move.
 */
export function slideDropIndex(from: number, over: number, after: boolean): number | null {
  const gap = over + (after ? 1 : 0);
  const to = gap > from ? gap - 1 : gap;
  return to === from ? null : to;
}

/** PowerPoint's font size steps (points) for Grow/Shrink Font. */
export const FONT_SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 44, 48, 54, 60, 66, 72, 80, 88, 96];

/** The next font size (hundredths of a point) up (`1`) or down (`-1`) the step list. */
export function stepFontSize(size: number, dir: 1 | -1): number {
  const pt = size / 100;
  if (dir > 0) {
    const next = FONT_SIZES.find((s) => s > pt + 1e-9);
    return Math.round((next ?? Math.floor(pt / 10) * 10 + 10) * 100);
  }
  const prev = [...FONT_SIZES].reverse().find((s) => s < pt - 1e-9);
  return Math.round((prev ?? Math.max(1, pt - 1)) * 100);
}

/** Line spacing choices (multiples of single spacing). */
export const LINE_SPACINGS = [1, 1.15, 1.5, 2, 2.5, 3];

/** `SetParagraphProps` setting proportional line spacing (`1.5` = 150 %). */
export function lineSpacingCommand(shape: NodeId, paragraphs: number[], multiple: number): ShowCommand {
  return { type: "setParagraphProps", shape, paragraphs, patch: { lineSpacing: { kind: "percent", value: Math.round(multiple * 100000) } } };
}

/** The line spacing multiple of a paragraph (`null` = not proportional / inherited). */
export function lineSpacingOf(spacing: TextSpacing | null | undefined): number | null {
  return spacing && spacing.kind === "percent" ? spacing.value / 100000 : null;
}

export const EMU_PER_CM = 360000;
export const cmToEmu = (cm: number): number => Math.round(cm * EMU_PER_CM);
export const emuToCm = (emu: number): number => Math.round((emu / EMU_PER_CM) * 100) / 100;

/** The values of the Format Shape dialog (lengths in cm, line width in pt). */
export interface FormatValues {
  /** `null` = no fill. */
  fill: Color | null;
  /** `null` = no line. */
  line: Color | null;
  lineWidthPt: number;
  dash: LineDash;
  /** Text box settings (shapes with text only). */
  anchor: Anchor;
  insets: { left: number; top: number; right: number; bottom: number };
  /** Size and position (one shape only). */
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
}

/** The dialog's initial values for `shape`. */
export function formatValuesOf(shape: Shape): FormatValues {
  const t = shape.transform;
  const body = shape.kind.kind === "auto" ? shape.kind.value.text : null;
  const ins = body?.props.insets ?? { left: 91440, top: 45720, right: 91440, bottom: 45720 };
  return {
    fill: shape.fill.kind === "solid" ? shape.fill.value : null,
    line: shape.line.fill.kind === "solid" ? shape.line.fill.value : null,
    lineWidthPt: Math.round((shape.line.width / EMU_PER_PT) * 100) / 100,
    dash: shape.line.dash,
    anchor: body?.props.anchor ?? "top",
    insets: { left: emuToCm(ins.left), top: emuToCm(ins.top), right: emuToCm(ins.right), bottom: emuToCm(ins.bottom) },
    x: emuToCm(t.x),
    y: emuToCm(t.y),
    w: emuToCm(t.w),
    h: emuToCm(t.h),
    rotation: t.rotationDeg ?? 0,
  };
}

const sameColor = (a: Color | null, b: Color | null) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The commands of the Format Shape dialog for `shapes` (only what
 * changed against `before`, the values the dialog opened with): style
 * (`SetShapeStyle`), text box (`SetTextBody` with new body properties)
 * and, for a single shape, size/position/rotation (`SetTransform`).
 */
export function formatCommands(shapes: Shape[], before: FormatValues, v: FormatValues): ShowCommand[] {
  if (!shapes.length) return [];
  const ids = shapes.map((s) => s.id);
  const out: ShowCommand[] = [];
  const style: Extract<ShowCommand, { type: "setShapeStyle" }> = { type: "setShapeStyle", shapes: ids };
  if (!sameColor(before.fill, v.fill)) style.fill = v.fill ? { kind: "solid", value: v.fill } : null;
  if (!sameColor(before.line, v.line) || before.lineWidthPt !== v.lineWidthPt || before.dash !== v.dash) {
    style.line = v.line ? { fill: { kind: "solid", value: v.line }, width: Math.max(0, Math.round(v.lineWidthPt * EMU_PER_PT)), dash: v.dash } : null;
  }
  if ("fill" in style || "line" in style) out.push(style);
  const insetsChanged = (["left", "top", "right", "bottom"] as const).some((k) => before.insets[k] !== v.insets[k]);
  if (before.anchor !== v.anchor || insetsChanged) {
    for (const s of shapes) {
      const body = s.kind.kind === "auto" ? s.kind.value.text : null;
      if (!body) continue;
      const insets = insetsChanged
        ? { left: cmToEmu(v.insets.left), top: cmToEmu(v.insets.top), right: cmToEmu(v.insets.right), bottom: cmToEmu(v.insets.bottom) }
        : body.props.insets;
      out.push({ type: "setTextBody", shape: s.id, body: { ...body, props: { ...body.props, anchor: v.anchor, insets } } });
    }
  }
  if (shapes.length === 1) {
    const s = shapes[0]!;
    const moved = (["x", "y", "w", "h"] as const).some((k) => before[k] !== v[k]) || before.rotation !== v.rotation;
    if (moved) {
      const t: Transform = {
        ...s.transform,
        x: before.x !== v.x ? cmToEmu(v.x) : s.transform.x,
        y: before.y !== v.y ? cmToEmu(v.y) : s.transform.y,
        w: before.w !== v.w ? Math.max(0, cmToEmu(v.w)) : s.transform.w,
        h: before.h !== v.h ? Math.max(0, cmToEmu(v.h)) : s.transform.h,
        rotationDeg: normalizeDeg(v.rotation),
      };
      out.push({ type: "setTransform", shapes: [[s.id, t]] });
    }
  }
  return out;
}
