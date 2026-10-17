// The pagination engine (P8-31) on stub measurements: lines of 20 px, pages
// with a 200 px body (10 lines) 50 px below the sheet top.

import { describe, expect, it } from "vitest";
import {
  collapseMargins, firstChange, lineSlots, mergeLineRects, pageOfUnit, paginate,
  type Flow, type PaginateOptions, type Unit,
} from "./paginate";
import { buildFlow, closeUp, fragmentSlots, type BlockMeasure, type Item } from "./measure";
import { computeBreaks, pageAtPos, pageIndexAt, type PageLayout } from "../pagination";
import { visibleSheets } from "../../ui/PageChrome";
import { verticalPos } from "../floating";
import type { Anchor } from "../../generated/Anchor";

const L = 20;
const BOX = { height: 300, bodyTop: 50, bodyHeight: 200 };
const OPTS: PaginateOptions = { pageBox: () => BOX, gap: 10, noteSeparator: 10 };

interface ParaSpec {
  lines: number;
  widow?: boolean;
  keepLines?: boolean;
  keepNext?: boolean;
  breakBefore?: Unit["breakBefore"];
  notes?: Record<number, number[]>;
  gap?: number;
}

/** A flow of paragraphs (each its own block), lines of `L` px, `gap` px between paragraphs. */
function flowOf(paras: ParaSpec[], footnotes: Record<number, number> = {}): Flow {
  const flow: Flow = { units: [], paras: [], tables: [], regions: [], blocks: [], footnotes: new Map(), end: 0 };
  let y = 0;
  paras.forEach((p, b) => {
    y += b > 0 ? (p.gap ?? 0) : 0;
    const first = flow.units.length;
    flow.blocks.push({ top: b, child: -1, y, bottom: y + p.lines * L });
    for (let k = 0; k < p.lines; k++) {
      flow.units.push({
        kind: "line",
        top: y + k * L,
        bottom: y + (k + 1) * L,
        anchorTop: y + k * L,
        at: k === 0 ? { kind: "block", pos: b * 100 } : { kind: "inline", pos: b * 100 + k * 10 },
        block: b,
        para: b,
        section: 0,
        ...(k === 0 && p.breakBefore ? { breakBefore: p.breakBefore } : {}),
        ...(p.notes?.[k] ? { notes: p.notes[k] } : {}),
      });
    }
    flow.paras.push({ first, last: flow.units.length - 1, widow: p.widow ?? true, keepLines: !!p.keepLines, keepNext: !!p.keepNext });
    y += p.lines * L;
  });
  for (const [id, h] of Object.entries(footnotes)) {
    const lines = Array.from({ length: Math.round(h / 10) }, (_, k) => ({ top: k * 10, bottom: (k + 1) * 10 }));
    flow.footnotes.set(Number(id), { id: Number(id), height: h, lines });
  }
  flow.end = y;
  return flow;
}

/** Lines per page of paragraph `b`. */
function split(flow: Flow, pages: ReturnType<typeof paginate>["pages"], b: number): number[] {
  return pages.map((p) => flow.units.slice(p.start, p.end).filter((u) => u.para === b).length);
}

const starts = (r: ReturnType<typeof paginate>) => r.pages.map((p) => p.start);

