// ProseMirror transaction → one `WriteCommand` (ADR 0007 §3).
//
// The mapper compares the document before and after the transaction at the
// model level: unchanged top-level nodes are skipped by identity (ProseMirror
// shares them structurally), the changed range is converted with `fromPM`
// and trimmed to the blocks that really differ. The difference is then
// classified into a fine-grained command (typing, deletion, mark changes,
// split/join, paragraph properties, lists; typing and formatting inside one
// table cell too); anything else becomes
// `ReplaceBlocks` of the affected top-level blocks, which is always correct.

import type { Node as PMNode } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import type { Block } from "../generated/Block";
import type { Inline } from "../generated/Inline";
import type { ListKind } from "../generated/ListKind";
import type { Paragraph } from "../generated/Paragraph";
import type { Run } from "../generated/Run";
import type { ParagraphProperties } from "../generated/ParagraphProperties";
import type { WriteCommand } from "../generated/WriteCommand";
import { nodesToBlocks, nodeToBlocks, notesNode } from "./fromPM";
import {
  applyParagraphPatch, applyRunPatch, blockKey, canonBlock, canonDrawing, canonValue, noteRefIds, propsKey, RUN_KEYS, RUN_TOGGLES, stableStringify,
  SYNTHETIC_BULLET, SYNTHETIC_DECIMAL, type RunProperties,
} from "./model";

export interface MapperOptions {
  /** The document's default paragraph style (`SetStyle` target for "no style"). */
  defaultStyle?: string;
  /** Kind of an existing numbering definition (for `ApplyList`). */
  listKindOf?: (numId: number) => "bullet" | "decimal" | null;
  /** An existing numbering id to use for a new list of `kind` in a `ReplaceBlocks`, or null. */
  listIdFor?: (kind: "bullet" | "decimal") => number | null;
}

export interface MapResult {
  command: WriteCommand;
  /**
   * New lists that a `ReplaceBlocks` could not express (no definition of
   * that kind yet): after the reply, send `ApplyList` for these (temporary
   * or real) ids.
   */
  followUp?: { ids: number[]; kind: ListKind };
}

type P = { kind: "paragraph"; value: Paragraph };
const isPara = (b: Block): b is P => b.kind === "paragraph";

/** Model blocks of one top-level node, memoized per node identity. */
const blockCache = new WeakMap<PMNode, Block[]>();
export function topBlocks(node: PMNode): Block[] {
  let b = blockCache.get(node);
  if (!b) blockCache.set(node, (b = nodeToBlocks(node)));
  return b;
}

// ----- inline diff -----------------------------------------------------------

interface Pos {
  key: string;
  ch?: string;
  props?: RunProperties;
  /** Character style of a text position ("" = none). */
  style?: string;
  /** Hyperlink of a text position. */
  link?: Run["link"];
  /** The inline, for images and breaks. */
  inline?: Inline;
}

/** One entry per char position (scalar, image or break). */
function positions(inlines: Inline[]): Pos[] {
  const out: Pos[] = [];
  for (const inline of inlines) {
    if (inline.kind === "run") {
      const pk = propsKey(inline.value.props);
      const props = (canonValue(inline.value.props ?? {}) ?? {}) as RunProperties;
      const style = inline.value.style ?? "";
      const link = inline.value.link;
      const lk = link ? stableStringify(canonValue(link)) : "";
      for (const ch of inline.value.text) out.push({ key: `${ch}\u0000${pk}\u0000${style}\u0000${lk}`, ch, props, style, link });
    } else {
      const canon = inline.kind === "drawing" ? ({ kind: "drawing", value: canonDrawing(inline.value) } as Inline) : inline;
      out.push({ key: stableStringify(canon), inline: canon });
    }
  }
  return out;
}

/** Keys of the comment and bookmark markers of `ps` whose partner is not in `ps` (what a deletion of `ps` keeps). */
function keptMarkers(ps: Pos[]): { ends: string[]; starts: string[] } {
  const ids = (kind: string) => new Set(ps.flatMap((p) => (p.inline?.kind === kind ? [(p.inline.value as { id: number }).id] : [])));
  const idOf = (p: Pos) => (p.inline!.value as { id: number }).id;
  const cs = ids("commentStart");
  const ce = ids("commentEnd");
  const bs = ids("bookmarkStart");
  const be = ids("bookmarkEnd");
  return {
    ends: ps
      .filter((p) => (p.inline?.kind === "commentEnd" && !cs.has(idOf(p))) || (p.inline?.kind === "bookmarkEnd" && !bs.has(idOf(p))))
      .map((p) => p.key),
    starts: ps
      .filter((p) => (p.inline?.kind === "commentStart" && !ce.has(idOf(p))) || (p.inline?.kind === "bookmarkStart" && !be.has(idOf(p))))
      .map((p) => p.key),
  };
}

