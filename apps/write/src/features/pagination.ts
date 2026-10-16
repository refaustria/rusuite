// Print layout (P8-31, docs/write-layout.md): the document stays one
// ProseMirror flow; the plugin measures it (features/layout/measure.ts),
// lays it out on pages (features/layout/paginate.ts: line-granular breaks,
// flow options, tables split between rows with repeated header rows,
// footnotes at the bottom of their page, multi-column sections across
// pages) and turns the result into spacer widgets (a page gap before the
// line, block or row that starts a page), footnotes positioned at the
// bottom of their page and the `PageLayout` the page chrome
// (`ui/PageChrome.tsx`), the print preview, PDF export, page fields, TOC
// page numbers and the status bar read.

import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import type { Block } from "../generated/Block";
import type { HeaderFooterSet } from "../generated/HeaderFooterSet";
import type { PageSetup } from "../generated/PageSetup";
import type { Section } from "../generated/Section";
import { notesNode } from "../sync/fromPM";
import { TWIPS_PER_PX } from "../sync/schema";
import { formatNumber, noteNumbers } from "./numbers";
import { buildFlow, measureBlock, type BlockMeasure, type FlowProps, type MeasureContext } from "./layout/measure";
import { firstChange, paginate, type Anchor, type Flow, type PageBox, type PaginateResult, type Spacer } from "./layout/paginate";

/** Height of the grey band between two pages (CSS px). */
export const PAGE_GAP_PX = 16;
/** The band between pages with white space hidden (Word: a thin line). */
export const HIDDEN_GAP_PX = 3;
/** Room for the footnote separator above a page's footnotes. */
export const NOTE_SEPARATOR_PX = 14;

// ----- block packing (kept for callers that pack whole blocks) ----------------------------

/** One measured block: natural top/bottom (px), a forced break after it, the height of the footnotes it references. */
export interface BlockBox {
  top: number;
  bottom: number;
  breakAfter: boolean;
  notes?: number;
  /** Page break before (`pageBreakBefore`). */
  breakBefore?: boolean;
  /** Keep with next (`keepNext`): never the last block of a page when the next one moves on. */
  keepNext?: boolean;
}

/** A page break before block `index`; `fill` = unused text height left on the previous page. */
export interface PageBreak {
  index: number;
  fill: number;
}

/**
 * Packs whole blocks into pages with the pagination engine (each block one
 * unbreakable unit). `pageHeight` is the text height of every page, or of
 * the page starting at a given block.
 */
export function computeBreaks(blocks: BlockBox[], pageHeight: number | ((startIndex: number) => number)): { breaks: PageBreak[]; lastFill: number } {
  const heightAt = typeof pageHeight === "number" ? () => pageHeight : pageHeight;
  if (!blocks.length) return { breaks: [], lastFill: Math.max(0, heightAt(0)) };
  if (heightAt(0) <= 0) return { breaks: [], lastFill: 0 };
  const flow: Flow = { units: [], paras: [], tables: [], regions: [], blocks: [], footnotes: new Map(), end: blocks[blocks.length - 1]!.bottom };
  const base = Math.min(0, blocks[0]!.top);
  blocks.forEach((b, i) => {
    const prev = blocks[i - 1];
    flow.blocks.push({ top: i, child: -1, y: b.top - base, bottom: b.bottom - base });
    flow.paras.push({ first: i, last: i, widow: false, keepLines: true, keepNext: !!b.keepNext });
    if (b.notes) flow.footnotes.set(i, { id: i, height: b.notes, lines: [] });
    flow.units.push({
      kind: "atom",
      top: b.top - base,
      bottom: b.bottom - base,
      anchorTop: b.top - base,
      at: { kind: "block", pos: i },
      block: i,
      para: i,
      section: 0,
      ...(prev?.breakAfter || b.breakBefore ? { breakBefore: "page" as const } : {}),
      ...(b.notes ? { notes: [i] } : {}),
    });
  });
  const r = paginate(flow, { pageBox: (p) => ({ height: Math.max(1, heightAt(p.start)), bodyTop: 0, bodyHeight: Math.max(1, heightAt(p.start)) }), gap: 0, noteSeparator: 0 });
  const fill = (k: number) => {
    const p = r.pages[k]!;
    return Math.max(0, p.sheetTop + p.box.bodyHeight - p.notesHeight - p.contentEnd + p.notesHeight);
  };
  const breaks = r.pages.slice(1).map((p, k) => ({ index: p.start, fill: fill(k) }));
  return { breaks, lastFill: fill(r.pages.length - 1) };
}

/** Page geometry in CSS px. */
export interface PageGeometry {
  width: number;
  height: number;
  top: number;
  bottom: number;
  left: number;
  right: number;
  header: number;
  footer: number;
}

export function pageGeometry(page: PageSetup | null | undefined): PageGeometry {
  const px = (v: number | undefined, d: number) => (v === undefined ? d : v / TWIPS_PER_PX);
  const m = page?.margins;
  return {
    width: px(page?.width, 794),
    height: px(page?.height, 1123),
    top: px(m?.top, 96),
    bottom: px(m?.bottom, 96),
    left: px(m?.left, 96),
    right: px(m?.right, 96),
    header: px(m?.header, 47),
    footer: px(m?.footer, 47),
  };
}

