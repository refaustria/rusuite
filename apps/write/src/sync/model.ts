// Model-side helpers shared by the mapping layer (ADR 0006/0007): canonical
// form for structural comparison, char-offset arithmetic (Unicode scalar
// values; images, breaks, fields, note references and comment markers
// count as one position) and property merges
// that mirror the Rust `apply` functions.

import type { RunProperties } from "../../../../packages/ui-shared/src/generated/RunProperties";
import type { Block } from "../generated/Block";
import type { Indent } from "../generated/Indent";
import type { Inline } from "../generated/Inline";
import type { Note } from "../generated/Note";
import type { Paragraph } from "../generated/Paragraph";
import type { ParagraphProperties } from "../generated/ParagraphProperties";
import type { Spacing } from "../generated/Spacing";
import type { TabStop } from "../generated/TabStop";

export type { RunProperties };

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Keys whose `false` value equals absence in the Rust serialization. */
const FALSE_IS_DEFAULT = new Set(["header", "isDefault"]);
/** Arrays that Rust skips when empty. */
const EMPTY_ARRAY_IS_DEFAULT = new Set(["colWidths"]);

/**
 * Drops `null`/`undefined` values, empty objects and serde defaults so that
 * two values that deserialize to the same Rust value compare equal.
 */
export function canonValue(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonValue);
  if (!isPlainObject(v)) return v;
  const out: Record<string, unknown> = {};
  for (const [k, raw] of Object.entries(v)) {
    if (raw === null || raw === undefined) continue;
    if (raw === false && FALSE_IS_DEFAULT.has(k)) continue;
    if (Array.isArray(raw) && raw.length === 0 && EMPTY_ARRAY_IS_DEFAULT.has(k)) continue;
    const c = canonValue(raw);
    if (isPlainObject(c) && Object.keys(c).length === 0) continue;
    out[k] = c;
  }
  return out;
}

