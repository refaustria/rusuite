// Unit tests of the P6-4 editor features (find, pagination, tables,
// pictures, formatting) on headless editors.

import { afterEach, describe, expect, it } from "vitest";
import { Extension, type Editor } from "@tiptap/core";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import type { Block } from "../generated/Block";
import type { Inline } from "../generated/Inline";
import { makeDoc, para, run } from "../test/fixtures";
import { change, makeEditor, posOf, select, Tagger } from "../test/harness";
import { findAll, findInChars, findPlugin, findState, findStep, replaceCurrent, setFindQuery } from "./find";
import { clearFormattingCommand, FormatPainter, wordAt } from "./formatting";
import { HANDLES, resizeBy } from "./imageView";
import { fitToWidth, imageFiles, selectedImage, setImageAttrs } from "./images";
import { computeBreaks, headerFooterText, pageGeometry } from "./pagination";
import {
  bordersOf, colWidthsOf, deleteCols, deleteRows, dragBorder, insertCol, insertRow, setRowHeight, shadeCells, tableContext, toggleHeaderRow,
} from "./tables";
import { contentValue, writeHeaderFooterCss, writePrintCss } from "../print/printCss";
import { cm, fromCm, fromPt, lineRuleOf, lineSpacingOf, pt } from "../ui/dialogs";
import { matchLabel } from "../ui/FindBar";
import { withPageNumber } from "../ui/WriteToolbar";

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

const FindExt = Extension.create({ name: "testFind", addProseMirrorPlugins: () => [findPlugin()] });
const open = (body: Block[], find = false) => (editor = makeEditor(makeDoc(body), find ? [Tagger, FindExt] : [Tagger]));

/** A table block with ids: table `id`, rows id+1.., cells and paragraphs after. */
function table(id: number, rows: string[][], props?: Record<string, unknown>): Block {
  let n = id + 1;
  return {
    kind: "table",
    value: {
      id,
      ...(props ? { props } : {}),
      rows: rows.map((r) => ({
        id: n++,
        cells: r.map((text) => {
          const cell = n++;
          return { id: cell, blocks: [para(cell + 1000, text)] };
        }),
      })),
    },
  } as Block;
}

const image = (alt?: string): Inline => ({ kind: "image", value: { media: 1, width: 952500, height: 476250, ...(alt ? { alt } : {}) } });

describe("find", () => {
  const m = (text: string, pat: string, c = false, w = false) => findInChars([...text], [...pat], c, w);
  it("matches like the Rust core (case folding, whole words, no overlap)", () => {
    expect(m("Cat cat CAT", "cat")).toEqual([[0, 3], [4, 7], [8, 11]]);
    expect(m("Cat cat CAT", "cat", true)).toEqual([[4, 7]]);
    expect(m("cat concat cats cat_ cat", "cat", true, true)).toEqual([[0, 3], [21, 24]]);
    expect(m("aaaa", "aa")).toEqual([[0, 2], [2, 4]]);
    expect(m("Élan élan", "ÉLAN", false, true)).toEqual([[0, 4], [5, 9]]);
    expect(m("abc", "")).toEqual([]);
    expect(m("😀a😀a", "a")).toEqual([[1, 2], [3, 4]]);
  });

  it("findAll maps char offsets to editor positions (images count one)", () => {
    const e = open([para(1, [run("ab"), image(), run("ab")]), para(2, "xab")]);
    const hits = findAll(e.state.doc, { text: "ab", matchCase: false, wholeWord: false });
    expect(hits.map((h) => e.state.doc.textBetween(h.from, h.to))).toEqual(["ab", "ab", "ab"]);
    expect(hits[1]!.from).toBe(posOf(e, 1, 3));
  });

  it("highlights every match; Enter-like steps select the next / previous, wrapping", () => {
    const e = open([para(1, "red fish red"), para(2, "red")], true);
    setFindQuery(e.view, { text: "red", matchCase: false, wholeWord: false });
    expect(findState(e.state)!.matches).toHaveLength(3);
    expect(e.view.dom.querySelectorAll(".find-match")).toHaveLength(3);
    expect(e.view.dom.querySelectorAll(".find-current")).toHaveLength(1);
    expect(findStep(e.view, 1)).toBe(0);
    expect(findStep(e.view, 1)).toBe(1);
    expect(findStep(e.view, 1)).toBe(2);
    expect(findStep(e.view, 1)).toBe(0);
    expect(findStep(e.view, -1)).toBe(2);
    const { from, to } = e.state.selection;
    expect(e.state.doc.textBetween(from, to)).toBe("red");
    setFindQuery(e.view, null);
    expect(e.view.dom.querySelectorAll(".find-match")).toHaveLength(0);
  });

  it("Replace replaces the selected match through the mapper (replaceText) and moves on", () => {
    const e = open([para(1, "red fish red")], true);
    setFindQuery(e.view, { text: "red", matchCase: false, wholeWord: false });
    findStep(e.view, 1);
    const r = change(e, () => replaceCurrent(e.view, "blue"));
    expect(r?.command).toEqual({ type: "replaceText", block: 1, from: 0, to: 3, text: "blue" });
    expect(e.state.doc.textContent).toBe("blue fish red");
    expect(findState(e.state)!.matches).toHaveLength(1);
    expect(e.state.doc.textBetween(e.state.selection.from, e.state.selection.to)).toBe("red");
  });

  it("match counter text", () => {
    expect(matchLabel(1, 5, "x")).toBe("2 of 5");
    expect(matchLabel(-1, 0, "x")).toBe("No results");
    expect(matchLabel(-1, 0, "")).toBe("");
  });
});