/** Header/footer text of page `n` (`{PAGE}` → `n`, `{NUMPAGES}` → `total`). */
export function headerFooterText(text: string | null | undefined, n: number | string, total?: number): string {
  let out = (text ?? "").split("{PAGE}").join(String(n));
  if (total != null) out = out.split("{NUMPAGES}").join(String(total));
  return out;
}

// ----- sections -------------------------------------------------------------------

/** Plain text of header/footer blocks, page fields as `{PAGE}` / `{NUMPAGES}`. */
export function blocksText(blocks: Block[] | null | undefined): string {
  if (!blocks) return "";
  const paras: string[] = [];
  for (const b of blocks) {
    if (b.kind !== "paragraph") continue;
    let s = "";
    for (const i of b.value.inlines ?? []) {
      if (i.kind === "run") s += i.value.text;
      else if (i.kind === "break") s += "\n";
      else if (i.kind === "field") s += i.value.kind.kind === "page" ? "{PAGE}" : i.value.kind.kind === "numPages" ? "{NUMPAGES}" : i.value.cached;
    }
    paras.push(s);
  }
  return paras.join("\n");
}

/** The header (or footer) blocks of `slot` for section `index`, inherited from earlier sections like Word. */
export function sectionHf(sections: Section[], index: number, footer: boolean, slot: keyof HeaderFooterSet): Block[] | null {
  for (let i = index; i >= 0; i--) {
    const set = footer ? sections[i]?.footers : sections[i]?.headers;
    const blocks = set?.[slot];
    if (blocks) return blocks;
  }
  return null;
}

/** One page of the layout. */
export interface PageInfo {
  /** Section index. */
  section: number;
  /** First page of its section. */
  first: boolean;
  /** The page number as shown (section restarts and formats applied). */
  number: string;
  /** The numeric page number (for odd/even). */
  value: number;
}

/** Pages → section, number; `starts` = index of the first block of each page, `sectionOf` = section index per block. */
export function pageInfos(starts: number[], sectionOf: (block: number) => number, sections: Section[]): PageInfo[] {
  const out: PageInfo[] = [];
  let value = 0;
  let prevSection = -1;
  for (const s of starts) {
    const sec = sectionOf(s);
    const first = sec !== prevSection;
    const def = sections[sec];
    value = first && def?.pageNumberStart != null ? def.pageNumberStart : value + 1;
    out.push({ section: sec, first, value, number: formatNumber(value, def?.pageNumberFormat ?? "decimal") });
    prevSection = sec;
  }
  return out;
}

/** Header or footer text of a page (sections' slots, else the page setup's plain text). */
export function pageHfText(info: PageInfo, total: number, footer: boolean, sections: Section[], page: PageSetup | null): string {
  if (!sections.length) return headerFooterText(footer ? page?.footerText : page?.headerText, info.number, total);
  const def = sections[info.section];
  const evenUsed = sections.some((s) => (footer ? s.footers : s.headers)?.even != null);
  const slot: keyof HeaderFooterSet = def?.titlePage && info.first ? "first" : evenUsed && info.value % 2 === 0 ? "even" : "default";
  return headerFooterText(blocksText(sectionHf(sections, info.section, footer, slot)), info.number, total);
}


/** Resolved flow options of a top-level node: page break before its first paragraph, keep with next of its last. */
export function flowOf(n: PMNode, flow: (textblock: PMNode) => { keepNext?: boolean | null; pageBreakBefore?: boolean | null }): { breakBefore: boolean; keepNext: boolean } {
  const blocks: PMNode[] = [];
  if (n.isTextblock) blocks.push(n);
  else
    n.descendants((c) => {
      if (c.isTextblock) {
        blocks.push(c);
        return false;
      }
      return c.type.name !== "table";
    });
  const first = blocks[0];
  const last = blocks[blocks.length - 1];
  return { breakBefore: !!(first && flow(first).pageBreakBefore), keepNext: n.type.name !== "table" && !!(last && flow(last).keepNext) };
}

/** Section ids ended by paragraphs inside top-level node `n`. */
function sectionEnds(n: PMNode): number[] {
  const out: number[] = [];
  const visit = (x: PMNode) => {
    if (x.isTextblock) {
      const end = (x.attrs.extra as { sectionEnd?: number } | null)?.sectionEnd;
      if (end != null) out.push(end);
      return false;
    }
    return true;
  };
  if (visit(n)) n.descendants(visit);
  return out;
}

/** Per top-level node: its section index and whether a section break (not continuous) ends its page. */
export function sectionLayout(doc: PMNode, sections: Section[]): { section: number[]; breakAfter: boolean[] } {
  const section: number[] = [];
  const breakAfter: boolean[] = [];
  const index = new Map(sections.map((s, i) => [s.id, i]));
  let cur = 0;
  doc.forEach((n) => {
    section.push(cur);
    let brk = false;
    for (const id of sectionEnds(n)) {
      const i = index.get(id);
      if (i === undefined) continue;
      cur = Math.min(sections.length - 1, i + 1);
      if (sections[cur]?.kind !== "continuous") brk = true;
    }
    breakAfter.push(brk);
  });
  return { section, breakAfter };
}


// ----- the layout ------------------------------------------------------------------

/** A footnote (or a slice of a long one) at the bottom of a sheet. */
export interface SheetNote {
  id: number;
  /** The number shown. */
  n: string;
  /** Px `[from, to)` of the note's height on this sheet. */
  from: number;
  to: number;
  /** Frame y of the slice's top. */
  top: number;
}

