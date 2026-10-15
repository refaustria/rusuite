// CSS of the print view: one page per slide, the page as big as the slide.

import { pageRule } from "@rusuite/ui-shared";
import type { SlideSize } from "../generated/SlideSize";

const EMU_PER_IN = 914_400;
const inches = (emu: number) => Number((emu / EMU_PER_IN).toFixed(3));

/** `@page` rule for slides of `size` (16:9 → `13.333in 7.5in`, 4:3 → `10in 7.5in`), no margin. */
export function showPageCss(size: SlideSize): string {
  return pageRule(`${inches(size.width)}in ${inches(size.height)}in`, "0");
}

/** Print-view styles: slide images fill whole pages; everything else is hidden by the view being the only content. */
export function showPrintCss(size: SlideSize): string {
  const w = inches(size.width);
  const h = inches(size.height);
  return `${showPageCss(size)}
html, body, #root { height: auto !important; overflow: visible !important; margin: 0; background: #fff; }
.print-slide { display: block; width: ${w}in; height: ${h}in; break-after: page; page-break-after: always; }
.print-slide:last-child { break-after: auto; page-break-after: auto; }
@media screen { .print-pages { display: flex; flex-direction: column; gap: 8px; align-items: center; padding: 8px; background: #888; } .print-slide { width: min(100%, ${w}in); height: auto; } }
`;
}
