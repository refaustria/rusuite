// Shared printing (P7-9): paper and margins, page ranges, the print
// document (explicit, fixed-size pages as HTML), its `@page` CSS, the
// print root mounted while the system print dialog is open, and the
// print-then-restore flow.
//
// Every app builds a `PrintDoc`: one HTML string per page, each laid out at
// the full sheet size (margins are padding inside the page). The same
// document is shown in the File › Print preview (`<iframe srcdoc>`) and
// printed (mounted in `#rusuite-print-root`, the only thing visible under
// `@media print`), so the preview's page count is the printed one.

import type { Backend } from "./backend";

export type PaperName = "A4" | "Letter" | "Legal" | "A3";
export type PageOrientation = "portrait" | "landscape";

/** Paper sizes in inches (portrait). */
export const PAPER_IN: Record<PaperName, { w: number; h: number }> = {
  A4: { w: 210 / 25.4, h: 297 / 25.4 },
  Letter: { w: 8.5, h: 11 },
  Legal: { w: 8.5, h: 14 },
  A3: { w: 297 / 25.4, h: 420 / 25.4 },
};

export const PAPER_NAMES = Object.keys(PAPER_IN) as PaperName[];

/** `{ value, label }` choices of the paper select. */
export const PAPER_CHOICES: PrintChoice[] = [
  { value: "A4", label: "A4 (21 × 29.7 cm)" },
  { value: "Letter", label: "Letter (8.5 × 11 in)" },
  { value: "Legal", label: "Legal (8.5 × 14 in)" },
  { value: "A3", label: "A3 (29.7 × 42 cm)" },
];

export const ORIENTATION_CHOICES: PrintChoice[] = [
  { value: "portrait", label: "Portrait" },
  { value: "landscape", label: "Landscape" },
];

/** Page margins in inches; `header`/`footer` = distance of the header/footer from the sheet edge. */
export interface PrintMargins {
  top: number;
  right: number;
  bottom: number;
  left: number;
  header: number;
  footer: number;
}

export type MarginPreset = "normal" | "narrow" | "wide";

/** Word's margin presets (Normal 1 in, Narrow 0.5 in, Wide 1 in / 2 in). */
export const MARGIN_PRESETS: Record<MarginPreset, PrintMargins> = {
  normal: { top: 1, right: 1, bottom: 1, left: 1, header: 0.5, footer: 0.5 },
  narrow: { top: 0.5, right: 0.5, bottom: 0.5, left: 0.5, header: 0.3, footer: 0.3 },
  wide: { top: 1, right: 2, bottom: 1, left: 2, header: 0.5, footer: 0.5 },
};

export const MARGIN_CHOICES: PrintChoice[] = [
  { value: "normal", label: "Normal" },
  { value: "narrow", label: "Narrow" },
  { value: "wide", label: "Wide" },
];

/** One entry of a print-option select. */
export interface PrintChoice {
  value: string;
  label: string;
}

/** The sheet size in inches for `paper` in `orientation`. */
export function paperSize(paper: PaperName, orientation: PageOrientation): { w: number; h: number } {
  const p = PAPER_IN[paper];
  return orientation === "landscape" ? { w: p.h, h: p.w } : { w: p.w, h: p.h };
}

const fmt = (n: number) => `${Number(n.toFixed(3))}`;

/**
 * An `@page` rule. `size` is a named paper (`A4`, `Letter`, optionally with
 * ` landscape`) or explicit `<w>in <h>in`; `margin` is a CSS length list.
 */
export function pageRule(size: string, margin: string): string {
  return `@page { size: ${size}; margin: ${margin}; }`;
}

/** `A4`/`Letter`/… (+ ` landscape`) for a page of `widthIn × heightIn` (either orientation), else explicit inches. */
export function pageSizeCss(widthIn: number, heightIn: number, tolerance = 0.03): string {
  const landscape = widthIn > heightIn;
  const [short, long] = landscape ? [heightIn, widthIn] : [widthIn, heightIn];
  for (const name of PAPER_NAMES) {
    const p = PAPER_IN[name];
    if (Math.abs(p.w - short) <= tolerance && Math.abs(p.h - long) <= tolerance) {
      return landscape ? `${name} landscape` : name;
    }
  }
  return `${fmt(widthIn)}in ${fmt(heightIn)}in`;
}

// ---------------------------------------------------------------- page ranges

/** `""` (or only blanks) = all pages; else `1-3,5`, `7-` (to the end), `-2` (from the start). */
export type PageRangeResult = { pages: number[] } | { error: string };

/**
 * Parses a page range against `count` pages: sorted, unique, 1-based page
 * numbers. Pages past the end are dropped; an empty result is an error.
 */