describe("pagination", () => {
  const box = (top: number, h: number, breakAfter = false) => ({ top, bottom: top + h, breakAfter });

  it("packs blocks into pages; the overflowing block starts the next page", () => {
    const blocks = [box(0, 400), box(400, 400), box(800, 300), box(1100, 100)];
    const { breaks, lastFill } = computeBreaks(blocks, 1000);
    expect(breaks).toEqual([{ index: 2, fill: 200 }]);
    expect(lastFill).toBe(1000 - 400);
  });

  it("a manual page break ends its page; a block taller than a page overflows alone", () => {
    const blocks = [box(0, 100, true), box(100, 2500), box(2600, 100)];
    const { breaks } = computeBreaks(blocks, 1000);
    expect(breaks.map((b) => b.index)).toEqual([1, 2]);
    expect(breaks[0]!.fill).toBe(900);
    expect(computeBreaks([], 1000).breaks).toEqual([]);
  });

  it("page geometry and header/footer text", () => {
    const g = pageGeometry({ width: 15840, height: 12240, orientation: "landscape", margins: { top: 1440, right: 720, bottom: 1440, left: 720, header: 708, footer: 708 } });
    expect([g.width, g.height, g.left]).toEqual([1056, 816, 48]);
    expect(pageGeometry(null).width).toBe(794);
    expect(headerFooterText("Page {PAGE} of report {PAGE}", 3)).toBe("Page 3 of report 3");
    expect(headerFooterText(undefined, 1)).toBe("");
  });

  it("print CSS: header and footer as @page margin boxes with the page counter", () => {
    expect(contentValue('A "b"\n{PAGE}')).toBe('"A \\"b\\"\\A " counter(page) ""');
    const margins = { top: 1440, right: 1440, bottom: 1440, left: 1440, header: 720, footer: 720 };
    const page = { width: 12240, height: 15840, orientation: "portrait" as const, margins, headerText: "Report", footerText: "Page {PAGE}" };
    const css = writeHeaderFooterCss(page);
    expect(css).toContain('@top-left { content: "Report"; vertical-align: top; padding-top: 0.5in;');
    expect(css).toContain('@bottom-left { content: "Page " counter(page) "";');
    expect(writePrintCss(page)).toContain(css);
    expect(writeHeaderFooterCss({ ...page, headerText: undefined, footerText: undefined })).toBe("");
  });
});

