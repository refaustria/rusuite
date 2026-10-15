import { describe, expect, it } from "vitest";
import type { Table } from "../generated/Table";
import { body } from "../test/fixture";
import {
  alignCommand, anchorOf, bordersCommand, cellsIn, deleteColsCommand, deleteRowsCommand, distributeCommand, effectiveBorders, effectiveFill,
  expandRange, insertColsCommand, insertRowsCommand, keyMove, lookCommand, mergeCommand, moveCell, NO_LINE, resizeColCommand,
  resizeRowCommand, splitCommand, styleCell, styleCommand, TABLE_STYLES,
} from "./tables";

/** A rows × cols table in the default style; `merged` = [row, col, rowSpan, colSpan] regions. */
function table(rows: number, cols: number, merged: [number, number, number, number][] = []): Table {
  const t: Table = {
    rows: Array.from({ length: rows }, () => ({ height: 370840 })),
    cols: Array.from({ length: cols }, () => ({ width: 1000000 })),
    cells: Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => ({ text: body(`${r}${c}`) }))),
    styleId: TABLE_STYLES[0]!.id,
    look: { firstRow: true, bandRows: true },
  };
  for (const [r, c, rs, cs] of merged) {
    for (let i = r; i < r + rs; i++) for (let k = c; k < c + cs; k++) if (i !== r || k !== c) t.cells[i]![k]!.covered = true;
    Object.assign(t.cells[r]![c]!, { rowSpan: rs, colSpan: cs });
  }
  return t;
}

const accent = (slot: string, tint: number) => ({ kind: "theme", value: { slot, tint } });

describe("table styles", () => {
  it("Medium Style 2: accent header with bold light text, banded rows, white grid (thick under the header)", () => {
    const t = table(4, 2);
    expect(styleCell(t, 0, 0)).toMatchObject({ fill: accent("accent1", 0), bold: true, textColor: accent("light1", 0) });
    expect(styleCell(t, 1, 0).fill).toEqual(accent("accent1", 0.6));
    expect(styleCell(t, 2, 0).fill).toEqual(accent("accent1", 0.8));
    expect(styleCell(t, 0, 0).borders.bottom).toEqual({ color: accent("light1", 0), width: 38100 });
    expect(styleCell(t, 2, 1).borders.left).toEqual({ color: accent("light1", 0), width: 12700 });
  });

  it("the six built-ins differ by accent; an unknown style draws nothing", () => {
    expect(TABLE_STYLES.map((s) => s.accent)).toEqual([1, 2, 3, 4, 5, 6]);
    const t = { ...table(2, 2), styleId: TABLE_STYLES[3]!.id };
    expect(styleCell(t, 0, 0).fill).toEqual(accent("accent4", 0));
    const none = { ...table(2, 2), styleId: "{00000000-0000-0000-0000-000000000000}" };
    expect(styleCell(none, 0, 0)).toMatchObject({ fill: null, bold: false });
  });

  it("look options: total row and first column are emphasised, banded columns alternate", () => {
    const t = { ...table(3, 3), look: { lastRow: true, firstCol: true, bandCols: true } };
    expect(styleCell(t, 2, 1).bold).toBe(true);
    expect(styleCell(t, 1, 0).bold).toBe(true);
    expect(styleCell(t, 1, 1).fill).toEqual(accent("accent1", 0.6));
    expect(styleCell(t, 1, 2).fill).toEqual(accent("accent1", 0.8));
  });

  it("a cell's own fill and borders override the style (no fill = none)", () => {
    const t = table(2, 2);
    t.cells[1]![1]!.fill = { kind: "solid", value: { kind: "rgb", value: "FF0000" } };
    t.cells[1]![0]!.fill = { kind: "none" };
    t.cells[1]![0]!.borders = { top: NO_LINE };
    expect(effectiveFill(t, 1, 1)).toEqual({ kind: "rgb", value: "FF0000" });
    expect(effectiveFill(t, 1, 0)).toBeNull();
    expect(effectiveBorders(t, 1, 0).top).toBeNull();
    expect(effectiveBorders(t, 1, 0).left).not.toBeNull();
  });

  it("style gallery and look check boxes keep the other setting", () => {
    const t = table(2, 2);
    expect(styleCommand(7, t, TABLE_STYLES[1]!.id)).toEqual({ type: "setTableStyle", shape: 7, styleId: TABLE_STYLES[1]!.id, look: t.look });
    expect(lookCommand(7, t, "lastRow", true)).toEqual({ type: "setTableStyle", shape: 7, styleId: TABLE_STYLES[0]!.id, look: { firstRow: true, bandRows: true, lastRow: true } });
  });
});

