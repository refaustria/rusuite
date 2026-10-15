// P8-17: table context with merged cells and the Table Design / Layout
// commands; paragraph borders, shading and tab stop commands.

import { afterEach, describe, expect, it } from "vitest";
import type { Editor } from "@tiptap/core";
import { CellSelection } from "@tiptap/pm/tables";
import type { Block } from "../generated/Block";
import { makeDoc, para } from "../test/fixtures";
import { makeEditor, select } from "../test/harness";
import { findPos } from "../sync/SyncPlugin";
import {
  addTabCommand, bordersShadingCommand, moveTabCommand, nextTabKind, paragraphBorderState, paragraphBordersCommand, paragraphShadingCommand, removeTabCommand,
  selectedParagraphs, snapTwips, tabsDialogCommand, tabsPatch, PARA_BORDER, NO_PARA_BORDER,
} from "./paragraphFormat";
import {
  cellAlignmentCommands, cellBordersCommand, closeRect, distributeCols, distributeRows, inLastCell, mergeCellsCommand, selectInTable, setSelectedColWidth, setTableStyle,
  splitCellCommand, splitRowsValid, tableContext, tablePropsCommands, tablePropsValues, toggleLook, WORD_DEFAULT_LOOK,
} from "./tables";
import { borderGroups, groupMemberCss } from "./paragraphBox";
import { paragraphBoxCss } from "../sync/schema";

type Cell = { id: number; gridSpan?: number; vMerge?: "restart" | "continue"; blocks: Block[] };
const c = (id: number, text: string, extra: Partial<Cell> = {}): Cell => ({ id, blocks: [para(id + 100, text)], ...extra });

/** 3 × 3: (0,0)-(1,1) merged; row 2 plain. */
function table(): Block {
  return {
    kind: "table",
    value: {
      id: 10,
      props: { colWidths: [1000, 2000, 3000] },
      rows: [
        { id: 11, cells: [c(20, "big", { gridSpan: 2, vMerge: "restart" }), c(21, "a")] },
        { id: 12, cells: [c(22, "", { gridSpan: 2, vMerge: "continue" }), c(23, "b")] },
        { id: 13, cells: [c(24, "x"), c(25, "y"), c(26, "z")] },
      ],
    },
  } as Block;
}

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});
const open = (blocks: Block[]) => (editor = makeEditor(makeDoc(blocks)));
const cellSel = (e: Editor, a: number, b: number) => {
  const pa = findPos(e.state.doc, a);
  const pb = findPos(e.state.doc, b);
  e.view.dispatch(e.state.tr.setSelection(CellSelection.create(e.state.doc, pa, pb)));
};

