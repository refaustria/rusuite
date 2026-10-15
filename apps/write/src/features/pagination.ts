// Print layout: approximate page breaks drawn as gaps between pages.
//
// The browser lays the document out as one long column; after a document
// change the plugin measures the top-level blocks (their natural position,
// i.e. without the gaps it inserted itself), packs them into pages of the
// text height of their section's `PageSetup` (a block that does not fit
// starts a new page; a manual page break and a section break other than
// "continuous" end their page; footnotes referenced on a page take room at
// its bottom) and inserts a widget before every block that starts a page.
// The widget covers the rest of the page with the page's footnotes, the
// bottom margin with the greyed footer, the grey gap and the next page's
// top margin with the greyed header. Headers, footers and page numbers
// follow the sections (first-page / even headers, numbering restarts and
// formats). Blocks are not split (a list or a table longer than a page
// overflows it), hence "approximate".

import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import type { Block } from "../generated/Block";
import type { HeaderFooterSet } from "../generated/HeaderFooterSet";
import type { PageSetup } from "../generated/PageSetup";
import type { Section } from "../generated/Section";
import { notesNode } from "../sync/fromPM";
import { TWIPS_PER_PX } from "../sync/schema";
import { t } from "../i18n";
import { formatNumber, noteNumbers } from "./numbers";

/** Height of the grey band between two pages (CSS px). */
export const PAGE_GAP_PX = 16;

/** One measured top-level block: natural top/bottom (px), a forced break after it, the height of the footnotes it references. */
export interface BlockBox {
  top: number;
  bottom: number;
  breakAfter: boolean;
  notes?: number;
}

/** A page break before block `index`; `fill` = unused text height left on the previous page. */
export interface PageBreak {
  index: number;
  fill: number;
}

/**
 * Packs blocks into pages. `pageHeight` is the text height of every page,
 * or of the page starting at a given block. Returns the breaks (before
 * which block a new page starts) and the unused height of the last page.
 */
export function computeBreaks(blocks: BlockBox[], pageHeight: number | ((startIndex: number) => number)): { breaks: PageBreak[]; lastFill: number } {
  const heightAt = typeof pageHeight === "number" ? () => pageHeight : pageHeight;
  const breaks: PageBreak[] = [];
  if (!blocks.length) return { breaks, lastFill: Math.max(0, heightAt(0)) };
  let cap = heightAt(0);
  if (cap <= 0) return { breaks, lastFill: 0 };
  let pageStart = Math.min(0, blocks[0]!.top);
  let notes = blocks[0]!.notes ?? 0;
  let forced = blocks[0]!.breakAfter;
  for (let i = 1; i < blocks.length; i++) {
    const b = blocks[i]!;
    const n = b.notes ?? 0;
    if (forced || (b.bottom - pageStart + notes + n > cap && b.top > pageStart)) {
      breaks.push({ index: i, fill: Math.max(0, pageStart + cap - blocks[i - 1]!.bottom) });
      pageStart = b.top;
      cap = Math.max(1, heightAt(i));
      notes = 0;
    }
    notes += n;
    forced = b.breakAfter;
  }
  const last = blocks[blocks.length - 1]!;
  return { breaks, lastFill: Math.max(0, pageStart + cap - last.bottom) };
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

// ----- the plugin ------------------------------------------------------------------

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
  onLayout?: (layout: PageLayout) => void;
}

/** The computed layout: pages, the page of each top-level node. */
export interface PageLayout {
  pages: PageInfo[];
  /** Page index (0-based) per top-level node. */
  nodePage: number[];
  /** Header of the first page, footer of the last page (the frame draws them). */
  firstHeader: string;
  lastFooter: string;
}

