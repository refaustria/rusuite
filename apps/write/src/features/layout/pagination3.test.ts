// P9-W2 (pagination round 3) on stub measurements: sections with their own
// paper (continuous breaks, resuming before a changed section, printed page
// sizes), notes (continued footnotes as one positioned note, endnotes at
// section ends, numbering per section), tables across pages (nested rows,
// rows split at the page bottom, clipped rows) and the reuse of the
// previous run (incremental flow, unchanged pages taken over).

import { describe, expect, it } from "vitest";
import { buildFlow, type BlockMeasure, type FlowInput, type NoteMeasure } from "./measure";
import { paginate, type CellFlow, type Flow, type NestedRow, type PaginateOptions, type Unit } from "./paginate";
import { endnoteReserves, firstSectionChange, placeNote, samePaper, sectionsOf, slicesClip } from "../pagination";
import { endnoteSections, noteLabels } from "../noteNumbering";
import { mixedPageCss } from "../../print/writePrintDoc";
import { noteDialogCommands, numberingOf, type NoteDialogValues } from "../../ui/noteDialog";
import { makeDoc, note, noteRef, para, run } from "../../test/fixtures";
import { toPM } from "../../sync/toPM";
import { writeSchema } from "../../sync/schema";
import type { Section } from "../../generated/Section";
import type { PageSetup } from "../../generated/PageSetup";
import type { Document } from "../../generated/Document";

const L = 20;
const BOX = { height: 300, bodyTop: 50, bodyHeight: 200 };
const OPTS: PaginateOptions = { pageBox: () => BOX, gap: 10, noteSeparator: 10 };

// ----- stubs ---------------------------------------------------------------------------------------------------

/** A measured paragraph block of `lines` lines (block-relative), optional section end. */
function paraBlock(lines: number, o: { sectionEnd?: number; mb?: number; notes?: Record<number, number[]> } = {}): BlockMeasure {
  return {
    kind: "flow",
    height: lines * L,
    mt: 0,
    mb: o.mb ?? 0,
    items: Array.from({ length: lines }, (_, k) => ({
      kind: "line" as const,
      top: k * L,
      bottom: (k + 1) * L,
      anchorTop: k * L,
      at: k === 0 ? { kind: "block" as const, rel: 0 } : { kind: "inline" as const, rel: 1 + k },
      para: 0,
      ...(o.notes?.[k] ? { notes: o.notes[k] } : {}),
    })),
    paras: [{ first: 0, last: lines - 1, flow: {}, ...(o.sectionEnd != null ? { sectionEnd: o.sectionEnd } : {}) }],
  };
}

/** Input blocks: paragraphs at PM positions 100 apart. */
function input(blocks: BlockMeasure[], sections: number[] = [], extra: Partial<FlowInput> = {}): FlowInput {
  return { blocks: blocks.map((m, i) => ({ m, pos: i * 100, section: sections[i] ?? 0, region: false })), ...extra };
}

/** The numbers of a flow's units (for comparing two builds). */
const unitNumbers = (f: Flow) =>
  f.units.map((u) => [u.top, u.bottom, u.anchorTop, u.block, u.para, u.section, u.at.kind === "cells" ? u.at.cells.join() : typeof u.at.pos === "number" ? u.at.pos : "fn", u.breakBefore ?? ""]);