/** JSON with sorted object keys (stable across key order). */
export function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (isPlainObject(v)) {
    const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

/** Canonical key of run properties (absent/empty = `{}`). */
export function propsKey(props: RunProperties | undefined | null): string {
  return stableStringify(canonValue(props ?? {}));
}

/** Merges adjacent runs with equal properties and drops empty runs. */
export function mergeRuns(inlines: Inline[]): Inline[] {
  const out: Inline[] = [];
  for (const inline of inlines) {
    if (inline.kind === "run") {
      if (inline.value.text === "") continue;
      const prev = out[out.length - 1];
      if (
        prev?.kind === "run" &&
        propsKey(prev.value.props) === propsKey(inline.value.props) &&
        (prev.value.style ?? null) === (inline.value.style ?? null) &&
        stableStringify(canonValue(prev.value.link ?? null)) === stableStringify(canonValue(inline.value.link ?? null))
      ) {
        out[out.length - 1] = { kind: "run", value: { ...prev.value, text: prev.value.text + inline.value.text } };
        continue;
      }
    }
    out.push(inline);
  }
  return out;
}

type DrawingValue = Extract<Inline, { kind: "drawing" }>["value"];

/**
 * A drawing without the values Rust leaves out of its JSON (kind shape,
 * no rotation/flips/adjust, no fill, the default outline, Word's text
 * insets, top alignment, no autofit, wrapping on), text blocks canonical.
 */
export function canonDrawing(d: DrawingValue): DrawingValue {
  const out = { ...(canonValue(d) as DrawingValue) };
  if (out.kind === "shape") delete out.kind;
  if (!out.rotation) delete out.rotation;
  if (!out.flipH) delete out.flipH;
  if (!out.flipV) delete out.flipV;
  if (out.adjust && !Object.keys(out.adjust).length) delete out.adjust;
  if (out.fill?.kind === "none") delete out.fill;
  if (out.line && out.line.fill.kind === "none" && out.line.width === 9525 && (out.line.dash ?? "solid") === "solid") delete out.line;
  if (out.line?.dash === "solid") out.line = { fill: out.line.fill, width: out.line.width };
  if (out.text) {
    const t = { ...out.text, blocks: (out.text.blocks ?? []).map(canonBlock) };
    const ins = t.insets;
    if (ins && ins.top === 45720 && ins.bottom === 45720 && ins.left === 91440 && ins.right === 91440) delete t.insets;
    if (t.verticalAlign === "top") delete t.verticalAlign;
    if (t.autofit === "none") delete t.autofit;
    if (t.wrap === true) delete t.wrap;
    out.text = t;
  }
  return out;
}

/** A drawing inline in canonical form. */
function canonInline(i: Inline): Inline {
  return i.kind === "drawing" ? { kind: "drawing", value: canonDrawing(i.value) } : i;
}

/** Canonical form of a block: merged runs, no nulls or serde defaults (drawing text included). */
export function canonBlock(block: Block): Block {
  if (block.kind === "paragraph") {
    const p = block.value;
    return canonValue({ kind: "paragraph", value: { id: p.id, props: p.props, inlines: mergeRuns(p.inlines ?? []).map(canonInline) } }) as Block;
  }
  if (block.kind === "toc") {
    const { id, fromLevel, toLevel, title, entries, caption } = block.value;
    return canonValue({ kind: "toc", value: { id, fromLevel, toLevel, title, entries, caption } }) as Block;
  }
  const t = block.value;
  return canonValue({
    kind: "table",
    value: {
      id: t.id,
      props: t.props,
      rows: t.rows.map((r) => ({
        id: r.id,
        props: r.props,
        cells: r.cells.map((c) => ({
          id: c.id,
          props: c.props,
          gridSpan: (c.gridSpan ?? 1) > 1 ? c.gridSpan : undefined,
          vMerge: c.vMerge,
          blocks: c.blocks.map(canonBlock),
        })),
      })),
    },
  }) as Block;
}

/** Canonical form of a note. */
export function canonNote(note: Note): Note {
  return { id: note.id, kind: note.kind, blocks: (note.blocks ?? []).map(canonBlock) };
}

/** Note ids referenced in `blocks` (cells included). */
export function noteRefIds(blocks: Iterable<Block>): Set<number> {
  const out = new Set<number>();
  for (const b of blocks) {
    for (const x of walkBlocks([b])) {
      if (x.kind !== "paragraph") continue;
      for (const i of x.value.inlines ?? []) if (i.kind === "noteRef") out.add(i.value.id);
    }
  }
  return out;
}

/** Structural equality of blocks (ADR 0007 §1). */
export function blocksEqual(a: Block, b: Block): boolean {
  return stableStringify(canonBlock(a)) === stableStringify(canonBlock(b));
}

export function blockKey(b: Block): string {
  return stableStringify(canonBlock(b));
}

export function blockId(b: Block): number {
  return b.value.id;
}

/** Number of Unicode scalar values of a string. */
export function scalarLength(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

/** Number of char positions of one inline. */
export function inlineLength(inline: Inline): number {
  return inline.kind === "run" ? scalarLength(inline.value.text) : 1;
}

export function paragraphLength(p: Paragraph): number {
  return (p.inlines ?? []).reduce((n, i) => n + inlineLength(i), 0);
}

/** The drawings of a paragraph's inlines. */
export function drawingsOf(p: Paragraph): Extract<Inline, { kind: "drawing" }>["value"][] {
  return (p.inlines ?? []).flatMap((i) => (i.kind === "drawing" ? [i.value] : []));
}

/** Every block, cells and the text of drawings included, in document order. */
export function* walkAllBlocks(blocks: Block[]): Generator<Block> {
  for (const b of blocks) {
    yield b;
    if (b.kind === "table") {
      for (const row of b.value.rows) for (const cell of row.cells) yield* walkAllBlocks(cell.blocks);
    } else if (b.kind === "paragraph") {
      for (const d of drawingsOf(b.value)) yield* walkAllBlocks(d.text?.blocks ?? []);
    }
  }
}

/** Every block (recursively, cells included) in document order. */
export function* walkBlocks(blocks: Block[]): Generator<Block> {
  for (const b of blocks) {
    yield b;
    if (b.kind === "table") {
      for (const row of b.value.rows) for (const cell of row.cells) yield* walkBlocks(cell.blocks);
    }
  }
}

/** Replaces the block with id `id` (anywhere) by `next`; returns whether found. */
export function substituteBlock(blocks: Block[], id: number, next: Block): boolean {
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]!;
    if (b.value.id === id) {
      blocks[i] = next;
      return true;
    }
    if (b.kind === "table") {
      for (const row of b.value.rows) {
        for (const cell of row.cells) {
          const copy = [...cell.blocks];
          if (substituteBlock(copy, id, next)) {
            cell.blocks = copy;
            return true;
          }
        }
      }
    }
  }
  return false;
}

// ----- property merges mirroring Rust ---------------------------------------