/** Splits text positions into segments of equal properties. */
function segments(ps: Pos[]): { text: string; props: RunProperties; style: string; link?: Run["link"] }[] {
  const out: { text: string; props: RunProperties; style: string; link?: Run["link"]; key: string }[] = [];
  for (const p of ps) {
    const key = `${propsKey(p.props)}\u0000${p.style ?? ""}\u0000${p.link ? stableStringify(canonValue(p.link)) : ""}`;
    const last = out[out.length - 1];
    if (last && last.key === key) last.text += p.ch;
    else out.push({ text: p.ch!, props: p.props!, style: p.style ?? "", link: p.link, key });
  }
  return out.map(({ text, props, style, link }) => (link ? { text, props, style, link } : { text, props, style }));
}

/** `InsertText` of one segment (style and link only when set). */
function insertCmd(block: number, offset: number, s: { text: string; props: RunProperties; style: string; link?: Run["link"] }): WriteCommand {
  const cmd: WriteCommand = { type: "insertText", block, offset, text: s.text, props: s.props };
  if (s.style) cmd.style = s.style;
  if (s.link) cmd.link = s.link;
  return cmd;
}

/** A `SetRunProps` patch turning every `old[i]` into `next[i]`, or null. */
function runPatch(old: Pos[], next: Pos[]): RunProperties | null {
  const patch: Record<string, unknown> = {};
  for (const k of RUN_KEYS) {
    const changed = old.some((o, i) => stableStringify(o.props![k]) !== stableStringify(next[i]!.props![k]));
    if (!changed) continue;
    const values = new Set(next.map((n) => stableStringify(n.props![k])));
    if (values.size !== 1) return null;
    const v = next[0]!.props![k];
    if (v === undefined) {
      if ((RUN_TOGGLES as readonly string[]).includes(k)) patch[k] = false;
      else return null;
    } else patch[k] = v;
  }
  const p = patch as RunProperties;
  const ok = old.every((o, i) => propsKey(applyRunPatch(o.props, p)) === propsKey(next[i]!.props));
  return ok ? p : null;
}

/** The same image (same media) resized and/or with new alt text: `SetImageSize`/`SetImageAlt`, else null. */
function imageCommand(block: number, offset: number, a: Inline | undefined, b: Inline | undefined): WriteCommand | null {
  if (a?.kind !== "image" || b?.kind !== "image") return null;
  const [x, y] = [a.value, b.value];
  if (x.media !== y.media) return null;
  const cmds: WriteCommand[] = [];
  if (x.width !== y.width || x.height !== y.height) {
    if (y.width <= 0 || y.height <= 0) return null;
    cmds.push({ type: "setImageSize", block, offset, width: y.width, height: y.height });
  }
  if ((x.name ?? null) !== (y.name ?? null) || !!x.hidden !== !!y.hidden) {
    cmds.push({ type: "setImageMeta", block, offset, ...((x.name ?? null) !== (y.name ?? null) ? { name: y.name ?? "" } : {}), ...(!!x.hidden !== !!y.hidden ? { hidden: !!y.hidden } : {}) });
  }
  if ((x.alt ?? null) !== (y.alt ?? null) || !!x.decorative !== !!y.decorative) {
    cmds.push({ type: "setImageAlt", block, offset, alt: y.alt ?? null, ...(!!x.decorative !== !!y.decorative ? { decorative: !!y.decorative } : {}) });
  }
  if (stableStringify(canonValue(x.anchor ?? null)) !== stableStringify(canonValue(y.anchor ?? null))) {
    cmds.push({ type: "setImageAnchor", block, offset, anchor: y.anchor ?? null });
  }
  if (stableStringify(canonValue(x.format ?? {})) !== stableStringify(canonValue(y.format ?? {}))) {
    cmds.push({ type: "setImageFormat", block, offset, format: (canonValue(y.format ?? {}) ?? {}) as never });
  }
  if (stableStringify(canonValue(x.link ?? null)) !== stableStringify(canonValue(y.link ?? null))) {
    cmds.push({ type: "setImageLink", block, offset, link: y.link ?? null });
  }
  return cmds.length ? one(cmds) : null;
}

type DrawingValue = Extract<Inline, { kind: "drawing" }>["value"];

/** A drawing without its text blocks (what `SetDrawingProps` carries; Rust keeps the blocks). */
export function drawingShell(d: DrawingValue): DrawingValue {
  const out = canonDrawing(d);
  return out.text ? { ...out, text: { ...out.text, blocks: [] } } : out;
}

