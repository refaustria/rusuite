// Write's print document (P8-31, docs/write-layout.md): the pages of the
// print layout's `PageLayout` – every fragment a slice of a cloned block cut
// between two lines, footnotes at the bottom, repeated table headers – so
// with the document's own page setup at 100 % the printed pages are the
// editor's pages. Other settings measure the clones at the printed width
// and run the same pagination.

import {
  MARGIN_PRESETS, PAPER_IN, escapeHtml, type MarginPreset, type PageOrientation, type PaperName, type PrintChoice, type PrintDoc, withLabel,
} from "@rusuite/ui-shared";
import "../i18n";
import type { PageSetup } from "../generated/PageSetup";
import type { Comment } from "../generated/Comment";
import { commentText, fullDate, initialsOf, threads } from "../comments/model";
import { t } from "../i18n";
import type { Node as PMNode } from "@tiptap/pm/model";
import { computeBreaks, headerFooterText, NOTE_SEPARATOR_PX, pageGeometry, type BlockBox, type PageGeometry, type PageLayout } from "../features/pagination";
import { buildFlow, measureBlock, type FlowProps, type MeasureContext } from "../features/layout/measure";
import { paginate, type Flow, type FlowBlock, type PaginateResult } from "../features/layout/paginate";

export interface WritePrintOptions {
  /** `""` = all pages. */
  range: string;
  /** `document` = the document's page setup. */
  paper: PaperName | "document";
  orientation: PageOrientation | "document";
  margins: MarginPreset | "document";
  /** Content scale in percent (25–200). */
  scale: number;
  /** "Print markup": comment marks in the text and the comments as a list at the end. */
  markup?: boolean;
}

export const DEFAULT_WRITE_PRINT: WritePrintOptions = { range: "", paper: "document", orientation: "document", margins: "document", scale: 100, markup: false };

export const WRITE_PAPER_CHOICES: PrintChoice[] = [
  withLabel({ value: "document" }, "print.asDocument"),
  withLabel({ value: "A4" }, "print.paper.A4"),
  withLabel({ value: "Letter" }, "print.paper.Letter"),
  withLabel({ value: "Legal" }, "print.paper.Legal"),
  withLabel({ value: "A3" }, "print.paper.A3"),
];

export const WRITE_ORIENTATION_CHOICES: PrintChoice[] = [
  withLabel({ value: "document" }, "print.asDocument"),
  withLabel({ value: "portrait" }, "print.portrait"),
  withLabel({ value: "landscape" }, "print.landscape"),
];

export const WRITE_MARGIN_CHOICES: PrintChoice[] = [
  withLabel({ value: "document" }, "print.asDocument"),
  withLabel({ value: "normal" }, "write.print.margins.normal"),
  withLabel({ value: "narrow" }, "write.print.margins.narrow"),
  withLabel({ value: "wide" }, "write.print.margins.wide"),
];

/** The printed page geometry (CSS px): the document's page setup with the print overrides. */
export function writePrintGeometry(page: PageSetup | null, o: Pick<WritePrintOptions, "paper" | "orientation" | "margins">): PageGeometry {
  const g = { ...pageGeometry(page) };
  let landscape = g.width > g.height;
  if (o.paper !== "document") {
    const p = PAPER_IN[o.paper];
    [g.width, g.height] = landscape ? [p.h * 96, p.w * 96] : [p.w * 96, p.h * 96];
  }
  if (o.orientation !== "document") {
    const want = o.orientation === "landscape";
    if (want !== landscape) [g.width, g.height] = [g.height, g.width];
    landscape = want;
  }
  if (o.margins !== "document") {
    const m = MARGIN_PRESETS[o.margins];
    Object.assign(g, { top: m.top * 96, right: m.right * 96, bottom: m.bottom * 96, left: m.left * 96, header: m.header * 96, footer: m.footer * 96 });
  }
  return g;
}

/**
 * Pages of blocks measured at `1 / scale` of the printed width: `[start,
 * end)` block index ranges per page (at least one page).
 */
export function pageGroups(blocks: readonly BlockBox[], textHeight: number, scale = 1): [number, number][] {
  if (blocks.length === 0) return [[0, 0]];
  const scaled = blocks.map((b) => ({ top: b.top * scale, bottom: b.bottom * scale, breakAfter: b.breakAfter }));
  const starts = [0, ...computeBreaks(scaled, textHeight).breaks.map((b) => b.index)];
  return starts.map((s, i) => [s, starts[i + 1] ?? blocks.length]);
}