describe("line rects", () => {
  it("rects of one line merge; the next line starts a new one", () => {
    const lines = mergeLineRects([
      { top: 0, bottom: 16 },
      { top: 0.5, bottom: 16 },
      { top: 15.8, bottom: 31.8 },
    ]);
    expect(lines).toEqual([
      { top: 0, bottom: 16, first: 0 },
      { top: 15.8, bottom: 31.8, first: 2 },
    ]);
  });

  it("a superscript or a tall image joins its line", () => {
    const lines = mergeLineRects([
      { top: 10, bottom: 26 },
      { top: 6, bottom: 16 },
      { top: -20, bottom: 24 },
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ top: -20, bottom: 26 });
  });

  it("empty rects are skipped", () => {
    expect(mergeLineRects([{ top: 5, bottom: 5 }, { top: 0, bottom: 16 }])).toEqual([{ top: 0, bottom: 16, first: 1 }]);
    expect(mergeLineRects([])).toEqual([]);
  });

  it("line slots: boundaries in the middle between glyph boxes; content edges at the ends", () => {
    const slots = lineSlots([{ top: 1, bottom: 17 }, { top: 17, bottom: 33 }, { top: 33, bottom: 49 }], 0, 52);
    expect(slots).toEqual([{ top: 0, bottom: 17 }, { top: 17, bottom: 33 }, { top: 33, bottom: 52 }]);
  });

  it("overlapping glyph boxes (line height below the font's) still give contiguous slots", () => {
    const slots = lineSlots([{ top: -1, bottom: 17 }, { top: 15, bottom: 33 }], 0, 32);
    expect(slots[0]!.bottom).toBe(16);
    expect(slots[1]!.top).toBe(16);
  });

  it("a paragraph split over two columns: slots per run, no negative heights", () => {
    const lines = [{ top: 100, bottom: 116 }, { top: 116, bottom: 132 }, { top: 0, bottom: 16 }, { top: 16, bottom: 32 }];
    const slots = fragmentSlots(lines, [0, 0, 300, 300], 100, 32, 0);
    expect(slots.map((s) => s.bottom - s.top)).toEqual([16, 16, 16, 16]);
  });

  it("a column jump is also seen in the left edge", () => {
    const slots = fragmentSlots([{ top: 0, bottom: 16 }, { top: 16, bottom: 32 }], [0, 300], 0, 32, 2);
    expect(slots).toEqual([{ top: 0, bottom: 18 }, { top: 14, bottom: 32 }]);
  });

  it("margins collapse like CSS", () => {
    expect(collapseMargins(10, 16)).toBe(16);
    expect(collapseMargins(10, -4)).toBe(6);
    expect(collapseMargins(-2, -4)).toBe(-4);
  });

  it("closeUp removes column jumps (items keep their heights)", () => {
    const item = (top: number, bottom: number, left = 0): Item => ({ kind: "line", top, bottom, anchorTop: top, at: { kind: "block", rel: 0 }, para: 0, left });
    const out = closeUp([item(0, 20), item(20, 40), item(0, 20, 300), item(20, 40, 300)]);
    expect(out.map((x) => [x.top, x.bottom])).toEqual([[0, 20], [20, 40], [40, 60], [60, 80]]);
  });
});

describe("pages at line boundaries", () => {
  it("a long paragraph fills pages line by line", () => {
    const flow = flowOf([{ lines: 25 }]);
    const r = paginate(flow, OPTS);
    expect(split(flow, r.pages, 0)).toEqual([10, 10, 5]);
    expect(r.origin).toBe(50);
    expect(r.height).toBe(3 * 300 + 2 * 10);
  });

  it("a spacer puts the next page's first line at its body top", () => {
    const flow = flowOf([{ lines: 12 }]);
    const r = paginate(flow, OPTS);
    expect(r.spacers).toHaveLength(1);
    const s = r.spacers[0]!;
    expect(s.unit).toBe(10);
    // Line 10 is at natural y 200 = frame 250; page 2's body starts at 310 + 50.
    expect(s.height).toBe(360 - 250);
    expect(r.vtop[10]).toBe(360);
    expect(s.at).toEqual({ kind: "inline", pos: 100 });
  });

  it("the page's content end and the page of a unit", () => {
    const flow = flowOf([{ lines: 12 }]);
    const r = paginate(flow, OPTS);
    expect(r.pages[0]!.contentEnd).toBe(250);
    expect(pageOfUnit(r.pages, 11)).toBe(1);
    expect(pageOfUnit(r.pages, 3)).toBe(0);
  });

  it("fragments: per page and column, the units of each block with their sheet y", () => {
    const flow = flowOf([{ lines: 6 }, { lines: 6 }]);
    const r = paginate(flow, OPTS);
    const frags = r.pages.map((p) => p.columns[0]!.fragments.map((f) => [f.block, f.to - f.from, f.y]));
    expect(frags).toEqual([[[0, 6, 50], [1, 4, 170]], [[1, 2, 50]]]);
  });
});