/** Commands allowed for the paragraphs inside a drawing's text (addressed by their ids). */
const IN_DRAWING = new Set<WriteCommand["type"]>(["splitParagraph", "joinWithPrevious"]);
const inDrawing = (c: WriteCommand): boolean =>
  c.type === "compound" ? c.commands.every(inDrawing) : IN_PLACE.has(c.type) || IN_DRAWING.has(c.type);

/**
 * The same drawing changed: `SetDrawingProps` for its shape / placement
 * (Rust keeps the text blocks), then the edit of its text — in-place
 * commands (typing, formatting, Enter / Backspace) addressed to the
 * paragraphs inside, else `SetDrawingText` with all its blocks.
 */
function drawingCommand(block: number, offset: number, a: Inline | undefined, b: Inline | undefined, opts: MapperOptions): WriteCommand | null {
  if (a?.kind !== "drawing" || b?.kind !== "drawing" || a.value.id !== b.value.id) return null;
  const [x, y] = [a.value, b.value];
  const cmds: WriteCommand[] = [];
  const hadText = !!x.text;
  if (stableStringify(drawingShell(x)) !== stableStringify(drawingShell(y))) {
    // Group members carry their text: new paragraphs' temporary ids become 0 (fresh ids in the core).
    const shell = drawingShell(y);
    cmds.push({ type: "setDrawingProps", block, offset, drawing: shell.children?.length ? sanitizeDrawing(shell) : shell });
  }
  const ob = (x.text?.blocks ?? []).map(canonBlock);
  const nb = (y.text?.blocks ?? []).map(canonBlock);
  if (hadText && y.text && stableStringify(ob) !== stableStringify(nb)) {
    let s = 0;
    while (s < ob.length && s < nb.length && blockKey(ob[s]!) === blockKey(nb[s]!)) s++;
    let e = 0;
    while (e < ob.length - s && e < nb.length - s && blockKey(ob[ob.length - 1 - e]!) === blockKey(nb[nb.length - 1 - e]!)) e++;
    const os = ob.slice(s, ob.length - e);
    const ns = nb.slice(s, nb.length - e);
    const r = os.length && ns.length && os.every(isPara) && ns.every(isPara) ? classify(os, ns, s > 0 ? ob[s - 1]! : null, opts) : null;
    if (r && !r.followUp && inDrawing(r.command)) cmds.push(r.command);
    else cmds.push({ type: "setDrawingText", block, offset, blocks: nb });
  } else if (!hadText && y.text && cmds.length === 0) {
    cmds.push({ type: "setDrawingText", block, offset, blocks: nb });
  }
  return cmds.length ? one(cmds) : null;
}

/** A drawing with negative (temporary) ids inside → 0 (the core gives them fresh ids). */
export function sanitizeDrawing(d: DrawingValue): DrawingValue {
  return {
    ...d,
    id: d.id < 0 ? 0 : d.id,
    ...(d.text ? { text: { ...d.text, blocks: sanitizeNested(d.text.blocks ?? []) } } : {}),
    ...(d.children?.length ? { children: d.children.map(sanitizeDrawing) } : {}),
  };
}

/** Blocks inside drawings: every temporary id → 0. */
function sanitizeNested(bs: Block[]): Block[] {
  return bs.map((b) => {
    if (b.kind === "paragraph") {
      const v = { ...b.value, id: b.value.id < 0 ? 0 : b.value.id };
      v.inlines = (v.inlines ?? []).map((i) => (i.kind === "drawing" ? ({ kind: "drawing", value: sanitizeDrawing(i.value) } as Inline) : i));
      return { kind: "paragraph", value: v } as Block;
    }
    if (b.kind === "table") {
      return {
        kind: "table",
        value: {
          ...b.value,
          id: Math.max(0, b.value.id),
          rows: b.value.rows.map((r) => ({ ...r, id: Math.max(0, r.id), cells: r.cells.map((c) => ({ ...c, id: Math.max(0, c.id), blocks: sanitizeNested(c.blocks) })) })),
        },
      } as Block;
    }
    return b;
  });
}

/** Negative (temporary) ids inside drawings → 0 (the core gives them fresh ids). */
export function sanitizeDrawingIds(blocks: Block[]): Block[] {
  // Top-level ids may be temporary (the core maps them); only those inside drawings are reset.
  return blocks.map((b) => {
    if (b.kind !== "paragraph" || !(b.value.inlines ?? []).some((i) => i.kind === "drawing")) return b;
    const inlines = (b.value.inlines ?? []).map((i) => (i.kind === "drawing" ? ({ kind: "drawing", value: sanitizeDrawing(i.value) } as Inline) : i));
    return { kind: "paragraph", value: { ...b.value, inlines } } as Block;
  });
}

