// The pagination engine of the print layout (docs/write-layout.md): a pure
// function from the measured flow (lines, table rows, atoms in natural px,
// i.e. as the browser lays the document out without page gaps) to pages.
// No DOM here: the editor, the print preview and the tests feed it.

/** Where a spacer goes when a page (or column) starts at a unit. */
export type Anchor =
  /** A widget before a top-level block (or a child of a columns box) at this PM position. */
  | { kind: "block"; pos: number }
  /** A widget inside a paragraph at the start of the line (PM position, resolved lazily). */
  | { kind: "inline"; pos: number | (() => number) }
  /** A widget at the start of every cell of a table row (PM positions inside the cells). */
  | { kind: "cells"; cells: number[] };

/** A line of a table cell (row splitting). */
export interface CellLine {
  top: number;
  bottom: number;
  /** Spacer position before this line (inside the cell). */
  at: Anchor;
}

export interface CellFlow {
  lines: CellLine[];
  /** Natural bottom of the cell's content. */
  bottom: number;
}

/** One unit of the flow: a line of a paragraph, a table row or an unbreakable block. */
export interface Unit {
  kind: "line" | "row" | "atom";
  /** Natural top / bottom (px from the top of the editor content; in a columns box: of its single-column flow). */
  top: number;
  bottom: number;
  /** Lines: the bottom of the glyphs (may hang below the line box). */
  ink?: number;
  /** The natural y a spacer before this unit pushes to the top of the body (a block's border top for its first line). */
  anchorTop: number;
  at: Anchor;
  /** Index into `Flow.blocks` (the element the unit belongs to, for fragments). */
  block: number;
  /** Paragraph index (`Flow.paras`) for lines, -1 otherwise. */
  para: number;
  /** Section index. */
  section: number;
  /** A page starts before this unit: `page` (page break, page break before, next-page section), `even` / `odd` (section starts on an even/odd page). */
  breakBefore?: "page" | "even" | "odd";
  /** A column break before this unit (in a columns box). */
  columnBreakBefore?: boolean;
  /** Footnote ids referenced on this unit. */
  notes?: number[];
  /** Table (`Flow.tables`) and row index of a row. */
  table?: number;
  row?: number;
  /** Rows: can not break across pages; the cells' lines (for splitting a row taller than a page). */
  cantSplit?: boolean;
  cells?: CellFlow[];
  /** Columns box (`Flow.regions`). */
  region?: number;
  /** The first unit of a block: the margin a widget before it must take back (the block's and the previous block's margins no longer collapse). */
  collapse?: number;
}

export interface Para {
  first: number;
  last: number;
  widow: boolean;
  keepLines: boolean;
  keepNext: boolean;
}

export interface TableFlow {
  first: number;
  last: number;
  /** Number of leading header rows (`repeat_header`) and their height. */
  headerRows: number;
  headerHeight: number;
  /** `Flow.blocks` index of the table. */
  block: number;
}

export interface RegionFlow {
  first: number;
  last: number;
  /** Column x offsets and widths (px, from the column box's left edge). */
  columns: { x: number; width: number }[];
  /** Natural top and bottom of the box in the editor flow (its rendered height, without spacers). */
  top: number;
  bottom: number;
}

/** A measured element fragments refer to: a top-level block, or a child of a columns box. */
export interface FlowBlock {
  /** Top-level index. */
  top: number;
  /** Index of the child in a columns box, -1 for a top-level block. */
  child: number;
  /** Natural (or virtual, in a columns box) top and bottom of the element. */
  y: number;
  bottom: number;
}

export interface FootnoteFlow {
  id: number;
  height: number;
  /** Line boundaries (px from the note's top), for continuing a long note on the next page. */
  lines: { top: number; bottom: number }[];
}

export interface Flow {
  units: Unit[];
  paras: Para[];
  tables: TableFlow[];
  regions: RegionFlow[];
  blocks: FlowBlock[];
  footnotes: Map<number, FootnoteFlow>;
  /** Natural bottom of the last block. */
  end: number;
}

