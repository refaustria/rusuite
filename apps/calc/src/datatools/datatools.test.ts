// Data tools in the UI (P8-35): the text wizard helpers, page breaks,
// outline bars and picture sizing.
import { describe, expect, it } from "vitest";
import { colGeometry, DEFAULT_FORMAT, rowGeometry } from "../grid/geometry";
import { gutterSize, levelButton, OUTLINE_STEP, outlineGroups, outlineHitAt, toggleButton, type BarLayout, type OutlineLine } from "../outline/bar";
import { fitSize, insertAnchor } from "../pictures/controller";
import { manualBreakAt, previewBreaks, previewPages, withBreak, withoutBreak } from "./pageBreaks";
import { delimited, editBreaks, guessBreaks, previewColumns, setFormat } from "./TextWizard";
import { PASTE_GALLERY } from "./DataRibbon";

const col = colGeometry(DEFAULT_FORMAT, new Map());
const row = rowGeometry(DEFAULT_FORMAT, new Map());

describe("text wizard helpers", () => {
  it("maps a separator to the delimiter checkboxes", () => {
    expect(delimited(";")).toMatchObject({ kind: "delimited", semicolon: true, comma: false, tab: false });
    expect(delimited("\t")).toMatchObject({ tab: true });
    expect(delimited("|")).toMatchObject({ other: "|" });
    expect(delimited(",")).not.toHaveProperty("other");
  });
  it("guesses fixed-width breaks from blank columns", () => {
    expect(guessBreaks(["abc  12", "de   34"])).toEqual([5]);
    expect(guessBreaks(["abc"])).toEqual([]);
    expect(guessBreaks([])).toEqual([]);
  });
  it("counts preview columns", () => {
    expect(previewColumns([["a"], ["a", "b", "c"]])).toBe(3);
    expect(previewColumns([])).toBe(0);
  });
  it("sets a column format, filling with General", () => {
    expect(setFormat([], 2, { kind: "text" })).toEqual([{ kind: "general" }, { kind: "general" }, { kind: "text" }]);
    expect(setFormat([{ kind: "text" }], 0, { kind: "skip" })).toEqual([{ kind: "skip" }]);
  });
  it("adds, moves and removes fixed-width breaks", () => {
    expect(editBreaks([5], { add: 2 })).toEqual([2, 5]);
    expect(editBreaks([2, 5], { add: 5 })).toEqual([2, 5]);
    expect(editBreaks([2, 5], { remove: 2 })).toEqual([5]);
    expect(editBreaks([2, 5], { move: 5, to: 8 })).toEqual([2, 8]);
    expect(editBreaks([2], { move: 2, to: 0 })).toEqual([]);
  });
});

describe("page breaks", () => {
  it("adds breaks sorted and unique, never before the first line", () => {
    expect(withBreak([10], 4)).toEqual([4, 10]);
    expect(withBreak([4], 4)).toEqual([4]);
    expect(withBreak([], 0)).toEqual([]);
  });
  it("removes a break", () => {
    expect(withoutBreak([4, 10], 4)).toEqual([10]);
  });
  it("knows the manual breaks at the active cell", () => {
    expect(manualBreakAt([5], [2], 5, 3)).toEqual({ row: true, col: false });
  });
  it("a small sheet is one page", () => {
    expect(previewBreaks(col, row, 10, 3, [], [])).toEqual([]);
  });
  it("a manual row break splits the pages", () => {
    const lines = previewBreaks(col, row, 10, 3, [5], []);
    expect(lines).toEqual([{ axis: "rows", index: 5, manual: true }]);
    expect(previewPages(lines, 10, 3)).toEqual([
      { rows: [0, 5], cols: [0, 4] },
      { rows: [5, 11], cols: [0, 4] },
    ]);
  });
  it("long sheets get automatic breaks", () => {
    const lines = previewBreaks(col, row, 200, 3, [], []);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.every((l) => l.axis === "rows" && !l.manual)).toBe(true);
  });
  it("orders the pages down, then over", () => {
    const pages = previewPages([{ axis: "rows", index: 3, manual: true }, { axis: "cols", index: 2, manual: true }], 5, 4);
    expect(pages.map((p) => [p.rows[0], p.cols[0]])).toEqual([[0, 0], [3, 0], [0, 2], [3, 2]]);
  });
});