/** One sheet as the page chrome draws it (frame px: y from the top of the page frame). */
export interface SheetView {
  index: number;
  top: number;
  height: number;
  bodyTop: number;
  bodyBottom: number;
  /** Where the page's text ends (the white fill below it is covered). */
  contentEnd: number;
  geo: PageGeometry;
  header: string;
  footer: string;
  /** Top of the footnote area (separator) and its notes. */
  notesTop: number;
  notes: SheetNote[];
  /** A repeated table header at the top of the body: the table's PM position, frame top and height. */
  repeat?: { pos: number; top: number; height: number };
  /** Column rules of multi-column sets: frame top, height and the rules' x (px from the body's left). */
  rules?: { top: number; height: number; xs: number[] }[];
}

/** The computed layout: pages, the page of each top-level node and position, the sheets. */
export interface PageLayout {
  pages: PageInfo[];
  /** Page index (0-based) per top-level node (its first line). */
  nodePage: number[];
  /** PM position where each page's first line starts. */
  pageStarts: number[];
  /** Header of the first page, footer of the last page. */
  firstHeader: string;
  lastFooter: string;
  sheets: SheetView[];
  /** Frame y of the editor content's top (the first page's body top) and the frame height. */
  origin: number;
  height: number;
  gap: number;
  /** White space between pages hidden (Word's Hide White Space). */
  hide: boolean;
  /** The engine's flow and result, and the top-level node positions they refer to (the print path reuses them). */
  flow?: Flow;
  result?: PaginateResult;
  positions?: number[];
}

/** The layout of block-level breaks (`computeBreaks`): page infos, the page of every top-level node, frame header/footer texts. */
export function computeLayout(doc: PMNode, breaks: PageBreak[], sections: Section[], page: PageSetup | null): PageLayout {
  const { section } = sectionLayout(doc, sections);
  const starts = [0, ...breaks.map((b) => b.index)];
  const pages = pageInfos(starts, (i) => section[i] ?? 0, sections);
  const nodePage: number[] = [];
  const positions: number[] = [];
  doc.forEach((_n, offset) => positions.push(offset));
  let k = 0;
  for (let i = 0; i < doc.childCount; i++) {
    while (k + 1 < starts.length && starts[k + 1]! <= i) k++;
    nodePage.push(k);
  }
  const total = pages.length;
  return {
    pages,
    nodePage,
    pageStarts: starts.map((s) => positions[s] ?? doc.content.size),
    firstHeader: pageHfText(pages[0]!, total, false, sections, page),
    lastFooter: pageHfText(pages[total - 1]!, total, true, sections, page),
    sheets: [],
    origin: 0,
    height: 0,
    gap: PAGE_GAP_PX,
    hide: false,
  };
}

/** Index of the page holding PM position `pos`. */
export function pageIndexAt(layout: PageLayout, pos: number): number {
  const s = layout.pageStarts;
  let lo = 0;
  let hi = s.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (s[mid]! <= pos) lo = mid;
    else hi = mid - 1;
  }
  return Math.max(0, lo);
}

/** The page info of position `pos` (null without a layout). */
export function pageAtPos(layout: PageLayout | null, pos: number): PageInfo | null {
  if (!layout || !layout.pages.length) return null;
  return layout.pages[pageIndexAt(layout, pos)] ?? null;
}

export interface PaginationOptions {
  /** Print layout on; off = draft (no pages). */
  enabled: () => boolean;
  /** Page setup of the last section (documents without sections). */
  page: () => PageSetup | null;
  /** Sections in order (page setup, headers/footers and page numbering per section). */
  sections?: () => Section[];
  /** Double-click on a header or footer. */
  onEditHeaderFooter?: (which: "header" | "footer") => void;
  /** Called after the page count changed. */
  onPages?: (pages: number) => void;
  /** Called after every new layout. */
  onLayout?: (layout: PageLayout | null) => void;
  /** The resolved flow options of a paragraph (style chain + direct). */
  flow?: (textblock: PMNode) => FlowProps;
  /** Hide White Space (double-click a page gap). */
  hideWhiteSpace?: () => boolean;
}

interface PaginationState {
  layout: PageLayout | null;
  decorations: DecorationSet;
}

export const paginationKey = new PluginKey<PaginationState>("rusuitePagination");

/** Resolves a spacer anchor to PM positions. */
function anchorPositions(at: Anchor): number[] {
  if (at.kind === "cells") return at.cells;
  if (at.kind === "block") return [at.pos];
  return [typeof at.pos === "function" ? at.pos() : at.pos];
}

function spacerDom(tag: "div" | "span", cls: string, height: number, collapse: number, page: number): HTMLElement {
  const el = document.createElement(tag);
  el.className = cls;
  el.contentEditable = "false";
  el.dataset.page = String(page);
  el.setAttribute("aria-hidden", "true");
  el.style.height = `${Math.max(0, height).toFixed(2)}px`;
  if (collapse > 0) el.style.marginTop = `${-collapse.toFixed(2)}px`;
  return el;
}

interface ResolvedSpacer {
  pos: number;
  height: number;
  kind: Spacer["kind"];
  /** Where the widget goes: before a block (div), inside a paragraph (span), at a cell's start (div). */
  place: "block" | "inline";
  collapse: number;
  /** Index of the page that starts after it. */
  page: number;
}