/** The vertical page box (px): sheet height, the body's offset from the sheet top and its height. */
export interface PageBox {
  height: number;
  bodyTop: number;
  bodyHeight: number;
}

export interface PageSpec {
  /** The page's first unit. */
  start: number;
  section: number;
  /** First page of its section. */
  first: boolean;
  /** Numeric page number (restarts applied). */
  value: number;
  index: number;
}

export interface PaginateOptions {
  /** The page box of a page (header and footer heights decide the body). */
  pageBox: (p: PageSpec) => PageBox;
  /** Page numbering restart of a section (null: continue). */
  numberStart?: (section: number) => number | null | undefined;
  /** Grey gap between two sheets (px). */
  gap: number;
  /** Height reserved for the footnote separator above a page's footnotes. */
  noteSeparator?: number;
  /**
   * Incremental pagination: the previous result of a flow whose units
   * before `from` are unchanged; the walk resumes at the last page that was
   * decided by units before `from`.
   */
  resume?: { prev: PaginateResult; from: number };
}

/** A piece of a block on a page column: units `[from, to)` of block `block`, natural `top`/`bottom`, page-relative `y`. */
export interface Fragment {
  block: number;
  from: number;
  to: number;
  top: number;
  bottom: number;
  /** Top of the fragment on its sheet (px from the sheet top). */
  y: number;
}

export interface LayoutColumn {
  x: number;
  width: number;
  fragments: Fragment[];
}

/** A footnote (or a slice of a long one) on a page: px `[from, to)` of the note's height. */
export interface PageFootnote {
  id: number;
  from: number;
  to: number;
}

export interface LayoutPage extends PageSpec {
  box: PageBox;
  /** Top of the sheet in the frame (px; sheets stacked with the gap). */
  sheetTop: number;
  /** First and last+1 unit. */
  start: number;
  end: number;
  /** Frame y where the page's content ends (the fill below it is empty). */
  contentEnd: number;
  columns: LayoutColumn[];
  footnotes: PageFootnote[];
  /** Height of the footnote area including the separator (0 without notes). */
  notesHeight: number;
  /** A table header repeated at the top of the body: the table and the header's height. */
  repeat?: { table: number; height: number };
  /** Columns boxes on this page: frame top and height of each column set (for the separator line). */
  sets?: { region: number; top: number; height: number }[];
  /** The columns of the column sets: units `[start, end)` in column `col` of a set starting at frame y `top`. */
  regionColumns?: { region: number; col: number; start: number; end: number; top: number }[];
}

export interface Spacer {
  at: Anchor;
  height: number;
  /** `page` = a page gap; `span` = a page gap in a columns box (spans all columns); `column` = a zero-height column break. */
  kind: "page" | "span" | "column";
  /** The unit it precedes. */
  unit: number;
}

/** The walk's state when a page was started (for resuming an incremental pagination). */
export interface Checkpoint {
  shift: number;
  carry: PageFootnote[];
  spacers: number;
  /** The last unit the decision to start this page looked at; -1: not resumable (columns box, split row, notes). */
  decided: number;
}

export interface PaginateResult {
  /** Per page: the state it started with. */
  checkpoints: Checkpoint[];
  /** Frame y of every unit's top. */
  vtop: Float64Array;
  pages: LayoutPage[];
  spacers: Spacer[];
  /** Frame y of natural y 0 (the editor content's top = the first page's body top). */
  origin: number;
  /** Total frame height (all sheets and gaps). */
  height: number;
}

const EPS = 0.5;

/**
 * Lays the flow out on pages: line-granular breaks with widow/orphan
 * control, keep lines together, keep with next, page break before,
 * explicit breaks, tables split between rows with repeated header rows
 * (rows taller than a page split at cell line boundaries unless
 * `cantSplit`), footnotes reserved at the bottom of their reference's page
 * (long notes continue), and multi-column boxes filled column by column
 * (balanced on their last page).
 */