/** Inline-level change of one paragraph, or null when not expressible. */
function inlineCommand(id: number, oldInlines: Inline[], newInlines: Inline[], opts: MapperOptions = {}): WriteCommand | null {
  const a = positions(oldInlines);
  const b = positions(newInlines);
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre]!.key === b[pre]!.key) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf]!.key === b[b.length - 1 - suf]!.key) suf++;
  const oldMid = a.slice(pre, a.length - suf);
  const newMid = b.slice(pre, b.length - suf);
  if (!oldMid.length && !newMid.length) return null;
  const allText = (ps: Pos[]) => ps.every((p) => p.ch !== undefined);
  if (!newMid.length) return { type: "deleteText", block: id, from: pre, to: pre + oldMid.length };
  // Comment markers kept by an edit (the comments plugin, like Rust's
  // `DeleteText`/`ReplaceText`, keeps a lone marker: ends before the new
  // text, starts after it): the text change alone.
  const kept = keptMarkers(oldMid);
  if (kept.ends.length + kept.starts.length > 0) {
    const ke = kept.ends.length;
    const ks = kept.starts.length;
    const lead = newMid.slice(0, ke).map((p) => p.key);
    const tail = newMid.slice(newMid.length - ks).map((p) => p.key);
    const text = newMid.slice(ke, newMid.length - ks);
    if (newMid.length >= ke + ks && stableStringify(lead) === stableStringify(kept.ends) && stableStringify(tail) === stableStringify(kept.starts) && allText(text)) {
      const del: WriteCommand = { type: "deleteText", block: id, from: pre, to: pre + oldMid.length };
      if (!text.length) return del;
      const cmds: WriteCommand[] = [del];
      let offset = pre + ke;
      for (const sg of segments(text)) {
        cmds.push(insertCmd(id, offset, sg));
        offset += [...sg.text].length;
      }
      return { type: "compound", commands: cmds };
    }
  }
  if (oldMid.length === 1 && newMid.length === 1) {
    const img = imageCommand(id, pre, oldMid[0]!.inline, newMid[0]!.inline);
    if (img) return img;
    const dr = drawingCommand(id, pre, oldMid[0]!.inline, newMid[0]!.inline, opts);
    if (dr) return dr;
  }
  if (!allText(newMid)) return null;
  const inserts = (at: number): WriteCommand[] => {
    const cmds: WriteCommand[] = [];
    let offset = at;
    for (const s of segments(newMid)) {
      cmds.push(insertCmd(id, offset, s));
      offset += [...s.text].length;
    }
    return cmds;
  };
  if (!oldMid.length) {
    const cmds = inserts(pre);
    return cmds.length === 1 ? cmds[0]! : { type: "compound", commands: cmds };
  }
  // Same characters, different formatting: a mark change.
  if (oldMid.length === newMid.length && allText(oldMid) && oldMid.every((o, i) => o.ch === newMid[i]!.ch)) {
    const to = pre + oldMid.length;
    const propsChanged = oldMid.some((o, i) => propsKey(o.props) !== propsKey(newMid[i]!.props));
    const styles = new Set(newMid.map((n) => n.style ?? ""));
    const styleChanged = oldMid.some((o, i) => (o.style ?? "") !== (newMid[i]!.style ?? ""));
    const linkChanged = oldMid.some((o, i) => stableStringify(o.link ?? null) !== stableStringify(newMid[i]!.link ?? null));
    const patch = propsChanged ? runPatch(oldMid, newMid) : null;
    if (!linkChanged && (!propsChanged || patch) && (!styleChanged || styles.size === 1)) {
      const cmds: WriteCommand[] = [];
      if (patch) cmds.push({ type: "setRunProps", block: id, from: pre, to, patch });
      if (styleChanged) cmds.push({ type: "applyCharacterStyle", block: id, from: pre, to, style: [...styles][0] || null });
      if (cmds.length) return one(cmds);
    }
  }
  const segs = segments(newMid);
  if (
    segs.length === 1 &&
    oldMid[0]!.ch !== undefined &&
    propsKey(oldMid[0]!.props) === propsKey(segs[0]!.props) &&
    (oldMid[0]!.style ?? "") === segs[0]!.style &&
    stableStringify(oldMid[0]!.link ?? null) === stableStringify(segs[0]!.link ?? null)
  ) {
    return { type: "replaceText", block: id, from: pre, to: pre + oldMid.length, text: segs[0]!.text };
  }
  return { type: "compound", commands: [{ type: "deleteText", block: id, from: pre, to: pre + oldMid.length }, ...inserts(pre)] };
}

// ----- paragraph properties --------------------------------------------------

const PARA_KEYS = [
  "style", "alignment", "indent", "spacing", "numbering", "keepNext", "keepLines", "widowControl", "suppressLineNumbers", "suppressAutoHyphens",
  "pageBreakBefore", "contextualSpacing", "outlineLevel", "runDefaults", "borders", "shading", "tabs",
] as const;
type ParaKey = (typeof PARA_KEYS)[number];