function buildDecorations(doc: PMNode, layout: PageLayout, spacers: ResolvedSpacer[]): DecorationSet {
  const decos: Decoration[] = [];
  const size = doc.content.size;
  for (const s of spacers) {
    if (s.pos < 0 || s.pos > size) continue;
    if (s.kind === "column") {
      decos.push(Decoration.widget(s.pos, () => spacerDom(s.place === "inline" ? "span" : "div", "page-colbreak", 0, 0, s.page), { side: -1, key: `cb:${s.pos}`, ignoreSelection: true, marks: [] }));
      continue;
    }
    const cls = s.kind === "span" ? "page-spacer page-spacer-span" : "page-spacer";
    const h = Math.round(s.height * 100) / 100;
    decos.push(
      Decoration.widget(s.pos, () => spacerDom(s.place === "inline" ? "span" : "div", cls, h, s.place === "block" ? s.collapse : 0, s.page), {
        side: -1,
        key: `sp:${s.kind}:${s.place}:${h}:${s.collapse.toFixed(1)}:${s.page}`,
        ignoreSelection: true,
        marks: [],
      }),
    );
  }
  // Footnotes at the bottom of their page: the notes area's own (editable) note nodes, positioned.
  const area = notesNode(doc);
  if (area) {
    const positions = new Map<number, [number, number]>();
    let pos = size - area.nodeSize + 1;
    area.forEach((n) => {
      positions.set(n.attrs.id as number, [pos, n.nodeSize]);
      pos += n.nodeSize;
    });
    for (const sheet of layout.sheets) {
      for (const note of sheet.notes) {
        const at = positions.get(note.id);
        if (!at || note.from > 0) continue;
        const clip = note.to < (layout.flow?.footnotes.get(note.id)?.height ?? Infinity) - 0.5 ? `max-height: ${(note.to - note.from).toFixed(1)}px; overflow: hidden;` : "";
        decos.push(
          Decoration.node(at[0], at[0] + at[1], {
            class: "note-paged",
            style: `top: ${(note.top - layout.origin).toFixed(1)}px; ${clip}`,
            ...(clip ? { "data-clipped": "" } : {}),
          }),
        );
      }
    }
  }
  return DecorationSet.create(doc, decos);
}

/** Section index per top-level node and the kind of the page break a section end makes (null: continuous). */
function sectionsOf(doc: PMNode, sections: Section[]): { section: number[]; breakKind: (sectionEnd: number) => "page" | "even" | "odd" | null } {
  const index = new Map(sections.map((s, i) => [s.id, i]));
  const { section } = sectionLayout(doc, sections);
  return {
    section,
    breakKind: (id) => {
      const i = index.get(id);
      if (i === undefined) return null;
      const next = sections[Math.min(sections.length - 1, i + 1)];
      if (!next || i + 1 >= sections.length) return null;
      return next.kind === "continuous" ? null : next.kind === "evenPage" ? "even" : next.kind === "oddPage" ? "odd" : "page";
    },
  };
}

interface CacheEntry {
  node: PMNode;
  el: HTMLElement;
  m: BlockMeasure;
}

/** Where the floats that text wraps around are, relative to their paragraphs (CSS px): a change reflows the text. */
export function floatSignature(dom: HTMLElement, zoom: number): string {
  const out: string[] = [];
  dom.querySelectorAll<HTMLElement>("[data-wrap]").forEach((el) => {
    if (!/^(square|tight|through|topAndBottom)$/.test(el.dataset.wrap ?? "")) return;
    const p = el.closest("p, h1, h2, h3, h4, h5, h6");
    const r = el.getBoundingClientRect();
    const b = p?.getBoundingClientRect() ?? r;
    out.push([r.left - b.left, r.top - b.top, r.width, r.height].map((v) => Math.round(v / zoom)).join(","));
  });
  return out.join(";");
}

/** The measuring side of the plugin: cached block measures, dirty tracking, header heights. */
class Measurer {
  /** Measures by PM node (a node unchanged by an edit is the same object). */
  private cache = new Map<PMNode, CacheEntry>();
  private dirty = new WeakSet<Element>();
  private key = "";
  private hfCache = new Map<string, number>();
  private probe: HTMLElement | null = null;
  private observer: MutationObserver | null = null;
  /** Blocks measured (not from the cache) by the last `measure`. */
  fresh = 0;

  constructor(
    private view: EditorView,
    private onChange: () => void,
  ) {
    if (typeof MutationObserver !== "undefined") {
      this.observer = new MutationObserver((records) => {
        let any = false;
        for (const r of records) {
          const top = this.topOf(r.target);
          if (!top) continue;
          if (r.type === "childList" && [...Array.from(r.addedNodes), ...Array.from(r.removedNodes)].every((n) => n instanceof HTMLElement && n.matches(".page-spacer, .page-colbreak"))) continue;
          if (r.type === "attributes" && r.target === top && r.attributeName === "style") continue;
          if (r.type === "attributes" && (r.target as Element).matches?.(".note, .page-spacer")) continue;
          this.dirty.add(top);
          any = true;
        }
        if (any) this.onChange();
      });
      this.observer.observe(view.dom, { subtree: true, childList: true, characterData: true, attributes: true });
    }
  }

  private topOf(n: Node): Element | null {
    let cur: Node | null = n;
    while (cur && cur.parentNode !== this.view.dom) cur = cur.parentNode;
    return cur && cur.nodeType === 1 ? (cur as Element) : null;
  }