export function parsePageRange(text: string, count: number): PageRangeResult {
  const all = Array.from({ length: count }, (_, i) => i + 1);
  if (text.trim() === "") return { pages: all };
  const out = new Set<number>();
  for (const raw of text.split(/[,;]/)) {
    const part = raw.trim();
    if (part === "") continue;
    const m = /^(\d*)\s*(-?)\s*(\d*)$/.exec(part);
    if (!m || (m[1] === "" && m[3] === "") || (m[2] === "" && m[3] !== "")) return { error: `"${part}" is not a page or a range` };
    const from = m[1] === "" ? 1 : Number(m[1]);
    const to = m[2] === "" ? from : m[3] === "" ? count : Number(m[3]);
    if (from < 1 || to < from) return { error: `"${part}" is not a valid range` };
    for (let p = from; p <= Math.min(to, count); p++) out.add(p);
  }
  if (out.size === 0) return { error: count === 0 ? "Nothing to print" : `The document has ${count} page${count === 1 ? "" : "s"}` };
  return { pages: [...out].sort((a, b) => a - b) };
}

// -------------------------------------------------------------- print documents

/** A document to print: fixed-size pages as HTML (each laid out on the whole sheet). */
export interface PrintDoc {
  /** Sheet size in inches. */
  widthIn: number;
  heightIn: number;
  /** Styles of the page contents (scoped by the app, e.g. `.rs-calc …`). */
  css: string;
  /** One HTML string per page (the content of a `.rs-print-page`). */
  pages: string[];
  /** Extra `<head>` markup for the preview only (e.g. the app's stylesheets; the print root lives in the app's document). */
  head?: string;
}

/** The pages of `doc` in `range` (see `parsePageRange`); an invalid range keeps nothing. */
export function applyPageRange(doc: PrintDoc, range: string): PrintDoc {
  const r = parsePageRange(range, doc.pages.length);
  if ("error" in r) return { ...doc, pages: [] };
  return { ...doc, pages: r.pages.map((p) => doc.pages[p - 1]!) };
}

/** `@page` for the document (margin 0: the pages carry their margins) and the page box rules. */
export function printDocCss(doc: Pick<PrintDoc, "widthIn" | "heightIn">): string {
  const w = fmt(doc.widthIn);
  const h = fmt(doc.heightIn);
  return `@page { size: ${w}in ${h}in; margin: 0; }
.rs-print-page { position: relative; box-sizing: border-box; width: ${w}in; height: ${h}in; overflow: hidden; background: #fff; color: #000; break-after: page; page-break-after: always; break-inside: avoid; }
.rs-print-page:last-child { break-after: auto; page-break-after: auto; }`;
}

/** Escapes text for HTML content and attribute values. */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const pageHtml = (html: string, i: number) => `<div class="rs-print-page" data-page="${i + 1}">${html}</div>`;

/** Screen styles of the preview frame: grey desk, one page at a time (`.rs-preview-off` hides the others). */
export const PREVIEW_SCREEN_CSS = `@media screen {
  html { background: #d4d4d4; }
  body { margin: 0; padding: 16px; display: flex; flex-direction: column; align-items: center; }
  .rs-print-page { box-shadow: 0 1px 4px rgba(0,0,0,.35); flex: none; }
  .rs-print-page.rs-preview-off { display: none; }
}`;

/** A standalone HTML document of `doc` (the preview's `srcdoc`; also what the e2e tests turn into a PDF). */
export function printDocHtml(doc: PrintDoc, opts: { preview?: boolean } = {}): string {
  return `<!doctype html><html><head><meta charset="utf-8">${doc.head ?? ""}<style>
html, body { margin: 0; padding: 0; background: #fff; }
@media print { html, body { height: auto !important; overflow: visible !important; } }
${doc.css}
${printDocCss(doc)}
${opts.preview ? PREVIEW_SCREEN_CSS : ""}
</style></head><body>${doc.pages.map(pageHtml).join("")}</body></html>`;
}

export const PRINT_ROOT_ID = "rusuite-print-root";

/** Global rules while the print root is mounted: on screen it is hidden; on paper it is the only content. */
export const PRINT_ROOT_CSS = `@media screen { #${PRINT_ROOT_ID} { display: none !important; } }
@media print {
  html, body { height: auto !important; min-height: 0 !important; overflow: visible !important; margin: 0 !important; padding: 0 !important; background: #fff !important; }
  body > *:not(#${PRINT_ROOT_ID}) { display: none !important; }
  #${PRINT_ROOT_ID} { display: block !important; }
}`;

let unmountTimer: ReturnType<typeof setTimeout> | undefined;

/** Removes the print root (if any). */
export function unmountPrintRoot(): void {
  clearTimeout(unmountTimer);
  unmountTimer = undefined;
  document.getElementById(PRINT_ROOT_ID)?.remove();
}