export function paginate(flow: Flow, o: PaginateOptions): PaginateResult {
  const units = flow.units;
  const sep = o.noteSeparator ?? 14;
  const pages: LayoutPage[] = [];
  const spacers: Spacer[] = [];
  let shift = 0;
  let origin = 0;
  /** Frame y of every placed unit's top. */
  const vtop = new Float64Array(units.length);
  const checkpoints: Checkpoint[] = [];
  /** The unit that decides the next page break (set by the walk before `breakAt`). */
  let deciding = -1;

  // ----- pages -----
  const newPage = (start: number, section: number): LayoutPage => {
    const prev = pages[pages.length - 1];
    const first = !prev || prev.section !== section;
    const restart = first ? o.numberStart?.(section) : null;
    const value = restart != null ? restart : prev ? prev.value + 1 : 1;
    const spec: PageSpec = { start, section, first, value, index: pages.length };
    const box = o.pageBox(spec);
    const sheetTop = prev ? prev.sheetTop + prev.box.height + o.gap : 0;
    const page: LayoutPage = { ...spec, box, sheetTop, start, end: start, contentEnd: sheetTop + box.bodyTop, columns: [], footnotes: [], notesHeight: 0 };
    checkpoints.push({ shift, carry: [...carry], spacers: spacers.length, decided: deciding });
    deciding = -1;
    pages.push(page);
    return page;
  };
  const bodyTop = (p: LayoutPage) => p.sheetTop + p.box.bodyTop;
  const bodyBottom = (p: LayoutPage) => bodyTop(p) + p.box.bodyHeight;
  const visual = (y: number) => origin + y + shift;

  // ----- footnotes -----
  /** Note slices waiting for the next page (continuations). */
  let carry: PageFootnote[] = [];
  const noteHeight = (id: number) => flow.footnotes.get(id)?.height ?? 0;
  const placedNotes = (p: LayoutPage) => new Set(p.footnotes.map((n) => n.id));
  const areaHeight = (notes: PageFootnote[]) => (notes.length ? sep + notes.reduce((s, n) => s + (n.to - n.from), 0) : 0);
  /** The page's notes plus the full notes of `ids` not yet on it. */
  const withNotes = (p: LayoutPage, ids: number[] | undefined): PageFootnote[] => {
    if (!ids?.length) return p.footnotes;
    const seen = placedNotes(p);
    const out = [...p.footnotes];
    for (const id of ids) {
      if (seen.has(id) || !flow.footnotes.has(id)) continue;
      seen.add(id);
      out.push({ id, from: 0, to: noteHeight(id) });
    }
    return out;
  };
  /** Cuts the last note at a line boundary so the area fits `room`; null when not even its first line fits. */
  const fitNotes = (notes: PageFootnote[], fixed: number, room: number): { placed: PageFootnote[]; rest: PageFootnote[] } | null => {
    if (areaHeight(notes) + fixed <= room + EPS) return { placed: notes, rest: [] };
    const placed: PageFootnote[] = [];
    for (let k = 0; k < notes.length; k++) {
      const n = notes[k]!;
      const before = areaHeight([...placed, { ...n, to: n.from }]) + fixed;
      const lines = flow.footnotes.get(n.id)?.lines ?? [];
      let cut = n.from;
      for (const l of lines) if (l.bottom > n.from + EPS && before + (l.bottom - n.from) <= room + EPS) cut = l.bottom;
      if (before + (n.to - n.from) <= room + EPS) {
        placed.push(n);
        continue;
      }
      if (cut <= n.from + EPS) return placed.length ? { placed, rest: notes.slice(k) } : null;
      placed.push({ ...n, to: cut });
      return { placed, rest: [{ ...n, from: cut }, ...notes.slice(k + 1)] };
    }
    return { placed, rest: [] };
  };
  const setNotes = (p: LayoutPage, notes: PageFootnote[]) => {
    p.footnotes = notes;
    p.notesHeight = areaHeight(notes);
  };

  // ----- page breaks -----
  let page = newPage(0, units[0]?.section ?? 0);
  origin = bodyTop(page);

  const startCarry = (p: LayoutPage) => {
    if (!carry.length) return;
    const fit = fitNotes(carry, 0, p.box.bodyHeight * 0.5) ?? { placed: carry.slice(0, 1), rest: carry.slice(1) };
    setNotes(p, fit.placed);
    carry = fit.rest;
  };

  /** Ends the current page before unit `b` and starts the next one (blank pages for even/odd section starts). */
  const breakAt = (b: number, kind: Spacer["kind"] = "page"): void => {
    const u = units[b]!;
    page.end = b;
    page.contentEnd = page.sheetTop + page.box.bodyTop;
    for (let k = page.start; k < b - 1; k++) page.contentEnd = Math.max(page.contentEnd, vtop[k]! + (units[k]!.bottom - units[k]!.top));
    if (b > page.start) page.contentEnd = Math.max(page.contentEnd, visual(Math.max(units[b - 1]!.bottom, units[b - 1]!.ink ?? 0)));
    let next = newPage(b, u.section);
    if ((u.breakBefore === "even" && next.value % 2 === 1) || (u.breakBefore === "odd" && next.value % 2 === 0)) {
      next.end = b;
      next = newPage(b, u.section);
    }
    page = next;
    startCarry(page);
    let extra = 0;
    if (u.kind === "row" && u.table != null) {
      const t = flow.tables[u.table]!;
      if (t.headerRows > 0 && (u.row ?? 0) >= t.headerRows) {
        page.repeat = { table: u.table, height: t.headerHeight };
        extra = t.headerHeight;
      }
    }
    const h = Math.max(0, bodyTop(page) + extra - visual(u.anchorTop));
    spacers.push({ at: u.at, height: h, kind, unit: b });
    shift += h;
  };

  const paraOf = (i: number): Para | null => {
    const u = units[i];
    return u && u.para >= 0 ? flow.paras[u.para]! : null;
  };

  /** The unit before which the page breaks when unit `i` does not fit (flow rules), > `start` or -1. */
  const chooseBreak = (i: number, start: number): number => {
    let b = i;
    const p = paraOf(i);
    if (p && i > p.first) {
      if (p.keepLines) b = p.first;
      else if (p.widow) {
        const n = p.last - p.first + 1;
        let k = i - p.first;
        if (n - k < 2) k = n - 2;
        if (k < 2) k = 0;
        b = p.first + k;
      }
    }
    // Header rows never stay alone at the bottom of a page.
    const u = units[b]!;
    if (u.kind === "row" && u.table != null) {
      const t = flow.tables[u.table]!;
      if ((u.row ?? 0) > 0 && (u.row ?? 0) <= t.headerRows) b = t.first;
    }
    // Keep with next: the paragraph before moves along (its last lines, all of it with keep lines together).
    for (let guard = 0; guard < 1000; guard++) {
      const prev = paraOf(b - 1);
      const cur = units[b]!;
      const startsBlock = cur.para < 0 ? cur.kind !== "row" || cur.row === 0 || units[b - 1]?.table !== cur.table : flow.paras[cur.para]!.first === b;
      if (!prev || !prev.keepNext || !startsBlock || b - 1 < start) break;
      const n = prev.last - prev.first + 1;
      let k = prev.keepLines ? 0 : n - 1;
      if (prev.widow && !prev.keepLines) {
        if (n - k < 2) k = n - 2;
        if (k < 2) k = 0;
      }
      const nb = prev.first + Math.max(0, k);
      if (nb <= start) break;
      b = nb;
    }
    return b > start ? b : -1;
  };

  // ----- one unit -----
  const place = (i: number, notes: PageFootnote[]) => {
    const u = units[i]!;
    vtop[i] = visual(u.top);
    setNotes(page, notes);
    page.end = i + 1;
    page.contentEnd = Math.max(page.contentEnd, visual(Math.max(u.bottom, u.ink ?? 0)));
  };

  /** Fits unit `i` (and its notes) on the current page: the notes to place, or null. */
  const fitUnit = (i: number, bottom: number): PageFootnote[] | null => {
    const u = units[i]!;
    const limit = bodyBottom(page);
    if (bottom > limit + EPS) return null;
    const notes = withNotes(page, u.notes);
    if (notes === page.footnotes) return bottom + page.notesHeight <= limit + EPS ? notes : null;
    const fit = fitNotes(notes, 0, limit - bottom);
    if (!fit) return null;
    if (fit.rest.length) carry = [...fit.rest, ...carry];
    return fit.placed;
  };

  /** A row taller than a page: its cells continue on the next pages at line boundaries. */
  const splitRow = (i: number) => {
    const u = units[i]!;
    const cells = u.cells ?? [];
    vtop[i] = visual(u.top);
    const cellShift = cells.map(() => shift);
    const next = cells.map(() => 0);
    setNotes(page, withNotes(page, u.notes));
    for (let guard = 0; guard < 500; guard++) {
      const limit = bodyBottom(page) - page.notesHeight;
      let advanced = false;
      cells.forEach((c, k) => {
        while (next[k]! < c.lines.length && origin + c.lines[next[k]!]!.bottom + cellShift[k]! <= limit + EPS) {
          next[k]!++;
          advanced = true;
        }
      });
      if (cells.every((c, k) => next[k]! >= c.lines.length)) break;
      if (!advanced) {
        // A line taller than the page: it stays (overflows).
        cells.forEach((c, k) => {
          if (next[k]! < c.lines.length) next[k]!++;
        });
        if (cells.every((c, k) => next[k]! >= c.lines.length)) break;
      }
      page.end = i + 1;
      page.contentEnd = limit;
      page = newPage(i, u.section);
      page.end = i + 1;
      startCarry(page);
      let extra = 0;
      if (u.table != null) {
        const t = flow.tables[u.table]!;
        if (t.headerRows > 0 && (u.row ?? 0) >= t.headerRows) {
          page.repeat = { table: u.table, height: t.headerHeight };
          extra = t.headerHeight;
        }
      }
      cells.forEach((c, k) => {
        const l = c.lines[next[k]!];
        if (!l) return;
        const h = Math.max(0, bodyTop(page) + extra - (origin + l.top + cellShift[k]!));
        spacers.push({ at: l.at, height: h, kind: "page", unit: i });
        cellShift[k]! += h;
      });
    }
    // The row ends below its tallest cell; what follows moves by the row's growth.
    const contentBottom = Math.max(...cells.map((c) => c.bottom), u.top);
    const pad = Math.max(0, u.bottom - contentBottom);
    const visualBottom = Math.max(...cells.map((c, k) => origin + c.bottom + cellShift[k]!), visual(u.top)) + pad;
    shift = visualBottom - origin - u.bottom;
    page.end = i + 1;
    page.contentEnd = Math.max(page.contentEnd, visualBottom);
  };

  // ----- columns boxes -----
  const layoutRegion = (r: number): number => {
    const reg = flow.regions[r]!;
    const n = Math.max(1, reg.columns.length);
    let j = reg.first;
    let setTop = visual(reg.top);
    // Fill columns of height `h` from unit `from`: the units of each column, honouring column breaks and widow control.
    const fill = (from: number, h: number, cols: number): { cols: [number, number][]; next: number } => {
      const out: [number, number][] = [];
      let k = from;
      for (let c = 0; c < cols && k <= reg.last; c++) {
        const start = k;
        const top = units[start]!.top;
        while (k <= reg.last && !(k > start && units[k]!.columnBreakBefore) && units[k]!.bottom - top <= h + EPS) k++;
        if (k === start) k++;
        if (k <= reg.last && !units[k]!.columnBreakBefore && k > start + 1) {
          const b = chooseBreak(k, start);
          if (b > start) k = b;
        }
        out.push([start, k]);
      }
      return { cols: out, next: k };
    };
    const notesOf = (from: number, to: number): number[] => {
      const ids: number[] = [];
      for (let k = from; k < to; k++) ids.push(...(units[k]!.notes ?? []));
      return ids;
    };
    const heightOf = (cols: [number, number][]) => Math.max(0, ...cols.map(([a, b]) => units[b - 1]!.bottom - units[a]!.top));
    for (let guard = 0; guard < 10000 && j <= reg.last; guard++) {
      // A forced page break before the set's first unit.
      if (units[j]!.breakBefore && j > page.start) {
        breakAt(j, "span");
        setTop = bodyTop(page);
      }
      let avail = bodyBottom(page) - page.notesHeight - setTop;
      if (avail < 12 && j > page.start) {
        breakAt(j, "span");
        setTop = bodyTop(page);
        avail = bodyBottom(page) - page.notesHeight - setTop;
      }
      let res = fill(j, avail, n);
      // Footnotes of the set shrink it (re-break, at most 3 times).
      for (let it = 0; it < 3; it++) {
        const area = areaHeight(withNotes(page, notesOf(j, res.next)));
        const room = bodyBottom(page) - area - setTop;
        if (room >= avail - EPS) break;
        avail = room;
        res = fill(j, avail, n);
      }
      let last = res.next > reg.last;
      if (last) {
        // The section's last page: balance the columns (the smallest height that still takes everything).
        let lo = 0;
        let hi = avail;
        for (let k = j; k <= reg.last; k++) lo = Math.max(lo, Math.min(avail, units[k]!.bottom - units[k]!.top));
        for (let it = 0; it < 24 && hi - lo > 0.5; it++) {
          const mid = (lo + hi) / 2;
          if (fill(j, mid, n).next > reg.last) hi = mid;
          else lo = mid;
        }
        res = fill(j, hi, n);
        last = res.next > reg.last;
      }
      const height = heightOf(res.cols);
      setNotes(page, withNotes(page, notesOf(j, res.next)));
      page.sets = [...(page.sets ?? []), { region: r, top: setTop, height }];
      res.cols.forEach(([a, b], c) => {
        if (c > 0 && !units[a]!.columnBreakBefore) spacers.push({ at: units[a]!.at, height: 0, kind: "column", unit: a });
        for (let k = a; k < b; k++) vtop[k] = setTop + (units[k]!.top - units[a]!.top);
        page.regionColumns = [...(page.regionColumns ?? []), { region: r, col: c, start: a, end: b, top: setTop }];
      });
      page.end = res.next;
      page.contentEnd = Math.max(page.contentEnd, setTop + height);
      const k = res.next;
      if (last || k > reg.last) {
        shift = setTop + height - origin - reg.bottom;
        return reg.last + 1;
      }
      // The next set starts on the next page; the spacer spans all columns.
      const u = units[k]!;
      page.end = k;
      page = newPage(k, u.section);
      startCarry(page);
      spacers.push({ at: u.at, height: Math.max(0, bodyTop(page) - (setTop + height)), kind: "span", unit: k });
      setTop = bodyTop(page);
      j = k;
    }
    shift = setTop - origin - reg.bottom;
    return reg.last + 1;
  };

  // ----- the walk -----
  let i = 0;
  let rebreaks = 0;
  const r = o.resume;
  if (r && r.prev.vtop.length) {
    let k = -1;
    for (let p = r.prev.checkpoints.length - 1; p >= 1; p--) {
      const cp = r.prev.checkpoints[p]!;
      if (cp.decided >= 0 && cp.decided < r.from && r.prev.pages[p]!.start < units.length) {
        k = p;
        break;
      }
    }
    if (k >= 1) {
      pages.length = 0;
      checkpoints.length = 0;
      for (let p = 0; p < k; p++) {
        pages.push({ ...r.prev.pages[p]!, columns: [] });
        checkpoints.push(r.prev.checkpoints[p]!);
      }
      const cp = r.prev.checkpoints[k]!;
      spacers.push(...r.prev.spacers.slice(0, cp.spacers));
      const start = r.prev.pages[k]!.start;
      vtop.set(r.prev.vtop.subarray(0, Math.min(start, r.prev.vtop.length, vtop.length)));
      shift = cp.shift;
      carry = [...cp.carry];
      page = pages[k - 1]!;
      deciding = cp.decided;
      breakAt(start);
      i = start;
    }
  }
  while (i < units.length) {
    const u = units[i]!;
    if (u.region != null && flow.regions[u.region]!.first === i) {
      i = layoutRegion(u.region);
      continue;
    }
    const atStart = i === page.start || (pages.length === 1 && i === 0);
    if (!atStart && u.breakBefore) {
      deciding = i;
      breakAt(i);
      continue;
    }
    const notes = fitUnit(i, visual(u.bottom));
    if (notes) {
      place(i, notes);
      rebreaks = 0;
      i++;
      continue;
    }
    if (atStart) {
      const tall = visual(u.bottom) - visual(u.anchorTop) > page.box.bodyHeight - (page.repeat?.height ?? 0) + EPS;
      if (u.kind === "row" && !u.cantSplit && tall && u.cells?.length) splitRow(i);
      else place(i, withNotes(page, u.notes));
      i++;
      continue;
    }
    let b = chooseBreak(i, page.start);
    if (b < 0) b = i;
    if (b < i) {
      // Lines moving on take their notes along.
      const keep: number[] = [];
      for (let k = page.start; k < b; k++) keep.push(...(units[k]!.notes ?? []));
      const ids = new Set(keep);
      setNotes(page, page.footnotes.filter((x) => ids.has(x.id) || x.from > 0));
      carry = carry.filter((x) => ids.has(x.id));
    }
    if (++rebreaks > 3 && b < i) b = i;
    deciding = i;
    breakAt(b);
    i = b;
  }
  page.end = units.length;
  if (carry.length) {
    // Notes still continuing after the last unit get pages of their own.
    for (let guard = 0; guard < 100 && carry.length; guard++) {
      const prev = page;
      page = newPage(units.length, prev.section);
      startCarry(page);
    }
  }
  for (const p of pages) p.columns = columnsOf(flow, p, vtop);
  const lastPage = pages[pages.length - 1]!;
  return { pages, spacers, origin, height: lastPage.sheetTop + lastPage.box.height, checkpoints, vtop };
}