/** A table flow: one row per entry (cells of `lines` lines each), the cells' content as given. */
function tableFlow(rows: { cells: CellFlow[]; height: number; cantSplit?: boolean; header?: boolean }[], before = 0): Flow {
  const flow: Flow = { units: [], paras: [], tables: [], regions: [], blocks: [], footnotes: new Map(), end: 0 };
  let y = 0;
  for (let k = 0; k < before; k++) {
    flow.blocks.push({ top: flow.blocks.length, child: -1, y, bottom: y + L });
    flow.units.push({ kind: "line", top: y, bottom: y + L, anchorTop: y, at: { kind: "block", pos: k * 10 }, block: flow.blocks.length - 1, para: k, section: 0 });
    flow.paras.push({ first: k, last: k, widow: true, keepLines: false, keepNext: false });
    y += L;
  }
  const first = flow.units.length;
  flow.blocks.push({ top: flow.blocks.length, child: -1, y, bottom: y });
  rows.forEach((r, i) => {
    flow.units.push({
      kind: "row",
      top: y,
      bottom: y + r.height,
      anchorTop: y,
      at: { kind: "cells", cells: r.cells.map((_c, k) => 1000 + i * 10 + k) },
      block: flow.blocks.length - 1,
      para: -1,
      section: 0,
      table: 0,
      row: i,
      ...(r.cantSplit ? { cantSplit: true } : {}),
      cells: r.cells,
    });
    y += r.height;
  });
  flow.blocks[flow.blocks.length - 1]!.bottom = y;
  flow.tables.push({ first, last: flow.units.length - 1, headerRows: rows.filter((r) => r.header).length, headerHeight: rows.filter((r) => r.header).reduce((s, r) => s + r.height, 0), block: flow.blocks.length - 1 });
  flow.end = y;
  return flow;
}

/** A cell of `n` lines starting at natural `top`; anchors `pos`, `pos + 1`, … */
function cell(top: number, n: number, pos: number): CellFlow {
  const lines = Array.from({ length: n }, (_, k) => ({ top: top + k * L, bottom: top + (k + 1) * L, at: { kind: "inline" as const, pos: pos + k } }));
  return { lines, bottom: top + n * L };
}

/** A nested row of cells (each `n` lines) at `top`. */
function nested(top: number, ns: number[], pos: number, o: { cantSplit?: boolean; header?: boolean } = {}): NestedRow {
  const cells = ns.map((n, k) => cell(top, n, pos + k * 100));
  return { kind: "row", top, bottom: top + Math.max(...ns) * L, at: { kind: "cells", cells: ns.map((_n, k) => pos + k * 100 - 1) }, cells, ...o };
}

const page = (w: number, h: number, orientation: PageSetup["orientation"] = "portrait", left = 1440): PageSetup => ({
  width: w,
  height: h,
  orientation,
  margins: { top: 1440, right: 1440, bottom: 1440, left, header: 708, footer: 708 },
});
const A4 = page(11906, 16838);
const A4L = page(16838, 11906, "landscape");
const section = (id: number, p: PageSetup, kind: Section["kind"] = "nextPage", extra: Partial<Section> = {}): Section => ({ id, page: p, kind, titlePage: false, ...extra });

// ----- 1. sections with their own text width -------------------------------------------------------------------

