// Print layout: approximate page breaks drawn as gaps between pages.
//
// The browser lays the document out as one long column; after a document
// change the plugin measures the top-level blocks (their natural position,
// i.e. without the gaps it inserted itself), packs them into pages of the
// text height of the `PageSetup` (a block that does not fit starts a new
// page; a manual page break ends its page) and inserts a widget before
// every block that starts a page. The widget covers the rest of the page,
// the bottom margin with the greyed footer, the grey gap and the next
// page's top margin with the greyed header. Blocks are not split (a list
// or a table longer than a page overflows it), hence "approximate".

import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import type { PageSetup } from "../generated/PageSetup";
import { TWIPS_PER_PX } from "../sync/schema";

/** Height of the grey band between two pages (CSS px). */
export const PAGE_GAP_PX = 16;

/** One measured top-level block: natural top/bottom (px) and a forced break after it. */
export interface BlockBox {
  top: number;
  bottom: number;
  breakAfter: boolean;
}

/** A page break before block `index`; `fill` = unused text height left on the previous page. */
export interface PageBreak {
  index: number;
  fill: number;
}

/**
 * Packs blocks into pages of `pageHeight` px of text. Returns the breaks
 * (before which block a new page starts) and the unused height of the last
 * page.
 */
export function computeBreaks(blocks: BlockBox[], pageHeight: number): { breaks: PageBreak[]; lastFill: number } {
  const breaks: PageBreak[] = [];
  if (pageHeight <= 0 || !blocks.length) return { breaks, lastFill: Math.max(0, pageHeight) };
  let pageStart = Math.min(0, blocks[0]!.top);
  let forced = blocks[0]!.breakAfter;
  for (let i = 1; i < blocks.length; i++) {
    const b = blocks[i]!;
    if (forced || (b.bottom - pageStart > pageHeight && b.top > pageStart)) {
      breaks.push({ index: i, fill: Math.max(0, pageStart + pageHeight - blocks[i - 1]!.bottom) });
      pageStart = b.top;
    }
    forced = b.breakAfter;
  }
  const last = blocks[blocks.length - 1]!;
  return { breaks, lastFill: Math.max(0, pageStart + pageHeight - last.bottom) };
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

export function pageGeometry(page: PageSetup | null): PageGeometry {
  const px = (t: number | undefined, d: number) => (t === undefined ? d : t / TWIPS_PER_PX);
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

/** Header/footer text of page `n` (`{PAGE}` → `n`). */
export function headerFooterText(text: string | null | undefined, n: number): string {
  return (text ?? "").split("{PAGE}").join(String(n));
}

export interface PaginationOptions {
  /** Print layout on; off = draft (no pages). */
  enabled: () => boolean;
  page: () => PageSetup | null;
  /** Double-click on a header or footer. */
  onEditHeaderFooter?: (which: "header" | "footer") => void;
  /** Called after the page count changed. */
  onPages?: (pages: number) => void;
}

interface PaginationState {
  breaks: PageBreak[];
  lastFill: number;
  decorations: DecorationSet;
}

export const paginationKey = new PluginKey<PaginationState>("rusuitePagination");

const hasPageBreak = (n: PMNode): boolean => {
  let found = false;
  n.descendants((c) => {
    if (found) return false;
    if (c.type.name === "pageBreak") found = true;
    return !found;
  });
  return found;
};

function hfBox(cls: string, text: string, style: string, which: "header" | "footer"): HTMLElement {
  const el = document.createElement("div");
  el.className = `page-hf ${cls}`;
  el.dataset.hf = which;
  el.setAttribute("style", style);
  el.textContent = text;
  el.title = `Double-click to edit the ${which}`;
  return el;
}

/** The gap widget before page `next` (1-based number of the page that starts). */
function gapWidget(fill: number, next: number, geo: PageGeometry, page: PageSetup | null): HTMLElement {
  const el = document.createElement("div");
  el.className = "page-gap";
  el.contentEditable = "false";
  el.dataset.page = String(next);
  const h = fill + geo.bottom + PAGE_GAP_PX + geo.top;
  el.setAttribute("style", `height:${h}px;margin-left:-${geo.left + 8}px;margin-right:-${geo.right + 8}px;`);
  const band = document.createElement("div");
  band.className = "page-gap-band";
  band.setAttribute("style", `top:${fill + geo.bottom}px;height:${PAGE_GAP_PX}px;`);
  el.append(
    hfBox("page-footer", headerFooterText(page?.footerText, next - 1), `bottom:${geo.footer + PAGE_GAP_PX + geo.top}px;left:${geo.left + 8}px;right:${geo.right + 8}px;`, "footer"),
    band,
    hfBox("page-header", headerFooterText(page?.headerText, next), `top:${fill + geo.bottom + PAGE_GAP_PX + geo.header}px;left:${geo.left + 8}px;right:${geo.right + 8}px;`, "header"),
  );
  return el;
}

function endWidget(fill: number): HTMLElement {
  const el = document.createElement("div");
  el.className = "page-end";
  el.contentEditable = "false";
  el.setAttribute("style", `height:${fill}px`);
  return el;
}

/** Positions of the top-level nodes. */
function topPositions(doc: PMNode): number[] {
  const out: number[] = [];
  doc.forEach((_n, offset) => out.push(offset));
  return out;
}

function buildDecorations(doc: PMNode, breaks: PageBreak[], lastFill: number, opts: PaginationOptions): DecorationSet {
  const page = opts.page();
  const geo = pageGeometry(page);
  const pos = topPositions(doc);
  const key = `${page?.headerText ?? ""}|${page?.footerText ?? ""}|${geo.top}|${geo.bottom}|${geo.left}|${geo.right}`;
  const decos = breaks
    .filter((b) => b.index < pos.length)
    .map((b, k) =>
      Decoration.widget(pos[b.index]!, () => gapWidget(b.fill, k + 2, geo, page), {
        side: -1,
        key: `gap:${k}:${Math.round(b.fill)}:${key}`,
        ignoreSelection: true,
        stopEvent: () => false,
      }),
    );
  decos.push(Decoration.widget(doc.content.size, () => endWidget(lastFill), { side: 1, key: `end:${Math.round(lastFill)}`, ignoreSelection: true }));
  return DecorationSet.create(doc, decos);
}

/** Measures the natural boxes of the top-level blocks (without the gap widgets). */
export function measureBlocks(view: EditorView): BlockBox[] {
  const out: BlockBox[] = [];
  const dom = view.dom as HTMLElement;
  const nodes: PMNode[] = [];
  view.state.doc.forEach((n) => nodes.push(n));
  let removed = 0;
  let k = 0;
  for (const child of Array.from(dom.children) as HTMLElement[]) {
    if (child.classList.contains("page-gap") || child.classList.contains("page-end")) {
      removed += child.offsetHeight;
      continue;
    }
    if (k >= nodes.length) break;
    const top = child.offsetTop - removed;
    out.push({ top, bottom: top + child.offsetHeight, breakAfter: hasPageBreak(nodes[k]!) });
    k++;
  }
  return out;
}

const sameBreaks = (a: PageBreak[], b: PageBreak[]) =>
  a.length === b.length && a.every((x, i) => x.index === b[i]!.index && Math.abs(x.fill - b[i]!.fill) < 1);

/** The pagination plugin; `remeasure(view)` forces a new layout (page setup or view changes). */
export function paginationPlugin(opts: PaginationOptions): Plugin<PaginationState> {
  return new Plugin<PaginationState>({
    key: paginationKey,
    state: {
      init: () => ({ breaks: [], lastFill: 0, decorations: DecorationSet.empty }),
      apply(tr, prev, _old, state) {
        const meta = tr.getMeta(paginationKey) as { breaks: PageBreak[]; lastFill: number } | "clear" | undefined;
        if (meta === "clear") return { breaks: [], lastFill: 0, decorations: DecorationSet.empty };
        if (meta) return { ...meta, decorations: buildDecorations(state.doc, meta.breaks, meta.lastFill, opts) };
        return tr.docChanged ? { ...prev, decorations: prev.decorations.map(tr.mapping, tr.doc) } : prev;
      },
    },
    props: {
      decorations: (state) => paginationKey.getState(state)?.decorations ?? null,
      handleDOMEvents: {
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
      const run = () => {
        timer = undefined;
        if (!view.dom.isConnected) return;
        const st = paginationKey.getState(view.state);
        if (!opts.enabled()) {
          if (st && st.decorations !== DecorationSet.empty) view.dispatch(view.state.tr.setMeta(paginationKey, "clear").setMeta("addToHistory", false));
          return;
        }
        const geo = pageGeometry(opts.page());
        const { breaks, lastFill } = computeBreaks(measureBlocks(view), geo.height - geo.top - geo.bottom);
        if (st && sameBreaks(st.breaks, breaks) && Math.abs(st.lastFill - lastFill) < 1 && st.decorations !== DecorationSet.empty && !force) return;
        force = false;
        view.dispatch(view.state.tr.setMeta(paginationKey, { breaks, lastFill }).setMeta("addToHistory", false));
        if (breaks.length + 1 !== pages) {
          pages = breaks.length + 1;
          opts.onPages?.(pages);
        }
      };
      let force = true;
      const schedule = (delay = 120) => {
        clearTimeout(timer);
        timer = setTimeout(run, delay);
      };
      schedule(0);
      const onRemeasure = () => {
        force = true;
        schedule(0);
      };
      view.dom.addEventListener("rusuite-remeasure", onRemeasure);
      return {
        update(v, prevState) {
          if (v.state.doc !== prevState.doc) schedule();
        },
        destroy() {
          clearTimeout(timer);
          view.dom.removeEventListener("rusuite-remeasure", onRemeasure);
        },
      };
    },
  });
}

/** Asks the pagination plugin of `view` to lay the pages out again (page setup or view mode changed). */
export function remeasurePages(view: EditorView | null | undefined): void {
  view?.dom.dispatchEvent(new Event("rusuite-remeasure"));
}

export function pageCount(view: EditorView): number {
  return (paginationKey.getState(view.state)?.breaks.length ?? 0) + 1;
}