interface PaginationState {
  breaks: PageBreak[];
  lastFill: number;
  layout: PageLayout | null;
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

/** Footnote ids referenced in `n`, in order. */
function footRefs(n: PMNode): number[] {
  const out: number[] = [];
  n.descendants((c) => {
    if (c.type.name === "noteRef" && c.attrs.kind !== "end") out.push(c.attrs.id as number);
    return true;
  });
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

function hfBox(cls: string, text: string, style: string, which: "header" | "footer"): HTMLElement {
  const el = document.createElement("div");
  el.className = `page-hf ${cls}`;
  el.dataset.hf = which;
  el.setAttribute("style", style);
  el.textContent = text;
  el.title = t(`write.hfTip.${which}`);
  return el;
}

type PageNote = { id: number; n: string; text: string };

/** One page's footnotes (number + text) as the box at the bottom of its text area. */
function notesBox(notes: PageNote[], style: string): HTMLElement | null {
  if (!notes.length) return null;
  const el = document.createElement("div");
  el.className = "page-notes";
  el.setAttribute("style", style);
  for (const x of notes) {
    const row = document.createElement("div");
    row.className = "page-note";
    row.dataset.noteId = String(x.id);
    const sup = document.createElement("sup");
    sup.textContent = x.n;
    row.append(sup, document.createTextNode(` ${x.text.trim()}`));
    el.appendChild(row);
  }
  return el;
}

interface GapSpec {
  fill: number;
  /** Geometry of the page that ends and of the page that starts. */
  end: PageGeometry;
  start: PageGeometry;
  /** Horizontal geometry of the frame. */
  frame: PageGeometry;
  footer: string;
  header: string;
  /** 1-based number of the page that starts. */
  next: number;
  notes: PageNote[];
}

/** The gap widget before a page. */
function gapWidget(g: GapSpec): HTMLElement {
  const el = document.createElement("div");
  el.className = "page-gap";
  el.contentEditable = "false";
  el.dataset.page = String(g.next);
  const h = g.fill + g.end.bottom + PAGE_GAP_PX + g.start.top;
  el.setAttribute("style", `height:${h}px;margin-left:-${g.frame.left + 8}px;margin-right:-${g.frame.right + 8}px;`);
  const band = document.createElement("div");
  band.className = "page-gap-band";
  band.setAttribute("style", `top:${g.fill + g.end.bottom}px;height:${PAGE_GAP_PX}px;`);
  const side = `left:${g.frame.left + 8}px;right:${g.frame.right + 8}px;`;
  const notes = notesBox(g.notes, `bottom:${h - g.fill}px;${side}`);
  el.append(
    ...(notes ? [notes] : []),
    hfBox("page-footer", g.footer, `bottom:${g.end.footer + PAGE_GAP_PX + g.start.top}px;${side}`, "footer"),
    band,
    hfBox("page-header", g.header, `top:${g.fill + g.end.bottom + PAGE_GAP_PX + g.start.header}px;${side}`, "header"),
  );
  return el;
}

function endWidget(fill: number, notes: PageNote[]): HTMLElement {
  const el = document.createElement("div");
  el.className = "page-end";
  el.contentEditable = "false";
  el.setAttribute("style", `height:${fill}px`);
  const box = notesBox(notes, "bottom:0;left:0;right:0;");
  if (box) el.appendChild(box);
  return el;
}

/** Positions of the top-level nodes. */
function topPositions(doc: PMNode): number[] {
  const out: number[] = [];
  doc.forEach((_n, offset) => out.push(offset));
  return out;
}

/** Text of each footnote (from the notes area). */
function footnoteTexts(doc: PMNode): Map<number, string> {
  const out = new Map<number, string>();
  notesNode(doc)?.forEach((n) => {
    if (n.attrs.kind !== "end") out.set(n.attrs.id as number, n.textContent);
  });
  return out;
}

/** The layout of the breaks: page infos, the page of every node, frame header/footer texts. */
export function computeLayout(doc: PMNode, breaks: PageBreak[], sections: Section[], page: PageSetup | null): PageLayout {
  const count = doc.childCount;
  const { section } = sectionLayout(doc, sections);
  const starts = [0, ...breaks.map((b) => b.index)];
  const pages = pageInfos(starts, (i) => section[i] ?? 0, sections);
  const nodePage: number[] = [];
  let k = 0;
  for (let i = 0; i < count; i++) {
    while (k + 1 < starts.length && starts[k + 1]! <= i) k++;
    nodePage.push(k);
  }
  const total = pages.length;
  return {
    pages,
    nodePage,
    firstHeader: pageHfText(pages[0]!, total, false, sections, page),
    lastFooter: pageHfText(pages[total - 1]!, total, true, sections, page),
  };
}

/** Footnotes per page (numbered like their references), from the layout. */
export function footnotesPerPage(doc: PMNode, layout: PageLayout): PageNote[][] {
  const numbers = noteNumbers(doc);
  const texts = footnoteTexts(doc);
  const out: PageNote[][] = layout.pages.map(() => []);
  const seen = new Set<number>();
  doc.forEach((n, _o, i) => {
    if (n.type.name === "notes") return;
    for (const id of footRefs(n)) {
      if (seen.has(id) || !texts.has(id)) continue;
      seen.add(id);
      out[layout.nodePage[i] ?? 0]?.push({ id, n: numbers.get(id) ?? "", text: texts.get(id)! });
    }
  });
  return out;
}

function buildDecorations(doc: PMNode, breaks: PageBreak[], lastFill: number, layout: PageLayout, opts: PaginationOptions): DecorationSet {
  const page = opts.page();
  const sections = opts.sections?.() ?? [];
  const geoOf = (sec: number) => pageGeometry(sections[sec]?.page ?? page);
  const frame = geoOf(0);
  const pos = topPositions(doc);
  const total = layout.pages.length;
  const pageNotes = footnotesPerPage(doc, layout);
  const noteKey = (ns: PageNote[] | undefined) => (ns ?? []).map((x) => `${x.n}${x.text}`).join("|");
  const decos = breaks
    .filter((b) => b.index < pos.length)
    .map((b, k) => {
      const ending = layout.pages[k]!;
      const starting = layout.pages[k + 1]!;
      const spec: GapSpec = {
        fill: b.fill,
        end: geoOf(ending.section),
        start: geoOf(starting.section),
        frame,
        footer: pageHfText(ending, total, true, sections, page),
        header: pageHfText(starting, total, false, sections, page),
        next: k + 2,
        notes: pageNotes[k] ?? [],
      };
      const key = `gap:${k}:${Math.round(b.fill)}:${spec.footer}|${spec.header}|${spec.end.bottom}|${spec.start.top}|${noteKey(spec.notes)}`;
      return Decoration.widget(pos[b.index]!, () => gapWidget(spec), { side: -1, key, ignoreSelection: true, stopEvent: () => false });
    });
  const lastNotes = pageNotes[total - 1] ?? [];
  decos.push(
    Decoration.widget(doc.content.size, () => endWidget(lastFill, lastNotes), {
      side: 1,
      key: `end:${Math.round(lastFill)}:${noteKey(lastNotes)}`,
      ignoreSelection: true,
    }),
  );
  return DecorationSet.create(doc, decos);
}

/** Measures the natural boxes of the top-level blocks (without the gap widgets) and the footnote room they need. */
export function measureBlocks(view: EditorView, sections: Section[] = []): BlockBox[] {
  const out: BlockBox[] = [];
  const dom = view.dom as HTMLElement;
  const nodes: PMNode[] = [];
  view.state.doc.forEach((n) => nodes.push(n));
  const { breakAfter } = sectionLayout(view.state.doc, sections);
  // Footnote heights as rendered in the notes area.
  const noteHeight = new Map<number, number>();
  dom.querySelectorAll<HTMLElement>(".notes-area .note[data-note-kind='foot']").forEach((el) => noteHeight.set(Number(el.dataset.noteId), el.offsetHeight));
  let removed = 0;
  let k = 0;
  for (const child of Array.from(dom.children) as HTMLElement[]) {
    if (child.classList.contains("page-gap") || child.classList.contains("page-end")) {
      removed += child.offsetHeight;
      continue;
    }
    if (k >= nodes.length) break;
    const top = child.offsetTop - removed;
    const node = nodes[k]!;
    const notes = node.type.name === "notes" ? 0 : footRefs(node).reduce((s, id) => s + (noteHeight.get(id) ?? 0), 0);
    out.push({ top, bottom: top + child.offsetHeight, breakAfter: hasPageBreak(node) || breakAfter[k] === true, notes });
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
      init: () => ({ breaks: [], lastFill: 0, layout: null, decorations: DecorationSet.empty }),
      apply(tr, prev, _old, state) {
        const meta = tr.getMeta(paginationKey) as { breaks: PageBreak[]; lastFill: number; layout: PageLayout } | "clear" | undefined;
        if (meta === "clear") return { breaks: [], lastFill: 0, layout: null, decorations: DecorationSet.empty };
        if (meta) return { ...meta, decorations: buildDecorations(state.doc, meta.breaks, meta.lastFill, meta.layout, opts) };
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
        const sections = opts.sections?.() ?? [];
        const page = opts.page();
        const { section } = sectionLayout(view.state.doc, sections);
        const heightAt = (i: number) => {
          const g = pageGeometry(sections[section[i] ?? 0]?.page ?? page);
          return g.height - g.top - g.bottom;
        };
        const { breaks, lastFill } = computeBreaks(measureBlocks(view, sections), heightAt);
        const layout = computeLayout(view.state.doc, breaks, sections, page);
        const same = st && sameBreaks(st.breaks, breaks) && Math.abs(st.lastFill - lastFill) < 1 && st.decorations !== DecorationSet.empty;
        if (same && !force && JSON.stringify(st.layout) === JSON.stringify(layout)) return;
        force = false;
        view.dispatch(view.state.tr.setMeta(paginationKey, { breaks, lastFill, layout }).setMeta("addToHistory", false));
        opts.onLayout?.(layout);
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

/** The current layout of `state` (null in draft view or before the first layout). */
export function currentLayout(state: EditorState): PageLayout | null {
  return paginationKey.getState(state)?.layout ?? null;
}