const kindOfSynthetic = (numId: number): "bullet" | "decimal" | null =>
  numId === SYNTHETIC_BULLET ? "bullet" : numId === SYNTHETIC_DECIMAL ? "decimal" : null;

/** Commands turning the props of `olds[i]` into `news[i]` (same ids), or null. */
function propsCommands(olds: Paragraph[], news: Paragraph[], opts: MapperOptions): WriteCommand[] | null {
  const get = (p: Paragraph, k: ParaKey) => (canonValue(p.props ?? {}) as ParagraphProperties)[k];
  const changed = (k: ParaKey) =>
    olds.map((_o, i) => i).filter((i) => stableStringify(get(olds[i]!, k)) !== stableStringify(get(news[i]!, k)));
  const cmds: WriteCommand[] = [];

  // Lists.
  const nIdx = changed("numbering");
  if (nIdx.length) {
    const ids = nIdx.map((i) => news[i]!.id);
    const oldN = nIdx.map((i) => olds[i]!.props?.numbering);
    const newN = nIdx.map((i) => news[i]!.props?.numbering);
    const off = (n: typeof oldN[number]) => !n || n.numId === 0;
    if (newN.every(off)) {
      cmds.push({ type: "applyList", blocks: ids, kind: "none" });
    } else if (
      newN.every((n) => !off(n)) &&
      oldN.every((o, k) => !off(o) && o!.numId === newN[k]!.numId) &&
      new Set(newN.map((n, k) => n!.level - oldN[k]!.level)).size === 1
    ) {
      cmds.push({ type: "indentList", blocks: ids, delta: newN[0]!.level - oldN[0]!.level });
    } else if (newN.every((n) => !off(n))) {
      const kinds = new Set(newN.map((n) => kindOfSynthetic(n!.numId) ?? opts.listKindOf?.(n!.numId) ?? null));
      if (kinds.size !== 1 || kinds.has(null)) return null;
      const kind = [...kinds][0]!;
      cmds.push({ type: "applyList", blocks: ids, kind });
      // ApplyList keeps the old level (0 when not numbered before).
      const levels = newN.map((n, k) => n!.level - (off(oldN[k]) ? 0 : oldN[k]!.level));
      if (new Set(levels).size !== 1) return null;
      if (levels[0] !== 0) cmds.push({ type: "indentList", blocks: ids, delta: levels[0]! });
    } else return null;
  }

  // Style. A Normal paragraph that becomes a list item takes List Paragraph inside `ApplyList` (W-03): no SetStyle.
  const unnumbered = (n: { numId: number } | undefined | null) => !n || n.numId === 0;
  const sIdx = changed("style").filter(
    (i) =>
      !(news[i]!.props?.style === "ListParagraph" && !olds[i]!.props?.style && unnumbered(olds[i]!.props?.numbering) && !unnumbered(news[i]!.props?.numbering)),
  );
  if (sIdx.length) {
    const styles = new Set(sIdx.map((i) => news[i]!.props?.style ?? opts.defaultStyle ?? "Normal"));
    if (styles.size !== 1) return null;
    cmds.push({ type: "setStyle", blocks: sIdx.map((i) => news[i]!.id), style: [...styles][0]! });
  }

  // Everything else: SetParagraphProps with a verified patch.
  const rest = PARA_KEYS.filter((k) => k !== "style" && k !== "numbering");
  const patch: Record<string, unknown> = {};
  const touched = new Set<number>();
  for (const k of rest) {
    const idx = changed(k);
    if (!idx.length) continue;
    const values = new Set(idx.map((i) => stableStringify(get(news[i]!, k))));
    if (values.size !== 1) return null;
    const v = get(news[idx[0]!]!, k);
    if (v === undefined) return null;
    patch[k] = v;
    idx.forEach((i) => touched.add(i));
  }
  if (touched.size) {
    const idx = [...touched].sort((x, y) => x - y);
    const strip = (p: ParagraphProperties) => {
      const { style: _s, numbering: _n, ...r } = p;
      return stableStringify(canonValue(r));
    };
    const ok = idx.every((i) => strip(applyParagraphPatch(olds[i]!.props, patch as ParagraphProperties)) === strip(news[i]!.props ?? {}));
    if (!ok) return null;
    cmds.push({ type: "setParagraphProps", blocks: idx.map((i) => news[i]!.id), patch: patch as ParagraphProperties });
  }
  return cmds;
}

// ----- block-level classification -------------------------------------------

const one = (cmds: WriteCommand[]): WriteCommand => (cmds.length === 1 ? cmds[0]! : { type: "compound", commands: cmds });

