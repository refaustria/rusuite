// Print stylesheet of Write: `@page` generated from the document's
// `PageSetup`, plus `@media print` rules that show only the document.

import { pageRule, pageSizeCss } from "@rusuite/ui-shared";
import type { PageSetup } from "../generated/PageSetup";

const TWIPS_PER_IN = 1440;
const inch = (twips: number) => `${Number((twips / TWIPS_PER_IN).toFixed(3))}in`;

/** `@page` for a document page: paper size (named when A4/Letter), orientation, margins. */
export function writePageCss(page: PageSetup | null): string {
  if (!page) return pageRule("A4", "1in");
  let w = page.width / TWIPS_PER_IN;
  let h = page.height / TWIPS_PER_IN;
  // The model may store the unrotated sheet; the orientation decides.
  if (page.orientation === "landscape" ? w < h : w > h) [w, h] = [h, w];
  const m = page.margins;
  return pageRule(pageSizeCss(w, h), `${inch(m.top)} ${inch(m.right)} ${inch(m.bottom)} ${inch(m.left)}`);
}

/** A CSS string for `content`: quotes and backslashes escaped, line breaks as `\A`, `{PAGE}` as `counter(page)`. */
export function contentValue(text: string): string {
  const str = (t: string) => `"${t.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\A ")}"`;
  return text
    .split("{PAGE}")
    .map(str)
    .join(" counter(page) ");
}

/**
 * The header and footer as `@page` margin boxes (`@top-left` /
 * `@bottom-left`, printed on every page by Chromium), at the header/footer
 * distance from the sheet edge. Empty without header and footer.
 */
export function writeHeaderFooterCss(page: PageSetup | null): string {
  if (!page) return "";
  const box = (name: string, text: string | null | undefined, edge: "top" | "bottom", dist: number) =>
    text
      ? `@${name} { content: ${contentValue(text)}; vertical-align: ${edge}; padding-${edge}: ${inch(dist)}; white-space: pre-wrap; font: 9pt Calibri, Carlito, sans-serif; color: #000; }`
      : "";
  const inner = [box("top-left", page.headerText, "top", page.margins.header), box("bottom-left", page.footerText, "bottom", page.margins.footer)]
    .filter(Boolean)
    .join(" ");
  return inner ? `@page { ${inner} }` : "";
}

/** Rules for `@media print` (the page frame fills the sheet; chrome is hidden). */
export const WRITE_PRINT_RULES = `@media print {
  html, body, #root { height: auto !important; overflow: visible !important; background: #fff !important; }
  main { display: block !important; height: auto !important; }
  main > :not(.write-scroll) { display: none !important; }
  .write-scroll { overflow: visible !important; padding: 0 !important; background: none !important; }
  .write-page { width: auto !important; max-width: none !important; margin: 0 !important; padding: 0 !important; box-shadow: none !important; }
  .tiptap-content .page-break { display: block; height: 0; margin: 0; border: 0; break-before: page; page-break-before: always; }
  .tiptap-content p, .tiptap-content tr, .tiptap-content img { break-inside: avoid; }
}`;

/** The complete `<style>` text for a document. */
export function writePrintCss(page: PageSetup | null): string {
  const hf = writeHeaderFooterCss(page);
  return `${writePageCss(page)}\n${hf ? `${hf}\n` : ""}${WRITE_PRINT_RULES}`;
}