  invalidate(): void {
    this.cache.clear();
    this.hfCache.clear();
  }

  destroy(): void {
    this.observer?.disconnect();
    this.probe?.remove();
  }

  zoom(): number {
    const dom = this.view.dom as HTMLElement;
    const w = dom.offsetWidth;
    const r = dom.getBoundingClientRect().width;
    return w > 0 && r > 0 ? r / w : 1;
  }

  /** Height (CSS px) of a header/footer text at the text width. */
  hfHeight(text: string, width: number): number {
    if (!text.trim()) return 0;
    const k = `${width}|${text}`;
    const hit = this.hfCache.get(k);
    if (hit != null) return hit;
    const host = (this.view.dom as HTMLElement).parentElement;
    if (!host) return 0;
    if (!this.probe) {
      this.probe = document.createElement("div");
      this.probe.className = "page-hf page-hf-probe";
      this.probe.setAttribute("aria-hidden", "true");
      this.probe.style.cssText = "position:absolute;visibility:hidden;left:0;top:0;pointer-events:none;";
      host.appendChild(this.probe);
    }
    this.probe.style.width = `${width}px`;
    this.probe.textContent = text;
    const h = this.probe.offsetHeight;
    this.hfCache.set(k, h);
    return h;
  }

  /** Measures every top-level block (cached ones are reused). */
  measure(flowOf: (n: PMNode) => FlowProps): { measures: (BlockMeasure | null)[]; positions: number[] } {
    const view = this.view;
    const dom = view.dom as HTMLElement;
    const z = this.zoom();
    let fresh = 0;
    // Text wrapping around a floating picture or shape reflows the following blocks without touching their DOM
    // (a moved or resized float): their cached lines are stale then (W-14).
    const key = `${dom.offsetWidth}|${z.toFixed(3)}|${floatSignature(dom, z)}`;
    if (key !== this.key) {
      this.cache.clear();
      this.key = key;
    }
    const ctx: MeasureContext = {
      zoom: z,
      textblock: (el) => {
        const d = (el as HTMLElement & { pmViewDesc?: { node?: PMNode; posAtStart?: number; posBefore?: number } }).pmViewDesc;
        if (!d?.node?.isTextblock || d.node && (d as { dom?: Node }).dom !== el) return null;
        return { node: d.node, pos: d.posBefore ?? 0 };
      },
      posAt: (node, offset) => {
        try {
          return view.posAtDOM(node, offset);
        } catch {
          return -1;
        }
      },
      flow: (n) => (n ? flowOf(n) : {}),
    };
    const measures: (BlockMeasure | null)[] = [];
    const positions: number[] = [];
    const next = new Map<PMNode, CacheEntry>();
    // The top-level elements in order (`nodeDOM` searches from the start: quadratic for long documents).
    const kids = (Array.from(dom.children) as HTMLElement[]).filter((c) => !c.classList.contains("ProseMirror-widget") && !c.matches(".page-spacer, .page-colbreak, .page-hf-probe"));
    const direct = kids.length === view.state.doc.childCount;
    view.state.doc.forEach((node, offset, index) => {
      positions.push(offset);
      const el = (direct ? kids[index] : view.nodeDOM(offset)) as HTMLElement | null;
      if (!el || el.nodeType !== 1) {
        measures.push(null);
        return;
      }
      const hit = this.cache.get(node);
      const reuse = hit && hit.el === el && !this.dirty.has(el) ? hit : null;
      let m: BlockMeasure;
      if (reuse) m = reuse.m;
      else {
        m = measureBlock(el, node, offset, ctx);
        fresh++;
        this.dirty.delete(el);
      }
      next.set(node, { node, el, m });
      measures.push(m);
    });
    this.cache = next;
    this.fresh = fresh;
    return { measures, positions };
  }

}

