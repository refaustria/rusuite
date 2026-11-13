// Print and PDF of Notes pages through ui-shared's print pipeline: each Notes page (title, date, content) is laid
// out at the sheet's text width in a hidden box, its top-level blocks are measured and packed onto fixed-size
// sheets (a block taller than a sheet gets one of its own and is cut at the sheet's bottom). Section print: every
// page (sub-pages after their page) starts on a new sheet.

import { MARGIN_PRESETS, paperSize, type MarginPreset, type PageOrientation, type PaperName, type PrintDoc } from "@rusuite/ui-shared";

export interface NotesPrintOptions {
  what: "page" | "section";
  paper: PaperName;
  orientation: PageOrientation;
  margins: MarginPreset;
  range: string;
}

export const DEFAULT_PRINT: NotesPrintOptions = { what: "page", paper: "A4", orientation: "portrait", margins: "normal", range: "" };

/** One Notes page to print: header and content as elements (from `renderContent`). */
export interface PrintPage {
  title: string;
  date: string;
  content: HTMLElement;
}

/** The styles of printed pages (the preview frame has no app CSS). */
export const NOTES_PRINT_CSS = `
.np { font-family: Calibri, Carlito, "Segoe UI", Arial, sans-serif; font-size: 11pt; line-height: 1.45; color: #000; }
.np-title { font-size: 20pt; font-weight: 600; margin: 0 0 2pt; border-bottom: 1px solid #bbb; padding-bottom: 2pt; }
.np-date { font-size: 8.5pt; color: #555; margin: 0 0 10pt; }
.np .notes-content { white-space: pre-wrap; word-wrap: break-word; }
.np .notes-content > * { margin: 0; }
.np .notes-content > * + * { margin-top: 0.35em; }
.np h1 { font-size: 18pt; font-weight: 600; } .np h2 { font-size: 14pt; font-weight: 600; } .np h3 { font-size: 12pt; font-weight: 600; }
.np ul { list-style: disc; padding-left: 1.5em; } .np ol { list-style: decimal; padding-left: 1.5em; }
.np ul[data-type="taskList"] { list-style: none; padding-left: 0.2em; }
.np ul[data-type="taskList"] li { display: flex; gap: 0.4em; }
.np ul[data-type="taskList"] li[data-checked="true"] > div { text-decoration: line-through; color: #666; }
.np blockquote { border-left: 3px solid #bbb; padding-left: 0.8em; color: #444; }
.np pre { background: #f4f4f4; border: 1px solid #ddd; padding: 0.4em 0.6em; font-family: Consolas, "Courier New", monospace; font-size: 9.5pt; white-space: pre-wrap; }
.np code { font-family: Consolas, "Courier New", monospace; font-size: 0.92em; }
.np hr { border: none; border-top: 1px solid #999; margin: 0.8em 0; }
.np a { color: #0645ad; text-decoration: underline; } .np a.broken { color: #888; text-decoration: line-through; }
.np mark { background: #fff59d; color: inherit; }
.np table { border-collapse: collapse; width: 100%; table-layout: fixed; }
.np td, .np th { border: 1px solid #999; padding: 2pt 4pt; vertical-align: top; }
.np th { background: #eee; font-weight: 600; text-align: left; }
.np td > p, .np th > p { margin: 0; }
.np figure { margin: 0.4em 0; } .np figure[data-align="center"] { text-align: center; }
.np figure img { max-width: 100%; height: auto; }
.np .notes-attachment { display: inline-flex; align-items: center; gap: 6pt; border: 1px solid #bbb; border-radius: 4pt; padding: 3pt 6pt; }
.np .notes-attachment-icon { font-size: 7pt; font-weight: 700; border: 1px solid #888; border-radius: 2pt; padding: 1pt 2pt; }
.np .notes-attachment-info { display: flex; flex-direction: column; } .np .notes-attachment-size { font-size: 8pt; color: #555; }
.np .notes-tag-icons { display: inline-flex; gap: 2pt; margin-right: 4pt; vertical-align: -2pt; }
.np .notes-done { text-decoration: line-through; color: #666; }
.np-sheet { position: absolute; inset: 0; box-sizing: border-box; overflow: hidden; }
`;

/** Packs block boxes (`top`/`bottom` px from the content's top) onto sheets of `height` px: index lists per sheet. */
export function paginate(blocks: readonly { top: number; bottom: number }[], height: number): number[][] {
  const sheets: number[][] = [];
  let current: number[] = [];
  let start = 0;
  blocks.forEach((b, i) => {
    if (current.length > 0 && b.bottom - start > height) {
      sheets.push(current);
      current = [];
    }
    if (current.length === 0) start = b.top;
    current.push(i);
  });
  if (current.length) sheets.push(current);
  return sheets;
}

const PX_PER_IN = 96;

/** Waits until the pictures under `el` are loaded (or failed), at most `ms`. */
async function imagesLoaded(el: HTMLElement, ms = 3000): Promise<void> {
  const imgs = Array.from(el.querySelectorAll("img")).filter((i) => !i.complete);
  if (imgs.length === 0) return;
  await Promise.race([
    Promise.all(imgs.map((i) => new Promise<void>((r) => ((i.onload = () => r()), (i.onerror = () => r()))))),
    new Promise<void>((r) => setTimeout(r, ms)),
  ]);
}

/** Lays out `pages` and returns the print document. */
export async function buildNotesPrintDoc(pages: readonly PrintPage[], o: NotesPrintOptions, doc: Document = document): Promise<PrintDoc> {
  const size = paperSize(o.paper, o.orientation);
  const m = MARGIN_PRESETS[o.margins];
  const widthPx = (size.w - m.left - m.right) * PX_PER_IN;
  const heightPx = (size.h - m.top - m.bottom) * PX_PER_IN;
  const host = doc.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = `position:fixed;left:-10000px;top:0;width:${widthPx}px;visibility:hidden;pointer-events:none;`;
  host.innerHTML = `<style>${NOTES_PRINT_CSS}</style>`;
  doc.body.appendChild(host);
  const sheets: string[] = [];
  try {
    for (const p of pages) {
      const box = doc.createElement("div");
      box.className = "np";
      const title = doc.createElement("h1");
      title.className = "np-title";
      title.textContent = p.title;
      const date = doc.createElement("p");
      date.className = "np-date";
      date.textContent = p.date;
      // The header and the content's blocks are the units that are packed.
      const content = p.content;
      content.classList.add("notes-content");
      box.append(title, date, content);
      host.appendChild(box);
      await imagesLoaded(box);
      const units: HTMLElement[] = [title, date, ...(Array.from(content.children) as HTMLElement[])];
      const base = box.getBoundingClientRect().top;
      const boxes = units.map((u) => {
        const r = u.getBoundingClientRect();
        const cs = doc.defaultView?.getComputedStyle(u);
        const mb = cs ? parseFloat(cs.marginBottom) || 0 : 0;
        return { top: r.top - base, bottom: r.bottom - base + mb };
      });
      for (const group of paginate(boxes, heightPx)) {
        const header = group.filter((i) => i < 2).map((i) => units[i]!.outerHTML).join("");
        const blocks = group.filter((i) => i >= 2).map((i) => units[i]!.outerHTML).join("");
        sheets.push(
          `<div class="np-sheet" style="padding:${m.top}in ${m.right}in ${m.bottom}in ${m.left}in"><div class="np">${header}<div class="notes-content">${blocks}</div></div></div>`,
        );
      }
      box.remove();
    }
  } finally {
    host.remove();
  }
  return { widthIn: size.w, heightIn: size.h, css: NOTES_PRINT_CSS, pages: sheets };
}