/** The fragments of a page: per column, the consecutive units of each block. */
function columnsOf(flow: Flow, p: LayoutPage, vtop: Float64Array): LayoutColumn[] {
  const units = flow.units;
  const cols: LayoutColumn[] = [];
  let col: LayoutColumn | null = null;
  let key = "";
  let frag: Fragment | null = null;
  for (let k = p.start; k < p.end; k++) {
    const u = units[k]!;
    const rc = u.region != null ? p.regionColumns?.find((c) => c.region === u.region && c.start <= k && k < c.end) : undefined;
    const reg = u.region != null ? flow.regions[u.region] : undefined;
    const ck = rc ? `r${rc.region}:${rc.start}` : "main";
    if (!col || ck !== key) {
      const c = rc && reg ? reg.columns[rc.col] : undefined;
      col = { x: c?.x ?? 0, width: c?.width ?? 0, fragments: [] };
      cols.push(col);
      key = ck;
      frag = null;
    }
    if (!frag || frag.block !== u.block) {
      frag = { block: u.block, from: k, to: k + 1, top: u.top, bottom: u.bottom, y: vtop[k]! - p.sheetTop };
      col.fragments.push(frag);
    } else {
      frag.to = k + 1;
      frag.bottom = u.bottom;
    }
  }
  return cols.length ? cols : [{ x: 0, width: 0, fragments: [] }];
}