describe("merged cells and ranges", () => {
  const t = table(3, 3, [[0, 1, 2, 2]]);

  it("finds the anchor of a covered cell", () => {
    expect(anchorOf(t, 1, 2)).toEqual([0, 1]);
    expect(anchorOf(t, 2, 2)).toEqual([2, 2]);
  });

  it("grows a range over the merged regions it touches", () => {
    expect(expandRange(t, { r0: 1, c0: 0, r1: 1, c1: 1 })).toEqual({ r0: 0, c0: 0, r1: 1, c1: 2 });
    expect(cellsIn(t, { r0: 0, c0: 0, r1: 1, c1: 2 })).toEqual([[0, 0], [0, 1], [1, 0]]);
  });

  it("Merge Cells covers the grown range; one cell gives nothing", () => {
    expect(mergeCommand(4, table(3, 3), { r0: 1, c0: 1, r1: 1, c1: 0 } as never)).toBeNull(); // reversed range: nothing valid
    expect(mergeCommand(4, table(3, 3), { r0: 1, c0: 0, r1: 1, c1: 1 })).toEqual({ type: "mergeTableCells", shape: 4, row: 1, col: 0, rowSpan: 1, colSpan: 2 });
    expect(mergeCommand(4, t, { r0: 0, c0: 1, r1: 1, c1: 2 })).toBeNull();
    expect(mergeCommand(4, t, { r0: 1, c0: 0, r1: 1, c1: 1 })).toEqual({ type: "mergeTableCells", shape: 4, row: 0, col: 0, rowSpan: 2, colSpan: 3 });
  });

  it("Split Cell undoes the merge of the region (from any of its cells)", () => {
    expect(splitCommand(4, t, 1, 2)).toEqual({ type: "splitTableCell", shape: 4, row: 0, col: 1 });
    expect(splitCommand(4, t, 2, 0)).toBeNull();
  });
});

describe("keyboard between cells", () => {
  const t = table(2, 3, [[0, 1, 1, 2]]);

  it("Tab / Shift+Tab in reading order; Tab in the last cell adds a row", () => {
    expect(moveCell(t, 0, 0, "next")).toEqual([0, 1]);
    expect(moveCell(t, 0, 1, "next")).toEqual([1, 0]);
    expect(moveCell(t, 1, 0, "prev")).toEqual([0, 1]);
    expect(moveCell(t, 1, 2, "next")).toBe("insertRow");
    expect(moveCell(t, 0, 0, "prev")).toBeNull();
  });

  it("arrows move over merged cells and wrap left / right at the row ends", () => {
    expect(moveCell(t, 1, 2, "up")).toEqual([0, 1]);
    expect(moveCell(t, 0, 1, "down")).toEqual([1, 1]);
    expect(moveCell(t, 0, 1, "right")).toEqual([1, 0]);
    expect(moveCell(t, 1, 0, "left")).toEqual([0, 1]);
    expect(moveCell(t, 1, 1, "down")).toBeNull();
  });

  it("arrow keys leave the cell only at the text's edges", () => {
    expect(keyMove("Tab", true, "ab", 1, 1)).toBe("prev");
    expect(keyMove("ArrowUp", false, "ab\ncd", 1, 1)).toBe("up");
    expect(keyMove("ArrowUp", false, "ab\ncd", 4, 4)).toBeNull();
    expect(keyMove("ArrowDown", false, "ab\ncd", 4, 4)).toBe("down");
    expect(keyMove("ArrowLeft", false, "ab", 0, 0)).toBe("left");
    expect(keyMove("ArrowRight", false, "ab", 2, 2)).toBe("right");
    expect(keyMove("ArrowRight", false, "ab", 0, 2)).toBeNull();
    expect(keyMove("Enter", false, "ab", 2, 2)).toBeNull();
  });
});