describe("sections with different paper", () => {
  it("a continuous break to other paper starts a new page (Word); other margins stay on the page", () => {
    const doc = toPM(makeDoc([para(1, "a", { sectionEnd: 1 }), para(2, "b", { sectionEnd: 2 }), para(3, "c")]), writeSchema());
    const land = sectionsOf(doc, [section(1, A4), section(2, A4L, "continuous"), section(3, page(11906, 16838, "portrait", 2000), "continuous")]);
    expect(land.breakKind(1)).toBe("page");
    expect(land.breakKind(2)).toBe("page");
    const margins = sectionsOf(doc, [section(1, A4), section(2, page(11906, 16838, "portrait", 2000), "continuous"), section(3, A4)]);
    expect(margins.breakKind(1)).toBeNull();
    expect(samePaper(A4, page(11906, 16838, "portrait", 3000))).toBe(true);
    expect(samePaper(A4, A4L)).toBe(false);
  });

  it("a continuous section starts below the break on the same page, with its own page box after", () => {
    const flow = buildFlow(input([paraBlock(3, { sectionEnd: 1 }), paraBlock(12)], [0, 1]));
    const boxes: Record<number, typeof BOX> = { 0: BOX, 1: { height: 400, bodyTop: 50, bodyHeight: 300 } };
    const r = paginate(flow, { ...OPTS, pageBox: (p) => boxes[p.section]! });
    // Page 1 (section 0's box) holds 3 + 7 lines; the next page is section 1's.
    expect(r.pages[0]!.section).toBe(0);
    expect(r.pages[0]!.end).toBe(10);
    expect(r.pages[1]!.section).toBe(1);
    expect(r.pages[1]!.box.bodyHeight).toBe(300);
  });

  it("the first changed section decides where a new layout resumes", () => {
    const a = [section(1, A4), section(2, A4L), section(3, A4)];
    expect(firstSectionChange(a, a)).toBe(3);
    expect(firstSectionChange(a, [a[0]!, { ...a[1]!, page: A4 }, a[2]!])).toBe(1);
    expect(firstSectionChange(a, [a[0]!, a[1]!, { ...a[2]!, columns: { count: 2, equal: true } }])).toBe(2);
    expect(firstSectionChange(a, a.slice(0, 2))).toBe(2);
  });

  it("resuming before a section whose page changed gives the same pages as a full run", () => {
    const blocks = [paraBlock(15, { sectionEnd: 1 }), paraBlock(25)];
    const flow = buildFlow(input(blocks, [0, 1]));
    const small = { height: 300, bodyTop: 50, bodyHeight: 150 };
    const prev = paginate(flow, OPTS);
    const opts: PaginateOptions = { ...OPTS, pageBox: (p) => (p.section === 1 ? small : BOX) };
    const full = paginate(flow, opts);
    const inc = paginate(flow, { ...opts, resume: { prev, from: flow.units.findIndex((u) => u.section >= 1) } });
    expect(inc.pages.map((p) => [p.start, p.end, p.box.bodyHeight])).toEqual(full.pages.map((p) => [p.start, p.end, p.box.bodyHeight]));
    expect(inc.spacers.map((s) => [s.unit, s.height])).toEqual(full.spacers.map((s) => [s.unit, s.height]));
  });

  it("printed pages of mixed sizes get named @page rules (the first size is the document's)", () => {
    const g = (w: number, h: number) => ({ width: w, height: h, top: 96, bottom: 96, left: 96, right: 96, header: 48, footer: 48 });
    const m = mixedPageCss([g(794, 1123), g(1123, 794), g(794, 1123), g(1123, 794)]);
    expect(m.classOf(0)).toBe("");
    expect(m.classOf(1)).toBe("rs-wsize-0");
    expect(m.classOf(3)).toBe("rs-wsize-0");
    expect(m.css).toContain("@page rs-wsize-0 { size: 11.698in 8.271in; margin: 0; }");
    expect(m.css).toContain(".rs-print-page:has(> .rs-wsize-0) { page: rs-wsize-0;");
    expect(mixedPageCss([g(794, 1123)]).css).toBe("");
  });
});

// ----- 2. notes ------------------------------------------------------------------------------------------------