/** The sheets, page infos and field data of an engine result. */
function toLayout(
  doc: PMNode,
  result: PaginateResult,
  flow: Flow,
  positions: number[],
  sections: Section[],
  page: PageSetup | null,
  geoOf: (section: number) => PageGeometry,
  hide: boolean,
): PageLayout {
  const infos: PageInfo[] = result.pages.map((p) => ({
    section: p.section,
    first: p.first,
    value: p.value,
    number: formatNumber(p.value, sections[p.section]?.pageNumberFormat ?? "decimal"),
  }));
  const total = infos.length;
  const numbers = noteNumbers(doc);
  const nodePage: number[] = positions.map(() => -1);
  const pageStarts: number[] = [];
  result.pages.forEach((p, k) => {
    for (let u = p.start; u < p.end; u++) {
      const top = flow.blocks[flow.units[u]!.block]?.top;
      if (top != null && nodePage[top] === -1) nodePage[top] = k;
    }
    const u = flow.units[p.start];
    const start = u ? Math.min(...anchorPositions(u.at)) : k === 0 ? 0 : doc.content.size;
    pageStarts.push(k === 0 ? 0 : Math.max(pageStarts[k - 1] ?? 0, start));
  });
  for (let i = 0; i < nodePage.length; i++) if (nodePage[i] === -1) nodePage[i] = i > 0 ? nodePage[i - 1]! : 0;
  // Table positions for repeated headers.
  const tablePos = (t: number): number => positions[flow.blocks[flow.tables[t]!.block]!.top] ?? 0;
  const sheets: SheetView[] = result.pages.map((p, k) => {
    const geo = geoOf(p.section);
    const bodyTop = p.sheetTop + p.box.bodyTop;
    const bodyBottom = bodyTop + p.box.bodyHeight;
    const notesTop = bodyBottom - p.notesHeight;
    let y = notesTop + NOTE_SEPARATOR_PX;
    const notes = p.footnotes.map((n) => {
      const out: SheetNote = { id: n.id, n: numbers.get(n.id) ?? "", from: n.from, to: n.to, top: y };
      y += n.to - n.from;
      return out;
    });
    const sheet: SheetView = {
      index: k,
      top: p.sheetTop,
      height: p.box.height,
      bodyTop,
      bodyBottom,
      contentEnd: Math.min(p.contentEnd, notesTop),
      geo,
      header: hide ? "" : pageHfText(infos[k]!, total, false, sections, page),
      footer: hide ? "" : pageHfText(infos[k]!, total, true, sections, page),
      notesTop,
      notes,
    };
    if (p.repeat) sheet.repeat = { pos: tablePos(p.repeat.table), top: bodyTop, height: p.repeat.height };
    if (p.sets?.length) {
      sheet.rules = p.sets.flatMap((s) => {
        const reg = flow.regions[s.region];
        const sec = sections[p.section];
        if (!reg || !sec?.columns?.separator || reg.columns.length < 2) return [];
        const xs = reg.columns.slice(1).map((c, i) => (reg.columns[i]!.x + reg.columns[i]!.width + c.x) / 2);
        return [{ top: s.top, height: s.height, xs }];
      });
    }
    return sheet;
  });
  return {
    pages: infos,
    nodePage,
    pageStarts,
    firstHeader: sheets[0]?.header ?? "",
    lastFooter: sheets[sheets.length - 1]?.footer ?? "",
    sheets,
    origin: result.origin,
    height: result.height,
    gap: hide ? HIDDEN_GAP_PX : PAGE_GAP_PX,
    hide,
    flow,
    result,
    positions,
  };
}

/** A compact signature of what the decorations show (no new dispatch when it did not change). */
function signature(layout: PageLayout, spacers: ResolvedSpacer[]): string {
  const sp = spacers.map((s) => `${s.pos}:${s.kind}:${Math.round(s.height)}`).join(",");
  const sh = layout.sheets
    .map((s) => `${Math.round(s.top)}|${Math.round(s.bodyTop)}|${Math.round(s.contentEnd)}|${s.header}|${s.footer}|${s.notes.map((n) => `${n.id}:${Math.round(n.from)}-${Math.round(n.to)}@${Math.round(n.top)}`).join(";")}|${s.repeat ? `${s.repeat.pos}:${Math.round(s.repeat.height)}` : ""}`)
    .join("/");
  return `${layout.hide}#${sp}#${sh}#${layout.pages.map((p) => p.number).join(",")}`;
}

