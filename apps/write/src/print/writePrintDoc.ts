// Write's print document: the editor's top-level blocks cloned onto
// fixed-size pages. The blocks are measured at the printed text width and
// packed with the same `computeBreaks` as the print layout view, so with
// the document's own page setup at 100 % the pages are the editor's pages.

import {
  MARGIN_PRESETS, PAPER_IN, escapeHtml, type MarginPreset, type PageOrientation, type PaperName, type PrintChoice, type PrintDoc, withLabel,
} from "@rusuite/ui-shared";
import "../i18n";
import type { PageSetup } from "../generated/PageSetup";
import { computeBreaks, headerFooterText, pageGeometry, type BlockBox, type PageGeometry } from "../features/pagination";

export interface WritePrintOptions {
  /** `""` = all pages. */
  range: string;
  /** `document` = the document's page setup. */
  paper: PaperName | "document";
  orientation: PageOrientation | "document";
  margins: MarginPreset | "document";
  /** Content scale in percent (25–200). */
  scale: number;
}

export const DEFAULT_WRITE_PRINT: WritePrintOptions = { range: "", paper: "document", orientation: "document", margins: "document", scale: 100 };

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
.rs-write-content .field { background: none !important; }
.rs-write-content [data-section-label]::after { display: none !important; }
.rs-write-content .notes-separator { color: transparent !important; }
.rs-write-content > * { content-visibility: visible !important; }
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
  return (Array.from(dom.children) as HTMLElement[]).filter((c) => !c.classList.contains("page-gap") && !c.classList.contains("page-end") && !c.classList.contains("ProseMirror-widget"));
}

/** Builds the print document from the editor DOM `dom` and the document's page setup. */
export function buildWritePrintDoc(dom: HTMLElement, page: PageSetup | null, o: WritePrintOptions): PrintDoc {
  const geo = writePrintGeometry(page, o);
  const scale = Math.max(0.1, o.scale / 100);
  const textW = geo.width - geo.left - geo.right;
  const textH = geo.height - geo.top - geo.bottom;
  const contentClass = Array.from(dom.classList)
    .filter((c) => c !== "ProseMirror-focused")
    .join(" ");
  // Measure the clones at the printed width (off-screen, with the app's styles).
  const host = document.createElement("div");
  host.className = "write-paged";
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = `position:absolute;left:-100000px;top:0;visibility:hidden;width:${textW / scale}px`;
  const inner = document.createElement("div");
  inner.className = `${contentClass} rs-write-content`;
  inner.style.position = "relative";
  host.appendChild(inner);
  const clones = editorBlocks(dom).map((b) => {
    const c = b.cloneNode(true) as HTMLElement;
    c.removeAttribute("contenteditable");
    c.querySelectorAll("[contenteditable]").forEach((e) => e.removeAttribute("contenteditable"));
    return c;
  });
  inner.append(...clones);
  document.body.appendChild(host);
  let groups: [number, number][];
  try {
    const boxes: BlockBox[] = clones.map((c) => ({
      top: c.offsetTop,
      bottom: c.offsetTop + c.offsetHeight,
      // Manual page breaks and section breaks other than "continuous".
      breakAfter:
        c.classList.contains("page-break") ||
        c.querySelector(".page-break") !== null ||
        [c, ...Array.from(c.querySelectorAll<HTMLElement>("[data-section-next]"))].some((e) => e.dataset.sectionNext != null && e.dataset.sectionNext !== "continuous"),
    }));
    groups = pageGroups(boxes, textH, scale);
  } finally {
    host.remove();
  }
  const pages = groups.map(([s, e], i) => writePageHtml(clones.slice(s, e).map((c) => c.outerHTML).join(""), i + 1, geo, page, scale, contentClass));
  return { widthIn: geo.width / 96, heightIn: geo.height / 96, css: WRITE_PRINT_CSS, pages, head: documentStyles() };
}