function concatInlines(a: Inline[], b: Inline[]): string {
  return stableStringify(positions([...a, ...b]).map((p) => p.key));
}

/** Replaces synthetic list ids for `ReplaceBlocks`; returns the blocks needing a follow-up `ApplyList`. */
function resolveSynthetic(blocks: Block[], opts: MapperOptions): { blocks: Block[]; followUp?: MapResult["followUp"] } {
  const pending: number[] = [];
  let pendingKind: ListKind | null = null;
  const out = blocks.map((b) => {
    if (!isPara(b)) return b;
    const n = b.value.props?.numbering;
    const kind = n ? kindOfSynthetic(n.numId) : null;
    if (!n || !kind) return b;
    const real = opts.listIdFor?.(kind) ?? null;
    const props = { ...b.value.props };
    if (real != null) props.numbering = { numId: real, level: n.level };
    else {
      delete props.numbering;
      if (pendingKind === null || pendingKind === kind) {
        pendingKind = kind;
        pending.push(b.value.id);
      }
    }
    return { kind: "paragraph", value: { ...b.value, props } } as Block;
  });
  return pending.length ? { blocks: out, followUp: { ids: pending, kind: pendingKind! } } : { blocks: out };
}

function replaceBlocks(ids: number[], blocks: Block[], opts: MapperOptions): MapResult {
  const r = resolveSynthetic(sanitizeDrawingIds(blocks), opts);
  const command: WriteCommand = blocks.length ? { type: "replaceBlocks", ids, blocks: r.blocks } : { type: "deleteBlocks", ids };
  return r.followUp ? { command, followUp: r.followUp } : { command };
}

/** Commands addressed to existing paragraphs only (valid inside a table cell as well). */
const IN_PLACE = new Set<WriteCommand["type"]>([
  "insertText", "deleteText", "replaceText", "setRunProps", "setParagraphProps", "setStyle", "setImageSize", "setImageAlt", "setImageMeta", "setImageAnchor",
  "setImageFormat", "setImageLink", "setDrawingProps", "setDrawingText",
]);
const inPlace = (c: WriteCommand): boolean =>
  c.type === "compound" ? c.commands.every(inPlace) : IN_PLACE.has(c.type);

type T = Extract<Block, { kind: "table" }>["value"];
const shell = (x: { props?: unknown; gridSpan?: number; vMerge?: unknown }) =>
  stableStringify(canonValue({ props: x.props ?? {}, span: (x.gridSpan ?? 1) > 1 ? x.gridSpan : null, vMerge: x.vMerge ?? null }));

/**
 * Typing or formatting inside one cell of an otherwise unchanged table:
 * the in-place paragraph commands for that cell (P5-4: a 200-row table is
 * not resent per keystroke), or null.
 */
function cellCommand(o: T, n: T, opts: MapperOptions): MapResult | null {
  if (o.id !== n.id || shell(o) !== shell(n) || o.rows.length !== n.rows.length) return null;
  let changed: [Block[], Block[]] | null = null;
  for (let r = 0; r < o.rows.length; r++) {
    const [or, nr] = [o.rows[r]!, n.rows[r]!];
    if (or.id !== nr.id || shell(or) !== shell(nr) || or.cells.length !== nr.cells.length) return null;
    for (let c = 0; c < or.cells.length; c++) {
      const [oc, nc] = [or.cells[c]!, nr.cells[c]!];
      if (oc.id !== nc.id || shell(oc) !== shell(nc)) return null;
      if (oc.blocks.length === nc.blocks.length && oc.blocks.every((b, i) => blockKey(b) === blockKey(nc.blocks[i]!))) continue;
      if (changed) return null;
      changed = [oc.blocks, nc.blocks];
    }
  }
  if (!changed) return null;
  const [ob, nb] = changed;
  let a = 0;
  while (a < ob.length && a < nb.length && blockKey(ob[a]!) === blockKey(nb[a]!)) a++;
  let z = 0;
  while (z < ob.length - a && z < nb.length - a && blockKey(ob[ob.length - 1 - z]!) === blockKey(nb[nb.length - 1 - z]!)) z++;
  const [os, ns] = [ob.slice(a, ob.length - z), nb.slice(a, nb.length - z)];
  if (!os.length || os.length !== ns.length || !os.every(isPara) || !ns.every(isPara)) return null;
  const r = classify(os, ns, a > 0 ? ob[a - 1]! : null, opts);
  return r && !r.followUp && inPlace(r.command) ? r : null;
}

/**
 * Classifies the difference between the (trimmed) old blocks `ob` and new
 * blocks `nb`; `after` is the id of the block before them (null = start).
 */