export const WRITE_PRINT_CSS = `.rs-write-body { position: absolute; }
.rs-write-content .page-break { border: 0 !important; margin: 0 !important; }
.rs-write-content .find-match, .rs-write-content .find-current { background: none !important; outline: none !important; }
.rs-write-content .ProseMirror-selectednode { outline: none !important; }
.rs-write-content .hidden-text { display: none !important; }
.rs-write-content .drawing-wrap span[data-tag] { display: block; }
.rs-write-content .drawing-wrap span.drawing-text { display: flex; }
.rs-write-content .drawing-wrap span[data-tag="p"] { margin: 0 0 8pt; }
.rs-write-content .image-handle, .rs-write-content .drawing-rotate, .rs-write-content .drawing-adjust, .rs-write-content .crop-handle, .rs-write-content .crop-window, .rs-write-content .crop-mask, .rs-write-content .chain-caret { display: none !important; }
.rs-write-content .drawing-member { outline: none !important; }
.rs-write-content .drawing-box, .rs-write-content .inline-image-wrap img { outline: none !important; }
.rs-write-content .field { background: none !important; }
.rs-write-content [data-section-label]::after { display: none !important; }
.rs-write-content .notes-separator { color: transparent !important; }
.rs-write-content > * { content-visibility: visible !important; }
.rs-write-content .comment-range { background: none !important; }
.rs-write-markup .comment-range { background: #fff3b0 !important; }
.rs-write-content .comment-ref { font-size: 0.7em; vertical-align: super; line-height: 0; color: #555; }
.rs-write-content .print-comment { margin: 0 0 4pt; font-size: 9.5pt; }
.rs-write-content .print-comment-reply { margin-left: 1.5em; }
.rs-write-content .print-comments-title { margin: 12pt 0 6pt; font-size: 12pt; font-weight: 600; border-top: 1px solid #888; padding-top: 6pt; }
.rs-write-hf { position: absolute; overflow: hidden; color: #000; font: 9pt/1.3 Calibri, Carlito, "Segoe UI", sans-serif; white-space: pre-wrap; tab-size: 8; }`;

/** One page: header, the blocks in the text area (scaled), footer. */
export function writePageHtml(blocksHtml: string, n: number, geo: PageGeometry, page: PageSetup | null, scale: number, contentClass: string): string {
  const textW = geo.width - geo.left - geo.right;
  const hf = (text: string, pos: string) => (text ? `<div class="rs-write-hf" style="${pos};left:${geo.left}px;right:${geo.right}px">${escapeHtml(text)}</div>` : "");
  const zoom = scale === 1 ? "" : `zoom:${scale};`;
  return `${hf(headerFooterText(page?.headerText, n), `top:${geo.header}px`)}<div class="rs-write-body write-paged" style="top:${geo.top}px;left:${geo.left}px;width:${textW}px"><div class="${escapeHtml(contentClass)} rs-write-content" style="${zoom}width:${textW / scale}px">${blocksHtml}</div></div>${hf(headerFooterText(page?.footerText, n), `bottom:${geo.footer}px`)}`;
}

/** The app's stylesheets as one `<style>` (for the isolated preview frame). */
export function documentStyles(doc: Document = document): string {
  const out: string[] = [];
  for (const sheet of Array.from(doc.styleSheets)) {
    try {
      out.push(Array.from(sheet.cssRules, (r) => r.cssText).join("\n"));
    } catch {
      // Cross-origin sheet: not readable.
    }
  }
  return `<style>${out.join("\n").replace(/<\/style/gi, "<\\/style")}</style>`;
}

/** The editor's top-level block elements (without the pagination widgets). */
export function editorBlocks(dom: HTMLElement): HTMLElement[] {
  return (Array.from(dom.children) as HTMLElement[]).filter(
    (c) => !c.classList.contains("page-gap") && !c.classList.contains("page-end") && !c.classList.contains("page-spacer") && !c.classList.contains("page-colbreak") && !c.classList.contains("ProseMirror-widget"),
  );
}

/** A comment's mark in printed markup: the author's initials and the thread's number (`[AB1]`). */
export function commentLabel(c: Comment, n: number): string {
  return `[${c.initials || initialsOf(c.author)}${n}]`;
}