describe("widow / orphan control, keep lines together", () => {
  it("widow: the last line never stands alone on the next page (two lines move)", () => {
    // 7 + 4 lines: the 4-line paragraph would split 3 / 1.
    const flow = flowOf([{ lines: 7 }, { lines: 4 }]);
    expect(split(flow, paginate(flow, OPTS).pages, 1)).toEqual([2, 2]);
  });

  it("without widow control the last line may stand alone", () => {
    const flow = flowOf([{ lines: 7 }, { lines: 4, widow: false }]);
    expect(split(flow, paginate(flow, OPTS).pages, 1)).toEqual([3, 1]);
  });

  it("orphan: a paragraph's first line alone at a page bottom moves on", () => {
    const flow = flowOf([{ lines: 9 }, { lines: 5 }]);
    expect(split(flow, paginate(flow, OPTS).pages, 1)).toEqual([0, 5]);
  });

  it("a 3-line paragraph that can not split 2 / 2 moves whole", () => {
    const flow = flowOf([{ lines: 8 }, { lines: 3 }]);
    expect(split(flow, paginate(flow, OPTS).pages, 1)).toEqual([0, 3]);
  });

  it("widow control never empties a page", () => {
    const flow = flowOf([{ lines: 11 }]);
    expect(split(flow, paginate(flow, OPTS).pages, 0)).toEqual([9, 2]);
  });

  it("keep lines together moves the whole paragraph", () => {
    const flow = flowOf([{ lines: 6 }, { lines: 6, keepLines: true }]);
    expect(split(flow, paginate(flow, OPTS).pages, 1)).toEqual([0, 6]);
  });

  it("a kept paragraph longer than a page still breaks", () => {
    const flow = flowOf([{ lines: 2 }, { lines: 14, keepLines: true }]);
    const pages = paginate(flow, OPTS).pages;
    expect(split(flow, pages, 1)).toEqual([0, 10, 4]);
  });
});

describe("keep with next, page breaks", () => {
  it("a heading kept with the next paragraph moves to the next page with it", () => {
    const flow = flowOf([{ lines: 8 }, { lines: 1, keepNext: true }, { lines: 4 }]);
    const pages = paginate(flow, OPTS).pages;
    expect(split(flow, pages, 1)).toEqual([0, 1]);
    expect(split(flow, pages, 2)).toEqual([0, 4]);
  });

  it("a chain of kept paragraphs moves together", () => {
    const flow = flowOf([{ lines: 7 }, { lines: 1, keepNext: true }, { lines: 1, keepNext: true }, { lines: 3 }]);
    const pages = paginate(flow, OPTS).pages;
    expect(pages[1]!.start).toBe(7);
  });

  it("a kept paragraph keeps its last two lines with the next one", () => {
    const flow = flowOf([{ lines: 9, keepNext: true }, { lines: 3 }]);
    expect(starts(paginate(flow, OPTS))).toEqual([0, 7]);
  });

  it("a chain that would empty the page does not move", () => {
    const flow = flowOf([{ lines: 9, keepNext: true, keepLines: true }, { lines: 3 }]);
    expect(starts(paginate(flow, OPTS))).toEqual([0, 9]);
  });

  it("keep with next keeps only the last lines of a long paragraph (widow control: two)", () => {
    const r = paginate(flowOf([{ lines: 2 }, { lines: 8, keepNext: true }, { lines: 3, keepLines: true }]), OPTS);
    // The first paragraph and 6 lines of the second stay; its last two lines go with the kept paragraph.
    expect(r.pages[1]!.start).toBe(8);
  });

  it("page break before starts a new page", () => {
    const flow = flowOf([{ lines: 2 }, { lines: 2, breakBefore: "page" }]);
    expect(starts(paginate(flow, OPTS))).toEqual([0, 2]);
  });

  it("an odd-page section start adds a blank page", () => {
    // Page 1, then the break would start page 2: odd wanted → a blank page 2, the text on page 3.
    const flow = flowOf([{ lines: 2 }, { lines: 2, breakBefore: "odd" }]);
    const r = paginate(flow, OPTS);
    expect(r.pages.map((p) => [p.value, p.end - p.start])).toEqual([[1, 2], [2, 0], [3, 2]]);
    expect(r.vtop[2]).toBe(2 * 310 + 50);
  });

  it("page numbering restarts per section", () => {
    const flow = flowOf([{ lines: 2 }, { lines: 2, breakBefore: "page" }]);
    flow.units[2]!.section = 1;
    flow.units[3]!.section = 1;
    const r = paginate(flow, { ...OPTS, numberStart: (s) => (s === 1 ? 7 : null) });
    expect(r.pages.map((p) => [p.section, p.first, p.value])).toEqual([[0, true, 1], [1, true, 7]]);
  });
});