describe("Layout commands", () => {
  const t = table(3, 3);

  it("inserts as many rows / columns as selected, above / below / left / right", () => {
    expect(insertRowsCommand(1, t, { r0: 1, c0: 0, r1: 2, c1: 0 }, true)).toEqual({
      type: "compound",
      commands: [{ type: "insertTableRow", shape: 1, index: 3 }, { type: "insertTableRow", shape: 1, index: 3 }],
    });
    expect(insertRowsCommand(1, t, { r0: 1, c0: 0, r1: 1, c1: 0 }, false)).toEqual({ type: "insertTableRow", shape: 1, index: 1 });
    expect(insertColsCommand(1, t, { r0: 0, c0: 2, r1: 0, c1: 2 }, true)).toEqual({ type: "insertTableCol", shape: 1, index: 3 });
  });

  it("deletes rows / columns bottom-up; all of them deletes the table", () => {
    expect(deleteRowsCommand(1, t, { r0: 0, c0: 0, r1: 1, c1: 0 })).toEqual({
      type: "compound",
      commands: [{ type: "deleteTableRow", shape: 1, index: 1 }, { type: "deleteTableRow", shape: 1, index: 0 }],
    });
    expect(deleteColsCommand(1, t, { r0: 0, c0: 0, r1: 0, c1: 2 })).toEqual({ type: "deleteShapes", ids: [1] });
  });

  it("borders: all in one command, outside as four edges, none as explicit no-line", () => {
    const line = { fill: { kind: "solid" as const, value: { kind: "rgb" as const, value: "000000" } }, width: 12700, dash: "solid" as const };
    const r = { r0: 0, c0: 0, r1: 1, c1: 1 };
    expect(bordersCommand(1, r, "all", line)).toMatchObject({ type: "setTableCellProps", rowSpan: 2, colSpan: 2, patch: { left: line, top: line } });
    const out = bordersCommand(1, r, "outside", line);
    expect(out?.type === "compound" && out.commands.map((c) => (c.type === "setTableCellProps" ? Object.keys(c.patch)[0] : ""))).toEqual(["top", "bottom", "left", "right"]);
    expect(bordersCommand(1, r, "none", line)).toMatchObject({ patch: { left: NO_LINE, bottom: NO_LINE } });
    expect(bordersCommand(1, { r0: 0, c0: 0, r1: 0, c1: 0 }, "insideH", line)).toBeNull();
  });

  it("distributes the selected rows / columns evenly (all for one)", () => {
    const u = { ...table(2, 3), cols: [{ width: 100 }, { width: 200 }, { width: 600 }] };
    expect(distributeCommand(1, u, { r0: 0, c0: 0, r1: 0, c1: 1 }, "cols")).toEqual({ type: "setTableGrid", shape: 1, colWidths: [150, 150, 600] });
    expect(distributeCommand(1, u, null, "cols")).toEqual({ type: "setTableGrid", shape: 1, colWidths: [300, 300, 300] });
    expect(distributeCommand(1, table(2, 2), null, "rows")).toBeNull();
  });

  it("dragging borders: neighbouring columns share the change (minimum width), rows grow", () => {
    expect(resizeColCommand(1, t, 0, 200000)).toEqual({ type: "setTableGrid", shape: 1, colWidths: [1200000, 800000, 1000000] });
    expect(resizeColCommand(1, t, 0, 5000000)).toEqual({ type: "setTableGrid", shape: 1, colWidths: [1908560, 91440, 1000000] });
    expect(resizeColCommand(1, t, 2, -100)).toEqual({ type: "setTableGrid", shape: 1, colWidths: [1000000, 1000000, 999900] });
    expect(resizeRowCommand(1, t, 1, 100000)).toEqual({ type: "setTableGrid", shape: 1, rowHeights: [370840, 470840, 370840] });
    expect(resizeRowCommand(1, t, 1, 0)).toBeNull();
  });

  it("horizontal alignment rewrites the selected cells' paragraphs", () => {
    const c = alignCommand(1, t, { r0: 0, c0: 0, r1: 0, c1: 1 }, "center");
    expect(c?.type).toBe("compound");
    expect(c?.type === "compound" && c.commands[1]).toMatchObject({ type: "setTableCellText", row: 0, col: 1, body: { paragraphs: [{ props: { alignment: "center" }, runs: [{ text: "01" }] }] } });
  });
});