/**
 * Print markup on the cloned blocks: a `[AB1]` mark after every comment
 * range and, appended as blocks of their own, the comments as a list
 * (threads in the order of their ranges, replies indented).
 */
export function addCommentMarkup(clones: HTMLElement[], comments: Comment[]): HTMLElement[] {
  const order: number[] = [];
  for (const c of clones) c.querySelectorAll<HTMLElement>("[data-comment-start]").forEach((e) => order.push(Number(e.dataset.commentStart)));
  const list = threads(comments, order).filter((th) => order.includes(th.root.id));
  if (!list.length) return clones;
  const number = new Map(list.map((th, i) => [th.root.id, i + 1]));
  for (const c of clones) {
    c.querySelectorAll<HTMLElement>("[data-comment-end]").forEach((e) => {
      const id = Number(e.dataset.commentEnd);
      const th = list.find((x) => x.root.id === id);
      if (!th) return;
      const sup = document.createElement("span");
      sup.className = "comment-ref";
      sup.textContent = commentLabel(th.root, number.get(id)!);
      e.after(sup);
    });
  }
  const block = (cls: string, text: string) => {
    const p = document.createElement("p");
    p.className = cls;
    p.textContent = text;
    return p;
  };
  const out = [...clones, block("print-comments-title", t("write.print.commentsTitle"))];
  for (const th of list) {
    const n = number.get(th.root.id)!;
    const line = (c: Comment) => `${c.author}${c.date ? ` (${fullDate(c.date)})` : ""}: ${commentText(c)}`;
    out.push(block("print-comment", `${commentLabel(th.root, n)} ${line(th.root)}${th.root.resolved ? ` – ${t("write.comments.resolved")}` : ""}`));
    for (const r of th.replies) out.push(block("print-comment print-comment-reply", line(r)));
  }
  return out;
}

// ----- pages from the pagination ---------------------------------------------------------

/**
 * The block elements inside shapes and text boxes as `span`s (`display:
 * block`): the clone is serialized to HTML, where a `div` or `p` inside the
 * paragraph holding the drawing would end that paragraph.
 */
export function inlineDrawingBlocks(c: HTMLElement): void {
  const doc = c.ownerDocument;
  c.querySelectorAll<HTMLElement>(".drawing-wrap div, .drawing-wrap p, .drawing-wrap h1, .drawing-wrap h2, .drawing-wrap h3, .drawing-wrap h4, .drawing-wrap h5, .drawing-wrap h6").forEach((e) => {
    const span = doc.createElement("span");
    for (const a of Array.from(e.attributes)) span.setAttribute(a.name, a.value);
    span.dataset.tag = e.tagName.toLowerCase();
    while (e.firstChild) span.append(e.firstChild);
    e.replaceWith(span);
  });
}

/**
 * Widgets and editor-only placement removed from a cloned block.
 * `keepSpacers`: the page gaps stay (slicing a row split across pages);
 * `piece`: the clone becomes a printed piece, so the notes area keeps only
 * the endnotes it prints in its flow (footnotes and endnotes at section ends
 * are pieces of their own).
 */
function cleanClone(c: HTMLElement, keepSpacers = false, piece = false): HTMLElement {
  c.querySelectorAll(keepSpacers ? ".page-colbreak, .page-hf-probe" : ".page-spacer, .page-colbreak, .page-hf-probe").forEach((e) => e.remove());
  if (piece && c.matches(".notes-area")) c.querySelectorAll(".note.note-paged, .note[data-note-kind='foot']").forEach((e) => e.remove());
  c.querySelectorAll("[data-clipped]").forEach((e) => {
    e.removeAttribute("data-clipped");
    (e as HTMLElement).style.removeProperty("clip-path");
  });
  inlineDrawingBlocks(c);
  c.removeAttribute("contenteditable");
  c.querySelectorAll("[contenteditable]").forEach((e) => e.removeAttribute("contenteditable"));
  [c, ...Array.from(c.querySelectorAll<HTMLElement>(".note-paged"))].filter((e) => e.classList.contains("note-paged")).forEach((e) => {
    e.classList.remove("note-paged", "note-paged-end");
    e.removeAttribute("style");
    e.removeAttribute("data-slices");
    if (!keepSpacers) e.querySelectorAll(".page-spacer").forEach((x) => x.remove());
  });
  return c;
}