export function classify(ob: Block[], nb: Block[], prev: Block | null, opts: MapperOptions = {}): MapResult | null {
  if (!ob.length && !nb.length) return null;
  const after = prev ? prev.value.id : null;
  // Enter at the end of a paragraph: one new empty paragraph after it.
  if (!ob.length && nb.length === 1 && prev && isPara(prev) && isPara(nb[0]!)) {
    const q = (nb[0] as P).value;
    const strip = (p: Paragraph) => {
      const { style: _s, ...r } = p.props ?? {};
      return stableStringify(canonValue(r));
    };
    if (q.inlines.length === 0 && q.id < 0 && strip(q) === strip(prev.value)) {
      return { command: { type: "splitParagraph", block: prev.value.id, offset: positions(prev.value.inlines).length, newId: q.id } };
    }
  }
  if (!ob.length) {
    const r = resolveSynthetic(sanitizeDrawingIds(nb), opts);
    const command: WriteCommand = { type: "insertBlocks", after, blocks: r.blocks };
    return r.followUp ? { command, followUp: r.followUp } : { command };
  }
  if (!nb.length) return { command: { type: "deleteBlocks", ids: ob.map((b) => b.value.id) } };

  const allParas = ob.every(isPara) && nb.every(isPara);
  if (allParas) {
    const o = ob as P[];
    const n = nb as P[];
    // Same paragraphs: inline and/or property changes.
    if (o.length === n.length && o.every((b, i) => b.value.id === n[i]!.value.id)) {
      const cmds: WriteCommand[] = [];
      const inlineChanged = o.filter((b, i) => concatInlines(b.value.inlines, []) !== concatInlines(n[i]!.value.inlines, []));
      if (inlineChanged.length > 1) return replaceBlocks(o.map((b) => b.value.id), nb, opts);
      const propsCmds = propsCommands(o.map((b) => b.value), n.map((b) => b.value), opts);
      if (!propsCmds) return replaceBlocks(o.map((b) => b.value.id), nb, opts);
      cmds.push(...propsCmds);
      if (inlineChanged.length === 1) {
        const i = o.indexOf(inlineChanged[0]!);
        const c = inlineCommand(o[i]!.value.id, o[i]!.value.inlines, n[i]!.value.inlines, opts);
        if (!c) return replaceBlocks(o.map((b) => b.value.id), nb, opts);
        cmds.push(c);
      }
      return cmds.length ? { command: one(cmds) } : null;
    }
    // Split: [P] → [P', Q] with P' keeping the id and props.
    if (o.length === 1 && n.length === 2 && n[0]!.value.id === o[0]!.value.id && n[1]!.value.id !== o[0]!.value.id) {
      const [p, q] = [n[0]!.value, n[1]!.value];
      if (
        stableStringify(canonValue(p.props ?? {})) === stableStringify(canonValue(o[0]!.value.props ?? {})) &&
        concatInlines(p.inlines, q.inlines) === concatInlines(o[0]!.value.inlines, [])
      ) {
        const offset = positions(p.inlines).length;
        return { command: { type: "splitParagraph", block: p.id, offset, newId: q.id } };
      }
    }
    // Join: [P, Q] → [P'] (Backspace at the start of Q).
    if (o.length === 2 && n.length === 1 && n[0]!.value.id === o[0]!.value.id) {
      const [p, q] = [o[0]!.value, o[1]!.value];
      if (
        stableStringify(canonValue(n[0]!.value.props ?? {})) === stableStringify(canonValue(p.props ?? {})) &&
        concatInlines(p.inlines, q.inlines) === concatInlines(n[0]!.value.inlines, [])
      ) {
        return { command: { type: "joinWithPrevious", block: q.id } };
      }
    }
  }
  if (ob.length === 1 && nb.length === 1 && ob[0]!.kind === "table" && nb[0]!.kind === "table") {
    const r = cellCommand(ob[0]!.value, nb[0]!.value, opts);
    if (r) return r;
  }
  return replaceBlocks(ob.map((b) => b.value.id), nb, opts);
}

/** Number of body (non-notes) top-level children. */
const bodyCount = (doc: PMNode): number => doc.childCount - (doc.lastChild?.type.name === "notes" ? 1 : 0);