describe("outline bars", () => {
  const lines = (levels: Record<number, number>, collapsed: number[] = []) => (i: number): OutlineLine => ({ level: levels[i] ?? 0, collapsed: collapsed.includes(i) });
  const layout = (gw: number): BarLayout => ({ gw, gh: 0, headerW: 46, headerH: 20, screenX: (x) => x, screenY: (y) => y, width: 800, height: 600 });
  it("sizes the gutter by the deepest level", () => {
    expect(gutterSize(0)).toBe(0);
    expect(gutterSize(1)).toBe(2 * OUTLINE_STEP + 3);
    expect(gutterSize(2)).toBeGreaterThan(gutterSize(1));
  });
  it("finds the groups with their summary rows below", () => {
    const g = outlineGroups(lines({ 1: 1, 2: 1, 3: 1, 4: 1 }), 0, 20, 1, true, 1000);
    expect(g).toEqual([{ level: 1, start: 1, end: 4, summary: 5, collapsed: false }]);
  });
  it("puts the summary above when asked", () => {
    const g = outlineGroups(lines({ 1: 1, 2: 1 }), 0, 20, 1, false, 1000);
    expect(g[0]!.summary).toBe(0);
  });
  it("finds nested groups per level", () => {
    const g = outlineGroups(lines({ 1: 1, 2: 2, 3: 2, 4: 1 }), 0, 20, 2, true, 1000);
    expect(g.map((x) => [x.level, x.start, x.end])).toEqual([[1, 1, 4], [2, 2, 3]]);
  });
  it("marks collapsed groups by their summary line", () => {
    const g = outlineGroups(lines({ 1: 1, 2: 1 }, [3]), 0, 20, 1, true, 1000);
    expect(g[0]!.collapsed).toBe(true);
  });
  it("hits the level buttons and the −/+ button", () => {
    const l = layout(gutterSize(1));
    const groups = outlineGroups(lines({ 1: 1, 2: 1 }), 0, 20, 1, true, 1000);
    const b1 = levelButton("rows", 1, l);
    const empty = { groups: [], max: 0, geo: col };
    expect(outlineHitAt(b1.x + 3, b1.y + 3, { groups, max: 1, geo: row }, empty, l)).toEqual({ kind: "level", axis: "rows", level: 1 });
    const tb = toggleButton("rows", groups[0]!, row, l)!;
    expect(outlineHitAt(tb.x + 3, tb.y + 3, { groups, max: 1, geo: row }, empty, l)).toEqual({ kind: "toggle", axis: "rows", index: 3, collapsed: true });
    expect(outlineHitAt(400, 300, { groups, max: 1, geo: row }, empty, l)).toBeNull();
  });
});

describe("pictures", () => {
  it("fits large pictures, keeps small ones", () => {
    expect(fitSize(1280, 640)).toEqual({ w: 640, h: 320 });
    expect(fitSize(100, 50)).toEqual({ w: 100, h: 50 });
    expect(fitSize(0, 0)).toEqual({ w: 1, h: 1 });
  });
  it("anchors at a cell in EMU", () => {
    expect(insertAnchor(2, 3, 10, 20)).toEqual({ type: "oneCell", from: { col: 3, row: 2, colOffset: 0, rowOffset: 0 }, width: 95250, height: 190500 });
  });
});

describe("paste gallery", () => {
  it("has Excel's entries, each a paste special", () => {
    expect(PASTE_GALLERY.map((g) => g.id)).toContain("transpose");
    expect(PASTE_GALLERY.find((g) => g.id === "transpose")!.special).toMatchObject({ transpose: true });
    expect(PASTE_GALLERY.find((g) => g.id === "values")!.special).toMatchObject({ parts: "values" });
    expect(PASTE_GALLERY.find((g) => g.id === "link")!.special).toMatchObject({ link: true });
  });
});