describe("table context with merged cells", () => {
  it("grid coordinates: the merged cell covers rows 0–1 and columns 0–1", () => {
    const e = open([table()]);
    select(e, 125, 0);
    const t = tableContext(e.state)!;
    expect([t.row, t.col, t.rows, t.cols]).toEqual([2, 1, 3, 3]);
    select(e, 120, 1);
    const m = tableContext(e.state)!;
    expect(m.cell).toEqual({ top: 0, left: 0, bottom: 2, right: 2 });
    expect(m.cells).toEqual([20]);
    expect(m.rowIndices).toEqual([0, 1]);
    expect(m.colIndices).toEqual([0, 1]);
    expect(mergeCellsCommand(m)).toBeNull();
  });

  it("a cell selection grows to whole merged cells; Merge Cells sends its rectangle", () => {
    const e = open([table()]);
    cellSel(e, 25, 24);
    let t = tableContext(e.state)!;
    expect(t.rect).toEqual({ top: 2, left: 0, bottom: 3, right: 2 });
    expect(mergeCellsCommand(t)).toEqual({ type: "mergeCells", table: 10, top: 2, left: 0, bottom: 2, right: 1 });
    // From x up to b: the merged cell is inside, all of rows 0–2.
    cellSel(e, 24, 23);
    t = tableContext(e.state)!;
    expect(t.rect).toEqual({ top: 0, left: 0, bottom: 3, right: 3 });
    expect(t.cells.sort()).toEqual([20, 21, 23, 24, 25, 26]);
    expect(closeRect(t.map, { top: 1, left: 1, bottom: 2, right: 2 })).toEqual({ top: 0, left: 0, bottom: 2, right: 2 });
  });

  it("Split Cells: the caret's cell origin; rows must divide a merged region", () => {
    const e = open([table()]);
    select(e, 120, 0);
    const t = tableContext(e.state)!;
    expect(splitCellCommand(t, 2, 2)).toEqual({ type: "splitCell", table: 10, row: 0, col: 0, rows: 2, cols: 2 });
    expect(splitCellCommand(t, 1, 1)).toBeNull();
    expect(splitRowsValid(t, 2)).toBe(true);
    expect(splitRowsValid(t, 3)).toBe(false);
    select(e, 126, 0);
    expect(splitRowsValid(tableContext(e.state)!, 3)).toBe(true);
  });

  it("inLastCell and Select Row / Column / Table", () => {
    const e = open([table()]);
    select(e, 126, 0);
    expect(inLastCell(tableContext(e.state)!)).toBe(true);
    select(e, 123, 0);
    expect(inLastCell(tableContext(e.state)!)).toBe(false);
    expect(selectInTable(e.view, "column")).toBe(true);
    expect(e.state.selection).toBeInstanceOf(CellSelection);
    expect(tableContext(e.state)!.cells.sort()).toEqual([21, 23, 26]);
    select(e, 124, 0);
    selectInTable(e.view, "row");
    expect(tableContext(e.state)!.cells.sort()).toEqual([24, 25, 26]);
    selectInTable(e.view, "table");
    expect(tableContext(e.state)!.cells).toHaveLength(6);
  });

  it("Borders ▾ on a selection: outside edges vs inside lines, grouped per patch", () => {
    const e = open([table()]);
    cellSel(e, 24, 26);
    const t = tableContext(e.state)!;
    const bottom = cellBordersCommand(t, "bottom");
    expect(bottom).toEqual({ type: "setCellProps", cells: [24, 25, 26], patch: { borders: { bottom: expect.objectContaining({ style: "single" }) } } });
    const inside = cellBordersCommand(t, "inside") as { type: "compound"; commands: { cells: number[]; patch: { borders: Record<string, unknown> } }[] };
    expect(inside.type).toBe("compound");
    expect(inside.commands.map((x) => [x.cells, Object.keys(x.patch.borders).sort()])).toEqual([
      [[24], ["right"]],
      [[25], ["left", "right"]],
      [[26], ["left"]],
    ]);
    expect(cellBordersCommand(t, "insideH")).toBeNull();
    expect(cellBordersCommand(t, "none")).toEqual(expect.objectContaining({ cells: [24, 25, 26] }));
  });

  it("cell alignment: vertical alignment of the cells and paragraph alignment of their text", () => {
    const e = open([table()]);
    cellSel(e, 24, 25);
    const cmds = cellAlignmentCommands(tableContext(e.state)!, "center", "right", e.state.doc);
    expect(cmds).toEqual([
      { type: "setCellProps", cells: [24, 25], patch: { verticalAlign: "center" } },
      { type: "setParagraphProps", blocks: [124, 125], patch: { alignment: "right" } },
    ]);
  });

  it("cell size: width of the selected columns, distribute columns and rows", () => {
    const e = open([table()]);
    cellSel(e, 24, 25);
    const t = tableContext(e.state)!;
    expect(setSelectedColWidth(t, [1000, 2000, 3000], 1500)).toEqual([1500, 1500, 3000]);
    expect(distributeCols(t, [1000, 2000, 3000])).toEqual([1500, 1500, 3000]);
    select(e, 126, 0);
    const one = tableContext(e.state)!;
    expect(distributeCols(one, [1000, 2000, 3001])).toEqual([2000, 2000, 2001]);
    expect(distributeRows(one, [300, 600, 900])).toEqual({ type: "setRowProps", table: 10, rows: [0, 1, 2], height: { value: 600, rule: "atLeast" } });
  });

  it("table styles: a table without a look gets Word's default look; look toggles keep the others", () => {
    const e = open([table()]);
    select(e, 126, 0);
    const t = tableContext(e.state)!;
    expect(setTableStyle(t, "GridTable4-Accent1")).toEqual({ type: "setTableProps", table: 10, patch: { style: "GridTable4-Accent1", look: WORD_DEFAULT_LOOK } });
    expect(setTableStyle(t, "")).toEqual({ type: "setTableProps", table: 10, patch: { style: "" } });
    expect(toggleLook(t, "lastRow")).toEqual({ type: "setTableProps", table: 10, patch: { look: expect.objectContaining({ lastRow: true, firstRow: false }) } });
    const styled = { ...t, props: { ...t.props, look: WORD_DEFAULT_LOOK } };
    expect(setTableStyle(styled, "TableGrid")).toEqual({ type: "setTableProps", table: 10, patch: { style: "TableGrid" } });
    expect(toggleLook(styled, "firstRow")).toEqual({ type: "setTableProps", table: 10, patch: { look: { ...WORD_DEFAULT_LOOK, firstRow: false } } });
  });

  it("Table Properties: only changed values are sent", () => {
    const e = open([table()]);
    select(e, 124, 0);
    const t = tableContext(e.state)!;
    const v = tablePropsValues(t);
    expect(v).toEqual({ alignment: "left", indent: 0, layout: "autofit", cantSplit: false, header: false });
    expect(tablePropsCommands(t, v, v)).toEqual([]);
    expect(tablePropsCommands(t, v, { ...v, alignment: "center", cantSplit: true })).toEqual([
      { type: "setTableProps", table: 10, patch: { alignment: "center" } },
      { type: "setRowProps", table: 10, rows: [2], cantSplit: true },
    ]);
  });
});