describe("footnotes continued on the next page", () => {
  it("one note element: positioned at its first slice, a spacer before the continued line, clipped to both slices", () => {
    const at = { kind: "inline" as const, pos: 77 };
    const p = placeNote(
      [
        { page: 0, top: 250, from: 0, to: 40 },
        { page: 1, top: 620, from: 40, to: 90, at },
      ],
      50,
    );
    expect(p.top).toBe(200);
    // The line at natural 40 is drawn at frame 620: 620 - (250 + 40).
    expect(p.spacers).toEqual([{ at, height: 330, page: 1 }]);
    expect(p.clip).toEqual([
      [-12, 40],
      [370, 420],
    ]);
    expect(slicesClip(p.clip)).toBe("polygon(0 -12.0px, 100% -12.0px, 100% 40.0px, 0 40.0px, 0 370.0px, 100% 370.0px, 100% 420.0px, 0 420.0px)");
  });

  it("a third slice accounts for the spacer before it", () => {
    const p = placeNote(
      [
        { page: 0, top: 100, from: 0, to: 10 },
        { page: 1, top: 400, from: 10, to: 20, at: { kind: "inline", pos: 1 } },
        { page: 2, top: 700, from: 20, to: 30, at: { kind: "inline", pos: 2 } },
      ],
      0,
    );
    expect(p.spacers.map((s) => s.height)).toEqual([290, 290]);
  });

  it("the notes' line anchors are resolved against the notes area", () => {
    const notes: BlockMeasure = { kind: "notes", height: 0, mt: 0, mb: 0, items: [], paras: [], footnotes: [{ id: 3, height: 40, lines: [{ top: 0, bottom: 20, at: { kind: "inline", rel: 2 } }, { top: 20, bottom: 40, at: { kind: "inline", rel: 9 } }], paras: [] }] };
    const flow = buildFlow({ blocks: [{ m: paraBlock(2, { notes: { 1: [3] } }), pos: 0, section: 0, region: false }, { m: notes, pos: 500, section: 0, region: false }] });
    expect(flow.footnotes.get(3)!.lines.map((l) => l.at)).toEqual([
      { kind: "inline", pos: 502 },
      { kind: "inline", pos: 509 },
    ]);
  });
});

/** The notes area with endnotes measured on their own (`pos="sectEnd"`). */
function notesArea(ends: [number, number][]): BlockMeasure {
  const endnotes: NoteMeasure[] = ends.map(([id, lines]) => ({
    id,
    height: lines * L,
    lines: Array.from({ length: lines }, (_, k) => ({ top: k * L, bottom: (k + 1) * L, at: { kind: "inline" as const, rel: id * 10 + k } })),
    paras: [{ first: 0, last: lines - 1, flow: {} }],
  }));
  return { kind: "notes", height: 0, mt: 0, mb: 0, items: [], paras: [], footnotes: [], endnotes };
}

describe("endnotes at the end of each section", () => {
  const blocks = (first: number, lines = 2) => input([paraBlock(first, { sectionEnd: 1 }), paraBlock(3), notesArea([[1, lines], [2, 1]])], [0, 1, 1], {
    endnotes: [{ section: 0, ids: [1] }, { section: 1, ids: [2] }],
    endnoteSeparator: 10,
  });

  it("a section's endnotes follow its last block; the next section moves down by their height", () => {
    const flow = buildFlow(blocks(3));
    const groups = flow.endGroups!;
    expect(groups).toHaveLength(2);
    // Separator (10) + 2 lines after section 0's 3 lines; section 1 starts below them.
    expect(groups[0]).toMatchObject({ section: 0, first: 3, last: 5, height: 50, next: 6 });
    expect(flow.units[6]!.top).toBe(3 * L + 50);
    expect(flow.units[4]!.top).toBe(3 * L + 10);
    // The first line of a note moves the (positioned) note: no spacer anchor; later lines have theirs.
    expect(flow.units[4]!.at).toEqual({ kind: "block", pos: -1 });
    expect(flow.units[5]!.at).toEqual({ kind: "inline", pos: 211 });
    expect(flow.blocks[flow.units[4]!.block]!.note).toBe(1);
    // The last section's endnotes end the document (no next unit).
    expect(groups[1]).toMatchObject({ section: 1, next: -1 });
  });

  it("the reserved space includes a page gap inside the endnotes", () => {
    // 7 lines and the separator: two of the endnote's four lines fit, the other two go to the next page.
    const flow = buildFlow(blocks(7, 4));
    const r = paginate(flow, OPTS);
    const [g0] = endnoteReserves(flow, r);
    const g = flow.endGroups![0]!;
    expect(g0!.unit).toBe(g.next);
    expect(g0!.height).toBeGreaterThan(g.height);
    // The gap: the third line starts the next page's body (a spacer inside the positioned note).
    expect(r.vtop[g.first + 3]).toBe(r.pages[1]!.sheetTop + BOX.bodyTop);
    expect(r.spacers.find((s) => s.unit === g.first + 3)!.at).toEqual({ kind: "inline", pos: 212 });
  });

  it("endnotes are grouped by the section of their first reference", () => {
    const doc = toPM(makeDoc([para(1, [run("a"), noteRef(4, "end")], { sectionEnd: 1 }), para(2, [noteRef(5, "end"), noteRef(4, "end"), noteRef(6, "foot")])]), writeSchema());
    expect(endnoteSections(doc, [section(1, A4), section(2, A4)])).toEqual([
      { section: 0, ids: [4] },
      { section: 1, ids: [5] },
    ]);
  });
});