/** Mounts `doc` as the print root (replacing a previous one); returns it. */
export function mountPrintRoot(doc: PrintDoc): HTMLElement {
  unmountPrintRoot();
  const root = document.createElement("div");
  root.id = PRINT_ROOT_ID;
  root.setAttribute("aria-hidden", "true");
  root.innerHTML = `<style>${PRINT_ROOT_CSS}\n${doc.css}\n${printDocCss(doc)}</style>${doc.pages.map(pageHtml).join("")}`;
  document.body.appendChild(root);
  return root;
}

/**
 * Prints and resolves once printing is over: on `afterprint`, or shortly
 * after `backend.print()` returned if the webview never fires it.
 */
export async function printAndWait(backend: Pick<Backend, "print">, graceMs = 1500): Promise<void> {
  let done!: () => void;
  const finished = new Promise<void>((r) => (done = r));
  window.addEventListener("afterprint", done, { once: true });
  try {
    await backend.print();
    const timer = setTimeout(done, graceMs);
    await finished;
    clearTimeout(timer);
  } finally {
    window.removeEventListener("afterprint", done);
  }
}

/** How long the print root stays mounted on the desktop after the print dialog returned (the webview may still be spooling). */
export const DESKTOP_PRINT_KEEP_MS = 60_000;

/**
 * Prints `doc` through the system print dialog (the user picks a printer
 * or "Save as PDF" there). The browser removes the print root once
 * `afterprint` fired; the desktop shells keep it for a while, because
 * WebKitGTK / WKWebView may render the pages after their dialog returned.
 */
export async function printDocument(doc: PrintDoc, backend: Pick<Backend, "print" | "kind">): Promise<void> {
  if (doc.pages.length === 0) throw new Error("Nothing to print");
  mountPrintRoot(doc);
  try {
    await printAndWait(backend);
  } finally {
    if (backend.kind === "tauri") {
      clearTimeout(unmountTimer);
      unmountTimer = setTimeout(unmountPrintRoot, DESKTOP_PRINT_KEEP_MS);
    } else unmountPrintRoot();
  }
}

// ------------------------------------------------------------ header / footer

/** Left / center / right slots of a header or footer (Excel style). */
export interface HeaderFooterSlots {
  left: string;
  center: string;
  right: string;
}

export const EMPTY_SLOTS: HeaderFooterSlots = { left: "", center: "", right: "" };

/** Values of the header/footer tokens. */
export interface HeaderFooterContext {
  page: number;
  pages: number;
  date: Date;
  /** Sheet (`&A`) name. */
  sheet?: string;
  /** File (`&F`) name. */
  file?: string;
}

/**
 * Expands Excel's tokens: `&P` page, `&N` pages, `&D` date, `&T` time,
 * `&A` sheet name, `&F` file name, `&&` a literal `&`. Unknown tokens stay.
 */
export function expandHeaderFooter(text: string, ctx: HeaderFooterContext): string {
  return text.replace(/&([&PNDTAF])/gi, (all, t: string) => {
    switch (t.toUpperCase()) {
      case "&":
        return "&";
      case "P":
        return String(ctx.page);
      case "N":
        return String(ctx.pages);
      case "D":
        return ctx.date.toLocaleDateString();
      case "T":
        return ctx.date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      case "A":
        return ctx.sheet ?? "";
      case "F":
        return ctx.file ?? "";
      default:
        return all;
    }
  });
}

/**
 * A header (or footer) band: three absolutely positioned slots at
 * `edgeIn` from the top (bottom) sheet edge, between the left and right
 * margins. Empty when all slots are empty.
 */
export function headerFooterHtml(slots: HeaderFooterSlots, ctx: HeaderFooterContext, where: "header" | "footer", edgeIn: number, leftIn: number, rightIn: number): string {
  const parts = (["left", "center", "right"] as const)
    .map((k) => [k, expandHeaderFooter(slots[k], ctx)] as const)
    .filter(([, t]) => t !== "");
  if (parts.length === 0) return "";
  const pos = where === "header" ? `top:${fmt(edgeIn)}in` : `bottom:${fmt(edgeIn)}in`;
  const inner = parts.map(([k, t]) => `<span class="rs-hf-${k}" style="position:absolute;${k === "center" ? "left:0;right:0;text-align:center" : `${k}:0`}">${escapeHtml(t)}</span>`).join("");
  return `<div class="rs-hf rs-${where}" style="position:absolute;${pos};left:${fmt(leftIn)}in;right:${fmt(rightIn)}in;height:1.2em;font:9pt Calibri,Carlito,Arial,sans-serif;color:#000;white-space:pre">${inner}</div>`;
}
