// DOM measurement for the pagination (docs/write-layout.md, step 1): every
// top-level block is measured once into block-relative "items" (paragraph
// lines, table rows with their cells' lines, atoms) and cached; `buildFlow`
// chains the cached blocks into the natural flow `paginate` consumes.
// Rects are read in client px and divided by the zoom; spacers the
// pagination inserted are subtracted, so a block measures the same with or
// without page gaps.

import type { Node as PMNode } from "@tiptap/pm/model";
import type { Columns } from "../../generated/Columns";
import { columnLayout } from "../columns";
import { collapseMargins, lineSlots, mergeLineRects, type Anchor, type CellContent, type CellFlow, type EndnoteGroup, type Flow, type FootnoteFlow, type Unit } from "./paginate";

/** Flow options of a paragraph (resolved: style chain + direct). */
export interface FlowProps {
  widowControl?: boolean | null;
  keepLines?: boolean | null;
  keepNext?: boolean | null;
  pageBreakBefore?: boolean | null;
}

/** A block-relative spacer anchor: a PM offset from the block's position, or a live resolver. */
export type CachedAnchor = { kind: "block"; rel: number } | { kind: "inline"; rel?: number; fn?: () => number } | { kind: "cells"; rels: number[] };

export interface CellItem {
  lines: { top: number; bottom: number; at: CachedAnchor }[];
  bottom: number;
  /** Lines and nested table rows in order (cells holding nested tables). */
  content?: CachedContent[];
}

/** A line of a cell or a row of a nested table (block-relative, like `CellItem`). */
export type CachedContent =
  | { kind: "line"; top: number; bottom: number; at: CachedAnchor }
  | { kind: "row"; top: number; bottom: number; cantSplit?: boolean; header?: boolean; at: CachedAnchor; cells: CellItem[] };

export interface Item {
  kind: "line" | "row" | "atom";
  top: number;
  bottom: number;
  anchorTop: number;
  at: CachedAnchor;
  /** Paragraph index within the block (-1: none). */
  para: number;
  notes?: number[];
  pageBreakBefore?: boolean;
  columnBreakBefore?: boolean;
  row?: number;
  header?: boolean;
  cantSplit?: boolean;
  cells?: CellItem[];
  /** Child index in a columns box. */
  child?: number;
  /** Left edge (client px / zoom): a different column in a columns box. */
  left?: number;
  /** Bottom of the glyphs of a line. */
  ink?: number;
}

export interface ParaItem {
  first: number;
  last: number;
  flow: FlowProps;
  /** Section id ended by this paragraph. */
  sectionEnd?: number;
}

/** One measured top-level block (block-relative px; a columns box: its single-column virtual flow). */
export interface BlockMeasure {
  kind: "flow" | "table" | "atom" | "columns" | "notes";
  height: number;
  mt: number;
  mb: number;
  items: Item[];
  paras: ParaItem[];
  /** A page break (or a column break) after the last line. */
  breakAfter?: "page" | "column";
  /** Tables: leading header rows and their height. */
  headerRows?: number;
  headerHeight?: number;
  /** Columns boxes: the children (virtual top / bottom) and the column geometry. */
  children?: { y: number; bottom: number }[];
  columns?: { x: number; width: number }[];
  /** The notes area: footnotes, and endnotes when they go to their section's end. */
  footnotes?: NoteMeasure[];
  endnotes?: NoteMeasure[];
  /** Vertical padding + border of the element (its content box is `height - pad`). */
  pad?: number;
}

export interface MeasureContext {
  /** PM info of a textblock element (null: not a textblock). */
  textblock(el: Element): { node: PMNode | null; pos: number } | null;
  /** PM position of a DOM point (-1 when unknown). */
  posAt(node: Node, offset: number): number;
  flow(node: PMNode | null): FlowProps;
  /** Client px per CSS px (CSS zoom of the page). */
  zoom: number;
  /** Endnotes go to the end of their section (`w:endnotePr/w:pos="sectEnd"`): measured on their own, not in the notes area's flow. */
  endnotesAtSectionEnd?: boolean;
}

const SKIP = ".page-spacer, .page-colbreak, .inline-image-wrap.floating, .drawing-wrap.floating, .notes-separator, .note-label, .note[data-note-kind='foot']";

interface RawRect {
  top: number;
  bottom: number;
  left: number;
  ref: { node: Node; frag: number } | { el: Element };
}

const hasRects = typeof Range !== "undefined" && typeof Range.prototype.getClientRects === "function";

function cssPx(v: string | null | undefined): number {
  const n = parseFloat(v ?? "");
  return Number.isFinite(n) ? n : 0;
}

/** The box of an element as top of its first fragment and bottom of its last (a block split over columns has several). */
function fragmentBox(el: Element): { top: number; bottom: number; height: number; left: number } {
  const rs = el.getClientRects();
  if (rs.length > 1) return { top: rs[0]!.top, bottom: rs[rs.length - 1]!.bottom, height: rs[rs.length - 1]!.bottom - rs[0]!.top, left: rs[0]!.left };
  const r = el.getBoundingClientRect();
  return { top: r.top, bottom: r.bottom, height: r.height, left: r.left };
}

/** Spacers inside `root` (client rects / zoom): `[bottom, height]`. */
function spacersIn(root: Element, z: number): [number, number][] {
  const out: [number, number][] = [];
  root.querySelectorAll<HTMLElement>(".page-spacer").forEach((s) => {
    const r = s.getBoundingClientRect();
    if (r.height > 0) out.push([r.bottom / z, r.height / z]);
  });
  return out.sort((a, b) => a[0] - b[0]);
}

/** `y` (client / zoom) without the spacers above it, relative to `base`; `at` decides which spacers are above (default `y`). */
function naturalY(y: number, base: number, spacers: [number, number][], at = y): number {
  let s = 0;
  for (const [bottom, h] of spacers) if (bottom <= at + 0.5) s += h;
  return y - base - s;
}

/** A rect without the spacers above its middle (glyph boxes overhang the line box a little). */
function naturalRect(top: number, bottom: number, base: number, spacers: [number, number][]): { top: number; bottom: number } {
  const mid = (top + bottom) / 2;
  return { top: naturalY(top, base, spacers, mid), bottom: naturalY(bottom, base, spacers, mid) };
}