/** Children of a columns box (without widgets). */
const boxChildren = (el: HTMLElement): HTMLElement[] =>
  (Array.from(el.children) as HTMLElement[]).filter((c) => !c.matches(".page-spacer, .page-colbreak, .ProseMirror-widget"));

/** What a printed page shows: positioned slices of blocks and notes (px on the sheet, before `scale`). */
interface PrintPiece {
  html: string;
  x: number;
  y: number;
  width: number;
  /** Px of the source hidden above the slice and the slice's height. */
  off: number;
  height: number;
  cls?: string;
  /** The content's box in the piece when it is not the piece itself (a block laid out in the editor's text column, moved into its section's). */
  inner?: { left: number; width: number };
}

interface PrintSheet {
  pieces: PrintPiece[];
  header: string;
  footer: string;
  /** Footnote separator (y, full width for a continuation). */
  sep?: { y: number; cont: boolean };
  /** Endnote separators at section ends (y). */
  endSeps?: number[];
}

/** Where a printed page's text column is (sheet px): its own section's geometry (P9-W2). */
export interface PrintColumn {
  left: number;
  width: number;
  /** The editor's text column relative to this page's (W-18 decorations): top-level clones move back by `dx`. */
  dx: number;
  /** The editor content's width (a top-level clone is laid out at it). */
  editorWidth: number;
}

/**
 * The printed pages of an engine result: every fragment is a slice of its
 * block's clone (`elementOf`), clipped between two line boundaries; repeated
 * table headers and footnote slices like in the editor. Every page uses its
 * own section's text column (`column(k)`); a table row split across pages
 * is cut out of a clone that keeps the editor's page gaps (each cell
 * continues at its own line; the borders stay open at the cut).
 */
function sheetsFromResult(
  flow: Flow,
  result: PaginateResult,
  elementOf: (block: FlowBlock) => HTMLElement | null,
  tableOf: (table: number) => HTMLElement | null,
  noteOf: (id: number) => HTMLElement | null,
  column: (page: number) => PrintColumn,
  texts: (page: number) => { header: string; footer: string },
  endSeps: (page: number) => number[] = () => [],
): PrintSheet[] {
  const html = new Map<HTMLElement, string>();
  const live = new Map<HTMLElement, string>();
  const outer = (el: HTMLElement, keepSpacers = false) => {
    const cache = keepSpacers ? live : html;
    let h = cache.get(el);
    if (h == null) {
      const c = cleanClone(el.cloneNode(true) as HTMLElement, keepSpacers, true);
      c.style.marginTop = "0";
      c.style.marginBottom = "0";
      h = c.outerHTML;
      cache.set(el, h);
    }
    return h;
  };
  return result.pages.map((p, k) => {
    const pieces: PrintPiece[] = [];
    const col0 = column(k);
    const limit = p.box.bodyTop + p.box.bodyHeight - p.notesHeight;
    const windows = new Map((p.rowWindows ?? []).map((w) => [w.unit, w]));
    for (const col of p.columns) {
      for (const f of col.fragments) {
        const b = flow.blocks[f.block];
        if (!b || b.note === 0) continue;
        const el = b.note ? noteOf(b.note) : elementOf(b);
        if (!el) continue;
        if (b.note) {
          // An endnote at a section end: in the notes area's style, like in the editor.
          pieces.push({ html: `<div class="notes-area">${outer(el)}</div>`, x: col0.left + col.x, y: f.y, width: col.width || col0.width, off: f.top - b.y, height: f.bottom - f.top, cls: "rs-write-note" });
          continue;
        }
        const top = b.child < 0 && !b.note;
        const x = col0.left + col.x;
        const width = col.width || col0.width;
        // A top-level block keeps the editor's layout (the editor's text column, moved by the section's offset).
        const inner = top && (Math.abs(col0.dx) > 0.01 || Math.abs(col0.editorWidth - width) > 0.01) ? { left: -col0.dx, width: col0.editorWidth } : undefined;
        const u0 = flow.units[f.from]!;
        const wFirst = windows.get(f.from);
        const wLast = windows.get(f.to - 1);
        if ((wFirst || wLast) && u0.table != null) {
          // A row split across pages: a window over the table as the editor shows it (page gaps kept).
          const t = flow.tables[u0.table]!;
          const tableTop = result.vtop[t.first]! - (flow.units[t.first]!.top - b.y);
          const last = flow.units[f.to - 1]!;
          const winTop = wFirst ? wFirst.top : result.vtop[f.from]!;
          const winBottom = wLast ? wLast.bottom : result.vtop[f.to - 1]! + (last.bottom - last.top);
          const y = winTop - p.sheetTop;
          pieces.push({ html: outer(el, true), x, y, width, off: winTop - tableTop, height: Math.min(winBottom - p.sheetTop, limit) - y, ...(inner ? { inner } : {}) });
          continue;
        }
        let bottom = f.bottom;
        for (let u = f.from; u < f.to; u++) bottom = Math.max(bottom, flow.units[u]!.ink ?? 0);
        // A clipped row (can not break, taller than the page) ends at the body bottom.
        const height = Math.min(bottom - f.top, (p.clips?.length ? limit : Infinity) - f.y);
        pieces.push({ html: outer(el), x, y: f.y, width, off: f.top - b.y, height, ...(inner ? { inner } : {}) });
      }
    }
    if (p.repeat) {
      const t = tableOf(p.repeat.table);
      const b = flow.blocks[flow.tables[p.repeat.table]!.block];
      const inner = Math.abs(col0.dx) > 0.01 || Math.abs(col0.editorWidth - col0.width) > 0.01 ? { left: -col0.dx, width: col0.editorWidth } : undefined;
      if (t && b) pieces.push({ html: outer(t), x: col0.left, y: p.box.bodyTop, width: col0.width, off: 0, height: p.repeat.height, ...(inner ? { inner } : {}) });
    }
    const sheet: PrintSheet = { pieces, ...texts(k) };
    const seps = endSeps(k);
    if (seps.length) sheet.endSeps = seps;
    if (p.footnotes.length) {
      const notesTop = p.box.bodyTop + p.box.bodyHeight - p.notesHeight;
      sheet.sep = { y: notesTop + 5, cont: p.footnotes[0]!.from > 0 };
      let y = notesTop + NOTE_SEPARATOR_PX;
      for (const n of p.footnotes) {
        const el = noteOf(n.id);
        if (el) pieces.push({ html: `<div class="notes-area">${outer(el)}</div>`, x: col0.left, y, width: col0.width, off: n.from, height: n.to - n.from, cls: "rs-write-note" });
        y += n.to - n.from;
      }
    }
    return sheet;
  });
}