/** A table of `rows` rows of `h` px (the first `header` rows repeat), after `before` lines. */
function tableFlow(before: number, rows: number, h: number, header = 0, cells?: (r: number) => number[]): Flow {
  const flow = flowOf([{ lines: before }]);
  const first = flow.units.length;
  let y = before * L;
  flow.blocks.push({ top: 1, child: -1, y, bottom: y + rows * h });
  for (let r = 0; r < rows; r++) {
    const cellLines = cells?.(r) ?? [];
    const u: Unit = {
      kind: "row",
      top: y,
      bottom: y + h,
      anchorTop: y,
      at: r === 0 ? { kind: "block", pos: 1000 } : { kind: "cells", cells: [1000 + r * 10 + 1, 1000 + r * 10 + 5] },
      block: 1,
      para: -1,
      section: 0,
      table: 0,
      row: r,
      cells: cellLines.map((n, c) => ({
        lines: Array.from({ length: n }, (_, k) => ({ top: y + k * L, bottom: y + (k + 1) * L, at: { kind: "inline" as const, pos: 2000 + c * 100 + k } })),
        bottom: y + n * L,
      })),
    };
    flow.units.push(u);
    y += h;
  }
  flow.tables.push({ first, last: flow.units.length - 1, headerRows: header, headerHeight: header * h, block: 1 });
  return flow;
}

describe("tables", () => {
  it("a table breaks between rows", () => {
    const flow = tableFlow(2, 12, 30);
    const r = paginate(flow, OPTS);
    // 2 lines (40 px) + 5 rows (150) on page 1.
    expect(starts(r)).toEqual([0, 7, 13]);
    expect(r.spacers[0]!.at).toEqual({ kind: "cells", cells: [1051, 1055] });
  });

  it("header rows repeat at the top of each continuation page", () => {
    const flow = tableFlow(0, 12, 30, 1);
    const r = paginate(flow, OPTS);
    expect(r.pages[1]!.repeat).toEqual({ table: 0, height: 30 });
    // The first row of page 2 sits below the repeated header.
    expect(r.vtop[r.pages[1]!.start]).toBe(360 + 30);
    expect(r.pages[0]!.repeat).toBeUndefined();
  });

  it("header rows never stay alone at the bottom of a page", () => {
    const flow = tableFlow(8, 6, 30, 1);
    const r = paginate(flow, OPTS);
    // 160 px of text, the header row would fit (190) but the first body row not: the table moves.
    expect(r.pages[1]!.start).toBe(8);
    expect(r.pages[1]!.repeat).toBeUndefined();
  });

  it("a row taller than a page that can not split overflows its page", () => {
    const flow = tableFlow(0, 2, 250);
    flow.units[0]!.cantSplit = true;
    const r = paginate(flow, OPTS);
    expect(starts(r)).toEqual([0, 1]);
  });

  it("a row taller than a page splits its cells at line boundaries", () => {
    // One row of 14 lines in cell 0 and 3 in cell 1.
    const flow = tableFlow(0, 1, 14 * L, 0, () => [14, 3]);
    const r = paginate(flow, OPTS);
    expect(r.pages).toHaveLength(2);
    // Only the long cell continues on page 2: a spacer before its 11th line.
    expect(r.spacers).toHaveLength(1);
    expect(r.spacers[0]!.at).toEqual({ kind: "inline", pos: 2010 });
    expect(r.spacers[0]!.height).toBe(360 - (50 + 10 * L));
  });
});