/** The client rects of a textblock's inline content in DOM order. */
function inlineRects(el: Element): { rects: RawRect[]; refs: Element[]; breaks: { y: number; kind: "page" | "column" }[] } {
  const rects: RawRect[] = [];
  const refs: Element[] = [];
  const breaks: { y: number; kind: "page" | "column" }[] = [];
  const range = el.ownerDocument.createRange();
  const walk = (n: Node) => {
    for (let c = n.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) {
        const text = c.nodeValue ?? "";
        if (!text.length) continue;
        range.selectNodeContents(c);
        Array.from(range.getClientRects()).forEach((r, frag) => {
          if (r.height > 0) rects.push({ top: r.top, bottom: r.bottom, left: r.left, ref: { node: c, frag } });
        });
        continue;
      }
      if (c.nodeType !== 1) continue;
      const e = c as Element;
      if (e.matches(SKIP)) continue;
      if (e.matches(".page-break, .column-break")) {
        const r = e.getBoundingClientRect();
        breaks.push({ y: r.bottom, kind: e.classList.contains("page-break") ? "page" : "column" });
        continue;
      }
      if (e.matches("sup.note-ref")) refs.push(e);
      // Pictures and inline shapes / text boxes are one box each (a text box's own paragraphs are not lines of the page).
      if (e.matches("img, .inline-image-wrap, .drawing-wrap, sup.note-ref, .tab-char, br") || !e.firstChild) {
        if (e.tagName === "BR" && rects.length) continue;
        const r = e.getBoundingClientRect();
        if (r.height > 0) rects.push({ top: r.top, bottom: r.bottom, left: r.left, ref: { el: e } });
        if (e.matches("img, .inline-image-wrap, .drawing-wrap, br")) continue;
      }
      walk(e);
    }
  };
  walk(el);
  return { rects, refs, breaks };
}