/** A document with footnotes 1, 2 in section 1 and 3, 4 in section 2, endnotes 7 (section 1) and 8 (section 2). */
function notesDoc(): Document {
  const doc = makeDoc([
    para(1, [run("a"), noteRef(1), noteRef(7, "end"), noteRef(2)], { sectionEnd: 1 }),
    para(2, [run("b"), noteRef(3), noteRef(8, "end")]),
    para(3, [run("c"), noteRef(4)]),
  ]);
  doc.notes = [1, 2, 3, 4].map((id) => note(id, "foot", [para(100 + id, "n")])).concat([note(7, "end", [para(107, "e")]), note(8, "end", [para(108, "e")])]);
  return doc;
}

describe("note numbers per section", () => {
  const pm = () => toPM(notesDoc(), writeSchema());
  const labels = (m: Map<number, string>) => [1, 2, 3, 4, 7, 8].map((id) => m.get(id));

  it("defaults: footnotes 1, 2, 3 … and endnotes i, ii … through the document", () => {
    expect(labels(noteLabels(pm(), [section(1, A4), section(2, A4)]))).toEqual(["1", "2", "3", "4", "i", "ii"]);
  });

  it("number format, start and restart each section (w:numFmt, w:numStart, w:numRestart)", () => {
    const s2: Section = section(2, A4, "nextPage", { footnoteNumbering: { format: "lowerLetter", restart: "eachSection" }, endnoteNumbering: { format: "upperRoman", start: 3, restart: "eachSection" } });
    const s1: Section = section(1, A4, "nextPage", { footnoteNumbering: { start: 5 } });
    expect(labels(noteLabels(pm(), [s1, s2]))).toEqual(["5", "6", "a", "b", "i", "III"]);
  });

  it("restart each page uses the page of each reference", () => {
    const s: Section = section(1, A4, "nextPage", { footnoteNumbering: { restart: "eachPage" } });
    const s2: Section = section(2, A4, "nextPage", { footnoteNumbering: { restart: "eachPage" } });
    const doc = pm();
    const pageOf = (pos: number) => (pos < doc.child(0).nodeSize + doc.child(1).nodeSize ? 0 : 1);
    expect(labels(noteLabels(doc, [s, s2], pageOf)).slice(0, 4)).toEqual(["1", "2", "3", "1"]);
    // Without a layout (draft view) the numbers run on.
    expect(labels(noteLabels(doc, [s, s2])).slice(0, 4)).toEqual(["1", "2", "3", "4"]);
  });
});