describe("footnotes", () => {
  it("a footnote is reserved on the page of its reference", () => {
    const flow = flowOf([{ lines: 12, notes: { 2: [7] } }], { 7: 30 });
    const r = paginate(flow, OPTS);
    expect(r.pages[0]!.footnotes).toEqual([{ id: 7, from: 0, to: 30 }]);
    expect(r.pages[0]!.notesHeight).toBe(40);
    // 200 - 40 = 160 px: 8 lines stay on page 1.
    expect(r.pages[1]!.start).toBe(8);
  });

  it("the reference line moves to the next page with its note when both do not fit", () => {
    const flow = flowOf([{ lines: 12, widow: false, notes: { 9: [7] } }], { 7: 30 });
    const r = paginate(flow, OPTS);
    expect(r.pages[0]!.footnotes).toEqual([]);
    expect(r.pages[1]!.footnotes.map((n) => n.id)).toEqual([7]);
  });

  it("a long footnote continues on the next page", () => {
    const flow = flowOf([{ lines: 12, widow: false, notes: { 4: [7] } }], { 7: 260 });
    const r = paginate(flow, OPTS);
    const first = r.pages[0]!.footnotes[0]!;
    expect(first.from).toBe(0);
    expect(first.to).toBeLessThan(260);
    // Continuations take at most half of a page; the slices are contiguous up to the note's end.
    const slices = r.pages.flatMap((p) => p.footnotes);
    expect(slices.map((n) => n.id)).toEqual(slices.map(() => 7));
    slices.forEach((n, k) => k > 0 && expect(n.from).toBe(slices[k - 1]!.to));
    expect(slices[slices.length - 1]!.to).toBe(260);
  });

  it("several notes stack; a note referenced twice is reserved once", () => {
    const flow = flowOf([{ lines: 4, notes: { 0: [1], 1: [2], 2: [1] } }], { 1: 20, 2: 20 });
    const r = paginate(flow, OPTS);
    expect(r.pages[0]!.footnotes.map((n) => n.id)).toEqual([1, 2]);
    expect(r.pages[0]!.notesHeight).toBe(50);
  });
});

/** A columns box of `lines` lines (one paragraph per `per` lines), `cols` columns. */
function columnsFlow(lines: number, cols = 2, per = 5, columnBreakAt: number[] = []): Flow {
  const n = Math.ceil(lines / per);
  const flow = flowOf(Array.from({ length: n }, (_, i) => ({ lines: Math.min(per, lines - i * per), widow: false })));
  flow.units.forEach((u, k) => {
    u.region = 0;
    if (columnBreakAt.includes(k)) u.columnBreakBefore = true;
  });
  flow.regions.push({ first: 0, last: flow.units.length - 1, columns: Array.from({ length: cols }, (_, c) => ({ x: c * 110, width: 100 })), top: 0, bottom: (lines / cols) * L });
  return flow;
}

describe("multi-column sections", () => {
  it("column 1 fills before column 2; the box continues on the next page", () => {
    const flow = columnsFlow(30);
    const r = paginate(flow, OPTS);
    expect(r.pages[0]!.regionColumns!.map((c) => c.end - c.start)).toEqual([10, 10]);
    expect(r.spacers.map((s) => [s.unit, s.kind])).toEqual([[10, "column"], [20, "span"], [25, "column"]]);
  });

  it("the section's last page is balanced", () => {
    const flow = columnsFlow(30);
    const r = paginate(flow, OPTS);
    expect(r.pages[1]!.regionColumns!.map((c) => c.end - c.start)).toEqual([5, 5]);
    expect(r.pages[1]!.sets![0]!.height).toBe(5 * L);
  });

  it("a short box balances on one page", () => {
    const r = paginate(columnsFlow(7, 2, 7), OPTS);
    expect(r.pages).toHaveLength(1);
    expect(r.pages[0]!.regionColumns!.map((c) => c.end - c.start)).toEqual([4, 3]);
  });

  it("a column break starts the next column", () => {
    const r = paginate(columnsFlow(6, 2, 6, [2]), OPTS);
    expect(r.pages[0]!.regionColumns!.map((c) => [c.start, c.end])).toEqual([[0, 2], [2, 6]]);
    // The browser breaks there itself: no column spacer.
    expect(r.spacers).toEqual([]);
  });

  it("fragments of column boxes carry the column's x", () => {
    const r = paginate(columnsFlow(20, 2, 20), OPTS);
    expect(r.pages[0]!.columns.map((c) => c.x)).toEqual([0, 110]);
  });
});