/** The pagination plugin; `remeasurePages(view)` forces a new layout (page setup, zoom or view changes). */
export function paginationPlugin(opts: PaginationOptions): Plugin<PaginationState> {
  return new Plugin<PaginationState>({
    key: paginationKey,
    state: {
      init: () => ({ layout: null, decorations: DecorationSet.empty }),
      apply(tr, prev, _old, state) {
        const meta = tr.getMeta(paginationKey) as { layout: PageLayout; spacers: ResolvedSpacer[] } | "clear" | undefined;
        if (meta === "clear") return { layout: null, decorations: DecorationSet.empty };
        if (meta) return { layout: meta.layout, decorations: buildDecorations(state.doc, meta.layout, meta.spacers) };
        return tr.docChanged ? { ...prev, decorations: prev.decorations.map(tr.mapping, tr.doc) } : prev;
      },
    },
    props: {
      decorations: (state) => paginationKey.getState(state)?.decorations ?? null,
      attributes: (state): Record<string, string> => (paginationKey.getState(state)?.layout ? { "data-paged": "" } : {}),
      handleKeyDown(view, e) {
        if ((e.key !== "PageDown" && e.key !== "PageUp") || e.ctrlKey || e.metaKey || e.altKey) return false;
        const layout = paginationKey.getState(view.state)?.layout;
        if (!layout) return false;
        return movePage(view, layout, e.key === "PageDown" ? 1 : -1, e.shiftKey);
      },
      handleDOMEvents: {
        mousedown: (view, e) => {
          const target = e.target as HTMLElement | null;
          const spacer = target?.closest?.(".page-spacer") as HTMLElement | null;
          if (!spacer || e.button !== 0) return false;
          const layout = paginationKey.getState(view.state)?.layout;
          if (!layout) return false;
          e.preventDefault();
          return clickInGap(view, layout, Number(spacer.dataset.page), e.clientX, e.clientY);
        },
        dblclick: (_view, e) => {
          const hf = (e.target as HTMLElement | null)?.closest?.("[data-hf]") as HTMLElement | null;
          if (!hf) return false;
          e.preventDefault();
          opts.onEditHeaderFooter?.(hf.dataset.hf === "footer" ? "footer" : "header");
          return true;
        },
      },
    },
    view(view) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let pages = 0;
      let last = "";
      let passes = 0;
      let force = true;
      let prev: { flow: Flow; result: PaginateResult; inputs: string } | null = null;
      const measurer = new Measurer(view, () => schedule(60, false));
      const run = () => {
        timer = undefined;
        if (!view.dom.isConnected) return;
        const st = paginationKey.getState(view.state);
        if (!opts.enabled()) {
          if (st?.layout) {
            flushDomSelection(view);
            view.dispatch(view.state.tr.setMeta(paginationKey, "clear").setMeta("addToHistory", false));
            opts.onLayout?.(null);
          }
          last = "";
          return;
        }
        const t0 = performance.now();
        const wasForcedRun = force;
        if (force) measurer.invalidate();
        const sections = opts.sections?.() ?? [];
        const page = opts.page();
        const hide = !!opts.hideWhiteSpace?.();
        const doc = view.state.doc;
        const { measures, positions } = measurer.measure(opts.flow ?? (() => ({})));
        const t1 = performance.now();
        const { section, breakKind } = sectionsOf(doc, sections);
        const flow = buildFlow({
          blocks: measures.flatMap((m, i) => (m ? [{ m, pos: positions[i]!, section: section[i] ?? 0, region: m.kind === "columns" }] : [])),
          sectionBreak: breakKind,
        });
        // Fragments refer to top-level indices of the measured blocks only.
        const indexMap = measures.flatMap((m, i) => (m ? [i] : []));
        for (const b of flow.blocks) b.top = indexMap[b.top] ?? b.top;
        const geoOf = (s: number) => pageGeometry(sections[s]?.page ?? page);
        const total = Math.max(1, st?.layout?.pages.length ?? 1);
        const textWidth = (view.dom as HTMLElement).offsetWidth || 600;
        const pageBox = (p: { section: number; first: boolean; value: number }): PageBox => {
          const g = geoOf(p.section);
          const info: PageInfo = { ...p, number: formatNumber(p.value, sections[p.section]?.pageNumberFormat ?? "decimal") };
          const hh = measurer.hfHeight(pageHfText(info, total, false, sections, page), textWidth);
          const fh = measurer.hfHeight(pageHfText(info, total, true, sections, page), textWidth);
          const top = Math.max(g.top, g.header + hh);
          const bottom = Math.min(g.height - g.bottom, g.height - g.footer - fh);
          const body = Math.max(48, bottom - top);
          return hide ? { height: body, bodyTop: 0, bodyHeight: body } : { height: g.height, bodyTop: top, bodyHeight: body };
        };
        // Incremental: resume at the last page decided before the first changed unit (same page setup and view).
        const inputs = `${hide}|${total}|${JSON.stringify(sections.map((x) => x.page))}|${JSON.stringify(page)}`;
        const resume = !wasForcedRun && prev && prev.inputs === inputs ? { prev: prev.result, from: firstChange(prev.flow, flow) } : undefined;
        const result = paginate(flow, {
          resume,
          pageBox,
          numberStart: (s) => (sections[s]?.pageNumberStart ?? null),
          gap: hide ? HIDDEN_GAP_PX : PAGE_GAP_PX,
          noteSeparator: NOTE_SEPARATOR_PX,
        });
        prev = { flow, result, inputs };
        const layout = toLayout(doc, result, flow, positions, sections, page, geoOf, hide);
        // For tools and the perf scripts: the last layout and its timings (ms).
        Object.assign(view.dom, { rusuiteLayout: layout, rusuitePaginationMs: { measure: t1 - t0, total: performance.now() - t0, measured: measurer.fresh, resumedFrom: resume ? (result.checkpoints.length && result.pages.length ? resume.from : -1) : -1 } });
        const pageOfUnit = new Map<number, number>();
        result.pages.forEach((p, k) => pageOfUnit.set(p.start, pageOfUnit.has(p.start) ? pageOfUnit.get(p.start)! : k));
        const spacers: ResolvedSpacer[] = [];
        for (const s of result.spacers) {
          const u = flow.units[s.unit]!;
          const place: ResolvedSpacer["place"] = s.at.kind === "inline" ? "inline" : "block";
          const pg = result.pages.findIndex((p) => p.start === s.unit && p.index > 0);
          for (const pos of anchorPositions(s.at)) spacers.push({ pos, height: s.height, kind: s.kind, place, collapse: s.at.kind === "block" ? (u.collapse ?? 0) : 0, page: pg < 0 ? 0 : pg });
        }
        const sig = signature(layout, spacers);
        const wasForced = force;
        force = false;
        if (sig === last && st?.layout && !wasForced) return;
        last = sig;
        // A selection the browser has changed but ProseMirror not yet read (Shift+Arrow just before Ctrl+K) would be
        // overwritten by this transaction's redraw with the old one: take it over first.
        flushDomSelection(view);
        view.dispatch(view.state.tr.setMeta(paginationKey, { layout, spacers }).setMeta("addToHistory", false));
        opts.onLayout?.(layout);
        view.dom.dispatchEvent(new Event("rusuite-layout"));
        if (layout.pages.length !== pages) {
          pages = layout.pages.length;
          opts.onPages?.(pages);
        }
        // Check the result once the browser has laid the new gaps out (a columns box may balance differently).
        if (passes++ < 2) schedule(30, false);
      };
      const schedule = (delay = 120, edit = true) => {
        if (edit) passes = 0;
        clearTimeout(timer);
        timer = setTimeout(run, delay);
      };
      schedule(0);
      const onRemeasure = () => {
        force = true;
        passes = 0;
        schedule(0);
      };
      view.dom.addEventListener("rusuite-remeasure", onRemeasure);
      // Window resizes and font loads lay the pages out again (60 ms debounce).
      let width = (view.dom as HTMLElement).offsetWidth;
      const ro =
        typeof ResizeObserver !== "undefined"
          ? new ResizeObserver(() => {
              const w = (view.dom as HTMLElement).offsetWidth;
              if (w !== width) {
                width = w;
                force = true;
                schedule(60);
              }
            })
          : null;
      ro?.observe(view.dom);
      const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
      const onFonts = () => {
        force = true;
        schedule(60);
      };
      fonts?.addEventListener?.("loadingdone", onFonts);
      return {
        update(v, prevState) {
          if (v.state.doc !== prevState.doc) schedule();
        },
        destroy() {
          clearTimeout(timer);
          ro?.disconnect();
          fonts?.removeEventListener?.("loadingdone", onFonts);
          measurer.destroy();
          view.dom.removeEventListener("rusuite-remeasure", onRemeasure);
        },
      };
    },
  });
}