/** One printed page: header, footer (sheet px) and the pieces (in a `zoom: scale` layer). */
function sheetHtml(s: PrintSheet, geo: PageGeometry, scale: number, contentClass: string, size = ""): string {
  const hf = (text: string, pos: string) => (text ? `<div class="rs-write-hf" style="${pos};left:${geo.left}px;right:${geo.right}px">${escapeHtml(text)}</div>` : "");
  const cls = escapeHtml(contentClass);
  const pieces = s.pieces
    .map(
      (p) =>
        `<div class="rs-write-piece${p.cls ? ` ${p.cls}` : ""}" style="left:${p.x.toFixed(2)}px;top:${p.y.toFixed(2)}px;width:${p.width.toFixed(2)}px;height:${Math.max(0, p.height).toFixed(2)}px"><div class="${cls} rs-write-content" style="width:${(p.inner?.width ?? p.width).toFixed(2)}px;margin-top:${(-p.off).toFixed(2)}px${p.inner ? `;margin-left:${p.inner.left.toFixed(2)}px` : ""}">${p.html}</div></div>`,
    )
    .join("");
  const sep =
    (s.sep ? `<div class="rs-write-note-sep" style="top:${s.sep.y.toFixed(2)}px;left:${geo.left}px;${s.sep.cont ? `right:${geo.right}px` : "width:2in"}"></div>` : "") +
    (s.endSeps ?? []).map((y) => `<div class="rs-write-note-sep" style="top:${(y + 5).toFixed(2)}px;left:${geo.left}px;width:2in"></div>`).join("");
  const layer = scale === 1 ? `${pieces}${sep}` : `<div class="rs-write-scaled" style="zoom:${scale}">${pieces}${sep}</div>`;
  return `${size ? `<i class="rs-wsize ${size}" hidden></i>` : ""}${hf(s.header, `top:${geo.header}px`)}<div class="write-paged rs-write-layer">${layer}</div>${hf(s.footer, `bottom:${geo.footer}px`)}`;
}