describe("Footnote and Endnote dialog", () => {
  const sections = [section(1, A4), section(2, A4L)];
  const v = (over: Partial<NoteDialogValues>): NoteDialogValues => ({ kind: "foot", endAtSection: false, format: "decimal", start: 1, restart: "continuous", applyTo: "whole", ...over });

  it("defaults are left out; endnotes do not restart per page", () => {
    expect(numberingOf(v({}))).toEqual({});
    expect(numberingOf(v({ format: "upperRoman", start: 2, restart: "eachPage" }))).toEqual({ format: "upperRoman", start: 2, restart: "eachPage" });
    expect(numberingOf(v({ kind: "end", format: "lowerRoman", restart: "eachPage" }))).toEqual({});
  });

  it("Apply: whole document sets every section, This section only the caret's; End of section is a setting", () => {
    const whole = noteDialogCommands(v({ format: "lowerLetter" }), sections, sections[1]!, {});
    expect(whole).toEqual([
      { type: "setSection", section: 1, patch: { footnoteNumbering: { format: "lowerLetter" } } },
      { type: "setSection", section: 2, patch: { footnoteNumbering: { format: "lowerLetter" } } },
    ]);
    const one = noteDialogCommands(v({ kind: "end", endAtSection: true, format: "decimal", applyTo: "section" }), sections, sections[1]!, { autoHyphenation: true });
    expect(one).toEqual([
      { type: "setSettings", settings: { autoHyphenation: true, endnotesAtSectionEnd: true } },
      { type: "setSection", section: 2, patch: { endnoteNumbering: { format: "decimal" } } },
    ]);
    // Nothing changed: no commands.
    expect(noteDialogCommands(v({}), sections, sections[0]!, {})).toEqual([]);
  });
});

// ----- 3. tables across pages ----------------------------------------------------------------------------------