/** Reads a pending DOM selection change into the editor state (ProseMirror otherwise waits for `selectionchange`). */
function flushDomSelection(view: EditorView): void {
  const observer = (view as unknown as { domObserver?: { forceFlush?: () => void; flush?: () => void } }).domObserver;
  observer?.forceFlush?.();
  observer?.flush?.();
}

/** Client px per frame px and the frame's client top (the page frame is the editor's parent's parent). */
function frameOf(view: EditorView): { top: number; left: number; zoom: number } | null {
  const frame = (view.dom as HTMLElement).closest(".write-page") as HTMLElement | null;
  if (!frame) return null;
  const r = frame.getBoundingClientRect();
  const z = frame.offsetWidth > 0 ? r.width / frame.offsetWidth : 1;
  return { top: r.top, left: r.left, zoom: z || 1 };
}

/** A click in the gap before page `page`: the caret goes to the nearest line (the last of the page above, the first below). */
function clickInGap(view: EditorView, layout: PageLayout, page: number, x: number, y: number): boolean {
  const f = frameOf(view);
  const next = layout.sheets[page];
  const prev = layout.sheets[page - 1];
  if (!f || !next || !prev) return false;
  const fy = (y - f.top) / f.zoom;
  const above = fy < prev.top + prev.height + layout.gap / 2 && fy < next.top;
  const target = above ? prev.contentEnd - 4 : next.bodyTop + (next.repeat?.height ?? 0) + 4;
  const hit = view.posAtCoords({ left: x, top: f.top + target * f.zoom });
  if (!hit) return false;
  view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(hit.pos))));
  view.focus();
  return true;
}

/** PageDown / PageUp: the caret moves by one page (same place on the next / previous page). */
function movePage(view: EditorView, layout: PageLayout, dir: 1 | -1, extend: boolean): boolean {
  const f = frameOf(view);
  if (!f) return false;
  const { head, anchor } = view.state.selection;
  let c: { top: number; left: number };
  try {
    c = view.coordsAtPos(head);
  } catch {
    return false;
  }
  const fy = (c.top - f.top) / f.zoom;
  const k = layout.sheets.findIndex((s) => fy < s.top + s.height + layout.gap);
  const cur = layout.sheets[k < 0 ? layout.sheets.length - 1 : k]!;
  const to = layout.sheets[Math.max(0, Math.min(layout.sheets.length - 1, cur.index + dir))]!;
  if (to === cur) {
    const pos = dir > 0 ? view.state.doc.content.size : 0;
    const sel = TextSelection.near(view.state.doc.resolve(pos), dir > 0 ? -1 : 1);
    view.dispatch(view.state.tr.setSelection(extend ? TextSelection.create(view.state.doc, anchor, sel.head) : sel).scrollIntoView());
    return true;
  }
  const offset = Math.max(0, Math.min(fy - cur.bodyTop, to.bodyBottom - to.bodyTop - 4));
  const target = to.bodyTop + offset;
  // Bring the target page into view, then hit-test it.
  const scroller = (view.dom as HTMLElement).closest(".write-scroll") as HTMLElement | null;
  if (scroller) scroller.scrollTop += (to.top - cur.top) * f.zoom;
  const f2 = frameOf(view)!;
  const hit = view.posAtCoords({ left: c.left, top: f2.top + target * f2.zoom + 2 });
  const pos = hit?.pos ?? layout.pageStarts[to.index] ?? 0;
  const sel = TextSelection.near(view.state.doc.resolve(Math.min(pos, view.state.doc.content.size)));
  view.dispatch(view.state.tr.setSelection(extend ? TextSelection.create(view.state.doc, anchor, sel.head) : sel));
  return true;
}

/** Asks the pagination plugin of `view` to lay the pages out again (page setup, zoom or view mode changed). */
export function remeasurePages(view: EditorView | null | undefined): void {
  view?.dom.dispatchEvent(new Event("rusuite-remeasure"));
}

export function pageCount(view: EditorView): number {
  return paginationKey.getState(view.state)?.layout?.pages.length ?? 1;
}

/** The current layout of `state` (null in draft view or before the first layout). */
export function currentLayout(state: EditorState): PageLayout | null {
  return paginationKey.getState(state)?.layout ?? null;
}

/** Page width, left margin and text column width (CSS px) of `page`, for floating pictures. */
export function floatPage(page: PageSetup | null | undefined): { width: number; marginLeft: number; columnWidth: number } {
  const g = pageGeometry(page);
  return { width: g.width, marginLeft: g.left, columnWidth: g.width - g.left - g.right };
}