/**
 * Sheet sizes of a document with mixed page sizes (portrait and landscape
 * sections): a named `@page` per size and the page boxes that use it (the
 * shared print document sets one size for all pages). `classOf(k)` is the
 * marker class of page `k` (empty for the document's first size).
 */
export function mixedPageCss(geos: readonly PageGeometry[]): { css: string; classOf: (k: number) => string } {
  const sizes: string[] = [];
  const keyOf = (g: PageGeometry) => `${(g.width / 96).toFixed(3)}x${(g.height / 96).toFixed(3)}`;
  const first = geos[0] ? keyOf(geos[0]) : "";
  const index = geos.map((g) => {
    const key = keyOf(g);
    if (key === first) return -1;
    let i = sizes.indexOf(key);
    if (i < 0) i = sizes.push(key) - 1;
    return i;
  });
  const css = sizes
    .map((key, i) => {
      const [w, h] = key.split("x");
      return `@page rs-wsize-${i} { size: ${w}in ${h}in; margin: 0; }\n.rs-print-page:has(> .rs-wsize-${i}) { page: rs-wsize-${i}; width: ${w}in; height: ${h}in; }`;
    })
    .join("\n");
  return { css, classOf: (k) => (index[k] != null && index[k]! >= 0 ? `rs-wsize-${index[k]}` : "") };
}

/** Whether the print options are the document's own (the editor's pages print as they are). */
export function isDocumentLayout(o: WritePrintOptions): boolean {
  return o.paper === "document" && o.orientation === "document" && o.margins === "document" && o.scale === 100 && !o.markup;
}

/** The PM info of textblock elements, paired from the editor DOM to its clones (same structure). */
function pairTextblocks(orig: Element, clone: Element, out: Map<Element, { node: PMNode | null; pos: number }>): void {
  const d = (orig as Element & { pmViewDesc?: { node?: PMNode; dom?: Node; posBefore?: number } }).pmViewDesc;
  if (d?.node?.isTextblock && d.dom === orig) out.set(clone, { node: d.node, pos: d.posBefore ?? -1 });
  const a = orig.children;
  const b = clone.children;
  for (let i = 0; i < a.length && i < b.length; i++) pairTextblocks(a[i]!, b[i]!, out);
}

const TEXTBLOCK = "p, h1, h2, h3, h4, h5, h6";

/**
 * Builds the print document from the editor DOM `dom` and the document's
 * page setup. With the document's own setup at 100 % (no markup) the
 * editor's `layout` is printed as it is (the same pages, cut between the
 * same lines); other paper, margins, scale or print markup measure clones
 * of the blocks at the printed width and paginate them with the same engine.
 */