describe("tables across pages (rows split like Word)", () => {
  it("a row that does not fit the rest of the page splits there; each cell continues at its own line", () => {
    // 6 lines of text, then a row with 8 and 3 lines: 4 lines of the long cell fit on page 1.
    const flow = tableFlow([{ cells: [cell(6 * L, 8, 2000), cell(6 * L, 3, 3000)], height: 8 * L }], 6);
    const r = paginate(flow, OPTS);
    expect(r.pages).toHaveLength(2);
    expect(r.pages[0]!.end).toBe(7);
    expect(r.spacers).toHaveLength(1);
    expect(r.spacers[0]!.at).toEqual({ kind: "inline", pos: 2004 });
    // The row's part on each page: open at the cut.
    expect(r.pages[0]!.rowWindows).toEqual([{ unit: 6, top: 50 + 6 * L, bottom: 250 }]);
    expect(r.pages[1]!.rowWindows![0]).toMatchObject({ unit: 6, top: 310 + 50 });
  });

  it("a row whose first lines do not fit moves whole; header rows never split", () => {
    const flow = tableFlow([{ cells: [cell(10 * L - 10, 3, 2000)], height: 3 * L }], 0);
    flow.units[0]!.top = 195;
    flow.units[0]!.anchorTop = 195;
    flow.units[0]!.bottom = 195 + 3 * L;
    flow.units[0]!.cells = [cell(195, 3, 2000)];
    const r = paginate({ ...flow, units: [{ ...flow.units[0]!, kind: "line", cells: undefined, table: undefined, row: undefined, top: 0, bottom: 195, anchorTop: 0, at: { kind: "block", pos: 1 } } as Unit, flow.units[0]!], tables: [{ ...flow.tables[0]!, first: 1, last: 1 }] }, OPTS);
    expect(r.pages[1]!.start).toBe(1);
    const head = tableFlow([{ cells: [cell(180, 3, 2000)], height: 3 * L, header: true }, { cells: [cell(240, 1, 3000)], height: L }], 9);
    const rh = paginate(head, OPTS);
    expect(rh.pages[0]!.rowWindows).toBeUndefined();
  });

  it("rows of a nested table split independently per nested cell; the outer cell's lines after it follow", () => {
    // Outer cell: 2 lines, a nested row with cells of 6 and 2 lines, 1 line after (the nested row ends at 8 lines).
    const top = 0;
    const content = [
      { kind: "line" as const, ...cell(top, 2, 5000).lines[0]! },
      { kind: "line" as const, ...cell(top, 2, 5000).lines[1]! },
      nested(2 * L, [12, 2], 6000),
      { kind: "line" as const, top: 14 * L, bottom: 15 * L, at: { kind: "inline" as const, pos: 7000 } },
    ];
    const outer: CellFlow = { lines: [], bottom: 15 * L, content };
    const flow = tableFlow([{ cells: [outer], height: 15 * L }]);
    const r = paginate(flow, OPTS);
    expect(r.pages).toHaveLength(2);
    // Only the long nested cell continues on page 2 (its 9th line); the line after the nested table follows it.
    expect(r.spacers.map((s) => s.at)).toEqual([{ kind: "inline", pos: 6008 }]);
    // 8 of its 12 lines fit; 4 continue and the outer cell's last line follows them.
    expect(r.pages[1]!.rowWindows![0]!.bottom).toBeCloseTo(360 + 5 * L, 5);
  });

  it("a nested row that can not break moves whole (a spacer at its cells), a nested header row with the next", () => {
    const content = [nested(0, [8], 6000), nested(8 * L, [3, 1], 7000, { cantSplit: true })];
    const flow = tableFlow([{ cells: [{ lines: [], bottom: 11 * L, content }], height: 11 * L }]);
    const r = paginate(flow, OPTS);
    expect(r.spacers.map((s) => s.at)).toEqual([{ kind: "cells", cells: [6999, 7099] }]);
    const withHeader = [nested(0, [9], 6000), nested(9 * L, [1], 7000, { header: true }), nested(10 * L, [2], 8000)];
    const r2 = paginate(tableFlow([{ cells: [{ lines: [], bottom: 12 * L, content: withHeader }], height: 12 * L }]), OPTS);
    expect(r2.spacers.map((s) => s.at)).toEqual([{ kind: "cells", cells: [6999] }]);
  });

  it("a row that can not break and is taller than the page is clipped; what follows starts on the next page", () => {
    const flow = tableFlow([{ cells: [cell(0, 20, 2000)], height: 20 * L, cantSplit: true }]);
    flow.blocks.push({ top: 1, child: -1, y: 20 * L, bottom: 21 * L });
    flow.units.push({ kind: "line", top: 20 * L, bottom: 21 * L, anchorTop: 20 * L, at: { kind: "block", pos: 900 }, block: 1, para: 0, section: 0 });
    flow.paras.push({ first: 1, last: 1, widow: true, keepLines: false, keepNext: false });
    const r = paginate(flow, OPTS);
    expect(r.pages[0]!.clips).toEqual([{ unit: 0, bottom: 250 }]);
    expect(r.pages[1]!.start).toBe(1);
    // The next block is pulled up to the next page's body top: a negative spacer.
    expect(r.spacers[0]!.height).toBeLessThan(0);
    expect(r.vtop[1]).toBe(r.pages[1]!.sheetTop + 50);
  });
});

// ----- 4. reuse of the previous run ----------------------------------------------------------------------------