describe("tables", () => {
  it("tableContext: row, column, selected cells", () => {
    const e = open([para(1, "x"), table(10, [["a", "b"], ["c", "d"]], { colWidths: [3000, 6000] })]);
    select(e, 1015, 0); // cell (1, 0): ids 11(row) 12 13, 14(row) 15 16 → paragraph 1015
    let t = tableContext(e.state)!;
    expect([t.table, t.row, t.col, t.rows, t.cols]).toEqual([10, 1, 0, 2, 2]);
    expect(t.cells).toEqual([15]);
    select(e, 1012, 0, 1016, 1);
    t = tableContext(e.state)!;
    expect(t.rowIndices).toEqual([0, 1]);
    expect(t.colIndices).toEqual([0, 1]);
    expect(t.cells).toEqual([12, 13, 15, 16]);
    select(e, 1, 0);
    expect(tableContext(e.state)).toBeNull();
  });

  it("row/column commands follow Word (above/below/left/right; deleting all rows deletes the table)", () => {
    const e = open([table(10, [["a", "b"], ["c", "d"]])]);
    select(e, 1013, 0); // row 0, col 1
    const t = tableContext(e.state)!;
    expect(insertRow(t, false)).toEqual({ type: "insertTableRow", table: 10, at: 0 });
    expect(insertRow(t, true)).toEqual({ type: "insertTableRow", table: 10, at: 1 });
    expect(insertCol(t, false)).toEqual({ type: "insertTableCol", table: 10, at: 1 });
    expect(insertCol(t, true)).toEqual({ type: "insertTableCol", table: 10, at: 2 });
    expect(deleteRows(t)).toEqual({ type: "deleteTableRow", table: 10, at: 0 });
    expect(deleteCols(t)).toEqual({ type: "deleteTableCol", table: 10, at: 1 });
    select(e, 1012, 0, 1016, 1);
    const all = tableContext(e.state)!;
    expect(deleteRows(all)).toEqual({ type: "deleteBlocks", ids: [10] });
    expect(deleteCols(all)).toEqual({ type: "deleteBlocks", ids: [10] });
  });

  it("shading, borders, header row and row height commands", () => {
    const e = open([table(10, [["a", "b"]])]);
    select(e, 1012, 0);
    const t = tableContext(e.state)!;
    expect(shadeCells(t, null)).toEqual({ type: "setCellProps", cells: [12], patch: { shading: { kind: "auto" } } });
    expect(shadeCells(t, { kind: "rgb", value: "FFFF00" })).toMatchObject({ patch: { shading: { kind: "rgb", value: "FFFF00" } } });
    expect(bordersOf("all").insideH?.style).toBe("single");
    expect(bordersOf("outside").insideV?.style).toBe("none");
    expect(bordersOf("outside").top?.style).toBe("single");
    expect(bordersOf("none").left?.style).toBe("none");
    expect(toggleHeaderRow(t)).toEqual({ type: "setRowProps", table: 10, rows: [0], header: true });
    expect(setRowHeight(t, null)).toEqual({ type: "setRowProps", table: 10, rows: [0], height: { value: 0, rule: "atLeast" } });
    expect(colWidthsOf(t, 9000)).toEqual([4500, 4500]);
  });

  it("dragging a border: the neighbour compensates, columns keep a minimum, the last border resizes alone", () => {
    expect(dragBorder([3000, 3000, 3000], 0, 600)).toEqual([3600, 2400, 3000]);
    expect(dragBorder([3000, 3000], 0, 5000)).toEqual([5640, 360]);
    expect(dragBorder([3000, 3000], 1, -400)).toEqual([3000, 2600]);
    expect(dragBorder([3000, 3000], 1, -4000)).toEqual([3000, 360]);
  });

  it("table borders render as CSS variables; header rows are marked", () => {
    const e = open([table(10, [["a"]], { borders: bordersOf("outside") })]);
    const el = e.view.dom.querySelector("table")!;
    expect(el.hasAttribute("data-borders")).toBe(true);
    expect(el.getAttribute("style")).toContain("--tb-top: 1px solid");
    expect(el.getAttribute("style")).toContain("--tb-ih: 1px dashed var(--write-gridline");
  });
});

describe("pictures", () => {
  it("corner handles resize proportionally, side handles one dimension", () => {
    expect(HANDLES).toHaveLength(8);
    expect(resizeBy("se", 200, 100, 100, 0)).toEqual({ w: 300, h: 150 });
    expect(resizeBy("nw", 200, 100, 50, 0)).toEqual({ w: 150, h: 75 });
    expect(resizeBy("e", 200, 100, 30, 99)).toEqual({ w: 230, h: 100 });
    expect(resizeBy("s", 200, 100, 0, -500)).toEqual({ w: 200, h: 8 });
    expect(resizeBy("se", 200, 100, -400, -400).h).toBeGreaterThanOrEqual(8);
  });

  it("resizing / alt text are SetImageSize / SetImageAlt (not ReplaceBlocks)", () => {
    const e = open([para(1, [run("ab"), image("old")])]);
    const pos = posOf(e, 1, 2);
    e.view.dispatch(e.state.tr.setSelection(NodeSelection.create(e.state.doc, pos)));
    expect(selectedImage(e.state)?.pos).toBe(pos);
    let r = change(e, () => setImageAttrs(e.view, pos, { width: 1905000, height: 952500 }));
    expect(r?.command).toEqual({ type: "setImageSize", block: 1, offset: 2, width: 1905000, height: 952500 });
    r = change(e, () => setImageAttrs(e.view, pos, { alt: "A chart" }));
    expect(r?.command).toEqual({ type: "setImageAlt", block: 1, offset: 2, alt: "A chart" });
    r = change(e, () => setImageAttrs(e.view, pos, { alt: null, width: 100, height: 50 }));
    expect(r?.command).toEqual({
      type: "compound",
      commands: [
        { type: "setImageSize", block: 1, offset: 2, width: 100, height: 50 },
        { type: "setImageAlt", block: 1, offset: 2, alt: null },
      ],
    });
  });

  it("the image node view has handles and follows attribute changes", () => {
    const e = open([para(1, [image()])]);
    const wrap = e.view.dom.querySelector(".inline-image-wrap")!;
    expect(wrap.querySelectorAll(".image-handle")).toHaveLength(8);
    const img = wrap.querySelector("img")!;
    expect([img.width, img.height]).toEqual([100, 50]);
    const pos = posOf(e, 1, 0);
    setImageAttrs(e.view, pos, { width: 952500 * 2, height: 952500 });
    expect([img.width, img.height]).toEqual([200, 100]);
    expect(wrap.classList.contains("selected")).toBe(true);
  });

  it("fit to the text width and clipboard image files", () => {
    expect(fitToWidth(1200, 600, 600)).toEqual({ width: 600 * 9525, height: 300 * 9525 });
    expect(fitToWidth(100, 50, 600)).toEqual({ width: 100 * 9525, height: 50 * 9525 });
    const png = new File([new Uint8Array([1])], "a.png", { type: "image/png" });
    const txt = new File(["x"], "a.txt", { type: "text/plain" });
    expect(imageFiles({ files: [txt, png] } as unknown as DataTransfer)).toEqual([png]);
    expect(imageFiles({ files: [], items: [{ kind: "file", type: "image/png", getAsFile: () => png }] } as unknown as DataTransfer)).toEqual([png]);
    expect(imageFiles(null)).toEqual([]);
  });
});