/** Toggles whose `false` in `SetRunProps` removes the direct value (Rust's rule). */
export const RUN_TOGGLES = [
  "bold", "italic", "strike", "smallCaps", "allCaps", "doubleStrike", "outline", "shadow", "emboss", "imprint", "hidden",
] as const;
export const RUN_KEYS = [
  "font", "size", "bold", "italic", "underline", "strike", "color", "highlight", "verticalAlign",
  "smallCaps", "allCaps", "doubleStrike", "charSpacing", "scale", "kerning", "position", "outline", "shadow", "emboss", "imprint", "hidden", "rtl",
] as const;

/**
 * `RunProperties::apply` plus the `SetRunProps` rule that `false` removes a
 * toggle (assuming the style does not turn it on).
 */
export function applyRunPatch(base: RunProperties | undefined, patch: RunProperties, falseClears = true): RunProperties {
  const out: RunProperties = { ...(base ?? {}) };
  for (const k of RUN_KEYS) {
    const v = patch[k];
    if (v !== undefined && v !== null) (out as Record<string, unknown>)[k] = v;
  }
  if (falseClears) for (const k of RUN_TOGGLES) if (patch[k] === false) delete out[k];
  return out;
}

function mergeIndent(a: Indent, b: Indent): Indent {
  const firstFromB = b.firstLine != null || b.hanging != null;
  return {
    left: b.left ?? a.left,
    right: b.right ?? a.right,
    firstLine: firstFromB ? b.firstLine : a.firstLine,
    hanging: firstFromB ? b.hanging : a.hanging,
  };
}

function mergeSpacing(a: Spacing, b: Spacing): Spacing {
  return { before: b.before ?? a.before, after: b.after ?? a.after, line: b.line ?? a.line };
}

/** `ParagraphProperties::apply`. */
export function applyParagraphPatch(base: ParagraphProperties | undefined, over: ParagraphProperties): ParagraphProperties {
  const out: ParagraphProperties = { ...(base ?? {}) };
  if (over.style != null) out.style = over.style;
  if (over.alignment != null) out.alignment = over.alignment;
  if (over.indent != null) out.indent = out.indent ? mergeIndent(out.indent, over.indent) : over.indent;
  if (over.spacing != null) out.spacing = out.spacing ? mergeSpacing(out.spacing, over.spacing) : over.spacing;
  if (over.numbering != null) out.numbering = over.numbering;
  if (over.keepNext != null) out.keepNext = over.keepNext;
  if (over.keepLines != null) out.keepLines = over.keepLines;
  if (over.widowControl != null) out.widowControl = over.widowControl;
  if (over.suppressLineNumbers != null) out.suppressLineNumbers = over.suppressLineNumbers;
  if (over.suppressAutoHyphens != null) out.suppressAutoHyphens = over.suppressAutoHyphens;
  if (over.pageBreakBefore != null) out.pageBreakBefore = over.pageBreakBefore;
  if (over.contextualSpacing != null) out.contextualSpacing = over.contextualSpacing;
  if (over.outlineLevel != null) out.outlineLevel = over.outlineLevel;
  if (over.runDefaults != null) out.runDefaults = applyRunPatch(out.runDefaults ?? {}, over.runDefaults, false);
  if (over.borders != null) {
    const b = out.borders ?? {};
    out.borders = {
      top: over.borders.top ?? b.top, bottom: over.borders.bottom ?? b.bottom, left: over.borders.left ?? b.left,
      right: over.borders.right ?? b.right, between: over.borders.between ?? b.between,
    };
  }
  if (over.shading != null) {
    // `SetParagraphProps`: `auto` removes the direct shading.
    if (over.shading.kind === "auto") delete out.shading;
    else out.shading = over.shading;
  }
  if (over.tabs?.length) out.tabs = mergeTabs(out.tabs ?? [], over.tabs);
  return out;
}

/** `merge_tabs`: a stop replaces the one at its position; sorted by position. */
export function mergeTabs(base: TabStop[], over: TabStop[]): TabStop[] {
  let out = [...base];
  for (const t of over) {
    out = out.filter((b) => b.pos !== t.pos);
    out.push(t);
  }
  return out.sort((a, b) => a.pos - b.pos);
}

/** Synthetic numbering ids of lists created in the editor (no `NumberingDef` yet). */
export const SYNTHETIC_BULLET = -1;
export const SYNTHETIC_DECIMAL = -2;