/** The first character offset of `text` whose rect starts at or below `top` (client px): where a wrapped line begins. */
function lineStartOffset(text: Node, top: number): number {
  const len = text.nodeValue?.length ?? 0;
  const range = text.ownerDocument!.createRange();
  let lo = 0;
  let hi = len - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    range.setStart(text, mid);
    range.setEnd(text, mid + 1);
    const rs = range.getClientRects();
    const r = rs[rs.length - 1];
    if (r && r.top >= top - 1) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** A resolver of the PM position where the line with first rect `r` starts. */
function lineStart(r: RawRect, ctx: MeasureContext): () => number {
  return () => {
    if ("el" in r.ref) {
      const e = r.ref.el;
      const parent = e.parentNode!;
      return ctx.posAt(parent, Array.prototype.indexOf.call(parent.childNodes, e));
    }
    const { node, frag } = r.ref;
    return ctx.posAt(node, frag === 0 ? 0 : lineStartOffset(node, r.top));
  };
}

interface TextLines {
  lines: { top: number; bottom: number; ink?: number; left: number; at: CachedAnchor; notes?: number[]; pageBreakBefore?: boolean; columnBreakBefore?: boolean }[];
  breakAfter?: "page" | "column";
  /** Natural content bottom (relative). */
  bottom: number;
}

/** Lines of a textblock relative to `base` (client / zoom), spacers subtracted; the first line's anchor is `first`. */
function textLines(el: HTMLElement, base: number, spacers: [number, number][], first: CachedAnchor, ctx: MeasureContext, contained: boolean): TextLines {
  const z = ctx.zoom;
  const cs = getComputedStyle(el);
  const box = fragmentBox(el);
  const pt = cssPx(cs.paddingTop) + cssPx(cs.borderTopWidth);
  const pb = cssPx(cs.paddingBottom) + cssPx(cs.borderBottomWidth);
  const contentTop = naturalY(box.top / z, base, spacers) + pt;
  const { rects, refs, breaks } = hasRects ? inlineRects(el) : { rects: [], refs: [], breaks: [] };
  const nat = rects.map((r) => naturalRect(r.top / z, r.bottom / z, base, spacers));
  const merged = mergeLineRects(nat);
  const lh = cssPx(cs.lineHeight);
  const last = merged[merged.length - 1];
  const halfLeading = last && lh > 0 ? Math.max(0, (lh - (last.bottom - last.top)) / 2) : 0;
  let contentBottom = contained || !box.height ? (last ? last.bottom + halfLeading : contentTop + Math.max(lh, 0)) : naturalY(box.bottom / z, base, spacers) - pb;
  if (last && contentBottom < last.bottom) contentBottom = last.bottom;
  if (!merged.length) {
    return { lines: [{ top: contentTop - pt, bottom: Math.max(contentBottom, contentTop) + pb, left: box.left / z, at: first }], bottom: contentBottom + pb };
  }
  const slots = fragmentSlots(merged, merged.map((m) => rects[m.first]!.left / z), contentTop, contentBottom, halfLeading);
  const lines: TextLines["lines"] = slots.map((s, k) => ({
    top: k === 0 ? contentTop - pt : s.top,
    bottom: k === slots.length - 1 ? s.bottom + pb : s.bottom,
    left: rects[merged[k]!.first]!.left / z,
    ink: merged[k]!.bottom,
    at: k === 0 ? first : { kind: "inline", fn: lineStart(rects[merged[k]!.first]!, ctx) },
  }));
  // Floating pictures, shapes and text boxes may hang below the text: the page cover must not hide them.
  const last2 = lines[lines.length - 1]!;
  // (Rotated shapes too: the rotated box may reach below its line.)
  el.querySelectorAll(".drawing-wrap.floating, .inline-image-wrap.floating, .drawing-wrap:not(.floating) > .drawing-box[style*='rotate']").forEach((f) => {
    const r = f.getBoundingClientRect();
    if (r.height > 0) last2.ink = Math.max(last2.ink ?? last2.bottom, naturalY(r.bottom / z, base, spacers));
  });
  for (const ref of refs) {
    if ((ref as HTMLElement).dataset.noteKind === "end") continue;
    const id = Number((ref as HTMLElement).dataset.noteId);
    const r = ref.getBoundingClientRect();
    const y = naturalY((r.top + r.bottom) / 2 / z, base, spacers);
    const k = Math.max(0, slots.findIndex((sl) => y < sl.bottom));
    (lines[k]!.notes ??= []).push(id);
  }
  let breakAfter: TextLines["breakAfter"];
  for (const b of breaks) {
    const y = naturalY(b.y / z, base, spacers);
    const k = lines.findIndex((l, i) => i > 0 && l.top >= y - 1);
    if (k < 0) breakAfter = b.kind;
    else if (b.kind === "page") lines[k]!.pageBreakBefore = true;
    else lines[k]!.columnBreakBefore = true;
  }
  return { lines, breakAfter, bottom: contentBottom + pb };
}

/**
 * Line slots of a paragraph that may be split over columns: the lines are
 * cut into runs at column jumps (a line above the previous one, or in
 * another column), each run gets `lineSlots` of its own.
 */
export function fragmentSlots(
  lines: readonly { top: number; bottom: number }[],
  lefts: readonly number[],
  contentTop: number,
  contentBottom: number,
  halfLeading = 0,
): { top: number; bottom: number }[] {
  const out: { top: number; bottom: number }[] = [];
  let start = 0;
  for (let k = 1; k <= lines.length; k++) {
    const jump = k < lines.length && (lines[k]!.top < lines[k - 1]!.bottom - 1 || Math.abs((lefts[k] ?? 0) - (lefts[k - 1] ?? 0)) > 20);
    if (k < lines.length && !jump) continue;
    const run = lines.slice(start, k);
    const top = start === 0 ? contentTop : run[0]!.top - halfLeading;
    const bottom = k === lines.length ? contentBottom : run[run.length - 1]!.bottom + halfLeading;
    out.push(...lineSlots(run, top, bottom));
    start = k;
  }
  return out;
}

/** Whether the browser skips the element's content (`content-visibility: auto` off screen): its own box is a placeholder. */
function skipped(el: HTMLElement): boolean {
  const cv = (el as HTMLElement & { checkVisibility?: (o: object) => boolean }).checkVisibility;
  return typeof cv === "function" ? !cv.call(el, { contentVisibilityAuto: true }) : false;
}

/** The textblock elements below `root` in DOM order (not inside skipped parts like the notes' separators). */
function textblocksIn(root: Element, ctx: MeasureContext): HTMLElement[] {
  const out: HTMLElement[] = [];
  const visit = (n: Element) => {
    for (const c of Array.from(n.children)) {
      if (c.matches(SKIP)) continue;
      if (ctx.textblock(c)) out.push(c as HTMLElement);
      else visit(c);
    }
  };
  visit(root);
  return out;
}

function margins(el: HTMLElement): { mt: number; mb: number } {
  const cs = getComputedStyle(el);
  return { mt: cssPx(cs.marginTop), mb: cssPx(cs.marginBottom) };
}

/**
 * The margins of a container block (a list) as CSS collapses them: without padding or a border, the first child's
 * top margin and the last child's bottom margin collapse through it (the last list item's space after is outside
 * the list's border box, so the next block starts below it).
 */
export function collapsedMargins(el: Element): { mt: number; mb: number } {
  const cs = getComputedStyle(el);
  let mt = cssPx(cs.marginTop);
  let mb = cssPx(cs.marginBottom);
  const through = /^(UL|OL|LI)$/.test(el.tagName) && (cs.display === "block" || cs.display === "list-item") && cs.overflow === "visible" && cs.columnCount === "auto" && cs.float === "none";
  if (!through) return { mt, mb };
  const kids = Array.from(el.children).filter((c) => {
    const k = getComputedStyle(c);
    return k.display !== "none" && k.position !== "absolute" && k.position !== "fixed" && k.float === "none";
  });
  const first = kids[0];
  const last = kids[kids.length - 1];
  if (first && cssPx(cs.paddingTop) === 0 && cssPx(cs.borderTopWidth) === 0) mt = collapseMargins(mt, collapsedMargins(first).mt);
  if (last && cssPx(cs.paddingBottom) === 0 && cssPx(cs.borderBottomWidth) === 0) mb = collapseMargins(mb, collapsedMargins(last).mb);
  return { mt, mb };
}

/** Spacers of a cell outside its nested tables (client / zoom): `[bottom, height]`. */
function ownSpacers(td: Element, z: number): [number, number][] {
  const out: [number, number][] = [];
  td.querySelectorAll<HTMLElement>(".page-spacer").forEach((s) => {
    if (s.parentElement?.closest("td, th") !== td) return;
    const r = s.getBoundingClientRect();
    if (r.height > 0) out.push([r.bottom / z, r.height / z]);
  });
  return out.sort((a, b) => a[0] - b[0]);
}

/** The table element of a (nested) table block: the element itself or the table in its wrapper. */
function tableIn(el: Element): HTMLTableElement | null {
  if (el.matches("table")) return el as HTMLTableElement;
  if (el.matches(".tableWrapper")) return el.querySelector(":scope > table");
  return null;
}

/**
 * The content of a cell, natural px relative to the table (`base`: client
 * px / zoom that maps to natural 0): its lines (spacers of the pagination
 * subtracted) and the rows of nested tables, each with its cells measured
 * the same way, so nested tables split across pages like their parent rows.
 */
function cellItem(td: HTMLElement, base: number, first: CachedAnchor, ctx: MeasureContext, pos: number, notes: number[]): CellItem {
  const z = ctx.zoom;
  const sp = ownSpacers(td, z);
  const lines: CellItem["lines"] = [];
  const content: CachedContent[] = [];
  let bottom = naturalY(td.getBoundingClientRect().top / z, base, sp);
  let firstDone = false;
  let nested = false;
  const relOf = (el: Element): number => {
    const p = ctx.posAt(el, 0);
    return p < 0 ? 1 : p - pos;
  };
  const visit = (n: Element) => {
    for (const c of Array.from(n.children)) {
      if (c.matches(SKIP)) continue;
      const info = ctx.textblock(c);
      if (info) {
        const tl = textLines(c as HTMLElement, base, sp, firstDone ? { kind: "inline", rel: info.pos - pos + 1 } : first, ctx, false);
        firstDone = true;
        for (const l of tl.lines) {
          const line = { top: l.top, bottom: l.bottom, at: l.at };
          lines.push(line);
          content.push({ kind: "line", ...line });
          if (l.notes) notes.push(...l.notes);
        }
        bottom = Math.max(bottom, tl.bottom);
        continue;
      }
      const table = tableIn(c);
      if (table) {
        nested = true;
        firstDone = true;
        for (const tr of Array.from(table.rows)) {
          const rr = tr.getBoundingClientRect();
          const top = naturalY(rr.top / z, base, sp);
          const rowBase = rr.top / z - top;
          const cells: CellItem[] = [];
          const rels: number[] = [];
          let contentBottom = top;
          let maxSpacers = 0;
          for (const td2 of Array.from(tr.cells)) {
            const rel = relOf(td2);
            rels.push(rel);
            const ci = cellItem(td2, rowBase, { kind: "block", rel }, ctx, pos, notes);
            cells.push(ci);
            lines.push(...ci.lines);
            contentBottom = Math.max(contentBottom, ci.bottom + cellPad(td2));
            maxSpacers = Math.max(maxSpacers, spacersIn(td2, z).reduce((a, x) => a + x[1], 0));
          }
          // The row's natural height: without the growth its cells' spacers caused (a minimum height stays).
          const observed = rr.height / z;
          const height = Math.min(observed, Math.max(contentBottom - top, observed - maxSpacers));
          const grown = observed - height;
          content.push({ kind: "row", top, bottom: top + height, at: { kind: "cells", rels }, cells, ...(tr.hasAttribute("data-cant-split") ? { cantSplit: true } : {}), ...(tr.hasAttribute("data-header") ? { header: true } : {}) });
          // What follows the row in the cell moves up by the row's growth.
          if (grown > 0) {
            sp.push([rr.bottom / z, grown]);
            sp.sort((a, b) => a[0] - b[0]);
          }
          bottom = Math.max(bottom, top + height);
        }
        continue;
      }
      visit(c);
    }
  };
  visit(td);
  return nested ? { lines, bottom, content } : { lines, bottom };
}

/** Bottom padding and border of a cell (px). */
function cellPad(td: Element): number {
  const cs = getComputedStyle(td);
  return cssPx(cs.paddingBottom) + cssPx(cs.borderBottomWidth);
}

/** Measures a table: rows with their cells' lines (and nested tables' rows); header rows; the cells' spacers and the rows' growth subtracted. */
function measureTable(el: HTMLElement, node: PMNode | null, pos: number, ctx: MeasureContext, base: number): BlockMeasure {
  const z = ctx.zoom;
  const items: Item[] = [];
  const paras: BlockMeasure["paras"] = [];
  const table = tableIn(el) ?? el.querySelector("table");
  const rows = table ? Array.from(table.rows) : [];
  // PM positions of the cells relative to the table node.
  const cellRels: number[][] = [];
  node?.forEach((row, rowOff) => {
    const rels: number[] = [];
    row.forEach((_cell, cellOff) => rels.push(1 + rowOff + 1 + cellOff + 1));
    cellRels.push(rels);
  });
  let growth = 0;
  let headerRows = 0;
  let headerHeight = 0;
  let inHeader = true;
  rows.forEach((tr, r) => {
    const rr = tr.getBoundingClientRect();
    const top = rr.top / z - base - growth;
    const cells: CellItem[] = [];
    const rels = cellRels[r] ?? [];
    let observed = rr.top / z;
    let natural = rr.top / z;
    const notes: number[] = [];
    Array.from(tr.cells).forEach((td, c) => {
      const own = spacersIn(td, z).reduce((s, x) => s + x[1], 0);
      const ci = cellItem(td, base + growth, { kind: "block", rel: rels[c] ?? 1 }, ctx, pos, notes);
      cells.push({ ...ci, bottom: Math.max(top, ci.bottom) });
      const tdr = td.getBoundingClientRect();
      observed = Math.max(observed, tdr.bottom / z);
      natural = Math.max(natural, tdr.bottom / z - own);
    });
    const height = rr.height / z - Math.max(0, observed - natural);
    const header = tr.hasAttribute("data-header");
    if (inHeader && header) {
      headerRows++;
      headerHeight += height;
    } else inHeader = false;
    items.push({
      kind: "row",
      left: rr.left / z,
      top,
      bottom: top + height,
      anchorTop: top,
      at: r === 0 ? { kind: "block", rel: 0 } : { kind: "cells", rels },
      para: -1,
      notes: notes.length ? notes : undefined,
      row: r,
      header,
      cantSplit: tr.hasAttribute("data-cant-split"),
      cells,
    });
    growth += Math.max(0, observed - natural);
  });
  const rect = el.getBoundingClientRect();
  const last = items[items.length - 1];
  const height = skipped(el) || !rect.height ? (last ? last.bottom + 1 : 0) : rect.height / z - growth;
  return { kind: "table", height, ...margins(el), items, paras, headerRows, headerHeight };
}

/** Measures one block element (`base`: its top in client px / zoom). */
function measureElement(el: HTMLElement, node: PMNode | null, pos: number, ctx: MeasureContext, top: boolean): BlockMeasure {
  const z = ctx.zoom;
  const rect = fragmentBox(el);
  const base = rect.top / z;
  const contained = top && skipped(el);
  const kind = blockKind(el, node);
  if (kind === "table") return measureTable(el, node, pos, ctx, base);
  if (kind === "atom") {
    const h = rect.height / z;
    return { kind: "atom", height: h, ...margins(el), items: [{ kind: "atom", top: 0, bottom: h, anchorTop: 0, at: { kind: "block", rel: 0 }, para: -1 }], paras: [] };
  }
  const items: Item[] = [];
  const paras: ParaItem[] = [];
  const spacers = spacersIn(el, z);
  const blocks = ctx.textblock(el) ? [el] : textblocksIn(el, ctx);
  let breakAfter: BlockMeasure["breakAfter"];
  let bottom = 0;
  for (const p of blocks) {
    const info = ctx.textblock(p)!;
    const first: CachedAnchor = p === el ? { kind: "block", rel: 0 } : { kind: "inline", rel: info.pos - pos + 1 };
    const tl = textLines(p, base, spacers, first, ctx, contained && p === el);
    const flow = ctx.flow(info.node);
    const firstItem = items.length;
    tl.lines.forEach((l, k) => {
      items.push({
        kind: "line",
        top: l.top,
        bottom: l.bottom,
        anchorTop: l.top,
        at: l.at,
        left: l.left,
        ink: l.ink,
        para: paras.length,
        notes: l.notes,
        pageBreakBefore: (k === 0 && (!!flow.pageBreakBefore || breakAfter === "page")) || l.pageBreakBefore || undefined,
        columnBreakBefore: (k === 0 && breakAfter === "column") || l.columnBreakBefore || undefined,
      });
    });
    breakAfter = tl.breakAfter;
    bottom = Math.max(bottom, tl.bottom);
    const sectionEnd = (info.node?.attrs.extra as { sectionEnd?: number } | null | undefined)?.sectionEnd;
    paras.push({ first: firstItem, last: items.length - 1, flow, ...(sectionEnd != null ? { sectionEnd } : {}) });
  }
  const own = spacers.reduce((s, x) => s + x[1], 0);
  const cs = getComputedStyle(el);
  const height = contained || !rect.height ? bottom + cssPx(cs.paddingBottom) + cssPx(cs.borderBottomWidth) : rect.height / z - own;
  if (!items.length) items.push({ kind: "atom", top: 0, bottom: height, anchorTop: 0, at: { kind: "block", rel: 0 }, para: -1 });
  // A list: its items' outer margins collapse through it (a paragraph keeps its own).
  return { kind: "flow", height, ...(ctx.textblock(el) ? margins(el) : collapsedMargins(el)), items, paras, breakAfter };
}

/** A footnote or endnote measured on its own: height and lines relative to its top (spacers inside it subtracted). */
export interface NoteMeasure {
  id: number;
  height: number;
  lines: { top: number; bottom: number; at?: CachedAnchor }[];
  /** Paragraphs (lines `[first, last]`) with their flow options (endnotes placed at a section end). */
  paras: ParaItem[];
}

/**
 * Lines of a note element (relative to its top) and its height. A
 * continuation spacer the layout put into the note is subtracted; `pos` (the
 * notes area's PM position) makes the lines' spacer anchors.
 */
export function measureFootnote(el: HTMLElement, ctx: MeasureContext, pos = -1): NoteMeasure {
  const z = ctx.zoom;
  const r = el.getBoundingClientRect();
  const sp = spacersIn(el, z);
  const own = sp.reduce((a, x) => a + x[1], 0);
  const height = Math.max(0, r.height / z - own);
  const lines: NoteMeasure["lines"] = [];
  const paras: ParaItem[] = [];
  for (const p of textblocksIn(el, ctx)) {
    const info = ctx.textblock(p)!;
    const tl = textLines(p, r.top / z, sp, { kind: "inline", rel: info.pos - pos + 1 }, ctx, false);
    const first = lines.length;
    for (const l of tl.lines) lines.push(pos >= 0 && info.pos >= 0 ? { top: l.top, bottom: l.bottom, at: l.at } : { top: l.top, bottom: l.bottom });
    if (lines.length > first) paras.push({ first, last: lines.length - 1, flow: ctx.flow(info.node) });
  }
  return { id: Number(el.dataset.noteId), height, lines, paras };
}

/**
 * A columns box as one virtual column: every child measured on its own,
 * line fragments in other columns closed up (a line keeps its height), the
 * children chained with their margins.
 */
function measureColumns(el: HTMLElement, node: PMNode | null, pos: number, ctx: MeasureContext): BlockMeasure {
  const z = ctx.zoom;
  const items: Item[] = [];
  const paras: ParaItem[] = [];
  const children: { y: number; bottom: number }[] = [];
  let y = 0;
  let prevMb: number | null = null;
  let breakAfter: BlockMeasure["breakAfter"];
  const kids = Array.from(el.children).filter((c) => !c.matches(".page-spacer, .page-colbreak, .ProseMirror-widget")) as HTMLElement[];
  const offs: [PMNode | null, number][] = [];
  if (node) node.forEach((child, off) => offs.push([child, off]));
  else kids.forEach(() => offs.push([null, -1]));
  offs.forEach(([child, off], index) => {
    const dom = kids[index];
    if (!dom) return;
    const m = measureElement(dom, child, pos + 1 + off, ctx, false);
    // Close up the column jumps: consecutive items keep their heights.
    const virt = closeUp(m.items);
    const top = prevMb === null ? 0 : y + collapseMargins(prevMb, m.mt);
    const height = virt.length ? Math.max(virt[virt.length - 1]!.bottom, m.kind === "flow" ? 0 : m.height) : m.height;
    const base = paras.length;
    for (const it of virt) {
      items.push({
        ...it,
        top: it.top + top,
        bottom: it.bottom + top,
        anchorTop: it.anchorTop + top,
        ...(it.ink != null ? { ink: it.ink + top } : {}),
        at: shiftAnchor(it.at, 1 + off),
        para: it.para >= 0 ? it.para + base : -1,
        child: index,
        columnBreakBefore: it.columnBreakBefore || (it === virt[0] && breakAfter === "column") || undefined,
      });
    }
    for (const p of m.paras) paras.push({ ...p, first: p.first + items.length - virt.length, last: p.last + items.length - virt.length });
    children.push({ y: top, bottom: top + height });
    y = top + height;
    prevMb = m.mb;
    breakAfter = m.breakAfter;
  });
  const c = (node?.attrs.columns as Columns | null | undefined) ?? columnsFromCss(el);
  const width = el.getBoundingClientRect().width / z;
  const twips = width * 15;
  const cols = c && c.count > 1 ? columnLayout(c, twips) : [{ width: twips, space: 0 }];
  let x = 0;
  const columns = cols.map((col) => {
    const out = { x: x / 15, width: col.width / 15 };
    x += col.width + col.space;
    return out;
  });
  const spanners = spacersIn(el, z).reduce((s, x2) => s + x2[1], 0);
  const rect = el.getBoundingClientRect();
  const height = skipped(el) ? y : rect.height / z - spanners;
  return { kind: "columns", height, ...margins(el), items, paras, children, columns, breakAfter: breakAfter === "page" ? "page" : undefined };
}

function shiftAnchor(a: CachedAnchor, by: number): CachedAnchor {
  if (a.kind === "block") return { kind: "block", rel: a.rel + by };
  if (a.kind === "cells") return { kind: "cells", rels: a.rels.map((r) => r + by) };
  return a.rel != null ? { ...a, rel: a.rel + by } : a;
}

/** Items of one block with column jumps removed (an item above the previous one's bottom starts right below it). */
export function closeUp(items: readonly Item[]): Item[] {
  const out: Item[] = [];
  let shift = 0;
  let prev: Item | null = null;
  for (const it of items) {
    let top = it.top + shift;
    const jump = prev && it.left != null && prev.left != null && Math.abs(it.left - prev.left) > 20;
    if (prev && (top < prev.bottom - 1 || jump)) {
      shift += prev.bottom - top;
      top = prev.bottom;
    }
    const moved: Item = { ...it, top, bottom: it.bottom + shift, anchorTop: it.anchorTop + shift, ...(it.ink != null ? { ink: it.ink + shift } : {}) };
    out.push(moved);
    prev = moved;
  }
  return out;
}

/** Measures the notes area: endnotes in the flow (or on their own, placed at their section's end), footnotes on their own. */
function measureNotes(el: HTMLElement, ctx: MeasureContext, pos: number): BlockMeasure {
  const z = ctx.zoom;
  const base = el.getBoundingClientRect().top / z;
  const footnotes = Array.from(el.querySelectorAll<HTMLElement>(".note[data-note-kind='foot']")).map((n) => measureFootnote(n, ctx, pos));
  const items: Item[] = [];
  const paras: ParaItem[] = [];
  const ends = Array.from(el.querySelectorAll<HTMLElement>(".note[data-note-kind='end']"));
  if (ctx.endnotesAtSectionEnd) {
    const endnotes = ends.map((n) => measureFootnote(n, ctx, pos));
    return { kind: "notes", height: 0, mt: 0, mb: 0, items, paras, footnotes, endnotes };
  }
  if (ends.length) {
    const sepEl = el.querySelector<HTMLElement>(".notes-separator-end");
    const first: HTMLElement = sepEl ?? ends[0]!;
    const off = first.getBoundingClientRect().top / z - base;
    if (sepEl) {
      const r = sepEl.getBoundingClientRect();
      const firstBlock = textblocksIn(ends[0]!, ctx)[0];
      const rel = firstBlock ? ctx.textblock(firstBlock)!.pos - pos + 1 : 1;
      items.push({ kind: "atom", top: 0, bottom: r.height / z, anchorTop: 0, at: { kind: "inline", rel }, para: -1 });
    }
    for (const n of ends) {
      for (const p of textblocksIn(n, ctx)) {
        const info = ctx.textblock(p)!;
        const tl = textLines(p, base + off, [], { kind: "inline", rel: info.pos - pos + 1 }, ctx, false);
        const firstItem = items.length;
        for (const l of tl.lines) items.push({ kind: "line", top: l.top, bottom: l.bottom, anchorTop: l.top, at: l.at, para: paras.length });
        paras.push({ first: firstItem, last: items.length - 1, flow: ctx.flow(info.node) });
      }
    }
  }
  const last = items[items.length - 1];
  return { kind: "notes", height: last ? last.bottom : 0, mt: ends.length ? margins(el).mt : 0, mb: 0, items, paras, footnotes };
}

/** The kind of a block from its PM node, else from its element (print clones). */
export function blockKind(el: Element, node: PMNode | null): "table" | "atom" | "columns" | "notes" | "flow" {
  if (node) {
    const n = node.type.name;
    if (n === "table" || n === "notes" || n === "columns") return n;
    return node.isAtom || n === "toc" || n === "horizontalRule" ? "atom" : "flow";
  }
  if (el.matches("table, .tableWrapper") || (el.firstElementChild?.matches("table") && el.children.length === 1)) return "table";
  if (el.matches(".notes-area")) return "notes";
  if (el.matches(".section-columns")) return "columns";
  if (el.matches(".toc, hr, img") || el.getAttribute("contenteditable") === "false") return "atom";
  return "flow";
}

/** Columns of a columns box from its CSS (print clones). */
function columnsFromCss(el: HTMLElement): Columns | null {
  const n = Number(el.dataset.columns ?? "1");
  if (!(n > 1)) return null;
  const gap = cssPx(getComputedStyle(el).columnGap);
  return { count: n, equal: true, spacing: Math.round(gap * 15) };
}

/** Measures a top-level block. */
export function measureBlock(el: HTMLElement, node: PMNode | null, pos: number, ctx: MeasureContext): BlockMeasure {
  const kind = blockKind(el, node);
  const m = kind === "notes" ? measureNotes(el, ctx, pos) : kind === "columns" ? measureColumns(el, node, pos, ctx) : measureElement(el, node, pos, ctx, true);
  const cs = getComputedStyle(el);
  m.pad = cssPx(cs.paddingTop) + cssPx(cs.paddingBottom) + cssPx(cs.borderTopWidth) + cssPx(cs.borderBottomWidth);
  return m;
}

// ----- the flow -------------------------------------------------------------------------

export interface FlowInput {
  /** Measured top-level blocks with their PM position, section index and top-level index (default: the array index). */
  blocks: { m: BlockMeasure; pos: number; section: number; region: boolean; index?: number; nextKind?: "page" | "even" | "odd" | null }[];
  /** What the flow depends on besides the blocks (section kinds): a previous flow with another key is not reused. */
  key?: string;
  /** Per section id: the kind of the section starting after it (`page`, `even`, `odd`; null = continuous). */
  sectionBreak?: (sectionEnd: number) => "page" | "even" | "odd" | null;
  /** Endnotes at their section's end: per section index, the note ids in reference order (needs the notes area measured with `endnotesAtSectionEnd`). */
  endnotes?: { section: number; ids: number[] }[];
  /** Height of the separator line above each section's endnotes (px). */
  endnoteSeparator?: number;
}

/** A measured note in flow coordinates (anchors resolved against the notes area at `pos`). */
function noteFlow(n: NoteMeasure, pos: number): FootnoteFlow {
  return { id: n.id, height: n.height, lines: n.lines.map((l) => (l.at ? { top: l.top, bottom: l.bottom, at: resolve(l.at, pos) } : { top: l.top, bottom: l.bottom })) };
}

const resolve = (a: CachedAnchor, pos: number): Anchor => {
  if (a.kind === "block") return { kind: "block", pos: pos + a.rel };
  if (a.kind === "cells") return { kind: "cells", cells: a.rels.map((r) => pos + r) };
  if (a.fn) return { kind: "inline", pos: a.fn };
  return { kind: "inline", pos: pos + (a.rel ?? 0) };
};

/** A measured cell in flow coordinates (`top`: the table's natural top; `pos`: its PM position). */
function cellFlow(c: CellItem, top: number, pos: number): CellFlow {
  const out: CellFlow = { bottom: top + c.bottom, lines: c.lines.map((l) => ({ top: top + l.top, bottom: top + l.bottom, at: resolve(l.at, pos) })) };
  if (c.content) out.content = c.content.map((x) => contentFlow(x, top, pos));
  return out;
}

function contentFlow(x: CachedContent, top: number, pos: number): CellContent {
  if (x.kind === "line") return { kind: "line", top: top + x.top, bottom: top + x.bottom, at: resolve(x.at, pos) };
  return {
    kind: "row",
    top: top + x.top,
    bottom: top + x.bottom,
    at: resolve(x.at, pos),
    cells: x.cells.map((c) => cellFlow(c, top, pos)),
    ...(x.cantSplit ? { cantSplit: true } : {}),
    ...(x.header ? { header: true } : {}),
  };
}

/** Chains the measured blocks (margins collapsed) into the natural flow of `paginate`. */
/** The builder's state at the start of a block (for reusing a previous flow). */
interface BlockStart {
  y: number;
  prevMb: number | null;
  pending: Unit["breakBefore"];
  pendingColumn: boolean;
  units: number;
  paras: number;
  tables: number;
  regions: number;
  blocks: number;
}

/** What `buildFlow` keeps for the next run: its input blocks and the state at each block's start. */
interface FlowBuild {
  input: FlowInput["blocks"];
  key: string;
  starts: BlockStart[];
}

const builds = new WeakMap<Flow, FlowBuild>();

/** The top-level index of input block `k`. */
const indexOf = (input: FlowInput, k: number) => input.blocks[k]!.index ?? k;

/**
 * Chains the measured blocks (margins collapsed) into the natural flow of
 * `paginate`. With the previous run's flow (`prev`, same `key`), the
 * unchanged blocks at the start are taken over as they are and the
 * unchanged blocks at the end are moved (their units' positions shifted in
 * place), so a keystroke builds the units of one block; `flow.reuse` then
 * tells `paginate` where the flow changed and how the rest moved.
 */
export function buildFlow(input: FlowInput, prev?: Flow | null): Flow {
  const pb = prev ? builds.get(prev) : undefined;
  const key = input.key ?? "";
  if (pb && prev && pb.key === key && !input.endnotes?.length && !prev.endGroups?.length) {
    const flow = buildIncremental(input, prev, pb);
    if (flow) return flow;
  }
  return buildRange(input, 0, input.blocks.length, null, null);
}

/** `buildFlow` from a previous flow; null when nothing can be taken over. */
function buildIncremental(input: FlowInput, prev: Flow, pb: FlowBuild): Flow | null {
  const a = input.blocks;
  const b = pb.input;
  const n = a.length;
  const pn = b.length;
  const sameBlock = (x: FlowInput["blocks"][number], y: FlowInput["blocks"][number]) => x.m === y.m && x.section === y.section && x.region === y.region;
  let P = 0;
  while (P < n && P < pn && sameBlock(a[P]!, b[P]!) && a[P]!.pos === b[P]!.pos && indexOf(input, P) === (b[P]!.index ?? P)) P++;
  let S = 0;
  const dpos = n && pn ? a[n - 1]!.pos - b[pn - 1]!.pos : 0;
  const dindex = n && pn ? indexOf(input, n - 1) - (b[pn - 1]!.index ?? pn - 1) : 0;
  while (S < n - P && S < pn - P) {
    const x = a[n - 1 - S]!;
    const y = b[pn - 1 - S]!;
    if (!sameBlock(x, y) || x.pos - y.pos !== dpos || indexOf(input, n - 1 - S) - (y.index ?? pn - 1 - S) !== dindex) break;
    S++;
  }
  if (P === 0 && S === 0) return null;
  const flow = buildRange(input, P, n - S, prev, pb.starts[P] ?? null);
  const fb = builds.get(flow)!;
  const enter = pb.starts[pn - S];
  const now = fb.starts[n - S];
  if (S > 0 && (!enter || !now || enter.pending !== now.pending || enter.pendingColumn !== now.pendingColumn || enter.prevMb !== now.prevMb)) {
    return P > 0 ? buildRange(input, P, n, prev, pb.starts[P] ?? null) : null;
  }
  const reuseFrom = (pb.starts[P]?.units ?? 0);
  if (S === 0) {
    flow.reuse = { from: reuseFrom, same: flow.units.length, du: 0, dy: 0, db: 0, dp: 0, dt: 0, dr: 0 };
    return flow;
  }
  // The unchanged blocks at the end: moved by the deltas (in place: the previous flow is not used again).
  const d = {
    du: now!.units - enter!.units,
    dy: now!.y - enter!.y,
    db: now!.blocks - enter!.blocks,
    dp: now!.paras - enter!.paras,
    dt: now!.tables - enter!.tables,
    dr: now!.regions - enter!.regions,
  };
  const same = flow.units.length;
  const units = prev.units.slice(enter!.units);
  const moved = d.dy !== 0 || dpos !== 0 || d.db !== 0 || d.dp !== 0 || d.dt !== 0 || d.dr !== 0;
  if (moved) for (const u of units) moveUnit(u, d.dy, dpos, d.db, d.dp, d.dt, d.dr);
  flow.units.push(...units);
  for (const p of prev.paras.slice(enter!.paras)) {
    p.first += d.du;
    p.last += d.du;
    flow.paras.push(p);
  }
  for (const t of prev.tables.slice(enter!.tables)) {
    t.first += d.du;
    t.last += d.du;
    t.block += d.db;
    flow.tables.push(t);
  }
  for (const r of prev.regions.slice(enter!.regions)) {
    r.first += d.du;
    r.last += d.du;
    r.top += d.dy;
    r.bottom += d.dy;
    flow.regions.push(r);
  }
  for (const x of prev.blocks.slice(enter!.blocks)) {
    x.top += dindex;
    x.y += d.dy;
    x.bottom += d.dy;
    flow.blocks.push(x);
  }
  fb.starts.length = n - S;
  for (const st of pb.starts.slice(pn - S)) {
    st.y += d.dy;
    st.units += d.du;
    st.paras += d.dp;
    st.tables += d.dt;
    st.regions += d.dr;
    st.blocks += d.db;
    fb.starts.push(st);
  }
  fb.input = a;
  for (const blk of a.slice(n - S)) for (const f of blk.m.footnotes ?? []) flow.footnotes.set(f.id, noteFlow(f, blk.pos));
  flow.end = prev.end + d.dy;
  flow.reuse = { from: reuseFrom, same, ...d };
  return flow;
}

function moveAnchor(a: Anchor, dpos: number): void {
  if (!dpos) return;
  if (a.kind === "cells") for (let k = 0; k < a.cells.length; k++) a.cells[k]! += dpos;
  else if (typeof a.pos === "number" && a.pos >= 0) a.pos += dpos;
}

function moveCell(c: CellFlow, dy: number, dpos: number, seen: Set<object>): void {
  c.bottom += dy;
  for (const l of c.lines) {
    l.top += dy;
    l.bottom += dy;
    if (!seen.has(l.at)) {
      seen.add(l.at);
      moveAnchor(l.at, dpos);
    }
  }
  const visit = (items: CellContent[]) => {
    for (const x of items) {
      x.top += dy;
      x.bottom += dy;
      if (!seen.has(x.at)) {
        seen.add(x.at);
        moveAnchor(x.at, dpos);
      }
      if (x.kind === "row") for (const cc of x.cells) moveCell(cc, dy, dpos, seen);
    }
  };
  if (c.content) visit(c.content);
}

/** Shifts a unit of the flow's unchanged end: natural y by `dy`, PM positions by `dpos`, indices by their deltas. */
function moveUnit(u: Unit, dy: number, dpos: number, db: number, dp: number, dt: number, dr: number): void {
  u.top += dy;
  u.bottom += dy;
  u.anchorTop += dy;
  if (u.ink != null) u.ink += dy;
  moveAnchor(u.at, dpos);
  u.block += db;
  if (u.para >= 0) u.para += dp;
  if (u.table != null) u.table += dt;
  if (u.region != null) u.region += dr;
  if (u.cells) {
    const seen = new Set<object>([u.at]);
    for (const c of u.cells) moveCell(c, dy, dpos, seen);
  }
}

/**
 * Builds the units of input blocks `[from, to)` (all of them without a
 * previous flow); the blocks before `from` are the previous flow's (`state`:
 * the builder's state at `from`).
 */
function buildRange(input: FlowInput, from: number, to: number, prev: Flow | null, state: BlockStart | null): Flow {
  const flow: Flow = { units: [], paras: [], tables: [], regions: [], blocks: [], footnotes: new Map(), end: 0 };
  const starts: BlockStart[] = [];
  if (prev && state && from > 0) {
    flow.units = prev.units.slice(0, state.units);
    flow.paras = prev.paras.slice(0, state.paras);
    flow.tables = prev.tables.slice(0, state.tables);
    flow.regions = prev.regions.slice(0, state.regions);
    flow.blocks = prev.blocks.slice(0, state.blocks);
    const pb = builds.get(prev)!;
    starts.push(...pb.starts.slice(0, from));
    for (const b of input.blocks.slice(0, from)) for (const f of b.m.footnotes ?? []) flow.footnotes.set(f.id, noteFlow(f, b.pos));
  } else from = 0;
  let y = state && from > 0 ? state.y : 0;
  let prevMb: number | null = state && from > 0 ? state.prevMb : null;
  let pending: Unit["breakBefore"] = state && from > 0 ? state.pending : undefined;
  let pendingColumn = state && from > 0 ? state.pendingColumn : false;
  // Endnotes at section ends: the notes area's measured endnotes, grouped by section.
  const notesAt = input.blocks.findIndex((b) => b.m.kind === "notes");
  const notesIndex = notesAt < 0 ? -1 : indexOf(input, notesAt);
  const notesBlock = input.blocks[notesAt];
  const endMeasures = new Map((notesBlock?.m.endnotes ?? []).map((n) => [n.id, n]));
  const groups = (input.endnotes ?? []).filter((g) => g.ids.some((id) => endMeasures.has(id)));
  let gi = 0;
  /** The group whose `next` unit is still to come. */
  const open: { group: EndnoteGroup | null } = { group: null };
  const sep = input.endnoteSeparator ?? 0;
  const emitGroup = (g: { section: number; ids: number[] }) => {
    const top0 = prevMb === null ? 0 : y + Math.max(0, prevMb);
    let gy = top0;
    const first = flow.units.length;
    const at: Anchor = { kind: "block", pos: -1 };
    // The separator line above the section's endnotes (drawn by the page chrome).
    flow.blocks.push({ top: notesIndex, child: -1, y: gy, bottom: gy + sep, note: 0 });
    flow.units.push({ kind: "atom", top: gy, bottom: gy + sep, anchorTop: gy, at, block: flow.blocks.length - 1, para: -1, section: g.section });
    gy += sep;
    for (const id of g.ids) {
      const n = endMeasures.get(id);
      if (!n) continue;
      const block = flow.blocks.length;
      flow.blocks.push({ top: notesIndex, child: -1, y: gy, bottom: gy + n.height, note: id });
      const base = flow.units.length;
      const paraBase = flow.paras.length;
      const paraOf = (k: number) => n.paras.findIndex((p) => p.first <= k && k <= p.last);
      n.lines.forEach((l, k) => {
        const pi = paraOf(k);
        flow.units.push({
          kind: "line",
          top: gy + l.top,
          bottom: gy + l.bottom,
          anchorTop: gy + l.top,
          // A page starting at a note's first line moves the (positioned) note itself: no spacer.
          at: k > 0 && l.at && notesBlock ? resolve(l.at, notesBlock.pos) : at,
          block,
          para: pi >= 0 ? paraBase + pi : -1,
          section: g.section,
        });
      });
      for (const p of n.paras) {
        flow.paras.push({ first: base + p.first, last: base + p.last, widow: p.flow.widowControl !== false, keepLines: !!p.flow.keepLines, keepNext: !!p.flow.keepNext });
      }
      if (!n.lines.length) flow.units.push({ kind: "atom", top: gy, bottom: gy + n.height, anchorTop: gy, at, block, para: -1, section: g.section });
      gy += n.height;
    }
    const height = gy - top0;
    const group: EndnoteGroup = { section: g.section, first, last: flow.units.length - 1, height, next: -1 };
    (flow.endGroups ??= []).push(group);
    open.group = group;
    // The space after the last block counts once (the group starts below it).
    y += height;
  };
  for (let index0 = from; index0 < to; index0++) {
    const b = input.blocks[index0]!;
    const index = indexOf(input, index0);
    starts[index0] = { y, prevMb, pending, pendingColumn, units: flow.units.length, paras: flow.paras.length, tables: flow.tables.length, regions: flow.regions.length, blocks: flow.blocks.length };
    const m = b.m;
    for (const f of m.footnotes ?? []) flow.footnotes.set(f.id, noteFlow(f, b.pos));
    while (gi < groups.length && (m.kind === "notes" || b.section > groups[gi]!.section)) emitGroup(groups[gi++]!);
    if (m.kind === "notes" && !m.items.length) continue;
    const top = prevMb === null ? Math.max(0, m.mt) : y + collapseMargins(prevMb, m.mt);
    if (open.group) {
      open.group.next = flow.units.length;
      open.group = null;
    }
    const region = m.kind === "columns" && (m.columns?.length ?? 1) > 1 ? flow.regions.length : null;
    const firstUnit = flow.units.length;
    const blockIndex = flow.blocks.length;
    if (m.kind === "columns") for (const c of m.children ?? []) flow.blocks.push({ top: index, child: flow.blocks.length - blockIndex, y: top + c.y, bottom: top + c.bottom });
    else flow.blocks.push({ top: index, child: -1, y: top, bottom: top + m.height });
    const paraBase = flow.paras.length;
    const table = m.kind === "table" ? flow.tables.length : null;
    m.items.forEach((it, k) => {
      const u: Unit = {
        kind: it.kind,
        top: top + it.top,
        bottom: top + it.bottom,
        anchorTop: top + it.anchorTop,
        ...(it.ink != null ? { ink: top + it.ink } : {}),
        at: resolve(it.at, b.pos),
        block: m.kind === "columns" ? blockIndex + (it.child ?? 0) : blockIndex,
        para: it.para >= 0 ? paraBase + it.para : -1,
        section: b.section,
      };
      if (it.notes?.length) u.notes = it.notes;
      if (k === 0 && prevMb !== null) u.collapse = Math.min(Math.max(0, prevMb), Math.max(0, m.mt));
      if (pending) {
        u.breakBefore = pending;
        pending = undefined;
      }
      if (it.pageBreakBefore && !u.breakBefore) u.breakBefore = "page";
      if (pendingColumn || it.columnBreakBefore) {
        if (region != null) u.columnBreakBefore = true;
        else u.breakBefore ??= "page";
        pendingColumn = false;
      }
      if (table != null) {
        u.table = table;
        u.row = it.row;
        if (it.cantSplit) u.cantSplit = true;
        u.cells = (it.cells ?? []).map((c) => cellFlow(c, top, b.pos));
      }
      if (region != null) u.region = region;
      flow.units.push(u);
    });
    for (const p of m.paras) {
      flow.paras.push({
        first: firstUnit + p.first,
        last: firstUnit + p.last,
        widow: p.flow.widowControl !== false,
        keepLines: !!p.flow.keepLines,
        keepNext: !!p.flow.keepNext,
      });
      if (p.sectionEnd != null) {
        const kind = input.sectionBreak?.(p.sectionEnd);
        if (kind) pending = kind;
      }
    }
    if (m.breakAfter === "page") pending ??= "page";
    if (m.breakAfter === "column") pendingColumn = true;
    if (table != null) flow.tables.push({ first: firstUnit, last: flow.units.length - 1, headerRows: m.headerRows ?? 0, headerHeight: m.headerHeight ?? 0, block: blockIndex });
    if (region != null) flow.regions.push({ first: firstUnit, last: flow.units.length - 1, columns: m.columns ?? [], top, bottom: top + m.height });
    y = top + m.height;
    prevMb = m.mb;
  }
  starts[to] = { y, prevMb, pending, pendingColumn, units: flow.units.length, paras: flow.paras.length, tables: flow.tables.length, regions: flow.regions.length, blocks: flow.blocks.length };
  if (to === input.blocks.length) while (gi < groups.length) emitGroup(groups[gi++]!);
  flow.end = y;
  builds.set(flow, { input: input.blocks, key: input.key ?? "", starts });
  return flow;
}