describe("formatting", () => {
  it("clear formatting covers the selected part of each paragraph", () => {
    const e = open([para(1, "hello"), para(2, "world")]);
    select(e, 1, 2, 2, 3);
    expect(clearFormattingCommand(e, false)).toEqual({
      type: "compound",
      commands: [
        { type: "clearFormatting", block: 1, from: 2, to: 5, paragraph: false },
        { type: "clearFormatting", block: 2, from: 0, to: 3, paragraph: false },
      ],
    });
    select(e, 2, 1);
    expect(clearFormattingCommand(e, false)).toBeNull();
    expect(clearFormattingCommand(e, true)).toEqual({ type: "clearFormatting", block: 2, from: 0, to: 5, paragraph: true });
  });

  it("format painter copies the formatting at the caret and paints the next selection (setRunProps)", () => {
    const e = open([para(1, [run("bold", { bold: true }), run(" plain")])]);
    const painter = new FormatPainter();
    select(e, 1, 1);
    painter.copy(e);
    expect(painter.active).toBe(true);
    expect(e.view.dom.classList.contains("format-painter")).toBe(true);
    select(e, 1, 5, 1, 10);
    const r = change(e, () => painter.paste(e));
    expect(r?.command).toEqual({ type: "setRunProps", block: 1, from: 5, to: 10, patch: { bold: true } });
    expect(painter.active).toBe(false);
  });

  it("a click paints the word under the caret; sticky mode keeps painting", () => {
    const e = open([para(1, [run("Big", { italic: true }), run(" small words")])]);
    expect(wordAt(e.state.doc, posOf(e, 1, 6))).toEqual({ from: posOf(e, 1, 4), to: posOf(e, 1, 9) });
    expect(wordAt(e.state.doc, posOf(e, 1, 3) + 1)).toEqual({ from: posOf(e, 1, 4), to: posOf(e, 1, 9) });
    const painter = new FormatPainter();
    select(e, 1, 1);
    painter.copy(e, true);
    e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, posOf(e, 1, 6))));
    expect(painter.paste(e)).toBe(true);
    expect(painter.active).toBe(true);
    painter.cancel(e);
    expect(e.view.dom.classList.contains("format-painter")).toBe(false);
  });

  it("units and line spacing rules of the dialogs", () => {
    expect(cm(1440)).toBe("2.54");
    expect(fromCm("2,54")).toBe(1440);
    expect(fromCm("x")).toBeNull();
    expect(pt(240)).toBe("12");
    expect(fromPt("6")).toBe(120);
    expect(lineRuleOf({ kind: "multiple", value: 1.5 })).toEqual({ rule: "1.5", value: "1.5" });
    expect(lineRuleOf({ kind: "exact", value: 360 })).toEqual({ rule: "exact", value: "18" });
    expect(lineSpacingOf("atLeast", "12")).toEqual({ kind: "atLeast", value: 240 });
    expect(lineSpacingOf("multiple", "1,2")).toEqual({ kind: "multiple", value: 1.2 });
    expect(lineSpacingOf("exact", "0")).toBeNull();
    expect(withPageNumber(null)).toBe("{PAGE}");
    expect(withPageNumber("Report")).toBe("Report\t{PAGE}");
    expect(withPageNumber("p. {PAGE}")).toBe("p. {PAGE}");
  });
});