describe("incremental flow and reused pages", () => {
  const doc = (edit: number, extra = 0) => Array.from({ length: 40 }, (_, i) => paraBlock(3 + (i % 4) + (i === edit ? extra : 0)));
  const cached = doc(-1);
  const inputOf = (blocks: BlockMeasure[], shiftFrom = 99, dpos = 0) => ({ blocks: blocks.map((m, i) => ({ m, pos: i * 100 + (i >= shiftFrom ? dpos : 0), section: 0, region: false })), key: "k" });

  it("an edited block: units before are taken over, units after are moved; the result equals a full build", () => {
    const prev = buildFlow(inputOf(cached));
    const prevFirst = prev.units[0];
    const blocks = [...cached];
    blocks[20] = paraBlock(3 + (20 % 4) + 2);
    const inc = buildFlow(inputOf(blocks, 21, 7), prev);
    const full = buildFlow(inputOf(blocks, 21, 7));
    expect(unitNumbers(inc)).toEqual(unitNumbers(full));
    expect(inc.paras).toEqual(full.paras);
    expect(inc.blocks).toEqual(full.blocks);
    expect(inc.end).toBe(full.end);
    expect(inc.units[0]).toBe(prevFirst);
    const first20 = full.blocks.findIndex((b) => b.top === 20);
    expect(inc.reuse).toMatchObject({ from: full.units.findIndex((u) => u.block === first20), du: 2, dy: 2 * L, db: 0, dp: 0 });
  });

  it("a deleted block and an edit in the last block: still equal to a full build", () => {
    const prev = buildFlow(inputOf(cached));
    const shorter = cached.filter((_m, i) => i !== 10);
    const inc = buildFlow({ blocks: shorter.map((m, i) => ({ m, pos: i * 100 + (i >= 10 ? 50 : 0), section: 0, region: false })), key: "k" }, prev);
    const full = buildFlow({ blocks: shorter.map((m, i) => ({ m, pos: i * 100 + (i >= 10 ? 50 : 0), section: 0, region: false })), key: "k" });
    expect(unitNumbers(inc)).toEqual(unitNumbers(full));
    expect(inc.blocks).toEqual(full.blocks);
    const prev2 = buildFlow(inputOf(cached));
    const last = [...cached.slice(0, -1), paraBlock(9)];
    const inc2 = buildFlow(inputOf(last), prev2);
    expect(unitNumbers(inc2)).toEqual(unitNumbers(buildFlow(inputOf(last))));
    expect(inc2.reuse!.same).toBe(inc2.units.length);
  });

  it("a measure replaced (the block's DOM changed) is built again even at the same position", () => {
    const prev = buildFlow(inputOf(cached));
    const blocks = [...cached];
    blocks[5] = paraBlock(3 + (5 % 4));
    const inc = buildFlow(inputOf(blocks), prev);
    expect(inc.reuse!.from).toBe(prev.units.findIndex((u) => u.block === 5));
    expect(inc.reuse!.du).toBe(0);
    expect(unitNumbers(inc)).toEqual(unitNumbers(buildFlow(inputOf(blocks))));
  });

  it("another key (section breaks changed) builds everything again", () => {
    const prev = buildFlow(inputOf(cached));
    const again = buildFlow({ ...inputOf(cached), key: "other" }, prev);
    expect(again.reuse).toBeUndefined();
    expect(again.units[0]).not.toBe(prev.units[0]);
  });

  it("pages after the edit are taken over once the breaks meet the previous ones again", () => {
    const prevFlow = buildFlow(inputOf(cached));
    const prev = paginate(prevFlow, OPTS);
    const prevPages = prev.pages.map((p) => [p.start, p.end]);
    const blocks = [...cached];
    // One more line in block 20 (page ~6): the following breaks shift by one unit at most, then meet again.
    blocks[20] = paraBlock(3 + (20 % 4) + 1);
    const flow = buildFlow(inputOf(blocks, 21, 3), prevFlow);
    const full = paginate(buildFlow(inputOf(blocks, 21, 3)), OPTS);
    const inc = paginate(flow, { ...OPTS, resume: { prev, from: flow.reuse!.from } });
    expect(inc.pages.map((p) => [p.start, p.end])).toEqual(full.pages.map((p) => [p.start, p.end]));
    expect(inc.spacers.map((s) => [s.unit, Math.round(s.height * 100)])).toEqual(full.spacers.map((s) => [s.unit, Math.round(s.height * 100)]));
    expect(Array.from(inc.vtop)).toEqual(Array.from(full.vtop));
    expect(inc.pages.map((p) => p.columns[0]!.fragments.map((f) => [f.block, f.from, f.to, f.y]))).toEqual(full.pages.map((p) => p.columns[0]!.fragments.map((f) => [f.block, f.from, f.to, f.y])));
    expect(prevPages.length).toBeGreaterThan(8);
  });
});