describe("block packing (computeBreaks)", () => {
  it("keeps the old block-level API on the new engine", () => {
    const blocks = [0, 1, 2, 3].map((i) => ({ top: i * 300, bottom: i * 300 + 300, breakAfter: false }));
    expect(computeBreaks(blocks, 700).breaks.map((b) => b.index)).toEqual([2]);
    expect(computeBreaks(blocks, 700).breaks[0]!.fill).toBe(100);
  });

  it("a page break after a block", () => {
    const blocks = [{ top: 0, bottom: 10, breakAfter: true }, { top: 10, bottom: 20, breakAfter: false }];
    expect(computeBreaks(blocks, 700).breaks.map((b) => b.index)).toEqual([1]);
  });
});

describe("incremental pagination", () => {
  it("an unchanged flow has no change; geometry, anchors and notes are changes", () => {
    const a = flowOf([{ lines: 5 }, { lines: 5 }]);
    expect(firstChange(a, flowOf([{ lines: 5 }, { lines: 5 }]))).toBe(10);
    // A paragraph with one more line changes from its first line (its widow/orphan decisions change).
    expect(firstChange(a, flowOf([{ lines: 5 }, { lines: 6 }]))).toBe(5);
    expect(firstChange(a, flowOf([{ lines: 5 }, { lines: 5, gap: 4 }]))).toBe(5);
    const moved = flowOf([{ lines: 5 }, { lines: 5 }]);
    moved.units[7]!.at = { kind: "block", pos: 9 };
    expect(firstChange(a, moved)).toBe(7);
    expect(firstChange(a, flowOf([{ lines: 5 }, { lines: 5 }], { 1: 10 }))).toBe(0);
  });

  it("a paragraph's flow options are part of the comparison", () => {
    const a = flowOf([{ lines: 5 }, { lines: 5 }]);
    expect(firstChange(a, flowOf([{ lines: 5 }, { lines: 5, keepLines: true }]))).toBe(5);
  });

  it("resuming after an edit on page 4 gives the same pages as a full run", () => {
    const paras = Array.from({ length: 30 }, (_, i) => ({ lines: 3 + (i % 5), gap: 6 }));
    const before = flowOf(paras);
    const prev = paginate(before, OPTS);
    const edited = paras.map((p, i) => (i === 14 ? { ...p, lines: p.lines + 2 } : p));
    const after = flowOf(edited);
    const from = firstChange(before, after);
    const full = paginate(after, OPTS);
    const inc = paginate(after, { ...OPTS, resume: { prev, from } });
    expect(inc.pages.map((p) => [p.start, p.end])).toEqual(full.pages.map((p) => [p.start, p.end]));
    expect(inc.spacers.map((s) => [s.unit, Math.round(s.height)])).toEqual(full.spacers.map((s) => [s.unit, Math.round(s.height)]));
    // Only the pages from the edit on were walked again: the ones before are taken over.
    expect(inc.pages[0]).toBe(prev.pages[0]);
    expect(from).toBeGreaterThan(prev.pages[2]!.start);
  });

  it("an unchanged flow resumes at its last page", () => {
    const flow = flowOf(Array.from({ length: 10 }, () => ({ lines: 4 })));
    const prev = paginate(flow, OPTS);
    const inc = paginate(flow, { ...OPTS, resume: { prev, from: flow.units.length } });
    expect(inc.pages.map((p) => p.start)).toEqual(prev.pages.map((p) => p.start));
    expect(Array.from(inc.vtop)).toEqual(Array.from(prev.vtop));
  });
});