/** Index of the page holding unit `unit` (binary search over the page starts). */
export function pageOfUnit(pages: readonly LayoutPage[], unit: number): number {
  let lo = 0;
  let hi = pages.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (pages[mid]!.start <= unit && pages[mid]!.end > pages[mid]!.start) lo = mid;
    else if (pages[mid]!.start <= unit) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Merges client rects of a paragraph's inline content into line boxes (DOM order; a rect overlapping the current line by half its height joins it). */
export function mergeLineRects(rects: readonly { top: number; bottom: number }[]): { top: number; bottom: number; first: number }[] {
  const lines: { top: number; bottom: number; first: number }[] = [];
  rects.forEach((r, k) => {
    if (r.bottom - r.top <= 0) return;
    const cur = lines[lines.length - 1];
    if (cur) {
      const overlap = Math.min(cur.bottom, r.bottom) - Math.max(cur.top, r.top);
      if (overlap >= 0.5 * Math.min(cur.bottom - cur.top, r.bottom - r.top)) {
        cur.top = Math.min(cur.top, r.top);
        cur.bottom = Math.max(cur.bottom, r.bottom);
        return;
      }
    }
    lines.push({ top: r.top, bottom: r.bottom, first: k });
  });
  return lines;
}

/**
 * Line slots from glyph line boxes: the boundary between two lines is the
 * middle between the first one's bottom and the next one's top (the line
 * box edge for uniform line heights); the first starts at `contentTop`, the
 * last ends at `contentBottom`.
 */
export function lineSlots(lines: readonly { top: number; bottom: number }[], contentTop: number, contentBottom: number): { top: number; bottom: number }[] {
  const out: { top: number; bottom: number }[] = [];
  for (let k = 0; k < lines.length; k++) {
    const top = k === 0 ? Math.min(contentTop, lines[0]!.top) : out[k - 1]!.bottom;
    const next = lines[k + 1];
    const bottom = next ? (lines[k]!.bottom + next.top) / 2 : Math.max(contentBottom, top);
    out.push({ top, bottom: Math.max(top, bottom) });
  }
  return out;
}

/** CSS margin collapsing of two adjoining margins. */
export function collapseMargins(a: number, b: number): number {
  const pos = Math.max(0, a, b);
  const neg = Math.min(0, a, b);
  return pos + neg;
}

const anchorKey = (a: Anchor): string => (a.kind === "cells" ? `c${a.cells.join(",")}` : a.kind === "block" ? `b${a.pos}` : typeof a.pos === "number" ? `i${a.pos}` : "f");

/**
 * The first unit of `next` that differs from `prev` (geometry, flow options,
 * notes, anchors): where an incremental pagination must start again.
 * `next.units.length` when nothing changed; 0 when footnotes changed.
 */
export function firstChange(prev: Flow, next: Flow): number {
  if (prev.footnotes.size !== next.footnotes.size) return 0;
  for (const [id, f] of next.footnotes) if (Math.abs((prev.footnotes.get(id)?.height ?? -1) - f.height) > 0.01) return 0;
  const n = Math.min(prev.units.length, next.units.length);
  const para = (f: Flow, u: Unit) => {
    const p = u.para >= 0 ? f.paras[u.para] : null;
    return p ? `${p.first - u.para}|${p.last - p.first}|${p.widow}|${p.keepLines}|${p.keepNext}` : "";
  };
  for (let k = 0; k < n; k++) {
    const a = prev.units[k]!;
    const b = next.units[k]!;
    if (
      Math.abs(a.top - b.top) > 0.01 ||
      Math.abs(a.bottom - b.bottom) > 0.01 ||
      Math.abs(a.anchorTop - b.anchorTop) > 0.01 ||
      a.kind !== b.kind ||
      a.breakBefore !== b.breakBefore ||
      a.columnBreakBefore !== b.columnBreakBefore ||
      a.section !== b.section ||
      a.region !== b.region ||
      a.table !== b.table ||
      (a.notes ?? []).join() !== (b.notes ?? []).join() ||
      anchorKey(a.at) !== anchorKey(b.at) ||
      para(prev, a) !== para(next, b)
    )
      return k;
  }
  return n;
}