describe("paragraph borders, shading and tabs", () => {
  const bordered = (id: number, text: string, extra?: object) => para(id, text, { borders: { bottom: PARA_BORDER }, ...extra });

  it("a side toggles: on when not every paragraph has it, off when all have it", () => {
    const e = open([bordered(1, "a"), para(2, "b")]);
    select(e, 1, 0, 2, 1);
    const nodes = selectedParagraphs(e.state);
    expect(nodes.map((n) => n.attrs.id)).toEqual([1, 2]);
    expect(paragraphBordersCommand(nodes, "bottom")).toEqual({ type: "setParagraphProps", blocks: [1, 2], patch: { borders: { bottom: PARA_BORDER } } });
    select(e, 1, 0);
    expect(paragraphBordersCommand(selectedParagraphs(e.state), "bottom")).toEqual({ type: "setParagraphProps", blocks: [1], patch: { borders: { bottom: NO_PARA_BORDER } } });
    expect(paragraphBorderState(selectedParagraphs(e.state))).toEqual({ top: false, bottom: true, left: false, right: false, between: false });
  });

  it("No Border / All / Outside / Inside, shading and the dialog", () => {
    const e = open([para(1, "a")]);
    const nodes = selectedParagraphs(e.state);
    expect(Object.keys((paragraphBordersCommand(nodes, "none") as { patch: { borders: object } }).patch.borders)).toHaveLength(5);
    expect(Object.keys((paragraphBordersCommand(nodes, "outside") as { patch: { borders: object } }).patch.borders).sort()).toEqual(["bottom", "left", "right", "top"]);
    expect((paragraphBordersCommand(nodes, "inside") as { patch: { borders: object } }).patch.borders).toEqual({ between: PARA_BORDER });
    expect(paragraphShadingCommand(nodes, null)).toEqual({ type: "setParagraphProps", blocks: [1], patch: { shading: { kind: "auto" } } });
    expect(bordersShadingCommand(nodes, { borders: { top: PARA_BORDER }, shading: { kind: "rgb", value: "FFF2CC" } })).toEqual({
      type: "setParagraphProps", blocks: [1], patch: { borders: { top: PARA_BORDER }, shading: { kind: "rgb", value: "FFF2CC" } },
    });
    expect(paragraphBordersCommand([], "all")).toBeNull();
  });

  it("tab stop commands: add, move (clear + new), remove (clear), dialog diff", () => {
    const e = open([para(1, "a\tb")]);
    const nodes = selectedParagraphs(e.state);
    expect(addTabCommand(nodes, { pos: 2835, kind: "center" })).toEqual({ type: "setParagraphProps", blocks: [1], patch: { tabs: [{ pos: 2835, kind: "center" }] } });
    expect(moveTabCommand(nodes, 2835, { pos: 3402, kind: "center" })).toEqual({
      type: "setParagraphProps", blocks: [1], patch: { tabs: [{ pos: 2835, kind: "clear" }, { pos: 3402, kind: "center" }] },
    });
    expect(moveTabCommand(nodes, 2835, { pos: 2835, kind: "center" })).toBeNull();
    expect(removeTabCommand(nodes, 2835)).toEqual({ type: "setParagraphProps", blocks: [1], patch: { tabs: [{ pos: 2835, kind: "clear" }] } });
    const before = [{ pos: 1000, kind: "left" as const }, { pos: 2000, kind: "right" as const }];
    const after = [{ pos: 2000, kind: "right" as const, leader: "dot" as const }, { pos: 3000, kind: "decimal" as const }];
    expect(tabsPatch(before, after)).toEqual([{ pos: 1000, kind: "clear" }, { pos: 2000, kind: "right", leader: "dot" }, { pos: 3000, kind: "decimal" }]);
    expect(tabsDialogCommand(nodes, before, before)).toBeNull();
  });

  it("ruler helpers: snapping to 1/8 cm and the corner selector cycle", () => {
    expect(snapTwips(4540)).toBe(4535);
    expect(snapTwips(-20)).toBe(0);
    expect(["left", "center", "right", "decimal", "bar"].map((k) => nextTabKind(k as never))).toEqual(["center", "right", "decimal", "bar", "left"]);
  });

  it("paragraph box CSS: borders with their distance, left/right in the indent, shading", () => {
    const css = paragraphBoxCss({ left: { style: "single", width: 30, color: { kind: "rgb", value: "2E75B6" }, space: 6 } }, { kind: "rgb", value: "DEEBF7" }, { left: 0 });
    expect(css).toEqual(["background-color: #DEEBF7", "border-left: 2px solid #2E75B6", "padding-left: 8.00px", "margin-left: -10.00px"]);
    expect(paragraphBoxCss({ top: { style: "none", width: 0, color: { kind: "auto" } } }, { kind: "auto" }, null)).toEqual([]);
  });

  it("consecutive paragraphs with equal borders form one box (between border, inner spacing)", () => {
    const e = open([bordered(1, "a"), bordered(2, "b"), bordered(3, "c"), para(4, "d"), bordered(5, "e")]);
    const groups = borderGroups(e.state.doc);
    expect(groups.map((g) => g.map((m) => m.node.attrs.id))).toEqual([[1, 2, 3]]);
    const b = { bottom: PARA_BORDER, between: PARA_BORDER };
    expect(groupMemberCss(0, 3, b, null)).toBe("border-bottom: 1px solid #000; margin-bottom: 0; padding-bottom: 10.67px");
    expect(groupMemberCss(2, 3, b, { before: 120 })).toBe("border-top: none; padding-top: 8.00px; margin-top: 0");
    expect(groupMemberCss(0, 1, b, null)).toBeNull();
  });
});