describe("the flow from measured blocks", () => {
  const m = (lines: number, mt: number, mb: number, extra: Partial<BlockMeasure> = {}): BlockMeasure => ({
    kind: "flow",
    height: lines * L,
    mt,
    mb,
    items: Array.from({ length: lines }, (_, k): Item => ({ kind: "line", top: k * L, bottom: (k + 1) * L, anchorTop: k * L, at: k === 0 ? { kind: "block", rel: 0 } : { kind: "inline", rel: 1 + k }, para: 0 })),
    paras: [{ first: 0, last: lines - 1, flow: {} }],
    ...extra,
  });

  it("blocks chain with collapsed margins; anchors become document positions", () => {
    const flow = buildFlow({ blocks: [{ m: m(2, 0, 10), pos: 0, section: 0, region: false }, { m: m(1, 16, 0), pos: 20, section: 0, region: false }] });
    expect(flow.units.map((u) => u.top)).toEqual([0, 20, 56]);
    expect(flow.units[2]!.at).toEqual({ kind: "block", pos: 20 });
    expect(flow.units[1]!.at).toEqual({ kind: "inline", pos: 2 });
    // The widget before the second block takes back the margin that no longer collapses.
    expect(flow.units[2]!.collapse).toBe(10);
  });

  it("a section end with a next-page section breaks before the next block", () => {
    const end = m(1, 0, 0, { paras: [{ first: 0, last: 0, flow: {}, sectionEnd: 5 }] });
    const flow = buildFlow({ blocks: [{ m: end, pos: 0, section: 0, region: false }, { m: m(1, 0, 0), pos: 10, section: 1, region: false }], sectionBreak: (id) => (id === 5 ? "even" : null) });
    expect(flow.units[1]!.breakBefore).toBe("even");
    expect(flow.units[1]!.section).toBe(1);
  });

  it("widow control is Word's default; flow options come through", () => {
    const flow = buildFlow({ blocks: [{ m: m(2, 0, 0, { paras: [{ first: 0, last: 1, flow: { keepNext: true, widowControl: false } }] }), pos: 0, section: 0, region: false }] });
    expect(flow.paras[0]).toMatchObject({ widow: false, keepNext: true, keepLines: false });
    expect(buildFlow({ blocks: [{ m: m(1, 0, 0), pos: 0, section: 0, region: false }] }).paras[0]!.widow).toBe(true);
  });

  it("a page break inside a paragraph breaks before the next block", () => {
    const flow = buildFlow({ blocks: [{ m: m(1, 0, 0, { breakAfter: "page" }), pos: 0, section: 0, region: false }, { m: m(1, 0, 0), pos: 9, section: 0, region: false }] });
    expect(flow.units[1]!.breakBefore).toBe("page");
  });
});

describe("page lookups", () => {
  const layout = { pageStarts: [0, 120, 300], pages: [{ number: "i" }, { number: "ii" }, { number: "iii" }] } as unknown as PageLayout;

  it("the page of a document position", () => {
    expect(pageIndexAt(layout, 0)).toBe(0);
    expect(pageIndexAt(layout, 119)).toBe(0);
    expect(pageIndexAt(layout, 120)).toBe(1);
    expect(pageIndexAt(layout, 5000)).toBe(2);
  });

  it("page fields read the page's formatted number", () => {
    expect(pageAtPos(layout, 150)?.number).toBe("ii");
    expect(pageAtPos(null, 1)).toBeNull();
  });

  it("the chrome renders the visible sheets and a few around them", () => {
    const sheets = Array.from({ length: 50 }, (_, i) => ({ top: i * 310, height: 300 })) as unknown as Parameters<typeof visibleSheets>[0];
    expect(visibleSheets(sheets, 0, 900)).toEqual([0, 5]);
    expect(visibleSheets(sheets, 3100, 4000)).toEqual([8, 15]);
    expect(visibleSheets(sheets, 20000, 21000)).toEqual([48, 50]);
  });
});

describe("floating pictures on the page", () => {
  const anchor = (relativeTo: "page" | "margin" | "paragraph", place: Anchor["v"]["place"]): Anchor => ({
    h: { relativeTo: "column", place: { kind: "offset", value: 0 } },
    v: { relativeTo, place },
    wrap: "square",
    distance: { top: 0, bottom: 0, left: 0, right: 0 },
    allowOverlap: true,
  });
  const page = { paraTop: 400, height: 1123, bodyTop: 96, bodyBottom: 1027 };

  it("page and margin positions are resolved against the anchor paragraph's page", () => {
    expect(verticalPos(anchor("page", { kind: "offset", value: 9525 * 100 }), page)).toBe(100 - 400);
    expect(verticalPos(anchor("margin", { kind: "align", value: "bottom" }), page, 50)).toBe(1027 - 50 - 400);
    expect(verticalPos(anchor("margin", { kind: "align", value: "center" }), page, 31)).toBe((96 + 1027 - 31) / 2 - 400);
  });

  it("without a page (draft view) they stay at the paragraph; paragraph offsets always apply", () => {
    expect(verticalPos(anchor("page", { kind: "align", value: "top" }))).toBe(0);
    expect(verticalPos(anchor("paragraph", { kind: "offset", value: 9525 * 10 }), page)).toBe(10);
  });
});