/** The body change `before → after` (the notes area excluded). */
function mapBodyChange(before: PMNode, after: PMNode, opts: MapperOptions): MapResult | null {
  const oc = bodyCount(before);
  const nc = bodyCount(after);
  const same = (x: PMNode, y: PMNode) => x === y || x.eq(y);
  let pre = 0;
  while (pre < oc && pre < nc && same(before.child(pre), after.child(pre))) pre++;
  let suf = 0;
  while (suf < oc - pre && suf < nc - pre && same(before.child(oc - 1 - suf), after.child(nc - 1 - suf))) suf++;
  const ob: Block[] = [];
  for (let i = pre; i < oc - suf; i++) ob.push(...topBlocks(before.child(i)));
  const nb: Block[] = [];
  for (let i = pre; i < nc - suf; i++) nb.push(...topBlocks(after.child(i)));
  // Trim identical blocks at both ends (model level).
  let a = 0;
  while (a < ob.length && a < nb.length && blockKey(ob[a]!) === blockKey(nb[a]!)) a++;
  let z = 0;
  while (z < ob.length - a && z < nb.length - a && blockKey(ob[ob.length - 1 - z]!) === blockKey(nb[nb.length - 1 - z]!)) z++;
  let prev: Block | null = null;
  if (a > 0) prev = ob[a - 1]!;
  else if (pre > 0) {
    const blocks = topBlocks(before.child(pre - 1));
    prev = blocks.length ? blocks[blocks.length - 1]! : null;
  }
  const os = ob.slice(a, ob.length - z);
  const ns = nb.slice(a, nb.length - z);
  const result = classify(os, ns, prev, opts);
  // Deleting a note reference deletes its note (Word): `deleteFootnote` after
  // the text change, unless the reference still exists elsewhere (moved).
  const lost = noteRefIds(os);
  if (lost.size) {
    for (const id of noteRefIds(ns)) lost.delete(id);
    if (lost.size) for (const id of bodyNoteRefs(after)) lost.delete(id);
  }
  if (!lost.size) return result;
  const extra: WriteCommand[] = [...lost].sort((x, y) => x - y).map((id) => ({ type: "deleteFootnote", id }));
  return { ...(result ?? {}), command: one([...(result ? [result.command] : []), ...extra]) };
}

/** Note ids referenced anywhere in the body of `doc`. */
function bodyNoteRefs(doc: PMNode): Set<number> {
  const out = new Set<number>();
  const n = bodyCount(doc);
  for (let i = 0; i < n; i++) {
    doc.child(i).descendants((node) => {
      if (node.type.name === "noteRef") out.add(node.attrs.id as number);
      return true;
    });
  }
  return out;
}

/** In-place commands (text, formatting) inside one note, else `ReplaceNote`. */
function noteCommand(o: PMNode, n: PMNode, opts: MapperOptions): WriteCommand | null {
  const ob = nodesToBlocks(o);
  const nb = nodesToBlocks(n);
  let a = 0;
  while (a < ob.length && a < nb.length && blockKey(ob[a]!) === blockKey(nb[a]!)) a++;
  let z = 0;
  while (z < ob.length - a && z < nb.length - a && blockKey(ob[ob.length - 1 - z]!) === blockKey(nb[nb.length - 1 - z]!)) z++;
  const [os, ns] = [ob.slice(a, ob.length - z), nb.slice(a, nb.length - z)];
  if (!os.length && !ns.length) return null;
  if (os.length && os.every(isPara) && ns.every(isPara)) {
    // Typing and formatting in place; Enter / Backspace as split / join (P9-W6: the core edits notes like the body).
    const r = classify(os, ns, a > 0 ? ob[a - 1]! : null, opts);
    if (r && !r.followUp && (os.length === ns.length ? inPlace(r.command) : inDrawing(r.command))) return r.command;
  }
  const id = n.attrs.id as number;
  return { type: "replaceNote", id, blocks: resolveSynthetic(nb, opts).blocks };
}

/** Commands for edits inside the notes area (notes matched by id; removed notes are handled by `deleteFootnote`). */
function mapNotesChange(before: PMNode | null, after: PMNode | null, opts: MapperOptions): WriteCommand[] {
  if (!after || before === after) return [];
  const old = new Map<number, PMNode>();
  before?.forEach((n) => old.set(n.attrs.id as number, n));
  const out: WriteCommand[] = [];
  after.forEach((n) => {
    const o = old.get(n.attrs.id as number);
    if (!o || o === n || o.eq(n)) return;
    const c = noteCommand(o, n, opts);
    if (c) out.push(c);
  });
  return out;
}

/** The command for the change `before → after`, or null when the model is unchanged. */
export function mapDocChange(before: PMNode, after: PMNode, opts: MapperOptions = {}): MapResult | null {
  if (before === after) return null;
  const body = mapBodyChange(before, after, opts);
  const notes = mapNotesChange(notesNode(before), notesNode(after), opts);
  if (!notes.length) return body;
  return { ...(body ?? {}), command: one([...(body ? [body.command] : []), ...notes]) };
}

export function mapTransaction(tr: Transaction, opts: MapperOptions = {}): MapResult | null {
  if (!tr.docChanged) return null;
  return mapDocChange(tr.before, tr.doc, opts);
}