export function buildWritePrintDoc(
  dom: HTMLElement,
  page: PageSetup | null,
  o: WritePrintOptions,
  comments: Comment[] = [],
  layout: PageLayout | null = null,
  flowOf: (node: PMNode) => FlowProps = () => ({}),
): PrintDoc {
  const contentClass = Array.from(dom.classList)
    .filter((c) => c !== "ProseMirror-focused")
    .join(" ");
  const css = `${WRITE_PRINT_CSS}\n${WRITE_PIECE_CSS}`;
  if (layout?.result && layout.flow && layout.positions && isDocumentLayout(o)) {
    const { flow, result } = layout;
    const blocks = editorBlocks(dom);
    const tops = layout.positions.map((_p, i) => blocks[i] ?? null);
    const elementOf = (b: FlowBlock) => {
      const top = tops[b.top];
      return top && b.child >= 0 ? boxChildren(top)[b.child] ?? null : top ?? null;
    };
    const geo0 = layout.sheets[0]?.geo ?? pageGeometry(page);
    const geoOf = (k: number) => layout.sheets[k]?.geo ?? geo0;
    const editorWidth = dom.offsetWidth || geo0.width - geo0.left - geo0.right;
    const sheets = sheetsFromResult(
      flow,
      result,
      elementOf,
      (t) => elementOf(flow.blocks[flow.tables[t]!.block]!),
      (id) => dom.querySelector<HTMLElement>(`.note[data-note-id="${id}"]`),
      (k) => {
        const g = geoOf(k);
        return { left: g.left, width: g.width - g.left - g.right, dx: layout.sheets[k]?.shift?.dx ?? 0, editorWidth };
      },
      (k) => ({ header: layout.sheets[k]?.header ?? "", footer: layout.sheets[k]?.footer ?? "" }),
      (k) => (layout.sheets[k]?.endSeps ?? []).map((y) => y - (layout.sheets[k]?.top ?? 0)),
    );
    const mixed = mixedPageCss(sheets.map((_s, k) => geoOf(k)));
    const pages = sheets.map((s, k) => sheetHtml(s, geoOf(k), 1, contentClass, mixed.classOf(k)));
    return { widthIn: geo0.width / 96, heightIn: geo0.height / 96, css: mixed.css ? `${css}\n${mixed.css}` : css, pages, head: documentStyles() };
  }
  const geo = writePrintGeometry(page, o);
  const scale = Math.max(0.1, o.scale / 100);
  const textW = geo.width - geo.left - geo.right;
  // Measure the clones at the printed width (off-screen, with the app's styles).
  const host = document.createElement("div");
  host.className = "write-paged";
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = `position:absolute;left:-100000px;top:0;visibility:hidden;width:${textW / scale}px`;
  const inner = document.createElement("div");
  inner.className = `${contentClass} rs-write-content`;
  inner.style.position = "relative";
  inner.style.display = "flow-root";
  host.appendChild(inner);
  const info = new Map<Element, { node: PMNode | null; pos: number }>();
  let clones = editorBlocks(dom).map((b) => {
    const c = b.cloneNode(true) as HTMLElement;
    pairTextblocks(b, c, info);
    return cleanClone(c);
  });
  if (o.markup) clones = addCommentMarkup(clones, comments);
  inner.append(...clones);
  document.body.appendChild(host);
  try {
    const ctx: MeasureContext = {
      zoom: 1,
      textblock: (el) => info.get(el) ?? (el.matches(TEXTBLOCK) && !el.closest(".toc") ? { node: null, pos: -1 } : null),
      posAt: () => -1,
      flow: (n) => (n ? flowOf(n) : {}),
    };
    const measures = clones.map((c) => measureBlock(c, null, -1, ctx));
    const flow = buildFlow({ blocks: measures.map((m) => ({ m, pos: -1, section: 0, region: m.kind === "columns" })) });
    const s = 1 / scale;
    const top = geo.top * s;
    const bodyHeight = Math.max(48, (geo.height - geo.top - geo.bottom) * s);
    const result = paginate(flow, { pageBox: () => ({ height: geo.height * s, bodyTop: top, bodyHeight }), gap: 0, noteSeparator: NOTE_SEPARATOR_PX });
    const total = result.pages.length;
    const sheets = sheetsFromResult(
      flow,
      result,
      (b) => {
        const el = clones[b.top];
        return el && b.child >= 0 ? boxChildren(el)[b.child] ?? null : el ?? null;
      },
      (t) => clones[flow.blocks[flow.tables[t]!.block]!.top] ?? null,
      (id) => inner.querySelector<HTMLElement>(`.note[data-note-id="${id}"]`),
      () => ({ left: geo.left * s, width: textW * s, dx: 0, editorWidth: textW * s }),
      (k) => ({ header: headerFooterText(page?.headerText, k + 1, total), footer: headerFooterText(page?.footerText, k + 1, total) }),
    );
    const cls = o.markup ? `${contentClass} rs-write-markup` : contentClass;
    const pages = sheets.map((sh) => sheetHtml(sh, geo, scale, cls));
    return { widthIn: geo.width / 96, heightIn: geo.height / 96, css, pages: pages.length ? pages : [""], head: documentStyles() };
  } finally {
    host.remove();
  }
}

/** Positioned slices of the print pages. */
export const WRITE_PIECE_CSS = `.rs-write-layer { position: absolute; inset: 0; }
.rs-write-scaled { position: absolute; left: 0; top: 0; width: 100%; height: 100%; }
.rs-write-piece { position: absolute; overflow: hidden; }
.rs-write-piece > .rs-write-content { position: relative; display: flow-root; }
.rs-write-note .note { position: relative; }
.rs-write-note .notes-area { margin: 0 !important; }
.rs-write-note-sep { position: absolute; border-top: 1px solid #000; }`;
